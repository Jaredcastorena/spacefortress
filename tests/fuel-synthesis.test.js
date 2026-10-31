import {withTemperaturePressureReadings} from './helpers/pressure-migration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {VERSION,BUILDINGS,RECIPES} from '../src/data.js';
import {executeAction,createAgentInterface} from '../src/controls.js';
import {initializeStorage,totalResources,syncResources} from '../src/inventory.js';
import {initializeElectrical,refreshPower} from '../src/power.js';
import {productionEligibility,projectedStock} from '../src/production.js';
import {tileAt,positionOf,tileEntityId} from '../src/spatial.js';
import {roomAt} from '../src/atmosphere.js';
import {HEAT_CAPACITY} from '../src/thermal.js';
import {observe,startRecording,exportRecording} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/synthesis-schema68.json.gz',import.meta.url))).toString();
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
const act=(s,id,args={})=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);return r;};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const exact=s=>{syncResources(s);const text=serialize(s);assert.ok(serialize(deserialize(text))===text,'exact save roundtrip');};
const until=(s,label,p,limit=180)=>{for(let n=0;n<limit&&!p();n++)step(s);assert.ok(p(),`${label} at tick${s.tick}: ${JSON.stringify(s.sites.surface.tiles.filter(t=>t.building==='fuelSynthesizer').map(t=>({z:t.z,status:t.machine.status,ready:productionEligibility(s,s.sites.surface,t),input:t.machine.input,output:t.machine.output,progress:t.machine.progress})))}`);};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function configure(s){
 for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.machine)act(s,'production.enable',{site:site.id,...positionOf(t),enabled:false});
 for(const c of s.crew){for(const labor of Object.keys(c.labors))act(s,'crew.labor',{crew:c.id,labor,enabled:false});act(s,'crew.routine',{crew:c.id,policy:'work'});}
 return s;
}
function install(s,x,y,z=0,kind='fuelSynthesizer'){
 const t=at(s.sites.surface,x,y,z);t.building=kind;delete t.machine;initializeStorage(t);initializeElectrical(t);return t;
}
function fixture(){
 // Synthetic installed equipment and one physically delivered finite input batch.
 const s=configure(createGame(74219)),site=s.sites.surface,t=install(s,13,10);t.machine.input={cells:1,water:2};
 act(s,'crew.labor',{crew:'crew-3',labor:'production',enabled:true});act(s,'production.order',{site:site.id,...positionOf(t),mode:'batches',limit:1});
 refreshPower(s,site);syncResources(s);return {s,site,t,m:t.machine};
}

test('genuine schema68 preserves state and older saves reject fuel equipment and queued work',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'a621fd8d8e1ed5ec52f5278612d32971eaa70db71396f68184a88e2230774df6');
 const expected=JSON.parse(raw);expected.version=VERSION;for(const site of Object.values(expected.sites))for(const t of site.tiles)if(t.building==='stockpile')t.storage.limits={};const s=deserialize(raw);assert.ok(serialize(s)===JSON.stringify(withTemperaturePressureReadings(expected)));exact(s);
 for(const change of [s=>{s.sites.surface.tiles.find(t=>t.building==='refinery').building='fuelSynthesizer';},s=>{s.jobs.find(j=>j.kind==='build').building='fuelSynthesizer';}]){const old=JSON.parse(raw);change(old);assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy fuel synthesizer/);}
});

test('fuel readiness uses shared skill, power, atmosphere, temperature and delivered-input boundaries',()=>{
 const {s,site,t,m}=fixture(),before=serialize(s),api=createAgentInterface(()=>s),def=api.definitions();
 assert.deepEqual(def.buildings.fuelSynthesizer.cost,{alloy:6,components:2});assert.deepEqual(RECIPES.fuelSynthesizer.input,{cells:1,water:2});assert.equal(BUILDINGS.fuelSynthesizer.demand,6);
 const readiness=()=>productionEligibility(s,site,t);assert.equal(readiness().blockedCode,null);assert.equal(readiness().minSkill,2);
 assert.ok(readiness().eligibleCrewIds.includes('crew-3'));observe(s);assert.equal(serialize(s),before);
 m.input={};assert.equal(readiness().blockedCode,'inputs');assert.equal(readiness().requirements.find(r=>r.resource==='cells').missing,1);m.input={cells:1,water:2};
 s.crew[3].skills.production.level=1;assert.equal(readiness().blockedCode,'no_qualified_operator');s.crew[3].skills.production.level=3;
 t.powered=false;assert.equal(readiness().blockedCode,'power');refreshPower(s,site);
 const room=roomAt(site,t.x,t.y,t.z),heat=room.heat;room.heat=(60+273.15)*room.volume*HEAT_CAPACITY;assert.equal(readiness().blockedCode,'temperature');room.heat=heat;
 const air=room.air;room.air=20;assert.equal(readiness().blockedCode,'air');room.air=air;
 m.output={fuel:20};assert.equal(readiness().blockedCode,'output_full');m.output={};
 act(s,'production.enable',{site:site.id,...positionOf(t),enabled:false});const inputs=JSON.stringify(m.input);step(s,5);assert.equal(m.progress,0);assert.equal(JSON.stringify(m.input),inputs);assert.equal(m.completed,0);exact(s);
});

test('committed synthesis survives pause, stock-order changes and reload without double spending inputs',()=>{
 const {s,site,t,m}=fixture(),before=totalResources(s);startRecording(s);
 until(s,'batch commitment',()=>m.progress>0);assert.deepEqual(m.batch,{cells:1,water:2});assert.equal(m.input.cells||0,0);assert.equal(projectedStock(s,site,'fuel'),before.fuel+2);exact(s);
 act(s,'production.enable',{site:site.id,...positionOf(t),enabled:false});const progress=m.progress;step(s,5);assert.equal(m.progress,progress);assert.deepEqual(m.batch,{cells:1,water:2});
 act(s,'production.order',{site:site.id,...positionOf(t),mode:'stock',limit:0});act(s,'production.enable',{site:site.id,...positionOf(t),enabled:true});
 const copy=deserialize(serialize(s));step(s,3);step(copy,3);assert.ok(serialize(s)===serialize(copy),'deterministic committed continuation');
 until(s,'fuel batch',()=>m.completed===1);step(s,4);assert.equal(m.completed,1);assert.equal(m.output.fuel,2);assert.deepEqual(m.batch,{});
 const after=totalResources(s);close(before.cells-after.cells,1);close(before.water-after.water,2);close(after.fuel-before.fuel,2);exact(s);
 const log=events(s),started=log.find(e=>e.id==='production.batch.started'&&e.recipe==='fuelSynthesizer'),done=log.find(e=>e.id==='production.batch.completed'&&e.recipe==='fuelSynthesizer');
 assert.deepEqual(started.input,{cells:1,water:2});assert.deepEqual(done.output,{fuel:2});assert.equal(started.entity,tileEntityId(site.id,t.x,t.y,t.z));assert.equal(done.actor,'crew-3');
});

test('dismantling a partial batch returns its finite unconverted contents without minting fuel',()=>{
 const {s,site,t,m}=fixture();act(s,'crew.labor',{crew:'crew-0',labor:'construction',enabled:true});const before=totalResources(s);
 until(s,'batch commitment',()=>m.progress>0);const r=act(s,'job.order',{site:site.id,...positionOf(t),kind:'remove'});exact(s);
 until(s,'supplied dismantling',()=>!s.jobs.some(j=>j.id===r.job));assert.equal(t.building,null);assert.deepEqual(t.drop,{cells:1,water:2,alloy:3,components:1});
 close(totalResources(s).cells,before.cells);close(totalResources(s).water,before.water);close(totalResources(s).fuel,before.fuel);exact(s);
});

test('synthesized fuel is hauled to an empty reactor and consumed through its finite fuel ledger',()=>{
 // Synthetic installed plant/reactor and feedstock; all later work and hauling are native.
 const {s,site,t,m}=fixture(),store=at(site,8,10);store.stock.fuel=0;
 const reactor=install(s,12,11,0,'reactor');for(let x=8;x<=13;x++)at(site,x,11).cable={enabled:true,hp:100};
 for(const id of ['crew-1','crew-5','crew-6'])act(s,'crew.labor',{crew:id,labor:'hauling',enabled:true});
 syncResources(s);assert.equal(totalResources(s).fuel,0);assert.equal(reactor.machine.input.fuel||0,0);startRecording(s);
 until(s,'reactor receives manufactured fuel',()=>site.reactorLedger.fuelUsed>0);assert.equal(m.completed,1);
 close(totalResources(s).fuel+site.reactorLedger.fuelUsed,2);assert.ok(site.reactorLedger.generated>0);assert.ok(site.reactorLedger.heatMade>0);exact(s);
 assert.ok(events(s).some(e=>e.id==='production.batch.completed'&&e.recipe==='fuelSynthesizer'));
});

test('upper-floor synthesis keeps supplied inputs, power, operator work and output on that floor',()=>{
 // Existing declared stair habitat plus explicit finite equipment/input fixture.
 const s=configure(deserialize(gunzipSync(readFileSync(new URL('./fixtures/tools-schema63.json.gz',import.meta.url))).toString())),site=s.sites.surface;
 for(const j of [...s.jobs])act(s,'job.cancel',{job:j.id});const t=install(s,10,9,1);t.machine.input={cells:1,water:2};
 for(const [x,y] of [[10,8],[11,9]]){const bank=install(s,x,y,1,'battery');bank.charge=120;site.energy.initial+=120;bank.cable={enabled:true,hp:100};}
 t.cable={enabled:true,hp:100};act(s,'crew.labor',{crew:'crew-3',labor:'production',enabled:true});act(s,'production.order',{site:site.id,...positionOf(t),mode:'batches',limit:1});
 startRecording(s);until(s,'upper batch commitment',()=>t.machine.progress>0);assert.equal(s.crew[3].z,1);exact(s);
 until(s,'upper fuel',()=>t.machine.completed===1);assert.equal(t.machine.output.fuel,2);assert.equal(at(site,10,9).machine,undefined);exact(s);
 for(const id of ['production.batch.started','production.batch.completed'])assert.equal(events(s).find(e=>e.id===id&&e.recipe==='fuelSynthesizer').entity,tileEntityId(site.id,10,9,1));
});

test('native salvage and solar collection supply a paid fuel synthesizer with stored output',()=>{
 const s=configure(createGame(74219)),site=s.sites.surface,store=at(site,8,10),ids=['crew-2','crew-4'];
 // Ordinary starter colony: no position, health, inventory or unlock grants.
 act(s,'crew.labor',{crew:'crew-2',labor:'mining',enabled:true});
 for(const c of s.crew)if(c.id!=='crew-0'&&c.id!=='crew-3')act(s,'crew.labor',{crew:c.id,labor:'hauling',enabled:true});
 startRecording(s,{maxRecords:10000,maxBytes:32_000_000});
 act(s,'expedition.launch',{site:'wreck',crewIds:ids});until(s,'wreck arrival',()=>s.mission?.phase==='working');
 const j=act(s,'job.order',{site:'wreck',x:5,y:6,kind:'mine'});until(s,'salvage',()=>!s.jobs.some(job=>job.id===j.job));until(s,'salvage loaded',()=>s.mission.cargo.components>=3);
 act(s,'expedition.recall');until(s,'wreck return',()=>!s.mission&&!s.departure);assert.equal(s.flags.salvageReturned,true);
 act(s,'expedition.launch',{site:'solar',crewIds:ids});until(s,'solar arrival',()=>s.mission?.phase==='working');until(s,'two solar cells',()=>s.mission.cargo.cells>=2);
 act(s,'expedition.recall');until(s,'solar return',()=>!s.mission&&!s.departure);until(s,'stored solar cells',()=>store.stock.cells>=2);exact(s);
 // Restart the existing supplied life support before staffing the new industry.
 act(s,'production.enable',{site:site.id,x:7,y:7,enabled:true});
 act(s,'crew.labor',{crew:'crew-0',labor:'construction',enabled:true});act(s,'crew.labor',{crew:'crew-0',labor:'engineering',enabled:true});
 const beforeBuild=totalResources(s),build=act(s,'job.order',{site:'surface',x:12,y:8,kind:'build',building:'fuelSynthesizer'});
 until(s,'paid synthesis plant',()=>!s.jobs.some(j=>j.id===build.job));const t=at(site,12,8);assert.equal(t.building,'fuelSynthesizer');
 close(beforeBuild.alloy-totalResources(s).alloy,6);close(beforeBuild.components-totalResources(s).components,2);
 act(s,'production.order',{site:site.id,...positionOf(t),mode:'batches',limit:1});act(s,'crew.labor',{crew:'crew-3',labor:'production',enabled:true});
 const before=totalResources(s);until(s,'delivered cell commitment',()=>t.machine.progress>0);exact(s);until(s,'fuel production',()=>t.machine.completed===1);
 until(s,'fuel in depot',()=>!t.machine.output.fuel&&!s.crew.some(c=>c.carry?.fuel));close(totalResources(s).cells,before.cells-1);close(totalResources(s).water,before.water-2);close(totalResources(s).fuel,before.fuel+2);
 // This bounded chain ends at stored fuel. The longer repeat-journey attempt
 // did not complete departure within180 ticks; ordinary endurance is separate.
 exact(s);
 assert.ok(s.crew.every(c=>c.health>0));const log=events(s);assert.ok(log.some(e=>e.id==='production.batch.completed'&&e.recipe==='fuelSynthesizer'));assert.ok(log.some(e=>e.id==='production.batch.started'&&e.input.cells===1));
});


test('an empty shuttle receives manufactured fuel through normal delivery and launches with finite reserves',()=>{
 // Synthetic finite delivered cells/water and no initial fuel; all work, hauling
 // and departure actions below use the normal simulation.
 const {s,site,t,m}=fixture(),store=at(site,8,10);store.stock.fuel=0;m.input={cells:2,water:4};
 act(s,'production.order',{site:site.id,...positionOf(t),mode:'batches',limit:2});
 for(const id of ['crew-1','crew-5','crew-6'])act(s,'crew.labor',{crew:id,labor:'hauling',enabled:true});
 syncResources(s);assert.equal(totalResources(s).fuel,0);startRecording(s);
 until(s,'two manufactured batches',()=>m.completed===2);until(s,'four stored fuel',()=>store.stock.fuel===4);exact(s);
 act(s,'expedition.launch',{site:'wreck',crewIds:['crew-2','crew-4']});
 until(s,'supplied outbound launch',()=>s.mission?.phase==='outbound');assert.ok(totalResources(s).fuel<4);assert.ok(s.shuttle.supplies.fuel>0);exact(s);
 const completed=events(s).filter(e=>e.id==='production.batch.completed'&&e.recipe==='fuelSynthesizer');assert.equal(completed.length,2);
});
