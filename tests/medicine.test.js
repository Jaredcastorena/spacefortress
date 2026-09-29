import { resourceEntries } from '../src/inventory.js';
import { foodAge } from '../src/food-lots.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, setLabor, serialize, deserialize, updateRooms, launch } from '../src/simulation.js';
import { injure } from '../src/medicine.js';
import { initializeStorage, syncResources, totalResources } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
import { fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
const depot = s => at(s.sites.surface, 8, 10);
const until = (s, condition, limit = 250) => { for (let i = 0; i < limit && !condition(); i++) step(s); assert.ok(condition(), `Expected condition before tick ${s.tick}`); };
function clinic() {
  const s = createGame(), cot = at(s.sites.surface, 10, 9); cot.building = 'medicalCot';
  return { s, cot, patient: s.crew[0] };
}
const noMedics = s => s.crew.forEach(c => setLabor(s, c.id, 'medicine', false));

test('injuries persist despite breathable shelter and reduce effective health until treatment', () => {
  const s = createGame(), c = s.crew[0]; injure(s, c, 12, 'debris impact'); step(s, 50);
  assert.equal(c.health, 88); assert.equal(c.medical.injury, 12); assert.match(c.medical.status, /cot/);
});

test('cot construction uses real delivered supplies; a medic carries medicine before treatment and recovery', () => {
  const s = createGame(), c = s.crew[0], build = order(s, 'surface', 10, 9, 'build', 'medicalCot'); assert.ok(build.ok);
  until(s, () => !s.jobs.includes(build.job)); const medicine = totalResources(s).medicine;
  injure(s, c, 8, 'debris impact'); step(s); const j = s.jobs.find(j => j.kind === 'treat'); assert.ok(j); assert.equal(j.remaining, 20); assert.deepEqual(j.materials, {});
  until(s, () => s.crew.some(worker => worker.delivery?.job === j.id)); assert.equal(totalResources(s).medicine, medicine); assert.equal(c.health, 92);
  until(s, () => j.remaining < j.work); assert.equal(j.materials.medicine, 1); assert.notEqual(j.worker, c.id);
  const medic = s.crew.find(worker => worker.id === j.worker); assert.ok(Math.abs(medic.x - 10) + Math.abs(medic.y - 9) === 1); assert.equal(c.x, 10); assert.equal(c.y, 9);
  until(s, () => !s.jobs.includes(j)); assert.equal(totalResources(s).medicine, medicine - 1); assert.ok(c.health < 100); assert.ok(c.medical.treated > 0);
  until(s, () => c.medical.injury === 0); assert.ok(Math.abs(c.health - 100) < 1e-7); assert.equal(c.medical.bed, null); assert.ok(medic.skills.medicine.xp > 0 || medic.skills.medicine.level > 3);
});

test('medicine duties gate treatment and the patient cannot treat themself', () => {
  const { s, patient } = clinic(); noMedics(s); setLabor(s, patient.id, 'medicine', true); injure(s, patient, 10, 'debris impact'); step(s, 20);
  const j = s.jobs.find(j => j.kind === 'treat'); assert.equal(j.worker, null); assert.equal(patient.health, 90);
  setLabor(s, s.crew[5].id, 'medicine', true); until(s, () => patient.medical.treated > 0); assert.ok(s.crew[5].skills.medicine.xp > 0);
});

test('scarce cots are reserved for the most injured crew without duplicate claims', () => {
  const { s } = clinic(); noMedics(s); injure(s, s.crew[0], 5, 'debris impact'); injure(s, s.crew[1], 20, 'solar exposure'); step(s);
  assert.deepEqual(s.crew[1].medical.bed, [10, 9]); assert.equal(s.crew[0].medical.bed, null); assert.equal(s.jobs.filter(j => j.kind === 'treat').length, 1);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('unsafe cot air cancels care and returns medicine without healing the injury', () => {
  const { s, patient } = clinic(); noMedics(s); injure(s, patient, 10, 'debris impact'); step(s); const total = totalResources(s).medicine;
  s.sites.surface.rooms.forEach(r => fillRoom(r, 10)); refreshAtmosphere(s.sites.surface); step(s);
  assert.equal(patient.medical.bed, null); assert.equal(s.jobs.filter(j => j.kind === 'treat').length, 0); assert.equal(totalResources(s).medicine, total); assert.equal(patient.health, 90);
});

test('cancelling a treatment shipment preserves its carrier and delays automatic reordering', () => {
  const { s, patient } = clinic(); const before = totalResources(s).medicine; injure(s, patient, 10, 'debris impact'); step(s); const j = s.jobs.find(j => j.kind === 'treat');
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); const carrier = s.crew.find(c => c.delivery?.job === j.id); cancelJob(s, j.id);
  assert.equal(carrier.carry.medicine, 1); assert.equal(carrier.delivery, null); assert.equal(totalResources(s).medicine, before); step(s, 10); assert.equal(s.jobs.filter(j => j.kind === 'treat').length, 0);
  until(s, () => !carrier.carry); assert.equal(totalResources(s).medicine, before);
});

test('patient death releases reserved treatment supplies and the cot', () => {
  const { s, patient } = clinic(); noMedics(s); injure(s, patient, 10, 'debris impact'); step(s); const before = totalResources(s).medicine;
  patient.health = 0; step(s); assert.equal(patient.medical.bed, null); assert.equal(s.jobs.filter(j => j.kind === 'treat').length, 0); assert.equal(totalResources(s).medicine, before);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('medical recovery waits for bedside food and yields to air emergencies', () => {
  const { s, patient } = clinic(); noMedics(s); injure(s, patient, 10, 'debris impact'); step(s, 4); assert.equal(patient.intent.type, 'medical');
  patient.hunger = 5; step(s); assert.equal(patient.intent.type, 'medical'); assert.ok(s.jobs.some(j => j.kind === 'feed' && j.patient === patient.id)); assert.match(patient.activity, /bedside meal/);
  patient.x = 10; patient.y = 14; patient.oxygen = 1; step(s); assert.equal(patient.intent.type, 'air');
});

test('an injured carrier delivers held construction supplies before medical rest', () => {
  const { s } = clinic(), j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); const c = s.crew.find(c => c.delivery?.job === j.id); injure(s, c, 10, 'debris impact');
  until(s, () => !c.carry); assert.ok(j.materials.alloy === 5 || !s.jobs.includes(j)); until(s, () => c.intent?.type === 'medical');
});

test('a medical synthesizer completes the food-water-medicine-delivery-treatment chain', () => {
  const { s, patient } = clinic(); delete depot(s).stock.medicine; syncResources(s);
  const t = at(s.sites.surface, 12, 9); t.building = 'medlab'; t.cable = { hp: 100, enabled: true }; initializeStorage(t);
  at(s.sites.surface, 13, 9).cable = { hp: 100, enabled: true }; refreshPower(s, s.sites.surface);
  injure(s, patient, 5, 'debris impact'); step(s, 4); assert.equal(s.jobs.filter(j => j.kind === 'treat').length, 0); assert.equal(patient.health, 95);
  until(s, () => t.machine.progress > 0); assert.deepEqual(Object.fromEntries(resourceEntries(t.machine.batch)), { food: 1, water: 1 });
  until(s, () => patient.medical.treated > 0); assert.ok(t.machine.progress >= 0); until(s, () => !patient.medical.injury); assert.ok(patient.health > 99.99);
});

test('damage received after treatment remains untreated and costs another dose', () => {
  const { s, patient } = clinic(); injure(s, patient, 10, 'debris impact'); until(s, () => patient.medical.treated > 0);
  const protectedAmount = patient.medical.treated, before = totalResources(s).medicine; injure(s, patient, 5, 'solar exposure');
  assert.equal(patient.medical.treated, protectedAmount); assert.ok(Math.abs(patient.medical.injury - patient.medical.treated - 5) < 1e-7);
  until(s, () => totalResources(s).medicine < before); assert.equal(totalResources(s).medicine, before - 1);
});

test('treatment and convalescence resume deterministically across saves', () => {
  const { s, patient } = clinic(); injure(s, patient, 15, 'debris impact'); until(s, () => s.jobs.some(j => j.kind === 'treat' && j.remaining < j.work));
  const copy = deserialize(serialize(s)); step(s, 90); step(copy, 90); assert.deepEqual(copy, s);
  const recovering = deserialize(serialize(s)); step(s, 70); step(recovering, 70); assert.deepEqual(recovering, s);
});

test('schema-ten migration adds medical state and duties without restoring health or granting supplies', () => {
  const s = createGame(); s.version = 10; s.crew[0].health = 65; delete s.resources.medicine; delete depot(s).stock.medicine;
  for (const c of s.crew) { delete c.medical; delete c.skills.medicine; delete c.labors.medicine; if (c.favoriteLabor === 'medicine') c.favoriteLabor = 'engineering'; }
  const before = totalResources(s), copy = deserialize(serialize(s)); assert.equal(copy.version, VERSION); assert.equal(copy.crew[0].health, 65); assert.deepEqual(totalResources(copy), before); assert.equal(copy.crew[5].skills.medicine.level, 3);
});

test('invalid medical state, duplicate cot claims and invalid treatment doses are rejected', () => {
  for (const corrupt of [s => s.crew[0].medical.injury = -1, s => s.crew[0].medical.treated = 2, s => s.crew[0].medical.injury = 2, s => s.crew.slice(0, 2).forEach(c => c.medical.bed = [10, 9])]) {
    const s = createGame(); corrupt(s); assert.throws(() => deserialize(serialize(s)));
  }
  const { s, patient } = clinic(); noMedics(s); injure(s, patient, 10, 'debris impact'); step(s); s.jobs.find(j => j.kind === 'treat').dose = 26; assert.throws(() => deserialize(serialize(s)));
});

test('medical production preserves its batch through a cable outage and resumes on repair', () => {
  const { s } = clinic(), t = at(s.sites.surface, 12, 9); t.building = 'medlab'; t.cable = { hp: 100, enabled: true }; initializeStorage(t);
  at(s.sites.surface, 13, 9).cable = { hp: 100, enabled: true }; refreshPower(s, s.sites.surface);
  until(s, () => t.machine.progress > 3); const progress = t.machine.progress, batch = { ...t.machine.batch };
  t.cable.hp = 0; step(s, 10); assert.equal(t.machine.progress, progress); assert.deepEqual(Object.fromEntries(resourceEntries(t.machine.batch)), Object.fromEntries(resourceEntries(batch))); assert.ok(foodAge(t.machine.batch) > foodAge(batch)); assert.equal(t.machine.status, 'No power');
  t.cable.hp = 100; until(s, () => t.machine.progress > progress);
});

test('injury during departure preparation holds the assigned team until treatment', () => {
  const { s, patient } = clinic(); assert.ok(launch(s, 'wreck').ok); assert.ok(s.departure.crew.includes(patient.id)); noMedics(s); injure(s, patient, 2, 'debris impact');
  step(s, 80); assert.equal(s.mission, null); assert.ok(s.departure); assert.equal(patient.site, 'surface');
  setLabor(s, s.crew[5].id, 'medicine', true); until(s, () => s.mission); assert.equal(patient.medical.injury, 0); assert.equal(patient.site, 'transit');
});

test('treatment waits for an absent patient and preserves work during their meal', () => {
  const { s, patient } = clinic(); injure(s, patient, 10, 'debris impact'); until(s, () => s.jobs.some(j => j.kind === 'treat' && j.remaining < j.work));
  const j = s.jobs.find(j => j.kind === 'treat'), remaining = j.remaining;
  patient.hunger = 0; patient.x = 8; patient.y = 10; step(s, 5); assert.equal(j.remaining, remaining); assert.ok(patient.intent?.type === 'meal');
  until(s, () => patient.medical.treated > 0); assert.ok(patient.health < 100);
});
