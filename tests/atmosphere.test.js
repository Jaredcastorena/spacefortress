import { depart as launch } from './helpers/depart.js';
import { releaseBatteryEnergy } from '../src/power.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, updateRooms, roomAt, pathTo, order,  recall, serialize, deserialize } from '../src/simulation.js';
import { GASES, gasAmount, fillRoom, refreshAtmosphere, updateAtmosphere, breathable, breathe, setDoorMode, moveCrew, SUIT_PER_POINT } from '../src/atmosphere.js';
import { totalResources, initializeStorage, syncResources } from '../src/inventory.js';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} should equal ${b}`);
const gasInRooms = site => site.rooms.reduce((n, r) => n + gasAmount(r.gas), 0);
const allGas = s => totalResources(s).air + s.crew.reduce((n, c) => n + c.oxygen * SUIT_PER_POINT, 0) + Object.values(s.sites).reduce((n, site) => n + gasInRooms(site) + gasAmount(site.atmosphere.vented), 0);
function gasTicks(s, n = 1) { for (let i = 0; i < n; i++) { s.tick++; updateAtmosphere(s); } }
function until(s, predicate, limit = 300) { for (let i = 0; i < limit && !predicate(); i++) step(s); assert.ok(predicate(), 'Expected state before tick limit'); }
function twoRooms() {
  const s = createGame(), site = s.sites.surface;
  for (const t of site.tiles) { t.terrain = 'ground'; t.building = null; delete t.stock; delete t.machine; }
  site.rooms = []; delete site.atmosphere;
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 8; x++) {
    const t = at(site, x, y); t.terrain = 'floor';
    if (x === 2 || x === 8 || y === 2 || y === 6 || x === 5) t.building = 'wall';
  }
  at(site, 5, 4).building = 'door'; updateRooms(site);
  return { s, site, left: roomAt(site, 3, 3), right: roomAt(site, 6, 3) };
}

test('splitting, merging and expanding compartments conserve their stored gas', () => {
  const s = createGame(), site = s.sites.surface, before = gasInRooms(site);
  for (let y = 7; y <= 11; y++) at(site, 10, y).building = 'wall'; updateRooms(site);
  assert.equal(site.rooms.length, 2); close(gasInRooms(site), before);
  assert.ok(site.rooms.every(r => r.pressure > 100));
  for (let y = 7; y <= 11; y++) at(site, 10, y).building = null; updateRooms(site);
  assert.equal(site.rooms.length, 1); close(gasInRooms(site), before); close(site.rooms[0].pressure, 100);
  at(site, 9, 6).building = null; updateRooms(site);
  close(gasInRooms(site), before); assert.ok(site.rooms[0].pressure < 100); assert.equal(site.rooms[0].sealed, false);
});

test('removing the last room volume records its gas as escaped rather than silently deleting it', () => {
  const s = createGame(), site = s.sites.surface, gas = { ...site.rooms[0].gas };
  for (const t of site.tiles) if (t.terrain === 'floor') t.building = 'wall'; updateRooms(site);
  assert.equal(site.rooms.length, 0); for (const k of GASES) close(site.atmosphere.vented[k], gas[k]);
});

test('closed doors isolate gas; open doors equalize pressure without creating or losing gas', () => {
  const { s, site, left, right } = twoRooms(); fillRoom(left); fillRoom(right, 0); refreshAtmosphere(site);
  gasTicks(s, 10); close(left.pressure, 100); close(right.pressure, 0);
  const gas = gasInRooms(site); setDoorMode(s, 'surface', 5, 4, 'open'); gasTicks(s, 100);
  close(left.pressure, 50, 1e-6); close(right.pressure, 50, 1e-6); close(gasInRooms(site), gas); close(gasAmount(site.atmosphere.vented), 0);
});

test('an open door mixes exhaled gas even when both sides have the same pressure', () => {
  const { s, site, left, right } = twoRooms(); fillRoom(left); fillRoom(right);
  right.gas.oxygen -= 6; right.gas.co2 += 6; refreshAtmosphere(site);
  const before = Object.fromEntries(GASES.map(k => [k, left.gas[k] + right.gas[k]]));
  setDoorMode(s, 'surface', 5, 4, 'open'); gasTicks(s, 30);
  assert.ok(left.gas.co2 > 0); assert.ok(right.gas.co2 < 6); close(left.pressure, right.pressure);
  for (const k of GASES) close(left.gas[k] + right.gas[k], before[k]);
});

test('breathing transforms oxygen into exhaled gas; suit refill transfers oxygen from the room', () => {
  const s = createGame(), site = s.sites.surface, c = s.crew[0], r = roomAt(site, c.x, c.y);
  const amount = gasAmount(r.gas), oxygen = r.gas.oxygen; breathe(site, c);
  close(gasAmount(r.gas), amount); close(r.gas.oxygen, oxygen - .0075); close(r.gas.co2, .0075);
  c.oxygen = 40; const combined = gasAmount(r.gas) + c.oxygen * SUIT_PER_POINT;
  breathe(site, c); assert.equal(c.oxygen, 42); close(gasAmount(r.gas) + c.oxygen * SUIT_PER_POINT, combined);
  close(site.atmosphere.refilled, .2);
});

test('a pressurized but contaminated or oxygen-poor room cannot refill suits', () => {
  const s = createGame(), site = s.sites.surface, c = s.crew[0], r = site.rooms[0];
  r.gas.oxygen -= 10; r.gas.co2 += 10; refreshAtmosphere(site); close(r.pressure, 100); assert.equal(breathable(r), false);
  c.oxygen = 40; breathe(site, c); assert.ok(c.oxygen < 40);
  fillRoom(r); r.gas.inert += r.gas.oxygen; r.gas.oxygen = 0; refreshAtmosphere(site);
  assert.equal(breathable(r), false); close(r.pressure, 100);
  fillRoom(r, 200); assert.equal(breathable(r), false); assert.equal(r.air, 0);
});

test('life support cannot create room gas without delivered breathing mix', () => {
  const s = createGame(), site = s.sites.surface, r = site.rooms[0], support = at(site, 7, 7);
  fillRoom(r, 0); refreshAtmosphere(site); support.powered = true;
  gasTicks(s, 10); close(gasAmount(r.gas), 0); assert.match(support.machine.status, /empty/);
  support.machine.input.air = 5; const before = gasAmount(r.gas) + support.machine.input.air;
  gasTicks(s, 4); close(gasAmount(r.gas), 5); close(support.machine.input.air || 0, 0); close(gasAmount(r.gas), before);
});

test('powered recycling reduces exhaled gas without increasing total gas or consuming make-up mix', () => {
  const s = createGame(), site = s.sites.surface, r = site.rooms[0];
  r.gas.oxygen -= 10; r.gas.co2 += 10; refreshAtmosphere(site);
  const before = gasAmount(r.gas); at(site, 7, 7).powered = true; gasTicks(s, 30);
  assert.ok(r.gas.co2 < 7); assert.equal(breathable(r), true); close(gasAmount(r.gas), before); close(gasAmount(site.atmosphere.injected), 0);
});

test('power loss causes stale atmosphere and stopped crops; restored power recovers both', () => {
  const s = createGame(), site = s.sites.surface, r = site.rooms[0], farm = at(site, 7, 9);
  farm.machine.input.water = 1;
  for (const t of site.tiles) if (t.building === 'solar') t.hp = 0;
  releaseBatteryEnergy(site, at(site, 13, 7)); step(s, 160);
  close(r.pressure, 100); assert.ok(r.co2Fraction > .02); assert.equal(breathable(r), false);
  assert.equal(farm.machine.progress, 0); assert.ok(s.crew.some(c => c.oxygen < 100)); assert.ok(s.flags.airWarning);
  for (const t of site.tiles) if (t.building === 'solar') t.hp = 100;
  until(s, () => breathable(r) && s.resources.food > 24, 180);
  assert.equal(s.flags.airWarning, false); assert.ok(r.co2Fraction < .02);
});

test('opening a second breach increases loss, and escaped gas remains accounted for', () => {
  const one = createGame(), two = createGame();
  for (const [s, holes] of [[one, [9]], [two, [9, 11]]]) {
    const site = s.sites.surface; at(site, 7, 7).machine.enabled = false;
    for (const x of holes) at(site, x, 6).building = null; updateRooms(site); fillRoom(site.rooms[0]); refreshAtmosphere(site);
  }
  const beforeOne = gasInRooms(one.sites.surface), beforeTwo = gasInRooms(two.sites.surface);
  gasTicks(one, 20); gasTicks(two, 20);
  assert.ok(two.sites.surface.rooms[0].pressure < one.sites.surface.rooms[0].pressure);
  close(gasInRooms(one.sites.surface) + gasAmount(one.sites.surface.atmosphere.vented), beforeOne);
  close(gasInRooms(two.sites.surface) + gasAmount(two.sites.surface.atmosphere.vented), beforeTwo);
});

test('the same opening depressurizes a small chamber faster than a large habitat', () => {
  const small = twoRooms(), big = createGame(), site = big.sites.surface;
  fillRoom(small.left); fillRoom(small.right); at(small.site, 2, 4).building = 'door'; updateRooms(small.site);
  at(site, 7, 7).machine.enabled = false;
  setDoorMode(small.s, 'surface', 2, 4, 'open'); setDoorMode(big, 'surface', 10, 12, 'open');
  gasTicks(small.s); gasTicks(big);
  assert.ok(roomAt(small.site, 3, 3).pressure < site.rooms[0].pressure);
});

test('damaged hull seals leak, fully broken hull leaks faster, and repairs stop the loss', () => {
  const s = createGame(), site = s.sites.surface, wall = at(site, 9, 6); at(site, 7, 7).machine.enabled = false;
  wall.hp = 50; const start = gasInRooms(site); gasTicks(s, 10); const crackedLoss = start - gasInRooms(site);
  assert.ok(crackedLoss > 0); wall.hp = 0; const brokenStart = gasInRooms(site); gasTicks(s, 10);
  assert.ok(brokenStart - gasInRooms(site) > crackedLoss * 10);
  wall.hp = 100; const repaired = gasInRooms(site); gasTicks(s, 10); close(gasInRooms(site), repaired);
});

test('automatic doors open on passage, seal after a delay, and can be locked against routes', () => {
  const s = createGame(), site = s.sites.surface, c = s.crew[0]; c.x = 10; c.y = 11;
  assert.equal(setDoorMode(s, 'surface', 10, 12, 'closed').ok, true); assert.equal(pathTo(site, c, [[10, 14]]), null);
  setDoorMode(s, 'surface', 10, 12, 'auto'); assert.notEqual(pathTo(site, c, [[10, 14]]), null);
  moveCrew(c, site, [10, 12]); assert.equal(setDoorMode(s, 'surface', 10, 12, 'closed').ok, false);
  gasTicks(s); assert.ok(site.atmosphere.vented.oxygen > 0);
  moveCrew(c, site, [10, 13]); gasTicks(s, 3); assert.equal(site.rooms[0].sealed, true);
});

test('rooms, suits, breathing-mix inventories and escaped gas balance across a sustained breach', () => {
  const s = createGame(), site = s.sites.surface; s.crew[0].oxygen = 20;
  at(site, 9, 6).building = null; updateRooms(site); const initial = allGas(s);
  step(s, 300); close(allGas(s), initial, 1e-7);
  assert.ok(gasAmount(site.atmosphere.vented) > 0); assert.ok(gasAmount(site.atmosphere.injected) > 0);
});

test('preflight refills spend stored mix and landing preserves remaining suit gas', () => {
  const s = createGame(); s.crew[0].oxygen = 60; s.crew[1].oxygen = 65; const before = allGas(s), mix = s.resources.air;
  assert.equal(launch(s, 'wreck').ok, true); close(allGas(s), before); assert.ok(s.resources.air < mix);
  step(s, 32); const travelers = s.mission.crew.map(id => s.crew.find(c => c.id === id));
  assert.ok(travelers.every(c => c.oxygen < 100)); const remaining = travelers.map(c => c.oxygen);
  recall(s); until(s, () => s.mission.phase === 'returning'); const boarded = travelers.map(c => c.oxygen); assert.ok(boarded.every((n, i) => n < remaining[i])); step(s, 22); assert.deepEqual(travelers.map(c => c.oxygen), boarded); close(allGas(s), before, 1e-7);
});

test('water-to-breathing-mix production supplies life support through physical deliveries', () => {
  const s = createGame(), site = s.sites.surface, depot = at(site, 8, 10), r = site.rooms[0];
  depot.stock.air = 0; depot.stock.water = 100; syncResources(s); fillRoom(r, 50); refreshAtmosphere(site);
  const processor = at(site, 12, 9); processor.building = 'atmosphere'; initializeStorage(processor);
  at(site, 11, 14).building = 'advanced';
  until(s, () => gasAmount(site.atmosphere.injected) >= 30, 240);
  assert.ok(s.resources.water < 100); assert.ok(r.pressure > 50);
  until(s, () => breathable(r) && r.pressure > 90, 1000);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('a breach, partially supplied life support and open doors continue deterministically after reload', () => {
  const a = createGame(), site = a.sites.surface; at(site, 9, 6).hp = 20;
  setDoorMode(a, 'surface', 10, 12, 'open'); order(a, 'surface', 11, 14, 'build', 'solar'); step(a, 8);
  const b = deserialize(serialize(a)); step(a, 80); step(b, 80); assert.deepEqual(a, b);
});

test('schema-four air percentages migrate into gas quantities with one commissioning supply', () => {
  const s = createGame(); s.version = 4; delete s.resources.air; delete at(s.sites.surface, 8, 10).stock.air;
  delete at(s.sites.surface, 7, 7).machine;
  for (const site of Object.values(s.sites)) {
    delete site.atmosphere;
    for (const r of site.rooms) { for (const k of ['gas', 'volume', 'pressure', 'oxygenFraction', 'co2Fraction', 'leakArea']) delete r[k]; r.air = 65; }
    site.air = site.rooms.length ? 65 : 0;
    for (const t of site.tiles) { delete t.doorMode; delete t.doorUntil; }
  }
  const imported = deserialize(serialize(s)), r = imported.sites.surface.rooms[0];
  assert.equal(imported.version, VERSION); close(r.pressure, 65); close(r.oxygenFraction, .21);
  assert.equal(imported.resources.air, 160); assert.deepEqual(deserialize(serialize(imported)), imported);
});

test('invalid gases, volumes, cached readings, compartment topology and door states are rejected', () => {
  const reject = mutate => { const s = createGame(); mutate(s); assert.throws(() => deserialize(serialize(s))); };
  reject(s => s.sites.surface.rooms[0].gas.oxygen = -1);
  reject(s => delete s.sites.surface.rooms[0].gas.inert);
  reject(s => s.sites.surface.rooms[0].volume++);
  reject(s => s.sites.surface.rooms[0].pressure = 0);
  reject(s => s.sites.surface.rooms[0].cells[0] = s.sites.surface.rooms[0].cells[1]);
  reject(s => s.sites.surface.atmosphere.vented.co2 = -1);
  reject(s => s.sites.surface.atmosphere.tick++);
  reject(s => at(s.sites.surface, 10, 12).doorMode = 'unknown');
  reject(s => at(s.sites.surface, 10, 12).doorUntil = 1000);
  reject(s => at(s.sites.surface, 7, 7).machine.batch = { air: 5 });
});

test('atmosphere migration without a depot leaves the commissioning supply as recoverable cargo', () => {
  const s = createGame(), depot = at(s.sites.surface, 8, 10); s.version = 4;
  delete s.resources.air; depot.building = null; delete depot.stock;
  for (const r of Object.keys(s.resources)) s.resources[r] = 0;
  const imported = deserialize(serialize(s));
  assert.equal(imported.resources.air, 0); assert.equal(totalResources(imported).air, 160);
  assert.equal(at(imported.sites.surface, 10, 11).drop.air, 160);
  assert.equal(totalResources(deserialize(serialize(imported))).air, 160);
});
