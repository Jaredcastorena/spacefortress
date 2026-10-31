import { planetDefinitions, siteDefinition, settlementSite } from './region.js';
import { positionOf, sameCell, tileAt, tileEntityId } from './spatial.js';
import { contains, resourceEntries } from './inventory.js';
import { emitEvent } from './telemetry.js';

export const SATELLITE_COST = Object.freeze({ alloy: 6, components: 2, cells: 1, fuel: 2 });
export const SATELLITE_WORK = 16;
const owns = (value, key) => value != null && Object.hasOwn(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => owns(value, key));
const exactCost = cost => exact(cost, Object.keys(SATELLITE_COST)) && Object.entries(SATELLITE_COST).every(([resource, amount]) => cost[resource] === amount);
const planetFor = (s, site) => siteDefinition(s, site?.id)?.planetId || (!s.region && site?.id === 'surface' ? 'home' : null);
const pendingFor = (s, planetId, except = null) => (s.jobs || []).find(job => job !== except && job.kind === 'launchSatellite' && planetFor(s, s.sites[job.site]) === planetId);
const launchTile = (s, site, tile) => !!site && s.sites?.[site.id] === site && !!tile && tileAt(site, positionOf(tile)) === tile && (tile.z ?? 0) === 0 && (site.id === 'surface' ? tile.building === 'shuttle' : settlementSite(site) && tile.building === 'dock');

// Survey metadata is detached and deliberately contains no undiscovered world
// sectors. The caller may request the seeded atlas only when unlocked is true.
export function planetSurveyStatus(s, planetId) {
  const known = owns(planetDefinitions(s), planetId), launch = known && owns(s.satellites, planetId) ? s.satellites[planetId] : null;
  return { planetId, unlocked: !!launch, launchedAt: launch?.launchedAt ?? null, site: launch?.site ?? null, position: launch ? { ...launch.position } : null };
}

function launchStatus(s, site, tile, completing = null) {
  const planetId = planetFor(s, site), survey = planetSurveyStatus(s, planetId);
  const pending = pendingFor(s, planetId, completing);
  const result = { ok: false, ready: false, code: null, message: '', planetId, unlocked: survey.unlocked, launchedAt: survey.launchedAt, pendingJob: pending?.id || null, cost: { ...SATELLITE_COST }, work: SATELLITE_WORK };
  const reject = (code, message) => ({ ...result, code, message });
  if (!launchTile(s, site, tile) || !owns(planetDefinitions(s), planetId)) return reject('satellite_site', 'Select the surface shuttle or a settled planetary dock.');
  if (survey.unlocked) return reject('satellite_launched', 'This planet already has a survey satellite.');
  if (pending) return reject('satellite_pending', 'A survey satellite for this planet is already being assembled.');
  if (!(tile.hp >= 50)) return reject('satellite_damaged', 'Repair the launch structure to at least 50% condition.');
  if (tile.fire) return reject('satellite_fire', 'Suppress the fire before launching a satellite.');
  if (site.id === 'surface' && (s.mission || s.departure) || site.id !== 'surface' && s.mission?.site === site.id && s.mission.phase !== 'working') return reject('satellite_flight', 'Wait until the shuttle has finished its departure or flight at this launch site.');
  if (site.id !== 'surface') {
    const outpost = s.outposts?.[site.id];
    if (!outpost?.established || !s.crew.some(crew => crew.site === site.id && crew.health > 0 && outpost.residents.includes(crew.id))) return reject('satellite_unsettled', 'A living resident must be stationed at this dock before launching.');
  }
  if ((s.jobs || []).some(job => job !== completing && job.site === site.id && sameCell(positionOf(job), positionOf(tile)))) return reject('satellite_busy', 'Finish or cancel the work at this launch structure.');
  return { ...result, ok: true, ready: true, message: 'Ready to designate supplied satellite assembly and launch.' };
}

// These readers neither reserve supplies nor start work. The shared order path
// reserves this exact recipe and physically delivers it to the selected tile.
export function satelliteStatus(s, site, tile) { return launchStatus(s, site, tile); }
export function prepareSatelliteJob(s, site, tile) {
  const status = satelliteStatus(s, site, tile);
  return { ...status, building: null };
}

function validJobSpec(s, job) {
  const site = s.sites?.[job.site], tile = tileAt(site, positionOf(job));
  return launchTile(s, site, tile) && job.kind === 'launchSatellite' && job.building === null && exactCost(job.cost) && job.work === SATELLITE_WORK && job.missingFood === 0 && job.foodSpoiled === 0 && job.connection === undefined && job.utilityConnection === undefined;
}

// Called before the shared completion path removes the job and consumes its
// delivered inventory. False leaves every parcel with its existing owner so
// ordinary cancellation can refund it. A pending job is never an unlock.
export function completeSatelliteJob(s, crew, job) {
  if (!s.jobs.includes(job) || !validJobSpec(s, job) || !(job.remaining <= 0) || job.worker !== crew?.id || !s.crew.includes(crew) || !(crew.health > 0) || crew.site !== job.site || (crew.z ?? 0) !== job.z || !contains(job.materials || {}, SATELLITE_COST)) return false;
  if (resourceEntries(job.materials).some(([resource, amount]) => amount !== (SATELLITE_COST[resource] || 0))) return false;
  const site = s.sites[job.site], tile = tileAt(site, positionOf(job));
  const status = launchStatus(s, site, tile, job);
  if (!status.ok) return false;
  const launch = { launchedAt: s.tick, site: site.id, position: { x: tile.x, y: tile.y, z: tile.z ?? 0 } };
  if (!owns(s, 'satellites')) s.satellites = {};
  s.satellites[status.planetId] = launch;
  emitEvent(s, 'satellite.launched', { entity: `planet:${status.planetId}`, actor: crew.id, job: job.id, target: tileEntityId(site.id, tile.x, tile.y, tile.z ?? 0), planetId: status.planetId, site: `site:${site.id}`, cost: { ...SATELLITE_COST }, from: { entity: job.id, slot: 'materials' }, previous: null, next: { ...launch, position: { ...launch.position } }, tick: s.tick, reason: 'supplied_engineering_completed' });
  return true;
}

export function validateSatellites(s) {
  const jobs = (s.jobs || []).filter(job => job.kind === 'launchSatellite');
  if (s.version < 76 && (owns(s, 'satellites') || jobs.length)) throw new Error('Legacy satellite state or launch job.');
  if (owns(s, 'satellites')) {
    if (!record(s.satellites)) throw new Error('Invalid satellite registry.');
    for (const planetId of Reflect.ownKeys(s.satellites)) {
      const launch = s.satellites[planetId];
      if (!owns(planetDefinitions(s), planetId) || !exact(launch, ['launchedAt', 'site', 'position']) || !Number.isSafeInteger(launch.launchedAt) || launch.launchedAt < 0 || launch.launchedAt > s.tick || !exact(launch.position, ['x', 'y', 'z']) || !Object.values(launch.position).every(Number.isSafeInteger)) throw new Error('Invalid survey satellite record.');
      const site = s.sites[launch.site], tile = tileAt(site, launch.position);
      if (!launchTile(s, site, tile) || planetFor(s, site) !== planetId) throw new Error('Invalid satellite launch location.');
    }
  }
  const pending = new Set();
  for (const job of jobs) {
    const planetId = planetFor(s, s.sites[job.site]);
    // Damage, fire, residents and flight state may change after designation.
    // Those pending saves remain valid; completion rechecks live conditions.
    if (!validJobSpec(s, job) || !owns(planetDefinitions(s), planetId) || owns(s.satellites, planetId) || pending.has(planetId)) throw new Error('Invalid paid satellite launch job.');
    pending.add(planetId);
  }
}
