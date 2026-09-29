import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, serialize, deserialize, step } from '../src/simulation.js';
import { loadColony, storeColony, exportColony, SAVE_KEY } from '../src/persistence.js';

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

test('export preserves unreadable bytes while the original fallback colony remains active', () => {
  for (const original of ['not JSON', '', '{"version":900}']) {
    const storage = memoryStorage(original), session = loadColony(() => storage);
    const before = structuredClone(session);
    assert.deepEqual(exportColony(session, session.state), { contents: original, protectedOriginal: true });
    assert.deepEqual(session, before);
    assert.equal(storage.getItem(SAVE_KEY), original);
  }
});

test('new and imported colonies remain exportable after rejected replacement storage without losing the original', () => {
  const replacements = [() => createGame(91), () => deserialize(serialize(createGame(92)))];
  for (const replace of replacements) {
    const original = 'unreadable original', storage = memoryStorage(original), session = loadColony(() => storage);
    const active = replace(), fallback = session.state;
    const rejectedStorage = () => ({ setItem: () => { throw new Error('Storage full'); } });
    assert.throws(() => storeColony(rejectedStorage, session, active, true), /Storage full/);
    step(active);
    const before = structuredClone(session);
    assert.deepEqual(exportColony(session, active), { contents: serialize(active), protectedOriginal: false });
    assert.deepEqual(session, before);
    assert.equal(session.state, fallback); assert.equal(session.original, original);
    assert.throws(() => storeColony(() => storage, session, active), /Previous save could not be loaded/);
    assert.equal(storage.getItem(SAVE_KEY), original);
    assert.deepEqual(exportColony(session, fallback), { contents: original, protectedOriginal: true });
  }
});

test('normal, denied-storage and successful replacement exports contain the current colony', () => {
  const storage = memoryStorage(serialize(createGame(93))), session = loadColony(() => storage);
  step(session.state);
  assert.deepEqual(exportColony(session, session.state), { contents: serialize(session.state), protectedOriginal: false });
  const denied = loadColony(() => { throw new Error('Storage access denied'); });
  assert.deepEqual(exportColony(denied, denied.state), { contents: serialize(denied.state), protectedOriginal: false });
  const badStorage = memoryStorage('unreadable'), recovered = loadColony(() => badStorage), replacement = createGame(94);
  storeColony(() => badStorage, recovered, replacement, true);
  assert.equal(recovered.original, null); assert.equal(recovered.error, null);
  assert.deepEqual(exportColony(recovered, replacement), { contents: serialize(replacement), protectedOriginal: false });
  assert.equal(badStorage.getItem(SAVE_KEY), serialize(replacement));
});
