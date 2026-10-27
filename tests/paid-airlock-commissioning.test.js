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
import { newPipe } from '../src/gas-networks.js';
import { executeAction } from '../src/controls.js';
import { PLACEMENTS } from '../tools/paid-airlock-example.mjs';
import { physicalMaterialOwners, physicalBalances } from '../tools/paid-air-recovery.mjs';
import { commissionPaidAirlock, commissioningStatus, LIMITS, parseArguments } from '../tools/paid-airlock-commissioning.mjs';

// SYNTHETIC mechanics fixture: directly installed paid-example geometry, finite
// prepared gas, inventory and charge. Its richer chamber mix is not evidence
// that the tiny-margin ordinary checkpoint can finish within 47 ticks.
function synthetic() {
  const state = createGame(74219), site = state.sites.surface;
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
    if (t.machine && t.building !== 'scrubber') t.machine.enabled = false;
    if (t.stock) { t.stock.air = 4; t.stock.water = 22; }
    if (t.building === 'door') { t.doorMode = 'closed'; t.doorUntil = 0; }
    if (t.gasDevice) t.gasDevice.enabled = false;
  }
  tileAt(site, 7, 7).machine.input = { air: 6 };
  tileAt(site, 10, 12).doorMode = 'open';
  tileAt(site, 10, 13).gasDevice = { enabled: false, mode: 'exhaust', target: 0 };
  tileAt(site, 10, 15).gasDevice = { enabled: false, direction: 's' };
  for (const c of state.crew) {
    Object.assign(c, { x: 10, y: 11, oxygen: 90, job: null, intent: null });
    c.life.policy = ['crew-1', 'crew-3'].includes(c.id) ? 'work' : 'rest';
    c.labors.production = ['crew-3', 'crew-6'].includes(c.id);
  }
  state.creatures = []; state.jobs = [];
  updateRooms(site); initializeThermal(state); fillRoom(roomAt(site, 10, 11)); fillRoom(roomAt(site, 10, 13));
  refreshAtmosphere(site); initializePower(state, site, 120); refreshPower(state, site); syncResources(state);
  return deserialize(serialize(state));
}

async function preserve(name, output) {
  const directory = process.env.PAID_COMMISSIONING_OUTPUT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}-summary.json`), JSON.stringify(output.summary, null, 2) + '\n');
  await writeFile(join(directory, `${name}-save.json`), serialize(output.state));
  await writeFile(join(directory, `${name}-actions.json`), JSON.stringify(output.actions, null, 2) + '\n');
  if (output.recording) await writeFile(join(directory, `${name}-recording.ndjson`), output.recording);
}
let mechanicsOutput;
function mechanics() { return mechanicsOutput ??= commissionPaidAirlock(synthetic(), { record: true }); }

test('synthetic status and shared physical accounting are detached, pure and canonical', () => {
  const state = synthetic(), before = serialize(state), status = commissioningStatus(state);
  assert.equal(status.bound, false); assert.equal(status.layout.ok, true); assert.equal(status.healthy, true); assert.equal(status.habitatReturned, true);
  assert.equal(status.ok, false); assert.equal(status.readyToBind, false);
  const owners = physicalMaterialOwners(state), balances = physicalBalances(state);
  assert.equal(balances.owners.reduce((n, row) => n + row.air, 0), 10);
  assert.equal(owners.reduce((n, row) => n + row.air, 0), 10);
  status.r.chamber.gas.oxygen = 999; status.layout.ownedNodes[0].x = 999; owners[0].air = 999;
  assert.equal(serialize(state), before); assert.equal(serialize(deserialize(before)), before);
});

test('synthetic shared full ticks capture finite gas, drain accessible supply, bind and restore', async () => {
  const output = mechanics(); await preserve('mechanics', output);
  const { summary, state } = output;
  assert.equal(summary.ok, true, JSON.stringify(summary.failure));
  assert.ok(summary.addedTicks > 0 && summary.addedTicks <= LIMITS.ticks); assert.equal(summary.gasTicks, summary.addedTicks);
  assert.ok(summary.attempts <= 90 && summary.commands <= 35); assert.equal(summary.status.ok, true);
  assert.equal(summary.status.controller.phase, 'idle'); assert.equal(summary.status.controller.party, null);
  assert.equal(summary.status.productionLabors, true); assert.equal(summary.status.restored, true); assert.equal(summary.status.bank, 120);
  assert.equal(summary.status.scrubberEnabled, true); assert.equal(summary.status.farmEnabled, true);
  assert.ok(summary.status.r.chamber.pressure <= 1 + 1e-9); assert.equal(summary.status.r.chamber.breathable, false, 'vacuum is the commissioned empty chamber');
  assert.equal(summary.status.r.predicted.breathable, true); assert.equal(summary.status.habitatReturned, true);
  assert.ok(summary.status.reachableAir >= 5); assert.ok(Math.abs(summary.balances.gasError) < 1e-7);
  assert.ok(Object.values(summary.balances.energyErrors).every(n => Math.abs(n) < 1e-7));
  assert.equal(serialize(deserialize(serialize(state))), serialize(state));
  const rows = output.recording.trim().split('\n').map(line => JSON.parse(line)), records = rows.slice(1, -1);
  records.forEach((r, i) => assert.equal(r.sequence, i + 1));
  assert.equal(rows.at(-1).reason, 'stopped'); assert.equal(records.filter(r => r.kind === 'external').length, 0);
  const requests = records.filter(r => r.kind === 'action.requested'); assert.equal(requests.length, summary.attempts);
  assert.ok(requests.every(r => r.action.source === 'agent'));
  assert.equal(records.filter(r => r.kind === 'simulation.tick').length, summary.addedTicks);
  const events = records.filter(r => r.kind === 'event').map(r => r.event);
  assert.ok(events.some(e => e.id === 'gas.extracted' && e.amount > 0)); assert.ok(events.some(e => e.id === 'gas.transferred' && e.amount > 0));
  assert.equal(events.filter(e => e.id === 'airlock.configured').length, 1);
  assert.equal(events.filter(e => e.id === 'production.batch.started' || e.id === 'gas.loaded').length, 0);
  const firstStep = output.actions.findIndex(a => a.id === 'simulation.step');
  assert.ok(output.actions.slice(0, firstStep).some(a => a.id === 'production.enable' && a.args.x === 7 && a.args.y === 7 && !a.args.enabled));
  const binding = output.actions.findIndex(a => a.id === 'airlock.configure'); assert.ok(binding > firstStep);
  assert.ok(output.actions.slice(binding + 1).every(a => a.id !== 'simulation.step'), 'restore uses no extra tick');
  assert.equal(output.actions.at(-1).id, 'production.enable'); assert.equal(output.actions.at(-1).args.enabled, true);
  assert.equal(output.actions.at(-1).tick, state.tick, 'action ticks describe the post-command endpoint');
});

test('synthetic already-sufficient checkpoint returns zero actions and exact final boundaries', () => {
  assert.equal(mechanics().summary.ok, true);
  const state = deserialize(serialize(mechanics().state)), before = serialize(state), output = commissionPaidAirlock(state);
  assert.equal(output.summary.ok, true); assert.equal(output.summary.attempts, 0); assert.equal(output.summary.addedTicks, 0); assert.equal(serialize(state), before);
  const lowBank = deserialize(before), site = lowBank.sites.surface, bank = tileAt(site, 13, 7);
  bank.charge = 120 - Number.EPSILON * 120; site.energy.discarded += 120 - bank.charge; refreshPower(lowBank, site);
  assert.equal(commissioningStatus(lowBank).ok, false);
  const missingLabor = deserialize(before); missingLabor.crew[0].labors.production = false; assert.equal(commissioningStatus(missingLabor).ok, false);
});

test('synthetic first gas cap preserves isolation flags with no cleanup', async () => {
  const output = commissionPaidAirlock(synthetic(), { limits: { gasTicks: 1 }, record: true }); await preserve('gas-cap', output);
  assert.equal(output.summary.failure?.code, 'gas_tick_limit'); assert.equal(output.summary.addedTicks, 1); assert.equal(output.summary.gasTicks, 1);
  const site = output.state.sites.surface;
  assert.equal(tileAt(site, 7, 7).machine.enabled, false); assert.equal(tileAt(site, 10, 13).gasDevice.enabled, true);
  assert.equal(tileAt(site, 10, 15).gasDevice.enabled, true); assert.equal(tileAt(site, 10, 12).doorMode, 'closed');
  assert.equal(tileAt(site, 10, 10).airlock, null);
  assert.ok(commissioningStatus(output.state).r.chamber.pressure < 100, 'finite gas physically moved before the first cap');
});

test('synthetic first new harm stops on its full tick without restoration', async () => {
  const state = synthetic(); state.crew[0].hunger = 0;
  const output = commissionPaidAirlock(state, { record: true }); await preserve('crew-harmed', output);
  assert.equal(output.summary.failure?.code, 'crew_harmed'); assert.equal(output.summary.addedTicks, 1);
  assert.equal(output.actions.at(-1).id, 'simulation.step'); assert.ok(state.crew[0].health < 100);
  assert.equal(tileAt(state.sites.surface, 7, 7).machine.enabled, false);
});

test('synthetic finite refill status includes its pocket but rejects an insufficient reserve', () => {
  const state = synthetic(), site = state.sites.surface, chamber = roomAt(site, 10, 13), node = tileAt(site, 10, 13).gasStore;
  const original = Object.fromEntries(Object.entries(chamber.gas).map(([key, n]) => [key, n / 2])); fillRoom(chamber, 0); node.gas = original; site.gasNetwork.extracted = { ...original }; refreshAtmosphere(site);
  const save = serialize(state); assert.equal(serialize(deserialize(save)), save);
  const status = commissioningStatus(state); assert.equal(status.r.supply, Object.values(original).reduce((n, q) => n + q, 0));
  assert.ok(status.r.supply > 0 && status.r.supply < status.r.fillNeeded); assert.equal(status.r.blocker, 'supply_empty');
  assert.equal(status.readyToBind, false); assert.equal(serialize(state), save);
});

test('synthetic finite refill uses the actual rounded target and only available gas', () => {
  for (const [volume, breathable] of [[20, true], [19.6, false]]) {
    const state = synthetic(), site = state.sites.surface;
    fillRoom(roomAt(site, 10, 13), 0);
    const gas = { oxygen: volume * .16, inert: volume * .84, co2: 0 };
    tileAt(site, 10, 16).gasStore.gas = { ...gas }; site.gasNetwork.loaded = { ...gas }; refreshAtmosphere(site);
    const before = serialize(state); assert.equal(serialize(deserialize(before)), before);
    const status = commissioningStatus(state);
    assert.equal(status.r.supply, volume); assert.equal(status.r.fillNeeded, 19.6);
    assert.equal(status.r.predicted.breathable, breathable);
    assert.equal(status.r.blocker, breathable ? null : 'contaminated_mix');
    assert.equal(status.readyToBind, breathable); assert.equal(serialize(state), before);
  }
});

test('options and CLI enforce lower-only caps and distinct canonical destinations', () => {
  const state = synthetic(), before = serialize(state);
  for (const options of [{ limits: { ticks: 48 } }, { limits: { gasTicks: 48 } }, { limits: { commands: 36 } }, { limits: { toString: 1 } }, { record: 'yes' }, { geometry: [] }]) assert.throws(() => commissionPaidAirlock(state, options), TypeError);
  assert.equal(serialize(state), before);
  assert.deepEqual(parseArguments(['--input', 'in', '--save', 'out', '--gasTicks', '1']), { input: 'in', save: 'out', limits: { gasTicks: 1 } });
  for (const args of [[], ['--input'], ['--input', 'in', '--save', 'in'], ['--input', 'in', '--gasTicks', '48'], ['--input', 'in', '--ticks', '-1']]) assert.throws(() => parseArguments(args), TypeError);
});

test('offline CLI exports canonical synthetic stopped and sufficient states', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'paid-commissioning-')), input = join(directory, 'input.json'), save = join(directory, 'save.json'), record = join(directory, 'recording.ndjson');
  await writeFile(input, serialize(synthetic()));
  const failed = spawnSync(process.execPath, ['tools/paid-airlock-commissioning.mjs', '--input', input, '--save', save, '--record', record, '--gasTicks', '0'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr); assert.equal(JSON.parse(failed.stdout).failure.code, 'gas_tick_limit');
  const stopped = await readFile(save, 'utf8'); assert.equal(serialize(deserialize(stopped)), stopped); assert.match(await readFile(record, 'utf8'), /"kind":"footer"/);
  assert.equal(mechanics().summary.ok, true); const ready = serialize(mechanics().state); await writeFile(input, ready);
  const success = spawnSync(process.execPath, ['tools/paid-airlock-commissioning.mjs', '--input', input, '--save', save], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr); assert.equal(JSON.parse(success.stdout).attempts, 0); assert.equal(await readFile(save, 'utf8'), ready);
  await writeFile(input, '{invalid'); const invalid = spawnSync(process.execPath, ['tools/paid-airlock-commissioning.mjs', '--input', input], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stdout).failure.code, 'cli_error');
});

// SYNTHETIC native-birth reference: breeding.test.js's tibble-parent fixture.
// The ordinary shared tick creates its child away from the sealed airlock.
test('synthetic native birth away from chamber and doors preserves commissioning', async () => {
  const state = synthetic();
  state.creatures.push({ id: 'tibble-parent', species: 'tibble', site: 'surface', z: 0, x: 8, y: 10, health: 100, fed: 100, age: 60 });
  const before = serialize(state); assert.equal(serialize(deserialize(before)), before);
  const initialNextId = state.nextId;
  const output = commissionPaidAirlock(state, { record: true }); await preserve('native-birth', output);
  const events = output.recording.trim().split('\n').map(line => JSON.parse(line)).filter(r => r.kind === 'event').map(r => r.event);
  const birth = events.find(e => e.id === 'pest.born' && e.parent === 'tibble-parent');
  assert.ok(birth, 'a real native birth occurs during the full shared tick');
  const child = state.creatures.find(c => c.id === birth.entity);
  assert.ok(child); assert.equal(child.health, 100);
  assert.ok(!['10,13', '11,13', '10,12', '12,14'].includes(`${child.x},${child.y}`));
  assert.ok(state.nextId > initialNextId, 'the native birth advances the shared allocator');
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.equal(output.summary.status.ok, true); assert.equal(output.summary.status.habitatReturned, true);
  assert.equal(output.summary.status.controller.binding, `airlock-${state.nextId - 1}`, 'binding uses the actual allocator after the birth');
  assert.equal(serialize(deserialize(serialize(state))), serialize(state));
});
