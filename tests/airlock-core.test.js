import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, command, request, cycle, until, physicalTick, ledger, assertLedger, snapshot, close } from './helpers/airlock-fixture.js';
import { airlockStatus, airlockDoorPermit, airlockOpen, airlockLayout } from '../src/airlock-access.js';
import { gasNode, gasCapacity } from '../src/gas-networks.js';
import { mix, moveCrew, refreshRoom, updateRooms } from '../src/atmosphere.js';
import { continueCrewTraversal, advanceCrewRoute } from '../src/crew-traversal.js';

// Every installation here is a labeled synthetic fixture; paid acceptance is separate.
test('synthetic real-physics outward and inward cycles conserve species, smoke and allocated energy',()=>{
 const f=fixture(),before=ledger(f),phases=new Set();
 const capture=()=>phases.add(f.controller.airlock.phase);
 const out=cycle(f,'outward',{onTick:capture});assert.deepEqual([f.crew.x,f.crew.y],[10,7]);
 assert.ok(f.site.gasNetwork.extracted.oxygen>0,'recovery must use extractor');
 assert.ok(f.site.atmosphere.vented.oxygen>0,'actual outer opening records finite residual loss');
 assert.ok(f.site.atmosphere.vented.oxygen<.1,'outward residual must be bounded');
 const inward=cycle(f,'inward',{onTick:capture});assert.deepEqual([f.crew.x,f.crew.y],[5,7]);
 assert.ok(f.site.gasNetwork.delivered.oxygen>0,'refill must use vent');
 assert.ok(phases.has('recover')&&phases.has('refill'),'both physical transfer phases observed');
 assert.ok(f.site.energy.consumed>=out+inward,'real controller energy paid');
 assert.ok(f.site.gasNetwork.extracted.co2>0&&f.site.gasNetwork.delivered.co2>0,'nonzero CO2 must travel with the actual mixture');
 cycle(f,'outward');cycle(f,'inward');assertLedger(f,before);
 assert.equal(f.controller.airlock.phase,'idle');assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');
});

test('same-tick stale paths, unrelated crew and animals cannot tailgate either door',()=>{
 const f=fixture();request(f);until(f,()=>f.controller.airlock.phase==='admit');
 const stranger=f.s.crew[1];stranger.x=5;stranger.y=7;
 assert.equal(airlockDoorPermit(f.site,stranger,[5,7],[6,7]),false);
 assert.equal(moveCrew(stranger,f.site,[6,7]),false);assert.deepEqual([stranger.x,stranger.y],[5,7]);
 assert.equal(airlockDoorPermit(f.site,{id:'animal',species:'bristleback'},[5,7],[6,7]),false);
 assert.equal(airlockDoorPermit(f.site,f.crew,[8,7],[9,7]),false);
 assert.equal(moveCrew(f.crew,f.site,[9,7]),false);
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
 until(f,()=>!f.crew.airlockTraversal);assert.deepEqual([f.crew.x,f.crew.y],[10,7]);
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
 const f=fixture();request(f);until(f,()=>f.crew.x===6&&f.crew.y===7);
 for(const t of f.site.tiles)if(t.cable)t.cable.enabled=false;physicalTick(f);
 assert.equal(f.controller.airlock.reason,'no_power');assert.equal(airlockOpen(f.site,f.inner),true);assert.equal(airlockOpen(f.site,f.outer),false);
 assert.deepEqual([f.crew.x,f.crew.y],[6,7]);assert.ok(f.crew.airlockTraversal);
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
 request(f,'inward');for(const [x,y] of [[17,13],[19,13],[18,12],[18,14]])f.tile(x,y).building='wall';
 const result=continueCrewTraversal(f.s,f.crew,f.site);assert.equal(result.status,'blocked');assert.equal(result.reason,'route_unavailable');
 assert.equal(f.crew.airlockTraversal,null);assert.equal(f.controller.airlock.queue.length,0);assert.deepEqual(f.crew.carry,{alloy:2});
});

test('cancellation after real admission returns the intact party through the entry side',()=>{
 const f=fixture();request(f);until(f,()=>f.controller.airlock.phase==='recover');
 const position=[f.crew.x,f.crew.y];assert.equal(command(f,'cancel',{crew:f.crew.id}).recovering,true);assert.deepEqual([f.crew.x,f.crew.y],position);
 until(f,()=>!f.crew.airlockTraversal);assert.deepEqual([f.crew.x,f.crew.y],[5,7]);assert.equal(f.controller.airlock.phase,'idle');
});

test('an attached immobile patient walks only with the rescuer while cargo and original intent survive waiting',()=>{
 const f=fixture(),patient=f.s.crew[1];Object.assign(patient,{x:5,y:7});patient.medical.injury=90;
 f.crew.rescue={patient:patient.id,carrying:true};f.crew.carry={food:1,_food:[{amount:1,age:12}]};f.crew.intent={type:'synthetic-recovery',source:[5,7]};f.crew.job='synthetic-job';
 const retained=JSON.stringify({carry:f.crew.carry,intent:f.crew.intent,rescue:f.crew.rescue,job:f.crew.job});
 request(f);until(f,()=>!f.crew.airlockTraversal,{onTick:()=>{
 assert.deepEqual([patient.x,patient.y],[f.crew.x,f.crew.y]);
 assert.equal(JSON.stringify({carry:f.crew.carry,intent:f.crew.intent,rescue:f.crew.rescue,job:f.crew.job}),retained);
 }});assert.deepEqual([patient.x,patient.y],[10,7]);assert.equal(patient.airlockTraversal,null);
});

test('manual release lets unclaimed crew enter and leave the selected side for repair without a cycle request',()=>{
 const f=fixture();assert.equal(command(f,'release',{side:'inner',acceptAtmosphereLoss:true}).ok,true);
 for(const destination of [[7,7],[5,7]]) {
 for(let i=0;i<4&&(f.crew.x!==destination[0]||f.crew.y!==destination[1]);i++){
 const result=advanceCrewRoute(f.s,f.crew,f.site,[destination]);assert.notEqual(result.status,'blocked',result.reason||'manual access blocked');
 physicalTick(f);assert.equal(f.crew.airlockTraversal,null);assert.equal(f.controller.airlock.queue.length,0);
 }
 assert.deepEqual([f.crew.x,f.crew.y],destination);
 }
 assert.equal(airlockDoorPermit(f.site,f.crew,[8,7],[9,7]),false);
 const result=advanceCrewRoute(f.s,f.crew,f.site,[[10,7]]);assert.equal(result.status,'blocked');assert.equal(f.crew.airlockTraversal,null);
});

test('queue ordering is stable by urgency, request tick and crew ID without duplicate claims',()=>{
 const f=fixture(),second=f.s.crew[1],urgent=f.s.crew[2];Object.assign(second,{x:5,y:7});Object.assign(urgent,{x:5,y:7,oxygen:1});
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
 const f=fixture({configure:false});f.tile(8,6).pipe=null;const before=snapshot(f.s);
 const result=command(f,'configure',{chamber:[7,7],inner:[6,7],outer:[9,7],extractor:[7,7],pump:[7,5],reservoir:[7,3],vent:[8,7]});
 assert.equal(result.ok,false);assert.equal(result.reason,'layout_changed');assert.equal(snapshot(f.s),before);
});
