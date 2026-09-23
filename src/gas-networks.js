import { GASES, emptyGas, gasAmount, mix, roomAt, refreshAtmosphere, GAS_PER_TILE } from './atmosphere.js';
import { take } from './inventory.js';
import { refreshPower } from './power.js';
import { emitEvent, tileEntityId } from './telemetry.js';

// Rates and capacities are total payload (gas + suspended smoke). Pressure uses
// only gas density; smoke is a separate conserved tracer, not a fourth gas.
export const GAS_NETWORK = { pipeVolume:.25, pipeCapacity:10, tankVolume:2, tankCapacity:80, flow:2, pump:2, vent:2, extract:2, load:2, leak:2, diffusion:.02 };
export const GAS_DIRECTIONS = { east:[1,0], south:[0,1], west:[-1,0], north:[0,-1] };
const STORES=['gasTank','gasVent','gasExtractor','gasReservoir'];
export const gasEquipment = t => [...STORES,'gasPump'].includes(t.building);
const at=(site,x,y)=>x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
export const gasNode=t=>t?.pipe || t?.gasStore || null;
const condition=t=>t.pipe?t.pipe.hp:t.hp;
export const gasVolume=t=>['gasTank','gasReservoir'].includes(t.building)?GAS_NETWORK.tankVolume:GAS_NETWORK.pipeVolume;
export const gasCapacity=t=>['gasTank','gasReservoir'].includes(t.building)?GAS_NETWORK.tankCapacity:GAS_NETWORK.pipeCapacity;
export const gasPayload=t=>gasNode(t)?gasAmount(gasNode(t).gas)+gasNode(t).smoke:0;
export const gasPressure=t=>gasNode(t)?gasAmount(gasNode(t).gas)/gasVolume(t)/GAS_PER_TILE*100:0;
const free=t=>Math.max(0,gasCapacity(t)-gasPayload(t));
// Ruptured pipe remains a passage until isolated. Broken machinery cannot
// operate its port, but retained contents continue leaking independently.
const port=t=>gasNode(t)?.open===true&&(!!t.pipe||t.hp>0);
const id=(site,t)=>tileEntityId(site.id,t.x,t.y);
const roomId=(site,r)=>`room:${site.id}:${[...r.cells].sort((a,b)=>{const [ax,ay]=a.split(',').map(Number),[bx,by]=b.split(',').map(Number);return ay-by||ax-bx;})[0]}`;
const plus=(a,b,f=1)=>{for(const k of GASES)a[k]+=b[k]*f;};
const blank=()=>({gas:emptyGas(),smoke:0,open:true});
export function initializeGasTile(t){
 if(STORES.includes(t.building))t.gasStore??=blank();
 if(t.building==='gasPump')t.gasDevice??={enabled:true,direction:'east'};
 if(t.building==='gasVent')t.gasDevice??={enabled:true,target:100};
 if(t.building==='gasExtractor')t.gasDevice??={enabled:true,mode:'filter',target:100};
}
export const newPipe=()=>({...blank(),hp:100});
export function initializeGasNetworks(s){
 for(const site of Object.values(s.sites)){
  site.gasNetwork={loaded:emptyGas(),extracted:emptyGas(),delivered:emptyGas(),vented:emptyGas(),smoke:{captured:0,released:0,vented:0}};
  for(const t of site.tiles){t.pipe=null;initializeGasTile(t);}
 }
}
// Migration adds only fields introduced in schema34. Existing species, ports,
// controls and ledgers are not reset or silently repaired.
export function initializeGasExhaust(s){
 for(const site of Object.values(s.sites)){
  site.gasNetwork.extracted=emptyGas();site.gasNetwork.smoke={captured:0,released:0,vented:0};
  for(const t of site.tiles)if(gasNode(t))gasNode(t).smoke=0;
 }
}
function portion(gas,n){const total=gasAmount(gas),f=total?Math.min(1,n/total):0;return Object.fromEntries(GASES.map(k=>[k,gas[k]*f]));}
function payloadPortion(node,n){
 const total=gasAmount(node.gas)+node.smoke,f=total?Math.min(1,n/total):0;
 return {gas:Object.fromEntries(GASES.map(k=>[k,node.gas[k]*f])),smoke:node.smoke*f};
}
function move(s,site,a,b,n,reason,device=null){
 const source=gasNode(a),destination=gasNode(b);
 n=Math.min(n,gasPayload(a),free(b));if(n<=1e-9)return 0;
 const {gas,smoke}=payloadPortion(source,n);plus(source.gas,gas,-1);plus(destination.gas,gas);source.smoke-=smoke;destination.smoke+=smoke;
 emitEvent(s,'gas.transferred',{from:id(site,a),to:id(site,b),amount:n,gas,smoke,reason,...(device?{device:id(site,device)}:{})});return n;
}
function equalize(s,site,a,b){
 if(!port(a)||!port(b))return;
 let delta=gasAmount(gasNode(a).gas)/gasVolume(a)-gasAmount(gasNode(b).gas)/gasVolume(b);
 if(delta<0){[a,b]=[b,a];delta=-delta;}
 const gas=gasAmount(gasNode(a).gas),wantedGas=delta/(1/gasVolume(a)+1/gasVolume(b));
 // Bound pressure equalization by its gas component, while the rate/capacity
 // cap includes the smoke carried along by that parcel.
 move(s,site,a,b,gas?Math.min(GAS_NETWORK.flow,wantedGas*gasPayload(a)/gas):0,'pressure');
 // Equal amounts of gas exchange species without changing density/capacity.
 const ag=gasNode(a).gas,bg=gasNode(b).gas,n=Math.min(gasAmount(ag),gasAmount(bg))*GAS_NETWORK.diffusion;
 if(n>1e-9){
  const left=portion(ag,n),right=portion(bg,n);
  if(!GASES.every(k=>Math.abs(left[k]-right[k])<1e-10)){
   plus(ag,left,-1);plus(bg,right,-1);plus(ag,right);plus(bg,left);
   emitEvent(s,'gas.mixed',{from:id(site,a),to:id(site,b),amount:n,forward:left,backward:right});
  }
 }
 // A conservative game-scale smoke diffusion permits smoke-only filter output
 // to reach connected storage without inventing a carrier gas or pressure.
 let smokeDelta=gasNode(a).smoke/gasVolume(a)-gasNode(b).smoke/gasVolume(b);
 if(smokeDelta<0){[a,b]=[b,a];smokeDelta=-smokeDelta;}
 const smoke=Math.min(gasNode(a).smoke,free(b),smokeDelta/(1/gasVolume(a)+1/gasVolume(b))*GAS_NETWORK.diffusion);
 if(smoke>1e-9){gasNode(a).smoke-=smoke;gasNode(b).smoke+=smoke;emitEvent(s,'gas.transferred',{from:id(site,a),to:id(site,b),amount:smoke,gas:emptyGas(),smoke,reason:'smoke_diffusion'});}
}
export function releaseGas(s,site,t,n,reason){
 const node=gasNode(t);if(!node)return 0;
 n=Math.min(n,gasPayload(t));if(n<=1e-9)return 0;
 const {gas,smoke}=payloadPortion(node,n),room=roomAt(site,t.x,t.y),destinations=[];
 if(room)destinations.push(room);
 else if(['wall','door'].includes(t.building)){
  // Boundary tiles release into adjacent compartments and any exposed exterior.
  for(const [dx,dy] of Object.values(GAS_DIRECTIONS)){
   const neighbor=at(site,t.x+dx,t.y+dy),adjacent=neighbor&&roomAt(site,neighbor.x,neighbor.y);
   const destination=adjacent||(!neighbor||(!['wall','door'].includes(neighbor.building)&&!['floor','rock'].includes(neighbor.terrain))?null:undefined);
   if(destination!==undefined&&!destinations.includes(destination))destinations.push(destination);
  }
 }
 if(!destinations.length)destinations.push(null);
 plus(node.gas,gas,-1);node.smoke-=smoke;
 for(const destination of destinations){
  const share=Object.fromEntries(GASES.map(k=>[k,gas[k]/destinations.length])),smokeShare=smoke/destinations.length;
  if(destination){plus(destination.gas,share);destination.smoke+=smokeShare;plus(site.atmosphere.injected,share);plus(site.gasNetwork.delivered,share);site.gasNetwork.smoke.released+=smokeShare;}
  else {plus(site.atmosphere.vented,share);plus(site.gasNetwork.vented,share);site.gasNetwork.smoke.vented+=smokeShare;site.fireSafety.smokeVented+=smokeShare;}
  emitEvent(s,'gas.released',{from:id(site,t),to:destination?roomId(site,destination):`space:${site.id}`,amount:n/destinations.length,gas:share,smoke:smokeShare,reason});
 }
 return n;
}
export function removeGas(s,site,t,overlay=false){
 releaseGas(s,site,t,Infinity,'dismantled');
 if(overlay)t.pipe=null;else{delete t.gasStore;delete t.gasDevice;}
 refreshAtmosphere(site);
}
export function pumpPorts(site,t){
 const [dx,dy]=GAS_DIRECTIONS[t.gasDevice.direction];
 return {input:at(site,t.x-dx,t.y-dy),output:at(site,t.x+dx,t.y+dy)};
}
export function gasStatus(site,t){
 const node=gasNode(t),readings=node?{pressure:gasPressure(t),payload:gasPayload(t),capacity:gasCapacity(t),smoke:node.smoke}:{};
 if(t.building==='gasPump'){
  const {input,output}=pumpPorts(site,t);
  const blocked=t.fire?'Fire at pump':!t.gasDevice.enabled?'Pump disabled':t.hp<=0?'Needs repair':!gasNode(input)?'Missing inlet pipe or tank':!gasNode(output)?'Missing outlet pipe or tank':!input.pipe&&input.hp<=0?'Inlet equipment broken':!output.pipe&&output.hp<=0?'Outlet equipment broken':!port(input)||!port(output)?'Port valve closed':!t.powered?'No power':gasPayload(input)<=1e-9?'Inlet empty':free(output)<=1e-9?'Outlet full':null;
  return {blocked,status:blocked||'Pumping available gas',input:input?id(site,input):null,output:output?id(site,output):null};
 }
 if(t.building==='gasVent'){
  const room=roomAt(site,t.x,t.y);
  const blocked=t.fire?'Fire at vent':!t.gasDevice.enabled?'Vent disabled':t.hp<=0?'Needs repair':!node.open?'Port valve closed':!t.powered?'No power':!room?'No habitat compartment':gasAmount(room.gas)>=room.volume*GAS_PER_TILE*t.gasDevice.target/100-1e-9?'Room at target pressure':gasPayload(t)<=1e-9?'Pipe supply empty':null;
  return {blocked,status:blocked||'Supplying room',...readings};
 }
 if(t.building==='gasExtractor'){
  const room=roomAt(site,t.x,t.y),filter=t.gasDevice.mode==='filter';
  const blocked=t.fire?'Fire at extractor':!t.gasDevice.enabled?'Extractor disabled':t.hp<=0?'Needs repair':!node.open?'Port valve closed':!t.powered?'No power':!room?'No habitat compartment':free(t)<=1e-9?'Extraction storage full':filter?(room.gas.co2+room.smoke<=1e-9?'No CO2 or smoke to filter':null):gasAmount(room.gas)<=room.volume*GAS_PER_TILE*t.gasDevice.target/100+1e-9?'Room at target pressure':null;
  return {blocked,status:blocked||(filter?'Filtering into storage':'Exhausting into storage'),...readings,room:room?roomId(site,room):null,mode:t.gasDevice.mode,target:t.gasDevice.target};
 }
 if(node)return {blocked:!t.pipe&&t.hp<=0?'Needs repair':!node.open?'Valve closed':null,status:t.pipe?.hp===0?'Ruptured pipe — repair needed':condition(t)<50?'Leaking — repair needed':!node.open?'Valve closed':gasPayload(t)<=1e-9?'Empty':'Connected',...readings};
 return null;
}
function capture(s,site,t){
 const room=roomAt(site,t.x,t.y),node=gasNode(t),filter=t.gasDevice.mode==='filter';
 let gas=emptyGas(),smoke=0,n=Math.min(GAS_NETWORK.extract*t.hp/100,free(t));
 if(filter){
  n=Math.min(n,room.gas.co2+room.smoke);const fraction=n/(room.gas.co2+room.smoke);
  gas.co2=room.gas.co2*fraction;smoke=room.smoke*fraction;
 }else{
  const roomGas=gasAmount(room.gas),payload=roomGas+room.smoke;
  n=Math.min(n,payload,Math.max(0,roomGas-room.volume*GAS_PER_TILE*t.gasDevice.target/100)*payload/roomGas);
  ({gas,smoke}=payloadPortion(room,n));
 }
 if(n<=1e-9)return;
 plus(room.gas,gas,-1);room.smoke-=smoke;plus(node.gas,gas);node.smoke+=smoke;
 plus(site.gasNetwork.extracted,gas);site.gasNetwork.smoke.captured+=smoke;
 emitEvent(s,'gas.extracted',{from:roomId(site,room),to:id(site,t),device:id(site,t),amount:n,gas,smoke,mode:t.gasDevice.mode,target:t.gasDevice.target});
}
export function updateGasNetworks(s){
 for(const site of Object.values(s.sites)){
  const nodes=site.tiles.filter(t=>gasNode(t));
  if(!nodes.length)continue;
  for(const t of nodes)if(t.building==='gasTank'){
   const n=t.machine.enabled&&t.hp>0&&!t.fire?Math.min(GAS_NETWORK.load,t.machine.input.air||0,free(t)):0;
   if(n>1e-9){take(t.machine.input,{air:n});const gas=mix(n);plus(t.gasStore.gas,gas);plus(site.gasNetwork.loaded,gas);emitEvent(s,'gas.loaded',{entity:id(site,t),from:'machine.input',to:'gasStore',amount:n,gas,smoke:0});}
   t.machine.status=!t.machine.enabled?'Refill paused':t.hp<=0?'Needs repair':t.fire?'Fire at tank':free(t)<=1e-9?'Gas tank full':n?'Loading delivered breathing mix':'Awaiting breathing mix';
  }
  const ordered=s.tick%2?nodes:[...nodes].reverse();
  for(const t of ordered)for(const [dx,dy] of [[1,0],[0,1]]){const n=at(site,t.x+dx,t.y+dy);if(gasNode(n))equalize(s,site,t,n);}
  for(const t of site.tiles)if(t.building==='gasPump'&&!gasStatus(site,t).blocked){const {input,output}=pumpPorts(site,t);move(s,site,input,output,GAS_NETWORK.pump*t.hp/100,'pump',t);}
  for(const t of nodes){
   if(condition(t)<50)releaseGas(s,site,t,GAS_NETWORK.leak*(1-condition(t)/50),'damaged');
   if(t.building==='gasVent'&&!gasStatus(site,t).blocked){
    const room=roomAt(site,t.x,t.y),gas=gasAmount(gasNode(t).gas),needed=Math.max(0,room.volume*GAS_PER_TILE*t.gasDevice.target/100-gasAmount(room.gas));
    releaseGas(s,site,t,Math.min(GAS_NETWORK.vent*t.hp/100,gas?needed*gasPayload(t)/gas:Infinity),'vent');
   }
   if(t.building==='gasExtractor'&&!gasStatus(site,t).blocked)capture(s,site,t);
  }
  refreshAtmosphere(site);
 }
}
export function setGasValve(s,siteId,x,y,open){
 const site=s.sites[siteId],t=site&&at(site,x,y),node=gasNode(t);
 if(!node||typeof open!=='boolean')return {ok:false,message:'Select a gas pipe or equipment valve.'};
 node.open=open;emitEvent(s,'gas.valve.changed',{entity:id(site,t),open});return {ok:true};
}
export function setGasDevice(s,siteId,x,y,enabled,direction,target){
 const site=s.sites[siteId],t=site&&at(site,x,y);
 if(!['gasPump','gasVent'].includes(t?.building)||!t.gasDevice||typeof enabled!=='boolean'||!Object.hasOwn(GAS_DIRECTIONS,direction)||!Number.isInteger(target)||target<0||target>150)return {ok:false,message:'Select a gas pump or vent with valid settings.'};
 if(t.building==='gasPump')t.gasDevice={enabled,direction};else t.gasDevice={enabled,target};
 refreshPower(s,site);emitEvent(s,'gas.device.changed',{entity:id(site,t),...t.gasDevice});return {ok:true};
}
export function setGasExtractor(s,siteId,x,y,enabled,mode,target){
 const site=s.sites[siteId],t=site&&at(site,x,y);
 if(t?.building!=='gasExtractor'||!t.gasDevice||typeof enabled!=='boolean'||!['filter','exhaust'].includes(mode)||!Number.isInteger(target)||target<0||target>150)return {ok:false,message:'Select a gas extractor with valid settings.'};
 t.gasDevice={enabled,mode,target};refreshPower(s,site);emitEvent(s,'gas.extractor.changed',{entity:id(site,t),enabled,mode,target});return {ok:true};
}
export function validateGasNetworks(s){
 const number=n=>Number.isFinite(n)&&n>=0;
 const validGas=g=>g&&typeof g==='object'&&!Array.isArray(g)&&Object.keys(g).length===GASES.length&&GASES.every(k=>number(g[k]))&&Number.isFinite(gasAmount(g));
 for(const site of Object.values(s.sites)){
  const ledger=site.gasNetwork;if(!ledger||!['loaded','extracted','delivered','vented'].every(k=>validGas(ledger[k]))||!ledger.smoke||Object.keys(ledger.smoke).length!==3||!['captured','released','vented'].every(k=>number(ledger.smoke[k])))throw new Error('Invalid pipe gas ledger.');
  const total=emptyGas();let smoke=0;
  for(const t of site.tiles){
   if(t.building==='gasPipe')throw new Error('Gas pipe must be an overlay.');
   if(t.pipe!==null&&(!t.pipe||!number(t.pipe.hp)||t.pipe.hp>100||['rock','void'].includes(t.terrain)||gasEquipment(t)))throw new Error('Invalid gas pipe.');
   if(STORES.includes(t.building)&&t.terrain!=='floor')throw new Error('Gas equipment requires a habitat floor.');
   if(STORES.includes(t.building)?!t.gasStore:t.gasStore!==undefined)throw new Error('Invalid gas equipment storage.');
   const node=gasNode(t);if(node){if(!validGas(node.gas)||!number(node.smoke)||typeof node.open!=='boolean'||gasPayload(t)>gasCapacity(t)+1e-8)throw new Error('Invalid pipe gas contents.');plus(total,node.gas);smoke+=node.smoke;}
   if(['gasPump','gasVent','gasExtractor'].includes(t.building)){
    const d=t.gasDevice,pump=t.building==='gasPump',extractor=t.building==='gasExtractor';
    if(!d||typeof d.enabled!=='boolean'||Object.keys(d).length!==(extractor?3:2)||(pump?!Object.hasOwn(GAS_DIRECTIONS,d.direction):!Number.isInteger(d.target)||d.target<0||d.target>150)||(extractor&&!['filter','exhaust'].includes(d.mode)))throw new Error('Invalid gas device controls.');
   }else if(t.gasDevice!==undefined)throw new Error('Gas controls belong to missing equipment.');
  }
  for(const k of GASES){
   const supplied=ledger.loaded[k]+ledger.extracted[k],expected=supplied-ledger.delivered[k]-ledger.vented[k];
   if(!Number.isFinite(supplied)||!Number.isFinite(expected)||Math.abs(total[k]-expected)>1e-6+supplied*1e-9)throw new Error('Pipe gas does not balance.');
  }
  const expectedSmoke=ledger.smoke.captured-ledger.smoke.released-ledger.smoke.vented;
  if(!Number.isFinite(expectedSmoke)||Math.abs(smoke-expectedSmoke)>1e-7+ledger.smoke.captured*1e-9)throw new Error('Pipe smoke does not balance.');
 }
 for(const j of s.jobs){
  const t=at(s.sites[j.site],j.x,j.y);
  if(['repairPipe','removePipe'].includes(j.kind)){
   const repair=j.kind==='repairPipe';
   if(!t.pipe||(repair&&t.pipe.hp>=100)||j.building!==null||j.work!==3||Object.keys(j.cost).length!==(repair?1:0)||(repair&&j.cost.alloy!==1))throw new Error('Invalid gas pipe work order.');
  }
  if(j.kind==='build'&&j.building==='gasPipe'&&(t.pipe||gasEquipment(t)||['rock','void'].includes(t.terrain)||j.work!==2||Object.keys(j.cost).length!==1||j.cost.alloy!==1))throw new Error('Invalid gas pipe construction.');
  if(j.kind==='build'&&[...STORES,'gasPump'].includes(j.building)&&(t.pipe||t.building||(STORES.includes(j.building)&&t.terrain!=='floor')))throw new Error('Invalid gas device construction.');
 }
}
