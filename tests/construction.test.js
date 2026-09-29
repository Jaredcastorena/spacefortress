import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, setLabor, serialize, deserialize } from '../src/simulation.js';
import { totalResources, syncResources, quantity } from '../src/inventory.js';
import { materialsReady, reservedAt } from '../src/construction.js';
import { spillStorage } from '../src/industry.js';

function colony() {
  const s = createGame(); at(s.sites.surface, 7, 9).machine.enabled = false;
  at(s.sites.surface, 8, 10).stock.components = 4; syncResources(s);
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', false));
  return s;
}
function until(s, predicate, limit = 200) { for (let i = 0; i < limit && !predicate(); i++) step(s); assert.ok(predicate(), 'Condition must be reached within the tick limit'); }
const carrier = (s, j) => s.crew.find(c => c.delivery?.job === j.id);

test('large construction requires multiple physical trips before any building work begins', () => {
  const s = colony(), before = totalResources(s), j = order(s, 'surface', 11, 14, 'build', 'advanced').job;
  let trips = 0, previousCargo = null;
  while (s.jobs.includes(j)) {
    const c = carrier(s, j); if (c && !previousCargo) trips++;
    if (c) { assert.ok(quantity(c.carry) <= 6); assert.equal(j.remaining, j.work); }
    if (!materialsReady(j)) assert.equal(j.remaining, j.work);
    assert.equal(totalResources(s).alloy, before.alloy);
    assert.equal(totalResources(s).components, before.components);
    previousCargo = c?.id; step(s); assert.ok(s.tick < 150);
  }
  assert.equal(trips, 2); assert.equal(at(s.sites.surface, 11, 14).building, 'advanced');
  assert.equal(totalResources(s).alloy, before.alloy - 8); assert.equal(totalResources(s).components, before.components - 4);
});

test('cancelling while materials are carried returns only uncollected supplies immediately', () => {
  const s = colony(), j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  until(s, () => carrier(s, j)); const c = carrier(s, j);
  assert.equal(c.x, 8); assert.equal(c.y, 10); assert.equal(c.carry.alloy, 5);
  cancelJob(s, j.id); assert.equal(c.delivery, null); assert.equal(c.carry.alloy, 5);
  assert.equal(s.resources.alloy, 31); assert.equal(totalResources(s).alloy, 36);
  const copy = deserialize(serialize(s)); step(s, 20); step(copy, 20);
  assert.deepEqual(s, copy); assert.equal(s.resources.alloy, 36); assert.equal(at(s.sites.surface, 11, 14).building, null);
});

test('cancelling after the first delivery leaves those materials at the work site', () => {
  const s = colony(), before = totalResources(s), j = order(s, 'surface', 11, 14, 'build', 'advanced').job;
  until(s, () => quantity(j.materials) > 0);
  assert.equal(j.materials.alloy, 6); assert.equal(j.remaining, j.work);
  cancelJob(s, j.id); assert.equal(at(s.sites.surface, 11, 14).drop.alloy, 6);
  assert.equal(s.resources.alloy, before.alloy - 6); step(s, 5); assert.equal(s.resources.alloy, before.alloy - 6);
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', true)); until(s, () => s.resources.alloy === before.alloy);
  assert.equal(totalResources(s).components, before.components);
});

test('a recovering carrier and a replacement builder share deliveries without duplicated costs', () => {
  const s = colony(), j = order(s, 'surface', 11, 14, 'build', 'advanced').job;
  until(s, () => carrier(s, j)); const tired = carrier(s, j); tired.energy = 1; step(s);
  assert.equal(tired.intent.type, 'rest'); assert.equal(tired.job, null); assert.ok(tired.carry);
  until(s, () => quantity(j.materials) === 6); assert.equal(j.remaining, j.work); assert.ok(tired.carry);
  assert.equal(totalResources(s).alloy, 36); assert.equal(totalResources(s).components, 4);
  const copy = deserialize(serialize(s)); step(s, 160); step(copy, 160);
  assert.deepEqual(s, copy); assert.equal(at(s.sites.surface, 11, 14).building, 'advanced');
  assert.equal(totalResources(s).alloy, 28); assert.equal(totalResources(s).components, 0);
});

test('a route blocked after reservation prevents both pickup and building until reopened', () => {
  const s = colony(), j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  at(s.sites.surface, 10, 12).building = 'wall'; step(s, 20);
  assert.equal(j.worker, null); assert.match(j.blockedReason, /blocked route/); assert.equal(j.remaining, j.work);
  assert.equal(reservedAt(s, 'surface', 8, 10).alloy, 5);
  at(s.sites.surface, 10, 12).building = 'door'; until(s, () => !s.jobs.includes(j));
  assert.equal(at(s.sites.surface, 11, 14).building, 'solar');
});

test('a delivery blocked after pickup holds its cargo and survives a reload', () => {
  const s = colony(), j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  until(s, () => carrier(s, j)); const c = carrier(s, j); at(s.sites.surface, 10, 12).building = 'wall'; step(s, 5);
  assert.match(c.activity, /route blocked/); assert.equal(quantity(j.materials), 0); assert.equal(c.carry.alloy, 5);
  const copy = deserialize(serialize(s));
  for (const state of [s, copy]) { at(state.sites.surface, 10, 12).building = 'door'; step(state, 40); }
  assert.deepEqual(s, copy); assert.equal(at(s.sites.surface, 11, 14).building, 'solar');
});

test('a colony can eat loose rations and rebuild storage after dismantling its last depot', () => {
  const s = colony(), depot = at(s.sites.surface, 8, 10);
  assert.equal(order(s, 'surface', 8, 10, 'remove').ok, true); until(s, () => !depot.building);
  assert.equal(s.resources.alloy, 0); assert.equal(depot.drop.alloy, 37);
  const hungry = s.crew[0]; hungry.hunger = 20; hungry.x = 8; hungry.y = 10;
  const result = order(s, 'surface', 9, 10, 'build', 'stockpile'); assert.equal(result.ok, true);
  until(s, () => at(s.sites.surface, 9, 10).building === 'stockpile');
  until(s, () => hungry.hunger > 90);
  assert.ok(hungry.hunger > 80); assert.equal(depot.drop.food, 23);
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', true)); until(s, () => !depot.drop, 300);
  assert.equal(s.resources.alloy, 35); assert.equal(s.resources.food, 23);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('a dead builder leaves the reserved shipment where another worker can retrieve it', () => {
  const s = colony(), j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  until(s, () => carrier(s, j)); const c = carrier(s, j); c.health = .1; c.hunger = 0;
  step(s); assert.equal(c.health, 0); assert.equal(c.carry, null);
  assert.equal(reservedAt(s, 'surface', c.x, c.y).alloy, 5); assert.equal(totalResources(s).alloy, 36);
  assert.doesNotThrow(() => deserialize(serialize(s)));
  until(s, () => !s.jobs.includes(j)); assert.equal(totalResources(s).alloy, 31);
});

test('cancelled cargo is set down when no depot remains, freeing crew to rebuild storage', () => {
  const s = colony(), depot = at(s.sites.surface, 8, 10); depot.stock = { alloy: 5, food: 20 }; syncResources(s);
  const j = order(s, 'surface', 11, 14, 'build', 'solar').job; until(s, () => carrier(s, j)); const c = carrier(s, j);
  spillStorage(depot); depot.building = null; syncResources(s); cancelJob(s, j.id);
  step(s); assert.equal(c.carry, null); assert.equal(depot.drop.alloy, 5);
  assert.equal(order(s, 'surface', 9, 10, 'build', 'stockpile').ok, true);
  until(s, () => at(s.sites.surface, 9, 10).building === 'stockpile'); assert.equal(totalResources(s).alloy, 3);
});

test('repairs require a delivered alloy unit before restoring condition', () => {
  const s = colony(), tile = at(s.sites.surface, 7, 14); tile.hp = 20;
  const j = order(s, 'surface', 7, 14, 'repair').job;
  until(s, () => carrier(s, j)); assert.equal(tile.hp, 20); assert.equal(j.remaining, j.work);
  until(s, () => !s.jobs.includes(j)); assert.equal(tile.hp, 100); assert.equal(totalResources(s).alloy, 35);
});

test('version-three orders preserve their costs and already completed work during migration', () => {
  const s = colony(), waiting = order(s, 'surface', 11, 14, 'build', 'solar').job;
  const started = order(s, 'surface', 12, 14, 'build', 'solar').job; started.remaining -= 2;
  const before = totalResources(s); s.version = 3;
  for (const j of s.jobs) { delete j.materials; for (const source of j.sources) delete source.kind; }
  const migrated = deserialize(serialize(s));
  assert.equal(migrated.version, VERSION); assert.deepEqual(totalResources(migrated), before);
  assert.deepEqual(migrated.jobs[0].materials, {}); assert.deepEqual(migrated.jobs[1].materials, { alloy: 5 });
  assert.equal(migrated.jobs[1].remaining, started.remaining);
  cancelJob(migrated, waiting.id); cancelJob(migrated, started.id);
  assert.equal(migrated.resources.alloy, 31); assert.equal(at(migrated.sites.surface, 12, 14).drop.alloy, 5);
  assert.deepEqual(totalResources(migrated), before);
});

test('save validation rejects duplicated reservations, missing deliveries and phantom building progress', () => {
  const s = colony(), j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  until(s, () => carrier(s, j)); const saved = serialize(s);
  const reject = mutate => { const copy = JSON.parse(saved); mutate(copy); assert.throws(() => deserialize(JSON.stringify(copy))); };
  reject(copy => copy.jobs[0].sources[0].items.alloy = 5);
  reject(copy => copy.jobs[0].materials.alloy = 5);
  reject(copy => copy.jobs[0].remaining--);
  reject(copy => { const c = copy.crew.find(c => c.carry); c.delivery.job = 'job-9999'; });
  reject(copy => { const c = copy.crew.find(c => c.carry); c.delivery.target = [1, 1]; });
});

test('construction cannot bury loose supplies already reserved by another order', () => {
  const s = colony(), depot = at(s.sites.surface, 8, 10); depot.stock.alloy = 0;
  at(s.sites.surface, 11, 14).drop = { alloy: 5 }; syncResources(s);
  assert.equal(order(s, 'surface', 12, 14, 'build', 'solar').ok, true);
  assert.equal(at(s.sites.surface, 11, 14).drop, null);
  assert.equal(order(s, 'surface', 11, 14, 'build', 'wall').ok, false);
});

test('a hungry hauler can eat a carried ration even when no food store exists', () => {
  const s = colony(), depot = at(s.sites.surface, 8, 10), c = s.crew[0];
  depot.stock = {}; c.carry = { food: 1 }; c.delivery = { kind: 'stock', target: [8, 10] };
  c.hunger = 20; syncResources(s); step(s);
  assert.equal(c.intent.type, 'meal'); assert.equal(c.carry, null); assert.equal(c.delivery, null);
  const copy = deserialize(serialize(s)); step(s, 10); step(copy, 10);
  assert.deepEqual(copy, s); assert.ok(c.hunger > 90); assert.equal(totalResources(s).food, 0);
});

test('changing a builder duty releases work but preserves its in-flight shipment', () => {
  const s = colony(), j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  until(s, () => carrier(s, j)); const c = carrier(s, j);
  setLabor(s, c.id, 'construction', false); assert.equal(c.job, null); assert.equal(j.worker, null);
  assert.equal(c.carry.alloy, 5); assert.equal(c.delivery.job, j.id);
  until(s, () => !s.jobs.includes(j)); assert.equal(totalResources(s).alloy, 31);
  assert.equal(at(s.sites.surface, 11, 14).building, 'solar');
});

test('cancelling a supplied wall repair leaves its alloy on reachable ground beside the wall', () => {
  const s = colony(), wall = at(s.sites.surface, 9, 6); wall.hp = 50;
  const j = order(s, 'surface', 9, 6, 'repair').job;
  until(s, () => materialsReady(j)); cancelJob(s, j.id);
  assert.equal(wall.drop, null); assert.equal(wall.hp, 50); assert.equal(s.resources.alloy, 35);
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', true));
  until(s, () => s.resources.alloy === 36); assert.equal(totalResources(s).alloy, 36);
});
