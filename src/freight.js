import { RESOURCES, SHUTTLE_FITS } from './data.js';
import { add, extract, quantity, contains, resourceEntries } from './inventory.js';
import { shuttlePresence } from './outposts.js';
import { shuttleCargoClaims } from './inventory-reservations.js';
import { emitEvent, emitItemMovement, tileEntityId } from './telemetry.js';
import { FREIGHT_WORK } from './freight-persistence.js';
export { FREIGHT_WORK } from './freight-persistence.js';

export const isFreightJob = j => j?.kind === 'loadCargo' || j?.kind === 'unloadCargo';
const copy = value => structuredClone(value || {});
export function freightJobCargo(s, j) {
  const inventories = [j.materials, ...j.sources.map(source => source.items), ...s.crew.filter(c => c.delivery?.kind === 'job' && c.delivery.job === j.id).map(c => c.carry)];
  return inventories.reduce((total, inventory) => total + quantity(inventory), 0);
}
// Count each actual owner once. Cost is a request, never an additional owner.
export const freightReserved = s => s.jobs.filter(isFreightJob).reduce((total, j) => total + freightJobCargo(s, j), 0);
export function freightStatus(s, siteId = 'surface') {
  const presence = shuttlePresence(s, siteId), capacity = s.mission?.capacity ?? SHUTTLE_FITS[s.shuttle.fit].capacity;
  const claimed = s.mission ? shuttleCargoClaims(s, s.mission.site, s.mission.returnCrew) : 0;
  const reserved = freightReserved(s), job = s.jobs.find(isFreightJob);
  const onboard = copy(s.shuttle.freight), salvage = copy(s.mission?.cargo);
  const blocked = !presence.usable ? presence.blocked : s.departure ? 'departure_pending' : s.mission && s.mission.phase !== 'working' ? 'expedition_not_working' : job ? 'freight_pending' : null;
  return { site: siteId, location: presence.location, present: presence.present, usable: presence.usable, capacity, onboard, salvage, claimed, reserved, free: Math.max(0, capacity - quantity(onboard) - quantity(salvage) - claimed - reserved), job: job?.id || null, blocked };
}
export function freightRequest(s, siteId, kind, requested = undefined) {
  const reject = (code, message) => ({ ok: false, code, message });
  if (!['loadCargo', 'unloadCargo'].includes(kind) || !s.sites[siteId]) return reject('freight_unavailable', 'Select a freight operation at a known site.');
  const presence = shuttlePresence(s, siteId);
  if (!presence.usable || s.departure || (siteId === 'surface' ? !!s.mission : s.mission?.phase !== 'working') || kind === 'loadCargo' && siteId !== 'surface') return reject('freight_unavailable', 'Freight work needs the idle shuttle at a usable terminal.');
  if (s.jobs.some(isFreightJob)) return reject('freight_pending', 'Finish or cancel the existing freight order.');
  const items = requested === undefined && kind === 'unloadCargo' ? Object.fromEntries(resourceEntries(s.shuttle.freight).filter(([,n]) => n > 0)) : requested;
  if (!items || typeof items !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(items)) || !Object.keys(items).length || !Object.entries(items).every(([r,n]) => RESOURCES.includes(r) && Number.isFinite(n) && n > 0 && (r !== 'keepsakes' || Number.isInteger(n))) || !Number.isFinite(quantity(items))) return reject('invalid_freight', 'Choose positive amounts of known resources.');
  if (kind === 'loadCargo' && quantity(items) > freightStatus(s, siteId).free + 1e-8) return reject('freight_capacity', 'The requested freight exceeds the free shuttle hold.');
  if (kind === 'unloadCargo' && !contains(s.shuttle.freight, items)) return reject('freight_missing', 'The requested freight is not aboard.');
  return { ok: true, cost: { ...items }, terminal: presence.terminal, work: FREIGHT_WORK };
}
export function reserveFreight(s, x, y, cost) {
  const items = extract(s.shuttle.freight, cost);
  return items ? [{ x, y, kind: 'freight', items }] : null;
}
export function freightOrdered(s, job) {
  const transfers = job.sources.map((source, index) => ({ cargo: copy(source.items), from: source.kind === 'freight' ? { entity: 'colony', slot: 'shuttle.freight' } : { entity: tileEntityId(job.site, source.x, source.y), slot: source.kind }, to: { entity: job.id, slot: `sources.${index}` } }));
  emitEvent(s, 'freight.ordered', { entity: job.id, site: `site:${job.site}`, target: tileEntityId(job.site, job.x, job.y), kind: job.kind, cargo: job.cost, transfers, previous: null, next: 'reserved' });
  for (const transfer of transfers) emitItemMovement(s, transfer.cargo, null, transfer.from, transfer.to);
}
export function freightWorkValid(s, job) {
  const presence = shuttlePresence(s, job.site);
  return presence.usable && presence.terminal.x === job.x && presence.terminal.y === job.y && !s.departure && (job.site === 'surface' ? !s.mission : s.mission?.site === job.site && s.mission.phase === 'working');
}
export function completeFreight(s, crew, job) {
  if (!freightWorkValid(s, job)) return false;
  const status = freightStatus(s, job.site);
  if (quantity(status.onboard) + quantity(status.salvage) + status.claimed + status.reserved > status.capacity + 1e-8) return false;
  const tile = s.sites[job.site].tiles[job.y * s.sites[job.site].size + job.x];
  const destination = job.kind === 'loadCargo' ? s.shuttle.freight : job.site === 'surface' ? (tile.drop ||= {}) : tile.imports;
  if (!destination) return false;
  const previous = copy(destination), cargo = extract(job.materials, Object.fromEntries(resourceEntries(job.materials)));
  const from = { entity: job.id, slot: 'materials' }, to = job.kind === 'loadCargo' ? { entity: 'colony', slot: 'shuttle.freight' } : { entity: tileEntityId(job.site, job.x, job.y), slot: job.site === 'surface' ? 'drop' : 'imports' };
  add(destination, cargo); emitItemMovement(s, cargo, crew.id, from, to);
  emitEvent(s, job.kind === 'loadCargo' ? 'freight.loaded' : 'freight.unloaded', { entity: job.id, actor: crew.id, site: `site:${job.site}`, target: tileEntityId(job.site, job.x, job.y), cargo, from, to, previous, next: copy(destination), reason: 'work_completed' });
  return true;
}
export function freightCancellation(s, job, automatic) {
  emitEvent(s, 'freight.cancelled', { entity: job.id, site: `site:${job.site}`, target: tileEntityId(job.site, job.x, job.y), kind: job.kind, previous: 'reserved', next: null, automatic, sources: copy(job.sources), staged: copy(job.materials), carried: s.crew.filter(c => c.delivery?.kind === 'job' && c.delivery.job === job.id).map(c => ({ entity: c.id, cargo: copy(c.carry) })), reason: automatic ? 'operation_invalidated' : 'player' });
}
