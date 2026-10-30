import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { VERSION } from '../src/data.js';
import { createGame, at, step, serialize, deserialize } from '../src/simulation.js';
import { RECRUITMENT, contactRecruits, respondToRecruit, updatePopulation, populationStatus, validatePopulation } from '../src/population.js';
import { MAX_CREW } from '../src/crew-identity.js';
import { totalResources } from '../src/inventory.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

const raw71 = gunzipSync(readFileSync(new URL('./fixtures/population-schema71.json.gz', import.meta.url))).toString();
const pad = s => s.sites.surface.tiles.find(t => t.building === 'shuttle' && t.z === 0);
const exact = s => assert.equal(serialize(deserialize(serialize(s))), serialize(s));
const offer = s => { assert.equal(contactRecruits(s).ok, true); return s.population.offer.id; };
const accept = s => { const id = offer(s); assert.equal(respondToRecruit(s, id, true).ok, true); return id; };
const rejectUnchanged = (s, action, code) => {
  const before = serialize(s), result = action();
  assert.equal(result.ok, false); if (code) assert.equal(result.code, code);
  assert.equal(serialize(s), before);
};
const events = s => exportRecording(s).trim().split('\n').map(JSON.parse).filter(row => row.kind === 'event').map(row => row.event);
// Direct clock changes below isolate recruitment's state machine only. Whole-save
// and continuation checks use ordinary step(), including power/atmosphere clocks.
const moduleTick = (s, tick) => { s.tick = tick; updatePopulation(s); validatePopulation(s); };
const withoutRecruitment = s => {
  const copy = structuredClone(s); delete copy.population; delete copy.log; delete copy.crew;
  return copy;
};

test('genuine schema71 migrates lazily with existing reservations unchanged', () => {
  assert.equal(createHash('sha256').update(raw71).digest('hex'), 'c2b2451e2cc95e0be68408fd5f3ee6d4bd0d5c9ef6314c240b684fe985b99529');
  const expected = JSON.parse(raw71);
  assert.equal(expected.version, 71); assert.equal(expected.crew.length, 7);
  assert.ok(expected.jobs.some(job => job.sources.length));
  expected.version = VERSION;
  const migrated = deserialize(raw71);
  assert.equal(serialize(migrated), JSON.stringify(expected));
  assert.equal(Object.hasOwn(migrated, 'population'), false);
  const resumed = deserialize(serialize(migrated)); step(migrated); step(resumed);
  assert.equal(serialize(resumed), serialize(migrated));
  for (const shadow of [null, {}, { nextOffer: 1 }]) {
    const bad = JSON.parse(raw71); bad.population = shadow;
    assert.throws(() => deserialize(JSON.stringify(bad)), /Legacy population state/);
  }
  const extra = JSON.parse(raw71); extra.crew.push({ ...extra.crew[0], id: 'crew-7' });
  assert.throws(() => deserialize(JSON.stringify(extra)), /Incomplete save/);
});

test('untouched colonies never start recruitment and status is read-only', () => {
  const s = createGame(251), before = serialize(s);
  const status = populationStatus(s);
  assert.equal(status.phase, 'idle'); assert.equal(status.canContact, true);
  assert.equal(status.canAccept, false); assert.equal(status.count, 7);
  status.readiness.warnings.push('External mutation'); status.landing.x = 0;
  updatePopulation(s);
  assert.equal(serialize(s), before);
  step(s, 4); exact(s);
  assert.equal(Object.hasOwn(s, 'population'), false);
});

test('contacts derive stable profiles without advancing RNG or granting people and supplies', () => {
  const a = createGame(251), b = createGame(251);
  b.rng = 123456;
  const beforeA = structuredClone(a), beforeB = structuredClone(b);
  const id = offer(a); assert.equal(offer(b), id);
  const visibleA = populationStatus(a).offer, visibleB = populationStatus(b).offer;
  assert.deepEqual(visibleA, visibleB);
  assert.ok(visibleA.profileIndex >= 0 && visibleA.profileIndex <= 6);
  assert.equal(a.population.offer.landing, null);
  assert.deepEqual(withoutRecruitment(a), withoutRecruitment(beforeA));
  assert.deepEqual(a.crew, beforeA.crew);
  assert.deepEqual(withoutRecruitment(b), withoutRecruitment(beforeB));
  exact(a);
  assert.deepEqual(populationStatus(deserialize(serialize(a))).offer, visibleA);
  visibleA.name = 'Changed outside the game'; visibleA.expires = -1;
  assert.notEqual(populationStatus(a).offer.name, visibleA.name);
  rejectUnchanged(a, () => contactRecruits(a), 'offer_active');
  rejectUnchanged(a, () => respondToRecruit(a, 'recruit-999', true), 'stale_offer');
  rejectUnchanged(a, () => respondToRecruit(a, id, 'yes'), 'invalid_response');
});

test('missing, broken, burning and impassable pads reject before contact or acceptance without mutation', () => {
  for (const [change, reason] of [
    [tile => { tile.building = null; }, 'pad_missing'],
    [tile => { tile.hp = 0; }, 'pad_destroyed'],
    [tile => { tile.fire = { intensity: 1 }; }, 'pad_burning'],
    [tile => { tile.terrain = 'rock'; }, 'pad_blocked'],
  ]) {
    const s = createGame(251), tile = pad(s);
    change(tile);
    rejectUnchanged(s, () => contactRecruits(s), reason);
    assert.equal(Object.hasOwn(s, 'population'), false);
    const pending = createGame(251), id = offer(pending);
    change(pad(pending));
    rejectUnchanged(pending, () => respondToRecruit(pending, id, true), reason);
    assert.equal(respondToRecruit(pending, id, false).ok, true);
    validatePopulation(pending);
  }
});

test('decline and expiry enforce exact cooldown and stale-response boundaries', () => {
  const s = createGame(251), first = offer(s);
  assert.equal(respondToRecruit(s, first, false).ok, true);
  assert.deepEqual(s.population.last, { offer: first, outcome: 'declined', tick: 0, crew: null });
  rejectUnchanged(s, () => respondToRecruit(s, first, true), 'stale_offer');
  moduleTick(s, RECRUITMENT.cooldown - 1);
  rejectUnchanged(s, () => contactRecruits(s), 'cooldown');
  moduleTick(s, RECRUITMENT.cooldown);
  const second = offer(s), expiry = s.population.offer.expires;
  assert.equal(second, 'recruit-2');
  moduleTick(s, expiry - 1); assert.equal(s.population.offer.phase, 'offered');
  s.tick = expiry;
  rejectUnchanged(s, () => respondToRecruit(s, second, true), 'stale_offer');
  updatePopulation(s); validatePopulation(s);
  assert.equal(s.population.last.outcome, 'expired');
  assert.equal(s.population.cooldownUntil, expiry + RECRUITMENT.cooldown);
  assert.equal(s.crew.length, 7);
  const before = serialize(s); updatePopulation(s); assert.equal(serialize(s), before);
});

test('acceptance freezes the actual ground pad and preserves all non-recruitment state', () => {
  const s = createGame(251), id = offer(s), oldPad = pad(s);
  oldPad.building = null;
  const newPad = at(s.sites.surface, 18, 15);
  newPad.terrain = 'ground'; newPad.building = 'shuttle'; newPad.hp = 100;
  const before = structuredClone(s), stock = totalResources(s);
  assert.equal(respondToRecruit(s, id, true).ok, true);
  assert.deepEqual(s.population.offer.landing, { x: 18, y: 15, z: 0 });
  assert.equal(s.population.offer.arrives, RECRUITMENT.travelTicks);
  assert.deepEqual(withoutRecruitment(s), withoutRecruitment(before));
  assert.deepEqual(s.crew, before.crew);
  rejectUnchanged(s, () => respondToRecruit(s, id, false), 'stale_offer');
  moduleTick(s, RECRUITMENT.travelTicks - 1); assert.equal(s.crew.length, 7);
  moduleTick(s, RECRUITMENT.travelTicks);
  assert.equal(s.crew.length, 8);
  assert.deepEqual({ x: s.crew[7].x, y: s.crew[7].y, z: s.crew[7].z }, { x: 18, y: 15, z: 0 });
  assert.equal(s.crew[7].site, 'surface'); assert.deepEqual(totalResources(s), stock);
});

test('arrival appends complete new-person state while preserving founders, grief, jobs and claims', () => {
  const s = deserialize(raw71), founders = s.crew;
  founders[1].health = 0; founders[1].activity = 'Deceased';
  founders[0].relationships['crew-1'].affinity = 42;
  founders[0].life.losses.push({ id: 'crew-1', tick: s.tick, strength: 8 });
  founders[0].life.stress = 35; founders[0].housing.preference = 'quiet';
  founders[2].housing.bunk = { x: 9, y: 7, z: 0 };
  const id = accept(s), profile = populationStatus(s).offer;
  s.tick = s.population.offer.arrives;
  const before = structuredClone(s), stock = totalResources(s);
  updatePopulation(s); validatePopulation(s);
  assert.equal(s.crew, founders, 'Roster array retains its identity');
  const newcomer = s.crew[7];
  assert.equal(newcomer.id, 'crew-7'); assert.equal(newcomer.name, profile.name);
  assert.equal(newcomer.role, profile.role); assert.equal(newcomer.health, 100);
  assert.equal(newcomer.hunger, 28); assert.equal(newcomer.energy, 60); assert.equal(newcomer.oxygen, 80);
  assert.equal(newcomer.airlockTraversal, null); assert.equal(newcomer.job, null); assert.equal(newcomer.intent, null);
  assert.equal(newcomer.medical.foodAge, 0); assert.equal(newcomer.sanitation.retryAt, 0);
  assert.equal(newcomer.housing.preference, ['art', 'quiet', 'company'][profile.profileIndex % 3]);
  assert.deepEqual(newcomer.possessions, { inventory: {}, collect: true });
  assert.equal(newcomer.carry, undefined);
  for (const [index, previous] of before.crew.entries()) {
    const after = structuredClone(s.crew[index]);
    const bond = after.relationships[newcomer.id]; delete after.relationships[newcomer.id];
    assert.deepEqual(after, previous);
    assert.deepEqual(bond, { affinity: 0, interactions: 0, lastInteraction: null });
    assert.deepEqual(newcomer.relationships[previous.id], bond);
    assert.notEqual(s.crew[index].relationships[newcomer.id], newcomer.relationships[previous.id]);
  }
  assert.deepEqual(withoutRecruitment(s), withoutRecruitment(before));
  assert.deepEqual(totalResources(s), stock);
  assert.deepEqual(s.population.arrivals, [{ offer: id, crew: 'crew-7', tick: s.tick, site: 'surface', ...before.population.offer.landing }]);
  const landed = serialize(s); updatePopulation(s); assert.equal(serialize(s), landed);
});

test('holding changes emit once and the original pad can recover through the exact deadline', () => {
  const s = createGame(251); startRecording(s); accept(s);
  const tile = pad(s), deadline = s.population.offer.deadline;
  tile.hp = 0;
  moduleTick(s, s.population.offer.arrives - 1);
  assert.equal(s.population.offer.blocked, null);
  moduleTick(s, s.population.offer.arrives);
  assert.equal(s.population.offer.blocked, 'pad_destroyed');
  updatePopulation(s); updatePopulation(s);
  assert.equal(events(s).filter(event => event.id === 'population.arrival.blocked').length, 1);
  tile.hp = 100; tile.fire = { intensity: 1 };
  moduleTick(s, s.tick + 1);
  assert.equal(s.population.offer.blocked, 'pad_burning');
  delete tile.fire;
  moduleTick(s, deadline);
  assert.equal(s.crew.length, 8); assert.equal(s.population.last.outcome, 'arrived');
  const blocked = events(s).filter(event => event.id === 'population.arrival.blocked');
  assert.deepEqual(blocked.map(event => event.reason), ['pad_destroyed', 'pad_burning', null]);
  const arrived = events(s).filter(event => event.id === 'crew.arrived');
  assert.equal(arrived.length, 1); assert.equal(arrived[0].actor, 'crew-7');
  assert.equal(arrived[0].target, `tile:surface:${tile.x}:${tile.y}`);
});

test('a replacement pad cannot redirect an accepted ferry and deadline diversion adds nothing', () => {
  const s = createGame(251); startRecording(s); const id = accept(s);
  const old = pad(s), deadline = s.population.offer.deadline, stock = totalResources(s);
  old.building = null;
  const other = at(s.sites.surface, 18, 15); other.terrain = 'ground'; other.building = 'shuttle';
  moduleTick(s, s.population.offer.arrives); assert.equal(s.population.offer.blocked, 'pad_missing');
  moduleTick(s, deadline - 1); assert.equal(s.population.offer.phase, 'inbound');
  moduleTick(s, deadline);
  assert.equal(s.population.offer, null); assert.equal(s.crew.length, 7);
  assert.deepEqual(s.population.arrivals, []); assert.deepEqual(totalResources(s), stock);
  assert.deepEqual(s.population.last, { offer: id, outcome: 'diverted', tick: deadline, crew: null });
  assert.equal(events(s).filter(event => event.id === 'population.arrival.diverted').length, 1);
  rejectUnchanged(s, () => respondToRecruit(s, id, true), 'stale_offer');
  const before = serialize(s); updatePopulation(s); assert.equal(serialize(s), before);
});

test('offered, inbound and arrived whole saves resume deterministically on ordinary ticks', () => {
  const s = createGame(251), id = offer(s); exact(s);
  assert.equal(respondToRecruit(s, id, true).ok, true); exact(s);
  step(s, RECRUITMENT.travelTicks - 1); exact(s);
  const restored = deserialize(serialize(s));
  step(s); step(restored);
  assert.equal(s.crew.length, 8); assert.equal(serialize(s), serialize(restored)); exact(s);
  step(s, 3); step(restored, 3); assert.equal(serialize(s), serialize(restored)); exact(s);
});

test('current saves reject malformed offers, phase clocks and extra population fields', () => {
  const base = createGame(251); offer(base); const original = serialize(base);
  const corruptions = [
    s => { s.population = null; },
    s => { s.population.extra = true; },
    s => { s.population.nextOffer = 1; },
    s => { s.population.nextOffer = 100; },
    s => { s.population.cooldownUntil = 1; },
    s => { s.population.offer.id = 'recruit-01'; },
    s => { s.population.offer.created = -1; },
    s => { s.population.offer.expires++; },
    s => { s.population.offer.accepted = 0; },
    s => { s.population.offer.landing = { x: 16, y: 11, z: 0 }; },
    s => { s.population.offer.profileIndex = 0; },
    s => { s.population.offer.blocked = 'pad_destroyed'; },
    s => { s.population.arrivals = [{}]; },
    s => { s.population.last = {}; },
  ];
  for (const corrupt of corruptions) { const bad = JSON.parse(original); corrupt(bad); assert.throws(() => deserialize(JSON.stringify(bad)), /Invalid recruitment/); }
  assert.equal(respondToRecruit(base, base.population.offer.id, true).ok, true);
  const inbound = serialize(base);
  for (const corrupt of [
    s => { s.population.offer.arrives++; },
    s => { s.population.offer.deadline++; },
    s => { s.population.offer.accepted = -1; },
    s => { s.population.offer.landing.z = 1; },
    s => { s.population.offer.landing.extra = 0; },
    s => { s.population.offer.blocked = 'pad_destroyed'; },
  ]) { const bad = JSON.parse(inbound); corrupt(bad); assert.throws(() => deserialize(JSON.stringify(bad)), /Invalid recruitment/); }
});

test('arrival histories reject duplicate, missing, forged and future crew references on whole-save load', () => {
  const s = createGame(251); accept(s); step(s, RECRUITMENT.travelTicks); exact(s);
  const original = serialize(s);
  for (const corrupt of [
    state => { delete state.population; },
    state => { state.population.arrivals = []; },
    state => { state.population.arrivals.push({ ...state.population.arrivals[0] }); },
    state => { state.population.arrivals[0].crew = 'crew-6'; },
    state => { state.population.arrivals[0].offer = 'recruit-2'; },
    state => { state.population.arrivals[0].site = 'wreck'; },
    state => { state.population.arrivals[0].z = 1; },
    state => { state.population.arrivals[0].tick++; },
    state => { state.population.arrivals[0].extra = true; },
    state => { state.population.last.crew = 'crew-0'; },
    state => { state.population.last.outcome = 'declined'; },
    state => { state.population.last.tick--; },
    state => { state.population.cooldownUntil--; },
  ]) { const bad = JSON.parse(original); corrupt(bad); assert.throws(() => deserialize(JSON.stringify(bad)), /Invalid recruitment/); }
  const malformedRoster = JSON.parse(original); malformedRoster.crew[7].id = 'crew-07';
  assert.throws(() => deserialize(JSON.stringify(malformedRoster)), /Invalid crew|Invalid recruitment/);
});

test('repeated arrivals allocate consecutive IDs up to 64 including deceased records', () => {
  const s = createGame(251), resources = totalResources(s), rng = s.rng;
  s.crew[0].health = 0;
  for (let index = 7; index < MAX_CREW; index++) {
    moduleTick(s, s.population?.cooldownUntil || 0);
    const id = accept(s);
    moduleTick(s, s.population.offer.arrives);
    assert.equal(s.crew[index].id, `crew-${index}`);
    assert.equal(s.population.arrivals.at(-1).offer, id);
    assert.equal(s.population.arrivals.at(-1).crew, `crew-${index}`);
    assert.equal(Object.keys(s.crew[index].relationships).length, index);
  }
  const status = populationStatus(s);
  assert.equal(status.phase, 'full'); assert.equal(status.count, 64); assert.equal(status.living, 63);
  assert.equal(status.canContact, false); assert.equal(status.blocked, 'roster_full');
  rejectUnchanged(s, () => contactRecruits(s), 'roster_full');
  assert.deepEqual(totalResources(s), resources); assert.equal(s.rng, rng);
  assert.equal(s.population.arrivals.length, 57);
  assert.ok(s.crew.every(person => Object.keys(person.relationships).length === 63));
});

test('actual surface stock and safe bunks inform warnings without preventing an accepted arrival', () => {
  const s = createGame(251), depot = at(s.sites.surface, 8, 10);
  depot.stock.food = 0; depot.stock.air = 0; s.sites.surface.rooms = [];
  const readiness = populationStatus(s).readiness;
  assert.equal(readiness.food, 0); assert.equal(readiness.air, 0);
  assert.equal(readiness.bunks, 0); assert.equal(readiness.neededBunks, 8);
  assert.equal(readiness.breathableShelter, false); assert.equal(readiness.warnings.length, 4);
  accept(s); moduleTick(s, s.population.offer.arrives);
  assert.equal(s.crew.length, 8); assert.equal(s.population.last.outcome, 'arrived');
});

test('late arrivals anchor later arrival chronology across skipped offer numbers', () => {
  const s = createGame(251);
  moduleTick(s, 1000); accept(s); moduleTick(s, s.population.offer.arrives);
  const firstArrival = s.population.arrivals[0].tick;
  for (let i = 0; i < 2; i++) {
    moduleTick(s, s.population.cooldownUntil);
    const id = offer(s); assert.equal(respondToRecruit(s, id, false).ok, true);
  }
  moduleTick(s, s.population.cooldownUntil); accept(s); moduleTick(s, s.population.offer.arrives);
  assert.equal(s.population.arrivals[1].offer, 'recruit-4');
  assert.equal(s.population.arrivals[1].tick, firstArrival + 3 * RECRUITMENT.cooldown + RECRUITMENT.travelTicks);
  const bad = structuredClone(s), forgedTick = firstArrival + RECRUITMENT.cooldown + RECRUITMENT.travelTicks;
  bad.population.arrivals[1].tick = forgedTick;
  bad.population.last.tick = forgedTick; bad.population.cooldownUntil = forgedTick + RECRUITMENT.cooldown;
  assert.throws(() => validatePopulation(bad), /Invalid recruitment arrival identity or chronology/);
});

test('late arrivals anchor skipped-offer outcomes and their expiry or diversion delays', () => {
  for (const outcome of ['declined', 'expired', 'diverted']) {
    const s = createGame(251);
    moduleTick(s, 1000); accept(s); moduleTick(s, s.population.offer.arrives);
    const firstArrival = s.population.arrivals[0].tick;
    moduleTick(s, s.population.cooldownUntil);
    const skipped = offer(s); assert.equal(respondToRecruit(s, skipped, false).ok, true);
    moduleTick(s, s.population.cooldownUntil);
    const last = offer(s);
    if (outcome === 'declined') assert.equal(respondToRecruit(s, last, false).ok, true);
    if (outcome === 'expired') moduleTick(s, s.population.offer.expires);
    if (outcome === 'diverted') {
      assert.equal(respondToRecruit(s, last, true).ok, true);
      pad(s).hp = 0; moduleTick(s, s.population.offer.deadline);
    }
    validatePopulation(s); assert.equal(s.population.last.outcome, outcome);
    const bad = structuredClone(s), forgedTick = firstArrival + RECRUITMENT.cooldown;
    bad.population.last.tick = forgedTick; bad.population.cooldownUntil = forgedTick + RECRUITMENT.cooldown;
    assert.throws(() => validatePopulation(bad), /Invalid recruitment nonarrival outcome/);
  }
});
