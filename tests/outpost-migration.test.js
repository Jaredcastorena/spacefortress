import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createGame, deserialize, serialize, step } from '../src/simulation.js';
import { add, extract, totalResources, syncResources } from '../src/inventory.js';
import { validateShuttle } from '../src/expedition.js';
import { initializeOutpostState, assertLegacyOutpostState, migrateOutpostState, validateOutpostState } from '../src/outpost-persistence.js';

const phases = ['outbound', 'working-pile', 'working-carried', 'working-cargo', 'returning'];
const files = [
  ...phases.map(phase => `outpost-pre36-${phase}.json.gz`),
  ...['loading', 'boarding', 'outbound', 'returning'].map(phase => `expedition-schema36-${phase}.json.gz`),
];
const fixture = name => gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString('utf8');
const legacy = phase => JSON.parse(fixture(`outpost-pre36-${phase}.json.gz`));
const dock = (s, site = 'wreck') => s.sites[site].tiles.find(tile => tile.building === 'dock');
const allDocks = s => Object.values(s.sites).flatMap(site => site.tiles.filter(tile => tile.building === 'dock'));
const validate = s => { validateOutpostState(s); validateShuttle(s); };
function migrated(phase = 'working-cargo') {
  const s = legacy(phase); assert.equal(migrateOutpostState(s), true); return s;
}
function legacyProjection(s) {
  const projected = structuredClone(s);
  projected.version = 36; delete projected.outposts; delete projected.shuttle.freight;
  if (projected.mission) delete projected.mission.returnCrew;
  for (const site of Object.values(projected.sites)) for (const tile of site.tiles) delete tile.imports;
  return projected;
}

test('genuine schema36 snapshots migrate with exact old ownership, mission, RNG and fixture hashes', () => {
  const provenance = JSON.parse(readFileSync(new URL('./fixtures/outpost-pre36-provenance.json', import.meta.url), 'utf8'));
  for (const row of provenance.snapshots) {
    const compressed = readFileSync(new URL(`./fixtures/outpost-pre36-${row.phase}.json.gz`, import.meta.url));
    assert.equal(createHash('sha256').update(compressed).digest('hex'), row.sha256Compressed);
    assert.equal(createHash('sha256').update(gunzipSync(compressed)).digest('hex'), row.sha256Uncompressed);
  }
  for (const file of files) {
    const text = fixture(file), before = JSON.parse(text), s = JSON.parse(text);
    assert.equal(before.version, 36);
    assert.equal(migrateOutpostState(s), true); assert.equal(s.version, 37);
    assert.deepEqual(legacyProjection(s), before, file);
    assert.equal(JSON.stringify(legacyProjection(s)), text, `${file}: original serialized field order`);
    assert.deepEqual(totalResources(s), totalResources(before));
    assert.equal(s.rng, before.rng); assert.equal(s.nextId, before.nextId);
    assert.deepEqual(s.outposts, { wreck: { established: false, residents: [] } });
    assert.deepEqual(s.shuttle.freight, {});
    assert.equal(allDocks(s).length, 3);
    for (const tile of allDocks(s)) assert.deepEqual(tile.imports, {});
    if (s.mission) {
      assert.deepEqual(s.mission.returnCrew, before.mission.crew);
      assert.notEqual(s.mission.returnCrew, s.mission.crew);
    }
    validate(s);
  }
});

test('fresh initialization creates independent empty owners without spending or granting stock', () => {
  const s = createGame(37041), before = totalResources(s), rng = s.rng;
  initializeOutpostState(s);
  assert.deepEqual(s.outposts, { wreck: { established: false, residents: [] } });
  const owners = [s.shuttle.freight, ...allDocks(s).map(tile => tile.imports)];
  assert.equal(new Set(owners).size, 4);
  assert.ok(owners.every(owner => Object.keys(owner).length === 0));
  assert.deepEqual(totalResources(s), before); assert.equal(s.rng, rng);
  const snapshot = structuredClone(s);
  initializeOutpostState(s); assert.deepEqual(s, snapshot);
  validate(s);
});

test('legacy migration rejects smuggled state atomically before replacing any owner', () => {
  const corruptions = [
    s => { s.outposts = { wreck: { established: true, residents: [] } }; },
    s => { s.outposts = { wreck: { established: false, residents: ['crew-4'] } }; },
    s => { s.outposts = { wreck: { established: false, residents: [] }, comet: {} }; },
    s => { s.shuttle.freight = { alloy: 1 }; },
    s => { s.shuttle.freight = []; },
    s => { s.shuttle.freight = null; },
    s => { s.shuttle.freight = new Date(0); },
    s => { s.shuttle.freight = new Map([['alloy', 1]]); },
    s => { s.mission.returnCrew = [...s.mission.crew]; },
    s => { s.mission.returnCrew = 'crew-4'; },
    s => { s.mission.returnCrew = Object.assign([], { passenger: 'crew-4' }); },
    s => { dock(s).imports = { food: 1 }; },
    s => { dock(s).imports = null; },
    s => { s.sites.surface.tiles[0].imports = {}; },
  ];
  for (const corrupt of corruptions) {
    const s = legacy('working-cargo'); corrupt(s); const before = structuredClone(s);
    assert.throws(() => migrateOutpostState(s), /older save/);
    assert.deepEqual(s, before);
  }
});

test('canonical predeclared empty legacy owners normalize without sharing inventory or roster references', () => {
  const s = legacy('working-carried'), before = structuredClone(s), shared = {};
  s.outposts = { wreck: { established: false, residents: [] } };
  s.shuttle.freight = shared;
  for (const tile of allDocks(s)) tile.imports = shared;
  s.mission.returnCrew = [];
  assert.equal(migrateOutpostState(s), true);
  assert.deepEqual(legacyProjection(s), before);
  assert.equal(new Set([s.shuttle.freight, ...allDocks(s).map(tile => tile.imports)]).size, 4);
  assert.notEqual(s.mission.returnCrew, s.mission.crew);
  validate(s);
});

test('early legacy guards reject new ownership before old initializers can erase it', () => {
  const oldest = legacy('outbound'); oldest.version = 1; delete oldest.shuttle;
  assert.doesNotThrow(() => assertLegacyOutpostState(oldest), 'schema1 predates shuttle ownership');
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 35, 36]) {
    for (const change of [s => { s.shuttle.freight = { water: 13 }; },
      s => { dock(s).imports = { food: 1 }; },
      s => { s.outposts = { wreck: { established: true, residents: [] } }; },
      s => { s.mission.returnCrew = [...s.mission.crew]; }]) {
      const s = legacy('outbound'); s.version = version; change(s);
      const before = structuredClone(s);
      assert.throws(() => assertLegacyOutpostState(s), /older save/);
      assert.throws(() => deserialize(serialize(s)), /older save/);
      assert.deepEqual(s, before);
    }
  }
});

test('current schema migration is a no-op and repeated validation preserves the whole state', () => {
  const s = migrated(), before = structuredClone(s);
  for (let i = 0; i < 10; i++) { assert.equal(migrateOutpostState(s), false); validate(s); }
  assert.deepEqual(s, before);
  delete s.outposts; const malformed = structuredClone(s);
  assert.equal(migrateOutpostState(s), false);
  assert.throws(() => validate(s), /outpost registry/);
  assert.deepEqual(s, malformed, 'current saves must not be normalized or repaired');
});

test('resident validation rejects unknown, duplicate and malformed memberships without pruning valid history', () => {
  for (const value of [null, [], {}, { wreck: null }, { wreck: { established: 1, residents: [] } },
    { wreck: { established: false, residents: ['crew-4'] } },
    { wreck: { established: true, residents: ['crew-99'] } },
    { wreck: { established: true, residents: ['crew-4', 'crew-4'] } },
    { wreck: { established: true, residents: [], hidden: true } },
    { wreck: { established: true, residents: [] }, comet: { established: false, residents: [] } }]) {
    const s = migrated(); s.outposts = value; const before = structuredClone(s);
    assert.throws(() => validate(s)); assert.deepEqual(s, before);
  }
  const s = migrated(); s.outposts.wreck = { established: true, residents: ['crew-0', 'crew-4'] };
  s.crew.find(c => c.id === 'crew-0').health = 0;
  validate(s);
  assert.deepEqual(s.outposts.wreck.residents, ['crew-0', 'crew-4'], 'death/location are separate from residence history');
});

test('freight and dock inventories reject malformed resources, counts and metadata', () => {
  const values = [null, [], new Date(0), new Map([['food', 1]]), { unknown: 1 }, { water: -1 }, { water: Infinity }, { water: NaN },
    { water: '1' }, { water: Number.MAX_VALUE, alloy: Number.MAX_VALUE },
    { food: 1, _food: [{ amount: 2, age: 1 }] }, { food: 1, _food: [{ amount: 1, age: 3600 }] },
    { keepsakes: .5 }, { keepsakes: 1 }, { _items: [] }, { _food: [] },
    { _food: undefined }, { _items: undefined }, { food: 1, _food: new Array(1) }, { keepsakes: 1, _items: new Array(1) }];
  for (const target of ['freight', 'imports']) for (const value of values) {
    const s = migrated();
    if (target === 'freight') s.shuttle.freight = value; else dock(s).imports = value;
    const before = structuredClone(s);
    assert.throws(() => validate(s), `${target}: ${JSON.stringify(value)}`);
    assert.deepEqual(s, before);
  }
  const missingDock = migrated(); dock(missingDock).building = null;
  assert.throws(() => validate(missingDock), /missing dock/);
});

test('new owner aliases with existing inventories, metadata and other dock owners are rejected', () => {
  const cases = [
    s => { s.shuttle.freight = s.shuttle.supplies; },
    s => { dock(s).imports = s.sites.surface.tiles.find(t => t.stock).stock; },
    s => { dock(s, 'comet').imports = dock(s).imports; },
    s => { dock(s).imports = s.shuttle.freight; },
    s => {
      const lots = [{ amount: 1, age: 100 }];
      s.shuttle.freight = { food: 1, _food: lots }; dock(s).imports = { food: 1, _food: lots };
    },
    s => {
      const lots = [{ amount: 1, age: 100 }];
      s.shuttle.freight = { food: 1, _food: [lots[0]] }; dock(s).imports = { food: 1, _food: [lots[0]] };
    },
    s => {
      const lot = { amount: 1, age: 100 };
      s.mission.cargo = { food: 1, _food: [lot] }; dock(s).imports = { food: 1, _food: [lot] };
    },
    s => { s.mission.returnCrew = s.mission.crew; },
    s => { s.outposts.wreck.established = true; s.outposts.wreck.residents = s.mission.returnCrew; },
  ];
  for (const change of cases) { const s = migrated(); change(s); assert.throws(() => validate(s), /alias|shared|ownership|independent arrays/); }
});

test('return rosters reject unknown, duplicate, empty, impossible and silently abandoned members', () => {
  for (const ids of [undefined, null, [], ['crew-4', 'crew-4'], ['crew-99'], ['crew-4', 'crew-2', 'crew-0'], ['crew-0'], ['crew-4']]) {
    const s = migrated(); s.mission.returnCrew = ids;
    assert.throws(() => validate(s));
  }
  const outbound = migrated('outbound'); outbound.mission.returnCrew.reverse();
  assert.throws(() => validate(outbound), /return|outbound/i);
  const staying = migrated();
  staying.outposts.wreck = { established: true, residents: ['crew-2'] };
  staying.mission.returnCrew = ['crew-4']; validate(staying);
  const dead = migrated(); for (const c of dead.crew) if (dead.mission.crew.includes(c.id)) c.health = 0;
  validate(dead); assert.deepEqual(dead.mission.returnCrew, dead.mission.crew, 'all-dead fallback retains named ownership');
});

test('freight and imports cannot alias opened medical or self-served meal inventories or their lots', () => {
  for (const target of ['medical', 'intent']) for (const owner of ['freight', 'imports']) for (const nested of [false, true]) {
    const s = migrated(), food = { food: 1, _food: [{ amount: 1, age: 100 }] };
    const crew = s.crew.find(c => c.id === 'crew-0');
    if (target === 'intent') crew.intent = { type: 'meal', target: null };
    Object.assign(crew[target], { servings: 8, foodAge: 100, qualityTotal: 0, openedFood: food });
    const shipment = nested ? { food: 1, _food: [...food._food] } : food;
    if (owner === 'freight') s.shuttle.freight = shipment; else dock(s).imports = shipment;
    assert.throws(() => validate(s), /share physical ownership/, `${target}/${owner}/${nested}`);
  }
});

test('integrated loader migrates genuine schema36 states exactly and roundtrips current37', () => {
  for (const file of files) {
    const text = fixture(file), old = JSON.parse(text), loaded = deserialize(text);
    assert.equal(loaded.version, 37);
    assert.deepEqual(legacyProjection(loaded), old, file);
    assert.deepEqual(totalResources(loaded), totalResources(old));
    assert.equal(loaded.rng, old.rng);
    assert.deepEqual(deserialize(serialize(loaded)), loaded);
  }
});

test('integrated loader rejects missing current37 fields rather than silently granting defaults', () => {
  for (const remove of [s => { delete s.outposts; }, s => { delete s.shuttle.freight; },
    s => { delete dock(s).imports; }, s => { delete s.mission.returnCrew; }]) {
    const s = migrated(); remove(s); const text = serialize(s);
    assert.throws(() => deserialize(text)); assert.equal(serialize(s), text);
  }
});

test('integrated finite freight and imports preserve supplied food ages through save and tick continuation', () => {
  const s = deserialize(fixture('outpost-pre36-working-cargo.json.gz'));
  assert.equal(s.version, 37);
  const stock = s.sites.surface.tiles.find(t => t.stock?.food >= 2 && t.stock?.alloy >= 2).stock;
  const before = totalResources(s);
  add(s.shuttle.freight, extract(stock, { food: 1, alloy: 1 }));
  add(dock(s).imports, extract(stock, { food: 1, alloy: 1 }));
  syncResources(s);
  assert.deepEqual(totalResources(s), before, 'test setup transfers existing stock without grants');
  const copy = deserialize(serialize(s)); assert.deepEqual(copy, s);
  step(s, 8); step(copy, 8);
  assert.deepEqual(copy, s); assert.deepEqual(deserialize(serialize(s)), s);
  assert.ok(s.shuttle.freight._food?.[0]?.age > 0);
  assert.ok(dock(s).imports._food?.[0]?.age > 0);
});
