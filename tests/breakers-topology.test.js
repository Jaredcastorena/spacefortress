import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, at, step, order, serialize, deserialize } from '../src/simulation.js';
import { BUILDINGS } from '../src/data.js';
import { initializeStorage, totalResources } from '../src/inventory.js';
import { initializePower, initializeElectrical, refreshPower, updatePower, previewPower, breakerConditions, setCableEnabled, electrical, validatePower } from '../src/power.js';
import { BREAKER_DIRECTIONS, breakerClosed, setBreaker, resetBreaker } from '../src/breakers.js';
import { maintainable, recordOperation, damage, setAutoService } from '../src/maintenance.js';
import { ignite, updateFire, setFireResponse } from '../src/fire.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function grid() {
  const s = createGame(), site = s.sites.surface;
  for (const t of site.tiles) {
    t.building = null; t.cable = null; t.terrain = 'floor';
    delete t.charge; delete t.powerPriority; delete t.machine; delete t.stock;
  }
  initializePower(s, site, 0);
  return { s, site };
}
function device(site, x, y, building, charge = 0) {
  const t = at(site, x, y); t.building = building; t.hp = 100;
  initializeElectrical(t); initializeStorage(t);
  if (building === 'battery') { t.charge = charge; site.energy.initial += charge; }
  return t;
}
function wire(site, x, y) { const t = at(site, x, y); t.cable = { hp: 100, enabled: true }; return t; }
function breaker(site, x, y, direction = 'east', enabled = false, mode = 'manual') {
  const t = device(site, x, y, 'breaker');
  Object.assign(t.protection, { direction, enabled, mode });
  return t;
}
function balance(site) {
  const e = site.energy, stored = site.tiles.reduce((n, t) => n + (t.charge || 0), 0);
  close(stored + e.consumed + e.curtailed + e.discarded, e.initial + e.generated + e.injected);
}
const until = (s, predicate, limit = 120) => {
  for (let i = 0; i < limit && !predicate(); i++) step(s);
  assert.ok(predicate(), `Condition missing at tick ${s.tick}`);
};

test('all four breaker orientations power only their facing terminals and keep side loads isolated', () => {
  for (const [direction, [dx, dy]] of Object.entries(BREAKER_DIRECTIONS)) {
    const { s, site } = grid(), b = breaker(site, 10, 10, direction);
    const source = device(site, 10 - dx, 10 - dy, 'solar');
    const load = device(site, 10 + dx, 10 + dy, 'farm');
    const sideA = device(site, 10 - dy, 10 + dx, 'farm'), sideB = device(site, 10 + dy, 10 - dx, 'farm');
    refreshPower(s, site);
    let status = breakerConditions(s, site, b);
    assert.equal(status.connected, false); assert.equal(load.powered, false);
    assert.equal(status.inputCircuit, source.circuit); assert.equal(status.outputCircuit, load.circuit);
    assert.notEqual(status.inputCircuit, status.outputCircuit); assert.equal(b.circuit, null);
    assert.ok(setBreaker(s, 'surface', b.x, b.y, true, direction, 'manual').ok);
    updatePower(s, site); status = breakerConditions(s, site, b);
    assert.equal(status.connected, true); assert.equal(status.inputCircuit, status.outputCircuit);
    assert.equal(load.powered, true); assert.equal(sideA.powered, false); assert.equal(sideB.powered, false);
    assert.notEqual(sideA.circuit, source.circuit); assert.notEqual(sideB.circuit, source.circuit);
    assert.equal(site.energy.generated, 4); assert.equal(site.energy.consumed, 2); assert.equal(site.energy.curtailed, 2);
    balance(site);
  }
});

test('facing adjacent breakers preserve each terminal through all series contact combinations', () => {
  const { s, site } = grid(), source = device(site, 4, 5, 'solar');
  const a = breaker(site, 5, 5, 'east'), b = breaker(site, 6, 5, 'west'), load = device(site, 7, 5, 'farm');
  refreshPower(s, site);
  for (const [left, right] of [[false, false], [true, false], [false, true], [true, true]]) {
    assert.ok(setBreaker(s, 'surface', a.x, a.y, left, 'east', 'manual').ok);
    assert.ok(setBreaker(s, 'surface', b.x, b.y, right, 'west', 'manual').ok);
    const ca = breakerConditions(s, site, a), cb = breakerConditions(s, site, b);
    assert.equal(load.powered, left && right);
    assert.equal(ca.inputCircuit, source.circuit); assert.equal(cb.inputCircuit, load.circuit);
    assert.equal(ca.outputCircuit, cb.outputCircuit);
    assert.equal(ca.connected, left); assert.equal(cb.connected, right);
    assert.equal(site.power.output, 4); assert.equal(site.power.demand, 2); assert.equal(site.power.used, left && right ? 2 : 0);
  }
  assert.ok(setBreaker(s, 'surface', b.x, b.y, false, 'west', 'manual').ok);
  assert.ok(setBreaker(s, 'surface', b.x, b.y, true, 'north', 'manual').ok);
  assert.equal(load.powered, false, 'A side-facing second breaker must not bridge the first');
});

test('an external bypass remains live after manual opening and cannot be falsely protected', () => {
  const { s, site } = grid(), bank = device(site, 4, 5, 'battery', 30);
  const b = breaker(site, 5, 5, 'east', true, 'wet_fault'), load = device(site, 6, 5, 'farm');
  for (const x of [4, 5, 6]) wire(site, x, 6);
  const fault = at(site, 6, 6); fault.liquid = .25;
  refreshPower(s, site);
  const status = breakerConditions(s, site, b);
  assert.equal(status.bypassed, true); assert.equal(status.blocked, 'bypassed'); assert.equal(status.wouldTrip, false);
  assert.deepEqual(status.faultEntities, ['tile:surface:6:6']);
  updatePower(s, site); assert.equal(b.protection.tripped, false); assert.equal(load.powered, true); close(bank.charge, 23);
  const cables = [4, 5, 6].map(x => structuredClone(at(site, x, 6).cable));
  assert.ok(setBreaker(s, 'surface', 5, 5, false, 'east', 'wet_fault').ok);
  assert.equal(load.powered, true); assert.equal(breakerConditions(s, site, b).bypassed, true);
  assert.deepEqual([4, 5, 6].map(x => at(site, x, 6).cable), cables);
  updatePower(s, site); close(bank.charge, 16); close(site.energy.consumed, 14); balance(site);
});

test('generator and battery power flow opposite the marked branch direction without duplication', () => {
  const { s, site } = grid(), load = device(site, 3, 5, 'farm'), bank = device(site, 4, 5, 'battery');
  const b = breaker(site, 5, 5, 'east', true); device(site, 6, 5, 'solar');
  updatePower(s, site); assert.equal(load.powered, true); close(bank.charge, 2);
  assert.deepEqual(breakerConditions(s, site, b).sourceEntities, ['tile:surface:6:5']);
  setBreaker(s, 'surface', 5, 5, false, 'east', 'manual');
  updatePower(s, site); assert.equal(load.powered, true); close(bank.charge, 0);
  close(site.energy.generated, 8); close(site.energy.consumed, 4); close(site.energy.curtailed, 4); balance(site);

  const f = grid(), reverseBank = device(f.site, 6, 5, 'battery', 30), reverseLoad = device(f.site, 4, 5, 'farm');
  const reverse = breaker(f.site, 5, 5, 'east', true);
  updatePower(f.s, f.site); assert.equal(reverseLoad.powered, true); close(reverseBank.charge, 28);
  setBreaker(f.s, 'surface', 5, 5, false, 'east', 'manual');
  assert.equal(reverseLoad.powered, false);
  assert.deepEqual(breakerConditions(f.s, f.site, reverse).sourceEntities, ['tile:surface:6:5']);
  updatePower(f.s, f.site); close(reverseBank.charge, 28); balance(f.site);
});

test('two terminal memberships never duplicate batteries, demand or operation wear', () => {
  const { s, site } = grid(), left = device(site, 4, 5, 'battery', 17), right = device(site, 6, 5, 'battery', 93);
  const b = breaker(site, 5, 5);
  for (const enabled of [false, true, false]) {
    setBreaker(s, 'surface', 5, 5, enabled, 'east', 'manual');
    const status = breakerConditions(s, site, b), operating = updatePower(s, site);
    recordOperation(s, site, operating);
    assert.equal(b.circuit, null); assert.equal(b.powered, false); assert.equal(operating.has(b), false);
    assert.equal(status.inputCircuit === status.outputCircuit, enabled);
    assert.equal(site.power.battery, 110); assert.equal(site.power.capacity, 240);
    assert.equal(site.power.output, 0); assert.equal(site.power.demand, 0); assert.equal(site.energy.consumed, 0);
    assert.equal(left.charge, 17); assert.equal(right.charge, 93);
    assert.equal(site.circuits.flatMap(c => c.cells).filter(c => c === '5,5:input').length, 1);
    assert.equal(site.circuits.flatMap(c => c.cells).filter(c => c === '5,5:output').length, 1);
    assert.equal(b.maintenance, undefined); balance(site); validatePower(s, site);
  }
});

test('disabled ordinary cable overlays still isolate the equipment terminal beside a breaker', () => {
  const { s, site } = grid(), source = device(site, 4, 5, 'solar'), b = breaker(site, 5, 5, 'east', true);
  const load = device(site, 6, 5, 'farm'); source.cable = { hp: 100, enabled: false };
  refreshPower(s, site); assert.equal(load.powered, false); assert.equal(site.power.output, 4);
  assert.notEqual(source.circuit, breakerConditions(s, site, b).inputCircuit);
  updatePower(s, site); assert.equal(site.energy.consumed, 0); assert.equal(site.energy.curtailed, 4);
  setCableEnabled(s, 'surface', source.x, source.y, true); assert.equal(load.powered, true);
  updatePower(s, site); assert.equal(site.energy.consumed, 2); balance(site);
});

test('burning contacts conduct until destroyed while breakers have no powered fault countdown or service wear', () => {
  const { s, site } = grid(), b = breaker(site, 11, 9, 'east', true);
  device(site, 10, 9, 'solar'); const load = device(site, 12, 9, 'farm');
  refreshPower(s, site);
  assert.equal(electrical(b), true); assert.equal(maintainable(b), false);
  assert.equal(BUILDINGS.breaker.demand, undefined); assert.equal(BUILDINGS.breaker.output, undefined);
  assert.equal(setAutoService(s, 'surface', 11, 9, true).ok, false);
  b.hp = 20; s.tick++; updateFire(s);
  assert.equal(b.fireFault, undefined); assert.equal(b.fire, undefined);
  recordOperation(s, site, new Set([b])); assert.equal(b.hp, 20); assert.equal(b.maintenance, undefined);
  assert.ok(ignite(s, site, b, 'overheating')); s.tick++; updateFire(s); refreshPower(s, site);
  assert.ok(b.hp < 20); assert.ok(breakerClosed(b)); assert.equal(load.powered, true);
  b.hp = .1; s.tick++; updateFire(s); refreshPower(s, site);
  assert.equal(b.hp, 0); assert.equal(b.fire, undefined); assert.equal(breakerClosed(b), false); assert.equal(load.powered, false);
  assert.equal(breakerConditions(s, site, b).blocked, 'damaged');
  assert.ok(site.incidents.some(i => i.target === 'structure' && i.cause === 'fire' && i.x === 11 && i.y === 9));
});

test('physical breaker repair preserves requested contact and trip state without inventing service history', () => {
  for (const tripped of [false, true]) {
    const s = createGame(), site = s.sites.surface, b = at(site, 11, 9);
    for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
    for (const c of s.crew) { c.labors.hauling = false; c.labors.production = false; }
    setFireResponse(s, 'surface', false);
    b.cable = null; b.building = 'breaker'; initializeStorage(b); initializeElectrical(b);
    Object.assign(b.protection, { enabled: true, mode: 'wet_fault', tripped, cause: tripped ? 'wet_fault' : null });
    damage(s, site, b, 'structure', 100, 'debris'); refreshPower(s, site);
    assert.equal(breakerClosed(b), false); const before = totalResources(s).alloy;
    const j = order(s, 'surface', b.x, b.y, 'repair').job; assert.ok(j); assert.deepEqual(j.cost, { alloy: 1 });
    until(s, () => s.crew.some(c => c.delivery?.job === j.id)); assert.equal(b.hp, 0);
    until(s, () => !s.jobs.includes(j));
    assert.equal(b.hp, 100); assert.equal(b.protection.enabled, true); assert.equal(b.protection.tripped, tripped);
    assert.equal(b.protection.cause, tripped ? 'wet_fault' : null); assert.equal(breakerClosed(b), !tripped);
    assert.equal(b.maintenance, undefined); close(totalResources(s).alloy, before - 1);
    if (tripped) { assert.ok(resetBreaker(s, 'surface', b.x, b.y).ok); assert.equal(b.protection.enabled, false); assert.equal(breakerClosed(b), false); }
    deserialize(serialize(s));
  }
});

test('no-breaker topology and allocator retain legacy BFS, fault order, life-support tie and disabled-overlay behavior', () => {
  const { s, site } = grid();
  device(site, 1, 1, 'solar'); const firstFault = wire(site, 2, 1); firstFault.liquid = .25;
  const firstBank = device(site, 3, 1, 'battery', 2), secondFault = wire(site, 2, 2); secondFault.liquid = .25;
  device(site, 4, 1, 'farm');
  device(site, 10, 1, 'solar'); const refinery = device(site, 11, 1, 'refinery'), scrubber = device(site, 12, 1, 'scrubber');
  scrubber.powerPriority = 3; device(site, 13, 1, 'farm'); const chargingBank = device(site, 11, 2, 'battery');
  device(site, 3, 5, 'battery', 10).cable = { hp: 100, enabled: false }; device(site, 4, 5, 'solar'); device(site, 5, 5, 'farm');
  device(site, 1, 10, 'solar').cable = { hp: 100, enabled: false }; device(site, 2, 10, 'farm');
  refreshPower(s, site);
  const membership = site.circuits.map(({ id, cells }) => ({ id, cells }));
  assert.deepEqual(membership, [
    { id: 'circuit-27', cells: ['1,1', '2,1', '3,1', '2,2', '4,1'] },
    { id: 'circuit-36', cells: ['10,1', '11,1', '12,1', '11,2', '13,1'] },
    { id: 'circuit-133', cells: ['3,5'] }, { id: 'circuit-134', cells: ['4,5', '5,5'] },
    { id: 'circuit-261', cells: ['1,10'] }, { id: 'circuit-262', cells: ['2,10'] },
  ]);
  const plan = previewPower(s, site);
  assert.deepEqual([...plan.suppliedFaults].map(t => [t.x, t.y]), [[2, 1]]);
  assert.equal(scrubber.powered, true); assert.equal(refinery.powered, false);
  updatePower(s, site); close(firstBank.charge, 1); close(chargingBank.charge, 1);
  close(firstFault.cable.hp, 99.75); close(secondFault.cable.hp, 100);
  assert.deepEqual(site.circuits.map(({ id, cells }) => ({ id, cells })), membership);
  close(site.energy.generated, 16); close(site.energy.consumed, 10); close(site.energy.curtailed, 6); balance(site);
});

test('genuine schema35 no-breaker circuit diagnostics survive migration and repeated previews unchanged', () => {
  const original = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/breakers-schema35-owned.json.gz', import.meta.url))));
  assert.equal(original.version, 35);
  const s = deserialize(JSON.stringify(original));
  for (const [id, site] of Object.entries(s.sites)) {
    assert.ok(!site.tiles.some(t => t.building === 'breaker'));
    for (let i = 0; i < 3; i++) refreshPower(s, site);
    const previous = original.sites[id];
    assert.deepEqual(site.circuits, previous.circuits); assert.deepEqual(site.power, previous.power); assert.deepEqual(site.energy, previous.energy);
    for (let i = 0; i < site.tiles.length; i++) {
      for (const field of ['circuit', 'powerStatus', 'powered', 'wetShort', 'charge']) assert.equal(site.tiles[i][field], previous.tiles[i][field]);
    }
    validatePower(s, site);
  }
});
