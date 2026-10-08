import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, serialize, act, advance, until, checkpoint, diagnostic, diagnosticSummary, traceActions } from './helpers/outpost-gameplay.js';

const giant = 'diagnostic description '.repeat(10000);
function failure(fn) {
  let caught;
  try { fn(); } catch (error) { caught = error; }
  assert.ok(caught instanceof assert.AssertionError, 'Expected a helper assertion failure');
  assert.ok(caught.message.length <= 1600, `Failure message length: ${caught.message.length}`);
  assert.ok(inspect(caught).length < 3500, 'Assertion inspection must not include full states');
  return caught.message;
}
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'outpost-diagnostics-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('a real rejected public action gives its reason without changing the colony', () => {
  const s = createGame();
  const before = serialize(s);
  const trace = traceActions(s);
  const message = failure(() => act(s, 'expedition.recall'));
  assert.match(message, /expedition\.recall/);
  assert.match(message, /simulation_rejected/);
  assert.equal(serialize(s), before);
  assert.deepEqual(trace, []);
});

test('enormous rejected arguments and synthetic diagnostics stay capped', () => {
  const s = createGame();
  const before = serialize(s);
  const message = failure(() => act(s, 'simulation.step', { ticks: 1, description: giant, values: Array(10000).fill('value') }));
  assert.match(message, /Arguments must be small JSON data/);
  assert.equal(serialize(s), before);
  const synthetic = { tick: 42, crew: Array(200).fill({}), jobs: [{ id: giant, blockedReason: giant }],
    mission: { phase: giant }, resources: { food: 3, description: giant }, sites: { surface: { rooms: Array(1000).fill({}) } } };
  const summary = diagnosticSummary(synthetic);
  assert.equal(summary.crew, 200);
  assert.equal(summary.rooms, 1000);
  assert.ok(JSON.stringify(summary).length < 1400);
});

test('failed until advances exactly its bounded horizon with a compact predicate summary', () => {
  const s = createGame();
  const expected = createGame();
  advance(expected, 2);
  let calls = 0;
  const message = failure(() => until(s, () => { calls++; return false; }, giant, 2));
  assert.match(message, /predicate unsatisfied after limit=2/);
  assert.match(message, /"tick":"2"/);
  assert.match(message, /"crew":7/);
  assert.equal(calls, 3);
  assert.equal(serialize(s), serialize(expected));
});

test('until writes complete diagnostic and successful trace only to an explicitly selected failure artifact', t => {
  const directory = temporary(t);
  const artifactPath = join(directory, 'until.json');
  const s = createGame();
  traceActions(s);
  failure(() => until(s, () => false, 'default failure', 0));
  assert.deepEqual(readdirSync(directory), []);
  failure(() => until(s, () => false, 'saved failure', 1, { artifactPath }));
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(JSON.stringify(artifact.diagnostic), JSON.stringify(diagnostic(s)), 'Artifact preserves the JSON diagnostic');
  assert.deepEqual(artifact.actions, [{ id: 'simulation.step', args: { ticks: 1 } }]);
});

test('successful actions, until and exact reload keep their original results and timing', t => {
  const directory = temporary(t);
  const s = createGame();
  const expected = createGame();
  const trace = traceActions(s);
  const result = act(s, 'simulation.step', { ticks: 1 });
  assert.equal(result.ok, true);
  assert.equal(until(s, current => current.tick === 1, 'already ready', 4), s);
  const restored = checkpoint(s, giant, 3, { artifactPath: join(directory, 'unexpected.json') });
  advance(expected, 1); advance(expected, 3);
  assert.deepEqual(s, expected);
  assert.deepEqual(restored, expected);
  assert.deepEqual(trace, [{ id: 'simulation.step', args: { ticks: 1 } }, { id: 'simulation.step', args: { ticks: 3 } }]);
  assert.deepEqual(readdirSync(directory), []);
});

test('reload mismatch reports the first path and saves full comparisons only on request', t => {
  const directory = temporary(t);
  const s = createGame();
  // A synthetic metadata field is lost by JSON; no crew or inventory fixture edits.
  s.diagnosticOnly = undefined;
  s.largeDiagnosticDescription = giant;
  const before = serialize(s);
  const message = failure(() => checkpoint(s, giant));
  assert.match(message, /exact reload at tick 0/);
  assert.match(message, /\$\.diagnosticOnly: expected "undefined", actual <missing>/);
  assert.deepEqual(readdirSync(directory), []);
  const artifactPath = join(directory, 'reload.json');
  failure(() => checkpoint(s, 'metadata mismatch', 3, { artifactPath }));
  assert.equal(serialize(s), before);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.expected.largeDiagnosticDescription, giant);
  assert.equal(artifact.actual.largeDiagnosticDescription, giant);
  assert.equal(artifact.expected.tick, 0);
  assert.equal(artifact.actual.tick, 0);
});
