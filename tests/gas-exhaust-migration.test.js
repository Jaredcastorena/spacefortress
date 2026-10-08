import { assertSquareProtected, legacyText as squareText } from './helpers/legacy-square.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
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

test('genuine schema33 gas ownership remains exportable after protected square rejection', () => {
  assertSquareProtected(squareText('gas-schema33-retained'));
});





test('current saves preserve distinct held smoke and species without regenerating migration defaults', () => {
  const { s } = currentFixture();
  const first = reload(s), second = reload(first);
  assert.equal(first.version, VERSION);
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
