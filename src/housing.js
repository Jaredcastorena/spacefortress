import { roomAt, breathable } from './atmosphere.js';
import { thermalSafe } from './thermal.js';
import { livingAllowed, roomBenefit } from './rooms.js';
import { remember } from './crew.js';

const same = (a,b) => a && b && a[0] === b[0] && a[1] === b[1];
export function initializeHousing(s) { for (const c of s.crew) c.housing ??= { bunk: null }; }
export function bunkOwner(s, siteId, x, y) {
  return siteId === 'surface' ? s.crew.find(c => c.health > 0 && same(c.housing?.bunk, [x,y])) : null;
}
export const ownsBunk = (c, siteId, x, y) => siteId === 'surface' && same(c.housing?.bunk, [x,y]);
export function bunkAccessible(s, c, site, x, y) {
  const owner = bunkOwner(s, site.id, x, y);
  return !owner || owner.id === c.id;
}
export function housingObstruction(s, c, pathTo = null) {
  const home = c.housing.bunk;
  if (!home) return 'Uses communal bunks';
  const site = s.sites.surface, t = site.tiles[home[1] * site.size + home[0]];
  if (t?.building !== 'bunk') return 'Assigned bunk no longer exists';
  if (!t.hp) return 'Assigned bunk needs repair';
  if (!livingAllowed(site, ...home)) return 'Assigned bunk is in waste storage';
  const room = roomAt(site, ...home);
  if (!breathable(room) || !thermalSafe(room)) return 'Assigned bunk needs safe air and temperature';
  if (c.site !== 'surface') return 'Home reserved while away';
  if (pathTo && pathTo(site, c, [home]) === null) return 'Assigned bunk is unreachable';
  return null;
}
function releaseUnauthorizedSleep(s) {
  for (const c of s.crew) if (c.site === 'surface' && c.intent?.type === 'rest' && c.intent.target && !bunkAccessible(s,c,s.sites.surface,...c.intent.target)) c.intent.target = null;
}
export function setBunkOwner(s, siteId, x, y, crewId) {
  const site = s.sites[siteId], t = site?.tiles.find(t=>t.x===x&&t.y===y), next = crewId === null ? null : s.crew.find(c=>c.id===crewId&&c.health>0);
  if (siteId !== 'surface' || t?.building !== 'bunk' || (crewId !== null && !next)) return {ok:false,message:'Choose a surface bunk and a living crew member, or communal use.'};
  const previous = bunkOwner(s,siteId,x,y);
  if (previous === next || (!previous && !next)) return {ok:true};
  if (previous) { previous.housing.bunk = null; remember(s,previous,'housing-reassigned','My assigned bunk was reassigned to someone else or made communal.',-5); }
  if (next) { next.housing.bunk=[x,y]; if(next.intent?.type==='rest')next.intent.target=null; }
  releaseUnauthorizedSleep(s);return {ok:true};
}
export function reconcileHousing(s) {
  for (const c of s.crew) if (c.housing.bunk) {
    const [x,y] = c.housing.bunk;
    if (c.health <= 0 || s.sites.surface.tiles[y * s.sites.surface.size + x]?.building !== 'bunk') {
      c.housing.bunk=null;
      if(c.health>0)remember(s,c,'housing-lost','My assigned bunk is gone. I need somewhere new to sleep.',-6);
    }
  }
  releaseUnauthorizedSleep(s);
}
export function rememberHousingSleep(s,c,site) {
  if (!ownsBunk(c,site.id,c.x,c.y)) return;
  const settled = roomBenefit(s,site,c,'quarters');
  remember(s,c,'personal-bunk',settled ? 'Settled into my own bunk in comfortable living quarters.' : 'Rested in a bunk that is my own.',settled ? 8 : 4);
}
export function validateHousing(s) {
  const owners = new Set();
  for(const c of s.crew){
    if(!c.housing || !Object.hasOwn(c.housing,'bunk'))throw new Error('Missing housing assignment.');
    const home=c.housing.bunk;if(home===null)continue;
    if(!Array.isArray(home)||home.length!==2||!home.every(Number.isInteger)||home.some(n=>n<0||n>=s.sites.surface.size)||c.health<=0||s.sites.surface.tiles[home[1]*s.sites.surface.size+home[0]].building!=='bunk'||owners.has(home.join(',')))throw new Error('Invalid bunk ownership.');
    owners.add(home.join(','));
  }
  for(const c of s.crew)if(c.site==='surface'&&c.intent?.type==='rest'&&c.intent.target&&!bunkAccessible(s,c,s.sites.surface,...c.intent.target))throw new Error('Sleeping reservation violates bunk ownership.');
}
