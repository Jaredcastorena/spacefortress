import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,order,cancelJob,step,serialize,deserialize,setAnimalPost,setAnimalPolicy,setAnimalTreatment,butcherAnimal,transportAnimalToPost} from '../src/simulation.js';
import {initializeHusbandry,validateHusbandry,prepareHusbandry,completeAnimalJob} from '../src/husbandry.js';
import {initializeBreeding,updateBreeding,validateBreeding,breedingStatus,BREEDING} from '../src/breeding.js';
import {initializeAnimalHealth,injureAnimal,updateAnimalHealth,animalHealthStatus,animalTreatmentEligibility,completeAnimalTreatment} from '../src/animal-health.js';
import {initializeAnimalTraits} from '../src/animal-traits.js';
import {initializeAnimalDeaths,registerAnimalDeath,butcheryEligibility,validateCarcasses,carcassPosition,releaseCarcass,completeCarcass,actCarcass} from '../src/animal-carcasses.js';
import {postReserved,transportRoute,validateTransport,completeTransport,actTransport} from '../src/animal-transport.js';
import {validateAnimalLocations} from '../src/animal-locations.js';
import {pastureRegions,animalPasture} from '../src/pastures.js';
import {tileAt,positionOf,horizontalNeighbors,sameCell} from '../src/spatial.js';
import {initializeStorage,totalResources,syncResources} from '../src/inventory.js';
import {typedFood,FOOD_LIFETIME} from '../src/food-lots.js';
import {startRecording,exportRecording,tileEntityId} from '../src/telemetry.js';
import {executeAction} from '../src/controls.js';
import {updateRooms} from '../src/atmosphere.js';
import {initializeThermal} from '../src/thermal.js';

const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).flatMap(row=>row.event?[row.event]:[]);
const check=s=>{syncResources(s);return deserialize(serialize(s));};
const until=(s,p,max=180)=>{for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),`tick ${s.tick}: ${s.jobs.map(j=>`${j.kind}: ${j.blockedReason}`).join('; ')}`);};
function initialize(s){initializeHusbandry(s);initializeBreeding(s);initializeAnimalHealth(s);initializeAnimalTraits(s);initializeAnimalDeaths(s);}
// Synthetic finite mechanics boundary: existing generated settlements, installed
// pens/stores and resident handlers. This does not claim paid settlement travel,
// pen construction or sustained habitation. Jobs still deliver and consume stock.
function fixture({species='bristleback',upper=false}={}){
 const s=createGame(74219,{regionSchema:2}),sites=Object.values(s.sites).filter(site=>s.region.sites[site.id]?.template==='outcrop').slice(0,2);
 assert.equal(sites.length,2);s.creatures=[];
 for(const [i,site] of sites.entries()){
  if(upper){const blank=site.tiles.find(t=>t.terrain==='ground'&&!t.building&&!t.flora&&!t.deposit);site.levels.push({z:1,name:'Test platform'});site.tiles.push(...site.tiles.map(t=>({...structuredClone(blank),x:t.x,y:t.y,z:1,terrain:'ground',building:null})));}
  for(const z of upper?[0,1]:[0]){
   for(let y=3;y<=10;y++)for(let x=3;x<=10;x++){
    const t=at(site,x,y,z);Object.assign(t,{terrain:'ground',building:x===3||x===10||y===3||y===10?'fence':null,hp:100,flora:{},drop:null});delete t.deposit;t.liquid=0;delete t.gateMode;
   }
   Object.assign(at(site,7,10,z),{building:'pastureGate',gateMode:'latched'});at(site,7,7,z).building='husbandryPost';
   const store=at(site,8,7,z);store.building='stockpile';initializeStorage(store);store.stock={...typedFood('fungalcap',3),medicine:1};
  }
  const c=s.crew[i];Object.assign(c,{site:site.id,x:7,y:7,z:0});for(const key of Object.keys(c.labors))c.labors[key]=key==='husbandry'||key==='medicine';
  s.outposts[site.id]={established:true,residents:[c.id]};
  s.creatures.push({id:`site-animal-${i}`,species,site:site.id,x:7,y:7,z:0,health:100,fed:80,age:0});
 }
 initialize(s);for(const a of s.creatures){a.husbandry.care=false;a.husbandry.harvest=false;}
 return {s,sites,a:s.creatures[0],b:s.creatures[1],c:s.crew[0],d:s.crew[1],post:at(sites[0],7,7),otherPost:at(sites[1],7,7)};
}
function addAnimal(f,site,index,z=0){const a={id:`site-extra-${index}`,species:f.a.species,site:site.id,x:8,y:8,z,health:100,fed:100,age:0};f.s.creatures.push(a);initialize(f.s);a.husbandry.care=false;a.husbandry.harvest=false;return a;}
function assign(f,a,z=0){const r=setAnimalPost(f.s,a.id,7,7,z);assert.equal(r.ok,true,r.message);}

test('detached initializers need no home site and preserve initialized animal fields',()=>{
 const f=fixture(),s={sites:{[f.sites[0].id]:f.sites[0]},creatures:[{id:'detached',species:'glazefoot',site:f.sites[0].id,x:7,y:7,z:0,health:100,fed:50,age:0}],crew:[],jobs:[],seed:55,tick:0};
 initialize(s);assert.equal(s.creatures[0].death,null);assert.equal(s.creatures[0].lifecycle.growth,600);assert.equal(s.creatures[0].condition.injury,0);s.creatures[0].husbandry.trust=42;const prior=structuredClone(s.creatures);initialize(s);assert.deepEqual(s.creatures,prior);
});

test('identical post coordinates remain independent across sites and floors and save exactly',()=>{
 const f=fixture({upper:true});assign(f,f.a);assign(f,f.b);const upper=addAnimal(f,f.sites[0],2,1);assign(f,upper,1);
 const duplicate=addAnimal(f,f.sites[0],3);assert.equal(setAnimalPost(f.s,duplicate.id,7,7).ok,false);
 validateHusbandry(f.s);validateAnimalLocations(f.s);assert.notEqual(animalPasture(f.s,f.a).region,animalPasture(f.s,f.b).region);assert.notEqual(animalPasture(f.s,f.a).region,animalPasture(f.s,upper).region);
 assert.equal(animalPasture(f.s,f.b,pastureRegions(f.sites[0])).region,null);assert.equal(serialize(check(f.s)),serialize(f.s));
 const bad=structuredClone(f.s);bad.creatures[3].husbandry.post={x:7,y:7,z:0};assert.throws(()=>validateHusbandry(bad),/assigned twice/);
});

test('local typed feed is physically reserved, refundable and consumed by real handler work',()=>{
 const f=fixture({species:'glazefoot'});assign(f,f.a);assign(f,f.b);f.a.husbandry.care=true;
 const local=at(f.sites[0],8,7),foreign=at(f.sites[1],8,7),foreignFood=foreign.stock.food;
 local.stock=typedFood('curd',3);assert.equal(order(f.s,f.a.site,7,7,'animalCare',f.a.id).ok,false);
 local.stock={...typedFood('fungalcap',3),medicine:1};const before=totalResources(f.s);prepareHusbandry(f.s,order,cancelJob);let j=f.s.jobs.find(j=>j.animal===f.a.id);assert.ok(j);assert.equal(j.site,f.a.site);assert.deepEqual(j.cost,{food:1});assert.deepEqual(j.foodKinds,{fungalcap:1});assert.ok(j.sources.every(source=>source.x===8&&source.y===7&&source.z===0));
 cancelJob(f.s,j.id,true);assert.deepEqual(totalResources(f.s),before);prepareHusbandry(f.s,order,cancelJob);j=f.s.jobs.find(j=>j.animal===f.a.id);assert.ok(j);
 const copy=check(f.s);startRecording(f.s);until(f.s,()=>f.a.husbandry.trust===40);step(copy,f.s.tick-copy.tick);assert.deepEqual(f.s,copy);
 assert.equal(setAnimalPolicy(f.s,f.a.id,'care',false).ok,true); // Refund the next automatic visit, if already reserved.
 assert.equal(local.stock.food,2);assert.equal(foreign.stock.food,foreignFood);assert.equal(f.post.drop.waste,.125);assert.equal(f.otherPost.drop,null);assert.ok(events(f.s).some(e=>e.id==='animal.care.completed'&&e.entity===f.a.id));
 f.a.husbandry.care=false;f.a.husbandry.trust=100;f.a.husbandry.harvest=true;f.a.husbandry.product=100;until(f.s,()=>f.a.husbandry.product<100);assert.equal(f.post.drop.food,2);assert.equal(f.otherPost.drop,null);assert.ok(events(f.s).some(e=>e.id==='animal.harvested'&&e.target===tileEntityId(f.a.site,7,7,0)));check(f.s);
});

test('remote veterinary care consumes local medicine and ignores other-site post work',()=>{
 const f=fixture();
 // Initial finite warm-room boundary: exposed old outcrops are -60 C, which
 // correctly blocks treatment. No active heater or health reset is supplied.
 for(let y=5;y<=9;y++)for(let x=5;x<=9;x++){const t=at(f.sites[0],x,y);t.terrain='floor';if(x===5||x===9||y===5||y===9)t.building='wall';}
 updateRooms(f.sites[0]);initializeThermal(f.s);assign(f,f.a);assign(f,f.b);f.a.husbandry.trust=100;injureAnimal(f.s,f.a,5,'fire');
 f.s.jobs.push({id:'foreign-post-work',kind:'build',site:f.b.site,x:7,y:7,z:0});assert.equal(animalTreatmentEligibility(f.s,f.a).ok,true);f.s.jobs.pop();
 const r=setAnimalTreatment(f.s,f.a.id);assert.equal(r.ok,true,r.message);const j=r.job;assert.equal(j.site,f.a.site);assert.deepEqual(j.cost,{medicine:1});assert.equal(completeAnimalTreatment(f.s,f.d,j),false);
 until(f.s,()=>!f.s.jobs.includes(j));assert.equal(at(f.sites[0],8,7).stock.medicine,undefined);assert.equal(at(f.sites[1],8,7).stock.medicine,1);assert.ok(f.a.condition.treated>0);assert.equal(animalHealthStatus(f.s,f.a).recovery,'recovering');check(f.s);
});

test('health and direct completions use the animal and handler actual floors',()=>{
 const f=fixture({upper:true});f.a.z=1;assign(f,f.a,1);const top=at(f.sites[0],7,7,1);f.a.health=90;
 top.fire='upper-fire';updateAnimalHealth(f.s,f.a);assert.equal(f.a.health,90);delete top.fire;f.post.fire='lower-fire';updateAnimalHealth(f.s,f.a);assert.equal(f.a.health,90.01);delete f.post.fire;
 f.a.husbandry.care=true;const j={kind:'animalCare',site:f.a.site,animal:f.a.id,x:7,y:7,z:1,materials:typedFood('fungalcap',1)};
 assert.equal(completeAnimalJob(f.s,f.c,j),false);f.c.z=1;assert.equal(completeAnimalJob(f.s,f.d,j),false);assert.equal(completeAnimalJob(f.s,f.c,j),true);assert.equal(top.drop.waste,.125);assert.equal(f.post.drop,null);
});

test('local escort reservations and physical handlers cannot cross settlement ownership',()=>{
 const f=fixture({upper:true});for(const a of [f.a,f.b]){a.husbandry.trust=100;a.x=5;}
 const r=transportAnimalToPost(f.s,f.a.id,7,7),other=transportAnimalToPost(f.s,f.b.id,7,7);assert.equal(r.ok,true,r.message);assert.equal(other.ok,true,other.message);const j=r.job;
 assert.equal(postReserved(f.s,7,7,'someone',0,f.a.site),true);assert.equal(postReserved(f.s,7,7,'someone',1,f.a.site),false);assert.equal(transportRoute(f.s,j,f.d),null);validateTransport(f.s);
 const bad=structuredClone(f.s);bad.jobs[0].worker=f.d.id;assert.throws(()=>validateTransport(bad),/transport/);
 Object.assign(f.c,positionOf(f.a));f.c.job=j.id;j.worker=f.c.id;const release=()=>assert.fail('local route should remain available');let finished=false;
 for(let n=0;n<100&&!finished;n++){f.s.tick++;finished=actTransport(f.s,f.c,j,release);assert.equal(f.a.site,f.c.site);if(j.phase==='escort')assert.ok(sameCell(f.a,f.c));}
 assert.equal(finished,true);assert.equal(completeTransport(f.s,f.d,j),false);assert.equal(completeTransport(f.s,f.c,j),true);assert.deepEqual(f.a.husbandry.post,{x:7,y:7,z:0});assert.equal(f.b.husbandry.post,null);
 const noHandler=fixture();noHandler.a.husbandry.trust=100;noHandler.c.site='surface';assert.equal(transportAnimalToPost(noHandler.s,noHandler.a.id,7,7).ok,false);
});

test('mates, pasture capacity and birth occupancy are local while population caps remain global',()=>{
 const f=fixture({upper:true});for(const a of [f.a,f.b]){a.husbandry.trust=100;a.lifecycle.enabled=true;}
 assert.equal(breedingStatus(f.s,f.a).reason,'no_compatible_mate');const mate=addAnimal(f,f.sites[0],2);Object.assign(mate,{x:8,y:7});mate.husbandry.trust=100;mate.lifecycle.enabled=true;f.s.tick=1;updateBreeding(f.s);assert.ok(f.a.lifecycle.brood);assert.equal(f.b.lifecycle.brood,null);assert.equal(f.a.fed,70);assert.equal(mate.fed,90);
 const cells=horizontalNeighbors(positionOf(f.a)),free=cells.find(p=>!sameCell(p,mate)&&!tileAt(f.sites[0],p).building);assert.ok(free);f.a.lifecycle.brood.progress=BREEDING.gestation;f.s.tick=BREEDING.gestation+1;
 f.s.jobs=cells.filter(p=>!sameCell(p,free)).map((p,i)=>({id:`local-block-${i}`,site:f.a.site,materials:{},sources:[],...p}));f.s.jobs.push({id:'foreign-block',site:f.b.site,materials:{},sources:[],...free},{id:'upper-block',site:f.a.site,materials:{},sources:[],...free,z:1});Object.assign(f.d,free);
 const before=structuredClone(f.s);startRecording(f.s);updateBreeding(f.s);updateBreeding(before);assert.deepEqual(f.s,before);const child=f.s.creatures.find(a=>a.lifecycle?.born!==null);assert.ok(child);assert.equal(child.site,f.a.site);assert.deepEqual(positionOf(child),free);assert.equal(child.fed,40);assert.deepEqual(child.lifecycle.parents,[f.a.id,mate.id]);assert.ok(events(f.s).some(e=>e.id==='animal.born'&&e.target===tileEntityId(f.a.site,free.x,free.y,free.z)));validateBreeding(f.s);
 const malformed=structuredClone(f.s);malformed.creatures.find(a=>a.id===mate.id).site=f.b.site;assert.throws(()=>validateBreeding(malformed),/parentage/);
 const capped=fixture();for(const a of capped.s.creatures){a.husbandry.trust=100;a.lifecycle.enabled=true;}for(let i=0;i<22;i++)addAnimal(capped,capped.sites[1],10+i);assert.equal(breedingStatus(capped.s,capped.a).reason,'herd_limit');
});

test('same-coordinate local butchery claims preserve finite meat and actual body ownership',()=>{
 const f=fixture();registerAnimalDeath(f.s,f.a,'unknown');registerAnimalDeath(f.s,f.b,'unknown');
 assert.equal(butcheryEligibility(f.s,f.a,7,7,0,f.b.site).code,'wrong_site');startRecording(f.s);
 const r=butcherAnimal(f.s,f.a.id,7,7),other=butcherAnimal(f.s,f.b.id,7,7);assert.equal(r.ok,true,r.message);assert.equal(other.ok,true,other.message);validateCarcasses(f.s);check(f.s);
 until(f.s,()=>f.a.death.disposition==='butchered'&&f.b.death.disposition==='butchered');assert.equal(f.post.drop.food,4);assert.equal(f.otherPost.drop.food,4);assert.equal(f.post.drop.waste,.25);assert.equal(f.a.death.owner,null);assert.equal(f.b.death.owner,null);
 for(const a of [f.a,f.b])assert.ok(events(f.s).some(e=>e.id==='animal.butchered'&&e.entity===a.id&&e.target===tileEntityId(a.site,7,7,0)));check(f.s);
});

test('carried bodies retain actual floors on cancellation and reject foreign owners',()=>{
 const f=fixture({upper:true});f.a.z=f.c.z=1;registerAnimalDeath(f.s,f.a,'unknown');const r=butcherAnimal(f.s,f.a.id,7,7,1);assert.equal(r.ok,true,r.message);const j=r.job;j.worker=f.c.id;f.c.job=j.id;
 startRecording(f.s);const arrived=()=> 'arrived',release=()=>assert.fail('valid local body should stay owned');assert.equal(actCarcass(f.s,f.c,j,arrived,release),false);assert.equal(f.a.death.owner.kind,'crew');assert.equal(carcassPosition(f.s,f.a).z,1);validateCarcasses(f.s);
 assert.ok(events(f.s).some(e=>e.id==='carcass.picked_up'&&e.target===tileEntityId(f.a.site,7,7,1)));
 const bad=structuredClone(f.s);bad.crew[0].site=f.b.site;assert.throws(()=>validateCarcasses(bad),/carcass location/);assert.equal(completeCarcass(f.s,f.d,{...j,remaining:0}),false);
 f.c.z=0;releaseCarcass(f.s,j,f.c,'cancelled');f.s.jobs=[];f.c.job=null;assert.deepEqual(carcassPosition(f.s,f.a),{site:f.a.site,x:7,y:7,z:0});assert.equal(f.a.z,1);validateCarcasses(f.s);
 f.a.death.age=FOOD_LIFETIME;f.a.death.disposition='spoiled';const discard=executeAction(f.s,'husbandry.discard',{creature:f.a.id});assert.equal(discard.ok,true,discard.message);const job=f.s.jobs.find(j=>j.id===discard.job);assert.equal(job.z,0);assert.equal(job.site,f.a.site);until(f.s,()=>f.a.death.disposition==='discarded');assert.equal(f.post.drop.waste,.25);assert.equal(at(f.sites[0],7,7,1).drop,null);check(f.s);
});
