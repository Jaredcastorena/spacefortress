import { tileAt } from './spatial.js';
import { roomAcceptsResource } from './rooms.js';
import { RESOURCES } from './data.js';
import { quantity, resourceEntries } from './inventory.js';
import { sameInventoryLocation } from './inventory-reservations.js';

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
export const acceptsResource = (t, r, site = null) => t.building === 'stockpile' && t.storage?.accepted.includes(r) && roomAcceptsResource(site, t, r);
export function acceptsShipment(s, siteId, t, items, exclude = null) {
  return t?.building === 'stockpile' && resourceEntries(items).every(([r]) => acceptsResource(t, r, s.sites[siteId])) && quantity(items) <= depotUsage(s, siteId, t, exclude).free + 1e-9;
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
export function validateStorage(s) {
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    if (t.building !== 'stockpile') { if (t.storage !== undefined) throw new Error('Storage policy attached to a missing depot.'); continue; }
    const policy = t.storage;
    if (!policy || ![1, 3, 5].includes(policy.priority) || !Array.isArray(policy.accepted) || new Set(policy.accepted).size !== policy.accepted.length || !policy.accepted.every(r => RESOURCES.includes(r))) throw new Error('Invalid depot policy.');
    // Legacy depots may already exceed capacity. Never discard their goods; new deliveries wait for space.
  }
}
