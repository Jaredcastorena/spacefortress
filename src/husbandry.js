import { distance } from './geometry.js';
import { transportFor, postReserved } from './animal-transport.js';
import { adult } from './breeding.js';
import { animalPath } from './navigation.js';
import { moveAnimal } from './pastures.js';
import { spill } from './inventory.js';
import { planFoodSelection, typedFood } from './food-lots.js';
import { isLivestock, livestockDef, VETERINARY } from './livestock-data.js';
import { animalActivityAllowed, animalHealthStatus, animalTreatmentValid, completeAnimalTreatment } from './animal-health.js';
import { emitEvent, tileEntityId } from './telemetry.js';
export const ANIMAL_JOBS = ['animalCare','animalHarvest','animalTreat'];
export const animalJob = j => ANIMAL_JOBS.includes(j.kind);
export function initializeHusbandry(s) {
  for(const c of s.crew){c.labors.husbandry??=true;c.skills.husbandry??={level:c.role==='Botanist'?2:0,xp:0};}
  for(const a of s.creatures)if(isLivestock(a))a.husbandry??={post:null,trust:0,product:0,care:true,harvest:true,retryAt:0,blocked:null};
}
const postTile=(s,a)=>a.husbandry.post?s.sites.surface.tiles[a.husbandry.post[1]*s.sites.surface.size+a.husbandry.post[0]]:null;
export const animalForJob=(s,j)=>s.creatures.find(a=>a.id===j.animal&&isLivestock(a)&&a.health>0&&a.husbandry.post?.[0]===j.x&&a.husbandry.post?.[1]===j.y);
export function animalJobValid(s,j) {
  if(j.kind==='animalTreat')return animalTreatmentValid(s,j);
  const a=animalForJob(s,j),t=a&&postTile(s,a);if(!a||t?.building!=='husbandryPost'||!t.hp)return false;
  return j.kind==='animalCare'?a.husbandry.care:j.kind==='animalHarvest'&&animalActivityAllowed(a)&&adult(a)&&a.husbandry.harvest&&a.husbandry.trust===100&&a.husbandry.product>=100&&a.fed>=40&&a.health>=40;
}
export function assignAnimal(s,id,x,y,pathTo,cancelJob) {
  const a=s.creatures.find(a=>a.id===id&&isLivestock(a)&&a.health>0);if(!a)return {ok:false,message:'Choose living livestock.'};
  if(x!==null||y!==null){const site=s.sites.surface;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=site.size||y>=site.size)return {ok:false,message:'Choose a husbandry post.'};const t=site.tiles[y*site.size+x];if(t.building!=='husbandryPost'||t.hp<=0)return {ok:false,message:'Choose a working husbandry post.'};if(postReserved(s,x,y,id))return {ok:false,message:'This post is reserved for transport.'};if(s.creatures.some(o=>o!==a&&o.health>0&&o.husbandry?.post?.[0]===x&&o.husbandry.post[1]===y))return {ok:false,message:'This post already has an animal.'};if(pathTo(site,a,[[x,y]])===null)return {ok:false,message:'The animal cannot reach this post.'};}
  for(const j of [...s.jobs])if(j.animal===id)cancelJob(s,j.id,true);
  a.husbandry.post=x===null?null:[x,y];a.husbandry.retryAt=0;a.husbandry.blocked=null;
  emitEvent(s,'animal.post.assigned',{entity:id,target:x===null?null:tileEntityId('surface',x,y)});return {ok:true};
}
export function animalPolicy(s,id,policy,enabled,cancelJob) {
  const a=s.creatures.find(a=>a.id===id&&isLivestock(a)&&a.health>0);if(!a||!['care','harvest'].includes(policy)||typeof enabled!=='boolean')return {ok:false,message:'Choose living livestock and care policy.'};
  a.husbandry[policy]=enabled;if(enabled)a.husbandry.retryAt=0;a.husbandry.blocked=null;
  for(const j of [...s.jobs])if(j.animal===id&&j.kind===(policy==='care'?'animalCare':'animalHarvest')&&!enabled)cancelJob(s,j.id,true);
  return {ok:true};
}
export function prepareHusbandry(s,order,cancelJob) {
  for(const a of s.creatures)if(a.husbandry?.post&&postTile(s,a)?.building!=='husbandryPost'){
    a.husbandry.post=null;emitEvent(s,'animal.post.lost',{entity:a.id});
  }
  for(const j of [...s.jobs])if(animalJob(j)&&!animalJobValid(s,j))cancelJob(s,j.id,true);
  for(const a of s.creatures)if(isLivestock(a)&&a.health>0&&a.husbandry.post){
    const h=a.husbandry,t=postTile(s,a);if(transportFor(s,a))continue;if(!t.hp||s.tick<h.retryAt)continue;
    const pending=s.jobs.filter(j=>j.site==='surface'&&j.x===t.x&&j.y===t.y),needsCare=h.care&&(h.trust<100||a.fed<((a.condition.injury>1e-8||a.condition.treated>1e-8)?60:40));
    const canFeed=pending.every(j=>j.kind==='animalTreat'&&j.animal===a.id);
    const kind=needsCare&&canFeed?'animalCare':!pending.length&&animalActivityAllowed(a)&&adult(a)&&h.harvest&&h.trust===100&&h.product>=100&&a.fed>=40&&a.health>=40?'animalHarvest':null;
    if(kind){const result=order(s,'surface',t.x,t.y,kind,a.id);h.blocked=result.ok?null:result.message;}else h.blocked=null;
  }
}
export function animalCareSupplied(s,j) {
  if(j.kind!=='animalCare')return true;
  const a=animalForJob(s,j),def=livestockDef(a);
  return !!def&&planFoodSelection(j.materials,def.careFood,def.feedKinds?{rawOnly:true,foodKinds:def.feedKinds}:false)!==null;
}
export function completeAnimalJob(s,c,j) {
  if(j.kind==='animalTreat')return completeAnimalTreatment(s,c,j);
  if(!animalJobValid(s,j))return false;
  const a=animalForJob(s,j);if(!a||!animalCareSupplied(s,j))return false;
  const h=a.husbandry,t=postTile(s,a),def=livestockDef(a);
  if(j.kind==='animalCare'){
    const wasTame=h.trust===100;a.fed=Math.min(100,a.fed+def.careNutrition);h.trust=Math.min(100,h.trust+def.careTrust);spill(t,{waste:def.careWaste});
    emitEvent(s,'animal.care.completed',{entity:a.id,actor:c.id,job:j.id,food:def.careFood,foodKinds:def.feedKinds,trust:h.trust,fed:a.fed});
    if(!wasTame&&h.trust===100)emitEvent(s,'animal.tamed',{entity:a.id,actor:c.id});
  }else{
    h.product=0;a.fed=Math.max(0,a.fed-def.harvestNutrition);spill(t,{...typedFood(def.productKind,def.productFood),waste:def.productWaste});
    emitEvent(s,'animal.harvested',{entity:a.id,actor:c.id,job:j.id,target:tileEntityId('surface',t.x,t.y),productKind:def.productKind,output:{food:def.productFood,waste:def.productWaste},foodKinds:{[def.productKind]:def.productFood}});
  }
  return true;
}
// Return true when an assigned animal uses its post route instead of wandering.
export function moveAssignedAnimal(s,a,pathTo,roamPasture=false) {
  if(transportFor(s,a))return false;
  const t=postTile(s,a);if(!t||t.building!=='husbandryPost'||t.hp<=0)return false;
  const working=s.jobs.some(j=>animalJob(j)&&j.animal===a.id)||a.condition.treated>1e-8;
  if(working||(!roamPasture&&distance([a.x,a.y],[t.x,t.y])>2)){
    if(s.tick%3===0){const route=pathTo(s.sites.surface,a,[[t.x,t.y]]);if(route?.length)moveAnimal(s,a,route[0],'post');}
    return true;
  }
  return false;
}
export function animalCondition(s,a) {
  if(a.health>0&&animalActivityAllowed(a)&&adult(a)&&a.husbandry.trust===100&&a.fed>=60&&a.health>=60){const before=a.husbandry.product;a.husbandry.product=Math.min(100,before+livestockDef(a).productRate);if(before<100&&a.husbandry.product===100)emitEvent(s,'animal.product.ready',{entity:a.id,productKind:livestockDef(a).productKind});}
}
export function husbandryStatus(s,a,_pathTo) {
  const h=a.husbandry;if(!h)return null;
  if(a.health<=0)return 'Deceased';const transport=transportFor(s,a);if(transport)return transport.blockedReason||(transport.phase==='escort'?'Being escorted to a post':'Handler collection designated');if(!h.post)return h.trust===100?'Tame; no post assigned':'Wild; no post assigned';const t=postTile(s,a);
  if(t?.building!=='husbandryPost')return 'Post lost';if(!t.hp)return 'Post damaged';if(animalPath(s.sites.surface,a,[h.post])===null)return 'Post route blocked';
  const job=s.jobs.find(j=>animalJob(j)&&j.animal===a.id);if(job)return job.blockedReason|| (job.kind==='animalCare'?'Care designated':job.kind==='animalTreat'?'Veterinary treatment designated':'Harvest designated');
  if(h.blocked)return h.blocked;
  const def=livestockDef(a),health=animalHealthStatus(s,a);
  if(!health.activityAllowed)return health.treated>1e-8?health.recoveryReason:health.injury>1e-8?'Needs veterinary treatment':'Thermal stress pauses production';
  if(!adult(a))return `Juvenile; growing before ${def.productName.toLowerCase()} production`;if(h.trust<100)return h.care?`Needs delivered ${def.feedName} and handling`:'Care paused';if(a.fed<60)return def.grazesLichen?'Needs grazing or feeding to produce':`Needs delivered ${def.feedName} to produce`;return h.product>=100?`${def.productName} ready for collection`:`Producing ${def.productName.toLowerCase()}`;
}
export function validateHusbandry(s) {
  const posts=new Set(),ids=new Set();
  for(const a of s.creatures){if(ids.has(a.id))throw new Error('Duplicate creature identity.');ids.add(a.id);if(!isLivestock(a))continue;const h=a.husbandry;
    if(!h||(h.blocked!==null&&(typeof h.blocked!=='string'||h.blocked.length>200))||![h.trust,h.product].every(n=>Number.isFinite(n)&&n>=0&&n<=100)||typeof h.care!=='boolean'||typeof h.harvest!=='boolean'||!Number.isSafeInteger(h.retryAt)||h.retryAt<0||h.retryAt>s.tick+120)throw new Error('Invalid animal care state.');
    if(h.post!==null){if(!Array.isArray(h.post)||h.post.length!==2||!h.post.every(n=>Number.isInteger(n)&&n>=0&&n<s.sites.surface.size)||postTile(s,a)?.building!=='husbandryPost')throw new Error('Invalid husbandry post.');if(a.health>0){const key=h.post.join(',');if(posts.has(key))throw new Error('Husbandry post assigned twice.');posts.add(key);}}
  }
  const assigned=new Map();for(const j of s.jobs.filter(animalJob)){const a=animalForJob(s,j),prior=assigned.get(j.animal)||[];
    if(prior.length>=2||prior.includes(j.kind)||prior.length===1&&![...prior,j.kind].every(kind=>['animalCare','animalTreat'].includes(kind)))throw new Error('Conflicting animal work orders.');
    const def=livestockDef(a),feed=j.kind==='animalCare'&&def?.feedKinds;
    if(!a||j.site!=='surface'||j.building!==null||j.work!==(j.kind==='animalCare'?def.careWork:j.kind==='animalTreat'?VETERINARY.work:def.harvestWork)||Object.keys(j.cost).length!==(j.kind==='animalHarvest'?0:1)||(j.kind==='animalCare'&&j.cost.food!==def.careFood)||(j.kind==='animalTreat'&&(j.cost.medicine!==VETERINARY.medicine||!animalTreatmentValid(s,j))))throw new Error('Invalid animal work order.');
    if(feed?(!j.foodKinds||Object.keys(j.foodKinds).length!==Object.keys(feed).length||Object.entries(feed).some(([kind,n])=>j.foodKinds[kind]!==n)):j.foodKinds!==undefined)throw new Error('Invalid animal feed requirement.');
    if(feed)for(const inv of [j.materials,...j.sources.map(source=>source.items)]){const amount=inv.food||0;if(amount&&planFoodSelection(inv,amount,{rawOnly:true,foodKinds:Object.fromEntries(Object.entries(feed).map(([kind,n])=>[kind,n*amount/def.careFood]))})===null)throw new Error('Invalid staged animal feed.');}
    assigned.set(a.id,[...prior,j.kind]);
  }
}
