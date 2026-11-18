import { HEAT_CAPACITY, KELVIN_ZERO } from './thermal-units.js';

import { gasAmount, dryGasAmount, gasPortion } from './gas-species.js';

// Vapor carries its phase-change enthalpy in addition to sensible energy.
// Smoke remains a massless tracer; these are game-scale balancing constants.
export const GAS_HEAT_CAPACITY = .2;
export const VAPOR_HEAT_CAPACITY = 1;
export const VAPOR_LATENT_HEAT = 540;
export const GAS_REFERENCE_KELVIN = 20 + KELVIN_ZERO;
export const gasQuantity = gasAmount;
export const gasHeatCapacity = gas => GAS_HEAT_CAPACITY * dryGasAmount(gas) + VAPOR_HEAT_CAPACITY * (gas.vapor ?? 0);
export const gasLatentHeat = gas => VAPOR_LATENT_HEAT * (gas.vapor ?? 0);
export const gasEnergy = (gas, kelvin) => gasHeatCapacity(gas) * kelvin + gasLatentHeat(gas);
export const roomStructureCapacity = room => room.volume * HEAT_CAPACITY;
export const roomHeatCapacity = room => roomStructureCapacity(room) + (room.gasThermal === true ? gasHeatCapacity(room.gas) : 0);
export const roomKelvin = room => room.heat === undefined ? GAS_REFERENCE_KELVIN : (room.heat - (room.gasThermal === true ? gasLatentHeat(room.gas) : 0)) / roomHeatCapacity(room);
export const nodeKelvin = node => gasQuantity(node.gas) > 0 ? (node.heat === undefined ? GAS_REFERENCE_KELVIN : (node.heat - gasLatentHeat(node.gas)) / gasHeatCapacity(node.gas)) : null;
// Numeric parcels are explicitly dry gas; owned mixtures pass their composition.
export const parcelHeat = (amount, kelvin) => typeof amount === 'number' ? GAS_HEAT_CAPACITY * amount * kelvin : gasEnergy(amount, kelvin);

export function pressureAfterGas(room, delta, heat) {
  const amount = typeof delta === 'number' ? delta : gasQuantity(delta);
  const quantity = gasQuantity(room.gas) + amount;
  const thermal = room.gasThermal === true;
  const capacity = roomHeatCapacity(room) + (thermal ? (typeof delta === 'number' ? GAS_HEAT_CAPACITY * amount : gasHeatCapacity(delta)) : 0);
  const latent = thermal ? gasLatentHeat(room.gas) + (typeof delta === 'number' ? 0 : gasLatentHeat(delta)) : 0;
  const initial = room.heat ?? roomHeatCapacity(room) * GAS_REFERENCE_KELVIN + (thermal ? gasLatentHeat(room.gas) : 0);
  return 100 * quantity / (10 * room.volume) * (initial + heat - latent) / capacity / GAS_REFERENCE_KELVIN;
}

// A monotone, bounded solve uses the actual inlet temperature. It never
// allocates gas or changes the room; zero-kelvin gas can have a finite limiting
// pressure, so callers must provide their finite available parcel.
export function roomFillAmount(room, target, inletKelvin, available, inletGas = null) {
  if (!Number.isFinite(target) || target < 0 || !Number.isFinite(inletKelvin) || inletKelvin < 0 || !Number.isFinite(available) || available < 0) throw new Error('Invalid thermal fill request.');
  if (available === 0 || pressureAfterGas(room, 0, 0) >= target) return 0;
  const pressure = amount => { const parcel = inletGas ? gasPortion(inletGas, amount) : amount; return pressureAfterGas(room, parcel, parcelHeat(parcel, inletKelvin)); };
  if (pressure(available) <= target) return available;
  let low = 0, high = available;
  for (let i = 0; i < 60; i++) {
    const middle = (low + high) / 2;
    if (pressure(middle) <= target) low = middle; else high = middle;
  }
  return low;
}

// Equalize a room pair using the temperatures after the parcel has moved.
// Source gas leaves at its own temperature; the receiving structure and gas mix.
export function roomEqualizeAmount(source, destination) {
  const available=gasQuantity(source.gas),kelvin=roomKelvin(source);
  if(!destination)return available;
  const difference=amount=>{const parcel=gasPortion(source.gas,amount),negative=gasPortion(source.gas,-amount),heat=parcelHeat(parcel,kelvin);return pressureAfterGas(source,negative,-heat)-pressureAfterGas(destination,parcel,heat);};
  if(available<=0||difference(0)<=0)return 0;
  let low=0,high=available;
  for(let i=0;i<60;i++){const middle=(low+high)/2;if(difference(middle)>=0)low=middle;else high=middle;}
  return low;
}

// Call around an owned gas transfer, using the source temperature sampled
// before changing its gas quantities. The whole site's room/network energy is
// one ledger: internal transfers require no counter entry.
export function exportRoomHeat(site, room, amount, { boundary = false } = {}) {
  const parcel = typeof amount === 'number' ? gasPortion(room.gas, amount) : amount;
  const heat = parcelHeat(parcel, roomKelvin(room));
  room.heat -= heat;
  if (boundary) site.thermal.gasVented += heat;
  return heat;
}
export function importRoomHeat(site, room, heat, { boundary = false } = {}) {
  room.heat += heat;
  if (boundary) site.thermal.gasLoaded += heat;
}

export function initializeGasHeat(s, { legacy = false } = {}) {
  for (const site of Object.values(s.sites)) {
    const ledger = site.thermal;
    ledger.gasInitial = 0; ledger.gasLoaded = 0; ledger.gasVented = 0;
    for (const room of site.rooms) {
      if (room.gasThermal !== true) {
        const added = gasEnergy(room.gas, roomKelvin(room));
        room.heat += added; room.gasThermal = true; ledger.gasInitial += added;
      }
    }
    for (const tile of site.tiles) for (const node of [tile.pipe, tile.gasStore]) {
      if (!node) continue;
      if (legacy || node.heat === undefined) { node.heat = gasEnergy(node.gas, GAS_REFERENCE_KELVIN); ledger.gasInitial += node.heat; }
    }
  }
}
