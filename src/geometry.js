// Shared flat-top odd-q geometry. Coordinates use column x and row y;
// projection, pixel scale, map bounds and simulation state belong to callers.
export const GRID = 'hex-odd-q-v1';
export const DIRECTIONS = Object.freeze(['n', 'ne', 'se', 's', 'sw', 'nw']);

const ROOT3 = Math.sqrt(3);
const AXIAL_STEPS = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0]];
const VERTICES = [[1, 0], [.5, ROOT3 / 2], [-.5, ROOT3 / 2], [-1, 0], [-.5, -ROOT3 / 2], [.5, -ROOT3 / 2]];
const EDGE_CORNERS = [[4, 5], [5, 0], [0, 1], [1, 2], [2, 3], [3, 4]];

function integers(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new TypeError('Hex coordinates must be safe integers.');
  }
}

function pair(value) {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError('Expected a coordinate pair.');
  integers(...value);
}

function result(a, b) {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    throw new RangeError('Hex coordinates exceed safe integer precision.');
  }
  return [a === 0 ? 0 : a, b === 0 ? 0 : b];
}

function directionIndex(direction) {
  const index = DIRECTIONS.indexOf(direction);
  if (index < 0) throw new RangeError('Unknown hex direction.');
  return index;
}

// Math.floor also gives the correct odd-column offset for negative columns.
export function offsetToAxial(x, y) {
  integers(x, y);
  return result(x, y - Math.floor(x / 2));
}

export function axialToOffset(q, r) {
  integers(q, r);
  return result(q, r + Math.floor(q / 2));
}

export function step(x, y, direction) {
  const [q, r] = offsetToAxial(x, y);
  const [dq, dr] = AXIAL_STEPS[directionIndex(direction)];
  const [nextQ, nextR] = result(q + dq, r + dr);
  return axialToOffset(nextQ, nextR);
}

export function neighbors(x, y) {
  return DIRECTIONS.map(direction => step(x, y, direction));
}

// These three directions own each undirected edge exactly once.
export function forwardNeighbors(x, y) {
  return DIRECTIONS.slice(0, 3).map(direction => step(x, y, direction));
}

export function opposite(direction) {
  return DIRECTIONS[(directionIndex(direction) + 3) % 6];
}

export function directionBetween(a, b) {
  pair(a);
  pair(b);
  const [aq, ar] = offsetToAxial(...a), [bq, br] = offsetToAxial(...b);
  const index = AXIAL_STEPS.findIndex(([dq, dr]) => bq - aq === dq && br - ar === dr);
  return index < 0 ? null : DIRECTIONS[index];
}

export function distance(a, b) {
  pair(a);
  pair(b);
  const [aq, ar] = offsetToAxial(...a), [bq, br] = offsetToAxial(...b);
  const dq = bq - aq, dr = br - ar;
  const value = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  if (!Number.isSafeInteger(value)) throw new RangeError('Hex distance exceeds safe integer precision.');
  return value;
}

// Unlike the unbounded geometry functions, lookup returns null for invalid
// input, missing cells or out-of-map coordinates. Check before indexing so a
// negative column or column === size can never wrap into another row.
export function tileAt(site, x, y) {
  const size = site?.size;
  if (!Number.isSafeInteger(size) || size <= 0 || !Number.isSafeInteger(size * size)
      || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)
      || x < 0 || y < 0 || x >= size || y >= size || !Array.isArray(site.tiles)) return null;
  return site.tiles[y * size + x] ?? null;
}

export function groundCenter(x, y) {
  const [q, r] = offsetToAxial(x, y);
  return [1.5 * q, ROOT3 * (r + q / 2)];
}

// Vertices begin east and run toward positive ground-v (clockwise on screen).
export function corners(x, y) {
  const [u, v] = groundCenter(x, y);
  return VERTICES.map(([du, dv]) => [u + du, v + dv]);
}

export function edge(x, y, direction) {
  const indices = EDGE_CORNERS[directionIndex(direction)];
  const vertices = corners(x, y);
  return indices.map(index => vertices[index]);
}

// Round fractional cube (q,r,s=-q-r), then repair its largest rounding error.
// Scalar half ties round toward +Infinity. Error ties within 1e-12 are resolved
// in q, r, s order; that tolerance absorbs arithmetic noise at shared edges
// and corners. Boundary ownership is deterministic, without clamping to a map.
// Integer geometry inputs must be safe integers; this inverse accepts finite
// ground coordinates and rejects results outside safe integer precision.
export function fromGround(u, v) {
  if (!Number.isFinite(u) || !Number.isFinite(v)) throw new TypeError('Ground coordinates must be finite numbers.');
  const q = u * (2 / 3), r = v / ROOT3 - u / 3, s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const eq = Math.abs(rq - q), er = Math.abs(rr - r), es = Math.abs(rs - s);
  const largest = Math.max(eq, er, es), tolerance = 1e-12;
  if (largest - eq <= tolerance) rq = -rr - rs;
  else if (largest - er <= tolerance) rr = -rq - rs;
  else rs = -rq - rr;
  const [safeQ, safeR] = result(rq, rr);
  return axialToOffset(safeQ, safeR);
}
