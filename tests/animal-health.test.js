import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeAnimalCondition, initializeAnimalHealth, injureAnimal, updateAnimalHealth, animalActivityAllowed, animalHealthStatus, animalTreatmentEligibility, animalTreatmentValid, animalTreatmentReady, completeAnimalTreatment, validateAnimalHealth } from '../src/animal-health.js';
import { animalCondition, animalJobValid, completeAnimalJob, prepareHusbandry, validateHusbandry, moveAssignedAnimal } from '../src/husbandry.js';
import { breedingStatus, updateBreeding, newLifecycle } from '../src/breeding.js';
import { requestTransport } from '../src/animal-transport.js';
import { animalPath } from '../src/navigation.js';
import { VETERINARY } from '../src/livestock-data.js';
import { createGame, at } from '../src/simulation.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

// Domain fixtures supply a post and staged medicine explicitly. Actual delivery,
// worker progress, cancellation refunds and save migration have integration tests.
function patient(species='bristleback'){
  const site={id:'surface',size:8,rooms:[],thermal:{ambient:8},tiles:Array.from({length:64},(_,i)=>({x:i%8,y:Math.floor(i/8),terrain:'ground',building:null,hp:100,drop:null}))};
  const post=site.tiles[3*8+3];post.building='husbandryPost';
  const a={id:'patient-1',species,site:'surface',x:3,y:3,health:100,fed:80,age:0,husbandry:{post:[3,3],trust:100,product:0,care:true,harvest:true,retryAt:0,blocked:null},lifecycle:newLifecycle(null,[],species)};
  const c={id:'crew-0',site:'surface',x:2,y:3,health:100};
  const s={tick:0,nextId:10,seed:123,rng:321,sites:{surface:site},creatures:[a],crew:[c],jobs:[],log:[]};initializeAnimalHealth(s);return {s,a,c,site,post};
}
const treatment=(a,dose=10)=>({id:'job-1',kind:'animalTreat',animal:a.id,site:'surface',x:3,y:3,building:null,cost:{medicine:1},materials:{medicine:1},sources:[],work:20,remaining:0,dose});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const recover=(s,a,n)=>{for(let i=0;i<n;i++){s.tick++;updateAnimalHealth(s,a);}};

test('initial condition is neutral, idempotent and exclusive to livestock',()=>{
  const {s,a}=patient();a.health=63;a.fed=44;delete a.condition;s.creatures.push({id:'pest',species:'tibble',health:100});const before={health:a.health,fed:a.fed,rng:s.rng};initializeAnimalHealth(s);
  assert.deepEqual(a.condition,{injury:0,treated:0,thermalStress:0,cause:null,recovery:'none'});assert.deepEqual({health:a.health,fed:a.fed,rng:s.rng},before);assert.equal(s.creatures[1].condition,undefined);
  injureAnimal(s,a,2,'fire');const q=structuredClone(a.condition);initializeAnimalCondition(a);assert.deepEqual(a.condition,q);validateAnimalHealth(s);
});

test('fire creates bounded persistent injury and feeding only restores nonwound health deficits',()=>{
  const {s,a}=patient();assert.equal(injureAnimal(s,a,10,'fire'),10);assert.equal(a.health,90);assert.equal(a.condition.injury,10);recover(s,a,20);assert.equal(a.health,90);
  a.fed=0;updateAnimalHealth(s,a);close(a.health,89.8);assert.equal(a.condition.injury,10);a.fed=80;updateAnimalHealth(s,a);close(a.health,89.81);
  recover(s,a,100);close(a.health,90);assert.equal(a.condition.injury,10);assert.equal(a.condition.cause,'fire');validateAnimalHealth(s);
});

test('normal surface temperatures are tolerated while extreme exposure creates stress and injury',()=>{
  for(const species of ['bristleback','glazefoot']){
    const {s,a,site}=patient(species);for(const temp of [8,-35]){site.thermal.ambient=temp;recover(s,a,80);}assert.equal(a.health,100);assert.equal(a.condition.thermalStress,0);
    a.condition.thermalStress=44.5;site.thermal.ambient=80;updateAnimalHealth(s,a);assert.equal(animalHealthStatus(s,a).thermalState,'stressed');assert.equal(animalActivityAllowed(a),false);
    a.condition.thermalStress=70;updateAnimalHealth(s,a);assert.ok(a.condition.injury>0);assert.equal(a.condition.cause,'heat');assert.equal(animalHealthStatus(s,a).thermalState,'danger');
    site.thermal.ambient=-80;a.condition.thermalStress=-70;updateAnimalHealth(s,a);assert.equal(a.condition.cause,'cold');const injury=a.condition.injury;
    site.thermal.ambient=8;a.condition.thermalStress=40;updateAnimalHealth(s,a);close(a.condition.thermalStress,39.2);close(a.condition.injury,injury);validateAnimalHealth(s);
  }
});

test('treatment needs staged medicine and grants credit rather than immediate health or trust',()=>{
  const {s,a,c}=patient();injureAnimal(s,a,10,'fire');const j=treatment(a);s.jobs.push(j);j.materials={};const before=structuredClone(a);
  assert.equal(completeAnimalTreatment(s,c,j),false);assert.deepEqual(a,before);j.materials={medicine:1};assert.equal(completeAnimalTreatment(s,c,j),true);
  assert.equal(a.health,90);assert.equal(a.husbandry.trust,100);assert.equal(a.condition.treated,10);assert.equal(animalTreatmentEligibility(s,a).ok,false);
  s.jobs=[];recover(s,a,1);close(a.health,90.1);close(a.condition.injury,9.9);close(a.condition.treated,9.9);recover(s,a,99);
  assert.equal(a.health,100);assert.equal(a.condition.injury,0);assert.equal(a.condition.treated,0);assert.equal(a.condition.cause,null);assert.equal(a.condition.recovery,'none');validateAnimalHealth(s);
});

test('credit pauses for food, post access, temperature, fire and transport without loss',()=>{
  for(const [reason,change] of [['needs_food',f=>f.a.fed=59],['needs_post',f=>f.a.x=4],['unsafe_temperature',f=>f.site.thermal.ambient=40],['fire',f=>f.post.fire={id:'fire-1'}],['transport',f=>f.s.jobs.push({kind:'animalLead',animal:f.a.id})]]){
    const f=patient();injureAnimal(f.s,f.a,10,'fire');f.a.condition.treated=10;change(f);updateAnimalHealth(f.s,f.a);
    assert.equal(animalHealthStatus(f.s,f.a).recovery,reason);assert.equal(f.a.condition.treated,10);assert.equal(f.a.condition.injury,10);assert.equal(f.a.health,90);
  }
  const {s,a}=patient();injureAnimal(s,a,10,'fire');a.condition.treated=10;a.x=4;s.tick=3;assert.equal(moveAssignedAnimal(s,a,animalPath),true);assert.deepEqual([a.x,a.y],[3,3]);updateAnimalHealth(s,a);close(a.health,90.1);
});

test('paid treatment stays valid while unsafe or hungry and waits for feeding work',()=>{
  const {s,a,post}=patient();injureAnimal(s,a,10,'fire');const j=treatment(a);s.jobs=[j];a.fed=50;
  assert.equal(animalTreatmentValid(s,j),true);assert.equal(animalTreatmentReady(s,j),false);a.fed=80;post.fire={id:'fire-1'};assert.equal(animalTreatmentValid(s,j),true);assert.equal(animalTreatmentReady(s,j),false);delete post.fire;
  s.jobs.push({id:'job-2',kind:'animalCare',animal:a.id});assert.equal(animalTreatmentReady(s,j),false);s.jobs.pop();assert.equal(animalTreatmentReady(s,j),true);
});

test('injury and stress preserve stored products while pausing production and collection',()=>{
  const {s,a,c}=patient();a.husbandry.product=100;const j={id:'job-1',kind:'animalHarvest',animal:a.id,site:'surface',x:3,y:3,building:null};injureAnimal(s,a,1,'fire');
  animalCondition(s,a);assert.equal(a.husbandry.product,100);assert.equal(animalJobValid(s,j),false);assert.equal(completeAnimalJob(s,c,j),false);assert.equal(a.husbandry.product,100);
  a.condition.treated=1;recover(s,a,10);assert.equal(animalJobValid(s,j),true);a.husbandry.product=50;a.condition.thermalStress=45;animalCondition(s,a);assert.equal(a.husbandry.product,50);a.condition.thermalStress=0;animalCondition(s,a);assert.equal(a.husbandry.product,50.25);
});

test('injured adults pause an existing brood and injured juveniles pause growth until recovery',()=>{
  const s=createGame(),site=s.sites.surface,[a,b]=s.creatures;
  for(let y=15;y<=23;y++)for(let x=3;x<=9;x++){const t=at(site,x,y);t.terrain='ground';t.building=x===3||x===9||y===15||y===23?'fence':null;t.hp=100;t.flora={lichen:{biomass:80,harvests:0}};}
  for(const [animal,x] of [[a,6],[b,7]]){animal.x=x;animal.y=18;animal.fed=100;animal.husbandry.trust=100;animal.lifecycle.enabled=true;}
  s.tick=1;updateBreeding(s);const brood=a.lifecycle.brood;assert.ok(brood);injureAnimal(s,a,1,'fire');a.husbandry.post=[6,18];at(site,6,18).building='husbandryPost';a.condition.treated=1;
  for(let i=0;i<5;i++){s.tick++;updateAnimalHealth(s,a);updateBreeding(s);}assert.equal(brood.progress,0);assert.equal(breedingStatus(s,a).reason,'injured');
  for(let i=0;i<5;i++){s.tick++;updateAnimalHealth(s,a);updateBreeding(s);}assert.equal(brood.progress,1);
  const child={...structuredClone(b),id:'bristleback-900',x:5,y:19,husbandry:{...b.husbandry,post:null,product:0},lifecycle:newLifecycle(s.tick,[a.id,b.id])};initializeAnimalCondition(child);s.creatures.push(child);injureAnimal(s,child,1,'cold');const growth=child.lifecycle.growth;s.tick++;updateBreeding(s);assert.equal(child.lifecycle.growth,growth);
  child.condition.injury=0;child.condition.cause=null;child.health=100;child.condition.thermalStress=45;s.tick++;updateBreeding(s);assert.equal(child.lifecycle.growth,growth);assert.equal(breedingStatus(s,child).reason,'thermal_stress');child.condition.thermalStress=0;s.tick++;updateBreeding(s);assert.equal(child.lifecycle.growth,growth+1);
});

test('wounded animals request food below60 while a paid treatment stays queued, in either pair order',()=>{
  const {s,a}=patient();injureAnimal(s,a,10,'fire');a.fed=55;const j=treatment(a);s.jobs=[j];const requested=[];
  prepareHusbandry(s,(_s,site,x,y,kind,id)=>{requested.push({site,x,y,kind,id});return {ok:true};},()=>assert.fail('valid treatment must remain queued'));
  assert.deepEqual(requested,[{site:'surface',x:3,y:3,kind:'animalCare',id:a.id}]);
  const care={id:'job-2',kind:'animalCare',site:'surface',x:3,y:3,animal:a.id,building:null,work:12,cost:{food:1},materials:{},sources:[]};s.jobs.push(care);validateHusbandry(s);s.jobs.reverse();validateHusbandry(s);assert.equal(animalTreatmentReady(s,j),false);
  s.jobs=[care];assert.equal(animalTreatmentEligibility(s,a).ok,true);s.jobs.push({...care,id:'job-3'});assert.throws(()=>validateHusbandry(s),/Conflicting/);
});

test('physical transport can cancel both pending work types while preserving injury and credit',()=>{
  const {s,a,site}=patient();injureAnimal(s,a,10,'fire');a.condition.treated=2;const j=treatment(a,8);s.jobs=[j,{id:'job-2',kind:'animalCare',animal:a.id,site:'surface',x:3,y:3}];site.tiles[4*8+4].building='husbandryPost';
  const q=structuredClone(a.condition),cancelled=[];const result=requestTransport(s,a.id,4,4,(_s,id)=>{cancelled.push(id);s.jobs=s.jobs.filter(j=>j.id!==id);});
  assert.equal(result.ok,true);assert.deepEqual(cancelled,['job-1','job-2']);assert.deepEqual(a.condition,q);assert.deepEqual(a.husbandry.post,[3,3]);assert.equal(s.jobs[0].kind,'animalLead');
});

test('strict conditions and veterinary job pins reject malformed state',()=>{
  for(const mutate of [a=>delete a.condition,a=>a.condition.extra=true,a=>a.condition.injury=101,a=>a.condition.treated=1,a=>a.condition.thermalStress=101,a=>a.condition.cause='disease',a=>a.condition.recovery='free_healing',a=>a.condition.injury=1]){const {s,a}=patient();mutate(a);assert.throws(()=>validateAnimalHealth(s),/condition/);}
  for(const mutate of [j=>j.dose=21,j=>j.dose=0,j=>j.cost.food=1,j=>j.work=19,j=>j.patient='crew-0']){const {s,a}=patient();injureAnimal(s,a,10,'fire');const j=treatment(a);s.jobs=[j];mutate(j);assert.throws(()=>validateAnimalHealth(s),/treatment/);}
  const {s}=patient();s.creatures.push({id:'pest',species:'tibble',condition:{}});assert.throws(()=>validateAnimalHealth(s),/Pests/);
});

test('semantic injury/recovery/death transitions are recorded once and never revive a dead animal',()=>{
  const s=createGame(),a=s.creatures[0],site=s.sites.surface,post=at(site,10,15);post.building='husbandryPost';a.x=10;a.y=15;a.husbandry.post=[10,15];a.fed=80;startRecording(s);
  injureAnimal(s,a,1,'fire');a.condition.treated=1;recover(s,a,10);injureAnimal(s,a,200,'fire');const q=structuredClone(a.condition);assert.equal(injureAnimal(s,a,1,'fire'),0);recover(s,a,10);assert.equal(a.health,0);assert.deepEqual(a.condition,q);
  const events=exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event?.entity===a.id).map(r=>r.event);
  assert.equal(events.filter(e=>e.id==='animal.recovered').length,1);assert.equal(events.filter(e=>e.id==='animal.died').length,1);assert.equal(events.filter(e=>e.id==='animal.injured').length,2);assert.ok(events.some(e=>e.id==='animal.recovery.state_changed'&&e.current==='recovering'));assert.equal(VETERINARY.medicine,1);
});
