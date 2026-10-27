import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { tileAt } from '../src/geometry.js';
import { initializeStorage, syncResources } from '../src/inventory.js';
import { initializeElectrical, initializePower, refreshPower } from '../src/power.js';
import { initializeProduction } from '../src/production.js';
import { initializeAirlocks } from '../src/airlock-persistence.js';
import { updateRooms, roomAt, fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { initializeThermal } from '../src/thermal.js';
import { newPipe } from '../src/gas-networks.js';
import { executeAction } from '../src/controls.js';
import { PLACEMENTS } from '../tools/paid-airlock-example.mjs';
import { physicalMaterialOwners } from '../tools/paid-air-recovery.mjs';
import { runPaidAirBatch, LIMITS, parseArguments } from '../tools/paid-air-batch.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const config = { site: 'surface', x: 10, y: 10, chamber: [10, 13], inner: [10, 12], outer: [12, 14], extractor: [10, 13], pump: [10, 15], reservoir: [10, 16], vent: [11, 13] };

// SYNTHETIC setup installs fixed geometry, finite stock and prepared needs.
// Tests establish native recipe/hauling mechanics, not an ordinary journey.
function synthetic({ lowOxygen = false, farm = false, bank = 120, tick = 0 } = {}) {
  const state = createGame(74219), site = state.sites.surface;
  state.tick = tick;
  for (const p of PLACEMENTS) {
    const t = tileAt(site, p.x, p.y);
    if (p.building === 'floor') t.terrain = 'floor';
    else if (p.building === 'cable') t.cable = { enabled: true, hp: 100 };
    else if (p.building === 'gasPipe') t.pipe = newPipe();
    else t.building = p.building;
    t.hp = 100; initializeStorage(t); initializeElectrical(t);
  }
  const processor = tileAt(site, 13, 9); processor.building = 'atmosphere'; initializeStorage(processor); initializeElectrical(processor);
  initializeProduction(state); initializeAirlocks(state);
  for (const t of site.tiles) {
    if (t.machine) t.machine.enabled = false;
    if (t.stock) { t.stock.air = 4; t.stock.water = 1; }
    if (t.building === 'door') { t.doorMode = 'closed'; t.doorUntil = 0; }
    if (t.gasDevice) t.gasDevice.enabled = false;
  }
  Object.assign(processor.machine, { input: {}, output: {}, batch: {}, progress: 0, order: { mode: 'batches', limit: 0, remaining: 0, priority: 5 } });
  tileAt(site, 7, 7).machine.enabled = true; tileAt(site, 7, 7).machine.input = { air: 6 };
  tileAt(site, 7, 9).machine.enabled = farm;
  tileAt(site, 10, 13).gasDevice = { enabled: false, mode: 'exhaust', target: 0 };
  tileAt(site, 10, 15).gasDevice = { enabled: false, direction: 's' };
  for (const c of state.crew) {
    Object.assign(c, { x: 8, y: 10, oxygen: 90, energy: 90, hunger: 90, job: null, intent: null, carry: null, delivery: null });
    c.life.policy = 'balanced';
    for (const labor of Object.keys(c.labors)) c.labors[labor] = false;
    c.labors.hauling = true; c.labors.production = c.id === 'crew-3';
    if (c.labors.production) c.skills.production.level = 10;
  }
  state.creatures = []; state.jobs = [];
  updateRooms(site); initializeThermal(state); fillRoom(roomAt(site, 10, 11));
  const chamber = roomAt(site, 10, 13); chamber.gas = { oxygen: 0, inert: 0, co2: 0 };
  if (lowOxygen) roomAt(site, 10, 11).gas = { oxygen: 52.8, inert: 277.0263378661494, co2: .051891004317951676 };
  refreshAtmosphere(site); initializePower(state, site, bank); refreshPower(state, site); syncResources(state);
  assert.equal(executeAction(state, 'airlock.configure', config, 'agent').ok, true);
  for (const current of Object.values(state.sites)) current.atmosphere.tick = state.tick;
  return deserialize(serialize(state));
}

async function preserve(name, output, input) {
  const directory = process.env.PAID_AIR_BATCH_OUTPUT_DIR; if (!directory) return;
  await mkdir(directory, { recursive: true });
  for (const [suffix, text] of Object.entries({ 'input.json': input, 'summary.json': JSON.stringify(output.summary, null, 2) + '\n', 'endpoint.json': output.endpoint, 'actions.json': JSON.stringify(output.actions), 'recording.ndjson': output.recording })) if (text) await writeFile(join(directory, `${name}-${suffix}`), text);
}

test('one paid water batch delivers exactly ten air through native hauling with an owned idle vacuum chamber', async () => {
  const state = synthetic({ tick: 190 });
  tileAt(state.sites.surface, 13, 9).machine.order.limit = 1; // Exhausted historical order.
  const input = serialize(state), policies = state.crew.map(c => c.life.policy), output = runPaidAirBatch(state);
  await preserve('success', output, input);
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.deepEqual(output.summary.recipes, { started: 1, completed: 1, waterConsumed: 1, waterCommitted: 0, airProduced: 10, duration: 25 });
  assert.equal(output.summary.delivery.pickedUp, 10); assert.equal(output.summary.delivery.delivered, 10);
  assert.equal(output.summary.checkpoint.home, 7); assert.equal(output.summary.checkpoint.jobs, 0);
  assert.equal(output.summary.checkpoint.chamber.breathable, false); assert.equal(output.summary.checkpoint.chamber.pressure, 0);
  assert.equal(output.summary.checkpoint.paused, true); assert.equal(output.summary.checkpoint.routinesRestored, true);
  assert.ok(output.summary.checkpoint.bank < 120);
  assert.deepEqual(state.crew.map(c => c.life.policy), policies);
  assert.equal(tileAt(state.sites.surface, 10, 10).airlock.phase, 'idle');
  assert.equal(output.summary.commissioned, false); assert.equal(output.summary.safeHabitationEstablished, false);
  assert.ok(output.summary.addedTicks <= LIMITS.ticks); assert.ok(output.summary.commands <= LIMITS.commands);
  assert.ok(Math.abs(output.summary.accounting.gasError) < 1e-7);
  assert.ok(Math.abs(output.summary.accounting.species.inertError) < 1e-7);
  assert.ok(Math.abs(output.summary.accounting.species.oxygenCo2Error) < 1e-7);
  assert.ok(Object.values(output.summary.accounting.energyErrors).every(n => Math.abs(n) < 1e-7));
  const water = owners => owners.reduce((n, row) => n + row.water, 0);
  assert.equal(water(output.summary.accounting.materialsBefore) - water(physicalMaterialOwners(state)), 1);
  assert.equal(output.summary.inputSha256, hash(input)); assert.equal(output.summary.endpointSha256, hash(serialize(state)));
  assert.match(output.summary.sourceSha256, /^[a-f0-9]{64}$/); assert.equal(hash(serialize(deserialize(output.endpoint))), hash(output.endpoint));
  const records = output.recording.trim().split('\n').map(JSON.parse), events = records.filter(r => r.kind === 'event').map(r => r.event);
  assert.equal(events.filter(e => e.id === 'production.batch.started' && e.recipe === 'atmosphere').length, 1);
  assert.equal(events.filter(e => e.id === 'production.batch.completed' && e.recipe === 'atmosphere').length, 1);
  assert.equal(records.filter(r => r.kind === 'external').length, 0);
  assert.equal(records.filter(r => r.kind === 'simulation.tick').length, output.summary.addedTicks);
  assert.equal(records.filter(r => r.kind === 'action.requested').length, output.summary.attempts);
  assert.ok(records.filter(r => r.kind === 'action.requested').every(r => r.action.source === 'agent'));
  const replay = deserialize(input); for (const action of output.actions) assert.equal(executeAction(replay, action.id, action.args, 'agent').ok, true);
  assert.equal(hash(serialize(replay)), hash(output.endpoint));
});

test('a lowered tick cap preserves a paid partial batch and temporary routines without cleanup', async () => {
  const state = synthetic(), input = serialize(state), output = runPaidAirBatch(state, { limits: { ticks: 13 } });
  await preserve('partial', output, input);
  assert.equal(output.summary.ok, false); assert.equal(output.summary.failure.code, 'tick_limit'); assert.equal(output.summary.addedTicks, 13);
  assert.equal(output.summary.recipes.started, 1); assert.equal(output.summary.recipes.completed, 0);
  assert.equal(tileAt(state.sites.surface, 13, 9).machine.batch.water, 1);
  assert.ok(state.crew.some(c => c.life.policy === 'work'));
  assert.equal(output.actions.at(-1).id, 'simulation.step'); assert.equal(hash(serialize(deserialize(output.endpoint))), hash(output.endpoint));
});

test('invalid or unhealthy inputs and lowered command/attempt caps issue no forbidden actions', () => {
  for (const mutate of [s => { Object.assign(tileAt(s.sites.surface, 13, 9).machine.order, { limit: 1, remaining: 1 }); }, s => { tileAt(s.sites.surface, 13, 9).machine.enabled = true; }, s => { s.crew[0].health = 99; }, s => { s.crew[0].energy = 24; }, s => { tileAt(s.sites.surface, 10, 12).doorMode = 'open'; }]) {
    const state = synthetic(); mutate(state); const input = serialize(state), output = runPaidAirBatch(state);
    assert.equal(output.summary.ok, false); assert.equal(output.actions.length, 0); assert.equal(hash(serialize(state)), hash(input));
  }
  for (const limits of [{ commands: 0 }, { attempts: 0 }]) {
    const state = synthetic(), input = serialize(state), output = runPaidAirBatch(state, { limits });
    assert.equal(output.summary.ok, false); assert.equal(output.actions.length, 0); assert.equal(hash(serialize(state)), hash(input));
  }
});

test('baseline enabled farm and scrubber and habitat oxygen at its minimum are accepted without policy changes to equipment', () => {
  const state = synthetic({ lowOxygen: true, farm: true }), output = runPaidAirBatch(state, { limits: { ticks: 1 } });
  assert.equal(output.summary.failure.code, 'tick_limit'); assert.equal(output.summary.addedTicks, 1);
  assert.equal(tileAt(state.sites.surface, 7, 9).machine.enabled, true); assert.equal(tileAt(state.sites.surface, 7, 7).machine.enabled, true);
  assert.ok(Number.isFinite(output.summary.checkpoint.habitat.gas.oxygen));
});

test('options and CLI reject raised caps, recipe variants and ambiguous arguments', () => {
  const state = synthetic(), input = serialize(state);
  for (const options of [{ limits: { ticks: 181 } }, { limits: { batches: 2 } }, { limits: { attempts: 231 } }, { recipe: 'other' }, { processor: [-1, 0] }, { limits: { toString: 1 } }]) assert.throws(() => runPaidAirBatch(state, options), TypeError);
  for (const args of [[], ['--input', 'a', '--output-dir', 'a'], ['--input', 'a', '--output-dir', 'b', '--ticks', '181'], ['--input', 'a', '--input', 'b'], ['--input', 'a', '--output-dir', 'b', '--batches', '1']]) assert.throws(() => parseArguments(args), TypeError);
  assert.equal(hash(serialize(state)), hash(input));
});

test('CLI preserves canonical input, first endpoint, trace, recording and hashes in a fresh directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paid-air-batch-')), input = join(directory, 'input.json'), outputDir = join(directory, 'result'), text = serialize(synthetic());
  await writeFile(input, text);
  const args = ['tools/paid-air-batch.mjs', '--input', input, '--output-dir', outputDir, '--ticks', '1'];
  const result = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.ok(result.stdout.length, JSON.stringify({ status: result.status, signal: result.signal, stderr: result.stderr, error: result.error?.message }));
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.failure.code, 'tick_limit'); assert.equal(summary.inputSha256, hash(text));
  assert.equal(hash(await readFile(input, 'utf8')), hash(text)); assert.equal(hash(await readFile(join(outputDir, 'input.json'), 'utf8')), hash(text));
  const endpoint = await readFile(join(outputDir, 'endpoint.json'), 'utf8'); assert.equal(hash(endpoint), summary.endpointSha256);
  assert.equal(hash(serialize(deserialize(endpoint))), hash(endpoint)); assert.match(await readFile(join(outputDir, 'recording.ndjson'), 'utf8'), /"kind":"footer"/);
  assert.equal(hash(JSON.stringify(JSON.parse(await readFile(join(outputDir, 'actions.json'), 'utf8')))), summary.actionSha256);
  const rerun = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(rerun.status, 2); assert.equal(hash(await readFile(join(outputDir, 'endpoint.json'), 'utf8')), hash(endpoint));
});
