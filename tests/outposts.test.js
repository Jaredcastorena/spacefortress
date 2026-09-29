import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at } from '../src/simulation.js';
import {
  OUTPOST_SITES, defaultOutposts, defaultDockImports, normalizeResidents,
  validateOutposts, residentIds, residentSite, isResident, dockImports,
  validateDockImports, shuttleLocation, shuttlePresence,
} from '../src/outposts.js';

function fixture() {
  const s = createGame();
  s.outposts = defaultOutposts();
  for (const site of Object.values(s.sites)) for (const tile of site.tiles) if (tile.building === 'dock') tile.imports = defaultDockImports();
  return s;
}
const mission = (s, phase, site = 'wreck') => { s.mission = { site, phase, remaining: 0 }; };

test('default outposts and each dock inventory are fresh independent empty owners', () => {
  const a = defaultOutposts(), b = defaultOutposts(), first = defaultDockImports(), second = defaultDockImports();
  assert.deepEqual(a, { wreck: { established: false, residents: [] } });
  a.wreck.residents.push('crew-2'); a.wreck.established = true; first.air = 8;
  assert.deepEqual(b, { wreck: { established: false, residents: [] } });
  assert.deepEqual(second, {}); assert.deepEqual(OUTPOST_SITES, ['wreck']);
  assert.ok(Object.isFrozen(OUTPOST_SITES));
  const s = fixture(); validateOutposts(s); validateDockImports(s);
  assert.notEqual(at(s.sites.wreck, 4, 11).imports, at(s.sites.comet, 5, 10).imports);
});

test('resident normalization preserves ordered known IDs and never changes the source', () => {
  const s = fixture(), ids = ['crew-4', 'crew-2'], before = structuredClone(s);
  const normalized = normalizeResidents(s, ids);
  assert.deepEqual(normalized, ids); assert.notEqual(normalized, ids);
  normalized.reverse(); assert.deepEqual(ids, ['crew-4', 'crew-2']); assert.deepEqual(s, before);
  for (const invalid of [null, {}, 'crew-2', ['unknown'], ['crew-2', 'crew-2'], [2], [null]]) {
    assert.throws(() => normalizeResidents(s, invalid)); assert.deepEqual(s, before);
  }
});

test('residence is independent of physical site, health, mission and presence observations', () => {
  const s = fixture(); s.outposts.wreck = { established: true, residents: ['crew-2', 'crew-4'] };
  s.crew[2].site = 'surface'; s.crew[4].site = 'transit'; s.crew[4].health = 0;
  const before = structuredClone(s); validateOutposts(s);
  assert.equal(residentSite(s, 'crew-2'), 'wreck'); assert.equal(isResident(s, 'crew-4', 'wreck'), true);
  assert.equal(isResident(s, 'crew-2', 'comet'), false); assert.equal(residentSite(s, 'crew-0'), null);
  const ids = residentIds(s); ids.pop(); assert.deepEqual(s.outposts.wreck.residents, ['crew-2', 'crew-4']);
  assert.deepEqual(s, before);
  assert.throws(() => residentSite(s, 'unknown')); assert.throws(() => residentIds(s, 'comet'));
  assert.throws(() => isResident(s, 'crew-2', 'unknown'));
});

test('outpost validators reject missing, unknown, duplicate and unestablished resident state', () => {
  for (const change of [
    s => delete s.outposts, s => { s.outposts = null; },
    s => { s.outposts.comet = { established: false, residents: [] }; },
    s => { s.outposts.wreck.established = 1; }, s => { s.outposts.wreck.residents = null; },
    s => { s.outposts.wreck.extra = true; }, s => { s.outposts.wreck.residents = ['crew-2']; },
    s => { s.outposts.wreck = { established: true, residents: ['unknown'] }; },
    s => { s.outposts.wreck = { established: true, residents: ['crew-2', 'crew-2'] }; },
    s => { s.crew[1].id = s.crew[0].id; },
  ]) { const s = fixture(); change(s); const before = structuredClone(s); assert.throws(() => validateOutposts(s)); assert.deepEqual(s, before); }
});

test('resident validation rejects sparse and decorated arrays that cannot round-trip as a roster', () => {
  const s = fixture();
  for (const residents of [Array(1), Object.assign(['crew-2'], { selected: true })]) {
    s.outposts.wreck = { established: true, residents };
    const before = structuredClone(s);
    assert.throws(() => normalizeResidents(s, residents));
    assert.throws(() => residentIds(s));
    assert.deepEqual(s, before);
  }
});

test('legacy observation returns no residence or imports without silently migrating state', () => {
  const s = createGame(); delete s.outposts; const dock = at(s.sites.wreck, 4, 11); delete dock.imports;
  const before = structuredClone(s);
  assert.deepEqual(residentIds(s), []); assert.equal(residentSite(s, 'crew-0'), null);
  assert.deepEqual(dockImports(dock), {}); assert.equal(dockImports(at(s.sites.surface, 16, 11)), null);
  assert.deepEqual(s, before); assert.throws(() => validateOutposts(s)); assert.throws(() => validateDockImports(s));
});

test('dock import observations deeply preserve food and item metadata without sharing ownership', () => {
  const s = fixture(), dock = at(s.sites.wreck, 4, 11);
  dock.imports = {
    alloy: 3, food: 2, _food: [{ amount: 2, age: 13, meal: { id: 'meal-job-9', maker: 'crew-3', quality: 3, created: 0 } }],
    keepsakes: 1, _items: [{ id: 'item-1', maker: 'crew-3', style: 'art', quality: 2, created: 0 }],
  };
  const before = structuredClone(s); validateDockImports(s);
  const observation = dockImports(dock); assert.deepEqual(observation, dock.imports);
  observation.alloy = 0; observation._food[0].meal.quality = 1; observation._items[0].id = 'item-2';
  assert.deepEqual(s, before);
});

test('dock inventories reject invalid resources, quantities, metadata and wrong owners', () => {
  for (const imports of [null, [], { imaginary: 1 }, { alloy: -1 }, { water: Infinity },
    { food: 1, _food: [{ amount: 2, age: 1 }] }, { keepsakes: 1 }, { keepsakes: .5 },
    { keepsakes: 2, _items: Array.from({ length: 2 }, () => ({ id: 'item-1', maker: 'crew-0', style: 'art', quality: 1, created: 0 })) },
  ]) {
    const s = fixture(), dock = at(s.sites.wreck, 4, 11); dock.imports = imports;
    assert.throws(() => validateDockImports(s)); assert.throws(() => dockImports(dock));
  }
  const wrong = fixture(); at(wrong.sites.surface, 16, 11).imports = {}; assert.throws(() => validateDockImports(wrong));
  const shared = fixture(); at(shared.sites.comet, 5, 10).imports = at(shared.sites.wreck, 4, 11).imports;
  assert.throws(() => validateDockImports(shared));
});

test('dock imports reject overflow and metadata that cannot round-trip through a save', () => {
  for (const imports of [
    new Date(0), { alloy: Number.MAX_VALUE, water: Number.MAX_VALUE },
    { food: 1, _food: Array(1) }, { keepsakes: 1, _items: Array(1) },
    { food: 1, _food: [{ amount: 1, age: 1, meal: undefined }] },
    { _food: undefined }, { _items: undefined },
    { food: 1, _food: Object.assign([{ amount: 1, age: 1 }], { chosen: 0 }) },
  ]) {
    const s = fixture(), dock = at(s.sites.wreck, 4, 11); dock.imports = imports;
    const before = structuredClone(s);
    assert.throws(() => validateDockImports(s)); assert.throws(() => dockImports(dock));
    assert.deepEqual(s, before);
  }
});

test('shuttle remains physically surface during loading and preparation boarding', () => {
  const s = fixture(); const before = structuredClone(s);
  assert.equal(shuttleLocation(s), 'surface'); assert.equal(shuttlePresence(s, 'surface').usable, true);
  assert.equal(shuttlePresence(s, 'wreck').present, false); assert.equal(shuttlePresence(s, 'wreck').blocked, 'shuttle_elsewhere');
  assert.deepEqual(s, before);
  for (const stage of ['loading', 'boarding']) {
    s.departure = { site: 'wreck', stage }; const snapshot = structuredClone(s);
    assert.equal(shuttleLocation(s), 'surface'); assert.equal(shuttlePresence(s, 'wreck').present, false);
    assert.deepEqual(s, snapshot);
  }
});

test('shuttle mission phase determines location even at zero remaining travel time', () => {
  for (const site of ['wreck', 'comet', 'solar']) for (const phase of ['outbound', 'working', 'boarding', 'returning']) {
    const s = fixture(); mission(s, phase, site); const before = structuredClone(s);
    const transit = ['outbound', 'returning'].includes(phase);
    assert.equal(shuttleLocation(s), transit ? 'transit' : site);
    assert.equal(shuttlePresence(s, site).present, !transit);
    assert.equal(shuttlePresence(s, 'surface').present, false);
    assert.equal(shuttlePresence(s, 'surface').blocked, transit ? 'shuttle_in_transit' : 'shuttle_elsewhere');
    assert.deepEqual(s, before);
  }
});

test('destroyed or missing dock blocks access without relocating a present shuttle', () => {
  const s = fixture(); mission(s, 'working'); const dock = at(s.sites.wreck, 4, 11); dock.hp = 0;
  const damaged = shuttlePresence(s, 'wreck');
  assert.equal(damaged.present, true); assert.equal(damaged.usable, false); assert.equal(damaged.blocked, 'terminal_destroyed');
  assert.equal(damaged.terminal.entity, 'tile:wreck:4:11'); damaged.terminal.condition = 100; assert.equal(dock.hp, 0);
  dock.building = null; const missing = shuttlePresence(s, 'wreck');
  assert.equal(shuttleLocation(s), 'wreck'); assert.equal(missing.present, true); assert.equal(missing.usable, false);
  assert.equal(missing.blocked, 'terminal_missing'); assert.equal(missing.terminal, null);
});

test('surface terminal damage and removal do not move the idle shuttle', () => {
  const s = fixture(), terminal = s.sites.surface.tiles.find(tile => tile.building === 'shuttle');
  terminal.hp = 1;
  assert.equal(shuttlePresence(s, 'surface').usable, true);
  terminal.hp = 0;
  assert.equal(shuttlePresence(s, 'surface').blocked, 'terminal_destroyed');
  terminal.building = null;
  const before = structuredClone(s), info = shuttlePresence(s, 'surface');
  assert.equal(info.location, 'surface'); assert.equal(info.present, true);
  assert.equal(info.usable, false); assert.equal(info.blocked, 'terminal_missing');
  assert.deepEqual(s, before);
});

test('terminal selection prefers a usable berth without sorting or changing map tiles', () => {
  const s = fixture(); mission(s, 'boarding');
  const site = s.sites.wreck, original = at(site, 4, 11);
  original.hp = 0;
  const alternate = at(site, 5, 11); alternate.building = 'dock'; alternate.hp = 42;
  const earlier = at(site, 3, 11); earlier.building = 'dock'; earlier.hp = 9;
  const before = structuredClone(s), info = shuttlePresence(s, 'wreck');
  assert.equal(info.terminal.entity, 'tile:wreck:3:11'); assert.equal(info.usable, true);
  assert.equal(info.phase, 'boarding'); assert.deepEqual(s, before);
  earlier.hp = 0; alternate.hp = 0;
  assert.equal(shuttlePresence(s, 'wreck').terminal.entity, 'tile:wreck:3:11');
  assert.equal(shuttlePresence(s, 'wreck').blocked, 'terminal_destroyed');
});

test('malformed terminal condition rejects instead of reporting an unusable berth without a reason', () => {
  for (const hp of [undefined, null, NaN, Infinity, -1, 101, '100']) {
    const s = fixture(); at(s.sites.wreck, 4, 11).hp = hp; mission(s, 'working');
    const before = structuredClone(s);
    assert.throws(() => shuttlePresence(s, 'wreck'), /Invalid shuttle terminal/);
    assert.deepEqual(s, before);
  }
});

test('shuttle observations reject invalid mission/site data without mutating it', () => {
  for (const value of [false, 'working', {}, { site: 'wreck', phase: 'landed' }, { site: 'unknown', phase: 'working' }, { site: 'surface', phase: 'outbound' }]) {
    const s = fixture(); s.mission = value; const before = structuredClone(s);
    assert.throws(() => shuttleLocation(s)); assert.deepEqual(s, before);
  }
  assert.throws(() => shuttlePresence(fixture(), 'unknown'));
  assert.throws(() => shuttlePresence(fixture(), 'transit'));
});
