import test from 'node:test';
import assert from 'node:assert/strict';
import { breathe, breatheBatch, breathable, emptyGas, gasAmount, refreshRoom, SUIT_PER_POINT } from '../src/atmosphere.js';
import { FIRE } from '../src/fire.js';

const FLOOR = 56, INITIAL_OXYGEN = 56.065, BREATH = .0075;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function fixture(oxygen = INITIAL_OXYGEN) {
  const room = { volume: 35, cells: Array.from({ length: 35 }, (_, i) => `${i % 7 + 1},${Math.floor(i / 7) + 1}`),
    sealed: true, gas: { oxygen, inert: 280, co2: 0 }, smoke: 0 };
  refreshRoom(room);
  const site = { id: 'surface', rooms: [room], atmosphere: {
    tick: 0, vented: emptyGas(), injected: emptyGas(), breathed: 0, refilled: 0,
  } };
  const crew = [0, 1, 2].map(i => ({ id: `crew-${i}`, site: 'surface', x: i + 1,
    y: 1, health: 100, job: null, oxygen: i ? 100 : 98 }));
  return { room, site, crew };
}
function run({ room, site, crew }) {
  const suitOxygen = () => crew.reduce((n, c) => n + c.oxygen * SUIT_PER_POINT, 0);
  const oxygenTotal = () => room.gas.oxygen + suitOxygen();
  const gasTotal = () => gasAmount(room.gas) + gasAmount(site.atmosphere.vented) + suitOxygen();
  const before = { oxygen: oxygenTotal(), gas: gasTotal(), co2: room.gas.co2 + site.atmosphere.vented.co2,
    breathed: site.atmosphere.breathed, refilled: site.atmosphere.refilled };
  const result = breatheBatch(site, crew), values = [...result.values()];
  close(before.oxygen - oxygenTotal(), site.atmosphere.breathed - before.breathed);
  close(gasTotal(), before.gas);
  close(room.gas.co2 + site.atmosphere.vented.co2 - before.co2, site.atmosphere.breathed - before.breathed);
  close(values.reduce((sum, a) => sum + a.refillOxygen, 0), site.atmosphere.refilled - before.refilled);
  for (const a of values) for (const amount of Object.values(a)) assert.ok(Number.isFinite(amount) && amount >= 0);
  for (const c of crew) if (result.has(c.id)) {
    const a = result.get(c.id), demand = c.site === 'solar' ? .018 : c.job ? .01 : BREATH;
    close(a.roomOxygen + a.suitOxygen + a.unmetOxygen, demand);
  }
  assert.deepEqual(site.atmosphere.injected, emptyGas());
  return result;
}

test('sufficient room surplus covers all basal breaths when every suit is full', () => {
  const f = fixture(); f.crew.forEach(c => c.oxygen = 100); run(f);
  close(f.room.gas.oxygen, INITIAL_OXYGEN - 3 * BREATH);
  assert.equal(f.site.atmosphere.refilled, 0);
  assert.equal(breathable(f.room), true);
});

test('optional early suit charging preserves oxygen reserved for later basal breaths', () => {
  const f = fixture(); assert.ok(INITIAL_OXYGEN - FLOOR > f.crew.length * BREATH);
  const result = run(f);
  assert.ok(f.room.gas.oxygen >= FLOOR, `${f.room.gas.oxygen} < ${FLOOR}`);
  assert.equal(breathable(f.room), true);
  close(f.site.atmosphere.refilled, .0425);
  for (const a of result.values()) { close(a.roomOxygen, BREATH); assert.equal(a.suitOxygen, 0); }
});

test('multiple partial suits and different basal demands have identical per-ID allocations under permutation', () => {
  const a = fixture(), b = fixture();
  for (const f of [a, b]) { f.crew[0].oxygen = 98; f.crew[1].oxygen = 99.95; f.crew[2].oxygen = 70; f.crew[1].job = 1; }
  b.crew.reverse(); const first = run(a), second = run(b);
  assert.deepEqual(first, second); assert.deepEqual(a.room, b.room);
  assert.deepEqual(a.crew.map(c => [c.id, c.oxygen]), b.crew.toReversed().map(c => [c.id, c.oxygen]));
  assert.ok(first.get('crew-0').refillOxygen > first.get('crew-1').refillOxygen);
  close(first.get('crew-0').refillOxygen, first.get('crew-2').refillOxygen);
});

test('limited room oxygen is shared before finite suits expose actual unmet demand', () => {
  const f = fixture(FLOOR + .006);
  f.crew[0].oxygen = 0; f.crew[1].oxygen = .025; f.crew[2].oxygen = 100;
  const result = run(f);
  for (const a of result.values()) close(a.roomOxygen, .002);
  close(result.get('crew-0').unmetOxygen, .0055);
  close(result.get('crew-1').suitOxygen, .0025); close(result.get('crew-1').unmetOxygen, .003);
  assert.equal(result.get('crew-2').unmetOxygen, 0);
  assert.equal(f.crew[0].oxygen, 0); assert.equal(f.crew[1].oxygen, 0);
  assert.equal(breathable(f.room), true);
});

test('singleton wrapper accepts synthetic health omission while batches skip dead, transit and other-site crew', () => {
  const a = fixture(), b = fixture(); a.crew = [a.crew[0]]; b.crew = [b.crew[0]];
  delete a.crew[0].health; delete b.crew[0].health;
  const ignored = [ { ...a.crew[0], id: 'dead', health: 0 }, { ...a.crew[0], id: 'transit', site: 'transit' },
    { ...a.crew[0], id: 'other', site: 'wreck' } ];
  const before = structuredClone(ignored);
  const batch = breatheBatch(a.site, [...a.crew, ...ignored]), singleton = breathe(b.site, b.crew[0]);
  assert.deepEqual([...batch.keys()], ['crew-0']); assert.deepEqual(batch.get('crew-0'), singleton);
  assert.deepEqual(a.site, b.site); assert.deepEqual(a.crew, b.crew); assert.deepEqual(ignored, before);
});

test('oxygen-floor and oxygen-unsafe rooms use actual suits without borrowing room oxygen', () => {
  for (const oxygen of [FLOOR, FLOOR - .0075, 105.01]) {
    const f = fixture(oxygen), before = structuredClone(f.room.gas), result = run(f);
    assert.deepEqual(f.room.gas, before);
    for (const a of result.values()) { assert.equal(a.roomOxygen, 0); close(a.suitOxygen, BREATH); assert.equal(a.refillOxygen, 0); }
  }
});

test('CO2 headroom caps basal conversion and prevents charging across the unchanged limit', () => {
  const f = fixture(70); f.room.gas.inert = 273.01; f.room.gas.co2 = 6.99; refreshRoom(f.room);
  run(f); assert.ok(f.room.co2Fraction <= .02); close(f.room.gas.co2, 7);
  close(f.site.atmosphere.refilled, 0); assert.equal(breathable(f.room), true);
  f.room.gas.co2 += .001; refreshRoom(f.room); const before = structuredClone(f.room.gas), result = run(f);
  assert.deepEqual(f.room.gas, before); for (const a of result.values()) assert.equal(a.roomOxygen, 0);
});

test('pressure floor prevents optional charging while unsafe pressure requires suits', () => {
  for (const inert of [132.5, 132.49, 465.01]) {
    const f = fixture(60); f.room.gas.inert = inert; refreshRoom(f.room);
    const safe = breathable(f.room), result = run(f);
    assert.equal(f.site.atmosphere.refilled, 0);
    if (safe) { assert.ok(f.room.pressure >= 55); for (const a of result.values()) close(a.roomOxygen, BREATH); }
    else for (const a of result.values()) { assert.equal(a.roomOxygen, 0); close(a.suitOxygen, BREATH); }
  }
});

test('smoke at its limit forbids room breathing and charging without consuming smoke or room gas', () => {
  const f = fixture(70); f.room.smoke = FIRE.smokeLimit * f.room.volume; refreshRoom(f.room);
  const before = structuredClone(f.room), result = run(f);
  assert.deepEqual(f.room, before); assert.equal(breathable(f.room), false);
  for (const a of result.values()) { assert.equal(a.roomOxygen, 0); assert.equal(a.refillOxygen, 0); close(a.suitOxygen, BREATH); }
});
