import { HEAT_CAPACITY, KELVIN_ZERO } from './thermal-units.js';
export const GAS_PER_TILE = 10;
export const REFERENCE_KELVIN = 20 + KELVIN_ZERO;
const amount = gas => gas.oxygen + gas.inert + gas.co2;
// A room is deliberately filled before thermal initialization in new games.
// Loaded rooms always require finite, nonnegative heat through save validation.
export const roomPressureFactor = room => room.heat === undefined ? 1 : (room.heat / (room.volume * HEAT_CAPACITY)) / REFERENCE_KELVIN;
export const roomPressure = (room, gas=room?.gas) => room ? amount(gas) / (room.volume * GAS_PER_TILE) * 100 * roomPressureFactor(room) : 0;
export const roomOxygenPressure = (room, gas=room?.gas) => room ? gas.oxygen / (room.volume * GAS_PER_TILE) * roomPressureFactor(room) : null;
// null is an unattainable positive target, never an unbounded material request.
export function gasAtRoomPressure(room, percent) {
  if(percent===0)return 0;
  const factor=roomPressureFactor(room);
  if(!(factor>0))return null;
  const quantity=(room.volume*GAS_PER_TILE*percent/100)/factor;
  return Number.isFinite(quantity)?quantity:null;
}
