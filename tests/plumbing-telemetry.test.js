import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { initializeStorage, syncResources } from '../src/inventory.js';
import { initializeElectrical, refreshPower, updatePower } from '../src/power.js';
import { newPipe } from '../src/gas-networks.js';
import { newWaterPipe, operatePlumbing } from '../src/plumbing.js';
import { actionCatalog, executeAction, controlBindings, createAgentInterface } from '../src/controls.js';
import { observe, startRecording, exportRecording, recordingStatus } from '../src/telemetry.js';

const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const xy = (x, y = 9) => ({site:'surface', x, y});
const deviceArgs = (x, extra = {}) => ({...xy(x), enabled:true, direction:'east', ...extra});
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function base() {
  const s = createGame(), site = s.sites.surface;
  for (const tile of site.tiles) if (tile.machine) tile.machine.enabled = false;
  for (const crew of s.crew) { crew.labors.hauling = false; crew.labors.production = false; }
  for (let x = 8; x <= 13; x++) at(site, x, 9).cable = {enabled:true, hp:100};
  return {s, site};
}
function install(s, building, x, y = 9) {
  const tile = at(s.sites.surface, x, y);
  assert.equal(tile.building, null);
  tile.building = building;
  initializeStorage(tile);
  initializeElectrical(tile);
  return tile;
}
function controlFixture() {
  const {s, site} = base();
  const pump = install(s, 'waterPump', 11), intake = install(s, 'waterIntake', 12), outlet = install(s, 'waterOutlet', 13);
  const pipe = at(site, 11, 8); pipe.waterPipe = newWaterPipe();
  refreshPower(s, site);
  return {s, site, pump, intake, outlet, pipe};
}
function chain(mode = 'inventory') {
  const {s, site} = base();
  const intake = install(s, 'waterIntake', 10), outlet = install(s, 'waterOutlet', 12), node = at(site, 11, 9);
  node.waterPipe = newWaterPipe();
  const source = mode === 'inventory' ? install(s, 'waterTank', 9) : at(site, 9, 9);
  const target = mode === 'inventory' ? install(s, 'farm', 13) : at(site, 13, 9);
  at(site, 8, 10).stock.water -= 2;
  if (mode === 'inventory') { source.machine.input.water = 2; source.machine.enabled = false; }
  else { source.liquid = 2; site.liquids.released += 2; }
  intake.waterDevice.mode = mode;
  outlet.waterDevice.mode = mode;
  syncResources(s);
  refreshPower(s, site);
  return {s, site, intake, outlet, node, source, target};
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

test('plumbing catalog defines strict controls, physical work kinds and detached constants', () => {
  const catalog = actionCatalog();
  for (const kind of ['valve','pump','intake','outlet']) {
    const entry = catalog.find(action => action.id === `plumbing.${kind}`);
    assert.ok(entry);
    assert.equal(entry.parameters.additionalProperties, false);
    assert.deepEqual(entry.parameters.required, ['site','x','y', ...(kind === 'valve' ? ['open'] : ['enabled','direction', ...(['intake','outlet'].includes(kind) ? ['mode'] : [])])]);
    if (kind !== 'valve') assert.deepEqual(entry.parameters.properties.direction.enum, ['east','south','west','north']);
    if (['intake','outlet'].includes(kind)) assert.deepEqual(entry.parameters.properties.mode.enum, ['inventory','floor']);
  }
  const workKinds = catalog.find(action => action.id === 'job.order').parameters.properties.kind.enum;
  assert.ok(workKinds.includes('repairWaterPipe') && workKinds.includes('removeWaterPipe'));
  const {s} = base(), api = createAgentInterface(() => s), definitions = api.definitions();
  assert.equal(definitions.plumbing.pipeCapacity, 2);
  assert.equal(definitions.plumbing.reservoirCapacity, 32);
  assert.deepEqual(definitions.waterDirections.east, [1,0]);
  definitions.plumbing.pipeCapacity = 999;
  definitions.waterDirections.east[0] = 999;
  assert.equal(api.definitions().plumbing.pipeCapacity, 2);
  assert.deepEqual(api.definitions().waterDirections.east, [1,0]);
});

test('every plumbing control uses identical player and agent rules with linked request, event and result records', () => {
  const a = controlFixture().s, b = deserialize(serialize(a));
  startRecording(a); startRecording(b);
  const controls = controlBindings(() => a), api = createAgentInterface(() => b);
  assert.ok(controls.setWaterValve(a, 'surface', 11, 8, false).ok);
  assert.ok(controls.setWaterPump(a, 'surface', 11, 9, false, 'north').ok);
  assert.ok(controls.setWaterIntake(a, 'surface', 12, 9, true, 'south', 'floor').ok);
  assert.ok(controls.setWaterOutlet(a, 'surface', 13, 9, false, 'west', 'floor').ok);
  for (const [id, args] of [
    ['plumbing.valve', {...xy(11, 8), open:false}],
    ['plumbing.pump', deviceArgs(11, {enabled:false, direction:'north'})],
    ['plumbing.intake', deviceArgs(12, {direction:'south', mode:'floor'})],
    ['plumbing.outlet', deviceArgs(13, {enabled:false, direction:'west', mode:'floor'})],
  ]) assert.ok(api.act(id, args).ok);
  assert.deepEqual(a, b);
  for (const [s, source] of [[a, 'player'], [b, 'agent']]) {
    const recording = rows(s), requests = recording.filter(row => row.kind === 'action.requested');
    assert.equal(requests.length, 4);
    for (const request of requests) {
      assert.equal(request.action.source, source);
      const event = recording.find(row => row.kind === 'event' && row.command === request.sequence);
      assert.equal(event.event.id, request.action.id === 'plumbing.valve' ? 'plumbing.valve.changed' : 'plumbing.device.changed');
      assert.equal(event.event.entity, `tile:surface:${request.action.args.x}:${request.action.args.y}`);
      assert.equal(recording.find(row => row.kind === 'action.result' && row.command === request.sequence).result.code, 'applied');
    }
  }
});

test('plumbing rejects bad arguments and wrong equipment without changing device state or observations', () => {
  const {s} = controlFixture();
  startRecording(s);
  const before = serialize(s), observed = observe(s);
  const requests = [
    ['plumbing.valve', {...xy(11, 8), open:'yes'}],
    ['plumbing.pump', deviceArgs(11, {direction:'up'})],
    ['plumbing.pump', deviceArgs(11, {enabled:1})],
    ['plumbing.intake', deviceArgs(12, {mode:'gas'})],
    ['plumbing.outlet', deviceArgs(13)],
    ['plumbing.outlet', deviceArgs(13, {mode:'floor', extra:true})],
    ['plumbing.pump', deviceArgs(12)],
    ['plumbing.intake', deviceArgs(13, {mode:'floor'})],
    ['plumbing.outlet', deviceArgs(11, {mode:'inventory'})],
    ['plumbing.valve', {...xy(12), open:false}],
  ];
  for (const [id, args] of requests) assert.equal(executeAction(s, id, args).ok, false);
  assert.equal(serialize(s), before);
  assert.deepEqual(observe(s), observed);
  const recording = rows(s), results = recording.filter(row => row.kind === 'action.result');
  assert.equal(results.length, requests.length);
  assert.ok(results.every(row => row.result.ok === false && row.changes.length === 0));
  assert.ok(results.some(row => row.result.code === 'invalid_arguments'));
  assert.ok(results.some(row => row.result.code === 'simulation_rejected'));
  assert.equal(recording.some(row => row.kind === 'event'), false);
});

test('water overlay observations preserve simultaneous gas, reactor and radiator conditions', () => {
  const {s, site} = base(), reactor = install(s, 'reactor', 11), radiator = install(s, 'radiator', 12, 13), ordinary = at(site, 12, 9);
  for (const tile of [reactor, radiator, ordinary]) tile.pipe = newPipe();
  refreshPower(s, site);
  const previous = observe(s);
  for (const tile of [reactor, radiator, ordinary]) tile.waterPipe = newWaterPipe();
  const observations = observe(s);
  for (const tile of [reactor, radiator, ordinary]) {
    const id = `tile:surface:${tile.x}:${tile.y}`, {plumbing, ...existing} = observations.entities[id].derived;
    assert.deepEqual(existing, previous.entities[id].derived);
    assert.equal(plumbing.water, 0);
    assert.equal(plumbing.capacity, 2);
    assert.equal(plumbing.fill, 0);
    assert.equal(typeof plumbing.status, 'string');
    observations.entities[id].waterPipe.water = 2;
    assert.equal(tile.waterPipe.water, 0);
  }
  assert.ok(Number.isFinite(observations.entities['tile:surface:11:9'].derived.reactorTemperature));
  assert.ok(Array.isArray(observations.entities['tile:surface:12:13'].derived.targets));
  assert.equal(observations.entities['tile:surface:12:9'].derived.status, 'Empty');
});

test('same-tick inventory transfers retain owner slots and semantic boundaries when the pipe finishes empty', () => {
  const {s, site, node, source, target} = chain();
  updatePower(s, site);
  startRecording(s);
  for (let i = 0; i < 6; i++) operatePlumbing(s);
  near(source.machine.input.water || 0, 0);
  near(target.machine.input.water, 2);
  near(node.waterPipe.water, 0);
  const recording = rows(s), loaded = recording.filter(row => row.event?.id === 'plumbing.loaded'), delivered = recording.filter(row => row.event?.id === 'plumbing.delivered');
  assert.ok(loaded.length && delivered.length);
  for (const row of loaded) {
    assert.deepEqual(row.event.from, {entity:'tile:surface:9:9', slot:'machine.input'});
    assert.deepEqual(row.event.to, {entity:'tile:surface:11:9', slot:'waterPipe'});
    assert.equal(row.event.device, 'tile:surface:10:9');
  }
  for (const row of delivered) {
    assert.deepEqual(row.event.from, {entity:'tile:surface:11:9', slot:'waterPipe'});
    assert.deepEqual(row.event.to, {entity:'tile:surface:13:9', slot:'machine.input'});
    assert.equal(row.event.device, 'tile:surface:12:9');
    assert.equal(row.event.reason, 'supply');
  }
  for (const row of [...loaded, ...delivered]) { assert.equal(row.tick, 0); assert.ok(row.event.amount > 0); }
  assert.equal(recording.flatMap(row => row.changes || []).some(change => change.entity === 'tile:surface:11:9' && change.path.join('.') === 'waterPipe.water'), false);
  assert.ok(recording.some(row => row.kind === 'external' && row.command === null));
  assert.deepEqual(reconstruct(recording), observe(s));
  deserialize(serialize(s));
});

test('floor adapters name the liquid and node owners and expose actual blocked conditions', () => {
  const {s, site, source, target} = chain('floor');
  updatePower(s, site);
  startRecording(s);
  for (let i = 0; i < 6; i++) operatePlumbing(s);
  near(source.liquid, 0); near(target.liquid, 2);
  const recording = rows(s), recovered = recording.find(row => row.event?.id === 'plumbing.recovered'), released = recording.find(row => row.event?.id === 'plumbing.released');
  assert.ok(recovered && released);
  assert.deepEqual(recovered.event.from, {entity:'tile:surface:9:9', slot:'liquid'});
  assert.deepEqual(recovered.event.to, {entity:'tile:surface:11:9', slot:'waterPipe'});
  assert.deepEqual(released.event.from, {entity:'tile:surface:11:9', slot:'waterPipe'});
  assert.deepEqual(released.event.to, {entity:'tile:surface:13:9', slot:'liquid'});
  assert.equal(released.event.reason, 'outlet');
  const state = observe(s).entities['tile:surface:10:9'].derived.plumbing;
  assert.equal(state.blockedCode, 'source_empty');
  assert.equal(state.input, 'tile:surface:9:9');
  assert.equal(state.output, 'tile:surface:11:9');
  assert.equal(state.inputSlot, 'liquid');
  assert.equal(state.outputSlot, 'waterPipe');
  assert.ok(Number.isFinite(state.reservedInput) && Number.isFinite(state.reservedOutput));
  executeAction(s, 'plumbing.intake', deviceArgs(10, {mode:'floor', enabled:false}));
  assert.equal(observe(s).entities['tile:surface:10:9'].derived.plumbing.blockedCode, 'disabled');
  assert.deepEqual(reconstruct(rows(s)), observe(s));
  deserialize(serialize(s));
});

test('detached plumbing observations distinguish source output claims from incoming target reservations', () => {
  const {s, site} = base(), source = install(s, 'bilgePump', 9), target = install(s, 'farm', 13);
  install(s, 'waterIntake', 10); install(s, 'waterOutlet', 12);
  source.machine.enabled = false;
  source.machine.output.water = 2;
  at(site, 11, 9).waterPipe = {...newWaterPipe(), water:1};
  site.plumbing.loaded += 1;
  s.crew[0].intent = {type:'haul', source:'output', target:[9,9], items:{water:1}, destination:{kind:'stock', target:[8,10]}};
  s.crew[1].carry = {water:.75};
  s.crew[1].delivery = {kind:'input', target:[13,9]};
  s.crew[2].intent = {type:'haul', source:'stock', target:[8,10], items:{water:.5}, destination:{kind:'input', target:[13,9]}};
  at(site, 8, 10).stock.water -= 3.75;
  syncResources(s);
  refreshPower(s, site); updatePower(s, site);
  const intake = () => observe(s).entities['tile:surface:10:9'].derived.plumbing;
  const outlet = () => observe(s).entities['tile:surface:12:9'].derived.plumbing;
  let observed = intake();
  assert.equal(observed.inputSlot, 'machine.output');
  assert.equal(observed.reservedOutput, 1);
  assert.equal(observed.reservedInput, 0);
  assert.equal(observed.sourceAvailable, 1);
  observed = outlet();
  assert.equal(observed.outputSlot, 'machine.input');
  assert.equal(observed.reservedInput, 1.25);
  assert.equal(observed.reservedOutput, 0);
  near(observed.targetFree, .75);
  observed.reservedInput = 999;
  assert.equal(outlet().reservedInput, 1.25);
  s.crew[0].intent.items.water = 2;
  assert.equal(intake().blockedCode, 'source_reserved');
  s.crew[1].carry.water = 1.5;
  assert.equal(outlet().blockedCode, 'target_reserved');
  assert.equal(source.machine.output.water, 2);
  assert.equal(target.machine.input.water || 0, 0);
});

test('plumbing recordings reconstruct typed changes and replay shared commands without changing saves or RNG', () => {
  const a = chain().s, b = deserialize(serialize(a));
  startRecording(a, {maxRecords:10000, maxBytes:32000000});
  const commands = [
    ['plumbing.intake', deviceArgs(10, {mode:'inventory'})],
    ['plumbing.outlet', deviceArgs(12, {mode:'inventory'})],
    ['simulation.step', {ticks:6}],
    ['plumbing.intake', deviceArgs(10, {mode:'inventory', enabled:false})],
    ['plumbing.valve', {...xy(11), open:false}],
    ['simulation.step', {ticks:2}],
  ];
  for (const s of [a, b]) for (const [id, args] of commands) assert.ok(executeAction(s, id, args).ok);
  assert.deepEqual(a, b);
  assert.equal(serialize(a), serialize(b));
  const recording = rows(a), changes = recording.flatMap(row => row.changes || []);
  assert.ok(changes.some(change => change.system === 'plumbing' && change.entity === 'site:surface' && change.path[0] === 'plumbing'));
  assert.ok(changes.some(change => change.system === 'plumbing' && change.path[0] === 'waterDevice'));
  assert.ok(changes.some(change => change.system === 'plumbing' && change.path[0] === 'waterPipe'));
  assert.deepEqual(reconstruct(recording), observe(a));
  const replay = deserialize(JSON.stringify(recording[0].initialState));
  for (const row of recording) if (row.kind === 'action.requested') assert.ok(executeAction(replay, row.action.id, row.action.args, 'test').ok);
  assert.deepEqual(replay, a);
  assert.equal(recordingStatus(replay).reason, 'not_started');
});

test('bounded plumbing recording stops explicitly while gameplay continues identically', () => {
  const a = chain().s, b = deserialize(serialize(a));
  startRecording(a, {maxRecords:3});
  for (const s of [a, b]) {
    executeAction(s, 'plumbing.intake', deviceArgs(10, {mode:'inventory'}));
    executeAction(s, 'simulation.step', {ticks:8});
  }
  assert.deepEqual(a, b);
  const recording = rows(a), footer = recording.at(-1);
  assert.equal(footer.active, false);
  assert.equal(footer.reason, 'record_limit');
  assert.equal(footer.records, 3);
  assert.ok(footer.throughTick < a.tick);
  assert.equal(reconstruct(recording).tick, footer.throughTick);
});
