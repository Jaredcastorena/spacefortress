import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, pathTo, order, cancelJob, serialize, deserialize, setLabor, launch } from '../src/simulation.js';
import { add, extract, take, quantity, totalResources, syncResources, initializeStorage } from '../src/inventory.js';
import { foodAge, foodLots, FOOD_LIFETIME } from '../src/food-lots.js';
import { updateFood } from '../src/spoilage.js';
import { haul, spillStorage } from '../src/industry.js';
import { fetchMaterials, deliverMaterials } from '../src/construction.js';
import { injure } from '../src/medicine.js';
import { completeFeeding } from '../src/nursing.js';
import { setClimate, initializeClimate, HEAT_CAPACITY, temperature } from '../src/thermal.js';
import { refreshPower } from '../src/power.js';

function fixture() {
  const s = createGame(), site = s.sites.surface, depot = at(site, 8, 10);
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  refreshPower(s, site); return { s, site, depot, c: s.crew[0] };
}
const aged = (amount, age) => ({ food: amount, _food: [{ amount, age }] });
const check = s => { syncResources(s); return deserialize(serialize(s)); };
const tickFood = s => { updateFood(s, pathTo); check(s); };
function temp(site, value) {
  for (const r of site.rooms) { const heat = (value + 273.15) * HEAT_CAPACITY * r.volume, delta = heat - r.heat; site.thermal[delta >= 0 ? 'added' : 'removed'] += Math.abs(delta); r.heat = heat; }
}
function feedJob(f) {
  const { s, c } = f; injure(s, c, 60, 'test'); c.hunger = 20;
  const result = order(s, 'surface', c.x, c.y, 'feed', c.id); assert.equal(result.ok, true); return result.job;
}

test('oldest lots are consumed first and mixed fresh food never rejuvenates old portions', () => {
  const inventory = aged(2, 3000); add(inventory, { food: 4 });
  assert.equal(quantity(inventory), 6); const shipment = extract(inventory, { food: 3 });
  assert.deepEqual(foodLots(shipment), [{ amount: 2, age: 3000 }, { amount: 1, age: 0 }]);
  assert.equal(inventory.food, 3); assert.equal(foodAge(inventory), 0);
  add(inventory, shipment); assert.equal(inventory.food, 6); assert.equal(foodAge(inventory), 3000);
  take(inventory, { food: 1 }); assert.deepEqual(inventory._food, [{ amount: 1, age: 3000 }]);
});

test('a real haul carries age from a loose pile into a depot without duplicating food', () => {
  const { s, site, depot, c } = fixture(); depot.stock = {}; const pile = at(site, 11, 10); pile.drop = aged(4, 1000);
  const before = totalResources(s).food;
  for (let i = 0; i < 40 && !depot.stock.food; i++) { haul(s, c, site, pathTo); tickFood(s); }
  assert.equal(depot.stock.food, 4); assert.ok(foodAge(depot.stock) > 1000); assert.equal(totalResources(s).food, before);
});

test('cold rooms preserve food and hot rooms accelerate deterioration', () => {
  const cold = fixture(), warm = fixture(), hot = fixture();
  for (const [f, value] of [[cold, -5], [warm, 20], [hot, 50]]) { temp(f.site, value); for (let i = 0; i < 20; i++) tickFood(f.s); }
  assert.ok(Math.abs(foodAge(cold.depot.stock) - 1) < 1e-8); assert.equal(foodAge(warm.depot.stock), 20); assert.equal(foodAge(hot.depot.stock), 80);
});

test('only expired lots become physical waste; fresh portions and depot capacity survive', () => {
  const { s, depot } = fixture(); depot.stock = aged(2, FOOD_LIFETIME - 1); add(depot.stock, { food: 3 });
  const before = quantity(depot.stock); tickFood(s);
  assert.equal(depot.stock.food, 3); assert.equal(depot.stock.waste, 2); assert.equal(quantity(depot.stock), before);
  assert.equal(s.foodSpoiled, 2); assert.equal(foodAge(depot.stock), 1); assert.equal(s.resources.food, 3);
});

test('reserved spoiled food waits for a physical replacement, preserving prior job work', () => {
  const f = fixture(), j = feedJob(f); f.depot.stock.food = 0; delete f.depot.stock._food;
  const source = j.sources.find(source => source.items.food); j.materials = extract(source.items, { food: 1 }); j.materials._food = [{ amount: 1, age: FOOD_LIFETIME - 1 }]; j.remaining = 4;
  tickFood(f.s); assert.equal(j.missingFood, 1); assert.equal(j.foodSpoiled, 1); assert.equal(j.remaining, 4); assert.equal(j.materials.food, undefined);
  add(f.depot.stock, { food: 1 }); tickFood(f.s); assert.equal(j.missingFood, 0); assert.equal(j.remaining, 4); assert.equal(j.materials.food, undefined);
  const medic = f.s.crew[5]; medic.x = 8; medic.y = 10;
  fetchMaterials(f.s, medic, j, f.site, pathTo); assert.equal(medic.carry.food, 1);
  for (let i = 0; i < 20 && medic.carry; i++) deliverMaterials(f.s, medic, f.site, pathTo);
  assert.equal(j.materials.food, 1); assert.equal(j.remaining, 4); check(f.s);
});

test('cancelling after source spoilage never refunds the lost food', () => {
  const f = fixture(), j = feedJob(f); f.depot.stock = {};
  j.sources.find(source => source.items.food).items = aged(1, FOOD_LIFETIME - 1); tickFood(f.s);
  assert.equal(j.missingFood, 1); cancelJob(f.s, j.id); assert.equal(totalResources(f.s).food, 0); assert.equal(totalResources(f.s).waste, 1); check(f.s);
});

test('job cargo can spoil during recovery and its waste stays at the carrier location', () => {
  const f = fixture(), j = feedJob(f), carrier = f.s.crew[5]; f.depot.stock = {};
  const source = j.sources.find(source => source.items.food); carrier.carry = extract(source.items, { food: 1 }); carrier.carry._food = [{ amount: 1, age: FOOD_LIFETIME - 1 }];
  carrier.x = 12; carrier.y = 10; carrier.delivery = { kind: 'job', job: j.id, target: [j.x, j.y] }; carrier.intent = { type: 'rest', target: null };
  tickFood(f.s); assert.equal(carrier.carry, null); assert.equal(carrier.delivery, null); assert.equal(j.missingFood, 1); assert.equal(at(f.site, 12, 10).drop.waste, 1);
});

test('spoilage in a medical batch recovers other ingredients and cannot produce medicine', () => {
  const { s, site } = fixture(), t = at(site, 12, 9); t.building = 'medlab'; initializeStorage(t); refreshPower(s, site);
  t.machine.batch = { ...aged(1, FOOD_LIFETIME - 1), water: 1 }; t.machine.progress = 20;
  tickFood(s); assert.deepEqual(t.machine.batch, {}); assert.equal(t.machine.progress, 0); assert.equal(t.drop.water, 1); assert.equal(t.drop.waste, 1); assert.equal(t.machine.output.medicine, undefined);
});

test('new hydroponic output starts fresh and is aged on following ticks', () => {
  const { s, site } = fixture(), t = at(site, 7, 9); t.machine.enabled = true; t.machine.input.water = 1; t.machine.input.fertilizer = .25;
  for (const c of s.crew) setLabor(s, c.id, 'hauling', false);
  for (let i = 0; i < 70 && !t.machine.output.food; i++) step(s);
  assert.equal(t.machine.output.food, 2); assert.equal(foodAge(t.machine.output), 0); step(s); assert.equal(foodAge(t.machine.output), 1); check(s);
});

test('opened rations inherit age and spoiled remaining portions are not eaten', () => {
  const { s, site, depot, c } = fixture(); depot.stock = aged(1, FOOD_LIFETIME - 3); c.x = 8; c.y = 10; c.hunger = 20;
  step(s); assert.equal(c.intent.servings, 8); assert.equal(c.intent.foodAge, FOOD_LIFETIME - 2);
  step(s); assert.equal(c.intent.servings, 7); const fed = c.hunger;
  step(s); assert.ok(c.hunger < fed); assert.equal(c.intent.servings, 0); assert.equal(totalResources(s).waste, 7 / 8 + 1 / 16); check(s);
});

test('bedside portions retain delivered food age and spoil fractionally', () => {
  const f = fixture(), j = feedJob(f); f.depot.stock = {};
  const source = j.sources.find(source => source.items.food); j.materials = extract(source.items, { food: 1 }); j.materials._food = [{ amount: 1, age: FOOD_LIFETIME - 2 }];
  completeFeeding(f.s, j); f.s.jobs = f.s.jobs.filter(job => job !== j);
  assert.equal(f.c.medical.foodAge, FOOD_LIFETIME - 2); f.c.medical.servings = 5; extract(f.c.medical.openedFood,{food:3/8});
  tickFood(f.s); tickFood(f.s); assert.equal(f.c.medical.servings, 0); assert.equal(totalResources(f.s).waste, 5 / 8);
});

test('shuttle loading and unloading preserve age and spoiled service stores hold departure', () => {
  const { s, site, depot } = fixture(); depot.stock = aged(2, 1000); add(depot.stock, { fuel: 20, air: 160 }); syncResources(s);
  assert.equal(launch(s, 'wreck').ok, true); const j = s.jobs.find(j => j.kind === 'loadShuttle'); assert.ok(j.sources.some(source => foodAge(source.items) >= 1000));
  // Staged service stores retain age when moved aboard.
  for (const source of j.sources) add(s.shuttle.supplies, extract(source.items, { ...Object.fromEntries(Object.entries(source.items).filter(([r]) => r !== '_food')) }));
  s.jobs = s.jobs.filter(job => job !== j); s.shuttle.supplies._food = [{ amount: 2, age: FOOD_LIFETIME - 1 }];
  tickFood(s); assert.equal(s.shuttle.supplies.food, undefined); assert.equal(s.shuttle.supplies.waste, 2);
  step(s); assert.equal(s.mission, null); assert.equal(s.departure.stage, 'loading');
  s.departure = null; spillStorage(depot); depot.building = null; check(s);
});

test('spoilage during orbital transit preserves hold capacity and cargo totals', () => {
  const { s } = fixture(); assert.equal(launch(s, 'wreck').ok, true);
  for (let i = 0; i < 250 && !s.mission; i++) step(s);
  assert.ok(s.mission); s.mission.cargo = aged(4, FOOD_LIFETIME - 1); const before = quantity(s.mission.cargo);
  tickFood(s); assert.equal(quantity(s.mission.cargo), before); assert.equal(s.mission.cargo.waste, 4); assert.equal(s.mission.cargo.food, undefined);
});

test('demolition and cancellation preserve age instead of creating fresh food', () => {
  const f = fixture(); f.depot.stock = aged(3, 2500); const j = feedJob(f);
  cancelJob(f.s, j.id); assert.equal(f.depot.stock.food, 3); assert.equal(foodAge(f.depot.stock), 2500);
  spillStorage(f.depot); f.depot.building = null; assert.equal(foodAge(f.depot.drop), 2500); check(f.s);
});

test('cold-store power failure accelerates aging as exterior heat warms the room', () => {
  const { s, site, depot } = fixture(), t = at(site, 12, 10); t.building = 'climate'; initializeClimate(t); t.cable = { enabled: true, hp: 100 }; refreshPower(s, site);
  assert.equal(setClimate(s, 'surface', 12, 10, -5, true).ok, true); temp(site, -.001); const copy = check(s);
  setClimate(copy, 'surface', 12, 10, -5, false); step(s, 20); step(copy, 20);
  assert.ok(temperature(site.rooms[0]) < 0); assert.ok(temperature(copy.sites.surface.rooms[0]) > 0);
  assert.ok(foodAge(at(copy.sites.surface, 8, 10).stock) > foodAge(depot.stock) * 3); check(s); check(copy);
});

test('aging, pending replacements and waste continue deterministically after saving', () => {
  const f = fixture(), j = feedJob(f); f.depot.stock = {}; j.sources.find(source => source.items.food).items = aged(1, FOOD_LIFETIME - 1); tickFood(f.s);
  const copy = check(f.s); step(f.s, 30); step(copy, 30); assert.deepEqual(copy, f.s); check(f.s);
});

test('version-fifteen migration keeps quantities and paid portions without inventing food', () => {
  const { s, c } = fixture(); const before = totalResources(s); s.version = 15; delete s.foodSpoiled; delete s.resources.waste; c.intent = { type: 'meal', target: null, servings: 4 };
  const copy = deserialize(serialize(s)); assert.equal(copy.version, VERSION); assert.deepEqual(totalResources(copy), before); assert.equal(copy.crew[0].intent.servings, 4); assert.equal(copy.crew[0].intent.foodAge, 0); check(copy);
});

test('invalid lot quantities, ages and replacement records are rejected', () => {
  for (const change of [f => f.depot.stock._food = [{ amount: 100, age: 5 }], f => f.depot.stock._food = [{ amount: 1, age: FOOD_LIFETIME }], f => f.depot.stock._food = [{ amount: -1, age: 2 }], f => f.s.foodSpoiled = -1, f => { const j = feedJob(f); j.missingFood = 1; }, f => f.c.medical.foodAge = FOOD_LIFETIME]) {
    const f = fixture(); change(f); assert.throws(() => check(f.s));
  }
});

test('air emergencies preserve opened portions and death drops uneaten aged rations', () => {
  const f = fixture(), c = f.c; c.x = 16; c.y = 11; c.oxygen = 1; c.intent = { type: 'meal', target: null, servings: 3, foodAge: 100 };
  step(f.s); assert.equal(c.intent.type, 'air'); assert.equal(c.medical.servings, 3); assert.ok(c.medical.foodAge >= 100);
  c.health = 0; step(f.s); assert.equal(c.medical.servings, 0);
  const pile = at(f.site, c.x, c.y).drop; assert.equal(pile.food, 3 / 8); assert.ok(foodAge(pile) >= 100); check(f.s);
});
