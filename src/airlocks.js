import { tileAt, positionOf, sameCell } from './spatial.js';
import { airlockConfig, airlockCells } from './airlock-locations.js';
import { emitEvent } from './telemetry.js';
import { refreshAtmosphere } from './atmosphere.js';
import { roomPressure, gasAtRoomPressure } from './room-pressure.js';
import { refreshPower } from './power.js';
import { opposite as oppositeDirection } from './geometry.js';
import { airlockTile as at, airlockId as id, airlockKey as key, airlockRoom, airlockNode as node, airlockGas as gas, airlockPayload as payload, airlockCapacity as capacity, airlockOpen as open, airlockLayout, airlockRouteInfo, airlockPhysicalPath, airlockSideBlock, airlockPermittedSide, airlockRoomReading, airlockGasQuantities as quantities } from './airlock-access.js';

const opposite=side=>side==='inner'?'outer':'inner';
const members=entry=>entry?[entry.crew,...(entry.patient?[entry.patient]:[])]:[];
const controllers=s=>Object.values(s.sites).flatMap(site=>site.tiles.filter(t=>t.airlock).map(t=>[site,t]));
const resolve=(s,args)=>{const site=s.sites[args.site];return [site,site&&at(site,args.x,args.y,args.z??0)];};
const error=(reason,message=reason.replaceAll('_',' '))=>({ok:false,reason,message});
// Successful public controls must leave immediately serializable derived
// readings. This previews the circuit only: no charge, fuel or energy is used.
const refreshedResult=(s,site,result={ok:true})=>{refreshPower(s,site);return result;};
const entrySide=a=>a.direction==='outward'?'inner':'outer';
const exitSide=a=>a.recoverySide||(a.direction==='outward'?'outer':'inner');
const inside=(a,c)=>!!c&&a.chamberCells.includes(key(positionOf(c)));
const doorPosition=(a,c)=>!!c&&['inner','outer'].some(side=>key(a.config[side])===key(positionOf(c)));
const event=(s,site,t,name,details={})=>emitEvent(s,`airlock.${name}`,{entity:id(site,t),site:site.id,cycle:t.airlock?.cycle??null,tick:s.tick,reason:name,...details});
const occupied=(s,site,p)=>s.crew.some(c=>c.site===site.id&&c.health>0&&sameCell(positionOf(c),p))||(s.creatures||[]).some(c=>(c.site||'surface')===site.id&&c.health>0&&sameCell(positionOf(c),p));
function setDoor(s,site,t,side,wanted) {
 const d=tileAt(site,t.airlock.config[side]);if(d?.building!=='door'||d.hp<=0||!wanted&&occupied(s,site,positionOf(d)))return false;
 const previous=open(site,d);d.doorMode=wanted?'open':'closed';d.doorUntil=0;
 if(previous!==wanted){event(s,site,t,'door_changed',{door:id(site,d),previous,next:wanted,party:members(t.airlock.party)});refreshAtmosphere(site);}
 return true;
}
function stopTransfers(site,t) {
 const a=t.airlock;
 for(const ref of a.ownedNodes){const n=tileAt(site,ref),holder=ref.layer==='pipe'?n?.pipe:n;if(holder?.airlockOwner?.binding!==a.binding)continue;if(node(n))node(n).open=false;if(n.gasDevice)n.gasDevice.enabled=false;}
}
function phase(s,site,t,next,reason='measured_conditions') {
 const a=t.airlock,previous=a.phase;if(previous===next)return;
 a.phase=next;event(s,site,t,'phase_changed',{previous,next,reason,party:members(a.party),chamber:airlockRoomReading(airlockRoom(site,a.config.chamber))?.pressure??null,reservoirPayload:payload(tileAt(site,a.config.reservoir)),inner:id(site,tileAt(site,a.config.inner)||a.config.inner),outer:id(site,tileAt(site,a.config.outer)||a.config.outer)});
}
function pause(s,site,t,reason) {
 const a=t.airlock;stopTransfers(site,t);for(const side of ['inner','outer'])setDoor(s,site,t,side,false);
 if(a.phase!=='paused'){a.resumePhase=a.phase;phase(s,site,t,'paused',reason);}
 if(a.reason!==reason)event(s,site,t,'blocked',{reason,party:members(a.party)});
 a.reason=reason;
}
function resume(s,site,t) {
 const a=t.airlock,reason=a.reason;a.reason=null;phase(s,site,t,a.resumePhase||'idle','conditions_restored');a.resumePhase=null;event(s,site,t,'resumed',{reason:reason||'conditions_restored'});
}
function partyBlock(s,site,t) {
 const a=t.airlock,party=members(a.party),living=s.crew.filter(c=>c.site===site.id&&c.health>0),inRoom=living.filter(c=>inside(a,c)||doorPosition(a,c));
 if(inRoom.some(c=>!party.includes(c.id))||(s.creatures||[]).some(c=>(c.site||'surface')===site.id&&c.health>0&&(inside(a,c)||doorPosition(a,c))))return 'unexpected_occupant';
 if(a.party){const c=s.crew.find(c=>c.id===a.party.crew);if(!c||c.site!==site.id||c.health<=0)return 'traveler_missing';if(a.party.patient){const patient=s.crew.find(c=>c.id===a.party.patient);if(!patient||patient.health<=0||patient.site!==site.id||c.rescue?.patient!==patient.id||!c.rescue.carrying)return 'party_separated';}}
 return null;
}
function predictedRefill(layout,q,target) {
 const room=layout.room,quantity=gasAtRoomPressure(room,target);if(quantity===null)return null;
 const total=q.supply,needed=Math.min(total,Math.max(0,quantity-gas(room.gas))),mix={...room.gas};let smoke=room.smoke||0;
 if(total>0)for(const t of q.refill){const n=node(t);for(const k of ['oxygen','inert','co2'])mix[k]+=n.gas[k]*needed/total;smoke+=n.smoke*needed/total;}
 return airlockRoomReading({...room,gas:mix,smoke});
}
function refillTarget(layout,q=quantities(layout)) {
 const pressure=roomPressure(layout.habitat),rounded=Math.max(0,Math.min(150,Math.round(pressure)));
 if(predictedRefill(layout,q,rounded)?.breathable)return rounded;
 // A rounded target can cross the oxygen floor after modest cooling. Prefer
 // it when safe; otherwise try the nearest legal finite fill, lower on ties.
 const candidates=[];
 for(let target=Math.max(0,Math.ceil(pressure-2));target<=Math.min(150,Math.floor(pressure+2));target++)if(target!==rounded)candidates.push(target);
 candidates.sort((a,b)=>Math.abs(a-pressure)-Math.abs(b-pressure)||a-b);
 return candidates.find(target=>{const predicted=predictedRefill(layout,q,target);return predicted?.breathable&&Math.abs(predicted.pressure-pressure)<=2+1e-9;})??rounded;
}
// Pure finite diagnostics shared by controller admission and commissioning.
export function airlockResourceStatus(layout,mode=null,admission=true) {
 const q=quantities(layout),needsFill=mode==='refill'||admission;
 const target=needsFill?refillTarget(layout,q):null,predicted=needsFill?predictedRefill(layout,q,target):null;
 const habitat=airlockRoomReading(layout.habitat),chamber=airlockRoomReading(layout.room);
 let blocker=null;
 if(needsFill&&(q.fillNeeded===null||predicted===null))blocker='unsafe_temperature';
 else if((mode==='recover'||admission)&&q.headroom+1e-8<q.recoverNeeded)blocker='reservoir_full';
 else if(needsFill&&q.supply+1e-8<q.fillNeeded)blocker='supply_empty';
 else if(needsFill&&(!habitat.thermalSafe||!chamber.thermalSafe))blocker='unsafe_temperature';
 else if(needsFill&&(!habitat.breathable||!predicted.breathable))blocker='contaminated_mix';
 return {blocker,headroom:q.headroom,recoverNeeded:q.recoverNeeded,supply:q.supply,fillNeeded:q.fillNeeded,target,predicted,habitat,chamber};
}
const resources=(layout,mode,admission=false)=>airlockResourceStatus(layout,mode,admission).blocker;
function estimatedTicks(layout) {
 const target=gasAtRoomPressure(layout.room,refillTarget(layout));if(target===null)return null;
 const nodes=[...layout.recoveryNodes,...layout.storageNodes],deviceRate=Math.min(2,...nodes.filter(t=>['gasExtractor','gasVent'].includes(t.building)).map(t=>2*t.hp/100));
 return Math.ceil((gas(layout.room.gas)+target)/Math.max(.01,deviceRate))+layout.room.cells.length+6+2*nodes.length;
}
function admissionBlock(s,site,t,layout,request) {
 const c=s.crew.find(c=>c.id===request.crew),side=request.direction==='outward'?'inner':'outer';
 if(!c||c.health<=0||c.site!==site.id)return 'traveler_missing';
 if(!inside(t.airlock,c)&&!airlockPhysicalPath(site,positionOf(c),layout.route[side].outside))return 'route_unavailable';
 const resource=resources(layout,null,true);if(resource)return resource;
 const ticks=estimatedTicks(layout);if(ticks===null)return 'unsafe_temperature';
 const required=.18*(Math.ceil(1.25*ticks)+20);
 if(members(request).some(pid=>(s.crew.find(c=>c.id===pid)?.oxygen??0)<required))return 'insufficient_suit';
 return null;
}
function desiredTransfer(site,t,layout,current) {
 if(current==='recover')return 'recover';if(current==='refill')return roomPressure(layout.room)>roomPressure(layout.habitat)+2?'recover':'refill';if(current!=='prepare_entry')return null;
 const side=entrySide(t.airlock);if(!airlockSideBlock(site,t,side))return null;
 // Pressure excess must be recovered before returning reserve gas, even when
 // matching habitat for an outward admission.
 return side==='outer'||roomPressure(layout.room)>roomPressure(layout.habitat)+2?'recover':'refill';
}
// Physiology can change pressure after an exit first matches. Re-enter the
// existing finite transfer phase only while the whole party can be sealed in.
function correctExitPressure(s,site,t) {
 const a=t.airlock,eligible=a.phase==='release'||a.phase==='paused'&&a.resumePhase==='release'&&a.reason==='pressure_mismatch';
 if(!eligible||!a.party||airlockSideBlock(site,t,exitSide(a))!=='pressure_mismatch')return false;
 if(!members(a.party).every(pid=>inside(a,s.crew.find(c=>c.id===pid)))||['inner','outer'].some(side=>occupied(s,site,a.config[side])))return false;
 stopTransfers(site,t);
 if(!['inner','outer'].every(side=>setDoor(s,site,t,side,false)))return false;
 const wasPaused=a.phase==='paused';a.reason=null;a.resumePhase=null;
 phase(s,site,t,exitSide(a)==='inner'?'refill':'recover','exit_pressure_drift');
 if(wasPaused)event(s,site,t,'resumed',{reason:'exit_pressure_drift'});
 return true;
}
function command(site,t,layout,mode) {
 stopTransfers(site,t);if(!mode)return;
 const a=t.airlock,pump=tileAt(site,a.config.pump),ex=tileAt(site,a.config.extractor),vent=tileAt(site,a.config.vent);
 for(const n of layout.phaseNodes[mode])node(n).open=true;
 ex.gasStore.open=true;vent.gasStore.open=mode==='refill';
 ex.gasDevice={enabled:mode==='recover',mode:'exhaust',target:0};vent.gasDevice={enabled:mode==='refill',target:refillTarget(layout)};
 pump.gasDevice={enabled:true,direction:mode==='recover'?layout.recoveryDirection:oppositeDirection(layout.recoveryDirection)};
}
function clearClaim(s,site,t,entry,reason) {
 for(const member of members(entry)){const c=s.crew.find(c=>c.id===member);if(c?.airlockTraversal?.controller===id(site,t)&&c.airlockTraversal.binding===t.airlock.binding)c.airlockTraversal=null;}
 event(s,site,t,'request_cancelled',{crew:entry.crew,party:members(entry),direction:entry.direction,requestTick:entry.requestTick,reason});
}
function finish(s,site,t) {
 const a=t.airlock,entry=a.party,route=airlockRouteInfo(site,t),side=exitSide(a),recovery=!!a.recoverySide;
 stopTransfers(site,t);for(const side of ['inner','outer'])setDoor(s,site,t,side,false);
 event(s,site,t,'traversed',{crew:entry.crew,party:members(entry),direction:a.direction,from:route[entrySide(a)].outside,to:route[side].outside,reason:recovery?'safe_return':'physical_exit'});
 for(const member of members(entry)){const c=s.crew.find(c=>c.id===member);if(c?.airlockTraversal?.binding===a.binding)c.airlockTraversal=null;}
 a.party=null;a.direction=null;a.cycle=null;a.recoverySide=null;a.reason=null;a.resumePhase=null;phase(s,site,t,'idle','physical_exit');
}

export function configureAirlock(s,args) {
 const [site,t]=resolve(s,args);if(t?.building!=='airlockController')return error('invalid_controller');
 if(t.airlock&&(t.airlock.party||t.airlock.queue.length||!(t.airlock.phase==='idle'||t.airlock.phase==='paused'&&t.airlock.resumePhase==='idle')))return error('cycle_active');
 const names=['chamber','inner','outer','extractor','pump','reservoir','vent'];
 if(names.some(k=>!Array.isArray(args[k])||args[k].length!==2||!args[k].every(Number.isInteger)||!at(site,...args[k],args.z??0)))return error('invalid_reference');
 const config=airlockConfig(args);
 if(new Set(names.filter(k=>k!=='chamber').map(k=>key(config[k]))).size!==6)return error('duplicate_reference');
 const room=airlockRoom(site,config.chamber);if(!room)return error('layout_changed');
 const previous=t.airlock,a={binding:'pending',config,chamberCells:airlockCells(room).sort(),ownedNodes:[],enabled:true,phase:'idle',direction:null,party:null,queue:[],nextCycle:1,cycle:null,resumePhase:null,recoverySide:null,reason:null};
 const layout=airlockLayout(site,{...t,airlock:a},false);if(!layout.ok)return error(layout.reason);
 if(['inner','outer'].some(side=>open(site,tileAt(site,config[side]))))return error('door_open');
 if(s.crew.some(c=>c.site===site.id&&c.health>0&&(inside(a,c)||doorPosition(a,c)))||(s.creatures||[]).some(c=>(c.site||'surface')===site.id&&c.health>0&&(inside(a,c)||doorPosition(a,c))))return error('unexpected_occupant');
 for(const ref of layout.ownedNodes){const n=tileAt(site,ref),holder=ref.layer==='pipe'?n.pipe:n;if(holder.airlockOwner&&holder.airlockOwner.binding!==previous?.binding)return error('airlock_controlled');}
 if(previous)for(const ref of previous.ownedNodes){const n=tileAt(site,ref),holder=ref.layer==='pipe'?n?.pipe:n;if(holder?.airlockOwner?.binding===previous.binding)delete holder.airlockOwner;}
 a.binding=`airlock-${s.nextId++}`;a.ownedNodes=layout.ownedNodes;t.airlock=a;
 for(const ref of a.ownedNodes){const n=tileAt(site,ref);(ref.layer==='pipe'?n.pipe:n).airlockOwner={controller:id(site,t),binding:a.binding};}
 stopTransfers(site,t);for(const side of ['inner','outer'])setDoor(s,site,t,side,false);
 event(s,site,t,'configured',{binding:a.binding,config:a.config,ownedNodes:a.ownedNodes});return refreshedResult(s,site);
}
export function enableAirlock(s,args) {
 const [site,t]=resolve(s,args);if(!t?.airlock||typeof args.enabled!=='boolean')return error('invalid_controller');
 if(args.enabled&&t.airlock.reason==='manual_release'&&['inner','outer'].some(side=>occupied(s,site,t.airlock.config[side])))return error('door_obstructed');
 t.airlock.enabled=args.enabled;if(!args.enabled)pause(s,site,t,'disabled');
 else if(t.airlock.reason==='manual_release'){for(const side of ['inner','outer'])setDoor(s,site,t,side,false);t.airlock.reason='disabled';if(!t.airlock.party)t.airlock.recoverySide=null;}
 event(s,site,t,'enabled',{enabled:args.enabled});return refreshedResult(s,site);
}
export function requestAirlock(s,args) {
 const [site,t]=resolve(s,args),a=t?.airlock,c=s.crew.find(c=>c.id===args.crew);
 if(!a||!['inward','outward'].includes(args.direction))return error('invalid_controller');
 if(!c||c.site!==site.id||c.health<=0)return error('traveler_missing');
 for(const [otherSite,other] of controllers(s))for(const entry of [...other.airlock.queue,...(other.airlock.party?[other.airlock.party]:[])])if(members(entry).includes(c.id))return other===t&&entry.direction===args.direction?{ok:true,queued:other.airlock.party!==entry}:error('already_requested');
 const patient=c.rescue?.carrying?c.rescue.patient:null,p=patient?s.crew.find(c=>c.id===patient):null;
 if(patient&&(!p||p.site!==site.id||p.health<=0||!sameCell(positionOf(p),positionOf(c))))return error('party_separated');
 if(patient&&controllers(s).some(([,other])=>[...other.airlock.queue,...(other.airlock.party?[other.airlock.party]:[])].some(entry=>members(entry).includes(patient))))return error('already_requested');
 const layout=airlockLayout(site,t);if(!layout.ok)return error(layout.reason);if(!a.enabled)return error('disabled');
 const side=args.direction==='outward'?'inner':'outer';if(!inside(a,c)&&!airlockPhysicalPath(site,positionOf(c),layout.route[side].outside))return error('route_unavailable');
 const ticks=estimatedTicks(layout);
 const entry={crew:c.id,patient,direction:args.direction,destination:null,requestTick:s.tick,emergency:ticks!==null&&Math.min(c.oxygen,p?.oxygen??100)<.18*(Math.ceil(1.25*ticks)+20)};
 a.queue.push(entry);a.queue.sort((l,r)=>Number(r.emergency)-Number(l.emergency)||l.requestTick-r.requestTick||l.crew.localeCompare(r.crew));
 for(const member of members(entry))s.crew.find(c=>c.id===member).airlockTraversal={controller:id(site,t),binding:a.binding,cycle:null,requestTick:s.tick,destination:null};
 event(s,site,t,'requested',{crew:c.id,party:members(entry),direction:entry.direction,requestTick:s.tick,destination:null,emergency:entry.emergency});return {ok:true,queued:true};
}
export function cancelAirlock(s,args) {
 const [site,t]=resolve(s,args),a=t?.airlock;if(!a)return error('invalid_controller');
 const index=a.queue.findIndex(entry=>members(entry).includes(args.crew));
 if(index>=0){const entry=a.queue.splice(index,1)[0];clearClaim(s,site,t,entry,'cancelled');return {ok:true};}
 if(!members(a.party).includes(args.crew))return error('request_missing');
 const c=s.crew.find(c=>c.id===a.party.crew);
 if(c&&!inside(a,c)&&!doorPosition(a,c)){clearClaim(s,site,t,a.party,'cancelled');a.party=null;a.direction=null;a.cycle=null;a.recoverySide=null;a.resumePhase=null;a.reason=null;phase(s,site,t,'idle','cancelled');stopTransfers(site,t);for(const side of ['inner','outer'])setDoor(s,site,t,side,false);return refreshedResult(s,site);}
 a.recoverySide=entrySide(a);event(s,site,t,'request_cancelled',{crew:a.party.crew,party:members(a.party),reason:'safe_return_requested'});
 if(!doorPosition(a,c)){for(const side of ['inner','outer'])setDoor(s,site,t,side,false);phase(s,site,t,a.recoverySide==='inner'?'refill':'recover','safe_return_requested');a.reason=null;a.resumePhase=null;}
 return refreshedResult(s,site,{ok:true,recovering:true});
}
export function releaseAirlock(s,args) {
 const [site,t]=resolve(s,args),a=t?.airlock;if(!a||!['inner','outer'].includes(args.side)||args.acceptAtmosphereLoss!==true)return error('invalid_override');
 const other=tileAt(site,a.config[opposite(args.side)]),door=tileAt(site,a.config[args.side]);
 if(other?.building!=='door'||other.hp<100||open(site,other))return error('seal_broken');
 if(door?.building!=='door'||door.hp<=0)return error('seal_broken');
 pause(s,site,t,'manual_release');a.recoverySide=args.side;a.enabled=false;setDoor(s,site,t,args.side,true);
 event(s,site,t,'manual_release',{side:args.side,actor:args.crew??null,chamber:airlockRoomReading(airlockRoom(site,a.config.chamber)),acceptAtmosphereLoss:true});return refreshedResult(s,site);
}
export function unbindAirlock(s,args) {
 const [site,t]=resolve(s,args),a=t?.airlock;if(!a)return error('invalid_controller');
 if(a.party||a.queue.length||!['idle','paused'].includes(a.phase))return error('cycle_active');
 if(s.crew.some(c=>c.site===site.id&&c.health>0&&(inside(a,c)||doorPosition(a,c)))||(s.creatures||[]).some(c=>(c.site||'surface')===site.id&&c.health>0&&(inside(a,c)||doorPosition(a,c))))return error('unexpected_occupant');
 if(['inner','outer'].some(side=>{const d=tileAt(site,a.config[side]);return d?.building!=='door'||d.hp<100||open(site,d);} ))return error('door_open');
 detach(s,site,t,'unbound');return refreshedResult(s,site);
}
function detach(s,site,t,reason) {
 const a=t.airlock;stopTransfers(site,t);for(const side of ['inner','outer'])setDoor(s,site,t,side,false);
 for(const entry of [...a.queue,...(a.party?[a.party]:[])])clearClaim(s,site,t,entry,reason);
 for(const ref of a.ownedNodes){const n=tileAt(site,ref),holder=ref.layer==='pipe'?n?.pipe:n;if(holder?.airlockOwner?.binding===a.binding)delete holder.airlockOwner;}
 event(s,site,t,'unbound',{reason,binding:a.binding});t.airlock=null;
}
export function invalidateAirlockPart(s,site,t,layer='building',reason='part_removed') {
 if(layer==='building'&&t.airlock){detach(s,site,t,reason);return;}
 const holder=layer==='pipe'?t.pipe:t,owner=holder?.airlockOwner;
 if(owner){const control=site.tiles.find(n=>n.airlock?.binding===owner.binding&&id(site,n)===owner.controller);if(control)pause(s,site,control,reason);delete holder.airlockOwner;}
 // Geometry changes need no replacement token to invalidate the chamber.
 for(const control of site.tiles.filter(n=>n.airlock))if(!airlockLayout(site,control).ok)pause(s,site,control,'layout_changed');
}
export function prepareAirlocks(s) {
 for(const [site,t] of controllers(s)) {
  const a=t.airlock;if(a.reason==='manual_release'){stopTransfers(site,t);setDoor(s,site,t,opposite(a.recoverySide),false);continue;}
  stopTransfers(site,t);const layout=airlockLayout(site,t);
  if(!layout.ok){pause(s,site,t,layout.reason);continue;}if(!a.enabled){pause(s,site,t,'disabled');continue;}
  for(let i=a.queue.length-1;i>=0;i--){const entry=a.queue[i],c=s.crew.find(c=>c.id===entry.crew);if(!c||c.health<=0||c.site!==site.id){a.queue.splice(i,1);clearClaim(s,site,t,entry,'traveler_missing');}}
  // A request from a crew member already inside takes precedence. Do not admit
  // remote queues before the traveler has physically reached their staging tile.
  const waitingInside=!a.party?a.queue.find(entry=>inside(a,s.crew.find(c=>c.id===entry.crew))):null;
  let block=waitingInside?null:partyBlock(s,site,t);if(block){pause(s,site,t,block);continue;}
  const current=a.phase==='paused'?a.resumePhase:a.phase;
  if(!a.party&&a.queue.length&&current==='idle') {
   const request=waitingInside||a.queue[0],traveler=s.crew.find(c=>c.id===request.crew),staging=layout.route[request.direction==='outward'?'inner':'outer'].outside;
   if(!waitingInside&&!sameCell(positionOf(traveler),staging))continue;
   block=admissionBlock(s,site,t,layout,request);
   if(block){pause(s,site,t,block);continue;}
   if(a.phase==='paused')resume(s,site,t);
   a.party=a.queue.splice(a.queue.indexOf(request),1)[0];a.direction=a.party.direction;a.cycle=a.nextCycle++;a.recoverySide=null;
   for(const member of members(a.party)){const c=s.crew.find(c=>c.id===member);c.airlockTraversal.cycle=a.cycle;}
   phase(s,site,t,waitingInside?'seal_entry':'prepare_entry','request_admitted');
  }
  correctExitPressure(s,site,t);
  const desired=a.phase==='paused'?a.resumePhase:a.phase,mode=desiredTransfer(site,t,layout,desired);
  if(mode&&(block=resources(layout,mode))){pause(s,site,t,block);continue;}
  if(!['admit','release'].includes(desired))for(const side of ['inner','outer'])if(!setDoor(s,site,t,side,false)){block='door_obstructed';}
  if(block){pause(s,site,t,block);continue;}
  command(site,t,layout,mode);
 }
}
export function gateAirlocks(s) {
 for(const [site,t] of controllers(s)) {
  const a=t.airlock;if(a.reason==='manual_release')continue;
  if(!a.enabled){pause(s,site,t,'disabled');continue;}
  const layout=airlockLayout(site,t);if(!layout.ok){pause(s,site,t,layout.reason);continue;}
  const desired=a.phase==='paused'?a.resumePhase:a.phase,mode=desiredTransfer(site,t,layout,desired),needed=[t,...(mode?[tileAt(site,a.config.pump),tileAt(site,a.config[mode==='recover'?'extractor':'vent'])]:[])];
  const blocked=partyBlock(s,site,t)||(mode&&resources(layout,mode))||(!a.party&&a.queue.length&&desired==='idle'?admissionBlock(s,site,t,layout,a.queue[0]):null)||(!['admit','release'].includes(desired)&&['inner','outer'].some(side=>occupied(s,site,a.config[side]))&&'door_obstructed')||(a.party&&['admit','release'].includes(desired)&&airlockSideBlock(site,t,desired==='admit'?entrySide(a):exitSide(a)))||needed.some(n=>!n?.powered)&&'no_power';
  if(blocked){pause(s,site,t,blocked);continue;}
  if(a.phase==='paused')resume(s,site,t);
 }
}
export function reconcileAirlocks(s) {
 for(const [site,t] of controllers(s)) {
  const a=t.airlock;
  if(a.reason==='manual_release') {const other=tileAt(site,a.config[opposite(a.recoverySide)]),route=airlockRouteInfo(site,t);if(other?.building!=='door'||other.hp<100||open(site,other)){stopTransfers(site,t);setDoor(s,site,t,a.recoverySide,false);a.reason='seal_broken';}else if(a.party&&route&&members(a.party).every(pid=>{const c=s.crew.find(c=>c.id===pid),p=route[a.recoverySide].outside;return c&&sameCell(positionOf(c),p);}))finish(s,site,t);continue;}
  const layout=airlockLayout(site,t),block=!layout.ok?layout.reason:partyBlock(s,site,t);
  if(block){pause(s,site,t,block);continue;}if(!a.enabled||!t.powered){pause(s,site,t,!a.enabled?'disabled':'no_power');continue;}
  // Reconciliation seals and changes phase only; transfers wait for prepare.
  correctExitPressure(s,site,t);
  if(a.phase==='paused'||!a.party)continue;
  const people=members(a.party).map(pid=>s.crew.find(c=>c.id===pid)),allInside=people.every(c=>inside(a,c)),doorsClear=['inner','outer'].every(side=>!occupied(s,site,a.config[side]));
  if(a.phase==='prepare_entry'&&!airlockSideBlock(site,t,entrySide(a)))phase(s,site,t,'admit','entry_matched');
  if(a.phase==='admit'&&allInside)phase(s,site,t,'seal_entry','party_inside');
  if(a.phase==='seal_entry') {
   if(!doorsClear){pause(s,site,t,'door_obstructed');continue;}
   for(const side of ['inner','outer'])setDoor(s,site,t,side,false);
   phase(s,site,t,exitSide(a)==='outer'?'recover':'refill','entry_sealed');
  }
  if(['recover','refill'].includes(a.phase)&&!airlockSideBlock(site,t,exitSide(a))) {stopTransfers(site,t);phase(s,site,t,'release','exit_matched');}
  if(a.phase==='release'&&doorsClear&&people.every(c=>c&&sameCell(positionOf(c),layout.route[exitSide(a)].outside))){finish(s,site,t);continue;}
  if(['admit','release'].includes(a.phase)) {
   const side=airlockPermittedSide(site,t);if(!side){pause(s,site,t,airlockSideBlock(site,t,a.phase==='admit'?entrySide(a):exitSide(a))||'seal_broken');continue;}
   setDoor(s,site,t,opposite(side),false);setDoor(s,site,t,side,true);
  }
 }
}
