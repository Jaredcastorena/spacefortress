import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRID, DIRECTIONS, offsetToAxial, axialToOffset, step, neighbors,
  forwardNeighbors, opposite, directionBetween, distance, tileAt,
  groundCenter, corners, edge, fromGround,
} from '../src/geometry.js';

const key = point => point.join(',');
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const closePair = (a, b) => { close(a[0], b[0]); close(a[1], b[1]); };
const midpoint = (a, b) => a.map((value, index) => (value + b[index]) / 2);
const toward = (a, b, amount) => a.map((value, index) => value + (b[index] - value) * amount);
const undirected = (a, b) => [key(a), key(b)].sort().join('|');

test('odd-q conversion preserves negative columns, both parities and integers beyond 32 bits', () => {
  assert.equal(GRID, 'hex-odd-q-v1');
  assert.deepEqual(DIRECTIONS, ['n', 'ne', 'se', 's', 'sw', 'nw']);
  assert.ok(Object.isFrozen(DIRECTIONS));
  const cases = [
    [[0, 0], [0, 0]], [[1, 0], [1, 0]], [[2, 0], [2, -1]],
    [[-1, 0], [-1, 1]], [[-2, 0], [-2, 1]], [[-3, -2], [-3, 0]],
    [[2 ** 32 + 1, 9], [2 ** 32 + 1, 9 - 2 ** 31]],
  ];
  for (const [offset, axial] of cases) {
    assert.deepEqual(offsetToAxial(...offset), axial);
    assert.deepEqual(axialToOffset(...axial), offset);
  }
  for (let x = -24; x <= 24; x++) for (let y = -24; y <= 24; y++) {
    assert.deepEqual(axialToOffset(...offsetToAxial(x, y)), [x, y]);
    assert.deepEqual(offsetToAxial(...axialToOffset(x, y)), [x, y]);
  }
});

test('six true neighbors have reciprocal directions and equal physical separation', () => {
  assert.deepEqual(neighbors(0, 0), [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 0], [-1, -1]]);
  assert.deepEqual(neighbors(1, 0), [[1, -1], [2, 0], [2, 1], [1, 1], [0, 1], [0, 0]]);
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) {
    const origin = [x, y], center = groundCenter(x, y), adjacent = neighbors(x, y);
    assert.equal(new Set(adjacent.map(key)).size, 6);
    assert.equal(directionBetween(origin, origin), null);
    assert.equal(directionBetween(origin, [x + 3, y + 3]), null);
    for (let i = 0; i < DIRECTIONS.length; i++) {
      const direction = DIRECTIONS[i], next = adjacent[i], nextCenter = groundCenter(...next);
      assert.deepEqual(step(...origin, direction), next);
      assert.equal(directionBetween(origin, next), direction);
      assert.equal(directionBetween(next, origin), opposite(direction));
      assert.equal(opposite(opposite(direction)), direction);
      assert.deepEqual(step(...next, opposite(direction)), origin);
      assert.equal(distance(origin, next), 1);
      close(Math.hypot(nextCenter[0] - center[0], nextCenter[1] - center[1]), Math.sqrt(3));
    }
  }
});

test('distance agrees with breadth-first shortest paths, is symmetric and satisfies triangle inequality', () => {
  for (const start of [[0, 0], [1, 1], [-3, -2]]) {
    const queue = [[start, 0]], visited = new Set([key(start)]);
    for (let i = 0; i < queue.length; i++) {
      const [position, depth] = queue[i];
      assert.equal(distance(start, position), depth);
      assert.equal(distance(position, start), depth);
      assert.equal(distance(position, position), 0);
      for (const via of [[-4, 3], [2, -5], [0, 0]]) {
        assert.ok(distance(start, position) <= distance(start, via) + distance(via, position));
      }
      if (depth === 7) continue;
      for (const next of neighbors(...position)) if (!visited.has(key(next))) {
        visited.add(key(next)); queue.push([next, depth + 1]);
      }
    }
    assert.equal(visited.size, 1 + 3 * 7 * 8);
  }
});

test('three forward neighbors visit every in-map edge exactly once without row wrapping', () => {
  for (const size of [1, 2, 3, 8]) {
    const site = { size, tiles: Array.from({ length: size * size }, (_, id) => ({ id })) };
    const allEdges = new Set(), forwardEdges = new Map();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      assert.equal(tileAt(site, x, y), site.tiles[y * size + x]);
      for (const adjacent of neighbors(x, y)) if (tileAt(site, ...adjacent)) allEdges.add(undirected([x, y], adjacent));
      assert.deepEqual(forwardNeighbors(x, y), ['n', 'ne', 'se'].map(direction => step(x, y, direction)));
      for (const adjacent of forwardNeighbors(x, y)) if (tileAt(site, ...adjacent)) {
        const id = undirected([x, y], adjacent);
        forwardEdges.set(id, (forwardEdges.get(id) ?? 0) + 1);
      }
    }
    assert.deepEqual(new Set(forwardEdges.keys()), allEdges);
    assert.ok([...forwardEdges.values()].every(count => count === 1));
    for (const invalid of [[-1, 1], [size, 0], [0, -1], [0, size], [.5, 0], [0, NaN], [Infinity, 0]]) {
      assert.equal(tileAt(site, ...invalid), null);
    }
  }
  const site = { size: 2, tiles: new Proxy([], { get() { assert.fail('Invalid coordinates indexed tiles.'); } }) };
  assert.equal(tileAt(site, -1, 1), null);
  assert.equal(tileAt(site, 2, 0), null);
  assert.equal(tileAt({ size: 2, tiles: [] }, 0, 0), null);
  for (const invalid of [null, {}, { size: 0, tiles: [] }, { size: 1.5, tiles: [] }, { size: 2 }]) {
    assert.equal(tileAt(invalid, 0, 0), null);
  }
});

test('unit hex corners wind consistently and adjacent cells share opposite edges', () => {
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) {
    const center = groundCenter(x, y), vertices = corners(x, y);
    assert.equal(vertices.length, 6);
    closePair(vertices[0], [center[0] + 1, center[1]]);
    let twiceArea = 0;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % 6];
      close(Math.hypot(a[0] - center[0], a[1] - center[1]), 1);
      close(Math.hypot(b[0] - a[0], b[1] - a[1]), 1);
      twiceArea += a[0] * b[1] - b[0] * a[1];
    }
    close(twiceArea / 2, 3 * Math.sqrt(3) / 2);
    for (const direction of DIRECTIONS) {
      const neighbor = step(x, y, direction), own = edge(x, y, direction), shared = edge(...neighbor, opposite(direction));
      closePair(own[0], shared[1]); closePair(own[1], shared[0]);
      closePair(midpoint(...own), midpoint(center, groundCenter(...neighbor)));
    }
  }
});

test('inverse preserves centers and picks the correct side of every edge and corner', () => {
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) {
    const origin = [x, y], center = groundCenter(x, y);
    assert.deepEqual(fromGround(...center), origin);
    for (const direction of DIRECTIONS) {
      const next = step(x, y, direction), boundary = midpoint(...edge(x, y, direction));
      assert.deepEqual(fromGround(...toward(boundary, center, 1e-7)), origin);
      assert.deepEqual(fromGround(...toward(boundary, groundCenter(...next), 1e-7)), next);
      assert.ok([key(origin), key(next)].includes(key(fromGround(...boundary))));
    }
    for (const vertex of corners(x, y)) {
      assert.deepEqual(fromGround(...toward(vertex, center, 1e-7)), origin);
      const touching = [origin, ...neighbors(x, y)].filter(cell => {
        const c = groundCenter(...cell); return Math.abs(Math.hypot(vertex[0] - c[0], vertex[1] - c[1]) - 1) < 1e-10;
      });
      assert.equal(touching.length, 3);
      assert.ok(touching.some(cell => key(cell) === key(fromGround(...vertex))));
      for (const cell of touching) assert.deepEqual(fromGround(...toward(vertex, groundCenter(...cell), 1e-7)), cell);
    }
  }
});

test('inverse cube ties have documented deterministic ownership and never clamp negative cells', () => {
  assert.deepEqual(fromGround(0, -Math.sqrt(3) / 2), [0, -1]);
  assert.deepEqual(fromGround(0, Math.sqrt(3) / 2), [0, 0]);
  assert.deepEqual(fromGround(1, 0), [0, 0]);
  assert.deepEqual(fromGround(-1, 0), [0, 0]);
  assert.deepEqual(fromGround(...groundCenter(-20, -30)), [-20, -30]);
  assert.deepEqual(fromGround(-0, -0), [0, 0]);
  const site = { size: 4, tiles: Array.from({ length: 16 }, () => ({})) };
  assert.equal(tileAt(site, ...fromGround(...groundCenter(-1, 1))), null);
});

test('invalid geometry input fails explicitly while lookup is nullable and returned arrays are independent', () => {
  for (const invalid of [.5, NaN, Infinity, '1', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    for (const operation of [offsetToAxial, axialToOffset, neighbors, forwardNeighbors, groundCenter, corners]) {
      assert.throws(() => operation(invalid, 0), TypeError);
    }
    assert.throws(() => step(invalid, 0, 'n'), TypeError);
    assert.throws(() => edge(invalid, 0, 'n'), TypeError);
    assert.throws(() => distance([invalid, 0], [0, 0]), TypeError);
    assert.throws(() => directionBetween([0, 0], [invalid, 0]), TypeError);
  }
  for (const invalid of [NaN, Infinity, '1', undefined]) assert.throws(() => fromGround(invalid, 0), TypeError);
  for (const invalid of ['e', 'N', '', null]) {
    assert.throws(() => opposite(invalid), RangeError);
    assert.throws(() => step(0, 0, invalid), RangeError);
    assert.throws(() => edge(0, 0, invalid), RangeError);
  }
  assert.throws(() => distance({ x: 0, y: 0 }, [0, 0]), TypeError);
  assert.throws(() => directionBetween([0, 0, 0], [0, 0]), TypeError);
  assert.throws(() => offsetToAxial(Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(() => fromGround(Number.MAX_VALUE, 0), RangeError);
  const mutable = neighbors(0, 0); mutable[0][0] = 500;
  assert.deepEqual(step(0, 0, 'n'), [0, -1]);
  const vertex = corners(0, 0); vertex[0][0] = 500;
  assert.deepEqual(corners(0, 0)[0], [1, 0]);
});
