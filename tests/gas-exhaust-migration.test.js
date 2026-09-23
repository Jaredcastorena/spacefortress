import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { initializeStorage, syncResources, totalResources } from '../src/inventory.js';
import { initializeElectrical, refreshPower } from '../src/power.js';
import { GASES, emptyGas, gasAmount, mix, roomAt, refreshAtmosphere } from '../src/atmosphere.js';
import { newPipe, gasNode } from '../src/gas-networks.js';

const reload = s => deserialize(serialize(s));
const addGas = (a, b) => { for (const species of GASES) a[species] += b[species]; };

function install(s, kind, x, y) {
  const tile = at(s.sites.surface, x, y);
  assert.equal(tile.building, null);
  tile.building = kind;
  initializeStorage(tile);
  initializeElectrical(tile);
  return tile;
}

function placePipe(site, x, y) {
  const tile = at(site, x, y);
  tile.pipe = newPipe();
  return tile;
}

function seedPackagedGas(s, tile, gas) {
  // Fixture ownership transfer: consume finite depot air before placing gas.
  at(s.sites.surface, 8, 10).stock.air -= gasAmount(gas);
  addGas(gasNode(tile).gas, gas);
  addGas(s.sites.surface.gasNetwork.loaded, gas);
}

function finishFixture(s) {
  for (const site of Object.values(s.sites)) {
    refreshAtmosphere(site);
    refreshPower(s, site);
  }
  syncResources(s);
  return s;
}

function asSchema33(s) {
  const legacy = structuredClone(s);
  legacy.version = 33;
  for (const site of Object.values(legacy.sites)) {
    delete site.plumbing;
    for (const tile of site.tiles) delete tile.waterPipe;
    delete site.gasNetwork.extracted;
    delete site.gasNetwork.smoke;
    for (const tile of site.tiles) if (gasNode(tile)) delete gasNode(tile).smoke;
  }
  return legacy;
}

function populatedLegacy() {
  const s = createGame(7319), site = s.sites.surface;
  const tank = install(s, 'gasTank', 11, 9);
  const pipe = placePipe(site, 12, 9);
  const pump = install(s, 'gasPump', 13, 9);
  const vent = install(s, 'gasVent', 13, 8);
  seedPackagedGas(s, tank, { oxygen: 3, inert: 8, co2: 2 });
  seedPackagedGas(s, pipe, { oxygen: 1, inert: 2, co2: 3 });
  seedPackagedGas(s, vent, mix(2));
  tank.gasStore.open = false;
  tank.machine.enabled = false;
  tank.machine.input.air = 5;
  at(site, 8, 10).stock.air -= 5;
  pipe.pipe.open = false;
  pipe.pipe.hp = 25;
  pump.gasDevice = { enabled: false, direction: 'north' };
  vent.gasDevice = { enabled: false, target: 117 };
  roomAt(site, 11, 9).smoke = 3;
  site.fireSafety.smokeProduced = 3;
  return asSchema33(finishFixture(s));
}

function currentFixture() {
  const s = createGame(7321), site = s.sites.surface;
  const extractor = install(s, 'gasExtractor', 11, 9);
  const reservoir = install(s, 'gasReservoir', 13, 9);
  const pipe = placePipe(site, 12, 9);
  const tank = install(s, 'gasTank', 11, 8);
  const vent = install(s, 'gasVent', 13, 8);
  const pump = install(s, 'gasPump', 10, 9);
  seedPackagedGas(s, tank, mix(4));
  seedPackagedGas(s, pipe, mix(2));
  seedPackagedGas(s, vent, mix(1));
  const room = roomAt(site, 11, 9);
  // A valid snapshot after finite extraction, before the next tick.
  room.gas.oxygen -= 5;
  room.gas.co2 += 4.5;
  extractor.gasStore.gas.co2 = .5;
  site.gasNetwork.extracted.co2 = .5;
  room.smoke = 1.25;
  reservoir.gasStore.smoke = .75;
  site.fireSafety.smokeProduced = 2;
  site.gasNetwork.smoke.captured = .75;
  finishFixture(s);
  reload(s); // Mutations below must start from a save accepted without repairs.
  return { s, site, extractor, reservoir, pipe, tank, vent, pump, room };
}

test('a genuine save produced and validated by schema 33 upgrades without rewriting existing state', () => {
  const legacyText = gunzipSync(readFileSync(new URL('./fixtures/gas-schema33-retained.json.gz', import.meta.url))).toString('utf8');
  const legacy = JSON.parse(legacyText);
  assert.equal(legacy.version, 33);
  const migrated = deserialize(legacyText);
  assert.equal(migrated.version, 36);
  assert.deepEqual(asSchema33(migrated), legacy);
  assert.deepEqual(totalResources(migrated), totalResources(legacy));
  assert.deepEqual(reload(migrated), migrated);
});

test('schema 33 migration preserves held mixtures, valves, damaged pipes, controls, room smoke and RNG', () => {
  const old = populatedLegacy(), before = structuredClone(old);
  const resources = totalResources(old), migrated = reload(old);
  assert.equal(migrated.version, 36);
  assert.deepEqual(old, before, 'deserialization must not mutate its input snapshot');
  assert.deepEqual(asSchema33(migrated), before, 'only the new empty exhaust state is added');
  assert.deepEqual(totalResources(migrated), resources);
  assert.equal(migrated.rng, old.rng);
  for (const site of Object.values(migrated.sites)) {
    assert.deepEqual(site.gasNetwork.extracted, emptyGas());
    assert.deepEqual(site.gasNetwork.smoke, { captured: 0, released: 0, vented: 0 });
    for (const tile of site.tiles) if (gasNode(tile)) assert.equal(gasNode(tile).smoke, 0);
    assert.ok(site.tiles.every(tile => !['gasExtractor', 'gasReservoir'].includes(tile.building)));
  }
  assert.deepEqual(reload(migrated), migrated, 'reloading a migrated save is idempotent');
});

test('schema 33 migration of an unmodified colony grants no gas, smoke, equipment or resources', () => {
  const old = asSchema33(createGame(7331)), migrated = reload(old);
  assert.equal(migrated.version, 36);
  assert.deepEqual(asSchema33(migrated), old);
  assert.deepEqual(totalResources(migrated), totalResources(old));
  for (const site of Object.values(migrated.sites)) {
    assert.ok(site.tiles.every(tile => !gasNode(tile) && !tile.gasDevice));
    assert.deepEqual(site.gasNetwork.extracted, emptyGas());
    assert.deepEqual(site.gasNetwork.smoke, { captured: 0, released: 0, vented: 0 });
  }
});

test('current saves preserve distinct held smoke and species without regenerating migration defaults', () => {
  const { s } = currentFixture();
  const first = reload(s), second = reload(first);
  assert.equal(first.version, 36);
  assert.deepEqual(first, s);
  assert.deepEqual(second, first);
});

test('current saves reject missing, negative, nonfinite and misplaced stored smoke', () => {
  for (const name of ['pipe', 'tank', 'vent', 'extractor', 'reservoir']) {
    for (const value of [undefined, -1, null, '1', Infinity]) {
      const fixture = currentFixture(), node = gasNode(fixture[name]);
      if (value === undefined) delete node.smoke;
      else node.smoke = value;
      assert.throws(() => reload(fixture.s), `${name} smoke ${String(value)}`);
    }
  }
  const { s, pipe } = currentFixture();
  pipe.pipe.gas.smoke = 1;
  assert.throws(() => reload(s), 'smoke is separate from the three pressure species');
});

test('save capacity includes stored smoke as well as gas in pipes and every reservoir size', () => {
  for (const name of ['pipe', 'vent', 'extractor', 'tank', 'reservoir']) {
    const fixture = currentFixture(), { s, site } = fixture, tile = fixture[name], node = gasNode(tile);
    const capacity = ['tank', 'reservoir'].includes(name) ? 80 : 10;
    const extraSmoke = capacity - gasAmount(node.gas) - node.smoke + .01;
    node.smoke += extraSmoke;
    site.gasNetwork.smoke.captured += extraSmoke;
    site.fireSafety.smokeProduced += extraSmoke;
    assert.throws(() => reload(s), `${name} cannot hide excess payload in smoke`);
  }
});

test('current saves reject malformed or unbalanced extraction and smoke histories', () => {
  const mutations = [
    f => { delete f.site.gasNetwork.extracted; },
    f => { f.site.gasNetwork.extracted = null; },
    f => { f.site.gasNetwork.extracted.co2 = -1; },
    f => { f.site.gasNetwork.extracted.oxygen = 1; },
    f => { f.site.gasNetwork.extracted.co2 = Infinity; },
    f => { f.site.gasNetwork.extracted.smoke = 0; },
    f => {
      // Each saved vector is finite, but intermediate arithmetic must be too.
      for (const key of ['loaded', 'extracted', 'delivered', 'vented']) f.site.gasNetwork[key].oxygen = 1e308;
    },
    f => { delete f.site.gasNetwork.smoke; },
    f => { f.site.gasNetwork.smoke = null; },
    f => { delete f.site.gasNetwork.smoke.released; },
    f => { f.site.gasNetwork.smoke.captured = -1; },
    f => { f.site.gasNetwork.smoke.released = '0'; },
    f => { f.site.gasNetwork.smoke.vented = Infinity; },
    f => { f.site.gasNetwork.smoke.captured += .25; },
    f => { f.site.gasNetwork.smoke.released += .25; },
    f => { f.site.gasNetwork.smoke.vented += .25; },
    // Keep the network balance valid: the independent fire balance must catch this.
    f => { f.reservoir.gasStore.smoke += .25; f.site.gasNetwork.smoke.captured += .25; },
    // Keep the fire balance valid: the network balance must catch this.
    f => { f.reservoir.gasStore.smoke += .25; f.site.fireSafety.smokeProduced += .25; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const fixture = currentFixture();
    mutate(fixture);
    assert.throws(() => reload(fixture.s), `invalid history mutation ${index}`);
  }
});

test('extractor save controls require enabled, a known mode and an integer pressure target', () => {
  const mutations = [
    f => { delete f.extractor.gasDevice; },
    f => { f.extractor.gasDevice.enabled = 'yes'; },
    f => { delete f.extractor.gasDevice.mode; },
    f => { f.extractor.gasDevice.mode = 'supply'; },
    f => { f.extractor.gasDevice.target = -1; },
    f => { f.extractor.gasDevice.target = 151; },
    f => { f.extractor.gasDevice.target = 99.5; },
    f => { f.extractor.gasDevice.target = null; },
    f => { f.extractor.gasDevice.direction = 'north'; },
    f => { f.reservoir.gasDevice = { enabled: true, mode: 'filter', target: 100 }; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const fixture = currentFixture();
    mutate(fixture);
    assert.throws(() => reload(fixture.s), `invalid extractor control mutation ${index}`);
  }
});
