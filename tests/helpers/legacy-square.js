import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { deserialize } from '../../src/simulation.js';
import { loadColony, storeColony, exportColony, SAVE_KEY } from '../../src/persistence.js';
import { totalResources } from '../../src/inventory.js';

export const legacyText = name => gunzipSync(readFileSync(new URL(`../fixtures/${name}.json.gz`, import.meta.url))).toString('utf8');
export function assertSquareProtected(original) {
  const before = JSON.parse(original), resources = totalResources(before);
  assert.throws(() => deserialize(original), /Legacy square-grid saves/);
  let stored = original;
  const storage = { getItem: key => key === SAVE_KEY ? stored : null, setItem: (key, value) => { stored = value; } };
  const session = loadColony(() => storage);
  assert.match(session.error, /Legacy square-grid saves/);
  assert.equal(session.original, original);
  assert.equal(session.state.grid, 'hex-odd-q-v1');
  assert.deepEqual(exportColony(session, session.state), { contents: original, protectedOriginal: true });
  assert.throws(() => storeColony(() => storage, session, session.state), /Previous save could not be loaded/);
  assert.equal(stored, original);
  assert.deepEqual(totalResources(JSON.parse(stored)), resources);
  assert.deepEqual(JSON.parse(stored), before);
}
