import test from 'node:test';
import assert from 'node:assert/strict';
import { breathable, breathingBlock, breathingStatus, refreshRoom } from '../src/atmosphere.js';
import { FIRE } from '../src/fire.js';

// Set physical contents rather than the derived display cache.
function setPressure(r, pressure) { r.gas.inert=r.volume*10*pressure/100-r.gas.oxygen-r.gas.co2; }
function setCO2(r, fraction) { const total=r.gas.oxygen+r.gas.inert+r.gas.co2;r.gas.co2=total*fraction;r.gas.inert=total-r.gas.oxygen-r.gas.co2; }
function adjacent(value, delta) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(delta));
  return view.getFloat64(0);
}
function room() {
  const r = { volume: 4, gas: { oxygen: 8.4, inert: 31.6, co2: 0 }, smoke: 0 };
  refreshRoom(r);
  return r;
}
function immutable(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

test('breathing status distinguishes exterior from a safe room with nominal limits', () => {
  for (const outside of [null, undefined]) {
    assert.equal(breathingBlock(outside), 'exterior');
    assert.deepEqual(breathingStatus(outside), { breathable: false, block: 'exterior', oxygenPressure: null,
      minimumOxygenPressure: .16, maximumOxygenPressure: .3 });
  }
  const r = room();
  assert.deepEqual(breathingStatus(r), { breathable: true, block: null, oxygenPressure: r.gas.oxygen / 40,
    minimumOxygenPressure: .16, maximumOxygenPressure: .3 });
});

const failures = [
  ['smoke', r => { r.smoke = FIRE.smokeLimit * r.volume; }],
  ['low_pressure', r => { setPressure(r, adjacent(55, -1)); }],
  ['high_pressure', r => { setPressure(r, adjacent(150, 1)); }],
  ['low_oxygen', r => { r.gas.oxygen = adjacent(.16, -2) * 40; }],
  ['high_oxygen', r => { r.gas.oxygen = adjacent(.3, 1) * 40; }],
  ['high_co2', r => { setCO2(r, adjacent(.02, 1)); }],
];
for (const [code, change] of failures) test(`breathing status identifies ${code} without changing the room`, () => {
  const r = room(); change(r); const before = structuredClone(r); immutable(r);
  assert.equal(breathingBlock(r), code);
  assert.equal(breathingStatus(r).block, code);
  assert.equal(breathingStatus(r).breathable, false);
  assert.equal(breathable(r), false);
  assert.deepEqual(r, before);
});

test('first breathing failure follows the stable smoke, pressure, oxygen, CO2 priority', () => {
  for (let i = 0; i < failures.length; i++) {
    const r = room();
    // Opposite bounds cannot fail together; retain the earlier bound's value.
    for (let j = failures.length - 1; j >= i; j--) failures[j][1](r);
    assert.equal(breathingBlock(r), failures[i][0]);
  }
});

test('breathing status preserves inclusive limits and the one-ULP oxygen allowance', () => {
  for (const change of [
    r => { setPressure(r, 55); },
    r => { setPressure(r, 150); },
    r => { r.gas.oxygen = adjacent(.16, -1) * 40; },
    r => { r.gas.oxygen = .16 * 40; },
    r => { r.gas.oxygen = .3 * 40; },
    r => { setCO2(r, .02); },
    r => { r.smoke = adjacent(FIRE.smokeLimit, -1) * r.volume; },
  ]) {
    const r = room(); change(r); immutable(r);
    assert.equal(breathingBlock(r), null);
    assert.equal(breathingStatus(r).breathable, true);
    assert.equal(breathable(r), true);
  }
});

test('unordered physical temperature keeps pressure unbreathable', () => {
  const r = room(); r.heat = NaN; immutable(r);
  assert.equal(breathingBlock(r), 'low_pressure');
  assert.equal(breathingStatus(r).breathable, false);
  assert.equal(breathable(r), false);
});

test('tick144 diagnostic numbers reveal low oxygen partial pressure despite normal concentration', () => {
  const r = { volume: 35, gas: { oxygen: 55.46668, inert: 212.02012, co2: 0 }, smoke: 0 };
  refreshRoom(r); const before = structuredClone(r); immutable(r);
  assert.ok(r.oxygenFraction > .207 && r.oxygenFraction < .208);
  assert.ok(r.pressure > 76 && r.pressure < 77);
  const first = breathingStatus(r), second = breathingStatus(r);
  assert.equal(first.block, 'low_oxygen');
  assert.equal(first.oxygenPressure, 55.46668 / 350);
  assert.ok(first.oxygenPressure < first.minimumOxygenPressure);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
  assert.deepEqual(r, before);
});
