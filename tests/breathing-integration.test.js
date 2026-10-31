import { gasAtRoomPressure } from '../src/room-pressure.js';
import { initializeClimate } from '../src/thermal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, serialize, deserialize } from '../src/simulation.js';
import { refreshAtmosphere, updateRooms, roomAt } from '../src/atmosphere.js';
import { startRecording, exportRecording } from '../src/telemetry.js';
import { refreshPower } from '../src/power.js';
import { fixture as airlockFixture, CONFIG } from './helpers/airlock-fixture.js';
import { executeAction } from '../src/controls.js';
import { airlockLayout } from '../src/airlock-access.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const airEvents = s => exportRecording(s).trim().split('\n').map(JSON.parse)
  .filter(row => row.event?.id === 'crew.air.allocated').map(row => row.event);
function colony() {
  const s = createGame(), site = s.sites.surface;
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  refreshPower(s, site);
  for (const c of s.crew) { c.x = 8; c.y = 9; c.job = null; }
  return { s, site, room: site.rooms[0], c: s.crew[0] };
}

// Isolate exact breathing boundaries using powered climate at the reference
// temperature. This synthetic fixture does not test paid construction.
function steadyColony() {
  const f=colony(),t=f.site.tiles.find(t=>t.x===12&&t.y===10);
  t.building='climate';t.cable={hp:100,enabled:true};initializeClimate(t);
  refreshPower(f.s,f.site);return f;
}

test('fully supplied breaths avoid false empty-suit injury while actual unmet demand injures', () => {
  const inside = steadyColony();
  Object.assign(inside.room.gas, { oxygen: 60, inert: gasAtRoomPressure(inside.room,55)-60, co2: 0 });
  inside.c.oxygen = 0; refreshAtmosphere(inside.site); step(inside.s);
  assert.equal(inside.c.oxygen, 0, 'pressure floor prevents an optional refill');
  assert.equal(inside.c.health, 100); assert.equal(inside.c.medical.injury, 0);
  for (const [oxygen, expectedHealth] of [[.075, 100], [0, 99.5]]) {
    const f = colony(); Object.assign(f.c, { x: 1, y: 1, oxygen }); step(f.s);
    assert.equal(f.c.oxygen, 0); assert.equal(f.c.health, expectedHealth);
    if (!oxygen) assert.equal(f.c.medical.cause, 'oxygen deprivation');
  }
});

test('typed allocation events preserve saves, RNG and exact deterministic continuation', () => {
  const { s } = colony();
  Object.assign(s.crew[0], { x: 1, y: 1, oxygen: .025 });
  s.crew[1].oxygen = 98;
  Object.assign(s.crew[2], { x: 2, y: 1, oxygen: 100 });
  const plain = deserialize(serialize(s)); startRecording(s); step(s); step(plain);
  assert.equal(serialize(s), serialize(plain)); assert.equal(s.rng, plain.rng);
  const events = airEvents(s); assert.deepEqual(events.map(e => e.actor), ['crew-0', 'crew-1', 'crew-2']);
  for (const e of events) {
    assert.equal(e.site, 'site:surface'); assert.equal(e.entity, e.actor);
    for (const field of ['roomOxygen', 'suitOxygen', 'refillOxygen', 'unmetOxygen'])
      assert.ok(typeof e[field] === 'number' && Number.isFinite(e[field]) && e[field] >= 0);
  }
  close(events[0].suitOxygen, .0025); close(events[0].unmetOxygen, .005); assert.equal(events[0].roomOxygen, 0);
  close(events[1].roomOxygen, .0075); close(events[1].refillOxygen, .2); assert.equal(events[1].unmetOxygen, 0);
  close(events[2].suitOxygen, .0075); assert.equal(events[2].unmetOxygen, 0);
  const raw = serialize(s), restored = deserialize(raw); assert.equal(serialize(restored), raw);
  step(s, 2); step(restored, 2); assert.equal(serialize(s), serialize(restored));
  assert.ok(s.crew.every(c => !Object.hasOwn(c, 'airAllocation') && !Object.hasOwn(c, 'unmetOxygen')));
});

test('ordinary room-only breaths run once before crew actions without allocation event noise', () => {
  const { s, site } = colony(); const before = site.atmosphere.breathed;
  startRecording(s); step(s);
  close(site.atmosphere.breathed - before, 7 * .0075);
  assert.deepEqual(airEvents(s), []); assert.ok(s.crew.every(c => c.oxygen === 100 && c.health === 100));
});

test('home warnings distinguish actual suit-assisted breathing from safe charging and outdoor suit use', () => {
  for (const scenario of ['home shortage', 'safe charging', 'outside']) {
    const f = steadyColony();
    if (scenario === 'home shortage') { f.room.gas.oxygen = gasAtRoomPressure(f.room,16); refreshAtmosphere(f.site); }
    else f.c.oxygen = 90;
    if (scenario === 'outside') { f.c.x = 1; f.c.y = 1; }
    startRecording(f.s); step(f.s); const events = airEvents(f.s);
    assert.equal(!!f.s.flags.airWarning, scenario === 'home shortage', scenario);
    if (scenario === 'home shortage') {
      assert.ok(events.some(e => e.suitOxygen > 0));
      assert.ok(f.s.log.some(e => e.message.startsWith('Habitat air reserves are low.')));
      assert.ok(!f.s.log.some(e => e.message.startsWith('Habitat air is unsafe.')));
    } else if (scenario === 'safe charging') {
      assert.ok(events.some(e => e.refillOxygen > 0)); assert.ok(events.every(e => e.suitOxygen === 0));
    } else assert.ok(events.some(e => e.actor === f.c.id && e.suitOxygen > 0));
  }
});

test('a deliberately bound chamber with a bunk does not raise the home suit-assistance warning', () => {
  const f = airlockFixture({ configure: false, smoke: 0 });
  // Extend the real synthetic chamber by one furnished cell, then bind normally.
  f.tile(8, 8).building = 'bunk';
  for (const [x, y] of [[9, 8], [8, 9]]) Object.assign(f.tile(x, y), { terrain: 'floor', building: 'wall', hp: 100 });
  updateRooms(f.site);
  const chamber = roomAt(f.site, 8, 8);
  Object.assign(chamber.gas, { oxygen: chamber.volume * 10 * .16, inert: chamber.volume * 10 * .84, co2: 0 });
  refreshAtmosphere(f.site);
  assert.equal(executeAction(f.s, 'airlock.configure', CONFIG, 'test').ok, true);
  assert.equal(airlockLayout(f.site, f.controller).ok, true);
  Object.assign(f.crew, { x: 8, y: 8 }); startRecording(f.s); step(f.s);
  assert.equal(airlockLayout(f.site, f.controller).ok, true);
  assert.ok(airEvents(f.s).some(e => e.actor === f.crew.id && e.suitOxygen > 0));
  assert.equal(!!f.s.flags.airWarning, false);
});
