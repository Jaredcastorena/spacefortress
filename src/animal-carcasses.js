import { tileAt, positionOf, sameCell, cellKey } from './spatial.js';
import { isLivestock, livestockDef } from './livestock-data.js';
import { adult } from './breeding.js';
import { FOOD_LIFETIME, decayRate, typedFood } from './food-lots.js';
import { temperatureAt } from './thermal.js';
import { spill } from './inventory.js';
import { workRate, gainExperience } from './crew.js';
import { immobile } from './mobility.js';
import { distance } from './geometry.js';
import { emitEvent, tileEntityId } from './telemetry.js';

export const BUTCHERY=Object.freeze({dispatchWork:8,processWork:20,discardWork:4,waste:.25});
const causes=['fire','cold','heat','starvation','dispatch','unknown','legacy'];
const physical=d=>d&&['fresh','spoiled'].includes(d.disposition);
const animal=(s,j)=>s.creatures.find(a=>a.id===j.animal&&isLivestock(a));
const tile=(s,site,x,y,z=0)=>tileAt(s.sites[site],{x,y,z});
const post=(s,x,y,z=0,siteId='surface')=>tile(s,siteId,x,y,z);
const workingPost=(s,x,y,z=0,siteId='surface')=>post(s,x,y,z,siteId)?.building==='husbandryPost'&&post(s,x,y,z,siteId).hp>0;
const id=a=>`carcass:${a.id}`;
const result=(ok,code,message)=>({ok,code,message});
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const same=(c,p)=>c&&p&&c.site===p.site&&sameCell(positionOf(c),positionOf(p));
const availableWorker=c=>c&&c.health>0&&!immobile(c)&&!c.carry&&!c.rescue&&!c.intent&&c.labors?.husbandry;
export const dispatchJob=j=>j.kind==='animalDispatch';
export const carcassJob=j=>['animalButcher','animalDiscard'].includes(j.kind);

export function initializeAnimalDeaths(s,{legacy=false}={}){
  if(legacy&&s.creatures.some(a=>['death','body','carcass'].some(key=>Object.hasOwn(a,key))))throw new Error('Legacy animal death shadow.');
  for(const a of s.creatures)if(isLivestock(a)&&a.death===undefined){
    if(a.health>0)a.death=null;
    else if(legacy)a.death={tick:s.tick,cause:'legacy',stage:adult(a)?'adult':'juvenile',meatKind:livestockDef(a).meatKind,yield:0,age:0,disposition:'legacy',owner:null,reservedBy:null};
    else registerAnimalDeath(s,a,'unknown');
  }
}
export function registerAnimalDeath(s,a,cause){
  if(!isLivestock(a)||a.death!=null||!causes.includes(cause)||cause==='legacy')return false;
  const def=livestockDef(a),stage=adult(a)?'adult':'juvenile';a.health=0;
  a.death={tick:s.tick,cause,stage,meatKind:def.meatKind,yield:stage==='adult'?def.meatYield:def.juvenileMeatYield,age:0,disposition:'fresh',owner:{kind:'tile',site:a.site,...positionOf(a)},reservedBy:null};
  if(a.lifecycle?.brood){const b=a.lifecycle.brood;emitEvent(s,'animal.brood.lost',{entity:a.id,brood:b.id,mate:b.mate,reason:'parent_died'});a.lifecycle.brood=null;}
  if(a.lifecycle)a.lifecycle.enabled=false;
  if(a.husbandry){a.husbandry.post=null;a.husbandry.harvest=false;}
  if(a.condition)a.condition.recovery='none';
  emitEvent(s,'animal.died',{entity:a.id,cause,carcass:id(a)});
  emitEvent(s,'carcass.created',{entity:id(a),animal:a.id,cause,stage,meatKind:a.death.meatKind,yield:a.death.yield,age:0,owner:structuredClone(a.death.owner),target:tileEntityId(a.site,a.x,a.y,a.z)});return true;
}
export function carcassPosition(s,a){
  const d=a?.death;if(!physical(d))return null;const o=d.owner;
  if(o?.kind==='tile')return {site:o.site,...positionOf(o)};
  if(o?.kind==='crew'){const c=s.crew.find(c=>c.id===o.crew);return c?{site:c.site,...positionOf(c)}:null;}
  if(o?.kind==='job'){const j=s.jobs.find(j=>j.id===o.job);return j?{site:j.site,...positionOf(j)}:null;}
  return null;
}
function dispatchCheck(s,a,exclude=null){
  if(!isLivestock(a)||a.health<=0)return result(false,'invalid_animal','Choose living livestock.');
  if(a.husbandry?.trust!==100)return result(false,'untamed','Slaughter requires tame livestock.');
  if(!adult(a))return result(false,'juvenile','Slaughter requires an adult animal.');
  const p=a.husbandry?.post;if(!p||!workingPost(s,p.x,p.y,p.z,a.site))return result(false,'needs_post','Assign a working local husbandry post.');
  if(a.lifecycle?.enabled)return result(false,'breeding_enabled','Disable breeding before slaughter.');
  if(a.lifecycle?.brood)return result(false,'carrying_brood','An animal carrying a brood cannot be slaughtered.');
  if(post(s,p.x,p.y,p.z,a.site).fire||tile(s,a.site,a.x,a.y,positionOf(a).z)?.fire)return result(false,'fire','Suppress the fire before slaughter.');
  if(s.jobs.some(j=>j!==exclude&&(j.animal===a.id||j.site===a.site&&sameCell(positionOf(j),p))))return result(false,'busy','Finish or cancel conflicting animal or post work.');
  return result(true,'ready','Ready to order slaughter for meat.');
}
export const dispatchEligibility=(s,a)=>dispatchCheck(s,a);
export function dispatchJobValid(s,j){const a=animal(s,j);return dispatchJob(j)&&!!a&&j.site===a.site&&sameCell(a.husbandry?.post,positionOf(j))&&dispatchCheck(s,a,j).ok;}
export function butcheryEligibility(s,a,x,y,z=0,siteId='surface'){
  if(!isLivestock(a)||a.health>0||!physical(a.death))return result(false,'no_body','Choose an unprocessed livestock carcass.');
  const d=a.death;if(d.disposition!=='fresh'||d.age>=FOOD_LIFETIME||d.yield<=0)return result(false,'spoiled','This carcass cannot supply edible meat.');
  if(d.reservedBy!==null||d.owner?.kind!=='tile')return result(false,'reserved','This carcass is already reserved.');
  const source=carcassPosition(s,a);if(!source||source.site!==siteId||a.site!==siteId)return result(false,'wrong_site','Butchery requires the carcass and post at the same site.');
  const site=s.sites[siteId];if(!site||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=site.size||y>=site.size||!workingPost(s,x,y,z,siteId))return result(false,'needs_post','Choose a working local husbandry post.');
  if(post(s,x,y,z,siteId).fire)return result(false,'fire','Suppress the fire at the post.');
  if(s.creatures.some(o=>o.site===siteId&&o.health>0&&sameCell(o.husbandry?.post,{x,y,z}))||s.jobs.some(j=>j.animal===a.id||j.site===siteId&&sameCell(positionOf(j),{x,y,z})))return result(false,'busy','This animal or post already has work or an assignment.');
  return result(true,'ready','Ready to retrieve and butcher this carcass.');
}
export function discardEligibility(s,a){
  if(!isLivestock(a)||a.health>0||a.death?.disposition!=='spoiled'||a.death.owner?.kind!=='tile')return result(false,'not_spoiled','Choose a spoiled carcass on the ground.');
  if(a.death.reservedBy!==null||s.jobs.some(j=>j.animal===a.id))return result(false,'reserved','This carcass is already reserved.');
  return result(true,'ready','Ready to discard this spoiled carcass.');
}
export function requestDispatch(s,animalId,order){const a=s.creatures.find(a=>a.id===animalId),eligibility=dispatchEligibility(s,a);if(!eligibility.ok)return eligibility;const r=order(s,a.site,a.husbandry.post.x,a.husbandry.post.y,'animalDispatch',animalId,a.husbandry.post.z);if(r.ok)emitEvent(s,'animal.dispatch.ordered',{entity:a.id,job:r.job.id,target:tileEntityId(a.site,a.husbandry.post.x,a.husbandry.post.y,a.husbandry.post.z)});return r;}
export function requestButchery(s,animalId,x,y,order,z=0,siteId='surface'){const a=s.creatures.find(a=>a.id===animalId),eligibility=butcheryEligibility(s,a,x,y,z,siteId);if(!eligibility.ok)return eligibility;const r=order(s,siteId,x,y,'animalButcher',animalId,z);if(r.ok)emitEvent(s,'carcass.reserved',{entity:id(a),animal:a.id,job:r.job.id,kind:'animalButcher',owner:structuredClone(a.death.owner),age:a.death.age,target:tileEntityId(siteId,x,y,z)});return r;}
export function requestDiscard(s,animalId,order){const a=s.creatures.find(a=>a.id===animalId),eligibility=discardEligibility(s,a);if(!eligibility.ok)return eligibility;const p=carcassPosition(s,a),r=order(s,p.site,p.x,p.y,'animalDiscard',animalId,p.z);if(r.ok)emitEvent(s,'carcass.reserved',{entity:id(a),animal:a.id,job:r.job.id,kind:'animalDiscard',owner:structuredClone(a.death.owner),age:a.death.age,target:tileEntityId(p.site,p.x,p.y,p.z)});return r;}
export function releaseCarcass(s,j,c,reason='handler_unavailable'){
  if(!carcassJob(j))return;const a=animal(s,j),d=a?.death;if(!physical(d)||d.reservedBy!==j.id)return;
  const cancel=['cancelled','destination_lost','worker_died','immobile','spoiled','invalidated'].includes(reason);
  if(d.owner.kind==='crew'||cancel&&d.owner.kind==='job'){
    const p=carcassPosition(s,a)||c&&{site:c.site,...positionOf(c)}||{site:j.site,...positionOf(j)};d.owner={kind:'tile',...p};
    emitEvent(s,'carcass.dropped',{entity:id(a),animal:a.id,job:j.id,actor:c?.id||j.worker,reason,owner:structuredClone(d.owner),age:d.age,target:tileEntityId(p.site,p.x,p.y,p.z)});
    if(j.kind==='animalButcher')j.phase='collect';
  }
  if(cancel)d.reservedBy=null;
}
export function reconcileCarcasses(s,cancelJob){
  for(const a of s.creatures)if(isLivestock(a)&&a.health<=0&&a.death==null)registerAnimalDeath(s,a,'unknown');
  for(const j of [...s.jobs]){
    const a=animal(s,j),c=s.crew.find(c=>c.id===j.worker);
    if(a?.health<=0&&['animalCare','animalHarvest','animalTreat','animalLead','animalDispatch'].includes(j.kind)){cancelJob(s,j.id,true);continue;}
    if(dispatchJob(j)){if(!dispatchJobValid(s,j))cancelJob(s,j.id,true);continue;}
    if(!carcassJob(j))continue;
    const d=a?.death,valid=a?.site===j.site&&carcassPosition(s,a)?.site===j.site&&d?.reservedBy===j.id&&(j.kind==='animalButcher'?d.disposition==='fresh'&&d.age<FOOD_LIFETIME&&workingPost(s,j.x,j.y,positionOf(j).z,j.site):d.disposition==='spoiled'&&d.owner?.kind==='tile');
    if(!valid||c&&(c.health<=0||immobile(c))){releaseCarcass(s,j,c,!valid?'invalidated':c.health<=0?'worker_died':'immobile');cancelJob(s,j.id,true);continue;}
    if(c&&(c.job!==j.id||!availableWorker(c)||c.site!==j.site)){releaseCarcass(s,j,c);if(c.job===j.id)c.job=null;j.worker=null;}
    if(!j.worker&&d.owner?.kind==='crew'){const owner=s.crew.find(c=>c.id===d.owner.crew);releaseCarcass(s,j,owner);}
  }
}
export function updateCarcasses(s){
  for(const a of s.creatures)if(physical(a.death)){
    const d=a.death,p=carcassPosition(s,a);if(!p)continue;d.age+=decayRate(temperatureAt(s.sites[p.site],p.x,p.y,p.z));
    if(d.disposition==='fresh'&&d.age>=FOOD_LIFETIME){d.disposition='spoiled';emitEvent(s,'carcass.spoiled',{entity:id(a),animal:a.id,age:d.age,owner:structuredClone(d.owner),reservedBy:d.reservedBy});}
  }
}
export function actCarcass(s,c,j,move,release){
  const a=animal(s,j),d=a?.death;if(!physical(d)||d.reservedBy!==j.id||!availableWorker(c)||c.site!==j.site||a.site!==j.site||c.job!==j.id||j.worker!==c.id){release(s,c);return false;}
  if(j.kind==='animalButcher'&&(d.disposition!=='fresh'||!workingPost(s,j.x,j.y,positionOf(j).z,j.site))||j.kind==='animalDiscard'&&d.disposition!=='spoiled'){release(s,c);return false;}
  const source=carcassPosition(s,a),target={site:j.site,...positionOf(j)},goal=j.kind==='animalButcher'&&j.phase==='collect'?source:target;
  if(!goal||source?.site!==j.site||goal.site!==c.site){j.blockedReason='Carcass route unavailable';release(s,c);return false;}
  const status=move(s,c,s.sites[c.site],[positionOf(goal)]);
  if(status==='blocked'){j.blockedReason='Carcass route blocked';release(s,c);return false;}
  if(status!=='arrived'){j.blockedReason=status==='waiting_airlock'?'Waiting for airlock cycle':null;return false;}
  j.blockedReason=null;
  if(j.kind==='animalButcher'&&j.phase==='collect'){
    if(d.owner.kind!=='tile'||!same(c,source))return false;d.owner={kind:'crew',crew:c.id};j.phase='carry';emitEvent(s,'carcass.picked_up',{entity:id(a),animal:a.id,job:j.id,actor:c.id,age:d.age,owner:structuredClone(d.owner),target:tileEntityId(c.site,c.x,c.y,c.z)});return false;
  }
  if(j.kind==='animalButcher'&&j.phase==='carry'){
    if(d.owner.kind!=='crew'||d.owner.crew!==c.id||!same(c,target))return false;d.owner={kind:'job',job:j.id};j.phase='process';emitEvent(s,'carcass.staged',{entity:id(a),animal:a.id,job:j.id,actor:c.id,age:d.age,owner:structuredClone(d.owner),target:tileEntityId(j.site,j.x,j.y,j.z)});return false;
  }
  if(tile(s,j.site,j.x,j.y,positionOf(j).z)?.fire){j.blockedReason='Waiting for fire suppression';return false;}
  if(j.kind==='animalButcher'&&(j.phase!=='process'||d.owner.kind!=='job'||d.owner.job!==j.id)||j.kind==='animalDiscard'&&(d.owner.kind!=='tile'||!same(c,source)))return false;
  const effort=Math.min(j.remaining,workRate(c,'husbandry'));j.remaining-=effort;gainExperience(c,'husbandry',effort);return j.remaining<=0;
}
export function completeDispatch(s,c,j){
  const a=animal(s,j);if(!dispatchJobValid(s,j)||j.work!==BUTCHERY.dispatchWork||j.remaining!==0||!availableWorker(c)||!same(a,{site:j.site,...positionOf(j)})||c.site!==j.site||positionOf(c).z!==positionOf(j).z||distance([c.x,c.y],[j.x,j.y])>1)return false;
  if(!registerAnimalDeath(s,a,'dispatch'))return false;emitEvent(s,'animal.dispatch.completed',{entity:a.id,carcass:id(a),actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y,j.z)});return true;
}
export function completeCarcass(s,c,j){
  const a=animal(s,j),d=a?.death;if(!carcassJob(j)||!availableWorker(c)||c.site!==j.site||a?.site!==j.site||!physical(d)||d.reservedBy!==j.id||j.remaining!==0)return false;
  const p=carcassPosition(s,a);if(!p||p.site!==j.site||!same(c,p))return false;
  if(j.kind==='animalButcher'){
    if(d.disposition!=='fresh'||d.age>=FOOD_LIFETIME||j.phase!=='process'||d.owner.kind!=='job'||d.owner.job!==j.id||!workingPost(s,j.x,j.y,positionOf(j).z,j.site)||post(s,j.x,j.y,positionOf(j).z,j.site).fire)return false;
    const output={...typedFood(d.meatKind,d.yield,d.age),waste:BUTCHERY.waste};spill(post(s,j.x,j.y,positionOf(j).z,j.site),output);d.disposition='butchered';d.owner=null;d.reservedBy=null;
    const details={entity:id(a),animal:a.id,job:j.id,actor:c.id,target:tileEntityId(j.site,j.x,j.y,j.z),age:d.age,meatKind:d.meatKind,output:structuredClone(output)};emitEvent(s,'carcass.butchered',details);emitEvent(s,'animal.butchered',{...details,entity:a.id,carcass:id(a)});return true;
  }
  if(j.kind==='animalDiscard'&&d.disposition==='spoiled'&&d.owner.kind==='tile'&&!tile(s,p.site,p.x,p.y,p.z).fire){spill(tile(s,p.site,p.x,p.y,p.z),{waste:BUTCHERY.waste});d.disposition='discarded';d.owner=null;d.reservedBy=null;emitEvent(s,'carcass.discarded',{entity:id(a),animal:a.id,job:j.id,actor:c.id,target:tileEntityId(p.site,p.x,p.y,p.z),age:d.age,output:{waste:BUTCHERY.waste}});return true;}return false;
}
export function carcassStatus(s,a){
  const d=a?.death;if(!d)return null;const j=s.jobs.find(j=>j.id===d.reservedBy);
  return {id:id(a),disposition:d.disposition,age:d.age,meatKind:d.meatKind,yield:d.yield,edibleYield:d.disposition==='fresh'&&d.age<FOOD_LIFETIME?d.yield:0,owner:d.owner?structuredClone(d.owner):null,reservedBy:d.reservedBy,position:carcassPosition(s,a),job:j?.id||null,phase:j?.phase||null,work:j?.work||null,remaining:j?.remaining??null};
}
export function validateCarcasses(s){
  const reserved=new Set(),carriers=new Set(),posts=new Set();
  for(const a of s.creatures){
    if(Object.hasOwn(a,'body')||Object.hasOwn(a,'carcass'))throw new Error('Invalid animal body shadow.');
    if(!isLivestock(a)){if(Object.hasOwn(a,'death')||Object.hasOwn(a,'body')||Object.hasOwn(a,'carcass'))throw new Error('Pests cannot have livestock mortality.');continue;}
    const d=a.death;if(a.health>0){if(d!==null)throw new Error('Living animal cannot have mortality.');continue;}
    const def=livestockDef(a);if(!exact(d,['tick','cause','stage','meatKind','yield','age','disposition','owner','reservedBy'])||!Number.isSafeInteger(d.tick)||d.tick<0||d.tick>s.tick||!causes.includes(d.cause)||!['adult','juvenile'].includes(d.stage)||d.stage!==(adult(a)?'adult':'juvenile')||d.meatKind!==def.meatKind||!Number.isFinite(d.age)||d.age<0||!['fresh','spoiled','butchered','discarded','legacy'].includes(d.disposition)||d.yield!==(d.disposition==='legacy'?0:d.stage==='adult'?def.meatYield:def.juvenileMeatYield))throw new Error('Invalid animal mortality.');
    if(d.disposition==='legacy'?(d.cause!=='legacy'||d.age!==0):d.cause==='legacy')throw new Error('Invalid legacy mortality.');
    if(physical(d)){
      if(d.disposition==='fresh'?d.age>=FOOD_LIFETIME:d.age<FOOD_LIFETIME)throw new Error('Invalid carcass freshness.');
      const o=d.owner,p=carcassPosition(s,a);if(!p||p.site!==a.site||!tileAt(s.sites[p.site],p))throw new Error('Invalid carcass location.');
      if(o.kind==='tile'?!exact(o,['kind','site','x','y','z']):o.kind==='crew'?!exact(o,['kind','crew']):o.kind==='job'?!exact(o,['kind','job']):true)throw new Error('Invalid carcass owner.');
      const j=s.jobs.find(j=>j.id===d.reservedBy);if(d.reservedBy!==null&&(!j||!carcassJob(j)||j.site!==p.site||j.animal!==a.id||reserved.has(j.id)))throw new Error('Invalid carcass reservation.');if(j)reserved.add(j.id);
      if(o.kind==='crew'){const c=s.crew.find(c=>c.id===o.crew);if(!j||j.kind!=='animalButcher'||j.phase!=='carry'||j.worker!==c?.id||c.job!==j.id||!availableWorker(c)||carriers.has(c.id))throw new Error('Invalid carcass carrier.');carriers.add(c.id);}
      if(o.kind==='job'&&(!j||o.job!==j.id||j.kind!=='animalButcher'||j.phase!=='process'))throw new Error('Invalid staged carcass.');
    }else if(d.owner!==null||d.reservedBy!==null)throw new Error('Consumed carcass cannot have an owner.');
  }
  for(const j of s.jobs.filter(j=>dispatchJob(j)||carcassJob(j))){
    const a=animal(s,j),d=a?.death;if(!a||j.site!==a.site||j.building!==null||Object.keys(j.cost).length||Object.keys(j.materials).length||j.sources.length||j.missingFood||j.foodSpoiled||j.foodKinds!==undefined||!Number.isFinite(j.remaining)||j.remaining<0||j.remaining>j.work||s.jobs.some(o=>o!==j&&o.animal===a.id))throw new Error('Invalid slaughter or carcass order.');
    if(dispatchJob(j)){if(j.work!==BUTCHERY.dispatchWork||!dispatchJobValid(s,j)||j.phase!==undefined)throw new Error('Invalid dispatch order.');}
    else if(d?.reservedBy!==j.id||!physical(d)||j.work!==(j.kind==='animalButcher'?BUTCHERY.processWork:BUTCHERY.discardWork))throw new Error('Invalid carcass order.');
    if(j.kind==='animalButcher'){
      if(d.disposition!=='fresh'||!workingPost(s,j.x,j.y,positionOf(j).z,j.site)||!['collect','carry','process'].includes(j.phase)||d.owner.kind!==({collect:'tile',carry:'crew',process:'job'}[j.phase])||s.creatures.some(o=>o.site===j.site&&o.health>0&&sameCell(o.husbandry?.post,positionOf(j)))||s.jobs.some(o=>o!==j&&o.site===j.site&&sameCell(positionOf(o),positionOf(j)))||posts.has(`${j.site}/${cellKey(positionOf(j))}`))throw new Error('Invalid butchery phase or post claim.');posts.add(`${j.site}/${cellKey(positionOf(j))}`);
    }
    if(j.kind==='animalDiscard'){const p=carcassPosition(s,a);if(d.disposition!=='spoiled'||d.owner.kind!=='tile'||j.phase!==undefined||!same(p,{site:j.site,...positionOf(j)}))throw new Error('Invalid discard order.');}
  }
}
