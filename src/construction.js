import { fitAmount } from './item-lots.js';
import { moveCrew } from './atmosphere.js';
import { RESOURCES } from './data.js';
import { CARRY_CAPACITY, add, addCounts, extract, resourceEntries, contains, quantity, spill, syncResources } from './inventory.js';
import { availableInventory } from './inventory-reservations.js';
import { shuttleLocation } from './outposts.js';
import { emitEvent, emitItemMovement } from './telemetry.js';

const at = (site, x, y) => x >= 0 && y >= 0 && x < site.size && y < site.size ? site.tiles[y * site.size + x] : undefined;
const workPositions = j => [[j.x + 1, j.y], [j.x - 1, j.y], [j.x, j.y + 1], [j.x, j.y - 1]];
export const materialsReady = j => contains(j.materials, j.cost);
const sourceInventory = (t, kind) => kind === 'stock' ? t.building === 'stockpile' ? t.stock : null : kind === 'imports' ? t.building === 'dock' ? t.imports : null : kind === 'drop' ? t.drop : null;
// Work authority follows living people at the site, independently of which map
// is viewed or whether the shuttle is still visiting a resident's home.
export function siteWorkAllowed(s, siteId) {
  if (!s.sites[siteId]) return false;
  if (siteId === 'surface') return true;
  const locals = s.crew.filter(c => c.site === siteId && c.health > 0);
  if (siteId === 'wreck' && s.outposts?.wreck.established && locals.some(c => s.outposts.wreck.residents.includes(c.id))) return true;
  const mission = s.mission;
  return !!mission && mission.site === siteId && mission.phase === 'working' &&
    locals.some(c => mission.crew.includes(c.id) || mission.returnCrew?.includes(c.id));
}
export function constructionSupplyLocations(s, siteId = 'surface') {
  const site = s.sites[siteId]; if (!site) return [];
  // Depots remain preferred. Landed imports precede loose piles, so a local
  // bootstrap can build storage without ever consulting another site's stock.
  return ['stock', 'imports', 'drop'].flatMap(kind => site.tiles.filter(t => quantity(sourceInventory(t, kind))).map(t => ({ t, kind })));
}
export function constructionResources(s, siteId = 'surface') {
  const total = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  for (const { t, kind } of constructionSupplyLocations(s, siteId)) for (const r of RESOURCES) total[r] += availableInventory(s, siteId, [t.x, t.y], kind, r);
  return total;
}
export function reserveConstruction(s, siteId, x, y, cost, pathTo) {
  if (!quantity(cost)) return [];
  const site = s.sites[siteId];
  if (!site || !Number.isInteger(x) || !Number.isInteger(y) || !at(site, x, y)) return null;
  const goals = workPositions({ x, y });
  const sources = constructionSupplyLocations(s, siteId).filter(({ t }) => pathTo(site, t, [[t.x, t.y]]) !== null && pathTo(site, t, goals) !== null);
  const available = {};
  for (const { t, kind } of sources) for (const r of RESOURCES) available[r] = (available[r] || 0) + availableInventory(s, siteId, [t.x, t.y], kind, r);
  if (!contains(available, cost)) return null;
  const remaining = { ...cost }, reserved = [];
  for (const { t, kind } of sources) {
    const inventory = sourceInventory(t, kind);
    const items = {};
    for (const [r, amount] of Object.entries(remaining)) { const n = Math.min(amount, availableInventory(s, siteId, [t.x, t.y], kind, r)); if (n) { items[r] = n; remaining[r] -= n; } }
    if (!quantity(items)) continue;
    const shipment = extract(inventory, items); reserved.push({ x: t.x, y: t.y, kind, items: shipment });
    if (kind === 'drop' && !quantity(t.drop)) t.drop = null;
  }
  syncResources(s); return reserved;
}
export function materialSource(j, c, site, pathTo) {
  if (!site || site.id !== j.site || c.site !== j.site) return null;
  return j.sources.find(source => quantity(source.items) && pathTo(site, c, [[source.x, source.y]]) !== null && pathTo(site, source, workPositions(j)) !== null);
}
export function materialRoute(j, c, site, pathTo) {
  if (!site || site.id !== j.site || c.site !== j.site) return null;
  if (materialsReady(j)) return pathTo(site, c, workPositions(j));
  const source = materialSource(j, c, site, pathTo);
  return source ? pathTo(site, c, [[source.x, source.y]]) : null;
}
export function materialObstruction(j) {
  if (j.missingFood > 0) return 'Food spoiled; waiting for replacement food';
  return j.sources.some(source => quantity(source.items)) ? 'Reserved supplies are beyond a blocked route' : 'Waiting for materials in transit';
}
// Material collection is part of a builder's/repairer's duty, even with general hauling disabled.
export function fetchMaterials(s, c, j, site, pathTo) {
  const source = materialSource(j, c, site, pathTo);
  if (!source) { j.blockedReason = materialObstruction(j); c.activity = j.blockedReason; j.worker = null; c.job = null; return; }
  j.blockedReason = null; c.activity = j.kind === 'feed' ? 'Collecting a patient ration' : j.kind === 'treat' ? 'Collecting medicine' : j.kind === 'loadShuttle' ? 'Collecting shuttle supplies' : ['loadCargo', 'unloadCargo'].includes(j.kind) ? 'Collecting freight shipment' : 'Collecting construction supplies';
  const path = pathTo(site, c, [[source.x, source.y]]);
  if (path.length) { moveCrew(c, site, path[0]); return; }
  const items = {}; let room = CARRY_CAPACITY;
  for (const [r, n] of resourceEntries(source.items)) { const amount = fitAmount(r,n,room); if (amount) items[r] = amount; room -= amount; }
  const sourceIndex = j.sources.indexOf(source);
  c.carry = extract(source.items, items); c.delivery = { kind: 'job', target: [j.x, j.y], job: j.id };
  if (['loadCargo', 'unloadCargo'].includes(j.kind) && quantity(c.carry)) {
    const from = { entity: j.id, slot: `sources.${sourceIndex}` }, to = { entity: c.id, slot: 'carry' };
    emitItemMovement(s, c.carry, c.id, from, to);
    emitEvent(s, 'freight.picked_up', { entity: j.id, job: j.id, actor: c.id, site: `site:${site.id}`,
      cargo: c.carry, from, to, reason: 'source_collected' });
  }
}
export function deliverMaterials(s, c, site, pathTo) {
  const j = s.jobs.find(j => j.id === c.delivery?.job && j.site === c.site);
  if (!j) { c.delivery = null; return false; }
  if (!site || site.id !== c.site) return false;
  const path = pathTo(site, c, workPositions(j));
  const purpose = ['treat', 'feed'].includes(j.kind) ? 'Medical' : ['loadShuttle', 'loadCargo', 'unloadCargo'].includes(j.kind) ? 'Shuttle' : 'Construction';
  c.activity = path === null ? `${purpose} delivery route blocked; holding supplies` : `Delivering ${purpose.toLowerCase()} supplies`;
  if (path === null) { j.blockedReason = `${purpose} delivery route blocked`; return true; }
  if (path.length) { moveCrew(c, site, path[0]); return true; }
  const cargo = c.carry;
  add(j.materials, cargo); c.carry = null; c.delivery = null; j.blockedReason = null;
  if (['loadCargo', 'unloadCargo'].includes(j.kind) && quantity(cargo)) {
    const from = { entity: c.id, slot: 'carry' }, to = { entity: j.id, slot: 'materials' };
    emitItemMovement(s, cargo, c.id, from, to);
    emitEvent(s, 'freight.delivered', { entity: j.id, job: j.id, actor: c.id, site: `site:${site.id}`,
      cargo, from, to, reason: 'materials_staged' });
  }
  return true;
}
export function cancelMaterials(s, j) {
  const site = s.sites[j.site];
  const open = t => t && !['void', 'rock'].includes(t.terrain) && t.building !== 'wall';
  const target = at(site, j.x, j.y);
  const staging = open(target) ? target : workPositions(j).map(([x, y]) => at(site, x, y)).find(open) || target;
  for (const source of j.sources) {
    const items = source.items; source.items = {};
    const tile = at(site, source.x, source.y);
    const inventory = source.kind === 'freight' ? shuttleLocation(s) === j.site ? s.shuttle.freight : null : tile && sourceInventory(tile, source.kind);
    if (inventory) add(inventory, items);
    else spill(open(tile) ? tile : staging, items);
  }
  const materials = j.materials; j.materials = {};
  spill(staging, materials);
  // A cancelled shipment stays with its carrier and is returned through ordinary hauling.
  for (const c of s.crew) if (c.delivery?.kind === 'job' && c.delivery.job === j.id) c.delivery = null;
  syncResources(s);
}
export function dropCarriedMaterials(s, c) {
  const j = c.delivery?.kind === 'job' && s.jobs.find(j => j.id === c.delivery.job && j.site === c.site);
  if (j) j.sources.push({ x: c.x, y: c.y, kind: 'drop', items: { ...c.carry } });
  else spill(at(s.sites[c.site], c.x, c.y), c.carry || {});
  c.carry = null; c.delivery = null;
}
export function reservedAt(s, siteId, x, y) {
  const total = {};
  for (const j of s.jobs.filter(j => j.site === siteId)) {
    for (const source of j.sources) if (source.x === x && source.y === y) addCounts(total, source.items);
    if (j.x === x && j.y === y) addCounts(total, j.materials);
  }
  return total;
}
