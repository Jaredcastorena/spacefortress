import test from 'node:test';
import assert from 'node:assert/strict';
import { tileAt } from '../src/spatial.js';
import { flowLiquids, releaseWater, pumpLiquids, quenchWater, wetCable, validateLiquids } from '../src/liquids.js';
import { absorbCultivationWater } from '../src/flora.js';
import { newWaterPipe, initializePlumbingTile, flowPlumbing, operatePlumbing, removePlumbing, validatePlumbing, plumbingStatus } from '../src/plumbing.js';
import { MELTING_KELVIN, WATER_LATENT_HEAT, waterHeatAt, parcelHeat, putWater, waterPhase, storedWaterHeat, validateWaterThermal } from '../src/water-thermal.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){
  const site={id:'surface',size:7,levels:[{z:0},{z:1}],tiles:[],atmosphere:{tick:0},verticalLinks:[],utilityLinks:[],
    thermal:{waterInitial:0,waterLoaded:0,waterRemoved:0},plumbing:{loaded:0,recovered:0,delivered:0,released:0},
    liquids:{released:0,recovered:0,lost:0,quenched:0,absorbed:0,faultEnergy:0,faultHeatVented:0}};
  for(let z=0;z<=1;z++)for(let y=0;y<7;y++)for(let x=0;x<7;x++)site.tiles.push({x,y,z,terrain:'rock',building:null,hp:100,liquid:0,liquidHeat:0,wetShort:false,waterPipe:null});
  const s={tick:0,sites:{surface:site},jobs:[],crew:[]};
  const floor=(x,y,z=0)=>{const t=tileAt(site,{x,y,z});t.terrain='floor';return t;};
  const pipe=(x,y,z=0)=>{const t=floor(x,y,z);t.waterPipe=newWaterPipe();return t;};
  const seed=(t,total,kelvin,{node=false,liquid=null}={})=>{
    const heat=liquid===null?waterHeatAt(total,kelvin):total*(MELTING_KELVIN-WATER_LATENT_HEAT)+liquid*WATER_LATENT_HEAT;
    putWater(node?t.waterPipe:t,total,heat,node?undefined:{floor:true});site.thermal.waterLoaded+=heat;site[node?'plumbing':'liquids'][node?'loaded':'released']+=total;
  };
  const heatTo=(t,kelvin,node=false)=>{const owner=node?t.waterPipe:t,field=node?'heat':'liquidHeat',total=node?owner.water:owner.liquid,heat=waterHeatAt(total,kelvin);site.thermal.waterLoaded+=heat-owner[field];owner[field]=heat;};
  const check=()=>{validateLiquids(s);validatePlumbing(s);validateWaterThermal(site);close(storedWaterHeat(site),site.thermal.waterLoaded-site.thermal.waterRemoved);};
  return {s,site,floor,pipe,seed,heatTo,check};
}
function device(f,building,mode='floor'){
  const t=f.floor(3,3);t.building=building;t.powered=true;initializePlumbingTile(t);t.waterDevice.direction='n';
  if(building!=='waterPump')t.waterDevice.mode=mode;
  return t;
}
const phase=t=>waterPhase(t,{floor:true});

test('ice stops horizontal floor flow; partial melting releases only liquid with exact residual ice',()=>{
  const f=fixture(),a=f.floor(3,3),b=f.floor(3,4);f.seed(a,1,250);flowLiquids(f.s);close(a.liquid,1);close(b.liquid,0);
  const heat=a.liquid*(MELTING_KELVIN-WATER_LATENT_HEAT)+.5*WATER_LATENT_HEAT;f.site.thermal.waterLoaded+=heat-a.liquidHeat;a.liquidHeat=heat;
  flowLiquids(f.s);close(b.liquid,.125);close(phase(a).ice,.5);close(b.liquidHeat,parcelHeat(.125,MELTING_KELVIN));f.check();
});

test('stairs preserve upper ice while their finite liquid parcel reaches the actual lower floor',()=>{
  const f=fixture(),lower=f.floor(3,3),upper=f.floor(3,3,1),link={id:'vertical-1',kind:'stairwell',lower:{x:3,y:3,z:0},upper:{x:3,y:3,z:1},hp:100,mode:'open',openUntil:0};
  f.site.verticalLinks=[link];lower.verticalLink=upper.verticalLink=link.id;f.seed(upper,1,MELTING_KELVIN,{liquid:.2});
  flowLiquids(f.s);close(upper.liquid,.8);close(phase(upper).ice,.8);close(lower.liquid,.2);close(lower.liquidHeat,parcelHeat(.2,MELTING_KELVIN));f.check();
});

test('frozen pump sources differ from empty sources and thawing restores movement',()=>{
  const f=fixture(),a=f.pipe(3,4),b=f.pipe(3,2),pump=device(f,'waterPump');f.seed(a,1,250,{node:true});
  const before=JSON.stringify(f.s),status=plumbingStatus(f.s,f.site,pump);assert.equal(status.blockedCode,'source_frozen');close(status.sourceWater,1);close(status.sourceAvailable,0);assert.equal(JSON.stringify(f.s),before);
  const nodeStatus=plumbingStatus(f.s,f.site,a);assert.equal(nodeStatus.phase,'solid');close(nodeStatus.ice,1);close(nodeStatus.liquid,0);close(nodeStatus.temperature,250-273.15);
  operatePlumbing(f.s);close(b.waterPipe.water,0);f.heatTo(a,300,true);operatePlumbing(f.s);close(b.waterPipe.water,.5);close(a.waterPipe.water,.5);f.check();
  const empty=fixture(),emptyPump=device(empty,'waterPump');empty.pipe(3,4);empty.pipe(3,2);assert.equal(plumbingStatus(empty.s,empty.site,emptyPump).blockedCode,'source_empty');
});

test('partly frozen pumps withdraw liquid without exporting the source ice',()=>{
  const f=fixture(),a=f.pipe(3,4),b=f.pipe(3,2);device(f,'waterPump');f.seed(a,1.5,MELTING_KELVIN,{node:true,liquid:.2});
  operatePlumbing(f.s);close(a.waterPipe.water,1.3);close(waterPhase(a.waterPipe).ice,1.3);close(b.waterPipe.water,.2);close(b.waterPipe.heat,parcelHeat(.2,MELTING_KELVIN));f.check();
});

test('water risers and damaged fittings transport only liquid and keep frozen mass',()=>{
  const f=fixture(),lower=f.pipe(3,3),upper=f.pipe(3,3,1),link={id:'utility-1',kind:'water',lower:{x:3,y:3,z:0},upper:{x:3,y:3,z:1},hp:100,enabled:true};
  f.site.utilityLinks=[link];lower.risers=upper.risers={water:link.id};f.seed(lower,1.5,MELTING_KELVIN,{node:true,liquid:.2});flowPlumbing(f.s);
  close(upper.waterPipe.water,.2);close(waterPhase(lower.waterPipe).ice,1.3);lower.waterPipe.hp=0;flowPlumbing(f.s);close(lower.liquid,0);close(lower.waterPipe.water,1.3);f.check();
  const g=fixture(),t=g.pipe(3,3);g.seed(t,1.5,MELTING_KELVIN,{node:true,liquid:.2});t.waterPipe.hp=0;flowPlumbing(g.s);close(t.liquid,.2);close(waterPhase(t.waterPipe).ice,1.3);g.check();
});

test('ice occupies node and floor capacity and limits incoming water',()=>{
  const f=fixture(),a=f.pipe(3,4),b=f.pipe(3,2);device(f,'waterPump');f.seed(a,1,300,{node:true});f.seed(b,1.75,250,{node:true});operatePlumbing(f.s);
  const headroom = 2 - 1.75 * 1.09;
  close(a.waterPipe.water,1-headroom);close(b.waterPipe.water,1.75+headroom);
  close(plumbingStatus(f.s,f.site,b).targetFree,0);f.check();
  const g=fixture(),tank=g.floor(3,3);tank.building='waterTank';tank.tank={drain:false};tank.machine={input:{water:1}};g.seed(tank,4,250);
  close(releaseWater(g.s,g.site,tank,.5,'test'),0);close(tank.machine.input.water,1);close(tank.liquid,4);g.check();
});

test('floor intakes and bilge pumps recover liquid while leaving ice in place',()=>{
  const f=fixture(),source=f.floor(3,4),target=f.pipe(3,2),intake=device(f,'waterIntake');f.seed(source,1,250);
  assert.equal(plumbingStatus(f.s,f.site,intake).blockedCode,'source_frozen');operatePlumbing(f.s);close(target.waterPipe.water,0);
  f.heatTo(source,300);operatePlumbing(f.s);close(target.waterPipe.water,.5);f.check();
  const g=fixture(),t=g.floor(3,3);t.building='bilgePump';t.powered=true;t.machine={enabled:true,output:{}};g.seed(t,1,MELTING_KELVIN,{liquid:.2});pumpLiquids(g.s);
  close(t.machine.output.water,.2);close(phase(t).ice,.8);close(g.site.thermal.waterRemoved,parcelHeat(.2,MELTING_KELVIN));g.check();
});

test('cultivation, fire and cable faults require liquid instead of frozen mass',()=>{
  const f=fixture(),t=f.floor(3,3);t.terrain='ground';t.cable={hp:100,enabled:true};t.flora={fungalcap:{origin:'cultivated',generation:'test',moisture:0}};f.site.cultivation={fungalcap:{absorbed:0}};f.seed(t,1,250);
  assert.equal(wetCable(t),false);assert.equal(quenchWater(f.s,f.site,t),false);close(absorbCultivationWater(f.s,f.site,t,.2),0);
  f.heatTo(t,300);assert.equal(wetCable(t),true);assert.equal(quenchWater(f.s,f.site,t),true);close(absorbCultivationWater(f.s,f.site,t,.2),.2);f.check();
});

test('void drainage removes liquid enthalpy and leaves the frozen portion balanced',()=>{
  const f=fixture(),t=f.floor(3,3);t.terrain='void';f.seed(t,1,MELTING_KELVIN,{liquid:.2});flowLiquids(f.s);
  close(t.liquid,.8);close(phase(t).ice,.8);close(f.site.liquids.lost,.2);close(f.site.thermal.waterRemoved,parcelHeat(.2,MELTING_KELVIN));f.check();
});

test('retained basin ice occupies depth while excess liquid can drain',()=>{
  const f=fixture(),t=f.floor(3,3);t.terrain='ground';t.basin=1;f.seed(t,1.5,MELTING_KELVIN,{liquid:.5});flowLiquids(f.s);
  assert.ok(f.site.liquids.lost>0&&f.site.liquids.lost<=.5);close(phase(t).ice,1);close(t.liquid+f.site.liquids.lost,1.5);f.check();
});

test('dismantling recovers all phases and exports their exact combined enthalpy',()=>{
  for(const liquid of [0,.2]){
    const f=fixture(),t=f.pipe(3,3);f.seed(t,1,MELTING_KELVIN,{node:true,liquid});const heat=t.waterPipe.heat;
    removePlumbing(f.s,f.site,t,t,true);assert.equal(t.waterPipe,null);close(t.drop.water,1);close(f.site.plumbing.delivered,1);close(f.site.thermal.waterRemoved,heat);f.check();
  }
});
