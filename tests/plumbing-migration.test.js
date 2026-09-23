import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, at, order, step, serialize, deserialize } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources, extract, add } from '../src/inventory.js';
import { initializeElectrical, refreshPower } from '../src/power.js';
import { newWaterPipe, waterNode } from '../src/plumbing.js';

const reload = s => deserialize(serialize(s));
const legacyText = () => gunzipSync(readFileSync(new URL('./fixtures/plumbing-schema34-owned.json.gz', import.meta.url))).toString('utf8');

function asSchema34(s) {
  const old = structuredClone(s);
  old.version = 34;
  for (const site of Object.values(old.sites)) {
    delete site.plumbing;
    for (const tile of site.tiles) {
      delete tile.waterPipe;
      delete tile.waterStore;
      delete tile.waterDevice;
    }
  }
  return old;
}

function install(s, kind, x, y) {
  const tile = at(s.sites.surface, x, y);
  assert.equal(tile.building, null);
  tile.building = kind;
  initializeStorage(tile);
  initializeElectrical(tile);
  return tile;
}

function fixture() {
  const s = createGame(35119), site = s.sites.surface;
  for (const tile of site.tiles) if (tile.machine) tile.machine.enabled = false;
  for (const c of s.crew) { c.labors.hauling = false; c.labors.production = false; }
  const tank = install(s, 'waterTank', 9, 9);
  const intake = install(s, 'waterIntake', 10, 9);
  const pipe = at(site, 11, 9); pipe.waterPipe = newWaterPipe();
  const pump = install(s, 'waterPump', 12, 9);
  const reservoir = install(s, 'waterReservoir', 13, 9);
  const outlet = install(s, 'waterOutlet', 13, 8);
  outlet.waterDevice.direction = 'north'; outlet.waterDevice.mode = 'floor';
  tank.machine.enabled = false;
  add(tank.machine.input, extract(at(site, 8, 10).stock, { water: 6 }));
  for (let x = 9; x <= 13; x++) at(site, x, 9).cable = { enabled: true, hp: 100 };
  for (let y = 7; y <= 10; y++) at(site, 13, y).cable = { enabled: true, hp: 100 };
  refreshPower(s, site); syncResources(s);
  reload(s);
  return { s, site, tank, intake, pipe, pump, reservoir, outlet };
}

function seedNode(f, tile, amount) {
  const moved = extract(at(f.site, 8, 10).stock, { water: amount });
  assert.equal(moved.water, amount);
  waterNode(tile).water += amount;
  f.site.plumbing.loaded += amount;
  syncResources(f.s);
}

test('genuine schema 34 capture includes existing wet ownership, gas, claims and construction reservations', () => {
  const old = JSON.parse(legacyText()), site = old.sites.surface;
  assert.equal(old.version, 34);
  assert.equal(site.tiles.reduce((sum, t) => sum + t.liquid, 0), 1.5);
  assert.equal(at(site, 11, 9).machine.input.water, 2);
  assert.equal(at(site, 11, 9).hp, 38);
  assert.equal(at(site, 12, 9).machine.output.water, .5);
  assert.equal(old.crew[0].carry.water, 6);
  assert.deepEqual(old.crew[0].delivery, { kind: 'input', target: [11, 9] });
  assert.equal(old.crew[1].intent.source, 'output');
  assert.equal(old.crew[1].intent.items.water, .5);
  assert.ok(old.jobs.some(job => job.sources.some(source => source.items.alloy > 0)));
  assert.ok(site.gasNetwork.extracted.co2 > 0 && site.gasNetwork.smoke.captured > 0);
  for (const st of Object.values(old.sites)) {
    assert.equal(st.plumbing, undefined);
    assert.ok(st.tiles.every(tile => tile.waterPipe === undefined && tile.waterStore === undefined && tile.waterDevice === undefined));
  }
});

test('schema 34 migration preserves all existing ownership, reservations, RNG and state without grants', () => {
  const text = legacyText(), old = JSON.parse(text), migrated = deserialize(text);
  assert.equal(migrated.version, 36);
  assert.deepEqual(asSchema34(migrated), old);
  assert.deepEqual(totalResources(migrated), totalResources(old));
  assert.equal(migrated.rng, old.rng);
  for (const site of Object.values(migrated.sites)) {
    assert.deepEqual(site.plumbing, { loaded: 0, recovered: 0, delivered: 0, released: 0 });
    assert.ok(site.tiles.every(tile => tile.waterPipe === null && tile.waterStore === undefined && tile.waterDevice === undefined));
  }
  assert.deepEqual(reload(migrated), migrated);
});

test('migrated wet floors, damaged tank and partially shipped water continue deterministically', () => {
  const first = deserialize(legacyText()), second = reload(first);
  step(first, 18); step(second, 18);
  assert.deepEqual(first, second);
  reload(first);
  assert.ok(first.tick > 0);
  assert.ok(first.sites.surface.liquids.released > 2, 'the existing damaged tank continues leaking');
});

test('schema 35 active plumbing reload preserves partial network transfers and cascading floor water', () => {
  const f = fixture();
  step(f.s, 5);
  assert.ok(f.site.plumbing.loaded > 0);
  assert.ok(f.site.tiles.some(tile => waterNode(tile)?.water > 0));
  const copy = reload(f.s);
  step(f.s, 18); step(copy, 18);
  assert.deepEqual(copy, f.s);
  assert.ok(f.site.plumbing.released > 0);
  reload(f.s);
});

test('current plumbing saves reject missing, invalid and over-capacity node water or valves', () => {
  for (const name of ['pipe', 'reservoir']) {
    for (const value of [undefined, -1, null, '1', Infinity]) {
      const f = fixture(), node = waterNode(f[name]);
      if (value === undefined) delete node.water;
      else node.water = value;
      assert.throws(() => reload(f.s), `${name} water ${String(value)}`);
    }
    for (const open of [undefined, 1, 'yes', null]) {
      const f = fixture(); waterNode(f[name]).open = open;
      assert.throws(() => reload(f.s), `${name} valve ${String(open)}`);
    }
    const f = fixture(), excess = name === 'pipe' ? 2.01 : 32.01;
    seedNode(f, f[name], excess);
    assert.throws(() => reload(f.s), `${name} finite capacity`);
  }
  for (const hp of [-1, 101, null, Infinity]) {
    const f = fixture(); f.pipe.waterPipe.hp = hp;
    assert.throws(() => reload(f.s), `pipe condition ${String(hp)}`);
  }
});

test('water ownership cannot be hidden on ordinary buildings, tanks, pumps or missing equipment', () => {
  const mutations = [
    f => { at(f.site, 8, 8).waterStore = { water: 0, open: true }; },
    f => { f.tank.waterStore = { water: 0, open: true }; },
    f => { f.pump.waterStore = { water: 0, open: true }; },
    f => { f.intake.waterStore = { water: 0, open: true }; },
    f => { f.outlet.waterStore = { water: 0, open: true }; },
    f => { delete f.reservoir.waterStore; },
    f => { f.reservoir.machine = { input: { water: 1 }, output: {}, batch: {}, progress: 0, enabled: true, status: 'Hidden' }; },
    f => { f.reservoir.waterPipe = newWaterPipe(); },
    f => { f.intake.waterPipe = newWaterPipe(); },
    f => { f.pipe.building = 'waterPipe'; },
    f => { f.pipe.terrain = 'void'; },
    f => { f.reservoir.terrain = 'ground'; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture(); mutate(f);
    assert.throws(() => reload(f.s), `invalid water owner ${index}`);
  }
});

test('water device saves reject wrong types, directions, modes and extraneous persisted controls', () => {
  const mutations = [
    f => { delete f.pump.waterDevice; },
    f => { f.pump.waterDevice.enabled = 'yes'; },
    f => { f.pump.waterDevice.direction = 'up'; },
    f => { f.pump.waterDevice.mode = 'floor'; },
    f => { f.intake.waterDevice.mode = 'stockpile'; },
    f => { delete f.intake.waterDevice.mode; },
    f => { f.outlet.waterDevice.direction = null; },
    f => { f.outlet.waterDevice.mode = 'both'; },
    f => { f.tank.waterDevice = { enabled: true, direction: 'east' }; },
    f => { f.reservoir.waterDevice = { enabled: true, direction: 'east' }; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture(); mutate(f);
    assert.throws(() => reload(f.s), `invalid water control ${index}`);
  }
});

test('plumbing ledgers reject missing, nonfinite, unbalanced and overflowing boundary transfers', () => {
  const mutations = [
    f => { delete f.site.plumbing; },
    f => { delete f.site.plumbing.recovered; },
    f => { f.site.plumbing.loaded = -1; },
    f => { f.site.plumbing.delivered = '0'; },
    f => { f.site.plumbing.released = Infinity; },
    f => { f.site.plumbing.loaded = 1; },
    f => { f.site.plumbing.recovered = 1; },
    f => { f.site.plumbing.delivered = 1; },
    f => { f.site.plumbing.released = 1; },
    f => { for (const field of ['loaded', 'recovered', 'delivered', 'released']) f.site.plumbing[field] = 1e308; },
    f => { f.pipe.waterPipe.water = 1; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture(); mutate(f);
    assert.throws(() => reload(f.s), `invalid plumbing history ${index}`);
  }
});

test('water pipe work validates job target, supplied cost, work duration and building ownership', () => {
  for (const kind of ['repairWaterPipe', 'removeWaterPipe']) {
    const f = fixture(); f.pipe.waterPipe.hp = 25;
    const result = order(f.s, 'surface', 11, 9, kind);
    assert.equal(result.ok, true); reload(f.s);
    const duration = reload(f.s); duration.jobs[0].work = 4; duration.jobs[0].remaining = 4;
    assert.throws(() => reload(duration));
    const target = reload(f.s); target.jobs[0].x = 8;
    assert.throws(() => reload(target));
    const building = reload(f.s); building.jobs[0].building = 'waterReservoir';
    assert.throws(() => reload(building));
    if (kind === 'repairWaterPipe') {
      const cost = reload(f.s); cost.jobs[0].cost = {}; cost.jobs[0].sources = [];
      assert.throws(() => reload(cost));
    }
  }
  const s = createGame(35129), site = s.sites.surface;
  assert.equal(order(s, 'surface', 11, 9, 'build', 'waterPipe').ok, true); reload(s);
  const cost = reload(s); cost.jobs[0].cost = {}; cost.jobs[0].sources = [];
  assert.throws(() => reload(cost));
  const duration = reload(s); duration.jobs[0].work = 3; duration.jobs[0].remaining = 3;
  assert.throws(() => reload(duration));
  install(s, 'waterReservoir', 11, 9); refreshPower(s, site);
  assert.throws(() => reload(s));
});

test('water device construction saves enforce their real material costs and work durations', () => {
  for (const kind of ['waterReservoir', 'waterPump', 'waterIntake', 'waterOutlet']) {
    const s = createGame(35131);
    assert.equal(order(s, 'surface', 11, 9, 'build', kind).ok, true); reload(s);
    const cost = reload(s); cost.jobs[0].cost = {}; cost.jobs[0].sources = [];
    assert.throws(() => reload(cost), `${kind} construction cannot discard its material requirement`);
    const work = reload(s); work.jobs[0].work += 1; work.jobs[0].remaining += 1;
    assert.throws(() => reload(work), `${kind} construction has a defined work duration`);
  }
});

test('schema 34 cannot smuggle new plumbing equipment or its construction into migration', () => {
  for (const kind of ['waterReservoir', 'waterPump', 'waterIntake', 'waterOutlet']) {
    const legacy = JSON.parse(legacyText());
    at(legacy.sites.surface, 8, 8).building = kind;
    assert.throws(() => reload(legacy), `${kind} did not exist in schema 34`);
  }
  const legacy = JSON.parse(legacyText());
  const job = legacy.jobs[0];
  job.building = 'waterPipe'; job.cost = { alloy: 1 }; job.work = 2; job.remaining = 2;
  job.sources[0].items = { alloy: 1 };
  assert.throws(() => reload(legacy), 'new water-pipe construction was not valid legacy work');
});
