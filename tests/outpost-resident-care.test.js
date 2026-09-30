import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, at, step, serialize, deserialize, updateRooms, recall } from '../src/simulation.js';
import { setReturnCrew } from '../src/expedition.js';
import { add, extract, initializeStorage, syncResources, totalResources, resourceEntries } from '../src/inventory.js';
import { initializeElectrical, refreshPower } from '../src/power.js';
import { fillRoom, roomAt, breathable, refreshAtmosphere, setDoorMode } from '../src/atmosphere.js';
import { injure, validateMedicine, treatmentPatient, treatmentReady } from '../src/medicine.js';
import { atCot, carriedBy, feedPatient, validateNursing } from '../src/nursing.js';
import { hygienePatient, hygieneReady, validateHygiene } from '../src/hygiene.js';
import { exposedWaste } from '../src/sanitation.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';

const until = (s, predicate, limit = 150) => {
  for (let i = 0; i < limit && !predicate(); i++) step(s);
  assert.ok(predicate(), `Condition missing at tick ${s.tick}`);
};
const checkpoint = s => { syncResources(s); return deserialize(serialize(s)); };
const events = s => exportRecording(s).trim().split('\n').map(JSON.parse).filter(r => r.event).map(r => r.event);

// Isolated boundary fixture, NOT commissioning acceptance: geometry, breathable gas,
// heat and residence are seeded deliberately. Supplies are transferred from the
// finite initial surface depot. Ordinary supplied construction lives in the
// separate outpost-gameplay acceptance suite.
function clinic({ food = 4, medicine = 3, state = null } = {}) {
  const s = state || createGame(), site = s.sites.wreck, surface = at(s.sites.surface, 8, 10);
  for (const c of s.crew) for (const labor of Object.keys(c.labors)) c.labors[labor] = false;
  for (const t of s.sites.surface.tiles) if (t.machine) t.machine.enabled = false;
  for (let y = 7; y <= 12; y++) for (let x = 7; x <= 12; x++) {
    const t = at(site, x, y); t.terrain = 'floor'; t.building = x === 7 || x === 12 || y === 7 || y === 12 ? 'wall' : null;
    t.hp = 100; initializeStorage(t); initializeElectrical(t);
  }
  for (const [x, y, building] of [[7, 10, 'door'], [8, 8, 'stockpile'], [9, 8, 'bunk'], [10, 8, 'bunk'], [10, 10, 'medicalCot'], [8, 11, 'sanitary'], [11, 9, 'scrubber'], [13, 9, 'solar']]) {
    const t = at(site, x, y); t.building = building; initializeStorage(t); initializeElectrical(t);
  }
  at(site, 12, 9).cable = { hp: 100, enabled: true };
  add(at(site, 11, 9).machine.input, extract(surface.stock, { air: 10 }));
  updateRooms(site);
  for (const r of site.rooms) {
    fillRoom(r, 120); const next = r.volume * 20 * (20 + 273.15);
    site.thermal.heating += next - r.heat; r.heat = next;
  }
  refreshAtmosphere(site); refreshPower(s, site); refreshPower(s, s.sites.surface);
  const stock = at(site, 8, 8).stock;
  add(stock, extract(surface.stock, { food, medicine }));
  const p = s.crew[0], helper = s.crew[5];
  for (const c of [p, helper]) { c.site = 'wreck'; c.x = 9; c.y = c === p ? 10 : 9; }
  s.outposts.wreck = { established: true, residents: [p.id, helper.id] };
  helper.labors.medicine = true;
  checkpoint(s);
  return { s, site, p, helper, stock, surface, cot: at(site, 10, 10) };
}

test('isolated residents eat local food and reserve local bunks without a mission or viewed-site state', () => {
  const { s, p, helper, stock, surface } = clinic();
  p.hunger = 20; helper.energy = 10;
  const surfaceFood = surface.stock.food, localFood = stock.food;
  const copy = checkpoint(s); startRecording(s);
  for (let i = 0; i < 35; i++) { observe(s); step(s); step(copy); }
  assert.deepEqual(s, copy, 'inspection/recording must not alter offscreen care');
  assert.equal(s.mission, null); assert.equal(p.site, 'wreck'); assert.ok(p.hunger > 90);
  assert.equal(stock.food, localFood - 1); assert.equal(surface.stock.food, surfaceFood);
  assert.ok(helper.energy > 30); assert.equal(at(s.sites.wreck, helper.x, helper.y).building, 'bunk');
  assert.deepEqual(checkpoint(s), s);
});

const field = () => deserialize(gunzipSync(readFileSync(new URL('./fixtures/outpost-pre36-working-pile.json.gz', import.meta.url))).toString('utf8'));

test('physical visitor departure preserves an unrelated resident treatment job and patient residence', () => {
  const { s, p, helper } = clinic({ state: field() });
  p.x = 10; p.y = 10; injure(s, p, 20, 'test impact');
  until(s, () => s.jobs.some(j => j.kind === 'treat' && j.patient === p.id && j.remaining < j.work));
  const treatment = s.jobs.find(j => j.kind === 'treat' && j.patient === p.id), before = structuredClone(treatment), arrivals = [...s.mission.crew];
  assert.equal(treatment.worker, helper.id); assert.ok(recall(s).ok);
  assert.deepEqual(treatment, before); assert.equal(helper.job, treatment.id);
  until(s, () => s.mission?.phase === 'returning');
  assert.deepEqual(s.mission.crew, arrivals); assert.equal(p.site, 'wreck'); assert.equal(helper.site, 'wreck');
  assert.ok(s.outposts.wreck.residents.includes(p.id)); assert.ok(s.outposts.wreck.residents.includes(helper.id));
  const copy = checkpoint(s); step(s, 25); step(copy, 25); assert.deepEqual(copy, s);
  assert.equal(s.mission, null); assert.ok(p.medical.treated > 0);
  assert.ok(arrivals.every(id => s.crew.find(c => c.id === id).site === 'surface'));
});

test('a prior resident is physically rescued for pickup while the resident helper stays behind', () => {
  const { s, p, helper } = clinic({ state: field() });
  const arrivals = [...s.mission.crew], stayingArrival = s.crew.find(c => c.id === arrivals[1]);
  s.outposts.wreck.residents.push(stayingArrival.id); stayingArrival.x = 9; stayingArrival.y = 9;
  p.x = 10; p.y = 10; helper.x = 9; helper.y = 10; injure(s, p, 65, 'test impact'); p.medical.bed = [10, 10];
  assert.equal(arrivals.includes(p.id), false);
  assert.ok(setReturnCrew(s, [arrivals[0], p.id]).ok); assert.ok(s.outposts.wreck.residents.includes(p.id));
  startRecording(s); assert.ok(recall(s).ok);
  until(s, () => carriedBy(s, p)); assert.equal(p.site, 'wreck'); assert.equal(carriedBy(s, p), helper);
  const carried = checkpoint(s); step(s); step(carried); assert.deepEqual(carried, s);
  until(s, () => s.mission?.phase === 'returning');
  assert.deepEqual(s.mission.crew, arrivals); assert.deepEqual(s.mission.returnCrew, [arrivals[0], p.id]);
  assert.equal(p.site, 'transit'); assert.equal(p.medical.bed, null); assert.equal(helper.rescue, null);
  assert.equal(helper.site, 'wreck'); assert.equal(stayingArrival.site, 'wreck');
  assert.deepEqual(s.outposts.wreck.residents, [helper.id, stayingArrival.id]);
  const delivered = events(s).filter(e => e.id === 'care.rescue.delivered' && e.entity === p.id);
  assert.equal(delivered.length, 1); assert.equal(delivered[0].reason, 'patient_boarded'); assert.equal(delivered[0].site, 'site:wreck');
  const copy = checkpoint(s); step(s, 25); step(copy, 25); assert.deepEqual(copy, s);
  assert.equal(s.mission, null); assert.equal(p.site, 'surface'); assert.equal(helper.site, 'wreck');
});

test('remote feeding and treatment physically consume local finite rations and medicine, surviving reload', () => {
  const { s, p, helper, stock, surface } = clinic();
  p.x = 10; p.y = 10; p.hunger = 20; injure(s, p, 20, 'test impact');
  const surfaceMedicine = surface.stock.medicine, surfaceFood = surface.stock.food;
  step(s); const meal = s.jobs.find(j => j.kind === 'feed' && j.patient === p.id);
  assert.ok(meal); assert.equal(meal.site, 'wreck'); assert.equal(meal.remaining, 8);
  until(s, () => helper.delivery?.job === meal.id);
  assert.equal(helper.carry.food, 1); assert.equal(p.medical.servings, 0);
  until(s, () => p.medical.servings > 0);
  assert.equal(stock.food, 3); assert.equal(surface.stock.food, surfaceFood);
  until(s, () => s.jobs.some(j => j.kind === 'treat' && j.remaining < j.work));
  const copy = checkpoint(s); step(s, 30); step(copy, 30); assert.deepEqual(copy, s);
  assert.ok(p.medical.treated > 0); assert.ok(p.health > 80);
  assert.equal(stock.medicine, 2); assert.equal(surface.stock.medicine, surfaceMedicine);
  assert.equal(p.site, 'wreck'); assert.ok(atCot(s, p));
});

test('local shortages cannot borrow surface food or medicine for a dependent resident', () => {
  const { s, p, surface } = clinic({ food: 0, medicine: 0 });
  p.x = 10; p.y = 10; p.hunger = 20; injure(s, p, 20, 'test impact');
  const supplies = { food: surface.stock.food, medicine: surface.stock.medicine };
  step(s, 35);
  assert.equal(s.jobs.filter(j => ['feed', 'treat'].includes(j.kind)).length, 0);
  assert.equal(p.medical.servings, 0); assert.equal(p.medical.treated, 0); assert.equal(p.health, 80);
  assert.ok(p.hunger < 20); assert.deepEqual({ food: surface.stock.food, medicine: surface.stock.medicine }, supplies);
  assert.deepEqual(checkpoint(s), s);
});

test('resident rescuer carries a stranded patient to local shelter without an absent shuttle', () => {
  const { s, site, p, helper } = clinic(); p.x = 5; p.y = 10; injure(s, p, 65, 'test impact');
  startRecording(s); assert.equal(s.mission, null);
  until(s, () => carriedBy(s, p));
  assert.equal(carriedBy(s, p), helper); const before = [p.x, p.y]; step(s);
  assert.ok(Math.abs(p.x - before[0]) + Math.abs(p.y - before[1]) <= 1);
  assert.equal(p.x, helper.x); assert.equal(p.y, helper.y);
  const copy = checkpoint(s); step(s, 12); step(copy, 12); assert.deepEqual(copy, s);
  until(s, () => atCot(s, p) && !carriedBy(s, p));
  assert.deepEqual([p.x, p.y], [10, 10]); assert.ok(breathable(roomAt(site, p.x, p.y)));
  const rescueEvents = events(s).filter(e => e.id.startsWith('care.rescue.'));
  assert.deepEqual(rescueEvents.map(e => e.id), ['care.rescue.assigned', 'care.rescue.picked_up', 'care.rescue.delivered']);
  for (const e of rescueEvents) { assert.equal(e.entity, p.id); assert.equal(e.actor, helper.id); assert.equal(e.site, 'site:wreck'); }
  assert.equal(rescueEvents.at(-1).reason, 'cot_reached');
});

test('a blocked local rescue route waits and helper exhaustion leaves the patient at the real location', () => {
  const { s, p, helper } = clinic(); p.x = 5; p.y = 10; injure(s, p, 65, 'test impact');
  setDoorMode(s, 'wreck', 7, 10, 'closed'); step(s, 3); assert.equal(helper.rescue, null); assert.deepEqual([p.x, p.y], [5, 10]);
  setDoorMode(s, 'wreck', 7, 10, 'auto'); until(s, () => carriedBy(s, p));
  startRecording(s); const before = [p.x, p.y]; helper.energy = 1; step(s);
  assert.equal(helper.rescue, null); assert.deepEqual([p.x, p.y], before); assert.equal(p.site, 'wreck');
  assert.ok(events(s).some(e => e.id === 'care.rescue.interrupted' && e.reason === 'rescuer_unavailable'));
  assert.deepEqual(checkpoint(s), s);
});

test('remote hygiene transfers waste through the local helper to the local depot exactly once', () => {
  const { s, p, helper, stock, surface } = clinic({ medicine: 0 });
  p.x = 10; p.y = 10; injure(s, p, 65, 'test impact'); p.sanitation.waste = .5;
  const waste = totalResources(s).waste;
  until(s, () => helper.carry?.waste === .5);
  assert.equal(p.sanitation.waste, 0); assert.equal(stock.waste || 0, 0); assert.equal(totalResources(s).waste, waste);
  const copy = checkpoint(s); step(s, 12); step(copy, 12); assert.deepEqual(copy, s);
  assert.equal(stock.waste, .5); assert.equal(surface.stock.waste || 0, 0); assert.equal(totalResources(s).waste, waste);
});

test('local sanitary visits and pollution use the physical site inventory', () => {
  const { s, site, p, surface } = clinic(); p.sanitation.waste = .5;
  until(s, () => p.sanitation.waste === 0);
  assert.equal(at(site, 8, 11).sanitary.output.waste, .5); assert.equal(surface.stock.waste || 0, 0);
  const dock = site.tiles.find(t => t.building === 'dock'); dock.imports.waste = 2;
  assert.equal(exposedWaste(s, site, null, dock), 2);
  assert.deepEqual(checkpoint(s), s);
});

test('cot claims are site qualified and remote care cannot bind a patient or worker on another site', () => {
  const { s, p, helper } = clinic(); const other = s.crew[1];
  at(s.sites.surface, 10, 10).building = 'medicalCot';
  for (const c of [p, other]) { injure(s, c, 20, 'test impact'); c.medical.bed = [10, 10]; }
  assert.doesNotThrow(() => validateMedicine(s));
  p.x = 10; p.y = 10; p.intent = { type: 'medical', target: [10, 10] }; p.hunger = 20; p.sanitation.waste = .5;
  const j = { site: 'wreck', patient: p.id, x: 10, y: 10 };
  assert.equal(treatmentPatient(s, j), p); assert.equal(feedPatient(s, j), p); assert.equal(hygienePatient(s, j), p);
  assert.equal(treatmentPatient(s, { ...j, site: 'surface' }), null);
  assert.equal(feedPatient(s, { ...j, site: 'surface' }), null); assert.equal(hygienePatient(s, { ...j, site: 'surface' }), null);
  assert.equal(treatmentReady(s, j, other), false); assert.equal(hygieneReady(s, j, other), false);
  helper.labors.medicine = false; step(s);
  const valid = checkpoint(s);
  for (const kind of ['treat', 'feed', 'hygiene']) {
    const bad = structuredClone(valid), job = bad.jobs.find(j => j.kind === kind && j.patient === p.id);
    assert.ok(job); job.site = 'surface';
    assert.throws(() => ({ treat: validateMedicine, feed: validateNursing, hygiene: validateHygiene })[kind](bad));
  }
});

test('loss of remote shelter cancels unsafe cot care without granting surface supplies or phantom healing', () => {
  const { s, site, p, helper, surface } = clinic(); helper.labors.medicine = false;
  p.x = 10; p.y = 10; injure(s, p, 20, 'test impact'); step(s);
  assert.ok(p.medical.bed); const medicine = totalResources(s).medicine, surfaceMedicine = surface.stock.medicine;
  at(site, 11, 7).hp = 0; step(s, 60);
  assert.ok(!breathable(roomAt(site, p.x, p.y))); assert.equal(p.medical.bed, null);
  assert.equal(p.medical.treated, 0); assert.equal(p.health, 80); assert.equal(totalResources(s).medicine, medicine);
  assert.equal(surface.stock.medicine, surfaceMedicine); assert.deepEqual(checkpoint(s), s);
});

test('an empty wreck dock gives a resident no invisible shuttle protection while a sealed room shelters the helper', () => {
  const { s, p, helper } = clinic(); p.x = 4; p.y = 11; helper.labors.medicine = false;
  assert.equal(s.mission, null); step(s, 65);
  assert.equal(p.medical.injury, 4); assert.equal(p.health, 96); assert.equal(p.medical.cause, 'debris impact');
  assert.equal(helper.medical.injury, 0); assert.equal(helper.health, 100);
  assert.deepEqual(checkpoint(s), s);
});

test('resident death releases local care reservations and retained waste without moving supplies across sites', () => {
  const { s, p, helper, site, surface } = clinic(); helper.labors.medicine = false;
  p.x = 10; p.y = 10; p.hunger = 20; p.sanitation.waste = .5; injure(s, p, 20, 'test impact'); step(s);
  assert.ok(s.jobs.some(j => j.patient === p.id));
  const before = totalResources(s), surfaceSupplies = resourceEntries(surface.stock);
  p.health = 0; step(s);
  assert.equal(p.medical.bed, null); assert.equal(s.jobs.some(j => j.patient === p.id), false);
  assert.equal(at(site, p.x, p.y).drop.waste, .5); assert.equal(p.sanitation.waste, 0);
  assert.equal(totalResources(s).medicine, before.medicine); assert.equal(totalResources(s).food, before.food);
  assert.equal(totalResources(s).waste, before.waste); assert.deepEqual(resourceEntries(surface.stock), surfaceSupplies);
  assert.deepEqual(checkpoint(s), s);
});
