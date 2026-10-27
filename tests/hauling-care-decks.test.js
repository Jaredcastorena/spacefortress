import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,serialize} from '../src/simulation.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {updateRooms,fillRoom,refreshAtmosphere} from '../src/atmosphere.js';
import {HEAT_CAPACITY} from '../src/thermal.js';
import {refreshPower} from '../src/power.js';
import {haul} from '../src/industry.js';
import {injure,safeBed} from '../src/medicine.js';
import {hygienePatient,hygieneReady} from '../src/hygiene.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {startRecording,exportRecording} from '../src/telemetry.js';
import {distance} from '../src/geometry.js';
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
// Synthetic declared upper floor; this does not enable multi-floor save files.
function fixture(){
 const s=createGame(74219),site=s.sites.surface;
 site.levels.push({z:7,name:'Upper test deck'});site.tiles.push(...site.tiles.map(t=>({...structuredClone(t),z:7})));
 updateRooms(site);for(const r of site.rooms){fillRoom(r);r.heat=(20+273.15)*r.volume*HEAT_CAPACITY;}
 for(const c of s.crew){for(const k of Object.keys(c.labors))c.labors[k]=false;c.life.policy='work';c.hunger=c.energy=c.oxygen=100;}
 for(const t of site.tiles){if(t.machine)t.machine.enabled=false;if(t.z===7){if(t.stock)t.stock={};t.drop=null;}}
 const p=s.crew[0],helper=s.crew[5];Object.assign(p,{x:8,y:9,z:7,intent:null,job:null,carry:null,delivery:null});Object.assign(helper,{x:9,y:10,z:7,intent:null,job:null,carry:null,delivery:null});
 const store=at(site,8,10,7),lowerStore=at(site,8,10);refreshAtmosphere(site);refreshPower(s,site);return {s,site,p,helper,store,lowerStore};
}
function until(f,p,limit=100){for(let n=0;n<limit&&!p();n++){const before=[f.p,f.helper].map(positionOf);step(f.s);for(const [i,c] of [f.p,f.helper].entries()){assert.equal(c.z,7);assert.ok(distance([before[i].x,before[i].y],[c.x,c.y])<=1);}}assert.ok(p(),`Tick ${f.s.tick}; patient: ${f.p.activity}; helper: ${f.helper.activity}`);}
function clinic(){
 const f=fixture();for(const z of [0,7])Object.assign(at(f.site,10,9,z),{building:'medicalCot',hp:100});
 Object.assign(f.p,{x:10,y:9});injure(f.s,f.p,65,'synthetic debris');f.p.medical.bed={x:10,y:9,z:7};f.p.intent={type:'medical',target:{...f.p.medical.bed}};f.helper.labors.medicine=true;
 f.store.stock={medicine:1,food:1};f.lowerStore.stock={medicine:10,food:10};return f;
}

test('upper hauling supplies a complete production batch and returns its output physically',()=>{
 const f=fixture(),machine=at(f.site,13,10,7);f.store.stock={ore:1};f.lowerStore.stock={ore:10,alloy:10};f.p.labors.hauling=true;f.helper.labors.production=true;
 assert.equal(executeAction(f.s,'production.order',{site:'surface',x:13,y:10,z:7,mode:'batches',limit:1}).ok,true);
 assert.equal(executeAction(f.s,'production.enable',{site:'surface',x:13,y:10,z:7,enabled:true}).ok,true);startRecording(f.s);
 until(f,()=>f.store.stock.alloy===2);assert.equal(machine.machine.completed,1);assert.equal(machine.machine.output.alloy||0,0);assert.equal(f.store.stock.ore||0,0);assert.deepEqual(f.lowerStore.stock,{ore:10,alloy:10});
 const moves=events(f.s).filter(e=>e.id==='inventory.transferred');
 assert.ok(moves.some(e=>e.from.entity==='tile:surface:8:10:7'&&e.to.entity===f.p.id&&e.resources.ore===1));
 assert.ok(moves.some(e=>e.to.entity==='tile:surface:13:10:7'&&e.to.slot==='machine.input'));
 assert.ok(moves.some(e=>e.from.entity==='tile:surface:13:10:7'&&e.to.entity===f.p.id&&e.resources.alloy===2));
 assert.ok(moves.some(e=>e.to.entity==='tile:surface:8:10:7'&&e.resources.alloy===2));
});

test('an undeliverable upper shipment is set down on its actual floor with the correct record',()=>{
 const f=fixture();for(const t of f.site.tiles)if(t.z===7&&t.building==='stockpile')t.building=null;
 f.p.carry={ore:2};f.p.delivery={kind:'stock',target:{x:8,y:10,z:7}};const below=structuredClone(at(f.site,f.p.x,f.p.y).drop);startRecording(f.s);
 assert.equal(haul(f.s,f.p,f.site),true);assert.equal(f.p.carry,null);assert.deepEqual(at(f.site,f.p.x,f.p.y,7).drop,{ore:2});assert.deepEqual(at(f.site,f.p.x,f.p.y).drop,below);
 const e=events(f.s).find(e=>e.id==='inventory.transferred');assert.equal(e.to.entity,`tile:surface:${f.p.x}:${f.p.y}:7`);assert.equal(e.to.slot,'drop');assert.equal(e.resources.ore,2);
});

test('one upstairs medic delivers food and medicine, provides hygiene and returns the waste',()=>{
 const f=clinic();f.p.hunger=20;f.p.sanitation.waste=.5;startRecording(f.s);
 step(f.s);for(const kind of ['feed','treat','hygiene'])assert.ok(f.s.jobs.some(j=>j.kind===kind&&j.z===7));
 until(f,()=>f.p.health>35&&f.p.medical.servings===0&&f.p.memories.some(m=>m.kind==='assisted-hygiene')&&!f.helper.carry);
 assert.ok(f.p.health>35);assert.ok(f.p.hunger>70);assert.deepEqual(positionOf(f.p),{x:10,y:9,z:7});
 assert.equal(f.store.stock.medicine||0,0);assert.equal(f.store.stock.food||0,0);assert.ok(f.store.stock.waste>=.5);assert.ok(f.p.sanitation.waste<.5);assert.equal(f.store.stock.waste+f.p.sanitation.waste,1);assert.equal(f.lowerStore.stock.medicine,10);assert.equal(f.lowerStore.stock.food,10);
 const completed=events(f.s).filter(e=>e.id==='job.completed');assert.ok(completed.length>=3);assert.ok(completed.every(e=>e.target==='tile:surface:10:9:7'));
});

test('upper care commands share player bindings and reject a downstairs patient alias',()=>{
 for(const kind of ['treat','feed','hygiene']){
  const f=clinic();f.p.hunger=20;f.p.sanitation.waste=.5;const args={site:'surface',x:10,y:9,z:7,kind,building:f.p.id},copy=structuredClone(f.s),before=serialize(f.s);
  assert.equal(executeAction(f.s,'job.order',{...args,z:0}).ok,false);assert.equal(serialize(f.s),before);
  const a=executeAction(f.s,'job.order',args),b=controlBindings(()=>copy).order(copy,'surface',10,9,kind,f.p.id,7);assert.equal(a.ok,true,a.message);assert.equal(b.ok,true,b.message);assert.equal(serialize(f.s),serialize(copy));
  assert.equal(f.s.jobs.find(j=>j.id===a.job).z,7);assert.deepEqual(f.lowerStore.stock,{medicine:10,food:10});
 }
});

test('a broken upper cot cannot use downstairs safety and a downstairs helper cannot perform hygiene',()=>{
 const f=clinic();assert.equal(safeBed(f.site,f.p.medical.bed),true);at(f.site,10,9,7).hp=0;assert.equal(safeBed(f.site,f.p.medical.bed),false);assert.equal(safeBed(f.site,{x:10,y:9,z:0}),true);
 at(f.site,10,9,7).hp=100;f.p.sanitation.waste=.5;const job={kind:'hygiene',patient:f.p.id,site:'surface',x:10,y:9,z:7};
 assert.equal(hygienePatient(f.s,{...job,z:0}),null);assert.equal(hygieneReady(f.s,job,{...f.helper,z:0}),false);assert.equal(hygieneReady(f.s,job,f.helper),true);
});

test('rescue carries an incapacitated patient to an upper cot and labels its actual destination',()=>{
 const f=clinic();Object.assign(f.p,{x:8,y:8});f.p.intent=null;f.store.stock={};startRecording(f.s);
 until(f,()=>events(f.s).some(e=>e.id==='care.rescue.delivered'),30);
 assert.deepEqual(positionOf(f.p),{x:10,y:9,z:7});const assigned=events(f.s).find(e=>e.id==='care.rescue.assigned'),delivered=events(f.s).find(e=>e.id==='care.rescue.delivered');
 assert.equal(assigned.destination,'tile:surface:10:9:7');assert.equal(delivered.tile,'tile:surface:10:9:7');assert.equal(f.helper.rescue,null);
});
