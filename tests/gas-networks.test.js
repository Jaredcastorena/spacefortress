import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, order, serialize, deserialize, pathTo } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources } from '../src/inventory.js';
import { initializeElectrical, refreshPower, updatePower } from '../src/power.js';
import { haul, setMachineEnabled } from '../src/industry.js';
import { GASES, emptyGas, gasAmount, mix, roomAt } from '../src/atmosphere.js';
import { newPipe, gasNode, gasPressure, gasStatus, updateGasNetworks, setGasValve, setGasDevice, validateGasNetworks } from '../src/gas-networks.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
import { executeAction, actionCatalog } from '../src/controls.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const check=s=>deserialize(serialize(s));
const addGas=(to,gas)=>{for(const k of GASES)to[k]+=gas[k];};
const stored=site=>site.tiles.reduce((gas,t)=>{if(gasNode(t))addGas(gas,gasNode(t).gas);return gas;},emptyGas());
function base(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 refreshPower(s,site);return {s,site};
}
function install(s,kind,x,y){const t=at(s.sites.surface,x,y);assert.equal(t.building,null);t.building=kind;t.hp=100;initializeStorage(t);initializeElectrical(t);return t;}
function pipe(site,x,y){const t=at(site,x,y);t.pipe=newPipe();return t;}
function seed(s,t,gas){
 // Fixture ownership transfer: finite packaged air becomes gas stored in a physical node.
 at(s.sites.surface,8,10).stock.air-=gasAmount(gas);addGas(gasNode(t).gas,gas);addGas(s.sites.surface.gasNetwork.loaded,gas);syncResources(s);
}
function buffer(s,t,n){at(s.sites.surface,8,10).stock.air-=n;t.machine.input.air=(t.machine.input.air||0)+n;syncResources(s);}
function network(){
 const {s,site}=base(),tank=install(s,'gasTank',11,9),pump=install(s,'gasPump',12,9),outlet=pipe(site,13,9),vent=install(s,'gasVent',13,8);
 for(let x=8;x<=13;x++)at(site,x,9).cable={enabled:true,hp:100};
 for(let y=9;y<=10;y++)at(site,12,y).cable={enabled:true,hp:100};
 refreshPower(s,site);return {s,site,tank,pump,outlet,vent};
}
function until(s,condition,max=200){for(let i=0;i<max&&!condition();i++)step(s);assert.ok(condition(),'Condition not reached');}

test('gas equipment and wall pipes need delivered construction supplies and start empty',()=>{
 const {s,site}=base(),before=totalResources(s);
 const tankJob=order(s,'surface',11,9,'build','gasTank');assert.ok(tankJob.ok);assert.deepEqual(tankJob.job.cost,{alloy:6,components:1});assert.equal(at(site,11,9).gasStore,undefined);
 until(s,()=>at(site,11,9).building==='gasTank');assert.deepEqual(at(site,11,9).gasStore.gas,emptyGas());assert.deepEqual(at(site,11,9).machine.input,{});
 assert.ok(order(s,'surface',11,12,'build','gasPipe').ok);until(s,()=>at(site,11,12).pipe);assert.equal(at(site,11,12).building,'wall');assert.equal(gasAmount(at(site,11,12).pipe.gas),0);
 assert.ok(order(s,'surface',12,9,'build','gasPump').ok);until(s,()=>at(site,12,9).building==='gasPump');
 assert.ok(order(s,'surface',13,9,'build','gasVent').ok);until(s,()=>at(site,13,9).building==='gasVent');
 close(totalResources(s).alloy,before.alloy-15);close(totalResources(s).components,before.components-3);
 assert.equal(order(s,'surface',11,9,'build','gasPipe').ok,false);assert.equal(order(s,'surface',12,14,'build','gasTank').ok,false);check(s);
});

test('haulers deliver finite breathing mix and tanks retain at most 80 gas units plus their loading buffer',()=>{
 const {s,site}=base(),tank=install(s,'gasTank',11,9),c=s.crew[1],before=totalResources(s).air;c.labors.hauling=true;c.x=8;c.y=10;setGasValve(s,'surface',11,9,false);
 haul(s,c,site,pathTo);assert.ok(c.carry.air>0);assert.equal(tank.machine.input.air,undefined);assert.equal(gasAmount(tank.gasStore.gas),0);
 for(let i=0;i<800&&gasAmount(tank.gasStore.gas)<80-1e-8;i++){haul(s,c,site,pathTo);updateGasNetworks(s);}
 close(gasAmount(tank.gasStore.gas),80);assert.ok((tank.machine.input.air||0)<=20);close(totalResources(s).air,before);
 const held=structuredClone(tank.gasStore.gas);for(let i=0;i<10;i++)updateGasNetworks(s);assert.deepEqual(tank.gasStore.gas,held);
 setMachineEnabled(s,'surface',11,9,false);for(let i=0;i<40&&(c.carry||c.intent);i++)haul(s,c,site,pathTo);
 assert.equal(haul(s,c,site,pathTo),false);syncResources(s);refreshPower(s,site);check(s);
});

test('closed tank valves retain contents while loading pauses without inventing gas from an empty buffer',()=>{
 const {s,site}=base(),tank=install(s,'gasTank',11,9);pipe(site,12,9);buffer(s,tank,3);setGasValve(s,'surface',11,9,false);const before=totalResources(s).air;
 updateGasNetworks(s);close(gasAmount(tank.gasStore.gas),2);close(tank.machine.input.air,1);close(totalResources(s).air,before);
 setMachineEnabled(s,'surface',11,9,false);updateGasNetworks(s);close(gasAmount(tank.gasStore.gas),2);
 setMachineEnabled(s,'surface',11,9,true);for(let i=0;i<8;i++)updateGasNetworks(s);close(gasAmount(tank.gasStore.gas),3);close(gasAmount(at(site,12,9).pipe.gas),0);close(totalResources(s).air,before);check(s);
});

test('physically delivered tank supply crosses a powered pump and pipe before a vent adds it to the room',()=>{
 const {s,site,tank,pump,outlet,vent}=network(),c=s.crew[1],room=roomAt(site,vent.x,vent.y),initialRoom={...room.gas},before=totalResources(s).air;
 c.labors.hauling=true;c.x=8;c.y=10;setGasDevice(s,'surface',vent.x,vent.y,true,'east',120);
 for(let i=0;i<150;i++){haul(s,c,site,pathTo);updatePower(s,site);updateGasNetworks(s);}
 assert.ok(gasAmount(site.gasNetwork.loaded)>10);assert.ok(gasAmount(site.gasNetwork.delivered)>10);assert.ok(gasAmount(outlet.pipe.gas)>0);assert.ok(pump.powered);
 for(const k of GASES)close(room.gas[k]-initialRoom[k],site.gasNetwork.delivered[k]);
 close(totalResources(s).air+gasAmount(site.gasNetwork.delivered)+gasAmount(site.gasNetwork.vented),before);
 setGasDevice(s,'surface',pump.x,pump.y,false,'east',100);setMachineEnabled(s,'surface',tank.x,tank.y,false);const retained={...tank.gasStore.gas};
 for(let i=0;i<20;i++){updatePower(s,site);updateGasNetworks(s);}assert.deepEqual(tank.gasStore.gas,retained);syncResources(s);refreshPower(s,site);check(s);
});

test('pressure-driven pipe flow, isolation and reconnection conserve each gas species',()=>{
 const {s,site}=base(),a=pipe(site,9,9),valve=pipe(site,10,9),b=pipe(site,11,9);seed(s,a,{oxygen:2,inert:5,co2:1});const before=stored(site);
 setGasValve(s,'surface',10,9,false);updateGasNetworks(s);assert.deepEqual(stored(site),before);close(gasAmount(b.pipe.gas),0);close(gasAmount(a.pipe.gas),8);
 setGasValve(s,'surface',10,9,true);for(let i=0;i<20;i++){s.tick++;for(const site of Object.values(s.sites))site.atmosphere.tick=s.tick;updateGasNetworks(s);}assert.ok(gasAmount(b.pipe.gas)>2);for(const k of GASES)close(stored(site)[k],before[k]);
 setGasValve(s,'surface',10,9,false);const trapped=structuredClone(valve.pipe.gas),left=structuredClone(a.pipe.gas);for(let i=0;i<5;i++)updateGasNetworks(s);assert.deepEqual(valve.pipe.gas,trapped);assert.deepEqual(a.pipe.gas,left);
 setGasValve(s,'surface',10,9,true);updateGasNetworks(s);for(const k of GASES)close(stored(site)[k],before[k]);validateGasNetworks(s);check(s);
});

test('different gas mixtures diffuse at equal pressure without changing volumes or species totals',()=>{
 const {s,site}=base(),a=pipe(site,9,9),b=pipe(site,10,9);seed(s,a,{oxygen:4,inert:0,co2:0});seed(s,b,{oxygen:0,inert:0,co2:4});const before=stored(site);
 close(gasPressure(a),gasPressure(b));updateGasNetworks(s);assert.ok(a.pipe.gas.co2>0);assert.ok(b.pipe.gas.oxygen>0);close(gasAmount(a.pipe.gas),4);close(gasAmount(b.pipe.gas),4);
 for(const k of GASES)close(stored(site)[k],before[k]);check(s);
});

test('powered pumps move against pressure only between their directional inlet and outlet',()=>{
 const {s,site,tank,pump,outlet,vent}=network();vent.gasStore.open=false;seed(s,tank,mix(4));seed(s,outlet,mix(8));const north=pipe(site,12,8),south=pipe(site,12,10);
 setGasValve(s,'surface',13,9,false);updatePower(s,site);assert.equal(pump.powered,true);updateGasNetworks(s);close(gasAmount(tank.gasStore.gas),4);assert.match(gasStatus(site,pump).blocked,/valve closed/i);
 setGasValve(s,'surface',13,9,true);updateGasNetworks(s);close(gasAmount(tank.gasStore.gas),2);close(gasAmount(outlet.pipe.gas),10);close(gasAmount(north.pipe.gas),0);close(gasAmount(south.pipe.gas),0);
 assert.match(gasStatus(site,pump).blocked,/Outlet full/);setGasDevice(s,'surface',12,9,true,'west',100);updateGasNetworks(s);assert.ok(gasAmount(tank.gasStore.gas)>2);assert.ok(gasAmount(outlet.pipe.gas)<10);refreshPower(s,site);check(s);
});

test('stopped, disconnected, empty and full pumps expose distinct reasons and never transfer passively',()=>{
 const {s,site,tank,pump,outlet,vent}=network();vent.gasStore.open=false;seed(s,tank,mix(6));
 setGasDevice(s,'surface',12,9,false,'east',100);updateGasNetworks(s);assert.match(gasStatus(site,pump).blocked,/disabled/);close(gasAmount(outlet.pipe.gas),0);
 setGasDevice(s,'surface',12,9,true,'east',100);pump.cable.enabled=false;refreshPower(s,site);updateGasNetworks(s);assert.match(gasStatus(site,pump).blocked,/No power/);close(gasAmount(outlet.pipe.gas),0);
 pump.cable.enabled=true;refreshPower(s,site);setGasDevice(s,'surface',12,9,true,'north',100);updateGasNetworks(s);assert.match(gasStatus(site,pump).blocked,/Missing inlet/);
 const input=pipe(site,12,10),output=pipe(site,12,8);updateGasNetworks(s);assert.match(gasStatus(site,pump).blocked,/Inlet empty/);
 // Isolate the outlet from the neighboring vent so only the selected pump can fill it.
 seed(s,input,mix(2));seed(s,output,mix(10));updateGasNetworks(s);assert.match(gasStatus(site,pump).blocked,/Outlet full/);close(gasAmount(input.pipe.gas),2);check(s);
});

test('vent targets add exactly the supplied gas to their real compartment and release no gas above target',()=>{
 const {s,site,vent}=network();setGasValve(s,'surface',13,9,false);const room=roomAt(site,13,8),before=gasAmount(room.gas),initial={...room.gas};seed(s,vent,{oxygen:1,inert:3,co2:1});
 setGasDevice(s,'surface',13,8,true,'east',100);updatePower(s,site);updateGasNetworks(s);close(gasAmount(vent.gasStore.gas),5);assert.match(gasStatus(site,vent).blocked,/target pressure/);
 setGasDevice(s,'surface',13,8,true,'east',110);updateGasNetworks(s);close(gasAmount(room.gas)-before,2);close(gasAmount(vent.gasStore.gas),3);
 for(const k of GASES)close(room.gas[k]-initial[k],site.gasNetwork.delivered[k]);assert.ok(room.pressure>100);
 setGasDevice(s,'surface',13,8,true,'east',100);updateGasNetworks(s);close(gasAmount(vent.gasStore.gas),3);validateGasNetworks(s);refreshPower(s,site);check(s);
});

test('gas devices pay actual circuit energy and disabling them releases their entire demand',()=>{
 const {s,site,pump,vent}=network(),before=site.energy.consumed;updatePower(s,site);close(site.energy.consumed-before,5);assert.ok(pump.powered&&vent.powered);
 setGasDevice(s,'surface',12,9,false,'east',100);setGasDevice(s,'surface',13,8,false,'east',100);const used=site.energy.consumed;updatePower(s,site);close(site.energy.consumed,used);close(site.power.demand,0);assert.equal(pump.powered,false);refreshPower(s,site);check(s);
});

test('ruptured pipe drains a connected supply until isolated, while its trapped gas still leaks',()=>{
 const {s,site}=base(),tank=install(s,'gasTank',11,9),broken=pipe(site,12,9);seed(s,tank,mix(30));broken.pipe.hp=0;
 for(let i=0;i<5;i++)updateGasNetworks(s);assert.ok(gasAmount(tank.gasStore.gas)<30);assert.ok(gasAmount(site.gasNetwork.delivered)>0);
 setGasValve(s,'surface',12,9,false);const held=structuredClone(tank.gasStore.gas);for(let i=0;i<10;i++)updateGasNetworks(s);assert.deepEqual(tank.gasStore.gas,held);close(gasAmount(broken.pipe.gas),0);
 close(gasAmount(stored(site))+gasAmount(site.gasNetwork.delivered)+gasAmount(site.gasNetwork.vented),30);validateGasNetworks(s);check(s);
});

test('damaged tanks leak with refill and valves disabled and a repaired pipe retains new contents',()=>{
 const {s,site}=base(),tank=install(s,'gasTank',11,9);seed(s,tank,mix(4));tank.hp=25;setGasValve(s,'surface',11,9,false);setMachineEnabled(s,'surface',11,9,false);
 updateGasNetworks(s);close(gasAmount(site.gasNetwork.delivered),1);tank.hp=100;updateGasNetworks(s);close(gasAmount(site.gasNetwork.delivered),1);
 const t=pipe(site,12,9);t.pipe.hp=25;assert.ok(order(s,'surface',12,9,'repairPipe').ok);const alloy=totalResources(s).alloy;
 until(s,()=>t.pipe.hp===100);close(totalResources(s).alloy,alloy-1);seed(s,t,mix(3));setGasValve(s,'surface',12,9,false);const delivered=gasAmount(site.gasNetwork.delivered);updateGasNetworks(s);close(gasAmount(site.gasNetwork.delivered),delivered);refreshPower(s,site);check(s);
});

test('dismantling a tank preserves packaged air and releases stored gas into its compartment',()=>{
 const {s,site}=base(),tank=install(s,'gasTank',11,9);buffer(s,tank,3);seed(s,tank,mix(8));setMachineEnabled(s,'surface',11,9,false);setGasValve(s,'surface',11,9,false);const before=totalResources(s).air;
 assert.ok(order(s,'surface',11,9,'remove').ok);until(s,()=>tank.building===null);assert.equal(tank.gasStore,undefined);assert.equal(tank.machine,undefined);close(tank.drop.air,3);close(gasAmount(site.gasNetwork.delivered),8);close(totalResources(s).air+gasAmount(site.gasNetwork.delivered),before);check(s);
});

test('dismantling exterior pipes records a finite loss instead of deleting unaccounted gas',()=>{
 const {s,site}=base(),t=pipe(site,15,13);seed(s,t,{oxygen:1,inert:2,co2:1});const before=totalResources(s).air;
 assert.ok(order(s,'surface',15,13,'removePipe').ok);until(s,()=>t.pipe===null);close(gasAmount(site.gasNetwork.vented),4);close(gasAmount(site.gasNetwork.delivered),0);close(totalResources(s).air+4,before);check(s);
});

test('a leaking wall pipe conserves contents across its neighboring habitat and exterior',()=>{
 const {s,site}=base(),t=pipe(site,11,12),room=roomAt(site,11,11);seed(s,t,mix(4));t.pipe.hp=0;const before=gasAmount(room.gas);
 updateGasNetworks(s);assert.ok(gasAmount(room.gas)>before);assert.ok(gasAmount(site.gasNetwork.vented)>0);
 close(gasAmount(room.gas)-before,gasAmount(site.gasNetwork.delivered));close(gasAmount(t.pipe.gas)+gasAmount(site.gasNetwork.delivered)+gasAmount(site.gasNetwork.vented),4);check(s);
});

test('shared gas controls, stable transfer labels and typed observations do not change recorded simulation outcomes',()=>{
 const {s:a,tank}=network();buffer(a,tank,12);const b=check(a);startRecording(a,{maxRecords:20000,maxBytes:32000000});
 for(const s of [a,b]){
  assert.equal(executeAction(s,'gas.valve',{site:'surface',x:11,y:9,open:'yes'}).ok,false);
  assert.ok(executeAction(s,'gas.valve',{site:'surface',x:11,y:9,open:true},'player').ok);
  assert.ok(executeAction(s,'gas.device',{site:'surface',x:13,y:8,enabled:true,direction:'east',target:110},'agent').ok);step(s,6);
 }
 assert.deepEqual(a,b);const rows=exportRecording(a).trim().split('\n').map(JSON.parse);
 for(const id of ['gas.valve.changed','gas.device.changed','gas.loaded','gas.transferred','gas.released'])assert.ok(rows.some(r=>r.event?.id===id),id);
 const transfer=rows.find(r=>r.event?.id==='gas.transferred'&&r.event.reason==='pump');assert.ok(transfer);assert.equal(transfer.event.device,'tile:surface:12:9');
 const events=rows.filter(r=>r.event?.id==='gas.transferred');assert.ok(events.length>0);
 const text=JSON.stringify(events);assert.match(text,/tile:surface:11:9/);assert.match(text,/tile:surface:13:9/);
 assert.ok(rows.some(r=>r.action?.id==='gas.valve'&&r.action.source==='player'));assert.ok(JSON.stringify(rows).includes('gas_networks'));
 const released=rows.find(r=>r.event?.id==='gas.released');assert.match(released.event.to,/^room:surface:\d+,\d+$/);assert.equal(observe(a).entities[released.event.to].type,'room');
 assert.ok(observe(a).entities['tile:surface:12:9'].derived.status);assert.ok(actionCatalog().some(a=>a.id==='gas.device'));check(a);
});

test('pipes under reactors preserve equipment observations and expose their own gas status',()=>{
 const {s,site}=base(),reactor=install(s,'reactor',11,9),radiator=install(s,'radiator',12,13);pipe(site,11,9);pipe(site,12,13);refreshPower(s,site);
 const observations=observe(s).entities;assert.ok(Number.isFinite(observations['tile:surface:11:9'].derived.reactorTemperature));assert.equal(observations['tile:surface:11:9'].derived.gasNetwork.status,'Empty');
 assert.ok(Array.isArray(observations['tile:surface:12:13'].derived.targets));assert.equal(observations['tile:surface:12:13'].derived.gasNetwork.status,'Empty');check(s);
});

test('gas mixture, controls and partial transfers resume deterministically after current save/reload',()=>{
 const {s,tank}=network();buffer(s,tank,16);setGasDevice(s,'surface',13,8,true,'east',110);step(s,8);const copy=check(s);step(s,16);step(copy,16);assert.deepEqual(s,copy);check(s);
});

test('schema 32 migration adds empty gas state without grants, equipment or RNG changes',()=>{
 const old=createGame();old.version=32;for(const site of Object.values(old.sites)){delete site.gasNetwork;for(const t of site.tiles)delete t.pipe;}
 const before=totalResources(old),migrated=check(old);assert.equal(migrated.version,36);assert.deepEqual(totalResources(migrated),before);assert.equal(migrated.rng,old.rng);
 for(const site of Object.values(migrated.sites)){assert.equal(gasAmount(stored(site)),0);assert.ok(site.tiles.every(t=>t.pipe===null&&!t.gasStore&&!t.gasDevice));}
 assert.deepEqual(check(migrated),migrated);
});

test('malformed pipe contents, incompatible overlays, controls and gas ledgers are rejected',()=>{
 for(const change of [
  ({outlet})=>outlet.pipe.gas.oxygen=-1,({outlet})=>outlet.pipe.gas.oxygen=11,
  ({outlet})=>outlet.pipe.gas.smoke=1,({outlet})=>outlet.pipe.open=1,({outlet})=>outlet.pipe.hp=101,
  ({tank})=>tank.pipe=newPipe(),({tank})=>tank.machine.input.air=21,
  ({pump})=>pump.gasDevice.direction='up',({vent})=>vent.gasDevice.target=151,
  ({site})=>site.gasNetwork.loaded.oxygen=1,({site})=>site.gasNetwork.vented.co2=-1,
  ({site})=>at(site,9,9).gasStore={gas:emptyGas(),open:true},
 ]){const f=network();change(f);assert.throws(()=>check(f.s));}
});

test('pipe work saves validate the target, kind, cost and overlay construction compatibility',()=>{
 for(const kind of ['repairPipe','removePipe']){
  const {s,site}=base(),t=pipe(site,11,9);t.pipe.hp=25;const result=order(s,'surface',11,9,kind);assert.ok(result.ok);check(s);
  const wrongWork=check(s);wrongWork.jobs[0].work=4;wrongWork.jobs[0].remaining=4;assert.throws(()=>check(wrongWork));
  if(kind==='repairPipe'){const wrongCost=check(s);wrongCost.jobs[0].cost={};wrongCost.jobs[0].sources=[];assert.throws(()=>check(wrongCost));}
  result.job.x=12;assert.throws(()=>check(s));
 }
 const {s,site}=base();assert.ok(order(s,'surface',11,9,'build','gasPipe').ok);check(s);install(s,'gasTank',11,9);refreshPower(s,site);assert.throws(()=>check(s));
});
