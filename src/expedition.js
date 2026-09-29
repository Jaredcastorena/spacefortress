import { emitEvent, emitItemMovement, tileEntityId } from './telemetry.js';
import { fitAmount, validItemLots, itemOwners } from './item-lots.js';
import { validFoodLots } from './food-lots.js';
import { isResident } from './outposts.js';
import { shuttleCargoClaims, hasOutgoingInventory } from './inventory-reservations.js';
import { immobile, impaired } from './mobility.js';
import { RESOURCES, SITES, SHUTTLE_FITS } from './data.js';
import { add, extract, resourceEntries, contains, quantity, spill, CARRY_CAPACITY } from './inventory.js';
import { moveCrew } from './atmosphere.js';
import { gainExperience } from './crew.js';

export function initializeShuttle(s) {
  s.shuttle = { fit: 'standard', accepted: ['components', 'cells', 'fuel', 'water', 'alloy', 'ore', 'food', 'air', 'ice'], freight: {} };
  if (s.mission) {
    s.mission.fit = 'standard'; s.mission.capacity = Math.max(18, quantity(s.mission.cargo));
    s.mission.legacyCapacity = s.mission.capacity > 18;
  }
}
export const routeTime = (s, siteId) => SITES[siteId].travel + SHUTTLE_FITS[s.mission?.site === siteId ? s.mission.fit : s.shuttle.fit].travel;
export const routeFuel = (s, siteId) => Math.max(1, SITES[siteId].fuel + SHUTTLE_FITS[s.shuttle.fit].fuel);
export const dockAt = site => site.tiles.find(t => t.building === 'dock' && t.hp > 0);
const xy = t => [t.x, t.y];
// Call only when creating a mission or deliberately migrating an older save.
// Current-schema validation never repairs a missing roster.
export function initializeReturnCrew(m) {
  if (m && m.returnCrew === undefined) m.returnCrew = [...m.crew];
}
export function returnCrewIds(s) {
  const m = s.mission;
  const ids = m?.returnCrew === undefined && s.version < 37 ? m?.crew : m?.returnCrew;
  return Array.isArray(ids) ? [...ids] : [];
}
export function returnCrewMembers(s, { livingOnly = false } = {}) {
  return returnCrewIds(s).map(id => s.crew.find(c => c.id === id)).filter(c => c && (!livingOnly || c.health > 0));
}
export function allReturnTravelersDead(s) {
  const ids = returnCrewIds(s);
  return ids.length > 0 && ids.every(id => { const c = s.crew.find(c => c.id === id); return c && c.health <= 0; });
}
export function isReturnTraveler(s, c) {
  const m = s.mission;
  return !!m && !!c && c.health > 0 && ['working', 'boarding'].includes(m.phase) && c.site === m.site && returnCrewIds(s).includes(c.id);
}
const abandonedArrival = (s, ids) => s.mission.crew.some(id => {
  const c = s.crew.find(c => c.id === id);
  return c?.health > 0 && !ids.includes(id) && (c.site !== s.mission.site || !isResident(s, id, s.mission.site));
});
export function setReturnCrew(s, crewIds) {
  const m = s.mission, reject = (code, message) => ({ ok: false, code, message });
  if (!m || !['working', 'boarding'].includes(m.phase)) return reject('return_unavailable', 'Select return passengers while the shuttle is at the destination.');
  if (!Array.isArray(crewIds) || crewIds.length < 1 || crewIds.length > 2 || new Set(crewIds).size !== crewIds.length || !Array.from(crewIds).every(id => typeof id === 'string' && s.crew.some(c => c.id === id))) return reject('invalid_return_crew', 'Select one or two distinct known crew members.');
  if (crewIds.some(id => { const c = s.crew.find(c => c.id === id); return c.health <= 0 || c.site !== m.site; })) return reject('return_crew_unavailable', 'Every selected passenger must be alive and physically at the shuttle destination.');
  if (abandonedArrival(s, crewIds)) return reject('unassigned_visitor', 'Station departing visitors before leaving them off the return roster.');
  const previous = returnCrewIds(s), removed = returnCrewMembers(s).filter(c => !crewIds.includes(c.id));
  if (removed.some(c => c.carry && c.delivery?.kind === 'shuttle' || c.intent?.type === 'salvage')) return reject('return_cargo_pending', 'Finish the removed passenger’s shuttle shipment before changing the return roster.');
  if (previous.length === crewIds.length && previous.every((id, i) => id === crewIds[i])) return { ok: true };
  m.returnCrew = [...crewIds];
  emitEvent(s, 'expedition.return_manifest.changed', { entity: 'colony', site: `site:${m.site}`, crewIds: [...m.crew], previous, next: [...crewIds], reason: 'passengers_selected', tick: s.tick });
  return { ok: true };
}
export function validateReturnCrew(s) {
  const m = s.mission; if (!m) return;
  const ids = m.returnCrew === undefined && s.version < 37 ? m.crew : m.returnCrew;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 2 || new Set(ids).size !== ids.length || !Array.from(ids).every(id => typeof id === 'string' && s.crew.some(c => c.id === id))) throw new Error('Invalid expedition return roster.');
  if (m.phase === 'outbound' && (ids.length !== m.crew.length || ids.some((id, i) => id !== m.crew[i]))) throw new Error('Outbound return roster must match the arrival crew.');
  const expected = ['working', 'boarding'].includes(m.phase) ? m.site : 'transit';
  if (ids.some(id => { const c = s.crew.find(c => c.id === id); return c.health > 0 && c.site !== expected; })) throw new Error('Return passenger is in the wrong location.');
  if (abandonedArrival(s, ids)) throw new Error('Living arrival crew cannot be left without residence.');
  for (const c of s.crew) if (c.site === m.site && !ids.includes(c.id) && (c.carry && c.delivery?.kind === 'shuttle' || c.intent?.type === 'salvage')) throw new Error('Shuttle shipment has no assigned return passenger.');
}
const context=(s)=>({entity:'colony',crewIds:[...s.mission.crew],returnCrewIds:returnCrewIds(s),site:`site:${s.mission.site}`,tick:s.tick});
export const reservedCargo = s => s.mission ? shuttleCargoClaims(s, s.mission.site, returnCrewIds(s)) : 0;
export const cargoFree = s => s.mission ? Math.max(0, s.mission.capacity - quantity(s.shuttle.freight) - quantity(s.mission.cargo) - reservedCargo(s)) : 0;
export function setCargoAccepted(s, resource, enabled) {
  if (!RESOURCES.includes(resource) || typeof enabled !== 'boolean') return { ok: false, message: 'Select a cargo type.' };
  s.shuttle.accepted = enabled ? [...new Set([...s.shuttle.accepted, resource])] : s.shuttle.accepted.filter(r => r !== resource);
  // Uncollected reservations can be reconsidered; carried shipments keep their destination.
  for (const c of s.crew) if (c.intent?.type === 'salvage') c.intent = null;
  return { ok: true };
}
function move(c, site, target, pathTo) {
  const route = pathTo(site, c, [target]);
  if (route === null) return 'blocked';
  if (!route.length) return 'arrived';
  moveCrew(c, site, route[0]); return 'moving';
}
export function haulSalvage(s, c, site, pathTo) {
  const m = s.mission; if (!isReturnTraveler(s, c) || m.site !== site.id) return false;
  // Local building, depot and machine shipments retain their actual owners.
  if (c.carry && c.delivery?.kind !== 'shuttle') return false;
  const dock = dockAt(site);
  if (c.carry) {
    if (!dock) { c.activity = 'No usable shuttle dock; holding cargo'; return true; }
    const result = move(c, site, xy(dock), pathTo);
    c.activity = result === 'blocked' ? 'Shuttle route blocked; holding cargo' : 'Carrying salvage to shuttle';
    if (result === 'arrived') {
      const room = Math.max(0, m.capacity - quantity(s.shuttle.freight) - quantity(m.cargo)), shipment = {}; let left = room;
      for (const [r, amount] of resourceEntries(c.carry)) { const n = fitAmount(r,amount,left); if (n) shipment[r] = n; left -= n; }
      const moved=extract(c.carry,shipment);emitItemMovement(s,moved,c.id,{entity:c.id,slot:'carry'},{entity:'colony',slot:'mission.cargo'});add(m.cargo,moved);
      if(quantity(moved))emitEvent(s,'expedition.salvage.delivered',{...context(s),actor:c.id,cargo:moved,from:{entity:c.id,slot:'carry'},to:{entity:'colony',slot:'mission.cargo'},reason:'dock_delivery'});
      if (quantity(c.carry)) { emitItemMovement(s,c.carry,c.id,{entity:c.id,slot:'carry'},{entity:tileEntityId(site.id,dock.x,dock.y),slot:'drop'});spill(dock, c.carry);emitEvent(s,'expedition.salvage.spilled',{...context(s),actor:c.id,cargo:c.carry,from:{entity:c.id,slot:'carry'},to:{entity:tileEntityId(site.id,dock.x,dock.y),slot:'drop'},reason:'hold_full'}); }
      c.carry = null; c.delivery = null; c.intent = null; gainExperience(c, 'hauling', 4);
    }
    return true;
  }
  if (m.phase !== 'working' || !c.labors.hauling || !dock) { if (c.intent?.type === 'salvage') c.intent = null; return false; }
  if (!c.intent) {
    const free = Math.min(CARRY_CAPACITY, cargoFree(s));
    if (free <= 0) { c.activity = 'Shuttle hold reserved or full'; return true; }
    const options = site.tiles.filter(t => quantity(t.drop) && !hasOutgoingInventory(s, site.id, xy(t), 'drop', c)).map(t => ({ t, path: pathTo(site, c, [xy(t)]) })).filter(o => o.path !== null && pathTo(site, o.t, [xy(dock)]) !== null).sort((a, b) => a.path.length - b.path.length || a.t.y - b.t.y || a.t.x - b.t.x);
    for (const { t } of options) {
      const items = {}; let room = free;
      for (const r of s.shuttle.accepted) { const n = fitAmount(r,t.drop[r]||0,room); if (n) items[r] = n; room -= n; }
      if (quantity(items)) { c.intent = { type: 'salvage', target: xy(t), items }; break; }
    }
  }
  if (c.intent?.type !== 'salvage') return false;
  const intent = c.intent, tile = site.tiles[intent.target[1] * site.size + intent.target[0]];
  if (!tile.drop || !contains(tile.drop, intent.items)) { c.intent = null; return true; }
  const result = move(c, site, intent.target, pathTo); c.activity = 'Collecting salvage for shuttle';
  if (result === 'arrived') { c.carry = extract(tile.drop, intent.items);emitItemMovement(s,c.carry,c.id,{entity:tileEntityId(site.id,...intent.target),slot:'drop'},{entity:c.id,slot:'carry'});emitEvent(s,'expedition.salvage.picked_up',{...context(s),actor:c.id,cargo:c.carry,from:{entity:tileEntityId(site.id,...intent.target),slot:'drop'},to:{entity:c.id,slot:'carry'},reason:'reserved_pickup'}); c.delivery = { kind: 'shuttle', target: xy(dock) }; c.intent = null; if (!quantity(tile.drop)) tile.drop = null; }
  else if (result === 'blocked') { c.intent = null; c.activity = 'Salvage route blocked'; }
  return true;
}
export function boardShuttle(s, c, site, pathTo) {
  if (s.mission?.phase !== 'boarding' || !isReturnTraveler(s, c) || site.id !== s.mission.site) return false;
  if (c.carry && c.delivery?.kind !== 'shuttle') return false;
  const dock=dockAt(site),aboard=!!dock&&c.x===dock.x&&c.y===dock.y&&!c.carry,origin=tileEntityId(site.id,c.x,c.y);
  if (c.carry) { haulSalvage(s, c, site, pathTo);if(!aboard&&!c.carry&&dock&&c.x===dock.x&&c.y===dock.y)emitEvent(s,'expedition.crew.boarded',{...context(s),actor:c.id,from:{entity:origin,slot:'location'},to:{entity:tileEntityId(site.id,dock.x,dock.y),slot:'boarding'},reason:'return_after_delivery'});return true; }
  const result = dock ? move(c, site, xy(dock), pathTo) : 'blocked';
  c.activity = result === 'blocked' ? 'Return route blocked; needs rescue' : result === 'arrived' ? 'At shuttle; waiting for team' : 'Returning to shuttle';
  if(!aboard&&dock&&c.x===dock.x&&c.y===dock.y)emitEvent(s,'expedition.crew.boarded',{...context(s),actor:c.id,from:{entity:origin,slot:'location'},to:{entity:tileEntityId(site.id,dock.x,dock.y),slot:'boarding'},reason:'return'});
  return true;
}
export function returnWalk(s, pathTo) {
  const m = s.mission; if (!m) return Infinity;
  const site = s.sites[m.site], dock = dockAt(site); if (!dock) return Infinity;
  const ids = returnCrewIds(s), members = returnCrewMembers(s);
  if (!ids.length || members.length !== ids.length) return Infinity;
  const team = members.filter(c => c.health > 0);
  if (team.some(c => c.site !== site.id)) return Infinity;
  return Math.max(0, ...team.map(c => {
    const distance = pathTo(site, c, [xy(dock)])?.length ?? Infinity;
    if (!immobile(c)) return distance * (impaired(c) || c.rescue?.carrying ? 2 : 1);
    if (!distance) return 0;
    const helpers = team.filter(other => other.id !== c.id && !impaired(other) && other.labors.medicine);
    const approach = Math.min(Infinity, ...helpers.map(other => pathTo(site, other, [[c.x + 1, c.y], [c.x - 1, c.y], [c.x, c.y + 1], [c.x, c.y - 1]])?.length ?? Infinity));
    return approach + distance * 2 + 3;
  }));
}
export function resumeExpedition(s) {
  const m = s.mission;
  if (!m || m.phase !== 'boarding' || !returnCrewMembers(s, { livingOnly: true }).some(c => c.site === m.site)) return { ok: false, message: 'No boarding team can resume work.' };
  m.phase = 'working';emitEvent(s,'expedition.resumed',{...context(s),previous:'boarding',next:'working',reason:'player_resume'});return { ok: true };
}
export function validateShuttle(s) {
  const fits = Object.keys(SHUTTLE_FITS), shuttle = s.shuttle;
  if (!shuttle || !fits.includes(shuttle.fit) || !Array.isArray(shuttle.accepted) || new Set(shuttle.accepted).size !== shuttle.accepted.length || !shuttle.accepted.every(r => RESOURCES.includes(r))) throw new Error('Invalid shuttle configuration.');
  const freight = shuttle.freight;
  if (freight !== undefined || s.version >= 37) {
    if (!freight || typeof freight !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(freight)) || !Object.entries(freight).every(([r, n]) => ['_food', '_items'].includes(r) || RESOURCES.includes(r) && Number.isFinite(n) && n >= 0)) throw new Error('Invalid shuttle freight.');
    for (const field of ['_food', '_items']) if (Object.hasOwn(freight, field) && (!Array.isArray(freight[field]) || !Array.from(freight[field]).every(lot => lot && typeof lot === 'object' && !Array.isArray(lot)))) throw new Error('Invalid shuttle freight metadata.');
    if (!validFoodLots(freight) || !validItemLots(freight, true) || !Number.isFinite(quantity(freight))) throw new Error('Invalid shuttle freight.');
    if (freight._items && new Set(freight._items.map(item => item.id)).size !== freight._items.length) throw new Error('Duplicate physical item in shuttle freight.');
    if (itemOwners(s).some(owner => owner.inventory === freight && !(owner.location.entity === 'colony' && owner.location.slot === 'shuttle.freight'))) throw new Error('Shuttle freight cannot alias another inventory.');
    if (quantity(freight) > SHUTTLE_FITS[shuttle.fit].capacity + 1e-8) throw new Error('Shuttle freight exceeds hold capacity.');
  }
  for (const j of s.jobs) if (j.kind === 'refit' && (j.site !== 'surface' || s.sites.surface.tiles[j.y * s.sites.surface.size + j.x].building !== 'shuttle' || !fits.includes(j.building) || j.building === shuttle.fit || s.mission || s.departure || quantity(freight) > SHUTTLE_FITS[j.building].capacity + 1e-8)) throw new Error('Invalid shuttle fitting order.');
  const claimed = new Set();
  for (const c of s.crew) if (c.intent?.type === 'salvage') {
    const tile = s.sites[c.site].tiles[c.intent.target[1] * s.sites[c.site].size + c.intent.target[0]], id = `${c.site}/${c.intent.target.join(',')}`;
    if (claimed.has(id) || !tile.drop || !contains(tile.drop, c.intent.items)) throw new Error('Invalid or duplicate salvage reservation.');
    claimed.add(id);
  }
  const m = s.mission;
  if (m) {
    validateReturnCrew(s);
    const held = quantity(freight) + quantity(m.cargo) + reservedCargo(s);
    if (!fits.includes(m.fit) || m.fit !== shuttle.fit || typeof m.legacyCapacity !== 'boolean' || !Number.isFinite(m.capacity) || m.capacity < 0 || !Number.isFinite(held) || (m.legacyCapacity ? m.fit !== 'standard' || m.capacity < 18 || m.capacity !== quantity(m.cargo) : m.capacity !== SHUTTLE_FITS[m.fit].capacity) || held > m.capacity + 1e-8) throw new Error('Invalid shuttle cargo capacity.');
    if (!Number.isInteger(m.remaining) || m.remaining > routeTime(s, m.site) || (['working', 'boarding'].includes(m.phase) && m.remaining !== 0)) throw new Error('Invalid shuttle travel time.');
  }
}
