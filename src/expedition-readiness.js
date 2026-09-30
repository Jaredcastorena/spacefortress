import { SITES } from './data.js';
import { routeTime } from './expedition.js';

// Readiness is a current observation, not a reservation or a promise that the
// crew will still be ready after supplies are hauled and boarding is complete.
export function expeditionCrewStatus(c, { boarding = false } = {}) {
  let blocked = null, reason = 'Ready';
  if (!c) { blocked = 'unknown_crew'; reason = 'Unknown crew member.'; }
  else if (c.health <= 0) { blocked = 'deceased'; reason = 'Deceased.'; }
  else if (c.site !== 'surface') { blocked = 'away'; reason = 'Not at the surface colony.'; }
  else if (c.life.policy === 'rest') { blocked = 'off_duty'; reason = 'Off duty under the rest routine.'; }
  else if (c.rescue) { blocked = 'rescue'; reason = 'A rescue is still in progress.'; }
  else if (c.medical.injury) { blocked = 'injured'; reason = 'Needs injury treatment.'; }
  else if (!(Math.abs(c.thermalStress) < 45)) { blocked = 'thermal_stress'; reason = 'Needs recovery from heat or cold.'; }
  else if (!(c.health > 50)) { blocked = 'low_health'; reason = 'Health must be above 50.'; }
  // At actual boarding, the existing paid suit refill restores oxygen. Initial
  // team selection still requires a more-than-half-full suit, as before.
  else if (!boarding && !(c.oxygen > 50)) { blocked = 'low_oxygen'; reason = 'Suit oxygen must be above 50.'; }
  else if (!(c.energy >= 40)) { blocked = 'low_energy'; reason = 'Energy must be at least 40.'; }
  else if (!(c.hunger >= 40)) { blocked = 'hungry'; reason = 'Food reserve must be at least 40.'; }
  else if (c.intent) { blocked = 'occupied'; reason = 'Finishing a personal task or pickup.'; }
  else if (c.carry) { blocked = 'carrying'; reason = 'Needs to put carried cargo away.'; }
  return { id: c?.id ?? null, eligible: blocked === null, blocked, reason };
}

export function expeditionCandidates(s) {
  return s.crew.map(c => expeditionCrewStatus(c));
}

export function expeditionCrewLimits(s, siteId) {
  return { min: s.version >= 38 && siteId === 'wreck' && s.outposts?.wreck?.established === true ? 1 : 2, max: 2, defaultCount: 2 };
}
export function expeditionCrewCountAllowed(s, siteId, count) {
  const limits = expeditionCrewLimits(s, siteId);
  return Number.isInteger(count) && count >= limits.min && count <= limits.max;
}

// Successful selection returns real crew references for the gameplay caller;
// observations should use the detached statuses/IDs instead of these references.
export function selectExpeditionCrew(s, crewIds = undefined, siteId = undefined) {
  const explicit = crewIds !== undefined;
  if (explicit && (!Array.isArray(crewIds) || !Array.from(crewIds).every(id => typeof id === 'string' && id.length > 0))) return { ok: false, code: 'invalid_crew_selection', message: 'Choose crew by their known crew IDs.', crewIds: [], crew: [] };
  if (explicit && !expeditionCrewCountAllowed(s, siteId, crewIds.length)) return { ok: false, code: 'crew_count', message: expeditionCrewLimits(s, siteId).min === 1 ? 'Choose one or two crew members for the established wreck outpost.' : 'Choose exactly two crew members.', crewIds: [...crewIds], crew: [] };
  if (explicit && new Set(crewIds).size !== crewIds.length) return { ok: false, code: 'duplicate_crew', message: 'Choose two different crew members.', crewIds: [...crewIds], crew: [] };
  const selected = explicit ? crewIds.map(id => s.crew.find(c => c.id === id)) : s.crew.filter(c => expeditionCrewStatus(c).eligible).slice(0, 2);
  if (explicit && selected.some(c => !c)) {
    return { ok: false, code: 'unknown_crew', message: 'A selected crew member is not part of this colony.', crewIds: [...crewIds], crew: [] };
  }
  if (!explicit && selected.length < 2) {
    return { ok: false, code: 'insufficient_crew', message: 'Need two healthy, supplied crew without carried cargo.', crewIds: selected.map(c => c.id), crew: [] };
  }
  const unavailable = selected.map(c => expeditionCrewStatus(c)).find(status => !status.eligible);
  if (unavailable) {
    const member = selected.find(c => c.id === unavailable.id);
    return { ok: false, code: 'crew_unavailable', message: `${member.name || member.id}: ${unavailable.reason}`, crewIds: [...crewIds], crew: [], blockedCrew: unavailable };
  }
  return { ok: true, code: null, message: 'Crew selected.', crewIds: selected.map(c => c.id), crew: selected };
}

// Preserve the existing initial-launch gate order. Supplies and walking routes
// are handled by physical preflight work; this does not promise a departure.
export function expeditionLaunchBlock(s, siteId) {
  if (!SITES[siteId]?.fuel) return { code: 'invalid_destination', message: 'Select an orbital destination.' };
  if (s.mission || s.departure) return { code: 'expedition_busy', message: 'The shuttle already has an expedition or departure plan.' };
  if (s.jobs.some(j => j.site === 'surface' && j.x === 16 && j.y === 11)) return { code: 'shuttle_work', message: 'Finish work at the shuttle before departure.' };
  const ship = s.sites.surface.tiles[11 * s.sites.surface.size + 16];
  if (ship?.building !== 'shuttle' || ship.hp < 50) return { code: 'shuttle_damaged', message: 'Finish the shuttle refit or repair before departure.' };
  if (siteId === 'comet' && (s.tick < s.comet.arrives || s.tick + routeTime(s, 'comet') * 2 + 20 >= s.comet.leaves)) return { code: 'comet_window', message: 'No safe comet approach window.' };
  if (siteId === 'solar' && !s.flags.salvageReturned) return { code: 'solar_locked', message: 'Recover satellite components to survey Helios Reach.' };
  return null;
}
