import { rawFood, preparedFood } from './food-lots.js';
import { cookMeal } from './meals.js';
import { craftKeepsake } from './possessions.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { cropRoomBlock } from './rooms.js';
import { temperatureAt } from './thermal.js';
import { RECIPES, BUILDINGS } from './data.js';
import { add, extract, contains, quantity, OUTPUT_CAPACITY, initializeStorage } from './inventory.js';
import { breathable, roomAt, moveCrew } from './atmosphere.js';
import { workRate, gainExperience, remember } from './crew.js';

export const staffed = t => !!RECIPES[t.building] && !RECIPES[t.building].lifeSupport && !RECIPES[t.building].automatic;
export const newProductionOrder = () => ({ mode: 'continuous', limit: 0, remaining: 0, priority: 1 });
export function initializeProduction(s) {
  for (const c of s.crew) {
    c.skills.production ??= { level: c.role === 'Botanist' || c.role === 'Technician' ? 3 : c.role === 'Engineer' ? 2 : 0, xp: 0 };
    c.labors.production ??= true;
  }
  for (const site of Object.values(s.sites)) for (const t of site.tiles) if (staffed(t)) {
    initializeStorage(t); t.machine.order ??= newProductionOrder(); t.machine.completed ??= 0;
  }
}
const operationAt = (s, site, t) => s.jobs.find(j => j.kind === 'operate' && j.site === site.id && j.x === t.x && j.y === t.y);
const outputResource = t => Object.keys(RECIPES[t.building].output)[0];
// Count available products once, including goods en route to storage and promised batch output.
// Ingredients and construction/shuttle reservations are already committed to another purpose.
export function projectedStock(s, site, resource, ignorePending = null, preparedOnly = false) {
  let total = 0;
  const amount = inventory => preparedOnly ? preparedFood(inventory) : inventory?.[resource] || 0;
  for (const t of site.tiles) {
    total += amount(t.stock) + amount(t.drop) + amount(t.machine?.output);
    if ((!preparedOnly || t.building==='galley') && staffed(t) && (quantity(t.machine?.batch) || (t !== ignorePending && operationAt(s, site, t)))) total += RECIPES[t.building].output[resource] || 0;
  }
  for (const c of s.crew) if (c.site === site.id && c.carry && (!c.delivery || c.delivery.kind === 'stock')) total += amount(c.carry);
  return total;
}
export function inputBatchesWanted(s, site, t) {
  const recipe = RECIPES[t.building], m = t.machine;
  if (!recipe || !m?.enabled) return 0;
  if (recipe.lifeSupport || recipe.automatic || m.order.mode === 'continuous') return 2;
  if (m.order.mode === 'batches') return Math.min(2, Math.max(0, m.order.remaining - (quantity(m.batch) ? 1 : 0)));
  const resource = outputResource(t);
  return Math.min(2, Math.max(0, Math.ceil((m.order.limit - projectedStock(s, site, resource, t, t.building==='galley')) / recipe.output[resource])));
}
function wanted(s, site, t) {
  const m = t.machine;
  if (quantity(m.batch)) return true; // Finish already committed ingredients under any revised order.
  if (m.order.mode === 'continuous') return true;
  if (m.order.mode === 'batches') return m.order.remaining > 0;
  return projectedStock(s, site, outputResource(t), t, t.building==='galley') < m.order.limit;
}
export function productionBlock(s, site, t) {
  if (!staffed(t) || !t.machine) return 'Workstation no longer exists';
  const m = t.machine, recipe = RECIPES[t.building];
  if(t.fire)return 'Fire at workstation';
  if (!m.enabled) return 'Paused by player';
  if (s.jobs.some(j => j.site === site.id && j.x === t.x && j.y === t.y && !['operate', 'feed', 'hygiene'].includes(j.kind))) return 'Reserved for construction or service';
  if (!t.hp) return 'Needs repair';
  const roomBlock = cropRoomBlock(s, site, t); if (roomBlock) return roomBlock;
  if (!wanted(s, site, t)) return m.order.mode === 'batches' ? 'Requested batches complete' : 'Stock target met';
  if (!t.powered) return 'No power';
  if (recipe.air && (!breathable(roomAt(site, t.x, t.y)) || (roomAt(site, t.x, t.y)?.air || 0) <= recipe.air)) return 'Needs breathable atmosphere';
  if (recipe.temperature) { const temp = temperatureAt(site, t.x, t.y); if (temp < recipe.temperature[0] || temp > recipe.temperature[1]) return `Needs ${recipe.temperature[0]}–${recipe.temperature[1]} °C`; }
  if (quantity(m.output) + quantity(recipe.output) > OUTPUT_CAPACITY) return 'Output full; needs hauling';
  if (!quantity(m.batch) && t.building==='galley' && rawFood(m.input)<recipe.input.food) return 'Waiting for unprepared food delivery';
  if (!quantity(m.batch) && !contains(m.input, recipe.input)) return `Waiting for input delivery: ${Object.entries(recipe.input).filter(([r, n]) => (m.input[r] || 0) < n).map(([r]) => r).join(', ')}`;
  return null;
}
export function releaseOperation(s, j) {
  for (const c of s.crew) if (c.job === j.id) { c.job = null; c.activity = 'Production interrupted'; }
  s.jobs = s.jobs.filter(other => other.id !== j.id);
}
export function releaseOperationsAt(s, siteId, x, y) {
  for (const j of [...s.jobs]) if (j.kind === 'operate' && j.site === siteId && j.x === x && j.y === y) releaseOperation(s, j);
}
export function scheduleProduction(s, order) {
  for (const j of [...s.jobs]) if (j.kind === 'operate') {
    const site = s.sites[j.site], t = site.tiles[j.y * site.size + j.x];
    if (t.building !== j.building || productionBlock(s, site, t)) releaseOperation(s, j);
  }
  for (const site of Object.values(s.sites)) for (const t of site.tiles) if (staffed(t)) {
    initializeStorage(t); const m = t.machine, blocked = productionBlock(s, site, t);
    if (blocked) { m.status = blocked; continue; }
    let j = operationAt(s, site, t);
    if (!j) { const result = order(s, site.id, t.x, t.y, 'operate', t.building); if (result.ok) j = result.job; else m.status = result.message; }
    if (j) m.status = j.worker ? 'Operator assigned' : j.blockedReason || 'Waiting for a production operator';
  }
}
export function operateMachine(s, c, j, site, pathTo) {
  const t = site.tiles[j.y * site.size + j.x], m = t.machine, blocked = productionBlock(s, site, t);
  if (blocked || t.building !== j.building) { if (m) m.status = blocked || 'Workstation replaced'; releaseOperation(s, j); return; }
  const goals = [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]], route = pathTo(site, c, goals);
  if (route === null) { c.job = null; j.worker = null; j.blockedReason = m.status = c.activity = 'Workstation route blocked'; return; }
  if (route.length) { moveCrew(c, site, route[0]); c.activity = `Going to ${BUILDINGS[t.building].name.toLowerCase()}`; return; }
  const recipe = RECIPES[t.building];
  if (!quantity(m.batch)) { const batch = extract(m.input, recipe.input, t.building==='galley'); if (!batch) return; m.batch = batch; m.progress = 0; emitEvent(s,'production.batch.started',{entity:tileEntityId(site.id,t.x,t.y),actor:c.id,job:j.id,recipe:t.building,input:batch}); }
  const effort = Math.min(recipe.duration - m.progress, workRate(c, 'production'));
  m.progress += effort; j.remaining = Math.max(0, recipe.duration - m.progress); gainExperience(c, 'production', effort);
  c.activity = `Operating ${BUILDINGS[t.building].name.toLowerCase()}`; m.status = 'Processing with operator'; j.blockedReason = null;
  if (j.remaining < 1e-9) {
    add(m.output, t.building==='galley'?cookMeal(s,c,j,m.batch):t.building==='artisan'?craftKeepsake(s,c):recipe.output); m.batch = {}; delete m.legacyCrop; m.progress = 0; m.completed++;
    if (m.order.mode === 'batches') m.order.remaining = Math.max(0, m.order.remaining - 1);
    m.status = 'Batch complete; output awaiting haul';
    emitEvent(s,'production.batch.completed',{entity:tileEntityId(site.id,t.x,t.y),actor:c.id,job:j.id,recipe:t.building,output:recipe.output});
    remember(s, c, 'production-work', 'Completed a production batch for the colony.', 3); releaseOperation(s, j); c.activity = 'Production batch complete';
  }
}
export function setProductionOrder(s, siteId, x, y, mode, limit) {
  const site = s.sites[siteId], t = site?.tiles.find(t => t.x === x && t.y === y);
  if (!t || !staffed(t) || !t.machine || !['continuous', 'batches', 'stock'].includes(mode) || !Number.isInteger(limit) || limit < 0 || limit > 1000) return { ok: false, message: 'Choose continuous, batches, or stock and a whole-number amount from 0 to 1000.' };
  const m = t.machine; m.order = { mode, limit: mode === 'continuous' ? 0 : limit, remaining: mode === 'batches' ? limit : 0, priority: m.order.priority };
  if (!wanted(s, site, t)) releaseOperationsAt(s, siteId, x, y);
  m.status = quantity(m.batch) ? 'Order changed; retaining current batch' : 'Production order updated'; return { ok: true };
}
export function setProductionPriority(s, siteId, x, y, priority) {
  const site = s.sites[siteId], t = site?.tiles.find(t => t.x === x && t.y === y);
  if (!t || !staffed(t) || !t.machine || ![1, 3, 5].includes(priority)) return { ok: false, message: 'Choose a workstation and a valid work priority.' };
  t.machine.order.priority = priority; const j = operationAt(s, site, t); if (j) j.priority = priority; return { ok: true };
}
export function validateProduction(s) {
  const seen = new Set();
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    if (!staffed(t)) continue;
    const m = t.machine, o = m.order;
    if(t.building==='galley'&&(preparedFood(m.input)>0||preparedFood(m.batch)>0||rawFood(m.output)>0))throw new Error('Invalid galley food state.');
    if (!o || !['continuous', 'batches', 'stock'].includes(o.mode) || !Number.isInteger(o.limit) || o.limit < 0 || o.limit > 1000 || !Number.isInteger(o.remaining) || o.remaining < 0 || o.remaining > o.limit || (o.mode !== 'batches' && o.remaining !== 0) || (o.mode === 'continuous' && o.limit !== 0) || ![1, 3, 5].includes(o.priority) || !Number.isSafeInteger(m.completed) || m.completed < 0) throw new Error('Invalid production order.');
  }
  for (const j of s.jobs.filter(j => j.kind === 'operate')) {
    const site = s.sites[j.site], t = site.tiles[j.y * site.size + j.x], key = `${j.site}/${j.x}/${j.y}`;
    if (!staffed(t) || t.building !== j.building || seen.has(key) || quantity(j.cost) || quantity(j.materials) || j.sources.length || j.work !== RECIPES[t.building].duration || Math.abs(j.remaining - (j.work - t.machine.progress)) > 1e-7 || j.priority !== t.machine.order.priority) throw new Error('Invalid production assignment.');
    seen.add(key);
  }
}
