import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, updateRooms, roomAt, step, order, serialize, deserialize, setLabor } from '../src/simulation.js';
import { totalResources } from '../src/inventory.js';
import { refreshAtmosphere } from '../src/atmosphere.js';
import { refreshPower } from '../src/power.js';
import { safeBed, injure } from '../src/medicine.js';
import { temperature, initializeClimate, updateThermal, setClimate, HEAT_CAPACITY, thermalExposure } from '../src/thermal.js';

const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} should equal ${b}`);
const totalHeat = site => site.rooms.reduce((n, r) => n + r.heat, 0);
function setTemp(site, room, temp) {
  const heat = (temp + 273.15) * HEAT_CAPACITY * room.volume, change = heat - room.heat;
  site.thermal[change >= 0 ? 'added' : 'removed'] += Math.abs(change); room.heat = heat;
}
function fixture() {
  const s = createGame(), site = s.sites.surface;
  return { s, site, r: site.rooms[0] };
}
function climate(s, x = 12, y = 10) {
  const site = s.sites.surface, t = at(site, x, y); t.building = 'climate'; initializeClimate(t);
  t.cable = { hp: 100, enabled: true }; refreshPower(s, site); return t;
}
function split(site) {
  for (let y = 7; y <= 11; y++) at(site, 10, y).building = 'wall';
  const door = at(site, 10, 9); door.building = 'door'; door.doorMode = 'closed'; door.doorUntil = 0;
  updateRooms(site); return { a: roomAt(site, 8, 9), b: roomAt(site, 12, 9), door };
}
const check = s => deserialize(serialize(s));

test('new colony starts temperate without free equipment, supplies or power changes', () => {
  const { s, site, r } = fixture(); close(temperature(r), 20);
  assert.equal(site.thermal.ambient, 8); assert.equal(site.power.demand, 8);
  assert.equal(site.tiles.some(t => t.building === 'climate'), false);
  assert.ok(s.crew.every(c => c.thermalStress === 0)); check(s);
});

test('room split, merge, new floors and removed volumes account for their thermal mass', () => {
  const { s, site, r } = fixture(); setTemp(site, r, 50); const before = totalHeat(site), removed = site.thermal.removed;
  split(site); assert.equal(site.rooms.length, 2); site.rooms.forEach(r => close(temperature(r), 50));
  close(before - totalHeat(site), site.thermal.removed - removed);
  for (let y = 7; y <= 11; y++) at(site, 10, y).building = null;
  updateRooms(site); assert.equal(site.rooms.length, 1);
  close(temperature(site.rooms[0]), (30 * 50 + 5 * 8) / 35);
  check(s);
  // Removing every room records all remaining stored heat.
  site.tiles.filter(t => t.terrain === 'floor').forEach(t => t.terrain = 'ground'); updateRooms(site);
  close(totalHeat(site), 0); check(s);
});

test('heat passes between rooms through closed bulkheads and much faster through open doors', () => {
  const closed = fixture(), open = fixture();
  for (const f of [closed, open]) {
    const { a, b, door } = split(f.site); setTemp(f.site, a, 60); setTemp(f.site, b, 0);
    for (const t of f.site.tiles) t.powered = false;
    if (f === open) door.doorMode = 'open';
  }
  updateThermal(closed.s); updateThermal(open.s);
  assert.ok(temperature(roomAt(open.site, 12, 9)) > temperature(roomAt(closed.site, 12, 9)));
  for (const f of [closed, open]) { refreshPower(f.s, f.site); refreshAtmosphere(f.site); check(f.s); }
});

test('hull damage increases heat loss and repairs restore insulation', () => {
  const intact = fixture(), damaged = fixture();
  for (const f of [intact, damaged]) { setTemp(f.site, f.r, 80); f.site.tiles.forEach(t => t.powered = false); }
  at(damaged.site, 8, 6).hp = 0;
  updateThermal(intact.s); updateThermal(damaged.s);
  assert.ok(temperature(damaged.r) < temperature(intact.r));
  const gap = temperature(intact.r) - temperature(damaged.r); at(damaged.site, 8, 6).hp = 100;
  updateThermal(intact.s); updateThermal(damaged.s);
  assert.ok(temperature(intact.r) - temperature(damaged.r) < gap);
});

test('power use adds recorded waste heat without changing gas or electrical energy totals', () => {
  const { s, site } = fixture(), gas = structuredClone(site.rooms[0].gas), electricity = structuredClone(site.energy);
  updateThermal(s); close(site.thermal.equipment, 8 * .35);
  assert.deepEqual(site.rooms[0].gas, gas); assert.deepEqual(site.energy, electricity); check(s);
});

test('a powered climate unit heats, cools, respects its target and releases demand when paused', () => {
  const { s, site, r } = fixture(), unit = climate(s); assert.equal(unit.powered, true);
  setTemp(site, r, 40); updateThermal(s); assert.equal(unit.climate.status, 'Cooling compartment'); assert.ok(site.thermal.cooling > 0);
  assert.equal(setClimate(s, 'surface', unit.x, unit.y, 30, false).ok, true); assert.equal(unit.powered, false); assert.equal(site.power.demand, 8);
  const cooling = site.thermal.cooling; updateThermal(s); assert.equal(site.thermal.cooling, cooling);
  setTemp(site, r, 10); setClimate(s, 'surface', unit.x, unit.y, 20, true); updateThermal(s); assert.equal(unit.climate.status, 'Heating compartment');
  for (let i = 0; i < 1000; i++) updateThermal(s);
  assert.ok(temperature(r) > 19 && temperature(r) <= 20.01); check(s);
});

test('climate output needs connected power and scales with condition', () => {
  const a = fixture(), b = fixture();
  for (const f of [a, b]) { f.unit = climate(f.s); setTemp(f.site, f.r, 50); }
  b.unit.hp = 50; refreshPower(b.s, b.site); updateThermal(a.s); updateThermal(b.s);
  close(a.site.thermal.cooling, b.site.thermal.cooling * 2);
  b.unit.cable.enabled = false; refreshPower(b.s, b.site);
  const cooled = b.site.thermal.cooling; updateThermal(b.s); assert.equal(b.site.thermal.cooling, cooled); assert.equal(b.unit.climate.status, 'No power'); check(b.s);
});

test('climate construction requires real supplies, and demolition cleans up controls', () => {
  const { s, site } = fixture(); const before = totalResources(s);
  const result = order(s, 'surface', 12, 10, 'build', 'climate'); assert.equal(result.ok, true);
  for (let i = 0; i < 100 && at(site, 12, 10).building !== 'climate'; i++) { step(s); check(s); }
  const unit = at(site, 12, 10); assert.equal(unit.building, 'climate'); assert.equal(unit.climate.target, 20);
  assert.equal(totalResources(s).components, before.components - 1);
  assert.equal(order(s, 'surface', 12, 10, 'remove').ok, true);
  for (let i = 0; i < 100 && unit.building; i++) { step(s); check(s); }
  assert.equal(unit.building, null); assert.equal(unit.climate, undefined);
});

test('unsafe crop temperature preserves a started batch and climate recovery resumes production', () => {
  const { s, site, r } = fixture(), farm = at(site, 7, 9); climate(s);
  for (const c of s.crew) setLabor(s, c.id, 'hauling', false);
  farm.machine.input.water = 1; farm.machine.input.fertilizer = .25; step(s, 5); assert.ok(farm.machine.progress > 0);
  setTemp(site, r, 40); const progress = farm.machine.progress; step(s);
  assert.equal(farm.machine.progress, progress); assert.deepEqual(farm.machine.batch, { water: 1, fertilizer: .25 }); assert.match(farm.machine.status, /10–35/);
  for (let i = 0; i < 450 && !farm.machine.completed; i++) { step(s); check(s); }
  assert.ok(farm.machine.completed > 0); assert.equal(farm.machine.output.food, 2);
});

test('thermal stress interrupts work, retains cargo and finds a reachable temperate compartment', () => {
  const { s, site } = fixture(), { a, b, door } = split(site);
  setTemp(site, a, 65); setTemp(site, b, 20); door.doorMode = 'auto'; refreshAtmosphere(site);
  const c = s.crew[0]; c.x = 8; c.y = 9; c.thermalStress = 50;
  c.carry = { components: 2 }; c.delivery = { kind: 'stock', target: [8, 10] };
  const supplies = totalResources(s).components;
  step(s); assert.equal(c.intent.type, 'temperature'); assert.deepEqual(c.carry, { components: 2 });
  for (let i = 0; i < 90 && c.intent?.type === 'temperature'; i++) { step(s); check(s); }
  assert.notEqual(c.intent?.type, 'temperature'); assert.ok(c.x >= 10); assert.ok(Math.abs(c.thermalStress) <= 10);
  assert.equal(totalResources(s).components, supplies);
});

test('paid meal portions finish before a thermal recovery interruption', () => {
  const { s, site, r } = fixture(), c = s.crew[0]; setTemp(site, r, 60); c.thermalStress = 50; c.hunger = 20;
  c.intent = { type: 'meal', target: null, servings: 3 };
  step(s); assert.equal(c.intent.type, 'meal'); assert.equal(c.intent.servings, 2);
  step(s, 2); assert.equal(c.intent, null); assert.ok(c.hunger > 49);
  step(s); assert.equal(c.intent.type, 'temperature'); check(s);
});

test('prolonged heat or cold exposure creates persistent treatable injury', () => {
  for (const [temp, strain, cause] of [[80, 80, 'heat exposure'], [-40, -80, 'cold exposure']]) {
    const { s, site, r } = fixture(), c = s.crew[0]; setTemp(site, r, temp); c.thermalStress = strain;
    step(s); assert.ok(c.medical.injury > 0); assert.equal(c.medical.cause, cause); assert.equal(c.intent.type, 'temperature');
    const injury = c.medical.injury; setTemp(site, r, 20); step(s, 20);
    assert.ok(Math.abs(c.thermalStress) < Math.abs(strain)); assert.ok(c.medical.injury >= injury); check(s);
  }
});

test('pressure suits protect ordinary exterior work and thermal strain recovers gradually', () => {
  const { s, site } = fixture(), c = s.crew[0]; c.x = 16; c.y = 11; c.thermalStress = -20;
  const damage = thermalExposure(c, site, true); assert.equal(damage, 0); close(c.thermalStress, -19.2);
  for (const siteId of ['wreck', 'comet', 'solar']) { c.site = siteId; c.x = 5; c.y = 10; c.thermalStress = 0; thermalExposure(c, s.sites[siteId], true); assert.equal(c.thermalStress, 0); }
});

test('unsafe temperatures invalidate medical cots instead of healing patients in danger', () => {
  const { s, site, r } = fixture(), c = s.crew[0], cot = at(site, 11, 9); cot.building = 'medicalCot';
  injure(s, c, 10, 'test'); c.medical.bed = [11, 9]; c.intent = { type: 'medical', target: [11, 9] };
  assert.equal(safeBed(site, c.medical.bed), true); setTemp(site, r, 60); assert.equal(safeBed(site, c.medical.bed), false);
  step(s); assert.equal(c.medical.bed, null); assert.equal(s.jobs.some(j => j.kind === 'treat'), false); check(s);
});

test('saved heat, climate settings, stress and recovery continue deterministically', () => {
  const { s, site, r } = fixture(), t = climate(s); setClimate(s, 'surface', t.x, t.y, 18, true);
  setTemp(site, r, 55); s.crew[0].thermalStress = 50; step(s, 3);
  const copy = check(s); step(s, 130); step(copy, 130); assert.deepEqual(copy, s); check(s);
});

test('schema-fourteen migration commissions neutral temperatures without altering supplies or injuries', () => {
  const { s } = fixture(); injure(s, s.crew[0], 10, 'old injury'); const before = totalResources(s);
  s.version = 14; for (const site of Object.values(s.sites)) { delete site.thermal; site.rooms.forEach(r => delete r.heat); } s.crew.forEach(c => delete c.thermalStress);
  const copy = check(s); assert.equal(copy.version, VERSION); assert.deepEqual(totalResources(copy), before); assert.equal(copy.crew[0].medical.injury, 10);
  close(temperature(copy.sites.surface.rooms[0]), 20); assert.equal(copy.crew[0].thermalStress, 0); assert.deepEqual(check(copy), copy);
});

test('invalid thermal ledgers, crew strain and climate controls are rejected', () => {
  for (const change of [s => s.sites.surface.rooms[0].heat++, s => s.sites.surface.thermal.environmentOut = -1, s => s.sites.surface.thermal.ambient = 99, s => s.crew[0].thermalStress = 101, s => climate(s).climate.target = 100, s => at(s.sites.surface, 8, 10).climate = { enabled: true, target: 20, status: 'bad' }]) {
    const s = createGame(); change(s); assert.throws(() => check(s), /thermal|heat|climate|Climate/);
  }
});
