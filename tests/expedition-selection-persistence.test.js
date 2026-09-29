import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, launch, recall, cancelDeparture, step, at, order, serialize, deserialize } from '../src/simulation.js';
import { totalResources, quantity } from '../src/inventory.js';
import { departureCrew, updateDeparture, tryDeparture } from '../src/preflight.js';
import { refreshPower } from '../src/power.js';
import { projectPreOutpost } from './helpers/legacy-projection.js';

const SELECTED = ['crew-5', 'crew-2'];
const reload = s => deserialize(serialize(s));
const oldText = phase => gunzipSync(readFileSync(new URL(`./fixtures/expedition-schema36-${phase}.json.gz`, import.meta.url))).toString('utf8');
const loading = s => s.jobs.find(j => j.kind === 'loadShuttle');
const carrier = s => { const job = loading(s); return job && s.crew.find(c => c.carry && c.delivery?.job === job.id); };
function until(s, predicate, max = 500) {
  for (let i = 0; i < max && !predicate(); i++) step(s);
  assert.ok(predicate(), `State not reached at tick ${s.tick}: ${s.departure?.status || s.mission?.phase || 'idle'}`);
}

let cachedStages;
function selectedStages() {
  if (cachedStages) return structuredClone(cachedStages);
  const s = createGame(36203);
  assert.equal(launch(s, 'wreck', SELECTED).ok, true);
  assert.deepEqual(s.departure.crew, SELECTED);
  const stages = {};
  until(s, () => carrier(s)); stages.loading = reload(s);
  until(s, () => s.departure?.stage === 'boarding'); stages.boarding = reload(s);
  until(s, () => s.mission?.phase === 'outbound'); stages.outbound = reload(s);
  until(s, () => s.mission?.phase === 'working'); stages.working = reload(s);
  assert.equal(recall(s).ok, true); stages.return_boarding = reload(s);
  until(s, () => s.mission?.phase === 'returning'); stages.returning = reload(s);
  until(s, () => !s.mission); stages.home = reload(s);
  cachedStages = stages;
  return structuredClone(stages);
}

test('genuine pre-selection schema 36 departure and transit saves load exactly with no grants or RNG change', () => {
  for (const phase of ['loading', 'boarding', 'outbound', 'returning']) {
    const text = oldText(phase), old = JSON.parse(text), loaded = deserialize(text);
    assert.equal(old.version, 36);
    assert.equal(loaded.version, VERSION);
    assert.deepEqual(projectPreOutpost(loaded), old, `${phase} retains all original state`);
    assert.deepEqual(totalResources(loaded), totalResources(old));
    assert.equal(loaded.rng, old.rng);
    assert.deepEqual(loaded.departure?.crew || loaded.mission.crew, ['crew-0', 'crew-1']);
    assert.equal(serialize(reload(loaded)), serialize(loaded));
  }
  const loadingSave = JSON.parse(oldText('loading'));
  assert.ok(carrier(loadingSave));
  assert.equal(quantity(loadingSave.shuttle.supplies), 0);
  const boarded = JSON.parse(oldText('boarding'));
  assert.equal(boarded.shuttle.supplies.fuel, 2);
  assert.equal(boarded.shuttle.supplies.food, 2);
  assert.equal(boarded.shuttle.supplies.air, 10);
  assert.equal(JSON.parse(oldText('outbound')).mission.returnFuel, 1);
  assert.equal(JSON.parse(oldText('returning')).mission.returnFuel, 0);
});

test('genuine old schema 36 loading and both travel legs continue deterministically', () => {
  for (const phase of ['loading', 'boarding', 'outbound', 'returning']) {
    const s = deserialize(oldText(phase)), copy = reload(s);
    step(s, 30); step(copy, 30);
    assert.deepEqual(copy, s, phase);
    reload(s);
  }
});

test('a non-first ordered manifest survives physical loading, both boarding phases, travel and return', () => {
  const stages = selectedStages();
  for (const [phase, s] of Object.entries(stages)) {
    assert.equal(s.version, VERSION);
    if (phase === 'home') {
      assert.equal(s.departure, null); assert.equal(s.mission, null);
      assert.ok(SELECTED.every(id => s.crew.find(c => c.id === id).site === 'surface'));
    } else assert.deepEqual(s.departure?.crew || s.mission.crew, SELECTED, phase);
    if (s.departure) assert.deepEqual(departureCrew(s).map(c => c.id), SELECTED, 'derived team follows chosen order');
    assert.deepEqual(reload(s), s, phase);
  }
  assert.ok(carrier(stages.loading), 'the snapshot includes physically carried loading supplies');
  assert.ok(stages.boarding.shuttle.supplies.fuel > 0);
  assert.ok(stages.outbound.mission.returnFuel > 0);
  assert.equal(stages.returning.mission.returnFuel, 0);
});

test('busy selected-team saves resume deterministically across loading, arrival and return', () => {
  const stages = selectedStages();
  for (const phase of ['loading', 'boarding', 'outbound', 'working', 'return_boarding', 'returning']) {
    const s = stages[phase], copy = reload(s);
    step(s, 20); step(copy, 20);
    assert.deepEqual(copy, s, phase);
    if (s.departure || s.mission) assert.deepEqual(s.departure?.crew || s.mission.crew, SELECTED, phase);
    reload(s);
  }
});

test('cancelling selected loading or boarding after reload preserves all actual supplied ownership', () => {
  const stages = selectedStages();
  for (const phase of ['loading', 'boarding']) {
    const s = stages[phase], copy = reload(s), before = totalResources(s);
    const stores = structuredClone(s.shuttle.supplies);
    const held = s.crew.map(c => ({ id: c.id, carry: structuredClone(c.carry) }));
    for (const state of [s, copy]) assert.equal(cancelDeparture(state).ok, true);
    assert.equal(s.departure, null); assert.equal(s.mission, null);
    assert.deepEqual(s.shuttle.supplies, stores);
    assert.deepEqual(totalResources(s), before);
    for (const c of held) assert.deepEqual(s.crew.find(crew => crew.id === c.id).carry, c.carry);
    assert.deepEqual(s, copy);
    step(s, 15); step(copy, 15);
    assert.deepEqual(s, copy); reload(s);
  }
});

test('departure and flight saves reject duplicate, foreign, missing and wrongly located team ownership', () => {
  const stages = selectedStages();
  for (const phase of ['loading', 'boarding', 'outbound', 'working', 'returning']) {
    for (const bad of [[SELECTED[0], SELECTED[0]], [SELECTED[0], 'crew-99'], [SELECTED[0]], [], null]) {
      const s = structuredClone(stages[phase]);
      (s.departure || s.mission).crew = bad;
      assert.throws(() => reload(s), `${phase} invalid team ${JSON.stringify(bad)}`);
    }
    const wrongLocation = structuredClone(stages[phase]);
    wrongLocation.crew.find(c => c.id === SELECTED[0]).site = wrongLocation.departure ? 'wreck' : 'surface';
    assert.throws(() => reload(wrongLocation), `${phase} member must remain owned by the expected expedition location`);
    const absent = structuredClone(stages[phase]);
    absent.crew = absent.crew.filter(c => c.id !== SELECTED[0]);
    assert.throws(() => reload(absent), `${phase} missing entity is not a valid save`);
  }
});

test('a selected crew death after preparation blocks departure without replacing the manifest or consuming fuel', () => {
  const s = selectedStages().boarding, selected = s.crew.find(c => c.id === SELECTED[0]);
  selected.health = 0;
  const manifest = [...s.departure.crew], fuel = totalResources(s).fuel;
  step(s, 6);
  assert.equal(s.mission, null);
  assert.deepEqual(s.departure.crew, manifest);
  assert.equal(totalResources(s).fuel, fuel);
  assert.match(s.departure.status, /unavailable|dead|healthy/i);
  assert.deepEqual(reload(s), s);
});

test('a missing selected entity cannot silently shrink or replace a live departure team', () => {
  const s = selectedStages().boarding, ship = at(s.sites.surface, 16, 11);
  // Hold the real boarding process at the damaged-ship gate until both selected
  // people have physically arrived without cargo or other recovery work.
  ship.hp = 49;
  until(s, () => SELECTED.every(id => {
    const c = s.crew.find(c => c.id === id);
    return c.x === 16 && c.y === 11 && !c.intent && !c.carry;
  }));
  ship.hp = 100; refreshPower(s, s.sites.surface);
  s.crew = s.crew.filter(c => c.id !== SELECTED[0]);
  const manifest = [...s.departure.crew], supplies = structuredClone(s.shuttle.supplies), resources = totalResources(s);
  updateDeparture(s, order, () => {});
  tryDeparture(s, () => {});
  assert.equal(s.mission, null);
  assert.deepEqual(s.departure.crew, manifest);
  assert.match(s.departure.status, /unavailable|missing/i);
  assert.deepEqual(s.shuttle.supplies, supplies);
  assert.deepEqual(totalResources(s), resources);
});
