import test from 'node:test';
const position=([x,y])=>({x,y,z:0});
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { startRecording, stopRecording, exportRecording } from '../src/telemetry.js';
import { fixture, command, request, cycle, until, physicalTick, ledger, assertLedger, snapshot, close, CONFIG, STAGING } from './helpers/airlock-fixture.js';
import { airlockStatus, airlockDoorPermit, airlockOpen, airlockLayout, airlockRoomReading, airlockSideBlock, airlockGasQuantities, airlockTankMakeupAllowance } from '../src/airlock-access.js';
import { gasNode, gasCapacity, newPipe, updateGasNetworks } from '../src/gas-networks.js';
import { mix, moveCrew, refreshRoom, refreshAtmosphere, updateRooms, breathe } from '../src/atmosphere.js';
import { continueCrewTraversal, advanceCrewRoute } from '../src/crew-traversal.js';
import { neighbors } from '../src/geometry.js';
import { prepareAirlocks } from '../src/airlocks.js';
import { initializeStorage } from '../src/inventory.js';

// Every installation here is a labeled synthetic fixture; paid acceptance is separate.
test('synthetic real-physics outward and inward cycles conserve species, smoke and allocated energy',()=>{
 const f=fixture(),before=ledger(f),phases=new Set();
 const capture=()=>phases.add(f.controller.airlock.phase);
 const out=cycle(f,'outward',{onTick:capture});assert.deepEqual([f.crew.x,f.crew.y],STAGING.outer);
 assert.ok(f.site.gasNetwork.extracted.oxygen>0,'recovery must use extractor');
 assert.ok(f.site.atmosphere.vented.oxygen>0,'actual outer opening records finite residual loss');
 assert.ok(f.site.atmosphere.vented.oxygen<.1,'outward residual must be bounded');
 const inward=cycle(f,'inward',{onTick:capture});assert.deepEqual([f.crew.x,f.crew.y],STAGING.inner);
 assert.ok(f.site.gasNetwork.delivered.oxygen>0,'refill must use vent');
 assert.ok(phases.has('recover')&&phases.has('refill'),'both physical transfer phases observed');
 assert.ok(f.site.energy.consumed>=out+inward,'real controller energy paid');
 assert.ok(f.site.gasNetwork.extracted.co2>0&&f.site.gasNetwork.delivered.co2>0,'nonzero CO2 must travel with the actual mixture');
 cycle(f,'outward');cycle(f,'inward');assertLedger(f,before);
 assert.equal(f.controller.airlock.phase,'idle');assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');
});

test('same-tick stale paths, unrelated crew and animals cannot tailgate either door',()=>{
 const f=fixture();request(f);until(f,()=>f.controller.airlock.phase==='admit');
 const stranger=f.s.crew[1];[stranger.x,stranger.y]=STAGING.inner;
 assert.equal(airlockDoorPermit(f.site,stranger,position(STAGING.inner),position(CONFIG.inner)),false);
 assert.equal(moveCrew(stranger,f.site,CONFIG.inner),false);assert.deepEqual([stranger.x,stranger.y],STAGING.inner);
 assert.equal(airlockDoorPermit(f.site,{id:'animal',species:'bristleback'},position(STAGING.inner),position(CONFIG.inner)),false);
 assert.equal(airlockDoorPermit(f.site,f.crew,position([8,7]),position(CONFIG.outer)),false);
 assert.equal(moveCrew(f.crew,f.site,CONFIG.outer),false);
 assert.ok(!(airlockStatus(f.s,f.site,f.controller).permissions.inner&&airlockStatus(f.s,f.site,f.controller).permissions.outer));
});

test('power loss stops actual transfers, retains cargo and closes clear doors before gas update',()=>{
 const f=fixture();f.crew.carry={alloy:2};f.crew.delivery={kind:'synthetic-parcel',site:'surface',x:12,y:7};
 request(f);until(f,()=>f.controller.airlock.phase==='recover');
 const gas=ledger(f),carry=JSON.stringify(f.crew.carry),delivery=JSON.stringify(f.crew.delivery),before=f.site.energy.consumed;
 for(const t of f.site.tiles)if(t.cable)t.cable.enabled=false;
 for(let i=0;i<3;i++)physicalTick(f);
 assert.equal(f.controller.airlock.reason,'no_power');assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');
 assert.equal(f.extractor.gasDevice.enabled,false);assert.equal(f.pump.gasDevice.enabled,false);
 assert.equal(JSON.stringify(f.crew.carry),carry);assert.equal(JSON.stringify(f.crew.delivery),delivery);assertLedger(f,gas);close(f.site.energy.consumed,before);
 for(const t of f.site.tiles)if(t.cable)t.cable.enabled=true;
 until(f,()=>!f.crew.airlockTraversal);assert.deepEqual([f.crew.x,f.crew.y],STAGING.outer);
});

for(const [label,modify,reason] of [
 ['reachable recovery capacity',f=>{for(const t of [...airlockLayout(f.site,f.controller).recoveryNodes,...airlockLayout(f.site,f.controller).storageNodes])gasNode(t).gas=mix(gasCapacity(t));},'reservoir_full'],
 ['empty refill reserve',f=>{f.chamber.gas=mix(0);refreshRoom(f.chamber);for(const t of f.site.tiles)if(gasNode(t))gasNode(t).gas=mix(0);},'supply_empty'],
 ['dirty refill reserve',f=>{f.chamber.gas=mix(0);refreshRoom(f.chamber);f.reservoir.gasStore.gas={oxygen:0,inert:0,co2:35};},'contaminated_mix'],
 ['unsafe real temperature',f=>{f.chamber.heat=f.chamber.volume*20*(273.15-10);},'unsafe_temperature'],
 ['insufficient suit reserve',f=>{f.crew.oxygen=1;},'insufficient_suit'],
])test(`synthetic ${label} pauses admission with a measured blocker`,()=>{
 const f=fixture();modify(f);request(f);const before=ledger(f);physicalTick(f);
 assert.equal(f.controller.airlock.phase,'paused');assert.equal(f.controller.airlock.reason,reason);
 assert.equal(f.controller.airlock.party,null);assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');assertLedger(f,before);
});

for(const [label,change,reason] of [
 ['broken opposite seal',f=>{f.outer.hp=0;},'seal_broken'],
 ['damaged pump',f=>{f.pump.hp=80;},'equipment_damaged'],
 ['damaged branch pipe',f=>{f.tile(7,4).pipe.hp=80;},'equipment_damaged'],
 ['removed chamber wall',f=>{f.tile(8,8).building=null;updateRooms(f.site);},'layout_changed'],
 ['new branch bypass',f=>{for(const [x,y] of [[8,4],[8,5],[8,6]])f.tile(x,y).pipe={gas:mix(0),smoke:0,open:true,hp:100};},'layout_changed'],
])test(`synthetic ${label} revokes permits and isolates controlled devices`,()=>{
 const f=fixture();request(f);until(f,()=>f.controller.airlock.phase==='recover');change(f);physicalTick(f);
 assert.equal(f.controller.airlock.phase,'paused');assert.equal(f.controller.airlock.reason,reason);
 assert.equal(f.inner.doorMode,'closed');assert.equal(f.extractor.gasDevice.enabled,false);assert.equal(f.pump.gasDevice.enabled,false);
 const status=airlockStatus(f.s,f.site,f.controller);assert.equal(status.permissions.inner,false);assert.equal(status.permissions.outer,false);
});

test('occupied entry stays physically open on outage, with the opposite side locked',()=>{
 const f=fixture();request(f);until(f,()=>f.crew.x===CONFIG.inner[0]&&f.crew.y===CONFIG.inner[1]);
 for(const t of f.site.tiles)if(t.cable)t.cable.enabled=false;physicalTick(f);
 assert.equal(f.controller.airlock.reason,'no_power');assert.equal(airlockOpen(f.site,f.inner),true);assert.equal(airlockOpen(f.site,f.outer),false);
 assert.deepEqual([f.crew.x,f.crew.y],CONFIG.inner);assert.ok(f.crew.airlockTraversal);
});

test('explicit one-sided release rejects an open or broken opposite door atomically',()=>{
 const f=fixture();let before=snapshot(f.s);
 assert.equal(command(f,'release',{side:'outer',acceptAtmosphereLoss:false}).ok,false);assert.equal(snapshot(f.s),before);
 f.inner.hp=0;before=snapshot(f.s);assert.equal(command(f,'release',{side:'outer',acceptAtmosphereLoss:true}).ok,false);assert.equal(snapshot(f.s),before);
 f.inner.hp=100;f.inner.doorMode='open';before=snapshot(f.s);assert.equal(command(f,'release',{side:'outer',acceptAtmosphereLoss:true}).ok,false);assert.equal(snapshot(f.s),before);
 f.inner.doorMode='closed';assert.equal(command(f,'release',{side:'outer',acceptAtmosphereLoss:true}).ok,true);
 assert.equal(f.controller.airlock.reason,'manual_release');assert.equal(f.outer.doorMode,'open');assert.equal(f.inner.doorMode,'closed');
 const gas=ledger(f);physicalTick(f);assertLedger(f,gas);assert.ok(f.site.atmosphere.vented.oxygen>0);
});

test('queue cancellation and lost approach release claims without moving a live parcel',()=>{
 const f=fixture();f.crew.carry={alloy:2};f.crew.x=18;f.crew.y=13;
 request(f,'inward');assert.equal(command(f,'cancel',{crew:f.crew.id}).ok,true);assert.equal(f.crew.airlockTraversal,null);assert.deepEqual(f.crew.carry,{alloy:2});
 request(f,'inward');for(const [x,y] of neighbors(18,13))f.tile(x,y).building='wall';
 const result=continueCrewTraversal(f.s,f.crew,f.site);assert.equal(result.status,'blocked');assert.equal(result.reason,'route_unavailable');
 assert.equal(f.crew.airlockTraversal,null);assert.equal(f.controller.airlock.queue.length,0);assert.deepEqual(f.crew.carry,{alloy:2});
});

test('cancellation after real admission returns the intact party through the entry side',()=>{
 const f=fixture();request(f);until(f,()=>f.controller.airlock.phase==='recover');
 const position=[f.crew.x,f.crew.y];assert.equal(command(f,'cancel',{crew:f.crew.id}).recovering,true);assert.deepEqual([f.crew.x,f.crew.y],position);
 until(f,()=>!f.crew.airlockTraversal);assert.deepEqual([f.crew.x,f.crew.y],STAGING.inner);assert.equal(f.controller.airlock.phase,'idle');
});

test('an attached immobile patient walks only with the rescuer while cargo and original intent survive waiting',()=>{
 const f=fixture(),patient=f.s.crew[1];Object.assign(patient,{x:STAGING.inner[0],y:STAGING.inner[1]});patient.medical.injury=90;
 f.crew.rescue={patient:patient.id,carrying:true};f.crew.carry={food:1,_food:[{amount:1,age:12}]};f.crew.intent={type:'synthetic-recovery',source:STAGING.inner};f.crew.job='synthetic-job';
 const retained=JSON.stringify({carry:f.crew.carry,intent:f.crew.intent,rescue:f.crew.rescue,job:f.crew.job});
 request(f);until(f,()=>!f.crew.airlockTraversal,{onTick:()=>{
 assert.deepEqual([patient.x,patient.y],[f.crew.x,f.crew.y]);
 assert.equal(JSON.stringify({carry:f.crew.carry,intent:f.crew.intent,rescue:f.crew.rescue,job:f.crew.job}),retained);
 }});assert.deepEqual([patient.x,patient.y],STAGING.outer);assert.equal(patient.airlockTraversal,null);
});

test('manual release lets unclaimed crew enter and leave the selected side for repair without a cycle request',()=>{
 const f=fixture();assert.equal(command(f,'release',{side:'inner',acceptAtmosphereLoss:true}).ok,true);
 for(const destination of [[7,7],STAGING.inner]) {
 for(let i=0;i<4&&(f.crew.x!==destination[0]||f.crew.y!==destination[1]);i++){
 const result=advanceCrewRoute(f.s,f.crew,f.site,[destination]);assert.notEqual(result.status,'blocked',result.reason||'manual access blocked');
 physicalTick(f);assert.equal(f.crew.airlockTraversal,null);assert.equal(f.controller.airlock.queue.length,0);
 }
 assert.deepEqual([f.crew.x,f.crew.y],destination);
 }
 assert.equal(airlockDoorPermit(f.site,f.crew,position([8,7]),position(CONFIG.outer)),false);
 const result=advanceCrewRoute(f.s,f.crew,f.site,[STAGING.outer]);assert.equal(result.status,'blocked');assert.equal(f.crew.airlockTraversal,null);
});

test('queue ordering is stable by urgency, request tick and crew ID without duplicate claims',()=>{
 const f=fixture(),second=f.s.crew[1],urgent=f.s.crew[2];Object.assign(second,{x:STAGING.inner[0],y:STAGING.inner[1]});Object.assign(urgent,{x:STAGING.inner[0],y:STAGING.inner[1],oxygen:1});
 request(f,'outward',second);request(f,'outward',f.crew);request(f,'outward',urgent);request(f,'outward',f.crew);
 assert.deepEqual(f.controller.airlock.queue.map(q=>q.crew),[urgent.id,f.crew.id,second.id]);assert.equal(f.controller.airlock.queue.length,3);
 assert.equal(command(f,'request',{crew:f.crew.id,direction:'inward'}).ok,false);
});

test('night and exhausted finite batteries produce a power pause without any gas grant',()=>{
 const f=fixture();f.s.tick=220;for(const site of Object.values(f.s.sites))site.atmosphere.tick=220;
 for(const t of f.site.tiles)if(t.building==='battery'){f.site.energy.discarded+=t.charge;t.charge=0;}
 request(f);const before=ledger(f);physicalTick(f);
 assert.equal(f.controller.airlock.reason,'no_power');assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');assertLedger(f,before);
});

test('setup rejects a vent whose only pump route passes through the closed extractor valve',()=>{
 const f=fixture({configure:false});
 // The lower pump branch reaches the extractor directly; the vent is reachable
 // only through that extractor until its valve closes. This is a real hex
 // failure topology, distinct from the valid upper independent vent feed.
 for(const [x,y] of [[7,6],[8,6],[7,4]])f.tile(x,y).pipe=null;
 for(const [from,to] of [[f.pump,f.tile(7,9)],[f.reservoir,f.tile(7,11)]]) {
  to.terrain='floor';to.building=from.building;to.hp=100;
  for(const field of ['gasDevice','gasStore','powerPriority'])if(Object.hasOwn(from,field)){to[field]=from[field];delete from[field];}
  from.building=null;
 }
 f.tile(7,9).gasDevice.direction='s';
 for(const [x,y] of [[7,8],[7,10]])f.tile(x,y).pipe=newPipe();
 updateRooms(f.site);const before=snapshot(f.s);
 const result=command(f,'configure',{...CONFIG,pump:[7,9],reservoir:[7,11]});
 assert.equal(result.ok,false);assert.equal(result.reason,'layout_changed');assert.equal(snapshot(f.s),before);
});


// Finite lean gas is installed only in this labeled synthetic mechanics fixture.
function finiteRefillFixture(reserve) {
 const f=fixture({chamberGas:.2,reserveGas:reserve,smoke:0});
 const lean=amount=>({oxygen:amount*.161,inert:amount*.839,co2:0});
 f.chamber.gas=lean(.2);f.habitat.gas=mix(f.habitat.volume*10);
 for(const room of [f.chamber,f.habitat]){room.smoke=0;room.heat=room.volume*20*293.15;refreshRoom(room);}
 for(const t of f.site.tiles)if(gasNode(t)){gasNode(t).gas=mix(0);gasNode(t).smoke=0;}
 f.reservoir.gasStore.gas=lean(reserve);f.site.gasNetwork.loaded=lean(reserve);
 [f.crew.x,f.crew.y]=CONFIG.chamber;
 return f;
}

for(const reserve of [20])test(`synthetic finite refill with reserve ${reserve} reaches a live safe exit`,()=>{
 const f=finiteRefillFixture(reserve),before=ledger(f),initial=snapshot(f.s);
 airlockStatus(f.s,f.site,f.controller);assert.equal(snapshot(f.s),initial,'status must not transfer or change finite gas');
 request(f,'inward');prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,null,'finite gas at the commanded target is breathable');
 physicalTick(f);
 let matched=null;
 until(f,()=>!f.crew.airlockTraversal,{max:200,label:'finite lean-gas inward cycle',onTick:()=>{
  if(airlockOpen(f.site,f.inner)&&!matched){
   matched=airlockRoomReading(f.chamber);
   assert.equal(airlockSideBlock(f.site,f.controller,'inner'),null,'live safe gas and pressure must precede opening');
   assert.ok(matched.breathable&&matched.thermalSafe);assert.equal(airlockOpen(f.site,f.outer),false);
   assert.equal(f.vent.gasDevice.target,100,'physical command keeps its habitat target');
   const remaining=airlockLayout(f.site,f.controller).phaseNodes.refill.reduce((n,t)=>n+Object.values(gasNode(t).gas).reduce((a,b)=>a+b,0),0);
   assert.ok(remaining>0&&remaining<reserve,'the physical vent consumes only finite reserve');
   close(remaining+Object.values(matched.gas).reduce((a,b)=>a+b,0),reserve+.2,'finite refill gas');
  }
 }});
 assert.ok(matched,'the real inner door must open');assert.deepEqual([f.crew.x,f.crew.y],STAGING.inner);
 assert.ok(f.site.gasNetwork.delivered.oxygen>0,'actual vent transfers must occur');assertLedger(f,before);
 assert.equal(f.controller.airlock.phase,'idle');assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');
});

// With temperature-aware pressure, this same finite reserve loses its narrow
// oxygen margin during native cooling. No legal vent target can create oxygen.
test('synthetic lean reserve 19.7 remains contained when cooling exhausts its safe fill margin',()=>{
 const f=finiteRefillFixture(19.7),before=ledger(f);request(f,'inward');prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,null,'initial finite mixture is breathable at 20 C');
 const party=JSON.stringify(f.controller.airlock.party),cycle=f.controller.airlock.cycle;
 until(f,()=>f.controller.airlock.reason==='contaminated_mix',{max:200,label:'temperature-aware lean-gas safe stop',onTick:()=>{
  assert.equal(airlockOpen(f.site,f.inner),false);assert.equal(airlockOpen(f.site,f.outer),false);
  assert.equal(JSON.stringify(f.controller.airlock.party),party);assert.equal(f.controller.airlock.cycle,cycle);
 }});
 assert.equal(f.controller.airlock.phase,'paused');assert.deepEqual([f.crew.x,f.crew.y],CONFIG.chamber);
 const layout=airlockLayout(f.site,f.controller),all={...f.chamber.gas};let remaining=0;
 for(const t of layout.phaseNodes.refill){const gas=gasNode(t).gas;for(const k of Object.keys(all))all[k]+=gas[k];remaining+=Object.values(gas).reduce((a,b)=>a+b,0);}
 assert.ok(remaining>0&&remaining<19.7);close(Object.values(all).reduce((a,b)=>a+b,0),19.9,'finite refill gas');
 assert.equal(airlockRoomReading({...f.chamber,gas:all}).breathable,false,'even every remaining gas parcel cannot make a safe mixture');
 assert.equal(airlockSideBlock(f.site,f.controller,'inner'),'contaminated_mix');assertLedger(f,before);
});

test('synthetic finite refill rejects reserve that cannot reach safe oxygen partial pressure',()=>{
 const f=finiteRefillFixture(19.6),before=ledger(f);request(f,'inward');prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,'contaminated_mix');assert.equal(f.controller.airlock.party,null);
 assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');assertLedger(f,before);
});

test('synthetic refill keeps the rounded habitat target and status remains read-only',()=>{
 const f=finiteRefillFixture(20);f.habitat.gas=mix(f.habitat.volume*10*.996);refreshRoom(f.habitat);
 request(f,'inward');until(f,()=>f.site.gasNetwork.delivered.oxygen>0,{max:20,label:'physical vent starts'});
 assert.equal(f.controller.airlock.reason,null);assert.equal(f.vent.gasDevice.target,100);
 const before=snapshot(f.s);airlockStatus(f.s,f.site,f.controller);assert.equal(snapshot(f.s),before);
});


// SYNTHETIC finite pocket: the original 20-unit reserve is split physically
// before the canonical recording boundary. Neither inventory is granted later.
test('synthetic refill returns a finite extractor pocket through its disabled passive port',async()=>{
 const f=fixture({chamberGas:.2,reserveGas:20,smoke:0});
 const pocket=3, fraction=pocket/20;
 f.extractor.gasStore.gas=Object.fromEntries(Object.entries(f.reservoir.gasStore.gas).map(([k,n])=>[k,n*fraction]));
 f.reservoir.gasStore.gas=Object.fromEntries(Object.entries(f.reservoir.gasStore.gas).map(([k,n])=>[k,n*(1-fraction)]));
 [f.crew.x,f.crew.y]=STAGING.outer;
 const input=serialize(f.s);assert.equal(serialize(deserialize(input)),input,'prepared input is canonical');
 const before=ledger(f),initialPressure=f.habitat.pressure;
 assert.ok(17<Math.max(0,f.chamber.volume*10*(initialPressure-2)/100-.2),'reservoir alone cannot meet the finite fill requirement');
 let failure=null,recording='',ticks=0;
 startRecording(f.s,{maxRecords:12000,maxBytes:128_000_000});
 try {
  const result=executeAction(f.s,'airlock.request',{site:'surface',x:CONFIG.x,y:CONFIG.y,crew:f.crew.id,direction:'inward'},'agent');assert.equal(result.ok,true);
  while(f.crew.airlockTraversal||f.controller.airlock.queue.length||f.controller.airlock.phase!=='idle') {
   assert.ok(ticks<80,'finite passive-pocket cycle stops within 80 full ticks');
   assert.equal(executeAction(f.s,'simulation.step',{ticks:1},'agent').ok,true);ticks++;
   assert.equal(f.controller.airlock.reason,null);
   if(f.vent.gasDevice.enabled){assert.equal(f.extractor.gasStore.open,true);assert.equal(f.extractor.gasDevice.enabled,false);}
  }
  assert.deepEqual([f.crew.x,f.crew.y],STAGING.inner);assertLedger(f,before);
  for(const ref of f.controller.airlock.ownedNodes){const n=gasNode(f.tile(ref.x,ref.y));if(n)assert.equal(n.open,false,'idle ports isolate retained contents');}
  assert.equal(executeAction(f.s,'airlock.enable',{site:'surface',x:CONFIG.x,y:CONFIG.y,enabled:false},'agent').ok,true);
  assert.equal(f.controller.airlock.phase,'paused');
  for(const ref of f.controller.airlock.ownedNodes){const n=gasNode(f.tile(ref.x,ref.y));if(n)assert.equal(n.open,false,'paused ports isolate retained contents');}
 } catch(error) {failure=error;}
 stopRecording(f.s);recording=exportRecording(f.s);
 const rows=recording.trim().split('\n').map(line=>JSON.parse(line)),records=rows.slice(1,-1),events=records.filter(r=>r.kind==='event').map(r=>r.event);
 try {
  assert.ok(events.some(e=>e.id==='gas.transferred'&&e.from===`tile:surface:${CONFIG.extractor.join(':')}`&&e.amount>0),'stored extractor gas moves through physical typed transfers');
  assert.equal(events.filter(e=>e.id==='gas.extracted').length,0,'disabled extractor never captures during this inward refill');
  assert.equal(events.filter(e=>e.id==='airlock.traversed'&&e.direction==='inward').length,1);
  assert.equal(records.filter(r=>r.kind==='external').length,0);records.forEach((r,i)=>assert.equal(r.sequence,i+1));assert.equal(rows.at(-1).reason,'stopped');
 } catch(error) {failure??=error;}
 const directory=process.env.AIRLOCK_FREIGHT_OUTPUT_DIR;
 if(directory){
  await mkdir(directory,{recursive:true});
  for(const [label,text] of Object.entries({input,endpoint:serialize(f.s),recording,summary:JSON.stringify({ticks,ok:!failure,failure:failure?.message})})){
   const sha=createHash('sha256').update(text).digest('hex'),path=join(directory,`core-passive-pocket-${label}-sha256-${sha}.txt`);
   try{await writeFile(path,text,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
   assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),sha);await chmod(path,0o444);
  }
 }
 if(failure)throw failure;
});

// SYNTHETIC finite inward journey. Every preparation precedes the canonical
// boundary; subsequent room pressure loss comes from ordinary suit refilling.
test('full ticks correct exit pressure drift without losing the party, cycle or parcel',()=>{
 const f=fixture({chamberGas:.2,reserveGas:35,smoke:0});
 [f.crew.x,f.crew.y]=STAGING.outer;f.crew.oxygen=50;
 const depot=f.tile(...STAGING.inner);depot.building='stockpile';initializeStorage(depot);depot.stock={};
 f.crew.carry={alloy:1};f.crew.delivery={kind:'stock',target: { x: STAGING.inner[0], y: STAGING.inner[1], z: 0 }};
 const input=serialize(f.s);assert.equal(serialize(deserialize(input)),input);
 const before=ledger(f),parcel=JSON.stringify(f.crew.carry),delivery=JSON.stringify(f.crew.delivery);
 startRecording(f.s,{maxRecords:12000,maxBytes:128_000_000});
 assert.equal(executeAction(f.s,'airlock.request',{site:CONFIG.site,x:CONFIG.x,y:CONFIG.y,crew:f.crew.id,direction:'inward'},'agent').ok,true);
 let ticks=0,cycleId=null,correctionSeen=false;
 while(f.crew.airlockTraversal||f.controller.airlock.queue.length||f.controller.airlock.phase!=='idle') {
  assert.ok(ticks++<100,'finite exit correction completes within 100 full ticks');
  assert.equal(executeAction(f.s,'simulation.step',{ticks:1},'agent').ok,true);
  const a=f.controller.airlock;
  assert.equal(a.reason,null);assert.equal(JSON.stringify(f.crew.carry),parcel);assert.equal(JSON.stringify(f.crew.delivery),delivery);
  if(a.party){cycleId??=a.cycle;assert.equal(a.cycle,cycleId);assert.equal(a.party.crew,f.crew.id);}
  assert.ok(!(airlockOpen(f.site,f.inner)&&airlockOpen(f.site,f.outer)));
 }
 stopRecording(f.s);
 const events=exportRecording(f.s).trim().split('\n').map(JSON.parse).filter(r=>r.kind==='event').map(r=>r.event);
 correctionSeen=events.some(e=>e.id==='airlock.phase_changed'&&e.reason==='exit_pressure_drift'&&e.next==='refill');
 assert.equal(correctionSeen,true,'physiology forces sealed finite correction');
 assert.ok(events.some(e=>e.id==='crew.air.allocated'&&e.refillOxygen>0));
 assert.equal(events.filter(e=>e.id==='airlock.traversed'&&e.direction==='inward').length,1);
 assert.deepEqual([f.crew.x,f.crew.y],STAGING.inner);assertLedger(f,before);
});

for(const refusal of ['occupied threshold','party already outside','split rescue party'])test(`exit pressure correction refuses ${refusal}`,()=>{
 const f=fixture({chamberGas:20,reserveGas:35,smoke:0});
 [f.crew.x,f.crew.y]=CONFIG.chamber;f.crew.oxygen=50;request(f,'inward');
 until(f,()=>f.controller.airlock.phase==='release',{tick:g=>physicalTick(g,{move:false})});
 // Native body refill removes finite room oxygen; no gas parcel is edited.
 breathe(f.site,f.crew);breathe(f.site,f.crew);breathe(f.site,f.crew);
 assert.equal(airlockSideBlock(f.site,f.controller,'inner'),'pressure_mismatch');
 if(refusal==='occupied threshold')[f.crew.x,f.crew.y]=CONFIG.inner;
 else if(refusal==='party already outside')[f.crew.x,f.crew.y]=STAGING.inner;
 else {const patient=f.s.crew[1];f.controller.airlock.party.patient=patient.id;f.crew.rescue={patient:patient.id,carrying:true};}
 const cycleId=f.controller.airlock.cycle,party=JSON.stringify(f.controller.airlock.party);
 prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.phase,'release');assert.equal(f.controller.airlock.cycle,cycleId);assert.equal(JSON.stringify(f.controller.airlock.party),party);
 assert.equal(f.pump.gasDevice.enabled,false);assert.equal(f.extractor.gasDevice.enabled,false);assert.equal(f.vent.gasDevice.enabled,false);
 if(refusal==='occupied threshold')assert.equal(f.inner.doorMode,'open','an occupied threshold is never sealed');
});


function tankMakeupFixture(options={}) {
 const f=fixture({...options,configure:false});f.reservoir.building='gasTank';initializeStorage(f.reservoir);
 assert.equal(executeAction(f.s,'airlock.configure',CONFIG,'test').ok,true);return f;
}

test('owned tank makeup reserves smoke recovery headroom and keeps allowance read-only',()=>{
 const f=tankMakeupFixture({reserveGas:0}),layout=airlockLayout(f.site,f.controller),q=airlockGasQuantities(layout);
 for(const t of q.recover){gasNode(t).gas=mix(gasCapacity(t));gasNode(t).smoke=0;}
 f.reservoir.gasStore.gas=mix(80-q.recoverNeeded-.5);f.vent.gasStore.gas=mix(10);
 f.reservoir.machine.input.air=3;const before=JSON.stringify(f.s);
 close(airlockTankMakeupAllowance(f.site,f.reservoir),.5);assert.equal(JSON.stringify(f.s),before);
 const loaded={...f.site.gasNetwork.loaded};updateGasNetworks(f.s);
 close(f.reservoir.machine.input.air,2.5);close(f.site.gasNetwork.loaded.oxygen-loaded.oxygen,.5*.21);close(f.site.gasNetwork.loaded.inert-loaded.inert,.5*.79);
 const after=airlockGasQuantities(airlockLayout(f.site,f.controller));close(after.headroom,after.recoverNeeded);close(airlockTankMakeupAllowance(f.site,f.reservoir),0);
});

test('owned tank makeup eligibility preserves lifecycle, power and manual ownership gates',()=>{
 const f=tankMakeupFixture();const input=serialize(f.s);assert.equal(serialize(deserialize(input)),input);
 const a=f.controller.airlock;request(f);assert.ok(airlockTankMakeupAllowance(f.site,f.reservoir)>0);
 a.phase='paused';a.resumePhase='idle';a.reason='supply_empty';assert.ok(airlockTankMakeupAllowance(f.site,f.reservoir)>0);
 for(const reason of ['manual_release','disabled','no_power','contaminated_mix','reservoir_full']){a.reason=reason;assert.equal(airlockTankMakeupAllowance(f.site,f.reservoir),0);}
 a.reason='supply_empty';a.party={crew:f.crew.id};assert.equal(airlockTankMakeupAllowance(f.site,f.reservoir),0);a.party=null;
 f.controller.powered=false;assert.equal(airlockTankMakeupAllowance(f.site,f.reservoir),0);f.controller.powered=true;
 a.enabled=false;assert.equal(airlockTankMakeupAllowance(f.site,f.reservoir),0);a.enabled=true;
 f.inner.doorMode='open';assert.equal(airlockTankMakeupAllowance(f.site,f.reservoir),0);f.inner.doorMode='closed';
 f.reservoir.gasStore.open=true;assert.equal(airlockTankMakeupAllowance(f.site,f.reservoir),0);f.reservoir.gasStore.open=false;
 for(const [id,args] of [['production.enable',{site:'surface',x:7,y:3,enabled:false}],['gas.valve',{site:'surface',x:7,y:3,open:true}]]){
  const result=executeAction(f.s,id,args,'test');assert.equal(result.code,'simulation_rejected');assert.equal(result.reason,'airlock_controlled');
 }
 const orphan=tankMakeupFixture(),canonical=serialize(orphan.s);assert.equal(serialize(deserialize(canonical)),canonical);
 orphan.reservoir.airlockOwner.binding='orphan';assert.equal(airlockTankMakeupAllowance(orphan.site,orphan.reservoir),0);assert.throws(()=>deserialize(serialize(orphan.s)));
});

// SYNTHETIC preparation ends at the canonical boundary. Only shared actions
// and ordinary native hauling run after recording begins; no journey claim.
test('full ticks replenish queued supply-empty admission from physically hauled finite air',async()=>{
 const f=tankMakeupFixture({chamberGas:0,reserveGas:0,smoke:0});
 f.habitat.gas={oxygen:2.9,inert:7.1,co2:0};refreshAtmosphere(f.site);
 for(const c of f.s.crew.slice(1,4)){c.x=18;c.y=11;c.labors.hauling=true;}
 const input=serialize(f.s);assert.equal(serialize(deserialize(input)),input);
 const before=ledger(f),initialAir=f.tile(18,11).stock.air;let ticks=0,attempts=0,sawPaused=false,sawPickup=false,failure=null;
 startRecording(f.s,{maxRecords:12000,maxBytes:128_000_000});
 const act=(id,args)=>{assert.ok(attempts++<120,'120 shared attempts');const result=executeAction(f.s,id,args,'agent');assert.equal(result.ok,true,result.reason||result.message);};
 try {
  act('airlock.request',{site:'surface',x:CONFIG.x,y:CONFIG.y,crew:f.crew.id,direction:'outward'});
  while(!f.controller.airlock.party){
   assert.ok(ticks++<80,'80 full ticks');act('simulation.step',{ticks:1});
   const a=f.controller.airlock;sawPaused||=a.phase==='paused'&&a.reason==='supply_empty';sawPickup||=f.s.crew.some(c=>(c.carry?.air||0)>0);
   assert.ok(a.reason===null||a.reason==='supply_empty',a.reason);assert.ok(f.s.crew.every(c=>c.health===100&&c.medical.injury===0),'first harm');
   assert.equal(serialize(deserialize(serialize(f.s))),serialize(f.s));
   const loaded=f.site.gasNetwork.loaded,after=ledger(f);close(after.oxygen,before.oxygen+loaded.oxygen);close(after.inert,before.inert+loaded.inert);close(after.co2,before.co2);close(after.energy,0);
  }
  assert.ok(sawPaused&&sawPickup);assert.ok(f.site.gasNetwork.loaded.oxygen>0);assert.equal(f.controller.airlock.reason,null);
  const packaged=f.tile(18,11).stock.air+(f.reservoir.machine.input.air||0)+f.s.crew.reduce((n,c)=>n+(c.carry?.air||0),0);
  close(packaged+Object.values(f.site.gasNetwork.loaded).reduce((a,b)=>a+b,0),initialAir);
 }catch(error){failure=error;}
 stopRecording(f.s);const recording=exportRecording(f.s),directory=process.env.AIRLOCK_FREIGHT_OUTPUT_DIR;
 const events=recording.trim().split('\n').map(JSON.parse).filter(r=>r.kind==='event').map(r=>r.event);
 try {assert.ok(events.some(e=>e.id==='gas.loaded'&&e.binding===f.controller.airlock.binding&&e.amount>0));}catch(error){failure??=error;}
 if(directory){await mkdir(directory,{recursive:true});for(const [label,text] of Object.entries({input,endpoint:serialize(f.s),recording,summary:JSON.stringify({ticks,attempts,ok:!failure,failure:failure?.message})})){const sha=createHash('sha256').update(text).digest('hex'),path=join(directory,`core-tank-makeup-${label}-sha256-${sha}.txt`);await writeFile(path,text,{flag:'wx'});assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),sha);await chmod(path,0o444);}}
 if(failure)throw failure;
});
