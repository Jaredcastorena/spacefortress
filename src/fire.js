import { gasNode } from './gas-networks.js';
import { LIQUID, quenchWater } from './liquids.js';
import { BUILDINGS } from './data.js';
import { roomAt, refreshRoom, moveCrew } from './atmosphere.js';
import { temperature } from './thermal.js';
import { damage } from './maintenance.js';
import { emitEvent, tileEntityId } from './telemetry.js';
export const FIRE={faultTicks:120,smokeLimit:.04,filterRate:.08,suppressionWater:2,suppressionWork:8,retry:120};
const adjacent=t=>[[t.x+1,t.y],[t.x-1,t.y],[t.x,t.y+1],[t.x,t.y-1]];
const at=(site,x,y)=>x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
export const combustible=t=>t?.hp>0&&!!BUILDINGS[t.building]&&!['floor','wall','door','fence','pastureGate','cable','solar','advanced','sculpture'].includes(t.building);
const oxygen=r=>!!r&&r.gas.oxygen/(r.volume*10)>=.12;
export function initializeFire(s){for(const site of Object.values(s.sites)){site.fireSafety??={automatic:true,smokeProduced:0,smokeCleared:0,smokeVented:0,oxygenBurned:0};site.thermal.combustion??=0;for(const r of site.rooms)r.smoke??=0;}}
export function ignite(s,site,t,cause='electrical_fault',parent=null){
 if((t.liquid||0)>=LIQUID.wet||t.fire||!combustible(t)||!oxygen(roomAt(site,t.x,t.y)))return false;
 t.fire={id:`fire-${s.nextId++}`,started:s.tick,age:0,intensity:20,retryAt:0,blocked:null};delete t.fireFault;
 emitEvent(s,'fire.ignited',{entity:t.fire.id,target:tileEntityId(site.id,t.x,t.y),cause,parent});s.log.unshift({tick:s.tick,message:`Fire at ${site.id} ${t.x}/${t.y}. Suppression needs delivered water; isolate damaged equipment.`,type:'danger'});s.log=s.log.slice(0,60);return true;
}
export function extinguish(s,site,t,reason,actor=null,job=null){
 if(!t.fire)return;emitEvent(s,'fire.extinguished',{entity:t.fire.id,target:tileEntityId(site.id,t.x,t.y),reason,actor,job});delete t.fire;delete t.fireFault;
}
export function updateFire(s){
 for(const site of Object.values(s.sites)){
  for(const t of site.tiles){
   if(t.fire)continue;
   if(!combustible(t)||!oxygen(roomAt(site,t.x,t.y))){delete t.fireFault;continue;}
   if(t.powered&&BUILDINGS[t.building]?.demand&&t.hp<=30){t.fireFault=(t.fireFault||0)+1;if(t.fireFault>=FIRE.faultTicks)ignite(s,site,t);}
   else delete t.fireFault;
   if(!t.fire&&temperature(roomAt(site,t.x,t.y))>=90)ignite(s,site,t,'overheating');
  }
  // A newly spread fire starts burning on the following tick.
  for(const t of site.tiles.filter(t=>t.fire)){
   const f=t.fire,r=roomAt(site,t.x,t.y);f.age++;
   if(quenchWater(s,site,t)){extinguish(s,site,t,'floor_water');continue;}
   if(!combustible(t)){extinguish(s,site,t,'fuel_exhausted');continue;}
   if(!oxygen(r)){f.intensity-=10;if(f.intensity<=0)extinguish(s,site,t,'oxygen_starved');continue;}
   f.intensity=Math.min(100,f.intensity+2);
   const consumed=Math.min(r.gas.oxygen,.002*f.intensity),smoke=consumed*.75,heat=consumed*1000;
   r.gas.oxygen-=consumed;r.gas.co2+=consumed;r.smoke+=smoke;r.heat+=heat;
   site.fireSafety.oxygenBurned+=consumed;site.fireSafety.smokeProduced+=smoke;site.thermal.combustion+=heat;
   damage(s,site,t,'structure',f.intensity*.005,'fire');if(t.cable)damage(s,site,t,'cable',f.intensity*.003,'fire');if(t.pipe)damage(s,site,t,'pipe',f.intensity*.003,'fire');if(t.waterPipe)damage(s,site,t,'waterPipe',f.intensity*.003,'fire');refreshRoom(r);
   emitEvent(s,'fire.burned',{entity:f.id,target:tileEntityId(site.id,t.x,t.y),oxygen:consumed,smoke,heat});
   if(t.hp<=0){extinguish(s,site,t,'fuel_exhausted');continue;}
   if(f.age%30===0&&f.intensity>=60){const next=adjacent(t).map(([x,y])=>at(site,x,y)).find(n=>combustible(n)&&!n.fire&&roomAt(site,n.x,n.y)===r);if(next)ignite(s,site,next,'spread',f.id);}
  }
 }
}
export function fireJobValid(s,j){return s.sites[j.site]?.tiles[j.y*s.sites[j.site].size+j.x]?.fire?.id===j.fire;}
export function prepareFire(s,order,cancelJob){
 for(const j of [...s.jobs])if(j.kind==='extinguish'&&!fireJobValid(s,j))cancelJob(s,j.id,true);
 for(const site of Object.values(s.sites))if(site.fireSafety.automatic)for(const t of site.tiles)if(t.fire&&s.tick>=t.fire.retryAt&&!s.jobs.some(j=>j.kind==='extinguish'&&j.site===site.id&&j.x===t.x&&j.y===t.y)){
  const result=order(s,site.id,t.x,t.y,'extinguish');t.fire.blocked=result.ok?null:result.message;
 }
}
export function setFireResponse(s,siteId,enabled){const site=s.sites[siteId];if(!site||typeof enabled!=='boolean')return {ok:false,message:'Choose a site and response policy.'};site.fireSafety.automatic=enabled;return {ok:true};}
export function evadeFire(s,c,site,pathTo,release){
 if(!at(site,c.x,c.y)?.fire)return false;
 release(s,c);const path=pathTo(site,c,site.tiles.filter(t=>!t.fire).map(t=>[t.x,t.y]));
 c.activity=path?.length?'Escaping a fire':'Trapped by fire';
 if(path?.length&&moveCrew(c,site,path[0])){const patient=c.rescue?.carrying&&s.crew.find(p=>p.id===c.rescue.patient);if(patient){patient.x=c.x;patient.y=c.y;}emitEvent(s,'fire.evacuated',{actor:c.id,target:tileEntityId(site.id,c.x,c.y)});}
 return true;
}
export function validateFire(s){
 const ids=new Set(),finite=n=>Number.isFinite(n)&&n>=0;
 for(const site of Object.values(s.sites)){
  const ledger=site.fireSafety;if(!ledger||typeof ledger.automatic!=='boolean'||!['smokeProduced','smokeCleared','smokeVented','oxygenBurned'].every(k=>finite(ledger[k]))||site.rooms.some(r=>!finite(r.smoke)))throw new Error('Invalid smoke state.');
  const expected=ledger.smokeProduced-ledger.smokeCleared-ledger.smokeVented,actual=site.rooms.reduce((n,r)=>n+r.smoke,0)+site.tiles.reduce((n,t)=>n+(gasNode(t)?.smoke||0),0);
  if(Math.abs(actual-expected)>1e-7+Math.abs(expected)*1e-9)throw new Error('Smoke does not balance.');
  for(const t of site.tiles){
   if(t.fireFault!==undefined&&(!Number.isInteger(t.fireFault)||t.fireFault<1||t.fireFault>=FIRE.faultTicks||t.fire))throw new Error('Invalid ignition countdown.');
   const f=t.fire;if(!f)continue;
   if(!/^fire-\d+$/.test(f.id)||Number(f.id.slice(5))>=s.nextId||ids.has(f.id)||!Number.isSafeInteger(f.started)||f.started<0||f.started>s.tick||!Number.isSafeInteger(f.age)||f.age<0||f.age>s.tick-f.started+1||!Number.isFinite(f.intensity)||f.intensity<=0||f.intensity>100||!Number.isSafeInteger(f.retryAt)||f.retryAt<0||f.retryAt>s.tick+FIRE.retry||(f.blocked!==null&&(typeof f.blocked!=='string'||f.blocked.length>200)))throw new Error('Invalid fire.');ids.add(f.id);
  }
 }
 const targets=new Set();for(const j of s.jobs.filter(j=>j.kind==='extinguish')){if(!fireJobValid(s,j)||targets.has(j.fire)||j.building!==null||j.work!==FIRE.suppressionWork||Object.keys(j.cost).length!==1||j.cost.water!==FIRE.suppressionWater)throw new Error('Invalid suppression order.');targets.add(j.fire);}
}
