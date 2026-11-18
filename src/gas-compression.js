import { roomAt } from './atmosphere.js';
import { GAS_WORK_FRACTION } from './gas-work.js';
import { positionOf } from './spatial.js';
import { emitEvent, tileEntityId, roomEntityId } from './telemetry.js';

export const GAS_DRIVES = Object.freeze(['gasPump', 'gasVent', 'gasExtractor']);
const fields = ['allocated', 'work', 'motorRoom', 'motorSpace'];
const tolerance = n => 1e-7 + Math.abs(n) * 1e-9;

export function initializeGasWork(site) {
  site.gasWork = { allocated: 0, work: 0, motorRoom: 0, motorSpace: 0 };
  site.thermal.compression = 0;
}

export function legacyGasWorkShadow(state) {
  return Object.values(state.sites || {}).some(site => Object.hasOwn(site, 'gasWork')
    || site.thermal && Object.hasOwn(site.thermal, 'compression'));
}

export function validateGasWork(state) {
  for (const site of Object.values(state.sites)) {
    const ledger = site.gasWork, heat = site.thermal;
    if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger) || Object.keys(ledger).length !== fields.length
      || !fields.every(k => Number.isFinite(ledger[k]) && ledger[k] >= 0)
      || !Number.isFinite(heat?.compression) || heat.compression < 0)
      throw new Error('Invalid gas compression ledger.');
    const error = tolerance(ledger.allocated);
    if (Math.abs(ledger.work + ledger.motorRoom + ledger.motorSpace - ledger.allocated) > error
      || ledger.work > GAS_WORK_FRACTION * ledger.allocated + error
      || !Number.isFinite(site.energy?.consumed) || ledger.allocated > site.energy.consumed + tolerance(site.energy.consumed)
      || Math.abs(heat.compression - ledger.work) > tolerance(ledger.work)
      || !Number.isFinite(heat.equipment) || ledger.motorRoom > heat.equipment + tolerance(heat.equipment))
      throw new Error('Gas compression energy does not balance.');
  }
}

// The caller already claimed a paid electrical grant and placed useful work
// in the receiving gas. Settle the rest exactly once in the device's actual
// room, or explicitly outside the modeled thermal owners.
export function settleGasWork(state, site, tile, allocated, work, details = {}) {
  if (!GAS_DRIVES.includes(tile.building) || !Number.isFinite(allocated) || allocated <= 0
    || !Number.isFinite(work) || work < 0 || work > GAS_WORK_FRACTION * allocated)
    throw new Error('Invalid gas compression settlement.');
  const room = roomAt(site, tile.x, tile.y, positionOf(tile).z), motorHeat = allocated - work;
  const ledger = site.gasWork;
  ledger.allocated += allocated; ledger.work += work;
  site.thermal.compression += work;
  if (room) {
    room.heat += motorHeat; site.thermal.equipment += motorHeat; ledger.motorRoom += motorHeat;
  } else ledger.motorSpace += motorHeat;
  emitEvent(state, 'gas.compression.applied', {
    ...details, entity: tileEntityId(site.id, tile.x, tile.y, positionOf(tile).z),
    allocated, work, motorHeat, heatRecipient: room ? roomEntityId(site.id, room) : `space:${site.id}`,
  });
}
