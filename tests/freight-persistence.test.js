import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, at, deserialize, launch, loadFreight, recall, serialize, setLabor, step, unloadFreight } from '../src/simulation.js';
import { add, extract, totalResources } from '../src/inventory.js';
import { projectPreOutpost } from './helpers/legacy-projection.js';
import {
  FREIGHT_WORK,
  assertLegacyFreightState,
  migrateFreightState,
  validateFreightState,
} from '../src/freight-persistence.js';

const surfaceTerminal = s => s.sites.surface.tiles.find(tile => tile.building === 'shuttle');
const dock = (s, siteId = 'wreck') => s.sites[siteId].tiles.find(tile => tile.building === 'dock');

function freightJob(s, overrides = {}) {
  const terminal = surfaceTerminal(s);
  return {
    id: 'job-900', site: 'surface', x: terminal.x, y: terminal.y,
    kind: 'loadCargo', building: null, cost: { alloy: 1 },
    sources: [{ x: 8, y: 10, kind: 'stock', items: { alloy: 1 } }],
    materials: {}, work: FREIGHT_WORK, remaining: FREIGHT_WORK, worker: null,
    priority: 3, blockedReason: null, missingFood: 0, foodSpoiled: 0,
    ...overrides,
  };
}

function remoteUnload(s, sources) {
  const terminal = dock(s);
  s.mission = { site: 'wreck', phase: 'working' };
  return freightJob(s, {
    site: 'wreck', x: terminal.x, y: terminal.y, kind: 'unloadCargo',
    cost: { food: 4 }, sources,
  });
}

test('schema 37 to 38 migration changes only the version', () => {
  const s = createGame(3817);
  s.version = 37;
  const before = structuredClone(s);
  assert.equal(migrateFreightState(s), true);
  assert.equal(s.version, 38);
  before.version = 38;
  assert.deepEqual(s, before);
  assert.equal(migrateFreightState(s), false);
  assert.deepEqual(s, before);
});

test('older schemas reject freight job and owner vocabulary without mutation', () => {
  for (const change of [
    s => { s.jobs = [freightJob(s)]; },
    s => {
      const terminal = surfaceTerminal(s);
      s.jobs = [freightJob(s, {
        kind: 'build', building: 'floor', work: 5, remaining: 5,
        sources: [{ x: terminal.x, y: terminal.y, kind: 'freight', items: { alloy: 1 } }],
      })];
    },
  ]) {
    const s = createGame();
    s.version = 37;
    change(s);
    const before = structuredClone(s);
    assert.throws(() => assertLegacyFreightState(s), /older save/);
    assert.deepEqual(s, before);
  }
});

test('schema 37 rejects singleton outbound rosters without changing the source state', () => {
  for (const change of [
    s => { s.departure = { crew: ['crew-0'] }; },
    s => { s.mission = { crew: ['crew-0'] }; },
  ]) {
    const s = createGame();
    s.version = 37;
    change(s);
    const before = structuredClone(s);
    assert.throws(() => assertLegacyFreightState(s), /one-person outbound roster/);
    assert.deepEqual(s, before);
  }
});

test('automatic departures stay two-person and unsupported solo destinations reject atomically', () => {
  const established = createGame(3821);
  established.outposts.wreck.established = true;
  assert.equal(launch(established, 'wreck').ok, true);
  assert.equal(established.departure.crew.length, 2);
  assert.equal(established.departure.target.food, 2);

  for (const [siteId, prepare] of [
    ['wreck', () => {}],
    ['comet', s => { s.tick = 200; }],
    ['solar', s => { s.flags.salvageReturned = true; }],
  ]) {
    const s = createGame(3822);
    prepare(s);
    const before = serialize(s);
    const result = launch(s, siteId, [s.crew[0].id]);
    assert.equal(result.ok, false, siteId);
    assert.equal(result.code, 'crew_count', siteId);
    assert.equal(serialize(s), before, siteId);
  }
});

test('schema 37 two-person departure migrates exactly and keeps the default roster', () => {
  const old = createGame(3823);
  assert.equal(launch(old, 'wreck').ok, true);
  assert.equal(old.departure.crew.length, 2);
  old.version = 37;
  const expected = structuredClone(old);
  expected.version = 38;
  const loaded = deserialize(serialize(old));
  assert.deepEqual(loaded, expected);
  assert.equal(loaded.departure.crew.length, 2);
  assert.equal(loaded.rng, old.rng);
  assert.equal(loaded.nextId, old.nextId);
  assert.deepEqual(totalResources(loaded), totalResources(old));
});

test('schema 38 established-wreck solo pickup survives every flight phase and reload', () => {
  // Synthetic history boundary: the habitat was established earlier and its
  // final resident has already left, so no fields or supplies are fabricated.
  let s = createGame(3824);
  s.outposts.wreck.established = true;
  assert.deepEqual(s.outposts.wreck.residents, []);
  const pilot = s.crew[0].id;
  assert.equal(launch(s, 'wreck', [pilot]).ok, true);
  assert.deepEqual(s.departure.crew, [pilot]);
  assert.equal(s.departure.target.food, 1);

  const observed = new Set();
  const rejectDowngrade = label => {
    const current = serialize(s), old = JSON.parse(current);
    old.version = 37;
    assert.throws(() => deserialize(JSON.stringify(old)), /one-person outbound roster/, label);
    assert.equal(serialize(s), current, `${label} source state`);
  };
  rejectDowngrade('departure');

  for (let ticks = 0; ticks < 400 && !s.mission; ticks++) {
    observed.add(`departure:${s.departure.stage}`);
    s = deserialize(serialize(s));
    step(s);
  }
  assert.ok(s.mission, `solo departure did not complete: ${s.departure?.status}`);
  assert.deepEqual(s.mission.crew, [pilot]);
  assert.deepEqual(s.mission.returnCrew, [pilot]);
  rejectDowngrade('outbound mission');

  for (let ticks = 0; ticks < 200 && s.mission?.phase === 'outbound'; ticks++) {
    observed.add(`mission:${s.mission.phase}`);
    s = deserialize(serialize(s));
    step(s);
  }
  assert.equal(s.mission?.phase, 'working');
  observed.add('mission:working');
  s = deserialize(serialize(s));
  assert.equal(recall(s).ok, true);
  observed.add(`mission:${s.mission.phase}`);

  for (let ticks = 0; ticks < 400 && s.mission; ticks++) {
    s = deserialize(serialize(s));
    observed.add(`mission:${s.mission.phase}`);
    step(s);
  }
  assert.equal(s.mission, null);
  assert.deepEqual(observed, new Set([
    'departure:loading', 'departure:boarding',
    'mission:outbound', 'mission:working', 'mission:boarding', 'mission:returning',
  ]));
  assert.equal(s.outposts.wreck.established, true);
  assert.deepEqual(s.outposts.wreck.residents, []);
  assert.equal(s.crew.find(crew => crew.id === pilot).site, 'surface');
  assert.equal(s.crew.filter(crew => crew.site === 'surface').length, 7);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('canonical surface loading and unloading validate at the physical idle craft', () => {
  const loading = createGame();
  loading.jobs = [freightJob(loading)];
  assert.doesNotThrow(() => validateFreightState(loading));

  const unloading = createGame();
  const terminal = surfaceTerminal(unloading);
  unloading.jobs = [freightJob(unloading, {
    kind: 'unloadCargo', cost: { alloy: 2 },
    sources: [{ x: terminal.x, y: terminal.y, kind: 'freight', items: { alloy: 2 } }],
  })];
  assert.doesNotThrow(() => validateFreightState(unloading));
});

test('remote unload accepts reserved freight and physical recovery or replacement sources', () => {
  const s = createGame(), terminal = dock(s);
  s.jobs = [remoteUnload(s, [
    { x: terminal.x, y: terminal.y, kind: 'freight', items: { food: 1 } },
    { x: 6, y: 11, kind: 'drop', items: { food: 1 } },
    { x: 4, y: 11, kind: 'imports', items: { food: 1 } },
    { x: 7, y: 7, kind: 'stock', items: { food: 1 } },
  ])];
  assert.doesNotThrow(() => validateFreightState(s));
});

test('malformed freight orders are rejected without normalizing the save', () => {
  const changes = [
    (s, job) => { job.extra = true; },
    (s, job) => { job.building = 'shuttle'; },
    (s, job) => { job.work = 2; },
    (s, job) => { job.remaining = 4; },
    (s, job) => { job.cost = {}; },
    (s, job) => { job.cost = { alloy: 0 }; },
    (s, job) => { job.cost = { keepsakes: .5 }; },
    (s, job) => { job.cost = { unknown: 1 }; },
    (s, job) => { job.materials = { food: 1, _food: [{ amount: 2, age: 1 }] }; },
    (s, job) => { job.site = 'wreck'; },
    (s, job) => { job.sources[0].kind = 'freight'; },
    (s, job) => { s.departure = { stage: 'loading' }; },
    (s, job) => { s.jobs.push({ ...structuredClone(job), id: 'job-901' }); },
  ];
  for (const change of changes) {
    const s = createGame(), job = freightJob(s);
    s.jobs = [job];
    change(s, job);
    const before = structuredClone(s);
    assert.throws(() => validateFreightState(s));
    assert.deepEqual(s, before);
  }
});

test('freight sources are unload-only and tied to the present terminal', () => {
  const cases = [
    s => {
      const job = freightJob(s, { kind: 'unloadCargo' });
      job.sources = [{ x: job.x + 1, y: job.y, kind: 'freight', items: { alloy: 1 } }];
      s.jobs = [job];
    },
    s => {
      const job = freightJob(s, { kind: 'build', building: 'floor', work: 5, remaining: 5 });
      job.sources = [{ x: job.x, y: job.y, kind: 'freight', items: { alloy: 1 } }];
      s.jobs = [job];
    },
    s => {
      const terminal = dock(s);
      s.jobs = [remoteUnload(s, [
        { x: terminal.x, y: terminal.y, kind: 'freight', items: { food: 4 } },
      ])];
      s.mission.phase = 'boarding';
    },
  ];
  for (const make of cases) {
    const s = createGame();
    make(s);
    const before = structuredClone(s);
    assert.throws(() => validateFreightState(s), /freight|Freight|shuttle|expedition/);
    assert.deepEqual(s, before);
  }
});

test('manifest fixtures reference real same-site coordinates without creating owners', () => {
  const s = createGame(), job = freightJob(s);
  s.jobs = [job];
  const before = structuredClone({
    resources: s.resources, freight: s.shuttle.freight,
    stock: at(s.sites.surface, 8, 10).stock, rng: s.rng, nextId: s.nextId,
  });
  validateFreightState(s);
  assert.deepEqual({
    resources: s.resources, freight: s.shuttle.freight,
    stock: at(s.sites.surface, 8, 10).stock, rng: s.rng, nextId: s.nextId,
  }, before);
});

test('integrated loader migrates a real schema 37 state without changing any other value', () => {
  const old = createGame(3837);
  old.version = 37;
  const before = structuredClone(old), resources = totalResources(old);
  const loaded = deserialize(JSON.stringify(old));
  before.version = 38;
  assert.deepEqual(loaded, before);
  assert.deepEqual(totalResources(loaded), resources);
  assert.equal(loaded.rng, old.rng);
  assert.equal(loaded.nextId, old.nextId);
  assert.deepEqual(deserialize(serialize(loaded)), loaded);
});

test('all genuine schema 36 expedition phases migrate through 37 to 38 exactly', () => {
  for (const phase of ['outbound', 'working-pile', 'working-carried', 'working-cargo', 'returning']) {
    const compressed = readFileSync(new URL(`./fixtures/outpost-pre36-${phase}.json.gz`, import.meta.url));
    const text = gunzipSync(compressed).toString('utf8'), old = JSON.parse(text);
    const loaded = deserialize(text);
    assert.equal(loaded.version, 38, phase);
    assert.deepEqual(projectPreOutpost(loaded), old, phase);
    assert.deepEqual(totalResources(loaded), totalResources(old), phase);
    assert.equal(loaded.rng, old.rng, phase);
    assert.equal(loaded.nextId, old.nextId, phase);
    assert.deepEqual(deserialize(serialize(loaded)), loaded, phase);
  }
});

test('reserved, carried, staged and loaded freight states survive the integrated loader', () => {
  const s = createGame(3888), resources = totalResources(s);
  const result = loadFreight(s, { alloy: 6 });
  assert.equal(result.ok, true);
  const states = new Set();
  for (let ticks = 0; ticks < 80 && s.jobs.some(job => job.kind === 'loadCargo'); ticks++) {
    const job = s.jobs.find(candidate => candidate.kind === 'loadCargo');
    if (job.sources.some(source => (source.items.alloy || 0) > 0)) states.add('reserved');
    if (s.crew.some(crew => crew.delivery?.job === job.id && (crew.carry?.alloy || 0) > 0)) states.add('carried');
    if ((job.materials.alloy || 0) > 0) states.add('staged');
    const copy = deserialize(serialize(s));
    assert.deepEqual(copy, s, `tick ${s.tick}`);
    step(s);
  }
  assert.equal(s.jobs.some(job => job.kind === 'loadCargo'), false);
  assert.equal(s.shuttle.freight.alloy, 6);
  assert.deepEqual(states, new Set(['reserved', 'carried', 'staged']));
  assert.equal(totalResources(s).alloy, resources.alloy);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('remote unload source, carry, staging and dock import survive integrated reloads', () => {
  const compressed = readFileSync(new URL('./fixtures/outpost-pre36-working-pile.json.gz', import.meta.url));
  const s = deserialize(gunzipSync(compressed).toString('utf8'));
  const pile = at(s.sites.wreck, 8, 10).drop;
  add(s.shuttle.freight, extract(pile, { alloy: 2 }));
  for (const id of s.mission.crew) setLabor(s, id, 'hauling', true);
  const alloy = totalResources(s).alloy;
  const result = unloadFreight(s, 'wreck', { alloy: 2 });
  assert.equal(result.ok, true);
  const states = new Set();
  for (let ticks = 0; ticks < 80 && s.jobs.some(job => job.kind === 'unloadCargo'); ticks++) {
    const job = s.jobs.find(candidate => candidate.kind === 'unloadCargo');
    if (job.sources.some(source => (source.items.alloy || 0) > 0)) states.add('reserved');
    if (s.crew.some(crew => crew.delivery?.job === job.id && (crew.carry?.alloy || 0) > 0)) states.add('carried');
    if ((job.materials.alloy || 0) > 0) states.add('staged');
    assert.deepEqual(deserialize(serialize(s)), s, `tick ${s.tick}`);
    step(s);
  }
  assert.equal(s.jobs.some(job => job.kind === 'unloadCargo'), false);
  assert.equal(s.shuttle.freight.alloy || 0, 0);
  assert.equal(dock(s).imports.alloy, 2);
  assert.deepEqual(states, new Set(['reserved', 'carried', 'staged']));
  assert.equal(totalResources(s).alloy, alloy);
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('integrated loader rejects downgraded and malformed freight without mutating live state', () => {
  const s = createGame(3899);
  assert.equal(loadFreight(s, { alloy: 2 }).ok, true);
  const saved = serialize(s);
  for (const change of [
    state => { state.version = 37; },
    state => { state.jobs[0].extra = true; },
    state => { state.jobs[0].building = 'shuttle'; },
    state => { state.jobs[0].work = 2; },
    state => { state.jobs[0].cost = { alloy: 0 }; },
    state => { state.jobs[0].sources[0].kind = 'freight'; },
    state => { state.departure = { stage: 'loading' }; },
    state => { state.jobs.push({ ...structuredClone(state.jobs[0]), id: 'job-9999' }); },
  ]) {
    const broken = JSON.parse(saved);
    change(broken);
    assert.throws(() => deserialize(JSON.stringify(broken)));
    assert.equal(serialize(s), saved);
  }
});
