import { REACTOR_RULES } from './reactor-rules.js';
import { roomAt } from './atmosphere.js';
import { temperatureAt } from './thermal.js';
import { refreshPower } from './power.js';
import { take } from './inventory.js';
import { emitEvent, tileEntityId } from './telemetry.js';
export const REACTOR = { ...REACTOR_RULES, capacity:4, conductance:.5, radiatorRate:32, vacuumLimit:.05 };
const at=(site,x,y)=>site?.tiles.find(t=>t.x===x&&t.y===y);
export function initializeReactorTile(t){
 if(t.building==='reactor')t.reactor??={output:100,tripped:false,heat:0};
 if(t.building==='radiator')t.radiator??={enabled:true,status:'Waiting for thermal exchange'};
}
export function initializeReactors(s){for(const site of Object.values(s.sites)){site.reactorLedger={fuelUsed:0,generated:0,heatMade:0,toRooms:0,radiated:0,discarded:0};site.tiles.forEach(initializeReactorTile);}}
export const coreTemperature=t=>20+(t.reactor?.heat||0)/REACTOR.capacity;
export const reactorTemperature=(site,t)=>Math.max(coreTemperature(t),temperatureAt(site,t.x,t.y));
export function reactorBlock(site,t){
 if(t.hp<=0)return 'Needs repair';
 if(t.fire)return 'Fire at reactor';
 if(t.reactor.tripped||reactorTemperature(site,t)>=REACTOR.tripTemperature)return 'Overheat shutdown';
 if(!t.machine.enabled)return 'Paused by player';
 if(!t.reactor.output)return 'Output set to zero';
 if(!(t.machine.input.fuel>0))return 'Waiting for fuel delivery';
 return null;
}
export function reactorOutput(site,t){
 if(reactorBlock(site,t))return 0;
 return Math.min(t.machine.input.fuel,REACTOR.fuelRate*t.reactor.output/100*t.hp/100)/REACTOR.fuelRate*REACTOR.supply;
}
export function tripReactor(s,site,t){
 if(t.reactor.tripped||reactorTemperature(site,t)<REACTOR.tripTemperature)return;
 t.reactor.tripped=true;
 emitEvent(s,'reactor.tripped',{entity:tileEntityId(site.id,t.x,t.y),temperature:reactorTemperature(site,t),limit:REACTOR.tripTemperature});
 s.log.unshift({tick:s.tick,message:`Reactor at ${t.x}/${t.y} shut down from heat. Restore cooling, then reset below 60°C.`,type:'danger'});s.log=s.log.slice(0,60);
}
export function generateReactor(s,site,t,output){
 if(!output)return;
 const fuel=Math.min(t.machine.input.fuel,output/REACTOR.supply*REACTOR.fuelRate),heat=output/REACTOR.supply*REACTOR.heat;
 take(t.machine.input,{fuel});t.reactor.heat+=heat;site.reactorLedger.fuelUsed+=fuel;site.reactorLedger.generated+=output;site.reactorLedger.heatMade+=heat;
 emitEvent(s,'reactor.generated',{entity:tileEntityId(site.id,t.x,t.y),fuel,power:output,heat});
}
// A radiator includes a short sealed thermal feedthrough: adjacent, or two tiles
// away in a straight line through an intact hull wall. No diagonal/long-range links.
export function radiatorTargets(site,t){
 const targets=[];
 for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
  const near=at(site,t.x+dx,t.y+dy),far=near?.building==='wall'&&near.hp>0?at(site,t.x+2*dx,t.y+2*dy):null;
  const reactor=near?.building==='reactor'?near:far?.building==='reactor'?far:null;
  if(reactor)targets.push(reactor);
 }
 return targets;
}
export function radiatorBlock(site,t){
 if(t.hp<=0)return 'Needs repair';if(t.fire)return 'Fire at radiator';if(!t.radiator.enabled)return 'Paused by player';
 if((roomAt(site,t.x,t.y)?.pressure||0)/100>REACTOR.vacuumLimit)return 'Needs exterior or near-vacuum';
 if(!radiatorTargets(site,t).length)return 'No reactor thermal connection';return null;
}
export function updateReactorCooling(s){
 for(const site of Object.values(s.sites)){
  for(const t of site.tiles)if(t.building==='reactor'){
   const room=roomAt(site,t.x,t.y);
   if(room){const heat=Math.min(t.reactor.heat,Math.max(0,coreTemperature(t)-temperatureAt(site,t.x,t.y))*REACTOR.conductance);
    if(heat>1e-9){t.reactor.heat-=heat;room.heat+=heat;site.thermal.equipment+=heat;site.reactorLedger.toRooms+=heat;emitEvent(s,'reactor.heat.transferred',{entity:tileEntityId(site.id,t.x,t.y),heat,destination:'compartment'});}
   }
  }
  for(const t of site.tiles)if(t.building==='radiator'){
   const blocked=radiatorBlock(site,t);let remaining=REACTOR.radiatorRate*t.hp/100;
   if(!blocked)for(const target of radiatorTargets(site,t)){
    const heat=Math.min(target.reactor.heat,remaining);if(heat<=1e-9)continue;
    target.reactor.heat-=heat;remaining-=heat;site.reactorLedger.radiated+=heat;
    emitEvent(s,'reactor.heat.radiated',{entity:tileEntityId(site.id,t.x,t.y),from:tileEntityId(site.id,target.x,target.y),heat,destination:'space'});
   }
   const status=blocked||(remaining<REACTOR.radiatorRate*t.hp/100?'Radiating reactor heat':'Thermal connection idle');
   if(status!==t.radiator.status)emitEvent(s,'radiator.status.changed',{entity:tileEntityId(site.id,t.x,t.y),previous:t.radiator.status,status});
   t.radiator.status=status;
  }
 }
}
export function releaseReactorHeat(s,site,t){
 if(!t.reactor)return;
 const heat=t.reactor.heat,room=roomAt(site,t.x,t.y);
 if(room){room.heat+=heat;site.thermal.equipment+=heat;site.reactorLedger.toRooms+=heat;}else site.reactorLedger.discarded+=heat;
 emitEvent(s,'reactor.removed',{entity:tileEntityId(site.id,t.x,t.y),heat,destination:room?'compartment':'space'});delete t.reactor;
}
export function setReactor(s,siteId,x,y,percent,enabled){
 const site=s.sites[siteId],t=at(site,x,y);
 if(t?.building!=='reactor'||!Number.isInteger(percent)||percent<0||percent>100||typeof enabled!=='boolean')return {ok:false,message:'Choose a reactor, an output from 0–100%, and an enabled state.'};
 const previous={output:t.reactor.output,enabled:t.machine.enabled};t.reactor.output=percent;t.machine.enabled=enabled;
 emitEvent(s,'reactor.controls.changed',{entity:tileEntityId(siteId,x,y),previous,output:percent,enabled});refreshPower(s,site);return {ok:true};
}
export function resetReactor(s,siteId,x,y){
 const site=s.sites[siteId],t=at(site,x,y);
 if(t?.building!=='reactor'||!t.reactor.tripped)return {ok:false,message:'Select a reactor with a latched shutdown.'};
 if(t.hp<=0||t.fire||reactorTemperature(site,t)>REACTOR.resetTemperature)return {ok:false,message:'Repair and cool the reactor to 60°C or below, and suppress any fire first.'};
 t.reactor.tripped=false;emitEvent(s,'reactor.reset',{entity:tileEntityId(siteId,x,y),temperature:reactorTemperature(site,t)});refreshPower(s,site);return {ok:true};
}
export function setRadiator(s,siteId,x,y,enabled){
 const t=at(s.sites[siteId],x,y);if(t?.building!=='radiator'||typeof enabled!=='boolean')return {ok:false,message:'Select a radiator.'};
 t.radiator.enabled=enabled;emitEvent(s,'radiator.controls.changed',{entity:tileEntityId(siteId,x,y),enabled});return {ok:true};
}
export function validateReactors(s){
 const amount=n=>Number.isFinite(n)&&n>=0,close=(a,b)=>Math.abs(a-b)<1e-6+Math.abs(b)*1e-9;
 for(const site of Object.values(s.sites)){
  const h=site.reactorLedger;
  if(!h||!['fuelUsed','generated','heatMade','toRooms','radiated','discarded'].every(k=>amount(h[k])))throw new Error('Invalid reactor ledger.');
  let stored=0;
  for(const t of site.tiles){
   if(t.building==='reactor'){
    const r=t.reactor;if(!r||!Number.isInteger(r.output)||r.output<0||r.output>100||typeof r.tripped!=='boolean'||!amount(r.heat))throw new Error('Invalid reactor controls or heat.');stored+=r.heat;
   }else if(t.reactor!==undefined)throw new Error('Reactor state attached to missing reactor.');
   if(t.building==='radiator'){
    const r=t.radiator;if(!r||typeof r.enabled!=='boolean'||typeof r.status!=='string'||r.status.length>100)throw new Error('Invalid radiator state.');
   }else if(t.radiator!==undefined)throw new Error('Radiator state attached to missing radiator.');
  }
  if(!close(stored,h.heatMade-h.toRooms-h.radiated-h.discarded)||!close(h.generated,h.fuelUsed/REACTOR.fuelRate*REACTOR.supply)||!close(h.heatMade,h.generated/REACTOR.supply*REACTOR.heat))throw new Error('Reactor fuel or heat does not balance.');
 }
}
