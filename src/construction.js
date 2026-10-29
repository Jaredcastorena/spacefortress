import { fitAmount } from './item-lots.js';
import { crewPathToPosition } from './navigation.js';
import { tileAt, sameCell, horizontalNeighbors } from './spatial.js';
import { shipmentPosition } from './shipment-locations.js';
import { advanceCrewRoutePositions as advanceCrewRoute } from './crew-traversal.js';
import { RESOURCES } from './data.js';
import { planFoodSelection } from './food-lots.js';
import { CARRY_CAPACITY, add, addCounts, extract, resourceEntries, contains, quantity, spill, syncResources } from './inventory.js';
import { availableInventory } from './inventory-reservations.js';
import { shuttleLocation } from './outposts.js';
import { emitEvent, emitItemMovement } from './telemetry.js';

const workCells = j => horizontalNeighbors(shipmentPosition(j));
export const materialsReady = j => contains(j.materials, j.cost) && (!j.foodKinds || !!planFoodSelection(j.materials, j.cost.food || 0, { rawOnly: true, foodKinds: j.foodKinds }));
const sourceInventory = (t, kind) => kind === 'stock' ? t.building === 'stockpile' ? t.stock : null : kind === 'imports' ? t.building === 'dock' ? t.imports : null : kind === 'drop' ? t.drop : null;
// Work authority follows living people at the site, independently of which map
// is viewed or whether the shuttle is still visiting a resident's home.
export function siteWorkAllowed(s, siteId) {
  if (!s.sites[siteId]) return false;
  if (siteId === 'surface') return true;
  const locals = s.crew.filter(c => c.site === siteId && c.health > 0);
  if (s.outposts?.[siteId]?.established && locals.some(c => s.outposts[siteId].residents.includes(c.id))) return true;
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
export function constructionResources(s, siteId = 'surface', selector = false) {
  const total = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  const kinds = selector?.foodKinds && Object.fromEntries(Object.keys(selector.foodKinds).map(kind => [kind, 0]));
  for (const { t, kind } of constructionSupplyLocations(s, siteId)) for (const r of RESOURCES) {
    if (r === 'food' && kinds) {
      for (const foodKind of Object.keys(kinds)) kinds[foodKind] += availableInventory(s, siteId, { x: t.x, y: t.y, z: t.z === undefined ? 0 : t.z }, kind, r, null, { rawOnly: true, foodKinds: { [foodKind]: selector.foodKinds[foodKind] } });
    } else total[r] += availableInventory(s, siteId, { x: t.x, y: t.y, z: t.z === undefined ? 0 : t.z }, kind, r, null, r === 'food' ? selector : false);
  }
  if (kinds) total.food = Object.entries(kinds).reduce((sum, [kind, n]) => sum + Math.min(n, selector.foodKinds[kind]), 0);
  return total;
}
export function reserveConstruction(s, siteId, x, y, cost, pathTo, selector = false, z = 0) {
  if (!quantity(cost)) return [];
  const site = s.sites[siteId];
  if (!site || !Number.isInteger(x) || !Number.isInteger(y) || !tileAt(site,{x,y,z})) return null;
  if (selector?.foodKinds && Math.abs(Object.values(selector.foodKinds).reduce((sum, n) => sum + n, 0) - (cost.food || 0)) > 1e-9) return null;
  const goals = workCells({ x, y, z });
  const sources = constructionSupplyLocations(s, siteId).filter(({ t }) => crewPathToPosition(s, site, shipmentPosition(t), [shipmentPosition(t)]) !== null && crewPathToPosition(s, site, shipmentPosition(t), goals) !== null);
  const remaining = { ...cost }, remainingKinds = selector?.foodKinds && { ...selector.foodKinds }, planned = [];
  // Preflight every source before extracting anything, including exact diets.
  for (const { t, kind } of sources) {
    const items = {}, selectedKinds = {};
    for (const [r, amount] of resourceEntries(remaining)) {
      let n;
      if (r === 'food' && remainingKinds) {
        for (const [foodKind, needed] of Object.entries(remainingKinds)) {
          const picked = availableInventory(s, siteId, { x: t.x, y: t.y, z: t.z === undefined ? 0 : t.z }, kind, r, null, { rawOnly: true, foodKinds: { [foodKind]: needed } });
          if (picked > 0) { selectedKinds[foodKind] = picked; remainingKinds[foodKind] -= picked; }
        }
        n = Object.values(selectedKinds).reduce((sum, n) => sum + n, 0);
      } else n = Math.min(amount, availableInventory(s, siteId, { x: t.x, y: t.y, z: t.z === undefined ? 0 : t.z }, kind, r, null, r === 'food' ? selector : false));
      if (n > 0) { items[r] = n; remaining[r] -= n; }
    }
    if (quantity(items)) planned.push({ t, kind, items, selector: remainingKinds ? { rawOnly: true, foodKinds: selectedKinds } : selector });
  }
  if (resourceEntries(remaining).some(([, n]) => n > 0)) return null;
  if (planned.some(({ t, kind, items, selector: selected }) => !contains(sourceInventory(t, kind), items) || items.food && !planFoodSelection(sourceInventory(t, kind), items.food, selected))) return null;
  const reserved = [];
  for (const { t, kind, items, selector: sourceSelector } of planned) {
    const shipment = extract(sourceInventory(t, kind), items, sourceSelector);
    reserved.push({ ...shipmentPosition(t), kind, items: shipment });
    if (kind === 'drop' && !quantity(t.drop)) t.drop = null;
  }
  syncResources(s); return reserved;
}
export function materialSource(j, c, site, pathTo) {
  if (!site || site.id !== j.site || c.site !== j.site) return null;
  return j.sources.find(source => quantity(source.items) && pathTo(site,c,[shipmentPosition(source)]) !== null && pathTo(site,shipmentPosition(source),workCells(j)) !== null);
}
export function materialRoute(j, c, site, pathTo) {
  if (!site || site.id !== j.site || c.site !== j.site) return null;
  if (materialsReady(j)) return pathTo(site,c,workCells(j));
  const source=materialSource(j,c,site,pathTo);
  return source ? pathTo(site,c,[shipmentPosition(source)]) : null;
}
export function materialObstruction(j) {
  if (j.missingFood > 0) return 'Food spoiled; waiting for replacement food';
  return j.sources.some(source => quantity(source.items)) ? 'Reserved supplies are beyond a blocked route' : 'Waiting for materials in transit';
}
// Material collection is part of a builder's/repairer's duty, even with general hauling disabled.
export function fetchMaterials(s, c, j, site, pathTo) {
  const source = materialSource(j, c, site, (current, from, goals) => crewPathToPosition(s, current, from, goals));
  if (!source) { j.blockedReason = materialObstruction(j); c.activity = j.blockedReason; j.worker = null; c.job = null; return; }
  j.blockedReason = null; c.activity = j.kind === 'feed' ? 'Collecting a patient ration' : j.kind === 'treat' ? 'Collecting medicine' : j.kind === 'loadShuttle' ? 'Collecting shuttle supplies' : ['loadCargo', 'unloadCargo'].includes(j.kind) ? 'Collecting freight shipment' : 'Collecting construction supplies';
  const path = crewPathToPosition(s, site, c, [shipmentPosition(source)]);
  if (path.length) { advanceCrewRoute(s, c, site, [path.at(-1)]); return; }
  const items = {}; let room = CARRY_CAPACITY;
  for (const [r, n] of resourceEntries(source.items)) { const amount = fitAmount(r,n,room); if (amount) items[r] = amount; room -= amount; }
  const sourceIndex = j.sources.indexOf(source);
  c.carry = extract(source.items, items); c.delivery = { kind: 'job', target: shipmentPosition(j), job: j.id };
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
  const path = crewPathToPosition(s, site, c, workCells(j));
  const purpose = ['treat', 'animalTreat', 'feed'].includes(j.kind) ? 'Medical' : ['loadShuttle', 'loadCargo', 'unloadCargo'].includes(j.kind) ? 'Shuttle' : 'Construction';
  c.activity = path === null ? `${purpose} delivery route blocked; holding supplies` : `Delivering ${purpose.toLowerCase()} supplies`;
  if (path === null) { j.blockedReason = `${purpose} delivery route blocked`; return true; }
  if (path.length) { advanceCrewRoute(s, c, site, [path.at(-1)]); return true; }
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
  const target = tileAt(site, shipmentPosition(j));
  const staging = open(target) ? target : workCells(j).map(p => tileAt(site, p)).find(open) || target;
  for (const source of j.sources) {
    const items = source.items; source.items = {};
    const tile = tileAt(site, source);
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
  if (j) j.sources.push({ ...shipmentPosition(c), kind: 'drop', items: { ...c.carry } });
  else spill(tileAt(s.sites[c.site], shipmentPosition(c)), c.carry || {});
  c.carry = null; c.delivery = null;
}
export function reservedAt(s, siteId, x, y, z = 0) {
  const total = {};
  for (const j of s.jobs.filter(j => j.site === siteId)) {
    for (const source of j.sources) if (sameCell(source, {x,y,z})) addCounts(total, source.items);
    if (sameCell(shipmentPosition(j), {x,y,z})) addCounts(total, j.materials);
  }
  return total;
}
