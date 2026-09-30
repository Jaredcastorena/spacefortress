import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize, pathTo } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { quantity, totalResources, syncResources } from '../src/inventory.js';
import { itemOwners } from '../src/item-lots.js';
import { foodLots, storeLots, FOOD_LIFETIME, decayRate } from '../src/food-lots.js';
import { foodOwners, updateFood } from '../src/spoilage.js';
import { temperatureAt } from '../src/thermal.js';
import { cargoFree, dockAt, haulSalvage } from '../src/expedition.js';
import { freightStatus } from '../src/freight.js';

const act = (s, id, args = {}) => {
  const result = executeAction(s, id, args, 'test');
  assert.equal(result.ok, true, `${id}: ${result.message}`);
  return result;
};
const tick = s => act(s, 'simulation.step', { ticks: 1 });
const close = (actual, expected, why) => assert.ok(Math.abs(actual - expected) < 1e-8, `${why}: ${actual} != ${expected}`);
const person = (s, id) => s.crew.find(c => c.id === id);
const jobById = (s, id) => s.jobs.find(j => j.id === id);
const carried = (s, id) => s.crew.filter(c => c.delivery?.kind === 'job' && c.delivery.job === id);
const reserved = j => j.sources.reduce((n, source) => n + quantity(source.items), 0);
function until(s, predicate, reason, limit = 250, invariant = () => {}) {
  for (let i = 0; i < limit && !predicate(); i++) { tick(s); invariant(); }
  assert.ok(predicate(), `${reason}; tick ${s.tick}; ${JSON.stringify(s.jobs.map(j => ({ kind: j.kind, blocked: j.blockedReason, remaining: j.remaining })))}`);
}
function reload(s) {
  const text = serialize(s), restored = deserialize(text);
  assert.equal(serialize(restored), text, 'save/load cannot normalize away a material owner');
  return restored;
}
function colony() {
  const s = createGame();
  // Shared controls isolate freight from unrelated production and hauling;
  // every resource, worker and route still comes from the real new colony.
  for (const tile of s.sites.surface.tiles) if (tile.machine && tile.building !== 'scrubber')
    act(s, 'production.enable', { site: 'surface', x: tile.x, y: tile.y, enabled: false });
  for (const c of s.crew) {
    act(s, 'crew.labor', { crew: c.id, labor: 'hauling', enabled: c.id === 'crew-4' });
    act(s, 'crew.possessions.collect', { crew: c.id, enabled: false });
  }
  return s;
}
function load(s, items) { return act(s, 'freight.load', { items }).job; }
function unload(s, site, items) { return act(s, 'freight.unload', { site, ...(items ? { items } : {}) }).job; }
function finishJob(s, id, invariant) { until(s, () => !jobById(s, id), 'freight work completes physically', 250, invariant); }
function arrive(s) {
  act(s, 'expedition.launch', { site: 'wreck', crewIds: ['crew-2', 'crew-4'] });
  until(s, () => s.mission?.phase === 'working', 'ordinary loaded flight reaches wreck', 350);
  assert.ok(['crew-2', 'crew-4'].every(id => person(s, id).site === 'wreck'));
  return dockAt(s.sites.wreck);
}
function loaded(items = { alloy: 14 }) {
  const s = colony(), id = load(s, items);
  finishJob(s, id);
  return s;
}
function assertOwners(s) {
  const owners = itemOwners(s);
  assert.equal(new Set(owners.map(owner => owner.inventory)).size, owners.length, 'no two physical slots alias an inventory');
  const ids = owners.flatMap(owner => owner.inventory._items || []).map(item => item.id);
  assert.equal(new Set(ids).size, ids.length, 'item IDs belong to one physical owner');
}

test('real depot shipment crosses reservation, multiple carries and staging once before entering freight', () => {
  const s = colony(), depot = at(s.sites.surface, 8, 10), before = totalResources(s).alloy;
  const stock = depot.stock.alloy, id = load(s, { alloy: 14 });
  assert.equal(depot.stock.alloy, stock - 14);
  assert.equal(reserved(jobById(s, id)), 14);
  assert.deepEqual(s.shuttle.freight, {});
  const stages = new Set();
  const invariant = () => {
    close(totalResources(s).alloy, before, 'alloy is owned, never spent by loading');
    assertOwners(s);
    const j = jobById(s, id);
    if (j) {
      const held = carried(s, id).reduce((n, c) => n + (c.carry.alloy || 0), 0);
      close(reserved(j) + held + quantity(j.materials), 14, 'requested amount has exactly one job owner');
      if (held) stages.add('carry');
      if (j.materials.alloy && reserved(j)) stages.add('partial staging');
      assert.deepEqual(s.shuttle.freight, {}, 'work and staged goods do not already count as loaded');
    }
  };
  finishJob(s, id, invariant);
  assert.deepEqual([...stages].sort(), ['carry', 'partial staging']);
  assert.deepEqual(s.shuttle.freight, { alloy: 14 });
  assert.deepEqual(s.shuttle.supplies, {}, 'freight does not silently populate service stores');
  close(totalResources(s).alloy, before, 'completed loading retains all alloy');
  reload(s);
});

test('cancelling a partially loaded shipment recovers unfetched, carried and staged stock without duplication', () => {
  const s = colony(), before = totalResources(s).alloy, id = load(s, { alloy: 14 });
  until(s, () => jobById(s, id)?.materials.alloy === 6 && carried(s, id).length === 1,
    'one delivered parcel and another real parcel in hand');
  const j = jobById(s, id), carrier = carried(s, id)[0], held = carrier.carry.alloy;
  const pending = reserved(j), depot = at(s.sites.surface, 8, 10), stock = depot.stock.alloy;
  act(s, 'job.cancel', { job: id });
  assert.equal(depot.stock.alloy, stock + pending, 'only untouched reservation returns to depot');
  assert.equal(at(s.sites.surface, 16, 11).drop.alloy, 6, 'delivered freight remains on the actual terminal floor');
  assert.equal(carrier.carry.alloy, held, 'held parcel stays with its carrier');
  assert.equal(carrier.delivery, null);
  assert.deepEqual(s.shuttle.freight, {});
  close(totalResources(s).alloy, before, 'cancellation preserves all three material states');
  const saved = serialize(s);
  assert.equal(executeAction(s, 'job.cancel', { job: id }, 'test').ok, false);
  assert.equal(serialize(s), saved, 'repeated cancellation cannot refund again');
  assertOwners(s); reload(s);
});

test('real loaded freight survives flight and partial unload cancellation restores only goods still aboard', () => {
  const s = loaded(), before = totalResources(s).alloy, dock = arrive(s);
  const supplies = structuredClone(s.shuttle.supplies), id = unload(s, 'wreck');
  assert.deepEqual(s.shuttle.freight, {}, 'unload reservation becomes a job owner, not a second copy');
  assert.deepEqual(dock.imports, {}, 'planning never delivers imports');
  until(s, () => jobById(s, id)?.materials.alloy === 6 && carried(s, id).length === 1,
    'unloader stages one parcel and carries the next');
  const j = jobById(s, id), pending = reserved(j), carrier = carried(s, id)[0], held = carrier.carry.alloy;
  act(s, 'job.cancel', { job: id });
  assert.deepEqual(s.shuttle.freight, { alloy: pending });
  assert.equal(dock.drop.alloy, 6);
  assert.equal(carrier.carry.alloy, held);
  assert.deepEqual(dock.imports, {});
  for (const resource of ['fuel', 'air']) close(s.shuttle.supplies[resource], supplies[resource], `unload cannot spend service ${resource}`);
  close(totalResources(s).alloy, before, 'flight and cancelled unload retain all alloy');
  assertOwners(s); reload(s);
});

test('completed imports pay only the local construction cost and leave surface stock untouched', () => {
  const s = loaded({ alloy: 8 }), dock = arrive(s), before = totalResources(s).alloy;
  const surfaceStock = at(s.sites.surface, 8, 10).stock.alloy;
  const id = unload(s, 'wreck'); finishJob(s, id);
  assert.deepEqual(s.shuttle.freight, {});
  assert.deepEqual(dock.imports, { alloy: 8 });
  const build = act(s, 'job.order', { site: 'wreck', x: 3, y: 11, kind: 'build', building: 'floor' }).job;
  assert.deepEqual(jobById(s, build).sources, [{ x: dock.x, y: dock.y, kind: 'imports', items: { alloy: 1 } }]);
  assert.equal(dock.imports.alloy, 7);
  close(totalResources(s).alloy, before, 'local reservation has not spent material');
  until(s, () => !jobById(s, build), 'real local construction consumes imported parcel');
  assert.equal(at(s.sites.wreck, 3, 11).terrain, 'floor');
  assert.equal(dock.imports.alloy, 7);
  assert.equal(at(s.sites.surface, 8, 10).stock.alloy, surfaceStock);
  close(totalResources(s).alloy, before - 1, 'one built floor has exactly one paid alloy');
  assertOwners(s); reload(s);
});

test('recall during a pending unload preserves intact freight and cancels the reservation before departure', () => {
  const s = loaded({ alloy: 10 }), dock = arrive(s), before = totalResources(s).alloy;
  const id = unload(s, 'wreck'), fuel = s.shuttle.supplies.fuel;
  assert.equal(reserved(jobById(s, id)), 10);
  act(s, 'expedition.recall');
  assert.equal(jobById(s, id), undefined);
  assert.deepEqual(s.shuttle.freight, { alloy: 10 });
  assert.deepEqual(dock.imports, {});
  assert.equal(s.shuttle.supplies.fuel, fuel, 'return fuel is spent only at actual takeoff');
  close(totalResources(s).alloy, before, 'recall cancellation cannot lose reserved freight');
  until(s, () => !s.mission, 'return carries the same durable freight home', 150);
  assert.deepEqual(s.shuttle.freight, { alloy: 10 });
  close(totalResources(s).alloy, before, 'arrival does not duplicate or auto-dump freight');
  const second = unload(s, 'surface', { alloy: 3 }); finishJob(s, second);
  assert.deepEqual(s.shuttle.freight, { alloy: 7 });
  close(totalResources(s).alloy, before, 'surface unload remains physical inventory');
  assertOwners(s); reload(s);
});

test('a dead remote carrier leaves one dropped parcel while safety recall restores only untouched freight', () => {
  const s = loaded({ alloy: 10 }), dock = arrive(s), before = totalResources(s).alloy, id = unload(s, 'wreck');
  until(s, () => carried(s, id).length === 1, 'real unload pickup');
  const carrier = carried(s, id)[0], amount = carrier.carry.alloy, place = [carrier.x, carrier.y];
  // Controlled failure of a real in-flight parcel; no resources are granted.
  carrier.health = 0;
  tick(s);
  assert.equal(carrier.carry, null);
  assert.equal(carrier.delivery, null);
  assert.equal(jobById(s, id), undefined, 'dead expedition member triggers safety recall and cancellation');
  assert.equal(s.mission.phase, 'boarding');
  assert.equal(at(s.sites.wreck, ...place).drop.alloy, amount);
  assert.equal(s.shuttle.freight.alloy, 10 - amount);
  close(totalResources(s).alloy, before, 'death moves rather than copies the held parcel');
  assert.deepEqual(dock.imports, {});
  assertOwners(s); reload(s);
});

test('a dead surface loader leaves a valid recoverable reservation that another worker completes once', () => {
  const s = colony(), before = totalResources(s).alloy, id = load(s, { alloy: 10 });
  until(s, () => carried(s, id).length === 1, 'real surface freight pickup');
  const carrier = carried(s, id)[0], amount = carrier.carry.alloy, place = [carrier.x, carrier.y];
  carrier.health = 0; tick(s);
  assert.equal(carrier.carry, null);
  assert.equal(carrier.delivery, null);
  assert.ok(jobById(s, id).sources.some(source => source.kind === 'drop' && source.x === place[0] && source.y === place[1] && source.items.alloy === amount));
  close(totalResources(s).alloy, before, 'death creates one recoverable owner');
  assertOwners(s); reload(s);
  act(s, 'crew.labor', { crew: 'crew-2', labor: 'hauling', enabled: true });
  finishJob(s, id);
  assert.deepEqual(s.shuttle.freight, { alloy: 10 });
  close(totalResources(s).alloy, before, 'replacement worker completes the same paid shipment');
  assertOwners(s); reload(s);
});

test('save and reload at a real held-unload boundary continue to exactly one identical delivery', () => {
  const s = loaded({ alloy: 10 }), dock = arrive(s), before = totalResources(s).alloy, id = unload(s, 'wreck');
  until(s, () => carried(s, id).length === 1, 'parcel is held before saving');
  const restored = reload(s);
  for (let i = 0; i < 100 && jobById(s, id); i++) {
    tick(s); tick(restored);
    assert.equal(serialize(restored), serialize(s), `continuation differs at tick ${s.tick}`);
    close(totalResources(s).alloy, before, 'original owns exactly one shipment');
    close(totalResources(restored).alloy, before, 'restored owns exactly one shipment');
  }
  assert.equal(jobById(s, id), undefined);
  assert.deepEqual(dock.imports, { alloy: 10 });
  assert.deepEqual(dockAt(restored.sites.wreck).imports, { alloy: 10 });
  assertOwners(s); assertOwners(restored);
});

test('broken and absent remote docks cannot finish pending freight or erase its owners', () => {
  for (const failure of ['broken', 'missing']) {
    const s = loaded({ alloy: 8 }), dock = arrive(s), before = totalResources(s).alloy, id = unload(s, 'wreck');
    if (failure === 'broken') dock.hp = 0;
    else { dock.building = null; delete dock.imports; }
    for (let i = 0; i < 4; i++) {
      tick(s);
      close(totalResources(s).alloy, before, `${failure} dock retains shipment`);
      assert.equal(dock.imports?.alloy || 0, 0, 'unusable terminal cannot credit imports');
      assertOwners(s);
    }
    if (jobById(s, id)) act(s, 'job.cancel', { job: id });
    close(totalResources(s).alloy, before, `${failure} dock cancellation preserves every parcel`);
    assert.equal(dock.building, failure === 'broken' ? 'dock' : null, 'handling freight cannot fabricate a replacement dock');
    assertOwners(s);
  }
});

test('pending full-hold freight blocks another shipment, launch and refit without duplicate reservations', () => {
  const s = colony(), before = totalResources(s).alloy, id = load(s, { alloy: 18 });
  until(s, () => carried(s, id).length === 1, 'full request is partly carried');
  for (const [action, args] of [
    ['freight.load', { items: { alloy: 1 } }],
    ['expedition.launch', { site: 'wreck', crewIds: ['crew-2', 'crew-4'] }],
    ['job.order', { site: 'surface', x: 16, y: 11, kind: 'refit', building: 'cargo' }]
  ]) {
    const saved = serialize(s);
    assert.equal(executeAction(s, action, args, 'test').ok, false, `${action} must respect occupied terminal`);
    assert.equal(serialize(s), saved);
  }
  finishJob(s, id);
  assert.deepEqual(s.shuttle.freight, { alloy: 18 });
  const saved = serialize(s);
  assert.equal(executeAction(s, 'freight.load', { items: { alloy: .5 } }, 'test').ok, false);
  assert.equal(serialize(s), saved);
  const refit = executeAction(s, 'job.order', { site: 'surface', x: 16, y: 11, kind: 'refit', building: 'shield' }, 'test');
  assert.equal(refit.ok, false);
  assert.equal(refit.reason, 'freight_capacity', 'actual onboard freight must fit the replacement hold');
  assert.equal(serialize(s), saved);
  close(totalResources(s).alloy, before, 'capacity checks do not spend or reserve rejected requests');
  reload(s);
});

test('a real crafted item and aged prepared food keep metadata through actual freight jobs and reload', () => {
  const s = colony(), depot = at(s.sites.surface, 8, 10), before = totalResources(s);
  for (const c of s.crew) act(s, 'crew.labor', { crew: c.id, labor: 'production', enabled: c.id === 'crew-6' });
  const build = act(s, 'job.order', { site: 'surface', x: 13, y: 8, kind: 'build', building: 'artisan' }).job;
  until(s, () => !jobById(s, build), 'craft workstation is paid and physically constructed');
  act(s, 'production.order', { site: 'surface', x: 13, y: 8, mode: 'batches', limit: 1 });
  until(s, () => depot.stock.keepsakes === 1, 'paid artisan recipe produces and hauls an actual item');
  close(totalResources(s).alloy, before.alloy - 8, 'workstation and recipe consume their real alloy');
  close(totalResources(s).components, before.components - 2, 'workstation and recipe consume their real components');
  const item = structuredClone(depot.stock._items[0]);
  // Isolated age/quality boundary on two existing rations, without adding food.
  const meal = { id: `meal-job-${s.nextId++}`, maker: 'crew-6', quality: 2, created: s.tick };
  storeLots(depot.stock, [{ amount: 2, age: 1200, meal }]);
  const id = load(s, { food: 2, keepsakes: 1 });
  finishJob(s, id);
  assert.deepEqual(s.shuttle.freight._items, [item]);
  assert.equal(foodLots(s.shuttle.freight)[0].meal.id, meal.id);
  assert.ok(foodLots(s.shuttle.freight)[0].age > 1200);
  const dock = arrive(s), next = unload(s, 'wreck');
  until(s, () => carried(s, next).length === 1, 'metadata-bearing parcel is physically picked up');
  const carrier = carried(s, next)[0], inventory = carrier.carry;
  const oldLots = foodLots(inventory), place = foodOwners(s).find(owner => owner.inventory === inventory).place;
  const rate = decayRate(place ? temperatureAt(place.site, place.x, place.y) : 20);
  updateFood(s, pathTo); syncResources(s);
  assert.deepEqual(foodLots(inventory), oldLots.map(lot => ({ ...lot, age: lot.age + rate })), 'held food ages exactly once at its physical location');
  assert.deepEqual(inventory._items, [item]);
  assertOwners(s); reload(s);
  finishJob(s, next);
  assert.deepEqual(dock.imports._items, [item]);
  assert.equal(dock.imports.keepsakes, 1);
  assert.equal(dock.imports.food, 2);
  assert.deepEqual(foodLots(dock.imports)[0].meal, meal);
  assert.ok(foodLots(dock.imports)[0].age >= oldLots[0].age + rate);
  assert.deepEqual(s.shuttle.freight, {});
  assertOwners(s); reload(s);
});

test('spoiled reserved unload food becomes located waste and cannot refill itself from distant surface stores', () => {
  const s = loaded({ food: 2 }), dock = arrive(s);
  storeLots(s.shuttle.freight, [{ amount: 2, age: FOOD_LIFETIME - .001 }]);
  const before = totalResources(s), stock = at(s.sites.surface, 8, 10).stock.food;
  const id = unload(s, 'wreck', { food: 1 });
  updateFood(s, pathTo); syncResources(s);
  const j = jobById(s, id);
  assert.equal(j.missingFood, 1);
  assert.equal(j.foodSpoiled, 1);
  assert.equal(dock.drop.waste, 1, 'reserved food was physically at the dock');
  assert.equal(s.shuttle.freight.waste, 1, 'unreserved onboard food spoils in its own owner');
  assert.equal(at(s.sites.surface, 8, 10).stock.food, stock, 'local replacement cannot reserve remote stock');
  close(totalResources(s).food, before.food - 2, 'two expired rations leave the food ledger');
  close(totalResources(s).waste, before.waste + 2, 'both expired rations remain as real waste');
  assert.deepEqual(dock.imports, {});
  assertOwners(s); reload(s);
  act(s, 'job.cancel', { job: id });
  close(totalResources(s).food + totalResources(s).waste, before.food + before.waste, 'cancellation cannot refund spoiled food');
  reload(s);
});

test('reserved freight and a genuine salvage pickup share one hold without counting local freight carry twice', () => {
  const s = loaded({ alloy: 17 }), dock = arrive(s), site = s.sites.wreck;
  act(s, 'crew.labor', { crew: 'crew-4', labor: 'hauling', enabled: false });
  const mine = act(s, 'job.order', { site: 'wreck', x: 8, y: 10, kind: 'mine' }).job;
  until(s, () => !jobById(s, mine), 'actual wreck salvage is mined');
  const total = totalResources(s), pile = at(site, 8, 10);
  assert.deepEqual(pile.drop, { components: 3, alloy: 2 });
  act(s, 'crew.labor', { crew: 'crew-4', labor: 'hauling', enabled: true });
  act(s, 'crew.labor', { crew: 'crew-2', labor: 'hauling', enabled: true });
  const id = unload(s, 'wreck'), miner = person(s, 'crew-2');
  assert.equal(cargoFree(s), 1);
  // This is the production hauling routine, starting from the real mined pile
  // and the crew's actual position, while the unload reservation remains aboard.
  assert.equal(haulSalvage(s, miner, site, pathTo), true);
  const claimed = miner.carry || miner.intent?.items;
  assert.equal(quantity(claimed), 1, 'freight commitment leaves one salvage slot');
  assert.equal(cargoFree(s), 0);
  assert.equal(freightStatus(s, 'wreck').reserved, 17);
  assert.equal(freightStatus(s, 'wreck').claimed, 1);
  until(s, () => carried(s, id).length === 1, 'unloader physically carries committed freight');
  assert.equal(freightStatus(s, 'wreck').reserved, 17, 'held job parcel is not an additional shuttle claim');
  assert.equal(cargoFree(s), 0);
  close(totalResources(s).alloy, total.alloy, 'unloading and salvage conserve alloy');
  close(totalResources(s).components, total.components, 'unloading and salvage conserve components');
  assertOwners(s); reload(s);
  finishJob(s, id);
  assert.equal(dock.imports.alloy, 17);
  close(totalResources(s).alloy, total.alloy, 'completed landing keeps its own seventeen units');
  close(totalResources(s).components, total.components, 'salvage and landing retain separate inventories');
  assert.ok(quantity(s.mission.cargo) <= 5);
});

test('freight fuel and packaged air unload without drawing on protected flight service stores', () => {
  const s = loaded({ fuel: 3, air: 5 }), dock = arrive(s), service = structuredClone(s.shuttle.supplies);
  assert.ok(service.fuel >= s.mission.returnFuel);
  const id = unload(s, 'wreck', { fuel: 3, air: 5 }); finishJob(s, id);
  assert.deepEqual(dock.imports, { fuel: 3, air: 5 });
  assert.deepEqual(s.shuttle.supplies, service, 'freight bookkeeping cannot raid the independent service reserve');
  const saved = serialize(s);
  assert.equal(executeAction(s, 'freight.unload', { site: 'wreck', items: { fuel: service.fuel } }, 'test').ok, false);
  assert.equal(serialize(s), saved, 'service fuel cannot satisfy a missing freight request');
  assertOwners(s); reload(s);
});

test('read-only freight status repeatedly reports detached snapshots without creating material owners', () => {
  const s = colony(), id = load(s, { alloy: 10 });
  until(s, () => carried(s, id).length === 1, 'real parcel held for preview');
  const saved = serialize(s), total = totalResources(s), preview = freightStatus(s, 'surface');
  assert.equal(preview.reserved, 10); assert.equal(preview.free, 8);
  preview.onboard.alloy = 999; preview.salvage.components = 999;
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(freightStatus(s, 'surface').onboard, {});
    assert.equal(serialize(s), saved);
    assert.deepEqual(totalResources(s), total);
  }
});

test('a hungry freight carrier cannot silently eat a reserved ration and invalidate its work order', () => {
  const s = colony(), id = load(s, { food: 2 });
  until(s, () => carried(s, id).length === 1, 'real food parcel is held');
  const carrier = carried(s, id)[0], before = totalResources(s).food;
  carrier.hunger = 9; tick(s);
  const j = jobById(s, id);
  const owned = (j.materials.food || 0) + j.sources.reduce((n, source) => n + (source.items.food || 0), 0) + carried(s, id).reduce((n, c) => n + (c.carry?.food || 0), 0);
  const opened = s.crew.reduce((n, c) => n + (c.medical.servings || 0) / 8 + (c.intent?.type === 'meal' ? c.intent.servings || 0 : 0) / 8, 0);
  close(totalResources(s).food + opened, before, 'opening a meal is a transfer into portions, not unexplained food loss');
  close(owned + j.missingFood, 2, 'recovery preserves or explicitly replaces every reserved ration');
  assertOwners(s); reload(s);
});

test('a route blocked after pickup retains the held parcel and pending reservation until cancellation', () => {
  const s = colony(), id = load(s, { alloy: 8 }), before = totalResources(s).alloy;
  until(s, () => carried(s, id).length === 1, 'real parcel collected before obstruction');
  const carrier = carried(s, id)[0], held = structuredClone(carrier.carry), pending = reserved(jobById(s, id));
  // Controlled route failure, independent of construction/maintenance costs.
  for (const [x, y] of [[15, 11], [17, 11], [16, 10], [16, 12]]) {
    const tile = at(s.sites.surface, x, y); tile.building = 'wall'; tile.hp = 100;
  }
  for (let i = 0; i < 3; i++) {
    tick(s);
    assert.deepEqual(carrier.carry, held, 'blocked carrier does not discard or deliver through a wall');
    assert.equal(reserved(jobById(s, id)), pending);
    assert.deepEqual(s.shuttle.freight, {});
    close(totalResources(s).alloy, before, 'blocked route keeps every parcel finite');
  }
  act(s, 'job.cancel', { job: id });
  assert.deepEqual(carrier.carry, held);
  assert.equal(carrier.delivery, null);
  close(totalResources(s).alloy, before, 'cancelling inaccessible work restores only untouched source goods');
  assertOwners(s); reload(s);
});
