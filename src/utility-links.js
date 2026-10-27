import {tileAt,positionOf,sameCell} from './spatial.js';
import {stairJobClaims} from './vertical.js';
import {BUILDINGS} from './data.js';
import {emitEvent,tileEntityId} from './telemetry.js';

export const RISER_KIND=Object.freeze({powerRiser:'power',gasRiser:'gas',waterRiser:'water'});
export const riserKind=building=>Object.hasOwn(RISER_KIND,building)?RISER_KIND[building]:null;
export const UTILITY_WORK=Object.freeze({repair:{cost:{alloy:1},work:6},remove:{cost:{},work:5}});
const kinds=Object.values(RISER_KIND),fields=['id','kind','lower','upper','hp','enabled'];
const point=p=>p&&Object.keys(p).length===3&&['x','y','z'].every(k=>Number.isSafeInteger(p[k]));
const shape=l=>l&&Object.keys(l).length===fields.length&&fields.every(k=>Object.hasOwn(l,k))&&typeof l.id==='string'&&/^utility-[1-9][0-9]*$/.test(l.id)&&kinds.includes(l.kind)&&point(l.lower)&&point(l.upper)&&l.lower.x===l.upper.x&&l.lower.y===l.upper.y&&l.upper.z===l.lower.z+1&&Number.isFinite(l.hp)&&l.hp>=0&&l.hp<=100&&typeof l.enabled==='boolean';
const node=(t,kind)=>kind==='power'?(t?.building==='breaker'?null:t?.cable):kind==='gas'?t?.pipe:t?.waterPipe;
const portReady=(t,kind)=>{const p=node(t,kind);return !!p&&(kind==='power'?p.hp>0&&p.enabled:p.open===true);};
const reject=(code,message)=>({ok:false,code,message});
const id=(site,p)=>tileEntityId(site.id,p.x,p.y,p.z);
export function utilityLinks(site,kind=null){
 return (site?.utilityLinks||[]).filter(l=>shape(l)&&(!kind||l.kind===kind)&&[l.lower,l.upper].every(p=>tileAt(site,p)?.risers?.[l.kind]===l.id));
}
export function utilityAt(site,p,kind){return utilityLinks(site,kind).find(l=>sameCell(l.lower,p)||sameCell(l.upper,p))||null;}
export const utilityActive=(site,link)=>link.enabled&&link.hp>=50&&[link.lower,link.upper].every(p=>portReady(tileAt(site,p),link.kind));
export const activeUtilityLinks=(site,kind)=>utilityLinks(site,kind).filter(l=>utilityActive(site,l));
export function utilityNeighbors(site,p,kind){return activeUtilityLinks(site,kind).flatMap(l=>sameCell(l.lower,p)?[l.upper]:sameCell(l.upper,p)?[l.lower]:[]);}
export function utilityJobClaims(j,p,site){
 const kind=riserKind(j.building);if(!kind)return false;
 if(j.kind==='build')return sameCell(j,p)||sameCell({...positionOf(j),z:j.z+1},p);
 const l=site?.utilityLinks?.find(l=>l.id===j.utilityConnection);return !!l&&(sameCell(l.lower,p)||sameCell(l.upper,p));
}
function claims(s,site,ends,ignoreJob){
 return s.jobs.some(j=>j.id!==ignoreJob&&j.site===site.id&&ends.some(p=>sameCell(j,p)||utilityJobClaims(j,p,site)||stairJobClaims(j,p,site)));
}
export function riserPlacement(s,site,lower,building,ignoreJob=null){
 const kind=riserKind(building),upper={...positionOf(lower),z:lower.z+1},ends=[lower,upper];
 if(!kind||!['surface','wreck'].includes(site.id))return reject('riser_site','Build risers within an existing colony site.');
 for(const p of ends){
  const t=tileAt(site,p),port=node(t,kind);
  if(t?.terrain!=='floor')return reject('riser_floor','Both riser ends need existing habitat floors, one directly above the other.');
  if(!port||port.hp<(kind==='power'?1:50))return reject('riser_ports',`Build or repair the ${kind==='power'?'cable':kind+' pipe'} at both ends first.`);
  if(t.fire||t.risers?.[kind])return reject('riser_occupied','Clear the fire or existing riser at both endpoints.');
 }
 if(claims(s,site,ends,ignoreJob))return reject('riser_reserved','Finish or cancel work claiming either riser endpoint.');
 return {ok:true,kind,upper};
}
export function commissionUtility(s,site,job){
 const ready=riserPlacement(s,site,positionOf(job),job.building,job.id);if(!ready.ok)return ready;
 const link={id:`utility-${s.nextId++}`,kind:ready.kind,lower:positionOf(job),upper:ready.upper,hp:100,enabled:true};site.utilityLinks.push(link);
 for(const p of [link.lower,link.upper]){const t=tileAt(site,p);t.risers??={};t.risers[link.kind]=link.id;}
 emitEvent(s,'utility.constructed',{entity:`site:${site.id}`,connection:link.id,kind:link.kind,actor:job.worker,job:job.id,lower:id(site,link.lower),upper:id(site,link.upper),cost:job.cost});
 return {ok:true};
}
export function utilityWorkReady(s,site,link,kind,ignoreJob=null){
 if(!link)return reject('missing_riser','Select an existing utility riser.');
 if(!Object.hasOwn(UTILITY_WORK,kind))return reject('riser_work','Choose repair or dismantle.');
 if(claims(s,site,[link.lower,link.upper],ignoreJob))return reject('riser_reserved','Finish or cancel work claiming either riser endpoint.');
 if([link.lower,link.upper].some(p=>tileAt(site,p)?.fire))return reject('riser_fire','Suppress the fire at both endpoints first.');
 return {ok:true};
}
export function completeUtilityWork(s,site,job){
 const link=utilityAt(site,positionOf(job),riserKind(job.building));
 if(link?.id!==job.utilityConnection)return reject('missing_riser','The designated riser no longer exists.');
 const ready=utilityWorkReady(s,site,link,job.kind,job.id);if(!ready.ok)return ready;
 const event={entity:`site:${site.id}`,connection:link.id,kind:link.kind,actor:job.worker,job:job.id,lower:id(site,link.lower),upper:id(site,link.upper),cost:job.cost};
 if(job.kind==='repair'){const previous=link.hp;link.hp=100;emitEvent(s,'utility.repaired',{...event,previous,condition:100});return {ok:true};}
 for(const p of [link.lower,link.upper]){const t=tileAt(site,p);delete t.risers[link.kind];if(!Object.keys(t.risers).length)delete t.risers;}
 site.utilityLinks=site.utilityLinks.filter(l=>l.id!==link.id);const refund={alloy:1};
 emitEvent(s,'utility.removed',{...event,refund});return {ok:true,refund};
}
export function configureUtility(s,siteId,connection,enabled){
 const site=s.sites[siteId],link=utilityLinks(site).find(l=>l.id===connection);
 if(!link||typeof enabled!=='boolean')return reject('missing_riser','Select a utility riser and a valid isolation setting.');
 if(enabled&&link.hp<50)return reject('damaged_riser','Repair the damaged riser before enabling it.');
 if(link.enabled===enabled)return {ok:true};const previous=link.enabled;link.enabled=enabled;
 emitEvent(s,'utility.isolation.changed',{entity:`site:${siteId}`,connection,kind:link.kind,previous,enabled});return {ok:true};
}
export function damageUtility(s,site,t,target,amount,cause){
 const kind={cable:'power',pipe:'gas',waterPipe:'water'}[target],link=kind&&utilityAt(site,positionOf(t),kind);
 if(!link||link.hp<=0)return;const previous=link.hp;link.hp=Math.max(0,link.hp-amount);
 emitEvent(s,'utility.damaged',{entity:`site:${site.id}`,connection:link.id,kind,at:id(site,t),cause,amount:previous-link.hp,condition:link.hp});
}
export function validateUtilityState(s){
 if(s.version<57){
  if(Object.values(s.sites).some(site=>Object.hasOwn(site,'utilityLinks')||site.tiles.some(t=>Object.hasOwn(t,'risers')||riserKind(t.building)))||s.jobs.some(j=>Object.hasOwn(j,'utilityConnection')||riserKind(j.building)))throw new Error('Legacy save contains utility riser fields.');
  return;
 }
 const ids=new Set();
 for(const site of Object.values(s.sites)){
  if(!Array.isArray(site.utilityLinks))throw new Error('Invalid utility link list.');
  for(const l of site.utilityLinks){
   if(!shape(l)||ids.has(l.id)||Number(l.id.slice(8))>=s.nextId||![l.lower,l.upper].every(p=>tileAt(site,p)?.terrain==='floor'&&tileAt(site,p).risers?.[l.kind]===l.id)||!['surface','wreck'].includes(site.id))throw new Error('Invalid utility riser.');
   ids.add(l.id);
  }
  for(const t of site.tiles){
   if(riserKind(t.building))throw new Error('Utility risers cannot occupy the structure slot.');
   if(!Object.hasOwn(t,'risers'))continue;
   if(!t.risers||Array.isArray(t.risers)||!Object.keys(t.risers).length||Object.entries(t.risers).some(([kind,ref])=>!kinds.includes(kind)||!site.utilityLinks.some(l=>l.id===ref&&l.kind===kind&&(sameCell(t,l.lower)||sameCell(t,l.upper)))))throw new Error('Orphan utility riser endpoint.');
  }
 }
}
export function validateUtilityJobs(s){
 for(const job of s.jobs){
  const kind=riserKind(job.building);if(!kind&&!Object.hasOwn(job,'utilityConnection'))continue;
  const site=s.sites[job.site],definition=job.kind==='build'?BUILDINGS[job.building]:UTILITY_WORK[job.kind],link=utilityAt(site,positionOf(job),kind);
  if(!kind||!definition||job.work!==definition.work||Object.keys(job.cost).length!==Object.keys(definition.cost).length||Object.entries(definition.cost).some(([r,n])=>job.cost[r]!==n)|| (job.kind==='build'?Object.hasOwn(job,'utilityConnection'):!link||job.utilityConnection!==link.id))throw new Error('Invalid paid utility riser order.');
  const ends=job.kind==='build'?[positionOf(job),{...positionOf(job),z:job.z+1}]:[link.lower,link.upper];
  if(ends.some(p=>!tileAt(site,p))||claims(s,site,ends,job.id))throw new Error('Invalid utility endpoint reservation.');
 }
}
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function utilityDetails(site,t){
 return utilityLinks(site).filter(l=>sameCell(l.lower,t)||sameCell(l.upper,t)).map(l=>{const building=Object.keys(RISER_KIND).find(k=>RISER_KIND[k]===l.kind);return `<hr><div class="eyebrow">${l.kind.toUpperCase()} RISER · FLOORS ${l.lower.z} ↔ ${l.upper.z}</div><p>Condition ${Math.round(l.hp)}% · ${utilityActive(site,l)?'Connected':l.enabled?'Ports blocked or damaged':'Isolated'}. Stair hatches do not control this connection.</p><button data-action="utility-toggle" data-simulation-action="utility.configure" data-connection="${esc(l.id)}" data-enabled="${!l.enabled}" aria-pressed="${l.enabled}">${l.enabled?'Isolate':'Enable'} riser</button>${l.hp<100?`<button data-action="utility-repair" data-simulation-action="job.order" data-building="${building}">Repair riser · 1 alloy</button>`:''}<button data-action="utility-remove" data-simulation-action="job.order" data-building="${building}">Dismantle riser · recover 1 alloy</button><p>Endpoint cables/pipes and their contents remain in place.</p>`;}).join('');
}
