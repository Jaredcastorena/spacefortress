import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import { projectPreDecks } from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, serialize, deserialize, setLabor } from '../src/simulation.js';
import { BUTCHERY, registerAnimalDeath, carcassPosition } from '../src/animal-carcasses.js';
import { isLivestock } from '../src/livestock-data.js';
import { setMachineEnabled } from '../src/industry.js';
import { totalResources } from '../src/inventory.js';
import { FOOD_LIFETIME, foodLots, foodOfKind } from '../src/food-lots.js';
import { executeAction, createAgentInterface } from '../src/controls.js';
import { observe, startRecording, exportRecording } from '../src/telemetry.js';

const checked=s=>{const text=serialize(s);assert.equal(serialize(deserialize(text)),text);};
const action=(s,id,args)=>{const result=executeAction(s,id,args,'test');assert.equal(result.ok,true,result.message);return result;};
const job=(s,result)=>s.jobs.find(j=>j.id===result.job);
const rows=s=>exportRecording(s).trim().split('\n').map(JSON.parse);
function until(s,predicate,max=100){let ticks=0;while(!predicate()&&ticks<max){step(s);ticks++;}assert.ok(predicate(),`condition not reached within ${max} ticks`);return ticks;}
function legacy45(s){const old=projectPreDecks(s);old.version=45;for(const a of old.creatures)delete a.death;return old;}
// Supplied local unit-test fixtures: post, tame adult and single novice handler.
// The physical movement/work below uses the shared simulation; no old trial is replayed.
function fixture(dead=false,species='bristleback'){
  const s=createGame(74219),site=s.sites.surface,a=s.creatures.find(a=>a.species===species),c=s.crew[0],post=at(site,12,10),source=at(site,9,10);
  for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
  for(const worker of s.crew)for(const labor of Object.keys(worker.labors))setLabor(s,worker.id,labor,false);
  setLabor(s,c.id,'husbandry',true);c.x=11;c.y=10;
  post.building='husbandryPost';post.hp=100;post.fire=null;source.building=null;source.fire=null;
  a.x=post.x;a.y=post.y;a.fed=100;a.husbandry.post={x:post.x,y:post.y,z:0};a.husbandry.trust=100;a.lifecycle.enabled=false;
  if(dead){a.x=source.x;a.y=source.y;assert.equal(registerAnimalDeath(s,a,'unknown'),true);}
  return {s,site,a,c,post,source};
}
function butcher(f){const j=job(f.s,action(f.s,'husbandry.butcher',{creature:f.a.id,x:f.post.x,y:f.post.y}));assert.ok(j);return j;}
function apply(observation,record){
  for(const change of record.changes||[]){
    if(!change.path.length){if(change.op==='remove')delete observation.entities[change.entity];else observation.entities[change.entity]=structuredClone(change.value);continue;}
    let target=observation.entities[change.entity];for(const key of change.path.slice(0,-1))target=target[key];
    const key=change.path.at(-1);if(change.op==='remove')delete target[key];else target[key]=structuredClone(change.value);
  }
  if(record.fromTick!==undefined)observation.tick=record.tick;
}

test('current shared carcass definitions and detached physical observations expose actual owners',()=>{
  const f=fixture(true),{s,a,source}=f,api=createAgentInterface(()=>s);
  assert.equal(s.version,CURRENT_SAVE_VERSION);assert.deepEqual(api.definitions().butchery,BUTCHERY);
  const definitions=api.definitions();definitions.butchery.processWork=99;assert.equal(api.definitions().butchery.processWork,20);
  const observation=observe(s),body=observation.entities[`carcass:${a.id}`];
  assert.equal(body.type,'carcass');assert.equal(body.x,source.x);assert.equal(body.y,source.y);assert.equal(body.z,source.z);assert.equal(body.yield,4);
  body.owner.x=0;observation.entities[a.id].death.age=99;assert.equal(a.death.owner.x,source.x);assert.equal(a.death.age,0);
  assert.equal(observe(s).entities[a.id].derived.carcass.edibleYield,4);checked(s);
});

test('schema45 migration changes only version and death bookkeeping, including exhausted legacy dead',()=>{
  const original=legacy45(createGame(744)),a=original.creatures[0];a.health=0;a.husbandry.product=7;a.husbandry.enabled=true;a.lifecycle.enabled=true;
  const text=serialize(original),physical=totalResources(original),loaded=deserialize(text);
  assert.equal(loaded.version,CURRENT_SAVE_VERSION);assert.deepEqual(legacy45(loaded),original);assert.deepEqual(totalResources(loaded),physical);assert.equal(serialize(original),text);
  const dead=loaded.creatures[0];assert.equal(dead.death.disposition,'legacy');assert.equal(dead.death.cause,'legacy');assert.equal(dead.death.yield,0);assert.equal(dead.death.age,0);assert.equal(dead.death.owner,null);assert.equal(dead.death.reservedBy,null);
  assert.equal(observe(loaded).entities[`carcass:${dead.id}`],undefined);
  for(const living of loaded.creatures.filter(a=>isLivestock(a)&&a.health>0))assert.equal(living.death,null);
  checked(loaded);
});

test('old saves reject mortality, new orders, meat and meal shadows before migration',()=>{
  const mutations=[...['death','body','carcass'].map(key=>s=>s.creatures[0][key]=null),s=>s.jobs.push({kind:'animalDispatch'}),s=>s.jobs.push({kind:'animalButcher'}),s=>s.jobs.push({kind:'animalDiscard'}),s=>at(s.sites.surface,8,10).stock._food=[{kind:'bristlemeat',amount:1,age:0}],s=>at(s.sites.surface,8,10).stock._food=[{kind:'glazemeat',amount:1,age:0}],s=>at(s.sites.surface,7,9).machine.recipeId='bristlecap_braise',s=>at(s.sites.surface,7,9).machine.batchRecipeId='sunberry_glaze_roast'];
  for(const version of [40,41,42,43,44,45])for(const mutate of mutations){const old=legacy45(createGame(745));old.version=version;mutate(old);const text=serialize(old);assert.throws(()=>deserialize(text),/shadow/);assert.equal(serialize(old),text);}
});

test('current schema rejects malformed ownership, missing mortality and inconsistent phases without repair',()=>{
  const mutations=[f=>delete f.a.death,f=>f.a.death.extra=true,f=>f.a.death.owner={kind:'crew',crew:'missing'},f=>f.a.death.reservedBy='missing',f=>f.a.death.owner={kind:'job',job:'missing'},f=>f.a.body={},f=>{const j=butcher(f);j.phase='process';},f=>{const j=butcher(f);j.remaining=21;}];
  for(const mutate of mutations){const f=fixture(true);mutate(f);const text=serialize(f.s);assert.throws(()=>deserialize(text));assert.equal(serialize(f.s),text);}
  const live=fixture();live.a.death={};assert.throws(()=>deserialize(serialize(live.s)));
});

test('shared dispatch is cancelable, consumes eight real work and creates one body without food',()=>{
  const f=fixture(),{s,a,post}=f;startRecording(s,{maxRecords:5000,maxBytes:64000000});
  const first=job(s,action(s,'husbandry.dispatch',{creature:a.id}));assert.equal(first.work,8);assert.deepEqual(first.cost,{});
  action(s,'job.cancel',{job:first.id});assert.equal(a.health,100);assert.equal(a.death,null);checked(s);
  const second=job(s,action(s,'husbandry.dispatch',{creature:a.id}));until(s,()=>a.health===0);
  assert.equal(s.jobs.includes(second),false);assert.equal(a.death.cause,'dispatch');assert.equal(a.death.yield,4);assert.equal(a.death.owner.kind,'tile');assert.equal(a.husbandry.post,null);
  assert.equal(foodOfKind(post.drop,'bristlemeat'),0);assert.equal(executeAction(s,'husbandry.dispatch',{creature:a.id},'test').ok,false);checked(s);
  const events=rows(s).filter(r=>r.event).map(r=>r.event);for(const id of ['animal.died','carcass.created','animal.dispatch.completed'])assert.equal(events.filter(e=>e.id===id).length,1);
});

test('physical collect carry and process reload exactly, with XP only from twenty processing work',()=>{
  for(const species of ['bristleback','glazefoot']){
    const f=fixture(true,species),{s,a,c,post,source}=f,j=butcher(f);assert.equal(j.phase,'collect');checked(s);
    until(s,()=>j.phase==='carry');assert.equal(c.x,source.x);assert.equal(c.y,source.y);assert.deepEqual(a.death.owner,{kind:'crew',crew:c.id});assert.equal(j.remaining,20);assert.equal(c.skills.husbandry.xp,0);checked(s);
    const physical=observe(s).entities[`carcass:${a.id}`];assert.equal(physical.x,c.x);assert.equal(physical.y,c.y);
    until(s,()=>j.phase==='process');assert.equal(c.x,post.x);assert.equal(c.y,post.y);assert.deepEqual(a.death.owner,{kind:'job',job:j.id});assert.equal(j.remaining,20);assert.equal(c.skills.husbandry.xp,0);checked(s);
    until(s,()=>a.death.disposition==='butchered');assert.equal(c.skills.husbandry.level,1);assert.ok(c.skills.husbandry.xp<1e-10);assert.equal(s.jobs.includes(j),false);
    const kind=species==='bristleback'?'bristlemeat':'glazemeat',yieldAmount=species==='bristleback'?4:3;
    assert.equal(foodOfKind(post.drop,kind),yieldAmount);assert.equal(post.drop.waste,.25);assert.equal(foodLots(post.drop).find(l=>l.kind===kind).age,a.death.age);assert.equal(a.death.owner,null);assert.equal(a.death.reservedBy,null);
    assert.equal(observe(s).entities[`carcass:${a.id}`],undefined);assert.equal(executeAction(s,'husbandry.butcher',{creature:a.id,x:post.x,y:post.y},'test').ok,false);checked(s);
  }
});

test('canceling during carriage drops the whole body at the actual handler tile with no output',()=>{
  const f=fixture(true),{s,a,c,post}=f,j=butcher(f);until(s,()=>j.phase==='carry');step(s);
  assert.equal(j.phase,'carry');const position={site:c.site,x:c.x,y:c.y,z:c.z},age=a.death.age;
  action(s,'job.cancel',{job:j.id});assert.deepEqual(a.death.owner,{kind:'tile',...position});assert.equal(a.death.age,age);assert.equal(a.death.reservedBy,null);assert.equal(c.job,null);assert.equal(s.jobs.includes(j),false);assert.equal(foodOfKind(post.drop,'bristlemeat'),0);checked(s);
});

test('staged interruption preserves work ownership and age, then resumes exactly once',()=>{
  const f=fixture(true),{s,a,c,post}=f,j=butcher(f);until(s,()=>j.phase==='process');step(s);const remaining=j.remaining,age=a.death.age;
  assert.ok(remaining<20);action(s,'crew.labor',{crew:c.id,labor:'husbandry',enabled:false});
  assert.equal(j.worker,null);assert.equal(j.remaining,remaining);assert.equal(a.death.age,age);assert.deepEqual(a.death.owner,{kind:'job',job:j.id});assert.equal(a.death.reservedBy,j.id);checked(s);
  step(s,3);assert.equal(j.remaining,remaining);assert.ok(a.death.age>age);
  action(s,'crew.labor',{crew:c.id,labor:'husbandry',enabled:true});until(s,()=>a.death.disposition==='butchered');assert.equal(foodOfKind(post.drop,'bristlemeat'),4);assert.equal(post.drop.waste,.25);checked(s);
});

test('worker death or immobility cancels carriage and drops at the actual worker position',()=>{
  for(const reason of ['dead','immobile']){
    const f=fixture(true),{s,a,c,post}=f,j=butcher(f);until(s,()=>j.phase==='carry');const position={site:c.site,x:c.x,y:c.y,z:c.z};
    if(reason==='dead')c.health=0;else c.medical.injury=60;
    step(s);assert.equal(s.jobs.includes(j),false);assert.deepEqual(a.death.owner,{kind:'tile',...position});assert.equal(a.death.reservedBy,null);assert.equal(foodOfKind(post.drop,'bristlemeat'),0);
  }
});

test('lost processing post releases a staged body and its reservation without creating supplies',()=>{
  const f=fixture(true),{s,a,post}=f,j=butcher(f);until(s,()=>j.phase==='process');post.hp=0;
  step(s);assert.equal(s.jobs.includes(j),false);assert.deepEqual(a.death.owner,{kind:'tile',site:'surface',x:post.x,y:post.y,z:post.z});assert.equal(a.death.reservedBy,null);assert.equal(foodOfKind(post.drop,'bristlemeat'),0);
});

test('spoilage during transport cancels edible work and shared disposal creates located waste once',()=>{
  const f=fixture(true),{s,a,c,post}=f,j=butcher(f);until(s,()=>j.phase==='carry');a.death.age=FOOD_LIFETIME-.01;step(s);
  assert.equal(a.death.disposition,'spoiled');assert.equal(s.jobs.includes(j),false);assert.equal(a.death.owner.kind,'tile');assert.equal(a.death.reservedBy,null);assert.equal(foodOfKind(post.drop,'bristlemeat'),0);checked(s);
  const position=carcassPosition(s,a),discard=job(s,action(s,'husbandry.discard',{creature:a.id}));assert.equal(discard.work,4);until(s,()=>a.death.disposition==='discarded');
  assert.equal(at(s.sites[position.site],position.x,position.y).drop.waste,.25);assert.equal(a.death.owner,null);assert.equal(a.death.reservedBy,null);assert.equal(executeAction(s,'husbandry.discard',{creature:a.id},'test').ok,false);assert.ok(c.skills.husbandry.xp>0);checked(s);
});

test('shared dispatch and butchery record single transitions, replay and reconstruct without interference',()=>{
  const f=fixture(),{s,a,post}=f,unrecorded=deserialize(serialize(s));startRecording(s,{maxRecords:10000,maxBytes:64000000});
  const pair=(id,args)=>{action(s,id,args);action(unrecorded,id,args);};
  pair('husbandry.dispatch',{creature:a.id});for(let ticks=0;a.health>0&&ticks<100;ticks++)pair('simulation.step',{ticks:1});assert.equal(a.health,0);
  pair('husbandry.butcher',{creature:a.id,x:post.x,y:post.y});for(let ticks=0;a.death.disposition!=='butchered'&&ticks<100;ticks++)pair('simulation.step',{ticks:1});assert.equal(a.death.disposition,'butchered');
  assert.deepEqual(s,unrecorded);assert.equal(serialize(s),serialize(unrecorded));checked(s);
  const recording=rows(s),events=recording.filter(r=>r.event).map(r=>r.event);
  for(const id of ['animal.dispatch.ordered','animal.dispatch.completed','animal.died','carcass.created','carcass.reserved','carcass.picked_up','carcass.staged','carcass.butchered','animal.butchered'])assert.equal(events.filter(e=>e.id===id).length,1,id);
  assert.ok(recording.some(r=>r.changes?.some(c=>c.system==='animal_carcasses')));
  const replay=deserialize(JSON.stringify(recording[0].initialState));for(const r of recording)if(r.kind==='action.requested')action(replay,r.action.id,r.action.args);assert.deepEqual(replay,s);
  const reconstructed=structuredClone(recording[0].observation);for(const r of recording.slice(1,-1))apply(reconstructed,r);assert.deepEqual(reconstructed,observe(s));
});
