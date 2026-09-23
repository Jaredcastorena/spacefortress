import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, order, serialize, deserialize, setLabor } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources, quantity } from '../src/inventory.js';
import { setMachineEnabled, spillStorage } from '../src/industry.js';
import { setProductionOrder } from '../src/production.js';
import { refreshPower, setCableEnabled } from '../src/power.js';
import { setDepotAccepted } from '../src/storage.js';
import { FOOD_LIFETIME } from '../src/food-lots.js';

const check = s => deserialize(serialize(s));
const until = (s, predicate, limit = 210) => { for (let i = 0; i < limit && !predicate(); i++) { step(s); check(s); } assert.ok(predicate(), `Condition missing at tick ${s.tick}`); };
function colony({ hauling = false } = {}) {
  const s = createGame(), site = s.sites.surface, depot = at(site, 8, 10), farm = at(site, 7, 9), recycler = at(site, 12, 10);
  setMachineEnabled(s, 'surface', 13, 10, false); setMachineEnabled(s, 'surface', 7, 9, false);
  recycler.building = 'recycler'; initializeStorage(recycler); recycler.cable = { hp: 100, enabled: true }; refreshPower(s, site);
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', hauling));
  return { s, site, depot, farm, recycler, m: recycler.machine };
}

test('starter nutrients fit storage, and a recycler must be constructed from delivered supplies', () => {
  const s = createGame(), site = s.sites.surface, depot = at(site, 8, 10), before = totalResources(s);
  assert.equal(before.fertilizer, 8); assert.ok(quantity(depot.stock) < 320); assert.equal(site.tiles.some(t => t.building === 'recycler'), false);
  assert.equal(order(s, 'surface', 11, 14, 'build', 'recycler').ok, false);
  const result = order(s, 'surface', 12, 10, 'build', 'recycler'); assert.ok(result.ok); assert.equal(totalResources(s).alloy, before.alloy);
  until(s, () => at(site, 12, 10).building === 'recycler'); assert.equal(totalResources(s).alloy, before.alloy - 6); assert.equal(totalResources(s).components, before.components - 1); check(s);
});

test('hydroponics waits for actual fertilizer and keeps its water unspent', () => {
  const { s, farm } = colony(); setMachineEnabled(s, 'surface', 7, 9, true); farm.machine.input.water = 1;
  step(s, 8); assert.equal(farm.machine.progress, 0); assert.equal(farm.machine.input.water, 1); assert.match(farm.machine.status, /fertilizer/);
  farm.machine.input.fertilizer = .25; until(s, () => farm.machine.completed === 1);
  assert.equal(farm.machine.output.food, 2); assert.equal(farm.machine.input.fertilizer, undefined); assert.equal(farm.machine.input.water, undefined);
});

test('recycling needs an adjacent operator and consumes only a complete batch', () => {
  const { s, m } = colony(); m.input = { waste: 1 }; step(s, 5); assert.match(m.status, /water/); assert.equal(m.input.waste, 1);
  m.input.water = .25; s.crew.forEach(c => setLabor(s, c.id, 'production', false)); step(s, 5); assert.equal(m.progress, 0);
  const c = s.crew[6]; setLabor(s, c.id, 'production', true); const before = totalResources(s);
  until(s, () => m.progress > 0); assert.equal(Math.abs(c.x - 12) + Math.abs(c.y - 10), 1); assert.deepEqual(m.batch, { waste: 1, water: .25 });
  until(s, () => m.completed === 1); assert.equal(m.output.fertilizer, .25); assert.equal(totalResources(s).waste, before.waste - 1); assert.equal(totalResources(s).water, before.water - .25); assert.equal(totalResources(s).fertilizer, before.fertilizer + .25);
});

test('fractional fertilizer targets and fixed batches bound deliveries and production', () => {
  const { s, m, depot } = colony({ hauling: true }); depot.stock.fertilizer = 0; depot.stock.waste = 8; syncResources(s);
  setProductionOrder(s, 'surface', 12, 10, 'stock', 1); until(s, () => m.completed === 4); step(s, 12);
  assert.equal(m.completed, 4); assert.equal(totalResources(s).fertilizer, 1); assert.equal(totalResources(s).waste, 4); assert.match(m.status, /Stock target/);
  setProductionOrder(s, 'surface', 12, 10, 'batches', 1); until(s, () => m.completed === 5); step(s, 8); assert.equal(m.completed, 5); assert.equal(m.order.remaining, 0);
});

test('waste is hauled through depot and recycler before fertilizer reaches crops', () => {
  const { s, site, depot, farm, m } = colony({ hauling: true }); depot.stock.fertilizer = 0; at(site, 11, 10).drop = { waste: 1 }; syncResources(s);
  setMachineEnabled(s, 'surface', 7, 9, true); setProductionOrder(s, 'surface', 7, 9, 'batches', 1); setProductionOrder(s, 'surface', 12, 10, 'batches', 1);
  const before = totalResources(s); until(s, () => farm.machine.completed === 1);
  assert.equal(m.completed, 1); assert.equal(totalResources(s).waste, 0); assert.equal(totalResources(s).fertilizer, 0); assert.equal(totalResources(s).food, before.food + 2); assert.equal(totalResources(s).water, before.water - 1.25);
});

test('a broken recycler power connection starves crops; repair resumes the same batch and supply chain', () => {
  const { s, site, depot, farm, m } = colony({ hauling: true }); depot.stock.fertilizer = 0; depot.stock.waste = 1; syncResources(s);
  setMachineEnabled(s, 'surface', 7, 9, true); setProductionOrder(s, 'surface', 7, 9, 'batches', 1); setProductionOrder(s, 'surface', 12, 10, 'batches', 1);
  until(s, () => m.progress > 2); const progress = m.progress, before = totalResources(s);
  setCableEnabled(s, 'surface', 12, 10, false); step(s, 15); assert.equal(m.progress, progress); assert.equal(farm.machine.completed, 0); assert.match(farm.machine.status, /fertilizer/); assert.equal(totalResources(s).waste, before.waste);
  setCableEnabled(s, 'surface', 12, 10, true); until(s, () => farm.machine.completed === 1); assert.equal(m.completed, 1); assert.equal(totalResources(s).fertilizer, 0);
});

test('rejected fertilizer stays physical and blocks crop supplies until storage accepts it', () => {
  const { s, depot, farm, m } = colony({ hauling: true }); depot.stock.fertilizer = 0; depot.stock.waste = 1; syncResources(s);
  setDepotAccepted(s, 'surface', 8, 10, 'fertilizer', false); setMachineEnabled(s, 'surface', 7, 9, true); setProductionOrder(s, 'surface', 12, 10, 'batches', 1);
  until(s, () => m.completed === 1); step(s, 10); assert.equal(m.output.fertilizer, .25); assert.equal(farm.machine.completed, 0);
  setDepotAccepted(s, 'surface', 8, 10, 'fertilizer', true); until(s, () => farm.machine.completed === 1); assert.equal(totalResources(s).fertilizer, 0);
});

test('ordinary and bedside meals retain half the consumed food as recoverable waste', () => {
  for (const bedside of [false, true]) {
    const { s, site } = colony(); const c = s.crew[0]; c.hunger = 10; c.x = 10; c.y = 9;
    if (bedside) { c.medical.servings = 8; c.medical.foodAge = 0; } else c.intent = { type: 'meal', target: null, servings: 8, foodAge: 0 };
    step(s, 8); assert.equal(totalResources(s).waste, .5); assert.equal(c.sanitation.waste, .5); assert.equal(at(site, 10, 9).drop, null); check(s);
  }
});

test('spoiled food can supply recycling without counting it as a meal', () => {
  const { s, depot, m } = colony({ hauling: true }); depot.stock.food = 1; depot.stock._food = [{ amount: 1, age: FOOD_LIFETIME - 1 }]; const before = totalResources(s).fertilizer;
  setProductionOrder(s, 'surface', 12, 10, 'batches', 1); until(s, () => m.completed === 1);
  assert.equal(s.foodSpoiled, 1); assert.equal(totalResources(s).food, 0); assert.equal(totalResources(s).waste, 0); assert.equal(totalResources(s).fertilizer, before + .25);
});

test('dismantling a recycler returns raw unfinished ingredients and finished fertilizer once', () => {
  const { s, recycler, m } = colony(); m.input = { waste: 1, water: .25 }; until(s, () => m.progress > 2); m.output.fertilizer = .25;
  setMachineEnabled(s, 'surface', 12, 10, false); const before = totalResources(s); spillStorage(recycler); recycler.building = null; refreshPower(s, s.sites.surface);
  assert.deepEqual(totalResources(s), before); assert.deepEqual(recycler.drop, { waste: 1, water: .25, fertilizer: .25 }); check(s);
});

test('legacy growing crops retain their inputs and progress, then require nutrients for the next crop', () => {
  const { s, farm, depot } = colony(); setMachineEnabled(s, 'surface', 7, 9, true); farm.machine.batch = { water: 1 }; farm.machine.progress = 11;
  // Model an actual schema-16 save: no fertilizer inventories or new resource filters.
  s.version = 16; delete depot.stock.fertilizer; delete s.resources.fertilizer; depot.storage.accepted = depot.storage.accepted.filter(r => r !== 'fertilizer');
  const copy = check(s), crop = at(copy.sites.surface, 7, 9); assert.equal(crop.machine.progress, 11); assert.equal(crop.machine.legacyCrop, true); assert.equal(totalResources(copy).fertilizer, 0); assert.ok(at(copy.sites.surface, 8, 10).storage.accepted.includes('fertilizer'));
  until(copy, () => crop.machine.completed === 1); assert.equal(crop.machine.output.food, 2); assert.equal(crop.machine.legacyCrop, undefined); crop.machine.input.water = 1; step(copy, 5); assert.match(crop.machine.status, /fertilizer/); assert.equal(crop.machine.completed, 1);
});

test('recycler batches persist deterministically and malformed nutrient batches are rejected', () => {
  const { s, m } = colony(); m.input = { waste: 1, water: .25 }; until(s, () => m.progress > 2); const copy = check(s); step(s, 35); step(copy, 35); assert.deepEqual(copy, s);
  for (const change of [f => f.farm.machine.batch = { water: 1 }, f => f.m.legacyCrop = true, f => f.m.input.fertilizer = 1, f => f.depot.stock.fertilizer = -1]) { const f = colony(); change(f); assert.throws(() => check(f.s)); }
});
