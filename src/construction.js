import { fitAmount } from './item-lots.js';
import { moveCrew } from './atmosphere.js';
import { RESOURCES } from './data.js';
import { CARRY_CAPACITY, add, addCounts, extract, resourceEntries, contains, quantity, spill, syncResources } from './inventory.js';

const at = (site, x, y) => x >= 0 && y >= 0 && x < site.size && y < site.size ? site.tiles[y * site.size + x] : undefined;
const workPositions = j => [[j.x + 1, j.y], [j.x - 1, j.y], [j.x, j.y + 1], [j.x, j.y - 1]];
export const materialsReady = j => contains(j.materials, j.cost);
function supplyLocations(s) {
  // Depot stock is preferred, but loose supplies can rebuild a colony without storage.
  return ['stock', 'drop'].flatMap(kind => s.sites.surface.tiles.filter(t => quantity(t[kind]) && (kind !== 'stock' || t.building === 'stockpile')).map(t => ({ t, kind })));
}
export function constructionResources(s) {
  const total = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  for (const { t, kind } of supplyLocations(s)) addCounts(total, t[kind]);
  return total;
}
export function reserveConstruction(s, siteId, x, y, cost, pathTo) {
  if (!quantity(cost)) return [];
  if (siteId !== 'surface') return null;
  const site = s.sites[siteId], goals = workPositions({ x, y });
  const sources = supplyLocations(s).filter(({ t }) => pathTo(site, t, [[t.x, t.y]]) !== null && pathTo(site, t, goals) !== null);
  const available = {}; sources.forEach(({ t, kind }) => addCounts(available, t[kind]));
  if (!contains(available, cost)) return null;
  const remaining = { ...cost }, reserved = [];
  for (const { t, kind } of sources) {
    const items = {};
    for (const [r, amount] of Object.entries(remaining)) { const n = Math.min(amount, t[kind][r] || 0); if (n) { items[r] = n; remaining[r] -= n; } }
    if (!quantity(items)) continue;
    const shipment = extract(t[kind], items); reserved.push({ x: t.x, y: t.y, kind, items: shipment });
    if (kind === 'drop' && !quantity(t.drop)) t.drop = null;
  }
  syncResources(s); return reserved;
}
export function materialSource(j, c, site, pathTo) {
  return j.sources.find(source => quantity(source.items) && pathTo(site, c, [[source.x, source.y]]) !== null && pathTo(site, source, workPositions(j)) !== null);
}
export function materialRoute(j, c, site, pathTo) {
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
  j.blockedReason = null; c.activity = j.kind === 'feed' ? 'Collecting a patient ration' : j.kind === 'treat' ? 'Collecting medicine' : j.kind === 'loadShuttle' ? 'Collecting shuttle supplies' : 'Collecting construction supplies';
  const path = pathTo(site, c, [[source.x, source.y]]);
  if (path.length) { moveCrew(c, site, path[0]); return; }
  const items = {}; let room = CARRY_CAPACITY;
  for (const [r, n] of resourceEntries(source.items)) { const amount = fitAmount(r,n,room); if (amount) items[r] = amount; room -= amount; }
  c.carry = extract(source.items, items); c.delivery = { kind: 'job', target: [j.x, j.y], job: j.id };
}
export function deliverMaterials(s, c, site, pathTo) {
  const j = s.jobs.find(j => j.id === c.delivery?.job && j.site === c.site);
  if (!j) { c.delivery = null; return false; }
  const path = pathTo(site, c, workPositions(j));
  const purpose = ['treat', 'feed'].includes(j.kind) ? 'Medical' : j.kind === 'loadShuttle' ? 'Shuttle' : 'Construction';
  c.activity = path === null ? `${purpose} delivery route blocked; holding supplies` : `Delivering ${purpose.toLowerCase()} supplies`;
  if (path === null) { j.blockedReason = `${purpose} delivery route blocked`; return true; }
  if (path.length) { moveCrew(c, site, path[0]); return true; }
  add(j.materials, c.carry); c.carry = null; c.delivery = null; j.blockedReason = null;
  return true;
}
export function cancelMaterials(s, j) {
  const site = s.sites[j.site];
  for (const source of j.sources) {
    const tile = at(site, source.x, source.y);
    if (source.kind === 'stock' && tile.building === 'stockpile') add(tile.stock, source.items);
    else spill(tile, source.items);
  }
  const open = t => t && !['void', 'rock'].includes(t.terrain) && t.building !== 'wall';
  const target = at(site, j.x, j.y);
  const staging = open(target) ? target : workPositions(j).map(([x, y]) => at(site, x, y)).find(open) || target;
  spill(staging, j.materials);
  // A cancelled shipment stays with its carrier and is returned through ordinary hauling.
  for (const c of s.crew) if (c.delivery?.kind === 'job' && c.delivery.job === j.id) c.delivery = null;
  syncResources(s);
}
export function dropCarriedMaterials(s, c) {
  const j = c.delivery?.kind === 'job' && s.jobs.find(j => j.id === c.delivery.job);
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
