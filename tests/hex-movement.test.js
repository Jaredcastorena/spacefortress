import test from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, step, tileAt } from '../src/geometry.js';
import { pathTo, animalPath, planCrewRoute } from '../src/navigation.js';
import { reserveConstruction, fetchMaterials, deliverMaterials, materialRoute, cancelMaterials } from '../src/construction.js';
import { pastureRegions } from '../src/pastures.js';

function map(size = 9) {
  return { id: 'surface', size, tiles: Array.from({ length: size * size }, (_, i) => ({ x: i % size, y: Math.floor(i / size), terrain: 'void', building: null, hp: 100, fire: 0 })) };
}
function open(site, p, building = null) { return Object.assign(tileAt(site, ...p), { terrain: 'ground', building }); }

for (const x of [4, 5]) {
  test(`crew and animals use all six sides of column ${x} without a square corner shortcut`, () => {
    const site = map(), from = { x, y: 4 }, origin = [x, 4];
    open(site, origin);
    for (const side of neighbors(...origin)) {
      open(site, side);
      assert.deepEqual(pathTo(site, from, [side]), [side]);
      assert.deepEqual(animalPath(site, { ...from, species: 'bristleback' }, [side]), [side]);
      assert.deepEqual(planCrewRoute({ sites: { surface: site } }, site, from, [side]), { path: [side], cost: 1, segments: [{ kind: 'walk', path: [side] }] });
      tileAt(site, ...side).terrain = 'void';
    }
    const corner = [x + 1, x % 2 ? 3 : 5];
    open(site, corner);
    assert.equal(pathTo(site, from, [corner]), null);
    assert.equal(animalPath(site, { ...from, species: 'bristleback' }, [corner]), null);
    assert.equal(pathTo(site, from, [[-1, 4], [site.size, 3]]), null);
  });

  test(`construction reserves, carries and stages physical material from every hex side at column ${x}`, () => {
    for (const side of neighbors(x, 4)) {
      const site = map(), target = [x, 4], depot = open(site, side, 'stockpile');
      open(site, target, 'wall'); depot.stock = { alloy: 5 };
      const crew = { id: 'builder', site: site.id, x: side[0], y: side[1], health: 100 }, s = { sites: { surface: site }, jobs: [], crew: [crew] };
      const cost = { alloy: 5 }, sources = reserveConstruction(s, site.id, ...target, cost, pathTo);
      assert.equal(depot.stock.alloy, undefined); assert.equal(s.resources.alloy, 0);
      assert.deepEqual(sources, [{ x: side[0], y: side[1], kind: 'stock', items: cost }]);
      const j = { id: 'build', site: site.id, kind: 'build', x, y: 4, cost, sources, materials: {} }; s.jobs.push(j);
      fetchMaterials(s, crew, j, site, pathTo);
      assert.deepEqual(crew.carry, cost); assert.deepEqual(j.sources[0].items, {});
      assert.equal(deliverMaterials(s, crew, site, pathTo), true);
      assert.deepEqual(j.materials, cost); assert.equal(crew.carry, null);
      assert.deepEqual(materialRoute(j, crew, site, pathTo), []);
      cancelMaterials(s, j);
      assert.deepEqual(depot.drop, cost); assert.deepEqual(j.materials, {});
    }
  });
}

test('a six-sided fence encloses a pasture and opening the extra diagonal edge releases it', () => {
  const site = map(), center = [4, 4];
  for (const tile of site.tiles) tile.terrain = 'ground';
  for (const p of neighbors(...center)) open(site, p, 'fence');
  const enclosed = pastureRegions(site).byCell.get(center[1] * site.size + center[0]);
  assert.equal(enclosed.enclosed, true); assert.deepEqual(enclosed.cells, [center]);
  tileAt(site, ...step(...center, 'ne')).hp = 0;
  const released = pastureRegions(site).byCell.get(center[1] * site.size + center[0]);
  assert.equal(released.enclosed, false); assert.ok(released.cells.length > 1);
});
