import {materialProfile,materialId} from './materials.js';
import {damageUtility} from './utility-links.js';
import { stairAt, STAIR } from './vertical.js';
import { tileAt, positionOf, sameCell } from './spatial.js';
import { validHazardPosition } from './hazard-locations.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { BUILDINGS } from './data.js';
import { depositImpactOre, IMPACT_ORE_AMOUNT } from './extraction.js';
import { spill } from './inventory.js';

export const SERVICE_INTERVAL = 1200;
export const WEAR_PERIOD = 30;
export const DEBRIS_INTERVAL = 1200;
export const DEBRIS_FORECAST = 90;
export const HERD_WARNING_LEAD = 180;
export const maintainable = t => !!(BUILDINGS[t.building]?.output || BUILDINGS[t.building]?.demand || t.building === 'battery');
export function initializeMaintenance(t) {
  if (!maintainable(t)) { delete t.maintenance; return; }
  if (t.maintenance?.asset !== t.building) t.maintenance = { asset: t.building, usage: 0, servicedAt: null, auto: false, blocked: null };
}
export function initializeReliability(s) {
  s.debris = { next: s.tick + DEBRIS_INTERVAL, target: null, count: 0, herdQuiet: false };
  for (const site of Object.values(s.sites)) { site.incidents = []; site.tiles.forEach(initializeMaintenance); }
}
const emit = (s, message, type = 'danger') => { s.log.unshift({ tick: s.tick, message, type }); s.log = s.log.slice(0, 60); };
export function damage(s, site, t, target, amount, cause) {
  const stair=target==='structure'?stairAt(site,positionOf(t)):null;
  const asset = target === 'waterPipe' ? t.waterPipe : target === 'pipe' ? t.pipe : target === 'cable' ? t.cable : target === 'structure' && t.building ? t : stair;
  if (!asset || asset.hp <= 0 || !Number.isFinite(amount) || amount <= 0) return;
  const profile=target==='structure'&&asset===t?materialProfile(t,'structure'):null;
  const applied=amount*(profile?.structure.damageMultiplier??1);
  const before = asset.hp; asset.hp = Math.max(0, asset.hp - applied);
  damageUtility(s,site,t,target,amount,cause);
  emitEvent(s,'structure.damaged',{entity:tileEntityId(site.id,t.x,t.y,positionOf(t).z),target,cause,amount:before-asset.hp,condition:asset.hp,...(profile?{material:materialId(t,'structure'),rawAmount:amount}:{})});
  if(stair){emitEvent(s,'vertical.damaged',{entity:`site:${site.id}`,connection:stair.id,target:tileEntityId(site.id,t.x,t.y,t.z),cause,amount:before-stair.hp,condition:stair.hp});if(before>=STAIR.minimumCondition&&stair.hp<STAIR.minimumCondition)emitEvent(s,'vertical.blocked',{entity:`site:${site.id}`,connection:stair.id,reason:'damage',condition:stair.hp});}
  site.incidents.unshift({ tick: s.tick, x: t.x, y: t.y, z: positionOf(t).z, target, cause, amount: before - asset.hp }); site.incidents = site.incidents.slice(0, 12);
  if (cause === 'debris' || [75, 50, 0].some(n => before > n && asset.hp <= n)) emit(s, `${target === 'waterPipe' ? 'Water pipe' : target === 'pipe' ? 'Gas pipe' : target === 'cable' ? 'Power cable' : (stair?'Stairwell':BUILDINGS[t.building]?.name) || 'Structure'} at ${t.x}/${t.y} · floor ${positionOf(t).z}: ${cause === 'wear' ? 'overdue service wear' : cause==='fire'?'fire damage':cause==='water'?'wet cable short':'debris impact'}, condition ${Math.round(asset.hp)}%.`);
}
export function recordOperation(s, site, operating) {
  for (const t of operating) {
    initializeMaintenance(t); const m = t.maintenance; if (!m || t.hp <= 0) continue;
    m.usage++;
    if (m.usage === SERVICE_INTERVAL) emit(s, `${BUILDINGS[t.building].name} at ${t.x}/${t.y} · floor ${positionOf(t).z} is due for service. Engineers need one alloy.`, 'info');
    if (m.usage > SERVICE_INTERVAL && (m.usage - SERVICE_INTERVAL) % WEAR_PERIOD === 0) damage(s, site, t, 'structure', 1, 'wear');
  }
}
export function completeService(s, t) {
  t.hp = 100;
  if (maintainable(t)) { initializeMaintenance(t); t.maintenance.usage = 0; t.maintenance.servicedAt = s.tick; t.maintenance.blocked = null; }
}
export function setAutoService(s, siteId, x, y, enabled,z=0) {
  const t = tileAt(s.sites[siteId],{x,y,z});
  if (!t || !maintainable(t) || typeof enabled !== 'boolean') return { ok: false, message: 'Select serviceable equipment.' };
  initializeMaintenance(t); t.maintenance.auto = enabled; t.maintenance.blocked = null; return { ok: true };
}
export function scheduleMaintenance(s, order) {
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    const m = t.maintenance;
    if (!m?.auto || (m.usage < SERVICE_INTERVAL && t.hp > 50)) continue;
    if (s.jobs.some(j => j.site === site.id && sameCell(positionOf(j),positionOf(t)) && j.kind !== 'operate')) { m.blocked = null; continue; }
    const result = order(s, site.id, t.x, t.y, t.hp < 100 ? 'repair' : 'service', null, positionOf(t).z);
    m.blocked = result.ok ? null : result.message;
    if (result.ok) { result.job.automaticMaintenance = true; result.job.priority = t.building === 'scrubber' || t.hp <= 50 ? 5 : 3; }
  }
}
export function updateDebris(s) {
  const h = s.debris, site = s.sites.surface;
  if (s.tick >= h.next - DEBRIS_FORECAST && !h.target) {
    const candidates = site.tiles.filter(t => (t.verticalLink&&stairAt(site,t)?.upper.z===t.z&&!site.rooms.some(room=>room.z===t.z&&room.sealed&&room.cells.includes(`${t.x},${t.y}`))) || (t.terrain !== 'floor' && (t.waterPipe || t.pipe || t.cable || BUILDINGS[t.building]?.output)) || t.building === 'wall');
    if (candidates.length) {
      const chosen = candidates[((s.seed >>> 0) + Math.imul(h.count + 1, 7919) >>> 0) % candidates.length]; h.target = positionOf(chosen);
      emit(s, `Debris tracked toward ${chosen.x}/${chosen.y} · floor ${positionOf(chosen).z}. Impact in ${Math.max(0, h.next - s.tick)}s. Inspect the forecast tile and prepare repair supplies.`);
    }
  }
  if (s.tick < h.next) return;
  if (h.target) {
    const t = tileAt(site,h.target);
    damage(s, site, t, 'structure', 35, 'debris'); damage(s, site, t, 'cable', 60, 'debris'); damage(s,site,t,'pipe',60,'debris'); damage(s,site,t,'waterPipe',60,'debris');
    const ore=depositImpactOre(t);if(ore.loose)spill(t,{ore:ore.loose});
    emitEvent(s,'deposit.arrived',{entity:tileEntityId(site.id,t.x,t.y,positionOf(t).z),resource:'ore',source:'orbital_debris',impact:h.count+1,amount:IMPACT_ORE_AMOUNT,...ore});
    emit(s, `Debris passed the surface at ${t.x}/${t.y} · floor ${positionOf(t).z}. Check equipment and hull seals.${ore.retained?' Mine the remaining impact ore.':ore.loose?' Loose ore is ready for hauling.':''}`, 'info');
  }
  h.count++; h.next = s.tick + DEBRIS_INTERVAL; h.target = null;
}
const herdMember = a => a.species === 'bristleback' && a.health > 0 && a.site === 'surface';
const livingHerd = s => s.creatures.filter(herdMember).map(a => a.id).sort();
export const herdMemberQuiet = (s, a) => s.debris?.herdQuiet === true && herdMember(a);
export function updateHerdWarning(s) {
  const h = s.debris;
  if (!h) return;
  const remaining = h.next - s.tick;
  const herd = livingHerd(s);
  const quiet = herd.length >= 2 && h.target == null && remaining > DEBRIS_FORECAST && remaining <= HERD_WARNING_LEAD;
  if (quiet === h.herdQuiet || (!quiet && h.herdQuiet !== true)) return;
  h.herdQuiet = quiet;
  const details = { entity: 'herd:bristleback', site: 'site:surface', animals: herd, impactTick: h.next };
  if (quiet) {
    emit(s, 'The bristlebacks have stopped clicking in unison.', 'discovery');
    emitEvent(s, 'herd.quiet', { ...details, reason: 'unison' });
  } else {
    const reason = herd.length < 2 ? 'herd_lost' : h.target ? 'forecast_visible' : 'window_ended';
    emit(s, reason === 'herd_lost' ? 'Too few bristlebacks remain to call in unison.' : 'The bristlebacks are clicking again.', 'info');
    emitEvent(s, 'herd.calling', { ...details, reason });
  }
}
export function validateReliability(s) {
  const h = s.debris;
  const point = (site,p) => p&&validHazardPosition(site,{x:p.x,y:p.y,z:p.z});
  if (!h || !Number.isSafeInteger(h.next) || h.next <= s.tick || h.next > s.tick + DEBRIS_INTERVAL || !Number.isSafeInteger(h.count) || h.count < 0 || (h.target !== null && (!validHazardPosition(s.sites.surface,h.target) || h.next - s.tick > DEBRIS_FORECAST))) throw new Error('Invalid debris forecast.');
  if (h.herdQuiet !== undefined && h.herdQuiet !== true && h.herdQuiet !== false) throw new Error('Invalid herd warning.');
  if (h.herdQuiet === true && (livingHerd(s).length < 2 || h.target !== null || h.next - s.tick > HERD_WARNING_LEAD || h.next - s.tick <= DEBRIS_FORECAST)) throw new Error('Invalid herd warning.');
  for (const site of Object.values(s.sites)) {
    if (!Array.isArray(site.incidents) || site.incidents.length > 12 || site.incidents.some(i => !point(site,i) || !Number.isSafeInteger(i.tick) || i.tick < 0 || i.tick > s.tick || !['wear', 'debris', 'fire', 'water'].includes(i.cause) || !['structure', 'cable', 'pipe', 'waterPipe'].includes(i.target) || !Number.isFinite(i.amount) || i.amount <= 0 || i.amount > 100)) throw new Error('Invalid damage history.');
    for (const t of site.tiles) {
      const m = t.maintenance;
      if (!maintainable(t)) { if (m !== undefined) throw new Error('Maintenance belongs to missing equipment.'); continue; }
      if (!m || m.asset !== t.building || !Number.isSafeInteger(m.usage) || m.usage < 0 || typeof m.auto !== 'boolean' || (m.servicedAt !== null && (!Number.isSafeInteger(m.servicedAt) || m.servicedAt < 0 || m.servicedAt > s.tick)) || (m.blocked !== null && (typeof m.blocked !== 'string' || m.blocked.length > 200))) throw new Error('Invalid service history.');
    }
  }
  for (const j of s.jobs) {
    if (j.automaticMaintenance !== undefined && (j.automaticMaintenance !== true || !['service', 'repair'].includes(j.kind))) throw new Error('Invalid automatic maintenance order.');
    if (j.kind === 'service' && !maintainable(tileAt(s.sites[j.site],positionOf(j)))) throw new Error('Service order has no equipment.');
  }
}
