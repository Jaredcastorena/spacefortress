import { rawFood, preparedFood } from './food-lots.js';
import { emitItemMovement, tileEntityId } from './telemetry.js';
import { fitAmount } from './item-lots.js';
import { depotUsage, acceptsResource, acceptsShipment } from './storage.js';
import { scheduleProduction, inputBatchesWanted, releaseOperationsAt } from './production.js';
import { moveCrew } from './atmosphere.js';
import { refreshPower } from './power.js';
import { RECIPES } from './data.js';
import { add, extract, resourceEntries, contains, quantity, spill, CARRY_CAPACITY } from './inventory.js';
import { gainExperience } from './crew.js';
import { deliverMaterials } from './construction.js';
import { incomingInventory, hasOutgoingInventory } from './inventory-reservations.js';

export { CARRY_CAPACITY } from './inventory.js';
export { OUTPUT_CAPACITY } from './inventory.js';
const tileAt = (site, xy) => site.tiles[xy[1] * site.size + xy[0]];
const xy = t => [t.x, t.y];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
export function buffer(tile, kind) {
  if (!tile) return null;
  if (kind === 'stock') return tile.building === 'stockpile' ? tile.stock : null;
  if (kind === 'imports') return tile.building === 'dock' ? tile.imports : null;
  if (kind === 'drop') return tile.drop;
  if (kind === 'output' && tile.building === 'sanitary') return tile.sanitary?.output;
  return RECIPES[tile.building] ? tile.machine?.[kind] : null;
}
export function updateIndustry(s, roomAt, order) { scheduleProduction(s, order); }
export function setMachineEnabled(s, siteId, x, y, enabled) {
  const site = s.sites[siteId], t = site?.tiles.find(t => t.x === x && t.y === y);
  if (!t?.machine || !RECIPES[t.building] || typeof enabled !== 'boolean') return { ok: false, message: 'Select a production machine.' };
  t.machine.enabled = enabled; if (!enabled) releaseOperationsAt(s, siteId, x, y); t.machine.status = enabled ? 'Waiting to resume' : 'Paused by player'; refreshPower(s, site); return { ok: true };
}

function pickHaul(s, c, site, pathTo) {
  const depots = site.tiles.filter(t => t.building === 'stockpile');
  const claimed = (t, kind) => s.crew.some(o=>o!==c&&o.site===c.site&&o.intent?.keepsake?.source===kind&&same(o.intent.keepsake.target,xy(t))) || hasOutgoingInventory(s, c.site, xy(t), kind, c);
  const candidates = [];
  const offer = (t, kind, items, destination, priority, purpose) => {
    if (!quantity(items)) return;
    const pickup = pathTo(site, c, [xy(t)]), delivery = pathTo(site, t, [destination.target]);
    if (pickup === null || delivery === null) return;
    candidates.push({ priority, purpose, distance: pickup.length + delivery.length, intent: { type: 'haul', target: xy(t), source: kind, items, destination } });
  };
  // Claims reserve space before pickup. Transfers only move uphill in priority, or evacuate rejected goods.
  for (const t of site.tiles) for (const kind of ['drop', 'output', 'stock', 'imports']) {
    const inventory = buffer(t, kind); if (!quantity(inventory) || claimed(t, kind)) continue;
    for (const depot of depots) {
      if (depot === t && kind === 'stock') continue;
      let room = Math.min(CARRY_CAPACITY, depotUsage(s, c.site, depot).free); const items = {};
      for (const [r, n] of resourceEntries(inventory)) {
        if (!acceptsResource(depot, r, site) || (kind === 'stock' && acceptsResource(t, r, site) && depot.storage.priority <= t.storage.priority)) continue;
        const picked = fitAmount(r,n,room); if (picked > 0) items[r] = picked; room -= picked;
      }
      offer(t, kind, items, { kind: 'stock', target: xy(depot) }, depot.storage.priority, 1);
    }
  }
  for (const t of site.tiles) {
    const recipe = RECIPES[t.building], m = t.machine;
    if (!recipe || !m?.enabled || !t.hp) continue;
    const destination = { kind: 'input', target: xy(t) };
    for (const [r, n] of Object.entries(recipe.input)) {
      const needed = n * inputBatchesWanted(s, site, t) - (m.input[r] || 0) - incomingInventory(s, c.site, destination, r); if (needed <= 0 || (recipe.automatic && ['reactor','waterTank','gasTank'].includes(t.building) && needed<n-1e-9)) continue;
      for (const source of site.tiles) for (const kind of ['stock', 'imports']) {
        const inventory = buffer(source, kind);
        if ((inventory?.[r] || 0) <= 0 || claimed(source, kind)) continue;
        offer(source, kind, { [r]: Math.min(needed, t.building==='galley'&&r==='food'?rawFood(inventory):inventory[r], CARRY_CAPACITY) }, destination, recipe.lifeSupport || recipe.automatic ? 5 : m.order.priority, 0);
      }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority || a.purpose - b.purpose || a.distance - b.distance);
  return candidates[0]?.intent || null;
}
function move(c, site, target, pathTo) {
  const path = pathTo(site, c, [target]);
  if (path === null) return 'blocked';
  if (!path.length) return 'arrived';
  moveCrew(c, site, path[0]); return 'moving';
}
export function haul(s, c, site, pathTo) {
  if (c.carry) {
    if (c.delivery?.kind === 'job' && deliverMaterials(s, c, site, pathTo)) return true;
    let d = c.delivery;
    const destinationAccepts = d => {
      if (!d) return false;
      const tile = tileAt(site, d.target), store = buffer(tile, d.kind);
      if (!store) return false;
      if(d.kind==='input'&&tile.building==='galley'&&preparedFood(c.carry)>0)return false;
      return (d.kind === 'stock' ? acceptsShipment(s, c.site, tile, c.carry, c) : resourceEntries(c.carry).every(([r, n]) => RECIPES[tile.building]?.input[r] && (store[r] || 0) + n <= RECIPES[tile.building].input[r] * 2));
    };
    // A dismantled machine/depot releases the delivery; keep the cargo and find storage.
    if (!destinationAccepts(d) || pathTo(site, c, [d.target]) === null) {
      const depot = site.tiles.filter(t => acceptsShipment(s, c.site, t, c.carry, c) && pathTo(site, c, [xy(t)]) !== null).sort((a, b) => b.storage.priority - a.storage.priority)[0];
      c.delivery = d = depot ? { kind: 'stock', target: xy(depot) } : null;
    }
    if (!d) {
      emitItemMovement(s,c.carry,c.id,{entity:c.id,slot:'carry'},{entity:tileEntityId(site.id,c.x,c.y),slot:'drop'});
      spill(tileAt(site, xy(c)), c.carry); c.carry = null; c.delivery = null; c.intent = null; c.activity = 'Set cargo down; no accepting depot with space';
      return true;
    }
    const result = move(c, site, d.target, pathTo);
    c.activity = result === 'blocked' ? 'Delivery route blocked; holding cargo' : d.kind === 'input' ? 'Delivering machine inputs' : 'Hauling to cargo depot';
    if (result === 'arrived') {
      emitItemMovement(s,c.carry,c.id,{entity:c.id,slot:'carry'},{entity:tileEntityId(site.id,...d.target),slot:d.kind==='input'?'machine.input':d.kind});
      add(buffer(tileAt(site, d.target), d.kind), c.carry); c.carry = null; c.delivery = null; c.intent = null;
      gainExperience(c, 'hauling', 4);
    }
    return true;
  }
  if (!c.labors.hauling) return false;
  if (!c.intent) c.intent = pickHaul(s, c, site, pathTo);
  if (c.intent?.type !== 'haul') return false;
  const intent = c.intent, source = tileAt(site, intent.target), items = buffer(source, intent.source);
  if (!items || !contains(items, intent.items) || !buffer(tileAt(site, intent.destination.target), intent.destination.kind) || (intent.destination.kind === 'stock' && !acceptsShipment(s, c.site, tileAt(site, intent.destination.target), intent.items, c))) { c.intent = null; return true; }
  const rawOnly=intent.destination.kind==='input'&&tileAt(site,intent.destination.target).building==='galley';
  if(rawOnly&&(intent.items.food||0)>rawFood(items)){c.intent=null;return true;}
  const result = move(c, site, intent.target, pathTo); c.activity = 'Collecting reserved shipment';
  if (result === 'arrived') {
    c.carry = extract(items, intent.items, rawOnly); emitItemMovement(s,c.carry,c.id,{entity:tileEntityId(site.id,...intent.target),slot:intent.source==='output'?'machine.output':intent.source},{entity:c.id,slot:'carry'}); c.delivery = intent.destination; c.intent = null;
    if (intent.source === 'drop' && !quantity(source.drop)) source.drop = null;
  } else if (result === 'blocked') { c.intent = null; c.activity = 'Pickup route blocked'; }
  return true;
}
export function spillStorage(t) {
  spill(t, t.sanitary?.output || {}); delete t.sanitary;
  spill(t, t.stock || {});
  if (t.machine) for (const kind of ['input', 'output', 'batch']) spill(t, t.machine[kind]);
  delete t.stock; delete t.storage; delete t.machine;
}
