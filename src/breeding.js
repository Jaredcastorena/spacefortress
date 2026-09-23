import { pastureRegions, moveAnimal } from './pastures.js';
import { animalPath } from './navigation.js';
import { emitEvent, tileEntityId } from './telemetry.js';
export const BREEDING={maturity:600,gestation:300,cooldown:600,tilesPerAnimal:6,herdLimit:24,creatureReserve:88};
export const adult=a=>!a.lifecycle||a.lifecycle.growth>=BREEDING.maturity;
export const newLifecycle=(born=null,parents=[])=>({born,parents,growth:born===null?BREEDING.maturity:0,enabled:false,cooldown:0,brood:null});
export function initializeBreeding(s){for(const a of s.creatures)if(a.species==='bristleback')a.lifecycle??=newLifecycle();}
const herd=s=>s.creatures.filter(a=>a.species==='bristleback');
const adjacent=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y)<=1;
const neighbors=a=>[[a.x+1,a.y],[a.x-1,a.y],[a.x,a.y+1],[a.x,a.y-1]];
const regionFor=(s,a,regions)=>regions.byCell.get(a.y*s.sites.surface.size+a.x);
const busy=(s,a)=>s.jobs.some(j=>j.animal===a.id);
function related(a,b){return a.lifecycle.parents.includes(b.id)||b.lifecycle.parents.includes(a.id)||a.lifecycle.parents.some(id=>b.lifecycle.parents.includes(id));}
function capacity(s,r,regions,additional=1){
 const animals=herd(s).filter(a=>a.health>0),pending=animals.filter(a=>a.lifecycle.brood).length;
 if(animals.length+pending+additional>BREEDING.herdLimit||s.creatures.length+pending+additional>BREEDING.creatureReserve)return 'herd_limit';
 const local=animals.filter(a=>regionFor(s,a,regions)===r);
 return (local.length+local.filter(a=>a.lifecycle.brood).length+additional)*BREEDING.tilesPerAnimal>r.cells.length?'pasture_crowded':null;
}
function ready(s,a,r,regions){
 const l=a.lifecycle;
 if(a.health<=0)return 'dead';if(!adult(a))return a.fed<40||a.health<40?'growth_condition_low':'juvenile';if(!l.enabled)return 'disabled';if(l.brood)return 'carrying_brood';if(l.cooldown)return 'cooldown';
 if(a.husbandry.trust<100)return 'untamed';if(a.fed<70||a.health<70)return 'condition_low';if(!r?.enclosed)return 'open_range';if(busy(s,a))return 'handler_work';
 return capacity(s,r,regions);
}
function broodBlock(s,a,r,regions){
 if(!r?.enclosed)return 'open_range';if(a.fed<50||a.health<50)return 'condition_low';return capacity(s,r,regions,0);
}
function birthTile(s,a,r,regions){
 const site=s.sites.surface;
 return neighbors(a).find(([x,y])=>{
  const t=x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
  return t&&t.terrain==='ground'&&!t.building&&regions.byCell.get(y*site.size+x)===r&&!s.creatures.some(o=>o.health>0&&o.x===x&&o.y===y)&&!s.crew.some(c=>c.health>0&&c.site==='surface'&&c.x===x&&c.y===y)&&!s.jobs.some(j=>j.site==='surface'&&j.x===x&&j.y===y);
 });
}
export function breedingStatus(s,a,regions=pastureRegions(s.sites.surface)){
 const l=a.lifecycle;if(!l)return null;const r=regionFor(s,a,regions);
 if(a.health<=0)return {phase:'dead',reason:'dead',mate:null};
 if(l.brood)return {phase:'brooding',reason:broodBlock(s,a,r,regions)||(l.brood.progress===BREEDING.gestation&&!birthTile(s,a,r,regions)?'birth_tile_blocked':null),mate:l.brood.mate};
 const reason=ready(s,a,r,regions);if(reason)return {phase:adult(a)?'adult':'juvenile',reason,mate:null};
 const mate=herd(s).find(b=>b!==a&&!related(a,b)&&regionFor(s,b,regions)===r&&!ready(s,b,r,regions));
 return {phase:mate?'courtship':'adult',reason:mate?null:'no_compatible_mate',mate:mate?.id||null};
}
export function setBreeding(s,id,enabled){
 const a=herd(s).find(a=>a.id===id&&a.health>0);if(!a||typeof enabled!=='boolean')return {ok:false,message:'Choose a living bristleback.'};
 const previous=a.lifecycle.enabled;a.lifecycle.enabled=enabled;
 if(previous!==enabled)emitEvent(s,'animal.breeding.policy',{entity:id,enabled});return {ok:true};
}
export function updateBreeding(s,positions=new Map()){
 const regions=pastureRegions(s.sites.surface),animals=herd(s);
 for(const a of animals){const l=a.lifecycle;
  if(a.health<=0){if(l.brood){emitEvent(s,'animal.brood.lost',{entity:a.id,brood:l.brood.id,mate:l.brood.mate,reason:'parent_died'});l.brood=null;}continue;}
  if(l.cooldown>0)l.cooldown--;
  if(!adult(a)&&a.fed>=40&&a.health>=40){l.growth++;if(adult(a))emitEvent(s,'animal.matured',{entity:a.id,parents:l.parents});}
  if(!l.brood)continue;
  const r=regionFor(s,a,regions);if(broodBlock(s,a,r,regions))continue;
  if(l.brood.progress<BREEDING.gestation){l.brood.progress++;a.fed=Math.max(0,a.fed-.02);}
  if(l.brood.progress<BREEDING.gestation)continue;
  const tile=birthTile(s,a,r,regions);if(!tile)continue;
  let childId;do{childId=`bristleback-${s.nextId++}`;}while(s.creatures.some(a=>a.id===childId));
  const mate=l.brood.mate,brood=l.brood.id,child={id:childId,species:'bristleback',site:'surface',x:tile[0],y:tile[1],health:100,fed:40,age:0,husbandry:{post:null,trust:40,product:0,care:true,harvest:true,retryAt:0,blocked:null},lifecycle:newLifecycle(s.tick,[a.id,mate])};
  s.creatures.push(child);a.fed=Math.max(0,a.fed-20);l.brood=null;l.cooldown=BREEDING.cooldown;
  emitEvent(s,'animal.born',{entity:child.id,brood,parents:child.lifecycle.parents,target:tileEntityId('surface',...tile),carrier:a.id});
  s.log.unshift({tick:s.tick,message:`A bristleback hatchling emerged beside ${a.id}. It needs grazing and handling before adulthood.`,type:'good'});s.log=s.log.slice(0,60);
 }
 const paired=new Set();
 for(const a of animals){const r=regionFor(s,a,regions);if(paired.has(a.id)||ready(s,a,r,regions))continue;
  const b=animals.find(b=>b!==a&&!paired.has(b.id)&&!related(a,b)&&regionFor(s,b,regions)===r&&!ready(s,b,r,regions));if(!b)continue;
  paired.add(a.id);paired.add(b.id);
  if(!adjacent(a,b)){
   const before=positions.get(a.id);if(s.tick%3===0&&(!before||before[0]===a.x&&before[1]===a.y)){const route=animalPath(s.sites.surface,a,neighbors(b));if(route?.length)moveAnimal(s,a,route[0],'courtship');}
   continue;
  }
  a.fed-=10;b.fed-=10;a.lifecycle.brood={id:`brood-${s.nextId++}`,mate:b.id,started:s.tick,progress:0};a.lifecycle.cooldown=b.lifecycle.cooldown=BREEDING.cooldown;
  emitEvent(s,'animal.brood.started',{entity:a.id,brood:a.lifecycle.brood.id,mate:b.id,region:r.id,nutritionCostPerParent:10});
 }
}
export function validateBreeding(s){
 const broods=new Set(),animals=herd(s),byId=new Map(animals.map(a=>[a.id,a]));
 const integer=(n,max)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
 for(const a of animals){const l=a.lifecycle;
  if(!l||typeof l.enabled!=='boolean'||!integer(l.growth,BREEDING.maturity)||!integer(l.cooldown,BREEDING.cooldown)||!Array.isArray(l.parents)||!(l.born===null?l.parents.length===0&&adult(a):integer(l.born,s.tick)&&l.parents.length===2&&l.parents[0]!==l.parents[1]&&integer(a.age,s.tick-l.born)&&l.growth<=a.age))throw new Error('Invalid animal lifecycle.');
  if(l.born!==null&&(!/^bristleback-\d+$/.test(a.id)||Number(a.id.slice(12))>=s.nextId))throw new Error('Invalid offspring identity.');
  for(const id of l.parents){const p=byId.get(id);if(!p||p===a||(p.lifecycle?.born!==null&&p.lifecycle?.born>=l.born))throw new Error('Invalid animal parentage.');}
  if(!adult(a)&&a.husbandry.product!==0)throw new Error('Juvenile animal cannot produce curd.');
  if(l.brood!==null){const b=l.brood,mate=byId.get(b?.mate);if(!b||!/^brood-\d+$/.test(b.id)||Number(b.id.slice(6))>=s.nextId||broods.has(b.id)||!adult(a)||a.health<=0||!mate||mate===a||!adult(mate)||related(a,mate)||!integer(b.started,s.tick)||(l.born!==null&&b.started<l.born+BREEDING.maturity)||(mate.lifecycle.born!==null&&b.started<mate.lifecycle.born+BREEDING.maturity)||!integer(b.progress,BREEDING.gestation)||b.progress>s.tick-b.started)throw new Error('Invalid animal brood.');broods.add(b.id);}
 }
}
