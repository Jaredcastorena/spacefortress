import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, at, serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { departureReadiness, tryDeparture } from '../src/preflight.js';
import { shuttlePresence } from '../src/outposts.js';
import { expeditionLaunchBlock } from '../src/expedition-readiness.js';
import { totalResources } from '../src/inventory.js';

const act = (s, id, args = {}) => {
  const result = executeAction(s, id, args, 'test');
  assert.equal(result.ok, true, `${id}: ${JSON.stringify(result)}`);
  return result;
};
function until(s, predicate, limit = 250) {
  for (let i = 0; i < limit && !predicate(); i++) step(s);
  assert.ok(predicate(), `Expected state; departure: ${s.departure?.status}`);
}
function loadedDeparture() {
  const s = createGame();
  act(s, 'expedition.launch', { site: 'wreck' });
  until(s, () => s.departure?.stage === 'boarding');
  assert.equal(s.mission, null);
  assert.equal(s.shuttle.supplies.fuel, 2);
  assert.equal(s.shuttle.supplies.food, 2);
  assert.equal(s.shuttle.supplies.air, 10);
  return s;
}
function reload(s) {
  const saved = serialize(s), restored = deserialize(saved);
  assert.equal(serialize(restored), saved);
  return restored;
}

// Only structural disappearance/replacement is synthetic. Service supplies were
// paid for and physically loaded by normal workers before these save boundaries.
for (const building of [null, 'bunk']) {
  const label = building === null ? 'missing' : 'replaced';
  test(`${label} terminal rejects a new departure atomically despite previously loaded stores`, () => {
    let s = loadedDeparture();
    act(s, 'expedition.cancel_departure');
    at(s.sites.surface, 16, 11).building = building;
    s = reload(s);
    assert.equal(shuttlePresence(s, 'surface').usable, false);
    const before = serialize(s), resources = totalResources(s), crew = structuredClone(s.crew);
    const result = executeAction(s, 'expedition.launch', { site: 'wreck' }, 'test');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'simulation_rejected');
    assert.equal(expeditionLaunchBlock(s, 'wreck').code, 'shuttle_damaged');
    assert.equal(serialize(s), before, 'rejection creates no reservations or crew changes');
    assert.deepEqual(totalResources(s), resources);
    assert.deepEqual(s.crew, crew);
    assert.equal(s.shuttle.supplies.fuel, 2);
    reload(s);
  });

  test(`${label} terminal discovered during boarding blocks liftoff without consuming paid supplies`, () => {
    let s = loadedDeparture();
    const ids = [...s.departure.crew];
    at(s.sites.surface, 16, 11).building = building;
    s = reload(s);
    const stored = Object.fromEntries(Object.entries(s.shuttle.supplies).filter(([key]) => !key.startsWith('_')));
    until(s, () => ids.every(id => {
      const c = s.crew.find(c => c.id === id);
      return c.x === 16 && c.y === 11;
    }));
    assert.equal(s.mission, null);
    assert.equal(departureReadiness(s).blocked, 'shuttle_damaged');
    assert.deepEqual(s.departure.crew, ids);
    assert.ok(ids.every(id => s.crew.find(c => c.id === id).site === 'surface'));
    assert.deepEqual(Object.fromEntries(Object.entries(s.shuttle.supplies).filter(([key]) => !key.startsWith('_'))), stored);
    const before = serialize(s);
    tryDeparture(s, () => assert.fail('blocked liftoff must not announce a departure'));
    assert.equal(serialize(s), before, 'actual liftoff check changes no owner or passenger state');
    reload(s);
    act(s, 'expedition.cancel_departure');
    assert.equal(s.departure, null);
    assert.equal(s.shuttle.supplies.fuel, 2);
    reload(s);
  });
}

test('a present damaged shuttle still supports paid physical repair, departure and return', () => {
  const s = loadedDeparture(), before = totalResources(s), ids = [...s.departure.crew];
  at(s.sites.surface, 16, 11).hp = 20;
  step(s, 3);
  assert.equal(s.mission, null);
  assert.equal(departureReadiness(s).blocked, 'shuttle_damaged');
  assert.equal(s.shuttle.supplies.fuel, 2);
  const repair = act(s, 'job.order', { site: 'surface', x: 16, y: 11, kind: 'repair' });
  assert.ok(repair.job);
  reload(s);
  until(s, () => s.mission?.phase === 'outbound');
  assert.ok(at(s.sites.surface, 16, 11).hp >= 50);
  assert.deepEqual(s.mission.crew, ids);
  assert.equal(totalResources(s).alloy, before.alloy - 1);
  assert.equal(totalResources(s).fuel, before.fuel - 1);
  act(s, 'expedition.recall');
  until(s, () => s.mission === null);
  assert.ok(ids.every(id => s.crew.find(c => c.id === id).site === 'surface'));
  assert.equal(totalResources(s).fuel, before.fuel - 2);
  assert.equal(shuttlePresence(s, 'surface').usable, true);
  reload(s);
});
