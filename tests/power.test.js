import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, serialize, deserialize, dischargeCell } from '../src/simulation.js';
import { initializePower, initializeElectrical, refreshPower, updatePower, releaseBatteryEnergy, setCableEnabled, setPowerPriority, validatePower } from '../src/power.js';
import { initializeStorage, syncResources, totalResources } from '../src/inventory.js';
import { setMachineEnabled } from '../src/industry.js';

function grid() {
  const s = createGame(), site = s.sites.surface;
  for (const t of site.tiles) { t.building = null; t.cable = null; t.terrain = 'floor'; delete t.charge; delete t.powerPriority; delete t.machine; delete t.stock; }
  initializePower(s, site, 0);
  return { s, site };
}
function device(site, x, y, building, charge = 0) {
  const t = at(site, x, y); t.building = building; t.hp = 100; initializeElectrical(t); initializeStorage(t);
  if (building === 'battery') { t.charge = charge; site.energy.initial += charge; }
  return t;
}
function wire(site, x, y) { const t = at(site, x, y); t.cable = { hp: 100, enabled: true }; return t; }
function until(s, predicate, limit = 150) { for (let i = 0; i < limit && !predicate(); i++) step(s); assert.ok(predicate(), 'Expected state before tick limit'); }
function balance(site) { const e = site.energy; assert.ok(Math.abs(site.power.battery + e.consumed + e.curtailed + e.discarded - e.initial - e.generated - e.injected) < 1e-7); }

test('starting equipment shares a working circuit and charges only from generated surplus', () => {
  const s = createGame(), site = s.sites.surface;
  assert.equal(site.power.networks, 1); assert.equal(site.power.output, 12); assert.equal(site.power.demand, 8); assert.equal(site.power.battery, 100);
  step(s); assert.equal(at(site, 13, 7).charge, 104); balance(site); validatePower(s, site);
});

test('distant and diagonal generators cannot power equipment until a cable route connects them', () => {
  const { s, site } = grid(); device(site, 1, 1, 'solar'); const load = device(site, 3, 1, 'scrubber');
  refreshPower(s, site); assert.equal(load.powered, false); assert.equal(site.power.output, 4);
  wire(site, 2, 2); refreshPower(s, site); assert.equal(load.powered, false);
  wire(site, 2, 1); updatePower(s, site); assert.equal(load.powered, true); assert.equal(site.energy.consumed, 3); balance(site);
});

test('a switched bridge isolates battery reserves and reconnection uses the surplus', () => {
  const { s, site } = grid(); device(site, 1, 1, 'solar'); wire(site, 2, 1); const bank = device(site, 3, 1, 'battery', 30); device(site, 4, 1, 'scrubber');
  assert.equal(setCableEnabled(s, 'surface', 2, 1, false).ok, true); updatePower(s, site);
  assert.equal(bank.charge, 27); assert.equal(site.energy.curtailed, 4);
  setCableEnabled(s, 'surface', 2, 1, true); updatePower(s, site); assert.equal(bank.charge, 28); balance(site);
});

test('joining and splitting circuits never redistributes existing bank charge', () => {
  const { s, site } = grid(); const a = device(site, 1, 1, 'battery', 17), b = device(site, 3, 1, 'battery', 93); wire(site, 2, 1);
  refreshPower(s, site); assert.equal(site.power.networks, 1);
  setCableEnabled(s, 'surface', 2, 1, false); updatePower(s, site);
  assert.equal(a.charge, 17); assert.equal(b.charge, 93); balance(site);
  setCableEnabled(s, 'surface', 2, 1, true); updatePower(s, site); assert.equal(a.charge, 17); assert.equal(b.charge, 93);
});

test('damaged batteries retain their charge but supply nothing until repaired', () => {
  const { s, site } = grid(); const bank = device(site, 1, 1, 'battery', 40), load = device(site, 2, 1, 'refinery');
  bank.hp = 0; updatePower(s, site); assert.equal(load.powered, false); assert.equal(bank.charge, 40);
  bank.hp = 100; updatePower(s, site); assert.equal(load.powered, true); assert.equal(bank.charge, 37); balance(site);
});

test('condition limits battery charging and unused generation is accounted for', () => {
  const { s, site } = grid(); const bank = device(site, 1, 1, 'battery'); bank.hp = 50;
  device(site, 2, 1, 'advanced'); device(site, 3, 1, 'advanced'); updatePower(s, site);
  assert.equal(bank.charge, 10); assert.equal(site.energy.curtailed, 14); balance(site);
  s.tick = 230; device(site, 1, 2, 'fabricator'); device(site, 2, 2, 'fabricator'); device(site, 3, 2, 'fabricator');
  updatePower(s, site); assert.equal(site.power.used, 8); assert.equal(bank.charge, 2); balance(site);
});

test('life support wins shortages by default and player priorities and pauses change allocation', () => {
  const { s, site } = grid(); device(site, 1, 1, 'solar'); const life = device(site, 2, 1, 'scrubber'), farm = device(site, 3, 1, 'farm');
  refreshPower(s, site); assert.equal(life.powered, true); assert.equal(farm.powered, false);
  setPowerPriority(s, 'surface', 2, 1, 1); setPowerPriority(s, 'surface', 3, 1, 5);
  assert.equal(life.powered, false); assert.equal(farm.powered, true);
  setMachineEnabled(s, 'surface', 3, 1, false); assert.equal(life.powered, true); assert.equal(farm.powered, false);
});

test('cable construction, repair and removal beneath a wall preserve the wall and deliver supplies', () => {
  const s = createGame(), site = s.sites.surface, wall = at(site, 6, 9), before = totalResources(s).alloy;
  assert.equal(wall.cable, null); wall.hp = 60;
  const build = order(s, 'surface', wall.x, wall.y, 'build', 'cable'); assert.equal(build.ok, true); assert.equal(wall.cable, null);
  until(s, () => !s.jobs.includes(build.job)); assert.equal(wall.building, 'wall'); assert.equal(wall.hp, 60); assert.equal(totalResources(s).alloy, before - 1);
  assert.equal(order(s, 'surface', wall.x, wall.y, 'build', 'cable').ok, false);
  wall.cable.hp = 0; const repair = order(s, 'surface', wall.x, wall.y, 'repairCable'); assert.equal(repair.ok, true);
  until(s, () => !s.jobs.includes(repair.job)); assert.equal(wall.cable.hp, 100); assert.equal(wall.hp, 60); assert.equal(totalResources(s).alloy, before - 2);
  const remove = order(s, 'surface', wall.x, wall.y, 'removeCable'); until(s, () => !s.jobs.includes(remove.job));
  assert.equal(wall.cable, null); assert.equal(wall.building, 'wall'); assert.equal(totalResources(s).alloy, before - 1.5);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('new battery construction starts empty and demolition discards its stored energy', () => {
  const s = createGame(), site = s.sites.surface;
  const build = order(s, 'surface', 11, 9, 'build', 'battery'); assert.equal(build.ok, true);
  until(s, () => !s.jobs.includes(build.job)); const bank = at(site, 11, 9); assert.equal(bank.charge, 0);
  bank.charge = 30; site.energy.injected += 30;
  const remove = order(s, 'surface', 11, 9, 'remove'); until(s, () => !s.jobs.includes(remove.job));
  assert.equal(bank.charge, undefined); assert.equal(site.energy.discarded, 30); balance(site); assert.deepEqual(deserialize(serialize(s)), s);
});

test('portable cells require reachable free capacity and charge only the selected bank', () => {
  const s = createGame(), site = s.sites.surface, bank = at(site, 13, 7), depot = at(site, 8, 10);
  depot.stock.cells = 2; syncResources(s); assert.equal(dischargeCell(s, 13, 7).ok, false); assert.equal(depot.stock.cells, 2);
  releaseBatteryEnergy(site, bank); refreshPower(s, site); setCableEnabled(s, 'surface', 13, 7, false);
  assert.equal(dischargeCell(s, 13, 7).ok, true); assert.equal(bank.charge, 100); assert.equal(depot.stock.cells, 1); balance(site);
  releaseBatteryEnergy(site, bank); refreshPower(s, site);
  for (const [x, y] of [[12, 7], [14, 7], [13, 6], [13, 8]]) at(site, x, y).building = 'wall';
  assert.equal(dischargeCell(s, 13, 7).ok, false); assert.equal(depot.stock.cells, 1);
});

test('power shortages and pending cable repairs resume deterministically from a save', () => {
  const s = createGame(), site = s.sites.surface; at(site, 7, 7).cable.hp = 0;
  const repair = order(s, 'surface', 7, 7, 'repairCable'); assert.equal(repair.ok, true); step(s);
  const copy = deserialize(serialize(s)); step(s, 100); step(copy, 100); assert.deepEqual(copy, s); assert.equal(at(site, 7, 7).cable.hp, 100); balance(site);
});

test('legacy pooled charge migrates once into individual banks without creating energy', () => {
  const old = createGame(), site = old.sites.surface; device(site, 11, 9, 'battery'); old.version = 5; site.power.battery = 235;
  const s = deserialize(serialize(old)), loaded = s.sites.surface;
  assert.equal(s.version, VERSION); assert.equal(at(loaded, 13, 7).charge, 117.5); assert.equal(at(loaded, 11, 9).charge, 117.5);
  assert.equal(loaded.power.battery, 235); balance(loaded); assert.deepEqual(deserialize(serialize(s)), s);
});

test('legacy pooled charge without a bank is recorded as discarded', () => {
  const old = createGame(), site = old.sites.surface, bank = at(site, 13, 7); old.version = 5; site.power.battery = 80; bank.building = null; delete bank.charge;
  const s = deserialize(serialize(old)); assert.equal(s.sites.surface.power.battery, 0); assert.equal(s.sites.surface.energy.discarded, 80); balance(s.sites.surface);
});

test('save validation rejects corrupt wiring, charge, priorities, circuit caches and energy creation', () => {
  for (const corrupt of [
    (s, site) => { at(site, 7, 7).cable.hp = -1; },
    (s, site) => { at(site, 7, 7).powerPriority = 4; },
    (s, site) => { at(site, 13, 7).charge = 121; },
    (s, site) => { site.circuits[0].used = 0; },
    (s, site) => { at(site, 13, 7).charge++; refreshPower(s, site); },
  ]) { const s = createGame(); corrupt(s, s.sites.surface); assert.throws(() => deserialize(serialize(s))); }
});
