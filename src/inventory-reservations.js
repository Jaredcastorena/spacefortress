import { RECIPES, RESOURCES } from './data.js';
import { sameCell, tileAt } from './spatial.js';
import { foodLots, foodOfKind, rawFood, preparedFood, planFoodSelection, takeFoodLots } from './food-lots.js';

// Claims reserve inventory or destination space; they do not own extra material.
// Keep these helpers pure so hauling and plumbing see the same current claims.
// Query boundary: old pairs always name deck zero, never the actor/viewed deck.
// Explicit positions may carry the matching site; a foreign site cannot alias it.
export function inventoryPosition(siteId, reference) {
  const p = Array.isArray(reference) ? reference.length === 2 ? { x: reference[0], y: reference[1], z: 0 } : null : reference;
  if (!p || p.site !== undefined && p.site !== siteId || ![p.x, p.y, p.z].every(Number.isSafeInteger)) return null;
  return { x: p.x, y: p.y, z: p.z };
}
export function sameInventoryLocation(siteId, a, b) {
  return sameCell(inventoryPosition(siteId, a), inventoryPosition(siteId, b));
}
const amount = (items, resource) => RESOURCES.includes(resource) && Number.isFinite(items?.[resource]) ? Math.max(0, items[resource]) : 0;
const quantity = items => RESOURCES.reduce((total, resource) => total + amount(items, resource), 0);
const aliveAt = (crew, siteId) => crew.site === siteId && crew.health > 0;
const pickupAt = (crew, siteId, target, kind) => aliveAt(crew, siteId) && !crew.carry && (
  crew.intent?.type === 'haul' && crew.intent.source === kind && sameInventoryLocation(siteId, crew.intent.target, target) ||
  crew.intent?.type === 'salvage' && kind === 'drop' && sameInventoryLocation(siteId, crew.intent.target, target)
);

export function incomingInventory(s, siteId, destination, resource, foodKind = null, exclude = null) {
  const target = inventoryPosition(siteId, destination?.target); if (!target) return 0;
  let reserved = 0;
  for (const crew of s.crew) {
    if (crew === exclude || !aliveAt(crew, siteId)) continue;
    // A recovery intent can coexist with held cargo. Only its actual delivery
    // reserves space; never add the old pickup amount to an already held load.
    const incoming = crew.carry ? crew.delivery : crew.intent?.type === 'haul' ? crew.intent.destination : null;
    if (incoming?.kind !== destination.kind || !sameInventoryLocation(siteId, incoming.target, target)) continue;
    if (!crew.carry && destination.recipeId && crew.intent.recipeId && destination.recipeId !== crew.intent.recipeId) continue;
    reserved += resource === 'food' && foodKind
      ? crew.carry ? foodOfKind(crew.carry, foodKind) : Math.max(0, crew.intent.foodKinds?.[foodKind] || 0)
      : amount(crew.carry || crew.intent.items, resource);
  }
  return reserved;
}

export function outgoingInventory(s, siteId, sourcePosition, sourceKind, resource, exclude = null) {
  let reserved = 0;
  for (const crew of s.crew) if (crew !== exclude && pickupAt(crew, siteId, sourcePosition, sourceKind)) reserved += amount(crew.intent.items, resource);
  return reserved;
}

// Haulers keep the existing one-pickup-per-source rule, even if the claim is
// for a different resource. Adapters can use outgoingInventory's exact amount.
export function hasOutgoingInventory(s, siteId, sourcePosition, sourceKind, exclude = null) {
  return s.crew.some(crew => crew !== exclude && pickupAt(crew, siteId, sourcePosition, sourceKind));
}

// Return only unpromised material still physically in this site-local slot.
// Job sources/materials and held cargo have already left the slot, so they must
// not be subtracted again. Imports and salvage drops remain distinct owners.
export function availableInventory(s, siteId, sourcePosition, sourceKind, resource, exclude = null, selector = false) {
  const site = s.sites?.[siteId];
  const position = inventoryPosition(siteId, sourcePosition);
  const tile = tileAt(site, position);
  if (!tile) return 0;
  const inventory = sourceKind === 'stock' ? tile.building === 'stockpile' ? tile.stock : null
    : sourceKind === 'drop' ? tile.drop
    : sourceKind === 'imports' ? tile.building === 'dock' ? tile.imports : null
    : sourceKind === 'output' && tile.building === 'sanitary' ? tile.sanitary?.output
    : RECIPES[tile.building] && ['input', 'output'].includes(sourceKind) ? tile.machine?.[sourceKind] : null;
  if (resource !== 'food') return Math.max(0, amount(inventory, resource) - outgoingInventory(s, siteId, sourcePosition, sourceKind, resource, exclude));
  // Project actual oldest-first pickups on a private food copy. A generic claim
  // can reserve a typed portion too; subtracting numeric food from each kind
  // would incorrectly hide ingredients that the pickup will leave behind.
  const available = { food: inventory?.food || 0, _food: foodLots(inventory) };
  for (const crew of s.crew) if (crew !== exclude && pickupAt(crew, siteId, sourcePosition, sourceKind) && amount(crew.intent.items, 'food')) {
    const destination = crew.intent.destination, target = destination?.target;
    const galley = destination?.kind === 'input' && tileAt(site, inventoryPosition(siteId, target))?.building === 'galley';
    const selection = crew.intent.foodKinds ? { rawOnly: true, foodKinds: crew.intent.foodKinds } : galley;
    const n = amount(crew.intent.items, 'food');
    if (planFoodSelection(available, n, selection)) { takeFoodLots(available, n, selection); available.food -= n; }
  }
  if (!selector?.foodKinds) {
    const rawOnly = selector === true || !!selector?.rawOnly;
    // A generic oldest-first extraction must stop before a promised kind. It
    // cannot jump over that lot to reach other food using its ordinary selector.
    const buckets = new Map(); let safe = 0;
    for (const lot of foodLots(inventory)) {
      if (rawOnly && lot.meal) continue;
      const key = lot.meal ? 'prepared' : lot.kind || 'ration';
      if (!buckets.has(key)) buckets.set(key, lot.meal ? preparedFood(available) : foodOfKind(available, key));
      const picked = Math.min(lot.amount, buckets.get(key)); safe += picked; buckets.set(key, buckets.get(key) - picked);
      if (picked < lot.amount) break;
    }
    return Math.min(safe, rawOnly ? rawFood(available) : Math.max(0, amount(inventory, resource) - outgoingInventory(s, siteId, sourcePosition, sourceKind, resource, exclude)));
  }
  return Object.entries(selector.foodKinds).reduce((total, [kind, limit]) => total + Math.min(limit, foodOfKind(available, kind)), 0);
}

// Only these crew claims belong to the salvage hold. Local construction and
// machine/depot deliveries keep their own owners even while a flight is active.
// Freight-loading jobs are accounted for by their separate sources/materials/
// carry owners; this helper does not also count their cost or their job cargo.
export function shuttleCargoClaims(s, siteId = s.mission?.site, crewIds = s.mission?.crew || []) {
  let reserved = 0;
  for (const crew of s.crew) {
    if (!aliveAt(crew, siteId) || !crewIds.includes(crew.id)) continue;
    if (crew.carry) {
      if (crew.delivery?.kind === 'shuttle') reserved += quantity(crew.carry);
    } else if (crew.intent?.type === 'salvage') reserved += quantity(crew.intent.items);
  }
  return reserved;
}
