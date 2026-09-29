import { itemOwners } from './item-lots.js';
import { defaultOutposts, defaultDockImports, validateOutposts, validateDockImports } from './outposts.js';

const record = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, fields) => record(value) && Reflect.ownKeys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const empty = value => record(value) && Reflect.ownKeys(value).length === 0;
const emptyRoster = value => Array.isArray(value) && value.length === 0 && Reflect.ownKeys(value).length === 1;
const docks = s => Object.values(s.sites).flatMap(site => site.tiles.filter(tile => tile.building === 'dock'));

// Only fresh games and deliberate legacy migrations call this initializer.
// Current saves must be validated as supplied, never repaired during loading.
export function initializeOutpostState(s) {
  if (s.outposts === undefined) s.outposts = defaultOutposts();
  if (s.shuttle.freight === undefined) s.shuttle.freight = {};
  for (const tile of docks(s)) if (tile.imports === undefined) tile.imports = defaultDockImports();
  if (s.mission && s.mission.returnCrew === undefined) s.mission.returnCrew = [...s.mission.crew];
  return s;
}

export function assertLegacyOutpostState(s) {
  if (s.version >= 37) return;
  // Synthetic legacy tests may predeclare empty owners. Actual legacy saves
  // cannot contain outpost stock, founding history or a chosen return roster.
  if (s.outposts !== undefined && (!exact(s.outposts, ['wreck']) ||
      !exact(s.outposts.wreck, ['established', 'residents']) ||
      s.outposts.wreck.established !== false || !emptyRoster(s.outposts.wreck.residents))) throw new Error('Outpost state is not valid in this older save.');
  if (s.shuttle?.freight !== undefined && !empty(s.shuttle.freight)) throw new Error('Freight is not valid in this older save.');
  if (s.mission?.returnCrew !== undefined && !emptyRoster(s.mission.returnCrew)) throw new Error('A return roster is not valid in this older save.');
  for (const site of Object.values(s.sites)) for (const tile of site.tiles) {
    if (tile.imports !== undefined && (tile.building !== 'dock' || !empty(tile.imports))) throw new Error('Dock imports are not valid in this older save.');
  }
}

export function migrateOutpostState(s) {
  if (s.version !== 36) return false;
  assertLegacyOutpostState(s);
  // Give each new owner its own empty object, even for predeclared empty fields.
  s.outposts = defaultOutposts(); s.shuttle.freight = {};
  for (const tile of docks(s)) tile.imports = defaultDockImports();
  if (s.mission) s.mission.returnCrew = [...s.mission.crew];
  s.version = 37;
  return true;
}

function validateOwnerAliases(s) {
  const seen = new WeakMap();
  const owners = itemOwners(s);
  // Opened meals own actual food even though the discrete-item walker does not
  // enumerate them. Inspect the retained inventory, never synthesize portions.
  for (const crew of s.crew) {
    for (const [slot, meal] of [['medical.openedFood', crew.medical], ['intent.openedFood', crew.intent?.type === 'meal' ? crew.intent : null]]) {
      if (meal?.openedFood) owners.push({ inventory: meal.openedFood, location: { entity: crew.id, slot } });
    }
  }
  for (const owner of owners) {
    const added = owner.location.slot === 'imports' || owner.location.slot === 'shuttle.freight';
    const active = new WeakSet();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (active.has(value)) throw new Error('Cyclic physical inventory.');
      const previous = seen.get(value);
      if (previous) {
        if (previous.owner !== owner && (added || previous.added)) throw new Error('Outpost inventories share physical ownership.');
        return;
      }
      seen.set(value, { owner, added }); active.add(value);
      for (const child of Object.values(value)) visit(child);
      active.delete(value);
    }
    visit(owner.inventory);
  }
  const rosters = [s.outposts.wreck.residents, s.mission?.crew, s.mission?.returnCrew, s.departure?.crew].filter(Boolean);
  if (new Set(rosters).size !== rosters.length) throw new Error('Outpost and expedition rosters must be independent arrays.');
}

// Return-manifest and freight shape/capacity checks remain validateShuttle's
// responsibility. This module has no simulation or expedition dependency.
export function validateOutpostState(s) {
  validateOutposts(s); validateDockImports(s); validateOwnerAliases(s);
}
