// Pure airlock observations and movement guards. Planning reads declared
// topology; observing or planning never changes a cycle.
import { DIRECTIONS, step, opposite, directionBetween, tileAt as legacyTileAt } from './geometry.js';
import { tileAt, cellKey, sameCell, horizontalNeighbors, positionOf } from './spatial.js';
import { airlockCells, airlockCellFromKey } from './airlock-locations.js';
import {walkingNeighbors} from './vertical.js';
import { breathable } from './atmosphere.js';
import { roomPressure, roomOxygenPressure, gasAtRoomPressure } from './room-pressure.js';
import { GAS_HEAT_CAPACITY, GAS_REFERENCE_KELVIN, nodeKelvin, parcelHeat, roomFillAmount, pressureAfterGas, roomHeatCapacity } from './gas-thermal.js';
import { temperature, thermalSafe } from './thermal.js';
export const AIRLOCK_PHASES = ['idle','prepare_entry','admit','seal_entry','recover','refill','release','paused'];
export const AIRLOCK_DIRECTIONS = Object.freeze(Object.fromEntries(DIRECTIONS.map(direction=>[direction,true])));
export const airlockTile = legacyTileAt;
export const airlockId = (site,t) => `tile:${site.id}:${t.x}:${t.y}${positionOf(t).z===0?'':`:${positionOf(t).z}`}`;
export const airlockKey = cellKey;
const neighbors = horizontalNeighbors;
const same = sameCell;
const hexStep = (p,d) => {const [x,y]=step(p.x,p.y,d);return {x,y,z:p.z};};
const hexDirection = (a,b) => a.z===b.z?directionBetween([a.x,a.y],[b.x,b.y]):null;
export const airlockRoom = (site,p) => p&&site.rooms.find(r=>(r.z??0)===p.z&&r.cells.includes(`${p.x},${p.y}`));
export const airlockNode = t => t?.pipe||t?.gasStore||null;
export const airlockGas = gas => (gas?.oxygen||0)+(gas?.inert||0)+(gas?.co2||0);
export const airlockPayload = t => {const n=airlockNode(t);return n?airlockGas(n.gas)+(n.smoke||0):0;};
export const airlockCapacity = t => ['gasReservoir','gasTank'].includes(t?.building)?80:10;
export const airlockOpen = (site,t) => !!t&&(t.hp<=0||t.doorMode==='open'||t.doorMode!=='closed'&&t.doorUntil>(site.atmosphere?.tick||0));
export const airlockWalkable = (site,p) => {const t=tileAt(site,p);return !!t&&!t.fire&&!['void','rock'].includes(t.terrain)&&t.building!=='wall'&&!(t.building==='fence'&&t.hp>0)&&!(t.building==='door'&&t.hp>0&&t.doorMode==='closed');};
export function airlockPhysicalPath(site,from,to) {
 if(!tileAt(site,from)||!tileAt(site,to))return false;
 const todo=[from],seen=new Set([airlockKey(from)]);
 for(let i=0;i<todo.length;i++) {if(same(todo[i],to))return true;for(const p of walkingNeighbors(site,todo[i]))if(!seen.has(airlockKey(p))&&airlockWalkable(site,p)){seen.add(airlockKey(p));todo.push(p);}}
 return false;
}
export function airlockRouteInfo(site,t) {
 const a=t?.airlock;if(!a||Object.values(a.config).some(p=>p?.z!==positionOf(t).z))return null;const cells=new Set(a.chamberCells),result={chamberCells:[...a.chamberCells]};
 for(const side of ['inner','outer']) {
  const door=a.config[side],inside=neighbors(door).filter(p=>cells.has(airlockKey(p)));
  if(inside.length!==1)return null;
  const inward=hexDirection(door,inside[0]);
  result[side]={door:{...door},inside:inside[0],outside:hexStep(door,opposite(inward))};
 }
 return result;
}
export function airlockController(site,reference) {return site.tiles.find(t=>t.airlock&&airlockId(site,t)===reference)||null;}
export function airlockControlOwner(site,t,layer='building') {
 const owner=(layer==='pipe'?t?.pipe:t)?.airlockOwner;if(!owner)return null;
 const controller=airlockController(site,owner.controller),a=controller?.airlock;
 return a?.binding===owner.binding?{...owner,cycle:a.cycle,phase:a.phase}:null;
}
const fail=reason=>({ok:false,reason});
// Traverse the actual potential graph, including closed owned valves. Looking
// through valves prevents a bypass from appearing when a commanded port opens.
export function airlockLayout(site,t,checkOwnership=true) {
 const a=t?.airlock;if(!a||t.building!=='airlockController')return fail('layout_changed');
 const cfg=a.config,route=airlockRouteInfo(site,t),room=airlockRoom(site,cfg.chamber);
 if(!route||!room||airlockCells(room).sort().join(';')!==[...a.chamberCells].sort().join(';'))return fail('layout_changed');
 if(t.hp<100||t.fire)return fail('equipment_damaged');
 const named=new Set([airlockKey(cfg.inner),airlockKey(cfg.outer)]),cells=new Set(airlockCells(room));
 // A chamber is controlled through its two doors only; independent vertical
 // openings or utility ports cannot become an unowned pressure bypass.
 if((site.verticalLinks||[]).some(link=>[link.lower,link.upper].some(p=>cells.has(airlockKey(p)))))return fail('layout_changed');
 for(const cell of cells)for(const p of neighbors(airlockCellFromKey(cell))) {
  if(cells.has(airlockKey(p)))continue;const n=tileAt(site,p);
  if(!n||!['wall','door'].includes(n.building)||n.building==='door'&&!named.has(airlockKey(p)))return fail('layout_changed');
  if(n.hp<100||n.fire)return fail('seal_broken');
 }
 for(const side of ['inner','outer']) {
  const r=route[side],door=tileAt(site,r.door);
  if(door?.building!=='door'||door.hp<100||door.fire)return fail('seal_broken');
  const sideWalls=neighbors(r.door).filter(p=>!same(p,r.inside)&&!same(p,r.outside));
  if(sideWalls.length!==4)return fail('layout_changed');
  for(const p of sideWalls) {const wall=tileAt(site,p);if(wall?.building!=='wall')return fail('layout_changed');if(wall.hp<100||wall.fire)return fail('seal_broken');}
  if(!airlockWalkable(site,r.inside)||!airlockWalkable(site,r.outside))return fail('route_unavailable');
 }
 const habitat=airlockRoom(site,route.inner.outside);
 if(!habitat||habitat===room||airlockRoom(site,route.outer.outside)?.sealed)return fail('layout_changed');
 const equipment={extractor:'gasExtractor',pump:'gasPump',reservoir:'gasReservoir',vent:'gasVent'};
 for(const [key,building] of Object.entries(equipment)){const n=tileAt(site,cfg[key]);if((key==='reservoir'?!['gasReservoir','gasTank'].includes(n?.building):n?.building!==building)||n.pipe)return fail('layout_changed');if(n.hp<100||n.fire)return fail('equipment_damaged');}
 if(!cells.has(airlockKey(cfg.extractor))||!cells.has(airlockKey(cfg.vent)))return fail('layout_changed');
 const pump=tileAt(site,cfg.pump),direction=pump.gasDevice?.direction;if(!Object.hasOwn(AIRLOCK_DIRECTIONS,direction))return fail('layout_changed');
 const ports=[hexStep(positionOf(pump),opposite(direction)),hexStep(positionOf(pump),direction)];
 const flood=(start,closed=null)=>{const found=[],seen=new Set(),todo=[start];for(let i=0;i<todo.length;i++){const p=todo[i],k=airlockKey(p),n=tileAt(site,p);if(seen.has(k)||!airlockNode(n)||n===closed)continue;seen.add(k);found.push(n);todo.push(...neighbors(p));}return found;};
 const first=flood(ports[0]),second=flood(ports[1]);
 if(!first.length||!second.length||first.some(n=>second.includes(n)))return fail('layout_changed');
 const ex=tileAt(site,cfg.extractor),vent=tileAt(site,cfg.vent),tank=tileAt(site,cfg.reservoir);
 const recoveryNodes=first.includes(ex)?first:second,storageNodes=first.includes(ex)?second:first;
 if(!recoveryNodes.includes(vent)||!storageNodes.includes(tank)||recoveryNodes.includes(tank)||storageNodes.includes(ex))return fail('layout_changed');
 const nodes=[...recoveryNodes,...storageNodes];
 const branchCells=new Set([...nodes,pump].map(n=>airlockKey(positionOf(n))));
 if((site.utilityLinks||[]).some(link=>link.kind==='gas'&&[link.lower,link.upper].some(p=>branchCells.has(airlockKey(p)))))return fail('layout_changed');
 if(nodes.some(n=>!n.pipe&&![ex,vent,tank].includes(n)))return fail('layout_changed');
 if(nodes.some(n=>(n.pipe?n.pipe.hp:n.hp)<100||n.fire))return fail('equipment_damaged');
 for(const other of site.tiles)if(other!==pump&&other.building==='gasPump') {const d=other.gasDevice?.direction;if(Object.hasOwn(AIRLOCK_DIRECTIONS,d)&&[tileAt(site,hexStep(positionOf(other),opposite(d))),tileAt(site,hexStep(positionOf(other),d))].some(n=>nodes.includes(n)))return fail('layout_changed');}
 // Preserve independent pump routes around each device for valid topology.
 // Recovery isolates the vent. Refill opens the whole recovery branch,
 // including the disabled extractor's passive store, so captured gas returns.
 const recoveryPort=recoveryNodes.includes(tileAt(site,ports[0]))?ports[0]:ports[1];
 const recoverChamber=flood(cfg.extractor,vent),refillChamber=flood(recoveryPort,ex);
 if(!recoverChamber.includes(tileAt(site,recoveryPort))||!refillChamber.includes(vent))return fail('layout_changed');
 const phaseNodes={recover:[...recoverChamber,...storageNodes],refill:[...recoveryNodes,...storageNodes]};
 const ownedNodes=[...nodes.map(n=>({x:n.x,y:n.y,layer:n.pipe?'pipe':'building',z:positionOf(n).z})),...[cfg.inner,cfg.outer,cfg.pump].map(({x,y,z})=>({x,y,layer:'building',z}))].sort((u,v)=>u.y-v.y||u.x-v.x||u.layer.localeCompare(v.layer));
 if(checkOwnership) {
  if(JSON.stringify(ownedNodes)!==JSON.stringify(a.ownedNodes))return fail('layout_changed');
  for(const ref of ownedNodes){const n=tileAt(site,ref),o=(ref.layer==='pipe'?n.pipe:n).airlockOwner;if(o?.controller!==airlockId(site,t)||o.binding!==a.binding)return fail('layout_changed');}
 }
 const recoveryDirection=opposite(hexDirection(positionOf(pump),recoveryPort));
 return {ok:true,reason:null,route,room,habitat,recoveryNodes,storageNodes,phaseNodes,ownedNodes,recoveryDirection};
}
// The finite reserve is mixed by its actual species and energy. Packaged tank
// input is not a reserve parcel until the network physically loads it at 20C.
export function airlockFillPlan(room,q,target) {
 const inletKelvin=q.supply>0?q.supplyHeat/(GAS_HEAT_CAPACITY*q.supply):GAS_REFERENCE_KELVIN;
 const amount=roomFillAmount(room,target,inletKelvin,q.supply),heat=parcelHeat(amount,inletKelvin);
 return {amount,heat,reachable:pressureAfterGas(room,amount,heat)>=target-1e-9};
}
export function airlockGasQuantities(layout) {
 const {recover,refill}=layout.phaseNodes;
 const room=layout.room,amount=airlockGas(room.gas),residual=gasAtRoomPressure(room,1);
 const recovered=roomPressure(room)<=1?0:Math.max(0,amount-residual);
 const q={recover,refill,headroom:recover.reduce((n,t)=>n+Math.max(0,airlockCapacity(t)-airlockPayload(t)),0),recoverNeeded:recovered*(amount?(amount+(room.smoke||0))/amount:1),supply:0,supplyHeat:0};
 for(const t of refill){const n=airlockNode(t),quantity=airlockGas(n.gas);q.supply+=quantity;if(quantity>0)q.supplyHeat+=parcelHeat(quantity,nodeKelvin(n));}
 const plan=airlockFillPlan(room,q,Math.max(0,roomPressure(layout.habitat)-2));
 return {...q,fillNeeded:plan.amount,fillReachable:plan.reachable};
}
// Loading is a pure allowance; passage remains owned by the controller gates.
export function airlockTankMakeupAllowance(site,t) {
 if(!Object.hasOwn(t,'airlockOwner'))return Infinity;
 const owner=airlockControlOwner(site,t),controller=owner&&airlockController(site,owner.controller),a=controller?.airlock;
 if(!a||t.building!=='gasTank'||!t.machine?.enabled||t.hp<100||t.fire||!same(a.config.reservoir,positionOf(t))||!a.enabled||!controller.powered||a.party)return 0;
 const idle=a.phase==='idle'&&a.reason===null&&a.resumePhase===null;
 const waiting=a.phase==='paused'&&a.resumePhase==='idle'&&a.reason==='supply_empty'&&a.queue.length>0;
 if(!idle&&!waiting)return 0;
 const layout=airlockLayout(site,controller);
 if(!layout.ok||!layout.room.sealed||['inner','outer'].some(side=>{const d=tileAt(site,a.config[side]);return d?.hp!==100||d.doorMode!=='closed'||airlockOpen(site,d);}))return 0;
 if(a.ownedNodes.some(ref=>{const n=airlockNode(tileAt(site,ref));return n&&n.open!==false;}))return 0;
 const q=airlockGasQuantities(layout);return Math.max(0,q.headroom-q.recoverNeeded);
}
export function airlockRoomReading(room) {
 if(!room)return null;
 return {pressure:roomPressure(room),oxygenPressure:roomOxygenPressure(room),gas:{...room.gas},smoke:room.smoke||0,heat:room.heat,heatCapacity:roomHeatCapacity(room),temperature:temperature(room),breathable:breathable(room),thermalSafe:thermalSafe(room)};
}
export function airlockSideBlock(site,t,side) {
 const a=t.airlock,route=airlockRouteInfo(site,t),chamber=airlockRoomReading(airlockRoom(site,a.config.chamber));
 if(!route||!chamber)return 'layout_changed';
 if(side==='outer'){const exterior=airlockRoomReading(airlockRoom(site,route.outer.outside));return chamber.pressure<=1+1e-9&&(!exterior||exterior.pressure<=1+1e-9)?null:'pressure_mismatch';}
 const habitat=airlockRoomReading(airlockRoom(site,route.inner.outside));
 if(!habitat)return 'layout_changed';
 if(!habitat.thermalSafe||!chamber.thermalSafe)return 'unsafe_temperature';
 if(!habitat.breathable||!chamber.breathable)return 'contaminated_mix';
 return Math.abs(chamber.pressure-habitat.pressure)<=2+1e-9?null:'pressure_mismatch';
}
export function airlockPermittedSide(site,t) {
 const a=t?.airlock;if(!a)return null;
 if(a.phase==='paused'&&a.reason==='manual_release')return a.recoverySide;
 if(!a.enabled||!t.powered||!a.party||!['admit','release'].includes(a.phase)||!airlockLayout(site,t).ok)return null;
 const side=a.phase==='admit'?(a.direction==='outward'?'inner':'outer'):(a.recoverySide||(a.direction==='outward'?'outer':'inner'));
 const opposite=tileAt(site,a.config[side==='inner'?'outer':'inner']);
 return opposite?.building==='door'&&opposite.hp===100&&!airlockOpen(site,opposite)&&!airlockSideBlock(site,t,side)?side:null;
}
export function airlockDoorPermit(site,c,from,to) {
 for(const t of site.tiles)if(t.airlock) {
  const a=t.airlock,route=airlockRouteInfo(site,t);if(!route)continue;
  const touched=['inner','outer'].filter(side=>same(from,route[side].door)||same(to,route[side].door));
  if(!touched.length&&a.chamberCells.includes(airlockKey(from))!==a.chamberCells.includes(airlockKey(to)))return false;
  if(!touched.length)continue;
  const permitted=airlockPermittedSide(site,t);
  if(!c?.id||c.species||touched.some(side=>side!==permitted))return false;
  if(a.reason!=='manual_release'&&![a.party?.crew,a.party?.patient].includes(c.id))return false;
  const side=permitted,opposite=tileAt(site,a.config[side==='inner'?'outer':'inner']);
  if(opposite?.building!=='door'||opposite.hp<100||airlockOpen(site,opposite))return false;
 }
 return true;
}
export function airlockStatus(s,site,t) {
 if(!t?.airlock)return null;const a=t.airlock,route=airlockRouteInfo(site,t),layout=airlockLayout(site,t),tank=tileAt(site,a.config.reservoir),node=airlockNode(tank),side=airlockPermittedSide(site,t);
 const result={entity:airlockId(site,t),site:site.id,...a,route,chamber:airlockRoomReading(airlockRoom(site,a.config.chamber)),habitat:route?airlockRoomReading(airlockRoom(site,route.inner.outside)):null,reservoir:node?{gas:{...node.gas},smoke:node.smoke,payload:airlockPayload(tank),capacity:airlockCapacity(tank),free:Math.max(0,airlockCapacity(tank)-airlockPayload(tank))}:null,powered:!!t.powered,blocker:a.reason||layout.reason,permissions:{inner:side==='inner',outer:side==='outer'},doors:Object.fromEntries(['inner','outer'].map(k=>{const d=tileAt(site,a.config[k]);return [k,{tile:{...a.config[k]},open:airlockOpen(site,d),intact:d?.building==='door'&&d.hp===100}];}))};
 return JSON.parse(JSON.stringify(result));
}
