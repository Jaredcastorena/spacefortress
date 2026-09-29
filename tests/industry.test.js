import { releaseBatteryEnergy } from '../src/power.js';
import { fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, setLabor, serialize, deserialize, updateRooms } from '../src/simulation.js';
import { initializeStorage, syncResources, totalResources, quantity } from '../src/inventory.js';
import { setMachineEnabled, spillStorage, OUTPUT_CAPACITY } from '../src/industry.js';

const depot = s => at(s.sites.surface, 8, 10);
const refinery = s => at(s.sites.surface, 13, 10);
function hauling(s, enabled) { s.crew.forEach(c => setLabor(s, c.id, 'hauling', enabled)); }
function until(s, condition, limit = 200) { for (let i = 0; i < limit && !condition(); i++) step(s); assert.ok(condition(), 'Expected condition before tick limit'); }
function machine(s, x, y, building) { const t = at(s.sites.surface, x, y); t.building = building; initializeStorage(t); return t; }

test('ore stays in its depot until a hauler delivers it; output needs a separate return trip', () => {
  const s = createGame(), m = refinery(s).machine; depot(s).stock.ore = 1; syncResources(s); hauling(s, false);
  const alloy = s.resources.alloy; step(s, 40);
  assert.equal(s.resources.ore, 1); assert.equal(quantity(m.batch), 0); assert.equal(s.resources.alloy, alloy);
  assert.match(m.status, /input delivery/);
  hauling(s, true); until(s, () => m.progress > 0);
  assert.equal(s.resources.ore, 0); assert.equal(s.resources.alloy, alloy); assert.deepEqual(m.batch, { ore: 1 });
  hauling(s, false); until(s, () => m.output.alloy === 2);
  assert.equal(s.resources.alloy, alloy); assert.equal(totalResources(s).alloy, alloy + 2);
  hauling(s, true); until(s, () => s.resources.alloy === alloy + 2);
  assert.equal(quantity(m.output), 0);
});

test('a closed route prevents deliveries, and opening it restarts the production chain', () => {
  const s = createGame(), site = s.sites.surface; depot(s).stock.ore = 1; syncResources(s);
  for (const [x, y] of [[12, 10], [13, 9], [13, 11]]) at(site, x, y).building = 'wall';
  step(s, 50); assert.equal(s.resources.ore, 1); assert.equal(refinery(s).machine.progress, 0);
  at(site, 12, 10).building = null; until(s, () => s.resources.alloy === 38);
});

test('an interrupted batch survives loss of power and a deterministic save/reload', () => {
  const s = createGame(), t = refinery(s); hauling(s, false); t.machine.input.ore = 1;
  step(s, 7); const progress = t.machine.progress; assert.ok(progress > 0 && progress < 20);
  for (const tile of s.sites.surface.tiles) if (tile.building === 'solar') tile.hp = 0;
  releaseBatteryEnergy(s.sites.surface, at(s.sites.surface, 13, 7));
  step(s, 5); assert.equal(t.machine.progress, progress); assert.deepEqual(t.machine.batch, { ore: 1 }); assert.equal(t.machine.status, 'No power');
  const copy = deserialize(serialize(s));
  for (const state of [s, copy]) { for (const tile of state.sites.surface.tiles) if (tile.building === 'solar') tile.hp = 100; until(state, () => refinery(state).machine.output.alloy === 2); }
  assert.deepEqual(copy, s); assert.equal(t.machine.output.alloy, 2); assert.equal(quantity(t.machine.batch), 0);
});

test('full output blocks production without spending inputs; collection permits the next batch', () => {
  const s = createGame(), m = refinery(s).machine; hauling(s, false); m.input.ore = 1; m.output.alloy = OUTPUT_CAPACITY;
  step(s, 30); assert.equal(m.input.ore, 1); assert.equal(m.progress, 0); assert.match(m.status, /Output full/);
  hauling(s, true); until(s, () => m.progress > 0); assert.equal(m.input.ore || 0, 0); assert.ok(quantity(m.output) < OUTPUT_CAPACITY);
});

test('hydroponics pauses its existing batch during a breach, then resumes after repair', () => {
  const s = createGame(), t = at(s.sites.surface, 7, 9); hauling(s, false); t.machine.input.water = 1; t.machine.input.fertilizer = .25;
  step(s, 4); const progress = t.machine.progress; assert.ok(progress > 0); fillRoom(s.sites.surface.rooms[0], 0); refreshAtmosphere(s.sites.surface);
  step(s, 8); assert.equal(t.machine.progress, progress); assert.equal(t.machine.status, 'Needs breathable atmosphere');
  updateRooms(s.sites.surface); fillRoom(s.sites.surface.rooms[0]); refreshAtmosphere(s.sites.surface); until(s, () => t.machine.output.food === 2);
  assert.equal(t.machine.output.food, 2); assert.equal(quantity(t.machine.batch), 0);
});

test('paused machines stop requesting new inputs and release their power demand', () => {
  const s = createGame(), t = refinery(s); depot(s).stock.ore = 2; syncResources(s);
  assert.equal(setMachineEnabled(s, 'surface', 13, 10, false).ok, true); step(s, 30);
  assert.equal(s.resources.ore, 2); assert.equal(t.powered, false); assert.equal(t.machine.status, 'Paused by player');
  setMachineEnabled(s, 'surface', 13, 10, true); until(s, () => t.machine.progress > 0);
});

test('pickup reservations and carried shipments survive recovery and reload without duplication', () => {
  const s = createGame(); at(s.sites.surface, 7, 9).machine.enabled = false;
  at(s.sites.surface, 16, 11).drop = { components: 9 }; const total = totalResources(s).components;
  until(s, () => s.crew.some(c => c.carry?.components));
  const carrier = s.crew.find(c => c.carry?.components); assert.equal(carrier.carry.components, 6);
  carrier.energy = 1; step(s); assert.equal(carrier.intent.type, 'rest');
  const copy = deserialize(serialize(s)); step(s, 160); step(copy, 160);
  assert.deepEqual(copy, s); assert.equal(s.resources.components, total); assert.equal(totalResources(s).components, total);
});

test('dismantling spills machine inputs, unfinished batches, and outputs without deleting materials', () => {
  const s = createGame(), t = refinery(s); hauling(s, false); t.machine.enabled = false;
  t.machine.input.ore = 2; t.machine.batch = { ore: 1 }; t.machine.progress = 5; t.machine.output.alloy = 4;
  const before = totalResources(s); assert.equal(order(s, 'surface', 13, 10, 'remove').ok, true);
  until(s, () => t.building === null); assert.equal(t.machine, undefined); assert.deepEqual(t.drop, { alloy: 7, ore: 3 });
  assert.equal(totalResources(s).ore, before.ore); assert.equal(totalResources(s).alloy, before.alloy + 3);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('depot demolition and order cancellation preserve both ordinary and reserved stock', () => {
  const s = createGame(), t = depot(s); hauling(s, false); const before = totalResources(s).alloy;
  const pending = order(s, 'surface', 11, 14, 'build', 'solar').job;
  for (const c of s.crew) setLabor(s, c.id, 'construction', false);
  // A destroyed depot is replaced by a local pile; cancellation must refund at that location.
  spillStorage(t); t.building = null; syncResources(s); cancelJob(s, pending.id);
  assert.equal(s.resources.alloy, 0); assert.equal(t.drop.alloy, before); assert.equal(totalResources(s).alloy, before);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('deliveries to a demolished machine return to storage, including a replacement with another recipe', () => {
  const s = createGame(); at(s.sites.surface, 7, 9).machine.enabled = false;
  depot(s).stock.ore = 2; syncResources(s); const total = totalResources(s).ore;
  until(s, () => s.crew.some(c => c.carry?.ore));
  const t = refinery(s); spillStorage(t); t.building = 'fabricator'; initializeStorage(t); t.machine.enabled = false;
  step(s, 30); assert.equal(s.resources.ore, total); assert.equal(quantity(t.machine.input), 0);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('tibbles cannot eat food on the other side of a sealed wall', () => {
  const s = createGame(), site = s.sites.surface; at(site, 7, 9).machine.enabled = false;
  at(site, 10, 12).building = 'wall';
  s.creatures.push({ id: 'outside-tibble', species: 'tibble', site: 'surface', x: 10, y: 14, health: 100, fed: 20, age: 0 });
  const food = s.resources.food; step(s, 60); assert.equal(s.resources.food, food);
  at(site, 10, 12).building = 'door'; step(s, 60); assert.ok(s.resources.food < food);
});

test('ore becomes alloy, fabricated components, and finally a constructed advanced array', () => {
  const s = createGame(); s.flags.salvageReturned = true;
  const parts = machine(s, 12, 9, 'fabricator');
  depot(s).stock = { ore: 10, food: 24, water: 40, fuel: 14 }; syncResources(s);
  // Power the extra production load before the ore-to-parts chain starts.
  machine(s, 11, 14, 'advanced');
  until(s, () => s.resources.components >= 4, 650);
  setMachineEnabled(s, 'surface', parts.x, parts.y, false);
  // Finish any already claimed alloy delivery before putting excess inputs back in storage.
  until(s, () => !s.crew.some(c => c.delivery?.kind === 'input' || c.intent?.destination?.kind === 'input'), 60);
  spillStorage(parts); parts.building = null;
  until(s, () => s.resources.alloy >= 8, 200);
  assert.equal(order(s, 'surface', 12, 14, 'build', 'advanced').ok, true);
  until(s, () => at(s.sites.surface, 12, 14).building === 'advanced', 100);
  assert.equal(totalResources(s).ore * 2 + totalResources(s).alloy + totalResources(s).components * 3, 0);
});

test('version-two global supplies migrate once while cargo, reserved jobs and crew skills survive', () => {
  const legacy = createGame(); const job = order(legacy, 'surface', 11, 14, 'build', 'solar').job;
  const before = totalResources(legacy); legacy.version = 2;
  for (const site of Object.values(legacy.sites)) for (const t of site.tiles) { delete t.stock; delete t.machine; }
  delete job.sources; legacy.crew[0].carry = { ore: 8 }; legacy.crew[1].intent = { type: 'haul', target: [15, 14] };
  const migrated = deserialize(serialize(legacy)); assert.equal(migrated.version, VERSION);
  assert.equal(migrated.resources.alloy, legacy.resources.alloy); assert.deepEqual(migrated.crew[0].skills, legacy.crew[0].skills);
  assert.equal(totalResources(migrated).ore, before.ore + 8); cancelJob(migrated, job.id);
  assert.equal(migrated.resources.alloy, before.alloy); assert.equal(migrated.crew[1].intent, null);
  assert.deepEqual(deserialize(serialize(migrated)), migrated);
});

test('malformed inventories, batches, deliveries and conflicting resource totals are rejected', () => {
  const bad = mutate => { const s = createGame(); mutate(s); assert.throws(() => deserialize(serialize(s))); };
  bad(s => depot(s).stock.ore = -1);
  bad(s => refinery(s).machine.batch = { ore: 2 });
  bad(s => refinery(s).machine.progress = 5);
  bad(s => refinery(s).machine.output.alloy = 13);
  bad(s => refinery(s).machine.input.fuel = 1);
  bad(s => s.resources.alloy++);
  bad(s => { s.crew[0].carry = { ore: 3 }; s.crew[0].delivery = { kind: 'input', target: [100, 10] }; });
});

test('several haulers reserve no more than two input batches even during a power outage', () => {
  const s = createGame(); depot(s).stock.ore = 30; syncResources(s);
  for (const t of s.sites.surface.tiles) if (t.building === 'solar') t.hp = 0;
  releaseBatteryEnergy(s.sites.surface, at(s.sites.surface, 13, 7));
  step(s, 40); assert.equal(refinery(s).machine.input.ore, 2); assert.equal(s.resources.ore, 28);
  assert.equal(s.crew.filter(c => c.carry?.ore || c.intent?.items?.ore).length, 0);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('a carrier dying outside leaves recoverable cargo at their location', () => {
  const s = createGame(), c = s.crew[0];
  c.carry = { components: 3 }; c.delivery = { kind: 'stock', target: [8, 10] };
  c.x = 16; c.y = 11; c.oxygen = 0; c.health = .1;
  const before = totalResources(s).components; step(s);
  assert.equal(c.health, 0); assert.equal(c.carry, null); assert.equal(c.delivery, null);
  assert.equal(at(s.sites.surface, 16, 11).drop.components, 3);
  until(s, () => s.resources.components === before); assert.equal(totalResources(s).components, before);
});
