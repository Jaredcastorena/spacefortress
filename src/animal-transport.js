import { pathTo } from './navigation.js';
import { moveCrew } from './atmosphere.js';
import { immobile } from './mobility.js';
import { workRate, gainExperience } from './crew.js';
import { moveAnimal } from './pastures.js';
import { emitEvent, tileEntityId } from './telemetry.js';
export const TRANSPORT_WORK=6,TRANSPORT_STEP=3;
export const transportJob=j=>j.kind==='animalLead';
export const transportFor=(s,a)=>s.jobs.find(j=>transportJob(j)&&j.animal===a.id);
export const transportAnimal=(s,j)=>s.creatures.find(a=>a.id===j.animal&&a.species==='bristleback'&&a.health>0&&a.husbandry.trust===100);
const target=(s,j)=>s.sites.surface.tiles[j.y*s.sites.surface.size+j.x];
const same=(a,b)=>a.x===b.x&&a.y===b.y&&a.site===b.site;
export const postReserved=(s,x,y,animal)=>s.jobs.some(j=>transportJob(j)&&j.x===x&&j.y===y&&j.animal!==animal);
export function requestTransport(s,id,x,y,cancelJob){
 const a=s.creatures.find(a=>a.id===id&&a.species==='bristleback'&&a.health>0&&a.husbandry.trust===100),site=s.sites.surface;
 if(!a)return {ok:false,message:'Transport requires a living, tame bristleback.'};
 if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=site.size||y>=site.size)return {ok:false,message:'Choose a husbandry post.'};
 const t=site.tiles[y*site.size+x];
 if(t.building!=='husbandryPost'||t.hp<=0)return {ok:false,message:'Choose a working husbandry post.'};
 if(transportFor(s,a))return {ok:false,message:'This animal already has a transport order.'};
 if(s.creatures.some(o=>o!==a&&o.health>0&&o.husbandry?.post?.[0]===x&&o.husbandry.post[1]===y)||postReserved(s,x,y,id))return {ok:false,message:'This post is assigned or reserved.'};
 if(s.jobs.some(j=>j.site==='surface'&&j.x===x&&j.y===y&&!(j.animal===id&&['animalCare','animalHarvest'].includes(j.kind))))return {ok:false,message:'Finish or cancel the work at this post first.'};
 if(pathTo(site,a,[[x,y]])===null||!s.crew.some(c=>c.site==='surface'&&c.health>0&&pathTo(site,c,[[a.x,a.y]])!==null))return {ok:false,message:'A handler needs a route to the animal and its destination.'};
 for(const j of [...s.jobs])if(j.animal===id)cancelJob(s,j.id,true);
 const j={id:`job-${s.nextId++}`,site:'surface',x,y,kind:'animalLead',animal:id,building:null,cost:{},sources:[],materials:{},work:TRANSPORT_WORK,remaining:TRANSPORT_WORK,phase:'collect',worker:null,priority:3,blockedReason:null,missingFood:0,foodSpoiled:0};
 s.jobs.push(j);emitEvent(s,'job.created',{entity:j.id,kind:j.kind,target:tileEntityId('surface',x,y),animal:id,cost:{}});emitEvent(s,'animal.transport.ordered',{entity:id,job:j.id,target:tileEntityId('surface',x,y)});return {ok:true,job:j};
}
export function transportRoute(s,j,c){
 const a=transportAnimal(s,j),t=target(s,j),site=s.sites.surface;
 return !a||t?.building!=='husbandryPost'||!t.hp||pathTo(site,a,[[j.x,j.y]])===null?null:pathTo(site,c,[[a.x,a.y]]);
}
export function releaseTransport(s,j,reason='handler_unavailable'){
 if(!transportJob(j))return;
 if(j.phase==='escort'||j.remaining<j.work)emitEvent(s,'animal.transport.interrupted',{entity:j.animal,job:j.id,actor:j.worker,reason});
 j.phase='collect';j.remaining=j.work;
}
export function reconcileTransport(s,cancelJob){
 for(const j of [...s.jobs].filter(transportJob)){
  const a=transportAnimal(s,j),t=target(s,j),c=s.crew.find(c=>c.id===j.worker);
  if(!a||t?.building!=='husbandryPost'||s.creatures.some(o=>o!==a&&o.health>0&&o.husbandry?.post?.[0]===j.x&&o.husbandry.post[1]===j.y)){cancelJob(s,j.id,true);continue;}
  if(c&&(c.job!==j.id||c.site!=='surface'||c.health<=0||!c.labors.husbandry||c.intent||c.carry||c.rescue||immobile(c)||j.phase==='escort'&&!same(a,c))){releaseTransport(s,j);if(c.job===j.id)c.job=null;j.worker=null;}
  if(!j.worker&&(j.phase!=='collect'||j.remaining<j.work))releaseTransport(s,j);
 }
}
export function heldForTransport(s,a){
 const j=transportFor(s,a),c=j&&s.crew.find(c=>c.id===j.worker);
 return !!c&&c.job===j.id&&c.health>0&&!c.intent&&!c.carry&&!c.rescue&&!immobile(c)&&same(a,c)&&(j.phase==='escort'||j.remaining<j.work);
}
// Crew and animal share a tile while attached; the animal moves only after the handler does.
export function actTransport(s,c,j,release){
 const a=transportAnimal(s,j),site=s.sites.surface,t=target(s,j);
 if(!a||t?.building!=='husbandryPost'||!t.hp){j.blockedReason='Animal or destination unavailable';release(s,c);return false;}
 const route=pathTo(site,c,j.phase==='collect'?[[a.x,a.y]]:[[j.x,j.y]]);
 if(route===null||pathTo(site,a,[[j.x,j.y]])===null){release(s,c);j.blockedReason=c.activity='Animal transport route blocked';return false;}
 j.blockedReason=null;
 if(j.phase==='collect'){
  c.activity='Collecting a tame bristleback';
  if(route.length){moveCrew(c,site,route[0]);return false;}
  const effort=Math.min(j.remaining,workRate(c,'husbandry'));j.remaining-=effort;gainExperience(c,'husbandry',effort);
  if(j.remaining<=0){j.phase='escort';emitEvent(s,'animal.transport.attached',{entity:a.id,actor:c.id,job:j.id,target:tileEntityId('surface',a.x,a.y)});}return false;
 }
 c.activity='Escorting a bristleback';
 if(!route.length)return true;
 if(s.tick%TRANSPORT_STEP===0&&moveCrew(c,site,route[0]))moveAnimal(s,a,[c.x,c.y],'handler_escort');
 return false;
}
export function completeTransport(s,c,j){
 const a=transportAnimal(s,j);a.husbandry.post=[j.x,j.y];a.husbandry.retryAt=0;a.husbandry.blocked=null;
 emitEvent(s,'animal.post.assigned',{entity:a.id,target:tileEntityId('surface',j.x,j.y)});
 emitEvent(s,'animal.transport.delivered',{entity:a.id,actor:c.id,job:j.id,target:tileEntityId('surface',j.x,j.y)});
}
export function transportStatus(s,a){const j=transportFor(s,a);return j?{job:j.id,phase:j.phase,worker:j.worker,destination:tileEntityId('surface',j.x,j.y),blocked:j.blockedReason}:null;}
export function validateTransport(s){
 const animals=new Set(),posts=new Set();
 for(const j of s.jobs.filter(transportJob)){
  const a=transportAnimal(s,j),c=s.crew.find(c=>c.id===j.worker),key=`${j.x},${j.y}`;
  if(!a||j.site!=='surface'||target(s,j)?.building!=='husbandryPost'||j.building!==null||j.work!==TRANSPORT_WORK||!['collect','escort'].includes(j.phase)||Object.keys(j.cost).length||Object.keys(j.materials).length||j.sources.length||j.missingFood||j.foodSpoiled||animals.has(a.id)||posts.has(key)||s.jobs.some(o=>o!==j&&o.animal===a.id)||s.creatures.some(o=>o!==a&&o.health>0&&o.husbandry?.post?.join(',')===key))throw new Error('Invalid animal transport order.');
  if(j.phase==='escort'?(j.remaining!==0||!c||!same(a,c)||c.job!==j.id||c.intent||c.carry||c.rescue||immobile(c)||!c.labors.husbandry||c.health<=0):j.remaining<=0||j.remaining<j.work&&(!c||!same(a,c)))throw new Error('Invalid animal escort.');
  animals.add(a.id);posts.add(key);
 }
}
