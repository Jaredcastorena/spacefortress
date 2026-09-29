import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { setReturnCrew, reservedCargo, dockAt } from '../src/expedition.js';
import { add, extract, quantity, totalResources } from '../src/inventory.js';
import { damage } from '../src/maintenance.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

// Foundation integration fixtures deliberately establish synthetic residence.
// There is no player settlement/freight action or playable outpost claim here.
const person = (s, id) => s.crew.find(c => c.id === id);
const field = (phase = 'working-pile') => deserialize(gunzipSync(readFileSync(new URL(`./fixtures/outpost-pre36-${phase}.json.gz`, import.meta.url))).toString('utf8'));
const act = (s, id, args = {}) => { const result = executeAction(s, id, args); assert.equal(result.ok, true, `${id}: ${result.message}`); return result; };
const order = (s, args) => { const { job } = act(s, 'job.order', args); return s.jobs.find(j => j.id === job); };
const tick = s => act(s, 'simulation.step', { ticks: 1 });
function until(s, predicate, limit, reason) {
  for (let i = 0; i < limit && !predicate(); i++) tick(s);
  assert.ok(predicate(), `${reason}; tick=${s.tick}, phase=${s.mission?.phase}, preparation=${s.departure?.status}`);
}
const residents = (s, ids) => { s.outposts.wreck.established = true; s.outposts.wreck.residents = [...ids]; };
const recorded = s => exportRecording(s).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row => row.kind === 'event').map(row => row.event);
function reload(s) {
  const text = serialize(s), restored = deserialize(text);
  assert.equal(serialize(restored), text);
  return restored;
}

test('fresh shared departure supplies and physically boards the chosen crew with detached schema37 owners', () => {
  const s = createGame(), request = ['crew-2', 'crew-4'];
  assert.equal(s.version, 37);
  assert.deepEqual(s.outposts, { wreck: { established: false, residents: [] } });
  const emptyOwners = [s.shuttle.freight, ...Object.values(s.sites).flatMap(site => site.tiles.filter(t => t.building === 'dock').map(t => t.imports))];
  assert.equal(emptyOwners.length, 4); assert.equal(new Set(emptyOwners).size, 4);
  assert.ok(emptyOwners.every(owner => JSON.stringify(owner) === '{}'));
  act(s, 'expedition.launch', { site: 'wreck', crewIds: request });
  assert.equal(s.mission, null);
  assert.ok(request.every(id => person(s, id).site === 'surface'));
  const prepared = reload(s);
  until(prepared, () => !!prepared.mission, 300, 'ordinary departure');
  assert.equal(prepared.mission.phase, 'outbound');
  assert.deepEqual(prepared.mission.crew, request);
  assert.deepEqual(prepared.mission.returnCrew, request);
  assert.notEqual(prepared.mission.returnCrew, prepared.mission.crew);
  assert.notEqual(prepared.mission.returnCrew, request);
  assert.ok(request.every(id => person(prepared, id).site === 'transit'));
  assert.ok(prepared.crew.filter(c => !request.includes(c.id)).every(c => c.site === 'surface'));
  assert.deepEqual(prepared.shuttle.freight, {});
  assert.ok(prepared.shuttle.supplies.fuel >= prepared.mission.returnFuel);
  reload(prepared);
});

test('genuine schema36 carried salvage reloads through the full loader and returns identically after a second save', () => {
  const s = field('working-carried'), carrier = person(s, 'crew-4');
  assert.equal(s.version, 37);
  assert.deepEqual(carrier.carry, { components: 3 });
  assert.equal(carrier.delivery.kind, 'shuttle');
  const restored = reload(s), components = totalResources(s).components;
  act(s, 'expedition.recall'); act(restored, 'expedition.recall');
  for (let i = 0; i < 90 && s.mission; i++) {
    tick(s); tick(restored);
    assert.equal(serialize(restored), serialize(s), `continuation tick ${s.tick}`);
  }
  assert.equal(s.mission, null);
  assert.equal(totalResources(s).components, components);
  assert.ok(['crew-4', 'crew-2'].every(id => person(s, id).site === 'surface'));
  reload(s);
});

function localRepairShipment() {
  const s = field(), site = s.sites.wreck, dock = dockAt(site), resident = person(s, 'crew-2');
  residents(s, [resident.id]); assert.equal(setReturnCrew(s, ['crew-4']).ok, true);
  // Move already-mined fixture alloy between physical owners, without a grant.
  const shipment = extract(at(site, 8, 10).drop, { alloy: 2 }); assert.ok(shipment); add(dock.imports, shipment);
  damage(s, site, at(site, 14, 10), 'structure', 10, 'debris');
  act(s, 'crew.labor', { crew: 'crew-4', labor: 'engineering', enabled: false });
  act(s, 'crew.labor', { crew: resident.id, labor: 'engineering', enabled: true });
  const job = order(s, { site: 'wreck', x: 14, y: 10, kind: 'repair' }), id = job.id;
  assert.deepEqual(job.sources, [{ x: dock.x, y: dock.y, kind: 'imports', items: { alloy: 1 } }]);
  assert.deepEqual(dock.imports, { alloy: 1 });
  until(s, () => resident.carry?.alloy === 1 && resident.delivery?.job === id, 30, 'resident collects a local repair shipment');
  return { s, id, resident: person(s, resident.id) };
}

test('remote job reservation survives save and ordinary act delivers its carry locally while the traveler hauls salvage', () => {
  const { s, id, resident } = localRepairShipment(), site = s.sites.wreck;
  assert.equal(resident.delivery.kind, 'job'); assert.equal(resident.delivery.job, id);
  const traveler = person(s, 'crew-4');
  assert.equal(reservedCargo(s), traveler.carry && traveler.delivery?.kind === 'shuttle' ? quantity(traveler.carry) : traveler.intent?.type === 'salvage' ? quantity(traveler.intent.items) : 0);
  const beforeAlloy = totalResources(s).alloy, restored = reload(s);
  tick(s); tick(restored);
  assert.equal(serialize(restored), serialize(s));
  assert.equal(resident.site, 'wreck');
  assert.ok(resident.carry?.alloy === 1 || s.jobs.find(j => j.id === id)?.materials.alloy === 1);
  assert.equal(s.mission.cargo.alloy || 0, 0, 'local repair alloy is not delivered into the shuttle hold');
  assert.equal(totalResources(s).alloy, beforeAlloy);
  until(s, () => !s.jobs.some(j => j.id === id), 50, 'supplied local repair finishes');
  assert.equal(at(site, 14, 10).hp, 100);
  assert.equal(totalResources(s).alloy, beforeAlloy - 1, 'only the completed repair consumes its alloy');
  reload(s);
});

test('full save validation bounds remote sources and deliveries by their physical job site', () => {
  const { s, id, resident } = localRepairShipment(), text = serialize(s);
  for (const corrupt of [
    state => { state.jobs.find(j => j.id === id).sources[0].x = 20; },
    state => { person(state, resident.id).delivery.target = [20, 10]; },
    state => { state.jobs.find(j => j.id === id).site = 'surface'; },
    state => { state.jobs.find(j => j.id === id).sources[0].kind = 'freight'; },
  ]) {
    const broken = JSON.parse(text); corrupt(broken);
    assert.throws(() => deserialize(JSON.stringify(broken)), /reservation|shipment/);
    assert.equal(serialize(s), text, 'rejected save never changes the live source state');
  }
});

test('recall preserves resident and unassigned local jobs without reassigning boarding travelers', () => {
  const s = field(), stay = person(s, 'crew-2'), traveler = person(s, 'crew-4');
  residents(s, [stay.id]); assert.equal(setReturnCrew(s, [traveler.id]).ok, true);
  const owned = order(s, { site: 'wreck', x: 5, y: 6, kind: 'mine' });
  const departing = order(s, { site: 'wreck', x: 12, y: 10, kind: 'mine' });
  const queued = order(s, { site: 'wreck', x: 7, y: 7, kind: 'mine' });
  // Synthetic assignment creates the lifecycle boundary under test; work and
  // subsequent boarding still run through the ordinary simulation dispatcher.
  owned.worker = stay.id; stay.job = owned.id; departing.worker = traveler.id; traveler.job = departing.id;
  reload(s);
  const preserved = structuredClone([owned, queued]);
  act(s, 'expedition.recall');
  assert.equal(s.jobs.some(j => j.id === departing.id), false);
  assert.deepEqual([s.jobs.find(j => j.id === owned.id), s.jobs.find(j => j.id === queued.id)], preserved);
  assert.equal(stay.job, owned.id); assert.equal(traveler.job, null);
  tick(s);
  assert.notEqual(s.jobs.find(j => j.id === queued.id)?.worker, traveler.id, 'boarding travelers cannot claim a resident work queue');
  assert.equal(traveler.job, null);
  assert.equal(stay.site, 'wreck'); assert.ok(s.outposts.wreck.residents.includes(stay.id));
  assert.equal(s.mission.phase, 'returning'); assert.equal(traveler.site, 'transit');
  reload(s);
});

test('recalled traveler leaves queued mining for a resident whose duty is temporarily disabled', () => {
  const s = field(), resident = person(s, 'crew-2'), traveler = person(s, 'crew-4');
  residents(s, [resident.id]);
  act(s, 'crew.labor', { crew: resident.id, labor: 'mining', enabled: false });
  assert.equal(setReturnCrew(s, [traveler.id]).ok, true);
  const job = order(s, { site: 'wreck', x: 12, y: 10, kind: 'mine' });
  act(s, 'expedition.recall'); tick(s);
  assert.equal(traveler.site, 'transit'); assert.equal(traveler.job, null);
  assert.equal(job.worker, null); assert.equal(job.remaining, job.work);
  assert.equal(resident.site, 'wreck'); reload(s);
  until(s, () => s.mission === null, 30, 'traveler returns without taking the resident work queue');
  assert.ok(s.jobs.some(j => j.id === job.id)); assert.equal(job.worker, null); reload(s);
  act(s, 'crew.labor', { crew: resident.id, labor: 'mining', enabled: true }); tick(s);
  assert.equal(job.worker, resident.id); assert.equal(resident.job, job.id);
  reload(s);
});

test('pickup residence ends only at physical departure, and the omitted resident never returns with the shuttle', () => {
  const s = field(), pickup = person(s, 'crew-0'), stay = person(s, 'crew-2'), pilot = person(s, 'crew-4');
  Object.assign(pickup, { site: 'wreck', x: 7, y: 11, job: null, intent: null });
  residents(s, [stay.id, pickup.id]);
  const arrival = [...s.mission.crew]; startRecording(s);
  assert.equal(setReturnCrew(s, [pickup.id, pilot.id]).ok, true);
  assert.deepEqual(s.mission.crew, arrival);
  assert.deepEqual(s.outposts.wreck.residents, [stay.id, pickup.id]);
  act(s, 'expedition.recall'); tick(s);
  assert.equal(s.mission.phase, 'boarding');
  assert.equal(pickup.site, 'wreck'); assert.ok(s.outposts.wreck.residents.includes(pickup.id));
  reload(s);
  until(s, () => s.mission?.phase === 'returning', 25, 'selected resident walks to the actual dock');
  assert.equal(pickup.site, 'transit'); assert.equal(pilot.site, 'transit'); assert.equal(stay.site, 'wreck');
  assert.deepEqual(s.outposts.wreck.residents, [stay.id]);
  const events = recorded(s), removed = events.filter(e => e.id === 'outpost.residence.removed');
  assert.equal(removed.length, 1); assert.equal(removed[0].entity, pickup.id);
  const departed = events.find(e => e.id === 'expedition.return.departed');
  assert.equal(removed[0].tick, departed.tick);
  assert.deepEqual(departed.aboard, [pickup.id, pilot.id]);
  const restored = reload(s);
  until(restored, () => restored.mission === null, 30, 'return flight completes');
  assert.equal(person(restored, pickup.id).site, 'surface'); assert.equal(person(restored, pilot.id).site, 'surface');
  assert.equal(person(restored, stay.id).site, 'wreck');
  assert.deepEqual(restored.outposts.wreck.residents, [stay.id]); reload(restored);
});

test('all named return travelers dead permits fallback flight while bodies remain physically on site', () => {
  const s = field('working-cargo'), ids = [...s.mission.returnCrew], loaded = structuredClone(s.mission.cargo);
  ids.forEach(id => { person(s, id).health = 0; });
  act(s, 'expedition.recall'); tick(s);
  assert.equal(s.mission.phase, 'returning'); assert.deepEqual(s.mission.returnCrew, ids);
  assert.ok(ids.every(id => person(s, id).site === 'wreck'));
  assert.deepEqual(s.mission.cargo, loaded); reload(s);
  until(s, () => s.mission === null, 30, 'automatic empty return after all assigned travelers die');
  assert.ok(ids.every(id => person(s, id).site === 'wreck' && person(s, id).health === 0));
  assert.equal(s.stats.returned, 1); reload(s);
});

test('an empty roster is rejected by saves and cannot masquerade as the all-dead fallback', () => {
  const s = field(); s.mission.returnCrew = [];
  const before = serialize(s), fuel = s.shuttle.supplies.fuel;
  assert.throws(() => deserialize(before), /return roster|residence/);
  assert.equal(executeAction(s, 'expedition.recall').ok, false);
  assert.equal(serialize(s), before, 'rejected recall is atomic');
  s.mission.phase = 'boarding'; tick(s);
  assert.equal(s.mission.phase, 'boarding'); assert.equal(s.shuttle.supplies.fuel, fuel);
  assert.ok(s.mission.crew.every(id => person(s, id).site === 'wreck'));
});

test('off-site selected passengers block departure instead of being teleported aboard', () => {
  const s = field(), absent = person(s, 'crew-2'), pilot = person(s, 'crew-4');
  act(s, 'expedition.recall');
  // Corrupt runtime state exercises the final departure guard independently
  // from the save validator, which must reject this same impossible state.
  absent.site = 'surface'; absent.x = 9; absent.y = 9;
  assert.throws(() => deserialize(serialize(s)), /wrong location/);
  const fuel = s.shuttle.supplies.fuel;
  for (let i = 0; i < 3; i++) tick(s);
  assert.equal(absent.site, 'surface'); assert.equal(pilot.site, 'wreck');
  assert.equal(s.mission.phase, 'boarding'); assert.equal(s.shuttle.supplies.fuel, fuel);
});
