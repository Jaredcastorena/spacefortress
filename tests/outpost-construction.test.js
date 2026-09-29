import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo, cancelJob, serialize, deserialize } from '../src/simulation.js';
import { foodLots } from '../src/food-lots.js';
import { initializeStorage } from '../src/inventory.js';
import {
  cancelMaterials,
  constructionResources,
  deliverMaterials,
  fetchMaterials,
  reserveConstruction,
} from '../src/construction.js';

const target = [9, 11];
const job = (s, sources, cost) => ({
  id: `job-${s.nextId++}`,
  site: 'wreck',
  x: target[0],
  y: target[1],
  kind: 'build',
  building: 'stockpile',
  cost,
  sources,
  materials: {},
  work: 5,
  remaining: 5,
  worker: null,
  priority: 3,
  blockedReason: null,
  missingFood: 0,
  foodSpoiled: 0,
});

function outpost() {
  const s = createGame(), site = s.sites.wreck;
  const dock = site.tiles.find(tile => tile.building === 'dock');
  dock.imports = {};
  return { s, site, dock, surfaceDepot: at(s.sites.surface, 8, 10) };
}

test('wreck construction cannot spend surface stock or unreachable wreck piles', () => {
  const { s, site, surfaceDepot } = outpost(), before = structuredClone(surfaceDepot.stock);
  assert.ok(constructionResources(s).alloy >= 5);
  assert.equal(constructionResources(s, 'wreck').alloy, 0);
  assert.equal(reserveConstruction(s, 'wreck', ...target, { alloy: 5 }, pathTo), null);
  assert.deepEqual(surfaceDepot.stock, before);

  const isolated = at(site, 1, 1);
  isolated.terrain = 'deck'; isolated.drop = { alloy: 5 };
  assert.equal(constructionResources(s, 'wreck').alloy, 5);
  assert.equal(reserveConstruction(s, 'wreck', ...target, { alloy: 5 }, pathTo), null);
  assert.deepEqual(isolated.drop, { alloy: 5 });
  assert.deepEqual(surfaceDepot.stock, before);
});

test('construction leaves material promised to a same-site pickup in dock imports', () => {
  const { s, dock } = outpost(), carrier = s.crew[0];
  dock.imports = { alloy: 6 };
  carrier.site = 'wreck'; carrier.x = 4; carrier.y = 10; carrier.carry = null;
  carrier.intent = { type: 'haul', target: [dock.x, dock.y], source: 'imports', items: { alloy: 4 }, destination: { kind: 'stock', target: [6, 11] } };

  assert.equal(constructionResources(s, 'wreck').alloy, 2);
  assert.equal(reserveConstruction(s, 'wreck', ...target, { alloy: 3 }, pathTo), null);
  const sources = reserveConstruction(s, 'wreck', ...target, { alloy: 2 }, pathTo);
  assert.deepEqual(sources, [{ x: dock.x, y: dock.y, kind: 'imports', items: { alloy: 2 } }]);
  assert.deepEqual(dock.imports, { alloy: 4 });
});

test('remote reservations restore each local owner and preserve food and item metadata', () => {
  const { s, site, dock, surfaceDepot } = outpost();
  const depot = at(site, 6, 11), pile = at(site, 7, 11);
  depot.building = 'stockpile'; initializeStorage(depot); depot.stock = { alloy: 2 };
  const meal = { id: 'meal-job-1', maker: 'crew-0', quality: 3, created: 0 };
  const keepsake = { id: 'item-1', maker: 'crew-0', style: 'quiet', quality: 2, created: 0 };
  s.nextItemId = 2;
  dock.imports = { alloy: 2, food: 1, _food: [{ amount: 1, age: 120, meal }], keepsakes: 1, _items: [keepsake] };
  pile.drop = { alloy: 3 };
  const original = { stock: structuredClone(depot.stock), imports: structuredClone(dock.imports), drop: structuredClone(pile.drop), surface: structuredClone(surfaceDepot.stock) };
  const cost = { alloy: 7, food: 1, keepsakes: 1 };

  const sources = reserveConstruction(s, 'wreck', ...target, cost, pathTo);
  assert.deepEqual(sources.map(source => [source.x, source.y, source.kind]), [[6, 11, 'stock'], [4, 11, 'imports'], [7, 11, 'drop']]);
  assert.ok(sources.every(source => !Object.hasOwn(source, 'site')), 'sources inherit the job site');
  const imported = sources.find(source => source.kind === 'imports').items;
  assert.deepEqual(foodLots(imported), [{ amount: 1, age: 120, meal }]);
  assert.deepEqual(imported._items, [keepsake]);

  const current = job(s, sources, cost); s.jobs.push(current);
  const reloaded = deserialize(serialize(s)), saved = reloaded.jobs.find(candidate => candidate.id === current.id);
  assert.deepEqual(foodLots(saved.sources.find(source => source.kind === 'imports').items), [{ amount: 1, age: 120, meal }]);
  assert.deepEqual(saved.sources.find(source => source.kind === 'imports').items._items, [keepsake]);
  cancelJob(s, current.id);
  assert.deepEqual(depot.stock, original.stock);
  assert.deepEqual(dock.imports, original.imports);
  assert.deepEqual(pile.drop, original.drop);
  assert.deepEqual(surfaceDepot.stock, original.surface);
  const restored = structuredClone({ stock: depot.stock, imports: dock.imports, drop: pile.drop });
  cancelMaterials(s, current);
  assert.deepEqual({ stock: depot.stock, imports: dock.imports, drop: pile.drop }, restored, 'a repeated cleanup cannot duplicate returned sources');
});

test('remote collection and cancellation keep delivered metadata at the wreck work site', () => {
  const { s, site, dock, surfaceDepot } = outpost(), crew = s.crew[0];
  const meal = { id: 'meal-job-2', maker: 'crew-0', quality: 4, created: 0 };
  const keepsake = { id: 'item-2', maker: 'crew-0', style: 'art', quality: 3, created: 0 };
  dock.imports = { food: 1, _food: [{ amount: 1, age: 240, meal }], keepsakes: 1, _items: [keepsake] };
  const surfaceBefore = structuredClone(surfaceDepot.stock), cost = { food: 1, keepsakes: 1 };
  const current = job(s, reserveConstruction(s, 'wreck', ...target, cost, pathTo), cost);
  s.jobs.push(current);
  crew.site = 'wreck'; crew.x = dock.x; crew.y = dock.y; crew.carry = null; crew.delivery = null; crew.intent = null;

  fetchMaterials(s, crew, current, site, pathTo);
  assert.deepEqual(foodLots(crew.carry), [{ amount: 1, age: 240, meal }]);
  assert.deepEqual(crew.carry._items, [keepsake]);
  const held = structuredClone(crew.carry), delivery = structuredClone(crew.delivery), position = [crew.x, crew.y];
  assert.equal(deliverMaterials(s, crew, s.sites.surface, pathTo), false);
  assert.deepEqual(crew.carry, held); assert.deepEqual(crew.delivery, delivery); assert.deepEqual([crew.x, crew.y], position);
  for (let i = 0; i < 30 && crew.carry; i++) deliverMaterials(s, crew, site, pathTo);
  assert.equal(crew.carry, null);
  assert.deepEqual(foodLots(current.materials), [{ amount: 1, age: 240, meal }]);
  assert.deepEqual(current.materials._items, [keepsake]);

  cancelJob(s, current.id);
  const staged = at(site, ...target).drop;
  assert.deepEqual(foodLots(staged), [{ amount: 1, age: 240, meal }]);
  assert.deepEqual(staged._items, [keepsake]);
  assert.deepEqual(dock.imports, {});
  assert.deepEqual(surfaceDepot.stock, surfaceBefore);
});

test('cancelled imports from a lost dock become one local pile', () => {
  const { s, dock, surfaceDepot } = outpost(), surfaceBefore = structuredClone(surfaceDepot.stock);
  dock.imports = { alloy: 5 };
  const cost = { alloy: 5 }, current = job(s, reserveConstruction(s, 'wreck', ...target, cost, pathTo), cost);
  s.jobs.push(current);
  dock.building = null; delete dock.imports;

  cancelJob(s, current.id);
  assert.deepEqual(dock.drop, { alloy: 5 });
  assert.deepEqual(surfaceDepot.stock, surfaceBefore);
  cancelMaterials(s, current);
  assert.deepEqual(dock.drop, { alloy: 5 }, 'cleanup is idempotent after the caller removes the job');
});
