import { tileAt, tileEntityId } from './spatial.js';
import { roomAcceptsResource } from './rooms.js';
import { RESOURCES } from './data.js';
import { quantity, resourceEntries } from './inventory.js';
import { incomingInventory, sameInventoryLocation } from './inventory-reservations.js';
import { emitEvent } from './telemetry.js';

export const DEPOT_CAPACITY = 320;
// Named schema47 material-source/legacy-tile boundary. Missing z means zero.
const located = t => ({ ...t, z: t.z === undefined ? 0 : t.z });
export function depotUsage(s, siteId, t, exclude = null) {
  let reserved = 0, incoming = 0;
  for (const j of s.jobs) if (j.site === siteId) for (const source of j.sources) {
    if (source.kind === 'stock' && sameInventoryLocation(siteId, located(source), located(t))) reserved += quantity(source.items);
  }
  for (const c of s.crew) {
    if (c === exclude || c.site !== siteId || c.health <= 0) continue;
    const d = c.carry ? c.delivery : c.intent?.type === 'haul' ? c.intent.destination : null;
    if (d?.kind === 'stock' && sameInventoryLocation(siteId, d.target, located(t))) incoming += quantity(c.carry || c.intent.items);
  }
  const stored = quantity(t.stock), used = stored + reserved;
  return { stored, reserved, incoming, used, free: Math.max(0, DEPOT_CAPACITY - used - incoming) };
}
export function depotResourceUsage(s, siteId, t, resource, exclude = null) {
  let reserved = 0;
  for (const j of s.jobs) if (j.site === siteId) for (const source of j.sources) {
    if (source.kind === 'stock' && sameInventoryLocation(siteId, located(source), located(t))) reserved += source.items?.[resource] || 0;
  }
  const stored = t.stock?.[resource] || 0, used = stored + reserved;
  const incoming = incomingInventory(s, siteId, { kind: 'stock', target: located(t) }, resource, null, exclude);
  const limit = t.storage?.limits?.[resource] ?? null;
  const free = Math.min(depotUsage(s, siteId, t, exclude).free, limit === null ? Infinity : Math.max(0, limit - used - incoming));
  return { stored, reserved, incoming, used, limit, free };
}
export const acceptsResource = (t, r, site = null) => t.building === 'stockpile' && t.storage?.accepted.includes(r) && roomAcceptsResource(site, t, r);
export function acceptsShipment(s, siteId, t, items, exclude = null) {
  return t?.building === 'stockpile' && resourceEntries(items).every(([r, n]) => acceptsResource(t, r, s.sites[siteId]) && n <= depotResourceUsage(s, siteId, t, r, exclude).free + 1e-9) && quantity(items) <= depotUsage(s, siteId, t, exclude).free + 1e-9;
}
export function setDepotAccepted(s, siteId, x, y, resource, accepted,z=0) {
  const t = tileAt(s.sites[siteId],{x,y,z});
  if (t?.building !== 'stockpile' || !RESOURCES.includes(resource) || typeof accepted !== 'boolean') return { ok: false, message: 'Select a depot and a valid resource.' };
  const values = new Set(t.storage.accepted); if (accepted) values.add(resource); else values.delete(resource);
  t.storage.accepted = RESOURCES.filter(r => values.has(r));
  return { ok: true };
}
export function setDepotPriority(s, siteId, x, y, priority,z=0) {
  const t = tileAt(s.sites[siteId],{x,y,z});
  if (t?.building !== 'stockpile' || ![1, 3, 5].includes(priority)) return { ok: false, message: 'Select a depot and a valid hauling priority.' };
  t.storage.priority = priority; return { ok: true };
}
const validLimit = limit => Number.isSafeInteger(limit) && limit >= 0 && limit <= DEPOT_CAPACITY;
export function setDepotLimit(s, siteId, x, y, resource, limit, z = 0) {
  const t = tileAt(s.sites[siteId], { x, y, z });
  if (t?.building !== 'stockpile' || !t.storage || !RESOURCES.includes(resource) || limit !== null && !validLimit(limit)) return { ok: false, message: 'Select a depot, a valid resource and a whole delivery limit from 0 to 320, or clear the limit.' };
  const previous = t.storage.limits?.[resource] ?? null;
  if (previous === limit) return { ok: true };
  t.storage.limits ??= {};
  if (limit === null) delete t.storage.limits[resource]; else t.storage.limits[resource] = limit;
  emitEvent(s, 'depot.limit.changed', { entity: tileEntityId(siteId, x, y, z), site: `site:${siteId}`, resource, previous, limit });
  return { ok: true };
}
export function validateStorage(s) {
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    if (t.building !== 'stockpile') { if (t.storage !== undefined) throw new Error('Storage policy attached to a missing depot.'); continue; }
    const policy = t.storage;
    if (!policy || ![1, 3, 5].includes(policy.priority) || !Array.isArray(policy.accepted) || new Set(policy.accepted).size !== policy.accepted.length || !policy.accepted.every(r => RESOURCES.includes(r))) throw new Error('Invalid depot policy.');
    if (s.version < 71) {
      if (Object.hasOwn(policy, 'limits')) throw new Error('Depot limits are not supported by this save version.');
    } else {
      const limits = policy.limits;
      if (!limits || typeof limits !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(limits)) || Object.entries(limits).some(([resource, limit]) => !RESOURCES.includes(resource) || !validLimit(limit))) throw new Error('Invalid depot delivery limits.');
    }
    // Legacy depots may already exceed capacity. Never discard their goods; new deliveries wait for space.
  }
}
