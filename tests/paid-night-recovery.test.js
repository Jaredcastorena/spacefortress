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
import { recoverPaidNight, LIMITS, parseArguments } from '../tools/paid-night-recovery.mjs';
import { availableForWork, workReadiness } from '../src/crew.js';
import { airlockSideBlock } from '../src/airlock-access.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const config = { site: 'surface', x: 10, y: 10, chamber: [10, 13], inner: [10, 12], outer: [12, 14], extractor: [10, 13], pump: [10, 15], reservoir: [10, 16], vent: [11, 13] };

// SYNTHETIC setup installs fixed geometry, finite stock and prepared needs.
// Tests establish native recipe/hauling mechanics, not an ordinary journey.
function synthetic({ lowOxygen = false, bank = 14, tick = 1430, cold = false, crew3Energy = 90 } = {}) {
  const state = createGame(74219), site = state.sites.surface;
  state.tick = tick; state.debris.next = tick + 1200;
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
  tileAt(site, 7, 9).machine.enabled = true;
  Object.assign(tileAt(site, 7, 9).machine, { input: { water: 2, fertilizer: .25 }, batch: { water: 1, fertilizer: .25 }, progress: 14, batchRecipeId: 'fungalcap' });
  processor.machine.output = { air: 4 }; processor.machine.completed = 1;
  tileAt(site, 10, 13).gasDevice = { enabled: false, mode: 'exhaust', target: 0 };
  tileAt(site, 10, 15).gasDevice = { enabled: false, direction: 's' };
  for (const c of state.crew) {
    Object.assign(c, { x: 8, y: 10, oxygen: 90, energy: c.id === 'crew-3' ? crew3Energy : 90, hunger: 90, job: null, intent: null, carry: null, delivery: null });
    c.life.policy = 'work';
    for (const labor of Object.keys(c.labors)) c.labors[labor] = false;
    c.labors.hauling = true; c.labors.production = c.id === 'crew-3';
    if (c.labors.production) c.skills.production.level = 10;
  }
  state.creatures = []; state.jobs = [];
  Object.assign(state.crew[1], { x: 13, y: 9, carry: { air: 6 }, delivery: { kind: 'stock', target: { x: 8, y: 10, z: 0 } } });
  Object.assign(state.crew[0], { x: 8, y: 10, carry: { fertilizer: .25 }, delivery: { kind: 'input', target: { x: 7, y: 9, z: 0 } } });
  updateRooms(site); initializeThermal(state); fillRoom(roomAt(site, 10, 11));
  const chamber = roomAt(site, 10, 13); chamber.gas = { oxygen: 0, inert: 0, co2: 0 };
  if (lowOxygen) roomAt(site, 10, 11).gas = { oxygen: 52.8, inert: 277.0263378661494, co2: .051891004317951676 };
  if (cold) { roomAt(site, 10, 11).heat = roomAt(site, 10, 11).volume * 20 * (273.15 + 9.968); chamber.heat = chamber.volume * 20 * (273.15 + 4); site.thermal.initial = site.rooms.reduce((n, r) => n + r.heat, 0); }
  refreshAtmosphere(site); initializePower(state, site, bank); refreshPower(state, site); syncResources(state);
  assert.equal(executeAction(state, 'airlock.configure', config, 'agent').ok, true);
  for (const current of Object.values(state.sites)) current.atmosphere.tick = state.tick;
  return deserialize(serialize(state));
}


async function preserve(name, output, input) {
  const directory = process.env.PAID_NIGHT_OUTPUT_DIR; if (!directory) return;
  await mkdir(directory, { recursive: true });
  for (const [suffix, text] of Object.entries({ 'input.json': input, 'summary.json': JSON.stringify(output.summary, null, 2) + '\n', 'endpoint.json': output.endpoint, 'actions.json': JSON.stringify(output.actions), 'recording.ndjson': output.recording })) if (text) await writeFile(join(directory, `${name}-${suffix}`), text);
}

test('synthetic native carry/output continuation conserves paid stock and restores finite daytime controls and balanced routines', async () => {
  const state = synthetic(), input = serialize(state), farm = tileAt(state.sites.surface, 7, 9).machine;
  const batch = structuredClone(farm.batch), output = recoverPaidNight(state); await preserve('success', output, input);
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.equal(output.summary.inputMode, 'night'); assert.equal(output.summary.delivery.target, 10);
  assert.equal(output.summary.delivery.initialCarry, 6); assert.equal(output.summary.delivery.initialOutput, 4);
  assert.equal(output.summary.delivery.pickedUp, 4); assert.equal(output.summary.delivery.delivered, 10);
  const cp = output.summary.checkpoint;
  assert.equal(cp.daylight, true); assert.equal(cp.bank, 120); assert.equal(cp.home, 7); assert.equal(cp.jobs, 0); assert.equal(cp.carries, 0);
  assert.equal(cp.habitat.breathable, true); assert.equal(cp.chamber.pressure, 0); assert.equal(cp.chamber.thermalSafe, true);
  assert.equal(cp.processorPaused, true); assert.equal(cp.controllerEnabled, true); assert.equal(cp.controllerPhase, 'idle');
  assert.equal(cp.farmEnabled, true); assert.equal(cp.scrubberEnabled, true); assert.ok(state.crew.every(c => c.life.policy === 'balanced'));
  assert.deepEqual(farm.batch, batch); assert.equal(output.summary.farm.nativeCompleted, 0);
  const finalFarm = output.actions.findIndex(a => a.id === 'production.enable' && a.args.enabled && a.args.x === 7 && a.args.y === 9);
  assert.ok(finalFarm >= 0); assert.ok(output.actions.slice(finalFarm).every(a => a.id !== 'simulation.step' && a.tick === state.tick));
  assert.equal(output.summary.farm.after.progress, 14);
  assert.equal(output.summary.commissioned, false); assert.equal(output.summary.safeHabitationEstablished, false);
  assert.ok(output.summary.addedTicks <= LIMITS.ticks); assert.ok(output.summary.commands <= LIMITS.commands);
  assert.equal(output.summary.inputSha256, hash(input)); assert.equal(output.summary.endpointSha256, hash(output.endpoint));
  assert.equal(hash(serialize(deserialize(output.endpoint))), hash(output.endpoint));
  for (const n of [output.summary.accounting.gasError, output.summary.accounting.waterError, output.summary.accounting.fertilizerError, ...Object.values(output.summary.accounting.energyErrors), output.summary.accounting.species.inertError, output.summary.accounting.species.oxygenCo2Error]) assert.ok(Math.abs(n) < 1e-7);
  const records = output.recording.trim().split('\n').map(JSON.parse);
  assert.equal(records.filter(r => r.kind === 'external').length, 0);
  assert.equal(records.filter(r => r.kind === 'simulation.tick').length, output.summary.addedTicks);
  assert.equal(records.filter(r => r.kind === 'action.requested').length, output.summary.attempts);
  assert.ok(records.some(r => r.kind === 'event' && r.event.id === 'airlock.enabled'));
  const replay = deserialize(input); for (const action of output.actions) assert.equal(executeAction(replay, action.id, action.args, 'agent').ok, true);
  assert.equal(hash(serialize(replay)), hash(output.endpoint));
  const paused = deserialize(input); for (const action of output.actions) {
    if (action.id === 'production.enable' && action.args.enabled) break;
    assert.equal(executeAction(paused, action.id, action.args, 'agent').ok, true);
    assert.deepEqual(tileAt(paused.sites.surface, 7, 9).machine.batch, batch);
    assert.equal(tileAt(paused.sites.surface, 7, 9).machine.progress, 14);
    if (paused.tick < 1500) assert.equal(tileAt(paused.sites.surface, 13, 7).charge, 14);
  }
});

test('empty cold chamber is observed through native warming without changing admission threshold', async () => {
  const state = synthetic({ tick: 1490, cold: true, crew3Energy: 29.04 });
  const chamber = roomAt(state.sites.surface, 10, 13), controller = tileAt(state.sites.surface, 10, 10);
  assert.equal(airlockSideBlock(state.sites.surface, controller, 'inner'), 'unsafe_temperature');
  const threshold = deserialize(serialize(state)); roomAt(threshold.sites.surface, 10, 13).heat = chamber.volume * 20 * (273.15 + 5);
  assert.notEqual(airlockSideBlock(threshold.sites.surface, tileAt(threshold.sites.surface, 10, 10), 'inner'), 'unsafe_temperature');
  const input = serialize(state), output = recoverPaidNight(state); await preserve('cold', output, input);
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.ok(output.summary.checkpoint.chamber.temperature >= 5); assert.equal(output.summary.checkpoint.chamber.pressure, 0);
  assert.ok(output.actions.every(a => !a.id.includes('request') && !a.id.includes('door')));
  assert.equal(state.crew[3].life.policy, 'balanced'); assert.equal(state.crew[3].health, 100);
});

test('exact synthetic paid partial endpoint resumes daylight off duty without claiming prior delivery again', async () => {
  const state = synthetic({ tick: 1490, cold: true, crew3Energy: 27.24 }), input = serialize(state);
  const first = recoverPaidNight(state, { limits: { ticks: 75 } }); await preserve('day-partial', first, input);
  assert.equal(first.summary.failure.code, 'tick_limit'); assert.equal(first.state.tick, 1565);
  assert.ok(Math.abs(first.state.crew[3].energy - 24.99) < 1e-7);
  assert.equal(availableForWork(first.state.crew[3]), false); assert.ok(workReadiness(first.state.crew[3]).blockers.includes('fatigued'));
  assert.equal(first.summary.delivery.delivered, 10); assert.equal(first.summary.checkpoint.pendingAir, 0);
  assert.ok(first.state.crew.every(c => c.life.policy === 'rest' && !c.carry && !c.job));
  assert.equal(first.summary.checkpoint.farmEnabled, false); assert.equal(first.summary.checkpoint.scrubberEnabled, false);
  assert.equal(first.summary.checkpoint.controllerEnabled, true);
  const stopped = first.endpoint, resumed = deserialize(stopped), output = recoverPaidNight(resumed); await preserve('day-resumed', output, stopped);
  assert.equal(first.endpoint, stopped); assert.equal(hash(serialize(state)), hash(stopped));
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure)); assert.equal(output.summary.inputMode, 'day');
  assert.equal(output.summary.inputSha256, hash(stopped)); assert.equal(output.summary.initialTick, first.summary.tick);
  assert.equal(output.summary.delivery.target, 0); assert.equal(output.summary.delivery.delivered, 0); assert.equal(output.summary.delivery.pickedUp, 0);
  assert.equal(output.summary.delivery.transfers.length, 0); assert.ok(!output.actions.some(a => a.id === 'airlock.enable' || a.id === 'production.enable' && !a.args.enabled));
  assert.deepEqual(output.summary.farm.before, output.summary.farm.after);
  assert.equal(hash(serialize(deserialize(output.endpoint))), hash(output.endpoint));
  const cp = output.summary.checkpoint; assert.equal(cp.bank, 120); assert.equal(cp.home, 7); assert.equal(cp.jobs, 0); assert.equal(cp.carries, 0);
  assert.equal(cp.habitat.breathable, true); assert.equal(cp.habitat.thermalSafe, true); assert.equal(cp.chamber.thermalSafe, true); assert.equal(cp.chamber.pressure, 0);
  assert.equal(cp.controllerEnabled, true); assert.equal(cp.controllerPhase, 'idle'); assert.equal(cp.farmEnabled, true); assert.equal(cp.scrubberEnabled, true);
  assert.ok(resumed.crew.every(c => c.health === 100 && !c.medical.injury && c.life.policy === 'balanced'));
  for (const n of [output.summary.accounting.gasError, output.summary.accounting.waterError, output.summary.accounting.fertilizerError, ...Object.values(output.summary.accounting.energyErrors), output.summary.accounting.species.inertError, output.summary.accounting.species.oxygenCo2Error]) assert.ok(Math.abs(n) < 1e-7);
  const records = output.recording.trim().split('\n').map(JSON.parse); assert.equal(records.filter(r => r.kind === 'external').length, 0);
  assert.equal(records.filter(r => r.kind === 'simulation.tick').length, output.summary.addedTicks); assert.equal(records.filter(r => r.kind === 'action.requested').length, output.summary.attempts);
  for (const change of [s => s.crew[0].life.policy = 'work', s => tileAt(s.sites.surface, 7, 9).machine.enabled = true]) {
    const invalid = deserialize(stopped); change(invalid); const before = serialize(invalid), result = recoverPaidNight(invalid);
    assert.equal(result.summary.ok, false); assert.equal(result.actions.length, 0); assert.equal(hash(serialize(invalid)), hash(before));
  }
});

test('caps preserve exact paid partial carry, committed farm and temporary controls without cleanup', async () => {
  const state = synthetic(), input = serialize(state), output = recoverPaidNight(state, { limits: { ticks: 1 } }); await preserve('partial', output, input);
  assert.equal(output.summary.failure.code, 'tick_limit'); assert.equal(output.summary.addedTicks, 1);
  assert.equal(tileAt(state.sites.surface, 7, 9).machine.enabled, false); assert.equal(tileAt(state.sites.surface, 7, 7).machine.enabled, false);
  assert.equal(tileAt(state.sites.surface, 10, 10).airlock.enabled, false); assert.ok(state.crew.every(c => c.life.policy === 'work'));
  assert.deepEqual(tileAt(state.sites.surface, 7, 9).machine.batch, { water: 1, fertilizer: .25 });
  assert.ok(output.summary.delivery.delivered < 10); assert.ok(output.summary.checkpoint.pendingAir > 0);
  assert.equal(hash(serialize(state)), hash(output.endpoint));
});

test('invalid input and zero command or attempt budgets leave state untouched and issue no forbidden action', () => {
  for (const change of [s => s.crew[3].energy = 24.99, s => s.crew[0].health = 99, s => s.crew[0].life.policy = 'balanced', s => s.jobs.push({}), s => tileAt(s.sites.surface, 13, 9).machine.order.remaining = 1]) {
    const state = synthetic(); change(state); const input = serialize(state), output = recoverPaidNight(state);
    assert.equal(output.summary.ok, false); assert.equal(output.actions.length, 0); assert.equal(hash(serialize(state)), hash(input));
  }
  for (const limits of [{ commands: 0 }, { attempts: 0 }]) {
    const state = synthetic(), input = serialize(state), output = recoverPaidNight(state, { limits });
    assert.equal(output.summary.ok, false); assert.equal(output.actions.length, 0); assert.equal(hash(serialize(state)), hash(input));
  }
  for (const options of [{ limits: { ticks: 221 } }, { limits: { attempts: 261 } }, { limits: { commands: 36 } }, { processor: [1, 1] }, { limits: { batches: 1 } }]) assert.throws(() => recoverPaidNight(synthetic(), options), TypeError);
  for (const args of [[], ['--input', 'a', '--output-dir', 'a'], ['--input', 'a', '--output-dir', 'b', '--ticks', '221']]) assert.throws(() => parseArguments(args), TypeError);
});

test('CLI exports canonical first endpoint and complete hashes to a fresh directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paid-night-')), input = join(directory, 'input.json'), outputDir = join(directory, 'result'), text = serialize(synthetic()); await writeFile(input, text);
  const args = ['tools/paid-night-recovery.mjs', '--input', input, '--output-dir', outputDir, '--ticks', '1'];
  const result = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr); const summary = JSON.parse(result.stdout);
  assert.equal(summary.failure.code, 'tick_limit'); assert.equal(summary.inputSha256, hash(text));
  assert.equal(hash(await readFile(input, 'utf8')), hash(text)); assert.equal(hash(await readFile(join(outputDir, 'input.json'), 'utf8')), hash(text));
  const endpoint = await readFile(join(outputDir, 'endpoint.json'), 'utf8'); assert.equal(hash(endpoint), summary.endpointSha256);
  assert.equal(hash(JSON.stringify(JSON.parse(await readFile(join(outputDir, 'actions.json'), 'utf8')))), summary.actionSha256);
  assert.equal(hash(await readFile(join(outputDir, 'recording.ndjson'), 'utf8')), summary.recordingSha256);
  const rerun = spawnSync(process.execPath, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8' }); assert.equal(rerun.status, 2);
  assert.equal(hash(await readFile(join(outputDir, 'endpoint.json'), 'utf8')), hash(endpoint));
});
