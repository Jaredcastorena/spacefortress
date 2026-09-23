import * as power from './power.js';
import { BUILDINGS } from './data.js';
import { emitEvent, tileEntityId } from './telemetry.js';

export const BREAKER_DIRECTIONS = { east:[1,0], south:[0,1], west:[-1,0], north:[0,-1] };
export const BREAKER_MODES = ['manual','wet_fault'];
const at=(site,x,y)=>site&&Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
const state=t=>({...t.protection});
const id=(site,t)=>tileEntityId(site.id,t.x,t.y);
export function initializeBreakerTile(t) {
 if(t.building==='breaker')t.protection??={kind:'breaker',direction:'east',enabled:false,mode:'manual',tripped:false,cause:null};
}
// Requested enabled state survives damage and a trip. Actual contact closure
// additionally requires an intact mechanism and a cleared latch.
export function breakerClosed(t) {
 return !!(t?.building==='breaker'&&t.protection?.enabled&&!t.protection.tripped&&t.hp>0);
}
export function breakerStatus(s,site,t) {
 return t?.building==='breaker'?power.breakerConditions(s,site,t):null;
}
function changed(s,site,t,event,previous,cause,faultEntities=[]) {
 emitEvent(s,event,{entity:id(site,t),previous,next:state(t),cause,faultEntities,tick:s.tick});
}
export function setBreaker(s,siteId,x,y,enabled,direction,mode) {
 const site=s.sites[siteId],t=at(site,x,y),p=t?.protection;
 if(t?.building!=='breaker'||!p||typeof enabled!=='boolean'||!Object.hasOwn(BREAKER_DIRECTIONS,direction)||!BREAKER_MODES.includes(mode))return {ok:false,message:'Choose a breaker with valid contact controls.'};
 // Evaluate the old contact before changing anything: an open-and-reconfigure
 // request cannot bypass the requirement to open it first.
 if(breakerClosed(t)&&(direction!==p.direction||mode!==p.mode))return {ok:false,message:'Open the breaker before changing direction or protection mode.'};
 if(enabled&&(t.hp<=0||p.tripped))return {ok:false,message:p.tripped?'Reset the tripped breaker before closing it.':'Repair the breaker before closing it.'};
 if(p.enabled===enabled&&p.direction===direction&&p.mode===mode)return {ok:true};
 const previous=state(t);t.protection={...p,enabled,direction,mode};
 power.refreshPower(s,site);changed(s,site,t,'power.breaker.changed',previous,'configuration');return {ok:true};
}
export function resetBreaker(s,siteId,x,y) {
 const site=s.sites[siteId],t=at(site,x,y),p=t?.protection;
 if(t?.building!=='breaker'||!p)return {ok:false,message:'Select a breaker.'};
 if(t.hp<=0||breakerClosed(t)||t.fire)return {ok:false,message:t.hp<=0?'Repair the breaker before resetting it.':t.fire?'Suppress the fire before resetting the breaker.':'Open the breaker before resetting it.'};
 if(!p.tripped&&p.cause===null&&!p.enabled)return {ok:true};
 const previous=state(t);t.protection={...p,enabled:false,tripped:false,cause:null};
 power.refreshPower(s,site);changed(s,site,t,'power.breaker.reset',previous,'manual_reset');return {ok:true};
}
// The allocator supplies actual energized fault IDs from its pure preview.
// This helper changes only the latch; its caller replans and commits once.
export function tripBreaker(s,site,t,faultEntities) {
 if(!breakerClosed(t)||t.protection.mode!=='wet_fault'||!Array.isArray(faultEntities)||!faultEntities.length)return false;
 const faults=[...new Set(faultEntities)].sort();
 const previous=state(t);t.protection={...t.protection,tripped:true,cause:'wet_fault'};
 changed(s,site,t,'power.breaker.tripped',previous,'wet_fault',faults);return true;
}
export function validateBreakers(s) {
 const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
 const fields=['kind','direction','enabled','mode','tripped','cause'];
 for(const site of Object.values(s.sites))for(const t of site.tiles) {
  if(t.building!=='breaker') {if(t.protection!==undefined)throw new Error('Protection belongs to a missing breaker.');continue;}
  const p=t.protection;
  if(t.terrain!=='floor'||t.cable!==null||!Number.isFinite(t.hp)||t.hp<0||t.hp>100)throw new Error('Invalid breaker placement or condition.');
  if(!exact(p,fields)||p.kind!=='breaker'||!Object.hasOwn(BREAKER_DIRECTIONS,p.direction)||!BREAKER_MODES.includes(p.mode)||typeof p.enabled!=='boolean'||typeof p.tripped!=='boolean'||(p.tripped?p.cause!=='wet_fault':p.cause!==null))throw new Error('Invalid breaker protection state.');
  if(t.powerPriority!==undefined||t.machine!==undefined||t.charge!==undefined||t.maintenance!==undefined)throw new Error('Breaker has unsupported powered equipment state.');
 }
 for(const j of s.jobs) {
  const t=at(s.sites[j.site],j.x,j.y);
  if(j.kind==='build'&&j.building==='breaker') {
   const def=BUILDINGS.breaker;
   if(j.site!=='surface'||!t||t.terrain!=='floor'||t.building||t.cable!==null||j.work!==def.work||!exact(j.cost,Object.keys(def.cost))||Object.entries(def.cost).some(([k,n])=>j.cost[k]!==n))throw new Error('Invalid breaker construction.');
  }
  if(j.kind==='build'&&j.building==='cable'&&t?.building==='breaker')throw new Error('Cable cannot bypass a breaker contact.');
  if(t?.building==='breaker'&&['repair','remove'].includes(j.kind)) {
   const repair=j.kind==='repair';
   if(j.building!==null||j.work!==5||!exact(j.cost,repair?['alloy']:[])||(repair&&j.cost.alloy!==1)||(repair&&t.hp>=100))throw new Error('Invalid breaker work order.');
  }
 }
}
