import test from 'node:test';
import assert from 'node:assert/strict';
import { tileAt } from '../src/spatial.js';
import { flowLiquids, releaseWater, pumpLiquids, quenchWater, validateLiquids } from '../src/liquids.js';
import { absorbCultivationWater } from '../src/flora.js';
import { newWaterPipe, initializePlumbingTile, flowPlumbing, operatePlumbing, removePlumbing, validatePlumbing, plumbingStatus } from '../src/plumbing.js';
import { parcelHeat, putWater, waterKelvin, storedWaterHeat, validateWaterThermal } from '../src/water-thermal.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){
  const site={id:'surface',size:7,levels:[{z:0},{z:1}],tiles:[],atmosphere:{tick:0},verticalLinks:[],utilityLinks:[],
    thermal:{waterInitial:0,waterLoaded:0,waterRemoved:0},plumbing:{loaded:0,recovered:0,delivered:0,released:0},
    liquids:{released:0,recovered:0,lost:0,quenched:0,absorbed:0,faultEnergy:0,faultHeatVented:0}};
  for(let z=0;z<=1;z++)for(let y=0;y<7;y++)for(let x=0;x<7;x++)site.tiles.push({x,y,z,terrain:'rock',building:null,hp:100,liquid:0,liquidHeat:0,wetShort:false,waterPipe:null});
  const s={tick:0,sites:{surface:site},jobs:[],crew:[]};
  const floor=(x,y,z=0)=>{const t=tileAt(site,{x,y,z});t.terrain='floor';return t;};
  const pipe=(x,y,z=0)=>{const t=floor(x,y,z);t.waterPipe=newWaterPipe();return t;};
  const seed=(t,n,kelvin,{node=false}={})=>{putWater(node?t.waterPipe:t,n,parcelHeat(n,kelvin),node?undefined:{floor:true});site.thermal.waterLoaded+=parcelHeat(n,kelvin);site[node?'plumbing':'liquids'][node?'loaded':'released']+=n;};
  const check=()=>{validateLiquids(s);validatePlumbing(s);validateWaterThermal(site);close(storedWaterHeat(site),site.thermal.waterLoaded-site.thermal.waterRemoved);};
  return {s,site,floor,pipe,seed,check};
}
function device(f,building,mode='floor'){
  const t=f.floor(3,3);t.building=building;t.powered=true;initializePlumbingTile(t);t.waterDevice.direction='n';
  if(building!=='waterPump')t.waterDevice.mode=mode;
  return t;
}

test('horizontal floor flow carries source heat and mixes without losing energy',()=>{
  const f=fixture(),a=f.floor(3,3),b=f.floor(3,4);f.seed(a,3,360);f.seed(b,1,280);
  flowLiquids(f.s);close(a.liquid,2.5);close(b.liquid,1.5);close(a.liquidHeat,900);close(b.liquidHeat,460);
  close(waterKelvin(a,{floor:true}),360);close(waterKelvin(b,{floor:true}),460/1.5);f.check();
});

test('open stairs carry upper-floor heat while closed hatches preserve both owners',()=>{
  const f=fixture(),lower=f.floor(3,3),upper=f.floor(3,3,1),link={id:'vertical-1',kind:'stairwell',lower:{x:3,y:3,z:0},upper:{x:3,y:3,z:1},hp:100,mode:'closed',openUntil:0};
  f.site.verticalLinks=[link];lower.verticalLink=upper.verticalLink=link.id;f.seed(upper,2,280);f.seed(lower,1,340);
  flowLiquids(f.s);close(upper.liquidHeat,560);close(lower.liquidHeat,340);
  link.mode='open';flowLiquids(f.s);close(upper.liquidHeat,420);close(lower.liquidHeat,480);f.check();
});

test('passive plumbing levels and mixes hot and cold parcels with finite capacity',()=>{
  const f=fixture(),a=f.pipe(3,3),b=f.pipe(3,4);f.seed(a,2,350,{node:true});f.seed(b,.5,270,{node:true});
  flowPlumbing(f.s);close(a.waterPipe.water,1.5);close(b.waterPipe.water,1);close(a.waterPipe.heat,525);close(b.waterPipe.heat,310);f.check();
  const status=plumbingStatus(f.s,f.site,b);close(status.heat,310);close(status.temperature,310-273.15);
});

test('water risers carry heat across floors in both directions and honor isolation',()=>{
  const f=fixture(),lower=f.pipe(3,3),upper=f.pipe(3,3,1),link={id:'utility-1',kind:'water',lower:{x:3,y:3,z:0},upper:{x:3,y:3,z:1},hp:100,enabled:true};
  f.site.utilityLinks=[link];lower.risers=upper.risers={water:link.id};f.seed(lower,2,360,{node:true});
  flowPlumbing(f.s);close(upper.waterPipe.heat,180);close(lower.waterPipe.heat,540);
  link.enabled=false;flowPlumbing(f.s);close(upper.waterPipe.heat,180);
  link.enabled=true;[lower.waterPipe,upper.waterPipe]=[upper.waterPipe,lower.waterPipe];flowPlumbing(f.s);close(lower.waterPipe.heat,360);close(upper.waterPipe.heat,360);f.check();
});

test('pumps preserve source temperature against a fill gradient and stop at target capacity',()=>{
  const f=fixture(),a=f.pipe(3,4),b=f.pipe(3,2);device(f,'waterPump');f.seed(a,.5,360,{node:true});f.seed(b,1.75,280,{node:true});
  operatePlumbing(f.s);close(a.waterPipe.water,.25);close(b.waterPipe.water,2);close(a.waterPipe.heat,90);close(b.waterPipe.heat,580);
  operatePlumbing(f.s);close(b.waterPipe.heat,580);f.check();
});

test('damaged pipes leak only available floor capacity with their carried heat',()=>{
  const f=fixture(),t=f.pipe(3,3);f.seed(t,2,350,{node:true});f.seed(t,3.875,270);t.waterPipe.hp=0;t.waterPipe.open=false;
  flowPlumbing(f.s);close(t.liquid,4);close(t.liquidHeat,3.875*270+.125*350);close(t.waterPipe.heat,1.875*350);
  flowPlumbing(f.s);close(t.waterPipe.heat,1.875*350);f.check();
});

test('floor intake and outlet retain heat within the finite water domain',()=>{
  const f=fixture(),floor=f.floor(3,4),node=f.pipe(3,2),pump=device(f,'waterIntake');f.seed(floor,1,280);
  operatePlumbing(f.s);close(floor.liquidHeat,140);close(node.waterPipe.heat,140);close(f.site.thermal.waterRemoved,0);
  pump.building='waterOutlet';pump.waterDevice.direction='s';operatePlumbing(f.s);close(floor.liquidHeat,280);close(node.waterPipe.heat,0);f.check();
});

test('packaged intake and tank release import reference heat; dismantling exports current heat',()=>{
  const f=fixture(),source=f.floor(3,4),node=f.pipe(3,2);source.building='waterTank';source.machine={input:{water:1}};source.tank={drain:false};device(f,'waterIntake','inventory');
  operatePlumbing(f.s);close(node.waterPipe.heat,parcelHeat(.5));close(source.machine.input.water,.5);
  releaseWater(f.s,f.site,source,.5,'test');close(source.liquidHeat,parcelHeat(.5));close(f.site.thermal.waterLoaded,parcelHeat(1));
  removePlumbing(f.s,f.site,node,node,true);close(node.drop.water,.5);close(f.site.thermal.waterRemoved,parcelHeat(.5));f.check();
});

test('machine delivery and bilge recovery export the actual water heat',()=>{
  const f=fixture(),input=f.pipe(3,4),output=f.floor(3,2);device(f,'waterOutlet','inventory');
  output.building='farm';output.machine={enabled:true,input:{},order:{mode:'continuous'}};f.seed(input,1,370,{node:true});
  operatePlumbing(f.s);close(output.machine.input.water,.5);close(f.site.thermal.waterRemoved,185);
  output.building='bilgePump';output.machine={enabled:true,output:{}};output.powered=true;f.seed(output,.5,280);
  pumpLiquids(f.s);close(output.machine.output.water,.5);close(output.liquidHeat,0);close(f.site.thermal.waterRemoved,325);f.check();
});

test('cultivation and fire export heat with their finite water consumption',()=>{
  const f=fixture(),t=f.floor(3,3);t.terrain='ground';t.flora={fungalcap:{origin:'cultivated',generation:'test',moisture:0}};f.site.cultivation={fungalcap:{absorbed:0}};f.seed(t,1,360);
  close(absorbCultivationWater(f.s,f.site,t,.2),.2);close(f.site.thermal.waterRemoved,72);close(t.flora.fungalcap.moisture,.2);
  assert.equal(quenchWater(f.s,f.site,t),true);close(f.site.thermal.waterRemoved,162);close(t.liquidHeat,198);f.check();
});

for(const terrain of ['ground','void'])test(`${terrain} drainage exports source heat without leaving heat on an empty owner`,()=>{
  const f=fixture(),t=f.floor(3,3);t.terrain=terrain;f.seed(t,.02,330);flowLiquids(f.s);
  close(t.liquid,0);close(t.liquidHeat,0);close(f.site.thermal.waterRemoved,6.6);f.check();
});

test('plumbing admission distinguishes legacy node shape from current heat owners',()=>{
  const f=fixture(),t=f.pipe(3,3);assert.deepEqual(t.waterPipe,{water:0,heat:0,open:true,hp:100});f.check();
  assert.equal(plumbingStatus(f.s,f.site,t).temperature,null);
  assert.throws(()=>validatePlumbing(f.s,{legacyHeat:true}),/Invalid water pipe/);
  delete t.waterPipe.heat;assert.throws(()=>validatePlumbing(f.s),/Invalid water pipe/);validatePlumbing(f.s,{legacyHeat:true});
});
