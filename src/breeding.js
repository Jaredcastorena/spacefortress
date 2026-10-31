import { positionOf, cellKey, sameCell, horizontalNeighbors, tileAt } from './spatial.js';
import { animalActivityAllowed, initializeAnimalCondition } from './animal-health.js';
import { isLivestock, livestockDef } from './livestock-data.js';
import { distance } from './geometry.js';
import { pastureRegions, moveAnimal } from './pastures.js';
import { animalPathToPosition as animalPath } from './navigation.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { animalTraits, inheritGenome, neutralGenome } from './animal-traits.js';
export const BREEDING={maturity:600,gestation:300,cooldown:600,tilesPerAnimal:6,herdLimit:24,creatureReserve:88};
export const adult=a=>!a.lifecycle||a.lifecycle.growth>=(livestockDef(a)?.maturity??BREEDING.maturity);
export const newLifecycle=(born=null,parents=[],species='bristleback')=>({born,parents,growth:born===null?livestockDef(species).maturity:0,enabled:false,cooldown:0,brood:null});
export function initializeBreeding(s){for(const a of s.creatures)if(isLivestock(a))a.lifecycle??=newLifecycle(null,[],a.species);}
const herd=s=>s.creatures.filter(a=>isLivestock(a));
const adjacent=(a,b)=>a.site===b.site&&positionOf(a).z===positionOf(b).z&&distance([a.x,a.y],[b.x,b.y])<=1;
const regionFor=(s,a,regions)=>a.site===regions.site?regions.byCell.get(cellKey(positionOf(a))):null;
const busy=(s,a)=>s.jobs.some(j=>j.animal===a.id);
function related(a,b){return a.lifecycle.parents.includes(b.id)||b.lifecycle.parents.includes(a.id)||a.lifecycle.parents.some(id=>b.lifecycle.parents.includes(id));}
function capacity(s,r,regions,additional=1){
 const animals=herd(s).filter(a=>a.health>0),pending=animals.filter(a=>a.lifecycle.brood).length;
 if(animals.length+pending+additional>BREEDING.herdLimit||s.creatures.length+pending+additional>BREEDING.creatureReserve)return 'herd_limit';
 const local=animals.filter(a=>regionFor(s,a,regions)===r);
 return local.reduce((n,a)=>n+livestockDef(a).tilesPerAnimal*(a.lifecycle.brood?2:1),additional*BREEDING.tilesPerAnimal)>r.cells.length?'pasture_crowded':null;
}
function ready(s,a,r,regions){
 const l=a.lifecycle;
 if(a.health<=0)return 'dead';if(!animalActivityAllowed(a))return a.condition.injury>1e-8?'injured':'thermal_stress';if(!adult(a))return a.fed<40||a.health<40?'growth_condition_low':'juvenile';if(!l.enabled)return 'disabled';if(l.brood)return 'carrying_brood';if(l.cooldown)return 'cooldown';
 if(a.husbandry.trust<100)return 'untamed';if(a.fed<70||a.health<70)return 'condition_low';if(!r?.enclosed)return 'open_range';if(busy(s,a))return 'handler_work';
 return capacity(s,r,regions);
}
function broodBlock(s,a,r,regions){
 if(!r?.enclosed)return 'open_range';if(!animalActivityAllowed(a))return a.condition.injury>1e-8?'injured':'thermal_stress';if(a.fed<50||a.health<50)return 'condition_low';return capacity(s,r,regions,0);
}
function birthTile(s,a,r,regions){
 const site=s.sites[a.site];
 return horizontalNeighbors(positionOf(a)).find(p=>{
  const t=tileAt(site,p),occupied=o=>o.site===a.site&&sameCell(positionOf(o),p);
  return t&&['ground','floor'].includes(t.terrain)&&!t.building&&regions.byCell.get(cellKey(p))===r&&!s.creatures.some(o=>o.health>0&&occupied(o))&&!s.crew.some(c=>c.health>0&&occupied(c))&&!s.jobs.some(occupied);
 });
}
export function breedingStatus(s,a,regions=pastureRegions(s.sites[a.site])){
 const l=a.lifecycle;if(!l)return null;const r=regionFor(s,a,regions);
 if(a.health<=0)return {phase:'dead',reason:'dead',mate:null};
 if(l.brood)return {phase:'brooding',reason:broodBlock(s,a,r,regions)||(l.brood.progress===livestockDef(a).gestation&&!birthTile(s,a,r,regions)?'birth_tile_blocked':null),mate:l.brood.mate};
 const reason=ready(s,a,r,regions);if(reason)return {phase:adult(a)?'adult':'juvenile',reason,mate:null};
 const mate=herd(s).find(b=>b!==a&&b.species===a.species&&!related(a,b)&&regionFor(s,b,regions)===r&&!ready(s,b,r,regions));
 return {phase:mate?'courtship':'adult',reason:mate?null:'no_compatible_mate',mate:mate?.id||null};
}
export function setBreeding(s,id,enabled){
 const a=herd(s).find(a=>a.id===id&&a.health>0);if(!a||typeof enabled!=='boolean')return {ok:false,message:'Choose living livestock.'};
 const previous=a.lifecycle.enabled;a.lifecycle.enabled=enabled;
 if(previous!==enabled)emitEvent(s,'animal.breeding.policy',{entity:id,enabled});return {ok:true};
}
export function updateBreeding(s,positions=new Map()){
 const regionsBySite=new Map(),local=a=>{if(!regionsBySite.has(a.site))regionsBySite.set(a.site,pastureRegions(s.sites[a.site]));return regionsBySite.get(a.site);},animals=herd(s);
 for(const a of animals){const regions=local(a),l=a.lifecycle,def=livestockDef(a);
  if(a.health<=0){if(l.brood){emitEvent(s,'animal.brood.lost',{entity:a.id,brood:l.brood.id,mate:l.brood.mate,reason:'parent_died'});l.brood=null;}continue;}
  if(l.cooldown>0)l.cooldown--;
  if(!adult(a)&&animalActivityAllowed(a)&&a.fed>=40&&a.health>=40){l.growth++;if(adult(a))emitEvent(s,'animal.matured',{entity:a.id,parents:l.parents});}
  if(!l.brood)continue;
  const r=regionFor(s,a,regions);if(broodBlock(s,a,r,regions))continue;
  if(l.brood.progress<def.gestation){l.brood.progress++;a.fed=Math.max(0,a.fed-.02);}
  if(l.brood.progress<def.gestation)continue;
  const tile=birthTile(s,a,r,regions);if(!tile)continue;
  let childId;do{childId=`${a.species}-${s.nextId++}`;}while(s.creatures.some(a=>a.id===childId));
  const mate=l.brood.mate,brood=l.brood.id,inheritance=structuredClone(l.brood.inheritance),child={id:childId,species:a.species,site:a.site,...tile,health:100,fed:40,age:0,death:null,genetics:structuredClone(inheritance.child),husbandry:{post:null,trust:40,product:0,care:true,harvest:true,retryAt:0,blocked:null},lifecycle:newLifecycle(s.tick,[a.id,mate],a.species)};
  initializeAnimalCondition(child);s.creatures.push(child);a.fed=Math.max(0,a.fed-20);l.brood=null;l.cooldown=def.cooldown;
  emitEvent(s,'animal.born',{entity:child.id,species:child.species,brood,parents:[...child.lifecycle.parents],target:tileEntityId(a.site,tile.x,tile.y,tile.z),carrier:a.id,inheritance,genetics:structuredClone(child.genetics),profile:animalTraits(child)});
  emitEvent(s,'animal.traits.inherited',{entity:child.id,brood,parents:[...child.lifecycle.parents],carrier:a.id,genetics:structuredClone(child.genetics),profile:animalTraits(child)});
  s.log.unshift({tick:s.tick,message:`A ${def.name.toLowerCase()} hatchling emerged beside ${a.id}. It needs ${def.grazesLichen?'grazing':'delivered fungal caps'} and handling before adulthood.`,type:'good'});s.log=s.log.slice(0,60);
 }
 const paired=new Set();
 for(const a of animals){const regions=local(a),r=regionFor(s,a,regions);if(paired.has(a.id)||ready(s,a,r,regions))continue;
  const b=animals.find(b=>b!==a&&b.species===a.species&&!paired.has(b.id)&&!related(a,b)&&regionFor(s,b,regions)===r&&!ready(s,b,r,regions));if(!b)continue;
  paired.add(a.id);paired.add(b.id);
  if(!adjacent(a,b)){
   const before=positions.get(a.id);if(s.tick%3===0&&(!before||sameCell(Array.isArray(before)?{x:before[0],y:before[1],z:0}:before,positionOf(a)))){const route=animalPath(s.sites[a.site],{...a,...positionOf(a)},horizontalNeighbors(positionOf(b)));if(route?.length)moveAnimal(s,a,route[0],'courtship');}
   continue;
  }
  const broodId=`brood-${s.nextId++}`,inheritance={parents:[a,b].map(parent=>({id:parent.id,genetics:structuredClone(parent.genetics??neutralGenome())})),child:inheritGenome(s.seed,a,b,broodId)};
  a.fed-=10;b.fed-=10;a.lifecycle.brood={id:broodId,mate:b.id,started:s.tick,progress:0,inheritance};a.lifecycle.cooldown=livestockDef(a).cooldown;b.lifecycle.cooldown=livestockDef(b).cooldown;
  emitEvent(s,'animal.brood.started',{entity:a.id,brood:broodId,mate:b.id,region:r.id,nutritionCostPerParent:10,inheritance:structuredClone(inheritance),genetics:structuredClone(inheritance.child),profile:animalTraits({...a,genetics:inheritance.child})});
 }
}
export function validateBreeding(s){
 const broods=new Set(),animals=herd(s),byId=new Map(animals.map(a=>[a.id,a]));
 const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 for(const a of animals){const l=a.lifecycle,def=livestockDef(a);
  if(!l||typeof l.enabled!=='boolean'||!integer(l.growth,def.maturity)||!integer(l.cooldown,def.cooldown)||!Array.isArray(l.parents)||!(l.born===null?l.parents.length===0&&adult(a):integer(l.born,s.tick)&&l.parents.length===2&&l.parents[0]!==l.parents[1]&&integer(a.age,s.tick-l.born)&&l.growth<=a.age))throw new Error('Invalid animal lifecycle.');
  if(l.born!==null&&(!a.id.startsWith(`${a.species}-`)||!/^\d+$/.test(a.id.slice(a.species.length+1))||Number(a.id.slice(a.species.length+1))>=s.nextId))throw new Error('Invalid offspring identity.');
  for(const id of l.parents){const p=byId.get(id);if(!p||p.site!==a.site||p.species!==a.species||p===a||(p.lifecycle?.born!==null&&p.lifecycle?.born>=l.born))throw new Error('Invalid animal parentage.');}
  if(!adult(a)&&a.husbandry.product!==0)throw new Error('Juvenile animal cannot produce food.');
  if(l.brood!==null){const b=l.brood,mate=byId.get(b?.mate);if(!b||!/^brood-\d+$/.test(b.id)||Number(b.id.slice(6))>=s.nextId||broods.has(b.id)||!adult(a)||a.health<=0||!mate||mate.site!==a.site||mate.species!==a.species||mate===a||!adult(mate)||related(a,mate)||!integer(b.started,s.tick)||(l.born!==null&&b.started<l.born+def.maturity)||(mate.lifecycle.born!==null&&b.started<mate.lifecycle.born+livestockDef(mate).maturity)||!integer(b.progress,def.gestation)||b.progress>s.tick-b.started)throw new Error('Invalid animal brood.');broods.add(b.id);}
 }
}
