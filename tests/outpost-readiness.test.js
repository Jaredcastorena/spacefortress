import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at } from '../src/simulation.js';
import { initializeStorage, totalResources } from '../src/inventory.js';
import { updateRooms, fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { initializeElectrical, refreshPower } from '../src/power.js';
import { HEAT_CAPACITY, temperature } from '../src/thermal.js';
import { outpostReadiness, OUTPOST_RESERVES } from '../src/outpost-readiness.js';

// Synthetic conditions isolate the inspector. This is not a supplied ordinary
// gameplay journey: the journey suite owns construction/pressurization/warm-up.
function habitat() {
  const s = createGame(), site = s.sites.wreck;
  for (const t of site.tiles) {
    t.terrain = 'deck'; t.building = null; t.hp = 100; t.drop = null; t.cable = null;
    delete t.stock; delete t.storage; delete t.machine; delete t.imports;
  }
  for (let y = 6; y <= 10; y++) for (let x = 6; x <= 10; x++) {
    const t = at(site, x, y); t.terrain = 'floor';
    if ([6, 10].includes(x) || [6, 10].includes(y)) t.building = 'wall';
  }
  const door = at(site, 8, 10); Object.assign(door, { building: 'door', doorMode: 'auto', doorUntil: 0 });
  const device = (x, y, building) => {
    const t = at(site, x, y); t.building = building; t.hp = 100; initializeStorage(t); initializeElectrical(t); return t;
  };
  const dock = at(site, 4, 11); Object.assign(dock, { building: 'dock', imports: {} });
  const depot = device(7, 7, 'stockpile'); depot.stock = { food: 8, air: 20, water: 4 };
  const beds = [device(8, 7, 'bunk'), device(9, 7, 'bunk')];
  const scrubber = device(7, 8, 'scrubber'), climate = device(8, 8, 'climate');
  const solar = [device(7, 11, 'solar'), device(8, 11, 'solar')];
  for (let y = 7; y <= 11; y++) for (let x = 7; x <= 8; x++) at(site, x, y).cable = { hp: 100, enabled: true };
  updateRooms(site);
  const room = site.rooms.find(r => r.cells.includes('7,7'));
  fillRoom(room); room.heat = (20 + 273.15) * room.volume * HEAT_CAPACITY;
  refreshPower(s, site);
  const crew = s.crew.slice(0, 2);
  crew.forEach((c, i) => Object.assign(c, { site: 'wreck', x: 4 + i, y: 11, job: null, carry: null, delivery: null, intent: null }));
  const ids = crew.map(c => c.id);
  return { s, site, room, dock, depot, beds, scrubber, climate, solar, crew, ids, device };
}
const inspect = f => outpostReadiness(f.s, 'wreck', f.ids);
const codes = result => result.blockers.map(b => b.code);
function freeze(v) { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.values(v).forEach(freeze); } return v; }

test('unbuilt wreck and missing/invalid proposed rosters report blockers without granting state', () => {
  const s = createGame(), before = structuredClone(s);
  const r = outpostReadiness(s);
  assert.equal(r.ready, false); assert.ok(codes(r).includes('crew_selection_required'));
  assert.ok(codes(r).includes('depot_unreachable')); assert.ok(codes(r).includes('habitat_unready'));
  assert.deepEqual(outpostReadiness(s, 'surface', ['crew-0']).blockers.map(b => b.code), ['unsupported_site']);
  for (const ids of [null, ['unknown'], ['crew-0', 'crew-0'], Array(1), Object.assign(['crew-0'], { extra: true })]) {
    assert.deepEqual(codes(outpostReadiness(s, 'wreck', ids)), ['invalid_residents']);
  }
  assert.ok(codes(outpostReadiness(s, 'wreck', ['crew-0'])).includes('crew_unavailable'));
  assert.deepEqual(s, before);
});

test('safe local supplied habitat measures distinct bunks and returns detached stable entity IDs', () => {
  const f = habitat(), result = inspect(f);
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.deepEqual(OUTPOST_RESERVES, { foodPerResident: 2, airPerResident: 5, reactorFuel: 1 });
  assert.equal(result.bunks.assignments.length, 2);
  assert.equal(new Set(result.bunks.assignments.map(a => a.bunk)).size, 2);
  assert.equal(result.dock.entity, 'tile:wreck:4:11');
  assert.equal(result.rooms[0].entity, 'room:wreck:7,7');
  assert.deepEqual(result.provisions.required, { food: 4, air: 10, fuel: 0, medicine: 0 });
  assert.equal(result.power.reactorDependent, false);
  result.crewIds.length = 0; result.provisions.sources[0].items.food = 999;
  result.rooms[0].lifeSupport.length = 0;
  assert.deepEqual(inspect(f).crewIds, f.ids); assert.equal(f.depot.stock.food, 8);
});

test('deeply frozen repeated inspection preserves inventories, heat, gas, power, IDs and RNG', () => {
  const f = habitat(), before = structuredClone(f.s), totals = totalResources(f.s);
  freeze(f.s);
  const a = inspect(f);
  for (let i = 0; i < 4; i++) assert.deepEqual(inspect(f), a);
  assert.equal(a.ready, true); assert.deepEqual(f.s, before); assert.deepEqual(totalResources(f.s), totals);
});

test('cold zero-gas floor never qualifies from equipment nameplates or stale gas readings', () => {
  const f = habitat();
  f.room.gas = { oxygen: 0, inert: 0, co2: 0 };
  f.room.heat = (273.15 - 60) * f.room.volume * HEAT_CAPACITY;
  const before = structuredClone(f.s), result = inspect(f), room = result.rooms[0];
  assert.equal(result.ready, false); assert.equal(room.pressure, 0);
  assert.ok(Math.abs(room.temperature + 60) < 1e-10);
  assert.ok(room.blockers.some(b => b.code === 'air_unsafe'));
  assert.ok(room.blockers.some(b => b.code === 'temperature_unsafe'));
  assert.ok(Math.abs(temperature(f.room) + 60) < 1e-10); assert.deepEqual(f.s, before);
});

test('actual seals, harmful gas and smoke override old room display values', () => {
  for (const corrupt of [
    f => { at(f.site, 7, 6).hp = 0; },
    f => { f.room.gas = { oxygen: 18.9, inert: 68.1, co2: 3 }; },
    f => { f.room.smoke = 100; },
    f => { f.room.heat = (40 + 273.15) * f.room.volume * HEAT_CAPACITY; },
  ]) {
    const f = habitat(); corrupt(f); const before = structuredClone(f.s);
    assert.equal(inspect(f).ready, false); assert.deepEqual(f.s, before);
  }
});

test('required utilities use actual circuit allocation, condition and control state', () => {
  for (const corrupt of [
    f => { at(f.site, 8, 10).cable.enabled = false; at(f.site, 7, 10).cable.enabled = false; },
    f => { f.solar[1].hp = 0; },
    f => { f.scrubber.machine.enabled = false; },
    f => { f.scrubber.hp = 0; },
    f => { f.climate.climate.enabled = false; },
    f => { f.climate.climate.target = 0; },
    f => { f.climate.fire = { intensity: 1 }; },
  ]) {
    const f = habitat(); assert.equal(f.scrubber.powered, true); corrupt(f);
    const before = structuredClone(f.s); assert.equal(inspect(f).ready, false); assert.deepEqual(f.s, before);
  }
});

test('distinct beds, usable dock and physical reachability are required for each resident', () => {
  const f = habitat(); f.beds[1].hp = 0;
  assert.ok(codes(inspect(f)).includes('bunk_unavailable'));
  f.beds[1].hp = 100; at(f.site, 8, 10).doorMode = 'closed';
  assert.ok(codes(inspect(f)).includes('habitat_unready'));
  at(f.site, 8, 10).doorMode = 'auto'; f.dock.hp = 0;
  assert.ok(codes(inspect(f)).includes('dock_damaged'));
  f.dock.hp = 100; Object.assign(f.crew[0], { x: 1, y: 1 });
  for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]]) at(f.site, x, y).building = 'wall';
  assert.ok(codes(inspect(f)).includes('dock_unreachable'));
});

test('provisions count only reachable local unpromised owners, never remote stores or freight', () => {
  const f = habitat(); f.depot.stock = {};
  f.s.shuttle.freight = { food: 100, air: 100 }; f.s.shuttle.supplies = { food: 100, air: 100 };
  at(f.site, 1, 1).drop = { food: 100, air: 100 };
  for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]]) at(f.site, x, y).building = 'wall';
  assert.ok(codes(inspect(f)).includes('food_reserve_low')); assert.ok(codes(inspect(f)).includes('air_reserve_low'));
  f.dock.imports = { food: 4, air: 10 };
  assert.equal(inspect(f).ready, true);
  f.crew[0].intent = { type: 'haul', source: 'imports', target: [4, 11], items: { food: 1 }, destination: { kind: 'stock', target: [7, 7] } };
  assert.equal(inspect(f).provisions.available.food, 3);
  assert.ok(codes(inspect(f)).includes('food_reserve_low'));
  f.crew[0].intent = null; f.dock.imports.air = 5; f.scrubber.machine.input.air = 5;
  assert.equal(inspect(f).ready, true, 'delivered life-support buffer is a real local reserve');
});

test('fuel guard applies only when assigned habitat utilities actually depend on a reactor', () => {
  const f = habitat(), reactor = f.device(8, 11, 'reactor'); reactor.reactor.output = 25;
  reactor.machine.input.fuel = .5; f.solar[0].hp = 0;
  assert.equal(inspect(f).power.reactorDependent, true);
  assert.ok(codes(inspect(f)).includes('fuel_reserve_low'));
  f.dock.imports.fuel = .5; assert.equal(inspect(f).ready, true);
  delete f.dock.imports.fuel; f.device(7, 11, 'solar'); f.device(7, 10, 'solar');
  assert.equal(inspect(f).power.reactorDependent, false);
  assert.equal(inspect(f).provisions.required.fuel, 0);
  assert.equal(inspect(f).ready, true, 'independent solar supply does not invent a fuel requirement');
});

test('serious injury requires actual safe care, medicine and a caregiver in the proposed roster', () => {
  const f = habitat(), patient = f.crew[0]; patient.health = 50; patient.medical.injury = 50;
  let result = inspect(f); assert.ok(codes(result).includes('medical_cot_unavailable'));
  assert.ok(codes(result).includes('medicine_reserve_low'));
  f.device(7, 9, 'medicalCot'); f.dock.imports.medicine = 2;
  assert.equal(inspect(f).ready, true);
  result = outpostReadiness(f.s, 'wreck', [patient.id]);
  assert.ok(codes(result).includes('caregiver_unavailable'), 'a departing visitor is not permanent medical support');
  patient.health = 95; patient.medical.injury = 5; f.dock.imports.medicine = 0;
  assert.equal(outpostReadiness(f.s, 'wreck', [patient.id]).ready, true, 'minor injury is reported without demanding unrelated equipment');
});
