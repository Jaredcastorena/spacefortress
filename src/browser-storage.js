import { createGame, serialize, deserialize } from './simulation.js';
import { SAVE_KEY, loadColony } from './persistence.js';

const DATABASE = 'spacefortress', STORE = 'saves';
const sessions = new WeakMap();
const protectionMessage = 'Previous save could not be loaded. Export it or choose New colony before replacing it.';
const message = (error, fallback) => error?.message || fallback;

function attach(session, backend) {
  sessions.set(session, backend);
  return session;
}
function failedSession(error, original = null) {
  return { state: createGame(), fresh: false, error: message(error, 'Saved colony could not be read.'), original };
}
function readLegacy(storage) { return storage().getItem(SAVE_KEY); }
function readableOriginal(storage) {
  try { return readLegacy(storage); } catch { return null; }
}
function database(backend) {
  if (backend.db) return Promise.resolve(backend.db);
  return new Promise((resolve, reject) => {
    let request, finished = false;
    const fail = error => { if (!finished) { finished = true; reject(error); } };
    try {
      const factory = backend.indexedDB();
      if (!factory) throw new Error('IndexedDB is unavailable.');
      request = factory.open(DATABASE, 1);
    } catch (error) { fail(error); return; }
    request.onblocked = () => fail(new Error('Saved colony storage is blocked by another open page.'));
    request.onerror = () => fail(request.error || new Error('Saved colony storage could not be opened.'));
    request.onupgradeneeded = () => {
      try {
        if (finished) { request.transaction.abort(); return; }
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      } catch (error) { fail(error); request.transaction?.abort(); }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (finished) { db.close(); return; }
      finished = true;
      backend.db = db;
      const forget = () => { if (backend.db === db) backend.db = null; };
      db.onversionchange = () => { forget(); db.close(); };
      db.onclose = forget;
      resolve(db);
    };
  });
}
function transaction(backend, db, mode, operation) {
  return new Promise((resolve, reject) => {
    let tx, request;
    try {
      tx = db.transaction(STORE, mode);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || request?.error || new Error('Saved colony transaction was aborted.'));
      tx.onerror = () => reject(tx.error || request?.error || new Error('Saved colony transaction failed.'));
      request = operation(tx.objectStore(STORE));
    } catch (error) {
      if (error?.name === 'InvalidStateError' && backend.db === db) backend.db = null;
      // A synchronous request failure must not leave a partially scheduled write.
      try { tx?.abort(); } catch { /* The transaction may already have finished. */ }
      reject(error);
    }
  });
}

export async function loadBrowserColony({ indexedDB = () => globalThis.indexedDB, legacyStorage = () => globalThis.localStorage } = {}) {
  const backend = { indexedDB, legacyStorage, db: null, fallback: false, tail: Promise.resolve() };
  let factory;
  try { factory = indexedDB(); }
  catch (error) { return attach(failedSession(error, readableOriginal(legacyStorage)), backend); }
  if (factory == null) {
    backend.fallback = true;
    return attach(loadColony(legacyStorage), backend);
  }
  let original = null, primaryRead = false, primaryPresent = false;
  try {
    const db = await database(backend);
    await transaction(backend, db, 'readonly', store => {
      // A cursor distinguishes an absent key from a stored undefined/null value.
      const request = store.openCursor(SAVE_KEY);
      request.onsuccess = () => {
        primaryPresent = request.result !== null;
        original = primaryPresent ? request.result.value : undefined;
        primaryRead = true;
      };
      return request;
    });
    if (!primaryPresent) original = readLegacy(legacyStorage);
    if ((primaryPresent || original !== null) && typeof original !== 'string') throw new Error('Saved colony data is not text.');
    const state = original === null ? createGame() : deserialize(original);
    return attach({ state, fresh: original === null, error: null, original: null }, backend);
  } catch (error) {
    // A primary read/validation failure must never load a stale legacy colony.
    // Retain any bytes already read, or the legacy bytes when the primary was inaccessible.
    if (!primaryRead || (!primaryPresent && original === undefined)) original = readableOriginal(legacyStorage);
    // Structured corrupt records remain untouched, but cannot be exported as original text.
    return attach(failedSession(error, typeof original === 'string' ? original : null), backend);
  }
}

export function storeBrowserColony(session, state, replace = false) {
  const backend = sessions.get(session);
  if (!backend) return Promise.reject(new Error('Unknown browser save session.'));
  let contents;
  try {
    if (session.error && !replace) throw new Error(protectionMessage);
    // Capture now, before an earlier transaction can delay this request.
    contents = serialize(state);
  } catch (error) { return Promise.reject(error); }
  const committed = () => { session.error = null; session.original = null; };
  let operation;
  if (backend.fallback) {
    // Preserve synchronous write-at-invocation for browsers without IndexedDB.
    try { backend.legacyStorage().setItem(SAVE_KEY, contents); committed(); operation = Promise.resolve(); }
    catch (error) { operation = Promise.reject(error); }
  } else {
    operation = backend.tail.then(async () => {
      const db = await database(backend);
      await transaction(backend, db, 'readwrite', store => store.put(contents, SAVE_KEY));
      committed();
    });
  }
  // Each caller sees its own failure; a rejected write never poisons later writes.
  backend.tail = operation.catch(() => {});
  return operation;
}

export function flushBrowserColony(session) {
  const backend = sessions.get(session);
  return backend ? backend.tail : Promise.reject(new Error('Unknown browser save session.'));
}
