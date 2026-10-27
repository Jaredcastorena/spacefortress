import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, updateRooms, serialize, deserialize } from '../src/simulation.js';
import { executeAction, actionCatalog, controlBindings, createAgentInterface } from '../src/controls.js';
import { emptyGas, mix, GASES, GAS_PER_TILE, SUIT_PER_POINT, gasAmount, refreshAtmosphere, roomAt, breathingStatus } from '../src/atmosphere.js';
import { suitReleaseStatus } from '../src/suit-release-status.js';
import { releaseSuitOxygen } from '../src/suit-supply.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { gasNode, newPipe } from '../src/gas-networks.js';
import { observe, startRecording, exportRecording, stopRecording } from '../src/telemetry.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const releases = s => rows(s).filter(r => r.event?.id === 'crew.suit.released').map(r => r.event);
function fixture() {
  const s = createGame(), c = s.crew[0], site = s.sites.surface, room = roomAt(site, c.x, c.y);
  room.gas = emptyGas(); refreshAtmosphere(site); c.oxygen = 25;
  return { s, c, site, room };
}
const act = ({ s, c }, points, source = 'test') => executeAction(s, 'crew.suit.release', { crew: c.id, points }, source);
function unchanged(s, run) {
  const before = structuredClone(s), result = run();
  assert.deepEqual(s, before); return result;
}
function reconstructed(records) {
  const observation = structuredClone(records[0].observation);
  for (const row of records.slice(1, -1)) {
    for (const change of row.changes || []) {
      if (!change.path.length) {
        if (change.op === 'remove') delete observation.entities[change.entity];
        else observation.entities[change.entity] = structuredClone(change.value);
        continue;
      }
      let target = observation.entities[change.entity];
      for (const key of change.path.slice(0, -1)) target = target[key];
      const key = change.path.at(-1);
      if (change.op === 'remove') delete target[key]; else target[key] = structuredClone(change.value);
    }
    if (row.fromTick !== undefined) observation.tick = row.tick;
  }
  return observation;
}
function gasOwners(s) {
  const nodes = emptyGas(), combined = emptyGas();
  const add = (target, source) => { for (const species of GASES) target[species] += source[species]; };
  for (const site of Object.values(s.sites)) {
    for (const tile of site.tiles) if (gasNode(tile)) add(nodes, gasNode(tile).gas);
    for (const room of site.rooms) add(combined, room.gas);
    // Network exterior discharge is already included in atmosphere.vented.
    add(combined, site.atmosphere.vented);
  }
  add(combined, nodes);
  add(combined, mix(totalResources(s).air - gasAmount(nodes)));
  combined.oxygen += s.crew.reduce((n, c) => n + c.oxygen * SUIT_PER_POINT, 0);
  return combined;
}

test('shared command transfers finite suit oxygen into the current sealed room', () => {
  const f = fixture(), { c, room, site } = f, gas = room.gas, rng = f.s.rng;
  const beforeLedger = structuredClone(site.atmosphere), tick = f.s.tick;
  assert.equal(act(f, 7).ok, true);
  assert.equal(c.oxygen, 18); assert.equal(room.gas, gas); assert.equal(room.gas.oxygen, 7 * SUIT_PER_POINT);
  assert.equal(room.gas.inert, 0); assert.equal(room.gas.co2, 0);
  assert.equal(site.atmosphere.injected.oxygen, beforeLedger.injected.oxygen + 7 * SUIT_PER_POINT);
  assert.equal(site.atmosphere.injected.inert, beforeLedger.injected.inert);
  assert.equal(site.atmosphere.injected.co2, beforeLedger.injected.co2);
  assert.deepEqual(site.atmosphere.vented, beforeLedger.vented);
  assert.equal(site.atmosphere.refilled, beforeLedger.refilled); assert.equal(site.atmosphere.breathed, beforeLedger.breathed);
  close(room.pressure, gasAmount(room.gas) / (room.volume * GAS_PER_TILE) * 100);
  assert.equal(f.s.tick, tick); assert.equal(f.s.rng, rng);
});

test('status has a detached stable shape and the same numeric room anchor as telemetry', () => {
  const { s, c, room } = fixture(); room.cells.reverse();
  const source = structuredClone(s), status = suitReleaseStatus(s, c.id), observation = observe(s);
  assert.deepEqual(Object.keys(status).sort(), ['available', 'maxPoints', 'blockedCode', 'message', 'oxygenPerPoint', 'destination'].sort());
  assert.deepEqual(status, { available: true, maxPoints: 25, blockedCode: null, message: null, oxygenPerPoint: SUIT_PER_POINT,
    destination: { site: 'site:surface', tile: `tile:surface:${c.x}:${c.y}`, room: 'room:surface:7,7' } });
  assert.equal(observation.entities[status.destination.room].type, 'room');
  assert.deepEqual(observation.entities[c.id].derived.suitRelease, status);
  assert.deepEqual(s, source, 'neither reader sorts source cells or changes state');
  status.destination.room = 'spoofed'; observation.entities[c.id].derived.suitRelease.maxPoints = 100;
  assert.deepEqual(s, source); assert.equal(suitReleaseStatus(s, c.id).maxPoints, 25);
});

const gates = [
  ['unknown_crew', f => ({ id: 'missing' })],
  ['dead', f => { f.c.health = 0; f.c.medical.injury = 60; f.c.site = 'transit'; }],
  ['immobile', f => { f.c.medical.injury = 60; f.c.site = 'transit'; }],
  ['in_transit', f => { f.c.site = 'transit'; f.c.oxygen = 0; }],
  ['no_site', f => { f.c.site = 'missing'; f.c.oxygen = 0; }],
  ['no_sealed_room', f => { f.c.x = 0; f.c.y = 0; f.c.oxygen = 0; }],
  ['insufficient_suit_oxygen', f => { f.c.oxygen = .9999999999999999; f.room.gas = mix(f.room.volume * GAS_PER_TILE); }],
  ['room_full', f => { f.room.gas = mix(f.room.volume * GAS_PER_TILE); refreshAtmosphere(f.site); }],
];
for (const [code, setup] of gates) test(`ordered ${code} gate rejects atomically`, () => {
  const f = fixture(), id = setup(f)?.id || f.c.id;
  const status = unchanged(f.s, () => suitReleaseStatus(f.s, id));
  assert.equal(status.available, false); assert.equal(status.maxPoints, 0);
  assert.equal(status.blockedCode, code); assert.equal(typeof status.message, 'string');
  if (['insufficient_suit_oxygen', 'room_full'].includes(code)) assert.ok(status.destination);
  else assert.equal(status.destination, null);
  const direct = unchanged(f.s, () => releaseSuitOxygen(f.s, id, 1));
  assert.equal(direct.ok, false); assert.equal(direct.code, code);
  const result = unchanged(f.s, () => executeAction(f.s, 'crew.suit.release', { crew: id, points: 1 }, 'test'));
  assert.equal(result.ok, false);
  assert.equal(result.code, code === 'unknown_crew' ? 'invalid_arguments' : 'simulation_rejected');
  if (code !== 'unknown_crew') assert.equal(result.reason, code);
});

test('a breached current room never accepts a release', () => {
  const f = fixture(); at(f.site, 9, 6).building = null; updateRooms(f.site);
  assert.equal(roomAt(f.site, f.c.x, f.c.y).sealed, false);
  assert.equal(suitReleaseStatus(f.s, f.c.id).blockedCode, 'no_sealed_room');
  assert.equal(unchanged(f.s, () => act(f, 1)).reason, 'no_sealed_room');
});

test('invalid points and forged crew arguments fail without mutation', () => {
  const f = fixture();
  for (const points of [undefined, null, NaN, Infinity, -Infinity, '2', {}, 0, -1, 1.5, 101]) {
    assert.equal(unchanged(f.s, () => releaseSuitOxygen(f.s, f.c.id, points)).code, 'invalid_points');
    const result = unchanged(f.s, () => act(f, points));
    assert.equal(result.ok, false); assert.equal(result.code, 'invalid_arguments');
  }
  const forged = { ...f.c, oxygen: 100 };
  assert.equal(unchanged(f.s, () => releaseSuitOxygen(f.s, forged, 1)).code, 'unknown_crew');
  assert.equal(unchanged(f.s, () => executeAction(f.s, 'crew.suit.release', { crew: f.c.id, points: 1, site: 'wreck' }, 'test')).code, 'invalid_arguments');
});

test('requested reserve shortage precedes requested capacity shortage and neither clamps', () => {
  const f = fixture(); f.c.oxygen = 5.5; f.room.gas = { oxygen: 0, inert: f.room.volume * GAS_PER_TILE - .15, co2: 0 }; refreshAtmosphere(f.site);
  assert.equal(suitReleaseStatus(f.s, f.c.id).maxPoints, 1);
  assert.equal(unchanged(f.s, () => act(f, 6)).reason, 'insufficient_suit_oxygen');
  assert.equal(unchanged(f.s, () => act(f, 2)).reason, 'room_full');
  assert.equal(act(f, 1).ok, true); assert.equal(f.c.oxygen, 4.5);
});

test('fractional reserve exposes the greatest whole release and allows an empty suit', () => {
  for (const [reserve, maximum] of [[0, 0], [.9999999999999999, 0], [1, 1], [1.9, 1], [2.0000000000000004, 2], [99.99999999999999, 99], [100, 100]]) {
    const f = fixture(); f.c.oxygen = reserve;
    assert.equal(suitReleaseStatus(f.s, f.c.id).maxPoints, maximum);
    if (maximum) {
      assert.equal(act(f, maximum).ok, true); assert.equal(f.c.oxygen, reserve - maximum);
      assert.equal(suitReleaseStatus(f.s, f.c.id).maxPoints, 0);
    }
  }
});

test('status and execution use actual prospective species addition at fractional capacity', () => {
  const cases = [
    [{ oxygen: .1, inert: 349.8, co2: 0 }, 1],
    [{ oxygen: .1, inert: 349.8, co2: Number.EPSILON * 350 }, 0],
    [{ oxygen: 0, inert: 349.75, co2: 0 }, 2],
    [{ oxygen: 0, inert: 349.9, co2: 0 }, 1],
  ];
  for (const [gas, maximum] of cases) {
    const f = fixture(); assert.equal(f.room.volume * GAS_PER_TILE, 350); f.c.oxygen = 100;
    f.room.gas = { ...gas }; refreshAtmosphere(f.site);
    assert.equal(suitReleaseStatus(f.s, f.c.id).maxPoints, maximum);
    assert.equal(unchanged(f.s, () => act(f, maximum + 1)).reason, 'room_full');
    if (maximum) {
      assert.equal(act(f, maximum).ok, true);
      assert.ok(gasAmount(f.room.gas) <= f.room.volume * GAS_PER_TILE);
    }
  }
  const gas = cases[0][0];
  // Regrouping the old total would reject a release that the assigned gas holds.
  assert.ok(gasAmount(gas) + SUIT_PER_POINT > 350);
  assert.equal(gasAmount({ ...gas, oxygen: gas.oxygen + SUIT_PER_POINT }), 350);
});

test('status and command recheck current reserve and capacity after a prior observation', () => {
  const f = fixture(); assert.equal(suitReleaseStatus(f.s, f.c.id).maxPoints, 25);
  f.c.oxygen = .5; assert.equal(unchanged(f.s, () => act(f, 1)).reason, 'insufficient_suit_oxygen');
  f.c.oxygen = 25; f.room.gas = mix(350); refreshAtmosphere(f.site);
  assert.equal(unchanged(f.s, () => act(f, 1)).reason, 'room_full');
});

test('fatigue, routine, injury below immobility, intent, job and carried cargo do not gate or change', () => {
  const f = fixture(), { c, s } = f;
  c.health = 1; c.energy = 0; c.hunger = 0; c.thermalStress = 60; c.medical.injury = 59;
  c.life.policy = 'rest'; c.job = 'job-preserved'; c.intent = { type: 'air', target: null }; c.carry = { air: .25, alloy: 1 };
  const original = structuredClone(c), beforeJobs = structuredClone(s.jobs);
  assert.equal(suitReleaseStatus(s, c.id).available, true); assert.equal(act(f, 25).ok, true);
  assert.deepEqual(c, { ...original, oxygen: 0 }); assert.deepEqual(s.jobs, beforeJobs);
});

test('transfer addresses only the actor current room and physical site', () => {
  const f = fixture();
  for (let y = 7; y <= 11; y++) at(f.site, 10, y).building = 'wall'; updateRooms(f.site);
  assert.equal(f.site.rooms.length, 2);
  f.c.x = 8; f.c.y = 8;
  for (const room of f.site.rooms) room.gas = emptyGas(); refreshAtmosphere(f.site);
  const local = roomAt(f.site, 8, 8), other = f.site.rooms.find(r => r !== local), remote = f.s.sites.wreck;
  const remoteBefore = structuredClone(remote), otherBefore = structuredClone(other);
  assert.equal(act(f, 5).ok, true); assert.equal(local.gas.oxygen, .5);
  assert.deepEqual(other, otherBefore); assert.deepEqual(remote, remoteBefore);
  const away = structuredClone(f.site); away.id = 'wreck'; f.s.sites.wreck = away; f.c.site = 'wreck';
  const homeBefore = structuredClone(f.site), awayRoom = roomAt(away, f.c.x, f.c.y), before = awayRoom.gas.oxygen;
  assert.equal(suitReleaseStatus(f.s, f.c.id).destination.site, 'site:wreck');
  assert.equal(act(f, 4).ok, true); assert.equal(awayRoom.gas.oxygen, before + .4); assert.deepEqual(f.site, homeBefore);
});

test('every gas species and whole gas remain owned across inventories, nodes, suits, rooms and escaped gas', () => {
  const f = fixture(), { s, site } = f, nodeTile = at(site, 12, 8), depot = at(site, 8, 10);
  nodeTile.pipe = newPipe(); nodeTile.pipe.gas = mix(2); depot.stock.air -= 2;
  site.gasNetwork.loaded = mix(2);
  site.atmosphere.vented = { oxygen: .3, inert: .8, co2: .2 };
  s.shuttle.freight.air = .75; f.c.carry = { air: .4 };
  f.room.gas = { oxygen: .7, inert: 2.3, co2: .15 }; refreshAtmosphere(site); syncResources(s);
  const before = gasOwners(s), ledger = structuredClone(site.gasNetwork), nodes = structuredClone(nodeTile.pipe);
  const resources = structuredClone(totalResources(s)), vented = structuredClone(site.atmosphere.vented);
  assert.equal(act(f, 13).ok, true);
  const after = gasOwners(s); for (const species of GASES) close(after[species], before[species]);
  close(gasAmount(after), gasAmount(before)); assert.deepEqual(site.gasNetwork, ledger);
  assert.deepEqual(nodeTile.pipe, nodes); assert.deepEqual(totalResources(s), resources); assert.deepEqual(site.atmosphere.vented, vented);
});

test('manual enrichment can produce existing high oxygen status without an added safety gate', () => {
  const f = fixture(); f.c.oxygen = 100; f.room.gas = { oxygen: 104.9, inert: 100, co2: 0 }; refreshAtmosphere(f.site);
  assert.equal(breathingStatus(f.room).block, null);
  assert.equal(suitReleaseStatus(f.s, f.c.id).maxPoints, 100);
  assert.equal(act(f, 2).ok, true); assert.equal(breathingStatus(f.room).block, 'high_oxygen');
  assert.equal(suitReleaseStatus(f.s, f.c.id).available, true);
});

test('typed transfer event identifies both physical owners and rejected attempts produce no release', () => {
  const f = fixture(); startRecording(f.s); assert.equal(act(f, 3).ok, true);
  const event = releases(f.s)[0], destination = suitReleaseStatus(f.s, f.c.id).destination;
  assert.deepEqual(event, { id: 'crew.suit.released', entity: f.c.id, actor: f.c.id, site: destination.site, target: destination.tile,
    room: destination.room, points: 3, oxygen: 3 * SUIT_PER_POINT, suitBefore: 25, suitAfter: 22,
    from: { entity: f.c.id, slot: 'oxygen' }, to: { entity: destination.room, slot: 'gas.oxygen' } });
  assert.equal(act(f, 23).reason, 'insufficient_suit_oxygen');
  assert.equal(releases(f.s).length, 1);
  const attempt = rows(f.s).find(r => r.kind === 'action.result' && r.result?.ok === false);
  assert.ok(rows(f.s).some(r => r.kind === 'action.result' && r.result?.reason === 'insufficient_suit_oxygen'));
  assert.deepEqual(reconstructed(rows(f.s)), observe(f.s));
  assert.equal(attempt?.result?.ok, false);
});

test('action schema, player binding and agent interface share mutation and recording parity', () => {
  const f = fixture(), raw = serialize(f.s), player = deserialize(raw), agent = deserialize(raw), direct = deserialize(raw);
  const definition = actionCatalog().find(a => a.id === 'crew.suit.release');
  assert.deepEqual(definition.parameters.properties, { crew: { type: 'string', entityType: 'crew' }, points: { type: 'integer', minimum: 1, maximum: 100 } });
  assert.deepEqual(definition.parameters.required, ['crew', 'points']); assert.equal(definition.parameters.additionalProperties, false);
  startRecording(player); startRecording(agent);
  assert.equal(controlBindings(() => player).releaseSuitOxygen(player, f.c.id, 11).ok, true);
  assert.equal(createAgentInterface(() => agent).act('crew.suit.release', { crew: f.c.id, points: 11 }).ok, true);
  assert.equal(releaseSuitOxygen(direct, f.c.id, 11).ok, true);
  assert.equal(serialize(player), serialize(agent)); assert.equal(serialize(player), serialize(direct));
  assert.equal(player.rng, f.s.rng); assert.equal(player.tick, f.s.tick);
  assert.deepEqual(reconstructed(rows(player)), observe(player)); assert.deepEqual(reconstructed(rows(agent)), observe(agent));
  assert.equal(rows(player).find(r => r.kind === 'action.requested').action.source, 'player');
  assert.equal(rows(agent).find(r => r.kind === 'action.requested').action.source, 'agent');
  const before = serialize(player); stopRecording(player); observe(player); assert.equal(serialize(player), before);
  assert.equal(serialize(deserialize(before)), before, 'no schema migration or history extension');
});
