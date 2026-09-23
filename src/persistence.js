import { createGame, serialize, deserialize } from './simulation.js';

export const SAVE_KEY = 'spacefortress-save-v1';
// Resolve storage inside the try block: some browser modes deny even property access.
export function loadColony(storage) {
  let original = null;
  try {
    original = storage().getItem(SAVE_KEY);
    return { state: original === null ? createGame() : deserialize(original), fresh: original === null, error: null, original: null };
  } catch (error) {
    return { state: createGame(), fresh: false, error: error.message || 'Saved colony could not be read.', original };
  }
}
export function storeColony(storage, session, state, replace = false) {
  if (session.error && !replace) throw new Error('Previous save could not be loaded. Export it or choose New colony before replacing it.');
  storage().setItem(SAVE_KEY, serialize(state));
  session.error = null; session.original = null;
}
