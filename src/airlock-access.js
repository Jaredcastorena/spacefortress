// Pure airlock observations and movement guards. This leaf deliberately imports
// neither physics nor movement; observing or planning never changes a cycle.
import { DIRECTIONS, neighbors as hexNeighbors, step, opposite, directionBetween, tileAt } from './geometry.js';
export const AIRLOCK_PHASES = ['idle','prepare_entry','admit','seal_entry','recover','refill','release','paused'];
export const AIRLOCK_DIRECTIONS = Object.freeze(Object.fromEntries(DIRECTIONS.map(direction=>[direction,true])));
export const airlockTile = tileAt;
export const airlockId = (site,t) => `tile:${site.id}:${t.x}:${t.y}`;
export const airlockKey = p => `${p[0]},${p[1]}`;
const neighbors = p => hexNeighbors(...p);
const same = (a,b) => !!a&&!!b&&a[0]===b[0]&&a[1]===b[1];
export const airlockRoom = (site,p) => p&&site.rooms.find(r=>r.cells.includes(airlockKey(p)));
export const airlockNode = t => t?.pipe||t?.gasStore||null;
export const airlockGas = gas => (gas?.oxygen||0)+(gas?.inert||0)+(gas?.co2||0);
export const airlockPayload = t => {const n=airlockNode(t);return n?airlockGas(n.gas)+(n.smoke||0):0;};
export const airlockCapacity = t => ['gasReservoir','gasTank'].includes(t?.building)?80:10;
export const airlockOpen = (site,t) => !!t&&(t.hp<=0||t.doorMode==='open'||t.doorMode!=='closed'&&t.doorUntil>(site.atmosphere?.tick||0));
export const airlockWalkable = (site,p) => {const t=airlockTile(site,...p);return !!t&&!t.fire&&!['void','rock'].includes(t.terrain)&&t.building!=='wall'&&!(t.building==='fence'&&t.hp>0)&&!(t.building==='door'&&t.hp>0&&t.doorMode==='closed');};
export function airlockPhysicalPath(site,from,to) {
 const todo=[from],seen=new Set([airlockKey(from)]);
 for(let i=0;i<todo.length;i++) {if(same(todo[i],to))return true;for(const p of neighbors(todo[i]))if(!seen.has(airlockKey(p))&&airlockWalkable(site,p)){seen.add(airlockKey(p));todo.push(p);}}
 return false;
}
export function airlockRouteInfo(site,t) {
 const a=t?.airlock;if(!a)return null;const cells=new Set(a.chamberCells),result={chamberCells:[...a.chamberCells]};
 for(const side of ['inner','outer']) {
  const door=a.config[side],inside=neighbors(door).filter(p=>cells.has(airlockKey(p)));
  if(inside.length!==1)return null;
  const inward=directionBetween(door,inside[0]);
  result[side]={door:[...door],inside:inside[0],outside:step(...door,opposite(inward))};
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
 if(!route||!room||[...room.cells].sort().join(';')!==[...a.chamberCells].sort().join(';'))return fail('layout_changed');
 if(t.hp<100||t.fire)return fail('equipment_damaged');
 const named=new Set([airlockKey(cfg.inner),airlockKey(cfg.outer)]),cells=new Set(room.cells);
 for(const cell of cells)for(const p of neighbors(cell.split(',').map(Number))) {
  if(cells.has(airlockKey(p)))continue;const n=airlockTile(site,...p);
  if(!n||!['wall','door'].includes(n.building)||n.building==='door'&&!named.has(airlockKey(p)))return fail('layout_changed');
  if(n.hp<100||n.fire)return fail('seal_broken');
 }
 for(const side of ['inner','outer']) {
  const r=route[side],door=airlockTile(site,...r.door);
  if(door?.building!=='door'||door.hp<100||door.fire)return fail('seal_broken');
  const sideWalls=neighbors(r.door).filter(p=>!same(p,r.inside)&&!same(p,r.outside));
  if(sideWalls.length!==4)return fail('layout_changed');
  for(const p of sideWalls) {const wall=airlockTile(site,...p);if(wall?.building!=='wall')return fail('layout_changed');if(wall.hp<100||wall.fire)return fail('seal_broken');}
  if(!airlockWalkable(site,r.inside)||!airlockWalkable(site,r.outside))return fail('route_unavailable');
 }
 const habitat=airlockRoom(site,route.inner.outside);
 if(!habitat||habitat===room||airlockRoom(site,route.outer.outside))return fail('layout_changed');
 const equipment={extractor:'gasExtractor',pump:'gasPump',reservoir:'gasReservoir',vent:'gasVent'};
 for(const [key,building] of Object.entries(equipment)){const n=airlockTile(site,...cfg[key]);if(n?.building!==building||n.pipe)return fail('layout_changed');if(n.hp<100||n.fire)return fail('equipment_damaged');}
 if(!cells.has(airlockKey(cfg.extractor))||!cells.has(airlockKey(cfg.vent)))return fail('layout_changed');
 const pump=airlockTile(site,...cfg.pump),direction=pump.gasDevice?.direction;if(!Object.hasOwn(AIRLOCK_DIRECTIONS,direction))return fail('layout_changed');
 const ports=[step(pump.x,pump.y,opposite(direction)),step(pump.x,pump.y,direction)];
 const flood=(start,closed=null)=>{const found=[],seen=new Set(),todo=[start];for(let i=0;i<todo.length;i++){const p=todo[i],k=airlockKey(p),n=airlockTile(site,...p);if(seen.has(k)||!airlockNode(n)||n===closed)continue;seen.add(k);found.push(n);todo.push(...neighbors(p));}return found;};
 const first=flood(ports[0]),second=flood(ports[1]);
 if(!first.length||!second.length||first.some(n=>second.includes(n)))return fail('layout_changed');
 const ex=airlockTile(site,...cfg.extractor),vent=airlockTile(site,...cfg.vent),tank=airlockTile(site,...cfg.reservoir);
 const recoveryNodes=first.includes(ex)?first:second,storageNodes=first.includes(ex)?second:first;
 if(!recoveryNodes.includes(vent)||!storageNodes.includes(tank)||recoveryNodes.includes(tank)||storageNodes.includes(ex))return fail('layout_changed');
 const nodes=[...recoveryNodes,...storageNodes];
 if(nodes.some(n=>!n.pipe&&![ex,vent,tank].includes(n)))return fail('layout_changed');
 if(nodes.some(n=>(n.pipe?n.pipe.hp:n.hp)<100||n.fire))return fail('equipment_damaged');
 for(const other of site.tiles)if(other!==pump&&other.building==='gasPump') {const d=other.gasDevice?.direction;if(Object.hasOwn(AIRLOCK_DIRECTIONS,d)&&[airlockTile(site,...step(other.x,other.y,opposite(d))),airlockTile(site,...step(other.x,other.y,d))].some(n=>nodes.includes(n)))return fail('layout_changed');}
 // The extractor and vent each close their physical port in the opposite
 // phase. A graph that works only through that closed device cannot cycle.
 // Buffers behind a closed valve are owned but unavailable to that phase.
 const recoveryPort=recoveryNodes.includes(airlockTile(site,...ports[0]))?ports[0]:ports[1];
 const recoverChamber=flood(cfg.extractor,vent),refillChamber=flood(recoveryPort,ex);
 if(!recoverChamber.includes(airlockTile(site,...recoveryPort))||!refillChamber.includes(vent))return fail('layout_changed');
 const phaseNodes={recover:[...recoverChamber,...storageNodes],refill:[...refillChamber,...storageNodes]};
 const ownedNodes=[...nodes.map(n=>({x:n.x,y:n.y,layer:n.pipe?'pipe':'building'})),...[cfg.inner,cfg.outer,cfg.pump].map(([x,y])=>({x,y,layer:'building'}))].sort((u,v)=>u.y-v.y||u.x-v.x||u.layer.localeCompare(v.layer));
 if(checkOwnership) {
  if(JSON.stringify(ownedNodes)!==JSON.stringify(a.ownedNodes))return fail('layout_changed');
  for(const ref of ownedNodes){const n=airlockTile(site,ref.x,ref.y),o=(ref.layer==='pipe'?n.pipe:n).airlockOwner;if(o?.controller!==airlockId(site,t)||o.binding!==a.binding)return fail('layout_changed');}
 }
 const recoveryDirection=opposite(directionBetween([pump.x,pump.y],recoveryPort));
 return {ok:true,reason:null,route,room,habitat,recoveryNodes,storageNodes,phaseNodes,ownedNodes,recoveryDirection};
}
export function airlockRoomReading(room) {
 if(!room)return null;const gas=airlockGas(room.gas),nominal=room.volume*10,pressure=gas/nominal*100,oxygen=room.gas.oxygen/nominal,co2=gas?room.gas.co2/gas:0,temperature=room.heat/(room.volume*20)-273.15;
 return {pressure,gas:{...room.gas},smoke:room.smoke||0,temperature,breathable:(room.smoke||0)/room.volume<.04&&pressure>=55&&pressure<=150&&oxygen>=.16-Number.EPSILON*.16&&oxygen<=.3&&co2<=.02,thermalSafe:temperature>=5&&temperature<=35};
}
export function airlockSideBlock(site,t,side) {
 const a=t.airlock,route=airlockRouteInfo(site,t),chamber=airlockRoomReading(airlockRoom(site,a.config.chamber));
 if(!route||!chamber)return 'layout_changed';
 if(side==='outer')return chamber.pressure<=1+1e-9?null:'pressure_mismatch';
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
 const opposite=airlockTile(site,...a.config[side==='inner'?'outer':'inner']);
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
  const side=permitted,opposite=airlockTile(site,...a.config[side==='inner'?'outer':'inner']);
  if(opposite?.building!=='door'||opposite.hp<100||airlockOpen(site,opposite))return false;
 }
 return true;
}
export function airlockStatus(s,site,t) {
 if(!t?.airlock)return null;const a=t.airlock,route=airlockRouteInfo(site,t),layout=airlockLayout(site,t),tank=airlockTile(site,...a.config.reservoir),node=airlockNode(tank),side=airlockPermittedSide(site,t);
 const result={entity:airlockId(site,t),site:site.id,...a,route,chamber:airlockRoomReading(airlockRoom(site,a.config.chamber)),habitat:route?airlockRoomReading(airlockRoom(site,route.inner.outside)):null,reservoir:node?{gas:{...node.gas},smoke:node.smoke,payload:airlockPayload(tank),capacity:airlockCapacity(tank),free:Math.max(0,airlockCapacity(tank)-airlockPayload(tank))}:null,powered:!!t.powered,blocker:a.reason||layout.reason,permissions:{inner:side==='inner',outer:side==='outer'},doors:Object.fromEntries(['inner','outer'].map(k=>{const d=airlockTile(site,...a.config[k]);return [k,{tile:[...a.config[k]],open:airlockOpen(site,d),intact:d?.building==='door'&&d.hp===100}];}))};
 return JSON.parse(JSON.stringify(result));
}
