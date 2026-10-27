import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { productionEligibility } from '../src/production.js';
import { workReadiness } from '../src/crew.js';
import { initializeStorage, syncResources } from '../src/inventory.js';
import { observe, startRecording, stopRecording, exportRecording, tileEntityId } from '../src/telemetry.js';
import { executeAction } from '../src/controls.js';

// Synthetic diagnostic fixture; no simulation time or accepted colony state is used.
function workstation() {
  const s = createGame(), site = s.sites.surface, t = at(site, 13, 10), c = s.crew[0];
  for (const crew of s.crew) crew.labors.production = crew === c;
  Object.assign(t, { hp: 100, powered: true });
  Object.assign(t.machine, { enabled: true, input: { ore: 1 }, batch: {}, output: {}, order: { mode: 'continuous', limit: 0, remaining: 0, priority: 1 } });
  return { s, site, t, c };
}

test('a supplied powered workstation reports a qualified exhausted operator as unavailable', () => {
  const { s, site, t, c } = workstation(); c.energy = 24;
  const result = productionEligibility(s, site, t);
  assert.deepEqual(result.eligibleCrewIds, [c.id]);
  assert.equal(result.requirements[0].delivered, 1);
  assert.equal(result.blockedCode, 'operators_unavailable');
  assert.equal(result.message, 'Qualified production operators are not ready for work');
});


const blockers = [
  ['thermal_stress', c => { c.thermalStress = 45; }],
  ['immobile', c => { c.medical.injury = 60; }],
  ['rescuing', c => { c.rescue = {}; }],
  ['assigned_medical_cot', c => { c.medical.bed = { x: 9, y: 7, z: 0 }; }],
  ['off_duty', c => { c.life.policy = 'rest'; }],
  ['busy_intent', c => { c.intent = { type: 'rest' }; }],
  ['carrying', c => { c.carry = { ore: 1 }; }],
  ['assigned_job', c => { c.job = 'job-other'; }],
  ['low_suit_oxygen', c => { c.oxygen = 24.999; }],
  ['hungry', c => { c.hunger = 34.999; }],
  ['fatigued', c => { c.energy = 24.999; }],
];

for (const [blocker, change] of blockers) {
  test(`qualified operator exposes the existing ${blocker} blocker`, () => {
    const { s, site, t, c } = workstation(); change(c);
    const result = productionEligibility(s, site, t);
    assert.deepEqual(result.eligibleCrewIds, [c.id]);
    assert.deepEqual(result.crewReadiness, [{ id: c.id, available: false, blockers: [blocker], minimumSuitOxygen: 25 }]);
    assert.deepEqual(result.availableCrewIds, []);
    assert.equal(result.blockedCode, ['busy_intent', 'assigned_job'].includes(blocker) ? 'busy' : 'operators_unavailable');
  });
}

test('simultaneous blockers keep the shared order and personal readiness does not change qualification', () => {
  const { s, site, t, c } = workstation();
  for (const [, change] of blockers) change(c);
  c.temperament = 'cautious';
  const result = productionEligibility(s, site, t);
  assert.deepEqual(result.eligibleCrewIds, [c.id]);
  assert.deepEqual(result.crewReadiness, [{ id: c.id, available: false, blockers: blockers.map(([blocker]) => blocker), minimumSuitOxygen: 35 }]);
  assert.deepEqual(result.availableCrewIds, []);
  assert.equal(result.blockedCode, 'busy');
});

test('qualification still requires local living crew, enabled labor and the selected recipe skill', () => {
  const { s, site, t } = workstation(); t.building = 'galley'; initializeStorage(t); t.machine.recipeId = 'curd_bake';
  for (const c of s.crew) { c.labors.production = true; c.skills.production.level = 3; }
  s.crew[0].energy = 24;
  s.crew[1].skills.production.level = 2;
  s.crew[2].site = 'wreck';
  s.crew[3].health = 0;
  s.crew[4].labors.production = false;
  s.crew[5].site = 'transit';
  const result = productionEligibility(s, site, t);
  assert.equal(result.minSkill, 3);
  assert.deepEqual(result.eligibleCrewIds, [s.crew[0].id, s.crew[6].id]);
  assert.deepEqual(result.crewReadiness, [s.crew[0], s.crew[6]].map(c => ({ id: c.id, ...workReadiness(c) })));
  assert.deepEqual(result.availableCrewIds, [s.crew[6].id]);
});

test('availability keeps exact need, temperature, mobility and cautious oxygen boundaries', () => {
  for (const [temperament, minimum] of [['steady', 25], ['cautious', 35]]) {
    const { s, site, t, c } = workstation();
    Object.assign(c, { temperament, health: 1, oxygen: minimum, hunger: 35, energy: 25, thermalStress: 44.999 });
    c.medical.injury = 59.999;
    let result = productionEligibility(s, site, t);
    assert.deepEqual(result.availableCrewIds, [c.id]); assert.equal(result.blockedCode, null);
    assert.deepEqual(result.crewReadiness, [{ id: c.id, available: true, blockers: [], minimumSuitOxygen: minimum }]);
    for (const [key, value, blocker] of [['oxygen', minimum - .001, 'low_suit_oxygen'], ['hunger', 34.999, 'hungry'], ['energy', 24.999, 'fatigued'], ['thermalStress', -45, 'thermal_stress']]) {
      const previous = c[key]; c[key] = value; result = productionEligibility(s, site, t);
      assert.deepEqual(result.availableCrewIds, []); assert.deepEqual(result.crewReadiness[0].blockers, [blocker]);
      assert.equal(result.blockedCode, 'operators_unavailable'); c[key] = previous;
    }
  }
});

for (const [code, change] of [
  ['fire', ({ t }) => { t.fire = {}; }],
  ['paused', ({ t }) => { t.machine.enabled = false; }],
  ['reserved', ({ s, site, t }) => { s.jobs.push({ id: 'job-build', kind: 'build', site: site.id, x: t.x, y: t.y }); }],
  ['repair', ({ t }) => { t.hp = 0; }],
  ['order_complete', ({ t }) => { t.machine.order.mode = 'batches'; t.machine.order.remaining = 0; }],
  ['power', ({ t }) => { t.powered = false; }],
  ['output_full', ({ t }) => { t.machine.output = { alloy: 1000 }; }],
  ['inputs', ({ t }) => { t.machine.input = {}; }],
]) {
  test(`${code} retains precedence over busy and personal readiness`, () => {
    const fixture = workstation(); fixture.c.energy = 24; fixture.c.job = 'job-other'; change(fixture);
    const { s, site, t, c } = fixture, result = productionEligibility(s, site, t);
    assert.equal(result.blockedCode, code); assert.deepEqual(result.eligibleCrewIds, [c.id]);
    assert.deepEqual(result.availableCrewIds, []);
  });
}

test('qualification and ingredients keep their existing precedence over personal readiness', () => {
  const { s, site, t, c } = workstation(); c.energy = 24; c.labors.production = false; t.machine.input = {};
  assert.equal(productionEligibility(s, site, t).blockedCode, 'no_qualified_operator');
  t.building = 'galley'; initializeStorage(t); t.machine.recipeId = 'basic_ration'; c.labors.production = true;
  assert.equal(productionEligibility(s, site, t).blockedCode, 'ingredients');
});

test('invalid recipe and missing machine return detached empty additive arrays', () => {
  const { s, site, t } = workstation();
  for (const result of [productionEligibility(s, site, t, 'invalid')]) {
    assert.equal(result.blockedCode, 'invalid_recipe');
    assert.deepEqual(result.eligibleCrewIds, []); assert.deepEqual(result.crewReadiness, []); assert.deepEqual(result.availableCrewIds, []);
  }
  t.machine = null;
  const result = productionEligibility(s, site, t); assert.equal(result.blockedCode, 'invalid_recipe');
  assert.deepEqual(result.crewReadiness, []); assert.deepEqual(result.availableCrewIds, []);
});

function currentOperation({ s, site, t, c }) {
  const j = { id: 'job-operation', kind: 'operate', site: site.id, x: t.x, y: t.y, building: t.building, worker: c.id };
  s.jobs.push(j); c.job = j.id; return j;
}

test('a mutually bound current operator can continue while personal availability stays false', () => {
  const fixture = workstation(), { s, site, t, c } = fixture, j = currentOperation(fixture);
  const before = serialize(s); Object.freeze(c); Object.freeze(j);
  const result = productionEligibility(s, site, t);
  assert.equal(result.blockedCode, null); assert.equal(result.message, null);
  assert.deepEqual(result.availableCrewIds, []);
  assert.deepEqual(result.crewReadiness, [{ id: c.id, available: false, blockers: ['assigned_job'], minimumSuitOxygen: 25 }]);
  assert.equal(serialize(s), before);
});

for (const [blocker, change] of blockers.filter(([blocker]) => blocker !== 'assigned_job')) {
  test(`current operation exception preserves ${blocker}`, () => {
    const fixture = workstation(), { s, site, t, c } = fixture; currentOperation(fixture); change(c);
    const result = productionEligibility(s, site, t);
    assert.equal(result.blockedCode, blocker === 'busy_intent' ? 'busy' : 'operators_unavailable');
    assert.ok(result.crewReadiness[0].blockers.includes(blocker));
    assert.ok(result.crewReadiness[0].blockers.includes('assigned_job')); assert.deepEqual(result.availableCrewIds, []);
  });
}

test('stale operation bindings do not supply the current-operator exception', () => {
  for (const stale of ['unassigned_worker', 'different_worker', 'missing_crew_job', 'different_site', 'different_x', 'different_y', 'different_kind']) {
    const fixture = workstation(), { s, site, t, c } = fixture, j = currentOperation(fixture);
    if (stale === 'unassigned_worker') j.worker = null;
    if (stale === 'different_worker') j.worker = s.crew[1].id;
    if (stale === 'missing_crew_job') { c.job = null; c.energy = 24; }
    if (stale === 'different_site') j.site = 'wreck';
    if (stale === 'different_x') j.x++;
    if (stale === 'different_y') j.y++;
    if (stale === 'different_kind') j.kind = 'feed';
    const result = productionEligibility(s, site, t);
    assert.equal(result.blockedCode, ['different_site', 'different_x', 'different_y', 'different_kind'].includes(stale) ? 'busy' : 'operators_unavailable', stale);
  }
});

test('a ready replacement is listed even when the current operator has additional blockers', () => {
  const fixture = workstation(), { s, site, t, c } = fixture; currentOperation(fixture); c.energy = 24;
  const replacement = s.crew[1]; replacement.labors.production = true;
  const result = productionEligibility(s, site, t);
  assert.equal(result.blockedCode, null); assert.deepEqual(result.eligibleCrewIds, [c.id, replacement.id]);
  assert.deepEqual(result.availableCrewIds, [replacement.id]);
  assert.deepEqual(result.crewReadiness.map(readiness => readiness.available), [false, true]);
});

test('the existing all-operators-job-or-intent busy predicate still wins', () => {
  const { s, site, t, c } = workstation(), second = s.crew[1]; second.labors.production = true;
  c.job = 'job-other'; second.intent = { type: 'rest' };
  assert.equal(productionEligibility(s, site, t).blockedCode, 'busy');
  second.intent = null; second.energy = 24;
  assert.equal(productionEligibility(s, site, t).blockedCode, 'operators_unavailable');
});

test('diagnostics and their nested arrays are detached and do not alter saves, RNG or recording', () => {
  const { s, site, t, c } = workstation(); c.energy = 24; syncResources(s);
  const before = serialize(s), rng = s.rng; startRecording(s);
  const recordingBefore = exportRecording(s), first = productionEligibility(s, site, t);
  first.eligibleCrewIds.push('invented'); first.availableCrewIds.push('invented');
  first.crewReadiness[0].blockers.push('invented'); first.crewReadiness[0].available = true;
  first.crewReadiness[0].id = 'invented'; first.crewReadiness[0].minimumSuitOxygen = 0;
  const observed = observe(s), entity = observed.entities[tileEntityId(site.id, t.x, t.y)];
  assert.ok(entity); entity.derived.production.crewReadiness[0].blockers.push('invented');
  const result = productionEligibility(s, site, t);
  assert.deepEqual(result.eligibleCrewIds, [c.id]); assert.deepEqual(result.availableCrewIds, []);
  assert.deepEqual(result.crewReadiness, [{ id: c.id, ...workReadiness(c) }]);
  assert.equal(serialize(s), before); assert.equal(s.rng, rng); assert.equal(exportRecording(s), recordingBefore);
  stopRecording(s); assert.equal(serialize(s), before); assert.equal(s.rng, rng);
  assert.deepEqual(deserialize(before), s);
});

test('recorded production readiness transitions preserve the same ordinary command state and RNG', () => {
  const { s, site, t, c } = workstation(); syncResources(s);
  const plain = deserialize(serialize(s)); startRecording(s);
  for (const state of [s, plain]) {
    assert.equal(executeAction(state, 'crew.routine', { crew: c.id, policy: 'rest' }).ok, true);
    assert.equal(productionEligibility(state, state.sites.surface, at(state.sites.surface, t.x, t.y)).blockedCode, 'operators_unavailable');
  }
  stopRecording(s); assert.deepEqual(s, plain); assert.equal(s.rng, plain.rng); assert.equal(serialize(s), serialize(plain));
  const rows = exportRecording(s).trim().split('\n').map(line => JSON.parse(line));
  const id = tileEntityId(site.id, t.x, t.y), initial = rows[0].observation.entities[id].derived.production;
  assert.deepEqual(initial.availableCrewIds, [c.id]); assert.equal(initial.crewReadiness[0].available, true);
  const changes = rows.flatMap(row => row.changes || []).filter(change => change.entity === id && change.path[0] === 'derived' && change.path[1] === 'production');
  assert.ok(changes.some(change => change.path[2] === 'blockedCode' && change.value === 'operators_unavailable'));
  assert.ok(changes.some(change => change.path[2] === 'availableCrewIds' && change.value.length === 0));
  assert.ok(changes.every(change => change.system === 'derived_conditions')); assert.equal(s.tick, 0);
});
