// Ice reserves are terrain resources, separate from extracted inventory.
export const ICE_SEAM_CAPACITY = 12;
export const ICE_EXTRACTION_AMOUNT = 6;
export const SURFACE_ICE_SEAMS = [[17,14],[18,14],[17,15],[18,15],[17,16],[18,16]];
export const iceAvailable = tile => !tile.building && tile.deposit?.resource === 'ice' && tile.deposit.remaining > 0;

export function initializeWater(s) {
  for (const site of Object.values(s.sites)) {
    const candidates = site.id === 'surface'
      ? SURFACE_ICE_SEAMS.map(([x,y]) => site.tiles[y * site.size + x])
      : site.id === 'comet' ? site.tiles.filter(t => t.terrain === 'ice') : [];
    for (const t of candidates) {
      // Migration never covers existing structures, inventories or designated work.
      if (t.deposit !== undefined || t.building || t.drop || t.cable ||
          !['ground','ice'].includes(t.terrain) ||
          s.jobs.some(j => j.site === site.id && (j.x === t.x && j.y === t.y || j.sources.some(source => source.x === t.x && source.y === t.y)))) continue;
      t.deposit = { resource: 'ice', remaining: ICE_SEAM_CAPACITY };
    }
  }
}

export function waterSupply(s, siteId = 'surface') {
  const result = { storedWater: 0, storedIce: 0, unminedIce: 0, processors: 0 };
  for (const t of s.sites[siteId].tiles) {
    result.storedWater += t.stock?.water || 0;
    result.storedIce += t.stock?.ice || 0;
    result.unminedIce += t.deposit?.remaining || 0;
    if (t.building === 'volatile') result.unminedIce += 12;
    if (t.building === 'iceProcessor' && t.hp > 0) result.processors++;
  }
  return result;
}

export function validateWater(s) {
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    if (t.deposit === undefined) continue;
    const d = t.deposit;
    if (!d || d.resource !== 'ice' || !Number.isInteger(d.remaining) || d.remaining < 0 || d.remaining > ICE_SEAM_CAPACITY ||
        !['surface','comet'].includes(site.id) || !['ground','floor','ice'].includes(t.terrain) || d.remaining > 0 && t.building)
      throw new Error('Invalid ice reserve.');
  }
}
