// Compatibility entry point for existing two-coordinate callers. New spatial
// code uses explicit { x, y, z } positions from spatial.js. Omitted z always
// means deck zero, independently of the selected view or level array order.
export * from './hex.js';
import { tileAt as tileAtPosition } from './spatial.js';

export function tileAt(site, x, y, z = 0) {
  return tileAtPosition(site, { x, y, z });
}
