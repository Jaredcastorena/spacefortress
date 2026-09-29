import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, setLabor, serialize, deserialize, recall, pathTo } from '../src/simulation.js';
import { injure } from '../src/medicine.js';
import { moveCrew, setDoorMode } from '../src/atmosphere.js';
import { immobile } from '../src/mobility.js';
import { carriedBy, atCot } from '../src/nursing.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { returnWalk } from '../src/expedition.js';
import { depart } from './helpers/depart.js';
const until = (s, condition, limit = 300) => { for (let i = 0; i < limit && !condition(); i++) { step(s); deserialize(serialize(s)); } assert.ok(condition(), `Expected condition by tick ${s.tick}`); };
function clinic() { const s = createGame(); at(s.sites.surface, 10, 9).building = 'medicalCot'; return { s, p: s.crew[0] }; }
const noMedics = s => s.crew.forEach(c => setLabor(s, c.id, 'medicine', false));
function fallenOutside() { const { s, p } = clinic(); p.x = 10; p.y = 15; injure(s, p, 65, 'debris impact'); return { s, p }; }

test('moderate injuries slow every walking path while critical injury prevents walking', () => {
  const s = createGame(), c = s.crew[0], site = s.sites.surface; injure(s, c, 30, 'debris impact'); c.x = 8; c.y = 8;
  site.atmosphere.tick = 1; assert.equal(moveCrew(c, site, [9, 8]), false); assert.equal(c.x, 8);
  site.atmosphere.tick = 2; assert.equal(moveCrew(c, site, [9, 8]), true); assert.equal(c.x, 9);
  injure(s, c, 30, 'debris impact'); assert.ok(immobile(c)); assert.equal(moveCrew(c, site, [10, 8]), false); assert.equal(c.x, 9);
});

test('a rescuer physically reaches, lifts and carries a patient through the habitat door to a cot', () => {
  const { s, p } = fallenOutside(); until(s, () => carriedBy(s, p)); const rescuer = carriedBy(s, p);
  assert.equal(Math.abs(p.x - 10) + Math.abs(p.y - 15), 1); assert.equal(rescuer.carry, undefined); assert.equal(p.x, rescuer.x); assert.equal(p.y, rescuer.y);
  const oxygen = p.oxygen, previous = [p.x, p.y]; step(s); assert.ok(Math.abs(p.x - previous[0]) + Math.abs(p.y - previous[1]) <= 1);
  until(s, () => atCot(s, p) && !carriedBy(s, p)); assert.ok(p.oxygen >= oxygen); assert.ok(p.memories.some(m => m.kind === 'rescued')); assert.ok(at(s.sites.surface, 10, 12).doorUntil > 0);
  until(s, () => p.medical.treated > 0); assert.ok(p.health > 35 || p.medical.treated > 0);
});

test('medicine permissions gate rescue and one helper uniquely claims each patient', () => {
  const { s, p } = fallenOutside(); noMedics(s); step(s, 4); assert.equal(s.crew.filter(c => c.rescue).length, 0); assert.equal(p.y, 15);
  setLabor(s, s.crew[5].id, 'medicine', true); step(s); assert.equal(s.crew.filter(c => c.rescue?.patient === p.id).length, 1); assert.equal(s.crew[5].rescue.patient, p.id);
  until(s, () => atCot(s, p) && !carriedBy(s, p));
});

test('collapse puts reserved construction cargo down without losing its ownership', () => {
  const { s } = clinic(), j = order(s, 'surface', 11, 14, 'build', 'solar').job, before = totalResources(s).alloy;
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); const p = s.crew.find(c => c.delivery?.job === j.id), location = [p.x, p.y];
  injure(s, p, 65, 'debris impact'); step(s); assert.equal(p.carry, null); assert.ok(j.sources.some(source => source.x === location[0] && source.y === location[1])); assert.equal(totalResources(s).alloy, before);
  until(s, () => !s.jobs.includes(j)); assert.equal(totalResources(s).alloy, before - 5);
});

test('rescuers divert to breathable shelter when a reserved cot breaks', () => {
  const { s, p } = fallenOutside(); until(s, () => carriedBy(s, p)); at(s.sites.surface, 10, 9).hp = 0;
  until(s, () => !carriedBy(s, p)); assert.equal(p.medical.bed, null); assert.ok(p.y <= 11); assert.ok(p.memories.some(m => m.kind === 'rescued'));
});

test('rescuer exhaustion leaves the patient at the actual position and another helper can take over', () => {
  const { s, p } = fallenOutside(); until(s, () => carriedBy(s, p)); const helper = carriedBy(s, p), location = [p.x, p.y]; helper.energy = 1;
  step(s); assert.equal(helper.rescue, null); assert.ok(Math.abs(p.x - location[0]) + Math.abs(p.y - location[1]) <= 1);
  until(s, () => atCot(s, p) && !carriedBy(s, p)); assert.ok(p.health > 0);
});

test('rescuer death releases the patient without teleporting or duplicating them', () => {
  const { s, p } = fallenOutside(); until(s, () => carriedBy(s, p)); const helper = carriedBy(s, p), position = [p.x, p.y]; noMedics(s); helper.health = 0;
  step(s); assert.equal(helper.rescue, null); assert.deepEqual([p.x, p.y], position); assert.equal(s.crew.length, 7);
  setLabor(s, s.crew.find(c => c.health > 0 && c.id !== p.id).id, 'medicine', true); until(s, () => atCot(s, p) && !carriedBy(s, p));
});

test('hungry cot patients receive a physically delivered ration and remain at bedside', () => {
  const { s, p } = clinic(); p.x = 10; p.y = 9; p.hunger = 20; injure(s, p, 30, 'debris impact'); const food = totalResources(s).food;
  step(s); const job = s.jobs.find(j => j.kind === 'feed'); assert.ok(job); assert.equal(job.remaining, 8); assert.equal(totalResources(s).food, food);
  until(s, () => s.crew.some(c => c.delivery?.job === job.id)); assert.equal(p.hunger < 20, true); assert.equal(totalResources(s).food, food);
  until(s, () => p.medical.servings > 0); assert.equal(totalResources(s).food, food - 1); assert.deepEqual([p.x, p.y], [10, 9]);
  step(s, 8); assert.ok(p.hunger > 90); assert.equal(p.medical.servings, 0);
});

test('a sole medic interrupts food-blocked treatment to nurse the patient without losing treatment progress', () => {
  const { s, p } = clinic(); noMedics(s); setLabor(s, s.crew[5].id, 'medicine', true); injure(s, p, 20, 'debris impact');
  until(s, () => s.jobs.some(j => j.kind === 'treat' && j.remaining < j.work)); const treatment = s.jobs.find(j => j.kind === 'treat'), remaining = treatment.remaining; p.hunger = 20;
  until(s, () => p.medical.servings > 0); assert.equal(treatment.remaining, remaining); assert.equal(treatment.materials.medicine, 1);
  until(s, () => p.medical.treated > 0); assert.ok(s.crew[5].skills.medicine.xp > 0);
});

test('meal cancellation preserves held food and postpones the automatic retry', () => {
  const { s, p } = clinic(); p.x = 10; p.y = 9; p.hunger = 20; injure(s, p, 30, 'debris impact'); const before = totalResources(s).food;
  step(s); const j = s.jobs.find(j => j.kind === 'feed'); until(s, () => s.crew.some(c => c.delivery?.job === j.id)); const c = s.crew.find(c => c.delivery?.job === j.id);
  cancelJob(s, j.id); assert.equal(c.carry.food, 1); assert.equal(c.delivery, null); assert.equal(totalResources(s).food, before); step(s, 10); assert.equal(s.jobs.filter(j => j.kind === 'feed').length, 0);
});

test('patient death refunds staged nursing food and clears the pending care job', () => {
  const { s, p } = clinic(); p.x = 10; p.y = 9; p.hunger = 20; injure(s, p, 30, 'debris impact'); const before = totalResources(s).food;
  step(s); const j = s.jobs.find(j => j.kind === 'feed'); until(s, () => j.materials.food === 1); p.health = 0; step(s);
  assert.ok(!s.jobs.includes(j)); assert.equal(totalResources(s).food, before); assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('closed hull doors block rescue until a route is reopened', () => {
  const { s, p } = fallenOutside(); assert.ok(setDoorMode(s, 'surface', 10, 12, 'closed').ok); step(s, 5); assert.equal(s.crew.filter(c => c.rescue).length, 0); assert.deepEqual([p.x, p.y], [10, 15]);
  setDoorMode(s, 'surface', 10, 12, 'auto'); until(s, () => atCot(s, p) && !carriedBy(s, p));
});

test('an expedition teammate carries an incapacitated survivor to the dock before return transit', () => {
  const s = createGame(); depart(s, 'wreck'); until(s, () => s.mission?.phase === 'working');
  const [p, helper] = s.mission.crew.map(id => s.crew.find(c => c.id === id)); p.x = 9; p.y = 9; helper.x = 5; helper.y = 10; injure(s, p, 65, 'debris impact');
  const estimate = returnWalk(s, pathTo); assert.ok(estimate > 10); recall(s); until(s, () => carriedBy(s, p)); assert.equal(s.mission.phase, 'boarding');
  until(s, () => s.mission?.phase === 'returning'); assert.equal(p.site, 'transit'); assert.equal(helper.rescue, null); until(s, () => !s.mission); assert.equal(p.site, 'surface');
});

test('transport and bedside meal portions resume deterministically across save/load', () => {
  const { s, p } = fallenOutside(); until(s, () => carriedBy(s, p)); const copy = deserialize(serialize(s)); step(s, 70); step(copy, 70); assert.deepEqual(copy, s);
  p.hunger = 20; until(s, () => p.medical.servings > 0); const nursing = deserialize(serialize(s)); step(s, 20); step(nursing, 20); assert.deepEqual(nursing, s);
});

test('schema-eleven migration adds nursing state without altering injury, inventories or jobs', () => {
  const { s, p } = clinic(); injure(s, p, 20, 'debris impact'); step(s, 4); s.version = 11;
  for (const c of s.crew) { delete c.rescue; delete c.medical.servings; delete c.medical.feedRetryAt; }
  const supplies = totalResources(s), jobs = structuredClone(s.jobs), copy = deserialize(serialize(s)); assert.equal(copy.version, VERSION); assert.equal(copy.crew[0].medical.injury, p.medical.injury); assert.deepEqual(totalResources(copy), supplies); assert.deepEqual(copy.jobs, jobs);
});

test('malformed nursing portions, duplicate helpers and remote transport coordinates are rejected', () => {
  for (const corrupt of [s => s.crew[0].medical.servings = 9, s => s.crew[0].rescue = { patient: 'crew-0', carrying: false }, s => { s.crew[1].rescue = { patient: 'crew-0', carrying: false }; s.crew[2].rescue = { patient: 'crew-0', carrying: false }; }, s => s.crew[1].rescue = { patient: 'crew-0', carrying: true }]) { const s = createGame(); corrupt(s); assert.throws(() => deserialize(serialize(s))); }
});

test('collapse and rescue preserve the remaining portions of a ration already being eaten', () => {
  const { s, p } = fallenOutside(); noMedics(s); const helper = s.crew[1]; setLabor(s, helper.id, 'medicine', true); helper.x = 10; helper.y = 14;
  p.hunger = 20; p.intent = { type: 'meal', target: null, servings: 6 }; at(s.sites.surface, 8, 10).stock.food--; syncResources(s); const food = totalResources(s).food;
  step(s); assert.ok(carriedBy(s, p)); assert.equal(p.medical.servings, 5); assert.equal(p.intent, null); assert.doesNotThrow(() => deserialize(serialize(s)));
  step(s, 5); assert.equal(p.medical.servings, 0); assert.ok(p.hunger > 79); assert.equal(totalResources(s).food, food);
});
