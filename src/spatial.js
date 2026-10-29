// Deck-aware cell addressing. No simulation state, rendering or vertical edges.
import { neighbors } from './hex.js';

// Stable physical-owner IDs. Ground IDs retain their original form.
export const tileEntityId = (site,x,y,z=0) => `tile:${site}:${x}:${y}${z===0?'':`:${z}`}`;

const position = p => !!p && ['x', 'y', 'z'].every(key => Number.isSafeInteger(p[key]));
const qualified = p => position(p) && typeof p.site === 'string' && p.site.length > 0;

function requirePosition(p) {
  if (!position(p)) throw new TypeError('Expected explicit safe integer x, y and z coordinates.');
}

// Deck numbers are identifiers, not dense-array indices. Legacy single-floor
// sites omit levels and expose only z=0 until their save migration is complete.
function layout(site, z) {
  const size = site?.size, area = size * size;
  if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(area)
      || !Number.isSafeInteger(z) || !Array.isArray(site.tiles)) return null;
  if (site.levels === undefined) return z === 0 ? { size, area, offset: 0 } : null;
  if (!Array.isArray(site.levels) || !site.levels.length
      || !Number.isSafeInteger(area * site.levels.length)) return null;
  const seen = new Set();
  let index = -1;
  for (let i = 0; i < site.levels.length; i++) {
    const level = site.levels[i];
    if (!Number.isSafeInteger(level?.z) || seen.has(level.z)) return null;
    seen.add(level.z);
    if (level.z === z) index = i;
  }
  return index < 0 ? null : { size, area, offset: index * area };
}

export function tileAt(site, p) {
  if (!position(p) || p.site !== undefined && p.site !== site?.id) return null;
  const deck = layout(site, p.z);
  if (!deck || p.x < 0 || p.y < 0 || p.x >= deck.size || p.y >= deck.size) return null;
  return site.tiles[deck.offset + p.y * deck.size + p.x] ?? null;
}

export function inside(site, p) { return tileAt(site, p) !== null; }

export function tilesOnLevel(site, z) {
  const deck = layout(site, z);
  return deck ? site.tiles.slice(deck.offset, deck.offset + deck.area) : [];
}

// Local keys/equality require a known site. Use qualified helpers across sites.
export function cellKey(p) { requirePosition(p); return `${p.x},${p.y},${p.z}`; }
export function sameCell(a, b) {
  return position(a) && position(b) && a.x === b.x && a.y === b.y && a.z === b.z;
}
export function locationKey(p) {
  if (!qualified(p)) throw new TypeError('Expected a nonempty site and explicit x, y, z coordinates.');
  return `${p.site}:${cellKey(p)}`;
}
export function sameLocation(a, b) { return qualified(a) && qualified(b) && a.site === b.site && sameCell(a, b); }

export function horizontalNeighbors(p) {
  requirePosition(p);
  return neighbors(p.x, p.y).map(([x, y]) => ({ x, y, z: p.z, ...(p.site === undefined ? {} : { site: p.site }) }));
}

// Existing movement interfaces accept legacy pairs or explicit positions. Pair
// omission means zero. Other decks are intentionally unavailable for execution
// until environment ownership, airlocks and observation IDs are converted.
export function groundStep(site, actor, next) {
  const from = actor && { ...actor, z: actor.z === undefined ? 0 : actor.z };
  const to = Array.isArray(next) && next.length === 2 ? { x: next[0], y: next[1], z: 0 } : next;
  if (!position(from) || from.z !== 0 || !position(to) || to.z !== 0 ||
      !tileAt(site, from) || !tileAt(site, to)) return null;
  return { x: to.x, y: to.y, z: 0 };
}

// Ordinary walking stays on the actor's declared deck. Pair destinations retain
// the legacy ground meaning; vertical movement needs a separate link contract.
export function horizontalStep(site, actor, next) {
  const from=actor&&{...actor,z:actor.z===undefined?0:actor.z};
  const to=Array.isArray(next)&&next.length===2?{x:next[0],y:next[1],z:0}:next;
  if(!position(from)||!position(to)||from.z!==to.z||!tileAt(site,from)||!tileAt(site,to))return null;
  return {x:to.x,y:to.y,z:to.z};
}

// Copy primary-entity coordinates; omitted z is the named legacy ground boundary.
export const positionOf = p => ({x:p.x,y:p.y,z:p.z === undefined ? 0 : p.z});
export function validCellPosition(site,p) {
  return p !== null && typeof p === 'object' && !Array.isArray(p) &&
    Object.keys(p).length === 3 && ['x','y','z'].every(k=>Object.hasOwn(p,k)) && !!tileAt(site,p);
}
