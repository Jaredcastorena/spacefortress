import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {serialize,deserialize,step} from '../src/simulation.js';
import {VERSION,BUILDINGS} from '../src/data.js';
import {executeAction,actionCatalog} from '../src/controls.js';
import {airlockStatus,airlockLayout,airlockId,airlockControlOwner,airlockSideBlock} from '../src/airlock-access.js';
import {airlockDetails,airlockOwnershipDetails,airlockFormAction} from '../src/airlock-panels.js';
import {planCrewRoutePositions} from '../src/navigation.js';
import {advanceCrewRoutePositions,cancelCrewTraversal} from '../src/crew-traversal.js';
import {observe,startRecording,exportRecording,tileEntityId} from '../src/telemetry.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {prepareAirlocks} from '../src/airlocks.js';
import {setRoomGas} from './helpers/airlock-fixture.js';
import {roomAt} from '../src/atmosphere.js';
import {refreshPower} from '../src/power.js';
import {fixture,CONFIG,STAGING,physicalTick,ledger,assertLedger} from './helpers/airlock-fixture.js';
import {floorFixture,floorRefs,upperCommand,upperTarget,stairToHabitat} from './helpers/airlock-floor-fixture.js';
// Captured before edits from v0.1.6/f54f57c at schema59, tick3/recover.
// Original reload verified; the ground assembly is a synthetic subsystem fixture.
const original=gunzipSync(readFileSync(new URL('./fixtures/airlocks-schema59.json.gz',import.meta.url))).toString();
const reload=s=>deserialize(serialize(s));
function until(f,p,max=180,tick=physicalTick){for(let i=0;i<max&&!p();i++)tick(f);assert.ok(p(),JSON.stringify({phase:f.controller.airlock.phase,reason:f.controller.airlock.reason,crew:positionOf(f.crew)}));}
const doCycle=(f,d)=>{const r=upperCommand(f,'request',{crew:f.crew.id,direction:d});assert.equal(r.ok,true,r.message);until(f,()=>!f.crew.airlockTraversal);};

test('genuine schema59 in-flight cycle migrates without changing physical state',()=>{
 assert.equal(createHash('sha256').update(original).digest('hex'),'7e5360c0294595a467ac0d2148a686179e125ec4d2ab8e611c1ec8727cbd3f14');
 const old=JSON.parse(original),s=deserialize(original);assert.equal(old.version,59);assert.equal(s.version,VERSION);old.version=VERSION;old.resources.tools=0;assert.deepEqual(s,old);assert.equal(serialize(reload(s)),serialize(s));
});
test('stacked assemblies bind distinct floor ownership with pure matching observations and UI',()=>{
 const f=floorFixture(),ground=floorRefs(f.s,0),before=serialize(f.s),status=airlockStatus(f.s,f.site,f.controller);
 assert.equal(status.entity,tileEntityId('surface',CONFIG.x,CONFIG.y,1));assert.notEqual(airlockId(f.site,ground.controller),status.entity);
 assert.equal(airlockControlOwner(f.site,f.inner).controller,status.entity);assert.equal(airlockControlOwner(f.site,ground.inner).controller,airlockId(f.site,ground.controller));
 assert.equal(observe(f.s).entities[status.entity].derived.airlock.entity,status.entity);assert.match(airlockOwnershipDetails(f.site,f.inner),/data-z="1"/);assert.match(airlockDetails(f.s,f.site,f.controller),/floor 1/);
 assert.equal(serialize(f.s),before);assert.equal(serialize(reload(f.s)),before);
 const actions=actionCatalog().filter(a=>a.id.startsWith('airlock.'));assert.equal(actions.length,6);assert.ok(actions.every(a=>a.parameters.properties.z));
 const values=Object.fromEntries(Object.entries(CONFIG).filter(([,v])=>Array.isArray(v)).flatMap(([k,v])=>[['x','y'].map((axis,i)=>[`${k}-${axis}`,String(v[i])])].flat()));
 assert.deepEqual(airlockFormAction('configure',values,upperTarget).args,{...CONFIG,z:1});
});
test('upper outward and inward cycles conserve finite gas, smoke and energy and leave ground control idle',()=>{
 const f=floorFixture(),ground=floorRefs(f.s,0),before=ledger(f),originalGround=structuredClone(ground.controller.airlock);startRecording(f.s);
 doCycle(f,'outward');assert.deepEqual(positionOf(f.crew),{x:STAGING.outer[0],y:STAGING.outer[1],z:1});assertLedger(f,before);reload(f.s);
 doCycle(f,'inward');assert.deepEqual(positionOf(f.crew),{x:STAGING.inner[0],y:STAGING.inner[1],z:1});assertLedger(f,before);assert.deepEqual(ground.controller.airlock,originalGround);reload(f.s);
 const events=exportRecording(f.s).trim().split('\n').map(JSON.parse).filter(r=>r.event?.id.startsWith('airlock.')).map(r=>r.event);assert.ok(events.some(e=>e.id==='airlock.traversed'));assert.ok(events.every(e=>e.entity.endsWith(':1')));
});
test('save and reload during upper recovery continue identically through pressure transitions',()=>{
 const f=floorFixture();assert.equal(upperCommand(f,'request',{crew:f.crew.id,direction:'outward'}).ok,true);until(f,()=>f.controller.airlock.phase==='recover');const other=floorRefs(reload(f.s));
 for(let i=0;i<14;i++){physicalTick(f);physicalTick(other);assert.equal(serialize(f.s),serialize(other.s));}
});
test('stairs connect ground approaches to an upstairs airlock without flattening destination or controller',()=>{
 const f=floorFixture(),link=stairToHabitat(f);f.crew.z=0;const goal={x:STAGING.outer[0],y:STAGING.outer[1],z:1},plan=planCrewRoutePositions(f.s,f.site,f.crew,[goal]);assert.ok(plan);assert.ok(plan.segments.some(s=>s.kind==='airlock'&&s.controller===airlockId(f.site,f.controller)));
 link.mode='closed';assert.equal(planCrewRoutePositions(f.s,f.site,f.crew,[goal]),null);link.mode='auto';
 const before=ledger(f);until(f,()=>!f.crew.airlockTraversal&&JSON.stringify(positionOf(f.crew))===JSON.stringify(goal),180,x=>{physicalTick(x,{move:false});advanceCrewRoutePositions(x.s,x.crew,x.site,[goal]);});assertLedger(f,before);reload(f.s);
});
test('upper control cancellation, power loss and manual release never operate the overlapping ground controller',()=>{
 const f=floorFixture(),ground=floorRefs(f.s,0);assert.equal(upperCommand(f,'request',{crew:f.crew.id,direction:'outward'}).ok,true);assert.equal(cancelCrewTraversal(f.s,f.crew).ok,true);assert.equal(f.controller.airlock.queue.length,0);assert.equal(ground.controller.airlock.phase,'idle');
 assert.equal(upperCommand(f,'request',{crew:f.crew.id,direction:'outward'}).ok,true);until(f,()=>f.controller.airlock.phase==='recover');f.controller.cable.enabled=false;refreshPower(f.s,f.site);physicalTick(f);assert.equal(f.controller.airlock.reason,'no_power');assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');reload(f.s);
 assert.equal(upperCommand(f,'release',{side:'inner',acceptAtmosphereLoss:true}).ok,true);assert.equal(f.inner.doorMode,'open');assert.equal(f.outer.doorMode,'closed');assert.equal(ground.inner.doorMode,'closed');assert.equal(ground.outer.doorMode,'closed');reload(f.s);
});
test('chamber stairs and gas riser bypasses cannot be bound or silently accepted',()=>{
 const f=floorFixture({configure:false}),chamber={x:CONFIG.chamber[0],y:CONFIG.chamber[1],z:1};f.site.verticalLinks.push({lower:{...chamber,z:0},upper:chamber});let before=serialize(f.s);assert.equal(executeAction(f.s,'airlock.configure',{...CONFIG,z:1}).reason,'layout_changed');assert.equal(serialize(f.s),before);
 f.site.verticalLinks=[];const p={x:CONFIG.reservoir[0],y:CONFIG.reservoir[1],z:1};f.site.utilityLinks.push({kind:'gas',lower:{...p,z:0},upper:p,enabled:false});before=serialize(f.s);assert.equal(executeAction(f.s,'airlock.configure',{...CONFIG,z:1}).reason,'layout_changed');assert.equal(serialize(f.s),before);
});
test('undeclared, mixed-floor and legacy future airlock claims reject without mutating valid state',()=>{
 const f=floorFixture(),before=serialize(f.s);assert.equal(upperCommand(f,'enable',{enabled:false,z:7}).ok,false);assert.equal(serialize(f.s),before);
 for(const mutate of [s=>{s.version=59;},s=>{floorRefs(s).controller.airlock.config.outer.z=0;},s=>{floorRefs(s).controller.airlock.ownedNodes[0].z=0;}]){const s=structuredClone(f.s);mutate(s);assert.throws(()=>reload(s));}
});
test('normal delivered construction can install and reload an upper-floor airlock controller',()=>{
 const raw=gunzipSync(readFileSync(new URL('./fixtures/solar-schema58.json.gz',import.meta.url))).toString(),s=deserialize(raw),site=s.sites.surface,p={x:8,y:8,z:1};assert.equal(tileAt(site,p).building,null);
 const result=executeAction(s,'job.order',{site:'surface',...p,kind:'build',building:'airlockController'});assert.equal(result.ok,true,result.message);const job=s.jobs.find(j=>j.id===result.job);assert.deepEqual(job.cost,BUILDINGS.airlockController.cost);assert.equal(tileAt(site,p).building,null);
 for(let i=0;i<160&&s.jobs.includes(job);i++)step(s);assert.ok(!s.jobs.includes(job));assert.equal(tileAt(site,p).building,'airlockController');assert.equal(tileAt(site,p).airlock,null);assert.equal(tileAt(site,{...p,z:0}).building,'solar');reload(s);
});

test('an upstairs rescue party and its carried cargo remain together through the pressure cycle',()=>{
 const f=floorFixture(),patient=f.s.crew[1];Object.assign(patient,{...positionOf(f.crew)});patient.medical.injury=90;f.crew.rescue={patient:patient.id,carrying:true};f.crew.carry={alloy:1};
 const cargo=structuredClone(f.crew.carry),before=ledger(f);assert.equal(upperCommand(f,'request',{crew:f.crew.id,direction:'outward'}).ok,true);
 until(f,()=>!f.crew.airlockTraversal,180,x=>{physicalTick(x);assert.deepEqual(positionOf(patient),positionOf(x.crew));assert.deepEqual(x.crew.carry,cargo);});
 assert.equal(patient.z,1);assert.equal(patient.airlockTraversal,null);assertLedger(f,before);
});
test('an exposed upper walkway must also have low measured pressure before outer release',()=>{
 const f=floorFixture(),outside=roomAt(f.site,...STAGING.outer,1);assert.equal(outside.sealed,false);setRoomGas(f.chamber,{oxygen:0,inert:0,co2:0});setRoomGas(outside,{oxygen:2,inert:8,co2:0},0);
 assert.equal(airlockSideBlock(f.site,f.controller,'outer'),'pressure_mismatch');setRoomGas(outside,{oxygen:0,inert:0,co2:0},0);assert.equal(airlockSideBlock(f.site,f.controller,'outer'),null);
});
test('adding an unowned gas bypass to a bound assembly pauses it before transfers',()=>{
 const f=floorFixture(),p={x:CONFIG.reservoir[0],y:CONFIG.reservoir[1],z:1};f.site.utilityLinks.push({kind:'gas',lower:{...p,z:0},upper:p,enabled:false});prepareAirlocks(f.s);assert.equal(f.controller.airlock.reason,'layout_changed');assert.equal(f.inner.doorMode,'closed');assert.equal(f.outer.doorMode,'closed');
 for(const ref of f.controller.airlock.ownedNodes){const t=tileAt(f.site,ref),node=t.pipe||t.gasStore;if(node)assert.equal(node.open,false);}
});
