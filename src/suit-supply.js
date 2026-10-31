import { SUIT_PER_POINT, gasAmount, roomAt, refreshAtmosphere } from './atmosphere.js';
import { gasAtRoomPressure } from './room-pressure.js';
import { suitReleaseStatus } from './suit-release-status.js';
import { tileAt, positionOf, sameCell } from './spatial.js';
import { take } from './inventory.js';
import { emitEvent, tileEntityId } from './telemetry.js';

// Packaged breathing mix uses the same finite conversion for local recovery
// and paid preflight preparation. Only oxygen is retained in the suit.
export function suitRefillPlan(c, { target = 100, maxPoints = 100, air = Infinity } = {}) {
  const from = c.oxygen, points = Math.min(maxPoints, Math.max(0, target - from));
  const required = points * SUIT_PER_POINT / .21, consumed = Math.min(air, required);
  const oxygen = consumed * .21;
  return { air: consumed, oxygen, ventedInert: consumed * .79, from,
    to: consumed === required ? from + points : Math.min(target, from + oxygen / SUIT_PER_POINT) };
}

function supply(tile) {
  if (tile?.building === 'stockpile' && tile.stock?.air > 0) return { inventory: tile.stock, slot: 'stock' };
  if (tile?.building === 'dock' && tile.hp > 0 && tile.imports?.air > 0) return { inventory: tile.imports, slot: 'imports' };
  return null;
}

export const suitSupplyGoals = site => site.tiles.filter(t => supply(t)).map(positionOf);

export function refillSuitFromSupply(s, site, c, tile) {
  if (!s.crew.includes(c) || !site || s.sites[c.site] !== site || tileAt(site,positionOf(c)) !== tile) return false;
  const source = supply(tile);
  if (!source || !sameCell(positionOf(c),positionOf(tile))) return false;
  const refill = suitRefillPlan(c, { target: 90, maxPoints: 2, air: source.inventory.air });
  const remaining = source.inventory.air - refill.air;
  if (!(refill.air > 0) || !take(source.inventory, { air: refill.air })) return false;
  // Generic extraction trims tiny remainders; gas accounting retains every
  // positive remainder because this transfer has no waste owner.
  if (remaining > 0) source.inventory.air = remaining;
  c.oxygen = refill.to;
  site.atmosphere.vented.inert += refill.ventedInert;
  emitEvent(s, 'crew.suit.refilled', { entity: c.id, actor: c.id, site: `site:${site.id}`,
    target: tileEntityId(site.id, tile.x, tile.y, positionOf(tile).z), slot: source.slot, ...refill });
  return true;
}

// This deliberate transfer never moves the actor or interrupts their work.
export function releaseSuitOxygen(s, crewId, points) {
  const reject = (code, message) => ({ ok: false, code, message });
  if (!Number.isInteger(points) || points < 1 || points > 100) {
    return reject('invalid_points', 'Choose an integer from 1 to 100 suit oxygen points.');
  }
  const status = suitReleaseStatus(s, crewId);
  if (status.blockedCode && !['insufficient_suit_oxygen', 'room_full'].includes(status.blockedCode)) {
    return reject(status.blockedCode, status.message);
  }
  const c = s.crew.find(member => member.id === crewId);
  if (!(c.oxygen >= points)) return reject('insufficient_suit_oxygen', 'Not enough suit oxygen for the requested release.');
  const site = s.sites[c.site], room = roomAt(site,c.x,c.y,c.z), oxygen = points * SUIT_PER_POINT;
  const candidate = { ...room.gas, oxygen: room.gas.oxygen + oxygen };
  const capacity = gasAtRoomPressure(room, 100);
  if (capacity === null) return reject('room_temperature', 'Room temperature cannot support a positive pressure target.');
  if (!(gasAmount(candidate) <= capacity)) {
    return reject('room_full', 'This room cannot hold the requested oxygen release.');
  }
  const suitBefore = c.oxygen;
  c.oxygen -= points;
  room.gas.oxygen = candidate.oxygen;
  site.atmosphere.injected.oxygen += oxygen;
  refreshAtmosphere(site);
  emitEvent(s, 'crew.suit.released', { entity: c.id, actor: c.id, site: status.destination.site,
    target: status.destination.tile, room: status.destination.room, points, oxygen,
    suitBefore, suitAfter: c.oxygen, from: { entity: c.id, slot: 'oxygen' },
    to: { entity: status.destination.room, slot: 'gas.oxygen' } });
  return { ok: true };
}
