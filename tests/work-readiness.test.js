import { TELEMETRY_VERSION as CURRENT_OBSERVATION_VERSION } from '../src/telemetry.js';
import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { availableForWork, workReadiness } from '../src/crew.js';
import { createGame, step, serialize, deserialize } from '../src/simulation.js';
import { observe, startRecording, stopRecording, exportRecording } from '../src/telemetry.js';
import { executeAction } from '../src/controls.js';

const worker = (changes = {}) => ({
  health: 100, thermalStress: 0, medical: { injury: 0, bed: null },
  life: { policy: 'work' }, site: 'surface', rescue: null, intent: null,
  carry: null, job: null, temperament: 'steady', oxygen: 25, hunger: 35, energy: 25,
  ...changes,
});

function expectReadiness(c, blockers, minimumSuitOxygen = 25) {
  assert.deepEqual(workReadiness(c), { available: !blockers.length, blockers, minimumSuitOxygen });
  assert.equal(availableForWork(c), !blockers.length);
}

test('work readiness preserves exact health, temperature, mobility and need boundaries', () => {
  expectReadiness(worker(), []);
  for (const [changes, blockers] of [
    [{ health: 0 }, ['dead']], [{ health: .001 }, []],
    [{ thermalStress: 44.999 }, []], [{ thermalStress: -44.999 }, []],
    [{ thermalStress: 45 }, ['thermal_stress']], [{ thermalStress: -45 }, ['thermal_stress']],
    [{ medical: { injury: 59.999 } }, []], [{ medical: { injury: 60 } }, ['immobile']],
    [{ oxygen: 24.999 }, ['low_suit_oxygen']], [{ hunger: 34.999 }, ['hungry']],
    [{ energy: 24.999 }, ['fatigued']],
  ]) expectReadiness(worker(changes), blockers);
});

test('suit oxygen requirements retain temperament-specific limits', () => {
  for (const temperament of ['steady', 'driven', 'social', undefined]) {
    expectReadiness(worker({ temperament }), []);
  }
  expectReadiness(worker({ temperament: 'cautious', oxygen: 34.999 }), ['low_suit_oxygen'], 35);
  expectReadiness(worker({ temperament: 'cautious', oxygen: 35 }), [], 35);
});

test('optional fields, truthiness and comparison coercion keep their existing work rules', () => {
  for (const [changes, blockers] of [
    [{ medical: undefined, life: undefined, thermalStress: undefined }, []],
    [{ rescue: {} }, ['rescuing']], [{ rescue: false }, []],
    [{ medical: { bed: [] } }, ['assigned_medical_cot']], [{ medical: { bed: '' } }, []],
    [{ life: { policy: 'rest' } }, ['off_duty']], [{ life: { policy: 'REST' } }, []],
    [{ site: 'transit' }, ['in_transit']], [{ site: undefined }, []],
    [{ intent: {} }, ['busy_intent']], [{ intent: '' }, []],
    [{ carry: {} }, ['carrying']], [{ carry: 0 }, []],
    [{ job: 'job-1' }, ['assigned_job']], [{ job: false }, []],
    [{ health: undefined }, ['dead']], [{ health: NaN }, ['dead']],
    [{ thermalStress: NaN }, []], [{ thermalStress: 'invalid' }, ['thermal_stress']],
    [{ oxygen: undefined }, ['low_suit_oxygen']], [{ oxygen: NaN }, ['low_suit_oxygen']],
    [{ hunger: undefined }, ['hungry']], [{ hunger: NaN }, ['hungry']],
    [{ energy: undefined }, ['fatigued']], [{ energy: NaN }, ['fatigued']],
    [{ health: '1', oxygen: '25', hunger: '35', energy: '25' }, []],
  ]) expectReadiness(worker(changes), blockers);
});

test('all simultaneous work blockers are reported once in canonical order', () => {
  expectReadiness(worker({
    health: 0, thermalStress: -45, medical: { injury: 60, bed: { x: 1, y: 2, z: 0 } },
    rescue: {}, life: { policy: 'rest' }, site: 'transit', intent: {}, carry: {},
    job: 'job-1', temperament: 'cautious', oxygen: 34.999, hunger: 34.999, energy: 24.999,
  }), ['dead', 'thermal_stress', 'immobile', 'rescuing', 'assigned_medical_cot',
    'off_duty', 'in_transit', 'busy_intent', 'carrying', 'assigned_job',
    'low_suit_oxygen', 'hungry', 'fatigued'], 35);
});

test('readiness is pure and each result has an independent mutable blocker list', () => {
  const c = worker({ energy: 24 });
  Object.freeze(c.medical); Object.freeze(c.life); Object.freeze(c);
  const before = structuredClone(c), first = workReadiness(c);
  first.available = true; first.blockers.push('invented'); first.minimumSuitOxygen = 0;
  expectReadiness(c, ['fatigued']);
  assert.deepEqual(c, before);
  const ready = workReadiness(worker()); ready.blockers.push('invented');
  expectReadiness(worker(), []);
});

test('detached observations expose shared work readiness while preserving other crew diagnostics', () => {
  const s = createGame(), c = s.crew[0]; c.energy = 24; c.carry = { ore: 1 };
  const before = serialize(s), rng = s.rng, o = observe(s), entity = o.entities[c.id];
  assert.equal(o.schemaVersion, CURRENT_OBSERVATION_VERSION); assert.equal(s.version, CURRENT_SAVE_VERSION);
  assert.deepEqual(entity.derived.work, workReadiness(c));
  assert.deepEqual(entity.derived.work.blockers, ['carrying', 'fatigued']);
  for (const key of ['expedition', 'residence', 'currentComfort', 'homeComfort']) {
    assert.ok(Object.hasOwn(entity.derived, key), key);
  }
  entity.derived.work.blockers.push('invented'); entity.derived.work.available = true;
  entity.carry.ore = 99;
  assert.deepEqual(observe(s).entities[c.id].derived.work, workReadiness(c));
  assert.equal(serialize(s), before); assert.equal(s.rng, rng);
  assert.ok(!Object.hasOwn(c, 'derived'));
});

test('runtime assignments agree with work labels and recording leaves gameplay, RNG and saves unchanged', () => {
  const recorded = createGame(), miner = recorded.crew[2];
  for (const c of recorded.crew) c.labors.mining = c.id === miner.id;
  const plain = deserialize(serialize(recorded));
  startRecording(recorded);
  for (const s of [recorded, plain]) {
    assert.equal(executeAction(s, 'crew.routine', { crew: miner.id, policy: 'rest' }).ok, true);
    assert.equal(executeAction(s, 'job.order', { site: 'surface', x: 4, y: 10, kind: 'mine' }).ok, true);
    step(s);
    const c = s.crew[2], job = s.jobs.find(j => j.kind === 'mine');
    assert.equal(job.worker, null);
    assert.ok(workReadiness(c).blockers.includes('off_duty'));
    assert.deepEqual(observe(s).entities[c.id].derived.work, workReadiness(c));
    assert.equal(executeAction(s, 'crew.routine', { crew: c.id, policy: 'work' }).ok, true);
    assert.equal(observe(s).entities[c.id].derived.work.available, true);
    step(s);
    assert.equal(job.worker, c.id); assert.equal(c.job, job.id);
    assert.deepEqual(observe(s).entities[c.id].derived.work.blockers, ['assigned_job']);
  }
  stopRecording(recorded);
  assert.deepEqual(recorded, plain); assert.equal(recorded.rng, plain.rng);
  assert.equal(serialize(recorded), serialize(plain));
  const rows = exportRecording(recorded).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(rows[0].schemaVersion, CURRENT_OBSERVATION_VERSION);
  assert.deepEqual(rows[0].observation.entities[miner.id].derived.work, {
    available: true, blockers: [], minimumSuitOxygen: 25,
  });
  const changes = rows.flatMap(row => row.changes || []).filter(change =>
    change.entity === miner.id && change.path[0] === 'derived' && change.path[1] === 'work');
  assert.ok(changes.some(change => change.path[2] === 'available' && change.value === false));
  assert.ok(changes.some(change => change.path[2] === 'blockers' && change.value.includes('off_duty')));
  assert.ok(changes.some(change => change.path[2] === 'blockers' && change.value.includes('assigned_job')));
  assert.ok(changes.every(change => change.system === 'derived_conditions'));
});
