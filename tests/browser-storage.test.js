import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, serialize } from '../src/simulation.js';
import { SAVE_KEY, exportColony } from '../src/persistence.js';
import { loadBrowserColony, storeBrowserColony, flushBrowserColony } from '../src/browser-storage.js';

const initial = serialize(createGame(256));
function colony(label) {
  const state = JSON.parse(initial);
  state.log[0].message = label;
  return state;
}
function sameText(actual, expected) {
  assert.equal(typeof actual, 'string');
  assert.equal(actual.length, expected.length);
  const digest = text => createHash('sha256').update(text).digest('hex');
  assert.equal(digest(actual), digest(expected));
}
function legacyStorage(original = null) {
  return {
    original, reads: 0, writes: 0, failure: null,
    getItem(key) { assert.equal(key, SAVE_KEY); this.reads++; return this.original; },
    setItem(key, value) { assert.equal(key, SAVE_KEY); this.writes++; if (this.failure) throw this.failure; this.original = value; }
  };
}

// Model request success separately from transaction commit. Tests explicitly drive
// writes, so an adapter that resolves on put.onsuccess cannot pass these checks.
function indexedDatabase(original) {
  const values = new Map(arguments.length ? [[SAVE_KEY, original]] : []);
  const queued = [], waiters = [];
  const adapter = {
    values, writes: [], opens: 0, created: [], closed: 0,
    openError: null, blocked: false, readOutcome: 'complete', putError: null,
    takeWrite: () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => waiters.push(resolve))
  };
  const db = {
    objectStoreNames: { contains: name => adapter.created.includes(name) },
    createObjectStore(name) { adapter.created.push(name); },
    close() { adapter.closed++; },
    transaction(name, mode) {
      assert.equal(name, 'saves'); assert.ok(['readonly', 'readwrite'].includes(mode));
      const tx = { error: null, abort() { queueMicrotask(() => tx.onabort?.()); } };
      tx.objectStore = name => {
        assert.equal(name, 'saves');
        return {
          openCursor(key) {
            assert.equal(mode, 'readonly'); assert.equal(key, SAVE_KEY);
            const request = {};
            queueMicrotask(() => {
              if (adapter.readOutcome === 'error') {
                tx.error = new Error('Read denied'); request.error = tx.error; tx.onerror?.(); tx.onabort?.();
              } else {
                request.result = values.has(key) ? { value: values.get(key) } : null; request.onsuccess?.();
                queueMicrotask(() => {
                  if (adapter.readOutcome === 'abort') { tx.error = new Error('Read aborted'); tx.onabort?.(); }
                  else tx.oncomplete?.();
                });
              }
            });
            return request;
          },
          put(value, key) {
            assert.equal(mode, 'readwrite'); assert.equal(key, SAVE_KEY);
            if (adapter.putError) throw adapter.putError;
            const request = {}, control = {
              value,
              success() { request.result = key; request.onsuccess?.(); },
              complete() { values.set(key, value); tx.oncomplete?.(); },
              abort() { tx.error = new Error('Write aborted'); tx.onabort?.(); },
              error() { tx.error = new Error('Write failed'); request.error = tx.error; tx.onerror?.(); tx.onabort?.(); }
            };
            adapter.writes.push(control);
            if (waiters.length) waiters.shift()(control); else queued.push(control);
            return request;
          }
        };
      };
      return tx;
    }
  };
  adapter.factory = { open(name, version) {
    assert.equal(name, 'spacefortress'); assert.equal(version, 1); adapter.opens++;
    const request = { transaction: { abort() {} } };
    queueMicrotask(() => {
      if (adapter.openError) { request.error = adapter.openError; request.onerror?.(); return; }
      if (adapter.blocked) { request.onblocked?.(); return; }
      request.result = db;
      if (!adapter.created.length) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  } };
  return adapter;
}
function options(db, legacy = legacyStorage()) {
  return { indexedDB: () => db.factory, legacyStorage: () => legacy };
}
async function commit(db, promise) {
  const write = await db.takeWrite(); write.success(); write.complete(); await promise; return write;
}

// No adapter or test changes the simulation: all saves use normal serialized worlds.
test('new browser saves commit only on transaction completion and reload exactly', async () => {
  const db = indexedDatabase(), legacy = legacyStorage(), session = await loadBrowserColony(options(db, legacy));
  assert.equal(session.fresh, true); assert.equal(session.error, null);
  assert.deepEqual(db.created, ['saves']); assert.equal(db.writes.length, 0);
  const expected = serialize(session.state);
  let finished = false;
  const saving = storeBrowserColony(session, session.state).then(() => { finished = true; });
  const write = await db.takeWrite(); write.success(); await Promise.resolve();
  assert.equal(finished, false); assert.equal(db.values.has(SAVE_KEY), false);
  write.complete(); await saving;
  sameText(db.values.get(SAVE_KEY), expected);
  const loaded = await loadBrowserColony(options(db, legacy));
  assert.equal(loaded.fresh, false); assert.equal(loaded.error, null); sameText(serialize(loaded.state), expected);
  assert.equal(legacy.writes, 0);
});

test('validated legacy saves migrate on the first successful save and retain their bytes', async () => {
  const db = indexedDatabase(), legacy = legacyStorage(initial), session = await loadBrowserColony(options(db, legacy));
  assert.equal(session.fresh, false); assert.equal(session.error, null); sameText(serialize(session.state), initial);
  assert.equal(db.values.has(SAVE_KEY), false);
  session.state.log[0].message = 'After migration';
  const expected = serialize(session.state);
  await commit(db, storeBrowserColony(session, session.state));
  sameText(legacy.original, initial); assert.equal(legacy.writes, 0);
  legacy.original = 'obsolete legacy data';
  const loaded = await loadBrowserColony(options(db, legacy));
  sameText(serialize(loaded.state), expected); assert.equal(legacy.reads, 1);
});

test('corrupt primary bytes stay protected without silently loading a valid legacy colony', async () => {
  for (const original of ['', 'not JSON', '{"version":900}']) {
    const db = indexedDatabase(original), legacy = legacyStorage(initial), session = await loadBrowserColony(options(db, legacy));
    assert.ok(session.error); assert.equal(session.fresh, false); assert.equal(session.original, original);
    assert.equal(legacy.reads, 0);
    assert.deepEqual(exportColony(session, session.state), { contents: original, protectedOriginal: true });
    await assert.rejects(storeBrowserColony(session, session.state), /Previous save could not be loaded/);
    assert.equal(db.values.get(SAVE_KEY), original); assert.equal(db.writes.length, 0);
  }
});

test('non-text primary records stay protected without claiming an exportable text original', async () => {
  for (const original of [null, undefined, false, 0, { unreadable: ['structured record'] }]) {
    const db = indexedDatabase(original), legacy = legacyStorage(initial), session = await loadBrowserColony(options(db, legacy));
    assert.equal(session.error, 'Saved colony data is not text.'); assert.equal(session.fresh, false);
    assert.equal(session.original, null); assert.equal(legacy.reads, 0);
    await assert.rejects(storeBrowserColony(session, session.state), /Previous save could not be loaded/);
    assert.equal(db.values.has(SAVE_KEY), true); assert.equal(db.values.get(SAVE_KEY), original); assert.equal(db.writes.length, 0);
    const exported = exportColony(session, session.state);
    assert.equal(exported.protectedOriginal, false); sameText(exported.contents, serialize(session.state));
  }
});

test('invalid and square legacy saves are never migrated or overwritten automatically', async () => {
  for (const original of ['broken legacy', '{"version":39}']) {
    const db = indexedDatabase(), legacy = legacyStorage(original), session = await loadBrowserColony(options(db, legacy));
    assert.ok(session.error); assert.equal(session.original, original);
    await assert.rejects(storeBrowserColony(session, session.state), /Previous save could not be loaded/);
    assert.equal(legacy.original, original); assert.equal(db.values.has(SAVE_KEY), false);
  }
});

test('overlapping requests capture each state immediately and commit in request order', async () => {
  const db = indexedDatabase(initial), session = await loadBrowserColony(options(db));
  const first = colony('First'), replacement = colony('Replacement'), newest = colony('Newest');
  const expected = [serialize(first), serialize(replacement), serialize(newest)];
  const promises = [storeBrowserColony(session, first), storeBrowserColony(session, replacement, true), storeBrowserColony(session, newest, true)];
  first.log[0].message = 'Later mutation'; replacement.log[0].message = 'Later mutation'; newest.log[0].message = 'Later mutation';
  let flushed = false;
  const flushing = flushBrowserColony(session).then(() => { flushed = true; });
  for (let i = 0; i < promises.length; i++) {
    const write = await db.takeWrite();
    assert.equal(db.writes.length, i + 1); sameText(write.value, expected[i]);
    assert.equal(flushed, false); write.complete(); await promises[i];
  }
  await flushing; assert.equal(flushed, true); sameText(db.values.get(SAVE_KEY), expected.at(-1));
});

test('aborted and failed writes retain the committed colony and do not poison queued saves', async () => {
  for (const outcome of ['abort', 'error']) {
    const db = indexedDatabase(initial), session = await loadBrowserColony(options(db)), replacement = colony(`After ${outcome}`);
    const rejected = assert.rejects(storeBrowserColony(session, colony('Rejected')), /Write (aborted|failed)/);
    const recovering = storeBrowserColony(session, replacement, true);
    const failed = await db.takeWrite(); failed.success(); failed[outcome](); await rejected;
    sameText(db.values.get(SAVE_KEY), initial); assert.equal(session.error, null);
    await commit(db, recovering); await flushBrowserColony(session);
    sameText(db.values.get(SAVE_KEY), serialize(replacement));
  }
});

test('failed explicit replacements keep protected originals and the new colony exportable', async () => {
  const original = 'unreadable original', db = indexedDatabase(original), session = await loadBrowserColony(options(db));
  const fallback = session.state, replacement = colony('Imported colony');
  const rejected = assert.rejects(storeBrowserColony(session, replacement, true), /Write aborted/);
  const write = await db.takeWrite(); write.success();
  assert.ok(session.error); assert.equal(session.original, original);
  write.abort(); await rejected; await flushBrowserColony(session);
  assert.equal(session.state, fallback); assert.equal(session.original, original); assert.ok(session.error);
  assert.equal(db.values.get(SAVE_KEY), original);
  assert.deepEqual(exportColony(session, fallback), { contents: original, protectedOriginal: true });
  const exported = exportColony(session, replacement);
  assert.equal(exported.protectedOriginal, false); sameText(exported.contents, serialize(replacement));
  await assert.rejects(storeBrowserColony(session, replacement), /Previous save could not be loaded/);
  const retry = storeBrowserColony(session, replacement, true), next = await db.takeWrite();
  assert.equal(session.original, original); next.complete(); await retry;
  assert.equal(session.error, null); assert.equal(session.original, null);
});

test('an open failure protects accessible legacy bytes and retries IndexedDB on explicit replacement', async () => {
  const db = indexedDatabase(), legacy = legacyStorage(initial); db.openError = new Error('Open denied');
  const session = await loadBrowserColony(options(db, legacy));
  assert.equal(session.error, 'Open denied'); assert.equal(session.fresh, false); sameText(session.original, initial);
  await assert.rejects(storeBrowserColony(session, session.state), /Previous save could not be loaded/);
  assert.equal(legacy.writes, 0);
  db.openError = null;
  const replacement = colony('Recovered database'); await commit(db, storeBrowserColony(session, replacement, true));
  sameText(db.values.get(SAVE_KEY), serialize(replacement)); sameText(legacy.original, initial);
  assert.equal(db.opens, 2); assert.equal(session.error, null);
});

test('blocked or denied IndexedDB access never silently switches to localStorage', async () => {
  const legacy = legacyStorage(initial), db = indexedDatabase(); db.blocked = true;
  const blocked = await loadBrowserColony(options(db, legacy));
  assert.match(blocked.error, /blocked/); sameText(blocked.original, initial);
  const denied = await loadBrowserColony({ indexedDB: () => { throw new Error('API denied'); }, legacyStorage: () => legacy });
  assert.equal(denied.error, 'API denied'); sameText(denied.original, initial);
  await assert.rejects(storeBrowserColony(denied, colony('Cannot save'), true), /API denied/);
  assert.equal(legacy.writes, 0); sameText(legacy.original, initial);
});

test('failed reads preserve accessible original bytes including a successful get followed by abort', async () => {
  const db = indexedDatabase(initial), legacy = legacyStorage('stale legacy'); db.readOutcome = 'abort';
  const session = await loadBrowserColony(options(db, legacy));
  assert.equal(session.error, 'Read aborted'); sameText(session.original, initial); assert.equal(legacy.reads, 0);
  assert.equal(exportColony(session, session.state).protectedOriginal, true);
  await assert.rejects(storeBrowserColony(session, session.state), /Previous save could not be loaded/);
  db.readOutcome = 'error';
  const unread = await loadBrowserColony(options(db, legacy));
  assert.equal(unread.error, 'Read denied'); assert.equal(unread.original, 'stale legacy');
  assert.equal(legacy.writes, 0); sameText(db.values.get(SAVE_KEY), initial);
});

test('denied legacy reads protect an empty database until an explicit replacement succeeds', async () => {
  const db = indexedDatabase(), session = await loadBrowserColony({ indexedDB: () => db.factory, legacyStorage: () => { throw new Error('Legacy access denied'); } });
  assert.equal(session.error, 'Legacy access denied'); assert.equal(session.original, null);
  await assert.rejects(storeBrowserColony(session, session.state), /Previous save could not be loaded/);
  await commit(db, storeBrowserColony(session, colony('Explicit fresh colony'), true));
  assert.equal(session.error, null);
});

test('absent IndexedDB retains synchronous localStorage writes and protected export behavior', async () => {
  const legacy = legacyStorage(initial), session = await loadBrowserColony({ indexedDB: () => undefined, legacyStorage: () => legacy });
  const replacement = colony('Fallback save'), saving = storeBrowserColony(session, replacement);
  sameText(legacy.original, serialize(replacement)); await saving; await flushBrowserColony(session);
  const broken = legacyStorage('broken fallback'), protectedSession = await loadBrowserColony({ indexedDB: () => null, legacyStorage: () => broken });
  broken.failure = new Error('Storage full');
  await assert.rejects(storeBrowserColony(protectedSession, replacement, true), /Storage full/);
  assert.equal(protectedSession.original, 'broken fallback'); assert.ok(protectedSession.error);
  assert.equal(exportColony(protectedSession, replacement).protectedOriginal, false);
  assert.equal(broken.original, 'broken fallback');
  broken.failure = null;
  const retry = storeBrowserColony(protectedSession, replacement, true);
  assert.equal(protectedSession.error, null); await retry;
  const denied = await loadBrowserColony({ indexedDB: () => undefined, legacyStorage: () => { throw new Error('Storage denied'); } });
  assert.equal(denied.error, 'Storage denied'); assert.equal(denied.original, null);
});

test('serialization and synchronous request failures leave later writes usable', async () => {
  const db = indexedDatabase(initial), session = await loadBrowserColony(options(db)), circular = colony('Circular'); circular.self = circular;
  await assert.rejects(storeBrowserColony(session, circular), /circular/i); assert.equal(db.writes.length, 0);
  db.putError = new Error('Request refused');
  await assert.rejects(storeBrowserColony(session, colony('Refused')), /Request refused/);
  sameText(db.values.get(SAVE_KEY), initial);
  db.putError = null;
  const replacement = colony('Retry'); await commit(db, storeBrowserColony(session, replacement));
  await flushBrowserColony(session); sameText(db.values.get(SAVE_KEY), serialize(replacement));
});
