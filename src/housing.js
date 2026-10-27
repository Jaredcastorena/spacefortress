import { tileAt, sameCell, cellKey } from './spatial.js';
import { validCrewPosition } from './crew-locations.js';
import { crewPathToPosition as crewPathTo } from './navigation.js';
import { roomAt, breathable } from './atmosphere.js';
import { thermalSafe } from './thermal.js';
import { livingAllowed, roomBenefit } from './rooms.js';
import { remember } from './crew.js';

const same = sameCell;
export function initializeHousing(s) { for (const c of s.crew) c.housing ??= { bunk: null }; }
export function bunkOwner(s, siteId, x, y, z = 0) {
  return siteId === 'surface' ? s.crew.find(c => c.health > 0 && same(c.housing?.bunk, {x,y,z})) : null;
}
export const ownsBunk = (c, siteId, x, y, z = 0) => siteId === 'surface' && same(c.housing?.bunk, {x,y,z});
export function bunkAccessible(s, c, site, x, y, z = 0) {
  const owner = bunkOwner(s, site.id, x, y, z);
  return !owner || owner.id === c.id;
}
export function housingObstruction(s, c, pathTo = null) {
  const home = c.housing.bunk;
  if (!home) return 'Uses communal bunks';
  const site = s.sites.surface, t = tileAt(site,home);
  if (t?.building !== 'bunk') return 'Assigned bunk no longer exists';
  if (!t.hp) return 'Assigned bunk needs repair';
  if (!livingAllowed(site, home.x, home.y, home.z)) return 'Assigned bunk is in waste storage';
  const room = roomAt(site,home.x,home.y,home.z);
  if (!breathable(room) || !thermalSafe(room)) return 'Assigned bunk needs safe air and temperature';
  if (c.site !== 'surface') return 'Home reserved while away';
  if (pathTo && crewPathTo(s, site, c, [home]) === null) return 'Assigned bunk is unreachable';
  return null;
}
function releaseUnauthorizedSleep(s) {
  for (const c of s.crew) if (c.site === 'surface' && c.intent?.type === 'rest' && c.intent.target && !bunkAccessible(s,c,s.sites.surface,c.intent.target.x,c.intent.target.y,c.intent.target.z)) c.intent.target = null;
}
export function setBunkOwner(s, siteId, x, y, crewId,z=0) {
  const site = s.sites[siteId], t = tileAt(site,{x,y,z}), next = crewId === null ? null : s.crew.find(c=>c.id===crewId&&c.health>0);
  if (siteId !== 'surface' || t?.building !== 'bunk' || (crewId !== null && !next)) return {ok:false,message:'Choose a surface bunk and a living crew member, or communal use.'};
  const previous = bunkOwner(s,siteId,x,y,z);
  if (previous === next || (!previous && !next)) return {ok:true};
  if (previous) { previous.housing.bunk = null; remember(s,previous,'housing-reassigned','My assigned bunk was reassigned to someone else or made communal.',-5); }
  if (next) { next.housing.bunk={x,y,z}; if(next.intent?.type==='rest')next.intent.target=null; }
  releaseUnauthorizedSleep(s);return {ok:true};
}
export function reconcileHousing(s) {
  for (const c of s.crew) if (c.housing.bunk) {
    if (c.health <= 0 || tileAt(s.sites.surface,c.housing.bunk)?.building !== 'bunk') {
      c.housing.bunk=null;
      if(c.health>0)remember(s,c,'housing-lost','My assigned bunk is gone. I need somewhere new to sleep.',-6);
    }
  }
  releaseUnauthorizedSleep(s);
}
export function rememberHousingSleep(s,c,site) {
  if (!ownsBunk(c,site.id,c.x,c.y,c.z)) return;
  const settled = roomBenefit(s,site,c,'quarters');
  remember(s,c,'personal-bunk',settled ? 'Settled into my own bunk in comfortable living quarters.' : 'Rested in a bunk that is my own.',settled ? 8 : 4);
}
export function validateHousing(s) {
  const owners = new Set();
  for(const c of s.crew){
    if(!c.housing || !Object.hasOwn(c.housing,'bunk'))throw new Error('Missing housing assignment.');
    const home=c.housing.bunk;if(home===null)continue;
    if(!validCrewPosition(s.sites.surface,home)||c.health<=0||tileAt(s.sites.surface,home).building!=='bunk'||owners.has(cellKey(home)))throw new Error('Invalid bunk ownership.');
    owners.add(cellKey(home));
  }
  for(const c of s.crew)if(c.site==='surface'&&c.intent?.type==='rest'&&c.intent.target&&!bunkAccessible(s,c,s.sites.surface,c.intent.target.x,c.intent.target.y,c.intent.target.z))throw new Error('Sleeping reservation violates bunk ownership.');
}
