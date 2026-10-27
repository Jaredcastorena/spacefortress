import { tileAt } from './spatial.js';

// Copy only location fields from a tile, actor or source. Omitted z is supported
// for legacy primary-object API callers; canonical saves require explicit z.
export const shipmentPosition = p => ({ x: p.x, y: p.y, z: p.z === undefined ? 0 : p.z });
const record = p => p !== null && typeof p === 'object' && !Array.isArray(p);
export function validShipmentPosition(site, p) {
  return record(p) && Object.keys(p).length === 3 && ['x','y','z'].every(k => Object.hasOwn(p,k)) &&
    !!tileAt(site,p);
}
function legacyPosition(site, p) {
  return Array.isArray(p) && p.length === 2 && !!tileAt(site,{x:p[0],y:p[1],z:0});
}
// Named fields only. Medical, bunk, leisure/keepsake and controller references
// have separate schemas; arbitrary arrays and scalar targets are not positions.
export function validateShipmentLocations(state, { legacy = false } = {}) {
  const target = (site, p) => {
    if (!(legacy ? legacyPosition(site,p) : validShipmentPosition(site,p))) {
      throw new Error(legacy ? 'Invalid legacy shipment location.' : 'Invalid shipment location.');
    }
  };
  for (const job of state.jobs) {
    if (!Array.isArray(job.sources)) continue; // Generic job validation owns this error.
    for (const source of job.sources) {
      if (!record(source) || (legacy ? Object.hasOwn(source,'z') : !Number.isSafeInteger(source.z)) ||
          !tileAt(state.sites[job.site],{x:source.x,y:source.y,z:legacy?0:source.z})) {
        throw new Error(legacy ? 'Invalid legacy material location.' : 'Invalid material location.');
      }
    }
  }
  for (const crew of state.crew) {
    const site = state.sites[crew.site], intent = crew.intent;
    if (crew.delivery) target(site,crew.delivery.target);
    if (intent?.type === 'haul' || intent?.type === 'salvage') target(site,intent.target);
    if (intent?.type === 'haul' && intent.destination) target(site,intent.destination.target);
  }
}
export function migrateShipmentLocations(state) {
  const convert = p => ({x:p[0],y:p[1],z:0});
  for (const job of state.jobs) if (Array.isArray(job.sources)) for (const source of job.sources) source.z = 0;
  for (const crew of state.crew) {
    if (crew.delivery) crew.delivery.target = convert(crew.delivery.target);
    if (crew.intent?.type === 'haul' || crew.intent?.type === 'salvage') crew.intent.target = convert(crew.intent.target);
    if (crew.intent?.type === 'haul' && crew.intent.destination) crew.intent.destination.target = convert(crew.intent.destination.target);
  }
}
