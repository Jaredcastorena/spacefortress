import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import { projectPreDecks } from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, serialize, deserialize } from '../src/simulation.js';
import { ANIMAL_TRAITS, animalTraits, founderGenome, inheritGenome, neutralGenome } from '../src/animal-traits.js';
import { isLivestock, livestockDef } from '../src/livestock-data.js';
import { newLifecycle } from '../src/breeding.js';
import { totalResources } from '../src/inventory.js';
import { setMachineEnabled } from '../src/industry.js';
import { executeAction, createAgentInterface } from '../src/controls.js';
import { observe, capture, startRecording, exportRecording } from '../src/telemetry.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const checked=s=>{const text=serialize(s);assert.equal(serialize(deserialize(text)),text);return s;};
const rows=s=>exportRecording(s).trim().split('\n').map(JSON.parse);
function legacy(s,version){
  const old=projectPreDecks(s);old.version=version;
  for(const a of old.creatures){delete a.death;delete a.genetics;if(a.lifecycle?.brood)delete a.lifecycle.brood.inheritance;if(version<=42)delete a.condition;}
  if(version<=43){
    for(const site of Object.values(old.sites)){
      delete site.cultivation;delete site.liquids.absorbed;
      for(const t of site.tiles){
        if(version<=41){if(t.flora?.lichen)t.lichen=t.flora.lichen.biomass;delete t.flora;}
        else for(const p of Object.values(t.flora||{})){delete p.origin;delete p.generation;}
        if(version===40&&t.machine){delete t.machine.recipeId;delete t.machine.batchRecipeId;}
      }
    }
    for(const j of old.jobs)delete j.plantGeneration;
  }
  return old;
}
// Declared supplied family fixture. No historical colony or gameplay is used.
function family(options){
  const s=createGame(901,options),[a,b]=s.creatures;s.nextId=100;
  const child={...structuredClone(a),id:'bristleback-98',age:0,fed:40,husbandry:{...a.husbandry,post:null,product:0},lifecycle:newLifecycle(0,[a.id,b.id],a.species),genetics:inheritGenome(s.seed,a,b,'brood-97')};
  s.creatures.push(child);
  a.health=90;a.condition={injury:10,treated:4,thermalStress:0,cause:'cold',recovery:'none'};
  a.lifecycle.brood={id:'brood-99',mate:b.id,started:0,progress:0,inheritance:{parents:[a,b].map(p=>({id:p.id,genetics:structuredClone(p.genetics)})),child:inheritGenome(s.seed,a,b,'brood-99')}};
  return {s,a,b,child};
}
function pen(){
  const s=createGame(902),site=s.sites.surface,[a,b]=s.creatures;
  for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
  for(let y=15;y<=23;y++)for(let x=3;x<=9;x++){const t=at(site,x,y);t.terrain='ground';t.building=x===3||x===9||y===15||y===23?'fence':null;t.hp=100;t.flora={lichen:{biomass:80,harvests:0,origin:'native',generation:'native'}};}
  const gate=at(site,6,15);gate.building='pastureGate';gate.gateMode='latched';
  a.x=6;a.y=18;b.x=7;b.y=18;
  for(const animal of [a,b]){animal.fed=100;animal.husbandry.trust=100;}
  return {s,a,b};
}
function apply(observation,record){
  for(const change of record.changes||[]){
    if(!change.path.length){if(change.op==='remove')delete observation.entities[change.entity];else observation.entities[change.entity]=structuredClone(change.value);continue;}
    let target=observation.entities[change.entity];for(const key of change.path.slice(0,-1))target=target[key];
    const key=change.path.at(-1);if(change.op==='remove')delete target[key];else target[key]=structuredClone(change.value);
  }
  if(record.fromTick!==undefined)observation.tick=record.tick;
}

test('schema46 founders and detached definitions persist without changing reproducibility',()=>{
  const a=createGame(900),b=createGame(900);assert.equal(serialize(a),serialize(b));
  for(const animal of a.creatures)assert.deepEqual(animal.genetics,founderGenome(a.seed,animal.species,animal.id));
  const definitions=createAgentInterface(()=>a).definitions();assert.deepEqual(definitions.animalTraits,ANIMAL_TRAITS);definitions.animalTraits.alleles[0]=99;
  assert.deepEqual(createAgentInterface(()=>a).definitions().animalTraits,ANIMAL_TRAITS);checked(a);
});

test('all hex legacy migration stages add balanced genes and preserve complete physical state',()=>{
  for(const version of [40,41,42,43,44]){
    const old=legacy(createGame(903,{regionSchema:2}),version),text=serialize(old),physical=totalResources(old),loaded=deserialize(text);
    assert.equal(loaded.version,CURRENT_SAVE_VERSION);assert.deepEqual(legacy(loaded,version),old);assert.deepEqual(totalResources(loaded),physical);assert.equal(serialize(old),text);
    for(const a of loaded.creatures){assert.deepEqual(a.genetics,neutralGenome());const profile=animalTraits(a),def=livestockDef(a);assert.deepEqual(profile.temperatureRange,def.temperature);assert.equal(profile.productRate,def.productRate);assert.equal(profile.metabolism,def.metabolism);}
    checked(loaded);
  }
});

test('schema44 supplied injured carrier, pending brood and offspring migrate without stepping or repair',()=>{
  const old=legacy(family({regionSchema:2}).s,44),text=serialize(old),loaded=deserialize(text);
  assert.deepEqual(legacy(loaded,44),old);assert.equal(serialize(old),text);assert.equal(loaded.tick,0);assert.equal(loaded.nextId,100);assert.equal(loaded.rng,old.rng);
  const [a,b]=loaded.creatures,inheritance=a.lifecycle.brood.inheritance;
  assert.deepEqual(a.condition,old.creatures[0].condition);assert.equal(a.health,90);assert.deepEqual(inheritance,{parents:[a,b].map(p=>({id:p.id,genetics:neutralGenome()})),child:neutralGenome()});
  for(const animal of loaded.creatures)assert.deepEqual(animal.genetics,neutralGenome());checked(loaded);
  inheritance.parents[0].genetics.thermal[0]=0;assert.equal(a.genetics.thermal[0],-1);assert.equal(inheritance.child.thermal[0],-1);
});

test('legacy schemas reject genetic and pending inheritance shadows before migration',()=>{
  for(const version of [40,41,42,43,44])for(const mutate of [s=>s.creatures[0].genetics=null,s=>s.creatures[0].lifecycle.brood.inheritance=null,s=>s.creatures.push({id:'pest-shadow',species:'tibble',genetics:null})]){
    const bad=legacy(family({regionSchema:2}).s,version);mutate(bad);const text=serialize(bad);assert.throws(()=>deserialize(text),/genetics shadow/);assert.equal(serialize(bad),text);
  }
});

test('current saves reject missing genes, malformed snapshots and parent genome drift without repair',()=>{
  for(const mutate of [s=>delete s.creatures[0].genetics,s=>s.creatures[0].genetics.extra=true,s=>s.creatures[0].genetics.thermal=[1],s=>delete s.creatures[0].lifecycle.brood.inheritance,s=>s.creatures[0].lifecycle.brood.inheritance.parents.reverse(),s=>s.creatures[0].lifecycle.brood.inheritance.parents[0].genetics.pace[0]=99,s=>s.creatures[0].lifecycle.brood.inheritance.child.thermal=[99,99],s=>s.creatures.push({id:'pest-shadow',species:'tibble',site:'surface',z:0,x:0,y:0,health:100,fed:10,age:0,genetics:neutralGenome()})]){
    const {s}=family();mutate(s);const text=serialize(s);assert.throws(()=>deserialize(text));assert.equal(serialize(s),text);
  }
});

test('actual adult and juvenile ecology apply each pace drain while feed and bite rules stay fixed',()=>{
  for(const species of ['bristleback','glazefoot'])for(const juvenile of [false,true])for(const allele of [-1,0,1]){
    const s=createGame(904),parents=s.creatures.filter(a=>a.species===species);
    for(const a of parents)a.genetics={origin:'founder',thermal:[0,0],pace:[allele,allele]};
    let a=parents[0];
    if(juvenile){a={...structuredClone(a),id:`${species}-999`,age:0,lifecycle:newLifecycle(0,parents.slice(0,2).map(p=>p.id),species),genetics:{origin:'inherited',thermal:[0,0],pace:[allele,allele]}};s.nextId=1000;s.creatures.push(a);}
    a.fed=80;const food=totalResources(s).food,expected=(juvenile?.008:.015)*(1+.2*allele);step(s);
    close(a.fed,80-expected);assert.equal(totalResources(s).food,food);checked(s);
  }
});

test('creature and brood observations expose detached profiles and classify genotype records',()=>{
  const {s,a}=family(),observation=observe(s),brood=a.lifecycle.brood;
  assert.deepEqual(observation.entities[a.id].genetics,a.genetics);assert.deepEqual(observation.entities[a.id].derived.traits,animalTraits(a));assert.deepEqual(observation.entities[a.id].derived.inheritance,brood.inheritance);assert.deepEqual(observation.entities[brood.id].inheritance,brood.inheritance);
  observation.entities[a.id].genetics.pace[0]=99;assert.notEqual(a.genetics.pace[0],99);
  const fresh=createGame(905);startRecording(fresh);fresh.creatures[0].genetics.pace[0]=fresh.creatures[0].genetics.pace[0]===1?-1:1;capture(fresh);
  assert.ok(rows(fresh).some(r=>r.kind==='external'&&r.changes.some(c=>c.system==='animal_genetics'&&c.path[0]==='genetics')));
});

test('ordinary breeding records frozen inheritance and replays birth without recorder interference',()=>{
  const {s,a,b}=pen(),unrecorded=deserialize(serialize(s));startRecording(s,{maxRecords:10000,maxBytes:64000000});
  const actions=[['husbandry.breed',{creature:a.id,enabled:true}],['husbandry.breed',{creature:b.id,enabled:true}],['simulation.step',{ticks:1}],['husbandry.breed',{creature:a.id,enabled:false}],['husbandry.breed',{creature:b.id,enabled:false}],['simulation.step',{ticks:300}]];
  let pinned;
  for(const [index,[id,args]] of actions.entries()){assert.equal(executeAction(s,id,args,'test').ok,true);assert.equal(executeAction(unrecorded,id,args,'test').ok,true);if(index===2)pinned=structuredClone(a.lifecycle.brood.inheritance);}
  assert.deepEqual(s,unrecorded);assert.equal(serialize(s),serialize(unrecorded));checked(s);
  const child=s.creatures.find(c=>c.lifecycle?.parents.includes(a.id));assert.ok(child);assert.deepEqual(child.genetics,pinned.child);
  const recording=rows(s),events=recording.filter(r=>r.event).map(r=>r.event),started=events.find(e=>e.id==='animal.brood.started'),born=events.find(e=>e.id==='animal.born'),inherited=events.find(e=>e.id==='animal.traits.inherited');
  assert.deepEqual(started.inheritance,pinned);assert.deepEqual(born.genetics,pinned.child);assert.deepEqual(inherited.genetics,pinned.child);assert.deepEqual(inherited.parents,[a.id,b.id]);assert.deepEqual(inherited.profile,animalTraits(child));
  const replay=deserialize(JSON.stringify(recording[0].initialState));for(const r of recording)if(r.kind==='action.requested')assert.equal(executeAction(replay,r.action.id,r.action.args,'test').ok,true);assert.deepEqual(replay,s);
  const reconstructed=structuredClone(recording[0].observation);for(const row of recording.slice(1,-1))apply(reconstructed,row);assert.deepEqual(reconstructed,observe(s));
});
