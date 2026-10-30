import { settlementSite } from './region.js';
import * as power from './power.js';
import { BUILDINGS } from './data.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { DIRECTIONS, tileAt } from './geometry.js';

export const BREAKER_DIRECTIONS = Object.freeze(Object.fromEntries(DIRECTIONS.map(direction=>[direction,true])));
export const BREAKER_MODES = ['manual','wet_fault','overload','wet_fault_and_overload'];
export const BREAKER_RATINGS = Object.freeze([4,8,16,32]);
export const BREAKER_OVERLOAD_TICKS = 3;
export const overloadMode=mode=>mode==='overload'||mode==='wet_fault_and_overload';
export const wetFaultMode=mode=>mode==='wet_fault'||mode==='wet_fault_and_overload';
const at=tileAt;
const state=t=>({...t.protection,...(t.protection.overload?{overload:{...t.protection.overload}}:{})});
const id=(site,t)=>tileEntityId(site.id,t.x,t.y,t.z);
export function initializeBreakerTile(t) {
 if(t.building==='breaker')t.protection??={kind:'breaker',direction:'ne',enabled:false,mode:'manual',tripped:false,cause:null};
}
// Requested enabled state survives damage and a trip. Actual contact closure
// additionally requires an intact mechanism and a cleared latch.
export function breakerClosed(t) {
 return !!(t?.building==='breaker'&&t.protection?.enabled&&!t.protection.tripped&&t.hp>0);
}
export function breakerStatus(s,site,t) {
 return t?.building==='breaker'?power.breakerConditions(s,site,t):null;
}
function changed(s,site,t,event,previous,cause,faultEntities=[],details={}) {
 emitEvent(s,event,{entity:id(site,t),previous,next:state(t),cause,faultEntities,tick:s.tick,...details});
}
export function setBreaker(s,siteId,x,y,enabled,direction,mode,z=0,rating) {
 const site=s.sites[siteId],t=at(site,x,y,z),p=t?.protection;
 if(t?.building!=='breaker'||!p||typeof enabled!=='boolean'||!Object.hasOwn(BREAKER_DIRECTIONS,direction)||!BREAKER_MODES.includes(mode)||(rating!==undefined&&!BREAKER_RATINGS.includes(rating)))return {ok:false,message:'Choose a breaker with valid contact controls and rating.'};
 const reconfigured=direction!==p.direction||mode!==p.mode||(rating!==undefined&&rating!==p.overload?.rating);
 // Evaluate the old contact before changing anything: an open-and-reconfigure
 // request cannot bypass the requirement to open it first.
 if(breakerClosed(t)&&reconfigured)return {ok:false,message:'Open the breaker before changing direction, protection mode or rating.'};
 if(enabled&&(t.hp<=0||p.tripped))return {ok:false,message:p.tripped?'Reset the tripped breaker before closing it.':'Repair the breaker before closing it.'};
 const overload=p.overload?{...p.overload}:overloadMode(mode)||rating!==undefined?{rating:8,ticks:0,lastThroughput:0,lastTick:null}:undefined;
 if(overload) {
  if(rating!==undefined)overload.rating=rating;
  if(!enabled||reconfigured||!overloadMode(mode)||p.tripped)overload.ticks=0;
  if(reconfigured){overload.lastThroughput=0;overload.lastTick=null;}
 }
 if(p.enabled===enabled&&!reconfigured&&p.overload?.ticks===overload?.ticks)return {ok:true};
 const previous=state(t);t.protection={...p,enabled,direction,mode,...(overload?{overload}:{})};
 power.refreshPower(s,site);changed(s,site,t,'power.breaker.changed',previous,'configuration');return {ok:true};
}
export function resetBreaker(s,siteId,x,y,z=0) {
 const site=s.sites[siteId],t=at(site,x,y,z),p=t?.protection;
 if(t?.building!=='breaker'||!p)return {ok:false,message:'Select a breaker.'};
 if(t.hp<=0||breakerClosed(t)||t.fire)return {ok:false,message:t.hp<=0?'Repair the breaker before resetting it.':t.fire?'Suppress the fire before resetting the breaker.':'Open the breaker before resetting it.'};
 if(!p.tripped&&p.cause===null&&!p.enabled&&(!p.overload||p.overload.ticks===0))return {ok:true};
 const previous=state(t);t.protection={...p,enabled:false,tripped:false,cause:null,...(p.overload?{overload:{...p.overload,ticks:0}}:{})};
 power.refreshPower(s,site);changed(s,site,t,'power.breaker.reset',previous,'manual_reset');return {ok:true};
}
// The allocator supplies actual energized fault IDs or attempted routed flow
// from its pure preview. This helper changes only the latch; the caller replans.
export function tripBreaker(s,site,t,faultEntities,details) {
 if(!breakerClosed(t))return false;
 const overload=details?.cause==='overload';
 if(overload) {
  if(!overloadMode(t.protection.mode)||!t.protection.overload||!Number.isFinite(details.attemptedThroughput)||!Number.isFinite(details.effectiveRating)||details.effectiveRating<0||details.attemptedThroughput<=details.effectiveRating)return false;
 } else if(details!==undefined||!wetFaultMode(t.protection.mode)||!Array.isArray(faultEntities)||!faultEntities.length)return false;
 const faults=overload?[]:[...new Set(faultEntities)].sort(),cause=overload?'overload':'wet_fault',p=t.protection;
 const previous=state(t);t.protection={...p,tripped:true,cause,...(p.overload?{overload:{...p.overload,ticks:0}}:{})};
 changed(s,site,t,'power.breaker.tripped',previous,cause,faults,overload?{attemptedThroughput:details.attemptedThroughput,effectiveRating:details.effectiveRating}:{});return true;
}
export function validateBreakers(s) {
 const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
 const fields=['kind','direction','enabled','mode','tripped','cause'];
 for(const site of Object.values(s.sites))for(const t of site.tiles) {
  if(t.building!=='breaker') {if(t.protection!==undefined)throw new Error('Protection belongs to a missing breaker.');continue;}
  const p=t.protection;
  if(t.terrain!=='floor'||t.cable!==null||!Number.isFinite(t.hp)||t.hp<0||t.hp>100)throw new Error('Invalid breaker placement or condition.');
  if((!exact(p,fields)&&!exact(p,[...fields,'overload']))||p.kind!=='breaker'||!Object.hasOwn(BREAKER_DIRECTIONS,p.direction)||!BREAKER_MODES.includes(p.mode)||typeof p.enabled!=='boolean'||typeof p.tripped!=='boolean'||(p.tripped?!['wet_fault','overload'].includes(p.cause):p.cause!==null))throw new Error('Invalid breaker protection state.');
  if(overloadMode(p.mode)||p.cause==='overload'||Object.hasOwn(p,'overload')) {
   const o=p.overload;
   if(!exact(o,['rating','ticks','lastThroughput','lastTick'])||!BREAKER_RATINGS.includes(o.rating)||!Number.isInteger(o.ticks)||o.ticks<0||o.ticks>=BREAKER_OVERLOAD_TICKS||((!overloadMode(p.mode)||p.tripped)&&o.ticks!==0)||!Number.isFinite(o.lastThroughput)||o.lastThroughput<0||(o.lastTick===null?o.lastThroughput!==0:!Number.isSafeInteger(o.lastTick)||o.lastTick<0||o.lastTick>s.tick))throw new Error('Invalid breaker overload state.');
  }
  if(t.powerPriority!==undefined||t.machine!==undefined||t.charge!==undefined||t.maintenance!==undefined)throw new Error('Breaker has unsupported powered equipment state.');
 }
 for(const j of s.jobs) {
  const t=at(s.sites[j.site],j.x,j.y,j.z??0);
  if(j.kind==='build'&&j.building==='breaker') {
   const def=BUILDINGS.breaker;
   if(!settlementSite(s.sites[j.site])||!t||t.terrain!=='floor'||t.building||t.cable!==null||j.work!==def.work||!exact(j.cost,Object.keys(def.cost))||Object.entries(def.cost).some(([k,n])=>j.cost[k]!==n))throw new Error('Invalid breaker construction.');
  }
  if(j.kind==='build'&&j.building==='cable'&&t?.building==='breaker')throw new Error('Cable cannot bypass a breaker contact.');
  if(t?.building==='breaker'&&['repair','remove'].includes(j.kind)) {
   const repair=j.kind==='repair';
   if(j.building!==null||j.work!==5||!exact(j.cost,repair?['alloy']:[])||(repair&&j.cost.alloy!==1)||(repair&&t.hp>=100))throw new Error('Invalid breaker work order.');
  }
 }
}
