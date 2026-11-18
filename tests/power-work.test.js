import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { BUILDINGS } from '../src/data.js';
import { initializePower, initializeElectrical, previewPower, refreshPower, updatePower, validatePower } from '../src/power.js';
import { initializeStorage } from '../src/inventory.js';
import { setBreaker } from '../src/breakers.js';
import { commitPowerWork, availablePowerWork, claimPowerWork, closePowerWork } from '../src/power-work.js';

function context() {
  const tile = { x: 2, y: 3, z: 1, building: 'gasPump' }, site = { id: 'surface', tiles: [tile] };
  return { state: { tick: 4, sites: { surface: site } }, site, tile };
}
function grid(charge = 20) {
  const state = createGame(), site = state.sites.surface;
  for (const tile of site.tiles) {
    tile.building = null; tile.cable = null; tile.terrain = 'floor';
    for (const field of ['charge', 'powerPriority', 'machine', 'stock', 'climate', 'gasDevice']) delete tile[field];
  }
  initializePower(state, site, 0);
  const install = (x, y, building) => {
    const tile = at(site, x, y); tile.building = building; tile.hp = 100;
    initializeElectrical(tile); initializeStorage(tile); return tile;
  };
  const bank = install(1, 1, 'battery'); bank.charge = charge; site.energy.initial += charge;
  const pump = install(2, 1, 'gasPump'), vent = install(3, 1, 'gasVent'), extractor = install(4, 1, 'gasExtractor');
  return { state, site, bank, pump, vent, extractor, install };
}

test('a committed grant is numeric, nonserialized and claimable exactly once', () => {
  const { state, site, tile } = context(), before = serialize(state);
  commitPowerWork(state, site, [[tile, 3]]);
  assert.equal(availablePowerWork(state, site, tile), 3);
  assert.equal(availablePowerWork(state, site, tile), 3);
  assert.equal(claimPowerWork(state, site, tile), 3);
  assert.equal(claimPowerWork(state, site, tile), 0);
  assert.equal(availablePowerWork(state, site, tile), 0);
  assert.equal(serialize(state), before);
});

test('foreign identity, changed position or building and expired ticks cannot claim paid work', () => {
  const invalid = [
    f => [{ ...f.state }, f.site, f.tile],
    f => [f.state, { ...f.site }, f.tile],
    f => [f.state, f.site, { ...f.tile }],
    f => { f.state.tick++; return [f.state, f.site, f.tile]; },
    f => { f.tile.building = 'gasVent'; return [f.state, f.site, f.tile]; },
    ...['x', 'y', 'z'].map(key => f => { f.tile[key]++; return [f.state, f.site, f.tile]; }),
    f => { f.site.tiles = [{ ...f.tile }]; return [f.state, f.site, f.tile]; },
    f => { f.state.sites.surface = { ...f.site }; return [f.state, f.site, f.tile]; },
  ];
  for (const change of invalid) {
    const f = context(); commitPowerWork(f.state, f.site, [[f.tile, 3]]);
    const args = change(f); assert.equal(availablePowerWork(...args), 0); assert.equal(claimPowerWork(...args), 0);
  }
  const f = context(); commitPowerWork(f.state, f.site, [[f.tile, 3]]);
  const clone = structuredClone(f.state), clonedSite = clone.sites.surface;
  assert.equal(claimPowerWork(clone, clonedSite, clonedSite.tiles[0]), 0);
  assert.equal(claimPowerWork(f.state, f.site, f.tile), 3);
});

test('closing grants and invalid allocations cannot create serialized or nonfinite work', () => {
  const { state, site, tile } = context(), before = serialize(state);
  for (const amount of [-1, NaN, Infinity, '3']) assert.throws(() => commitPowerWork(state, site, [[tile, amount]]), TypeError);
  assert.throws(() => commitPowerWork(state, site, [[{ ...tile }, 3]]), TypeError);
  assert.throws(() => commitPowerWork(state, site, [[tile, 3], [tile, 3]]), TypeError);
  commitPowerWork(state, site, [[tile, 0]]); assert.equal(claimPowerWork(state, site, tile), 0);
  commitPowerWork(state, site, [[tile, 3]]); closePowerWork(state, site); closePowerWork(state, site);
  assert.equal(claimPowerWork(state, site, tile), 0); assert.equal(serialize(state), before);
});

test('only paid allocations fund full device demand and claims do not spend electricity again', () => {
  const { state, site, bank, pump, vent, extractor } = grid(); pump.hp = 50;
  refreshPower(state, site); assert.equal(pump.powered, true);
  assert.equal(availablePowerWork(state, site, pump), 0);
  const operating = updatePower(state, site);
  assert.ok(operating instanceof Set && operating.has(bank) && operating.has(pump));
  assert.equal(site.energy.consumed, 8); assert.equal(bank.charge, 12);
  const paid = serialize(state);
  for (const [tile, amount] of [[pump, 3], [vent, 2], [extractor, 3]]) {
    assert.equal(availablePowerWork(state, site, tile), amount); assert.equal(claimPowerWork(state, site, tile), amount);
    assert.equal(claimPowerWork(state, site, tile), 0);
  }
  assert.equal(claimPowerWork(state, site, bank), 0); assert.equal(serialize(state), paid);
});

test('preview, refresh and validation preserve a grant even when preview supply changes', () => {
  const { state, site, pump, vent, extractor } = grid();
  updatePower(state, site); previewPower(state, site); refreshPower(state, site); validatePower(state, site);
  assert.equal(availablePowerWork(state, site, pump), 3);
  // Control previews can replace powered caches after payment without erasing it.
  pump.gasDevice = { enabled: false, direction: 'ne' }; refreshPower(state, site); validatePower(state, site);
  assert.equal(pump.powered, false); assert.equal(claimPowerWork(state, site, pump), 3);
  previewPower(state, site); refreshPower(state, site); validatePower(state, site);
  assert.equal(availablePowerWork(state, site, pump), 0);
  assert.equal(availablePowerWork(state, site, vent), 2); assert.equal(availablePowerWork(state, site, extractor), 3);
});

test('zero and insufficient supply grant no unfunded work while a second same-tick payment creates a fresh epoch', () => {
  const empty = grid(0); updatePower(empty.state, empty.site);
  assert.equal(empty.site.energy.consumed, 0);
  for (const tile of [empty.pump, empty.vent, empty.extractor]) assert.equal(claimPowerWork(empty.state, empty.site, tile), 0);
  const scarce = grid(2); updatePower(scarce.state, scarce.site);
  assert.equal(claimPowerWork(scarce.state, scarce.site, scarce.pump), 0);
  assert.equal(claimPowerWork(scarce.state, scarce.site, scarce.vent), 2);
  assert.equal(claimPowerWork(scarce.state, scarce.site, scarce.extractor), 0);
  assert.equal(scarce.bank.charge, 0); assert.equal(scarce.site.energy.consumed, 2);
  const f = grid(), tick = f.state.tick; updatePower(f.state, f.site);
  assert.equal(claimPowerWork(f.state, f.site, f.pump), 3);
  updatePower(f.state, f.site); assert.equal(f.state.tick, tick);
  assert.equal(f.bank.charge, 4); assert.equal(f.site.energy.consumed, 16);
  assert.equal(claimPowerWork(f.state, f.site, f.pump), 3);
  const paid = serialize(f.state); closePowerWork(f.state, f.site);
  assert.equal(claimPowerWork(f.state, f.site, f.vent), 0); assert.equal(serialize(f.state), paid);
});

test('a failed new power commit expires the old grant and cannot publish unpaid work', () => {
  const { state, site, pump } = grid(); updatePower(state, site);
  assert.equal(availablePowerWork(state, site, pump), 3);
  site.energy = null;
  assert.throws(() => updatePower(state, site), TypeError);
  assert.equal(availablePowerWork(state, site, pump), 0);
});

test('only the final protected allocation grants work after a breaker trip', () => {
  const state = createGame(), site = state.sites.surface;
  for (const tile of site.tiles) { tile.cable = null; if (tile.machine) tile.machine.enabled = false; }
  function install(building, x, y) {
    const tile = at(site, x, y); assert.equal(tile.building, null); tile.building = building; tile.hp = 100;
    initializeStorage(tile); initializeElectrical(tile); return tile;
  }
  const source = install('advanced', 9, 9), breaker = install('breaker', 10, 9), load = install('scrubber', 11, 8), climate = install('climate', 11, 9);
  assert.equal(setBreaker(state, 'surface', 10, 9, true, 'ne', 'overload', 0, 4).ok, true);
  breaker.protection.overload.ticks = 2;
  assert.equal(previewPower(state, site).powered.has(load), true);
  const before = site.energy.consumed; state.tick++; updatePower(state, site);
  assert.equal(breaker.protection.tripped, true); assert.equal(site.energy.consumed, before);
  for (const tile of [source, breaker, load, climate]) assert.equal(availablePowerWork(state, site, tile), 0);
});

test('canonical reload grants nothing and original generic paid demand remains claimable', () => {
  const state = createGame(), site = state.sites.surface;
  updatePower(state, site); refreshPower(state, site); validatePower(state, site);
  const tile = site.tiles.find(t => availablePowerWork(state, site, t) > 0);
  assert.ok(tile); const demand = BUILDINGS[tile.building].demand, text = serialize(state), loaded = deserialize(text);
  assert.equal(serialize(loaded), text);
  const loadedSite = loaded.sites.surface, loadedTile = at(loadedSite, tile.x, tile.y);
  assert.equal(claimPowerWork(loaded, loadedSite, loadedTile), 0);
  assert.equal(claimPowerWork(state, site, tile), demand); assert.equal(serialize(state), text);
});
