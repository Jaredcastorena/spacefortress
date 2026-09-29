import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, serialize } from '../src/simulation.js';
import { loadColony, storeColony, SAVE_KEY } from '../src/persistence.js';

function memoryStorage(initial) {
  const data = new Map(initial === undefined ? [] : [[SAVE_KEY, initial]]);
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}
test('failed loads preserve the original bytes and block autosave replacement', () => {
  for (const original of ['not JSON', '', '{"version":900}']) {
    const storage = memoryStorage(original), session = loadColony(() => storage);
    assert.ok(session.error); assert.equal(session.fresh, false); assert.equal(session.original, original);
    assert.throws(() => storeColony(() => storage, session, session.state));
    assert.equal(storage.getItem(SAVE_KEY), original);
  }
});
test('an explicit replacement clears load protection only after storage succeeds', () => {
  const storage = memoryStorage('unreadable original'), session = loadColony(() => storage);
  const rejectedStorage = () => ({ setItem: () => { throw new Error('Storage full'); } });
  assert.throws(() => storeColony(rejectedStorage, session, session.state, true));
  assert.ok(session.error); assert.equal(session.original, 'unreadable original');
  storeColony(() => storage, session, session.state, true);
  assert.equal(session.error, null); assert.equal(session.original, null); assert.equal(storage.getItem(SAVE_KEY), serialize(session.state));
});
test('new storage, supported legacy saves and denied storage access have distinct outcomes', () => {
  const empty = memoryStorage(), fresh = loadColony(() => empty); assert.equal(fresh.fresh, true); assert.equal(fresh.error, null);
  storeColony(() => empty, fresh, fresh.state); assert.equal(empty.getItem(SAVE_KEY), serialize(fresh.state));
  const legacy = createGame(); legacy.version = 3;
  const storage = memoryStorage(serialize(legacy)), session = loadColony(() => storage);
  assert.equal(session.error, null); assert.equal(session.state.version, VERSION); assert.equal(session.fresh, false);
  const denied = loadColony(() => { throw new Error('Storage access denied'); });
  assert.equal(denied.error, 'Storage access denied'); assert.equal(denied.original, null);
});
