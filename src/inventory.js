import { initializeBreakerTile } from './breakers.js';
import { initializePlumbingTile, waterNode } from './plumbing.js';
import { initializeGasTile, gasNode } from './gas-networks.js';
import { gasAmount } from './atmosphere.js';
import { initializeLiquidTile } from './liquids.js';
import { validItemLots, takeItemLots } from './item-lots.js';
import { foodLots, storeLots, takeFoodLots, rawFood } from './food-lots.js';
import { RESOURCES, RECIPES } from './data.js';
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
  if(items.keepsakes && !validItemLots(items,true))throw new Error('Physical keepsakes need item identities.');
  const discrete=items.keepsakes?[...(inventory._items||[]),...items._items.map(i=>({...i}))]:null;
  const lots = items.food ? [...foodLots(inventory), ...foodLots(items)] : null;
  addCounts(inventory, items); if(discrete)inventory._items=discrete; if (lots) storeLots(inventory, lots); return inventory;
}
export function extract(inventory, items, rawOnly = false) {
  if (!contains(inventory, items) || rawOnly && (items.food || 0) > rawFood(inventory) + 1e-9) return null;
  const result = {};
  if(items.keepsakes){const moved=takeItemLots(inventory,items.keepsakes,items._items);if(!moved)return null;result._items=moved;}
  if (items.food) storeLots(result, takeFoodLots(inventory, items.food, rawOnly));
  for (const [r, n] of resourceEntries(items)) { if (!n) continue; result[r] = n; inventory[r] -= n; if (inventory[r] < 1e-10) delete inventory[r]; }
  return result;
}
export const take = (inventory, items) => extract(inventory, items) !== null;
export function spill(tile, items) {
  if (quantity(items)) tile.drop = add(tile.drop || {}, items);
}
export function initializeStorage(tile) {
  initializeLiquidTile(tile); initializeGasTile(tile); initializePlumbingTile(tile); initializeBreakerTile(tile);
  if (tile.building === 'sanitary') tile.sanitary ??= { output: {} };
  if (tile.building === 'stockpile') {
    if (!tile.stock) tile.stock = {};
    if (!tile.storage) tile.storage = { accepted: [...RESOURCES], priority: 3 };
  }
  if (RECIPES[tile.building] && !tile.machine) tile.machine = { input: {}, output: {}, batch: {}, progress: 0, enabled: true, status: 'Waiting for delivery', ...(!(RECIPES[tile.building].lifeSupport || RECIPES[tile.building].automatic) ? { order: { mode: 'continuous', limit: 0, remaining: 0, priority: 1 }, completed: 0 } : {}) };
}
export const stores = s => s.sites.surface.tiles.filter(t => t.building === 'stockpile' && t.stock);
export function syncResources(s) {
  s.resources = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  for (const t of stores(s)) addCounts(s.resources, t.stock);
  return s.resources;
}
// Only unreserved depot stock is spendable. Other owners keep their own inventory.
export function reserve(s, cost, eligible = () => true) {
  const depots = stores(s).filter(eligible), total = {};
  depots.forEach(t => addCounts(total, t.stock));
  if (!contains(total, cost)) return null;
  const sources = [];
  for (const [r, amount] of Object.entries(cost)) {
    let left = amount;
    for (const t of depots) { const n = Math.min(left, t.stock[r] || 0); if (n) { const items = extract(t.stock, { [r]: n }); sources.push({ x: t.x, y: t.y, items }); } left -= n; }
  }
  syncResources(s); return sources;
}
export const spend = (s, cost, eligible) => reserve(s, cost, eligible) !== null;
export function totalResources(s) {
  const total = Object.fromEntries(RESOURCES.map(r => [r, 0]));
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    total.water += (t.liquid || 0) + (waterNode(t)?.water || 0);
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
