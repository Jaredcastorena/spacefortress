import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, serialize, deserialize } from '../src/simulation.js';
import { breathe, breathable, emptyGas, gasAmount, refreshRoom, refreshAtmosphere, updateAtmosphere, SUIT_PER_POINT } from '../src/atmosphere.js';
import { FIRE } from '../src/fire.js';
import { totalResources } from '../src/inventory.js';
import { outpostReadiness } from '../src/outpost-readiness.js';

// Adjacent doubles are constructed independently of the production comparison.
function adjacent(value, delta) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(delta));
  return view.getFloat64(0);
}
function room(oxygen = 6.3999999999999995) {
  const r = { cells: ['1,1', '2,1', '1,2', '2,2'], volume: 4,
    gas: { oxygen, inert: 33.5925, co2: .0075 }, smoke: 0 };
  refreshRoom(r);
  return r;
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(freeze);
  }
  return value;
};

test('synthetic oxygen boundary accepts exactly the adjacent floor without changing gas', () => {
  const r = room(), before = structuredClone(r);
  assert.equal(r.gas.oxygen / 40, adjacent(.16, -1));
  freeze(r);
  assert.equal(breathable(r), true);
  assert.equal(breathable(r), true);
  assert.deepEqual(r, before);
  assert.equal(breathable(room(6.4)), true);
  for (const ratio of [adjacent(.16, -2), .16 - 1e-12, (6.4 - .0075) / 40, .159, .15]) {
    const low = room(ratio * 40);
    assert.equal(breathable(low), false, `real lower reading ${ratio}`);
  }
});

test('oxygen rounding allowance leaves every other breathing limit exact', () => {
  for (const corrupt of [
    r => { r.pressure = adjacent(55, -1); },
    r => { r.pressure = adjacent(150, 1); },
    r => { r.gas.oxygen = adjacent(.3, 1) * 40; },
    r => { r.co2Fraction = adjacent(.02, 1); },
    r => { r.smoke = FIRE.smokeLimit * r.volume; },
  ]) {
    const r = room(); corrupt(r); freeze(r);
    assert.equal(breathable(r), false);
  }
});

test('actual recycling and breathing produce the adjacent floor, then consume finite gas without free suit refill', () => {
  // Small sealed synthetic chamber isolates the actual recycled-oxygen
  // arithmetic observed in the ordinary journey. No gameplay acceptance claim.
  const r = room(6.3925); r.gas.co2 = .015; refreshRoom(r);
  const site = { id: 'wreck', size: 4, rooms: [r], atmosphere: {
    tick: 0, vented: emptyGas(), injected: emptyGas(), breathed: 0, refilled: 0,
  }, tiles: Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4), terrain: 'floor',
    building: [0, 3].includes(i % 4) || [0, 3].includes(Math.floor(i / 4)) ? 'wall' : null, hp: 100 })) };
  const scrubber = site.tiles[5];
  Object.assign(scrubber, { building: 'scrubber', powered: true, machine: { enabled: true, input: {} } });
  const c = { id: 'probe', site: 'wreck', x: 1, y: 1, job: null, oxygen: 40 };
  const total = () => gasAmount(r.gas) + gasAmount(site.atmosphere.vented) + c.oxygen * SUIT_PER_POINT;
  const before = total();
  updateAtmosphere({ tick: 0, sites: { wreck: site } });
  assert.equal(r.gas.co2, 0);
  breathe(site, c);
  assert.equal(r.gas.oxygen, 6.3999999999999995);
  assert.equal(breathable(r), true);
  assert.equal(site.atmosphere.refilled, 0);
  assert.equal(c.oxygen, 40);
  close(total(), before);
  const oxygen = r.gas.oxygen, exhaled = r.gas.co2;
  breathe(site, c);
  assert.equal(r.gas.oxygen, oxygen - .0075);
  assert.equal(r.gas.co2, exhaled + .0075);
  assert.equal(breathable(r), false, 'a real breath deficit is far outside one ULP');
  assert.equal(c.oxygen, 40);
  assert.equal(site.atmosphere.refilled, 0);
  breathe(site, c);
  assert.ok(c.oxygen < 40, 'a genuinely depleted room makes the suit supply the next breath');
  close(total(), before);
  assert.deepEqual(site.atmosphere.injected, emptyGas());
  assert.deepEqual(scrubber.machine.input, {});
});

test('finite suit refill and oxygen boundary survive exact save and deterministic continuation', () => {
  // Synthetic gas composition isolates the save boundary; existing colony
  // topology, inventory, equipment and every later simulation tick are retained.
  const s = createGame(), site = s.sites.surface, c = s.crew[0];
  const r = site.rooms.find(r => r.cells.includes(`${c.x},${c.y}`));
  r.gas.oxygen = r.volume * 10 * .16 + .1075; c.oxygen = 40;
  refreshAtmosphere(site);
  const before = gasAmount(r.gas) + c.oxygen * SUIT_PER_POINT;
  const stores = totalResources(s), refilled = site.atmosphere.refilled;
  breathe(site, c); refreshAtmosphere(site);
  assert.ok(c.oxygen > 40 && c.oxygen < 42);
  close(gasAmount(r.gas) + c.oxygen * SUIT_PER_POINT, before);
  close(site.atmosphere.refilled - refilled, (c.oxygen - 40) * SUIT_PER_POINT);
  assert.deepEqual(totalResources(s), stores);
  const raw = serialize(s), restored = deserialize(raw);
  assert.equal(serialize(restored), raw);
  for (let i = 0; i < 4; i++) {
    step(s); step(restored);
    assert.equal(serialize(restored), serialize(s));
    assert.equal(serialize(deserialize(serialize(s))), serialize(s));
  }
});

test('a breathable oxygen floor does not satisfy the separate five-unit packaged-air reserve', () => {
  // A synthetic proposed local resident isolates the provision guard. The
  // genuine late-staging checkpoint is independently probed outside fixtures.
  const s = createGame(), site = s.sites.wreck, c = s.crew[0];
  Object.assign(c, { site: 'wreck', x: 4, y: 11 });
  const r = room();
  site.rooms = [r];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    Object.assign(at(site, x, y), { terrain: 'floor', building: [0, 3].includes(x) || [0, 3].includes(y) ? 'wall' : null, hp: 100 });
  }
  refreshAtmosphere(site);
  const before = structuredClone(s), totals = totalResources(s);
  const readiness = outpostReadiness(s, 'wreck', [c.id]);
  assert.equal(readiness.rooms[0].breathable, true);
  assert.equal(readiness.provisions.available.air, 0);
  assert.equal(readiness.provisions.required.air, 5);
  assert.ok(readiness.blockers.some(b => b.code === 'air_reserve_low' && b.available === 0 && b.required === 5));
  assert.equal(readiness.ready, false);
  assert.deepEqual(s, before); assert.deepEqual(totalResources(s), totals);
});
