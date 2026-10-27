import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import { projectPreDecks } from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, order, cancelJob, setLabor, setAnimalPost, setAnimalTreatment, transportAnimalToPost, serialize, deserialize } from '../src/simulation.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { setMachineEnabled } from '../src/industry.js';
import { LABORS, laborFor } from '../src/crew.js';
import { VETERINARY } from '../src/livestock-data.js';
import { animalTraits } from '../src/animal-traits.js';
import { ignite, setFireResponse } from '../src/fire.js';
import { actionCatalog, controlBindings, createAgentInterface, executeAction } from '../src/controls.js';
import { observe, startRecording, exportRecording } from '../src/telemetry.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const checked=s=>{syncResources(s);const copy=deserialize(serialize(s));assert.deepEqual(copy,s);return copy;};
const until=(s,p,max=120)=>{for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),`Condition missing at tick ${s.tick}`);};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function fixture({fed=75,care=false,inside=false}={}){
  const s=createGame(),site=s.sites.surface,a=s.creatures[0],post=at(site,inside?11:10,inside?9:13),c=s.crew[5];
  for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
  for(const worker of s.crew)for(const labor of Object.keys(LABORS))setLabor(s,worker.id,labor,false);
  setLabor(s,c.id,'medicine',true);setLabor(s,c.id,'husbandry',true);setFireResponse(s,'surface',false);
  post.building='husbandryPost';post.hp=100;a.x=post.x;a.y=post.y;a.health=90;a.fed=fed;
  a.condition={injury:10,treated:0,thermalStress:0,cause:'cold',recovery:'none'};
  a.husbandry.trust=100;a.husbandry.care=care;a.husbandry.harvest=false;
  assert.ok(setAnimalPost(s,a.id,post.x,post.y).ok);
  return {s,site,a,post,c,depot:at(site,8,10)};
}
const designate=f=>{const result=executeAction(f.s,'husbandry.treat',{creature:f.a.id},'test');assert.ok(result.ok,result.message);return f.s.jobs.find(j=>j.id===result.job);};

test('shared veterinary controls reject healthy or untamed patients and expose bounded definitions',()=>{
  const f=fixture();f.a.health=100;f.a.condition.injury=0;
  let before=serialize(f.s);assert.equal(setAnimalTreatment(f.s,f.a.id).ok,false);assert.equal(serialize(f.s),before);
  f.a.health=90;f.a.condition.injury=10;f.a.husbandry.trust=99;before=serialize(f.s);
  assert.equal(setAnimalTreatment(f.s,f.a.id).ok,false);assert.equal(serialize(f.s),before);
  assert.equal(executeAction(f.s,'job.order',{site:'surface',x:10,y:13,kind:'animalTreat',building:'missing'},'test').code,'invalid_arguments');
  const action=actionCatalog().find(a=>a.id==='husbandry.treat');assert.equal(action.parameters.properties.creature.entityType,'creature');assert.equal(typeof controlBindings(()=>f.s).setAnimalTreatment,'function');
  const defs=createAgentInterface(()=>f.s).definitions();assert.deepEqual(defs.veterinary,VETERINARY);assert.deepEqual(defs.livestock.glazefoot.temperature,[-40,30]);
});

test('medicine is physically delivered before Medicine work and credit heals gradually across exact reloads',()=>{
  const f=fixture(),{s,a,c}=f,j=designate(f);startRecording(s,{maxRecords:20000,maxBytes:32000000});
  assert.equal(j.dose,10);assert.equal(laborFor(j),'medicine');assert.deepEqual(j.cost,{medicine:1});assert.deepEqual(j.materials,{});assert.equal(totalResources(s).medicine,4);checked(s);
  until(s,()=>j.remaining<j.work);assert.equal(j.materials.medicine,1);assert.equal(a.condition.treated,0);assert.equal(totalResources(s).medicine,4);assert.ok(c.skills.medicine.xp>0);
  const copy=checked(s);step(s);step(copy);assert.deepEqual(s,copy);
  until(s,()=>!s.jobs.includes(j));assert.equal(totalResources(s).medicine,3);assert.ok(a.health>90&&a.health<91);assert.ok(a.condition.treated>9&&a.condition.treated<10);assert.equal(setAnimalTreatment(s,a.id).ok,false);
  const completed=events(s).find(e=>e.id==='animal.treatment.completed');assert.equal(completed.dose,10);assert.equal(completed.medicine,1);assert.equal(completed.actor,c.id);
  const recovering=checked(s);step(s,10);step(recovering,10);assert.deepEqual(s,recovering);assert.ok(a.condition.injury>0);
  until(s,()=>a.condition.injury===0,110);close(a.health,100);assert.equal(a.condition.treated,0);assert.equal(totalResources(s).medicine,3);checked(s);
});

test('care and treatment pair in either designation order, rejecting every third or duplicate animal job',()=>{
  for(const careFirst of [true,false]){
    const f=fixture({fed:50,care:true}),{s,a,post}=f;
    const care=()=>order(s,'surface',post.x,post.y,'animalCare',a.id);
    if(careFirst)assert.ok(care().ok);const j=designate(f);if(!careFirst)assert.ok(care().ok);
    assert.equal(s.jobs.length,2);assert.equal(care().ok,false);assert.equal(setAnimalTreatment(s,a.id).ok,false);
    assert.equal(order(s,'surface',post.x,post.y,'animalHarvest',a.id).ok,false);assert.equal(order(s,'surface',post.x,post.y,'animalCare',s.creatures[1].id).ok,false);checked(s);
    const malformed=structuredClone(s);malformed.jobs.push({...structuredClone(j),id:`job-${malformed.nextId++}`});assert.throws(()=>deserialize(serialize(malformed)));
  }
});

test('one worker completes actual feeding before an older paid treatment can gain XP or consume medicine',()=>{
  const f=fixture({fed:50,care:true}),{s,a,c}=f,j=designate(f),medicine=c.skills.medicine.xp;startRecording(s,{maxRecords:20000,maxBytes:32000000});
  step(s);const care=s.jobs.find(o=>o.kind==='animalCare');assert.ok(care);assert.equal(j.worker,null);checked(s);
  until(s,()=>!s.jobs.includes(care));assert.equal(j.remaining,20);assert.equal(c.skills.medicine.xp,medicine);assert.equal(totalResources(s).medicine,4);assert.ok(a.fed>=60);assert.equal(a.condition.treated,0);
  assert.ok(events(s).some(e=>e.id==='animal.care.completed'&&e.actor===c.id));
  until(s,()=>!s.jobs.includes(j));assert.equal(totalResources(s).medicine,3);assert.ok(a.condition.treated>0);checked(s);
});

test('nutrition-paused treatment retains delivered medicine and earns no XP until readiness',()=>{
  const f=fixture({fed:55}),{s,a,c}=f,j=designate(f);until(s,()=>j.materials.medicine===1);const xp=structuredClone(c.skills.medicine);step(s,8);
  assert.equal(j.remaining,20);assert.deepEqual(c.skills.medicine,xp);assert.equal(a.condition.treated,0);assert.equal(totalResources(s).medicine,4);checked(s);
  cancelJob(s,j.id);assert.equal(totalResources(s).medicine,4);assert.equal(a.husbandry.retryAt,0);assert.equal(a.condition.treated,0);checked(s);
});

test('cancelled undelivered, carried and staged veterinary parcels preserve exact physical medicine',()=>{
  for(const phase of ['source','carry','staged']){
    const f=fixture(),{s,a}=f,j=designate(f);
    if(phase==='carry')until(s,()=>s.crew.some(c=>c.delivery?.job===j.id&&c.carry?.medicine===1));
    if(phase==='staged')until(s,()=>j.materials.medicine===1);
    checked(s);cancelJob(s,j.id);assert.equal(totalResources(s).medicine,4);assert.equal(a.condition.treated,0);assert.equal(s.jobs.includes(j),false);checked(s);
  }
});

test('death, post loss, reassignment and transport cancel staged treatment with located refunds',()=>{
  for(const reason of ['death','post','assign','transport']){
    const f=fixture(),{s,site,a,post}=f,j=designate(f);until(s,()=>j.materials.medicine===1);
    if(reason==='death')a.health=0;
    if(reason==='post')post.building=null;
    if(reason==='assign'||reason==='transport'){
      const dest=at(site,14,15);dest.terrain='ground';dest.building='husbandryPost';dest.hp=100;
      assert.ok((reason==='assign'?setAnimalPost(s,a.id,14,15):transportAnimalToPost(s,a.id,14,15)).ok);
    }else step(s);
    assert.equal(s.jobs.includes(j),false);assert.equal(totalResources(s).medicine,4);assert.equal(a.condition.treated,0);checked(s);
  }
});

test('normal ecology updates nonwound healing, starvation and treatment credit exactly once',()=>{
  const f=fixture(),{s,a}=f;a.health=50;a.condition.treated=2;step(s);close(a.health,50.11);close(a.condition.injury,9.9);close(a.condition.treated,1.9);checked(s);
  const g=fixture();g.a.health=50;g.a.fed=0;step(g.s);close(g.a.health,49.8);close(g.a.condition.injury,10);close(g.a.condition.treated,0);checked(g.s);
});

test('fire pauses treatment alongside reloadable suppression work and records bounded wounds once',()=>{
  const f=fixture({inside:true}),{s,site,a,post,c}=f,j=designate(f);startRecording(s,{maxRecords:10000,maxBytes:16000000});
  assert.ok(ignite(s,site,post));const suppression=order(s,'surface',post.x,post.y,'extinguish');assert.ok(suppression.ok);assert.equal(order(s,'surface',post.x,post.y,'extinguish').ok,false);checked(s);
  const skill=structuredClone(c.skills.medicine),health=a.health;step(s);assert.equal(j.remaining,20);assert.deepEqual(c.skills.medicine,skill);assert.equal(a.condition.treated,0);assert.equal(totalResources(s).medicine,4);
  const wound=events(s).find(e=>e.id==='animal.injured'&&e.entity===a.id);assert.equal(wound.cause,'fire');close(a.health,health-wound.amount);close(a.condition.injury,10+wound.amount);checked(s);
  const bad=structuredClone(s);bad.jobs.push({...structuredClone(suppression.job),id:`job-${bad.nextId++}`});assert.throws(()=>deserialize(serialize(bad)),/Duplicate tile reservation/);
});

test('fatal livestock fire emits one death and never grants health or treatment credit',()=>{
  const {s,site,a,post}=fixture({inside:true});a.health=.1;a.condition.injury=99.9;startRecording(s);assert.ok(ignite(s,site,post));step(s);assert.equal(a.health,0);close(a.condition.injury,100);step(s,2);
  assert.equal(events(s).filter(e=>e.id==='animal.died'&&e.entity===a.id).length,1);assert.equal(a.condition.treated,0);checked(s);
});

test('schema42 migration adds only neutral livestock metadata and preserves old damage and all physical state',()=>{
  const s=projectPreDecks(createGame(917));s.version=42;s.creatures[0].health=42;s.creatures[1].health=0;
  s.creatures.push({id:'legacy-tibble',species:'tibble',site:'surface',x:6,y:16,health:100,fed:25,age:0});
  for(const a of s.creatures){delete a.condition;delete a.genetics;delete a.death;}
  for(const site of Object.values(s.sites)){delete site.cultivation;delete site.liquids.absorbed;for(const t of site.tiles)for(const p of Object.values(t.flora||{})){delete p.origin;delete p.generation;}}
  const original=serialize(s),before=totalResources(s),loaded=deserialize(original);assert.equal(loaded.version,CURRENT_SAVE_VERSION);assert.deepEqual(totalResources(loaded),before);assert.equal(loaded.creatures[0].health,42);assert.equal(loaded.creatures[1].health,0);
  for(const a of loaded.creatures.filter(a=>a.species!=='tibble'))assert.deepEqual(a.condition,{injury:0,treated:0,thermalStress:0,cause:null,recovery:'none'});
  assert.equal(loaded.creatures.at(-1).condition,undefined);const demoted=projectPreDecks(loaded);demoted.version=42;for(const a of demoted.creatures){delete a.condition;delete a.genetics;delete a.death;}for(const site of Object.values(demoted.sites)){delete site.cultivation;delete site.liquids.absorbed;for(const t of site.tiles)for(const p of Object.values(t.flora||{})){delete p.origin;delete p.generation;}}assert.deepEqual(demoted,s);assert.equal(serialize(s),original);checked(loaded);
});

test('strict schema46 rejects malformed livestock condition and veterinary pins without repair',()=>{
  const f=fixture();designate(f);const changes=[
    s=>delete s.creatures[0].condition,s=>s.creatures[0].condition.extra=1,s=>s.creatures[0].condition.injury=-1,
    s=>s.creatures[0].condition.treated=11,s=>s.creatures[0].condition.thermalStress=101,s=>s.creatures[0].condition.cause='starvation',
    s=>s.creatures[0].condition.recovery='healed',s=>s.creatures[0].health=100,
    s=>s.jobs[0].dose=0,s=>s.jobs[0].dose=21,s=>s.jobs[0].work=19,s=>s.jobs[0].cost.medicine=2,
    s=>s.jobs[0].patient=s.crew[0].id,s=>s.jobs[0].animal=s.creatures[1].id,s=>s.jobs[0].building='husbandryPost',
    s=>s.jobs[0].site='wreck',s=>s.jobs[0].x++,s=>s.creatures[0].condition.treated=10,
    s=>s.creatures.push({id:'tibble',species:'tibble',site:'surface',z:0,x:6,y:16,health:100,fed:25,age:0,condition:{...s.creatures[0].condition}})
  ];
  for(const mutate of changes){const bad=structuredClone(f.s);mutate(bad);const bytes=serialize(bad);assert.throws(()=>deserialize(bytes));assert.equal(serialize(bad),bytes);}
  checked(f.s);
});

test('animal health observations and recording leave deterministic simulation and RNG unchanged',()=>{
  const f=fixture(),{s,a}=f;designate(f);const plain=structuredClone(s);startRecording(s,{maxRecords:10000,maxBytes:16000000});
  const before=serialize(s),entity=observe(s).entities[a.id];assert.equal(entity.derived.health.untreated,10);assert.deepEqual(entity.derived.health.temperatureRange,animalTraits(a).temperatureRange);assert.equal(serialize(s),before);
  step(s,25);step(plain,25);assert.deepEqual(s,plain);checked(s);assert.ok(events(s).some(e=>e.id==='animal.treatment.completed'));
});
