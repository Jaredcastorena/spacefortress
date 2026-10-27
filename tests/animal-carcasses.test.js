import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTCHERY, initializeAnimalDeaths, registerAnimalDeath, carcassPosition, dispatchEligibility, dispatchJobValid, butcheryEligibility, discardEligibility, dispatchJob, carcassJob, requestDispatch, requestButchery, requestDiscard, releaseCarcass, reconcileCarcasses, updateCarcasses, actCarcass, completeDispatch, completeCarcass, carcassStatus, validateCarcasses } from '../src/animal-carcasses.js';
import { newLifecycle } from '../src/breeding.js';
import { neutralGenome } from '../src/animal-traits.js';
import { initializeAnimalCondition, injureAnimal, updateAnimalHealth } from '../src/animal-health.js';
import { assignAnimal, prepareHusbandry, animalJobValid } from '../src/husbandry.js';
import { FOOD_LIFETIME, foodLots } from '../src/food-lots.js';
import { LIVESTOCK } from '../src/livestock-data.js';

// Supplied domain fixtures and an injected arrival stub isolate ownership/FSM
// rules. Integration owns actual crew traversal, deliveries and save migration.
function fixture(species='bristleback'){
  const size=8,site={id:'surface',size,rooms:[],thermal:{ambient:20},tiles:Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),terrain:'ground',building:null,hp:100,drop:null}))};site.tiles[4*size+4].building='husbandryPost';
  const a={id:'animal-0',species,site:'surface',x:2,y:2,health:100,fed:100,age:0,genetics:neutralGenome(),lifecycle:newLifecycle(null,[],species),husbandry:{post:{x:4,y:4,z:0},trust:100,product:40,care:true,harvest:true,retryAt:0,blocked:null}};initializeAnimalCondition(a);
  const c={id:'crew-0',site:'surface',x:2,y:2,health:100,energy:100,morale:50,skills:{husbandry:{level:0,xp:0}},labors:{husbandry:true},job:null,carry:null,rescue:null,intent:null};
  const s={tick:0,nextId:1,seed:1728,rng:444,creatures:[a],crew:[c],jobs:[],log:[],sites:{surface:site}};initializeAnimalDeaths(s);return {s,a,c,site,t:site.tiles[4*size+4]};
}
function orderStub(s,site,x,y,kind,animal){const work=kind==='animalDispatch'?8:kind==='animalButcher'?20:4,j={id:`job-${s.nextId++}`,site,x,y,kind,animal,building:null,work,remaining:work,cost:{},materials:{},sources:[],worker:null,blockedReason:null,missingFood:0,foodSpoiled:0};if(kind==='animalButcher')j.phase='collect';s.jobs.push(j);if(carcassJob(j))s.creatures.find(a=>a.id===animal).death.reservedBy=j.id;return {ok:true,job:j};}
const attach=(f,j)=>{j.worker=f.c.id;f.c.job=j.id;};
const arrive=(s,c,site,goals)=>{c.x=goals[0].x;c.y=goals[0].y;c.z=goals[0].z;return 'arrived';};
const release=(s,c)=>{const j=s.jobs.find(j=>j.id===c.job);releaseCarcass(s,j,c);j.worker=null;c.job=null;};
function butcherFixture(species='bristleback'){const f=fixture(species);registerAnimalDeath(f.s,f.a,'unknown');f.j=requestButchery(f.s,f.a.id,4,4,orderStub).job;attach(f,f.j);return f;}
function stage(f){assert.equal(actCarcass(f.s,f.c,f.j,arrive,release),false);assert.equal(f.j.phase,'carry');assert.equal(actCarcass(f.s,f.c,f.j,arrive,release),false);assert.equal(f.j.phase,'process');}
function cancel(s,jobId){const j=s.jobs.find(j=>j.id===jobId),c=s.crew.find(c=>c.id===j.worker);releaseCarcass(s,j,c,'cancelled');if(c)c.job=null;s.jobs=s.jobs.filter(candidate=>candidate!==j);}
function removeJob(f){f.s.jobs=f.s.jobs.filter(j=>j!==f.j);f.c.job=null;}

test('fresh initialization is idempotent and legacy dead bookkeeping grants no body or policy changes',()=>{
  const f=fixture();assert.equal(f.a.death,null);const before=structuredClone(f.s);initializeAnimalDeaths(f.s);assert.deepEqual(f.s,before);
  delete f.a.death;f.a.health=0;const original=structuredClone(f.s);initializeAnimalDeaths(f.s,{legacy:true});const copy=structuredClone(f.s);delete copy.creatures[0].death;assert.deepEqual(copy,original);assert.equal(f.a.death.disposition,'legacy');assert.equal(f.a.death.yield,0);assert.equal(carcassPosition(f.s,f.a),null);validateCarcasses(f.s);
});

test('legacy initialization rejects mortality/body shadows without assigning defaults',()=>{
  for(const key of ['death','body','carcass']){const f=fixture();delete f.a.death;f.a[key]=null;const before=structuredClone(f.s);assert.throws(()=>initializeAnimalDeaths(f.s,{legacy:true}),/shadow/);assert.deepEqual(f.s,before);}
});

test('death registers exactly one body with frozen species/stage yield and no RNG or ID allocation',()=>{
  for(const species of ['bristleback','glazefoot'])for(const juvenile of [false,true]){const {s,a}=fixture(species);if(juvenile)a.lifecycle=newLifecycle(0,['parent-a','parent-b'],species);const rng=s.rng,next=s.nextId,genetics=structuredClone(a.genetics),parents=[...a.lifecycle.parents];assert.equal(registerAnimalDeath(s,a,'unknown'),true);assert.equal(a.health,0);assert.equal(a.death.yield,juvenile?1:LIVESTOCK[species].meatYield);assert.equal(a.death.meatKind,LIVESTOCK[species].meatKind);assert.deepEqual(carcassPosition(s,a),{site:'surface',x:2,y:2,z:0});assert.equal(a.husbandry.post,null);assert.equal(a.lifecycle.enabled,false);const death=structuredClone(a.death);assert.equal(registerAnimalDeath(s,a,'fire'),false);assert.deepEqual(a.death,death);assert.equal(s.rng,rng);assert.equal(s.nextId,next);assert.deepEqual(a.genetics,genetics);assert.deepEqual(a.lifecycle.parents,parents);validateCarcasses(s);}
});

test('fire, thermal and starvation terminal health paths create bodies without changing injury cause enums',()=>{
  for(const cause of ['fire','cold','heat']){const f=fixture();injureAnimal(f.s,f.a,100,cause);assert.equal(f.a.death.cause,cause);assert.equal(f.a.condition.cause,cause);assert.equal(f.a.death.yield,4);}
  const f=fixture();f.a.health=.1;f.a.fed=0;updateAnimalHealth(f.s,f.a);assert.equal(f.a.death.cause,'starvation');assert.equal(f.a.condition.cause,null);validateCarcasses(f.s);
});

test('carrier death clears its brood while mate death preserves the other frozen brood and ancestry',()=>{
  const f=fixture(),mate={...structuredClone(f.a),id:'mate'};f.s.creatures.push(mate);const brood={id:'brood-1',mate:mate.id,started:0,progress:10,inheritance:{child:neutralGenome()}};f.a.lifecycle.brood=structuredClone(brood);registerAnimalDeath(f.s,mate,'heat');assert.deepEqual(f.a.lifecycle.brood,brood);assert.ok(f.s.creatures.includes(mate));registerAnimalDeath(f.s,f.a,'cold');assert.equal(f.a.lifecycle.brood,null);assert.ok(f.s.creatures.includes(f.a));
});

test('dispatch eligibility requires tame adult nonbrooding disabled breeding at an intact conflict-free post',()=>{
  const mutations=[[f=>f.a.husbandry.trust=40,'untamed'],[f=>f.a.lifecycle=newLifecycle(0,['p','q']),'juvenile'],[f=>f.a.lifecycle.enabled=true,'breeding_enabled'],[f=>f.a.lifecycle.brood={},'carrying_brood'],[f=>f.t.hp=0,'needs_post'],[f=>f.t.fire={},'fire'],[f=>f.s.jobs.push({kind:'animalLead',animal:f.a.id,site:'surface',x:1,y:1}),'busy']];
  for(const [mutate,code]of mutations){const f=fixture();mutate(f);assert.equal(dispatchEligibility(f.s,f.a).code,code);assert.equal(requestDispatch(f.s,f.a.id,()=>assert.fail('rejected action must not order')).ok,false);}
  const f=fixture();injureAnimal(f.s,f.a,1,'cold');assert.equal(dispatchEligibility(f.s,f.a).ok,true);
});

test('dispatch validator excludes its own job and death requires completed physical work',()=>{
  const f=fixture(),r=requestDispatch(f.s,f.a.id,orderStub);f.j=r.job;attach(f,f.j);assert.ok(dispatchJob(f.j));assert.equal(dispatchJobValid(f.s,f.j),true);assert.equal(animalJobValid(f.s,f.j),true);assert.equal(completeDispatch(f.s,f.c,f.j),false);f.j.remaining=0;assert.equal(completeDispatch(f.s,f.c,f.j),false);f.a.x=f.a.y=4;f.c.x=3;f.c.y=4;assert.equal(completeDispatch(f.s,f.c,f.j),true);assert.equal(f.a.death.cause,'dispatch');removeJob(f);validateCarcasses(f.s);
  const other=fixture(),job=requestDispatch(other.s,other.a.id,orderStub).job;other.a.lifecycle.enabled=true;assert.equal(dispatchJobValid(other.s,job),false);
});

test('canceling partial dispatch leaves livestock alive and automatic care waits while it exists',()=>{
  const f=fixture(),j=requestDispatch(f.s,f.a.id,orderStub).job;j.remaining=3;f.a.fed=10;prepareHusbandry(f.s,()=>assert.fail('dispatch must suppress automatic feeding'),()=>assert.fail('valid dispatch must remain'));f.s.jobs=[];assert.equal(f.a.health,100);assert.equal(f.a.death,null);assert.equal(dispatchEligibility(f.s,f.a).ok,true);
});

test('butchery/discard reject nonphysical, spoiled, reserved and occupied post targets without mutations',()=>{
  const f=fixture();assert.equal(butcheryEligibility(f.s,f.a,4,4).code,'no_body');registerAnimalDeath(f.s,f.a,'unknown');assert.equal(butcheryEligibility(f.s,f.a,4,4).ok,true);const original=structuredClone(f.s);assert.equal(requestButchery(f.s,f.a.id,-1,4,()=>assert.fail()).ok,false);assert.deepEqual(f.s,original);
  const live={...structuredClone(f.a),id:'live',health:100,death:null,husbandry:{...f.a.husbandry,post:{x:4,y:4,z:0}}};f.s.creatures.push(live);assert.equal(butcheryEligibility(f.s,f.a,4,4).code,'busy');f.s.creatures.pop();f.a.death.age=FOOD_LIFETIME;f.a.death.disposition='spoiled';assert.equal(butcheryEligibility(f.s,f.a,4,4).code,'spoiled');assert.equal(discardEligibility(f.s,f.a).ok,true);
});

test('collect/carry/process maintain exclusive physical ownership and produce no food or retrieval XP',()=>{
  const f=butcherFixture(),rng=f.s.rng;validateCarcasses(f.s);const age=f.a.death.age;assert.equal(f.c.skills.husbandry.xp,0);assert.equal(f.t.drop,null);stage(f);assert.equal(f.c.skills.husbandry.xp,0);assert.equal(f.j.remaining,20);assert.deepEqual(f.a.death.owner,{kind:'job',job:f.j.id});assert.deepEqual(carcassPosition(f.s,f.a),{site:'surface',x:4,y:4,z:0});assert.equal(f.a.x,2);assert.equal(f.a.y,2);assert.equal(f.t.drop,null);assert.equal(f.a.death.age,age);assert.equal(f.s.rng,rng);validateCarcasses(f.s);
});

test('butchery completion is atomic single-use typed output retaining body age and fixed waste',()=>{
  for(const species of ['bristleback','glazefoot']){const f=butcherFixture(species);f.a.death.age=72;stage(f);for(let i=0;i<64&&f.j.remaining>0;i++)actCarcass(f.s,f.c,f.j,arrive,release);assert.equal(f.j.remaining,0);assert.equal(f.c.skills.husbandry.level,1);assert.ok(Math.abs(f.c.skills.husbandry.xp)<1e-10);assert.equal(completeCarcass(f.s,f.c,f.j),true);assert.equal(f.t.drop.food,LIVESTOCK[species].meatYield);assert.equal(f.t.drop.waste,.25);assert.deepEqual(foodLots(f.t.drop),[{kind:LIVESTOCK[species].meatKind,amount:LIVESTOCK[species].meatYield,age:72}]);assert.equal(completeCarcass(f.s,f.c,f.j),false);assert.equal(f.a.death.disposition,'butchered');assert.equal(carcassPosition(f.s,f.a),null);removeJob(f);validateCarcasses(f.s);assert.equal(butcheryEligibility(f.s,f.a,4,4).ok,false);}
});

test('carry release drops at actual crew position while staged interruption keeps owner/work/age',()=>{
  const f=butcherFixture();actCarcass(f.s,f.c,f.j,arrive,release);f.c.x=3;f.c.y=2;f.a.death.age=50;release(f.s,f.c);assert.deepEqual(f.a.death.owner,{kind:'tile',site:'surface',x:3,y:2,z:0});assert.equal(f.j.phase,'collect');assert.equal(f.a.death.reservedBy,f.j.id);attach(f,f.j);stage(f);actCarcass(f.s,f.c,f.j,arrive,release);const remaining=f.j.remaining;release(f.s,f.c);assert.equal(f.j.phase,'process');assert.deepEqual(f.a.death.owner,{kind:'job',job:f.j.id});assert.equal(f.j.remaining,remaining);assert.equal(f.a.death.age,50);validateCarcasses(f.s);
});

test('canceling each carcass phase releases its actual body and claim without output or freshness reset',()=>{
  for(const phase of ['collect','carry','process']){const f=butcherFixture();if(phase!=='collect')actCarcass(f.s,f.c,f.j,arrive,release);if(phase==='process')actCarcass(f.s,f.c,f.j,arrive,release);if(phase==='carry'){f.c.x=3;f.c.y=2;}const p=carcassPosition(f.s,f.a);f.a.death.age=88;releaseCarcass(f.s,f.j,f.c,'cancelled');f.s.jobs=[];f.c.job=null;assert.deepEqual(carcassPosition(f.s,f.a),p);assert.equal(f.a.death.owner.kind,'tile');assert.equal(f.a.death.reservedBy,null);assert.equal(f.a.death.age,88);assert.equal(f.t.drop,null);validateCarcasses(f.s);assert.equal(butcheryEligibility(f.s,f.a,4,4).ok,true);}
});

test('blocked route drops a carried body while waiting airlock retains it',()=>{
  const f=butcherFixture();actCarcass(f.s,f.c,f.j,arrive,release);const owner=structuredClone(f.a.death.owner);assert.equal(actCarcass(f.s,f.c,f.j,()=> 'waiting_airlock',release),false);assert.deepEqual(f.a.death.owner,owner);assert.equal(f.j.phase,'carry');assert.equal(actCarcass(f.s,f.c,f.j,()=> 'blocked',release),false);assert.equal(f.a.death.owner.kind,'tile');assert.equal(f.j.phase,'collect');assert.equal(f.j.worker,null);assert.equal(f.a.death.reservedBy,f.j.id);
});

test('post destruction, worker death and immobility drop bodies and cancel claims at actual locations',()=>{
  for(const mode of ['post','death','immobile']){const f=butcherFixture();actCarcass(f.s,f.c,f.j,arrive,release);f.c.x=3;f.c.y=2;if(mode==='post')f.t.building=null;else if(mode==='death')f.c.health=0;else f.c.medical={injury:60};const p=carcassPosition(f.s,f.a);reconcileCarcasses(f.s,cancel);assert.deepEqual(carcassPosition(f.s,f.a),p);assert.equal(f.s.jobs.length,0);assert.equal(f.a.death.reservedBy,null);assert.equal(f.a.death.owner.kind,'tile');validateCarcasses(f.s);}
});

test('body age uses actual tile, carried and staged temperatures and rot preserves the physical body',()=>{
  const f=butcherFixture();f.site.thermal.ambient=-10;updateCarcasses(f.s);assert.equal(f.a.death.age,.05);actCarcass(f.s,f.c,f.j,arrive,release);f.site.thermal.ambient=50;updateCarcasses(f.s);assert.equal(f.a.death.age,4.05);actCarcass(f.s,f.c,f.j,arrive,release);f.site.thermal.ambient=20;updateCarcasses(f.s);assert.equal(f.a.death.age,5.05);f.a.death.age=FOOD_LIFETIME-1;updateCarcasses(f.s);assert.equal(f.a.death.disposition,'spoiled');assert.equal(carcassStatus(f.s,f.a).edibleYield,0);assert.deepEqual(f.a.death.owner,{kind:'job',job:f.j.id});assert.equal(completeCarcass(f.s,f.c,f.j),false);reconcileCarcasses(f.s,cancel);assert.equal(f.a.death.owner.kind,'tile');assert.equal(f.a.death.reservedBy,null);validateCarcasses(f.s);
});

test('discard is located work converting one spoiled body to waste once',()=>{
  const f=fixture();registerAnimalDeath(f.s,f.a,'unknown');f.a.death.age=FOOD_LIFETIME;f.a.death.disposition='spoiled';f.j=requestDiscard(f.s,f.a.id,orderStub).job;attach(f,f.j);validateCarcasses(f.s);for(let i=0;i<32&&f.j.remaining>0;i++)actCarcass(f.s,f.c,f.j,arrive,release);assert.equal(completeCarcass(f.s,f.c,f.j),true);assert.deepEqual(f.site.tiles[2*8+2].drop,{waste:.25});assert.equal(completeCarcass(f.s,f.c,f.j),false);removeJob(f);validateCarcasses(f.s);assert.equal(discardEligibility(f.s,f.a).ok,false);
});

test('death reconciliation cancels living-only work once and recovered dead records never spawn another body',()=>{
  const f=fixture();const job=orderStub(f.s,'surface',4,4,'animalDispatch',f.a.id).job;f.a.health=0;const canceled=[];reconcileCarcasses(f.s,(s,id)=>{canceled.push(id);s.jobs=s.jobs.filter(j=>j.id!==id);});assert.deepEqual(canceled,[job.id]);assert.equal(f.a.death.cause,'unknown');const death=structuredClone(f.a.death);reconcileCarcasses(f.s,()=>assert.fail());assert.deepEqual(f.a.death,death);f.a.death.disposition='butchered';f.a.death.owner=null;reconcileCarcasses(f.s,()=>assert.fail());assert.equal(f.a.death.disposition,'butchered');
});

test('corpse jobs reserve target posts against live assignment and eligibility returns detached status',()=>{
  const f=butcherFixture(),live={...structuredClone(f.a),id:'live',health:100,death:null,husbandry:{...f.a.husbandry,post:null}};f.s.creatures.push(live);assert.equal(assignAnimal(f.s,live.id,4,4,()=>[],()=>assert.fail()).ok,false);const status=carcassStatus(f.s,f.a);status.owner.x=7;assert.equal(f.a.death.owner.x,2);assert.equal(status.id,`carcass:${f.a.id}`);assert.equal(status.edibleYield,4);assert.equal(carcassStatus(f.s,live),null);
});

test('strict mortality rejects missing/extra fields, impossible bodies, yields, ages and shadows',()=>{
  for(const change of [a=>delete a.death,a=>a.death.extra=true,a=>a.death.tick=-1,a=>a.death.cause='disease',a=>a.death.yield=99,a=>a.death.meatKind='curd',a=>a.death.age=NaN,a=>a.death.age=-1,a=>a.death.age=FOOD_LIFETIME,a=>a.death.disposition='eaten',a=>a.death.owner.extra=1,a=>a.death.owner.x=-1,a=>a.death.owner={kind:'crew',crew:'missing'},a=>a.death.reservedBy='missing',a=>a.death.disposition='butchered',a=>a.body={}]){const f=fixture();registerAnimalDeath(f.s,f.a,'unknown');change(f.a);assert.throws(()=>validateCarcasses(f.s));}
  const f=fixture();f.a.death={};assert.throws(()=>validateCarcasses(f.s),/Living/);f.a.death=null;f.s.creatures.push({id:'pest',species:'tibble',death:null});assert.throws(()=>validateCarcasses(f.s),/Pests/);
});

test('strict job validation rejects duplicate claims, wrong phases and dangling owners',()=>{
  for(const change of [f=>f.j.phase='carry',f=>f.j.remaining=21,f=>f.j.cost.food=1,f=>f.j.foodKinds={},f=>f.j.work=19,f=>f.a.death.reservedBy=null,f=>f.s.jobs.push({...structuredClone(f.j),id:'job-other'}),f=>f.a.death.owner={kind:'job',job:'missing'}]){const f=butcherFixture();change(f);assert.throws(()=>validateCarcasses(f.s));}
  const f=butcherFixture();stage(f);f.a.death.owner.job='missing';assert.throws(()=>validateCarcasses(f.s));assert.deepEqual(BUTCHERY,{dispatchWork:8,processWork:20,discardWork:4,waste:.25});
});
