import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { tileAt, positionOf, horizontalNeighbors } from '../src/spatial.js';
import { emptyGas, mix, roomAt, refreshRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { GASES, gasAmount, addGas } from '../src/gas-species.js';
import { gasEnergy, gasLatentHeat, roomHeatCapacity, roomKelvin, GAS_REFERENCE_KELVIN } from '../src/gas-thermal.js';
import { roomPressure, roomOxygenPressure } from '../src/room-pressure.js';
import { gasNode, initializeGasTile, updateGasNetworks, validateGasNetworks } from '../src/gas-networks.js';
import { initializeElectrical, initializePower, updatePower, refreshPower } from '../src/power.js';
import { initializeStorage } from '../src/inventory.js';
import { validateGasWork } from '../src/gas-compression.js';
import { temperature, thermalSafe, validateThermal } from '../src/thermal.js';
import { storedWaterHeat } from '../src/water-thermal.js';
import { validateWaterVapor } from '../src/water-vapor.js';
import { airlockSideBlock } from '../src/airlock-access.js';
import { fixture as airlockFixture } from './helpers/airlock-fixture.js';

const K = GAS_REFERENCE_KELVIN;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const heat = site => site.rooms.reduce((n, room) => n + room.heat, 0) + site.tiles.reduce((n, tile) => n + (gasNode(tile)?.heat || 0), 0) + storedWaterHeat(site);
const gases = site => {
  const total = emptyGas();
  for (const room of site.rooms) addGas(total, room.gas);
  for (const tile of site.tiles) if (gasNode(tile)) addGas(total, gasNode(tile).gas);
  return total;
};
function validate(state) { validateGasNetworks(state); validateGasWork(state); validateThermal(state); validateWaterVapor(state); }
function seed(site, tile, gas, kelvin = K) {
  const node = gasNode(tile); node.gas = { ...gas }; node.heat = gasEnergy(gas, kelvin);
  addGas(site.gasNetwork.loaded, gas); site.thermal.gasLoaded += node.heat;
}
// All direct installation and finite stock/heat setup precedes acceptance.
// These are short subsystem fixtures, not paid construction or full cycles.
function extractorFixture() {
  const state = createGame(74265), site = state.sites.surface;
  for (const tile of site.tiles) {
    if (tile.machine) tile.machine.enabled = false;
    if (tile.climate) tile.climate.enabled = false;
    if (tile.gasDevice) tile.gasDevice.enabled = false;
    if (tile.building === 'solar') tile.hp = 0;
  }
  const drive = tileAt(site, { x: 12, y: 9, z: 0 }); assert.equal(drive.building, null);
  drive.building = 'gasExtractor'; initializeElectrical(drive); initializeGasTile(drive);
  const bank = horizontalNeighbors(positionOf(drive)).map(p => tileAt(site, p)).find(t => t && !t.building && t.terrain === 'floor');
  assert.ok(bank); bank.building = 'battery'; initializeElectrical(bank); initializeStorage(bank);
  initializePower(state, site, 0); bank.charge = 12; site.energy.initial += 12; refreshPower(state, site);
  return { state, site, drive, bank, room: roomAt(site, drive.x, drive.y, drive.z) };
}
function pulse(f) { updatePower(f.state, f.site); updateGasNetworks(f.state); }
function refillFixture({ pressure = 97, kelvin = K, oxygenFraction = .21 } = {}) {
  const amount = 2 * 10 * pressure / 100 * K / kelvin;
  const f = airlockFixture({ chamberGas: amount, reserveGas: 0, smoke: 0 });
  f.state = f.s;
  f.chamber.gas.oxygen = amount * oxygenFraction;
  f.chamber.gas.inert = amount - f.chamber.gas.oxygen - f.chamber.gas.co2;
  const before = f.chamber.heat;
  f.chamber.heat = roomHeatCapacity(f.chamber) * kelvin + gasLatentHeat(f.chamber.gas);
  const delta = f.chamber.heat - before; f.site.thermal[delta >= 0 ? 'added' : 'removed'] += Math.abs(delta);
  // Isolate the installed vent for one physical refill pulse; other controlled
  // gas ports remain closed. No controller traversal or policy is bypassed.
  f.vent.gasDevice.enabled = true; f.vent.gasDevice.target = 100; f.vent.gasStore.open = true;
  seed(f.site, f.vent, mix(2), kelvin); refreshAtmosphere(f.site); refreshPower(f.state, f.site);
  return f;
}
function assertRefill(f, beforeHeat, beforeSpecies) {
  assert.ok(gasAmount(f.vent.gasStore.gas) < 2 && gasAmount(f.vent.gasStore.gas) >= 0);
  assert.ok(f.site.gasNetwork.delivered.oxygen > 0);
  close(f.site.gasWork.allocated, 2); close(heat(f.site) - beforeHeat, 2);
  assert.ok(f.site.gasWork.work <= 1.3); assert.ok(f.site.energy.consumed >= 2);
  for (const key of GASES) close(gases(f.site)[key], beforeSpecies[key]);
  assert.equal(f.inner.doorMode, 'closed'); assert.equal(f.outer.doorMode, 'closed');
  validate(f.state);
}

test('one paid humid mixed-exhaust pulse retains vapor latent heat and proportional smoke with finite compression work', () => {
  const f = extractorFixture(), added = { ...emptyGas(), co2: .3, vapor: 2 }, kelvin = roomKelvin(f.room);
  const imported = gasEnergy(added, kelvin); addGas(f.room.gas, added); f.room.heat += imported;
  addGas(f.site.atmosphere.injected, added); f.site.thermal.gasLoaded += imported;
  f.room.smoke = 1; f.site.fireSafety.smokeProduced += 1; f.drive.gasDevice.mode = 'exhaust'; f.drive.gasDevice.target = 0;
  seed(f.site, f.drive, mix(8)); refreshAtmosphere(f.site);
  const source = { ...f.room.gas }, beforeSpecies = gases(f.site), beforeHeat = heat(f.site), nodeHeat = f.drive.gasStore.heat;
  pulse(f);
  const transferred = Object.fromEntries(GASES.map(key => [key, source[key] - f.room.gas[key]])), moved = gasAmount(transferred);
  assert.ok(moved > 0 && moved + f.drive.gasStore.smoke <= 2 + 1e-9);
  assert.ok(transferred.vapor > 0); close(f.drive.gasStore.smoke, moved / gasAmount(source));
  close(f.room.smoke + f.drive.gasStore.smoke, 1);
  for (const key of GASES) { close(transferred[key], source[key] * moved / gasAmount(source)); close(gases(f.site)[key], beforeSpecies[key]); }
  const workBudget = 3 * .65;
  assert.ok(f.site.gasWork.work > 0 && f.site.gasWork.work <= workBudget,
    `useful work ${f.site.gasWork.work} must be within paid budget ${workBudget}`);
  close(f.drive.gasStore.heat - nodeHeat, gasEnergy(transferred, kelvin) + f.site.gasWork.work);
  close(heat(f.site) - beforeHeat, 3); close(f.bank.charge, 9); close(f.site.energy.consumed, 3);
  close(f.site.gasWork.work + f.site.gasWork.motorRoom, 3); validate(f.state);
});

test('smoke-only filtering moves no gas or latent heat and cannot reuse its paid drive pulse', () => {
  const f = extractorFixture(); assert.equal(f.room.gas.co2, 0);
  f.room.smoke = 3; f.site.fireSafety.smokeProduced += 3; refreshRoom(f.room);
  const beforeHeat = heat(f.site), beforeSpecies = gases(f.site);
  pulse(f);
  close(f.drive.gasStore.smoke, 2); close(f.room.smoke, 1); close(gasAmount(f.drive.gasStore.gas), 0); close(f.drive.gasStore.heat, 0);
  close(f.site.gasWork.work, 0); close(f.site.gasWork.motorRoom, 3); close(heat(f.site) - beforeHeat, 3); close(f.bank.charge, 9);
  const settled = heat(f.site); updateGasNetworks(f.state);
  close(f.drive.gasStore.smoke, 2); close(f.room.smoke, 1); close(heat(f.site), settled); close(f.site.gasWork.allocated, 3);
  for (const key of GASES) close(gases(f.site)[key], beforeSpecies[key]); validate(f.state);
});

test('paid refill preserves the inner two-point pressure gap and outer one-point vacuum admission guards', () => {
  const inner = refillFixture(), beforeHeat = heat(inner.site), beforeSpecies = gases(inner.site);
  close(roomPressure(inner.chamber), 97); assert.equal(airlockSideBlock(inner.site, inner.controller, 'inner'), 'pressure_mismatch');
  pulse(inner); assertRefill(inner, beforeHeat, beforeSpecies);
  assert.ok(roomPressure(inner.chamber) <= 100 + 1e-9 && roomPressure(inner.chamber) > 99.99);
  assert.equal(airlockSideBlock(inner.site, inner.controller, 'inner'), null);
  const outer = refillFixture({ pressure: .99 }), outerHeat = heat(outer.site), outerSpecies = gases(outer.site);
  assert.equal(airlockSideBlock(outer.site, outer.controller, 'outer'), null);
  pulse(outer); assertRefill(outer, outerHeat, outerSpecies);
  assert.ok(roomPressure(outer.chamber) > 1); assert.equal(airlockSideBlock(outer.site, outer.controller, 'outer'), 'pressure_mismatch');
});

test('pressure-matched paid refill still rejects oxygen below point-sixteen or above point-three', () => {
  for (const oxygenFraction of [.1, .4]) {
    const f = refillFixture({ oxygenFraction }), beforeHeat = heat(f.site), beforeSpecies = gases(f.site);
    assert.equal(airlockSideBlock(f.site, f.controller, 'inner'), 'contaminated_mix');
    pulse(f); assertRefill(f, beforeHeat, beforeSpecies); close(roomPressure(f.chamber), 100);
    assert.ok(oxygenFraction < .16 ? roomOxygenPressure(f.chamber) < .16 : roomOxygenPressure(f.chamber) > .3);
    assert.equal(airlockSideBlock(f.site, f.controller, 'inner'), 'contaminated_mix');
  }
});

test('paid refill heat respects native five and thirty-five degree admission limits', () => {
  for (const [celsius, safeBefore, safeAfter] of [[4.9, false, false], [5, true, true], [34.99, true, false]]) {
    const f = refillFixture({ kelvin: 273.15 + celsius }), beforeHeat = heat(f.site), beforeSpecies = gases(f.site);
    assert.equal(thermalSafe(f.chamber), safeBefore);
    pulse(f); assertRefill(f, beforeHeat, beforeSpecies); close(roomPressure(f.chamber), 100);
    assert.ok(temperature(f.chamber) > celsius); assert.equal(thermalSafe(f.chamber), safeAfter);
    assert.equal(airlockSideBlock(f.site, f.controller, 'inner'), safeAfter ? null : 'unsafe_temperature');
    if (celsius === 34.99) assert.ok(temperature(f.chamber) > 35);
    if (celsius === 4.9) assert.ok(temperature(f.chamber) < 5);
  }
});
