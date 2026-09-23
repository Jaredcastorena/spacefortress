import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, at, step, order, serialize, deserialize, pathTo} from '../src/simulation.js';
import {initializeStorage, totalResources, syncResources} from '../src/inventory.js';
import {initializeElectrical, refreshPower, updatePower} from '../src/power.js';
import {haul} from '../src/industry.js';
import {newPipe} from '../src/gas-networks.js';
import {PLUMBING, waterNode, newWaterPipe, plumbingStatus, flowPlumbing, operatePlumbing, setWaterValve, setWaterPump, setWaterIntake, setWaterOutlet} from '../src/plumbing.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const check=s=>{syncResources(s);return deserialize(serialize(s));};
function base(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 refreshPower(s,site);return {s,site};
}
function install(s,kind,x=11,y=9){
 const t=at(s.sites.surface,x,y);assert.equal(t.building,null);t.building=kind;t.hp=100;
 initializeStorage(t);initializeElectrical(t);return t;
}
function pipe(site,x,y){const t=at(site,x,y);t.waterPipe=newWaterPipe();return t;}
function wire(s){for(let x=8;x<=13;x++)at(s.sites.surface,x,9).cable={enabled:true,hp:100};refreshPower(s,s.sites.surface);}
function network(){
 const f=base(),pump=install(f.s,'waterPump'),input=pipe(f.site,10,9),output=pipe(f.site,12,9);
 wire(f.s);return {...f,pump,input,output};
}
function seed(s,t,n){
 // Transfer finite depot inventory into a real node for this fixture.
 at(s.sites.surface,8,10).stock.water-=n;waterNode(t).water+=n;s.sites.surface.plumbing.loaded+=n;syncResources(s);
}
function wet(s,t,n){at(s.sites.surface,8,10).stock.water-=n;t.liquid+=n;s.sites.surface.liquids.released+=n;syncResources(s);}
function until(s,p,max=240){for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),'Condition not reached');}

test('water devices require delivered materials and commission with empty storage and explicit controls',()=>{
 for(const kind of ['waterReservoir','waterPump','waterIntake','waterOutlet']){
  const {s,site}=base(),before=totalResources(s),result=order(s,'surface',11,9,'build',kind);
  assert.ok(result.ok);assert.deepEqual(result.job.cost,{alloy:kind==='waterReservoir'?6:4,components:1});
  assert.equal(result.job.work,kind==='waterReservoir'?10:8);assert.deepEqual(result.job.materials,{});
  until(s,()=>Object.keys(result.job.materials).length>0);assert.equal(at(site,11,9).building,null);
  close(totalResources(s).alloy,before.alloy);until(s,()=>at(site,11,9).building===kind);
  const t=at(site,11,9);assert.equal(t.machine,undefined);
  if(kind==='waterReservoir'){assert.deepEqual(t.waterStore,{water:0,open:true});assert.equal(t.waterDevice,undefined);}
  else {assert.equal(t.waterStore,undefined);assert.deepEqual(t.waterDevice,{enabled:true,direction:'east',...(kind==='waterPump'?{}:{mode:'inventory'})});}
  close(totalResources(s).alloy,before.alloy-result.job.cost.alloy);close(totalResources(s).components,before.components-1);
  assert.equal(order(s,'surface',11,9,'build','waterPipe').ok,false);
  assert.equal(order(s,'surface',12,14,'build',kind).ok,false);check(s);
 }
});

test('empty reservoirs receive no automatic water deliveries and remain empty without connected supply',()=>{
 const {s,site}=base(),reservoir=install(s,'waterReservoir'),c=s.crew[1],before=totalResources(s).water;
 c.labors.hauling=true;c.x=8;c.y=10;refreshPower(s,site);
 for(let i=0;i<25;i++){assert.equal(haul(s,c,site,pathTo),false);flowPlumbing(s);operatePlumbing(s);}
 close(reservoir.waterStore.water,0);close(totalResources(s).water,before);
 assert.equal(reservoir.machine,undefined);assert.equal(reservoir.powered,false);check(s);
});

test('powered water pumps move against fill gradients only through their selected front and rear ports',()=>{
 const {s,site,pump,input,output}=network(),north=pipe(site,11,8),south=pipe(site,11,10);
 seed(s,input,.5);seed(s,output,1.5);seed(s,north,.4);const total=totalResources(s).water;
 updatePower(s,site);assert.equal(pump.powered,true);operatePlumbing(s);
 close(input.waterPipe.water,0);close(output.waterPipe.water,2);close(north.waterPipe.water,.4);close(south.waterPipe.water,0);
 setWaterPump(s,'surface',11,9,true,'west');operatePlumbing(s);
 close(input.waterPipe.water,.5);close(output.waterPipe.water,1.5);
 pump.hp=50;operatePlumbing(s);close(input.waterPipe.water,.75);close(output.waterPipe.water,1.25);
 close(totalResources(s).water,total);check(s);
});

test('stopped pumps provide no passive passage and closed port valves or power loss stop active flow',()=>{
 const {s,site,pump,input,output}=network();seed(s,input,1.5);
 setWaterPump(s,'surface',11,9,false,'east');flowPlumbing(s);operatePlumbing(s);
 close(output.waterPipe.water,0);assert.equal(plumbingStatus(s,site,pump).blockedCode,'disabled');
 setWaterPump(s,'surface',11,9,true,'east');setWaterValve(s,'surface',10,9,false);operatePlumbing(s);
 close(output.waterPipe.water,0);assert.equal(plumbingStatus(s,site,pump).blockedCode,'valve_closed');
 setWaterValve(s,'surface',10,9,true);setWaterValve(s,'surface',12,9,false);operatePlumbing(s);
 close(output.waterPipe.water,0);assert.equal(plumbingStatus(s,site,pump).blockedCode,'valve_closed');
 setWaterValve(s,'surface',12,9,true);pump.cable.enabled=false;refreshPower(s,site);operatePlumbing(s);
 close(output.waterPipe.water,0);assert.equal(plumbingStatus(s,site,pump).blockedCode,'no_power');
 pump.cable.enabled=true;refreshPower(s,site);operatePlumbing(s);close(output.waterPipe.water,PLUMBING.pump);check(s);
});

test('unconnected, empty and full pump ports expose distinct conditions without consuming water',()=>{
 const {s,site}=base(),pump=install(s,'waterPump');wire(s);
 assert.equal(plumbingStatus(s,site,pump).blockedCode,'wrong_source');operatePlumbing(s);
 const input=pipe(site,10,9);assert.equal(plumbingStatus(s,site,pump).blockedCode,'wrong_target');operatePlumbing(s);
 const output=pipe(site,12,9);assert.equal(plumbingStatus(s,site,pump).blockedCode,'source_empty');operatePlumbing(s);
 seed(s,input,1);seed(s,output,2);const before=totalResources(s).water;
 assert.equal(plumbingStatus(s,site,pump).blockedCode,'target_full');operatePlumbing(s);
 close(input.waterPipe.water,1);close(output.waterPipe.water,2);close(totalResources(s).water,before);check(s);
});

test('plumbing devices pay actual circuit energy and disabled controls release their demand',()=>{
 const {s,site}=base(),pump=install(s,'waterPump'),intake=install(s,'waterIntake',12,9),outlet=install(s,'waterOutlet',13,9);wire(s);
 const before=site.energy.consumed;updatePower(s,site);close(site.energy.consumed-before,7);
 assert.ok(pump.powered&&intake.powered&&outlet.powered);
 setWaterPump(s,'surface',11,9,false,'east');setWaterIntake(s,'surface',12,9,false,'east','inventory');setWaterOutlet(s,'surface',13,9,false,'east','floor');
 const used=site.energy.consumed;updatePower(s,site);close(site.energy.consumed,used);close(site.power.demand,0);
 assert.equal(pump.powered,false);assert.equal(intake.powered,false);assert.equal(outlet.powered,false);refreshPower(s,site);check(s);
});

test('water pipes are physically constructed under walls beside independent gas and cable overlays',()=>{
 const {s,site}=base(),t=at(site,11,12),before=totalResources(s);
 assert.equal(t.building,'wall');t.pipe=newPipe();t.cable={enabled:false,hp:100};
 const result=order(s,'surface',11,12,'build','waterPipe');assert.ok(result.ok);
 assert.deepEqual(result.job.cost,{alloy:1});assert.equal(result.job.work,2);assert.equal(t.waterPipe,null);
 until(s,()=>!!t.waterPipe);assert.equal(t.building,'wall');assert.deepEqual(t.waterPipe,{water:0,open:true,hp:100});
 assert.ok(t.pipe);assert.ok(t.cable);close(totalResources(s).alloy,before.alloy-1);
 assert.equal(order(s,'surface',11,12,'build','waterPipe').ok,false);
 const ordinary=at(site,11,9);ordinary.waterPipe=newWaterPipe();assert.equal(order(s,'surface',11,9,'build','waterReservoir').ok,false);
 refreshPower(s,site);check(s);
});

test('demolishing the building above water gas and cable overlays preserves each route and its retained water',()=>{
 const {s,site}=base(),t=install(s,'commons');t.waterPipe=newWaterPipe();t.pipe=newPipe();t.cable={enabled:false,hp:100};seed(s,t,1.5);
 const water=structuredClone(t.waterPipe),gas=structuredClone(t.pipe),cable=structuredClone(t.cable);
 assert.ok(order(s,'surface',11,9,'remove').ok);until(s,()=>t.building===null);
 assert.deepEqual(t.waterPipe,water);assert.deepEqual(t.pipe,gas);assert.deepEqual(t.cable,cable);check(s);
});

test('dismantling a full isolated reservoir recovers all contained water as a physical drop despite a saturated floor',()=>{
 const {s,site}=base(),reservoir=install(s,'waterReservoir');seed(s,reservoir,32);wet(s,reservoir,4);
 setWaterValve(s,'surface',11,9,false);const before=totalResources(s).water;
 assert.ok(order(s,'surface',11,9,'remove').ok);until(s,()=>reservoir.building===null);
 assert.equal(reservoir.waterStore,undefined);close(site.plumbing.delivered,32);close(site.plumbing.released,0);
 close(site.tiles.reduce((n,t)=>n+(t.drop?.water||0),0),32);
 close(totalResources(s).water+site.liquids.lost,before);check(s);
});
