import { take, add, quantity, OUTPUT_CAPACITY } from './inventory.js';
import { roomAt } from './atmosphere.js';
import { refreshPower } from './power.js';
import { damage } from './maintenance.js';
import { emitEvent, tileEntityId } from './telemetry.js';
export const LIQUID = { capacity:4, flow:.5, release:.5, pump:.5, wet:.25, quench:.25, faultPower:5, faultDamage:.25 };
const at=(site,x,y)=>x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
const neighbors=(site,t)=>[[t.x+1,t.y],[t.x-1,t.y],[t.x,t.y+1],[t.x,t.y-1]].map(([x,y])=>at(site,x,y)).filter(Boolean);
export function liquidOpen(site,t,tick=site.atmosphere.tick){
 if(!t||t.terrain==='rock'||t.building==='wall'&&t.hp>0)return false;
 if(t.building==='door'&&t.hp>0)return t.doorMode==='open'||t.doorMode==='auto'&&t.doorUntil>tick;
 return true;
}
export function initializeLiquidTile(t){if(t.building==='waterTank')t.tank??={drain:false};}
export function initializeLiquids(s){
 for(const site of Object.values(s.sites)){
  site.liquids={released:0,recovered:0,lost:0,quenched:0,faultEnergy:0,faultHeatVented:0};
  for(const t of site.tiles){t.liquid=0;t.wetShort=false;initializeLiquidTile(t);}
 }
}
export function releaseWater(s,site,t,amount,cause){
 const n=Math.min(amount,t.machine?.input.water||0,LIQUID.capacity-t.liquid);if(n<=1e-9)return 0;
 take(t.machine.input,{water:n});t.liquid+=n;site.liquids.released+=n;
 emitEvent(s,'water.released',{entity:tileEntityId(site.id,t.x,t.y),amount:n,cause,from:'machine.input',to:'floor'});return n;
}
function transfer(s,site,a,b){
 if(!liquidOpen(site,a,s.tick)||!liquidOpen(site,b,s.tick))return;
 if(a.liquid<b.liquid)[a,b]=[b,a];
 const n=Math.min(LIQUID.flow,(a.liquid-b.liquid)*.25,LIQUID.capacity-b.liquid);if(n<=1e-9)return;
 a.liquid-=n;b.liquid+=n;emitEvent(s,'water.flowed',{from:tileEntityId(site.id,a.x,a.y),to:tileEntityId(site.id,b.x,b.y),amount:n});
}
export function flowLiquids(s){
 for(const site of Object.values(s.sites)){
  for(const t of site.tiles)if(t.building==='waterTank'){
   const leaking=t.hp<50,rate=leaking?LIQUID.release*(1-t.hp/50):0;
   releaseWater(s,site,t,Math.max(rate,t.tank.drain?LIQUID.release:0),leaking&&t.tank.drain?'drain_and_damage':leaking?'damaged_tank':'drain_valve');
  }
  if(!site.tiles.some(t=>t.liquid>0))continue;
  const cells=s.tick%2?site.tiles:[...site.tiles].reverse();
  for(const t of cells)if(t.liquid>0||neighbors(site,t).some(n=>n.liquid>0)){
   const pair=[at(site,t.x+1,t.y),at(site,t.x,t.y+1)];for(const n of pair)if(n)transfer(s,site,t,n);
  }
  for(const t of site.tiles)if(t.liquid>0&&liquidOpen(site,t,s.tick)){
   const space=t.terrain==='void',edge=t.x===0||t.y===0||t.x===site.size-1||t.y===site.size-1;
   const soil=['ground','ore'].includes(t.terrain),n=space?t.liquid:edge?Math.min(.5,t.liquid):soil?Math.min(.1,t.liquid):0;
   if(n>0){t.liquid-=n;site.liquids.lost+=n;emitEvent(s,'water.lost',{entity:tileEntityId(site.id,t.x,t.y),amount:n,cause:space?'space':edge?'map_edge':'ground_drainage'});}
  }
 }
}
export function pumpLiquids(s){
 for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.building==='bilgePump'){
  const m=t.machine;
  let status=t.fire?'Fire at pump':!m.enabled?'Paused by player':t.hp<=0?'Needs repair':!t.powered?'No power':quantity(m.output)>=OUTPUT_CAPACITY-1e-9?'Output full; needs hauling':null;
  let remaining=Math.min(LIQUID.pump*t.hp/100,OUTPUT_CAPACITY-quantity(m.output)),moved=0;
  if(!status)for(const from of [t,...neighbors(site,t)]){
   if(!liquidOpen(site,from,s.tick))continue;
   const n=Math.min(remaining,from.liquid);if(n<=1e-9)continue;
   from.liquid-=n;remaining-=n;moved+=n;add(m.output,{water:n});site.liquids.recovered+=n;
   emitEvent(s,'water.pumped',{entity:tileEntityId(site.id,t.x,t.y),from:tileEntityId(site.id,from.x,from.y),amount:n,to:'machine.output'});
  }
  m.status=status||(moved?'Recovering floor water':'Floor dry');
 }
}
export const wetCable=t=>!!(t.cable?.enabled&&t.cable.hp>0&&(t.liquid||0)>=LIQUID.wet);
export function shortCable(s,site,t){
 const energy=LIQUID.faultPower;site.liquids.faultEnergy+=energy;
 const room=roomAt(site,t.x,t.y);if(room){room.heat+=energy;site.thermal.equipment+=energy;}else site.liquids.faultHeatVented+=energy;
 damage(s,site,t,'cable',LIQUID.faultDamage,'water');
 emitEvent(s,'power.wet_short',{entity:tileEntityId(site.id,t.x,t.y),energy,condition:t.cable.hp});
}
export function quenchWater(s,site,t){
 if(t.liquid<LIQUID.quench)return false;
 t.liquid-=LIQUID.quench;site.liquids.quenched+=LIQUID.quench;
 emitEvent(s,'water.used_for_fire',{entity:tileEntityId(site.id,t.x,t.y),amount:LIQUID.quench});return true;
}
export function setTank(s,siteId,x,y,fill,drain){
 const site=s.sites[siteId],t=site&&at(site,x,y);
 if(t?.building!=='waterTank'||typeof fill!=='boolean'||typeof drain!=='boolean')return {ok:false,message:'Choose a water tank and fill/drain controls.'};
 t.machine.enabled=fill;t.tank.drain=drain;emitEvent(s,'water.tank.changed',{entity:tileEntityId(siteId,x,y),fill,drain});refreshPower(s,site);return {ok:true};
}
export function validateLiquids(s){
 const amount=n=>Number.isFinite(n)&&n>=0;
 for(const site of Object.values(s.sites)){
  const l=site.liquids;if(!l||!['released','recovered','lost','quenched','faultEnergy','faultHeatVented'].every(k=>amount(l[k]))||l.faultHeatVented>l.faultEnergy+1e-8)throw new Error('Invalid liquid ledger.');
  let stored=0;
  for(const t of site.tiles){
   if(!amount(t.liquid)||t.liquid>LIQUID.capacity+1e-8||typeof t.wetShort!=='boolean')throw new Error('Invalid floor water.');stored+=t.liquid;
   if(t.building==='waterTank'?!t.tank||typeof t.tank.drain!=='boolean':t.tank!==undefined)throw new Error('Invalid water tank controls.');
  }
  const expected=l.released-l.recovered-l.lost-l.quenched;
  if(!Number.isFinite(expected)||Math.abs(stored-expected)>1e-6+Math.abs(l.released)*1e-9)throw new Error('Floor water does not balance.');
 }
}
