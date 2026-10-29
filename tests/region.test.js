import test from 'node:test';
import assert from 'node:assert/strict';
import { SITES, VERSION } from '../src/data.js';
import { neighbors } from '../src/hex.js';
import { extractionStatus, extractTile } from '../src/extraction.js';
import { makeRegion, generatedLayout, siteDefinitions, siteDefinition, siteKind, settlementSite, outpostSiteIds, routeDefinition, validateRegion, migrateRegion } from '../src/region.js';

const generated = region => Object.values(region.sites).filter(def => def.template);
function state(seed = 74219, legacy = false) {
  const region = makeRegion(seed, legacy);
  return { version: VERSION, seed, rng: 1938274, nextId: 22, region, sites: Object.fromEntries(Object.values(region.sites).map(def => [def.id, { id: def.id, kind: def.kind, size: def.size, explored: def.id === 'surface', tiles: def.template ? generatedLayout(def) : [] }])) };
}
function oldState() {
  const s = state(74219, true); s.version = 64; delete s.region;
  for (const site of Object.values(s.sites)) delete site.kind;
  Object.assign(s, { tick: 879, resources: { ore: 19, ice: 3 }, flags: { visited: true }, jobs: [{ id: 'job-7', site: 'wreck', remaining: 2 }], crew: [{ id: 'crew-0', site: 'wreck', x: 4, y: 11, z: 0, cargo: { alloy: 2 } }], mission: { site: 'wreck', remaining: 7 }, outposts: { wreck: { established: true, residents: ['crew-0'] } } });
  s.sites.wreck.tiles.push({ x: 4, y: 11, z: 0, terrain: 'deck', building: 'dock', stock: { ore: 4 }, hp: 74 }, { x: 5, y: 10, z: 1, terrain: 'floor', building: 'stockpile', stock: { ice: 2 }, deposit: { resource: 'ore', remaining: 0 } });
  return s;
}
function reachable(tiles) {
  const available = new Set(tiles.filter(tile => tile.terrain !== 'void').map(tile => `${tile.x},${tile.y}`));
  const visited = new Set(['4,11']), queue = [[4, 11]];
  for (const point of queue) for (const [x, y] of neighbors(...point)) {
    const key = `${x},${y}`;
    if (available.has(key) && !visited.has(key)) { visited.add(key); queue.push([x, y]); }
  }
  return { visited, available };
}

test('region catalogs are reproducible, deeply frozen and isolated from state counters', () => {
  const s = state(), before = JSON.stringify(s), region = makeRegion(s.seed);
  assert.deepEqual(region, makeRegion(s.seed));
  assert.deepEqual(region, s.region);
  assert.equal(region.schema, 2); assert.equal(region.legacy, false);
  assert.equal(Object.keys(region.planets).length, 3); assert.equal(Object.keys(region.sites).length, 8);
  assert.ok(Object.isFrozen(region)); assert.ok(Object.isFrozen(region.sites));
  for (const def of Object.values(region.sites)) {
    assert.ok(Object.isFrozen(def)); assert.ok(Object.isFrozen(def.map));
    assert.ok(Object.hasOwn(region.planets, def.planetId));
    assert.ok(def.map.x >= 0 && def.map.x <= 1 && def.map.y >= 0 && def.map.y <= 1);
    siteDefinition(s, def.id); routeDefinition(s, def.id);
    if (def.template) { generatedLayout(def); assert.ok(Object.isFrozen(def.survey)); }
  }
  validateRegion(s); assert.equal(JSON.stringify(s), before);
  assert.throws(() => { region.sites.wreck.fuel = 99; }, TypeError);
});

test('distinct seeds change generated identities, layouts, routes and finite opportunities', () => {
  const a = makeRegion(42), b = makeRegion(43);
  for (let i = 0; i < 2; i++) {
    const first = generated(a)[i], second = generated(b)[i];
    assert.notEqual(first.id, second.id);
    assert.notDeepEqual(generatedLayout(first), generatedLayout(second));
    assert.notDeepEqual(first.survey, second.survey);
    assert.notDeepEqual(a.routes[`route-${first.id}`], b.routes[`route-${second.id}`]);
  }
  const [outcrop, derelict] = generated(a);
  assert.ok(outcrop.survey.ore > 0 && outcrop.survey.ice > 0);
  assert.equal(outcrop.survey.components, 0); assert.equal(outcrop.survey.alloy, 0);
  assert.equal(derelict.survey.ore, 0); assert.equal(derelict.survey.ice, 0);
  assert.ok(derelict.survey.components > 0 && derelict.survey.alloy > 0);
  assert.ok(outcrop.fuel < derelict.fuel); assert.ok(outcrop.travel < derelict.travel);
  assert.ok(outcrop.debris.period > derelict.debris.period); assert.ok(outcrop.debris.damage < derelict.debris.damage);
});

test('seed boundary identities stay bounded, unique, ASCII and colon-free', () => {
  const ids = new Set();
  for (const seed of [0, 1, -1, 42, 43, 0xffffffff, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
    const region = makeRegion(seed); validateRegion(state(seed));
    for (const id of [...Object.keys(region.planets), ...generated(region).map(def => def.id)]) {
      assert.match(id, /^[a-z][a-z0-9-]{1,39}$/); assert.ok(!ids.has(id)); ids.add(id);
    }
    for (const id of Object.keys(region.routes)) assert.match(id, /^[a-z][a-z0-9-]{1,49}$/);
  }
  for (const seed of [undefined, null, '42', 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => makeRegion(seed), /seed/);
  assert.throws(() => makeRegion(42, 1), /mode/);
});

test('generated layouts have connected finite land and clear standard landing cells', () => {
  for (let seed = 0; seed < 32; seed++) for (const def of generated(makeRegion(seed))) {
    const tiles = generatedLayout(def), { visited, available } = reachable(tiles);
    assert.equal(tiles.length, 18 * 18); assert.deepEqual(visited, available);
    assert.ok(available.size >= 37 && available.size < 18 * 18);
    const docks = tiles.filter(tile => tile.building === 'dock'); assert.equal(docks.length, 1);
    assert.deepEqual([docks[0].x, docks[0].y, docks[0].z], [4, 11, 0]);
    for (const [x, y] of [[4, 11], [4, 10], [5, 10]]) {
      const tile = tiles[y * 18 + x];
      assert.equal(tile.terrain, def.template === 'outcrop' ? 'ground' : 'deck');
      assert.equal(tile.deposit, undefined);
      if (y !== 11) assert.equal(tile.building, null);
    }
    tiles.forEach((tile, i) => {
      assert.deepEqual([tile.x, tile.y, tile.z], [i % 18, Math.floor(i / 18), 0]);
      assert.ok(Number.isInteger(tile.variant) && tile.variant >= 0 && tile.variant < 4);
      assert.ok([null, 'dock', 'salvage'].includes(tile.building));
      assert.equal(tile.stock, undefined); assert.equal(tile.drop, undefined); assert.equal(tile.powered, undefined);
      if (tile.deposit) {
        assert.deepEqual(Object.keys(tile.deposit).sort(), ['remaining', 'resource']);
        assert.equal(tile.deposit.resource, 'ice'); assert.equal(tile.terrain, 'ground'); assert.equal(tile.building, null);
        assert.ok(Number.isInteger(tile.deposit.remaining) && tile.deposit.remaining > 0 && tile.deposit.remaining <= 12);
      }
    });
  }
});

test('initial survey equals all native extraction yields and exhausts without replenishment', () => {
  for (const def of generated(makeRegion(74219))) {
    const tiles = generatedLayout(def), totals = { ore: 0, ice: 0, components: 0, alloy: 0 }, originalSurvey = JSON.stringify(def.survey);
    for (const tile of tiles) {
      let count = 0;
      while (extractionStatus(tile)) {
        assert.ok(++count <= 2);
        for (const [resource, amount] of Object.entries(extractTile(tile).output)) totals[resource] += amount;
      }
      assert.equal(extractTile(tile), null);
    }
    assert.deepEqual(totals, Object.fromEntries(Object.entries(def.survey).filter(([key]) => key !== 'label')));
    assert.equal(def.survey.label, 'Initial survey'); assert.equal(JSON.stringify(def.survey), originalSurvey);
    assert.ok(tiles.every(tile => !extractionStatus(tile)));
    assert.deepEqual(generatedLayout(def), generatedLayout(def));
    assert.notDeepEqual(tiles, generatedLayout(def));
  }
});

test('routes are canonical, capped, immutable and connect home to every destination', () => {
  const s = state(), routes = Object.values(s.region.routes);
  assert.equal(routes.length, 7); assert.equal(new Set(routes.map(route => route.to)).size, 7);
  for (const route of routes) {
    const def = siteDefinition(s, route.to);
    assert.equal(route.from, 'surface'); assert.equal(route.fuel, def.fuel); assert.equal(route.travel, def.travel);
    assert.ok(Number.isInteger(route.fuel) && route.fuel > 0 && route.fuel <= 7);
    assert.ok(Number.isInteger(route.travel) && route.travel > 0 && route.travel <= 50);
    assert.equal(routeDefinition(s, def.id), route); assert.equal(routeDefinition(s, route.id), route);
    assert.ok(Object.isFrozen(route));
  }
  assert.equal(routeDefinition(s, 'surface'), undefined); assert.equal(routeDefinition(s, 'toString'), undefined);
});

test('definition and kind helpers use own keys and include every actual settlement', () => {
  const s = state(), generatedIds = generated(s.region).map(def => def.id);
  assert.equal(siteDefinitions(s), s.region.sites);
  assert.equal(siteDefinitions({}), SITES); assert.equal(siteDefinition({}, 'wreck'), SITES.wreck);
  assert.equal(siteDefinition({}, 'constructor'), undefined); assert.equal(siteDefinition(s, '__proto__'), undefined);
  assert.equal(siteDefinition({ region: null }, 'wreck'), undefined);
  assert.equal(siteDefinition({ region: {} }, 'wreck'), undefined);
  assert.equal(siteKind({ id: 'wreck' }), 'wreck'); assert.equal(siteKind({ id: 'unknown' }), undefined);
  assert.equal(siteKind({ id: 'unknown', kind: 'wreck' }), 'wreck'); assert.equal(settlementSite({ id: 'comet' }), false);
  assert.equal(settlementSite({ id: 'surface' }), true);
  assert.deepEqual(outpostSiteIds(s), ['wreck', ...generatedIds]);
  delete s.sites[generatedIds[0]]; assert.deepEqual(outpostSiteIds(s), ['wreck', ...generatedIds.slice(1)]);
  assert.deepEqual(routeDefinition({}, 'wreck'), { id: 'route-wreck', from: 'surface', to: 'wreck', fuel: 2, travel: 22 });
  assert.equal(routeDefinition({ region: null }, 'wreck'), undefined);
});

test('metadata validation ignores key ordering and preserves mutable site changes', () => {
  const s = state();
  function reverse(value) { return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)])) : value; }
  s.region = reverse(s.region);
  for (const site of Object.values(s.sites)) {
    site.explored = true; site.residents = ['crew-4'];
    if (site.tiles.length) { site.tiles[0].terrain = 'floor'; site.tiles[0].building = 'stockpile'; site.tiles[0].stock = { ore: 4 }; }
  }
  const before = JSON.stringify(s); assert.doesNotThrow(() => validateRegion(s)); assert.equal(JSON.stringify(s), before);
});

const tampering = {
  schema: s => { s.region.schema = 3; }, seed: s => { s.region.seed++; }, stateSeed: s => { s.seed++; }, mode: s => { s.region.legacy = true; },
  unknown: s => { s.region.discovery = true; }, missingPlanet: s => { s.region.planets = {}; }, duplicatePlanet: s => { s.region.planets.extra = Object.values(s.region.planets)[0]; },
  planet: s => { Object.values(s.region.planets)[0].home = 'wreck'; }, duplicateDefinition: s => { s.region.sites.extra = s.region.sites.wreck; },
  definition: s => { s.region.sites.wreck.name = 'Forged'; }, map: s => { s.region.sites.wreck.map.x = Infinity; }, kind: s => { s.sites.wreck.kind = 'surface'; },
  missingKind: s => { delete s.sites.wreck.kind; }, size: s => { s.sites.wreck.size++; }, id: s => { s.sites.wreck.id = 'other'; },
  unknownSite: s => { s.sites.extra = { ...s.sites.wreck, id: 'extra' }; }, missingSite: s => { delete s.sites.solar; },
  duplicateRoute: s => { s.region.routes.extra = { ...s.region.routes['route-wreck'], id: 'extra' }; }, route: s => { s.region.routes['route-wreck'].fuel = 0; },
  survey: s => { generated(s.region)[0].survey.ore++; }, layout: s => { generated(s.region)[0].layoutSeed++; }, template: s => { generated(s.region)[0].template = 'derelict'; },
};
for (const [name, mutate] of Object.entries(tampering)) test(`region validation rejects ${name} tampering without repairing state`, () => {
  const s = structuredClone(state()); mutate(s); const before = JSON.stringify(s);
  assert.throws(() => validateRegion(s), /region/i); assert.equal(JSON.stringify(s), before);
});

test('legacy migration adds only catalog and classic kinds, preserving physical bytes and references', () => {
  const s = oldState(), before = JSON.stringify(s), sites = s.sites, tiles = s.sites.wreck.tiles, crew = s.crew, jobs = s.jobs;
  migrateRegion(s); assert.equal(s.version, 64); assert.equal(s.region.legacy, true);
  assert.deepEqual(Object.keys(s.region.sites), ['surface', 'wreck', 'comet', 'solar']); assert.deepEqual(generated(s.region), []);
  assert.equal(s.sites, sites); assert.equal(s.sites.wreck.tiles, tiles); assert.equal(s.crew, crew); assert.equal(s.jobs, jobs);
  assert.doesNotThrow(() => validateRegion(s));
  const stripped = structuredClone(s); delete stripped.region;
  for (const site of Object.values(stripped.sites)) { assert.equal(site.kind, site.id); delete site.kind; }
  assert.equal(JSON.stringify(stripped), before);
});

test('legacy migration rejects injected metadata, kinds, extra sites and invalid identity atomically', () => {
  for (const mutate of [
    s => { s.region = undefined; }, s => { s.region = makeRegion(s.seed, true); }, s => { s.sites.wreck.kind = undefined; },
    s => { s.sites.wreck.kind = 'wreck'; }, s => { s.sites.extra = { id: 'extra', size: 18 }; }, s => { delete s.sites.solar; },
    s => { s.sites.solar.id = 'wreck'; }, s => { s.sites.comet.size = 26; }, s => { s.seed = '42'; }, s => { s.version = 65; },
  ]) {
    const s = oldState(); mutate(s); const before = structuredClone(s);
    assert.throws(() => migrateRegion(s), /legacy/); assert.deepEqual(s, before);
  }
});

test('layout entry rejects unbounded or unknown inputs', () => {
  const base = generated(makeRegion(74219))[0];
  for (const def of [null, {}, { ...base, size: 10000000 }, { ...base, kind: 'surface' }, { ...base, template: 'unknown' }, { ...base, layoutSeed: 0 }, { ...base, layoutSeed: Infinity }, { ...base, layoutSeed: -1 }]) assert.throws(() => generatedLayout(def), /layout/);
});
