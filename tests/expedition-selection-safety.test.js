import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, launch, cancelDeparture, recall, step, at, order, setLabor, serialize, deserialize, updateRooms } from '../src/simulation.js';
import { setLifePolicy } from '../src/crew-life.js';
import { setMachineEnabled } from '../src/industry.js';
import { injure } from '../src/medicine.js';
import { carriedBy, atCot } from '../src/nursing.js';
import { setDoorMode, roomAt, breathable } from '../src/atmosphere.js';
import { totalResources, quantity } from '../src/inventory.js';
import { tryDeparture, departureReadiness } from '../src/preflight.js';

const TEAM = ['crew-6', 'crew-2'];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function colony() {
  const s = createGame();
  for (const c of s.crew) { setLifePolicy(s, c.id, 'work'); c.labors.production = false; }
  for (const t of s.sites.surface.tiles) if (t.machine && t.building !== 'scrubber') setMachineEnabled(s, 'surface', t.x, t.y, false);
  return s;
}
const members = (s, ids = TEAM) => ids.map(id => s.crew.find(c => c.id === id));
function until(s, condition, limit = 300, each = null) {
  for (let i = 0; i < limit && !condition(); i++) { step(s); each?.(); }
  assert.ok(condition(), `Expected transition at tick ${s.tick}: ${s.departure?.status || s.mission?.phase}`);
}
function plan(s, site = 'wreck', ids = TEAM) {
  const result = launch(s, site, ids); assert.ok(result.ok, result.message);
  assert.deepEqual(s.departure.crew, ids); return s.departure;
}
function boarding(s = colony(), site = 'wreck', ids = TEAM) {
  plan(s, site, ids); until(s, () => s.departure?.stage === 'boarding');
  assert.equal(s.mission, null); return s;
}
function launchPhysically(s, ids = TEAM, limit = 300) {
  until(s, () => !!s.mission, limit, () => {
    if (s.departure) assert.deepEqual(s.departure.crew, ids);
  });
  assert.deepEqual(s.mission.crew, ids);
  for (const c of members(s, ids)) { assert.equal(c.site, 'transit'); assert.deepEqual([c.x, c.y], [16, 11]); }
}
function field() {
  const s = boarding(); launchPhysically(s); until(s, () => s.mission?.phase === 'working'); return s;
}

test('a selected member going off duty after loading stays home until their routine changes', () => {
  const s = boarding(), [c] = members(s), fuel = totalResources(s).fuel;
  assert.ok(setLifePolicy(s, c.id, 'rest').ok);
  for (let i = 0; i < 12; i++) {
    const before = [c.x, c.y]; step(s);
    assert.equal(s.mission, null); assert.equal(c.site, 'surface'); assert.deepEqual(s.departure.crew, TEAM);
    assert.ok(Math.abs(c.x - before[0]) + Math.abs(c.y - before[1]) <= 1);
  }
  assert.equal(c.intent?.type, 'leisure'); close(totalResources(s).fuel, fuel);
  assert.ok(setLifePolicy(s, c.id, 'work').ok); launchPhysically(s);
});

test('selected fatigue and hunger create real recovery intentions that boarding cannot erase', () => {
  for (const [field, value, intent] of [['energy', 30, 'rest'], ['hunger', 30, 'meal']]) {
    const s = boarding(), [c] = members(s), before = totalResources(s);
    c[field] = value; step(s);
    assert.equal(s.mission, null); assert.equal(c.intent?.type, intent); assert.deepEqual(s.departure.crew, TEAM);
    const spentFood = totalResources(s).food;
    step(s, 2); assert.equal(s.mission, null); assert.ok(c.intent || c[field] >= 40);
    launchPhysically(s, TEAM, 350);
    assert.ok(c[field] >= 40); close(totalResources(s).fuel, before.fuel - 1);
    if (intent === 'meal') assert.ok(totalResources(s).food < before.food && totalResources(s).food <= spentFood);
  }
});

test('a selected injured member receives supplied medical care before walking aboard', () => {
  const s = colony(), cot = at(s.sites.surface, 10, 9); cot.building = 'medicalCot'; boarding(s);
  const [c] = members(s), medicine = totalResources(s).medicine;
  injure(s, c, 1, 'debris impact'); step(s);
  assert.equal(s.mission, null); assert.equal(c.medical.injury, 1); assert.ok(c.medical.bed);
  until(s, () => c.medical.treated > 0);
  assert.equal(s.mission, null); assert.ok(atCot(s, c)); close(totalResources(s).medicine, medicine - 1);
  launchPhysically(s); assert.equal(c.medical.injury, 0); assert.equal(c.medical.bed, null);
});

test('late thermal and low-health conditions delay the selected member without replacing them', () => {
  const hot = boarding(), [c] = members(hot); assert.ok(breathable(roomAt(hot.sites.surface, c.x, c.y)));
  c.thermalStress = 48; step(hot);
  assert.equal(hot.mission, null); assert.equal(c.intent?.type, 'temperature');
  until(hot, () => c.thermalStress <= 10);
  assert.equal(hot.mission, null); assert.deepEqual(hot.departure.crew, TEAM);
  launchPhysically(hot); assert.ok(c.thermalStress <= 10);

  const low = boarding(), [recovering] = members(low); assert.ok(breathable(roomAt(low.sites.surface, recovering.x, recovering.y)));
  recovering.health = 49.99; const fuel = totalResources(low).fuel;
  tryDeparture(low, () => {}); assert.equal(low.mission, null); close(totalResources(low).fuel, fuel);
  step(low); assert.ok(recovering.health > 50, 'Natural habitat healing must occur before acceptance');
  launchPhysically(low);
});

test('selected construction carriers finish their real shipment without losing the job claim during boarding', () => {
  const s = colony(), site = s.sites.surface, [builder] = members(s);
  for (const c of s.crew) { c.labors.construction = c.id === builder.id; c.labors.hauling = c.id === 'crew-4'; }
  const target = at(site, 20, 18); target.terrain = 'ground'; target.building = null;
  for (const [x, y] of [[19, 18], [21, 18], [20, 17], [20, 19]]) {
    const t = at(site, x, y); t.terrain = 'floor'; t.building = x === 19 ? 'door' : 'wall';
  }
  updateRooms(site); setDoorMode(s, 'surface', 19, 18, 'auto');
  const j = order(s, 'surface', 20, 18, 'build', 'solar').job; assert.ok(j);
  until(s, () => builder.job === j.id && !builder.carry);
  plan(s); until(s, () => builder.delivery?.job === j.id && !!builder.carry);
  assert.ok(setDoorMode(s, 'surface', 19, 18, 'closed').ok);
  const held = structuredClone(builder.carry), alloy = totalResources(s).alloy;
  until(s, () => s.departure?.stage === 'boarding'); step(s, 3);
  assert.equal(s.mission, null); assert.deepEqual(builder.carry, held); assert.equal(builder.delivery.job, j.id);
  assert.ok(s.jobs.includes(j)); assert.deepEqual(j.materials, {}); close(totalResources(s).alloy, alloy);
  assert.ok(setDoorMode(s, 'surface', 19, 18, 'auto').ok);
  until(s, () => builder.carry === null && j.materials.alloy === 5);
  launchPhysically(s); assert.ok(s.jobs.includes(j)); assert.equal(j.materials.alloy, 5); close(totalResources(s).alloy, alloy);
  deserialize(serialize(s));
});

test('a selected rescuer keeps their patient claim and carries them to shelter before boarding', () => {
  const s = colony(), ids = ['crew-5', 'crew-6'], patient = s.crew[0];
  at(s.sites.surface, 10, 9).building = 'medicalCot';
  for (const c of s.crew) c.labors.medicine = c.id === ids[0];
  boarding(s, 'wreck', ids); patient.x = 10; patient.y = 15; injure(s, patient, 65, 'debris impact');
  const rescuer = s.crew.find(c => c.id === ids[0]); until(s, () => !!carriedBy(s, patient));
  assert.equal(carriedBy(s, patient).id, rescuer.id); assert.equal(s.mission, null); assert.deepEqual(s.departure.crew, ids);
  for (let i = 0; i < 3 && carriedBy(s, patient); i++) {
    const before = [patient.x, patient.y]; step(s); assert.equal(s.mission, null);
    assert.ok(Math.abs(patient.x - before[0]) + Math.abs(patient.y - before[1]) <= 1);
    if (rescuer.rescue) assert.equal(rescuer.rescue.patient, patient.id);
  }
  until(s, () => atCot(s, patient) && !carriedBy(s, patient));
  assert.ok(patient.memories.some(m => m.kind === 'rescued'));
  launchPhysically(s, ids); assert.equal(patient.site, 'surface'); assert.ok(patient.health > 0);
});

test('a late blocked boarding route and damaged shuttle require reopening and supplied repair', () => {
  const s = colony(); for (const c of members(s)) c.labors.hauling = false;
  boarding(s); const [c] = members(s), ship = at(s.sites.surface, 16, 11), fuel = totalResources(s).fuel;
  assert.ok(c.x < 14 && c.y < 12); assert.ok(setDoorMode(s, 'surface', 10, 12, 'closed').ok);
  step(s, 5); assert.equal(s.mission, null); assert.match(c.activity, /blocked/i); assert.deepEqual(s.departure.crew, TEAM);
  assert.equal(departureReadiness(s).crew.find(member => member.id === c.id).routeBlocked, true);
  ship.hp = 20; setDoorMode(s, 'surface', 10, 12, 'auto'); step(s, 12);
  assert.equal(s.mission, null); close(totalResources(s).fuel, fuel); assert.match(s.departure.status, /damaged|repair/i);
  const alloy = totalResources(s).alloy, repair = order(s, 'surface', 16, 11, 'repair'); assert.ok(repair.ok);
  launchPhysically(s); assert.equal(ship.hp, 100); close(totalResources(s).alloy, alloy - 1);
});

test('a selected comet team misses a closing window without consuming departure fuel or switching identities', () => {
  const s = colony(); s.tick = 390; plan(s, 'comet'); const fuel = totalResources(s).fuel;
  step(s, 120); assert.equal(s.mission, null); assert.deepEqual(s.departure.crew, TEAM);
  assert.match(s.departure.status, /window closed/i); close(totalResources(s).fuel, fuel);
  const loaded = structuredClone(s.shuttle.supplies); assert.ok(cancelDeparture(s).ok);
  assert.deepEqual(s.shuttle.supplies, loaded); assert.equal(s.mission, null);
});

test('death during selected-team loading cannot substitute a healthy crewmate or spend flight fuel', () => {
  const s = colony(); for (const c of s.crew) c.labors.hauling = false;
  plan(s); const [dead, survivor] = members(s), fuel = totalResources(s).fuel;
  injure(s, dead, 100, 'debris impact'); const position = [dead.x, dead.y]; step(s, 3);
  assert.equal(s.mission, null); assert.deepEqual(s.departure.crew, TEAM); assert.equal(dead.health, 0);
  assert.deepEqual([dead.x, dead.y], position); assert.equal(survivor.site, 'surface'); assert.match(s.departure.status, /unavailable|dead|health/i);
  setLabor(s, 'crew-4', 'hauling', true); until(s, () => s.shuttle.supplies.fuel >= 2);
  step(s, 3); assert.equal(s.mission, null); assert.deepEqual(s.departure.crew, TEAM); close(totalResources(s).fuel, fuel);
  assert.ok(cancelDeparture(s).ok); deserialize(serialize(s));
});

test('a selected field carrier death keeps its identity and physical cargo while only the survivor returns', () => {
  const s = field(), site = s.sites.wreck;
  assert.ok(order(s, 'wreck', 5, 6, 'mine').ok);
  until(s, () => members(s).some(c => c.carry && quantity(c.carry)));
  const dead = members(s).find(c => c.carry), survivor = members(s).find(c => c !== dead), cargo = totalResources(s), location = [dead.x, dead.y];
  injure(s, dead, 100, 'debris impact'); step(s);
  assert.equal(dead.health, 0); assert.equal(dead.carry, null); assert.deepEqual(s.mission.crew, TEAM);
  close(totalResources(s).components, cargo.components); close(totalResources(s).alloy, cargo.alloy);
  if (s.mission.phase === 'working') assert.ok(recall(s).ok);
  until(s, () => !s.mission); assert.equal(dead.site, 'wreck'); assert.deepEqual([dead.x, dead.y], location);
  assert.equal(dead.health, 0); assert.equal(survivor.site, 'surface'); assert.equal(s.crew.length, 7);
  close(totalResources(s).components, cargo.components); close(totalResources(s).alloy, cargo.alloy); deserialize(serialize(s));
});

test('the explicitly chosen field partner rescues an incapacitated teammate and retains loaded salvage', () => {
  const s = field(); assert.ok(order(s, 'wreck', 5, 6, 'mine').ok);
  until(s, () => (s.mission.cargo.components || 0) > 0);
  const [patient, helper] = members(s); for (const c of members(s)) c.labors.hauling = false;
  until(s, () => members(s).every(c => !c.carry));
  patient.labors.mining = true; helper.labors.mining = false;
  const work = order(s, 'wreck', 12, 6, 'mine'); assert.ok(work.ok);
  until(s, () => patient.job === work.job.id && patient.x >= 7);
  const cargo = structuredClone(s.mission.cargo); injure(s, patient, 65, 'debris impact'); assert.ok(recall(s).ok);
  until(s, () => !!carriedBy(s, patient)); assert.equal(carriedBy(s, patient).id, helper.id);
  assert.equal(s.mission.phase, 'boarding'); assert.deepEqual(s.mission.crew, TEAM); assert.deepEqual(s.mission.cargo, cargo);
  until(s, () => s.mission?.phase === 'returning', 160, () => { if (s.mission) assert.deepEqual(s.mission.cargo, cargo); });
  assert.equal(patient.site, 'transit'); assert.equal(helper.rescue, null); assert.ok(patient.medical.injury >= 60);
  until(s, () => !s.mission); assert.equal(patient.site, 'surface'); assert.equal(helper.site, 'surface');
  assert.ok(patient.health > 0); assert.ok(patient.medical.injury >= 60); deserialize(serialize(s));
});
