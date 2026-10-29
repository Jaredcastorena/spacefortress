import { sameCell } from './spatial.js';
import { shipmentPosition } from './shipment-locations.js';
import { ICE_SEAM_CAPACITY, validateDeposits } from './extraction.js';
export { ICE_SEAM_CAPACITY, ICE_EXTRACTION_AMOUNT, iceAvailable } from './extraction.js';
export const SURFACE_ICE_SEAMS = [[17,14],[18,14],[17,15],[18,15],[17,16],[18,16]];

export function initializeWater(s) {
  for (const site of Object.values(s.sites)) {
    const candidates = site.id === 'surface'
      ? SURFACE_ICE_SEAMS.map(([x,y]) => site.tiles[y * site.size + x])
      : site.id === 'comet' ? site.tiles.filter(t => t.terrain === 'ice') : [];
    for (const t of candidates) {
      // Migration never covers existing structures, inventories or designated work.
      if (t.deposit !== undefined || t.building || t.drop || t.cable ||
          !['ground','ice'].includes(t.terrain) ||
          s.jobs.some(j => j.site === site.id && (sameCell(shipmentPosition(j), shipmentPosition(t)) || j.sources.some(source => sameCell(source, shipmentPosition(t)))))) continue;
      t.deposit = { resource: 'ice', remaining: ICE_SEAM_CAPACITY };
    }
  }
}

export function waterSupply(s, siteId = 'surface') {
  const result = { storedWater: 0, storedIce: 0, unminedIce: 0, processors: 0 };
  for (const t of s.sites[siteId].tiles) {
    result.storedWater += t.stock?.water || 0;
    result.storedIce += t.stock?.ice || 0;
    result.unminedIce += t.deposit?.resource==='ice'?t.deposit.remaining:0;
    if (t.building === 'volatile') result.unminedIce += 12;
    if (t.building === 'iceProcessor' && t.hp > 0) result.processors++;
  }
  return result;
}

export const validateWater = validateDeposits;
