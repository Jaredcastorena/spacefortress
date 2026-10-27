import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { tileAt } from '../src/geometry.js';
import { syncResources, initializeStorage } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
import { startRecording, stopRecording, exportRecording, recordingStatus } from '../src/telemetry.js';
import { containHabitatWaste, LIMITS } from '../tools/contain-habitat-waste.mjs';

const options = { crew: 'crew-4', habitat: [10, 10] };
const act = (state, id, args) => {
  const result = executeAction(state, id, args, 'test');
  assert.equal(result.ok, true, result.message);
  return result;
};
// SYNTHETIC only: a fresh seeded colony, directly supplied waste/exposure and
// isolated labors/needs. This is mechanics coverage, not an ordinary journey.
function fixture({ amount = 3.5, exposure = 10, injury = 0 } = {}) {
  const state = createGame(713), site = state.sites.surface;
  for (const tile of site.tiles) if (tile.machine && tile.building !== 'scrubber') tile.machine.enabled = false;
  for (const c of state.crew) {
    c.life.policy = 'rest'; c.possessions.collect = false;
    for (const labor of Object.keys(c.labors)) c.labors[labor] = labor === 'hauling' && c.id === options.crew;
    c.sanitation.exposure = exposure;
    c.health = 100 - injury; c.medical.injury = injury;
    if (injury) c.medical.cause = 'unsanitary exposure';
  }
  const worker = state.crew.find(c => c.id === options.crew);
  worker.x = 8; worker.y = 10;
  tileAt(site, 8, 10).stock.waste = amount;
  state.creatures = [];
  refreshPower(state, site); syncResources(state);
  return deserialize(serialize(state));
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const run = (state, extra = {}) => containHabitatWaste(state, { ...options, ...extra });

function unchanged(state, expectedCode, extra = {}) {
  const before = serialize(state), output = run(state, extra);
  assert.equal(output.summary.ok, false);
  assert.equal(output.summary.failure.code, expectedCode);
  assert.equal(output.endpoint, before);
  assert.equal(serialize(state), before);
  assert.equal(output.actions.length, 0);
  return output;
}

test('native pickup seals the exact parcel and stops at the first measured exposure decline', () => {
  const state = fixture(), output = run(state, { record: true }), { checkpoint } = output.summary;
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.equal(output.state, state);
  assert.equal(checkpoint.exposedWaste, 0);
  assert.equal(checkpoint.parcel.requested, 3.5);
  assert.equal(checkpoint.parcel.carried, 3.5);
  assert.equal(checkpoint.parcel.total, 3.5);
  assert.equal(checkpoint.parcel.reserved + checkpoint.parcel.staged + checkpoint.parcel.onboard, 0);
  assert.ok(checkpoint.occupants.every(c => c.current < c.peak));
  assert.equal(checkpoint.freight.pending, true);
  assert.deepEqual(checkpoint.routine, { crew: options.crew, original: 'rest', current: 'work' });
  assert.equal(output.summary.safeHabitationEstablished, false);
  assert.equal(output.summary.medicalRecoveryEstablished, false);
  assert.equal(output.summary.commands, 2);
  assert.ok(output.summary.addedTicks > 0 && output.summary.addedTicks <= LIMITS.ticks);
  assert.ok(state.crew.every(c => c.health === 100 && c.medical.injury === 0));
  const rows = output.recording.trim().split('\n').map(JSON.parse);
  const pickups = rows.filter(r => r.event?.id === 'freight.picked_up');
  assert.equal(pickups.length, 1);
  assert.equal(pickups[0].event.cargo.waste, 3.5);
  assert.equal(rows.filter(r => r.kind === 'external').length, 0);
  assert.equal(rows.at(-1).reason, 'stopped');
  // Replaying exactly one fewer action has sealed carry but no decline yet.
  const earlier = fixture();
  for (const action of output.actions.slice(0, -1)) act(earlier, action.id, action.args);
  assert.ok(earlier.crew.every(c => c.sanitation.exposure >= checkpoint.occupants.find(o => o.crew === c.id).peak));
  assert.equal(earlier.crew.find(c => c.id === options.crew).carry.waste, 3.5);
});

test('a finite tick cap preserves partial pickup, exposed remainder and pending work', () => {
  const state = fixture({ amount: 10 }), output = run(state, { limits: { ticks: 1 } });
  assert.equal(output.summary.ok, false);
  assert.equal(output.summary.failure.code, 'tick_limit');
  assert.equal(output.summary.addedTicks, 1);
  const { parcel, exposedWaste, freight } = output.summary.checkpoint;
  assert.equal(parcel.carried, 6);
  assert.equal(parcel.reserved, 4);
  assert.equal(parcel.total, 10);
  assert.equal(exposedWaste, 4);
  assert.equal(freight.pending, true);
  assert.equal(serialize(deserialize(output.endpoint)), output.endpoint);
  assert.deepEqual(output.actions.map(a => a.id), ['crew.routine', 'freight.load', 'simulation.step']);
});

test('command and attempt caps stop before the next action without cleanup', () => {
  for (const [limit, code] of [['commands', 'command_limit'], ['attempts', 'attempt_limit']]) {
    const state = fixture(), output = run(state, { limits: { [limit]: 1 } });
    assert.equal(output.summary.failure.code, code);
    assert.equal(output.summary.addedTicks, 0);
    assert.equal(output.actions.length, 1);
    assert.equal(state.crew.find(c => c.id === options.crew).life.policy, 'work');
    assert.equal(state.jobs.length, 0);
    assert.equal(tileAt(state.sites.surface, 8, 10).stock.waste, 3.5);
  }
});

test('pending freight and rejected native supply preflight leave the input unchanged', () => {
  const pending = fixture();
  act(pending, 'freight.load', { items: { alloy: 1 } });
  unchanged(pending, 'freight_pending');
  act(pending, 'crew.routine', { crew: options.crew, policy: 'work' });
  act(pending, 'simulation.step', { ticks: 1 });
  unchanged(pending, 'worker_busy');
  const absent = fixture({ amount: 0 });
  unchanged(absent, 'no_exposed_waste');
  const noHauling = fixture(); noHauling.crew.find(c => c.id === options.crew).labors.hauling = false;
  unchanged(noHauling, 'invalid_worker');
  unchanged(fixture({ amount: 100 }), 'freight_capacity');
  unchanged(fixture(), 'invalid_input', { habitat: [0, 0] });
  const inaccessible = fixture();
  // A broken sanitary tank exposes waste, but freight cannot reserve its output.
  const depot = tileAt(inaccessible.sites.surface, 8, 10), broken = tileAt(inaccessible.sites.surface, 12, 10);
  delete depot.stock.waste;
  broken.building = 'sanitary'; broken.hp = 0; broken.sanitary = { output: { waste: 3.5 } };
  refreshPower(inaccessible, inaccessible.sites.surface); syncResources(inaccessible);
  unchanged(deserialize(serialize(inaccessible)), 'preflight_rejected');
  const elsewhere = fixture(), otherSite = elsewhere.sites.surface;
  delete tileAt(otherSite, 8, 10).stock.waste;
  tileAt(otherSite, 10, 10).drop = { waste: 3.5 };
  const outside = tileAt(otherSite, 16, 10);
  outside.building = 'stockpile'; initializeStorage(outside); outside.stock.waste = 1;
  syncResources(elsewhere);
  unchanged(deserialize(serialize(elsewhere)), 'source_mismatch');
});

test('injury defaults stop immediately and an explicit small sanitation allowance is bounded', () => {
  const initial = fixture({ exposure: 80, injury: .05 });
  const stopped = run(initial);
  assert.equal(stopped.summary.failure.code, 'crew_harmed');
  assert.equal(stopped.summary.addedTicks, 1);
  assert.equal(stopped.actions.at(-1).id, 'simulation.step');
  assert.ok(initial.crew.some(c => c.medical.injury > .05));
  const state = fixture({ exposure: 80, injury: .05 }), output = run(state, { additionalSanitationInjury: .02 });
  assert.equal(output.summary.ok, true, JSON.stringify(output.summary.failure));
  assert.ok(state.crew.every(c => c.medical.injury > .05 && c.medical.injury <= .07 + 1e-8));
  assert.ok(state.crew.every(c => c.medical.cause === 'unsanitary exposure'));
  close(output.summary.checkpoint.parcel.total, 3.5);
});

test('recording is optional, preserves existing sessions, and leaves saves and continuation identical', () => {
  const plain = fixture(), recorded = fixture();
  const a = run(plain), b = run(recorded, { record: true });
  assert.equal(a.summary.ok, true);
  assert.equal(b.summary.ok, true);
  assert.equal(b.endpoint, a.endpoint);
  assert.equal(a.recording, undefined);
  assert.deepEqual(a.actions, b.actions);
  const restored = deserialize(b.endpoint);
  assert.equal(serialize(restored), b.endpoint);
  for (let i = 0; i < 3; i++) {
    for (const state of [plain, recorded, restored]) act(state, 'simulation.step', { ticks: 1 });
    assert.equal(serialize(recorded), serialize(plain));
    assert.equal(serialize(restored), serialize(plain));
  }
  for (const active of [true, false]) {
    const existing = fixture(); startRecording(existing);
    if (!active) stopRecording(existing);
    const previous = exportRecording(existing);
    unchanged(existing, 'recording_exists', { record: true });
    assert.equal(exportRecording(existing), previous);
    assert.equal(recordingStatus(existing).active, active);
  }
  const external = fixture(); startRecording(external);
  const output = run(external);
  assert.equal(output.summary.ok, true);
  assert.equal(recordingStatus(external).active, true, 'caller-owned recording is not stopped');
});

test('invalid options reject before any state or recording mutation', () => {
  for (const extra of [{ crew: null }, { habitat: [1] }, { record: 'yes' }, { additionalSanitationInjury: Infinity }, { additionalSanitationInjury: .11 }, { limits: { ticks: LIMITS.ticks + 1 } }, { limits: { ticks: NaN } }, { unknown: true }]) {
    const state = fixture(), before = serialize(state);
    assert.throws(() => run(state, extra), TypeError);
    assert.equal(serialize(state), before);
    assert.equal(recordingStatus(state).reason, 'not_started');
  }
});
