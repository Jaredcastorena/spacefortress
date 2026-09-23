import { RECIPES, BUILDINGS } from './data.js';
import { add, extract } from './inventory.js';
import { incomingInventory, outgoingInventory } from './inventory-reservations.js';
import { inputBatchesWanted } from './production.js';
import { LIQUID, liquidOpen } from './liquids.js';
import { refreshPower } from './power.js';
import { emitEvent, tileEntityId } from './telemetry.js';

export const PLUMBING = { pipeCapacity:2, reservoirCapacity:32, flow:.5, pump:.5, leak:.5 };
export const WATER_DIRECTIONS = { east:[1,0], south:[0,1], west:[-1,0], north:[0,-1] };
const DEVICES = ['waterPump','waterIntake','waterOutlet'];
const EQUIPMENT = ['waterReservoir',...DEVICES];
const EPS = 1e-9;
const at = (site,x,y) => site && x>=0 && y>=0 && x<site.size && y<site.size ? site.tiles[y*site.size+x] : null;
const id = (site,t) => tileEntityId(site.id,t.x,t.y);
const owner = (site,t,slot) => ({entity:id(site,t),slot});
const nodeSlot = t => t.waterPipe ? 'waterPipe' : 'waterStore';
const condition = t => t.waterPipe ? t.waterPipe.hp : t.hp;
const port = t => waterNode(t)?.open === true && (!!t.waterPipe || t.hp>0);
const blank = () => ({water:0,open:true});
const ordered = (s,tiles) => s.tick%2 ? tiles : [...tiles].reverse();

export const waterEquipment = t => !!t && EQUIPMENT.includes(t.building);
export const waterNode = t => t?.waterPipe || t?.waterStore || null;
export const waterCapacity = t => t?.waterPipe ? PLUMBING.pipeCapacity : t?.waterStore ? PLUMBING.reservoirCapacity : 0;
export const newWaterPipe = () => ({...blank(),hp:100});
export function initializePlumbingTile(t) {
  if(t.building==='waterReservoir') t.waterStore ??= blank();
  if(DEVICES.includes(t.building)) t.waterDevice ??= {enabled:true,direction:'east',...(t.building==='waterPump'?{}:{mode:'inventory'})};
}
export function initializePlumbing(s) {
  for(const site of Object.values(s.sites)) {
    site.plumbing={loaded:0,recovered:0,delivered:0,released:0};
    for(const t of site.tiles) {t.waterPipe=null;initializePlumbingTile(t);}
  }
}
export function waterPorts(site,t) {
  const direction=WATER_DIRECTIONS[t.waterDevice?.direction];
  if(!direction)return {input:null,output:null};
  const [dx,dy]=direction;
  return {input:at(site,t.x-dx,t.y-dy),output:at(site,t.x+dx,t.y+dy)};
}

const BLOCKED = {
  disabled:'Device disabled',damaged:'Needs repair',fire:'Fire at device or endpoint',no_power:'No power',
  missing_source:'Missing source',missing_target:'Missing destination',wrong_source:'Source cannot supply water',wrong_target:'Destination cannot receive water',
  source_damaged:'Source equipment broken',target_damaged:'Destination equipment broken',valve_closed:'Port valve closed',
  source_empty:'Source empty',source_reserved:'Source water reserved for hauling',target_full:'Destination full',target_reserved:'Destination space reserved for delivery',
  target_paused:'Destination refilling paused',target_order_complete:'Destination order needs no more water',floor_blocked:'Floor blocked by a wall or closed door'
};
function intakeInventory(t) {
  if(t?.building==='waterTank' && t.machine)return {inventory:t.machine.input,slot:'machine.input',reservedKind:null};
  if(RECIPES[t?.building]?.output.water && t.machine)return {inventory:t.machine.output,slot:'machine.output',reservedKind:'output'};
  return null;
}
function devicePlan(s,site,t) {
  const {input,output}=waterPorts(site,t),pump=t.building==='waterPump',intake=t.building==='waterIntake',floor=t.waterDevice.mode==='floor';
  const sourceNode=pump||!intake,targetNode=pump||intake;
  const sourceInventory=intake&&!floor?intakeInventory(input):null;
  const targetRecipe=!pump&&!intake&&!floor?RECIPES[output?.building]:null;
  const targetInventory=targetRecipe?.input.water && output?.machine ? output.machine.input : null;
  const inputSlot=sourceNode?(waterNode(input)?nodeSlot(input):null):floor?'liquid':sourceInventory?.slot||null;
  const outputSlot=targetNode?(waterNode(output)?nodeSlot(output):null):floor?'liquid':targetInventory?'machine.input':null;
  // Reservation names refer to machine inventory slots, not device direction:
  // output claims protect source goods; input claims protect delivery space.
  const reservedOutput=sourceInventory?.reservedKind?outgoingInventory(s,site.id,[input.x,input.y],sourceInventory.reservedKind,'water'):0;
  const reservedInput=targetInventory?incomingInventory(s,site.id,{kind:'input',target:[output.x,output.y]},'water'):0;
  const sourceWater=sourceNode?(waterNode(input)?.water||0):floor?(input?.liquid||0):(sourceInventory?.inventory.water||0);
  const targetWater=targetNode?(waterNode(output)?.water||0):floor?(output?.liquid||0):(targetInventory?.water||0);
  const targetCapacity=targetNode?waterCapacity(output):floor?LIQUID.capacity:targetInventory?targetRecipe.input.water*2:0;
  const desiredCapacity=targetInventory?Math.min(targetCapacity,targetRecipe.input.water*inputBatchesWanted(s,site,output)):targetCapacity;
  const sourceAvailable=Math.max(0,sourceWater-reservedOutput),targetFree=Math.max(0,desiredCapacity-targetWater-reservedInput);
  // Topology and endpoint controls precede power/quantity reasons, so a route
  // can be inspected while off. Quantity reasons never reserve or move water.
  const blockedCode=t.fire?'fire':!t.waterDevice.enabled?'disabled':t.hp<=0?'damaged':
    !input?'missing_source':!output?'missing_target':
    sourceNode&&!waterNode(input)?'wrong_source':targetNode&&!waterNode(output)?'wrong_target':
    !sourceNode&&!floor&&!sourceInventory?'wrong_source':!targetNode&&!floor&&!targetInventory?'wrong_target':
    sourceNode&&waterNode(input)&&!input.waterPipe&&input.hp<=0||sourceInventory&&input.hp<=0?'source_damaged':
    targetNode&&waterNode(output)&&!output.waterPipe&&output.hp<=0||targetInventory&&output.hp<=0?'target_damaged':
    sourceInventory&&input.fire||targetInventory&&output.fire?'fire':
    sourceNode&&!port(input)||targetNode&&!port(output)?'valve_closed':
    !sourceNode&&floor&&!liquidOpen(site,input,s.tick)||!targetNode&&floor&&!liquidOpen(site,output,s.tick)?'floor_blocked':
    targetInventory&&!output.machine.enabled?'target_paused':targetInventory&&desiredCapacity<=EPS?'target_order_complete':
    !t.powered?'no_power':sourceWater<=EPS?'source_empty':sourceAvailable<=EPS?'source_reserved':
    targetWater>=desiredCapacity-EPS?'target_full':targetFree<=EPS?'target_reserved':null;
  return {input,output,inputSlot,outputSlot,sourceInventory,targetInventory,reservedInput,reservedOutput,sourceWater,targetWater,targetCapacity,desiredCapacity,sourceAvailable,targetFree,blockedCode};
}
export function plumbingStatus(s,site,t) {
  const node=waterNode(t);
  if(node) {
    const capacity=waterCapacity(t),blockedCode=!t.waterPipe&&t.hp<=0?'damaged':!node.open?'valve_closed':null;
    return {water:node.water,capacity,fill:node.water/capacity*100,input:null,output:null,inputSlot:null,outputSlot:null,reservedInput:0,reservedOutput:0,
      sourceWater:node.water,targetWater:node.water,targetCapacity:capacity,desiredCapacity:capacity,sourceAvailable:node.water,targetFree:Math.max(0,capacity-node.water),blockedCode,blocked:blockedCode?BLOCKED[blockedCode]:null,
      status:condition(t)<50?'Leaking — repair needed':blockedCode?BLOCKED[blockedCode]:node.water<=EPS?'Empty':node.water>=capacity-EPS?'Full':'Connected'};
  }
  if(!DEVICES.includes(t.building)||!t.waterDevice)return null;
  const plan=devicePlan(s,site,t),{input,output,sourceInventory,targetInventory,...state}=plan;
  return {water:0,capacity:0,fill:0,...state,input:input?id(site,input):null,output:output?id(site,output):null,
    blocked:plan.blockedCode?BLOCKED[plan.blockedCode]:null,status:plan.blockedCode?BLOCKED[plan.blockedCode]:t.building==='waterPump'?'Pumping available water':t.building==='waterIntake'?'Collecting available water':'Supplying destination'};
}

function moveNodes(s,site,a,b,amount,reason,device=null) {
  const source=waterNode(a),destination=waterNode(b);
  const n=Math.min(amount,source.water,Math.max(0,waterCapacity(b)-destination.water));
  if(n<=EPS)return 0;
  source.water-=n;destination.water+=n;
  emitEvent(s,'plumbing.transferred',{from:owner(site,a,nodeSlot(a)),to:owner(site,b,nodeSlot(b)),amount:n,reason,...(device?{device:id(site,device)}:{})});
  return n;
}
function releaseFloor(s,site,source,target,amount,reason,device=null) {
  const node=waterNode(source),n=Math.min(amount,node.water,Math.max(0,LIQUID.capacity-target.liquid));
  if(n<=EPS)return 0;
  node.water-=n;target.liquid+=n;site.plumbing.released+=n;site.liquids.released+=n;
  emitEvent(s,'plumbing.released',{from:owner(site,source,nodeSlot(source)),to:owner(site,target,'liquid'),amount:n,reason,...(device?{device:id(site,device)}:{})});
  return n;
}
function leak(s,site,t) {
  const node=waterNode(t);let remaining=Math.min(node.water,PLUMBING.leak*(1-condition(t)/50));
  if(remaining<=EPS)return;
  // A full open tile retains overflow; a boundary fitting can leak into its
  // adjacent open cells. No full or isolated destination is an implicit sink.
  let targets=liquidOpen(site,t,s.tick)?[t]:Object.values(WATER_DIRECTIONS).map(([dx,dy])=>at(site,t.x+dx,t.y+dy)).filter(n=>n&&liquidOpen(site,n,s.tick));
  targets=targets.filter(n=>n.liquid<LIQUID.capacity-EPS);
  while(remaining>EPS&&targets.length) {
    const share=remaining/targets.length;let moved=0;
    for(const target of targets)moved+=releaseFloor(s,site,t,target,share,'damage');
    remaining-=moved;if(moved<=EPS)break;
    targets=targets.filter(n=>n.liquid<LIQUID.capacity-EPS);
  }
}
export function flowPlumbing(s) {
  for(const site of Object.values(s.sites)) {
    const nodes=ordered(s,site.tiles.filter(t=>waterNode(t)));
    for(const t of nodes)for(const [dx,dy] of [[1,0],[0,1]]) {
      const neighbor=at(site,t.x+dx,t.y+dy);if(!port(t)||!port(neighbor))continue;
      let a=t,b=neighbor,delta=waterNode(a).water/waterCapacity(a)-waterNode(b).water/waterCapacity(b);
      if(delta<0){[a,b]=[b,a];delta=-delta;}
      moveNodes(s,site,a,b,Math.min(PLUMBING.flow,delta/(1/waterCapacity(a)+1/waterCapacity(b))),'level');
    }
    for(const t of nodes)if(condition(t)<50)leak(s,site,t);
  }
}
export function operatePlumbing(s) {
  for(const site of Object.values(s.sites))for(const t of ordered(s,site.tiles))if(DEVICES.includes(t.building)) {
    const plan=devicePlan(s,site,t);if(plan.blockedCode)continue;
    const {input,output}=plan,n=Math.min(PLUMBING.pump*t.hp/100,plan.sourceAvailable,plan.targetFree);
    if(n<=EPS)continue;
    if(t.building==='waterPump')moveNodes(s,site,input,output,n,'pump',t);
    else if(t.building==='waterIntake') {
      const destination=waterNode(output);
      if(t.waterDevice.mode==='floor') {
        input.liquid-=n;destination.water+=n;site.plumbing.recovered+=n;site.liquids.recovered+=n;
        emitEvent(s,'plumbing.recovered',{from:owner(site,input,'liquid'),to:owner(site,output,nodeSlot(output)),amount:n,reason:'intake',device:id(site,t)});
      } else {
        const moved=extract(plan.sourceInventory.inventory,{water:n});if(!moved)continue;
        destination.water+=n;site.plumbing.loaded+=n;
        emitEvent(s,'plumbing.loaded',{from:owner(site,input,plan.inputSlot),to:owner(site,output,nodeSlot(output)),amount:n,reason:'intake',device:id(site,t)});
      }
    } else if(t.waterDevice.mode==='floor')releaseFloor(s,site,input,output,n,'outlet',t);
    else {
      waterNode(input).water-=n;add(plan.targetInventory,{water:n});site.plumbing.delivered+=n;
      emitEvent(s,'plumbing.delivered',{from:owner(site,input,nodeSlot(input)),to:owner(site,output,'machine.input'),amount:n,reason:'supply',device:id(site,t)});
    }
  }
}

export function removePlumbing(s,site,t,accessibleDropTile,overlay=false) {
  const node=overlay?t.waterPipe:t.waterStore,n=node?.water||0;
  if(n>0) {
    if(!accessibleDropTile||at(site,accessibleDropTile.x,accessibleDropTile.y)!==accessibleDropTile)throw new Error('Water dismantling needs an accessible recovery tile.');
    accessibleDropTile.drop=add(accessibleDropTile.drop||{},{water:n});
    node.water=0;site.plumbing.delivered+=n;
    emitEvent(s,'plumbing.delivered',{from:owner(site,t,overlay?'waterPipe':'waterStore'),to:owner(site,accessibleDropTile,'drop'),amount:n,reason:'dismantled'});
  }
  if(overlay)t.waterPipe=null;else{delete t.waterStore;delete t.waterDevice;}
  return n;
}
export function setWaterValve(s,siteId,x,y,open) {
  const site=s.sites[siteId],t=at(site,x,y),node=waterNode(t);
  if(!node||typeof open!=='boolean')return {ok:false,message:'Select a water pipe or reservoir valve.'};
  node.open=open;emitEvent(s,'plumbing.valve.changed',{entity:id(site,t),open});return {ok:true};
}
function setDevice(s,siteId,x,y,building,enabled,direction,mode) {
  const site=s.sites[siteId],t=at(site,x,y);
  if(t?.building!==building||!t.waterDevice||typeof enabled!=='boolean'||!Object.hasOwn(WATER_DIRECTIONS,direction)||(building!=='waterPump'&&!['inventory','floor'].includes(mode)))return {ok:false,message:'Choose the matching water device with valid controls.'};
  t.waterDevice={enabled,direction,...(building==='waterPump'?{}:{mode})};refreshPower(s,site);
  emitEvent(s,'plumbing.device.changed',{entity:id(site,t),building,...t.waterDevice});return {ok:true};
}
export const setWaterPump=(s,siteId,x,y,enabled,direction)=>setDevice(s,siteId,x,y,'waterPump',enabled,direction);
export const setWaterIntake=(s,siteId,x,y,enabled,direction,mode)=>setDevice(s,siteId,x,y,'waterIntake',enabled,direction,mode);
export const setWaterOutlet=(s,siteId,x,y,enabled,direction,mode)=>setDevice(s,siteId,x,y,'waterOutlet',enabled,direction,mode);

export function validatePlumbing(s) {
  const number=n=>Number.isFinite(n)&&n>=0;
  const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));
  for(const site of Object.values(s.sites)) {
    const ledger=site.plumbing;
    if(!keys(ledger,['loaded','recovered','delivered','released'])||!Object.values(ledger).every(number))throw new Error('Invalid plumbing ledger.');
    let stored=0;
    for(const t of site.tiles) {
      if(t.building==='waterPipe')throw new Error('Water pipe must be an overlay.');
      if(t.waterPipe!==null&&(!keys(t.waterPipe,['water','open','hp'])||!number(t.waterPipe.hp)||t.waterPipe.hp>100||['rock','void'].includes(t.terrain)||waterEquipment(t)))throw new Error('Invalid water pipe.');
      if(waterEquipment(t)&&t.terrain!=='floor')throw new Error('Water equipment requires a habitat floor.');
      if(t.building==='waterReservoir'?!keys(t.waterStore,['water','open']):t.waterStore!==undefined)throw new Error('Invalid reservoir storage.');
      const node=waterNode(t);
      if(node) {
        if(!number(node.water)||node.water>waterCapacity(t)+1e-8||typeof node.open!=='boolean')throw new Error('Invalid plumbing contents.');
        stored+=node.water;
      }
      if(DEVICES.includes(t.building)) {
        const d=t.waterDevice,pump=t.building==='waterPump';
        if(!keys(d,pump?['enabled','direction']:['enabled','direction','mode'])||typeof d.enabled!=='boolean'||!Object.hasOwn(WATER_DIRECTIONS,d.direction)||(!pump&&!['inventory','floor'].includes(d.mode)))throw new Error('Invalid water device controls.');
      }else if(t.waterDevice!==undefined)throw new Error('Water controls belong to missing equipment.');
    }
    const supplied=ledger.loaded+ledger.recovered,expected=supplied-ledger.delivered-ledger.released;
    if(!Number.isFinite(supplied)||!Number.isFinite(expected)||!Number.isFinite(stored)||Math.abs(stored-expected)>1e-6+supplied*1e-9)throw new Error('Plumbing water does not balance.');
  }
  for(const j of s.jobs) {
    const t=at(s.sites[j.site],j.x,j.y);
    if(['repairWaterPipe','removeWaterPipe'].includes(j.kind)) {
      const repair=j.kind==='repairWaterPipe';
      if(!t?.waterPipe||(repair&&t.waterPipe.hp>=100)||j.building!==null||j.work!==3||!keys(j.cost,repair?['alloy']:[])||(repair&&j.cost.alloy!==1))throw new Error('Invalid water pipe work order.');
    }
    if(j.kind==='build'&&j.building==='waterPipe'&&(!t||t.waterPipe||waterEquipment(t)||['rock','void'].includes(t.terrain)||j.work!==2||!keys(j.cost,['alloy'])||j.cost.alloy!==1))throw new Error('Invalid water pipe construction.');
    if(j.kind==='build'&&EQUIPMENT.includes(j.building)) {
      const definition=BUILDINGS[j.building];
      if(!t||t.waterPipe||t.building||t.terrain!=='floor'||j.work!==definition.work||!keys(j.cost,Object.keys(definition.cost))||Object.entries(definition.cost).some(([key,n])=>j.cost[key]!==n))throw new Error('Invalid water device construction.');
    }
  }
}
