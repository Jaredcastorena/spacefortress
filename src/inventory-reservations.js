// Claims reserve inventory or destination space; they do not own extra material.
// Keep these helpers pure so hauling and plumbing see the same current claims.
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
const amount = (items, resource) => typeof items?.[resource] === 'number' ? items[resource] : 0;
const aliveAt = (crew, siteId) => crew.site === siteId && crew.health > 0;
const pickupAt = (crew, siteId, target, kind) => aliveAt(crew, siteId) && !crew.carry && crew.intent?.type === 'haul' && crew.intent.source === kind && same(crew.intent.target, target);

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

export function outgoingInventory(s, siteId, sourceTileXY, sourceKind, resource) {
  let reserved = 0;
  for (const crew of s.crew) if (pickupAt(crew, siteId, sourceTileXY, sourceKind)) reserved += amount(crew.intent.items, resource);
  return reserved;
}

// Haulers keep the existing one-pickup-per-source rule, even if the claim is
// for a different resource. Adapters can use outgoingInventory's exact amount.
export function hasOutgoingInventory(s, siteId, sourceTileXY, sourceKind, exclude = null) {
  return s.crew.some(crew => crew !== exclude && pickupAt(crew, siteId, sourceTileXY, sourceKind));
}
