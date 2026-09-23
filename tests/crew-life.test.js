import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, order, updateRooms, serialize, deserialize, launch } from '../src/simulation.js';
import { setLifePolicy, socialize, updateCrewLife } from '../src/crew-life.js';
import { updateMorale, workRate } from '../src/crew.js';
import { fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { totalResources } from '../src/inventory.js';
function pair() {
  const s = createGame(); s.crew.forEach((c, i) => { c.x = i < 2 ? 8 + i : 13; c.y = i < 2 ? 8 : 11; });
  return { s, a: s.crew[0], b: s.crew[1] };
}
const until = (s, predicate, limit = 250) => { for (let i = 0; i < limit && !predicate(); i++) step(s); assert.ok(predicate(), 'Expected condition before tick limit'); };

test('safe nearby conversations build durable bonds and fulfill companionship', () => {
  const { s, a, b } = pair(); a.life.company = 10; b.life.company = 10;
  for (let i = 0; i < 10; i++) { s.tick += 30; socialize(s); }
  assert.equal(a.relationships[b.id].interactions, 10); assert.equal(a.relationships[b.id].affinity, 20);
  assert.equal(b.relationships[a.id].affinity, 20); assert.ok(a.life.company > 10); assert.ok(a.memories.some(m => m.text.includes(b.name)));
});

test('adjacent people in separate rooms or unsafe air do not socialize through a hull wall', () => {
  const { s, a, b } = pair(), site = s.sites.surface; a.x = 9; b.x = 11; a.y = b.y = 8;
  for (let y = 7; y <= 11; y++) at(site, 10, y).building = 'wall'; updateRooms(site);
  s.tick = 30; socialize(s); assert.equal(a.relationships[b.id].interactions, 0);
  a.x = b.x = 8; a.y = b.y = 8; site.rooms.forEach(r => fillRoom(r, 20)); refreshAtmosphere(site); s.tick = 60; socialize(s);
  assert.equal(a.relationships[b.id].interactions, 0);
});

test('friendship offers support under stress; tense encounters can strain relationships', () => {
  const { s, a, b } = pair(); a.relationships[b.id].affinity = 30; a.life.stress = 50;
  s.tick = 30; socialize(s); assert.equal(a.life.stress, 44); assert.ok(a.memories.some(m => m.kind === `support-${b.id}`));
  a.life.stress = b.life.stress = 80; const previous = a.relationships[b.id].affinity; s.tick = 60; socialize(s);
  assert.equal(a.relationships[b.id].affinity, previous - 2); assert.equal(a.life.stress, 82); assert.ok(a.memories.some(m => m.kind === `argument-${b.id}`));
});

test('stress and unfulfilled personal needs reduce morale and effective work speed', () => {
  const { s, a } = pair(); updateMorale(s, a); const rate = workRate(a, 'construction');
  a.life.stress = 90; a.life.company = a.life.leisure = 0; updateMorale(s, a);
  assert.ok(a.morale < 45); assert.ok(workRate(a, 'construction') < rate);
});

test('automatic breaks are staggered while player off-duty policy is honored', () => {
  const s = createGame(); s.crew.forEach(c => c.life.leisure = 10); step(s);
  assert.equal(s.crew.filter(c => c.intent?.type === 'leisure').length, 2);
  setLifePolicy(s, s.crew[2].id, 'rest'); step(s); assert.equal(s.crew[2].intent.type, 'leisure');
  assert.equal(s.crew.filter(c => c.intent?.type === 'leisure').length, 3);
});

test('common table construction creates faster restorative downtime with distinct reserved places', () => {
  const s = createGame(), result = order(s, 'surface', 10, 9, 'build', 'commons'); assert.equal(result.ok, true); until(s, () => !s.jobs.includes(result.job));
  const [a, b] = s.crew; setLifePolicy(s, a.id, 'rest'); setLifePolicy(s, b.id, 'rest'); a.life.leisure = b.life.leisure = 10;
  until(s, () => a.intent?.rested >= 1 && b.intent?.rested >= 1); assert.notDeepEqual(a.intent.target, b.intent.target);
  const before = a.life.leisure; step(s, 20); assert.ok(a.life.leisure - before > 12);
  assert.ok(Math.abs(a.x - 10) + Math.abs(a.y - 9) <= 1); assert.ok(Math.abs(b.x - 10) + Math.abs(b.y - 9) <= 1);
});

test('a balanced break ends and has a cooldown even when no companion is available', () => {
  const s = createGame(), c = s.crew[0]; c.life.company = 0; c.life.leisure = 80;
  s.crew.slice(1).forEach(other => { other.x = 13; other.y = 11; }); step(s); assert.equal(c.intent.type, 'leisure');
  until(s, () => c.intent === null); const next = c.life.nextBreak; assert.ok(next > s.tick); step(s, 10); assert.notEqual(c.intent?.type, 'leisure');
});

test('air emergencies interrupt downtime and an unsafe colony does not send all balanced workers on break', () => {
  const s = createGame(), c = s.crew[0]; c.life.leisure = 10; step(s); assert.equal(c.intent.type, 'leisure');
  c.oxygen = 1; c.x = 10; c.y = 14; step(s); assert.equal(c.intent.type, 'air');
  const unsafe = createGame(); unsafe.sites.surface.rooms.forEach(r => fillRoom(r, 20)); refreshAtmosphere(unsafe.sites.surface);
  unsafe.crew.forEach(person => { person.life.stress = 100; person.life.leisure = 0; }); step(unsafe);
  assert.equal(unsafe.crew.filter(person => person.intent?.type === 'leisure').length, 0);
});

test('breaks preserve delivered construction inventories and held shipments still reach their destination', () => {
  const s = createGame(), before = totalResources(s).alloy, j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); const carrier = s.crew.find(c => c.delivery?.job === j.id);
  setLifePolicy(s, carrier.id, 'rest'); assert.ok(carrier.carry); until(s, () => !carrier.carry);
  assert.ok(j.materials.alloy > 0 || !s.jobs.includes(j)); until(s, () => !s.jobs.includes(j)); assert.equal(totalResources(s).alloy, before - 5);
});

test('focusing on work defers breaks while off-duty crew are not assigned new orders or departures', () => {
  const s = createGame(), c = s.crew[0]; c.life.leisure = 0; c.life.stress = 90; setLifePolicy(s, c.id, 'work'); step(s); assert.notEqual(c.intent?.type, 'leisure');
  s.crew.forEach(other => setLifePolicy(s, other.id, 'rest')); const j = order(s, 'surface', 4, 10, 'mine').job; step(s);
  assert.equal(j.worker, null); assert.equal(launch(s, 'wreck').ok, false);
});

test('losses are remembered once and close friends carry stronger lasting grief', () => {
  const { s, a, b } = pair(); a.relationships[b.id].affinity = 80; b.health = 0; updateCrewLife(s);
  const acquaintance = s.crew[2]; assert.equal(a.life.losses.length, 1); assert.ok(a.life.losses[0].strength > acquaintance.life.losses[0].strength);
  updateCrewLife(s); assert.equal(a.life.losses.length, 1); a.memories = []; updateMorale(s, a); const grieving = a.morale;
  s.tick = 2401; updateMorale(s, a); assert.ok(a.morale > grieving); assert.equal(a.life.losses.length, 1);
});

test('breaks, social bonds and grief continue deterministically through save/load', () => {
  const s = createGame(); s.crew[0].life.leisure = 15; s.crew[1].health = 0; step(s, 35);
  const copy = deserialize(serialize(s)); step(s, 80); step(copy, 80); assert.deepEqual(copy, s);
});

test('schema-nine migration adds personal needs without altering jobs or inventories', () => {
  const s = createGame(); order(s, 'surface', 4, 10, 'mine'); step(s, 5); s.version = 9;
  for (const c of s.crew) { delete c.life; delete c.relationships; }
  const before = totalResources(s), jobs = structuredClone(s.jobs), copy = deserialize(serialize(s));
  assert.equal(copy.version, 36); assert.deepEqual(totalResources(copy), before); assert.deepEqual(copy.jobs, jobs); assert.equal(copy.crew[0].life.leisure, 80);
});

test('invalid needs, relationship peers, loss history and duplicate downtime places are rejected', () => {
  for (const corrupt of [
    s => { s.crew[0].life.stress = -1; },
    s => { s.crew[0].life.policy = 'random'; },
    s => { s.crew[0].relationships['crew-1'].affinity = 101; },
    s => { s.crew[0].relationships['crew-1'].lastInteraction = 999; },
    s => { s.crew[0].life.losses.push({ id: 'crew-1', tick: 0, strength: 10 }); },
    s => { s.crew.slice(0, 2).forEach(c => c.intent = { type: 'leisure', target: [8, 8], started: 0, rested: 0 }); },
  ]) { const s = createGame(); corrupt(s); assert.throws(() => deserialize(serialize(s))); }
});
