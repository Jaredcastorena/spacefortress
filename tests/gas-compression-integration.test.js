import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { tileAt, positionOf, horizontalNeighbors } from '../src/spatial.js';
import { emptyGas, mix, gasAmount, roomAt, updateRooms, refreshAtmosphere } from '../src/atmosphere.js';
import { addGas } from '../src/gas-species.js';
import { gasEnergy, roomKelvin, GAS_REFERENCE_KELVIN } from '../src/gas-thermal.js';
import { roomPressure } from '../src/room-pressure.js';
import { gasNode, newPipe, initializeGasTile, updateGasNetworks, validateGasNetworks, gasStatus } from '../src/gas-networks.js';
import { initializeElectrical, initializePower, updatePower, refreshPower } from '../src/power.js';
import { availablePowerWork } from '../src/power-work.js';
import { validateGasWork } from '../src/gas-compression.js';
import { initializeStorage } from '../src/inventory.js';
import { initializeThermal, updateThermal, validateThermal } from '../src/thermal.js';
import { storedWaterHeat } from '../src/water-thermal.js';
import { executeAction } from '../src/controls.js';
import { observe, systemFor, startRecording, stopRecording, exportRecording } from '../src/telemetry.js';
import { gasDetails } from '../src/gas-panels.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const at = (site, x, y, z = 0) => tileAt(site, { x, y, z });
const heat = site => site.rooms.reduce((n, r) => n + r.heat, 0) + site.tiles.reduce((n, t) => n + (gasNode(t)?.heat || 0), 0) + storedWaterHeat(site);
const gases = site => {
  const total = emptyGas();
  for (const room of site.rooms) addGas(total, room.gas);
  for (const tile of site.tiles) if (gasNode(tile)) addGas(total, gasNode(tile).gas);
  return total;
};
const events = state => {
  stopRecording(state);
  const rows = exportRecording(state).trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).reason, 'stopped');
  return rows.filter(row => row.event).map(row => row.event);
};

// Explicit finite subsystem fixtures, not a claim of paid construction. Every
// operating pulse below uses native electrical allocation from the seeded bank.
function fixture(kind = 'gasPump', { z = 0, charge = 30, exterior = false } = {}) {
  const state = createGame(74264), site = state.sites.surface;
  if (z) {
    const upper = site.tiles.map(t => ({ x: t.x, y: t.y, z, terrain: t.x >= 10 && t.x <= 14 && t.y >= 7 && t.y <= 11 ? 'floor' : 'void',
      building: null, hp: 100, pipe: null, cable: null, liquid: 0, liquidHeat: 0, wetShort: false }));
    site.levels.push({ z, name: 'Compression test deck' }); site.tiles.push(...upper); updateRooms(site); initializeThermal(state);
  }
  for (const tile of site.tiles) {
    if (tile.machine) tile.machine.enabled = false;
    if (tile.climate) tile.climate.enabled = false;
    if (tile.gasDevice) tile.gasDevice.enabled = false;
    if (tile.building === 'solar') tile.hp = 0;
  }
  const drive = at(site, 12, 9, z); assert.equal(drive.building, null);
  drive.building = kind; drive.hp = 100; initializeElectrical(drive); initializeGasTile(drive);
  if (kind === 'gasPump') drive.gasDevice.direction = 'se';
  const inlet = at(site, 11, 8, z), outlet = at(site, 13, 9, z);
  if (kind === 'gasPump') { inlet.pipe = newPipe(); outlet.pipe = newPipe(); }
  const bank = horizontalNeighbors(positionOf(drive)).map(p => tileAt(site, p)).find(t => t && !t.building && t.terrain === 'floor' && t !== inlet && t !== outlet);
  assert.ok(bank); bank.building = 'battery'; bank.hp = 100; initializeElectrical(bank); initializeStorage(bank);
  if (exterior) { drive.terrain = 'ground'; updateRooms(site); }
  initializePower(state, site, 0); bank.charge = charge; site.energy.initial += charge; refreshPower(state, site);
  return { state, site, drive, bank, inlet, outlet };
}
function seed(site, tile, gas, kelvin = GAS_REFERENCE_KELVIN, smoke = 0) {
  const node = gasNode(tile); node.gas = { ...gas }; node.heat = gasEnergy(gas, kelvin); node.smoke = smoke;
  addGas(site.gasNetwork.loaded, gas); site.thermal.gasLoaded += node.heat;
  site.gasNetwork.smoke.captured += smoke; site.fireSafety.smokeProduced += smoke;
}
function pump(options) {
  const f = fixture('gasPump', options); seed(f.site, f.inlet, mix(1)); seed(f.site, f.outlet, mix(8)); return f;
}
function pay(f) { updatePower(f.state, f.site); }
function validate(f) { validateGasNetworks(f.state); validateGasWork(f.state); validateThermal(f.state); }

test('native uphill pumping is power-limited and converts one paid pulse into gas and motor heat', () => {
  const f = pump(), before = heat(f.site), species = gases(f.site);
  assert.equal(startRecording(f.state, { maxRecords: 150, maxBytes: 32000000 }).active, true);
  pay(f); updateGasNetworks(f.state);
  const moved = gasAmount(f.outlet.pipe.gas) - 8;
  assert.ok(moved > 0 && moved < 1); close(f.bank.charge, 27); close(f.site.energy.consumed, 3);
  close(f.site.gasWork.allocated, 3); assert.ok(f.site.gasWork.work > 0 && f.site.gasWork.work <= 3 * .65);
  close(f.site.gasWork.motorRoom + f.site.gasWork.work, 3); close(heat(f.site) - before, 3);
  for (const key of Object.keys(species)) close(gases(f.site)[key], species[key]);
  const work = events(f.state).find(e => e.id === 'gas.compression.applied');
  assert.equal(work.entity, 'tile:surface:12:9'); assert.equal(work.limitedByWork, true); close(work.amount, moved);
  assert.match(work.heatRecipient, /^room:surface:/); close(work.work + work.motorHeat, work.allocated);
  validate(f);
});

test('a prospective powered flag cannot fund flow, and repeated gas passes cannot reuse a paid pulse', () => {
  const f = pump(), before = serialize(f.state); assert.equal(f.drive.powered, true);
  updateGasNetworks(f.state); assert.equal(serialize(f.state), before);
  pay(f); updateGasNetworks(f.state); const after = serialize(f.state);
  refreshPower(f.state, f.site); const preview = serialize(f.state); updateGasNetworks(f.state);
  assert.equal(serialize(f.state), preview); close(f.site.gasWork.allocated, 3); assert.equal(availablePowerWork(f.state, f.site, f.drive), 0);
  assert.notEqual(after, before); const n = gasAmount(f.outlet.pipe.gas);
  pay(f); updateGasNetworks(f.state); assert.ok(gasAmount(f.outlet.pipe.gas) > n); close(f.site.gasWork.allocated, 6); validate(f);
});

test('a preview after an exact battery debit cannot cancel already delivered pump energy', () => {
  const a = pump({ charge: 3 }), b = pump({ charge: 3 }); pay(a); pay(b);
  close(a.bank.charge, 0); close(b.bank.charge, 0); refreshPower(b.state, b.site); assert.equal(b.drive.powered, false);
  updateGasNetworks(a.state); updateGasNetworks(b.state);
  assert.ok(gasAmount(b.outlet.pipe.gas) > 8); assert.deepEqual(b.outlet.pipe, a.outlet.pipe);
  assert.deepEqual(b.site.gasWork, a.site.gasWork); close(heat(b.site), heat(a.site)); validate(b);
});

test('a paid blocked drive settles its motor heat once and generic thermal updates do not duplicate it', () => {
  const f = fixture(), before = heat(f.site); f.inlet.pipe = null; pay(f); updateGasNetworks(f.state);
  close(f.site.gasWork.work, 0); close(f.site.gasWork.motorRoom, 3); close(heat(f.site) - before, 3);
  const equipment = f.site.thermal.equipment; updateThermal(f.state); close(f.site.thermal.equipment, equipment); validate(f);
});

test('an exterior drive retains only gas work and explicitly accounts for motor heat outside', () => {
  const f = pump({ exterior: true }), before = heat(f.site); assert.equal(roomAt(f.site, f.drive.x, f.drive.y), undefined);
  pay(f); updateGasNetworks(f.state);
  assert.ok(f.site.gasWork.work > 0); close(f.site.gasWork.motorRoom, 0);
  close(f.site.gasWork.motorSpace + f.site.gasWork.work, 3); close(heat(f.site) - before, f.site.gasWork.work); validate(f);
});

test('paid vent flow includes its full drive heat envelope in the final pressure target', () => {
  const f = fixture('gasVent'), room = roomAt(f.site, f.drive.x, f.drive.y);
  seed(f.site, f.drive, mix(2)); f.drive.gasDevice.target = Math.min(150, Math.floor(roomPressure(room)) + 1);
  const before = heat(f.site), pressureBefore = roomPressure(room); pay(f); updateGasNetworks(f.state);
  assert.ok(gasAmount(f.drive.gasStore.gas) < 2); assert.ok(f.site.gasWork.work > 0);
  assert.ok(roomPressure(room) > pressureBefore && roomPressure(room) <= f.drive.gasDevice.target + 1e-9);
  close(f.site.gasWork.allocated, 2); close(heat(f.site) - before, 2); validate(f);
});

test('paid filtering selects only CO2 while finite work and motor heat preserve total energy', () => {
  const f = fixture('gasExtractor'), room = roomAt(f.site, f.drive.x, f.drive.y), added = { ...emptyGas(), co2: 2 };
  const imported = gasEnergy(added, roomKelvin(room)); addGas(room.gas, added); room.heat += imported;
  addGas(f.site.atmosphere.injected, added); f.site.thermal.gasLoaded += imported; refreshAtmosphere(f.site);
  seed(f.site, f.drive, mix(8)); const oxygen = room.gas.oxygen, inert = room.gas.inert, before = heat(f.site), species = gases(f.site);
  pay(f); updateGasNetworks(f.state);
  assert.ok(f.drive.gasStore.gas.co2 > 0); close(room.gas.oxygen, oxygen); close(room.gas.inert, inert);
  assert.ok(f.site.gasWork.work > 0); close(heat(f.site) - before, 3);
  for (const key of Object.keys(species)) close(gases(f.site)[key], species[key]); validate(f);
});

test('smoke-only pumping uses no fictitious gas work and still pays the drive', () => {
  const f = fixture(); seed(f.site, f.inlet, emptyGas(), GAS_REFERENCE_KELVIN, 2);
  const before = heat(f.site); pay(f); updateGasNetworks(f.state);
  close(f.outlet.pipe.smoke, 2); close(f.inlet.pipe.smoke, 0); close(f.site.gasWork.work, 0);
  close(f.site.gasWork.motorRoom, 3); close(f.outlet.pipe.heat, 0); close(heat(f.site) - before, 3); validate(f);
});

test('upper-floor funded work retains actual-deck gas and motor owners', () => {
  const f = pump({ z: 1 }), lower = f.site.rooms.filter(r => r.z === 0).reduce((n, r) => n + r.heat, 0);
  assert.equal(startRecording(f.state, { maxRecords: 150, maxBytes: 32000000 }).active, true);
  pay(f); updateGasNetworks(f.state);
  close(f.site.rooms.filter(r => r.z === 0).reduce((n, r) => n + r.heat, 0), lower);
  const event = events(f.state).find(e => e.id === 'gas.compression.applied');
  assert.equal(event.entity, 'tile:surface:12:9:1'); assert.match(event.heatRecipient, /:1$/); assert.equal(event.to, 'tile:surface:13:9:1'); validate(f);
});

test('shared player and agent ticks preserve compression through exact save continuation and labelled observations', () => {
  const f = pump(), twin = deserialize(serialize(f.state));
  assert.equal(executeAction(f.state, 'simulation.step', { ticks: 1 }, 'player').ok, true);
  assert.equal(executeAction(twin, 'simulation.step', { ticks: 1 }, 'agent').ok, true);
  assert.equal(serialize(f.state), serialize(twin)); assert.ok(f.site.gasWork.work > 0);
  const restored = deserialize(serialize(f.state));
  for (const state of [f.state, restored]) assert.equal(executeAction(state, 'simulation.step', { ticks: 1 }, 'agent').ok, true);
  assert.equal(serialize(f.state), serialize(restored));
  const observation = observe(f.state); assert.equal(observation.schemaVersion, 16);
  assert.deepEqual(observation.entities['site:surface'].gasWork, f.site.gasWork);
  assert.equal(systemFor('site', ['gasWork', 'work']), 'gas_compression'); assert.equal(systemFor('site', ['thermal', 'compression']), 'gas_compression');
  assert.equal(gasStatus(f.site, f.drive).maxCompressionWork, 3 * .65);
  assert.match(gasDetails(f.site, f.drive), /Higher outlet pressure can reduce flow/);
});

test('paid exhaust reaches its positive pressure target after retaining source motor heat', () => {
  const f = fixture('gasExtractor'), room = roomAt(f.site, f.drive.x, f.drive.y);
  f.drive.gasDevice.mode = 'exhaust'; f.drive.gasDevice.target = 99;
  // Keep enough physical storage for the 35-tile room's one-point reduction.
  seed(f.site, f.drive, mix(4));
  const before = heat(f.site), species = gases(f.site), initialAmount = gasAmount(room.gas);
  let pulses = 0;
  while (roomPressure(room) > f.drive.gasDevice.target + 1e-9 && pulses < 4) {
    pay(f); updateGasNetworks(f.state); pulses++;
  }
  assert.ok(initialAmount > gasAmount(room.gas));
  assert.ok(pulses > 0 && f.site.gasWork.work > 0 && f.site.gasWork.work <= pulses * 3 * .65);
  close(roomPressure(room), f.drive.gasDevice.target);
  assert.equal(gasStatus(f.site, f.drive).blocked, 'Room at target pressure');
  close(heat(f.site) - before, pulses * 3); close(f.bank.charge, 30 - pulses * 3);
  for (const key of Object.keys(species)) close(gases(f.site)[key], species[key]); validate(f);
});
