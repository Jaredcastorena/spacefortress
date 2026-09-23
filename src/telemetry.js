import { expeditionCrewStatus, expeditionCandidates, expeditionLaunchBlock } from './expedition-readiness.js';
import { departureReadiness } from './preflight.js';
import { plumbingStatus } from './plumbing.js';
import { breakerConditions } from './power.js';
import { gasStatus } from './gas-networks.js';
import { reactorTemperature, radiatorTargets, radiatorBlock } from './reactors.js';
import { transportStatus } from './animal-transport.js';
import { breedingStatus } from './breeding.js';
import { pastureRegions, animalPasture } from './pastures.js';
import { husbandryStatus } from './husbandry.js';
import { pathTo } from './simulation.js';
import { foodLots } from './food-lots.js';
import { waterSupply } from './water.js';
import { itemOwners } from './item-lots.js';
import { roomComfort } from './comfort.js';
import { roomStatus } from './rooms.js';
import { roomAt, breathable } from './atmosphere.js';
import { temperature } from './thermal.js';
// Local, opt-in recordings. WeakMap ownership keeps instrumentation out of game saves/RNG.
export const TELEMETRY_VERSION = 1;
const sessions = new WeakMap();
const clone = value => JSON.parse(JSON.stringify(value));
export const tileEntityId = (site,x,y) => `tile:${site}:${x}:${y}`;
export function observe(s) {
  const {sites,crew,jobs,creatures,...colony}=s;
  const selectedCrewIds=[...(s.departure?.crew||s.mission?.crew||[])],destination=s.departure?.site||s.mission?.site||null;
  const expedition={selectedCrewIds,destination:destination?`site:${destination}`:null,phase:s.departure?.stage||s.mission?.phase||'idle',preparing:!!s.departure,remaining:s.mission?.remaining||0,candidates:expeditionCandidates(s),departure:departureReadiness(s)};
  const entities={colony:{type:'colony',...colony,derived:{...(colony.derived||{}),expedition}}};
  for(const site of Object.values(sites)) {
    const {tiles,rooms,...environment}=site;
    const launchBlocked=expeditionLaunchBlock(s,site.id);
    // Destination gates are distinct from selected-crew, supplies and route readiness.
    entities[`site:${site.id}`]={type:'site',...environment,waterSupply:waterSupply(s,site.id),derived:{...(environment.derived||{}),expedition:{selected:destination===site.id,launchBlocked}}};
    for(const t of tiles) {
      const gas=(t.pipe||t.gasStore||t.gasDevice)?gasStatus(site,t):null;
      const plumbing=(t.waterPipe||t.waterStore||t.waterDevice)?plumbingStatus(s,site,t):null;
      const electrical=t.protection?breakerConditions(s,site,t):null;
      const previousDerived=t.reactor?{reactorTemperature:reactorTemperature(site,t),...(gas?{gasNetwork:gas}:{})}:t.radiator?{blocked:radiatorBlock(site,t),targets:radiatorTargets(site,t).map(r=>tileEntityId(site.id,r.x,r.y)),...(gas?{gasNetwork:gas}:{})}:gas;
      // Preserve established reactor/radiator and gas shapes. Independent
      // network diagnostics never overwrite another system's derived status.
      const derived=plumbing||electrical?{...previousDerived,...(plumbing?{plumbing}:{}),...(electrical?{electrical}:{})}:previousDerived;
      entities[tileEntityId(site.id,t.x,t.y)]={type:'tile',site:site.id,...t,...(derived?{derived}:{})};
    }
    for(const r of rooms) {
      const anchor=[...r.cells].sort((a,b)=>{const [ax,ay]=a.split(',').map(Number),[bx,by]=b.split(',').map(Number);return ay-by||ax-bx;})[0];
      entities[`room:${site.id}:${anchor}`]={type:'room',site:site.id,...r,derived:{purpose:roomStatus(s,site,r),comfort:roomComfort(s,site,r),temperature:temperature(r),breathable:breathable(r)}};
    }
  }
  for(const site of Object.values(sites))for(const t of site.tiles)if(t.fire)entities[t.fire.id]={type:'fire',...t.fire,tile:tileEntityId(site.id,t.x,t.y)};
  for(const c of crew) {const site=sites[c.site];entities[c.id]={type:'crew',...c,derived:{expedition:{...expeditionCrewStatus(c),selected:selectedCrewIds.includes(c.id)},currentComfort:site?roomComfort(s,site,roomAt(site,c.x,c.y),c):null,homeComfort:c.housing.bunk?roomComfort(s,sites.surface,roomAt(sites.surface,...c.housing.bunk),c):null}};}
  for(const j of jobs) entities[j.id]={type:'job',...j};
  const pastures=pastureRegions(sites.surface);
  for(const r of pastures.regions)if(r.enclosed)entities[r.id]={type:'pasture',site:'surface',...r};
  for(const c of creatures) entities[c.id]={type:'creature',...c,...(c.husbandry?{derived:{husbandryStatus:husbandryStatus(s,c,pathTo),pasture:animalPasture(s,c,pastures),breeding:breedingStatus(s,c,pastures),transport:transportStatus(s,c)}}:{})};
  for(const c of creatures)if(c.lifecycle?.brood){const brood=c.lifecycle.brood;entities[brood.id]={type:'brood',...brood,carrier:c.id};}
  for(const owner of itemOwners(s))for(const item of owner.inventory._items||[])entities[item.id]={type:'item',...item,location:owner.location};
  // A prepared batch can be split among several inventories and opened rations.
  const mealOwners=itemOwners(s);
  for(const c of crew){if(c.medical.openedFood)mealOwners.push({inventory:c.medical.openedFood,location:{entity:c.id,slot:'medical.openedFood'}});if(c.intent?.type==='meal'&&c.intent.openedFood)mealOwners.push({inventory:c.intent.openedFood,location:{entity:c.id,slot:'intent.openedFood'}});}
  for(const owner of mealOwners)for(const lot of foodLots(owner.inventory))if(lot.meal){const m=lot.meal;const entry=entities[m.id]??={type:'meal_batch',...m,locations:[],food:0};entry.locations.push({...owner.location,amount:lot.amount,age:lot.age});entry.food+=lot.amount;}
  return clone({schemaVersion:TELEMETRY_VERSION,tick:s.tick,entities});
}
export function systemFor(type,path) {
  const root=path[0];
  if(root==='derived')return 'derived_conditions';
  if(type==='item')return 'possessions';
  if(type==='fire')return 'fire';
  if(type==='brood')return 'breeding';
  if(type==='pasture')return 'pastures';
  if(type==='meal_batch')return 'food';
  if(type==='crew')return ({possessions:'possessions',memories:'memory',relationships:'relationships',housing:'housing',medical:'medicine',sanitation:'sanitation',life:'crew_life',intent:'intent',carry:'inventory',delivery:'logistics',skills:'skills',labors:'labor',thermalStress:'temperature',health:'health',oxygen:'atmosphere',energy:'needs',hunger:'needs',morale:'morale',x:'movement',y:'movement',site:'movement'})[root] || 'crew';
  if(type==='tile')return ({protection:'power',waterPipe:'plumbing',waterStore:'plumbing',waterDevice:'plumbing',pipe:'gas_networks',gasStore:'gas_networks',gasDevice:'gas_networks',liquid:'liquids',tank:'liquids',wetShort:'power',reactor:'power',radiator:'temperature',fire:'fire',fireFault:'fire',deposit:'geology',stock:'inventory',drop:'inventory',machine:'production',building:'construction',hp:'condition',cable:'power',charge:'power',powered:'power',powerPriority:'power',circuit:'power',powerStatus:'power',maintenance:'maintenance',sanitary:'sanitation',climate:'temperature',gateMode:'pastures',doorMode:'doors',doorUntil:'doors'})[root] || 'terrain';
  if(type==='room')return root==='smoke'?'fire':root==='heat'?'temperature':root==='cells'||root==='volume'?'room_topology':'atmosphere';
  if(type==='job')return 'jobs';
  if(type==='creature')return 'wildlife';
  return ({plumbing:'plumbing',gasNetwork:'gas_networks',liquids:'liquids',reactorLedger:'power',fireSafety:'fire',waterSupply:'water',mission:'expedition',departure:'departure',shuttle:'shuttle',resources:'inventory',anomaly:'anomaly',comet:'orbit',debris:'hazards',designations:'room_purpose',thermal:'temperature',power:'power',circuits:'power',energy:'power',atmosphere:'atmosphere',foodSpoiled:'food',log:'narrative',objectives:'objectives'})[root] || 'state';
}
export function changesBetween(before,after) {
  const changes=[];
  function walk(entity,type,a,b,path=[]) {
    if(JSON.stringify(a)===JSON.stringify(b))return;
    if(a && b && typeof a==='object' && typeof b==='object' && !Array.isArray(a) && !Array.isArray(b)) {
      for(const key of new Set([...Object.keys(a),...Object.keys(b)]))walk(entity,type,a[key],b[key],[...path,key]);
    } else changes.push({entity,system:systemFor(type,path),path,op:b===undefined?'remove':a===undefined?'add':'replace',...(a===undefined?{}:{previous:a}),...(b===undefined?{}:{value:b})});
  }
  for(const id of new Set([...Object.keys(before.entities),...Object.keys(after.entities)]))walk(id,after.entities[id]?.type||before.entities[id].type,before.entities[id],after.entities[id]);
  return changes;
}
export function startRecording(s,{maxRecords=2000,maxBytes=16_000_000}={}) {
  if(!Number.isInteger(maxRecords)||maxRecords<2||maxRecords>100000||!Number.isInteger(maxBytes)||maxBytes<1_000_000||maxBytes>128_000_000)throw new Error('Invalid recording limits.');
  const initial=observe(s),header={kind:'header',schemaVersion:TELEMETRY_VERSION,gameVersion:s.version,seed:s.seed,initialState:clone(s),observation:initial};
  const bytes=new TextEncoder().encode(JSON.stringify(header)).length;
  const session={header,last:initial,records:[],bytes,maxBytes,maxRecords,active:bytes<maxBytes,reason:bytes>=maxBytes?'byte_limit':null,command:null};
  sessions.set(s,session);return recordingStatus(s);
}
export function stopRecording(s) {const r=sessions.get(s);if(r){capture(s,'external');r.active=false;r.reason ||= 'stopped';}return recordingStatus(s);}
export function recordingStatus(s) {const r=sessions.get(s);return r?{active:r.active,records:r.records.length,bytes:r.bytes,reason:r.reason,maxRecords:r.maxRecords,maxBytes:r.maxBytes}:{active:false,records:0,bytes:0,reason:'not_started'};}
function append(s,record,after) {
  const r=sessions.get(s);if(!r?.active)return null;
  const entry={sequence:r.records.length+1,tick:s.tick,...record},bytes=new TextEncoder().encode(JSON.stringify(entry)).length;
  if(r.records.length>=r.maxRecords||r.bytes+bytes>r.maxBytes){r.active=false;r.reason=r.records.length>=r.maxRecords?'record_limit':'byte_limit';return null;}
  r.records.push(entry);r.bytes+=bytes;if(after)r.last=after;return entry.sequence;
}
export function emitItemMovement(s,inventory,actor,from,to) { for(const item of inventory?._items||[])emitEvent(s,'item.moved',{entity:item.id,actor,from,to}); }
export function emitEvent(s,id,details={}) { const r=sessions.get(s);if(r?.active)append(s,{kind:'event',command:r.command,event:{id,...clone(details)},changes:[]}); }
export function capture(s,kind='external',extra={}) {
  const r=sessions.get(s);if(!r?.active)return;
  const after=observe(s),changes=changesBetween(r.last,after);
  if(kind==='external'&&!changes.length)return;
  return append(s,{kind,fromTick:r.last.tick,command:r.command,...extra,changes},after);
}
export function beginAction(s,id,args,source) {
  const r=sessions.get(s);if(!r?.active)return;
  capture(s,'external');r.command=append(s,{kind:'action.requested',action:{id,args:clone(args),source},changes:[]});
}
export function endAction(s,result) {const r=sessions.get(s);if(!r)return;capture(s,'action.result',{result:clone(result)});r.command=null;}
export function exportRecording(s) {
  const r=sessions.get(s);if(!r)throw new Error('No recording has been started.');
  capture(s,'external');
  return [...[r.header],...r.records,{kind:'footer',schemaVersion:TELEMETRY_VERSION,...recordingStatus(s),throughTick:r.last.tick,lastSequence:r.records.length}].map(row=>JSON.stringify(row)).join('\n')+'\n';
}
