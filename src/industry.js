import { crewPathToPosition as crewPathTo } from './navigation.js';
import { advanceCrewRoutePositions as advanceCrewRoute } from './crew-traversal.js';
import { shipmentPosition } from './shipment-locations.js';
import { tileAt } from './spatial.js';
import { airlockControlOwner } from './airlock-access.js';
import { rawFood, foodOfKind, planFoodSelection } from './food-lots.js';
import { emitInventoryMovement, tileEntityId } from './telemetry.js';
import { fitAmount } from './item-lots.js';
import { depotUsage, acceptsResource, acceptsShipment } from './storage.js';
import { scheduleProduction, inputBatchesWanted, releaseOperationsAt, recipeFor } from './production.js';
import { refreshPower } from './power.js';
import { RECIPES } from './data.js';
import { add, extract, resourceEntries, contains, quantity, spill, CARRY_CAPACITY } from './inventory.js';
import { gainExperience } from './crew.js';
import { deliverMaterials } from './construction.js';
import { incomingInventory, hasOutgoingInventory, sameInventoryLocation } from './inventory-reservations.js';

export { CARRY_CAPACITY } from './inventory.js';
export { OUTPUT_CAPACITY } from './inventory.js';
const xy = shipmentPosition;
export function buffer(tile, kind) {
  if (!tile) return null;
  if (kind === 'stock') return tile.building === 'stockpile' ? tile.stock : null;
  if (kind === 'imports') return tile.building === 'dock' ? tile.imports : null;
  if (kind === 'drop') return tile.drop;
  if (kind === 'output' && tile.building === 'sanitary') return tile.sanitary?.output;
  return RECIPES[tile.building] ? tile.machine?.[kind] : null;
}
export function updateIndustry(s, roomAt, order) { scheduleProduction(s, order); }
export function setMachineEnabled(s, siteId, x, y, enabled,z=0) {
  const site = s.sites[siteId], t = tileAt(site,{x,y,z});
  if (!t?.machine || !RECIPES[t.building] || typeof enabled !== 'boolean') return { ok: false, message: 'Select a production machine.' };
  if (airlockControlOwner(site, t)) return { ok: false, code: 'airlock_controlled', message: 'This equipment is controlled by its airlock.' };
  t.machine.enabled = enabled; if (!enabled) releaseOperationsAt(s, siteId, x, y, z); t.machine.status = enabled ? 'Waiting to resume' : 'Paused by player'; refreshPower(s, site); return { ok: true };
}

function pickHaul(s, c, site, pathTo) {
  const depots = site.tiles.filter(t => t.building === 'stockpile');
  const claimed = (t, kind) => s.crew.some(o=>o!==c&&o.site===c.site&&o.intent?.keepsake?.source===kind&&sameInventoryLocation(c.site,o.intent.keepsake.target,t)) || hasOutgoingInventory(s, c.site, t, kind, c);
  const candidates = [];
  const offer = (t, kind, items, destination, priority, purpose, foodKinds = undefined) => {
    if (!quantity(items)) return;
    const pickup = crewPathTo(s, site, c, [xy(t)]), delivery = crewPathTo(s, site, t, [destination.target]);
    if (pickup === null || delivery === null) return;
    candidates.push({ priority, purpose, distance: pickup.length + delivery.length, intent: { type: 'haul', target: xy(t), source: kind, items, destination, ...(destination.recipeId ? { recipeId: destination.recipeId } : {}), ...(foodKinds ? { foodKinds } : {}) } });
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
    const recipe = recipeFor(t, 'selected'), m = t.machine;
    if (!recipe || !m?.enabled || !t.hp) continue;
    const destination = { kind: 'input', target: xy(t), ...(recipe.id ? { recipeId: recipe.id } : {}) };
    const claimDestination = { ...destination, target: t };
    const batches = inputBatchesWanted(s, site, t);
    for (const [r, n] of Object.entries(recipe.input)) {
      const delivered = r === 'food' && t.building === 'galley' ? rawFood(m.input) : m.input[r] || 0;
      const needed = n * batches - delivered - incomingInventory(s, c.site, claimDestination, r);
      const neededKinds = r === 'food' && recipe.foodKinds && Object.fromEntries(Object.entries(recipe.foodKinds).map(([kind, amount]) => [kind, Math.max(0, amount * batches - foodOfKind(m.input, kind) - incomingInventory(s, c.site, claimDestination, r, kind))]));
      if (neededKinds ? !Object.values(neededKinds).some(n => n > 1e-9) : needed <= 1e-9 || (recipe.automatic && ['reactor','waterTank','gasTank'].includes(t.building) && needed < n - 1e-9)) continue;
      for (const source of site.tiles) for (const kind of ['stock', 'imports']) {
        const inventory = buffer(source, kind);
        if ((inventory?.[r] || 0) <= 0 || claimed(source, kind)) continue;
        let picked, foodKinds;
        if (neededKinds) {
          foodKinds = {}; let room = CARRY_CAPACITY;
          for (const [foodKind, amount] of Object.entries(neededKinds)) {
            const n = Math.min(amount, foodOfKind(inventory, foodKind), room);
            if (n > 1e-9) { foodKinds[foodKind] = n; room -= n; }
          }
          picked = Object.values(foodKinds).reduce((sum, n) => sum + n, 0);
        } else {
          picked = Math.min(needed, t.building === 'galley' && r === 'food' ? rawFood(inventory) : inventory[r], CARRY_CAPACITY);
          if (t.building === 'galley' && r === 'food' && picked > 0) foodKinds = kindsIn(planFoodSelection(inventory, picked, true));
        }
        offer(source, kind, { [r]: picked }, destination, recipe.lifeSupport || recipe.automatic ? 5 : m.order.priority, 0, foodKinds);
      }
    }
  }
  candidates.sort((a, b) => b.priority - a.priority || a.purpose - b.purpose || a.distance - b.distance);
  return candidates[0]?.intent || null;
}
const kindsIn = lots => (lots || []).reduce((kinds, lot) => { const kind = lot.kind || 'ration'; kinds[kind] = (kinds[kind] || 0) + lot.amount; return kinds; }, {});
// Delivered cargo is physical: after a selection switch, keep only portions
// useful to the new recipe and return the remainder through ordinary hauling.
function inputShipment(s, c, site, tile, cargo) {
  const recipe = recipeFor(tile, 'selected'), store = tile.machine?.input;
  if (!recipe || !store || !tile.hp) return null;
  const destination = { kind: 'input', target: xy(tile), ...(recipe.id ? { recipeId: recipe.id } : {}) };
  const claimDestination = { ...destination, target: tile };
  const items = {}, foodKinds = {};
  for (const [r, n] of resourceEntries(cargo)) {
    if (!recipe.input[r]) continue;
    let picked;
    if (r === 'food' && recipe.foodKinds) {
      for (const [kind, amount] of Object.entries(recipe.foodKinds)) {
        const room = amount * 2 - foodOfKind(store, kind) - incomingInventory(s, c.site, claimDestination, r, kind, c);
        const take = Math.min(foodOfKind(cargo, kind), Math.max(0, room));
        if (take > 1e-9) foodKinds[kind] = take;
      }
      picked = Object.values(foodKinds).reduce((sum, n) => sum + n, 0);
    } else {
      const raw = r === 'food' && tile.building === 'galley';
      const room = recipe.input[r] * 2 - (raw ? rawFood(store) : store[r] || 0) - incomingInventory(s, c.site, claimDestination, r, null, c);
      picked = Math.min(raw ? rawFood(cargo) : n, Math.max(0, room));
    }
    if (picked > 1e-9) items[r] = picked;
  }
  if (!quantity(items)) return null;
  return { items, selector: items.food && tile.building === 'galley' ? recipe.foodKinds ? { rawOnly: true, foodKinds } : true : false };
}
function move(s, c, site, target) { return advanceCrewRoute(s, c, site, [target]).status; }
export function haul(s, c, site, pathTo) {
  if (c.carry) {
    if (c.delivery?.kind === 'job' && deliverMaterials(s, c, site, pathTo)) return true;
    let d = c.delivery;
    const destinationAccepts = d => {
      if (!d) return false;
      const tile = tileAt(site, d.target), store = buffer(tile, d.kind);
      if (!store) return false;
      return d.kind === 'stock' ? acceptsShipment(s, c.site, tile, c.carry, c) : d.kind === 'input' && !!inputShipment(s, c, site, tile, c.carry);
    };
    // A dismantled machine/depot releases the delivery; keep the cargo and find storage.
    if (!destinationAccepts(d) || crewPathTo(s, site, c, [d.target]) === null) {
      const depot = site.tiles.filter(t => acceptsShipment(s, c.site, t, c.carry, c) && crewPathTo(s, site, c, [xy(t)]) !== null).sort((a, b) => b.storage.priority - a.storage.priority)[0];
      c.delivery = d = depot ? { kind: 'stock', target: xy(depot) } : null;
    }
    if (!d) {
      emitInventoryMovement(s,c.carry,c.id,{entity:c.id,slot:'carry'},{entity:tileEntityId(site.id,c.x,c.y,c.z),slot:'drop'});
      spill(tileAt(site, xy(c)), c.carry); c.carry = null; c.delivery = null; c.intent = null; c.activity = 'Set cargo down; no accepting depot with space';
      return true;
    }
    const result = move(s, c, site, d.target, pathTo);
    c.activity = result === 'blocked' ? 'Delivery route blocked; holding cargo' : d.kind === 'input' ? 'Delivering machine inputs' : 'Hauling to cargo depot';
    if (result === 'arrived') {
      const tile = tileAt(site, d.target), selection = d.kind === 'input' ? inputShipment(s, c, site, tile, c.carry) : { items: c.carry, selector: false };
      const cargo = selection && extract(c.carry, selection.items, selection.selector);
      if (cargo) {
        emitInventoryMovement(s,cargo,c.id,{entity:c.id,slot:'carry'},{entity:tileEntityId(site.id,d.target.x,d.target.y,d.target.z),slot:d.kind==='input'?'machine.input':d.kind});
        add(buffer(tile, d.kind), cargo);
      }
      if (!quantity(c.carry)) c.carry = null;
      c.delivery = null; c.intent = null;
      gainExperience(c, 'hauling', 4);
    }
    return true;
  }
  if (!c.labors.hauling) return false;
  if (!c.intent) c.intent = pickHaul(s, c, site, pathTo);
  if (c.intent?.type !== 'haul') return false;
  const intent = c.intent, source = tileAt(site, intent.target), items = buffer(source, intent.source);
  if (!items || !contains(items, intent.items) || !buffer(tileAt(site, intent.destination.target), intent.destination.kind) || (intent.destination.kind === 'stock' && !acceptsShipment(s, c.site, tileAt(site, intent.destination.target), intent.items, c))) { c.intent = null; return true; }
  const target = tileAt(site, intent.destination.target), recipe = intent.destination.kind === 'input' && recipeFor(target, 'selected');
  const rawOnly = intent.destination.kind === 'input' && target.building === 'galley';
  const selector = intent.foodKinds ? { rawOnly: true, foodKinds: intent.foodKinds } : rawOnly;
  if (intent.items.food && !planFoodSelection(items, intent.items.food, selector)) { c.intent = null; return true; }
  if (intent.destination.kind === 'input') {
    if (!recipe || intent.recipeId && intent.recipeId !== recipe.id || recipe.foodKinds && intent.items.food && !intent.foodKinds) { c.intent = null; return true; }
    const selected = inputShipment(s, c, site, target, intent.items.food ? { ...intent.items, _food: planFoodSelection(items, intent.items.food, selector) } : intent.items);
    if (!selected || resourceEntries(intent.items).some(([r, n]) => (selected.items[r] || 0) + 1e-9 < n)) { c.intent = null; return true; }
  }
  const result = move(s, c, site, intent.target, pathTo); c.activity = 'Collecting reserved shipment';
  if (result === 'arrived') {
    c.carry = extract(items, intent.items, selector); emitInventoryMovement(s,c.carry,c.id,{entity:tileEntityId(site.id,intent.target.x,intent.target.y,intent.target.z),slot:intent.source==='output'?(source.building==='sanitary'?'sanitary.output':'machine.output'):intent.source},{entity:c.id,slot:'carry'}); c.delivery = intent.destination; c.intent = null;
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
