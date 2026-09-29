import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo } from '../src/simulation.js';
import { add, extract, quantity, totalResources } from '../src/inventory.js';
import { itemOwners } from '../src/item-lots.js';
import { foodLots, storeLots, decayRate } from '../src/food-lots.js';
import { foodOwners, updateFood, validateFood } from '../src/spoilage.js';
import { validatePossessions } from '../src/possessions.js';
import { observe } from '../src/telemetry.js';
import { temperatureAt } from '../src/thermal.js';
import { cargoFree, validateShuttle } from '../src/expedition.js';

// Phase one has no freight actions. These fixtures isolate the new physical
// owners and exercise the existing transfer, aging and observation functions.
function fixture() {
  const s = createGame();
  s.shuttle.freight = {};
  for (const site of Object.values(s.sites)) for (const tile of site.tiles) {
    if (tile.building === 'dock') tile.imports = {};
  }
  return { s, depot: at(s.sites.surface, 8, 10), dock: s.sites.wreck.tiles.find(t => t.building === 'dock') };
}
function payload(s) {
  const meal = { id: `meal-job-${s.nextId++}`, maker: s.crew[0].id, quality: 3, created: s.tick };
  const items = [0, 1].map(() => ({ id: `item-${s.nextItemId++}`, maker: s.crew[0].id, style: 'art', quality: 2, created: s.tick }));
  const inventory = { food: 3.25, keepsakes: 2, _items: items };
  storeLots(inventory, [{ amount: 1.5, age: 310.5, meal }, { amount: 1.75, age: 80.25 }]);
  return { inventory, meal, items };
}
const ownerKey = owner => `${owner.location.entity}/${owner.location.slot}`;
function lotsInWorld(s) {
  const lots = new Map();
  for (const { inventory } of itemOwners(s)) for (const lot of foodLots(inventory)) {
    const key = JSON.stringify([lot.age, lot.meal || null]);
    lots.set(key, (lots.get(key) || 0) + lot.amount);
  }
  return [...lots.entries()].sort(([a], [b]) => a.localeCompare(b));
}
function identities(s) {
  return itemOwners(s).flatMap(o => o.inventory._items || []).map(item => item.id).sort();
}
function move(source, destination, requested) {
  const shipment = extract(source, requested);
  assert.ok(shipment, 'a transfer must debit an actual source');
  add(destination, shipment);
  return shipment;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test('freight, imports at every dock and service stores are distinct owners counted once', () => {
  const { s } = fixture(), before = totalResources(s);
  s.shuttle.freight = { alloy: 2, food: .5 };
  s.shuttle.supplies = { fuel: 7, food: 3, air: 11 };
  const docks = Object.values(s.sites).flatMap(site => site.tiles.filter(t => t.building === 'dock').map(t => ({ site, t })));
  for (const [i, { t }] of docks.entries()) t.imports = { alloy: i + 1 };
  const owners = itemOwners(s), freight = owners.filter(o => ownerKey(o) === 'colony/shuttle.freight');
  assert.equal(freight.length, 1);
  assert.equal(freight[0].inventory, s.shuttle.freight);
  assert.equal(owners.filter(o => ownerKey(o) === 'colony/shuttle.supplies').length, 1);
  for (const { site, t } of docks) {
    const matches = owners.filter(o => ownerKey(o) === `tile:${site.id}:${t.x}:${t.y}/imports`);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].inventory, t.imports);
    assert.equal(foodOwners(s).filter(o => o.inventory === t.imports).length, 1);
  }
  assert.equal(foodOwners(s).filter(o => o.inventory === s.shuttle.freight).length, 1);
  assert.equal(new Set(owners.map(o => o.inventory)).size, owners.length, 'physical owners cannot share an inventory object');
  assert.deepEqual(totalResources(s), {
    ...before, alloy: before.alloy + 2 + docks.reduce((n, _, i) => n + i + 1, 0),
    food: before.food + 3.5, fuel: before.fuel + 7, air: before.air + 11
  });
  assert.equal(quantity(s.shuttle.freight), 2.5, 'service provisions are not stored inside freight');
});

test('in-transit freight and salvage share hold space while service stores remain separately owned', () => {
  const { s } = fixture(), before = totalResources(s), crew = s.crew.slice(0, 2);
  for (const c of crew) c.site = 'transit';
  s.mission = {
    site: 'wreck', phase: 'outbound', remaining: 1, fit: 'standard', capacity: 18,
    legacyCapacity: false, crew: crew.map(c => c.id), returnCrew: crew.map(c => c.id),
    cargo: { food: 3 }, collector: false, heat: 0, returnFuel: 1, kitReserved: false
  };
  s.shuttle.freight = { food: 2 };
  s.shuttle.supplies = { food: 5, fuel: 20, air: 100 };
  const inventories = [s.shuttle.freight, s.mission.cargo, s.shuttle.supplies];
  for (const inventory of inventories) storeLots(inventory, [{ amount: inventory.food, age: 90 }]);
  const loaded = structuredClone(s);
  for (let i = 0; i < 3; i++) {
    assert.equal(cargoFree(s), 13, 'flight provisions must not occupy the freight/salvage hold');
    validateShuttle(s);
    for (const inventory of inventories) {
      assert.equal(itemOwners(s).filter(owner => owner.inventory === inventory).length, 1);
      const matchingFood = foodOwners(s).filter(owner => owner.inventory === inventory);
      assert.equal(matchingFood.length, 1);
      assert.equal(matchingFood[0].place, null, 'transit food does not inherit either ground site temperature');
    }
    assert.deepEqual(s, loaded);
  }
  const total = totalResources(s);
  assert.deepEqual(total, { ...before, food: before.food + 10, fuel: before.fuel + 20, air: before.air + 100 });
  updateFood(s, pathTo);
  for (const inventory of inventories) assert.deepEqual(foodLots(inventory), [{ amount: inventory.food, age: 91 }]);
  assert.deepEqual(totalResources(s), total);
  assert.equal(cargoFree(s), 13);
  s.shuttle.freight.food = 16;
  assert.equal(cargoFree(s), 0);
  assert.throws(() => validateShuttle(s), /cargo capacity/, 'freight and salvage cannot each claim the same free hold');
});

test('a missing remote dock retains all onboard food owners and ages them once without relocating the ship', () => {
  const { s, dock } = fixture(), crew = s.crew.slice(0, 2);
  for (const c of crew) { c.site = 'wreck'; c.x = dock.x; c.y = dock.y; }
  s.mission = {
    site: 'wreck', phase: 'working', remaining: 0, fit: 'standard', capacity: 18,
    legacyCapacity: false, crew: crew.map(c => c.id), returnCrew: crew.map(c => c.id),
    cargo: { food: 3, alloy: 1 }, collector: false, heat: 0, returnFuel: 1, kitReserved: false
  };
  s.shuttle.freight = { food: 2, water: 4 };
  s.shuttle.supplies = { food: 5, fuel: 2, air: 10 };
  dock.building = null; delete dock.imports;
  const inventories = [s.shuttle.freight, s.shuttle.supplies, s.mission.cargo];
  for (const inventory of inventories) storeLots(inventory, [{ amount: inventory.food, age: 100 }]);
  const before = structuredClone(s), totals = totalResources(s), expected = inventories.map(inventory => {
    const copy = structuredClone(inventory); copy._food[0].age = 101; return copy;
  });
  for (const inventory of inventories) {
    const owners = foodOwners(s).filter(owner => owner.inventory === inventory);
    assert.equal(owners.length, 1);
    assert.equal(owners[0].place, null);
    assert.equal(owners[0].retainWaste, true);
  }
  assert.deepEqual(s, before, 'finding food owners cannot rebuild a missing dock or move the ship');
  updateFood(s, pathTo);
  assert.deepEqual(inventories, expected, 'each onboard inventory ages one tick at cabin temperature');
  assert.equal(s.shuttle.freight, inventories[0]);
  assert.equal(s.shuttle.supplies, inventories[1]);
  assert.equal(s.mission.cargo, inventories[2]);
  assert.deepEqual(totalResources(s), totals);
  assert.equal(s.sites.wreck.tiles.some(tile => tile.building === 'dock'), false);
  assert.equal(dock.imports, undefined);
  assert.equal(s.mission.site, 'wreck'); assert.equal(s.mission.phase, 'working');
  assert.deepEqual(s.crew, before.crew, 'crew remain at their actual positions without teleporting');
});

test('partial depot to freight to imports transfers preserve total ownership, prepared lots and item identities', () => {
  const { s, depot, dock } = fixture(), { inventory, meal, items } = payload(s);
  add(depot.stock, inventory);
  const before = totalResources(s), lots = lotsInWorld(s), ids = identities(s);
  const conserved = () => {
    assert.deepEqual(totalResources(s), before);
    assert.deepEqual(lotsInWorld(s), lots);
    assert.deepEqual(identities(s), ids);
    validatePossessions(s); validateFood(s);
  };
  const loaded = move(depot.stock, s.shuttle.freight, { food: 3.25, keepsakes: 2 });
  conserved();
  assert.deepEqual(s.shuttle.freight, inventory);
  assert.notEqual(s.shuttle.freight._items[0], loaded._items[0]);
  assert.notEqual(s.shuttle.freight._food[0].meal, loaded._food[0].meal);
  const landed = move(s.shuttle.freight, dock.imports, { food: .625, keepsakes: 1 });
  conserved();
  assert.deepEqual(foodLots(dock.imports), [{ amount: .625, age: 310.5, meal }]);
  assert.deepEqual(dock.imports._items, [items[0]]);
  assert.deepEqual(s.shuttle.freight._items, [items[1]]);
  assert.notEqual(dock.imports._food[0].meal, s.shuttle.freight._food[0].meal);
  assert.notEqual(dock.imports._items[0], landed._items[0]);
  move(s.shuttle.freight, dock.imports, { food: 2.625, keepsakes: 1 });
  conserved();
  assert.deepEqual(s.shuttle.freight, {});
  assert.deepEqual(dock.imports, inventory);
  move(dock.imports, depot.stock, { food: 3.25, keepsakes: 2 });
  conserved();
  assert.deepEqual(dock.imports, {});
  assert.equal(itemOwners(s).filter(o => o.inventory._items?.some(item => item.id === items[0].id)).length, 1);
});

test('failed or fractional freight extraction leaves both owners and metadata untouched', () => {
  const { s, dock } = fixture(), { inventory } = payload(s);
  add(s.shuttle.freight, inventory);
  const before = structuredClone(s);
  for (const request of [{ food: 4 }, { keepsakes: .5 }, { keepsakes: 3 }, { keepsakes: 1, _items: [{ id: 'item-999' }] }]) {
    assert.equal(extract(s.shuttle.freight, request), null);
    assert.deepEqual(s, before);
    assert.deepEqual(dock.imports, {});
  }
});

test('new owner slots expose duplicate or aliased item identities to validation', () => {
  for (const alias of [false, true]) {
    const { s, dock } = fixture(), { inventory } = payload(s);
    add(s.shuttle.freight, inventory);
    dock.imports = alias ? s.shuttle.freight : structuredClone(s.shuttle.freight);
    const before = structuredClone(s);
    assert.throws(() => validatePossessions(s), /duplicated item identity/);
    assert.deepEqual(s, before);
  }
  for (const slot of ['freight', 'imports']) {
    const { s, dock } = fixture();
    (slot === 'freight' ? s.shuttle : dock)[slot] = { keepsakes: 1 };
    assert.throws(() => validatePossessions(s), /Item count/);
  }
});

test('conflicting prepared batch metadata across freight and imports cannot evade validation', () => {
  const { s, dock } = fixture(), { inventory } = payload(s);
  add(s.shuttle.freight, inventory);
  move(s.shuttle.freight, dock.imports, { food: .5 });
  dock.imports._food[0].meal.quality = 1;
  assert.equal(s.shuttle.freight._food[0].meal.quality, 3, 'split lots must not alias nested batch metadata');
  const before = structuredClone(s);
  assert.throws(() => validateFood(s), /Conflicting meal batch metadata/);
  assert.deepEqual(s, before);
});

test('freight and dock food age exactly once at their actual locations and retain waste locally', () => {
  const { s, dock } = fixture(), before = totalResources(s);
  s.shuttle.freight = { food: 1 };
  dock.imports = { food: 2 };
  storeLots(s.shuttle.freight, [{ amount: 1, age: 3599.99 }]);
  storeLots(dock.imports, [{ amount: 2, age: 3599.99 }]);
  updateFood(s, pathTo);
  assert.deepEqual(s.shuttle.freight, { waste: 1 });
  assert.deepEqual(dock.imports, { waste: 2 });
  assert.equal(s.foodSpoiled, 3);
  assert.equal(totalResources(s).food, before.food);
  assert.equal(totalResources(s).waste, before.waste + 3);
  s.shuttle.freight = { food: 1 };
  dock.imports = { food: 1 };
  storeLots(s.shuttle.freight, [{ amount: 1, age: 10 }]);
  storeLots(dock.imports, [{ amount: 1, age: 10 }]);
  updateFood(s, pathTo);
  assert.equal(foodLots(s.shuttle.freight)[0].age, 10 + decayRate(temperatureAt(s.sites.surface, 16, 11)));
  assert.equal(foodLots(dock.imports)[0].age, 10 + decayRate(temperatureAt(s.sites.wreck, dock.x, dock.y)));
});

test('owner walks and observations are pure and report prepared portions and items once', () => {
  const { s, dock } = fixture(), { inventory, meal, items } = payload(s);
  add(s.shuttle.freight, inventory);
  move(s.shuttle.freight, dock.imports, { food: .625, keepsakes: 1 });
  const c = s.crew[0], portion = extract(s.shuttle.freight, { food: .125 });
  c.medical.servings = 1; c.medical.foodAge = 310.5; c.medical.openedFood = portion;
  const before = structuredClone(s);
  freeze(s);
  for (let i = 0; i < 3; i++) {
    itemOwners(s); foodOwners(s); totalResources(s); validatePossessions(s); validateFood(s);
    const snapshot = observe(s), batch = snapshot.entities[meal.id];
    assert.equal(batch.food, 1.5);
    assert.equal(batch.locations.length, 3);
    assert.deepEqual(snapshot.entities[items[0].id].location, { entity: `tile:wreck:${dock.x}:${dock.y}`, slot: 'imports' });
    assert.deepEqual(snapshot.entities[items[1].id].location, { entity: 'colony', slot: 'shuttle.freight' });
    assert.ok(batch.locations.some(p => p.entity === c.id && p.slot === 'medical.openedFood' && p.amount === .125));
    snapshot.entities[items[0].id].quality = 99;
    snapshot.entities[meal.id].locations[0].age = 0;
    assert.deepEqual(s, before, 'reading or mutating an observation cannot mutate physical inventory, RNG or IDs');
  }
});
