import { SUIT_PER_POINT, GAS_PER_TILE, gasAmount, roomAt } from './atmosphere.js';
import { immobile } from './mobility.js';

// Manual release uses only the actor's present reserve and physical room.
// Keep this reader independent of telemetry so observations stay read-only.
export function suitReleaseStatus(s, crewId) {
  const status = { available: false, maxPoints: 0, blockedCode: null, message: null,
    oxygenPerPoint: SUIT_PER_POINT, destination: null };
  const blocked = (code, message) => ({ ...status, blockedCode: code, message });
  const c = s.crew.find(member => member.id === crewId);
  if (!c) return blocked('unknown_crew', 'Unknown crew member.');
  if (!(c.health > 0)) return blocked('dead', 'Deceased crew cannot release suit oxygen.');
  if (immobile(c)) return blocked('immobile', 'This crew member needs carrying.');
  if (c.site === 'transit') return blocked('in_transit', 'Wait until this crew member arrives.');
  const site = s.sites[c.site];
  if (!site) return blocked('no_site', 'This crew member has no physical site.');
  const room = roomAt(site,c.x,c.y,c.z);
  if (!room?.sealed) return blocked('no_sealed_room', 'Enter a sealed room to release suit oxygen.');
  const anchor = [...room.cells].sort((a, b) => {
    const [ax, ay] = a.split(',').map(Number), [bx, by] = b.split(',').map(Number);
    return ay - by || ax - bx;
  })[0];
  status.destination = { site: `site:${site.id}`, tile: `tile:${site.id}:${c.x}:${c.y}`,
    room: `room:${site.id}:${anchor}` };
  if (!(c.oxygen >= 1)) return blocked('insufficient_suit_oxygen', 'Less than one point of suit oxygen remains.');
  for (let points = 100; points >= 1; points--) {
    const candidate = { ...room.gas, oxygen: room.gas.oxygen + points * SUIT_PER_POINT };
    if (c.oxygen >= points && gasAmount(candidate) <= room.volume * GAS_PER_TILE) {
      return { ...status, available: true, maxPoints: points };
    }
  }
  return blocked('room_full', 'This room has no capacity for one point of suit oxygen.');
}
