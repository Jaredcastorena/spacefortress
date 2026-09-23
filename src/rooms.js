import { roomAt, breathable } from './atmosphere.js';
import { temperature, thermalSafe } from './thermal.js';
import { exposedWaste } from './sanitation.js';

export const ROOM_ROLES = { general: 'General use', quarters: 'Living quarters', infirmary: 'Infirmary', farm: 'Greenhouse', waste: 'Waste storage' };
const key = t => `${t.x},${t.y}`;
export function initializeDesignations(s) { for (const site of Object.values(s.sites)) site.designations ??= []; }
export function roomDesignation(site, room) {
  const markers = room ? (site.designations || []).filter(d => room.cells.includes(key(d))) : [];
  const roles = [...new Set(markers.map(d => d.role))];
  return { markers, roles, role: roles.length > 1 ? 'conflict' : roles[0] || 'general' };
}
export function setRoomDesignation(s, siteId, x, y, role) {
  const site = s.sites[siteId];
  if (!site || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= site.size || y >= site.size || !Object.hasOwn(ROOM_ROLES, role)) return { ok: false, message: 'Choose a compartment and a valid purpose.' };
  const room = roomAt(site, x, y);
  if (!room && role !== 'general') return { ok: false, message: 'Select habitat flooring inside a compartment.' };
  site.designations = site.designations.filter(d => room ? !room.cells.includes(key(d)) : d.x !== x || d.y !== y);
  if (role !== 'general') site.designations.push({ x, y, role });
  return { ok: true };
}
export function livingAllowed(site, x, y) { return !roomDesignation(site, roomAt(site, x, y)).roles.includes('waste'); }
export function roomAcceptsResource(site, t, resource) {
  if (!site) return true;
  const { roles } = roomDesignation(site, roomAt(site, t.x, t.y));
  if (resource === 'waste' && roles.some(r => ['quarters', 'infirmary', 'farm'].includes(r))) return false;
  return !(['food', 'medicine'].includes(resource) && roles.includes('waste'));
}
export function roomStatus(s, site, room) {
  const designation = roomDesignation(site, room), { role } = designation;
  const result = { ...designation, ready: false, issues: [], occupants: 0, residents: 0, furnishings: 0, exposed: 0 };
  if (!room) { result.issues.push('No compartment at this location'); return result; }
  result.occupants = s.crew.filter(c => c.health > 0 && c.site === site.id && room.cells.includes(key(c))).length;
  result.residents = site.id === 'surface' ? s.crew.filter(c => c.health > 0 && c.housing?.bunk && room.cells.includes(c.housing.bunk.join(','))).length : 0;
  if (role === 'general') return result;
  if (role === 'conflict') { result.issues.push('Merged compartments have different purposes; choose one to resolve them'); return result; }
  const tiles = room.cells.map(k => { const [x,y] = k.split(',').map(Number); return site.tiles[y * site.size + x]; });
  const furniture = { quarters: 'bunk', infirmary: 'medicalCot', farm: 'farm', waste: 'stockpile' }[role];
  result.furnishings = tiles.filter(t => t.building === furniture && t.hp > 0).length;
  if (!result.furnishings) result.issues.push(`Needs ${ { quarters: 'a working bunk', infirmary: 'a working medical cot', farm: 'working hydroponics', waste: 'a working cargo depot' }[role] }`);
  if (!room.sealed) result.issues.push('Compartment is not sealed');
  result.exposed = exposedWaste(s, site, room);
  if (role !== 'waste') {
    if (!breathable(room)) result.issues.push('Needs breathable air');
    if (!thermalSafe(room)) result.issues.push('Needs 5–35 °C');
    if (result.exposed > 0) result.issues.push('Remove exposed waste');
    const noisy = tiles.some(t => ['reactor','galley','iceProcessor','artisan','refinery','fabricator','recycler','atmosphere','medlab', ...(role === 'farm' ? [] : ['farm'])].includes(t.building));
    if (noisy) result.issues.push('Separate industrial machinery from this room');
    if (role === 'quarters' && room.volume < result.furnishings * 4) result.issues.push('Needs at least four floor tiles per bunk');
    if (role === 'farm' && (temperature(room) < 10 || temperature(room) > 35)) result.issues.push('Crops need 10–35 °C');
  } else {
    if (!tiles.some(t => t.building === 'stockpile' && t.storage?.accepted.includes('waste'))) result.issues.push('A depot must accept waste');
    if (tiles.some(t => ['bunk','medicalCot','farm','commons'].includes(t.building))) result.issues.push('Move living, medical and farming furniture out of waste storage');
  }
  result.ready = result.issues.length === 0; return result;
}
export function roomBenefit(s, site, t, role) {
  const room = roomAt(site, t.x, t.y);
  if (roomDesignation(site, room).role !== role) return false;
  return roomStatus(s, site, room).ready;
}
export function cropRoomBlock(s, site, t) {
  if (t.building !== 'farm') return null;
  const room = roomAt(site, t.x, t.y), d = roomDesignation(site, room);
  if (d.roles.includes('waste')) return 'Crops cannot operate in waste storage';
  if (!d.roles.includes('farm')) return null;
  const status = roomStatus(s, site, room);
  return status.ready ? null : `Greenhouse: ${status.issues[0]}`;
}
export function validateDesignations(s) {
  for (const site of Object.values(s.sites)) {
    if (!Array.isArray(site.designations) || site.designations.length > site.tiles.length) throw new Error('Invalid room designations.');
    const anchors = new Set();
    for (const d of site.designations) {
      if (!d || !Number.isInteger(d.x) || !Number.isInteger(d.y) || d.x < 0 || d.y < 0 || d.x >= site.size || d.y >= site.size || d.role === 'general' || !Object.hasOwn(ROOM_ROLES, d.role) || anchors.has(key(d))) throw new Error('Invalid room designation marker.');
      anchors.add(key(d));
    }
  }
}
