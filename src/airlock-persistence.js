import { tileAt, cellKey, sameCell, positionOf } from './spatial.js';
import { validCellPosition } from './spatial.js';
import { validAirlockPosition, airlockCellFromKey } from './airlock-locations.js';
import { AIRLOCK_PHASES, airlockId, airlockOpen, airlockRouteInfo } from './airlock-access.js';

const record=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
const exact=(value,keys)=>record(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
const configKeys=['chamber','inner','outer','extractor','pump','reservoir','vent'];
const stateKeys=['binding','config','chamberCells','ownedNodes','enabled','phase','direction','party','queue','nextCycle','cycle','resumePhase','recoverySide','reason'];
const entryKeys=['crew','patient','direction','destination','requestTick','emergency'];
const traversalKeys=['controller','binding','cycle','requestTick','destination'];
const members=entry=>[entry.crew,...(entry.patient?[entry.patient]:[])];
const coord=validAirlockPosition;
const direction=value=>['inward','outward'].includes(value);
const fail=message=>{throw new Error(`Invalid airlock ${message}.`);};

// Validation only: run on the original pre39 input BEFORE migration. Even null
// fields are rejected so old versions cannot smuggle unvalidated new claims.
export function assertLegacyAirlocks(s) {
 if(s.version>=39)return;
 const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(['airlock','airlockOwner','airlockTraversal'].includes(key)||key==='building'&&child==='airlockController')fail('fields in legacy save');visit(child);}};
 visit(s);
}
// Idempotent initialization/migration only. Never changes gas, doors, timers,
// extant controller state or existing traversal references.
export function initializeAirlocks(s) {
 for(const c of s.crew)if(!Object.hasOwn(c,'airlockTraversal'))c.airlockTraversal=null;
 for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.building==='airlockController'&&!Object.hasOwn(t,'airlock'))t.airlock=null;
}
// Validation only. Layout damage, missing tokens, dead admitted travelers and
// depleted resources are reachable interruptions; reconciliation waits for tick.
export function validateAirlocks(s) {
 const controls=new Map(),bindings=new Set(),claims=new Map(),owned=new Map();
 for(const site of Object.values(s.sites))for(const t of site.tiles) {
  if(t.airlock!==undefined&&t.airlock!==null&&t.building!=='airlockController')fail('state without controller');
  if(t.building==='airlockController'&&!Object.hasOwn(t,'airlock'))fail('missing controller default');
  if(!t.airlock)continue;const a=t.airlock,entity=airlockId(site,t);
  if(!exact(a,stateKeys)||typeof a.binding!=='string'||!/^airlock-\d+$/.test(a.binding)||bindings.has(a.binding))fail('binding');bindings.add(a.binding);
  if(!exact(a.config,configKeys)||configKeys.some(k=>!coord(site,a.config[k]))||new Set(configKeys.filter(k=>k!=='chamber').map(k=>cellKey(a.config[k]))).size!==6)fail('configuration');
  if(!Array.isArray(a.chamberCells)||!a.chamberCells.length||a.chamberCells.length>site.tiles.length||new Set(a.chamberCells).size!==a.chamberCells.length||a.chamberCells.some(k=>typeof k!=='string'||!coord(site,airlockCellFromKey(k)))||!a.chamberCells.includes(cellKey(a.config.chamber)))fail('chamber cells');
  if(!airlockRouteInfo(site,t))fail('door orientation');
  if(!Array.isArray(a.ownedNodes)||a.ownedNodes.length<6||a.ownedNodes.length>site.tiles.length)fail('owned references');
  const refs=new Set();for(const ref of a.ownedNodes) {
   if(!exact(ref,['x','y','layer','z'])||!coord(site,{x:ref.x,y:ref.y,z:ref.z})||ref.z!==positionOf(t).z||!['building','pipe'].includes(ref.layer))fail('owned reference');
   const key=`${entity}:${ref.layer}:${cellKey(ref)}`,global=`${site.id}:${ref.layer}:${cellKey(ref)}`;
   if(refs.has(key)||owned.has(global))fail('duplicate ownership');refs.add(key);owned.set(global,{entity,binding:a.binding});
  }
  for(const part of ['inner','outer','extractor','pump','reservoir','vent'])if(!a.ownedNodes.some(n=>n.layer==='building'&&sameCell(n,a.config[part])))fail('missing named ownership');
  if(typeof a.enabled!=='boolean'||!AIRLOCK_PHASES.includes(a.phase)||a.direction!==null&&!direction(a.direction)||!integer(a.nextCycle,1)||a.cycle!==null&&(!integer(a.cycle,1)||a.cycle>=a.nextCycle)||a.resumePhase!==null&&(!AIRLOCK_PHASES.includes(a.resumePhase)||a.resumePhase==='paused')||a.recoverySide!==null&&!['inner','outer'].includes(a.recoverySide)||a.reason!==null&&(typeof a.reason!=='string'||!a.reason.length||a.reason.length>80))fail('cycle state');
  if(a.phase==='paused'?(a.resumePhase===null||a.reason===null):(a.resumePhase!==null||a.reason!==null))fail('pause state');
  if(!Array.isArray(a.queue)||a.queue.length>s.crew.length||a.party!==null&&!record(a.party))fail('party or queue');
  const current=a.phase==='paused'?a.resumePhase:a.phase;
  if(a.party===null?(a.direction!==null||a.cycle!==null||current!=='idle'):(a.direction===null||a.cycle===null||current==='idle'))fail('phase party compatibility');
  for(const [entry,admitted] of [...a.queue.map(q=>[q,false]),...(a.party?[[a.party,true]]:[])]) {
   if(!exact(entry,entryKeys)||typeof entry.crew!=='string'||entry.patient!==null&&typeof entry.patient!=='string'||entry.patient===entry.crew||!direction(entry.direction)||entry.destination!==null&&!validCellPosition(site,entry.destination)||!integer(entry.requestTick)||entry.requestTick>s.tick||typeof entry.emergency!=='boolean')fail('request');
   if(admitted&&entry.direction!==a.direction)fail('party direction');
   for(const member of members(entry)) {
    const c=s.crew.find(c=>c.id===member);if(!c||c.site!==site.id||claims.has(member))fail('local unique party');
    claims.set(member,{entity,binding:a.binding,cycle:admitted?a.cycle:null,requestTick:entry.requestTick});
   }
  }
  for(let i=1;i<a.queue.length;i++){const l=a.queue[i-1],r=a.queue[i],order=Number(r.emergency)-Number(l.emergency)||l.requestTick-r.requestTick||l.crew.localeCompare(r.crew);if(order>0)fail('queue order');}
  const inner=tileAt(site,a.config.inner),outer=tileAt(site,a.config.outer);
  if(inner?.building==='door'&&outer?.building==='door'&&inner.hp>0&&outer.hp>0&&airlockOpen(site,inner)&&airlockOpen(site,outer))fail('simultaneous door opening');
  controls.set(entity,{site,t});
 }
 for(const site of Object.values(s.sites))for(const t of site.tiles)for(const layer of ['building','pipe']) {
  const holder=layer==='pipe'?t.pipe:t;if(!holder||!Object.hasOwn(holder,'airlockOwner'))continue;const owner=holder.airlockOwner;
  if(!exact(owner,['controller','binding'])||typeof owner.controller!=='string'||typeof owner.binding!=='string')fail('owner token');
  const expected=owned.get(`${site.id}:${layer}:${cellKey(positionOf(t))}`),control=controls.get(owner.controller);
  if(!expected||expected.entity!==owner.controller||expected.binding!==owner.binding||!control||control.site!==site)fail('orphan owner token');
 }
 for(const c of s.crew) {
  const tr=c.airlockTraversal,claim=claims.get(c.id);
  if(tr===null){if(claim)fail('missing traversal');continue;}
  if(!exact(tr,traversalKeys)||!claim||tr.controller!==claim.entity||tr.binding!==claim.binding||tr.cycle!==claim.cycle||tr.requestTick!==claim.requestTick||tr.destination!==null&&!validCellPosition(s.sites[c.site],tr.destination))fail('traversal');
 }
}
