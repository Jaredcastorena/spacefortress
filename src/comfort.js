import { BUILDINGS } from './data.js';
import { roomAt, breathable } from './atmosphere.js';
import { thermalSafe } from './thermal.js';
import { livingAllowed } from './rooms.js';
import { exposedWaste } from './sanitation.js';
import { remember } from './crew.js';

export const COMFORT_PREFERENCES = { art: 'Art and color', quiet: 'Quiet and privacy', company: 'Shared living spaces' };
export function initializeComfort(s) {
  for (const [i,c] of s.crew.entries()) c.housing.preference ??= ['art','quiet','company'][i % 3];
}

// Derived from the current compartment. Walls/doors isolate this abstract room-wide hum.
export function roomComfort(s, site, room, c = null) {
  if (!room) return { score: 0, usable: false, art: 0, noise: 0, crowding: 0, dirty: false, private: false, shared: false };
  const tiles = room.cells.map(k => { const [x,y]=k.split(',').map(Number); return site.tiles[y*site.size+x]; });
  const occupants = s.crew.filter(p=>p.health>0 && p.site===site.id && room.cells.includes(`${p.x},${p.y}`)).length;
  const beds = tiles.filter(t=>['bunk','medicalCot'].includes(t.building) && t.hp>0).length;
  const styles = new Map(); let noise = 0;
  for (const t of tiles) {
    const def=BUILDINGS[t.building]; if (!def || t.hp<=0) continue;
    if (def.comfortArt && (!def.demand || t.powered)) styles.set(t.building,Math.max(styles.get(t.building)||0,t.hp/100));
    if (def.noise && (t.powered || t.building==='reactor'&&t.powerStatus==='Generating') && t.machine?.enabled!==false) noise += def.noise;
  }
  const art=[...styles.values()].reduce((n,value)=>n+value,0), dirty=exposedWaste(s,site,room)>0;
  const crowding=Math.min(3,Math.max(0,Math.ceil(Math.max(beds,occupants)*4/room.volume)-1));
  const privateRoom=beds===1 && occupants<=1;
  const shared=tiles.some(t=>t.building==='commons' && t.hp>0);
  const preference=c?.housing.preference;
  const usable=breathable(room) && thermalSafe(room) && livingAllowed(site,tiles[0].x,tiles[0].y);
  const score=usable ? Math.max(-6,Math.min(6,art*(preference==='art'?2:1) + (preference==='quiet'&&privateRoom?1:0) + (preference==='company'&&shared?1:0) - Math.min(3,noise)*(preference==='quiet'?2:1) - crowding - (dirty?2:0))) : 0;
  return {score,usable,art,noise,crowding,dirty,private:privateRoom,shared};
}

export function experienceComfort(s,c,site) {
  const comfort=roomComfort(s,site,roomAt(site,c.x,c.y),c);
  if (!comfort.usable) return comfort;
  c.life.stress=Math.max(0,Math.min(100,c.life.stress-comfort.score*(comfort.score<0?.02:.04)));
  if (comfort.score>=2) remember(s,c,'comfortable-room','Spent restorative time in a room that suits me.',Math.min(6,comfort.score));
  else if (comfort.score<=-2) remember(s,c,'uncomfortable-room',comfort.noise ? 'Machinery kept humming through my rest.' : comfort.dirty ? 'Tried to relax beside exposed waste.' : 'Could not get comfortable in crowded living space.',Math.max(-6,comfort.score));
  return comfort;
}

export function validateComfort(s) {
  for (const c of s.crew) if (!Object.hasOwn(COMFORT_PREFERENCES,c.housing.preference)) throw new Error('Invalid room comfort preference.');
}
