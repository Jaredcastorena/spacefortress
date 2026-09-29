import { RESOURCES, SITES } from './data.js';
import { validFoodLots } from './food-lots.js';
import { validItemLots } from './item-lots.js';

// Residence, a person's physical site and the shuttle's location are separate
// facts. These factories/readers/validators never move people or material.
export const OUTPOST_SITES = Object.freeze(['wreck']);
export const defaultOutposts = () => ({ wreck: { established: false, residents: [] } });
export const defaultDockImports = () => ({});
const record = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
// Sparse arrays and added properties do not survive a JSON save faithfully.
const arrayOf = (value, predicate) => Array.isArray(value) && Object.keys(value).length === value.length &&
  Array.from(value).every((entry, index) => Object.hasOwn(value, index) && predicate(entry));

function knownCrew(s) {
  if (!Array.isArray(s?.crew)) throw new Error('Missing crew registry.');
  const ids = new Set();
  for (const crew of s.crew) {
    if (typeof crew?.id !== 'string' || !crew.id || ids.has(crew.id)) throw new Error('Invalid or duplicate crew identity.');
    ids.add(crew.id);
  }
  return ids;
}

function knownOutpost(siteId) {
  if (!OUTPOST_SITES.includes(siteId)) throw new Error('Unknown outpost site.');
}

// "Normalize" means a checked detached copy, never silently deduplicate, prune
// dead people, sort a chosen order, infer residence or replace unknown IDs.
export function normalizeResidents(s, residents) {
  const known = knownCrew(s);
  if (!arrayOf(residents, id => typeof id === 'string' && known.has(id)) || new Set(residents).size !== residents.length) {
    throw new Error('Invalid or duplicate outpost resident.');
  }
  return [...residents];
}

export function validateOutposts(s) {
  if (!exact(s?.outposts, OUTPOST_SITES)) throw new Error('Invalid outpost registry.');
  for (const siteId of OUTPOST_SITES) {
    const state = s.outposts[siteId];
    if (!exact(state, ['established', 'residents']) || typeof state.established !== 'boolean') throw new Error('Invalid outpost state.');
    const residents = normalizeResidents(s, state.residents);
    if (!state.established && residents.length) throw new Error('Unestablished outpost has residents.');
  }
}

export function residentIds(s, siteId = 'wreck') {
  knownOutpost(siteId);
  // Old schemas can be observed before the explicit migration runs. Current
  // saves must pass validateOutposts; observation does not initialize anything.
  if (s.outposts === undefined) return [];
  validateOutposts(s);
  return [...s.outposts[siteId].residents];
}

export function residentSite(s, crewId) {
  if (!knownCrew(s).has(crewId)) throw new Error('Unknown crew member.');
  for (const siteId of OUTPOST_SITES) if (residentIds(s, siteId).includes(crewId)) return siteId;
  return null;
}

export function isResident(s, crewId, siteId = 'wreck') {
  // Other expedition destinations currently have no residence owner. They are
  // known sites, so a normal return-roster query there should simply be false.
  if (typeof siteId !== 'string' || !Object.hasOwn(SITES, siteId)) throw new Error('Unknown site.');
  return residentSite(s, crewId) === siteId;
}

function validImports(inventory) {
  if (!record(inventory) || !Object.entries(inventory).every(([resource, amount]) =>
    resource === '_food' || resource === '_items' || RESOURCES.includes(resource) && Number.isFinite(amount) && amount >= 0)) return false;
  if (!Number.isFinite(RESOURCES.reduce((total, resource) => total + (inventory[resource] || 0), 0))) return false;
  if (Object.hasOwn(inventory, '_food') && !arrayOf(inventory._food, lot => record(lot) &&
      (!Object.hasOwn(lot, 'meal') || record(lot.meal)))) return false;
  if (Object.hasOwn(inventory, '_items') && !arrayOf(inventory._items, record)) return false;
  if (!validFoodLots(inventory) || !validItemLots(inventory, true)) return false;
  return !inventory._items || new Set(inventory._items.map(item => item.id)).size === inventory._items.length;
}

// An observation only. Transfers must use the actual tile.imports with the
// inventory module's extract/add helpers so food ages and item IDs survive.
export function dockImports(tile) {
  if (tile?.building !== 'dock') return null;
  if (tile.imports === undefined) return defaultDockImports();
  if (!validImports(tile.imports)) throw new Error('Invalid dock imports.');
  return structuredClone(tile.imports);
}

export function validateDockImports(s) {
  if (!record(s?.sites)) throw new Error('Missing outpost sites.');
  const owners = new Set();
  for (const site of Object.values(s.sites)) {
    if (!Array.isArray(site?.tiles)) throw new Error('Invalid dock site.');
    for (const tile of site.tiles) {
      if (tile.building !== 'dock') {
        if (tile.imports !== undefined) throw new Error('Imports belong to a missing dock.');
        continue;
      }
      if (!validImports(tile.imports) || owners.has(tile.imports)) throw new Error('Invalid or shared dock imports.');
      owners.add(tile.imports);
    }
  }
}

// A destination's dock existing does not put the shuttle there. A remaining
// travel timer reaching zero also cannot preempt the committed phase change.
export function shuttleLocation(s) {
  const mission = s.mission;
  if (mission === null || mission === undefined) return 'surface';
  if (!record(mission) || !['outbound', 'working', 'boarding', 'returning'].includes(mission.phase) ||
      typeof mission.site !== 'string' || mission.site === 'surface' || !Object.hasOwn(SITES, mission.site)) {
    throw new Error('Invalid physical shuttle mission.');
  }
  return ['outbound', 'returning'].includes(mission.phase) ? 'transit' : mission.site;
}

export function shuttlePresence(s, siteId) {
  if (typeof siteId !== 'string' || !Object.hasOwn(SITES, siteId) || !Array.isArray(s.sites?.[siteId]?.tiles)) throw new Error('Unknown shuttle site.');
  const location = shuttleLocation(s), present = location === siteId;
  const kind = siteId === 'surface' ? 'shuttle' : 'dock';
  const terminals = s.sites[siteId].tiles.filter(tile => tile.building === kind).sort((a, b) => a.y - b.y || a.x - b.x);
  if (terminals.some(tile => !Number.isSafeInteger(tile.x) || tile.x < 0 || !Number.isSafeInteger(tile.y) || tile.y < 0 ||
      !Number.isFinite(tile.hp) || tile.hp < 0 || tile.hp > 100)) throw new Error('Invalid shuttle terminal.');
  // Existing maps have one terminal. Prefer a usable terminal if a later map
  // contains more; a broken terminal still records the site's physical berth.
  const terminal = terminals.find(tile => tile.hp > 0) || terminals[0] || null;
  const usable = present && !!terminal && terminal.hp > 0;
  const blocked = !present ? location === 'transit' ? 'shuttle_in_transit' : 'shuttle_elsewhere' : !terminal ? 'terminal_missing' : terminal.hp <= 0 ? 'terminal_destroyed' : null;
  return {
    site: siteId, location, phase: s.mission?.phase || 'docked', present, usable, blocked,
    terminal: terminal ? { entity: `tile:${siteId}:${terminal.x}:${terminal.y}`, x: terminal.x, y: terminal.y, condition: terminal.hp } : null,
  };
}
