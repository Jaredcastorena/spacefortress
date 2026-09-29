import { depart as launch } from './helpers/depart.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, at, order, cancelJob,  recall, serialize, deserialize } from '../src/simulation.js';
import { quantity, spill, totalResources, syncResources } from '../src/inventory.js';
import { cargoFree, reservedCargo, setCargoAccepted, routeTime, routeFuel, dockAt, resumeExpedition } from '../src/expedition.js';
import { VERSION, SHUTTLE_FITS } from '../src/data.js';
const until = (s, predicate, limit = 160) => { for (let i = 0; i < limit && !predicate(); i++) step(s); assert.ok(predicate(), 'Expected state before tick limit'); };
function expedition() { const s = createGame(); assert.equal(launch(s, 'wreck').ok, true); step(s, 22); return s; }
const team = s => s.crew.filter(c => s.mission.crew.includes(c.id));
function fit(s, id) { s.flags.salvageReturned = true; at(s.sites.surface, 8, 10).stock.components = 8; syncResources(s); const result = order(s, 'surface', 16, 11, 'refit', id); assert.equal(result.ok, true); until(s, () => !s.jobs.includes(result.job)); }

test('orbital extraction leaves located piles until hauling labor transports them to the dock', () => {
  const s = expedition(), site = s.sites.wreck; team(s).forEach(c => c.labors.hauling = false);
  const j = order(s, 'wreck', 5, 6, 'mine').job; until(s, () => !s.jobs.includes(j));
  assert.deepEqual(at(site, 5, 6).drop, { components: 3, alloy: 2 }); assert.equal(quantity(s.mission.cargo), 0);
  team(s).forEach(c => c.labors.hauling = true); until(s, () => team(s).some(c => c.carry));
  assert.equal(quantity(s.mission.cargo), 0); assert.equal(reservedCargo(s), 5);
  const carrier = team(s).find(c => c.carry); assert.equal(carrier.delivery.kind, 'shuttle');
  until(s, () => quantity(s.mission.cargo) === 5); assert.equal(carrier.x, 4); assert.equal(carrier.y, 11); assert.equal(at(site, 5, 6).drop, null);
  recall(s); until(s, () => !s.mission); until(s, () => s.resources.components === 6);
  assert.equal(s.flags.salvageReturned, true); const upgrade = order(s, 'surface', 16, 11, 'refit', 'cargo'); assert.equal(upgrade.ok, true);
  until(s, () => !s.jobs.includes(upgrade.job)); assert.equal(s.shuttle.fit, 'cargo'); assert.equal(s.resources.components, 3);
});

test('multiple haulers reserve shared hold space without overfilling it or duplicating cargo', () => {
  const s = expedition(), site = s.sites.wreck; s.mission.cargo = { alloy: 15 };
  spill(at(site, 4, 10), { components: 5 }); spill(at(site, 5, 10), { components: 5 });
  const before = totalResources(s).components; step(s);
  assert.equal(quantity(s.mission.cargo) + reservedCargo(s), 18); assert.equal(cargoFree(s), 0);
  step(s, 15); assert.equal(quantity(s.mission.cargo), 18); assert.equal(totalResources(s).components, before);
  assert.equal(site.tiles.reduce((n, t) => n + quantity(t.drop), 0), 7); assert.deepEqual(deserialize(serialize(s)), s);
});

test('cargo selection leaves excluded materials on site and can be changed during the expedition', () => {
  const s = expedition(), pile = at(s.sites.wreck, 5, 10); spill(pile, { water: 10, fuel: 3 });
  setCargoAccepted(s, 'water', false); until(s, () => s.mission.cargo.fuel === 3); step(s, 5);
  assert.equal(s.mission.cargo.water, undefined); assert.equal(pile.drop.water, 10);
  setCargoAccepted(s, 'water', true); until(s, () => s.mission.cargo.water === 10); assert.equal(pile.drop, null);
});

test('recall walks crew and held cargo back to the dock before transit begins', () => {
  const s = expedition(); spill(at(s.sites.wreck, 7, 7), { components: 5 });
  until(s, () => team(s).some(c => c.carry)); const carrier = team(s).find(c => c.carry), location = [carrier.x, carrier.y];
  assert.equal(recall(s).ok, true); assert.equal(s.mission.phase, 'boarding'); assert.equal(carrier.site, 'wreck'); assert.deepEqual([carrier.x, carrier.y], location);
  const oxygen = carrier.oxygen; until(s, () => s.mission.phase === 'returning'); assert.equal(s.mission.cargo.components, 5); assert.equal(carrier.carry, null); assert.ok(carrier.oxygen < oxygen);
  step(s, 22); assert.equal(s.mission, null); assert.equal(at(s.sites.surface, 16, 11).drop.components, 5);
});

test('a blocked return route strands the boarding team until the route is opened', () => {
  const s = expedition(), site = s.sites.wreck; team(s).forEach((c, i) => { c.x = 8; c.y = 8 + i; });
  for (const [x, y] of [[3, 11], [5, 11], [4, 10], [4, 12]]) at(site, x, y).building = 'wall';
  recall(s); step(s, 5); assert.equal(s.mission.phase, 'boarding'); assert.ok(team(s).every(c => c.site === 'wreck' && c.activity.includes('blocked')));
  assert.equal(order(s, 'wreck', 5, 11, 'remove').ok, false);
  assert.equal(resumeExpedition(s).ok, true); const clear = order(s, 'wreck', 5, 11, 'remove'); assert.equal(clear.ok, true);
  until(s, () => !s.jobs.includes(clear.job)); recall(s); until(s, () => s.mission.phase === 'returning'); assert.ok(team(s).every(c => c.site === 'transit'));
});

test('unloaded piles survive recall and can be recovered on a later expedition', () => {
  const s = expedition(), pile = at(s.sites.wreck, 7, 7); spill(pile, { components: 5 });
  team(s).forEach(c => c.labors.hauling = false); recall(s); until(s, () => !s.mission);
  assert.equal(pile.drop.components, 5); assert.equal(launch(s, 'wreck').ok, true); step(s, 22); team(s).forEach(c => c.labors.hauling = true);
  until(s, () => s.mission.cargo.components === 5); assert.equal(pile.drop, null);
});

test('carrier death releases cargo and capacity; a surviving teammate can still return', () => {
  const s = expedition(), site = s.sites.wreck; spill(at(site, 7, 7), { components: 5 });
  until(s, () => team(s).some(c => c.carry)); const c = team(s).find(c => c.carry); c.health = 0; step(s);
  assert.equal(c.carry, null); assert.equal(at(site, c.x, c.y).drop.components, 5); assert.ok(quantity(s.mission.cargo) + reservedCargo(s) <= 18);
  const before = totalResources(s).components; recall(s); until(s, () => !s.mission);
  assert.equal(c.site, 'wreck'); assert.equal(totalResources(s).components, before); assert.deepEqual(deserialize(serialize(s)), s);
});

test('refits require recovered technology, delivered materials, and engineering work before changing capability', () => {
  const s = createGame(); assert.equal(order(s, 'surface', 16, 11, 'refit', 'cargo').ok, false);
  s.flags.salvageReturned = true; const before = totalResources(s), j = order(s, 'surface', 16, 11, 'refit', 'cargo').job;
  assert.ok(j); assert.equal(s.shuttle.fit, 'standard'); assert.equal(launch(s, 'wreck').ok, false); assert.equal(totalResources(s).components, before.components);
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); assert.equal(j.remaining, j.work); assert.equal(s.shuttle.fit, 'standard');
  until(s, () => !s.jobs.includes(j)); assert.equal(s.shuttle.fit, 'cargo'); assert.equal(totalResources(s).components, before.components - 3); assert.equal(totalResources(s).alloy, before.alloy - 8);
  assert.equal(routeTime(s, 'wreck'), 28); assert.equal(routeFuel(s, 'wreck'), 3); assert.equal(launch(s, 'wreck').ok, true); assert.equal(s.mission.capacity, 36);
});

test('cancelled refits preserve the installed fitting and all unconsumed materials', () => {
  const s = createGame(); s.flags.salvageReturned = true; const before = totalResources(s), j = order(s, 'surface', 16, 11, 'refit', 'cargo').job;
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); cancelJob(s, j.id); step(s, 10);
  assert.equal(s.shuttle.fit, 'standard'); assert.equal(totalResources(s).components, before.components); assert.equal(totalResources(s).alloy, before.alloy);
});

test('cargo and drive fittings change paid fuel, travel time and hold space', () => {
  for (const id of ['cargo', 'drive']) {
    const s = createGame(); fit(s, id); const fuel = s.resources.fuel, time = routeTime(s, 'wreck'), cost = routeFuel(s, 'wreck');
    assert.equal(launch(s, 'wreck').ok, true); assert.equal(s.resources.fuel, fuel - cost); assert.equal(s.mission.capacity, SHUTTLE_FITS[id].capacity);
    step(s, time - 1); assert.equal(s.mission.phase, 'outbound'); step(s); assert.equal(s.mission.phase, 'working');
    assert.equal(order(s, 'surface', 16, 11, 'refit', 'standard').ok, false);
  }
});

test('storm shelter trades hold space for reduced debris injury while the dock shelters everyone', () => {
  const standard = expedition(), protectedState = createGame(); fit(protectedState, 'shield'); assert.equal(launch(protectedState, 'wreck').ok, true); step(protectedState, 22);
  for (const s of [standard, protectedState]) {
    s.tick += 64 - s.tick % 65; const [outside, sheltered] = team(s), dock = dockAt(s.sites.wreck);
    outside.x = 8; outside.y = 8; outside.health = 100; sheltered.x = dock.x; sheltered.y = dock.y; sheltered.health = 100;
    step(s); assert.equal(outside.health, s.shuttle.fit === 'shield' ? 99 : 96); assert.equal(sheltered.health, 100);
  }
  assert.equal(protectedState.mission.capacity, 12);
});

test('solar cells are produced on the platform and require hauling instead of appearing aboard', () => {
  const s = createGame(); s.flags.salvageReturned = true; launch(s, 'solar'); step(s, 38); team(s).forEach(c => c.labors.hauling = false);
  step(s, 70); assert.equal(s.mission.cargo.cells, undefined); assert.ok(at(s.sites.solar, 10, 8).drop.cells >= 2);
  team(s).forEach(c => c.labors.hauling = true); until(s, () => s.mission.cargo.cells > 0);
});

test('pickup, loaded carriers and boarding saves resume deterministically', () => {
  const s = expedition(); spill(at(s.sites.wreck, 8, 8), { components: 10 }); step(s);
  assert.ok(team(s).some(c => c.intent?.type === 'salvage')); let copy = deserialize(serialize(s)); step(s, 4); step(copy, 4); assert.deepEqual(copy, s);
  until(s, () => team(s).some(c => c.carry)); copy = deserialize(serialize(s)); step(s, 2); step(copy, 2); assert.deepEqual(copy, s);
  recall(s); copy = deserialize(serialize(s)); step(s, 40); step(copy, 40); assert.deepEqual(copy, s);
});

test('old in-flight cargo migrates without loss even when it exceeds the new standard capacity', () => {
  const s = expedition(); s.version = 7; s.mission.cargo = { alloy: 60 }; delete s.shuttle; delete s.mission.returnCrew;
  for (const field of ['fit', 'capacity', 'legacyCapacity']) delete s.mission[field];
  const migrated = deserialize(serialize(s)); assert.equal(migrated.version, VERSION); assert.equal(migrated.mission.capacity, 60); assert.equal(cargoFree(migrated), 0);
  assert.deepEqual(deserialize(serialize(migrated)), migrated); recall(migrated); until(migrated, () => !migrated.mission);
  assert.equal(at(migrated.sites.surface, 16, 11).drop.alloy, 60); assert.equal(SHUTTLE_FITS[migrated.shuttle.fit].capacity, 18);
});

test('save validation rejects overfilled holds, invalid fitting state and bad orbital pickup coordinates', () => {
  for (const corrupt of [
    s => { s.shuttle.fit = 'magic'; },
    s => { s.shuttle.accepted.push(s.shuttle.accepted[0]); },
    s => { s.mission.cargo = { alloy: 19 }; },
    s => { s.mission.capacity = 200; },
    s => { team(s)[0].intent = { type: 'salvage', target: [25, 25], items: { alloy: 2 } }; },
    s => { team(s)[0].carry = { alloy: 3 }; team(s)[0].delivery = { kind: 'shuttle', target: [5, 5] }; },
  ]) { const s = expedition(); corrupt(s); assert.throws(() => deserialize(serialize(s))); }
});
