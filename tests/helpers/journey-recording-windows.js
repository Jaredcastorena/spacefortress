// Test-only bounded evidence. Full deltas are verified before retaining a
// compact index of the original events/actions used by each acceptance test.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { step as nativeStep, serialize } from '../../src/simulation.js';
import { observe, startRecording, stopRecording, exportRecording, recordingStatus } from '../../src/telemetry.js';
const sessions = new WeakMap();
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
export const journeyRecording = state => sessions.get(state);
export function beforeJourneyAction(state) {
  const session = sessions.get(state);
  if (session && !session.done) { session.before(); session.requested(); }
}
export function journeyStep(state, ticks = 1) {
  const session = sessions.get(state);
  if (!session || session.done) return nativeStep(state, ticks);
  for (let tick = 0; tick < ticks; tick++) { session.before(); nativeStep(state); }
}
export function beginJourneyRecording(state, { limits = { maxRecords: 2000, maxBytes: 16_000_000 }, maxTicks = 2, tickLimit, stageLimit = 1, stage = 'run', event = () => false, change = () => false } = {}) {
  assert.ok(Number.isInteger(tickLimit) && tickLimit >= 0);
  assert.ok(Number.isInteger(maxTicks) && maxTicks > 0 && maxTicks <= (limits.maxRecords === 2000 && limits.maxBytes === 16_000_000 ? 4 : 20));
  assert.ok(!sessions.has(state) || sessions.get(state).done);
  const initialTick = state.tick, initialState = hash(serialize(state)), index = [], coverage = new Map(), windows = [];
  let firstHeader = null, current = null, previous = null, sequence = 0, requests = 0, expectedRequests = 0, ticks = 0;
  function preserveFailure(error) {
    if (error.journeyRecordingFailure) return error;
    const raw = exportRecording(state), sha = hash(raw);
    const directory = mkdtempSync(join(tmpdir(), 'spacefortress-recording-'));
    const artifact = join(directory, `window-sha256-${sha}.ndjson`);
    try { writeFileSync(artifact, raw, { flag: 'wx', mode: 0o444 }); }
    catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
    assert.equal(hash(readFileSync(artifact)), sha, 'frozen failure bytes verified');
    chmodSync(artifact, 0o444);
    error.journeyRecordingFailure = artifact;
    error.message += `; raw failed window: ${error.journeyRecordingFailure}`;
    return error;
  }
  function guarded(run) {
    try { return run(); } catch (error) { throw preserveFailure(error); }
  }
  function open(name) {
    const before = serialize(state), observation = observe(state);
    if (previous) {
      assert.equal(hash(before), previous.state, 'exact initial-state seam');
      assert.ok(isDeepStrictEqual(observation, previous.observation), 'exact observation seam');
    }
    current = { stage: name, tick: state.tick, state: hash(before), observation };
    assert.equal(startRecording(state, limits).active, true, 'original window header fits');
    assert.equal(serialize(state), before, 'starting evidence does not alter physical state');
  }
  function seal(reason) {
    assert.ok(current, 'one active evidence window');
    const endpoint = serialize(state), observed = observe(state);
    stopRecording(state);
    const rows = exportRecording(state).trim().split('\n').map(JSON.parse), header = rows[0], footer = rows.at(-1), records = rows.slice(1, -1);
    assert.equal(footer.kind, 'footer'); assert.equal(footer.reason, 'stopped', 'every original window is complete');
    assert.equal(footer.active, false); assert.equal(footer.throughTick, state.tick); assert.equal(footer.lastSequence, records.length);
    assert.equal(footer.records, records.length, 'footer counts every retained record');
    assert.equal(footer.maxRecords, limits.maxRecords); assert.equal(footer.maxBytes, limits.maxBytes);
    assert.ok(footer.records <= limits.maxRecords && footer.bytes <= limits.maxBytes);
    assert.equal(hash(JSON.stringify(header.initialState)), current.state);
    assert.ok(isDeepStrictEqual(header.observation, current.observation));
    assert.equal(header.initialState.tick, current.tick);
    assert.ok(state.tick - current.tick <= maxTicks, 'declared maximum tick interval');
    firstHeader ??= header;
    const reconstructed = copy(header.observation);
    for (const [offset, row] of records.entries()) {
      assert.equal(row.sequence, offset + 1);
      for (const delta of row.changes || []) {
        if (!delta.path.length) {
          if (delta.op === 'remove') delete reconstructed.entities[delta.entity];
          else reconstructed.entities[delta.entity] = copy(delta.value);
        } else {
          let target = reconstructed.entities[delta.entity];
          for (const key of delta.path.slice(0, -1)) target = target[key];
          const key = delta.path.at(-1);
          if (delta.op === 'remove') delete target[key]; else target[key] = copy(delta.value);
        }
        if (change(delta)) coverage.set(JSON.stringify([delta.entity, delta.system, delta.path, delta.op]), { entity: delta.entity, system: delta.system, path: copy(delta.path), op: delta.op });
      }
      if (row.fromTick !== undefined) reconstructed.tick = row.tick;
      if (row.kind === 'simulation.tick') ticks++;
      if (row.kind === 'action.requested') requests++;
      if (row.kind === 'action.requested' || row.event && event(row.event)) {
        index.push({ ...row, sequence: sequence + row.sequence, command: row.command == null ? row.command : sequence + row.command, changes: [] });
      }
    }
    assert.ok(isDeepStrictEqual(reconstructed, observed), 'all deltas reconstruct the complete window');
    assert.equal(serialize(state), endpoint, 'closing evidence does not alter physical state');
    sequence += records.length;
    windows.push({ stage: current.stage, reason, fromTick: current.tick, throughTick: state.tick, records: records.length, bytes: footer.bytes, ticks: records.filter(row => row.kind === 'simulation.tick').length, requests: records.filter(row => row.kind === 'action.requested').length, commands: records.filter(row => row.kind === 'action.requested' && row.action.id !== 'simulation.step').length, external: records.filter(row => row.kind === 'external').length, initialState: current.state, finalState: hash(endpoint), complete: true });
    previous = { state: hash(endpoint), observation: reconstructed }; current = null;
  }
  function rows() {
    // This is a claim index, never presented as a full raw JSONL recording.
    // Each discarded large delta has already been reconstructed and checked.
    return [firstHeader, ...index, { kind: 'verified-change-coverage', changes: [...coverage.values()] }];
  }
  const session = {
    done: false,
    windows,
    preserveFailure,
    requested() { expectedRequests++; },
    before() {
      return guarded(() => {
      assert.equal(recordingStatus(state).active, true, 'incomplete window cannot be replaced');
      if (state.tick - current.tick >= maxTicks) { const name = current.stage; seal('tick_bound'); open(name); }
      });
    },
    checkpoint(name) { return guarded(() => { seal('stage'); const result = rows(); open(name); return result; }); },
    finish() { return guarded(() => {
      if (!session.done) { seal('endpoint'); session.done = true; }
      session.assertComplete(); return rows();
    }); },
    assertComplete() { return guarded(() => {
      assert.equal(session.done, true); assert.ok(windows.length && windows.every(window => window.complete));
      assert.ok(windows.length <= Math.ceil(tickLimit / maxTicks) + stageLimit + 1, 'bounded total windows');
      assert.equal(windows[0].initialState, initialState); assert.equal(previous.state, hash(serialize(state)));
      assert.ok(isDeepStrictEqual(previous.observation, observe(state)), 'continuous reconstruction reaches the current endpoint');
      assert.equal(ticks, state.tick - initialTick, 'all scenario ticks covered exactly once');
      assert.equal(requests, expectedRequests, 'all wrapped requests covered exactly once');
    }); },
  };
  sessions.set(state, session); guarded(() => open(stage)); return session;
}
