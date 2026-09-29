import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, launch, cancelDeparture, cancelJob, recall, step, at, order, serialize, deserialize, setLabor } from '../src/simulation.js';
import { quantity, totalResources, syncResources } from '../src/inventory.js';
import { setDoorMode } from '../src/atmosphere.js';
const until = (s, predicate, limit = 250) => { for (let i = 0; i < limit && !predicate(); i++) step(s); assert.ok(predicate(), `Expected state before tick limit: ${s.departure?.status}`); };
const loading = s => s.jobs.find(j => j.kind === 'loadShuttle');
const carrier = s => s.crew.find(c => c.delivery?.job === loading(s)?.id && c.carry);

test('preparing a departure reserves supplies but leaves crew and materials on the surface', () => {
  const s = createGame(), before = totalResources(s); assert.equal(launch(s, 'wreck').ok, true);
  assert.equal(s.mission, null); assert.equal(s.departure.stage, 'loading'); assert.equal(s.crew.filter(c => c.site === 'surface').length, 7);
  assert.equal(quantity(s.shuttle.supplies), 0); assert.equal(totalResources(s).fuel, before.fuel); assert.equal(totalResources(s).air, before.air);
  assert.equal(loading(s).cost.fuel, 2); assert.equal(loading(s).cost.air, 10); assert.equal(launch(s, 'wreck').ok, false);
  until(s, () => carrier(s)); assert.ok(quantity(carrier(s).carry) <= 6); assert.equal(quantity(s.shuttle.supplies), 0);
  until(s, () => s.departure?.stage === 'boarding'); assert.equal(s.mission, null); assert.equal(s.shuttle.supplies.fuel, 2);
  until(s, () => s.mission); assert.ok(s.mission.crew.every(id => { const c = s.crew.find(c => c.id === id); return c.site === 'transit' && c.x === 16 && c.y === 11; }));
});

test('loading uses hauling labor and pauses when the source route becomes blocked', () => {
  const s = createGame(); for (const c of s.crew) setLabor(s, c.id, 'hauling', false);
  launch(s, 'wreck'); step(s, 3); assert.match(loading(s).blockedReason, /hauling/i); assert.equal(s.mission, null);
  setLabor(s, s.crew[4].id, 'hauling', true); until(s, () => carrier(s)); setDoorMode(s, 'surface', 10, 12, 'closed'); step(s, 10);
  assert.equal(s.mission, null); assert.equal(quantity(s.shuttle.supplies), 0); assert.ok(carrier(s));
  setDoorMode(s, 'surface', 10, 12, 'auto'); until(s, () => s.mission);
});

test('partial available supplies can load before the remaining fuel is produced or delivered', () => {
  const s = createGame(), depot = at(s.sites.surface, 8, 10); delete depot.stock.fuel; syncResources(s);
  assert.equal(launch(s, 'wreck').ok, true); assert.equal(loading(s).cost.fuel, undefined);
  until(s, () => s.shuttle.supplies.food === 2 && s.shuttle.supplies.air === 10); assert.equal(s.mission, null);
  assert.match(s.departure.status, /Missing supplies/); depot.stock.fuel = 2; syncResources(s); until(s, () => s.mission); assert.equal(s.shuttle.supplies.fuel, 1);
});

test('cancelling preparation during a shipment preserves fuel and all remaining reserved cargo', () => {
  const s = createGame(), fuel = totalResources(s).fuel; launch(s, 'wreck'); until(s, () => carrier(s));
  const c = carrier(s), held = { ...c.carry }; assert.equal(cancelDeparture(s).ok, true);
  assert.equal(s.departure, null); assert.equal(s.mission, null); assert.equal(loading(s), undefined); assert.deepEqual(c.carry, held); assert.equal(c.delivery, null);
  assert.equal(totalResources(s).fuel, fuel); step(s, 30); assert.equal(totalResources(s).fuel, fuel); assert.deepEqual(deserialize(serialize(s)), s);
});

test('cancelling the loading order also cancels preparation rather than silently requeueing', () => {
  const s = createGame(); launch(s, 'wreck'); cancelJob(s, loading(s).id); step(s, 5);
  assert.equal(s.departure, null); assert.equal(loading(s), undefined); assert.equal(s.mission, null);
});

test('loaded stores persist after cancellation and require a crew unloading job to return to the ground', () => {
  const s = createGame(); launch(s, 'wreck'); until(s, () => s.departure?.stage === 'boarding'); const aboard = { ...s.shuttle.supplies };
  cancelDeparture(s); assert.deepEqual(s.shuttle.supplies, aboard); const j = order(s, 'surface', 16, 11, 'unloadShuttle').job; assert.ok(j);
  assert.deepEqual(s.shuttle.supplies, aboard); until(s, () => !s.jobs.includes(j)); assert.equal(quantity(s.shuttle.supplies), 0); assert.ok(at(s.sites.surface, 16, 11).drop.fuel > 0);
  assert.equal(totalResources(s).fuel, 14);
});

test('boarding waits for a walking route and never teleports selected crew through a sealed door', () => {
  const s = createGame(); launch(s, 'wreck'); until(s, () => s.departure?.stage === 'boarding');
  const c = s.crew.find(c => c.id === s.departure.crew[0]); c.x = 8; c.y = 9; setDoorMode(s, 'surface', 10, 12, 'closed'); step(s, 5);
  assert.equal(s.mission, null); assert.equal(c.site, 'surface'); assert.match(c.activity, /blocked/);
  setDoorMode(s, 'surface', 10, 12, 'auto'); until(s, () => s.mission);
});

test('fatigued assigned crew rest before boarding and are not replaced silently', () => {
  const s = createGame(); launch(s, 'wreck'); until(s, () => s.departure?.stage === 'boarding'); const ids = [...s.departure.crew];
  const tired = s.crew.find(c => c.id === ids[0]); tired.energy = 30; step(s); assert.equal(tired.intent.type, 'rest'); assert.equal(s.mission, null);
  until(s, () => s.mission, 300); assert.deepEqual(s.mission.crew, ids); assert.ok(tired.energy >= 40);
});

test('shuttle damage and a closing comet window are rechecked at actual liftoff', () => {
  const s = createGame(); s.tick = 390; assert.equal(launch(s, 'comet').ok, true); step(s, 120);
  assert.equal(s.mission, null); assert.match(s.departure.status, /window closed/); assert.ok(s.shuttle.supplies.fuel >= 3); cancelDeparture(s);
  assert.equal(launch(s, 'wreck').ok, true); at(s.sites.surface, 16, 11).hp = 20; step(s, 30);
  assert.equal(s.mission, null); assert.match(s.departure.status, /damaged/);
  const repair = order(s, 'surface', 16, 11, 'repair'); assert.equal(repair.ok, true); until(s, () => s.mission);
});

test('flight consumes fuel by leg and preserves unused service stores between sorties', () => {
  const s = createGame(), fuel = totalResources(s).fuel; launch(s, 'wreck'); until(s, () => s.mission);
  assert.equal(totalResources(s).fuel, fuel - 1); assert.equal(s.shuttle.supplies.fuel, 1); assert.equal(s.mission.returnFuel, 1);
  const air = s.shuttle.supplies.air; assert.ok(air > 0); recall(s); assert.equal(totalResources(s).fuel, fuel - 2); assert.equal(s.mission.returnFuel, 0);
  until(s, () => !s.mission); assert.equal(s.shuttle.supplies.air, air); assert.equal(launch(s, 'wreck').ok, true); assert.ok(loading(s).cost.air < 5);
});

test('solar kit remains aboard on an outbound abort and is consumed only when deployed', () => {
  const s = createGame(); s.flags.salvageReturned = true; const before = totalResources(s).components;
  launch(s, 'solar'); until(s, () => s.mission); assert.equal(s.shuttle.supplies.components, 2); assert.equal(totalResources(s).components, before);
  recall(s); until(s, () => !s.mission); assert.equal(s.shuttle.supplies.components, 2);
  launch(s, 'solar'); assert.equal(loading(s).cost.components, undefined); until(s, () => s.mission?.phase === 'working');
  assert.equal(s.mission.collector, true); assert.equal(s.mission.kitReserved, false); assert.equal(totalResources(s).components, before - 2); step(s, 3); assert.equal(totalResources(s).components, before - 2);
});

test('loading and boarding persist with exactly the same future behavior after reload', () => {
  const s = createGame(); launch(s, 'wreck'); until(s, () => carrier(s)); let copy = deserialize(serialize(s)); step(s, 20); step(copy, 20); assert.deepEqual(copy, s);
  until(s, () => s.departure?.stage === 'boarding'); copy = deserialize(serialize(s)); step(s, 60); step(copy, 60); assert.deepEqual(copy, s);
});

test('schema-eight flights preserve already-paid supplies and gain no free service stores', () => {
  const s = createGame(); launch(s, 'wreck'); until(s, () => s.mission); s.version = 8; delete s.departure; delete s.shuttle.supplies; delete s.mission.returnFuel; delete s.mission.kitReserved; delete s.mission.returnCrew;
  const copy = deserialize(serialize(s)); assert.equal(copy.version, VERSION); assert.deepEqual(copy.shuttle.supplies, {}); assert.equal(copy.mission.returnFuel, 0);
  const fuel = copy.resources.fuel; recall(copy); until(copy, () => !copy.mission); assert.equal(copy.resources.fuel, fuel); assert.deepEqual(deserialize(serialize(copy)), copy);
});

test('invalid departure teams, supply targets and return reserves are rejected', () => {
  for (const corrupt of [
    s => { s.departure.crew[1] = s.departure.crew[0]; },
    s => { s.departure.target.fuel = 0; },
    s => { s.departure.target.air = 999; },
    s => { s.shuttle.supplies.fuel = -1; },
  ]) { const s = createGame(); launch(s, 'wreck'); corrupt(s); assert.throws(() => deserialize(serialize(s))); }
  const s = createGame(); launch(s, 'wreck'); until(s, () => s.mission); delete s.shuttle.supplies.fuel; assert.throws(() => deserialize(serialize(s)));
});
