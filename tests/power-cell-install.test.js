import {withTemperaturePressureReadings} from './helpers/pressure-migration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { neighbors } from '../src/geometry.js';
import { createGame, at, step, serialize, deserialize, dischargeCell, cancelJob } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { initializeElectrical, refreshPower, releaseBatteryEnergy, CELL_CHARGE } from '../src/power.js';
import { initializeStorage, syncResources, totalResources } from '../src/inventory.js';
import { startRecording, exportRecording } from '../src/telemetry.js';
import { VERSION } from '../src/data.js';

const until = (s, label, predicate, limit = 800) => {
  for (let n = 0; n < limit && !predicate(); n++) step(s);
  assert.ok(predicate(), label);
};
function bankReady(s) {
  const site = s.sites.surface, bank = at(site, 13, 7), depot = at(site, 8, 10);
  for (const job of [...s.jobs]) cancelJob(s, job.id);
  releaseBatteryEnergy(site, bank); bank.cable.enabled = false; refreshPower(s, site);
  depot.stock.cells = (depot.stock.cells || 0) + 1; syncResources(s);
  return { site, bank, depot };
}

test('installation reserves one cell and injects 100 kJ only when haulers finish', () => {
  const s = createGame(), { site, bank, depot } = bankReady(s);
  const before = { cells: totalResources(s).cells, injected: site.energy.injected, charge: bank.charge };
  startRecording(s);
  const ordered = dischargeCell(s, bank.x, bank.y, bank.z);
  assert.equal(ordered.ok, true); assert.equal(ordered.job.kind, 'chargeCell'); assert.equal(ordered.job.priority, 5);
  assert.equal(bank.charge, before.charge); assert.equal(site.energy.injected, before.injected);
  assert.equal(totalResources(s).cells, before.cells); assert.equal(depot.stock.cells || 0, 0);
  const copy = deserialize(serialize(s));
  assert.equal(serialize(copy), serialize(s));
  until(s, 'cell installed', () => bank.charge === before.charge + CELL_CHARGE);
  assert.equal(site.energy.injected, before.injected + CELL_CHARGE);
  assert.equal(totalResources(s).cells, before.cells - 1);
  assert.equal(exportRecording(s).includes('"id":"power.cell.installed"'), true);
  assert.equal(serialize(deserialize(serialize(s))), serialize(s));
});

test('cancelling installation returns the reserved cell and adds no charge', () => {
  const s = createGame(), { site, bank } = bankReady(s), before = totalResources(s).cells;
  const ordered = dischargeCell(s, 13, 7);
  assert.equal(ordered.ok, true);
  cancelJob(s, ordered.job.id);
  assert.equal(s.jobs.some(j => j.kind === 'chargeCell'), false);
  assert.equal(bank.charge, 0); assert.equal(site.energy.injected, 0);
  assert.equal(totalResources(s).cells, before);
  step(s, 20); assert.equal(bank.charge, 0); assert.equal(totalResources(s).cells, before);
});

test('a full bank, a blocked route and a second order do not spend the cell', () => {
  const s = createGame(), { bank, depot } = bankReady(s);
  bank.charge = 30; const stock = depot.stock.cells;
  assert.equal(dischargeCell(s, 13, 7).ok, false); assert.equal(depot.stock.cells, stock);
  bank.charge = 0;
  for (const [x, y] of neighbors(bank.x, bank.y)) at(s.sites.surface, x, y).building = 'wall';
  assert.equal(dischargeCell(s, 13, 7).ok, false); assert.equal(depot.stock.cells, stock); assert.equal(bank.charge, 0);
});

test('agent and direct orders share the installation rule', () => {
  const s = createGame(), { bank } = bankReady(s);
  const agent = executeAction(s, 'power.discharge_cell', { x: bank.x, y: bank.y, z: bank.z }, 'agent');
  assert.equal(agent.ok, true); assert.equal(typeof agent.job, 'string');
  assert.equal(executeAction(s, 'power.discharge_cell', { x: bank.x, y: bank.y, z: bank.z }, 'player').ok, false);
  until(s, 'agent installation', () => bank.charge === CELL_CHARGE);
});

test('upper-floor installation charges that bank from a cell on the same floor', () => {
  const s = deserialize(gunzipSync(readFileSync(new URL('./fixtures/tools-schema63.json.gz', import.meta.url))).toString());
  for (const job of [...s.jobs]) cancelJob(s, job.id);
  const site = s.sites.surface, bank = at(site, 10, 9, 1), source = at(site, 10, 8, 1);
  bank.building = 'battery'; delete bank.machine; initializeStorage(bank); initializeElectrical(bank); bank.charge = 0; bank.hp = 100;
  source.drop = { ...(source.drop || {}), cells: (source.drop?.cells || 0) + 1 };
  for (const c of s.crew) if (c.site === 'surface') c.labors.hauling = true;
  syncResources(s); const before = totalResources(s).cells, injected = site.energy.injected;
  const ordered = executeAction(s, 'power.discharge_cell', { x: 10, y: 9, z: 1 }, 'player');
  assert.equal(ordered.ok, true); assert.equal(s.jobs.find(j => j.id === ordered.job).z, 1);
  until(s, 'upper cell installed', () => bank.charge === CELL_CHARGE);
  assert.equal(at(site, 10, 9, 0).charge, undefined);
  assert.equal(site.energy.injected, injected + CELL_CHARGE);
  assert.equal(totalResources(s).cells, before - 1);
  assert.equal(serialize(deserialize(serialize(s))), serialize(s));
});

test('schema 69 preserves state and rejects a forged installation job', () => {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/cells-schema69.json.gz', import.meta.url))).toString();
  assert.equal(createHash('sha256').update(raw).digest('hex'), '5da6c529da0d0326ae78160e06d6bc4f34e352344a943f2a6446820039f11747');
  const old = JSON.parse(raw), expected = structuredClone(old);
  assert.equal(old.version, 69); expected.version = VERSION;
  for (const site of Object.values(expected.sites)) for (const t of site.tiles) if (t.building === 'stockpile') t.storage.limits = {};
  const loaded = deserialize(raw);
  assert.ok(serialize(loaded) === JSON.stringify(withTemperaturePressureReadings(expected)), 'genuine schema69 changes only version, neutral depot metadata and derived room readings');
  old.jobs.push({ id: 'job-9000', site: 'surface', x: 13, y: 7, z: 0, kind: 'chargeCell', building: null, cost: { cells: 1 }, sources: [], materials: {}, work: 4, remaining: 4, worker: null, priority: 5, blockedReason: null, missingFood: 0, foodSpoiled: 0 });
  assert.throws(() => deserialize(JSON.stringify(old)), /Legacy power-cell installation/);
});


test('current saves reject unpaid or altered installation contracts', () => {
  const s = createGame(), { bank } = bankReady(s), ordered = dischargeCell(s, bank.x, bank.y, bank.z);
  assert.equal(ordered.ok, true);
  for (const alter of [j => { j.cost = {}; j.sources = []; }, j => { j.work = j.remaining = 1; }, j => { j.building = 'battery'; }, j => { j.missingFood = 1; }]) {
    const bad = JSON.parse(serialize(s)); alter(bad.jobs.find(j => j.id === ordered.job.id));
    assert.throws(() => deserialize(JSON.stringify(bad)), /Invalid paid power-cell installation/);
  }
});

for (const change of ['natural recharge', 'removed bank']) test(`${change} during delivery returns the cell without injecting energy`, () => {
  const s = createGame(), { site, bank } = bankReady(s), ordered = dischargeCell(s, bank.x, bank.y, bank.z);
  assert.equal(ordered.ok, true);
  until(s, 'cell physically carried', () => s.crew.some(c => c.delivery?.job === ordered.job.id && c.carry?.cells === 1), 100);
  assert.ok(serialize(deserialize(serialize(s))) === serialize(s), 'carried-cell save');
  const cells = totalResources(s).cells, injected = site.energy.injected;
  if (change === 'natural recharge') { bank.cable.enabled = true; refreshPower(s, site); }
  else { bank.building = null; delete bank.charge; }
  until(s, 'invalidated installation refunded', () => !s.jobs.some(j => j.id === ordered.job.id), 100);
  assert.equal(site.energy.injected, injected); assert.equal(totalResources(s).cells, cells);
  assert.ok(serialize(deserialize(serialize(s))) === serialize(s), 'refunded-cell save');
});
