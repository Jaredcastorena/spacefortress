import { transportFor, postReserved } from './animal-transport.js';
import { adult } from './breeding.js';
import { animalPath } from './navigation.js';
import { moveAnimal } from './pastures.js';
import { spill } from './inventory.js';
import { emitEvent, tileEntityId } from './telemetry.js';
export const ANIMAL_JOBS = ['animalCare','animalHarvest'];
export const animalJob = j => ANIMAL_JOBS.includes(j.kind);
export function initializeHusbandry(s) {
  for(const c of s.crew){c.labors.husbandry??=true;c.skills.husbandry??={level:c.role==='Botanist'?2:0,xp:0};}
  for(const a of s.creatures)if(a.species==='bristleback')a.husbandry??={post:null,trust:0,product:0,care:true,harvest:true,retryAt:0,blocked:null};
}
const postTile=(s,a)=>a.husbandry.post?s.sites.surface.tiles[a.husbandry.post[1]*s.sites.surface.size+a.husbandry.post[0]]:null;
export const animalForJob=(s,j)=>s.creatures.find(a=>a.id===j.animal&&a.species==='bristleback'&&a.health>0&&a.husbandry.post?.[0]===j.x&&a.husbandry.post?.[1]===j.y);
export function animalJobValid(s,j) {
  const a=animalForJob(s,j),t=a&&postTile(s,a);if(!a||t?.building!=='husbandryPost'||!t.hp)return false;
  return j.kind==='animalCare'?a.husbandry.care:adult(a)&&a.husbandry.harvest&&a.husbandry.trust===100&&a.husbandry.product>=100&&a.fed>=40&&a.health>=40;
}
export function assignAnimal(s,id,x,y,pathTo,cancelJob) {
  const a=s.creatures.find(a=>a.id===id&&a.species==='bristleback'&&a.health>0);if(!a)return {ok:false,message:'Choose a living bristleback.'};
  if(x!==null||y!==null){const site=s.sites.surface;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=site.size||y>=site.size)return {ok:false,message:'Choose a husbandry post.'};const t=site.tiles[y*site.size+x];if(t.building!=='husbandryPost'||t.hp<=0)return {ok:false,message:'Choose a working husbandry post.'};if(postReserved(s,x,y,id))return {ok:false,message:'This post is reserved for transport.'};if(s.creatures.some(o=>o!==a&&o.health>0&&o.husbandry?.post?.[0]===x&&o.husbandry.post[1]===y))return {ok:false,message:'This post already has an animal.'};if(pathTo(site,a,[[x,y]])===null)return {ok:false,message:'The animal cannot reach this post.'};}
  for(const j of [...s.jobs])if(j.animal===id)cancelJob(s,j.id,true);
  a.husbandry.post=x===null?null:[x,y];a.husbandry.retryAt=0;a.husbandry.blocked=null;
  emitEvent(s,'animal.post.assigned',{entity:id,target:x===null?null:tileEntityId('surface',x,y)});return {ok:true};
}
export function animalPolicy(s,id,policy,enabled,cancelJob) {
  const a=s.creatures.find(a=>a.id===id&&a.species==='bristleback'&&a.health>0);if(!a||!['care','harvest'].includes(policy)||typeof enabled!=='boolean')return {ok:false,message:'Choose a living bristleback and care policy.'};
  a.husbandry[policy]=enabled;if(enabled)a.husbandry.retryAt=0;a.husbandry.blocked=null;
  for(const j of [...s.jobs])if(j.animal===id&&j.kind===(policy==='care'?'animalCare':'animalHarvest')&&!enabled)cancelJob(s,j.id,true);
  return {ok:true};
}
export function prepareHusbandry(s,order,cancelJob) {
  for(const a of s.creatures)if(a.husbandry?.post&&postTile(s,a)?.building!=='husbandryPost'){
    a.husbandry.post=null;emitEvent(s,'animal.post.lost',{entity:a.id});
  }
  for(const j of [...s.jobs])if(animalJob(j)&&!animalJobValid(s,j))cancelJob(s,j.id,true);
  for(const a of s.creatures)if(a.species==='bristleback'&&a.health>0&&a.husbandry.post){
    const h=a.husbandry,t=postTile(s,a);if(transportFor(s,a))continue;if(!t.hp||s.tick<h.retryAt||s.jobs.some(j=>j.site==='surface'&&j.x===t.x&&j.y===t.y))continue;
    const kind=h.care&&(h.trust<100||a.fed<40)?'animalCare':adult(a)&&h.harvest&&h.trust===100&&h.product>=100&&a.fed>=40&&a.health>=40?'animalHarvest':null;
    if(kind){const result=order(s,'surface',t.x,t.y,kind,a.id);h.blocked=result.ok?null:result.message;}else h.blocked=null;
  }
}
export function completeAnimalJob(s,c,j) {
  const a=animalForJob(s,j),h=a.husbandry,t=postTile(s,a);
  if(j.kind==='animalCare'){
    const wasTame=h.trust===100;a.fed=Math.min(100,a.fed+30);h.trust=Math.min(100,h.trust+40);spill(t,{waste:.125});
    emitEvent(s,'animal.care.completed',{entity:a.id,actor:c.id,job:j.id,food:1,trust:h.trust,fed:a.fed});
    if(!wasTame&&h.trust===100)emitEvent(s,'animal.tamed',{entity:a.id,actor:c.id});
  }else{
    h.product=0;a.fed=Math.max(0,a.fed-20);spill(t,{food:2,waste:.25});
    emitEvent(s,'animal.harvested',{entity:a.id,actor:c.id,job:j.id,target:tileEntityId('surface',t.x,t.y),output:{food:2,waste:.25}});
  }
}
// Return true when an assigned animal uses its post route instead of wandering.
export function moveAssignedAnimal(s,a,pathTo,roamPasture=false) {
  if(transportFor(s,a))return false;
  const t=postTile(s,a);if(!t||t.building!=='husbandryPost'||t.hp<=0)return false;
  const working=s.jobs.some(j=>animalJob(j)&&j.animal===a.id);
  if(working||(!roamPasture&&Math.abs(a.x-t.x)+Math.abs(a.y-t.y)>2)){
    if(s.tick%3===0){const route=pathTo(s.sites.surface,a,[[t.x,t.y]]);if(route?.length)moveAnimal(s,a,route[0],'post');}
    return true;
  }
  return false;
}
export function animalCondition(s,a) {
  if(a.fed===0){a.health=Math.max(0,a.health-.2);if(a.health===0)emitEvent(s,'animal.died',{entity:a.id,cause:'starvation'});}
  else if(a.fed>=60)a.health=Math.min(100,a.health+.01);
  if(a.health>0&&adult(a)&&a.husbandry.trust===100&&a.fed>=60&&a.health>=60){const before=a.husbandry.product;a.husbandry.product=Math.min(100,before+.25);if(before<100&&a.husbandry.product===100)emitEvent(s,'animal.product.ready',{entity:a.id});}
}
export function husbandryStatus(s,a,_pathTo) {
  const h=a.husbandry;if(!h)return null;
  if(a.health<=0)return 'Deceased';const transport=transportFor(s,a);if(transport)return transport.blockedReason||(transport.phase==='escort'?'Being escorted to a post':'Handler collection designated');if(!h.post)return h.trust===100?'Tame; no post assigned':'Wild; no post assigned';const t=postTile(s,a);
  if(t?.building!=='husbandryPost')return 'Post lost';if(!t.hp)return 'Post damaged';if(animalPath(s.sites.surface,a,[h.post])===null)return 'Post route blocked';
  const job=s.jobs.find(j=>animalJob(j)&&j.animal===a.id);if(job)return job.blockedReason|| (job.kind==='animalCare'?'Care designated':'Harvest designated');
  if(h.blocked)return h.blocked;
  if(!adult(a))return 'Juvenile; growing before curd production';if(h.trust<100)return h.care?'Needs delivered food and handling':'Care paused';if(a.fed<60)return 'Needs grazing or feeding to produce';return h.product>=100?'Curd ready for collection':'Producing nutrient curd';
}
export function validateHusbandry(s) {
  const posts=new Set(),ids=new Set();
  for(const a of s.creatures){if(ids.has(a.id))throw new Error('Duplicate creature identity.');ids.add(a.id);if(a.species!=='bristleback')continue;const h=a.husbandry;
    if(!h||(h.blocked!==null&&(typeof h.blocked!=='string'||h.blocked.length>200))||![h.trust,h.product].every(n=>Number.isFinite(n)&&n>=0&&n<=100)||typeof h.care!=='boolean'||typeof h.harvest!=='boolean'||!Number.isSafeInteger(h.retryAt)||h.retryAt<0||h.retryAt>s.tick+120)throw new Error('Invalid animal care state.');
    if(h.post!==null){if(!Array.isArray(h.post)||h.post.length!==2||!h.post.every(n=>Number.isInteger(n)&&n>=0&&n<s.sites.surface.size)||postTile(s,a)?.building!=='husbandryPost')throw new Error('Invalid husbandry post.');if(a.health>0){const key=h.post.join(',');if(posts.has(key))throw new Error('Husbandry post assigned twice.');posts.add(key);}}
  }
  const assigned=new Set();for(const j of s.jobs.filter(animalJob)){const a=animalForJob(s,j);
    if(!a||j.site!=='surface'||assigned.has(a.id)||j.building!==null||j.work!==(j.kind==='animalCare'?12:10)||Object.keys(j.cost).length!==(j.kind==='animalCare'?1:0)||(j.kind==='animalCare'&&j.cost.food!==1))throw new Error('Invalid animal work order.');assigned.add(a.id);
  }
}
