import { RECIPES, RESOURCES } from './data.js';

// Claims reserve inventory or destination space; they do not own extra material.
// Keep these helpers pure so hauling and plumbing see the same current claims.
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
const amount = (items, resource) => RESOURCES.includes(resource) && Number.isFinite(items?.[resource]) ? Math.max(0, items[resource]) : 0;
const quantity = items => RESOURCES.reduce((total, resource) => total + amount(items, resource), 0);
const aliveAt = (crew, siteId) => crew.site === siteId && crew.health > 0;
const pickupAt = (crew, siteId, target, kind) => aliveAt(crew, siteId) && !crew.carry && (
  crew.intent?.type === 'haul' && crew.intent.source === kind && same(crew.intent.target, target) ||
  crew.intent?.type === 'salvage' && kind === 'drop' && same(crew.intent.target, target)
);

export function incomingInventory(s, siteId, destination, resource) {
  let reserved = 0;
  for (const crew of s.crew) {
    if (!aliveAt(crew, siteId)) continue;
    // A recovery intent can coexist with held cargo. Only its actual delivery
    // reserves space; never add the old pickup amount to an already held load.
    const incoming = crew.carry ? crew.delivery : crew.intent?.type === 'haul' ? crew.intent.destination : null;
    if (incoming?.kind === destination.kind && same(incoming.target, destination.target)) reserved += amount(crew.carry || crew.intent.items, resource);
  }
  return reserved;
}

export function outgoingInventory(s, siteId, sourceTileXY, sourceKind, resource, exclude = null) {
  let reserved = 0;
  for (const crew of s.crew) if (crew !== exclude && pickupAt(crew, siteId, sourceTileXY, sourceKind)) reserved += amount(crew.intent.items, resource);
  return reserved;
}

// Haulers keep the existing one-pickup-per-source rule, even if the claim is
// for a different resource. Adapters can use outgoingInventory's exact amount.
export function hasOutgoingInventory(s, siteId, sourceTileXY, sourceKind, exclude = null) {
  return s.crew.some(crew => crew !== exclude && pickupAt(crew, siteId, sourceTileXY, sourceKind));
}

// Return only unpromised material still physically in this site-local slot.
// Job sources/materials and held cargo have already left the slot, so they must
// not be subtracted again. Imports and salvage drops remain distinct owners.
export function availableInventory(s, siteId, sourceTileXY, sourceKind, resource, exclude = null) {
  const site = s.sites?.[siteId];
  if (!site || !Array.isArray(sourceTileXY) || sourceTileXY.length !== 2) return 0;
  const [x, y] = sourceTileXY;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= site.size || y >= site.size) return 0;
  const tile = site.tiles[y * site.size + x];
  if (!tile) return 0;
  const inventory = sourceKind === 'stock' ? tile.building === 'stockpile' ? tile.stock : null
    : sourceKind === 'drop' ? tile.drop
    : sourceKind === 'imports' ? tile.building === 'dock' ? tile.imports : null
    : sourceKind === 'output' && tile.building === 'sanitary' ? tile.sanitary?.output
    : RECIPES[tile.building] && ['input', 'output'].includes(sourceKind) ? tile.machine?.[sourceKind] : null;
  return Math.max(0, amount(inventory, resource) - outgoingInventory(s, siteId, sourceTileXY, sourceKind, resource, exclude));
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
