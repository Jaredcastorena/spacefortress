import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at } from '../src/simulation.js';
import { initializeStorage } from '../src/inventory.js';
import { initializeElectrical, refreshPower, updatePower } from '../src/power.js';
import { GASES, gasAmount, mix, roomAt, refreshAtmosphere } from '../src/atmosphere.js';
import { validateFire } from '../src/fire.js';
import {
  newPipe, gasNode, gasPayload, gasCapacity, gasPressure, gasStatus,
  updateGasNetworks, setGasValve, setGasDevice, setGasExtractor,
  removeGas, validateGasNetworks,
} from '../src/gas-networks.js';

const close = (actual, expected, label='amount') => assert.ok(
  Math.abs(actual - expected) < 1e-7,
  `${label}: ${actual} != ${expected}`,
);
const plus = (to, from, factor=1) => { for (const k of GASES) to[k] += from[k] * factor; };

function base() {
  const s = createGame(), site = s.sites.surface;
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  refreshPower(s, site);
  return { s, site, room: roomAt(site, 9, 9) };
}
function install(s, kind, x, y) {
  const t = at(s.sites.surface, x, y);
  assert.equal(t.building, null);
  t.building = kind; t.hp = 100;
  initializeStorage(t); initializeElectrical(t);
  return t;
}
function pipe(site, x, y) {
  const t = at(site, x, y); t.pipe = newPipe(); return t;
}
function contaminate(site, room, co2, smoke) {
  // A fixture representing previous combustion: species conversion preserves
  // total gas, while smoke has its own explicitly recorded production source.
  room.gas.oxygen -= co2; room.gas.co2 += co2;
  room.smoke += smoke; site.fireSafety.smokeProduced += smoke;
  refreshAtmosphere(site);
}
function retain(site, room, tile, gas, smoke) {
  // A fixture representing a completed extraction, not a free resource grant.
  plus(room.gas, gas, -1); plus(gasNode(tile).gas, gas);
  plus(site.gasNetwork.extracted, gas);
  room.smoke -= smoke; gasNode(tile).smoke += smoke;
  site.gasNetwork.smoke.captured += smoke;
  refreshAtmosphere(site);
}
function totals(site) {
  const gas = { ...site.atmosphere.vented };
  let smoke = site.fireSafety.smokeCleared + site.fireSafety.smokeVented;
  for (const r of site.rooms) { plus(gas, r.gas); smoke += r.smoke; }
  for (const t of site.tiles) if (gasNode(t)) {
    plus(gas, gasNode(t).gas); smoke += gasNode(t).smoke;
  }
  return { gas, smoke };
}
function conserved(s, before) {
  const site = s.sites.surface, after = totals(site);
  for (const k of GASES) close(after.gas[k], before.gas[k], k);
  close(after.smoke, before.smoke, 'smoke');
  for (const t of site.tiles) if (gasNode(t)) {
    for (const k of GASES) assert.ok(gasNode(t).gas[k] >= 0, `${k} nonnegative`);
    assert.ok(gasNode(t).smoke >= 0, 'smoke nonnegative');
    assert.ok(gasPayload(t) <= gasCapacity(t) + 1e-8, 'finite payload capacity');
  }
  validateGasNetworks(s); validateFire(s);
}
function loop(withVent=true) {
  const f = base(), { s, site } = f;
  const extractor = install(s, 'gasExtractor', 8, 8), inlet = pipe(site, 9, 8);
  const pump = install(s, 'gasPump', 10, 8), reservoir = install(s, 'gasReservoir', 11, 8);
  const vent = withVent ? install(s, 'gasVent', 12, 8) : null;
  for (let x=8; x<=12; x++) at(site, x, 8).cable = { enabled:true, hp:100 };
  for (let y=8; y<=10; y++) at(site, 12, y).cable = { enabled:true, hp:100 };
  if (vent) assert.ok(setGasDevice(s, site.id, vent.x, vent.y, false, 'east', 150).ok);
  refreshPower(s, site); updatePower(s, site);
  assert.equal(extractor.powered, true); assert.equal(pump.powered, true);
  return { ...f, extractor, inlet, pump, reservoir, vent };
}

test('captured contaminants survive a pipe and pump into storage, then return through a supply vent', () => {
  const { s, site, room, extractor, reservoir, vent } = loop();
  contaminate(site, room, 8, 12);
  const before = totals(site), oxygen = room.gas.oxygen, inert = room.gas.inert;
  for (let i=0; i<100; i++) { s.tick++; updateGasNetworks(s); conserved(s, before); }
  assert.ok(reservoir.gasStore.gas.co2 > 1);
  assert.ok(reservoir.gasStore.smoke > 1);
  close(room.gas.oxygen, oxygen); close(room.gas.inert, inert);
  close(gasAmount(site.gasNetwork.delivered), 0);
  close(site.fireSafety.smokeCleared, 0);
  close(site.fireSafety.smokeVented, 0);

  const clean = { co2:room.gas.co2, smoke:room.smoke };
  assert.ok(setGasExtractor(s, site.id, extractor.x, extractor.y, false, 'filter', 100).ok);
  assert.ok(setGasDevice(s, site.id, vent.x, vent.y, true, 'east', 150).ok);
  updatePower(s, site);
  for (let i=0; i<100; i++) { s.tick++; updateGasNetworks(s); conserved(s, before); }
  assert.ok(room.gas.co2 > clean.co2, 'dirty supply raises room CO2 again');
  assert.ok(room.smoke > clean.smoke, 'dirty supply returns retained smoke');
  assert.ok(site.gasNetwork.delivered.co2 > 0);
  assert.ok(site.gasNetwork.smoke.released > 0);
  close(site.fireSafety.smokeCleared, 0);
});

test('smoke-only filter output occupies storage and crosses pipes and pumps without adding gas pressure or heat', () => {
  const { s, site, room, extractor, inlet, reservoir } = loop(false);
  contaminate(site, room, 0, 18);
  const before = totals(site), originalGas = { ...room.gas }, heat = room.heat;
  for (let i=0; i<250; i++) { s.tick++; updateGasNetworks(s); conserved(s, before); }
  assert.ok(reservoir.gasStore.smoke > 1, 'smoke-only inlet must not be treated as empty');
  assert.ok(room.smoke < 18);
  for (const t of [extractor, inlet, reservoir]) {
    close(gasAmount(gasNode(t).gas), 0);
    close(gasPressure(t), 0);
    close(gasPayload(t), gasNode(t).smoke);
  }
  for (const k of GASES) close(room.gas[k], originalGas[k]);
  close(room.heat, heat, 'gas storage does not model habitat heat transfer');
  close(site.fireSafety.smokeCleared, 0);
});

test('full nodes with different gas and smoke ratios never overflow or silently discard contents', () => {
  const { s, site, room } = base();
  contaminate(site, room, 8, 80);
  const extractor = install(s, 'gasExtractor', 9, 9), reservoir = install(s, 'gasReservoir', 10, 9);
  for (let x=8; x<=10; x++) at(site, x, 9).cable = { enabled:true, hp:100 };
  retain(site, room, extractor, { oxygen:1, inert:1, co2:0 }, 8);
  retain(site, room, reservoir, { oxygen:40, inert:20, co2:4 }, 16);
  const before = totals(site), remaining = { gas:{ ...room.gas }, smoke:room.smoke };
  refreshPower(s, site); updatePower(s, site);
  assert.equal(extractor.powered, true);
  for (let i=0; i<40; i++) { s.tick++; updateGasNetworks(s); conserved(s, before); }
  close(gasPayload(extractor), 10); close(gasPayload(reservoir), 80);
  assert.match(gasStatus(site, extractor).blocked, /full/i);
  for (const k of GASES) close(room.gas[k], remaining.gas[k]);
  close(room.smoke, remaining.smoke);
  close(site.fireSafety.smokeCleared, 0);
});

test('pressure flow between unequal volumes and smoke fractions never reverses the pressure difference', () => {
  const { s, site, room } = base();
  contaminate(site, room, 3, 65);
  const narrow = pipe(site, 9, 9), reservoir = install(s, 'gasReservoir', 10, 9);
  retain(site, room, narrow, { oxygen:2, inert:5, co2:1 }, 1);
  retain(site, room, reservoir, { oxygen:3, inert:5, co2:0 }, 55);
  const before = totals(site), initialDifference = gasPressure(narrow)-gasPressure(reservoir);
  assert.ok(initialDifference > 0);
  for (let i=0; i<120; i++) {
    const difference = gasPressure(narrow)-gasPressure(reservoir);
    s.tick++; updateGasNetworks(s); conserved(s, before);
    const after = gasPressure(narrow)-gasPressure(reservoir);
    assert.ok(after >= -1e-7, 'bounded flow must not overshoot equal gas density');
    assert.ok(after <= difference+1e-7, 'unpowered pressure flow cannot increase the difference');
  }
  assert.ok(gasPressure(narrow)-gasPressure(reservoir) < initialDifference);
});

test('a mostly-smoke supply respects its gas pressure target without losing retained smoke', () => {
  const { s, site, room } = base();
  contaminate(site, room, 0, 10);
  const vent = install(s, 'gasVent', 12, 9);
  vent.cable = { enabled:true, hp:100 };
  at(site, 12, 10).cable = { enabled:true, hp:100 };
  retain(site, room, vent, { oxygen:.63, inert:2.37, co2:0 }, 7);
  // Previously supplied finite breathing mix leaves only 0.1 gas unit needed
  // at the target. Most gas and smoke must therefore remain in the vent.
  at(site, 8, 10).stock.air -= 2.9;
  plus(room.gas, mix(2.9)); plus(site.atmosphere.injected, mix(2.9));
  refreshAtmosphere(site);
  const before = totals(site);
  refreshPower(s, site); updatePower(s, site);
  assert.equal(vent.powered, true);
  for (let i=0; i<15; i++) {
    s.tick++; updateGasNetworks(s); conserved(s, before);
    assert.ok(room.pressure <= 100+1e-8, 'vent must not overshoot its gas target');
  }
  close(room.pressure, 100);
  close(gasPayload(vent), 10-1/3);
  close(site.gasNetwork.smoke.released, 7/30);
  assert.match(gasStatus(site, vent).blocked, /target pressure/i);
});

for (const destination of [
  { name:'habitat', x:9, y:9, roomShare:1 },
  { name:'exterior', x:15, y:13, roomShare:0 },
  { name:'boundary wall', x:11, y:12, roomShare:.5 },
]) test(`closed ruptured pipe and dismantling preserve gas and smoke across ${destination.name} release`, () => {
  const { s, site, room } = base();
  contaminate(site, room, 2, 4);
  const t = pipe(site, destination.x, destination.y), mixture = { oxygen:2, inert:3, co2:1 };
  retain(site, room, t, mixture, 4);
  const before = totals(site);
  t.pipe.hp = 0;
  assert.ok(setGasValve(s, site.id, t.x, t.y, false).ok);
  updateGasNetworks(s); conserved(s, before);
  assert.ok(gasPayload(t) < 10, 'damage releases contents even behind a closed valve');
  removeGas(s, site, t, true); conserved(s, before);
  assert.equal(t.pipe, null);
  for (const k of GASES) {
    close(site.gasNetwork.delivered[k], mixture[k] * destination.roomShare);
    close(site.gasNetwork.vented[k], mixture[k] * (1-destination.roomShare));
  }
  close(site.gasNetwork.smoke.released, 4 * destination.roomShare);
  close(site.gasNetwork.smoke.vented, 4 * (1-destination.roomShare));
  close(site.fireSafety.smokeVented, 4 * (1-destination.roomShare));
  close(site.fireSafety.smokeCleared, 0);
});

test('repeated extraction, supply, valve changes and damage conserve every species and smoke at every step', () => {
  const { s, site, room, extractor, inlet, pump, reservoir, vent } = loop();
  contaminate(site, room, 20, 35);
  const before = totals(site);
  for (let i=0; i<360; i++) {
    if (i%31===0) assert.ok(setGasValve(s, site.id, inlet.x, inlet.y, i%62===0).ok);
    if (i%47===0) assert.ok(setGasDevice(s, site.id, pump.x, pump.y, true, i%94===0?'east':'west', 100).ok);
    if (i%53===0) assert.ok(setGasDevice(s, site.id, vent.x, vent.y, i%106===0, 'east', 140).ok);
    if (i%71===0) assert.ok(setGasExtractor(s, site.id, extractor.x, extractor.y, true, i%142===0?'filter':'exhaust', 98).ok);
    inlet.pipe.hp = i>=120&&i<180 ? 0 : 100;
    reservoir.hp = i>=240&&i<300 ? 25 : 100;
    s.tick++; updatePower(s, site); updateGasNetworks(s); conserved(s, before);
  }
  assert.ok(gasAmount(site.gasNetwork.extracted) > 5);
  assert.ok(site.gasNetwork.smoke.captured > 5);
  assert.ok(site.gasNetwork.smoke.released > 0);
  close(site.fireSafety.smokeCleared, 0);
});
