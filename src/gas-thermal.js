import { HEAT_CAPACITY, KELVIN_ZERO } from './thermal-units.js';

// Energy and capacity use the same game units as habitat structures. Smoke is
// a massless tracer; all three tracked gases share one sensible heat capacity.
export const GAS_HEAT_CAPACITY = .2;
export const GAS_REFERENCE_KELVIN = 20 + KELVIN_ZERO;
export const gasQuantity = gas => gas.oxygen + gas.inert + gas.co2;
export const gasHeatCapacity = gas => GAS_HEAT_CAPACITY * gasQuantity(gas);
export const gasEnergy = (gas, kelvin) => gasHeatCapacity(gas) * kelvin;
export const roomStructureCapacity = room => room.volume * HEAT_CAPACITY;
export const roomHeatCapacity = room => roomStructureCapacity(room) + (room.gasThermal === true ? gasHeatCapacity(room.gas) : 0);
export const roomKelvin = room => room.heat === undefined ? GAS_REFERENCE_KELVIN : room.heat / roomHeatCapacity(room);
export const nodeKelvin = node => gasQuantity(node.gas) > 0 ? (node.heat === undefined ? GAS_REFERENCE_KELVIN : node.heat / gasHeatCapacity(node.gas)) : null;
export const parcelHeat = (amount, kelvin) => GAS_HEAT_CAPACITY * amount * kelvin;

export function pressureAfterGas(room, amount, heat) {
  const quantity = gasQuantity(room.gas) + amount;
  const capacity = roomStructureCapacity(room) + (room.gasThermal === true ? GAS_HEAT_CAPACITY * quantity : 0);
  return 100 * quantity / (10 * room.volume) * ((room.heat ?? roomHeatCapacity(room) * GAS_REFERENCE_KELVIN) + heat) / capacity / GAS_REFERENCE_KELVIN;
}

// A monotone, bounded solve uses the actual inlet temperature. It never
// allocates gas or changes the room; zero-kelvin gas can have a finite limiting
// pressure, so callers must provide their finite available parcel.
export function roomFillAmount(room, target, inletKelvin, available) {
  if (!Number.isFinite(target) || target < 0 || !Number.isFinite(inletKelvin) || inletKelvin < 0 || !Number.isFinite(available) || available < 0) throw new Error('Invalid thermal fill request.');
  if (available === 0 || pressureAfterGas(room, 0, 0) >= target) return 0;
  const pressure = amount => pressureAfterGas(room, amount, parcelHeat(amount, inletKelvin));
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
  const difference=amount=>pressureAfterGas(source,-amount,-parcelHeat(amount,kelvin))-pressureAfterGas(destination,amount,parcelHeat(amount,kelvin));
  if(available<=0||difference(0)<=0)return 0;
  let low=0,high=available;
  for(let i=0;i<60;i++){const middle=(low+high)/2;if(difference(middle)>=0)low=middle;else high=middle;}
  return low;
}

// Call around an owned gas transfer, using the source temperature sampled
// before changing its gas quantities. The whole site's room/network energy is
// one ledger: internal transfers require no counter entry.
export function exportRoomHeat(site, room, amount, { boundary = false } = {}) {
  const heat = parcelHeat(amount, roomKelvin(room));
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
