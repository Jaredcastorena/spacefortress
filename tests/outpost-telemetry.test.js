import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, serialize, deserialize } from '../src/simulation.js';
import { add, extract, syncResources } from '../src/inventory.js';
import { observe, startRecording, exportRecording, changesBetween, systemFor } from '../src/telemetry.js';
import { defaultOutposts, defaultDockImports, shuttlePresence } from '../src/outposts.js';

function fixture() {
  const s = createGame();
  s.outposts ??= defaultOutposts();
  s.shuttle.freight ??= {};
  for (const site of Object.values(s.sites)) for (const tile of site.tiles) {
    if (tile.building === 'dock') tile.imports ??= defaultDockImports();
  }
  return s;
}
const dock = s => s.sites.wreck.tiles.find(tile => tile.building === 'dock');
const dockId = s => `tile:wreck:${dock(s).x}:${dock(s).y}`;
const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function reconstruct(recording) {
  const result = structuredClone(recording[0].observation);
  for (const record of recording.slice(1, -1)) {
    for (const change of record.changes || []) {
      if (!change.path.length) {
        if (change.op === 'remove') delete result.entities[change.entity];
        else result.entities[change.entity] = structuredClone(change.value);
        continue;
      }
      let target = result.entities[change.entity];
      for (const key of change.path.slice(0, -1)) target = target[key];
      const key = change.path.at(-1);
      if (change.op === 'remove') delete target[key];
      else target[key] = structuredClone(change.value);
    }
    if (record.fromTick !== undefined) result.tick = record.tick;
  }
  return result;
}
function payload(s) {
  const meal = { id: `meal-job-${s.nextId++}`, maker: 'crew-0', quality: 3, created: s.tick };
  const item = { id: `item-${s.nextItemId++}`, maker: 'crew-0', style: 'art', quality: 2, created: s.tick };
  return { food: 2, keepsakes: 1, _food: [{ amount: 2, age: 123, meal }], _items: [item] };
}
function mission(s, phase = 'working') {
  s.mission = { site: 'wreck', phase, remaining: 0, crew: ['crew-2', 'crew-4'], returnCrew: ['crew-4'], cargo: {}, fit: 'standard', capacity: 18, legacyCapacity: false };
  for (const id of s.mission.crew) Object.assign(s.crew.find(c => c.id === id), { site: 'wreck', x: dock(s).x, y: dock(s).y });
  s.outposts.wreck = { established: true, residents: ['crew-2'] };
}

test('residence, arrival team, return roster and physical shuttle are separate detached observations', () => {
  const s = fixture(); mission(s);
  const o = observe(s), colony = o.entities.colony;
  assert.deepEqual(colony.outposts, { wreck: { established: true, residents: ['crew-2'] } });
  assert.deepEqual(colony.derived.expedition.selectedCrewIds, ['crew-2', 'crew-4']);
  assert.deepEqual(colony.derived.expedition.returnCrewIds, ['crew-4']);
  assert.deepEqual(colony.mission.returnCrew, ['crew-4']);
  assert.deepEqual(o.entities['site:wreck'].derived.outpost, s.outposts.wreck);
  assert.equal(o.entities['site:surface'].derived.outpost, null);
  assert.equal(o.entities['crew-2'].derived.residence, 'site:wreck');
  assert.equal(o.entities['crew-2'].derived.expedition.selected, true);
  assert.equal(o.entities['crew-2'].derived.expedition.selectedForReturn, false);
  assert.equal(o.entities['crew-4'].derived.expedition.selectedForReturn, true);
  assert.equal(o.entities['crew-4'].derived.residence, null);
  assert.equal(colony.derived.shuttle.location, 'wreck');
  o.entities['site:wreck'].derived.outpost.residents.length = 0;
  colony.outposts.wreck.established = false;
  colony.derived.expedition.returnCrewIds.push('crew-0');
  assert.deepEqual(s.outposts.wreck, { established: true, residents: ['crew-2'] });
  assert.deepEqual(s.mission.returnCrew, ['crew-4']);
});

test('shuttle observations follow committed mission phases and damaged terminals rather than visible docks', () => {
  const s = fixture();
  for (const [phase, location] of [[null, 'surface'], ['outbound', 'transit'], ['working', 'wreck'], ['boarding', 'wreck'], ['returning', 'transit']]) {
    if (phase) mission(s, phase); else s.mission = null;
    const o = observe(s);
    assert.equal(o.entities.colony.derived.shuttle.location, location);
    for (const site of Object.keys(s.sites)) assert.deepEqual(o.entities[`site:${site}`].derived.shuttle, shuttlePresence(s, site));
    assert.equal(o.entities['site:wreck'].derived.shuttle.present, location === 'wreck');
    assert.equal(o.entities['site:surface'].derived.shuttle.present, location === 'surface');
  }
  mission(s); dock(s).hp = 0;
  const status = observe(s).entities['site:wreck'].derived.shuttle;
  assert.equal(status.present, true);
  assert.equal(status.usable, false);
  assert.equal(status.blocked, 'terminal_destroyed');
  assert.equal(status.terminal.entity, dockId(s));
});

test('frozen observations preserve new owners, batch identity, item identity, RNG and allocation counters', () => {
  const s = fixture(), cargo = payload(s), itemId = cargo._items[0].id, mealId = cargo._food[0].meal.id;
  add(s.shuttle.freight, cargo);
  add(dock(s).imports, extract(s.shuttle.freight, { food: .5, keepsakes: 1 }));
  s.crew[0].medical.openedFood = extract(s.shuttle.freight, { food: .25 });
  const before = structuredClone(s); freeze(s);
  for (let i = 0; i < 3; i++) {
    const o = observe(s), batch = o.entities[mealId];
    assert.equal(Object.values(o.entities).filter(e => e.type === 'item' && e.id === itemId).length, 1);
    assert.deepEqual(o.entities[itemId].location, { entity: dockId(s), slot: 'imports' });
    assert.equal(Object.values(o.entities).filter(e => e.type === 'meal_batch' && e.id === mealId).length, 1);
    assert.equal(batch.food, 2);
    assert.equal(batch.locations.length, 3);
    assert.ok(batch.locations.some(p => p.entity === 'colony' && p.slot === 'shuttle.freight' && p.amount === 1.25));
    assert.ok(batch.locations.some(p => p.entity === dockId(s) && p.slot === 'imports' && p.amount === .5));
    assert.ok(batch.locations.some(p => p.entity === 'crew-0' && p.slot === 'medical.openedFood' && p.amount === .25));
    o.entities.colony.shuttle.freight._food[0].age = 0;
    o.entities[dockId(s)].imports._items[0].quality = 99;
    batch.locations.length = 0;
    assert.deepEqual(s, before);
  }
});

test('inventory-owner, outpost and return-roster deltas reconstruct without mislabeling external transfers as player actions', () => {
  const s = fixture(), cargo = payload(s), itemId = cargo._items[0].id, mealId = cargo._food[0].meal.id;
  add(s.shuttle.freight, cargo); startRecording(s);
  add(dock(s).imports, extract(s.shuttle.freight, { food: .75, keepsakes: 1 })); rows(s);
  mission(s); rows(s);
  add(s.shuttle.freight, extract(dock(s).imports, { food: .75, keepsakes: 1 }));
  const recording = rows(s), changes = recording.flatMap(row => row.changes || []);
  assert.deepEqual(reconstruct(recording), observe(s));
  assert.ok(changes.some(c => c.entity === 'colony' && c.path[0] === 'outposts' && c.system === 'outposts'));
  assert.ok(changes.some(c => c.entity === 'colony' && c.path[0] === 'shuttle' && c.path[1] === 'freight' && c.system === 'inventory'));
  assert.ok(changes.some(c => c.entity === dockId(s) && c.path[0] === 'imports' && c.system === 'inventory'));
  assert.ok(changes.some(c => c.entity === itemId && c.path[0] === 'location' && c.system === 'possessions'));
  assert.ok(changes.some(c => c.entity === mealId && c.path[0] === 'locations' && c.system === 'food'));
  assert.ok(recording.slice(1, -1).every(row => row.kind === 'external' && row.command === null));
  assert.equal(systemFor('colony', ['mission', 'returnCrew']), 'expedition');
  assert.equal(systemFor('site', ['derived', 'shuttle', 'present']), 'derived_conditions');
});

test('recording with freight and remote imports leaves deterministic simulation and saves unchanged', () => {
  const a = fixture(), cargo = payload(a);
  add(a.shuttle.freight, cargo);
  add(dock(a).imports, extract(a.shuttle.freight, { food: .5, keepsakes: 1 }));
  syncResources(a);
  const b = deserialize(serialize(a));
  startRecording(a); step(a, 12); step(b, 12);
  assert.deepEqual(a, b);
  assert.equal(serialize(a), serialize(b));
  assert.deepEqual(reconstruct(rows(a)), observe(a));
});

test('observing legacy state uses detached fallbacks without migrating or inferring residence', () => {
  const s = fixture(); mission(s); s.version = 36;
  delete s.outposts; delete s.shuttle.freight; delete s.mission.returnCrew;
  for (const site of Object.values(s.sites)) for (const tile of site.tiles) delete tile.imports;
  const before = structuredClone(s); freeze(s);
  const o = observe(s);
  assert.deepEqual(o.entities.colony.derived.expedition.returnCrewIds, ['crew-2', 'crew-4']);
  assert.deepEqual(o.entities['site:wreck'].derived.outpost, { established: false, residents: [] });
  assert.equal(o.entities['crew-2'].derived.residence, null);
  assert.equal(Object.hasOwn(o.entities.colony, 'outposts'), false);
  assert.equal(Object.hasOwn(o.entities.colony.shuttle, 'freight'), false);
  assert.equal(Object.hasOwn(o.entities[dockId(s)], 'imports'), false);
  assert.deepEqual(changesBetween(observe(s), observe(s)), []);
  assert.deepEqual(s, before);
});
