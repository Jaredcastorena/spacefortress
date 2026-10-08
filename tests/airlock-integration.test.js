import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, refs, command, request, physicalTick, until, snapshot, CONFIG, TARGET, digest, ledger, assertLedger } from './helpers/airlock-fixture.js';
import { createGame, serialize, deserialize, step } from '../src/simulation.js';
import { executeAction, actionCatalog } from '../src/controls.js';
import { observe, startRecording, exportRecording } from '../src/telemetry.js';
import { airlockStatus, airlockLayout } from '../src/airlock-access.js';
import { planCrewRoute } from '../src/navigation.js';
import { prepareAirlocks } from '../src/airlocks.js';
import { refreshPower } from '../src/power.js';
import { refreshAtmosphere } from '../src/atmosphere.js';
import { extract, syncResources } from '../src/inventory.js';
import { projectPreAirlock } from './helpers/legacy-projection.js';

function roundtrip(s,label) {
 const bytes=serialize(s);let loaded;try{loaded=deserialize(bytes);}catch(error){throw new Error(`${label}: ${error.message}`);}
 assert.equal(snapshot(loaded),digest(bytes),`${label}: exact save roundtrip`);return loaded;
}
function continuation(s,label) {
 const loaded=roundtrip(s,label),a=refs(s),b=refs(loaded);
 for(let i=0;i<4;i++){physicalTick(a);physicalTick(b);assert.equal(snapshot(s),snapshot(loaded),`${label}: continuation tick ${i+1}`);}
}

test('synthetic controller fixture is a strict schema39 save with detached pure reads and planning',()=>{
 const f=fixture(),before=snapshot(f.s);
 roundtrip(f.s,'configured fixture');
 for(let i=0;i<3;i++){
 const status=airlockStatus(f.s,f.site,f.controller);status.config.inner[0]=-1;status.reservoir.gas.oxygen=999;
 const observed=observe(f.s);observed.entities['tile:surface:5:5'].derived.airlock.queue.push({crew:'forged'});
 planCrewRoute(f.s,f.site,f.crew,[[10,7]]);airlockLayout(f.site,f.controller);
 }
 assert.equal(snapshot(f.s),before);assert.equal(f.crew.airlockTraversal,null);assert.equal(f.controller.airlock.queue.length,0);
});

test('all six airlock shared actions have strict schemas and reject unknown/malformed fields atomically',()=>{
 const f=fixture({configure:false});const actions=actionCatalog().filter(a=>a.id.startsWith('airlock.'));
 assert.equal(actions.length,6);for(const a of actions)assert.equal(a.parameters.additionalProperties,false);
 for(const [id,args] of [
 ['configure',{...CONFIG,extra:1}],['configure',{...CONFIG,inner:[6.5,7]}],['enable',{...TARGET,enabled:1}],
 ['request',{...TARGET,crew:f.crew.id,direction:'sideways'}],['cancel',{...TARGET,crew:f.crew.id,extra:true}],
 ['release',{...TARGET,side:'outer',acceptAtmosphereLoss:false}],['unbind',{...TARGET,extra:null}],
 ]){const before=snapshot(f.s),result=executeAction(f.s,`airlock.${id}`,args,'test');assert.equal(result.ok,false,id);assert.equal(result.code,'invalid_arguments',id);assert.equal(snapshot(f.s),before,id);}
 assert.equal(executeAction(f.s,'airlock.configure',CONFIG,'test').ok,true);
 assert.equal(command(f,'enable',{enabled:false}).ok,true);assert.equal(command(f,'enable',{enabled:true}).ok,true);
 assert.equal(command(f,'unbind').ok,true);assert.equal(f.controller.airlock,null);
});

test('bound manual door/device/extractor/valve controls reject without changing gas or settings',()=>{
 const f=fixture();for(const [id,args] of [
 ['door.mode',{site:'surface',x:6,y:7,mode:'open'}],
 ['gas.device',{site:'surface',x:7,y:5,enabled:true,direction:'south',target:100}],
 ['gas.extractor',{site:'surface',x:7,y:7,enabled:true,mode:'filter',target:100}],
 ['gas.valve',{site:'surface',x:7,y:4,open:true}],
 ]){const before=snapshot(f.s),result=executeAction(f.s,id,args,'test');assert.equal(result.ok,false,id);assert.equal(result.reason,'airlock_controlled',`${id}: ${result.message}`);assert.equal(snapshot(f.s),before,id);}
});

test('schema38 migration preserves existing gas, door modes and timers; forged airlock fields reject before migration',()=>{
 const s=createGame(),legacy=projectPreAirlock(s,38),before=structuredClone(legacy);
 const loaded=deserialize(JSON.stringify(legacy));assert.equal(loaded.version,39);
 assert.equal(digest(projectPreAirlock(loaded,38)),digest(before),'legacy facts remain exact');
 for(const place of ['crew','tile','pipe','controller']){
 const forged=structuredClone(legacy);
 if(place==='crew')forged.crew[0].airlockTraversal=null;
 if(place==='tile')forged.sites.surface.tiles[0].airlock=null;
 if(place==='pipe')forged.sites.surface.tiles[0].pipe={airlockOwner:null};
 if(place==='controller')forged.sites.surface.tiles[0].building='airlockController';
 assert.throws(()=>deserialize(JSON.stringify(forged)),/airlock/i,place);
 }
});

test('interrupted queue, admission, actual transfers, release, pause and override reload exactly and continue deterministically',()=>{
 const f=fixture(),saved=new Map([['idle',serialize(f.s)]]);
 request(f);saved.set('queued',serialize(f.s));prepareAirlocks(f.s);saved.set('prepare_entry',serialize(f.s));
 const capture=()=>{const p=f.controller.airlock.phase;if(!saved.has(p))saved.set(p,serialize(f.s));};
 until(f,()=>!f.crew.airlockTraversal,{onTick:capture});
 request(f,'inward');until(f,()=>!f.crew.airlockTraversal,{onTick:capture});
 assert.ok(saved.has('recover')&&saved.has('refill')&&saved.has('admit')&&saved.has('release'),'real phases captured');
 // seal_entry advances within reconciliation; this is an explicitly synthetic
 // interruption at that valid transition boundary, with real retained gas.
 const sealing=JSON.parse(saved.get('recover'));refs(sealing).controller.airlock.phase='seal_entry';saved.set('seal_entry',serialize(sealing));
 const paused=refs(JSON.parse(saved.get('recover')));command(paused,'enable',{enabled:false});saved.set('paused',serialize(paused.s));
 const manual=refs(JSON.parse(saved.get('recover')));command(manual,'release',{side:'outer',acceptAtmosphereLoss:true});saved.set('manual_release',serialize(manual.s));
 for(const [label,bytes] of saved)continuation(JSON.parse(bytes),label);
});

test('reachable damaged and exhausted interruptions load without mutating state, while duplicated claims reject',()=>{
 const f=fixture();request(f);until(f,()=>f.controller.airlock.phase==='recover');
 for(const [name,change] of [
 ['missing pump',g=>{g.pump.building=null;delete g.pump.gasDevice;delete g.pump.powerPriority;delete g.pump.airlockOwner;}],['broken door',g=>{g.outer.hp=0;}],
 ['lost admitted traveler',g=>{g.crew.health=0;}],['empty battery',g=>{for(const t of g.site.tiles)if(t.building==='battery'){g.site.energy.discarded+=t.charge;t.charge=0;}}],
 ]){const g=refs(JSON.parse(serialize(f.s)));change(g);refreshPower(g.s,g.site);refreshAtmosphere(g.site);const before=snapshot(g.s);roundtrip(g.s,name);assert.equal(snapshot(g.s),before,name);}
 const duplicated=JSON.parse(serialize(f.s)),g=refs(duplicated);g.controller.airlock.queue.push({...g.controller.airlock.party});
 assert.throws(()=>deserialize(serialize(duplicated)),/airlock/i);
 const both=JSON.parse(serialize(f.s)),h=refs(both);h.inner.doorMode='open';h.outer.doorMode='open';refreshAtmosphere(h.site);
 assert.throws(()=>deserialize(serialize(both)),/airlock/i);
});

test('full simulation waits preserve an ordinary job, named parcel, food age and delivery claim',()=>{
 const f=fixture();
 // Synthetic preexisting job/cargo boundary; this does not claim paid hauling.
 const parcelId=`item-${f.s.nextItemId++}`,stock=f.tile(18,11).stock;
 stock.keepsakes=1;stock._items=[{id:parcelId,maker:f.crew.id,style:'art',quality:2,created:0}];stock._food=[{amount:1,age:12}];
 f.crew.carry=extract(stock,{alloy:2,food:1,keepsakes:1});syncResources(f.s);
 f.crew.delivery={kind:'stock',target:[18,11]};
 const ordered=executeAction(f.s,'job.order',{site:'surface',x:11,y:7,kind:'build',building:'floor'},'test');assert.equal(ordered.ok,true);
 const job=f.s.jobs.find(j=>j.id===ordered.job),remaining=job.remaining;job.worker=f.crew.id;f.crew.job=job.id;f.crew.labors.construction=true;
 request(f);roundtrip(f.s,'ordinary assigned job and named parcel');until(f,()=>f.controller.airlock.phase==='recover');
 const beforeGas=ledger(f),carry=structuredClone(f.crew.carry),delivery=digest(f.crew.delivery),intent=digest(f.crew.intent);
 step(f.s,2);
 assert.equal(f.crew.job,job.id);assert.equal(job.worker,f.crew.id);assert.equal(job.remaining,remaining);
 assert.ok(f.crew.carry._food[0].age>carry._food[0].age,'food continues aging while waiting');const afterCarry=structuredClone(f.crew.carry);afterCarry._food[0].age=carry._food[0].age;assert.equal(digest(afterCarry),digest(carry));assert.equal(digest(f.crew.delivery),delivery);assert.equal(digest(f.crew.intent),intent);
 assert.ok(f.crew.airlockTraversal);assert.equal(f.crew.carry._items[0].id,parcelId);
 assert.equal(f.site.tiles.reduce((n,t)=>n+(t.drop?.alloy||0),0),0,'normal wait must not set down cargo');assertLedger(f,beforeGas);
});

test('optional recording does not alter physical continuation and named cycle/gas events remain linked',()=>{
 const f=fixture(),g=refs(JSON.parse(serialize(f.s)));request(f);request(g);
 startRecording(f.s,{maxRecords:1000,maxBytes:16_000_000});
 for(let i=0;i<8;i++){physicalTick(f);physicalTick(g);assert.equal(snapshot(f.s),snapshot(g.s),`recording purity tick ${i}`);}
 const events=exportRecording(f.s).trim().split('\n').map(line=>JSON.parse(line)).filter(r=>r.kind==='event').map(r=>r.event);
 assert.ok(events.some(e=>e.id==='airlock.phase_changed'));
 assert.ok(events.some(e=>e.id==='gas.extracted'&&e.controller==='tile:surface:5:5'&&Number.isInteger(e.cycle)));
});

test('each successful shared airlock control leaves an immediately reloadable state',()=>{
 const f=fixture({configure:false});
 assert.equal(executeAction(f.s,'airlock.configure',CONFIG,'test').ok,true);roundtrip(f.s,'configure action');
 request(f);roundtrip(f.s,'request action');
 assert.equal(command(f,'cancel',{crew:f.crew.id}).ok,true);roundtrip(f.s,'cancel action');
 assert.equal(command(f,'enable',{enabled:false}).ok,true);roundtrip(f.s,'pause action');
 assert.equal(command(f,'release',{side:'outer',acceptAtmosphereLoss:true}).ok,true);roundtrip(f.s,'release action');
 assert.equal(command(f,'enable',{enabled:true}).ok,true);roundtrip(f.s,'resume action');
 assert.equal(command(f,'unbind').ok,true);roundtrip(f.s,'unbind action');
});

test('full simulation airlock waits retain opened meal portions and the physically carried patient',()=>{
 const f=fixture(),patient=f.s.crew[1];Object.assign(patient,{x:5,y:7});patient.medical.injury=90;
 f.crew.rescue={patient:patient.id,carrying:true};f.crew.intent={type:'meal',target:null,servings:4,foodAge:12,openedFood:{food:.5,_food:[{amount:.5,age:12}]},qualityTotal:0};
 request(f);until(f,()=>f.controller.airlock.phase==='recover');
 step(f.s,2);
 assert.deepEqual([patient.x,patient.y],[f.crew.x,f.crew.y]);assert.equal(f.crew.rescue.patient,patient.id);assert.equal(f.crew.rescue.carrying,true);
 assert.equal(f.crew.intent.type,'meal');assert.equal(f.crew.intent.servings,4);assert.equal(f.crew.intent.openedFood.food,.5);assert.ok(f.crew.intent.foodAge>12);
 assert.ok(f.crew.airlockTraversal);assert.equal(patient.airlockTraversal.controller,f.crew.airlockTraversal.controller);
});
