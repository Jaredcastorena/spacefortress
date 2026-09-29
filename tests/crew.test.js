import { depart as launch } from './helpers/depart.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, step, order, at, serialize, deserialize, setLabor, setJobPriority, updateRooms } from '../src/simulation.js';

test('exhausted crew keep their bunk until recovered instead of resuming at the first threshold', () => {
  const s = createGame(), c = s.crew[0]; c.energy = 20;
  step(s, 20); assert.equal(c.intent.type, 'rest'); assert.ok(c.energy > 25 && c.energy < 85); assert.equal(c.job, null);
  assert.equal(at(s.sites.surface, ...c.intent.target).building, 'bunk');
  step(s, 75); assert.equal(c.intent, null); assert.ok(c.energy >= 84); assert.ok(c.memories.some(m => m.kind === 'rested'));
});
test('seven exhausted crew compete for four bunks, then reuse bunks released by rested crew', () => {
  const s = createGame(); for (const c of s.crew) c.energy = 20;
  step(s, 10);
  const beds = s.crew.filter(c => c.intent?.target).map(c => c.intent.target.join(','));
  assert.equal(beds.length, 4); assert.equal(new Set(beds).size, 4);
  assert.equal(s.crew.filter(c => c.memories.some(m => m.kind === 'no-bunk')).length, 3);
  step(s, 180); assert.ok(s.crew.every(c => c.memories.some(m => m.kind === 'rested')));
});
test('breathing recovery continues until suit reserves are safe; failed shelter is explained', () => {
  const s = createGame(), c = s.crew[0]; c.x = 10; c.y = 13; c.oxygen = 15;
  step(s, 15); assert.equal(c.intent.type, 'air'); assert.ok(c.oxygen > 25 && c.oxygen < 90);
  step(s, 40); assert.notEqual(c.intent?.type, 'air'); assert.ok(c.oxygen >= 90);
  at(s.sites.surface, 9, 6).building = null; updateRooms(s.sites.surface); s.sites.surface.rooms.forEach(r => fillRoom(r, 0)); refreshAtmosphere(s.sites.surface); c.oxygen = 10;
  step(s); assert.match(c.activity, /No reachable breathable shelter/);
});
test('a meal reserves one ration and finishes over time, without taking another on reload', () => {
  const s = createGame(); at(s.sites.surface, 7, 9).machine.enabled = false;
  const c = s.crew[0]; c.x = 8; c.y = 10; c.hunger = 20;
  step(s); assert.equal(s.resources.food, 23); assert.equal(c.intent.type, 'meal');
  const copy = deserialize(serialize(s)); step(s, 10); step(copy, 10);
  assert.deepEqual(copy, s); assert.equal(s.resources.food, 23); assert.equal(c.intent, null); assert.ok(c.hunger > 90);
});
test('fractional trap bait cannot be consumed as a whole ration', () => {
  const s = createGame(); at(s.sites.surface, 7, 9).machine.enabled = false;
  const c = s.crew[0]; c.x = 8; c.y = 10; c.hunger = 20; at(s.sites.surface, 8, 10).stock.food = .25; syncResources(s);
  step(s, 10); assert.equal(s.resources.food, .25); assert.equal(c.activity, 'Waiting for food'); assert.ok(c.memories.some(m => m.kind === 'missed-meal'));
});
test('specialists win relevant assignments and learn through actual work', () => {
  const s = createGame(), miner = s.crew[2]; miner.skills.mining.xp = 64;
  const { job } = order(s, 'surface', 4, 10, 'mine'); step(s);
  assert.equal(job.worker, miner.id); step(s, 40);
  assert.equal(miner.skills.mining.level, 4); assert.ok(miner.memories.some(m => m.kind === 'finished-work')); assert.equal(s.stats.mined, 1);
});
test('disabled labors block orders visibly, then assignments resume when enabled', () => {
  const s = createGame(); for (const c of s.crew) setLabor(s, c.id, 'mining', false);
  const { job } = order(s, 'surface', 4, 10, 'mine'); step(s);
  assert.equal(job.worker, null); assert.match(job.blockedReason, /No crew assigned/);
  setLabor(s, s.crew[2].id, 'mining', true); step(s);
  assert.equal(job.worker, s.crew[2].id); assert.equal(job.blockedReason, null);
});
test('an urgent queued job is chosen first without discarding progress on existing work', () => {
  const s = createGame(); for (const c of s.crew.slice(1)) setLabor(s, c.id, 'mining', false);
  const low = order(s, 'surface', 4, 10, 'mine').job;
  const urgent = order(s, 'surface', 4, 11, 'mine').job;
  setJobPriority(s, low.id, 1); setJobPriority(s, urgent.id, 5); step(s);
  assert.equal(s.crew[0].job, urgent.id); assert.equal(low.worker, null);
  for (let n = 0; n < 60 && s.stats.mined === 0; n++) step(s);
  assert.equal(at(s.sites.surface, 4, 11).terrain, 'ground'); assert.equal(at(s.sites.surface, 4, 10).terrain, 'ore');
});
test('exhaustion releases unfinished work for another worker without refunding its reserved materials', () => {
  const s = createGame();
  const actual = order(s, 'surface', 11, 14, 'build', 'solar').job;
  step(s); const worker = s.crew.find(c => c.id === actual.worker); const alloy = s.resources.alloy;
  worker.energy = 1; step(s); assert.equal(actual.worker, null); assert.equal(worker.intent.type, 'rest');
  step(s); assert.notEqual(actual.worker, worker.id); assert.equal(s.resources.alloy, alloy);
  step(s, 40); assert.equal(at(s.sites.surface, 11, 14).building, 'solar'); assert.equal(s.resources.alloy, alloy);
});
test('haulers reserve pickups and do not duplicate material when interrupted', () => {
  const s = createGame(), before = s.resources.alloy; at(s.sites.surface, 15, 14).drop = { ore: 3 };
  step(s); const haulers = s.crew.filter(c => c.intent?.type === 'haul' && c.intent.source === 'drop'); assert.equal(haulers.length, 1);
  haulers[0].energy = 1; step(s); assert.equal(haulers[0].intent.type, 'rest');
  step(s, 70); assert.equal(at(s.sites.surface, 15, 14).drop, null);
  assert.equal(totalResources(s).ore * 2 + totalResources(s).alloy - before, 6);
});
test('recovery, memories, skills, permissions and priorities persist deterministically', () => {
  const a = createGame(); a.crew[0].energy = 20; setLabor(a, 'crew-1', 'mining', false);
  const job = order(a, 'surface', 4, 10, 'mine').job; setJobPriority(a, job.id, 5); step(a, 4);
  const b = deserialize(serialize(a)); step(a, 90); step(b, 90); assert.deepEqual(a, b);
});
test('version-one saves migrate, while corrupt current crew state is rejected', () => {
  const legacy = createGame(); legacy.version = 1;
  for (const c of legacy.crew) for (const field of ['skills', 'labors', 'intent', 'morale', 'memories', 'favoriteLabor', 'temperament']) delete c[field];
  const imported = deserialize(serialize(legacy)); assert.equal(imported.version, VERSION); assert.equal(imported.crew[2].skills.mining.level, 3); step(imported, 2);
  const bad = createGame(); bad.crew[0].intent = { type: 'rest', target: [900, 0] }; assert.throws(() => deserialize(serialize(bad)));
  bad.crew[0].intent = null; bad.crew[0].labors.mining = 'yes'; assert.throws(() => deserialize(serialize(bad)));
});
test('exhausted crew are not silently conscripted into an expedition', () => {
  const s = createGame(); for (const c of s.crew) c.energy = 10;
  assert.equal(launch(s, 'wreck').ok, false); assert.equal(s.mission, null);
});
test('missing every bunk causes poor floor rest, but does not deadlock recovery and construction', () => {
  const s = createGame(), c = s.crew[0];
  for (const t of s.sites.surface.tiles) if (t.building === 'bunk') t.building = null;
  c.energy = 20; step(s);
  assert.equal(c.intent.type, 'rest'); c.energy = 50.5; step(s);
  assert.equal(c.intent, null); assert.ok(c.memories.some(m => m.kind === 'poor-sleep'));
  const j = order(s, 'surface', 10, 7, 'build', 'bunk'); assert.equal(j.ok, true); step(s, 30);
  assert.equal(at(s.sites.surface, 10, 7).building, 'bunk');
});
