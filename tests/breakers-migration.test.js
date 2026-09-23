import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, at, order, step, serialize, deserialize } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources, extract, spill } from '../src/inventory.js';
import { initializeElectrical, refreshPower, updatePower, validatePower } from '../src/power.js';
import { executeAction } from '../src/controls.js';
import { observe } from '../src/telemetry.js';

const reload = s => deserialize(serialize(s));
const legacyText = () => gunzipSync(readFileSync(new URL('./fixtures/breakers-schema35-owned.json.gz', import.meta.url))).toString('utf8');

function install(s, kind, x, y) {
  const tile = at(s.sites.surface, x, y);
  assert.equal(tile.building, null);
  tile.building = kind;
  initializeStorage(tile); initializeElectrical(tile);
  return tile;
}

function fixture({ wet = true, closed = true } = {}) {
  const s = createGame(36107), site = s.sites.surface;
  for (const tile of site.tiles) {
    tile.cable = null;
    if (tile.machine) tile.machine.enabled = false;
  }
  for (const c of s.crew) { c.labors.hauling = false; c.labors.production = false; }
  const bank = install(s, 'battery', 9, 9);
  const originalBank = at(site, 13, 7);
  originalBank.charge -= 60; bank.charge = 60;
  const breaker = install(s, 'breaker', 10, 9);
  const fault = at(site, 11, 9); fault.cable = { enabled: true, hp: 100 };
  at(site, 12, 9).cable = { enabled: true, hp: 100 };
  const load = install(s, 'waterPump', 13, 9);
  if (wet) {
    const moved = extract(at(site, 8, 10).stock, { water: 2 });
    fault.liquid = moved.water; site.liquids.released += moved.water;
  }
  refreshPower(s, site); syncResources(s);
  const configured = executeAction(s, 'power.breaker', {
    site: 'surface', x: 10, y: 9, enabled: closed, direction: 'east', mode: 'wet_fault',
  });
  assert.equal(configured.ok, true, configured.message);
  reload(s);
  return { s, site, bank, originalBank, breaker, fault, load };
}

test('genuine schema 35 fixture retains water, charge, switches, priorities, exhaust and claims', () => {
  const old = JSON.parse(legacyText()), site = old.sites.surface;
  assert.equal(old.version, 35);
  assert.equal(site.tiles.reduce((n, t) => n + (t.waterPipe?.water || t.waterStore?.water || 0), 0), 1);
  assert.equal(site.tiles.reduce((n, t) => n + t.liquid, 0), 1.5);
  assert.equal(at(site, 13, 7).charge, 111);
  assert.equal(at(site, 12, 11).cable.enabled, false);
  assert.equal(at(site, 12, 11).waterPipe.open, false);
  assert.equal(at(site, 12, 11).waterPipe.hp, 31);
  assert.equal(at(site, 11, 10).powerPriority, 5);
  assert.equal(at(site, 11, 8).powerPriority, 1);
  assert.ok(site.gasNetwork.smoke.captured > 0);
  assert.equal(old.crew[0].carry.water, 6);
  assert.equal(old.crew[1].intent.items.water, .5);
  assert.ok(old.jobs.length > 0);
  assert.ok(Object.values(old.sites).every(st => st.tiles.every(t => t.protection === undefined)));
});

test('schema 35 migration changes only the schema and grants no electrical state, topology or resources', () => {
  const old = JSON.parse(legacyText()), migrated = deserialize(legacyText());
  assert.equal(migrated.version, 36);
  const projected = structuredClone(migrated); projected.version = 35;
  assert.deepEqual(projected, old, 'ordinary circuits and all existing owned state must remain exact');
  assert.deepEqual(totalResources(migrated), totalResources(old));
  assert.equal(migrated.rng, old.rng);
  for (const site of Object.values(migrated.sites)) assert.ok(site.tiles.every(t => t.building !== 'breaker' && t.protection === undefined));
  assert.deepEqual(reload(migrated), migrated);
});

test('migrated busy schema 35 water, exhaust, power and shipment state resumes deterministically', () => {
  const s = deserialize(legacyText()), copy = reload(s);
  step(s, 16); step(copy, 16);
  assert.deepEqual(s, copy);
  reload(s);
});

test('save immediately before a supplied wet trip resumes identically without a load-time trip', () => {
  const { s, site, breaker, fault } = fixture();
  assert.equal(breaker.protection.tripped, false);
  assert.equal(fault.wetShort, true, 'the closed branch previews a supplied wet fault');
  const before = serialize(s), copy = reload(s);
  assert.equal(serialize(s), before);
  assert.equal(at(copy.sites.surface, 10, 9).protection.tripped, false);
  updatePower(s, site); updatePower(copy, copy.sites.surface);
  assert.equal(breaker.protection.tripped, true);
  assert.deepEqual(s, copy);
  refreshPower(s, site); refreshPower(copy, copy.sites.surface);
  assert.deepEqual(reload(s), s);
});

test('save immediately after a trip retains its latch and deterministic recovery continuation', () => {
  const { s, site, breaker } = fixture();
  updatePower(s, site); refreshPower(s, site);
  assert.equal(breaker.protection.tripped, true);
  const copy = reload(s);
  for (const state of [s, copy]) {
    const opened = executeAction(state, 'power.breaker', { site: 'surface', x: 10, y: 9, enabled: false, direction: 'east', mode: 'wet_fault' });
    assert.equal(opened.ok, true);
    assert.equal(executeAction(state, 'power.breaker.reset', { site: 'surface', x: 10, y: 9 }).ok, true);
    assert.equal(executeAction(state, 'power.breaker', { site: 'surface', x: 10, y: 9, enabled: true, direction: 'east', mode: 'wet_fault' }).ok, true);
    updatePower(state, state.sites.surface);
  }
  assert.equal(breaker.protection.tripped, true, 'closing into the same supplied fault retrips');
  step(s, 8); step(copy, 8);
  assert.deepEqual(s, copy);
  reload(s);
});

test('inspection, validation, refresh, load and rejected controls cannot trip or spend resources', () => {
  const { s, site, breaker, fault } = fixture();
  assert.equal(fault.wetShort, true);
  const before = structuredClone(s), resources = totalResources(s);
  for (let i = 0; i < 5; i++) {
    refreshPower(s, site); validatePower(s, site); observe(s);
    assert.deepEqual(reload(s), s);
    assert.equal(executeAction(s, 'power.breaker', { site: 'surface', x: 10, y: 9, enabled: true, direction: 'north', mode: 'wet_fault' }).ok, false);
    assert.equal(executeAction(s, 'power.breaker.reset', { site: 'surface', x: 10, y: 9 }).ok, false);
  }
  assert.equal(breaker.protection.tripped, false);
  assert.deepEqual(s, before);
  assert.deepEqual(totalResources(s), resources);
});

test('current saves reject malformed protection ownership, controls and cause/latch state', () => {
  const mutations = [
    f => { delete f.breaker.protection; },
    f => { f.breaker.protection = null; },
    f => { f.breaker.protection.kind = 'fuse'; },
    f => { f.breaker.protection.direction = 'up'; },
    f => { f.breaker.protection.enabled = 'yes'; },
    f => { f.breaker.protection.mode = 'overload'; },
    f => { f.breaker.protection.tripped = 1; },
    f => { f.breaker.protection.cause = 'wet_fault'; },
    f => { f.breaker.protection.tripped = true; f.breaker.protection.cause = null; },
    f => { f.breaker.protection.tripped = true; f.breaker.protection.cause = 'overload'; },
    f => { f.breaker.protection.rating = 8; },
    f => { f.breaker.protection.inputCircuit = 'invented'; },
    f => { f.bank.protection = structuredClone(f.breaker.protection); },
    f => { at(f.site, 8, 8).protection = structuredClone(f.breaker.protection); },
    f => { f.breaker.cable = { enabled: true, hp: 100 }; },
    f => { f.breaker.terrain = 'ground'; },
    f => { f.breaker.charge = 1; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture({ wet: false }); mutate(f);
    assert.throws(() => reload(f.s), `invalid protection state ${index}`);
  }
});

test('serialized breaker and circuit diagnostics cannot invent terminal membership or supply', () => {
  const mutations = [
    f => { f.breaker.circuit = f.bank.circuit; },
    f => { f.breaker.powered = true; },
    f => { f.breaker.powerStatus = 'Powered'; },
    f => { f.site.circuits[0].cells.push('10,9'); },
    f => { f.site.circuits[0].id = 'circuit-forged-terminal'; },
    f => { f.site.circuits[0].used += 1; },
    f => { f.site.power.used += 1; },
    f => { f.site.energy.consumed += 1; },
    f => { f.bank.charge += 1; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture({ wet: false, closed: false }); mutate(f);
    assert.throws(() => reload(f.s), `invalid electrical diagnostic ${index}`);
  }
});

test('breaker construction saves require exact material cost, work and an unobstructed habitat tile', () => {
  const s = createGame(36111), site = s.sites.surface;
  assert.equal(order(s, 'surface', 11, 9, 'build', 'breaker').ok, true); reload(s);
  const cost = reload(s); cost.jobs[0].cost = {}; cost.jobs[0].sources = [];
  assert.throws(() => reload(cost));
  const work = reload(s); work.jobs[0].work += 1; work.jobs[0].remaining += 1;
  assert.throws(() => reload(work));
  const overlay = reload(s); at(overlay.sites.surface, 11, 9).cable = { enabled: false, hp: 100 }; refreshPower(overlay, overlay.sites.surface);
  assert.throws(() => reload(overlay), 'even a disabled cable bypasses the intended physical installation rule');
  const placement = reload(s); at(placement.sites.surface, 11, 9).terrain = 'ground';
  assert.throws(() => reload(placement));
  const target = reload(s); at(target.sites.surface, 11, 9).building = 'commons';
  assert.throws(() => reload(target));
  assert.equal(at(site, 11, 9).building, null);
});

test('breaker repair and dismantling saves retain their defined physical work and material requirements', () => {
  for (const kind of ['repair', 'remove']) {
    const f = fixture({ wet: false, closed: false });
    f.breaker.hp = 25; refreshPower(f.s, f.site);
    assert.equal(order(f.s, 'surface', 10, 9, kind).ok, true); reload(f.s);
    const work = reload(f.s); work.jobs[0].work = 1; work.jobs[0].remaining = 1;
    assert.throws(() => reload(work), `${kind} cannot replace physical work with an arbitrary duration`);
    const cost = reload(f.s);
    if (kind === 'repair') { cost.jobs[0].cost = {}; cost.jobs[0].sources = []; }
    else {
      cost.jobs[0].cost = { alloy: 1 };
      cost.jobs[0].sources = [{ x: 8, y: 10, kind: 'stock', items: { alloy: 1 } }];
    }
    assert.throws(() => reload(cost), `${kind} has a defined material cost`);
  }
});

test('a finite pile arriving after breaker designation survives reload with construction reservations intact', () => {
  const s = createGame(36113), site = s.sites.surface, target = at(site, 11, 9);
  const ordered = order(s, 'surface', 11, 9, 'build', 'breaker');
  assert.equal(ordered.ok, true);
  const reserved = structuredClone(ordered.job), before = totalResources(s);
  // A death/cancellation spill can arrive after the clear-tile placement check.
  spill(target, extract(at(site, 8, 10).stock, { water: 1 }));
  syncResources(s); refreshPower(s, site);
  const copy = reload(s);
  assert.deepEqual(copy.jobs[0], reserved);
  assert.deepEqual(at(copy.sites.surface, 11, 9).drop, { water: 1 });
  assert.deepEqual(totalResources(copy), before);
  assert.deepEqual(copy, s);

  const blocked = createGame(36113), blockedSite = blocked.sites.surface;
  spill(at(blockedSite, 11, 9), extract(at(blockedSite, 8, 10).stock, { water: 1 }));
  syncResources(blocked);
  assert.equal(order(blocked, 'surface', 11, 9, 'build', 'breaker').ok, false, 'initial placement still requires a clear tile');
});

test('schema 35 cannot contain breaker equipment, protection state or its construction jobs', () => {
  const equipment = JSON.parse(legacyText()); at(equipment.sites.surface, 8, 8).building = 'breaker';
  assert.throws(() => reload(equipment));
  const hidden = JSON.parse(legacyText()); at(hidden.sites.surface, 8, 8).protection = { kind: 'breaker', direction: 'east', enabled: false, mode: 'manual', tripped: false, cause: null };
  assert.throws(() => reload(hidden));
  const construction = JSON.parse(legacyText()), job = construction.jobs[0];
  job.building = 'breaker'; job.work = 8; job.remaining = 8; job.cost = { alloy: 4, components: 1 };
  job.sources[0].items = { alloy: 4, components: 1 };
  assert.throws(() => reload(construction));
});
