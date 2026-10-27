import test from 'node:test';
import assert from 'node:assert/strict';
import { tileAt, inside, tilesOnLevel, cellKey, locationKey, sameCell, sameLocation, horizontalNeighbors } from '../src/spatial.js';
import { tileAt as legacyTileAt } from '../src/geometry.js';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';

// Synthetic addressing fixtures; the colony schema does not yet install decks.
function site(levels = [4, -2, 0]) {
  return { id: 'surface', size: 3, levels: levels.map(z => ({ z, name: `Deck ${z}` })),
    tiles: levels.flatMap(z => Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3), z, marker: `${z}/${i}` }))) };
}

test('declared deck order addresses negative and nonconsecutive levels without overlapping cells', () => {
  const s = site(), before = JSON.stringify(s), seen = new Set();
  for (const z of [4, -2, 0]) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const tile = tileAt(s, { x, y, z });
    assert.deepEqual([tile.x, tile.y, tile.z], [x, y, z]);
    assert.ok(inside(s, { x, y, z })); seen.add(tile);
  }
  assert.equal(seen.size, 27);
  assert.deepEqual(tilesOnLevel(s, -2).map(t => t.marker), Array.from({ length: 9 }, (_, i) => `-2/${i}`));
  assert.equal(JSON.stringify(s), before);
});

test('invalid cells, site qualification and malformed deck metadata never alias a valid tile', () => {
  const s = site();
  for (const p of [null, {}, { x: 0, y: 0 }, { x: 3, y: 0, z: 0 }, { x: -1, y: 1, z: 0 },
    { x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 1 }, { x: .5, y: 0, z: 0 }, { x: 0, y: 0, z: Infinity },
    { x: 0, y: 0, z: Number.MAX_SAFE_INTEGER + 1 }, { site: 'wreck', x: 0, y: 0, z: 0 }]) {
    assert.equal(tileAt(s, p), null); assert.equal(inside(s, p), false);
  }
  assert.equal(tileAt(s, { site: 'surface', x: 0, y: 0, z: -2 }).z, -2);
  for (const levels of [null, {}, [], [{ z: 0 }, { z: 0 }], [{ z: 0 }, { z: .5 }], [null]]) {
    assert.equal(tileAt({ ...s, levels }, { x: 0, y: 0, z: 0 }), null);
    assert.deepEqual(tilesOnLevel({ ...s, levels }, 0), []);
  }
  assert.equal(tileAt({ ...s, size: Number.MAX_SAFE_INTEGER }, { x: 0, y: 0, z: 0 }), null);
  assert.deepEqual(tilesOnLevel(s, 99), []);
});

test('six horizontal hex neighbors retain level and optional site, without implicit vertical edges', () => {
  for (const [x, expected] of [[0, [[0,-1],[1,-1],[1,0],[0,1],[-1,0],[-1,-1]]], [1, [[1,-1],[2,0],[2,1],[1,1],[0,1],[0,0]]]]) {
    const p = { site: 'surface', x, y: 0, z: -2 }, result = horizontalNeighbors(p);
    assert.deepEqual(result.map(q => [q.x, q.y]), expected);
    assert.ok(result.every(q => q.z === -2 && q.site === 'surface'));
    assert.equal(new Set(result.map(locationKey)).size, 6);
    assert.ok(result.every(q => !sameCell(q, { x, y: 0, z: 0 })));
    assert.deepEqual(p, { site: 'surface', x, y: 0, z: -2 });
  }
  assert.ok(horizontalNeighbors({ x: -3, y: -4, z: 8 }).every(p => p.z === 8 && !Object.hasOwn(p, 'site')));
  assert.throws(() => horizontalNeighbors({ x: 0, y: 0 }), TypeError);
});

test('cell keys distinguish levels and qualified location keys also distinguish sites', () => {
  const p = { x: 1, y: 2, z: -3 }, surface = { ...p, site: 'surface' }, wreck = { ...p, site: 'wreck' };
  assert.equal(cellKey(p), '1,2,-3'); assert.notEqual(cellKey(p), cellKey({ ...p, z: 0 }));
  assert.ok(sameCell(surface, wreck)); assert.equal(sameLocation(surface, wreck), false);
  assert.notEqual(locationKey(surface), locationKey(wreck)); assert.ok(sameLocation(surface, { ...surface }));
  assert.equal(sameCell(p, { ...p, z: 4 }), false); assert.equal(sameCell(p, null), false);
  assert.equal(sameLocation(p, p), false);
  assert.throws(() => cellKey({ x: 1, y: 2 }), TypeError); assert.throws(() => locationKey(p), TypeError);
});

test('the compatibility lookup always defaults to deck zero, never the first or viewed deck', () => {
  const s = site(); s.viewZ = 4;
  assert.equal(legacyTileAt(s, 1, 2).z, 0);
  assert.equal(legacyTileAt(s, 1, 2, -2).z, -2);
  assert.equal(legacyTileAt(s, 1, 2, 99), null);
  const visible = tilesOnLevel(s, 4); visible.pop();
  assert.equal(s.tiles.length, 27, 'a view array cannot remove canonical tiles');
  assert.equal(visible[0], s.tiles[0], 'views retain physical tile identity');
});

test('current single-floor colonies retain exact lookup identity and canonical saves', () => {
  const state = createGame(74219), before = serialize(state);
  for (const s of Object.values(state.sites)) {
    assert.deepEqual(s.levels, [{ z: 0, name: 'Landing deck' }]);
    assert.deepEqual(s.verticalLinks, []);
    assert.equal(tilesOnLevel(s, 0).length, s.tiles.length);
    for (const t of s.tiles) {
      assert.equal(tileAt(s, { x: t.x, y: t.y, z: 0 }), t);
      assert.equal(at(s, t.x, t.y), t);
      assert.equal(tileAt(s, { x: t.x, y: t.y, z: 1 }), null);
    }
  }
  assert.equal(serialize(state), before); assert.equal(serialize(deserialize(before)), before);
});

test('the current save loader rejects incomplete or inconsistent declared floor layouts', () => {
  const original = serialize(createGame(74219));
  for (const levels of [[{ z: 0 }], [{ z: 1, name: 'Upper' }], [{ z: 0, name: 'Landing' }, { z: 1, name: 'Upper' }]]) {
    const value = JSON.parse(original); value.sites.surface.levels = levels;
    assert.throws(() => deserialize(JSON.stringify(value)), /deck|site/i);
  }
  const stacked = JSON.parse(original); stacked.sites.surface.tiles.push(...structuredClone(stacked.sites.surface.tiles));
  assert.throws(() => deserialize(JSON.stringify(stacked)), /Invalid site/);
  assert.equal(serialize(deserialize(original)), original);
});
