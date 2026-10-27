import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, at, serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { emptyGas, fillRoom, refreshAtmosphere, gasAmount, SUIT_PER_POINT, setDoorMode } from '../src/atmosphere.js';
import { totalResources, initializeStorage, syncResources } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
import { suitRefillPlan, suitSupplyGoals, refillSuitFromSupply } from '../src/suit-supply.js';
import { refillMix, planDeparture, tryDeparture } from '../src/preflight.js';
import { observe, startRecording, exportRecording, tileEntityId } from '../src/telemetry.js';
import { distance } from '../src/geometry.js';

const close = (actual, expected, label = 'quantity') => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);
const records = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const refills = s => records(s).filter(r => r.event?.id === 'crew.suit.refilled').map(r => r.event);
const tick = s => { const result = executeAction(s, 'simulation.step', { ticks: 1 }, 'test'); assert.equal(result.ok, true); };
const allGas = s => totalResources(s).air + s.crew.reduce((n, c) => n + c.oxygen * SUIT_PER_POINT, 0)
  + Object.values(s.sites).reduce((n, site) => n + site.rooms.reduce((v, r) => v + gasAmount(r.gas), 0) + gasAmount(site.atmosphere.vented), 0);

// Synthetic scarcity boundaries; these do not establish an ordinary colony
// rescue. All later movement, breathing and inventory changes use shared rules.
function fixture({ vacuum = true } = {}) {
  const s = createGame(), site = s.sites.surface, c = s.crew[0], depot = at(site, 8, 10);
  for (const member of s.crew) for (const labor of Object.keys(member.labors)) member.labors[labor] = false;
  for (const tile of site.tiles) if (tile.machine) tile.machine.enabled = false;
  if (vacuum) for (const room of site.rooms) room.gas = emptyGas();
  refreshAtmosphere(site); refreshPower(s, site);
  c.x = 8; c.y = 9; c.oxygen = 10;
  return { s, site, c, depot };
}

function reconstruct(rows) {
  const observation = structuredClone(rows[0].observation);
  for (const row of rows.slice(1, -1)) {
    for (const change of row.changes || []) {
      if (!change.path.length) {
        if (change.op === 'remove') delete observation.entities[change.entity];
        else observation.entities[change.entity] = structuredClone(change.value);
        continue;
      }
      let target = observation.entities[change.entity];
      for (const key of change.path.slice(0, -1)) target = target[key];
      const key = change.path.at(-1);
      if (change.op === 'remove') delete target[key]; else target[key] = structuredClone(change.value);
    }
    if (row.fromTick !== undefined) observation.tick = row.tick;
  }
  return observation;
}

test('critical air recovery walks to finite packaged mix when no breathable room exists', () => {
  const { s, c, depot } = fixture(), before = depot.stock.air, start = [c.x, c.y];
  startRecording(s); tick(s);
  assert.equal(distance(start, [c.x, c.y]), 1, 'one physical movement step');
  assert.deepEqual([c.x, c.y], [depot.x, depot.y]);
  assert.equal(depot.stock.air, before, 'walking does not remotely consume stock');
  assert.equal(refills(s).length, 0);
  tick(s);
  assert.ok(c.oxygen > 10, 'physical depot recovery must replenish the suit');
  close(c.oxygen, 10 - .075 * 2 + 2);
  close(before - depot.stock.air, .2 / .21);
  assert.equal(refills(s).length, 1);
});

test('reachable breathable shelter stays preferred to packaged mix', () => {
  const { s, c, depot } = fixture({ vacuum: false }), before = depot.stock.air, position = [c.x, c.y];
  startRecording(s); tick(s);
  assert.deepEqual([c.x, c.y], position); close(c.oxygen, 12);
  assert.equal(depot.stock.air, before); assert.equal(refills(s).length, 0);
});

test('an unreachable safe room permits a real route to a local outdoor depot', () => {
  const { s, site, c, depot } = fixture({ vacuum: false });
  c.x = 10; c.y = 13; setDoorMode(s, 'surface', 10, 12, 'closed');
  const local = at(site, 10, 14); local.building = 'stockpile'; initializeStorage(local); local.stock = { air: 2 };
  const remote = depot.stock.air; startRecording(s); tick(s); tick(s);
  assert.deepEqual([c.x, c.y], [10, 14]); assert.ok(c.oxygen > 10);
  assert.ok(local.stock.air < 2); assert.equal(depot.stock.air, remote);
  assert.equal(refills(s)[0].target, tileEntityId('surface', 10, 14));
});

test('blocked or empty stores preserve blocked cargo handling and never consume a parcel', () => {
  for (const blocked of [true, false]) {
    const { s, site, c, depot } = fixture();
    c.x = 10; c.y = 13; c.carry = { air: 3 }; c.delivery = null;
    if (blocked) setDoorMode(s, 'surface', 10, 12, 'closed'); else delete depot.stock.air;
    at(site, c.x, c.y).drop = { air: 4 }; s.shuttle.supplies.air = 5; s.shuttle.freight.air = 6;
    at(s.sites.wreck, 4, 11).imports.air = 7;
    const before = totalResources(s).air, position = [c.x, c.y], energy = c.energy;
    startRecording(s); tick(s);
    assert.deepEqual([c.x, c.y], position); assert.equal(c.carry, null);
    assert.equal(at(site, ...position).drop.air, 7);
    assert.equal(totalResources(s).air, before); assert.equal(refills(s).length, 0);
    assert.ok(c.oxygen < 10); close(c.energy, energy - .03);
    assert.equal(records(s).filter(r => r.event?.id === 'crew.recovery.cargo_set_down').length, 1);
  }
});

test('finite conversion handles exact, partial, capped and zero refills without gas loss', () => {
  for (const [from, available, expected] of [[20, .2 / .21, 22], [20, .01, 20.021], [89.5, 9, 90], [90, 9, 90]]) {
    const { s, site, c, depot } = fixture(); c.x = depot.x; c.y = depot.y; c.oxygen = from; depot.stock.air = available;
    const before = allGas(s), plan = suitRefillPlan(c, { target: 90, maxPoints: 2, air: available });
    startRecording(s); const changed = refillSuitFromSupply(s, site, c, depot);
    assert.equal(changed, from < 90); close(c.oxygen, expected); close(allGas(s), before);
    close(available - (depot.stock.air || 0), plan.air); close(site.atmosphere.vented.inert, plan.ventedInert);
    assert.deepEqual(site.atmosphere.injected, emptyGas()); assert.equal(site.atmosphere.refilled, 0);
    assert.equal(refills(s).length, changed ? 1 : 0);
  }
  const { s, site, c, depot } = fixture(); c.x = depot.x; c.y = depot.y;
  depot.stock.air = .2 / .21 + 5e-11; const before = allGas(s);
  refillSuitFromSupply(s, site, c, depot);
  assert.ok(depot.stock.air > 0, 'positive sub-extraction remainder retains its owner'); close(allGas(s), before);
});

test('a successful refill completes the existing 90 percent air intent before the next breath', () => {
  const { s, c, depot } = fixture(); c.x = depot.x; c.y = depot.y; c.oxygen = 89.5; c.intent = { type: 'air', target: null };
  c.labors.mining = true;
  const ordered = executeAction(s, 'job.order', { site: 'surface', x: 17, y: 7, kind: 'mine' }, 'test');
  assert.equal(ordered.ok, true); const job = s.jobs.find(j => j.kind === 'mine');
  tick(s); assert.equal(c.oxygen, 90); assert.equal(c.intent, null); assert.equal(c.job, null);
  tick(s); assert.notEqual(c.intent?.type, 'air'); assert.equal(c.job, job.id, 'ordinary work resumes after the paid refill');
});

test('only local depot stock or operational dock imports supply a suit', () => {
  const { s, site, c, depot } = fixture(); c.x = depot.x; c.y = depot.y;
  c.carry = { air: 2 }; c.delivery = null; depot.drop = { air: 3 };
  s.shuttle.supplies.air = 4; s.shuttle.freight.air = 5;
  at(s.sites.wreck, 4, 11).imports.air = 6;
  const machine = at(site, 7, 7); machine.machine.input.air = 7;
  const owners = [c.carry, depot.drop, s.shuttle.supplies, s.shuttle.freight, at(s.sites.wreck, 4, 11).imports, machine.machine.input];
  const before = owners.map(owner => structuredClone(owner)); tick(s);
  assert.deepEqual(owners, before); close(c.oxygen, 11.925);
  const invalid = { ...depot, building: 'shuttle', stock: { air: 8 }, imports: { air: 9 }, drop: { air: 10 }, machine: { input: { air: 11 } } };
  assert.deepEqual(suitSupplyGoals({ tiles: [invalid] }), []);
  assert.equal(refillSuitFromSupply(s, site, c, invalid), false);
});

test('wreck recovery draws local operational dock imports and ignores a broken dock', () => {
  for (const hp of [100, 0]) {
    const { s, c, depot } = fixture(), site = s.sites.wreck, dock = at(site, 4, 11), remote = depot.stock.air;
    c.site = 'wreck'; c.x = 4; c.y = 10; dock.hp = hp; dock.imports.air = 2;
    startRecording(s); tick(s); tick(s);
    assert.equal(depot.stock.air, remote);
    if (hp) {
      assert.deepEqual([c.x, c.y], [4, 11]); assert.ok(c.oxygen > 10);
      close(dock.imports.air, 2 - .2 / .21); assert.equal(refills(s)[0].slot, 'imports');
      assert.equal(refills(s)[0].site, 'site:wreck');
    } else {
      assert.deepEqual([c.x, c.y], [4, 10]); assert.equal(dock.imports.air, 2); assert.equal(refills(s).length, 0);
    }
  }
});

test('stored mix, suit oxygen and vented inert remain conserved through ordinary ticks', () => {
  const { s, site } = fixture(), before = allGas(s), injected = structuredClone(site.atmosphere.injected);
  const inert = () => totalResources(s).air * .79 + Object.values(s.sites).reduce((sum, current) => sum + current.rooms.reduce((n, r) => n + r.gas.inert, 0) + current.atmosphere.vented.inert, 0);
  const beforeInert = inert();
  for (let i = 0; i < 4; i++) { tick(s); close(allGas(s), before); close(inert(), beforeInert); }
  assert.deepEqual(site.atmosphere.injected, injected); assert.equal(site.atmosphere.refilled, 0);
});

test('preflight shares the same conversion, pays its existing full cost and reaches 100 percent', () => {
  const s = createGame(), crew = s.crew.slice(0, 2), site = s.sites.surface;
  crew[0].oxygen = 53.125; crew[1].oxygen = 70.33;
  for (const c of crew) { c.x = 16; c.y = 11; }
  planDeparture(s, 'wreck', crew); s.departure.stage = 'boarding';
  const air = refillMix(crew), expected = crew.reduce((sum, c) => sum + (100 - c.oxygen) * .1 / .21, 0);
  assert.equal(air, expected); assert.equal(air, crew.reduce((sum, c) => sum + suitRefillPlan(c).air, 0));
  s.shuttle.supplies = { air: air + 10, fuel: 2, food: 2 };
  const before = allGas(s), vented = site.atmosphere.vented.inert; tryDeparture(s, () => {});
  assert.ok(s.mission); assert.ok(crew.every(c => c.oxygen === 100 && c.site === 'transit'));
  close(s.shuttle.supplies.air, 10); assert.equal(s.shuttle.supplies.fuel, 1); assert.equal(s.shuttle.supplies.food, undefined);
  close(site.atmosphere.vented.inert - vented, air * .79); close(allGas(s), before);
});

test('typed refill labels reconstruct recording state and preserve RNG, saves and deterministic reload', () => {
  const { s, c, depot } = fixture(); syncResources(s);
  const raw = serialize(s), plain = deserialize(raw); assert.equal(serialize(plain), raw);
  startRecording(s); const copy = deserialize(serialize(s));
  for (let i = 0; i < 3; i++) { tick(s); tick(plain); step(copy); assert.equal(serialize(s), serialize(plain)); assert.equal(serialize(s), serialize(copy)); }
  const refill = refills(s)[0];
  assert.deepEqual(Object.keys(refill).sort(), ['id', 'entity', 'actor', 'site', 'target', 'slot', 'air', 'oxygen', 'ventedInert', 'from', 'to'].sort());
  assert.equal(refill.entity, c.id); assert.equal(refill.actor, c.id); assert.equal(refill.site, 'site:surface');
  assert.equal(refill.target, tileEntityId('surface', depot.x, depot.y)); assert.equal(refill.slot, 'stock');
  close(refill.air, .2 / .21); close(refill.oxygen, .2); close(refill.ventedInert, refill.air * .79); close(refill.to - refill.from, 2);
  assert.deepEqual(reconstruct(records(s)), observe(s));
  const restored = deserialize(serialize(s)); assert.equal(serialize(restored), serialize(s));
  tick(s); step(restored); assert.equal(serialize(restored), serialize(s));
});

const invalidSupplyOwners = [
  ['foreign site', ({ s, c }) => {
    const site = s.sites.wreck, tile = at(site, 4, 11); tile.imports.air = 2;
    c.x = tile.x; c.y = tile.y; return { site, c, tile };
  }],
  ['foreign tile with matching coordinates', ({ s, site, c }) => {
    const tile = at(s.sites.wreck, 4, 11); tile.imports.air = 2;
    c.x = tile.x; c.y = tile.y; return { site, c, tile };
  }],
  ['detached tile', ({ site, c, depot }) => {
    c.x = depot.x; c.y = depot.y; return { site, c, tile: structuredClone(depot) };
  }],
  ['detached site with a canonical tile', ({ site, c, depot }) => {
    c.x = depot.x; c.y = depot.y; return { site: structuredClone(site), c, tile: depot };
  }],
  ['unowned crew clone with an owned ID', ({ site, c, depot }) => {
    c.x = depot.x; c.y = depot.y; return { site, c: structuredClone(c), tile: depot };
  }],
];
for (const [label, setup] of invalidSupplyOwners) {
  test(`suit supply rejects a positive source for ${label} without any mutation`, () => {
    const f = fixture(), { s } = f, args = setup(f);
    const source = args.tile.stock || args.tile.imports;
    assert.ok(source.air > .2 / .21, 'the ownership regression has enough real mix for a transfer');
    startRecording(s);
    const before = structuredClone({ state: s, ...args }), recording = exportRecording(s);
    const oxygen = args.c.oxygen, air = source.air;
    const transferred = refillSuitFromSupply(s, args.site, args.c, args.tile);
    assert.equal(transferred, false, `${label}: suit ${oxygen} -> ${args.c.oxygen}; source air ${air} -> ${source.air}`);
    assert.deepEqual({ state: s, ...args }, before, 'suit, all inventories and both canonical/detached gas ledgers remain exact');
    assert.equal(exportRecording(s), recording, 'rejection emits no event or state delta');
  });
}
