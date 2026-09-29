import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo } from '../src/simulation.js';
import { initializeOutpostState } from '../src/outpost-persistence.js';
import { quantity, totalResources } from '../src/inventory.js';
import { startRecording, exportRecording } from '../src/telemetry.js';
import {
  initializeReturnCrew, returnCrewIds, returnCrewMembers, allReturnTravelersDead,
  isReturnTraveler, setReturnCrew, validateReturnCrew, validateShuttle,
  reservedCargo, cargoFree, haulSalvage, boardShuttle, returnWalk, resumeExpedition,
} from '../src/expedition.js';

// These are focused ownership fixtures, not an ordinary-play outpost proof.
function field() {
  const s = createGame();
  s.version = 37; initializeOutpostState(s);
  s.mission = { site: 'wreck', phase: 'working', remaining: 0, fit: 'standard', capacity: 18,
    legacyCapacity: false, crew: ['crew-4', 'crew-2'], cargo: {}, collector: false,
    heat: 0, returnFuel: 1, kitReserved: false };
  initializeReturnCrew(s.mission);
  s.shuttle.supplies = { fuel: 1 };
  s.mission.crew.forEach((id, i) => Object.assign(s.crew.find(c => c.id === id), {
    site: 'wreck', x: 4 + i, y: 10, job: null, intent: null, carry: null, delivery: null,
  }));
  return s;
}
const crew = (s, id = 'crew-4') => s.crew.find(c => c.id === id);
const station = (s, ids) => { s.outposts.wreck.established = true; s.outposts.wreck.residents = [...ids]; };
const events = s => exportRecording(s).trim().split('\n').filter(Boolean).map(JSON.parse).filter(r => r.kind === 'event').map(r => r.event);

test('return initialization copies arrival order only explicitly; readers and validation do not repair current saves', () => {
  const s = field(), m = s.mission;
  assert.deepEqual(returnCrewIds(s), m.crew);
  assert.notEqual(m.returnCrew, m.crew);
  const read = returnCrewIds(s); read.reverse();
  assert.deepEqual(m.returnCrew, ['crew-4', 'crew-2']);
  initializeReturnCrew(m); assert.deepEqual(m.returnCrew, ['crew-4', 'crew-2']);
  delete m.returnCrew;
  const before = structuredClone(s);
  assert.deepEqual(returnCrewIds(s), []);
  assert.throws(() => validateReturnCrew(s), /return roster/);
  assert.deepEqual(s, before);
  s.version = 36;
  assert.deepEqual(returnCrewIds(s), m.crew);
  validateReturnCrew(s);
  assert.equal(Object.hasOwn(m, 'returnCrew'), false);
});

test('explicit passenger order leaves arrival history fixed and emits only actual changes', () => {
  const s = field(), arrival = [...s.mission.crew], request = ['crew-2', 'crew-4'];
  startRecording(s);
  assert.deepEqual(setReturnCrew(s, request), { ok: true });
  assert.deepEqual(returnCrewMembers(s).map(c => c.id), request);
  request.reverse();
  assert.deepEqual(s.mission.returnCrew, ['crew-2', 'crew-4']);
  assert.deepEqual(s.mission.crew, arrival);
  assert.deepEqual(setReturnCrew(s, ['crew-2', 'crew-4']), { ok: true });
  const changed = events(s).filter(e => e.id === 'expedition.return_manifest.changed');
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0].previous, arrival);
  assert.deepEqual(changed[0].next, ['crew-2', 'crew-4']);
  assert.equal(changed[0].site, 'site:wreck');
  assert.deepEqual(changed[0].crewIds, arrival);
});

test('malformed, empty, unknown, away and deceased selection rejects without partial mutation', () => {
  const s = field(); station(s, s.mission.crew);
  for (const ids of [undefined, null, {}, 'crew-4', [], Array(1), ['crew-4', 'crew-4'], ['missing'], [4], ['crew-4', 'crew-2', 'crew-0'], ['crew-0']]) {
    const before = structuredClone(s);
    assert.equal(setReturnCrew(s, ids).ok, false);
    assert.deepEqual(s, before);
  }
  crew(s).health = 0;
  const before = structuredClone(s);
  assert.equal(setReturnCrew(s, ['crew-4']).code, 'return_crew_unavailable');
  assert.deepEqual(s, before);
  s.mission.phase = 'outbound';
  assert.equal(setReturnCrew(s, ['crew-2']).code, 'return_unavailable');
});

test('one visitor can return only after the omitted visitor is resident; local jobs and loads remain owned', () => {
  const s = field(), stay = crew(s, 'crew-2');
  const original = structuredClone(s);
  assert.equal(setReturnCrew(s, ['crew-4']).code, 'unassigned_visitor');
  assert.deepEqual(s, original);
  station(s, [stay.id]);
  stay.job = 'job-700'; stay.carry = { alloy: 2 };
  stay.delivery = { kind: 'job', job: stay.job, target: [9, 9] };
  s.jobs.push({ id: stay.job, kind: 'build', site: 'wreck', worker: stay.id, materials: {}, sources: [] });
  const before = structuredClone({ person: stay, jobs: s.jobs, residents: s.outposts.wreck.residents });
  assert.equal(setReturnCrew(s, ['crew-4']).ok, true);
  assert.deepEqual({ person: stay, jobs: s.jobs, residents: s.outposts.wreck.residents }, before);
  assert.deepEqual(s.mission.crew, ['crew-4', 'crew-2']);
  validateReturnCrew(s);
});

test('resident pickup accepts an injured physical passenger without changing residence or arrival history', () => {
  const s = field(), resident = crew(s, 'crew-0');
  Object.assign(resident, { site: 'wreck', x: 4, y: 11, health: 20, oxygen: 5, hunger: 10, energy: 5 });
  resident.medical.injury = 70;
  station(s, ['crew-2', resident.id]);
  assert.equal(setReturnCrew(s, [resident.id, 'crew-4']).ok, true);
  assert.deepEqual(s.mission.crew, ['crew-4', 'crew-2']);
  assert.deepEqual(s.outposts.wreck.residents, ['crew-2', resident.id]);
  assert.deepEqual(returnCrewMembers(s, { livingOnly: true }).map(c => c.id), [resident.id, 'crew-4']);
  validateReturnCrew(s);
});

test('removed passengers cannot orphan shuttle cargo or pickup claims', () => {
  for (const carried of [false, true]) {
    const s = field(), stay = crew(s, 'crew-2'); station(s, [stay.id]);
    if (carried) { stay.carry = { components: 2 }; stay.delivery = { kind: 'shuttle', target: [4, 11] }; }
    else stay.intent = { type: 'salvage', target: [8, 8], items: { components: 2 } };
    const before = structuredClone(s);
    assert.equal(setReturnCrew(s, ['crew-4']).code, 'return_cargo_pending');
    assert.deepEqual(s, before);
  }
});

test('named deceased travelers remain in the roster; missing IDs and voluntary empty lists are not autopilot', () => {
  const s = field();
  crew(s).health = 0;
  assert.equal(allReturnTravelersDead(s), false);
  crew(s, 'crew-2').health = 0;
  assert.equal(allReturnTravelersDead(s), true);
  assert.deepEqual(returnCrewIds(s), ['crew-4', 'crew-2']);
  assert.deepEqual(returnCrewMembers(s, { livingOnly: true }), []);
  assert.equal(setReturnCrew(s, []).ok, false);
  validateReturnCrew(s);
  s.mission.returnCrew = ['missing'];
  assert.equal(allReturnTravelersDead(s), false);
  assert.equal(returnWalk(s, pathTo), Infinity);
  assert.throws(() => validateReturnCrew(s));
});

test('boarding guards physical site, actual phase and selected passengers without taking local deliveries', () => {
  const s = field(), site = s.sites.wreck, returning = crew(s), stay = crew(s, 'crew-2');
  station(s, [stay.id]); setReturnCrew(s, [returning.id]);
  assert.equal(boardShuttle(s, returning, site, pathTo), false);
  s.mission.phase = 'boarding';
  let before = structuredClone(stay);
  assert.equal(boardShuttle(s, stay, site, pathTo), false); assert.deepEqual(stay, before);
  before = structuredClone(returning);
  assert.equal(boardShuttle(s, returning, s.sites.solar, pathTo), false); assert.deepEqual(returning, before);
  returning.carry = { alloy: 2 }; returning.delivery = { kind: 'job', job: 'job-700', target: [9, 9] };
  before = structuredClone(returning);
  assert.equal(boardShuttle(s, returning, site, pathTo), false);
  assert.equal(haulSalvage(s, returning, site, pathTo), false);
  assert.deepEqual(returning, before);
  returning.carry = null; returning.delivery = null;
  assert.equal(isReturnTraveler(s, returning), true);
  assert.equal(boardShuttle(s, returning, site, pathTo), true);
  assert.deepEqual([returning.x, returning.y], [4, 11]);
  assert.equal(returning.site, 'wreck');
  s.mission = null;
  assert.equal(boardShuttle(s, stay, site, pathTo), false);
});

test('return-route estimates and resume use the return roster instead of needy residents', () => {
  const s = field(), stay = crew(s, 'crew-2'); station(s, [stay.id]);
  assert.equal(setReturnCrew(s, ['crew-4']).ok, true);
  stay.x = 0; stay.y = 0; stay.medical.injury = 70;
  assert.equal(returnWalk(s, pathTo), 1);
  s.mission.phase = 'boarding';
  crew(s).health = 0;
  assert.equal(resumeExpedition(s).ok, false);
  assert.equal(returnWalk(s, pathTo), 0);
  crew(s).health = 80;
  assert.equal(resumeExpedition(s).ok, true);
  assert.equal(s.mission.phase, 'working');
});

test('freight and shuttle claims share capacity while local material stays outside the hold', () => {
  const s = field(), first = crew(s), second = crew(s, 'crew-2');
  s.shuttle.freight = { water: 10 }; s.mission.cargo = { ore: 3 };
  first.carry = { alloy: 4 }; first.delivery = { kind: 'job', job: 'job-700', target: [9, 9] };
  second.intent = { type: 'salvage', target: [8, 8], items: { components: 2 } };
  assert.equal(reservedCargo(s), 2); assert.equal(cargoFree(s), 3);
  second.carry = { components: 2 }; second.delivery = { kind: 'shuttle', target: [4, 11] };
  assert.equal(reservedCargo(s), 2, 'held material must not be added to its stale intent again');
  assert.equal(cargoFree(s), 3);
  const before = structuredClone(first);
  assert.equal(haulSalvage(s, first, s.sites.wreck, pathTo), false);
  assert.deepEqual(first, before);
});

test('local pickup claims and imports cannot be stolen by salvage hauling', () => {
  const s = field(), c = crew(s), local = crew(s, 'crew-2'), site = s.sites.wreck;
  at(site, 4, 11).imports = { components: 8 };
  at(site, 6, 10).drop = { components: 2 };
  local.intent = { type: 'haul', source: 'drop', target: [6, 10], items: { components: 2 }, destination: { kind: 'stock', target: [8, 8] } };
  const before = structuredClone(local);
  assert.equal(haulSalvage(s, c, site, pathTo), false);
  assert.equal(c.intent, null); assert.equal(c.carry, null);
  assert.deepEqual(local, before); assert.deepEqual(at(site, 4, 11).imports, { components: 8 });
  local.intent = null;
  assert.equal(haulSalvage(s, c, site, pathTo), true);
  assert.equal(c.intent?.type, 'salvage');
});

test('dock delivery retains freight and physically spills any shipment overflow', () => {
  const s = field(), c = crew(s), site = s.sites.wreck, dock = at(site, 4, 11);
  c.x = 4; c.y = 11; c.carry = { components: 3 }; c.delivery = { kind: 'shuttle', target: [4, 11] };
  s.shuttle.freight = { water: 17 };
  const before = totalResources(s);
  assert.equal(haulSalvage(s, c, site, pathTo), true);
  assert.deepEqual(s.shuttle.freight, { water: 17 });
  assert.deepEqual(s.mission.cargo, { components: 1 });
  assert.deepEqual(dock.drop, { components: 2 });
  assert.equal(c.carry, null); assert.equal(c.delivery, null);
  assert.equal(quantity(s.shuttle.freight) + quantity(s.mission.cargo), 18);
  assert.deepEqual(totalResources(s), before);
  validateShuttle(s);
});

test('return validation checks phase-specific location, dense IDs and retained residents', () => {
  const s = field();
  for (const ids of [[], ['missing'], ['crew-4', 'crew-4'], Array(1)]) {
    const broken = structuredClone(s); broken.mission.returnCrew = ids;
    assert.throws(() => validateReturnCrew(broken));
  }
  const away = structuredClone(s); crew(away).site = 'surface';
  assert.throws(() => validateReturnCrew(away), /wrong location/);
  station(s, ['crew-2']); setReturnCrew(s, ['crew-4']);
  s.mission.phase = 'returning';
  assert.throws(() => validateReturnCrew(s), /wrong location/);
  crew(s).site = 'transit'; validateReturnCrew(s);
  s.outposts.wreck.residents = [];
  assert.throws(() => validateReturnCrew(s), /residence/);
  const outbound = field(); outbound.mission.phase = 'outbound';
  returnCrewMembers(outbound).forEach(c => { c.site = 'transit'; });
  validateReturnCrew(outbound);
  outbound.mission.returnCrew.reverse();
  assert.throws(() => validateReturnCrew(outbound), /arrival crew/);
});

test('freight validator rejects missing, malformed, aliased and oversized physical inventories', () => {
  const item = { id: 'item-900', maker: 'crew-0', style: 'art', quality: 2, created: 0 };
  for (const freight of [undefined, null, [], new Date(), new Map(), { imaginary: 1 }, { water: -1 }, { water: Infinity }, { water: NaN }, { water: 19 }, { keepsakes: 1 }, { food: 1, _food: [{ amount: 2, age: 10 }] }, { keepsakes: 2, _items: [item, { ...item }] }, { _food: undefined }, { _items: undefined }, { food: 1, _food: Array(1) }, { keepsakes: 1, _items: Array(1) }]) {
    const s = field(); s.shuttle.freight = freight;
    assert.throws(() => validateShuttle(s));
  }
  const s = field();
  s.shuttle.freight = { food: 2, _food: [{ amount: 2, age: 10 }], keepsakes: 1, _items: [item] };
  validateShuttle(s);
  const before = structuredClone(s); validateShuttle(s); assert.deepEqual(s, before);
  s.shuttle.freight = s.shuttle.supplies;
  assert.throws(() => validateShuttle(s), /alias/);
  s.shuttle.freight = { water: 16 }; s.mission.cargo = { components: 3 };
  assert.throws(() => validateShuttle(s), /capacity/);
});

test('a smaller pending refit cannot promise a hold that excludes retained freight', () => {
  const s = field(); s.mission = null; s.shuttle.freight = { water: 13 };
  s.jobs.push({ id: 'job-700', kind: 'refit', site: 'surface', x: 16, y: 11, building: 'shield', materials: {}, sources: [] });
  assert.throws(() => validateShuttle(s), /fitting order/);
  s.shuttle.freight.water = 12;
  validateShuttle(s);
});
