import { GASES, gasAmount, gasPortion } from './gas-species.js';
import { GAS_REFERENCE_KELVIN, gasHeatCapacity, gasLatentHeat } from './gas-thermal.js';
import { GAS_PER_TILE } from './room-pressure.js';

// Game-scale work coefficient: one energy unit per gas unit at reference
// temperature and unit logarithmic pressure head. This is not an SI gas model.
export const GAS_WORK_COEFFICIENT = 1;
export const GAS_WORK_FRACTION = .65;

function owner(value) {
  if (!value || !value.gas || !GASES.every(k => Number.isFinite(value.gas[k]) && value.gas[k] >= 0)
    || !Number.isFinite(value.heat) || !Number.isFinite(value.volume) || value.volume < 0
    || !Number.isFinite(value.structureCapacity ?? 0) || (value.structureCapacity ?? 0) < 0)
    throw new TypeError('Invalid gas-work owner.');
  const amount = gasAmount(value.gas), capacity = gasHeatCapacity(value.gas) + (value.structureCapacity ?? 0);
  const sensible = value.heat - gasLatentHeat(value.gas);
  if (sensible < 0 || amount > 0 && value.volume === 0 || capacity === 0 && sensible !== 0)
    throw new TypeError('Invalid gas-work energy or volume.');
  const kelvin = capacity > 0 ? sensible / capacity : 0;
  const scale = value.volume > 0 ? 100 / (GAS_PER_TILE * value.volume * GAS_REFERENCE_KELVIN) : 0;
  const pressure = scale * amount * kelvin;
  if (![amount, capacity, sensible, kelvin, pressure].every(Number.isFinite))
    throw new TypeError('Unrepresentable gas-work owner.');
  return { amount, capacity, sensible, kelvin, scale, pressure, volume: value.volume };
}

// Integral of -log(1-r) from 0 to r. The limit at r=1 is finite:
// removing the final parcel does not require an artificial infinite budget.
function depletionIntegral(r) {
  if (r >= 1) return 1;
  if (r < 1e-4) return r * r * (.5 + r * (1 / 6 + r * (1 / 12 + r / 20)));
  return r + (1 - r) * Math.log1p(-r);
}

function logarithmicHead(sourceAmount, moved, inletPressure, outletPressure) {
  if (moved === 0 || outletPressure === 0) return 0;
  const free = Math.min(moved, Math.max(0, sourceAmount * (1 - outletPressure / inletPressure)));
  const paid = moved - free;
  if (paid <= 0) return 0;
  const remaining = sourceAmount - free;
  const initialHead = Math.max(0, Math.log(outletPressure) - Math.log(inletPressure) - Math.log(remaining / sourceAmount));
  return paid * initialHead + remaining * depletionIntegral(Math.min(1, paid / remaining));
}

/** Pure finite-parcel plan. Owners have gas, heat, volume and optional structural
 * capacity. selectableGas allows a filter to select CO2 without moving other
 * species. maxGas excludes smoke; callers retain payload/rate/storage bounds.
 *
 * The work law integrates falling inlet pressure against a conservative outlet
 * head (maximum initial/final pressure). Work is distributed through the parcel
 * and retained in its destination, so its heating participates in the solve.
 * destinationEnergy may supply the complete paid heat envelope when the drive
 * and discharge share a room (vents): work plus drive losses then sum to that
 * fixed envelope, rather than being added twice.
 * sourceEnergy supplies the paid envelope when the motor shares the inlet
 * room (exhaust): allocation minus receiver work heats the remaining source.
 * minSourcePressure constrains that final heated source. A device cannot
 * assign the same envelope to both ends.
 * It is a declared game approximation, not an isothermal discharge trajectory.
 */
export function planGasCompression({ source, destination, selectableGas = source?.gas, maxGas, energyBudget, targetPressure = Infinity, destinationEnergy = null, sourceEnergy = null, minSourcePressure = 0 }) {
  const from = owner(source), to = owner(destination);
  if (!Number.isFinite(maxGas) || maxGas < 0 || !Number.isFinite(energyBudget) || energyBudget < 0
    || !(targetPressure === Infinity || Number.isFinite(targetPressure) && targetPressure >= 0)
    || destinationEnergy !== null && (!Number.isFinite(destinationEnergy) || destinationEnergy < energyBudget || !(destination.structureCapacity > 0))
    || !Number.isFinite(minSourcePressure) || minSourcePressure < 0
    || sourceEnergy !== null && (!Number.isFinite(sourceEnergy) || sourceEnergy < energyBudget || !(source.structureCapacity > 0) || destinationEnergy !== null)
    || !selectableGas || !GASES.every(k => Number.isFinite(selectableGas[k]) && selectableGas[k] >= 0 && selectableGas[k] <= source.gas[k]))
    throw new TypeError('Invalid gas-work request.');
  const available = gasAmount(selectableGas), maximum = Math.min(maxGas, available);
  const specificCapacity = available > 0 ? gasHeatCapacity(selectableGas) / available : 0;
  const specificLatent = available > 0 ? gasLatentHeat(selectableGas) / available : 0;
  const pressure = (amount, work) => {
    const capacity = to.capacity + amount * specificCapacity;
    return capacity > 0 ? to.scale * (to.amount + amount) * (to.sensible + amount * specificCapacity * from.kelvin + (destinationEnergy ?? work)) / capacity : 0;
  };
  const sourcePressure = (amount, work) => {
    const remaining = Math.max(0, from.amount - amount);
    if (sourceEnergy === null) return from.amount > 0 ? from.pressure * Math.max(0, 1 - amount / from.amount) : 0;
    // Unaffordable candidates are rejected by the work bound. Do not invent
    // negative motor heat while searching those provisional amounts.
    const motorHeat = Math.max(0, sourceEnergy - work);
    const capacity = from.capacity - amount * specificCapacity;
    return from.scale * remaining * (from.sensible - amount * specificCapacity * from.kelvin + motorHeat) / capacity;
  };
  const required = (amount, work) => {
    // Continuous zero-temperature limit of T log(Pout/Pin); no 0 * Infinity.
    if (amount === 0 || from.kelvin === 0) return 0;
    const head = Math.max(to.pressure, pressure(amount, work));
    return GAS_WORK_COEFFICIENT * from.kelvin / GAS_REFERENCE_KELVIN * logarithmicHead(from.amount, amount, from.pressure, head);
  };
  function candidate(amount) {
    let work = 0;
    // With the declared coefficient and minimum gas capacity (.2), this fixed
    // point is contractive. Use a fixed ceiling and fail explicitly if broken.
    for (let i = 0; i < 64; i++) {
      const next = required(amount, work);
      if (!Number.isFinite(next)) throw new RangeError('Unrepresentable compression work.');
      const converged = Math.abs(next - work) <= 1e-12 * Math.max(1, next);
      work = next;
      if (converged) {
        const finalPressure = pressure(amount, work);
        if (!Number.isFinite(finalPressure)) throw new RangeError('Unrepresentable discharge pressure.');
        const remainingPressure = sourcePressure(amount, work);
        if (!Number.isFinite(remainingPressure)) throw new RangeError('Unrepresentable source pressure.');
        return { amount, work, pressure: finalPressure, sourcePressure: remainingPressure };
      }
    }
    throw new Error('Gas-work solve did not converge.');
  }
  const empty = { amount: 0, work: 0, pressure: pressure(0, 0), sourcePressure: sourcePressure(0, 0) };
  if (!Number.isFinite(empty.pressure) || !Number.isFinite(empty.sourcePressure))
    throw new RangeError('Unrepresentable paid-drive pressure.');
  let result = empty, limitedByWork = false, limitedByTarget = maximum > 0 && (empty.pressure >= targetPressure || empty.sourcePressure < minSourcePressure);
  if (maximum > 0 && from.volume > 0 && to.volume > 0 && empty.pressure < targetPressure && empty.sourcePressure >= minSourcePressure) {
    const full = candidate(maximum);
    limitedByWork = full.work > energyBudget;
    limitedByTarget = full.pressure > targetPressure || full.sourcePressure < minSourcePressure;
    if (!limitedByWork && !limitedByTarget) result = full;
    else {
      let low = 0, high = maximum;
      for (let i = 0; i < 56; i++) {
        const next = candidate((low + high) / 2);
        if (next.work <= energyBudget && next.pressure <= targetPressure && next.sourcePressure >= minSourcePressure) { low = next.amount; result = next; }
        else high = next.amount;
      }
    }
  }
  const gas = gasPortion(selectableGas, result.amount);
  return { amount: result.amount, gas, heat: result.amount * (specificCapacity * from.kelvin + specificLatent), work: result.work, destinationEnergy: destinationEnergy ?? result.work,
    sourcePressure: result.sourcePressure,
    destinationPressure: result.pressure, limitedByWork, limitedByTarget };
}
