import { GAS_PER_TILE, breathable, refreshAtmosphere } from './atmosphere.js';
import { temperature, thermalSafe } from './thermal.js';
import { previewPower, breakerConditions } from './power.js';
import { pathTo, passable } from './navigation.js';
import { livingAllowed } from './rooms.js';
import { availableInventory } from './inventory-reservations.js';
import { impaired, immobile } from './mobility.js';
import { RESOURCES, RECIPES } from './data.js';

// Commissioning guards in existing game units, not endurance predictions.
export const OUTPOST_RESERVES = Object.freeze({ foodPerResident: 2, airPerResident: 5, reactorFuel: 1 });
const xy = t => [t.x, t.y];
const position = t => `${t.x},${t.y}`;
const byPosition = (a, b) => a.y - b.y || a.x - b.x;
const entity = (site, t) => `tile:${site.id}:${t.x}:${t.y}`;
const working = t => t.hp > 0 && !t.fire;
const reachable = (site, from, to) => passable(site, from.x, from.y) && pathTo(site, from, [xy(to)]) !== null;
const amount = n => Number.isFinite(n) && n > 0 ? n : 0;
const note = (code, message, details = {}) => ({ code, message, ...details });
const roomId = (site, room) => `room:${site.id}:${[...room.cells].sort((a, b) => {
  const [ax, ay] = a.split(',').map(Number), [bx, by] = b.split(',').map(Number);
  return ay - by || ax - bx;
})[0]}`;

// Match distinct beds, rather than assuming a count proves each person has one.
function assignBeds(site, crew, beds) {
  const owner = new Map();
  function place(c, seen) {
    for (const bed of beds) {
      const key = position(bed);
      if (seen.has(key) || !reachable(site, c, bed)) continue;
      seen.add(key);
      if (!owner.has(key) || place(owner.get(key), seen)) { owner.set(key, c); return true; }
    }
    return false;
  }
  for (const c of crew) place(c, new Set());
  return new Map([...owner].map(([key, c]) => [c.id, beds.find(t => position(t) === key)]));
}

/** Inspect actual wreck conditions without moving, allocating or initializing anything.
 * crewIds is the complete proposed living resident roster. Empty means no selection.
 * All returned data is detached; no inventory/room/crew reference escapes.
 */
export function outpostReadiness(s, siteId = 'wreck', crewIds = []) {
  const result = {
    site: siteId, crewIds: [], ready: false, blockers: [], dock: null, rooms: [],
    bunks: { available: 0, required: 0, assignments: [] },
    provisions: { available: Object.fromEntries(RESOURCES.map(r => [r, 0])), required: { food: 0, air: 0, fuel: 0, medicine: 0 }, sources: [] },
    power: { circuits: [], output: 0, demand: 0, storedEnergy: 0, reactorDependent: false }, crew: [],
  };
  const site = s.sites?.[siteId], block = (...args) => result.blockers.push(note(...args));
  if (siteId !== 'wreck' || !site) { block('unsupported_site', 'Settlement currently requires the wreck site.'); return result; }
  if (!Array.isArray(crewIds) || Object.keys(crewIds).length !== crewIds.length ||
      !Array.from(crewIds).every((id, i) => Object.hasOwn(crewIds, i) && typeof id === 'string' && s.crew.some(c => c.id === id)) ||
      new Set(crewIds).size !== crewIds.length) {
    block('invalid_residents', 'Choose distinct known crew members.'); return result;
  }
  result.crewIds = [...crewIds]; result.bunks.required = crewIds.length;
  if (!crewIds.length) block('crew_selection_required', 'Select the proposed residents to check their habitat.');
  const proposed = crewIds.map(id => s.crew.find(c => c.id === id));
  const local = proposed.filter(c => c.health > 0 && c.site === siteId);
  for (const c of proposed) if (!local.includes(c)) block('crew_unavailable', 'Every proposed resident must be alive and physically at the wreck.', { crew: c.id });

  const terminals = site.tiles.filter(t => t.building === 'dock').sort(byPosition);
  const dock = terminals.find(working);
  if (!dock) block(terminals.length ? 'dock_damaged' : 'dock_missing', 'A functioning local dock is required.');
  else result.dock = { entity: entity(site, dock), x: dock.x, y: dock.y, condition: dock.hp };
  const dockRoutes = new Map(), localRoutes = new Map();
  const fromDock = t => {
    if (!dockRoutes.has(t)) dockRoutes.set(t, !!dock && reachable(site, dock, t));
    return dockRoutes.get(t);
  };
  const accessible = t => {
    if (!localRoutes.has(t)) localRoutes.set(t, fromDock(t) && local.every(c => reachable(site, c, t)));
    return localRoutes.get(t);
  };
  const depots = site.tiles.filter(t => t.building === 'stockpile' && working(t) && t.stock && accessible(t));
  if (!depots.length) block('depot_unreachable', 'Build a functioning cargo depot reachable from the dock and proposed residents.');

  // Read the current physical allocation instead of trusting stale display flags.
  const plan = previewPower(s, site), networkOf = new Map();
  for (const network of plan.networks) for (const t of network.tiles) networkOf.set(t, network);
  const faultCircuits = new Set(plan.networks.filter(n => n.activeFaults.length).map(n => n.id));
  for (const t of site.tiles.filter(t => t.building === 'breaker')) if (breakerConditions(s, site, t, plan).wouldTrip) {
    const network = networkOf.get(t); if (network) faultCircuits.add(network.id);
  }
  const operative = t => working(t) && plan.powered.has(t) && !faultCircuits.has(networkOf.get(t)?.id);
  const byCell = new Map(), eligibleRooms = new Set(), devicesByRoom = new Map();
  // Refresh only detached readings, including actual current hull/door seals.
  const measuredSite = { ...site, rooms: site.rooms.map(room => ({ ...room, gas: { ...room.gas } })) };
  refreshAtmosphere(measuredSite);
  for (const room of measuredSite.rooms) {
    const measured = room;
    const tiles = room.cells.map(k => { const [x, y] = k.split(',').map(Number); return site.tiles[y * site.size + x]; });
    const support = tiles.filter(t => t.building === 'scrubber' && t.machine?.enabled && operative(t));
    const climates = tiles.filter(t => t.building === 'climate' && t.climate?.enabled && operative(t));
    const warmControl = climates.some(t => t.climate.target >= 5 && t.climate.target <= 35);
    const safe = breathable(measured), temperate = thermalSafe(measured), reached = tiles.some(fromDock);
    const issues = [];
    if (!room.sealed) issues.push(note('room_unsealed', 'Seal this compartment.'));
    if (!safe) issues.push(note('air_unsafe', 'Compartment air is not breathable.'));
    if (!temperate) issues.push(note('temperature_unsafe', 'Compartment temperature must be 5–35 °C.'));
    if (!reached) issues.push(note('room_unreachable', 'Connect this compartment to the dock.'));
    if (tiles.some(t => t.fire)) issues.push(note('habitat_fire', 'Suppress the fire in this compartment.'));
    if (!tiles.every(t => livingAllowed(site, t.x, t.y))) issues.push(note('living_area_required', 'Living spaces cannot be designated as waste storage.'));
    if (!support.length) issues.push(note('life_support_unpowered', 'Provide functioning, enabled and wired life support.'));
    if (!warmControl || climates.some(t => t.climate.target < 5 || t.climate.target > 35)) issues.push(note('climate_unavailable', 'Provide powered climate control with safe temperature targets.'));
    const reading = {
      entity: roomId(site, room), volume: room.volume, pressure: measured.pressure,
      oxygenPartialPressure: measured.gas.oxygen / (room.volume * GAS_PER_TILE) * 100,
      co2Fraction: measured.co2Fraction, smoke: amount(room.smoke), temperature: temperature(measured),
      sealed: room.sealed, breathable: safe, thermalSafe: temperate, reachable: reached,
      lifeSupport: support.map(t => entity(site, t)), climate: climates.map(t => entity(site, t)),
      ready: !issues.length, blockers: issues,
    };
    result.rooms.push(reading); for (const t of tiles) byCell.set(position(t), reading);
    if (!issues.length) eligibleRooms.add(reading.entity);
    if (reached && tiles.some(t => t.building === 'bunk')) devicesByRoom.set(reading.entity, support.concat(climates));
  }
  if (!eligibleRooms.size) {
    const candidate = result.rooms.filter(r => site.tiles.some(t => t.building === 'bunk' && byCell.get(position(t)) === r))
      .sort((a, b) => Number(b.reachable) - Number(a.reachable) || a.blockers.length - b.blockers.length || a.entity.localeCompare(b.entity))[0];
    if (candidate) for (const issue of candidate.blockers) block(issue.code, issue.message, { room: candidate.entity });
    block('habitat_unready', 'A reachable sealed, breathable and warm compartment needs operating life support and climate control.');
  }
  const beds = site.tiles.filter(t => t.building === 'bunk' && working(t) && eligibleRooms.has(byCell.get(position(t))?.entity) && fromDock(t)).sort(byPosition);
  result.bunks.available = beds.length;
  const bedsByCrew = assignBeds(site, local, beds);
  for (const c of local) {
    const bed = bedsByCrew.get(c.id), dockReachable = !!dock && reachable(site, c, dock);
    const careNeeded = impaired(c) || c.health < 40;
    const details = { id: c.id, dockReachable, bunk: bed ? entity(site, bed) : null, injury: c.medical?.injury || 0, careNeeded, medicalCot: null, caregiver: null };
    result.crew.push(details);
    if (!dockReachable) block('dock_unreachable', 'The proposed resident cannot reach the local dock.', { crew: c.id });
    if (!bed) block('bunk_unavailable', 'Each proposed resident needs a distinct reachable bunk in an operational safe compartment.', { crew: c.id });
    else result.bunks.assignments.push({ crew: c.id, bunk: entity(site, bed), room: byCell.get(position(bed)).entity });
  }

  // Only utilities serving assigned sleeping rooms establish the fuel guard.
  // During commissioning, report reachable sleeping-room utilities as candidates.
  const assignedRooms = new Set(result.bunks.assignments.map(a => a.room));
  const habitatDevices = new Set([...devicesByRoom].filter(([id]) => !assignedRooms.size || assignedRooms.has(id)).flatMap(([, devices]) => devices));
  const habitatNetworks = [...new Set([...habitatDevices].map(t => networkOf.get(t)).filter(Boolean))];
  const noReactors = previewPower(s, { ...site, tiles: site.tiles.map(t => t.building === 'reactor' ? { ...t, machine: { ...t.machine, enabled: false } } : t) });
  const reactors = new Set();
  for (const n of habitatNetworks) {
    const reactorSources = [...n.sources].filter(([t, output]) => t.building === 'reactor' && output > 0);
    reactorSources.forEach(([t]) => reactors.add(t));
    const dependent = reactorSources.length > 0 && [...habitatDevices].some(t => networkOf.get(t) === n && !noReactors.powered.has(t));
    const stored = n.tiles.filter(t => t.building === 'battery' && working(t)).reduce((sum, t) => sum + amount(t.charge), 0);
    result.power.circuits.push({ id: n.id, output: n.output, demand: n.demand, storedEnergy: stored, reactorDependent: dependent });
    result.power.output += n.output; result.power.demand += n.demand; result.power.storedEnergy += stored;
    result.power.reactorDependent ||= dependent;
  }

  function stock(t, kind, allowed = RESOURCES) {
    const inventory = kind === 'input' || kind === 'output' ? t.machine?.[kind] : t[kind];
    if (!inventory || !allowed.some(r => amount(inventory[r]) > 0)) return;
    if (!accessible(t)) return;
    const items = {};
    for (const resource of allowed) {
      const n = availableInventory(s, siteId, xy(t), kind, resource);
      if (n > 0) { items[resource] = n; result.provisions.available[resource] += n; }
    }
    if (Object.keys(items).length) result.provisions.sources.push({ entity: entity(site, t), slot: kind === 'input' || kind === 'output' ? `machine.${kind}` : kind, items });
  }
  for (const t of site.tiles) {
    if (working(t) && t.building === 'stockpile') stock(t, 'stock');
    if (working(t) && t.building === 'dock') stock(t, 'imports');
    stock(t, 'drop');
    if (RECIPES[t.building]) stock(t, 'output');
    if (t.building === 'scrubber' || t.building === 'gasTank') stock(t, 'input', ['air']);
    if (reactors.has(t)) stock(t, 'input', ['fuel']);
  }
  result.provisions.required.food = OUTPOST_RESERVES.foodPerResident * crewIds.length;
  result.provisions.required.air = OUTPOST_RESERVES.airPerResident * crewIds.length;
  result.provisions.required.fuel = result.power.reactorDependent ? OUTPOST_RESERVES.reactorFuel : 0;

  const patients = local.filter(c => impaired(c) || c.health < 40);
  const cots = site.tiles.filter(t => t.building === 'medicalCot' && working(t) && eligibleRooms.has(byCell.get(position(t))?.entity) && fromDock(t));
  const cotByCrew = assignBeds(site, patients, cots);
  for (const c of patients) {
    const detail = result.crew.find(entry => entry.id === c.id), cot = cotByCrew.get(c.id);
    detail.medicalCot = cot ? entity(site, cot) : null;
    if (!cot) block('medical_cot_unavailable', 'An impaired or critically hurt resident needs a reachable safe medical cot.', { crew: c.id });
    const untreated = Math.max(0, (c.medical?.injury || 0) - (c.medical?.treated || 0));
    if (untreated > 1e-8 || immobile(c)) {
      const helper = local.find(other => other !== c && !impaired(other) && other.health >= 40 && other.labors?.medicine && reachable(site, other, c));
      detail.caregiver = helper?.id || null;
      if (!helper) block('caregiver_unavailable', 'The proposed roster needs a mobile crewmate assigned to medicine for this resident.', { crew: c.id });
    }
    result.provisions.required.medicine += Math.ceil(Math.max(0, untreated - 1e-8) / 25);
  }
  for (const [resource, required] of Object.entries(result.provisions.required)) {
    const available = result.provisions.available[resource];
    if (available + 1e-8 < required) block(`${resource}_reserve_low`, `Reachable local ${resource} reserve is below the commissioning minimum.`, { resource, available, required });
  }
  result.ready = result.blockers.length === 0;
  return result;
}
