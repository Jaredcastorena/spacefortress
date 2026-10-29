import { settlementSite } from './region.js';
import {tileAt,positionOf,sameCell,horizontalNeighbors} from './spatial.js';
import {emitEvent,tileEntityId} from './telemetry.js';

// One record owns both landing references and the hatch. Construction/save
// admission and paid work share this record; no view operation creates supplies.
export const STAIR = Object.freeze({minimumCondition:50,openTicks:3,gasConductance:.6,heatConductance:.8,waterFlow:.5});
const point=p=>p&&Object.keys(p).length===3&&['x','y','z'].every(k=>Number.isSafeInteger(p[k]));
const fields=['id','kind','lower','upper','hp','mode','openUntil'];
function shape(link){
 return link&&Object.keys(link).length===fields.length&&fields.every(k=>Object.hasOwn(link,k))&&typeof link.id==='string'&&/^vertical-[1-9][0-9]*$/.test(link.id)&&link.kind==='stairwell'&&point(link.lower)&&point(link.upper)&&link.lower.x===link.upper.x&&link.lower.y===link.upper.y&&link.upper.z===link.lower.z+1&&Number.isFinite(link.hp)&&link.hp>=0&&link.hp<=100&&['auto','open','closed'].includes(link.mode)&&Number.isSafeInteger(link.openUntil)&&link.openUntil>=0;
}
export function stairLinks(site){
 const links=site?.verticalLinks;if(!Array.isArray(links))return [];
 return links.filter(link=>shape(link)&&links.filter(other=>other?.id===link.id).length===1&&[link.lower,link.upper].every(p=>tileAt(site,p)?.verticalLink===link.id));
}
export function validateVerticalLinks(site){
 const links=stairLinks(site);
 if(!Array.isArray(site.verticalLinks)||links.length!==site.verticalLinks.length)throw new Error('Invalid stairwell connection.');
 for(const link of links)for(const p of [link.lower,link.upper]){const t=tileAt(site,p);if(t.terrain!=='floor'||t.building)throw new Error('Invalid stairwell landing.');}
 for(const t of site.tiles)if(Object.hasOwn(t,'verticalLink')&&!links.some(link=>link.id===t.verticalLink&&(sameCell(t,link.lower)||sameCell(t,link.upper))))throw new Error('Orphan stairwell landing.');
}
export const stairOpen=(site,link)=>link.hp<STAIR.minimumCondition||link.mode==='open'||link.mode==='auto'&&link.openUntil>(site.atmosphere?.tick??0);
export function stairAt(site,p){return stairLinks(site).find(link=>sameCell(link.lower,p)||sameCell(link.upper,p))||null;}
export function stairDestination(site,from,to){
 if(from?.site!==undefined&&from.site!==site.id||to?.site!==undefined&&to.site!==site.id)return null;
 const link=stairAt(site,from);
 if(!link||link.hp<STAIR.minimumCondition||link.mode==='closed')return null;
 const target=sameCell(from,link.lower)?link.upper:link.lower;
 if([from,target].some(p=>{const t=tileAt(site,p);return t.terrain!=='floor'||t.fire||t.building;}))return null;
 return sameCell(to,target)?positionOf(target):null;
}
export function walkingNeighbors(site,p){
 const result=horizontalNeighbors(p),link=stairAt(site,p);
 if(link){const target=sameCell(p,link.lower)?link.upper:link.lower;if(stairDestination(site,p,target))result.push(positionOf(target));}
 return result;
}
export function touchStairHatch(site,from,to){
 const link=stairAt(site,from);if(!link||!stairDestination(site,from,to))return false;
 if(link.mode==='auto')link.openUntil=(site.atmosphere?.tick??0)+STAIR.openTicks;
 return true;
}
export function setStairHatch(s,siteId,connection,mode){
 const site=s.sites[siteId],link=stairLinks(site).find(link=>link.id===connection);
 const reject=(code,message)=>({ok:false,code,message});
 if(!link)return reject('missing_stairwell','Select an existing stairwell.');
 if(!['auto','open','closed'].includes(mode))return reject('invalid_hatch_mode','Choose auto, open or closed.');
 if(link.hp<STAIR.minimumCondition)return reject('damaged_stairwell','Repair this damaged stairwell before controlling its hatch.');
 if(mode==='closed'&&[...s.crew,...s.creatures].some(c=>c.health>0&&c.site===siteId&&(sameCell(positionOf(c),link.lower)||sameCell(positionOf(c),link.upper))))return reject('occupied_stairwell','Clear both stair landings before closing the hatch.');
 if(link.mode===mode)return {ok:true};
 const previous=link.mode;link.mode=mode;link.openUntil=0;
 emitEvent(s,'vertical.hatch.changed',{entity:`site:${siteId}`,connection:link.id,previous,mode,lower:tileEntityId(siteId,link.lower.x,link.lower.y,link.lower.z),upper:tileEntityId(siteId,link.upper.x,link.upper.y,link.upper.z)});
 return {ok:true};
}

export const MAX_DECKS=8;
export const supportedFloor=(site,p)=>{const below=tileAt(site,{...p,z:p.z-1});return !!below&&(below.terrain==='floor'||below.building==='wall'&&below.hp>0);};
export const STAIR_WORK=Object.freeze({repair:{cost:{alloy:1},work:8},remove:{cost:{alloy:1},work:12}});
export function stairJobClaims(j,p,site){
 if(j.building!=='stairwell')return false;
 if(j.kind==='build')return sameCell(j,p)||sameCell({...j,z:j.z+1},p);
 const link=site?.verticalLinks?.find(link=>link.id===j.connection);
 return !!link&&(sameCell(link.lower,p)||sameCell(link.upper,p));
}
export function stairPlacement(s,site,lower,ignoreJob=null){
 const reject=(code,message)=>({ok:false,code,message}),bottom=tileAt(site,lower),upper={...positionOf(lower),z:lower.z+1},top=tileAt(site,upper);
 if(!settlementSite(site)||lower.z<0||upper.z>=MAX_DECKS)return reject('stair_limit','Stairs require a colony floor with room for another deck.');
 if(!bottom||bottom.terrain!=='floor'||bottom.building||bottom.verticalLink||bottom.drop||bottom.fire)return reject('stair_landing','Start stairs on a clear habitat floor.');
 if(!top&&upper.z!==site.levels.length)return reject('stair_layout','The next deck must directly follow the existing decks.');
 if(top&&(!['void','floor'].includes(top.terrain)||top.building||top.verticalLink||top.drop||top.fire||top.cable||top.pipe||top.waterPipe))return reject('stair_landing','Clear the upper landing first.');
 if(s.jobs.some(j=>j.id!==ignoreJob&&j.site===site.id&&(sameCell(j,upper)||stairJobClaims(j,upper,site)||stairJobClaims(j,lower,site))))return reject('stair_endpoint_reserved','Another job claims one of these stair landings.');
 return {ok:true,upper};
}
export function commissionStairwell(s,site,job){
 const result=stairPlacement(s,site,positionOf(job),job.id);if(!result.ok)return result;
 const {upper}=result;
 if(!tileAt(site,upper)){
  site.levels.push({z:upper.z,name:`Deck ${upper.z}`});
  for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({x,y,z:upper.z,terrain:'void',building:null,hp:100,drop:null,variant:(y*site.size+x)%4,powered:false,cable:null,circuit:null,powerStatus:null,wetShort:false,liquid:0,pipe:null,waterPipe:null});
 }
 const link={id:`vertical-${s.nextId++}`,kind:'stairwell',lower:positionOf(job),upper,hp:100,mode:'auto',openUntil:0};site.verticalLinks.push(link);
 for(const p of [link.lower,link.upper]){const t=tileAt(site,p);t.terrain='floor';t.verticalLink=link.id;}
 emitEvent(s,'vertical.constructed',{entity:`site:${site.id}`,actor:job.worker,job:job.id,connection:link.id,lower:tileEntityId(site.id,link.lower.x,link.lower.y,link.lower.z),upper:tileEntityId(site.id,upper.x,upper.y,upper.z),cost:job.cost});
 return {ok:true,link};
}

const rejectWork=(code,message)=>({ok:false,code,message});
export function stairWorkBlock(s,site,link,kind,ignoreJob=null,canLeave=()=>false){
 if(!link)return rejectWork('missing_stairwell','The stairwell no longer exists.');
 if(s.jobs.some(j=>j.id!==ignoreJob&&j.site===site.id&&[link.lower,link.upper].some(p=>sameCell(j,p)||stairJobClaims(j,p,site))))return rejectWork('stair_endpoint_reserved','Finish or cancel the work claiming either stair landing.');
 if([link.lower,link.upper].some(p=>tileAt(site,p)?.fire))return rejectWork('burning_stairwell','Suppress the fire at both stair landings first.');
 const occupied=[...s.crew,...s.creatures].some(c=>c.health>0&&c.site===site.id&&[link.lower,link.upper].some(p=>sameCell(positionOf(c),p)));
 if((kind==='remove'||link.mode==='closed')&&occupied)return rejectWork('occupied_stairwell','Clear both stair landings before sealing the hatch.');
 if(kind==='remove'&&!canLeave(link))return rejectWork('stranded_stairwell','Bring upstairs crew and animals down or provide another usable route to floor 0 before dismantling.');
 return {ok:true};
}
export function completeStairWork(s,site,job,canLeave){
 const link=stairAt(site,positionOf(job));
 if(link?.id!==job.connection)return rejectWork('missing_stairwell','The designated stairwell no longer exists.');
 const ready=stairWorkBlock(s,site,link,job.kind,job.id,canLeave);if(!ready.ok)return ready;
 const event={entity:`site:${site.id}`,actor:job.worker,job:job.id,connection:link.id,lower:tileEntityId(site.id,link.lower.x,link.lower.y,link.lower.z),upper:tileEntityId(site.id,link.upper.x,link.upper.y,link.upper.z),cost:job.cost};
 if(job.kind==='repair'){
  const previous=link.hp;link.hp=100;
  if(link.mode==='auto')link.openUntil=(site.atmosphere?.tick??s.tick)+STAIR.openTicks;
  emitEvent(s,'vertical.repaired',{...event,previous,condition:link.hp});
  return {ok:true};
 }
 // Paid sealing is atomic with detaching both references. Floors, people,
 // liquid, room gas and all owned inventories stay in their existing places.
 for(const p of [link.lower,link.upper])delete tileAt(site,p).verticalLink;
 site.verticalLinks=site.verticalLinks.filter(other=>other.id!==link.id);
 const refund={alloy:3};emitEvent(s,'vertical.removed',{...event,sealed:true,refund});
 return {ok:true,refund};
}
export function validateStairJobs(s){
 for(const job of s.jobs){
  const site=s.sites[job.site],isWork=Object.hasOwn(job,'connection')||job.building==='stairwell'&&job.kind!=='build';
  if(isWork){
   const def=STAIR_WORK[job.kind],link=stairAt(site,positionOf(job));
   if(job.building!=='stairwell'||!def||job.connection!==link?.id||!link||job.work!==def.work||Object.keys(job.cost).length!==1||job.cost.alloy!==def.cost.alloy||job.kind==='remove'&&!sameCell(job,link.lower))throw new Error('Invalid stairwell maintenance order.');
  }
  if(job.building!=='stairwell')continue;
  if(s.jobs.some(other=>other!==job&&other.site===job.site&&(stairJobClaims(job,positionOf(other),site)||site.verticalLinks.some(link=>[link.lower,link.upper].some(p=>stairJobClaims(job,p,site)&&stairJobClaims(other,p,site))))))throw new Error('Duplicate stairwell endpoint reservation.');
 }
}
