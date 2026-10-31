import { initializeBreakerTile } from './breakers.js';
import { initializePlumbingTile, waterNode } from './plumbing.js';
import { initializeGasTile, gasNode } from './gas-networks.js';
import { gasAmount } from './atmosphere.js';
import { initializeLiquidTile } from './liquids.js';
import { ITEM_RESOURCES, itemResource, validItemLots, takeItemLots } from './item-lots.js';
import { foodLots, storeLots, takeFoodLots, planFoodSelection } from './food-lots.js';
import { DEFAULT_CROP, DEFAULT_MEAL } from './food-data.js';
import { DEFAULT_TOOL_RECIPE } from './tool-data.js';
import { RESOURCES, RECIPES } from './data.js';
import { shipmentPosition } from './shipment-locations.js';
export const CARRY_CAPACITY = 6;
export const OUTPUT_CAPACITY = 12;

export const resourceEntries = inventory => Object.entries(inventory || {}).filter(([r]) => RESOURCES.includes(r));
export const quantity = inventory => resourceEntries(inventory).reduce((sum, [, n]) => sum + n, 0);
export const contains = (inventory, cost) => resourceEntries(cost).every(([r, n]) => (inventory[r] || 0) >= n);
export function addCounts(inventory, items) {
  for (const [r, n] of resourceEntries(items)) if (n > 0) inventory[r] = (inventory[r] || 0) + n;
  return inventory;
}
export function add(inventory, items) {
  let discrete = null;
  if (ITEM_RESOURCES.some(resource => items[resource] !== undefined) || items._items !== undefined) {
    if (!validItemLots(items, true) || !validItemLots(inventory, true)) throw new Error('Physical items need matching identities.');
    discrete = [...(inventory._items || []), ...(items._items || []).map(item => ({...item}))];
    const merged = { ...inventory, _items: discrete };
    for (const resource of ITEM_RESOURCES) merged[resource] = (inventory[resource] || 0) + (items[resource] || 0);
    if (discrete.length && !validItemLots(merged, true)) throw new Error('Physical items need unique identities and whole counts.');
  }
  const lots = items.food ? [...foodLots(inventory), ...foodLots(items)] : null;
  addCounts(inventory, items); if (discrete?.length) inventory._items = discrete; if (lots) storeLots(inventory, lots); return inventory;
}
export function extract(inventory, items, selector = false) {
  if (!contains(inventory, items) || planFoodSelection(inventory, items.food || 0, selector) === null) return null;
  // Plan every discrete family before changing any physical inventory or food lots.
  const counts = ITEM_RESOURCES.map(resource => items[resource] === undefined ? 0 : items[resource]), moved = [];
  if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) return null;
  if (counts.some(Boolean) || items._items !== undefined) {
    if (!validItemLots(inventory, true)) return null;
    let requested = null;
    if (items._items !== undefined) {
      if (!Array.isArray(items._items) || items._items.some(item => !item || typeof item.id !== 'string')) return null;
      const ids = items._items.map(item => item.id);
      if (new Set(ids).size !== ids.length || ids.length !== counts.reduce((sum, count) => sum + count, 0)) return null;
      requested = (inventory._items || []).filter(item => ids.includes(item.id));
      if (requested.length !== ids.length) return null;
    }
    const planned = { ...inventory };
    for (const [index, resource] of ITEM_RESOURCES.entries()) {
      const selected = takeItemLots(planned, counts[index], requested?.filter(item => itemResource(item) === resource) ?? null, resource);
      if (!selected) return null;
      moved.push(...selected);
    }
    if (planned._items) inventory._items = planned._items; else delete inventory._items;
  }
  const result = moved.length ? { _items: moved } : {};
  if (items.food) storeLots(result, takeFoodLots(inventory, items.food, selector));
  for (const [r, n] of resourceEntries(items)) { if (!n) continue; result[r] = n; inventory[r] -= n; if (inventory[r] < 1e-10) delete inventory[r]; }
  return result;
}
export const take = (inventory, items, selector = false) => extract(inventory, items, selector) !== null;
export function spill(tile, items) {
  if (quantity(items)) tile.drop = add(tile.drop || {}, items);
}
export function initializeStorage(tile) {
  initializeLiquidTile(tile); initializeGasTile(tile); initializePlumbingTile(tile); initializeBreakerTile(tile);
  if (tile.building === 'sanitary') tile.sanitary ??= { output: {} };
  if (tile.building === 'stockpile') {
    if (!tile.stock) tile.stock = {};
    if (!tile.storage) tile.storage = { accepted: [...RESOURCES], priority: 3, limits: {} };
  }
  if (RECIPES[tile.building] && !tile.machine) tile.machine = { input: {}, output: {}, batch: {}, progress: 0, enabled: true, status: 'Waiting for delivery', ...(!(RECIPES[tile.building].lifeSupport || RECIPES[tile.building].automatic) ? { order: { mode: 'continuous', limit: 0, remaining: 0, priority: 1 }, completed: 0 } : {}) };
  if (tile.machine && ['farm', 'galley', 'toolbench'].includes(tile.building)) tile.machine.recipeId ??= tile.building === 'farm' ? DEFAULT_CROP : tile.building === 'galley' ? DEFAULT_MEAL : DEFAULT_TOOL_RECIPE;
}
export const stores = (s, siteId='surface') => s.sites[siteId].tiles.filter(t => t.building === 'stockpile' && t.stock);
export function syncResources(s) {
  s.resources = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  for (const t of stores(s)) addCounts(s.resources, t.stock);
  return s.resources;
}
// Only unreserved depot stock is spendable. Other owners keep their own inventory.
export function reserve(s, cost, eligible = () => true, siteId = 'surface') {
  const depots = stores(s,siteId).filter(eligible), total = {};
  depots.forEach(t => addCounts(total, t.stock));
  if (!contains(total, cost)) return null;
  const sources = [];
  for (const [r, amount] of Object.entries(cost)) {
    let left = amount;
    for (const t of depots) { const n = Math.min(left, t.stock[r] || 0); if (n) { const items = extract(t.stock, { [r]: n }); sources.push({ ...shipmentPosition(t), items }); } left -= n; }
  }
  syncResources(s); return sources;
}
export const spend = (s, cost, eligible, siteId = 'surface') => reserve(s, cost, eligible, siteId) !== null;
export function totalResources(s) {
  const total = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    total.water += (t.liquid || 0) + (waterNode(t)?.water || 0);
    for(const patch of Object.values(t.flora||{}))if(patch.origin==='cultivated')total.water+=patch.moisture;
    if(gasNode(t))total.air+=gasAmount(gasNode(t).gas);
    addCounts(total, t.sanitary?.output || {});
    addCounts(total, t.drop || {}); addCounts(total, t.stock || {}); addCounts(total, t.imports || {});
    if (t.machine) for (const part of ['input', 'output', 'batch']) addCounts(total, t.machine[part]);
  }
  for (const c of s.crew) { addCounts(total, c.carry || {}); addCounts(total,c.possessions?.inventory||{}); total.waste += c.sanitation?.waste || 0; }
  for (const j of s.jobs) { addCounts(total, j.materials); for (const source of j.sources) addCounts(total, source.items); }
  if (s.mission) addCounts(total, s.mission.cargo);
  addCounts(total, s.shuttle?.supplies || {}); addCounts(total, s.shuttle?.freight || {});
  return total;
}
