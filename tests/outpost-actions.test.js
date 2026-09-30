import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { actionCatalog, executeAction, controlBindings, createAgentInterface } from '../src/controls.js';
import { observe, startRecording, exportRecording, recordingStatus, habitatSnapshot, recordHabitatChanges } from '../src/telemetry.js';
import { RESOURCES } from '../src/data.js';
import { quantity } from '../src/inventory.js';
import { outpostReadiness } from '../src/outpost-readiness.js';
import { freightStatus } from '../src/freight.js';

const records = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const field = () => deserialize(gunzipSync(readFileSync(new URL('./fixtures/outpost-pre36-working-pile.json.gz', import.meta.url))).toString('utf8'));
const act = (s, id, args = {}, source = 'test') => {
  const result = executeAction(s, id, args, source);
  assert.equal(result.ok, true, `${id}: ${result.message}`);
  return result;
};
function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}
function reconstruct(rows) {
  const observation = structuredClone(rows[0].observation);
  for (const row of rows.slice(1, -1)) {
    for (const change of row.changes || []) {
      if (!change.path.length) {
        if (change.op === 'remove') delete observation.entities[change.entity];
        else observation.entities[change.entity] = structuredClone(change.value);
        continue;
      }
      let target = observation.entities[change.entity];
      for (const key of change.path.slice(0, -1)) target = target[key];
      if (change.op === 'remove') delete target[change.path.at(-1)];
      else target[change.path.at(-1)] = structuredClone(change.value);
    }
    if (row.fromTick !== undefined) observation.tick = row.tick;
  }
  return observation;
}
function rejectedWithoutMutation(s, id, args, code) {
  const before = serialize(s), result = executeAction(s, id, args, 'test');
  assert.equal(result.ok, false, `${id} unexpectedly accepted ${JSON.stringify(args)}`);
  if (code) assert.equal(result.code, code);
  assert.equal(serialize(s), before, `${id} changed state when rejected`);
  return result;
}

test('outpost action catalog publishes detached resource and roster contracts for both control clients', () => {
  const catalog = actionCatalog();
  for (const id of ['freight.load', 'freight.unload', 'expedition.return_crew', 'outpost.residents']) {
    const matches = catalog.filter(action => action.id === id);
    assert.equal(matches.length, 1, id);
    assert.ok(matches[0].description.length > 20);
    assert.equal(matches[0].parameters.additionalProperties, false);
  }
  const load = catalog.find(a => a.id === 'freight.load').parameters;
  const unload = catalog.find(a => a.id === 'freight.unload').parameters;
  assert.deepEqual(load.required, ['items']);
  assert.deepEqual(unload.required, ['site']);
  assert.equal(unload.properties.items.optional, true);
  assert.equal(load.properties.items.additionalProperties, false);
  assert.equal(load.properties.items.minProperties, 1);
  assert.deepEqual(Object.keys(load.properties.items.properties).sort(), [...RESOURCES].sort());
  assert.equal(load.properties.items.properties.keepsakes.type, 'integer');
  assert.equal(load.properties.items.properties.food.exclusiveMinimum, 0);
  for (const [id, minimum, maximum] of [['expedition.return_crew', 1, 2], ['outpost.residents', 0, 7]]) {
    const schema = catalog.find(a => a.id === id).parameters.properties.crewIds;
    assert.equal(schema.type, 'array'); assert.equal(schema.uniqueItems, true);
    assert.equal(schema.minItems, minimum); assert.equal(schema.maxItems, maximum);
    assert.deepEqual(schema.items, { type: 'string', entityType: 'crew' });
  }
  const residents = catalog.find(a => a.id === 'outpost.residents').parameters;
  assert.deepEqual(residents.required, ['site', 'crewIds']);
  assert.deepEqual(residents.properties.site.enum, ['wreck']);
  load.properties.items.properties.food.exclusiveMinimum = -99;
  residents.properties.crewIds.items.entityType = 'invented';
  assert.equal(actionCatalog().find(a => a.id === 'freight.load').parameters.properties.items.properties.food.exclusiveMinimum, 0);
  assert.equal(createAgentInterface(() => createGame()).actions().find(a => a.id === 'outpost.residents').parameters.properties.crewIds.items.entityType, 'crew');
});

test('launch accepts one selected pilot only after wreck establishment, with route-specific atomic rejections', () => {
  const schema = actionCatalog().find(action => action.id === 'expedition.launch').parameters.properties.crewIds;
  assert.equal(schema.minItems, 1); assert.equal(schema.maxItems, 2);
  assert.equal(schema.uniqueItems, true); assert.equal(schema.optional, true);
  for (const [site, established] of [['wreck', false], ['comet', false], ['comet', true], ['solar', false], ['solar', true]]) {
    const s = createGame(); s.outposts.wreck.established = established;
    // Isolated route boundaries: open unrelated destination gates so a locked
    // route cannot hide a wrong one-pilot rule. This is not a played expedition.
    if (site === 'comet') s.tick = s.comet.arrives;
    if (site === 'solar') s.flags.salvageReturned = true;
    startRecording(s);
    const result = rejectedWithoutMutation(s, 'expedition.launch', { site, crewIds: ['crew-4'] }, 'simulation_rejected');
    assert.equal(result.reason, 'crew_count');
    const rows = records(s);
    assert.equal(rows.some(row => row.kind === 'event'), false);
    assert.ok(rows.filter(row => row.kind === 'action.result').every(row => row.changes.length === 0));
  }
});

test('established history permits explicit solo preparation without changing automatic two-person selection', () => {
  for (const established of [false, true]) {
    const s = createGame(); s.outposts.wreck.established = established;
    startRecording(s); act(s, 'expedition.launch', { site: 'wreck' });
    assert.equal(s.departure.crew.length, 2);
    assert.deepEqual(s.departure.crew, ['crew-0', 'crew-1']);
    const request = records(s).find(row => row.action?.id === 'expedition.launch');
    assert.equal(Object.hasOwn(request.action.args, 'crewIds'), false);
  }
  const s = createGame(); s.outposts.wreck.established = true;
  assert.deepEqual(s.outposts.wreck.residents, [], 'historical establishment survives the last resident leaving');
  const positions = s.crew.map(({ id, site, x, y }) => ({ id, site, x, y }));
  const supplies = structuredClone(s.shuttle.supplies); startRecording(s);
  const chosen = ['crew-4']; act(s, 'expedition.launch', { site: 'wreck', crewIds: chosen }); chosen.push('crew-2');
  assert.deepEqual(s.departure.crew, ['crew-4']); assert.equal(s.mission, null);
  assert.deepEqual(s.shuttle.supplies, supplies, 'preparation does not grant paid service stores');
  assert.deepEqual(s.crew.map(({ id, site, x, y }) => ({ id, site, x, y })), positions);
  assert.equal(serialize(deserialize(serialize(s))), serialize(s));
  const rows = records(s), started = rows.find(row => row.event?.id === 'expedition.preparation.started');
  assert.deepEqual(started.event.crewIds, ['crew-4']);
  assert.deepEqual(observe(s).entities.colony.derived.expedition.crewLimits, { min: 1, max: 2, defaultCount: 2 });
  assert.deepEqual(reconstruct(rows), observe(s));
});

test('launch policy observations are detached and distinguish established wreck history from other destinations', () => {
  for (const established of [false, true]) {
    const s = createGame(); s.outposts.wreck.established = established;
    const before = serialize(s); frozen(s);
    const observed = observe(s);
    assert.equal(observed.entities.colony.derived.expedition.crewLimits, null);
    for (const site of ['wreck', 'comet', 'solar']) {
      const expected = { min: established && site === 'wreck' ? 1 : 2, max: 2, defaultCount: 2 };
      assert.deepEqual(observed.entities[`site:${site}`].derived.expedition.crewLimits, expected);
      observed.entities[`site:${site}`].derived.expedition.crewLimits.min = 0;
      assert.deepEqual(observe(s).entities[`site:${site}`].derived.expedition.crewLimits, expected);
    }
    assert.equal(serialize(s), before);
  }
});

test('one-pilot permission still rejects empty, oversized or malformed outbound and return rosters', () => {
  const s = createGame(); s.outposts.wreck.established = true; startRecording(s);
  for (const crewIds of [[], ['crew-0', 'crew-1', 'crew-2'], ['crew-0', 'crew-0'], ['unknown'], [null], Array(1)]) {
    rejectedWithoutMutation(s, 'expedition.launch', { site: 'wreck', crewIds }, 'invalid_arguments');
  }
  rejectedWithoutMutation(s, 'expedition.return_crew', { crewIds: [] }, 'invalid_arguments');
  const fieldState = field(); fieldState.outposts.wreck.established = true;
  startRecording(fieldState);
  rejectedWithoutMutation(fieldState, 'expedition.return_crew', { crewIds: [] }, 'invalid_arguments');
  assert.ok(records(s).concat(records(fieldState)).filter(row => row.kind === 'action.result').every(row => row.changes.length === 0));
});

test('malformed freight maps reject before any reservation, event, RNG or ID mutation', () => {
  const s = createGame(); startRecording(s);
  const invalid = [null, [], {}, 1, 'alloy', { alloy: 0 }, { alloy: -1 }, { alloy: Infinity }, { alloy: NaN },
    { alloy: '1' }, { alloy: null }, { alloy: {} }, { keepsakes: .5 }, { madeUp: 1 },
    { alloy: 1, _items: [] }, { food: 1, _food: [] }, { alloy: 1, ignored: undefined }, Object.create({ alloy: 1 })];
  for (const items of invalid) {
    rejectedWithoutMutation(s, 'freight.load', { items }, 'invalid_arguments');
    rejectedWithoutMutation(s, 'freight.unload', { site: 'surface', items }, 'invalid_arguments');
  }
  rejectedWithoutMutation(s, 'freight.load', { items: { alloy: 1 }, unused: true }, 'invalid_arguments');
  const rows = records(s), failures = rows.filter(row => row.kind === 'action.result');
  assert.equal(failures.length, invalid.length * 2 + 1);
  assert.ok(failures.every(row => row.result.ok === false && row.changes.length === 0));
  assert.equal(rows.some(row => row.kind === 'event'), false);
  assert.deepEqual(reconstruct(rows), observe(s));
});

test('invalid return and residence identities cannot silently select substitutes or erase residents', () => {
  const s = field();
  // Synthetic pre-existing residence tests the registry boundary only. It is
  // deliberately not evidence that an ordinary colony has built a habitat.
  s.outposts.wreck = { established: true, residents: ['crew-2'] };
  startRecording(s);
  const invalid = [null, {}, 'crew-4', ['unknown'], ['crew-4', 'crew-4'], [1], [null], Array(1)];
  for (const crewIds of invalid) {
    rejectedWithoutMutation(s, 'expedition.return_crew', { crewIds }, 'invalid_arguments');
    rejectedWithoutMutation(s, 'outpost.residents', { site: 'wreck', crewIds }, 'invalid_arguments');
  }
  rejectedWithoutMutation(s, 'expedition.return_crew', { crewIds: [] }, 'invalid_arguments');
  rejectedWithoutMutation(s, 'expedition.return_crew', { crewIds: ['crew-4', 'crew-2', 'crew-0'] }, 'invalid_arguments');
  rejectedWithoutMutation(s, 'outpost.residents', { site: 'surface', crewIds: [] }, 'invalid_arguments');
  rejectedWithoutMutation(s, 'outpost.residents', { site: 'wreck', crewIds: [], teleport: true }, 'invalid_arguments');
  assert.ok(records(s).filter(row => row.kind === 'action.result').every(row => row.changes.length === 0));
  assert.deepEqual(s.outposts.wreck.residents, ['crew-2']);
});

test('well-formed unavailable freight and settlement orders have stable rejection reasons and zero deltas', () => {
  const s = createGame(); startRecording(s);
  for (const [id, args] of [
    ['freight.load', { items: { alloy: 19 } }],
    ['freight.unload', { site: 'wreck' }],
    ['freight.unload', { site: 'surface' }],
    ['expedition.return_crew', { crewIds: ['crew-4'] }],
    ['outpost.residents', { site: 'wreck', crewIds: ['crew-2'] }],
  ]) {
    const result = rejectedWithoutMutation(s, id, args, 'simulation_rejected');
    assert.equal(typeof result.reason, 'string', `${id} must expose its domain blocker`);
    assert.ok(result.reason.length > 0);
  }
  assert.ok(records(s).filter(row => row.kind === 'action.result').every(row => row.changes.length === 0));
  assert.equal(records(s).some(row => row.event), false);
});

test('new inspection surfaces are detached and can repeatedly inspect a deeply frozen colony', () => {
  for (const s of [createGame(), field()]) {
    const before = serialize(s), initial = observe(s), api = createAgentInterface(() => s);
    const readiness = outpostReadiness(s, 'wreck', ['crew-2']);
    const freight = freightStatus(s, 'wreck');
    frozen(s);
    for (let i = 0; i < 3; i++) {
      const observed = api.observe();
      assert.deepEqual(observed, initial);
      assert.deepEqual(observed.entities['site:wreck'].derived.freight, freight);
      assert.deepEqual(observed.entities['site:wreck'].derived.habitat, outpostReadiness(s, 'wreck', s.outposts.wreck.residents));
      observed.entities.colony.shuttle.freight.alloy = 999;
      observed.entities['site:wreck'].derived.outpost.residents.push('crew-0');
      api.actions(); api.definitions(); api.recording.status();
      const measured = outpostReadiness(s, 'wreck', ['crew-2']);
      assert.deepEqual(measured, readiness);
      assert.equal(measured.ready, false, 'an unsupplied cold wreck must not be labeled ready');
      assert.ok(measured.blockers.some(blocker => blocker.code === 'habitat_unready'));
      measured.provisions.available.food = 999; measured.crewIds.length = 0;
      const manifest = freightStatus(s, 'wreck');
      assert.deepEqual(manifest, freight);
      manifest.onboard.alloy = 999; manifest.salvage.food = 999;
      assert.equal(serialize(s), before);
    }
  }
});

test('player and agent freight cancellation record both same-tick boundaries without creating a delivery', () => {
  const a = createGame(), b = deserialize(serialize(a)), requested = { alloy: 2 };
  startRecording(a); startRecording(b);
  const player = controlBindings(() => a), agent = createAgentInterface(() => b);
  const first = player.loadFreight(a, requested), second = agent.act('freight.load', { items: requested });
  assert.equal(first.ok, true, first.message); assert.deepEqual(first, second);
  assert.deepEqual(a, b);
  assert.equal(quantity(a.shuttle.freight), 0, 'an order is a local reservation, not hold delivery');
  assert.equal(a.jobs.find(job => job.id === first.job).kind, 'loadCargo');
  assert.equal(a.jobs.find(job => job.id === first.job).sources.reduce((n, source) => n + quantity(source.items), 0), 2);
  requested.alloy = 100;
  assert.equal(player.cancelJob(a, first.job).ok, true);
  assert.equal(agent.act('job.cancel', { job: second.job }).ok, true);
  assert.equal(quantity(a.shuttle.freight), 0); assert.deepEqual(a, b);
  for (const [s, source] of [[a, 'player'], [b, 'agent']]) {
    const rows = records(s), request = rows.find(row => row.action?.id === 'freight.load');
    assert.equal(request.action.source, source); assert.deepEqual(request.action.args, { items: { alloy: 2 } });
    const ordered = rows.find(row => row.event?.id === 'freight.ordered');
    const cancelled = rows.find(row => row.event?.id === 'freight.cancelled');
    assert.ok(ordered && cancelled); assert.equal(ordered.tick, cancelled.tick);
    assert.equal(ordered.command, request.sequence); assert.ok(ordered.sequence < cancelled.sequence);
    assert.equal(rows.find(row => row.sequence === cancelled.command).action.id, 'job.cancel');
    assert.equal(rows.some(row => ['freight.loaded', 'freight.unloaded'].includes(row.event?.id)), false);
    assert.deepEqual(reconstruct(rows), observe(s));
  }
});

test('return selection and deceased-resident cleanup are separately recorded promises, never movement', () => {
  const s = field();
  // This isolated lifecycle fixture begins with a registered resident; it does
  // not claim the habitat was commissioned through normal play.
  s.outposts.wreck = { established: true, residents: ['crew-2', 'crew-0'] };
  Object.assign(s.crew.find(crew => crew.id === 'crew-0'), { health: 0, site: 'wreck', x: 7, y: 11 });
  const locations = s.crew.map(({ id, site, x, y }) => ({ id, site, x, y }));
  const arrivals = [...s.mission.crew]; startRecording(s);
  act(s, 'expedition.return_crew', { crewIds: ['crew-4'] });
  const rejected = rejectedWithoutMutation(s, 'outpost.residents', { site: 'wreck', crewIds: [] }, 'simulation_rejected');
  assert.equal(rejected.reason, 'resident_return_required');
  act(s, 'expedition.return_crew', { crewIds: ['crew-2', 'crew-4'] });
  const selected = rejectedWithoutMutation(s, 'outpost.residents', { site: 'wreck', crewIds: [] }, 'simulation_rejected');
  assert.equal(selected.reason, 'resident_return_required', 'a return seat cannot end residence before physical departure');
  act(s, 'outpost.residents', { site: 'wreck', crewIds: ['crew-2'] });
  const noOp = serialize(s); act(s, 'outpost.residents', { site: 'wreck', crewIds: ['crew-2'] });
  assert.equal(serialize(s), noOp);
  assert.deepEqual(s.crew.map(({ id, site, x, y }) => ({ id, site, x, y })), locations);
  assert.deepEqual(s.mission.crew, arrivals);
  assert.deepEqual(s.mission.returnCrew, ['crew-2', 'crew-4']);
  assert.deepEqual(s.outposts.wreck, { established: true, residents: ['crew-2'] });
  const rows = records(s), residence = rows.filter(row => row.event?.id === 'outpost.residents.changed');
  assert.equal(residence.length, 1, 'same-value commands must not invent a second transition');
  assert.equal(residence[0].event.entity, 'site:wreck');
  assert.deepEqual(residence[0].event.previous, ['crew-2', 'crew-0']); assert.deepEqual(residence[0].event.next, ['crew-2']);
  assert.equal(rows.find(row => row.sequence === residence[0].command).action.id, 'outpost.residents');
  assert.equal(rows.filter(row => row.event?.id === 'expedition.return_manifest.changed').length, 2);
  const changes = rows.flatMap(row => row.changes || []);
  assert.ok(changes.some(change => change.entity === 'colony' && change.path[0] === 'outposts' && change.system === 'outposts'));
  assert.ok(changes.some(change => change.entity === 'colony' && change.path[0] === 'mission' && change.path[1] === 'returnCrew' && change.system === 'expedition'));
  assert.ok(changes.some(change => change.entity === 'crew-0' && change.path[0] === 'derived' && change.system === 'derived_conditions'));
  assert.deepEqual(reconstruct(rows), observe(s));
  const replay = deserialize(JSON.stringify(rows[0].initialState));
  for (const row of rows) if (row.kind === 'action.requested') executeAction(replay, row.action.id, row.action.args, 'test');
  assert.equal(serialize(replay), serialize(s));
});

test('a pickup resident outside the arrival crew cannot be unregistered merely by reserving a return seat', () => {
  const s = field(), pickup = s.crew.find(crew => crew.id === 'crew-0');
  // Synthetic pre-existing third resident isolates pickup from arrival history.
  Object.assign(pickup, { site: 'wreck', x: 7, y: 11 });
  s.outposts.wreck = { established: true, residents: ['crew-2', pickup.id] };
  assert.equal(s.mission.crew.includes(pickup.id), false);
  assert.equal(serialize(deserialize(serialize(s))), serialize(s));
  startRecording(s);
  act(s, 'expedition.return_crew', { crewIds: [pickup.id, 'crew-4'] });
  const result = rejectedWithoutMutation(s, 'outpost.residents', { site: 'wreck', crewIds: ['crew-2'] }, 'simulation_rejected');
  assert.equal(result.reason, 'resident_return_required');
  assert.equal(pickup.site, 'wreck');
  assert.deepEqual(s.outposts.wreck.residents, ['crew-2', pickup.id]);
  const rows = records(s), rejection = rows.filter(row => row.kind === 'action.result').at(-1);
  assert.deepEqual(rejection.changes, []);
  assert.equal(rows.some(row => row.event?.id === 'outpost.residents.changed'), false);
  assert.deepEqual(reconstruct(rows), observe(s));
});

test('unready resident additions cannot partially change either residence or the return manifest', () => {
  const s = field(); startRecording(s);
  const unready = rejectedWithoutMutation(s, 'outpost.residents', { site: 'wreck', crewIds: ['crew-2'] }, 'simulation_rejected');
  assert.ok(outpostReadiness(s, 'wreck', ['crew-2']).blockers.some(blocker => blocker.code === unready.reason));
  const noPilot = rejectedWithoutMutation(s, 'outpost.residents', { site: 'wreck', crewIds: ['crew-2', 'crew-4'] }, 'simulation_rejected');
  assert.equal(noPilot.reason, 'return_crew_required');
  assert.equal(records(s).some(row => row.event), false);
  assert.ok(records(s).filter(row => row.kind === 'action.result').every(row => row.changes.length === 0));
});

test('habitat event boundaries retain same-tick terminal loss and recovery even with zero final state delta', () => {
  const s = field(), dock = s.sites.wreck.tiles.find(tile => tile.building === 'dock');
  assert.equal(habitatSnapshot(s), null, 'disabled recording does not maintain another simulation owner');
  startRecording(s); const before = serialize(s), condition = dock.hp;
  // Synthetic measurement boundary: two real condition readings in one tick.
  // Normal work integration and replay are exercised by the freight test below.
  const healthy = habitatSnapshot(s); dock.hp = 0; recordHabitatChanges(s, healthy);
  const damaged = habitatSnapshot(s); dock.hp = condition; recordHabitatChanges(s, damaged);
  const stable = habitatSnapshot(s);
  for (let i = 0; i < 3; i++) { observe(s); recordHabitatChanges(s, stable); }
  assert.equal(serialize(s), before);
  const rows = records(s), events = rows.filter(row => row.event?.id === 'outpost.habitat.changed');
  assert.equal(events.length, 2, 'unchanged inspection cannot invent additional transitions');
  assert.equal(events[0].tick, events[1].tick);
  assert.equal(events[0].event.entity, 'site:wreck');
  assert.equal(events[0].event.reason, 'measured_conditions_changed');
  assert.equal(events[0].event.previous.blockers.includes('dock_damaged'), false);
  assert.equal(events[0].event.next.blockers.includes('dock_damaged'), true);
  assert.equal(events[1].event.previous.blockers.includes('dock_damaged'), true);
  assert.equal(events[1].event.next.blockers.includes('dock_damaged'), false);
  assert.ok(events.every(row => row.command === null), 'external condition changes are not player orders');
  assert.equal(rows.flatMap(row => row.changes || []).length, 0);
  assert.deepEqual(reconstruct(rows), observe(s));
});

test('ordinary finite freight delivery records worker ownership, remote readiness and deterministic replay', () => {
  const a = createGame(), b = deserialize(serialize(a));
  startRecording(a, { maxRecords: 30000, maxBytes: 128000000 });
  const run = (id, args = {}) => {
    const result = act(a, id, args); assert.deepEqual(act(b, id, args), result); return result;
  };
  const until = (condition, limit, label, onTick = () => {}) => {
    for (let i = 0; i < limit && !condition(); i++) { run('simulation.step', { ticks: 1 }); onTick(); }
    assert.ok(condition(), `Physical freight failed to ${label} by tick ${a.tick}`);
  };
  const requested = { alloy: 2, air: 5, food: 2 };
  const load = run('freight.load', { items: requested });
  assert.equal(quantity(a.shuttle.freight), 0);
  assert.equal(a.jobs.find(job => job.id === load.job).sources.reduce((sum, source) => sum + quantity(source.items), 0), 9);
  let loadCarry = false;
  until(() => !a.jobs.some(job => job.id === load.job), 180, 'load the surface shuttle', () => {
    loadCarry ||= a.crew.some(crew => crew.carry && crew.delivery?.job === load.job);
  });
  assert.equal(loadCarry, true, 'a real worker must carry the reserved shipment');
  for (const [resource, amount] of Object.entries(requested)) assert.equal(a.shuttle.freight[resource], amount);
  const stores = structuredClone(a.shuttle.freight);
  run('expedition.launch', { site: 'wreck', crewIds: ['crew-2', 'crew-4'] });
  until(() => a.mission?.phase === 'working', 200, 'arrive at the wreck');
  const dock = a.sites.wreck.tiles.find(tile => tile.building === 'dock');
  const dockId = `tile:wreck:${dock.x}:${dock.y}`;
  assert.deepEqual(dock.imports, {}, 'arrival alone cannot credit local supplies');
  assert.deepEqual(Object.fromEntries(Object.keys(requested).map(resource => [resource, a.shuttle.freight[resource]])), requested);
  const readinessBefore = outpostReadiness(a, 'wreck', ['crew-2']);
  assert.equal(readinessBefore.provisions.available.food, 0, 'aboard freight is unavailable to the local habitat');
  const unload = run('freight.unload', { site: 'wreck' });
  assert.deepEqual(dock.imports, {}, 'an unload order is not a delivered import');
  assert.equal(quantity(a.shuttle.freight), 0);
  let unloadCarry = false;
  until(() => !a.jobs.some(job => job.id === unload.job), 100, 'deliver supplies to local imports', () => {
    unloadCarry ||= a.crew.some(crew => crew.carry && crew.delivery?.job === unload.job);
  });
  assert.equal(unloadCarry, true);
  for (const [resource, amount] of Object.entries(requested)) assert.equal(dock.imports[resource], amount);
  assert.deepEqual(dock.imports._food.map(lot => lot.amount), stores._food.map(lot => lot.amount));
  assert.ok(dock.imports._food.every(lot => lot.age > stores._food[0].age), 'food ages while physically transported');
  const readinessAfter = outpostReadiness(a, 'wreck', ['crew-2']);
  assert.equal(readinessAfter.provisions.available.food, 2);
  assert.equal(readinessAfter.provisions.available.air, 5);
  assert.equal(readinessAfter.ready, false, 'delivered reserves do not invent a safe room');
  assert.deepEqual(a, b); assert.equal(serialize(a), serialize(b));
  const rows = records(a), loaded = rows.find(row => row.event?.id === 'freight.loaded'), unloaded = rows.find(row => row.event?.id === 'freight.unloaded');
  assert.ok(loaded && unloaded); assert.ok(loaded.sequence < unloaded.sequence);
  for (const [job, sourceOwner] of [
    [load.job, { entity: 'tile:surface:8:10', slot: 'stock' }],
    [unload.job, { entity: 'colony', slot: 'shuttle.freight' }],
  ]) {
    const ordered = rows.find(row => row.event?.id === 'freight.ordered' && row.event.entity === job);
    assert.ok(ordered.event.transfers.length > 0);
    assert.equal(ordered.event.transfers.reduce((sum, transfer) => sum + quantity(transfer.cargo), 0), 9);
    ordered.event.transfers.forEach((transfer, index) => {
      assert.deepEqual(transfer.from, sourceOwner);
      assert.deepEqual(transfer.to, { entity: job, slot: `sources.${index}` });
    });
    const completed = job === load.job ? loaded : unloaded;
    const pickups = rows.filter(row => row.event?.id === 'freight.picked_up' && row.event.job === job);
    const deliveries = rows.filter(row => row.event?.id === 'freight.delivered' && row.event.job === job);
    assert.ok(pickups.length && deliveries.length, 'each order needs named physical collection and staging');
    for (const stage of [pickups, deliveries]) {
      for (const [resource, amount] of Object.entries(requested)) {
        assert.equal(stage.reduce((sum, row) => sum + (row.event.cargo[resource] || 0), 0), amount);
      }
      for (const row of stage) {
        assert.equal(row.event.entity, job);
        assert.ok(a.crew.some(crew => crew.id === row.event.actor));
        assert.equal(row.event.site, job === load.job ? 'site:surface' : 'site:wreck');
        assert.ok(row.sequence > ordered.sequence && row.sequence < completed.sequence);
        assert.equal(rows.find(request => request.sequence === row.command).action.id, 'simulation.step');
      }
    }
    for (const row of pickups) {
      assert.match(row.event.from.slot, /^sources\.\d+$/);
      const sourceIndex = Number(row.event.from.slot.split('.')[1]);
      assert.deepEqual(row.event.from, ordered.event.transfers[sourceIndex].to);
      assert.deepEqual(row.event.to, { entity: row.event.actor, slot: 'carry' });
    }
    for (const row of deliveries) {
      assert.deepEqual(row.event.from, { entity: row.event.actor, slot: 'carry' });
      assert.deepEqual(row.event.to, { entity: job, slot: 'materials' });
    }
    assert.ok(pickups[0].sequence < deliveries[0].sequence);
  }
  for (const [eventRow, job, destination] of [
    [loaded, load.job, { entity: 'colony', slot: 'shuttle.freight' }],
    [unloaded, unload.job, { entity: dockId, slot: 'imports' }],
  ]) {
    assert.equal(eventRow.event.entity, job);
    assert.ok(a.crew.some(crew => crew.id === eventRow.event.actor));
    assert.deepEqual(eventRow.event.from, { entity: job, slot: 'materials' });
    assert.deepEqual(eventRow.event.to, destination);
    assert.equal(rows.find(row => row.sequence === eventRow.command).action.id, 'simulation.step');
    for (const [resource, amount] of Object.entries(requested)) assert.equal(eventRow.event.cargo[resource], amount);
  }
  const changes = rows.flatMap(row => row.changes || []);
  assert.ok(changes.some(change => change.entity.startsWith('crew-') && change.path[0] === 'carry' && change.system === 'inventory'));
  assert.ok(changes.some(change => change.entity === 'colony' && change.path[0] === 'shuttle' && change.path[1] === 'freight' && change.system === 'inventory'));
  assert.ok(changes.some(change => change.entity === dockId && change.path[0] === 'imports' && change.system === 'inventory'));
  assert.ok(changes.some(change => change.entity === 'site:wreck' && change.path[0] === 'derived' && change.path[1] === 'habitat' && change.system === 'derived_conditions'));
  assert.deepEqual(reconstruct(rows), observe(a));
  assert.equal(recordingStatus(a).active, true, 'acceptance recording must not silently truncate');
  const replay = deserialize(JSON.stringify(rows[0].initialState));
  for (const row of rows) if (row.kind === 'action.requested') act(replay, row.action.id, row.action.args);
  assert.equal(serialize(replay), serialize(a));
  assert.equal(recordingStatus(replay).reason, 'not_started');
});
