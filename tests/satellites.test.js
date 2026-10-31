import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { siteDefinition } from '../src/region.js';
import { add, syncResources, totalResources } from '../src/inventory.js';
import { cancelMaterials, reserveConstruction } from '../src/construction.js';
import { crewPathToPosition } from '../src/navigation.js';
import { startRecording, exportRecording } from '../src/telemetry.js';
import { SATELLITE_COST, SATELLITE_WORK, satelliteStatus, prepareSatelliteJob, completeSatelliteJob, validateSatellites, planetSurveyStatus } from '../src/satellites.js';

const snapshot = s => JSON.stringify(s);
function base() {
  const s = createGame(74219, { regionSchema: 2 });
  s.version = 76;
  const site = s.sites.surface, tile = site.tiles.find(t => t.building === 'shuttle');
  return { s, site, tile, crew: s.crew[0], planetId: siteDefinition(s, site.id).planetId };
}
// Synthetic hook fixture: one explicitly added cell makes the finite recipe
// available. Reservations/refunds use real custody; this is not a claim about
// an ordinary colony's complete production, hauling or engineering journey.
function supplied(f, staged = true) {
  const { s, site, tile, crew } = f;
  const depot = site.tiles.find(t => t.building === 'stockpile');
  add(depot.stock, { cells: 1 }); syncResources(s);
  const before = totalResources(s);
  const sources = reserveConstruction(s, site.id, tile.x, tile.y, SATELLITE_COST, (current, from, goals) => crewPathToPosition(s, current, from, goals), false, tile.z);
  assert.ok(sources, 'reachable physical recipe sources');
  const job = { id: `job-${s.nextId++}`, site: site.id, x: tile.x, y: tile.y, z: tile.z, kind: 'launchSatellite', building: null, cost: { ...SATELLITE_COST }, sources, materials: {}, work: SATELLITE_WORK, remaining: staged ? 0 : SATELLITE_WORK, worker: crew.id, priority: 3, blockedReason: null, missingFood: 0, foodSpoiled: 0 };
  if (staged) for (const source of sources) { add(job.materials, source.items); source.items = {}; }
  s.jobs.push(job); crew.job = job.id;
  return { job, before };
}
function finishOwnership(f, job) { f.s.jobs = f.s.jobs.filter(j => j !== job); f.crew.job = null; syncResources(f.s); }
function refund(f, job) { cancelMaterials(f.s, job); finishOwnership(f, job); }
function remote() {
  const f = base(), def = Object.values(f.s.region.sites).find(d => d.template === 'outcrop'), site = f.s.sites[def.id], tile = site.tiles.find(t => t.building === 'dock');
  f.crew.site = site.id; f.crew.x = tile.x + 1; f.crew.y = tile.y; f.crew.z = tile.z;
  f.s.outposts[site.id] = { established: true, residents: [f.crew.id] };
  return { ...f, site, tile, planetId: def.planetId };
}

test('locked satellite readers preserve all state and hide undiscovered sector data', () => {
  const f = base(), before = snapshot(f.s), status = satelliteStatus(f.s, f.site, f.tile);
  assert.equal(status.ready, true); assert.equal(status.unlocked, false); assert.equal(status.pendingJob, null);
  assert.deepEqual(planetSurveyStatus(f.s, f.planetId), { planetId: f.planetId, unlocked: false, launchedAt: null, site: null, position: null });
  assert.equal(planetSurveyStatus(f.s, 'constructor').unlocked, false);
  status.cost.alloy = 900;
  assert.equal(SATELLITE_COST.alloy, 6); assert.equal(snapshot(f.s), before); assert.equal(Object.hasOwn(f.s, 'satellites'), false);
});

test('job preparation exposes the exact finite recipe without reserving or unlocking', () => {
  const f = base(), before = snapshot(f.s), request = prepareSatelliteJob(f.s, f.site, f.tile);
  assert.equal(request.ok, true); assert.deepEqual(request.cost, { alloy: 6, components: 2, cells: 1, fuel: 2 });
  assert.equal(request.work, 16); assert.equal(request.building, null); assert.equal(request.planetId, f.planetId);
  assert.equal(snapshot(f.s), before);
});

test('launch requires an actual ground launch structure in a known physical site', () => {
  const f = base();
  for (const [site, tile] of [[f.site, { ...f.tile }], [f.site, f.site.tiles[0]], [{ ...f.site }, f.tile], [null, null]]) assert.equal(satelliteStatus(f.s, site, tile).code, 'satellite_site');
  f.tile.z = 1; assert.equal(satelliteStatus(f.s, f.site, f.tile).code, 'satellite_site');
});

test('damage, fire, flight, departure and other launch-tile work reject preparation', () => {
  const cases = [
    [f => { f.tile.hp = 49; }, 'satellite_damaged'],
    [f => { f.tile.fire = { intensity: 1 }; }, 'satellite_fire'],
    [f => { f.s.mission = { site: 'wreck', phase: 'working' }; }, 'satellite_flight'],
    [f => { f.s.departure = { site: 'wreck' }; }, 'satellite_flight'],
    [f => { f.s.jobs.push({ id: 'other', site: 'surface', x: f.tile.x, y: f.tile.y, z: 0, kind: 'repair' }); }, 'satellite_busy']
  ];
  for (const [edit, code] of cases) { const f = base(); edit(f); const before = snapshot(f.s); assert.equal(prepareSatelliteJob(f.s, f.site, f.tile).code, code); assert.equal(snapshot(f.s), before); }
});

test('one pending satellite per planet is visible without prematurely unlocking', () => {
  const f = base(), { job } = supplied(f, false), status = satelliteStatus(f.s, f.site, f.tile);
  assert.equal(status.code, 'satellite_pending'); assert.equal(status.pendingJob, job.id); assert.equal(status.unlocked, false);
  validateSatellites(f.s); assert.equal(planetSurveyStatus(f.s, f.planetId).unlocked, false);
});

test('completion requires the registered paid job, delivered full recipe and finished work', () => {
  const edits = [
    (f, j) => { j.materials.cells = 0; }, (f, j) => { j.materials.fuel = 3; }, (f, j) => { j.cost.alloy = 0; },
    (f, j) => { j.remaining = 1; }, (f, j) => { j.worker = 'other'; }, (f, j) => { f.crew.health = 0; },
    (f, j) => { f.crew.site = 'wreck'; }, (f, j) => { f.s.jobs = []; }, (f, j) => { j.work = 1; }
  ];
  for (const edit of edits) { const f = base(), { job } = supplied(f); edit(f, job); const before = snapshot(f.s); assert.equal(completeSatelliteJob(f.s, f.crew, job), false); assert.equal(snapshot(f.s), before); }
});

test('paid completion ignores itself, records the launch once and consumes only through job ownership', () => {
  const f = base(); startRecording(f.s);
  const { job, before } = supplied(f); f.s.tick = 31;
  assert.deepEqual(totalResources(f.s), before);
  assert.equal(completeSatelliteJob(f.s, f.crew, job), true);
  assert.deepEqual(job.materials, SATELLITE_COST, 'shared completion still owns the delivered inventory');
  finishOwnership(f, job);
  const after = totalResources(f.s);
  for (const [resource, amount] of Object.entries(SATELLITE_COST)) assert.equal(after[resource], before[resource] - amount, resource);
  assert.deepEqual(f.s.satellites[f.planetId], { launchedAt: 31, site: 'surface', position: { x: f.tile.x, y: f.tile.y, z: 0 } });
  assert.equal(satelliteStatus(f.s, f.site, f.tile).code, 'satellite_launched');
  assert.equal(completeSatelliteJob(f.s, f.crew, job), false); validateSatellites(f.s);
  const events = exportRecording(f.s).trim().split('\n').map(JSON.parse).filter(r => r.event?.id === 'satellite.launched');
  assert.equal(events.length, 1); assert.equal(events[0].event.job, job.id); assert.deepEqual(events[0].event.cost, SATELLITE_COST);
});

test('ordinary cancellation refunds both reserved and delivered satellite supplies without discovery', () => {
  for (const staged of [false, true]) {
    const f = base(), { job, before } = supplied(f, staged); refund(f, job);
    assert.deepEqual(totalResources(f.s), before); assert.equal(Object.hasOwn(f.s, 'satellites'), false); validateSatellites(f.s);
  }
});

test('changed launch conditions preserve delivered custody for ordinary cancellation', () => {
  const f = base(), { job, before } = supplied(f); f.tile.hp = 20;
  validateSatellites(f.s); const blocked = snapshot(f.s);
  assert.equal(completeSatelliteJob(f.s, f.crew, job), false); assert.equal(snapshot(f.s), blocked);
  refund(f, job); assert.deepEqual(totalResources(f.s), before); assert.equal(Object.hasOwn(f.s, 'satellites'), false);
});

test('remote launches require a real settled dock and a living physically present resident', () => {
  const f = remote(); assert.equal(satelliteStatus(f.s, f.site, f.tile).ready, true);
  f.s.outposts[f.site.id].established = false; assert.equal(satelliteStatus(f.s, f.site, f.tile).code, 'satellite_unsettled');
  f.s.outposts[f.site.id].established = true; f.crew.site = 'surface'; assert.equal(satelliteStatus(f.s, f.site, f.tile).code, 'satellite_unsettled');
  f.crew.site = f.site.id; f.crew.health = 0; assert.equal(satelliteStatus(f.s, f.site, f.tile).code, 'satellite_unsettled');
});

test('resident dock launch is independent of unrelated flights but blocks its departing shuttle', () => {
  const f = remote();
  f.s.mission = { site: 'wreck', phase: 'outbound' }; assert.equal(satelliteStatus(f.s, f.site, f.tile).ready, true);
  f.s.mission = { site: f.site.id, phase: 'working' }; assert.equal(satelliteStatus(f.s, f.site, f.tile).ready, true);
  f.s.mission.phase = 'boarding'; assert.equal(satelliteStatus(f.s, f.site, f.tile).code, 'satellite_flight');
});

test('launched survey metadata is detached and validates exact physical planet ownership', () => {
  const f = base(), { job } = supplied(f); assert.equal(completeSatelliteJob(f.s, f.crew, job), true); finishOwnership(f, job);
  const before = snapshot(f.s), status = planetSurveyStatus(f.s, f.planetId); status.position.x = 999;
  assert.equal(snapshot(f.s), before); validateSatellites(f.s);
  const edits = [
    s => { s.satellites = null; }, s => { s.satellites.unknown = s.satellites[f.planetId]; },
    s => { s.satellites[f.planetId].launchedAt = s.tick + 1; }, s => { s.satellites[f.planetId].position.z = 1; },
    s => { s.satellites[f.planetId].position.extra = 1; }, s => { s.satellites[f.planetId].site = 'missing'; },
    s => { s.satellites[f.planetId].extra = 1; }, s => { s.satellites[f.planetId].position.x = 0; }
  ];
  for (const edit of edits) { const changed = JSON.parse(before); edit(changed); assert.throws(() => validateSatellites(changed), /satellite/i); }
});

test('old saves remain locked without initialization and cannot smuggle future satellite state', () => {
  const f = base(); f.s.version = 75; const before = snapshot(f.s); validateSatellites(f.s); assert.equal(snapshot(f.s), before);
  f.s.satellites = {}; assert.throws(() => validateSatellites(f.s), /Legacy satellite/);
  delete f.s.satellites; supplied(f, false); assert.throws(() => validateSatellites(f.s), /Legacy satellite/);
});

test('pending job validation rejects unpaid recipes, duplicates and launched-planet jobs', () => {
  const f = base(), { job } = supplied(f, false), raw = snapshot(f.s);
  for (const edit of [s => { s.jobs[0].cost.cells = 0; }, s => { s.jobs[0].work = 2; }, s => { s.jobs[0].building = 'shuttle'; }, s => { s.jobs[0].z = 1; }, s => { s.jobs.push({ ...s.jobs[0], id: 'job-duplicate' }); }]) { const changed = JSON.parse(raw); edit(changed); assert.throws(() => validateSatellites(changed), /satellite/i); }
  f.s.satellites = { [f.planetId]: { launchedAt: 0, site: 'surface', position: { x: job.x, y: job.y, z: 0 } } };
  assert.throws(() => validateSatellites(f.s), /satellite/i);
});

test('pending and launched module state roundtrip deterministically without consulting runtime RNG', () => {
  const f = base(), { job } = supplied(f), rng = f.s.rng, copy = JSON.parse(snapshot(f.s));
  validateSatellites(copy); assert.equal(completeSatelliteJob(f.s, f.crew, job), true);
  assert.equal(completeSatelliteJob(copy, copy.crew.find(c => c.id === f.crew.id), copy.jobs.find(j => j.id === job.id)), true);
  finishOwnership(f, job); copy.jobs = []; copy.crew.find(c => c.id === f.crew.id).job = null; syncResources(copy);
  validateSatellites(copy); assert.equal(snapshot(copy), snapshot(f.s)); assert.equal(f.s.rng, rng);
});
