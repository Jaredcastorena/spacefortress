import { tileAt, validCellPosition } from './spatial.js';

export const CARE_INTENTS = Object.freeze(['air','rest','meal','leisure','medical','temperature','sanitation']);
// The declared layout is validated before these named references.
export const validCrewPosition = validCellPosition;
function legacyPosition(site,p) {
  return Array.isArray(p) && p.length === 2 && !!tileAt(site,{x:p[0],y:p[1],z:0});
}
export function validateCrewLocations(s,{legacy=false}={}) {
  const check = (site,p) => {
    if (!(legacy ? legacyPosition(site,p) : validCrewPosition(site,p)))
      throw new Error(legacy ? 'Invalid legacy crew location.' : 'Invalid crew location.');
  };
  for (const c of s.crew) {
    const site=s.sites[c.site];
    if (c.medical?.bed != null) check(site,c.medical.bed);
    // Home belongs to surface even while its owner is at another site/transit.
    if (c.housing?.bunk != null) check(s.sites.surface,c.housing.bunk);
    if (CARE_INTENTS.includes(c.intent?.type) && c.intent.target !== null) check(site,c.intent.target);
    if (c.intent?.keepsake) check(site,c.intent.keepsake.target);
  }
}
export function migrateCrewLocations(s) {
  const convert = p => ({x:p[0],y:p[1],z:0});
  for (const c of s.crew) {
    if (c.medical?.bed != null) c.medical.bed=convert(c.medical.bed);
    if (c.housing?.bunk != null) c.housing.bunk=convert(c.housing.bunk);
    if (CARE_INTENTS.includes(c.intent?.type) && c.intent.target !== null) c.intent.target=convert(c.intent.target);
    if (c.intent?.keepsake) c.intent.keepsake.target=convert(c.intent.keepsake.target);
  }
}
