import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { initializeStorage } from '../src/inventory.js';
import { initializeElectrical, refreshPower } from '../src/power.js';
import { newPipe, gasStatus } from '../src/gas-networks.js';
import { newWaterPipe, plumbingStatus } from '../src/plumbing.js';
import { executeAction, controlBindings, actionCatalog, createAgentInterface } from '../src/controls.js';
import { startRecording, exportRecording, observe, recordingStatus } from '../src/telemetry.js';

const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const position = x => ({site:'surface', x, y:9});
const settings = (x = 10, extra = {}) => ({...position(x), enabled:true, direction:'east', mode:'wet_fault', ...extra});
function install(s, building, x, y = 9) {
  const tile = at(s.sites.surface, x, y);
  assert.equal(tile.building, null);
  tile.building = building;
  initializeStorage(tile);
  initializeElectrical(tile);
  return tile;
}
function fixture({backfeed = false} = {}) {
  const s = createGame(), site = s.sites.surface;
  for (const t of site.tiles) { t.cable = null; if (t.machine) t.machine.enabled = false; }
  for (const crew of s.crew) { crew.labors.hauling = false; crew.labors.production = false; }
  const bank = install(s, 'battery', 9), first = install(s, 'breaker', 10), second = install(s, 'breaker', 12);
  bank.charge = 30; site.energy.injected += 30;
  const faults = [at(site, 11, 9), at(site, 13, 9)];
  for (const t of faults) { t.cable = {enabled:true, hp:100}; t.liquid = 2; site.liquids.released += 2; }
  let localBank = null;
  if (backfeed) { localBank = install(s, 'battery', 11, 8); localBank.charge = 10; site.energy.injected += 10; }
  refreshPower(s, site);
  return {s, site, bank, first, second, faults, localBank};
}
function reconstruct(recording) {
  const observation = structuredClone(recording[0].observation);
  for (const row of recording.slice(1, -1)) {
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

test('breaker catalog describes configure/reset arguments and exposes detached mode/direction definitions', () => {
  const catalog = actionCatalog(), configure = catalog.find(a => a.id === 'power.breaker'), reset = catalog.find(a => a.id === 'power.breaker.reset');
  assert.deepEqual(configure.parameters.required, ['site','x','y','enabled','direction','mode']);
  assert.deepEqual(reset.parameters.required, ['site','x','y']);
  assert.equal(configure.parameters.additionalProperties, false);
  assert.equal(reset.parameters.additionalProperties, false);
  assert.deepEqual(configure.parameters.properties.mode.enum, ['manual','wet_fault']);
  assert.deepEqual(configure.parameters.properties.direction.enum, ['east','south','west','north']);
  const {s} = fixture(), api = createAgentInterface(() => s), definitions = api.definitions();
  assert.deepEqual(definitions.breakerModes, ['manual','wet_fault']);
  assert.deepEqual(definitions.breakerDirections.east, [1,0]);
  definitions.breakerModes.push('overload'); definitions.breakerDirections.east[0] = 999;
  assert.deepEqual(api.definitions().breakerModes, ['manual','wet_fault']);
  assert.deepEqual(api.definitions().breakerDirections.east, [1,0]);
});

test('player and agent breaker configuration/reset share rules and prior/next semantic state labels', () => {
  const {s:a, first} = fixture();
  first.protection = {...first.protection, enabled:true, mode:'wet_fault', tripped:true, cause:'wet_fault'};
  refreshPower(a, a.sites.surface);
  const b = deserialize(serialize(a));
  startRecording(a); startRecording(b);
  const controls = controlBindings(() => a), api = createAgentInterface(() => b);
  assert.ok(controls.setBreaker(a, 'surface', 10, 9, false, 'east', 'wet_fault').ok);
  assert.ok(controls.resetBreaker(a, 'surface', 10, 9).ok);
  assert.ok(api.act('power.breaker', settings(10, {enabled:false})).ok);
  assert.ok(api.act('power.breaker.reset', position(10)).ok);
  assert.deepEqual(a, b);
  for (const [s, source] of [[a,'player'], [b,'agent']]) {
    const recording = rows(s), requests = recording.filter(row => row.kind === 'action.requested');
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.action.source, source);
      const event = recording.find(row => row.kind === 'event' && row.command === request.sequence);
      assert.equal(event.event.entity, 'tile:surface:10:9');
      assert.equal(event.event.id, request.action.id === 'power.breaker' ? 'power.breaker.changed' : 'power.breaker.reset');
      assert.ok(event.event.previous && event.event.next);
      assert.deepEqual(event.event.faultEntities, []);
      assert.equal(recording.find(row => row.kind === 'action.result' && row.command === request.sequence).result.code, 'applied');
    }
    const reset = recording.find(row => row.event?.id === 'power.breaker.reset');
    assert.equal(reset.event.previous.tripped, true);
    assert.equal(reset.event.next.tripped, false);
    assert.equal(reset.event.next.enabled, false);
    assert.equal(reset.event.next.cause, null);
    assert.equal(reset.event.cause, 'manual_reset');
  }
});

test('rejected breaker requests and accepted no-ops produce results without fabricated state-change events', () => {
  const {s, first} = fixture();
  startRecording(s);
  const before = serialize(s);
  const invalid = [
    ['power.breaker', settings(10, {enabled:'yes'})],
    ['power.breaker', settings(10, {direction:'up'})],
    ['power.breaker', settings(10, {mode:'overload'})],
    ['power.breaker', settings(10, {extra:true})],
    ['power.breaker', settings(11)],
    ['power.breaker.reset', {...position(10), enabled:false}],
    ['power.breaker.reset', position(11)],
  ];
  for (const [id, args] of invalid) assert.equal(executeAction(s, id, args).ok, false);
  assert.ok(executeAction(s, 'power.breaker', settings(10, {enabled:false, mode:'manual'})).ok);
  assert.ok(executeAction(s, 'power.breaker.reset', position(10)).ok);
  assert.ok(executeAction(s, 'power.cable', {...position(11), enabled:true}).ok);
  assert.equal(serialize(s), before);
  const recording = rows(s), results = recording.filter(row => row.kind === 'action.result');
  assert.equal(results.length, invalid.length + 3);
  assert.equal(results.filter(row => !row.result.ok).length, invalid.length);
  assert.equal(recording.some(row => row.kind === 'event'), false);
  assert.ok(results.every(row => row.changes.length === 0));
  assert.equal(first.protection.tripped, false);
});

test('breaker previews expose detached terminal, fault and local source IDs without tripping or losing overlay observations', () => {
  const {s, site, first} = fixture({backfeed:true});
  first.pipe = newPipe(); first.waterPipe = newWaterPipe();
  assert.ok(executeAction(s, 'power.breaker', settings(10)).ok);
  assert.ok(executeAction(s, 'power.breaker', settings(12)).ok);
  startRecording(s);
  const before = serialize(s), initial = observe(s).entities['tile:surface:10:9'];
  const diagnostic = initial.derived.electrical;
  assert.equal(initial.circuit, null);
  assert.equal(diagnostic.connected, true);
  assert.equal(diagnostic.bypassed, false);
  assert.equal(diagnostic.wouldTrip, true);
  assert.equal(typeof diagnostic.inputCircuit, 'string');
  assert.equal(diagnostic.inputCircuit, diagnostic.outputCircuit);
  assert.ok(diagnostic.faultEntities.includes('tile:surface:13:9'));
  assert.ok(diagnostic.sourceEntities.includes('tile:surface:11:8'));
  const {electrical, plumbing, ...gas} = initial.derived;
  assert.deepEqual(gas, gasStatus(site, first));
  assert.deepEqual(plumbing, plumbingStatus(s, site, first));
  diagnostic.faultEntities.push('invented'); diagnostic.sourceEntities.length = 0;
  for (let i = 0; i < 3; i++) { observe(s); refreshPower(s, site); deserialize(serialize(s)); }
  assert.equal(serialize(s), before);
  assert.equal(first.protection.tripped, false);
  assert.equal(observe(s).entities['tile:surface:10:9'].derived.electrical.faultEntities.includes('invented'), false);
  assert.equal(rows(s).some(row => row.kind === 'event'), false);
});

test('batched breaker trips record each prior/next state, actual fault IDs and command before reset and deterministic replay', () => {
  const a = fixture().s, b = deserialize(serialize(a));
  startRecording(a, {maxRecords:10000, maxBytes:32000000});
  const commands = [
    ['power.breaker', settings(10)], ['power.breaker', settings(12)],
    ['simulation.step', {ticks:1}],
    ['power.breaker', settings(10, {enabled:false})], ['power.breaker.reset', position(10)],
    ['power.breaker', settings(12, {enabled:false})], ['power.breaker.reset', position(12)],
  ];
  for (const s of [a,b]) for (const [id,args] of commands) assert.ok(executeAction(s,id,args).ok);
  assert.deepEqual(a,b); assert.equal(serialize(a),serialize(b));
  const recording = rows(a), trips = recording.filter(row => row.event?.id === 'power.breaker.tripped');
  assert.equal(trips.length, 2);
  assert.deepEqual(trips.map(row => row.event.entity), ['tile:surface:10:9','tile:surface:12:9']);
  const advance = recording.find(row => row.action?.id === 'simulation.step');
  for (const trip of trips) {
    assert.equal(trip.command, advance.sequence);
    assert.equal(trip.tick, 1);
    assert.equal(trip.event.cause, 'wet_fault');
    assert.equal(trip.event.previous.tripped, false);
    assert.equal(trip.event.next.tripped, true);
    assert.equal(trip.event.next.cause, 'wet_fault');
    assert.ok(trip.event.faultEntities.length > 0);
    for (const entity of trip.event.faultEntities) assert.equal(observe(a).entities[entity].type, 'tile');
  }
  assert.ok(recording.flatMap(row => row.changes || []).some(change => change.system === 'power' && change.path[0] === 'protection'));
  assert.deepEqual(reconstruct(recording), observe(a));
  const replay = deserialize(JSON.stringify(recording[0].initialState));
  for (const row of recording) if (row.kind === 'action.requested') assert.ok(executeAction(replay,row.action.id,row.action.args,'test').ok);
  assert.deepEqual(replay,a);
  assert.equal(recordingStatus(replay).reason,'not_started');
});

test('manual cable isolation emits one real change with stable identity and no duplicate event for a no-op', () => {
  const {s} = fixture();
  startRecording(s);
  assert.ok(executeAction(s,'power.cable',{...position(11),enabled:false},'player').ok);
  assert.ok(executeAction(s,'power.cable',{...position(11),enabled:false},'player').ok);
  const recording = rows(s), events = recording.filter(row => row.event?.id === 'power.cable.changed');
  assert.equal(events.length,1);
  assert.equal(events[0].event.entity,'tile:surface:11:9');
  assert.equal(recording.find(row => row.sequence === events[0].command).action.source,'player');
  assert.deepEqual(reconstruct(recording),observe(s));
});

test('bounded breaker recordings stop explicitly without changing fault protection outcomes', () => {
  const a = fixture().s, b = deserialize(serialize(a));
  startRecording(a,{maxRecords:3});
  for (const s of [a,b]) {
    assert.ok(executeAction(s,'power.breaker',settings(10)).ok);
    assert.ok(executeAction(s,'power.breaker',settings(12)).ok);
    assert.ok(executeAction(s,'simulation.step',{ticks:2}).ok);
  }
  assert.deepEqual(a,b);
  const recording = rows(a), footer = recording.at(-1);
  assert.equal(footer.active,false);
  assert.equal(footer.reason,'record_limit');
  assert.equal(footer.records,3);
  assert.ok(footer.throughTick<a.tick);
  assert.equal(reconstruct(recording).tick,footer.throughTick);
});
