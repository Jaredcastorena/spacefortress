import { waterPhase, waterKelvin } from './water-thermal.js';
import { BUILDINGS } from './data.js';
import { planGasCompression, GAS_WORK_FRACTION } from './gas-work.js';
import { claimPowerWork, closePowerWork } from './power-work.js';
import { GAS_DRIVES, settleGasWork } from './gas-compression.js';
import { addGas, gasPortion } from './gas-species.js';
import { releaseNodeCondensate } from './water-vapor.js';
import {activeUtilityLinks} from './utility-links.js';
import { tileAt, positionOf } from './spatial.js';
import { DIRECTIONS, neighbors, forwardNeighbors, step, opposite } from './geometry.js';
import { GASES, emptyGas, gasAmount, mix, roomAt, refreshAtmosphere, GAS_PER_TILE } from './atmosphere.js';
import { roomPressure } from './room-pressure.js';
import { GAS_REFERENCE_KELVIN, gasLatentHeat, nodeKelvin, parcelHeat, roomStructureCapacity, exportRoomHeat, importRoomHeat } from './gas-thermal.js';
import { KELVIN_ZERO } from './thermal-units.js';
import { take } from './inventory.js';
import { refreshPower } from './power.js';
import { emitEvent, tileEntityId, roomEntityId } from './telemetry.js';
import { airlockControlOwner, airlockTankMakeupAllowance } from './airlock-access.js';

// Rates and capacities are total payload (gas + suspended smoke). Pressure uses
// only gas and its stored heat; smoke is a massless thermal tracer.
export const GAS_NETWORK = { pipeVolume:.25, pipeCapacity:10, tankVolume:2, tankCapacity:80, flow:2, pump:2, vent:2, extract:2, load:2, leak:2, diffusion:.02 };
export const GAS_DIRECTIONS = Object.freeze(Object.fromEntries(DIRECTIONS.map(direction => [direction, true])));
const STORES=['gasTank','gasVent','gasExtractor','gasReservoir'];
export const gasEquipment = t => [...STORES,'gasPump'].includes(t.building);
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
export const gasNode=t=>t?.pipe || t?.gasStore || null;
const condition=t=>t.pipe?t.pipe.hp:t.hp;
export const gasNominalVolume=t=>['gasTank','gasReservoir'].includes(t.building)?GAS_NETWORK.tankVolume:GAS_NETWORK.pipeVolume;
export const gasVolumeForWater=(t,mass)=>gasNominalVolume(t)*(1-mass/gasCapacity(t));
export const gasVolume=t=>gasVolumeForWater(t,gasNode(t)?.condensate?.water||0);
export const gasCapacity=t=>['gasTank','gasReservoir'].includes(t.building)?GAS_NETWORK.tankCapacity:GAS_NETWORK.pipeCapacity;
export const gasPayload=t=>gasNode(t)?gasAmount(gasNode(t).gas)+gasNode(t).smoke:0;
export const gasPressure=t=>gasNode(t)&&gasVolume(t)>0?gasAmount(gasNode(t).gas)/gasVolume(t)/GAS_PER_TILE*100*(nodeKelvin(gasNode(t))??0)/GAS_REFERENCE_KELVIN:0;
const free=t=>Math.max(0,gasCapacity(t)-gasPayload(t)-(gasNode(t)?.condensate?.water||0));
// Ruptured pipe remains a passage until isolated. Broken machinery cannot
// operate its port, but retained contents continue leaking independently.
const port=t=>gasNode(t)?.open===true&&(!!t.pipe||t.hp>0);
const id=(site,t)=>tileEntityId(site.id,t.x,t.y,positionOf(t).z);
// Link the existing physical transfer record to control ownership. This adds
// context only; it never creates a second transfer or mutates controller state.
function emitGas(s,site,event,details){
 const owners=[];
 for(const reference of [details.device,details.entity,details.from,details.to]){
  if(typeof reference!=='string'||!reference.startsWith(`tile:${site.id}:`))continue;
  const fields=reference.slice(`tile:${site.id}:`.length).split(':');
  if(fields.length!==2&&fields.length!==3)continue;
  const [x,y,z=0]=fields.map(Number),t=at(site,x,y,z);
  const owner=t&&airlockControlOwner(site,t,t.pipe?'pipe':'building');
  if(owner&&!owners.some(other=>other.controller===owner.controller&&other.binding===owner.binding))owners.push(owner);
 }
 emitEvent(s,event,{...details,...(owners.length===1?{controller:owners[0].controller,binding:owners[0].binding,cycle:owners[0].cycle}:owners.length?{airlocks:owners}:{}),tick:s.tick});
}
const controlRejection={ok:false,code:'airlock_controlled',message:'This gas equipment is controlled by its airlock. Use the controller or unbind it before changing these settings.'};

const roomId=(site,r)=>roomEntityId(site.id,r);
const plus=addGas;
const blank=()=>({gas:emptyGas(),smoke:0,heat:0,condensate:{water:0,heat:0},open:true});
export function initializeGasTile(t){
 if(STORES.includes(t.building))t.gasStore??=blank();
 if(t.building==='gasPump')t.gasDevice??={enabled:true,direction:'ne'};
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
const portion=gasPortion;
function payloadPortion(node,n){
 const total=gasAmount(node.gas)+node.smoke,f=total?Math.min(1,n/total):0;
 return {gas:Object.fromEntries(GASES.map(k=>[k,(node.gas[k]||0)*f])),smoke:node.smoke*f,fraction:f};
}
function move(s,site,a,b,n,reason,device=null,connection=null,work=0){
 const source=gasNode(a),destination=gasNode(b);
 n=Math.min(n,gasPayload(a),free(b));if(n<=1e-9)return 0;
 const {gas,smoke,fraction}=payloadPortion(source,n),heat=source.heat*fraction;
 source.heat-=heat;destination.heat+=heat+work;plus(source.gas,gas,-1);plus(destination.gas,gas);source.smoke-=smoke;destination.smoke+=smoke;
 emitGas(s,site,'gas.transferred',{from:id(site,a),to:id(site,b),amount:n,gas,smoke,heat,reason,...(connection?{connection}:{}),...(device?{device:id(site,device),work}:{})});return n;
}
function equalize(s,site,a,b,connection=null){
 if(!port(a)||!port(b))return;
 if(gasVolume(a)<=0||gasVolume(b)<=0)return;
 if(gasPressure(a)<gasPressure(b))[a,b]=[b,a];
 const source=gasNode(a),destination=gasNode(b),gas=gasAmount(source.gas);
 // Vapor stores latent energy and has a different heat capacity, so energy
 // density cannot stand in for pressure. Solve the actual mixed parcel state.
 const pressure=(t,node)=>gasAmount(node.gas)/gasVolume(t)/GAS_PER_TILE*100*(nodeKelvin(node)??0)/GAS_REFERENCE_KELVIN;
 const difference=amount=>{
  const parcel=portion(source.gas,amount),heat=gas?source.heat*amount/gas:0;
  const left={gas:{...source.gas},heat:source.heat-heat},right={gas:{...destination.gas},heat:destination.heat+heat};
  plus(left.gas,parcel,-1);plus(right.gas,parcel);
  return pressure(a,left)-pressure(b,right);
 };
 let low=0,high=gasPayload(a)?Math.min(gas,GAS_NETWORK.flow*gas/gasPayload(a),free(b)*gas/gasPayload(a)):0;
 if(high>0&&difference(0)>0){
  if(difference(high)>=0)low=high;
  else for(let i=0;i<60;i++){const mid=(low+high)/2;if(difference(mid)>=0)low=mid;else high=mid;}
 }
 // Rate and free-capacity bounds include smoke carried by the gas parcel.
 move(s,site,a,b,gas?Math.min(GAS_NETWORK.flow,low*gasPayload(a)/gas):0,'pressure',null,connection);
 // Equal gas parcels exchange both composition and energy, including identical
 // mixtures at different temperatures. Their smoke remains a separate tracer.
 const an=gasNode(a),bn=gasNode(b),ag=an.gas,bg=bn.gas,n=Math.min(gasAmount(ag),gasAmount(bg))*GAS_NETWORK.diffusion;
 if(n>1e-9){
  const left=portion(ag,n),right=portion(bg,n),forwardHeat=an.heat*(n/gasAmount(ag)),backwardHeat=bn.heat*(n/gasAmount(bg));
  if(!GASES.every(k=>Math.abs(left[k]-right[k])<1e-10)||Math.abs(forwardHeat-backwardHeat)>1e-10){
   an.heat+=backwardHeat-forwardHeat;bn.heat+=forwardHeat-backwardHeat;
   plus(ag,left,-1);plus(bg,right,-1);plus(ag,right);plus(bg,left);
   emitGas(s,site,'gas.mixed',{from:id(site,a),to:id(site,b),amount:n,forward:left,backward:right,forwardHeat,backwardHeat,...(connection?{connection}:{})});
  }
 }
 // A conservative game-scale smoke diffusion permits smoke-only filter output
 // to reach connected storage without inventing a carrier gas or pressure.
 let smokeDelta=gasNode(a).smoke/gasVolume(a)-gasNode(b).smoke/gasVolume(b);
 if(smokeDelta<0){[a,b]=[b,a];smokeDelta=-smokeDelta;}
 const smoke=Math.min(gasNode(a).smoke,free(b),smokeDelta/(1/gasVolume(a)+1/gasVolume(b))*GAS_NETWORK.diffusion);
 if(smoke>1e-9){gasNode(a).smoke-=smoke;gasNode(b).smoke+=smoke;emitGas(s,site,'gas.transferred',{from:id(site,a),to:id(site,b),amount:smoke,gas:emptyGas(),smoke,heat:0,reason:'smoke_diffusion',...(connection?{connection}:{})});}
}
export function releaseGas(s,site,t,n,reason,airlockContext=null,work=0){
 const node=gasNode(t);if(!node)return 0;
 n=Math.min(n,gasPayload(t));if(n<=1e-9)return 0;
 const {gas,smoke,fraction}=payloadPortion(node,n),heat=node.heat*fraction,room=roomAt(site,t.x,t.y,t.z),destinations=[];
 if(room)destinations.push(room);
 else if(['wall','door'].includes(t.building)){
  // Boundary tiles release into adjacent compartments and any exposed exterior.
  for(const [x,y] of neighbors(t.x,t.y)){
   const neighbor=at(site,x,y,positionOf(t).z),adjacent=neighbor&&roomAt(site,neighbor.x,neighbor.y,neighbor.z);
   const destination=adjacent||(!neighbor||(!['wall','door'].includes(neighbor.building)&&!['floor','rock'].includes(neighbor.terrain))?null:undefined);
   if(destination!==undefined&&!destinations.includes(destination))destinations.push(destination);
  }
 }
 if(!destinations.length)destinations.push(null);
 if(!Number.isFinite(work)||work<0||work!==0&&(reason!=='vent'||destinations.length!==1||!destinations[0]))throw new Error('Compression work requires a vent room.');
 node.heat-=heat;plus(node.gas,gas,-1);node.smoke-=smoke;
 for(const destination of destinations){
  const share=Object.fromEntries(GASES.map(k=>[k,gas[k]/destinations.length])),smokeShare=smoke/destinations.length,heatShare=heat/destinations.length;
  if(destination){plus(destination.gas,share);importRoomHeat(site,destination,heatShare+work);destination.smoke+=smokeShare;plus(site.atmosphere.injected,share);plus(site.gasNetwork.delivered,share);site.gasNetwork.smoke.released+=smokeShare;}
  else {site.thermal.gasVented+=heatShare;plus(site.atmosphere.vented,share);plus(site.gasNetwork.vented,share);site.gasNetwork.smoke.vented+=smokeShare;site.fireSafety.smokeVented+=smokeShare;}
  emitGas(s,site,'gas.released',{from:id(site,t),to:destination?roomId(site,destination):`space:${site.id}`,amount:n/destinations.length,gas:share,smoke:smokeShare,heat:heatShare,reason,...(reason==='vent'?{work}:{}),...(airlockContext||{})});
 }
 return n;
}
export function removeGas(s,site,t,overlay=false,airlockContext=null){
 releaseGas(s,site,t,Infinity,'dismantled',airlockContext);
 if(gasNode(t))releaseNodeCondensate(s,site,t,gasNode(t));
 if(overlay)t.pipe=null;else{delete t.gasStore;delete t.gasDevice;}
 refreshAtmosphere(site);
}
export function pumpPorts(site,t){
 const direction=t.gasDevice?.direction;
 if(!Object.hasOwn(GAS_DIRECTIONS,direction))return {input:null,output:null};
 return {input:at(site,...step(t.x,t.y,opposite(direction)),positionOf(t).z),output:at(site,...step(t.x,t.y,direction),positionOf(t).z)};
}
export function gasStatus(site,t,{funded=false}={}){
 const node=gasNode(t),condensate=node?.condensate,kelvin=node?nodeKelvin(node):null,readings=node?{pressure:gasPressure(t),payload:gasPayload(t),condensate:condensate?.water||0,...(condensate?{condensatePhase:waterPhase(condensate),condensateTemperature:condensate.water>0?waterKelvin(condensate)-KELVIN_ZERO:null}:{}),capacity:gasCapacity(t),smoke:node.smoke,heat:node.heat,temperature:kelvin===null?null:kelvin-KELVIN_ZERO}:{};
 if(t.building==='gasPump'){
  const {input,output}=pumpPorts(site,t);
  const blocked=t.fire?'Fire at pump':!t.gasDevice.enabled?'Pump disabled':t.hp<=0?'Needs repair':!gasNode(input)?'Missing inlet pipe or tank':!gasNode(output)?'Missing outlet pipe or tank':!input.pipe&&input.hp<=0?'Inlet equipment broken':!output.pipe&&output.hp<=0?'Outlet equipment broken':!port(input)||!port(output)?'Port valve closed':!t.powered&&!funded?'No power':gasPayload(input)<=1e-9?'Inlet empty':free(output)<=1e-9?'Outlet full':null;
  return {blocked,status:blocked||'Pumping available gas',input:input?id(site,input):null,output:output?id(site,output):null,maxCompressionWork:BUILDINGS[t.building].demand*GAS_WORK_FRACTION};
 }
 if(t.building==='gasVent'){
  const room=roomAt(site,t.x,t.y,t.z);
  const blocked=t.fire?'Fire at vent':!t.gasDevice.enabled?'Vent disabled':t.hp<=0?'Needs repair':!node.open?'Port valve closed':!t.powered&&!funded?'No power':!room?'No habitat compartment':roomPressure(room)>=t.gasDevice.target-1e-9?'Room at target pressure':gasPayload(t)<=1e-9?'Pipe supply empty':null;
  return {blocked,status:blocked||'Supplying room',...readings,maxCompressionWork:BUILDINGS[t.building].demand*GAS_WORK_FRACTION};
 }
 if(t.building==='gasExtractor'){
  const room=roomAt(site,t.x,t.y,t.z),filter=t.gasDevice.mode==='filter';
  const blocked=t.fire?'Fire at extractor':!t.gasDevice.enabled?'Extractor disabled':t.hp<=0?'Needs repair':!node.open?'Port valve closed':!t.powered&&!funded?'No power':!room?'No habitat compartment':free(t)<=1e-9?'Extraction storage full':filter?(room.gas.co2+room.smoke<=1e-9?'No CO2 or smoke to filter':null):roomPressure(room)<=t.gasDevice.target+1e-9?'Room at target pressure':null;
  return {blocked,status:blocked||(filter?'Filtering into storage':'Exhausting into storage'),...readings,room:room?roomId(site,room):null,mode:t.gasDevice.mode,target:t.gasDevice.target,maxCompressionWork:BUILDINGS[t.building].demand*GAS_WORK_FRACTION};
 }
 if(node)return {blocked:!t.pipe&&t.hp<=0?'Needs repair':!node.open?'Valve closed':null,status:t.pipe?.hp===0?'Ruptured pipe — repair needed':condition(t)<50?'Leaking — repair needed':!node.open?'Valve closed':gasPayload(t)<=1e-9?(node.condensate?.water>0?'Condensate retained':'Empty'):'Connected',...readings};
 return null;
}
const nodeOwner=t=>({gas:gasNode(t).gas,heat:gasNode(t).heat,volume:gasVolume(t)});
const roomOwner=room=>({gas:room.gas,heat:room.heat,volume:room.volume,structureCapacity:roomStructureCapacity(room)});
function planPayload(source,destination,smoke,maxPayload,allocated,options={}){
 const selectableGas=options.selectableGas||source.gas,gas=gasAmount(selectableGas),payload=gas+smoke;
 const n=Math.min(maxPayload,payload);
 if(gas===0)return {amount:n,gasAmount:0,gas:emptyGas(),smoke:n,heat:0,work:0,limitedByWork:false,limitedByTarget:false};
 const plan=planGasCompression({source,destination,maxGas:n*gas/payload,energyBudget:allocated*GAS_WORK_FRACTION,...options});
 const movedSmoke=plan.amount*smoke/gas,amount=plan.amount+movedSmoke;
 if(amount<=1e-9)return {...plan,amount:0,gasAmount:0,gas:emptyGas(),smoke:0,heat:0,work:0};
 return {...plan,gasAmount:plan.amount,amount,smoke:movedSmoke};
}
const workDetails=(from,to,plan,blocked=null)=>({from,to,amount:plan?.amount||0,gas:plan?.gas||emptyGas(),smoke:plan?.smoke||0,
 limitedByWork:!!plan?.limitedByWork,limitedByTarget:!!plan?.limitedByTarget,blocked});
function capture(s,site,t,allocated){
 const room=roomAt(site,t.x,t.y,t.z),node=gasNode(t),filter=t.gasDevice.mode==='filter';
 let gas=emptyGas(),smoke=0,n=Math.min(GAS_NETWORK.extract*t.hp/100,free(t));
 if(filter){
  n=Math.min(n,room.gas.co2+room.smoke);const fraction=n/(room.gas.co2+room.smoke);
  gas.co2=room.gas.co2*fraction;smoke=room.smoke*fraction;
 }else{
  n=Math.min(n,gasAmount(room.gas)+room.smoke);
  ({gas,smoke}=payloadPortion(room,n));
 }
 if(n<=1e-9)return null;
 const selectableGas=filter?{...emptyGas(),co2:room.gas.co2}:room.gas;
 const plan=planPayload(roomOwner(room),nodeOwner(t),room.smoke,n,allocated,{selectableGas,...(filter?{}:{sourceEnergy:allocated,minSourcePressure:t.gasDevice.target})});
 if(plan.amount<=1e-9)return plan;
 gas=plan.gas;smoke=plan.smoke;n=plan.amount;
 const heat=exportRoomHeat(site,room,gas);
 plus(room.gas,gas,-1);room.smoke-=smoke;plus(node.gas,gas);node.smoke+=smoke;node.heat+=heat+plan.work;
 plus(site.gasNetwork.extracted,gas);site.gasNetwork.smoke.captured+=smoke;
 emitGas(s,site,'gas.extracted',{from:roomId(site,room),to:id(site,t),device:id(site,t),amount:n,gas,smoke,heat,work:plan.work,mode:t.gasDevice.mode,target:t.gasDevice.target});
 return plan;
}
export function updateGasNetworks(s){
 for(const site of Object.values(s.sites)){
  const nodes=site.tiles.filter(t=>gasNode(t)),drives=site.tiles.filter(t=>GAS_DRIVES.includes(t.building));
  const grants=new Map(drives.map(t=>[t,claimPowerWork(s,site,t)]));
  for(const t of nodes)if(t.building==='gasTank'){
   const n=t.machine.enabled&&t.hp>0&&!t.fire?Math.min(GAS_NETWORK.load,t.machine.input.air||0,free(t),airlockTankMakeupAllowance(site,t)):0;
   if(n>1e-9){take(t.machine.input,{air:n});const gas=mix(n),heat=parcelHeat(n,GAS_REFERENCE_KELVIN);plus(t.gasStore.gas,gas);t.gasStore.heat+=heat;site.thermal.gasLoaded+=heat;plus(site.gasNetwork.loaded,gas);emitGas(s,site,'gas.loaded',{entity:id(site,t),from:'machine.input',to:'gasStore',amount:n,gas,smoke:0,heat});}
   t.machine.status=!t.machine.enabled?'Refill paused':t.hp<=0?'Needs repair':t.fire?'Fire at tank':free(t)<=1e-9?'Gas tank full':n?'Loading delivered breathing mix':Object.hasOwn(t,'airlockOwner')&&airlockTankMakeupAllowance(site,t)<=1e-9?'Airlock recovery capacity reserved':'Awaiting breathing mix';
  }
  const ordered=s.tick%2?nodes:[...nodes].reverse();
  // Flow and diffusion remain per edge; each of the six-sided graph's edges is visited once.
  for(const t of ordered)for(const [x,y] of forwardNeighbors(t.x,t.y)){const n=at(site,x,y,positionOf(t).z);if(gasNode(n))equalize(s,site,t,n);}
  for(const link of activeUtilityLinks(site,'gas'))equalize(s,site,at(site,link.lower.x,link.lower.y,link.lower.z),at(site,link.upper.x,link.upper.y,link.upper.z),link.id);
  for(const t of drives)if(t.building==='gasPump'&&grants.get(t)>0){
   const allocated=grants.get(t),{input,output}=pumpPorts(site,t),blocked=gasStatus(site,t,{funded:true}).blocked;
   let plan=null;
   if(!blocked){
    plan=planPayload(nodeOwner(input),nodeOwner(output),gasNode(input).smoke,Math.min(GAS_NETWORK.pump*t.hp/100,free(output)),allocated);
    if(plan.amount>1e-9)move(s,site,input,output,plan.amount,'pump',t,null,plan.work);
   }
   settleGasWork(s,site,t,allocated,plan?.work||0,workDetails(input?id(site,input):null,output?id(site,output):null,plan,blocked));
  }
  for(const t of nodes){
   if(condition(t)<50)releaseGas(s,site,t,GAS_NETWORK.leak*(1-condition(t)/50),'damaged');
   if(t.building==='gasVent'&&grants.get(t)>0){
    const allocated=grants.get(t),room=roomAt(site,t.x,t.y,t.z),node=gasNode(t),blocked=gasStatus(site,t,{funded:true}).blocked;
    let plan=null;
    if(!blocked){
     plan=planPayload(nodeOwner(t),roomOwner(room),node.smoke,GAS_NETWORK.vent*t.hp/100,allocated,{targetPressure:t.gasDevice.target,destinationEnergy:allocated});
     if(plan.amount>1e-9)releaseGas(s,site,t,plan.amount,'vent',null,plan.work);
    }
    settleGasWork(s,site,t,allocated,plan?.work||0,workDetails(id(site,t),room?roomId(site,room):null,plan,blocked));
   }
   if(t.building==='gasExtractor'&&grants.get(t)>0){
    const allocated=grants.get(t),room=roomAt(site,t.x,t.y,t.z),blocked=gasStatus(site,t,{funded:true}).blocked;
    const plan=blocked?null:capture(s,site,t,allocated);
    settleGasWork(s,site,t,allocated,plan?.work||0,workDetails(room?roomId(site,room):null,id(site,t),plan,blocked));
   }
  }
  closePowerWork(s,site);
  refreshAtmosphere(site);
 }
}
export function setGasValve(s,siteId,x,y,open,z=0){
 const site=s.sites[siteId],t=site&&at(site,x,y,z),node=gasNode(t);
 if(!node||typeof open!=='boolean')return {ok:false,message:'Select a gas pipe or equipment valve.'};
 if(airlockControlOwner(site,t,t.pipe?'pipe':'building'))return {...controlRejection};
 node.open=open;emitGas(s,site,'gas.valve.changed',{entity:id(site,t),open});return {ok:true};
}
export function setGasDevice(s,siteId,x,y,enabled,direction,target,z=0){
 const site=s.sites[siteId],t=site&&at(site,x,y,z);
 if(!['gasPump','gasVent'].includes(t?.building)||!t.gasDevice||typeof enabled!=='boolean'||!Object.hasOwn(GAS_DIRECTIONS,direction)||!Number.isInteger(target)||target<0||target>150)return {ok:false,message:'Select a gas pump or vent with valid settings.'};
 if(airlockControlOwner(site,t,'building'))return {...controlRejection};
 if(t.building==='gasPump')t.gasDevice={enabled,direction};else t.gasDevice={enabled,target};
 refreshPower(s,site);emitGas(s,site,'gas.device.changed',{entity:id(site,t),...t.gasDevice});return {ok:true};
}
export function setGasExtractor(s,siteId,x,y,enabled,mode,target,z=0){
 const site=s.sites[siteId],t=site&&at(site,x,y,z);
 if(t?.building!=='gasExtractor'||!t.gasDevice||typeof enabled!=='boolean'||!['filter','exhaust'].includes(mode)||!Number.isInteger(target)||target<0||target>150)return {ok:false,message:'Select a gas extractor with valid settings.'};
 if(airlockControlOwner(site,t,'building'))return {...controlRejection};
 t.gasDevice={enabled,mode,target};refreshPower(s,site);emitGas(s,site,'gas.extractor.changed',{entity:id(site,t),enabled,mode,target});return {ok:true};
}
export function validateGasNetworks(s,{legacyHeat=false,legacyVapor=false}={}){
 const number=n=>Number.isFinite(n)&&n>=0;
 const species=legacyVapor?GASES.filter(k=>k!=='vapor'):GASES;
 const validGas=g=>g&&typeof g==='object'&&!Array.isArray(g)&&Object.keys(g).length===species.length&&species.every(k=>number(g[k]))&&Number.isFinite(gasAmount(g));
 for(const site of Object.values(s.sites)){
  const ledger=site.gasNetwork;if(!ledger||!['loaded','extracted','delivered','vented'].every(k=>validGas(ledger[k]))||!ledger.smoke||Object.keys(ledger.smoke).length!==3||!['captured','released','vented'].every(k=>number(ledger.smoke[k])))throw new Error('Invalid pipe gas ledger.');
  const total=emptyGas();let smoke=0;
  for(const t of site.tiles){
   if(t.building==='gasPipe')throw new Error('Gas pipe must be an overlay.');
   if(t.pipe!==null&&(!t.pipe||!number(t.pipe.hp)||t.pipe.hp>100||['rock','void'].includes(t.terrain)||gasEquipment(t)))throw new Error('Invalid gas pipe.');
   if(STORES.includes(t.building)&&t.terrain!=='floor')throw new Error('Gas equipment requires a habitat floor.');
   if(STORES.includes(t.building)?!t.gasStore:t.gasStore!==undefined)throw new Error('Invalid gas equipment storage.');
   const node=gasNode(t);if(node){if(!validGas(node.gas)||!number(node.smoke)||typeof node.open!=='boolean'||gasPayload(t)+(node.condensate?.water||0)>gasCapacity(t)+1e-8||(gasAmount(node.gas)>0&&gasVolume(t)<=0))throw new Error('Invalid pipe gas contents.');if(!legacyHeat&&(!number(node.heat)||node.heat<gasLatentHeat(node.gas)||(gasAmount(node.gas)===0&&node.heat!==0)))throw new Error('Invalid pipe gas heat.');plus(total,node.gas);smoke+=node.smoke;}
   if(['gasPump','gasVent','gasExtractor'].includes(t.building)){
    const d=t.gasDevice,pump=t.building==='gasPump',extractor=t.building==='gasExtractor';
    if(!d||typeof d.enabled!=='boolean'||Object.keys(d).length!==(extractor?3:2)||(pump?!Object.hasOwn(GAS_DIRECTIONS,d.direction):!Number.isInteger(d.target)||d.target<0||d.target>150)||(extractor&&!['filter','exhaust'].includes(d.mode)))throw new Error('Invalid gas device controls.');
   }else if(t.gasDevice!==undefined)throw new Error('Gas controls belong to missing equipment.');
  }
  for(const k of species){
   const supplied=ledger.loaded[k]+ledger.extracted[k]+(k==='vapor'?(site.vapor?.nodeEvaporated||0):0),expected=supplied-ledger.delivered[k]-ledger.vented[k]-(k==='vapor'?(site.vapor?.nodeCondensed||0):0);
   if(!Number.isFinite(supplied)||!Number.isFinite(expected)||Math.abs(total[k]-expected)>1e-6+supplied*1e-9)throw new Error('Pipe gas does not balance.');
  }
  const expectedSmoke=ledger.smoke.captured-ledger.smoke.released-ledger.smoke.vented;
  if(!Number.isFinite(expectedSmoke)||Math.abs(smoke-expectedSmoke)>1e-7+ledger.smoke.captured*1e-9)throw new Error('Pipe smoke does not balance.');
 }
 for(const j of s.jobs){
  const t=at(s.sites[j.site],j.x,j.y,positionOf(j).z);
  if(['repairPipe','removePipe'].includes(j.kind)){
   const repair=j.kind==='repairPipe';
   if(!t.pipe||(repair&&t.pipe.hp>=100)||j.building!==null||j.work!==3||Object.keys(j.cost).length!==(repair?1:0)||(repair&&j.cost.alloy!==1))throw new Error('Invalid gas pipe work order.');
  }
  if(j.kind==='build'&&j.building==='gasPipe'&&(t.pipe||gasEquipment(t)||['rock','void'].includes(t.terrain)||j.work!==2||Object.keys(j.cost).length!==1||j.cost.alloy!==1))throw new Error('Invalid gas pipe construction.');
  if(j.kind==='build'&&[...STORES,'gasPump'].includes(j.building)&&(t.pipe||t.building||(STORES.includes(j.building)&&t.terrain!=='floor')))throw new Error('Invalid gas device construction.');
 }
}
