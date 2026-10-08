import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo } from '../src/simulation.js';
import { add, initializeStorage, totalResources } from '../src/inventory.js';
import { foodLots, foodOfKind, typedFood } from '../src/food-lots.js';
import { haul } from '../src/industry.js';
import { incomingInventory, availableInventory } from '../src/inventory-reservations.js';
import { reserveConstruction, constructionResources, materialsReady, cancelMaterials, fetchMaterials } from '../src/construction.js';
import { setProductionRecipe } from '../src/production.js';
import { updateFood } from '../src/spoilage.js';

const feed = { rawOnly: true, foodKinds: { fungalcap: 1 } };
const mixed = (...inventories) => inventories.reduce((all, inventory) => add(all, inventory), {});
const prepared = (amount, age = 200) => ({ food: amount, _food: [{ amount, age, meal: { id: 'meal-job-999', maker: 'crew-0', quality: 1, created: 0 } }] });
function fixture(recipeId = 'curd_bake') {
  const s = createGame(), site = s.sites.surface;
  s.jobs = [];
  for (const t of site.tiles) {
    if (t.machine) { t.machine.enabled = false; t.machine.input = {}; t.machine.output = {}; t.machine.batch = {}; }
    if (t.stock) t.stock = {};
    if (t.imports) t.imports = {};
    t.drop = null;
  }
  for (const c of s.crew) { c.intent = null; c.carry = null; c.delivery = null; c.x = 8; c.y = 8; c.labors.hauling = true; }
  const depot = at(site, 8, 10), galley = at(site, 12, 10);
  galley.building = 'galley'; galley.hp = 100; delete galley.machine; initializeStorage(galley);
  Object.assign(galley.machine, { recipeId, input: { water: 1 }, order: { mode: 'continuous', limit: 0, remaining: 0, priority: 4 } });
  return { s, site, depot, galley, c: s.crew[0], other: s.crew[1] };
}
function finish(s, site, c) {
  for (let i = 0; i < 40 && (c.intent || c.carry); i++) haul(s, c, site, pathTo);
  assert.equal(c.intent, null, 'pickup finishes within forty calls');
  assert.equal(c.carry, null, 'delivery and recovery finish within forty calls');
}
function careJob(s, materials = {}) {
  const j = { id: 'job-999', kind: 'animalCare', site: 'surface', x: 11, y: 10, cost: { food: 1 }, foodKinds: { fungalcap: 1 }, materials, sources: [], missingFood: 0, foodSpoiled: 0 };
  s.jobs.push(j); return j;
}

test('ingredient claims prevent overdelivery across sources while wrong raw and prepared food remain available', () => {
  const { s, site, depot, galley, c, other } = fixture();
  const extra = at(site, 12, 11); extra.building = 'stockpile'; initializeStorage(extra);
  depot.stock = mixed(typedFood('siltgrain', 6, 120), typedFood('sunberry', 3, 200), prepared(2));
  extra.stock = typedFood('siltgrain', 6, 60);
  galley.machine.input = mixed({ water: 1 }, typedFood('sunberry', 4, 90));
  const before = totalResources(s).food;
  haul(s, c, site, pathTo);
  assert.deepEqual(c.intent.foodKinds, { siltgrain: 2 });
  assert.equal(c.intent.recipeId, 'curd_bake');
  assert.equal(c.intent.destination.recipeId, 'curd_bake');
  assert.equal(incomingInventory(s, 'surface', c.intent.destination, 'food', 'siltgrain'), 2);
  haul(s, other, site, pathTo);
  assert.equal(other.intent, null, 'a second source cannot overpromise the grain requirement');
  finish(s, site, c);
  assert.equal(foodOfKind(galley.machine.input, 'siltgrain'), 2);
  assert.equal(foodOfKind(galley.machine.input, 'sunberry'), 4);
  assert.equal(foodOfKind(galley.machine.input, 'curd'), 0);
  assert.equal(totalResources(s).food, before);
  assert.equal(foodLots(galley.machine.input).find(l => l.kind === 'siltgrain').age, 120);
});

test('selection change cancels unpicked ingredient promises and partially accepts compatible carried lots', () => {
  const { s, site, depot, galley, c, other } = fixture();
  depot.stock = mixed(typedFood('siltgrain', 2, 120), typedFood('curd', 2, 80));
  haul(s, c, site, pathTo); assert.deepEqual(c.intent.foodKinds, { siltgrain: 2, curd: 2 });
  other.carry = mixed(typedFood('siltgrain', 1, 150), typedFood('curd', 1, 170));
  other.delivery = { kind: 'input', target: [galley.x, galley.y], recipeId: 'curd_bake' };
  const before = totalResources(s).food;
  assert.equal(setProductionRecipe(s, 'surface', galley.x, galley.y, 'berry_curd').ok, true);
  assert.equal(c.intent, null);
  finish(s, site, other);
  assert.equal(foodOfKind(galley.machine.input, 'curd'), 1);
  assert.equal(foodOfKind(galley.machine.input, 'siltgrain'), 0);
  assert.equal(foodOfKind(depot.stock, 'siltgrain'), 3);
  assert.equal(foodLots(galley.machine.input).find(l => l.kind === 'curd').age, 170);
  assert.equal(totalResources(s).food, before);
});

test('pickup rechecks kind availability after the promised ingredient disappears', () => {
  const { s, site, depot, c } = fixture('fungal_stew');
  depot.stock = typedFood('fungalcap', 4, 90);
  haul(s, c, site, pathTo); assert.deepEqual(c.intent.foodKinds, { fungalcap: 4 });
  depot.stock = typedFood('sunberry', 4, 70);
  haul(s, c, site, pathTo);
  assert.equal(c.intent, null); assert.equal(c.carry, null);
  assert.equal(foodOfKind(depot.stock, 'sunberry'), 4);
});

test('typed care reservation is atomic, excludes meals and refunds original lots without mass gain', () => {
  const { s, site, depot, c } = fixture();
  depot.stock = mixed(typedFood('sunberry', 3, 200), prepared(2));
  const before = structuredClone(depot.stock);
  assert.equal(constructionResources(s, 'surface', feed).food, 0);
  assert.equal(reserveConstruction(s, 'surface', 11, 10, { food: 1 }, pathTo, feed), null);
  assert.deepEqual(depot.stock, before);
  add(depot.stock, typedFood('fungalcap', 1, 75));
  const foodBefore = totalResources(s).food, j = careJob(s);
  j.sources = reserveConstruction(s, 'surface', 11, 10, j.cost, pathTo, feed);
  assert.equal(foodOfKind(j.sources[0].items, 'fungalcap'), 1);
  assert.equal(materialsReady({ ...j, materials: prepared(1) }), false);
  assert.equal(materialsReady({ ...j, materials: typedFood('sunberry', 1) }), false);
  assert.equal(materialsReady({ ...j, materials: typedFood('fungalcap', 1) }), true);
  c.x = depot.x; c.y = depot.y;
  fetchMaterials(s, c, j, site, pathTo);
  assert.equal(foodOfKind(c.carry, 'fungalcap'), 1);
  cancelMaterials(s, j); s.jobs = [];
  assert.equal(c.delivery, null);
  finish(s, site, c);
  assert.equal(foodLots(depot.stock).find(l => l.kind === 'fungalcap').age, 75);
  assert.equal(totalResources(s).food, foodBefore);
});

test('construction reserves only typed portions left by an earlier generic oldest-first pickup claim', () => {
  const { s, depot, c } = fixture();
  depot.stock = mixed(typedFood('fungalcap', 1, 50), typedFood('sunberry', 1, 100));
  c.intent = { type: 'haul', target: [depot.x, depot.y], source: 'stock', items: { food: 1 }, destination: { kind: 'stock', target: [12, 11] } };
  assert.equal(availableInventory(s, 'surface', [depot.x, depot.y], 'stock', 'food', null, feed), 1);
  const sources = reserveConstruction(s, 'surface', 11, 10, { food: 1 }, pathTo, feed);
  assert.equal(foodOfKind(sources[0].items, 'fungalcap'), 1);
  assert.equal(foodOfKind(depot.stock, 'sunberry'), 1);
  assert.deepEqual(c.intent.items, { food: 1 });
});

test('spoiled fungal care waits for the same ingredient and cancellation returns its aged replacement', () => {
  const { s, site, depot } = fixture();
  depot.stock = mixed(typedFood('sunberry', 3, 80), prepared(1));
  const j = careJob(s, typedFood('fungalcap', 1, 3599.99));
  const before = totalResources(s);
  updateFood(s, pathTo);
  assert.equal(j.missingFood, 1); assert.equal(j.sources.length, 0);
  assert.equal(totalResources(s).food, before.food - 1);
  assert.equal(totalResources(s).waste, before.waste + 1);
  add(depot.stock, typedFood('fungalcap', 1, 240));
  updateFood(s, pathTo);
  assert.equal(j.missingFood, 0); assert.equal(j.sources.length, 1);
  const age = foodLots(j.sources[0].items)[0].age;
  assert.ok(age >= 240);
  cancelMaterials(s, j); s.jobs = [];
  assert.equal(foodLots(depot.stock).find(l => l.kind === 'fungalcap').age, age);
  assert.equal(foodOfKind(depot.stock, 'sunberry'), 3);
  assert.equal(totalResources(s).food, before.food);
});

test('generic care cannot steal the kind promised to an ingredient hauler', () => {
  const { s, depot, c } = fixture();
  depot.stock = mixed(typedFood('fungalcap', 1, 200), typedFood('sunberry', 1, 100));
  c.intent = { type: 'haul', target: [depot.x, depot.y], source: 'stock', items: { food: 1 }, foodKinds: { fungalcap: 1 }, recipeId: 'fungal_stew', destination: { kind: 'input', target: [12, 10], recipeId: 'fungal_stew' } };
  assert.equal(reserveConstruction(s, 'surface', 11, 10, { food: 1 }, pathTo), null);
  assert.equal(reserveConstruction(s, 'surface', 11, 10, { food: 1 }, pathTo, true), null);
  assert.equal(foodOfKind(depot.stock, 'fungalcap'), 1);
  assert.equal(reserveConstruction(s, 'surface', 11, 10, { food: 1 }, pathTo, { rawOnly: true, foodKinds: { sunberry: 1 } })[0].items.food, 1);
});

test('a partly spoiled feed reservation replaces only the missing fungalcap portion', () => {
  const { s, depot } = fixture();
  depot.stock = mixed(typedFood('fungalcap', 1, 240), typedFood('sunberry', 4, 50));
  const j = careJob(s, mixed(typedFood('fungalcap', .25, 3599.99), typedFood('fungalcap', .75, 20)));
  const before = totalResources(s);
  updateFood(s, pathTo);
  assert.equal(j.missingFood, 0);
  assert.equal(j.sources.length, 1);
  assert.equal(foodOfKind(j.sources[0].items, 'fungalcap'), .25);
  assert.equal(foodOfKind(j.materials, 'fungalcap'), .75);
  assert.equal(foodOfKind(depot.stock, 'fungalcap'), .75);
  assert.equal(foodOfKind(depot.stock, 'sunberry'), 4);
  assert.equal(totalResources(s).food, before.food - .25);
  assert.equal(totalResources(s).waste, before.waste + .25);
});
