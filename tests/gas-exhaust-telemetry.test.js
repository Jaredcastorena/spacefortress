import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { initializeStorage } from '../src/inventory.js';
import { initializeElectrical, refreshPower, updatePower } from '../src/power.js';
import { roomAt, refreshAtmosphere, emptyGas, gasAmount } from '../src/atmosphere.js';
import { updateGasNetworks, newPipe, releaseGas } from '../src/gas-networks.js';
import { actionCatalog, executeAction, controlBindings, createAgentInterface } from '../src/controls.js';
import { observe, startRecording, recordingStatus, exportRecording } from '../src/telemetry.js';

const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const settings = (extra = {}) => ({site:'surface', x:11, y:9, enabled:true, mode:'filter', target:100, ...extra});

function install(s, building, x, y) {
  const tile = at(s.sites.surface, x, y);
  assert.equal(tile.building, null);
  tile.building = building;
  initializeStorage(tile);
  initializeElectrical(tile);
  return tile;
}

function fixture({smoke = 8, co2 = 8} = {}) {
  const s = createGame(), site = s.sites.surface;
  for (const tile of site.tiles) if (tile.machine) tile.machine.enabled = false;
  for (const crew of s.crew) { crew.labors.hauling = false; crew.labors.production = false; }
  const extractor = install(s, 'gasExtractor', 11, 9), room = roomAt(site, 11, 9);
  for (let x = 8; x <= 13; x++) at(site, x, 9).cable = {enabled:true, hp:100};
  room.gas.oxygen -= co2;
  room.gas.co2 += co2;
  site.atmosphere.breathed += co2;
  room.smoke += smoke;
  site.fireSafety.smokeProduced += smoke;
  refreshAtmosphere(site);
  refreshPower(s, site);
  return {s, site, extractor, room};
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

test('extractor controls expose strict arguments and identical player and agent rules with source labels', () => {
  const a = fixture().s, b = deserialize(serialize(a));
  const action = actionCatalog().find(entry => entry.id === 'gas.extractor');
  assert.ok(action);
  assert.deepEqual(action.parameters.required, ['site','x','y','enabled','mode','target']);
  assert.equal(action.parameters.additionalProperties, false);
  assert.deepEqual(action.parameters.properties.mode.enum, ['filter','exhaust']);
  assert.equal(action.parameters.properties.target.minimum, 0);
  assert.equal(action.parameters.properties.target.maximum, 150);
  startRecording(a); startRecording(b);
  const player = controlBindings(() => a);
  const agent = createAgentInterface(() => b);
  assert.equal(player.setGasExtractor(a, 'surface', 11, 9, true, 'exhaust', 70).ok, true);
  assert.equal(agent.act('gas.extractor', settings({mode:'exhaust', target:70})).ok, true);
  assert.deepEqual(a, b);
  for (const [s, source] of [[a, 'player'], [b, 'agent']]) {
    const recording = rows(s), request = recording.find(row => row.action?.id === 'gas.extractor');
    assert.equal(request.action.source, source);
    const event = recording.find(row => row.event?.id === 'gas.extractor.changed');
    assert.ok(event);
    assert.equal(event.command, request.sequence);
    assert.equal(event.event.entity, 'tile:surface:11:9');
    assert.equal(event.event.mode, 'exhaust');
    assert.equal(event.event.target, 70);
    const result = recording.find(row => row.kind === 'action.result');
    assert.equal(result.command, request.sequence);
    assert.equal(result.result.code, 'applied');
  }
  action.parameters.properties.mode.enum.push('invented');
  assert.equal(actionCatalog().find(entry => entry.id === 'gas.extractor').parameters.properties.mode.enum.includes('invented'), false);
});

test('invalid extractor actions are recorded without mutation and generic gas controls cannot erase extractor mode', () => {
  const {s} = fixture();
  startRecording(s);
  const before = serialize(s);
  const invalid = [settings({mode:'scrub'}), settings({target:-1}), settings({target:151}), settings({target:1.5}), settings({enabled:'yes'}), settings({target:undefined}), settings({extra:true}), settings({x:10})];
  for (const args of invalid) assert.equal(executeAction(s, 'gas.extractor', args).ok, false);
  assert.equal(executeAction(s, 'gas.device', {site:'surface', x:11, y:9, enabled:false, direction:'west', target:40}).ok, false);
  assert.equal(serialize(s), before);
  const recording = rows(s), results = recording.filter(row => row.kind === 'action.result');
  assert.equal(results.length, invalid.length + 1);
  assert.ok(results.every(row => row.result.ok === false && row.changes.length === 0));
  assert.ok(results.some(row => row.result.code === 'invalid_arguments'));
  assert.ok(results.some(row => row.result.code === 'simulation_rejected'));
  assert.equal(recording.some(row => row.event?.id === 'gas.extractor.changed'), false);
});

test('extractor observations identify retained smoke and distinct device conditions without leaking mutable state', () => {
  const {s, site, extractor} = fixture();
  const entry = () => observe(s).entities['tile:surface:11:9'];
  updatePower(s, site);
  updateGasNetworks(s);
  let observed = entry();
  assert.equal(observed.type, 'tile');
  assert.equal(observed.gasDevice.mode, 'filter');
  assert.ok(observed.gasStore.smoke > 0);
  assert.ok(observed.gasStore.gas.co2 > 0);
  assert.equal(observed.derived.blocked, null);
  assert.ok(Number.isFinite(observed.derived.pressure));
  observed.gasStore.smoke = 0;
  observed.gasDevice.mode = 'invented';
  assert.ok(extractor.gasStore.smoke > 0);
  assert.equal(extractor.gasDevice.mode, 'filter');
  executeAction(s, 'gas.extractor', settings({enabled:false}));
  assert.match(entry().derived.blocked, /disabled/i);
  executeAction(s, 'gas.extractor', settings());
  executeAction(s, 'gas.valve', {site:'surface', x:11, y:9, open:false});
  assert.match(entry().derived.blocked, /valve closed/i);
  executeAction(s, 'gas.valve', {site:'surface', x:11, y:9, open:true});
  extractor.cable.enabled = false;
  refreshPower(s, site);
  assert.match(entry().derived.blocked, /no power/i);
});

test('named extraction and return events preserve same-tick transitions invisible in final room and node contents', () => {
  const {s, site, extractor, room} = fixture();
  updatePower(s, site);
  const initialGas = structuredClone(room.gas), initialSmoke = room.smoke;
  startRecording(s);
  updateGasNetworks(s);
  assert.ok(extractor.gasStore.smoke > 0);
  releaseGas(s, site, extractor, Infinity, 'dismantled');
  refreshAtmosphere(site);
  assert.deepEqual(room.gas, initialGas);
  near(room.smoke, initialSmoke);
  assert.deepEqual(extractor.gasStore.gas, emptyGas());
  near(extractor.gasStore.smoke, 0);
  const recording = rows(s), captured = recording.find(row => row.event?.id === 'gas.extracted'), returned = recording.find(row => row.event?.id === 'gas.released');
  assert.ok(captured && returned);
  assert.equal(captured.tick, returned.tick);
  assert.ok(captured.sequence < returned.sequence);
  assert.equal(captured.command, null);
  assert.equal(captured.event.to, 'tile:surface:11:9');
  assert.equal(captured.event.device, captured.event.to);
  assert.match(captured.event.from, /^room:surface:\d+,\d+$/);
  assert.equal(observe(s).entities[captured.event.from].type, 'room');
  assert.equal(captured.event.mode, 'filter');
  assert.equal(captured.event.target, 100);
  assert.equal(captured.event.gas.oxygen, 0);
  assert.equal(captured.event.gas.inert, 0);
  assert.ok(captured.event.gas.co2 > 0 && captured.event.smoke > 0);
  near(captured.event.amount, gasAmount(captured.event.gas) + captured.event.smoke);
  assert.equal(returned.event.from, captured.event.to);
  assert.equal(returned.event.to, captured.event.from);
  assert.deepEqual(returned.event.gas, captured.event.gas);
  near(returned.event.smoke, captured.event.smoke);
  assert.equal(returned.event.reason, 'dismantled');
  const external = recording.find(row => row.kind === 'external');
  assert.ok(external);
  assert.equal(external.command, null);
  assert.equal(external.changes.some(change => change.entity === 'tile:surface:11:9' && change.path.join('.') === 'gasStore.smoke'), false);
  assert.deepEqual(reconstruct(recording), observe(s));
});

test('smoke-only diffusion, pumping and release events name their physical endpoints and explicit payloads', () => {
  const {s, site, extractor} = fixture({smoke:8, co2:0});
  const pump = install(s, 'gasPump', 12, 9), receiver = install(s, 'gasReservoir', 13, 9);
  at(site, 11, 10).pipe = newPipe();
  refreshPower(s, site);
  updatePower(s, site);
  assert.equal(pump.powered, true);
  startRecording(s);
  updateGasNetworks(s);
  updateGasNetworks(s);
  assert.ok(receiver.gasStore.smoke > 0);
  releaseGas(s, site, receiver, Infinity, 'damaged');
  refreshAtmosphere(site);
  const recording = rows(s), events = recording.filter(row => row.event?.id === 'gas.transferred');
  const diffused = events.find(row => row.event.reason === 'smoke_diffusion');
  const pumped = events.find(row => row.event.reason === 'pump');
  assert.ok(diffused && pumped);
  assert.equal(diffused.event.from, 'tile:surface:11:9');
  assert.equal(diffused.event.to, 'tile:surface:11:10');
  assert.equal(pumped.event.from, 'tile:surface:11:9');
  assert.equal(pumped.event.to, 'tile:surface:13:9');
  assert.equal(pumped.event.device, 'tile:surface:12:9');
  const released = recording.find(row => row.event?.id === 'gas.released' && row.event.from === 'tile:surface:13:9');
  assert.ok(released);
  assert.match(released.event.to, /^room:surface:\d+,\d+$/);
  for (const row of [diffused, pumped, released]) {
    assert.deepEqual(row.event.gas, emptyGas());
    assert.ok(row.event.smoke > 0);
    near(row.event.amount, row.event.smoke);
  }
  assert.ok(extractor.gasStore.smoke > 0);
  assert.deepEqual(reconstruct(recording), observe(s));
  deserialize(serialize(s));
});

test('extractor recording preserves gameplay, reconstructs typed gas changes and replays through shared actions', () => {
  const a = fixture().s, b = deserialize(serialize(a));
  startRecording(a, {maxRecords:10000, maxBytes:32000000});
  const commands = [['gas.extractor', settings()], ['simulation.step', {ticks:4}], ['gas.extractor', settings({mode:'exhaust', target:60})], ['simulation.step', {ticks:4}], ['gas.extractor', settings({enabled:false, mode:'exhaust', target:60})]];
  for (const s of [a, b]) for (const [id, args] of commands) assert.equal(executeAction(s, id, args).ok, true);
  assert.deepEqual(a, b);
  assert.equal(serialize(a), serialize(b));
  const recording = rows(a);
  assert.deepEqual(reconstruct(recording), observe(a));
  const changes = recording.flatMap(row => row.changes || []);
  assert.ok(changes.some(change => change.entity === 'tile:surface:11:9' && change.system === 'gas_networks' && change.path.join('.') === 'gasStore.smoke'));
  assert.ok(changes.some(change => change.entity === 'site:surface' && change.system === 'gas_networks' && change.path[0] === 'gasNetwork'));
  const replay = deserialize(JSON.stringify(recording[0].initialState));
  for (const row of recording) if (row.kind === 'action.requested') assert.equal(executeAction(replay, row.action.id, row.action.args, 'test').ok, true);
  assert.deepEqual(replay, a);
  assert.equal(recordingStatus(replay).reason, 'not_started');
});

test('extractor event volume respects recording bounds without changing simulation or claiming a complete observation', () => {
  const a = fixture().s, b = deserialize(serialize(a));
  startRecording(a, {maxRecords:3});
  for (const s of [a, b]) {
    executeAction(s, 'gas.extractor', settings());
    executeAction(s, 'simulation.step', {ticks:8});
  }
  assert.deepEqual(a, b);
  const recording = rows(a), footer = recording.at(-1);
  assert.equal(footer.active, false);
  assert.equal(footer.reason, 'record_limit');
  assert.equal(footer.records, 3);
  assert.equal(recording[0].initialState.tick, 0);
  assert.equal(reconstruct(recording).tick, footer.throughTick);
  assert.ok(footer.throughTick < a.tick);
});
