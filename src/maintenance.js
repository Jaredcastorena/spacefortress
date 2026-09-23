import { emitEvent, tileEntityId } from './telemetry.js';
import { BUILDINGS } from './data.js';

export const SERVICE_INTERVAL = 1200;
export const WEAR_PERIOD = 30;
export const DEBRIS_INTERVAL = 1200;
export const maintainable = t => !!(BUILDINGS[t.building]?.output || BUILDINGS[t.building]?.demand || t.building === 'battery');
export function initializeMaintenance(t) {
  if (!maintainable(t)) { delete t.maintenance; return; }
  if (t.maintenance?.asset !== t.building) t.maintenance = { asset: t.building, usage: 0, servicedAt: null, auto: false, blocked: null };
}
export function initializeReliability(s) {
  s.debris = { next: s.tick + DEBRIS_INTERVAL, target: null, count: 0 };
  for (const site of Object.values(s.sites)) { site.incidents = []; site.tiles.forEach(initializeMaintenance); }
}
const emit = (s, message, type = 'danger') => { s.log.unshift({ tick: s.tick, message, type }); s.log = s.log.slice(0, 60); };
export function damage(s, site, t, target, amount, cause) {
  const asset = target === 'waterPipe' ? t.waterPipe : target === 'pipe' ? t.pipe : target === 'cable' ? t.cable : target === 'structure' && t.building ? t : null;
  if (!asset || asset.hp <= 0 || !Number.isFinite(amount) || amount <= 0) return;
  const before = asset.hp; asset.hp = Math.max(0, asset.hp - amount);
  emitEvent(s,'structure.damaged',{entity:tileEntityId(site.id,t.x,t.y),target,cause,amount:before-asset.hp,condition:asset.hp});
  site.incidents.unshift({ tick: s.tick, x: t.x, y: t.y, target, cause, amount: before - asset.hp }); site.incidents = site.incidents.slice(0, 12);
  if (cause === 'debris' || [75, 50, 0].some(n => before > n && asset.hp <= n)) emit(s, `${target === 'waterPipe' ? 'Water pipe' : target === 'pipe' ? 'Gas pipe' : target === 'cable' ? 'Power cable' : BUILDINGS[t.building]?.name || 'Structure'} at ${t.x}/${t.y}: ${cause === 'wear' ? 'overdue service wear' : cause==='fire'?'fire damage':cause==='water'?'wet cable short':'debris impact'}, condition ${Math.round(asset.hp)}%.`);
}
export function recordOperation(s, site, operating) {
  for (const t of operating) {
    initializeMaintenance(t); const m = t.maintenance; if (!m || t.hp <= 0) continue;
    m.usage++;
    if (m.usage === SERVICE_INTERVAL) emit(s, `${BUILDINGS[t.building].name} at ${t.x}/${t.y} is due for service. Engineers need one alloy.`, 'info');
    if (m.usage > SERVICE_INTERVAL && (m.usage - SERVICE_INTERVAL) % WEAR_PERIOD === 0) damage(s, site, t, 'structure', 1, 'wear');
  }
}
export function completeService(s, t) {
  t.hp = 100;
  if (maintainable(t)) { initializeMaintenance(t); t.maintenance.usage = 0; t.maintenance.servicedAt = s.tick; t.maintenance.blocked = null; }
}
export function setAutoService(s, siteId, x, y, enabled) {
  const t = s.sites[siteId]?.tiles.find(t => t.x === x && t.y === y);
  if (!t || !maintainable(t) || typeof enabled !== 'boolean') return { ok: false, message: 'Select serviceable equipment.' };
  initializeMaintenance(t); t.maintenance.auto = enabled; t.maintenance.blocked = null; return { ok: true };
}
export function scheduleMaintenance(s, order) {
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    const m = t.maintenance;
    if (!m?.auto || (m.usage < SERVICE_INTERVAL && t.hp > 50)) continue;
    if (s.jobs.some(j => j.site === site.id && j.x === t.x && j.y === t.y && j.kind !== 'operate')) { m.blocked = null; continue; }
    const result = order(s, site.id, t.x, t.y, t.hp < 100 ? 'repair' : 'service');
    m.blocked = result.ok ? null : result.message;
    if (result.ok) { result.job.automaticMaintenance = true; result.job.priority = t.building === 'scrubber' || t.hp <= 50 ? 5 : 3; }
  }
}
export function updateDebris(s) {
  const h = s.debris, site = s.sites.surface;
  if (s.tick >= h.next - 90 && !h.target) {
    const candidates = site.tiles.filter(t => (t.terrain !== 'floor' && (t.waterPipe || t.pipe || t.cable || BUILDINGS[t.building]?.output)) || t.building === 'wall');
    if (candidates.length) {
      const chosen = candidates[((s.seed >>> 0) + Math.imul(h.count + 1, 7919) >>> 0) % candidates.length]; h.target = { x: chosen.x, y: chosen.y };
      emit(s, `Debris tracked toward ${chosen.x}/${chosen.y}. Impact in ${Math.max(0, h.next - s.tick)}s. Inspect the forecast tile and prepare repair supplies.`);
    }
  }
  if (s.tick < h.next) return;
  if (h.target) {
    const t = site.tiles[h.target.y * site.size + h.target.x];
    damage(s, site, t, 'structure', 35, 'debris'); damage(s, site, t, 'cable', 60, 'debris'); damage(s,site,t,'pipe',60,'debris'); damage(s,site,t,'waterPipe',60,'debris');
    emit(s, `Debris passed the surface at ${t.x}/${t.y}. Check equipment and hull seals.`, 'info');
  }
  h.count++; h.next = s.tick + DEBRIS_INTERVAL; h.target = null;
}
export function validateReliability(s) {
  const h = s.debris, size = s.sites.surface.size;
  const point = p => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 && p.x < size && p.y < size;
  if (!h || !Number.isSafeInteger(h.next) || h.next <= s.tick || h.next > s.tick + DEBRIS_INTERVAL || !Number.isSafeInteger(h.count) || h.count < 0 || (h.target !== null && (!point(h.target) || h.next - s.tick > 90))) throw new Error('Invalid debris forecast.');
  for (const site of Object.values(s.sites)) {
    if (!Array.isArray(site.incidents) || site.incidents.length > 12 || site.incidents.some(i => !point(i) || i.x >= site.size || i.y >= site.size || !Number.isSafeInteger(i.tick) || i.tick < 0 || i.tick > s.tick || !['wear', 'debris', 'fire', 'water'].includes(i.cause) || !['structure', 'cable', 'pipe', 'waterPipe'].includes(i.target) || !Number.isFinite(i.amount) || i.amount <= 0 || i.amount > 100)) throw new Error('Invalid damage history.');
    for (const t of site.tiles) {
      const m = t.maintenance;
      if (!maintainable(t)) { if (m !== undefined) throw new Error('Maintenance belongs to missing equipment.'); continue; }
      if (!m || m.asset !== t.building || !Number.isSafeInteger(m.usage) || m.usage < 0 || typeof m.auto !== 'boolean' || (m.servicedAt !== null && (!Number.isSafeInteger(m.servicedAt) || m.servicedAt < 0 || m.servicedAt > s.tick)) || (m.blocked !== null && (typeof m.blocked !== 'string' || m.blocked.length > 200))) throw new Error('Invalid service history.');
    }
  }
  for (const j of s.jobs) {
    if (j.automaticMaintenance !== undefined && (j.automaticMaintenance !== true || !['service', 'repair'].includes(j.kind))) throw new Error('Invalid automatic maintenance order.');
    if (j.kind === 'service' && !maintainable(s.sites[j.site].tiles[j.y * s.sites[j.site].size + j.x])) throw new Error('Service order has no equipment.');
  }
}
