import { BREAKER_DIRECTIONS, BREAKER_MODES, setBreaker, resetBreaker } from './breakers.js';
import { PLUMBING, WATER_DIRECTIONS, setWaterValve, setWaterPump, setWaterIntake, setWaterOutlet } from './plumbing.js';
import { GAS_NETWORK, GAS_DIRECTIONS, setGasValve, setGasDevice, setGasExtractor } from './gas-networks.js';
import { LIQUID, setTank } from './liquids.js';
import { REACTOR, setReactor, resetReactor, setRadiator } from './reactors.js';
import { FIRE, setFireResponse } from './fire.js';
import { TRANSPORT_WORK, TRANSPORT_STEP } from './animal-transport.js';
import { setBreeding, BREEDING } from './breeding.js';
import { setPastureGate } from './pastures.js';
import { ICE_SEAM_CAPACITY, ICE_EXTRACTION_AMOUNT } from './water.js';
import { setPossessionCollection, releasePossession } from './possessions.js';
import { ITEM_STYLES } from './item-lots.js';
import * as sim from './simulation.js';
import { BUILDINGS, RESOURCES, RECIPES, SHUTTLE_FITS } from './data.js';
import { LABORS } from './crew.js';
import { setRoomDesignation, ROOM_ROLES } from './rooms.js';
import { setBunkOwner } from './housing.js';
import { setClimate } from './thermal.js';
import { setDepotAccepted, setDepotPriority } from './storage.js';
import { setProductionOrder, setProductionPriority } from './production.js';
import { setMachineEnabled } from './industry.js';
import { setDoorMode } from './atmosphere.js';
import { setCargoAccepted, resumeExpedition, setReturnCrew } from './expedition.js';
import { OUTPOST_SITES, setOutpostResidents } from './outposts.js';
import { OUTPOST_RESERVES } from './outpost-readiness.js';
import { setAutoService } from './maintenance.js';
import { setCableEnabled, setPowerPriority } from './power.js';
import { setLifePolicy, LIFE_POLICIES } from './crew-life.js';
import { beginAction, endAction, observe, recordingStatus, startRecording, stopRecording, exportRecording } from './telemetry.js';

const enumeration=values=>({type:'string',enum:values});
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const site=enumeration(['surface','wreck','comet','solar']),xy={site,x:integer(0,1000),y:integer(0,1000)},enabled={type:'boolean'},crew={type:'string',entityType:'crew'},job={type:'string',entityType:'job'},priority={type:'integer',enum:[1,3,5]};
const inventoryRequest={type:'object',properties:Object.fromEntries(RESOURCES.map(resource=>[resource,{type:resource==='keepsakes'?'integer':'number',exclusiveMinimum:0}])),minProperties:1,maxProperties:RESOURCES.length,additionalProperties:false};
const optional=schema=>({...schema,optional:true});
const entries=[];
function register(id,binding,description,parameters,run) {entries.push({id,binding,description,parameters,run});}
register('job.order','order','Designate physical work. Materials and workers must still reach the target.',{...xy,kind:enumeration(['extinguish','build','mine','remove','repair','service','refit','unloadShuttle','repairPipe','removePipe','repairWaterPipe','removeWaterPipe','repairCable','removeCable','treat','feed','hygiene']),building:optional({type:['string','null'],description:'Building ID, shuttle fit ID, or patient crew ID, depending on kind.'})},sim.order);
register('job.cancel','cancelJob','Cancel an existing order; preserve its located materials.',{job},(s,id)=>{if(!s.jobs.some(j=>j.id===id))return {ok:false,message:'Unknown job.'};sim.cancelJob(s,id);return {ok:true};});
register('crew.labor','setLabor','Enable or disable one work duty.',{crew,labor:enumeration(Object.keys(LABORS)),enabled},sim.setLabor);
register('job.priority','setJobPriority','Set assignment priority for a pending job.',{job,priority},sim.setJobPriority);
register('expedition.launch','launch','Plan supplied loading and boarding. Choose two crew, or one pilot for an already established wreck outpost; omitting crewIds still selects two.',{site,crewIds:optional({type:'array',items:crew,minItems:1,maxItems:2,uniqueItems:true})},sim.launch);
register('expedition.cancel_departure','cancelDeparture','Cancel preparation; loaded stores stay aboard.',{},sim.cancelDeparture);
register('expedition.recall','recall','Order expedition crew back to their shuttle.',{},sim.recall);
register('expedition.resume','resumeExpedition','Resume field work before return departure.',{},resumeExpedition);
register('expedition.return_crew','setReturnCrew','Choose one or two living passengers physically at the shuttle destination. Other arriving visitors must have a residence.',{crewIds:{type:'array',items:crew,minItems:1,maxItems:2,uniqueItems:true}},setReturnCrew);
register('expedition.cargo','setCargoAccepted','Choose resources accepted in the shuttle hold.',{resource:enumeration(RESOURCES),enabled},setCargoAccepted);
register('freight.load','loadFreight','Order workers to physically load specified local supplies into the surface shuttle hold.',{items:inventoryRequest},(s,items)=>sim.loadFreight(s,items));
register('freight.unload','unloadFreight','Order workers to unload specified freight, or all current freight, at the present shuttle berth.',{site,items:optional(inventoryRequest)},(s,siteId,items)=>sim.unloadFreight(s,siteId,items));
register('outpost.residents','setOutpostResidents','Station named visitors in a ready habitat while retaining a living return passenger. Remote residents leave only on physical departure; remove surface or deceased entries here.',{site:enumeration(OUTPOST_SITES),crewIds:{type:'array',items:crew,minItems:0,maxItems:7,uniqueItems:true}},setOutpostResidents);
register('signal.resolve','resolveSignal','Investigate or isolate the current anomaly.',{investigate:enabled},sim.resolveSignal);
register('power.discharge_cell','dischargeCell','Consume a stored energy cell to charge a bank.',{x:optional({type:['integer','null'],minimum:0,maximum:1000}),y:optional({type:['integer','null'],minimum:0,maximum:1000})},sim.dischargeCell);
register('housing.assign','setBunkOwner','Assign a bunk to one living crew member, or null for communal use.',{...xy,crew:{type:['string','null'],entityType:'crew'}},setBunkOwner);
register('room.designate','setRoomDesignation','Set the purpose of the selected connected compartment.',{...xy,role:enumeration(Object.keys(ROOM_ROLES))},setRoomDesignation);
register('gas.valve','setGasValve','Open or close a gas port; retain trapped gas.',{...xy,open:enabled},setGasValve);
register('gas.device','setGasDevice','Enable or rotate a pump, or set a vent pressure target.',{...xy,enabled,direction:enumeration(Object.keys(GAS_DIRECTIONS)),target:integer(0,150)},setGasDevice);
register('gas.extractor','setGasExtractor','Retain CO2 and smoke, or exhaust into storage down to a pressure target.',{...xy,enabled,mode:enumeration(['filter','exhaust']),target:integer(0,150)},setGasExtractor);
register('plumbing.valve','setWaterValve','Open or close a water pipe or reservoir valve; retain its contents.',{...xy,open:enabled},setWaterValve);
register('plumbing.pump','setWaterPump','Enable or rotate a directional water pump.',{...xy,enabled,direction:enumeration(Object.keys(WATER_DIRECTIONS))},setWaterPump);
register('plumbing.intake','setWaterIntake','Configure water collection from an adjacent inventory or floor into a pipe or reservoir.',{...xy,enabled,direction:enumeration(Object.keys(WATER_DIRECTIONS)),mode:enumeration(['inventory','floor'])},setWaterIntake);
register('plumbing.outlet','setWaterOutlet','Configure water delivery from a pipe or reservoir into an adjacent inventory or floor.',{...xy,enabled,direction:enumeration(Object.keys(WATER_DIRECTIONS)),mode:enumeration(['inventory','floor'])},setWaterOutlet);
register('water.tank','setTank','Control tank refill assignments and floor drain valve.',{...xy,fill:enabled,drain:enabled},setTank);
register('reactor.configure','setReactor','Set reactor output and enabled state; preserve an overheat latch.',{...xy,percent:integer(0,100),enabled},setReactor);
register('reactor.reset','resetReactor','Reset a cooled, repaired reactor after overheat shutdown.',xy,resetReactor);
register('radiator.configure','setRadiator','Enable or isolate passive reactor cooling.',{...xy,enabled},setRadiator);
register('climate.configure','setClimate','Set a climate target and enabled state.',{...xy,target:{type:'number',minimum:-20,maximum:35},enabled},setClimate);
register('depot.accept','setDepotAccepted','Change a depot filter without deleting stored supplies.',{...xy,resource:enumeration(RESOURCES),enabled},setDepotAccepted);
register('depot.priority','setDepotPriority','Set delivery priority for a depot.',{...xy,priority},setDepotPriority);
register('production.order','setProductionOrder','Set continuous production, fixed batches or a stock target.',{...xy,mode:enumeration(['continuous','batches','stock']),limit:integer(0,1000)},setProductionOrder);
register('production.priority','setProductionPriority','Set priority for workstation operators and input delivery.',{...xy,priority},setProductionPriority);
register('production.enable','setMachineEnabled','Pause or resume a machine while retaining its inputs and batch.',{...xy,enabled},setMachineEnabled);
register('maintenance.auto','setAutoService','Enable or disable automatic engineering service.',{...xy,enabled},setAutoService);
register('power.priority','setPowerPriority','Set circuit load priority.',{...xy,priority},setPowerPriority);
register('power.breaker','setBreaker','Configure a physical breaker contact; orientation and mode changes require an open contact.',{...xy,enabled,direction:enumeration(Object.keys(BREAKER_DIRECTIONS)),mode:enumeration(BREAKER_MODES)},setBreaker);
register('power.breaker.reset','resetBreaker','Reset an intact open breaker and leave its contact open.',xy,resetBreaker);
register('power.cable','setCableEnabled','Connect or isolate a cable segment.',{...xy,enabled},setCableEnabled);
register('crew.routine','setLifePolicy','Set balanced, work-focused or off-duty routine.',{crew,policy:enumeration(Object.keys(LIFE_POLICIES))},setLifePolicy);
register('fire.response','setFireResponse','Enable or disable automatic supplied fire-response orders. Existing orders remain.',{site,enabled},setFireResponse);
register('pasture.gate','setPastureGate','Latch a crew wicket to contain bristlebacks, or hold it open for animal passage.',{...xy,mode:enumeration(['latched','open'])},setPastureGate);
register('door.mode','setDoorMode','Set a pressure door to automatic, open or sealed.',{...xy,mode:enumeration(['auto','open','closed'])},setDoorMode);
register('crew.possessions.collect','setPossessionCollection','Allow or stop physical keepsake collection during downtime.',{crew,enabled},setPossessionCollection);
register('crew.possessions.release','releasePossession','Put the owned keepsake down at this crew member’s local position.',{crew},releasePossession);
register('husbandry.assign','setAnimalPost','Assign one bristleback to a reachable post, or release it with null coordinates.',{creature:{type:'string',entityType:'creature'},x:{type:['integer','null'],minimum:0,maximum:25},y:{type:['integer','null'],minimum:0,maximum:25}},sim.setAnimalPost);
register('husbandry.transport','transportAnimalToPost','Send a handler to physically escort a tame animal to a post.',{creature:{type:'string',entityType:'creature'},x:integer(0,25),y:integer(0,25)},sim.transportAnimalToPost);
register('husbandry.breed','setBreeding','Allow or stop new brood pairing. Existing broods continue when conditions permit.',{creature:{type:'string',entityType:'creature'},enabled},setBreeding);
register('husbandry.policy','setAnimalPolicy','Enable or pause automatic feeding/handling or curd collection.',{creature:{type:'string',entityType:'creature'},policy:enumeration(['care','harvest']),enabled},sim.setAnimalPolicy);
register('simulation.step','step','Advance 1–300 deterministic simulation ticks.',{ticks:integer(1,300)},(s,ticks)=>{sim.step(s,ticks);return {ok:true};});

export function actionCatalog() {return JSON.parse(JSON.stringify(entries.map(({run,binding,parameters,...entry})=>({...entry,parameters:{type:'object',properties:parameters,required:Object.keys(parameters).filter(k=>!parameters[k].optional),additionalProperties:false}}))));}
function invalidValue(s,v,schema,key) {
  if(v===undefined&&schema.optional)return null;
  const types=[schema.type].flat();
  if(!types.some(type=>type==='null'?v===null:type==='array'?Array.isArray(v):type==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):type==='integer'?Number.isInteger(v):type==='number'?Number.isFinite(v):typeof v===type))return `Invalid ${key}.`;
  if(schema.enum&&!schema.enum.includes(v))return `Unsupported ${key}.`;
  if(v!==null&&((schema.minimum!==undefined&&v<schema.minimum)||(schema.maximum!==undefined&&v>schema.maximum)))return `${key} out of range.`;
  if(v!==null&&((schema.exclusiveMinimum!==undefined&&v<=schema.exclusiveMinimum)||(schema.exclusiveMaximum!==undefined&&v>=schema.exclusiveMaximum)))return `${key} out of range.`;
  if(Array.isArray(v)) {
    if((schema.minItems!==undefined&&v.length<schema.minItems)||(schema.maxItems!==undefined&&v.length>schema.maxItems))return `Invalid ${key} length.`;
    if(schema.uniqueItems&&new Set(v.map(item=>JSON.stringify(item))).size!==v.length)return `Duplicate ${key} items.`;
    if(schema.items)for(let i=0;i<v.length;i++){const error=invalidValue(s,v[i],schema.items,`${key}[${i}]`);if(error)return error;}
  }
  if(v!==null&&typeof v==='object'&&!Array.isArray(v)&&schema.properties) {
    if(Object.getPrototypeOf(v)!==Object.prototype)return `Invalid ${key} object.`;
    const keys=Object.keys(v);
    if((schema.minProperties!==undefined&&keys.length<schema.minProperties)||(schema.maxProperties!==undefined&&keys.length>schema.maxProperties))return `Invalid ${key} size.`;
    if(schema.additionalProperties===false&&keys.some(name=>!Object.hasOwn(schema.properties,name)))return `Unknown ${key} field.`;
    for(const name of schema.required||[])if(!Object.hasOwn(v,name))return `Missing ${key}.${name}.`;
    for(const name of keys)if(Object.hasOwn(schema.properties,name)) {
      const error=invalidValue(s,v[name],schema.properties[name],`${key}.${name}`);if(error)return error;
    }
  }
  if(v!==null&&schema.entityType==='crew'&&!s.crew.some(c=>c.id===v))return 'Unknown crew member.';
  if(schema.entityType==='creature'&&!s.creatures.some(c=>c.id===v))return 'Unknown creature.';
  if(schema.entityType==='job'&&!s.jobs.some(j=>j.id===v))return 'Unknown job.';
  return null;
}
function invalid(s,definition,args) {
  if(!args||typeof args!=='object'||Array.isArray(args))return 'Arguments must be an object.';
  if(Object.keys(args).some(k=>!Object.hasOwn(definition.parameters,k)))return 'Unknown argument.';
  for(const [key,schema] of Object.entries(definition.parameters)) {
    const error=invalidValue(s,args[key],schema,key);if(error)return error;
  }
  if(Object.hasOwn(args,'x')&&args.x!==null&&args.y!==undefined&&args.y!==null) {
    const current=s.sites[args.site || 'surface'];if(!current||!sim.inside(current,args.x,args.y))return 'Tile is outside this site.';
  }
  if(definition.id==='job.order') {
    if(args.kind==='build'&&!Object.hasOwn(BUILDINGS,args.building))return 'Unknown building.';
    if(args.kind==='refit'&&!Object.hasOwn(SHUTTLE_FITS,args.building))return 'Unknown shuttle fit.';
    if(['treat','feed','hygiene'].includes(args.kind)&&!s.crew.some(c=>c.id===args.building))return 'Unknown patient.';
  }
  if(definition.id==='power.discharge_cell' && ((args.x==null)!==(args.y==null)))return 'Provide both bank coordinates, or neither.';
  return null;
}
export function executeAction(s,id,args={},source='agent') {
  // Reject non-JSON/cyclic/oversized requests before recording or touching game state.
  let request;try{const text=JSON.stringify(args);if(!text||text.length>8192)throw new Error();request=JSON.parse(text);}catch{return {ok:false,message:'Arguments must be small JSON data.'};}
  const definition=entries.find(e=>e.id===id);
  if(typeof id!=='string'||id.length>100||!['player','agent','test'].includes(source))return {ok:false,message:'Invalid action identity or source.'};
  beginAction(s,id,request,source);
  // Validate caller fields before JSON cloning can discard an undefined
  // unknown key or coerce a non-finite resource quantity to null.
  const error=definition?invalid(s,definition,args):'Unknown action.';
  let result;
  if(error)result={ok:false,message:error};
  else { try { const output=definition.run(s,...Object.keys(definition.parameters).map(k=>request[k]));result=output?.ok===undefined?{ok:true}:output; } catch(error) { endAction(s,{ok:false,message:error.message,exception:true});throw error; } }
  const response={...result,...(!error&&!result.ok&&typeof result.code==='string'?{reason:result.code}:{}),code:error?(definition?'invalid_arguments':'unknown_action'):result.ok?'applied':'simulation_rejected',...(result.job?{job:result.job.id}:{})};
  endAction(s,response);return response;
}
// UI and agents use the same dispatcher and validators; internal autonomous jobs stay simulation-owned.
export function controlBindings(getState,source='player') {
  return Object.fromEntries(entries.filter(e=>e.binding!=='step').map(e=>[e.binding,(_state,...values)=>executeAction(getState(),e.id,Object.fromEntries(Object.keys(e.parameters).map((k,i)=>[k,values[i]]).filter(([,v])=>v!==undefined)),source)]));
}
export function createAgentInterface(getState,beforeAction=()=>{},afterAction=()=>{}) {
  return Object.freeze({version:1,definitions:()=>JSON.parse(JSON.stringify({gasNetworks:GAS_NETWORK,gasDirections:GAS_DIRECTIONS,plumbing:PLUMBING,waterDirections:WATER_DIRECTIONS,breakerDirections:BREAKER_DIRECTIONS,breakerModes:BREAKER_MODES,liquids:LIQUID,reactor:REACTOR,fire:FIRE,animalTransport:{work:TRANSPORT_WORK,stepInterval:TRANSPORT_STEP,tameOnly:true},breeding:BREEDING,buildings:BUILDINGS,recipes:RECIPES,resources:RESOURCES,shuttleFits:SHUTTLE_FITS,outposts:{sites:OUTPOST_SITES,commissioningReserves:OUTPOST_RESERVES},itemStyles:ITEM_STYLES,extraction:{ice:{capacity:ICE_SEAM_CAPACITY,perOrder:ICE_EXTRACTION_AMOUNT}}})),actions:actionCatalog,observe:()=>observe(getState()),act:(id,args={})=>{beforeAction();try{return executeAction(getState(),id,args,'agent');}finally{afterAction();}},recording:Object.freeze({status:()=>recordingStatus(getState()),start:options=>startRecording(getState(),options),stop:()=>stopRecording(getState()),export:()=>exportRecording(getState())})});
}
