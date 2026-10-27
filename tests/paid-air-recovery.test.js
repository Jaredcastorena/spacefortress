import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { tileAt } from '../src/geometry.js';
import { initializeStorage, syncResources } from '../src/inventory.js';
import { initializeElectrical, initializePower, refreshPower } from '../src/power.js';
import { initializeProduction } from '../src/production.js';
import { initializeAirlocks } from '../src/airlock-persistence.js';
import { updateRooms, roomAt, fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { initializeThermal } from '../src/thermal.js';
import { PLACEMENTS } from '../tools/paid-airlock-example.mjs';
import { recoverPaidAir, LIMITS, parseArguments } from '../tools/paid-air-recovery.mjs';

// SYNTHETIC mechanics fixture: directly installed geometry, supplies, needs and
// charge. It tests full-tick paid recipes/hauling, not an ordinary saved journey.
function synthetic({ ready = false } = {}) {
  const state = createGame(74219), site = state.sites.surface;
  for (const p of PLACEMENTS) {
    const t = tileAt(site, p.x, p.y);
    if (p.building === 'floor') t.terrain = 'floor';
    else if (p.building === 'cable') t.cable = { enabled: true, hp: 100 };
    else if (p.building === 'gasPipe') continue;
    else t.building = p.building;
    t.hp = 100; initializeStorage(t); initializeElectrical(t);
  }
  const processor = tileAt(site, 13, 9); processor.building = 'atmosphere';
  initializeStorage(processor); initializeElectrical(processor); initializeProduction(state);
  for (const t of site.tiles) {
    if (t.machine && t !== processor && t.building !== 'scrubber') t.machine.enabled = false;
    if (t.stock) { t.stock.air = ready ? 5 : 0; t.stock.water = 12; }
    if (t.building === 'door') { t.doorMode = 'auto'; t.doorUntil = 0; }
    if (t.gasDevice) t.gasDevice.enabled = false;
  }
  Object.assign(processor.machine, { enabled: false, order: { mode: 'batches', limit: 0, remaining: 0, priority: 5 } });
  for (const c of state.crew) {
    Object.assign(c, { x: 10, y: 11, oxygen: 90, job: null, intent: null });
    c.life.policy = c.id === 'crew-1' ? 'work' : 'rest';
    c.labors.production = c.id === 'crew-3';
    if (c.id === 'crew-3') c.skills.production.level = 10;
    for (const labor of ['mining', 'construction', 'engineering', 'medicine', 'husbandry']) c.labors[labor] = false;
    c.labors.hauling = true;
  }
  state.crew[0].oxygen = ready ? 60 : 75;
  if (!ready) Object.assign(state.crew[5], { x: 11, y: 13, oxygen: 100 });
  state.creatures = []; state.jobs = [];
  updateRooms(site); initializeThermal(state);
  fillRoom(roomAt(site, 10, 11), 120); fillRoom(roomAt(site, 10, 13));
  refreshAtmosphere(site); initializeAirlocks(state); initializePower(state, site, 120); refreshPower(state, site); syncResources(state);
  return deserialize(serialize(state));
}

async function preserve(name, output) {
  const directory = process.env.PAID_AIR_RECOVERY_OUTPUT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}-summary.json`), JSON.stringify(output.summary, null, 2) + '\n');
  await writeFile(join(directory, `${name}-save.json`), serialize(output.state));
  await writeFile(join(directory, `${name}-actions.json`), JSON.stringify(output.actions, null, 2) + '\n');
  if (output.recording) await writeFile(join(directory, `${name}-recording.ndjson`), output.recording);
}

test('synthetic full-tick recovery consumes finite water and physically delivers each one-batch output', async () => {
  const state = synthetic(), input = serialize(state), originalPolicies = state.crew.map(c => c.life.policy);
  const output = recoverPaidAir(state, { record: true });
  await preserve('mechanics', output);
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.equal(output.summary.commissioned, false);
  assert.equal(output.summary.safeHabitationEstablished, false);
  assert.ok(output.summary.addedTicks > 0 && output.summary.addedTicks <= LIMITS.ticks);
  assert.ok(output.summary.recipes.completed >= 1 && output.summary.recipes.completed <= 6);
  assert.equal(output.summary.recipes.waterConsumed * 10, output.summary.recipes.airProduced);
  assert.ok(output.summary.work.waterDeliveredToProcessor >= output.summary.recipes.completed);
  assert.ok(output.summary.work.observedAirCarryDeliveries > 0);
  assert.ok(Math.abs(output.summary.balances.gasError) < 1e-7);
  assert.ok(Object.values(output.summary.balances.energyErrors).every(n => Math.abs(n) < 1e-7));
  assert.deepEqual(state.crew.map(c => c.life.policy), originalPolicies);
  assert.equal(output.summary.checkpoint.home, 7); assert.equal(output.summary.checkpoint.clear, true);
  assert.equal(serialize(deserialize(serialize(state))), serialize(state));
  const records = output.recording.trim().split('\n').map(line => JSON.parse(line));
  const requests = records.filter(r => r.kind === 'action.requested');
  assert.equal(requests.length, output.summary.attempts);
  assert.ok(requests.every(r => r.action.source === 'agent'));
  assert.equal(records.filter(r => r.kind === 'external').length, 0);
  assert.equal(records.filter(r => r.kind === 'simulation.tick').length, output.summary.addedTicks);
  const events = records.filter(r => r.kind === 'event').map(r => r.event);
  const starts = events.filter(e => e.id === 'production.batch.started' && e.recipe === 'atmosphere');
  const completed = events.filter(e => e.id === 'production.batch.completed' && e.recipe === 'atmosphere');
  assert.equal(starts.length, output.summary.recipes.started);
  assert.equal(completed.length, output.summary.recipes.completed);
  assert.ok(starts.every(e => e.input.water === 1)); assert.ok(completed.every(e => e.output.air === 10));
  assert.ok(requests.filter(r => r.action.id === 'production.order').every(r => r.action.args.limit === 1));
  const replay = deserialize(input);
  for (const action of output.actions) {
    // Replaying the complete shared action trace must reproduce the exact save.
    const { executeAction } = await import('../src/controls.js');
    assert.equal(executeAction(replay, action.id, action.args, 'agent').ok, true);
  }
  assert.equal(serialize(replay), serialize(state));
});

test('synthetic sufficient checkpoint stops before any command or tick, without full suits', () => {
  const state = synthetic({ ready: true }), before = serialize(state);
  const output = recoverPaidAir(state);
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.equal(output.summary.attempts, 0); assert.equal(output.summary.addedTicks, 0);
  assert.equal(output.summary.recipes.completed, 0); assert.equal(serialize(state), before);
  assert.ok(state.crew.some(c => c.oxygen < 100), 'full suits are not a recovery requirement');
});

test('synthetic lowered tick budget preserves the failed endpoint and temporary policies', async () => {
  const state = synthetic(), output = recoverPaidAir(state, { limits: { ticks: 3 }, record: true });
  await preserve('tick-limit', output);
  assert.equal(output.summary.ok, false); assert.equal(output.summary.failure.code, 'tick_limit');
  assert.equal(output.summary.addedTicks, 3); assert.equal(output.actions.at(-1).id, 'simulation.step');
  assert.ok(output.summary.policies.some(p => p.current !== p.original), 'failure performs no cleanup');
  assert.equal(tileAt(state.sites.surface, 13, 9).machine.enabled, true);
});

test('synthetic zero-batch and initially harmed inputs stop with no gameplay changes', () => {
  const state = synthetic(), before = serialize(state), output = recoverPaidAir(state, { limits: { batches: 0 } });
  assert.equal(output.summary.failure.code, 'batch_limit'); assert.equal(output.summary.attempts, 0); assert.equal(serialize(state), before);
  const injured = synthetic(); injured.crew[0].health = 99;
  const stopped = recoverPaidAir(injured);
  assert.equal(stopped.summary.ok, false); assert.equal(stopped.summary.attempts, 0);
});

test('synthetic one-batch cap allows real delivery before stopping an insufficient checkpoint', async () => {
  const state = synthetic();
  fillRoom(roomAt(state.sites.surface, 10, 13), 0); refreshAtmosphere(state.sites.surface);
  const output = recoverPaidAir(state, { limits: { batches: 1 }, record: true });
  await preserve('batch-limit', output);
  assert.equal(output.summary.failure?.code, 'batch_limit');
  assert.equal(output.summary.recipes.completed, 1);
  assert.equal(tileAt(state.sites.surface, 13, 9).machine.enabled, false);
  assert.equal(tileAt(state.sites.surface, 13, 9).machine.output.air || 0, 0);
  assert.ok(state.crew.every(c => !c.carry?.air), 'completed output/carry is delivered before deciding another batch is needed');
  assert.ok(output.summary.work.observedAirCarryDeliveries >= 10);
});

test('synthetic first new harm stops after that full tick without cleanup', async () => {
  const state = synthetic();
  fillRoom(roomAt(state.sites.surface, 10, 11), 0); refreshAtmosphere(state.sites.surface); state.crew[0].oxygen = 0;
  const output = recoverPaidAir(state, { record: true });
  await preserve('crew-harmed', output);
  assert.equal(output.summary.failure?.code, 'crew_harmed');
  assert.equal(output.summary.addedTicks, 1); assert.equal(output.actions.at(-1).id, 'simulation.step');
  assert.ok(state.crew[0].health < 100); assert.equal(output.summary.checkpoint.healthy, false);
});

test('options and CLI reject raised caps, ambiguous paths and invalid arguments before actions', () => {
  const state = synthetic(), before = serialize(state);
  for (const options of [{ limits: { ticks: 181 } }, { limits: { batches: 7 } }, { limits: { invalid: 1 } }, { limits: { toString: 1 } }, { record: 'yes' }, { processor: [-1, 0] }, { unknown: true }]) assert.throws(() => recoverPaidAir(state, options), TypeError);
  assert.equal(serialize(state), before);
  assert.deepEqual(parseArguments(['--input', 'in.json', '--save', 'out.json', '--ticks', '3']), { input: 'in.json', save: 'out.json', limits: { ticks: 3 } });
  for (const args of [[], ['--input'], ['--input', 'in', '--save', 'in'], ['--input', 'in', '--input', 'other'], ['--input', 'in', '--ticks', '181'], ['--input', 'in', '--ticks', '-1'], ['--input', 'in', '--bogus', '1']]) assert.throws(() => parseArguments(args), TypeError);
});

test('offline CLI reads a canonical synthetic save and exports the exact stopped state and recording', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paid-air-recovery-'));
  const input = join(directory, 'input.json'), save = join(directory, 'output.json'), record = join(directory, 'recording.ndjson');
  await writeFile(input, serialize(synthetic()));
  const result = spawnSync(process.execPath, ['tools/paid-air-recovery.mjs', '--input', input, '--save', save, '--record', record, '--ticks', '1'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.failure.code, 'tick_limit'); assert.equal(summary.addedTicks, 1);
  const saved = await readFile(save, 'utf8'); assert.equal(serialize(deserialize(saved)), saved);
  assert.equal(deserialize(saved).tick, summary.tick); assert.equal(summary.saved, true);
  assert.match(await readFile(record, 'utf8'), /"kind":"footer"/);
  const ready = serialize(synthetic({ ready: true })); await writeFile(input, ready);
  const success = spawnSync(process.execPath, ['tools/paid-air-recovery.mjs', '--input', input, '--save', save], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr); assert.equal(JSON.parse(success.stdout).attempts, 0);
  assert.equal(await readFile(save, 'utf8'), ready); assert.equal(await readFile(input, 'utf8'), ready);
  await writeFile(input, '{invalid');
  const invalid = spawnSync(process.execPath, ['tools/paid-air-recovery.mjs', '--input', input], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).failure.code, 'cli_error');
});

// Additional SYNTHETIC boundary fixtures. Every modified fixture must still
// deserialize canonically before checking the recovery acceptance boundary.
test('synthetic recovery boundary requires bank charge exactly 120', () => {
  const state = synthetic({ ready: true }), site = state.sites.surface, bank = tileAt(site, 13, 7);
  bank.charge = 120 - Number.EPSILON * 120;
  site.energy.discarded += 120 - bank.charge; refreshPower(state, site);
  const before = serialize(state); assert.equal(serialize(deserialize(before)), before);
  const output = recoverPaidAir(state, { limits: { attempts: 0 } });
  assert.equal(output.summary.ok, false, 'a representable charge below 120 is insufficient');
  assert.equal(output.summary.checkpoint.ok, false); assert.equal(output.summary.checkpoint.bank, bank.charge);
  assert.equal(output.summary.attempts, 0); assert.equal(serialize(state), before);
});

test('synthetic recovery boundary includes a living creature in the chamber or either boundary door', async t => {
  for (const [name, x, y] of [['chamber', 11, 13], ['inner door', 10, 12], ['outer door', 12, 14]]) await t.test(name, () => {
    const state = synthetic({ ready: true }), animal = structuredClone(createGame(74219).creatures[0]);
    Object.assign(animal, { x, y }); state.creatures.push(animal);
    const before = serialize(state); assert.equal(serialize(deserialize(before)), before);
    const output = recoverPaidAir(state, { chamber: [11, 13], limits: { attempts: 0 } });
    assert.equal(output.summary.checkpoint.clear, false, `living creature in ${name} blocks clearance`);
    assert.equal(output.summary.ok, false); assert.equal(output.summary.attempts, 0); assert.equal(serialize(state), before);
  });
});

test('synthetic recovery boundary excludes an unrelated remote door creature', () => {
  const state = synthetic({ ready: true }), site = state.sites.surface, remote = tileAt(site, 2, 2);
  Object.assign(remote, { terrain: 'floor', building: 'door', hp: 100, doorMode: 'auto', doorUntil: 0 });
  updateRooms(site); initializeThermal(state); refreshAtmosphere(site); refreshPower(state, site);
  const animal = structuredClone(createGame(74219).creatures[0]); Object.assign(animal, { x: 2, y: 2 }); state.creatures.push(animal);
  const before = serialize(state); assert.equal(serialize(deserialize(before)), before);
  const output = recoverPaidAir(state, { limits: { attempts: 0 } });
  assert.equal(output.summary.checkpoint.clear, true); assert.equal(output.summary.ok, true);
  assert.equal(output.summary.attempts, 0); assert.equal(serialize(state), before);
});
