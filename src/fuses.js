import { settlementSite } from './region.js';
import * as power from './power.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { DIRECTIONS, tileAt } from './geometry.js';
import { PROTECTION_RATINGS, protectionClosed, FUSE_BUILD_COST, FUSE_BUILD_WORK } from './power-protection.js';

export const FUSE_DIRECTIONS=Object.freeze(Object.fromEntries(DIRECTIONS.map(direction=>[direction,true])));
export const FUSE_RATINGS=PROTECTION_RATINGS;
const state=t=>({...t.protection});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
export function initializeFuseTile(t) {
 if(t.building==='fuseBox')t.protection??={kind:'fuse',direction:'ne',enabled:false,blown:false,rating:8,lastThroughput:0,lastTick:null};
}
function changed(s,site,t,event,previous,cause,details={}) {
 emitEvent(s,event,{entity:tileEntityId(site.id,t.x,t.y,t.z),previous,next:state(t),cause,tick:s.tick,...details});
}
export function setFuse(s,siteId,x,y,enabled,direction,z=0,rating=8) {
 const site=s.sites[siteId],t=tileAt(site,x,y,z),p=t?.protection;
 if(t?.building!=='fuseBox'||p?.kind!=='fuse'||typeof enabled!=='boolean'||!Object.hasOwn(FUSE_DIRECTIONS,direction)||!FUSE_RATINGS.includes(rating))return {ok:false,message:'Choose a fuse box with valid contact controls and rating.'};
 const reconfigured=direction!==p.direction||rating!==p.rating;
 // Check the old contact: opening and reconfiguring in one request must fail.
 if(protectionClosed(t)&&reconfigured)return {ok:false,message:'Open the fuse switch before changing direction or rating.'};
 if(enabled&&(t.hp<=0||p.blown))return {ok:false,message:p.blown?'Replace the blown cartridge before closing the fuse switch.':'Repair the fuse box before closing it.'};
 if(p.enabled===enabled&&!reconfigured)return {ok:true};
 const previous=state(t);
 t.protection={...p,enabled,direction,rating,...(reconfigured?{lastThroughput:0,lastTick:null}:{})};
 power.refreshPower(s,site);changed(s,site,t,'power.fuse.changed',previous,'configuration');return {ok:true};
}
// The allocator supplies attempted routed flow and replans after opening every
// overloaded device. This helper changes only the disposable cartridge latch.
export function blowFuse(s,site,t,details) {
 if(t?.building!=='fuseBox'||t.protection?.kind!=='fuse'||!protectionClosed(t)||!Number.isFinite(details?.attemptedThroughput)||!Number.isFinite(details?.effectiveRating)||details.effectiveRating<0||details.attemptedThroughput<=details.effectiveRating)return false;
 const previous=state(t);t.protection={...t.protection,blown:true};
 changed(s,site,t,'power.fuse.blown',previous,'overload',{attemptedThroughput:details.attemptedThroughput,effectiveRating:details.effectiveRating});return true;
}
export function validateFuses(s) {
 const fields=['kind','direction','enabled','blown','rating','lastThroughput','lastTick'];
 for(const site of Object.values(s.sites))for(const t of site.tiles) {
  if(t.building!=='fuseBox') {if(t.building!=='breaker'&&t.protection!==undefined)throw new Error('Protection belongs to a missing fuse box.');continue;}
  const p=t.protection;
  if(t.terrain!=='floor'||t.cable!==null||!Number.isFinite(t.hp)||t.hp<0||t.hp>100)throw new Error('Invalid fuse placement or condition.');
  if(!exact(p,fields)||p.kind!=='fuse'||!Object.hasOwn(FUSE_DIRECTIONS,p.direction)||typeof p.enabled!=='boolean'||typeof p.blown!=='boolean'||!FUSE_RATINGS.includes(p.rating)||!Number.isFinite(p.lastThroughput)||p.lastThroughput<0||(p.lastTick===null?p.lastThroughput!==0:!Number.isSafeInteger(p.lastTick)||p.lastTick<0||p.lastTick>s.tick))throw new Error('Invalid fuse protection state.');
  if(t.powerPriority!==undefined||t.machine!==undefined||t.charge!==undefined||t.maintenance!==undefined)throw new Error('Fuse box has unsupported powered equipment state.');
 }
 for(const j of s.jobs)if(j.kind==='build'&&j.building==='fuseBox') {
  const site=s.sites[j.site],t=tileAt(site,j.x,j.y,j.z??0);
  if(!settlementSite(site)||!t||t.terrain!=='floor'||t.building||t.cable!==null||j.work!==FUSE_BUILD_WORK||!exact(j.cost,Object.keys(FUSE_BUILD_COST))||Object.entries(FUSE_BUILD_COST).some(([k,n])=>j.cost[k]!==n))throw new Error('Invalid fuse construction.');
 }
}
