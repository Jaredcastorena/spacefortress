import test from 'node:test';
import assert from 'node:assert/strict';
import { planGasCompression, GAS_WORK_FRACTION } from '../src/gas-work.js';
import { emptyGas, gasAmount, addGas } from '../src/gas-species.js';
import { gasEnergy, gasHeatCapacity, gasLatentHeat, GAS_REFERENCE_KELVIN } from '../src/gas-thermal.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);
function vessel(amount, volume = 1, kelvin = GAS_REFERENCE_KELVIN, vapor = 0, structureCapacity = 0) {
  const gas = { ...emptyGas(), oxygen: amount * .2, inert: amount * .8, vapor };
  return { gas, volume, structureCapacity, heat: gasEnergy(gas, kelvin) + structureCapacity * kelvin };
}
function pressure(v) {
  const capacity = gasHeatCapacity(v.gas) + v.structureCapacity;
  return capacity > 0 && v.volume > 0 ? 10 * gasAmount(v.gas) / v.volume * (v.heat - gasLatentHeat(v.gas)) / capacity / GAS_REFERENCE_KELVIN : 0;
}
function apply(source, destination, plan) {
  const from = structuredClone(source), to = structuredClone(destination);
  addGas(from.gas, plan.gas, -1); addGas(to.gas, plan.gas);
  from.heat -= plan.heat; to.heat += plan.heat + plan.destinationEnergy;
  return { from, to };
}

test('uphill pumping spends a finite budget and retains precisely that work in discharge energy', () => {
  const source = vessel(8, 1), destination = vessel(30, 1), before = JSON.stringify({ source, destination });
  const energyBudget = 3 * GAS_WORK_FRACTION;
  const plan = planGasCompression({ source, destination, maxGas: 2, energyBudget });
  assert.ok(plan.amount > 0 && plan.amount < 2); assert.ok(plan.work > 0 && plan.work <= energyBudget);
  assert.equal(plan.limitedByWork, true);
  const { from, to } = apply(source, destination, plan);
  close(from.heat + to.heat, source.heat + destination.heat + plan.work);
  close(gasAmount(from.gas) + gasAmount(to.gas), 38);
  close(pressure(from), plan.sourcePressure); close(pressure(to), plan.destinationPressure);
  assert.equal(JSON.stringify({ source, destination }), before, 'planning changes no owners');
});

test('zero work permits only pressure-driven transport and cannot pump uphill', () => {
  const source = vessel(20), destination = vessel(10);
  const downhill = planGasCompression({ source, destination, maxGas: 10, energyBudget: 0 });
  close(downhill.amount, 5); assert.equal(downhill.work, 0);
  close(downhill.sourcePressure, downhill.destinationPressure);
  const uphill = planGasCompression({ source: destination, destination: source, maxGas: 2, energyBudget: 0 });
  assert.equal(uphill.amount, 0); assert.equal(uphill.work, 0);
});

test('removing a complete finite source has finite depletion work and preserves all its gas', () => {
  const source = vessel(10), destination = vessel(0);
  const plan = planGasCompression({ source, destination, maxGas: 10, energyBudget: 20 });
  assert.equal(plan.amount, 10); assert.ok(plan.work > 10 && plan.work < 20);
  const { from, to } = apply(source, destination, plan);
  close(from.heat, 0); assert.equal(gasAmount(from.gas), 0); close(gasAmount(to.gas), 10);
  close(to.heat, source.heat + plan.work); assert.equal(plan.sourcePressure, 0);
});

test('vent target includes paid discharge heating and never invents extra gas', () => {
  const source = vessel(30, 5), destination = vessel(8, 1, GAS_REFERENCE_KELVIN, 0, 20);
  const plan = planGasCompression({ source, destination, maxGas: 5, energyBudget: 5, targetPressure: 100 });
  assert.ok(plan.work > 0); assert.ok(plan.amount < 2); assert.equal(plan.limitedByTarget, true);
  close(plan.destinationPressure, 100); assert.ok(plan.destinationPressure <= 100);
  const { to } = apply(source, destination, plan); close(pressure(to), 100);
  const stopped = planGasCompression({ source, destination, maxGas: 5, energyBudget: 5, targetPressure: 80 });
  assert.equal(stopped.amount, 0);
});

test('vapor latent energy travels with its owner and cannot fund compression', () => {
  const source = vessel(4, 1, 310, 6), destination = vessel(30, 1, 280, 2);
  const unfunded = planGasCompression({ source, destination, maxGas: 2, energyBudget: 0 });
  assert.equal(unfunded.amount, 0);
  const plan = planGasCompression({ source, destination, maxGas: 2, energyBudget: 1 });
  assert.ok(plan.work > 0 && plan.work <= 1); close(plan.gas.vapor / plan.amount, .6);
  close(plan.heat, gasHeatCapacity(plan.gas) * 310 + 540 * plan.gas.vapor);
  const { from, to } = apply(source, destination, plan);
  close(from.gas.vapor + to.gas.vapor, 8);
  close(from.heat + to.heat, source.heat + destination.heat + plan.work);
  close(pressure(to), plan.destinationPressure);
});

test('a vent includes its whole paid motor and discharge envelope in the target solve', () => {
  const source = vessel(30, 5), destination = vessel(8, 1, GAS_REFERENCE_KELVIN, 0, 20);
  const plan = planGasCompression({ source, destination, maxGas: 5, energyBudget: 1.3, destinationEnergy: 2, targetPressure: 100 });
  assert.ok(plan.work > 0 && plan.work <= 1.3); assert.equal(plan.destinationEnergy, 2);
  const { from, to } = apply(source, destination, plan);
  close(pressure(to), 100); assert.ok(plan.destinationPressure <= 100);
  close(from.heat + to.heat, source.heat + destination.heat + 2);
  const limited = planGasCompression({ source, destination, maxGas: 5, energyBudget: 1.3, destinationEnergy: 2, targetPressure: 80.01 });
  assert.equal(limited.amount, 0); assert.equal(limited.work, 0); assert.equal(limited.destinationEnergy, 2);
  assert.equal(limited.limitedByTarget, true);
  assert.throws(() => planGasCompression({ source, destination, maxGas: 5, energyBudget: 1.3, destinationEnergy: 1 }), TypeError);
  assert.throws(() => planGasCompression({ source, destination: vessel(0), maxGas: 0, energyBudget: 1, destinationEnergy: 2 }), TypeError);
});

test('selective extraction moves only the selected species and its own sensible heat', () => {
  const source = vessel(8); source.gas.co2 = 2; source.heat = gasEnergy(source.gas, 320);
  const destination = vessel(6, .25), selectableGas = { ...emptyGas(), co2: 2 };
  const plan = planGasCompression({ source, destination, selectableGas, maxGas: 2, energyBudget: .5 });
  assert.ok(plan.amount > 0 && plan.amount < 2);
  assert.equal(plan.gas.oxygen, 0); assert.equal(plan.gas.inert, 0); assert.equal(plan.gas.vapor, 0);
  close(plan.gas.co2, plan.amount); close(plan.heat, plan.amount * .2 * 320);
  const { from, to } = apply(source, destination, plan); close(pressure(from), plan.sourcePressure); close(pressure(to), plan.destinationPressure);
});

test('work agrees with independent numerical integration of the declared logarithmic head bound', () => {
  const source = vessel(12, 2, 340), destination = vessel(20, 1, 290);
  const plan = planGasCompression({ source, destination, maxGas: 1.5, energyBudget: 10 });
  assert.equal(plan.amount, 1.5);
  const outlet = Math.max(pressure(destination), plan.destinationPressure), inlet = pressure(source), slices = 4096;
  let integral = 0;
  for (let i = 0; i < slices; i++) {
    const removed = (i + .5) * plan.amount / slices;
    integral += Math.max(0, Math.log(outlet / (inlet * (1 - removed / 12)))) * plan.amount / slices;
  }
  close(plan.work, 340 / GAS_REFERENCE_KELVIN * integral, 1e-8);
});

test('more funding cannot reduce moved gas and each plan respects finite ownership', () => {
  const source = vessel(3, .25, 305, 1), destination = vessel(25, 1, 295);
  let previous = 0;
  for (const energyBudget of [0, .01, .1, .5, 1, 2, 5, 10]) {
    const p = planGasCompression({ source, destination, maxGas: 4, energyBudget });
    assert.ok(p.amount >= previous && p.amount <= 4); assert.ok(p.work >= 0 && p.work <= energyBudget);
    assert.ok(Object.values(p).filter(v => typeof v === 'number').every(Number.isFinite)); previous = p.amount;
  }
});

test('empty, zero-temperature and condensate-occluded volumes have explicit finite limits', () => {
  const empty = vessel(0), cold = vessel(2, 1, 0), blocked = vessel(0, 0);
  assert.equal(planGasCompression({ source: empty, destination: vessel(1), maxGas: 2, energyBudget: 2 }).amount, 0);
  assert.equal(planGasCompression({ source: vessel(1), destination: blocked, maxGas: 1, energyBudget: 2 }).amount, 0);
  const plan = planGasCompression({ source: cold, destination: empty, maxGas: 2, energyBudget: 0 });
  assert.equal(plan.amount, 2); assert.equal(plan.work, 0); assert.equal(plan.heat, 0); assert.equal(plan.destinationPressure, 0);
});

test('invalid owners, budgets, selections and targets reject without mutating inputs', () => {
  const source = vessel(5), destination = vessel(1), base = { source, destination, maxGas: 2, energyBudget: 1 };
  for (const override of [{ energyBudget: -1 }, { energyBudget: Infinity }, { maxGas: NaN }, { targetPressure: -1 },
    { selectableGas: { ...emptyGas(), oxygen: 2 } }, { source: { ...source, heat: -1 } },
    { destination: { ...destination, volume: 0 } }, { destination: { ...vessel(0), heat: 1 } }])
    assert.throws(() => planGasCompression({ ...base, ...override }), TypeError);
  assert.deepEqual(source, vessel(5)); assert.deepEqual(destination, vessel(1));
});

test('exhaust source target includes finite motor heat for dry and humid mixtures', () => {
  for (const vapor of [0, 2]) {
    const source = vessel(10, 1, GAS_REFERENCE_KELVIN, vapor, 20), destination = vessel(20);
    const target = pressure(source) - 1, allocated = 3;
    const plan = planGasCompression({ source, destination, maxGas: 2, energyBudget: allocated * GAS_WORK_FRACTION,
      sourceEnergy: allocated, minSourcePressure: target });
    const { from, to } = apply(source, destination, plan); from.heat += allocated - plan.work;
    assert.ok(plan.amount > 0 && plan.amount < 2 && plan.work > 0);
    assert.equal(plan.limitedByTarget, true); assert.ok(plan.work <= allocated * GAS_WORK_FRACTION);
    close(pressure(from), target); close(pressure(from), plan.sourcePressure);
    close(pressure(to), plan.destinationPressure);
    close(from.heat + to.heat, source.heat + destination.heat + allocated);
    close(gasAmount(from.gas) + gasAmount(to.gas), gasAmount(source.gas) + gasAmount(destination.gas));
    close(from.gas.vapor + to.gas.vapor, vapor);
  }
});

test('work and rate limits can stop exhaust above target without inventing energy or gas', () => {
  const source = vessel(10, 1, GAS_REFERENCE_KELVIN, 0, 20), destination = vessel(100);
  for (const [maxGas, energyBudget] of [[2, .001], [.001, 3 * GAS_WORK_FRACTION]]) {
    const plan = planGasCompression({ source, destination, maxGas, energyBudget, sourceEnergy: 3, minSourcePressure: 99 });
    const { from, to } = apply(source, destination, plan); from.heat += 3 - plan.work;
    assert.ok(plan.amount > 0 && plan.amount <= maxGas && plan.work <= energyBudget);
    assert.ok(pressure(from) > 99); close(pressure(from), plan.sourcePressure);
    close(from.heat + to.heat, source.heat + destination.heat + 3);
  }
});

test('source heat envelopes require structural custody and cannot also fund the destination', () => {
  const source = vessel(10, 1, GAS_REFERENCE_KELVIN, 0, 20), destination = vessel(20, 1, GAS_REFERENCE_KELVIN, 0, 20);
  const input = { source, destination, maxGas: 1, energyBudget: 3 * GAS_WORK_FRACTION, sourceEnergy: 3, minSourcePressure: 99 };
  for (const change of [{ source: vessel(10) }, { sourceEnergy: 1 }, { sourceEnergy: Infinity }, { minSourcePressure: -1 }, { destinationEnergy: 3 }])
    assert.throws(() => planGasCompression({ ...input, ...change }), /Invalid gas-work/);
  const blocked = planGasCompression({ ...input, maxGas: 0 });
  assert.equal(blocked.amount, 0); assert.equal(blocked.work, 0);
  const warmed = structuredClone(source); warmed.heat += 3;
  close(blocked.sourcePressure, pressure(warmed));
});
