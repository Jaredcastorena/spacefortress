import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, serialize, deserialize, setLabor, cancelJob } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { setMachineEnabled } from '../src/industry.js';
import { add, syncResources, totalResources } from '../src/inventory.js';
import { typedFood, foodOfKind, foodLots } from '../src/food-lots.js';
import { isLivestock, livestockDef } from '../src/livestock-data.js';
import { animalTraits } from '../src/animal-traits.js';
import { completeAnimalJob } from '../src/husbandry.js';
import { breedingStatus, adult, newLifecycle } from '../src/breeding.js';
import { animalPath } from '../src/navigation.js';
import { animalPasture } from '../src/pastures.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';

// Fixtures provision finite fungal caps and build a pen directly; all animal work
// below uses the same controls, supplied jobs and ticks as the player.
const check=s=>{syncResources(s);const copy=deserialize(serialize(s));assert.deepEqual(copy,s);return copy;};
const until=(s,p,max=240)=>{for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),`Condition missing at ${s.tick}`);};
function colony(){
  const s=createGame(),site=s.sites.surface,a=s.creatures.find(a=>a.species==='glazefoot'),depot=at(site,8,10);
  for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
  for(const c of s.crew)setLabor(s,c.id,'hauling',false);
  return {s,site,a,depot};
}
function pen(){
  const f=colony(),{s,site}=f,[a,b]=s.creatures.filter(a=>a.species==='glazefoot');
  for(const [i,animal] of s.creatures.filter(a=>a.species==='bristleback').entries()){animal.x=12+i;animal.y=20;}
  for(let y=15;y<=23;y++)for(let x=3;x<=9;x++){const t=at(site,x,y);t.terrain='ground';t.building=x===3||x===9||y===15||y===23?'fence':null;t.hp=100;t.flora={lichen:{biomass:80,harvests:0,origin:'native',generation:'native'}};}
  const gate=at(site,6,15);gate.building='pastureGate';gate.gateMode='latched';
  a.x=6;a.y=18;b.x=7;b.y=18;
  for(const animal of [a,b]){animal.fed=100;animal.husbandry.trust=100;animal.lifecycle.enabled=true;}
  return {...f,a,b,gate};
}
const care=(s,a)=>s.jobs.find(j=>j.kind==='animalCare'&&j.animal===a.id);
const childOf=(s,a)=>s.creatures.find(c=>c.lifecycle?.parents.includes(a.id));

test('new colonies contain two wild glazefoot adults with distinct registered feed and products',()=>{
  const s=createGame(),animals=s.creatures.filter(a=>a.species==='glazefoot');
  assert.equal(animals.length,2);assert.equal(s.creatures.filter(a=>a.species==='bristleback').length,3);
  for(const a of animals){assert.ok(isLivestock(a)&&adult(a));assert.equal(a.husbandry.trust,0);assert.equal(a.lifecycle.enabled,false);assert.deepEqual(livestockDef(a).feedKinds,{fungalcap:1});assert.equal(livestockDef(a).productKind,'glazeegg');}
  assert.equal(isLivestock('tibble'),false);assert.equal(livestockDef('bristleback').productKind,'curd');check(s);
});

test('glazefoot care requires delivered fungal caps and harvest creates typed eggs that haul intact',()=>{
  const {s,site,a,depot}=colony(),post=at(site,10,15);post.building='husbandryPost';
  const husbandryXp=s.crew.reduce((n,c)=>n+c.skills.husbandry.xp,0);
  assert.ok(executeAction(s,'husbandry.assign',{creature:a.id,x:10,y:15}).ok);
  const initial=totalResources(s).food;step(s,20);assert.equal(care(s,a),undefined);assert.equal(a.husbandry.trust,0);assert.equal(totalResources(s).food,initial);
  add(depot.stock,typedFood('fungalcap',3));syncResources(s);startRecording(s);
  until(s,()=>care(s,a)?.materials.food===1);assert.equal(foodOfKind(care(s,a).materials,'fungalcap'),1);
  const copy=check(s);step(s,5);step(copy,5);assert.deepEqual(s,copy);
  until(s,()=>a.husbandry.trust===100);assert.equal(totalResources(s).food,initial);assert.equal(totalResources(s).waste,.375);
  until(s,()=>s.jobs.some(j=>j.kind==='animalHarvest'&&j.animal===a.id),Math.ceil(100/animalTraits(a).productRate)+50);
  until(s,()=>foodOfKind(post.drop,'glazeegg')===2);assert.equal(totalResources(s).food,initial+2);
  const eggs=foodLots(post.drop).filter(l=>l.kind==='glazeegg');assert.equal(eggs.length,1);assert.equal(eggs[0].amount,2);check(s);
  assert.ok(Math.abs(s.crew.reduce((n,c)=>n+c.skills.husbandry.xp,0)-husbandryXp-(3*livestockDef(a).careWork+livestockDef(a).harvestWork))<1e-9);
  for(const c of s.crew)setLabor(s,c.id,'hauling',true);until(s,()=>site.tiles.reduce((n,t)=>n+foodOfKind(t.stock,'glazeegg'),0)===2);
  assert.equal(site.tiles.reduce((n,t)=>n+foodOfKind(t.stock,'glazeegg'),0),2);
  const events=exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
  assert.ok(events.some(e=>e.id==='animal.harvested'&&e.productKind==='glazeegg'&&e.foodKinds.glazeegg===2));
});

test('wrong and prepared feed cannot complete care or mutate the animal',()=>{
  const {s,site,a}=colony(),post=at(site,10,15);post.building='husbandryPost';a.husbandry.post=[10,15];
  const job={id:'job-999',kind:'animalCare',animal:a.id,x:10,y:15,foodKinds:{fungalcap:1}},before=structuredClone(a);
  for(const materials of [{food:1},typedFood('curd',1),{food:1,_food:[{amount:1,age:1,meal:{id:'meal-job-1',maker:'crew-3',quality:1,created:0}}]}]){
    assert.equal(completeAnimalJob(s,s.crew[3],{...job,materials}),false);assert.deepEqual(a,before);assert.equal(post.drop,null);
  }
});

test('glazefoots consume neither lichen nor stored rations during their ecology updates',()=>{
  const {s,a,depot}=colony();s.creatures=[a];a.x=8;a.y=10;a.husbandry.care=false;a.husbandry.harvest=false;
  const lichen=s.sites.surface.tiles.reduce((n,t)=>n+(t.flora?.lichen?.biomass||0),0),food=depot.stock.food,nutrition=a.fed;
  step(s,30);assert.equal(s.sites.surface.tiles.reduce((n,t)=>n+(t.flora?.lichen?.biomass||0),0),lichen);assert.equal(depot.stock.food,food);assert.ok(a.fed<nutrition);check(s);
});

test('glazefoot broods, hungry juveniles and same-species ancestry survive deterministic reload',()=>{
  const {s,a,b}=pen();step(s);assert.equal(a.lifecycle.brood.mate,b.id);a.lifecycle.enabled=b.lifecycle.enabled=false;
  step(s,120);const copy=check(s);step(s,180);step(copy,180);assert.deepEqual(s,copy);
  const child=childOf(s,a);assert.ok(child);assert.equal(child.species,'glazefoot');assert.deepEqual(child.lifecycle.parents,[a.id,b.id]);assert.match(child.id,/^glazefoot-\d+$/);
  child.husbandry.trust=100;step(s,10);assert.equal(child.lifecycle.growth,0);assert.equal(child.husbandry.product,0);
  child.fed=100;step(s,600);assert.ok(adult(child));step(s);assert.ok(child.husbandry.product>0);check(s);
  const forged=structuredClone(s),young=forged.creatures.find(c=>c.id===child.id);young.lifecycle.parents[0]=forged.creatures.find(c=>c.species==='bristleback').id;
  assert.throws(()=>deserialize(JSON.stringify(forged)),/parentage/);
});

test('different livestock species cannot pair and share enclosure capacity',()=>{
  const {s,a,b}=pen(),other=s.creatures.find(c=>c.species==='bristleback');
  b.lifecycle.enabled=false;other.x=7;other.y=18;other.fed=100;other.husbandry.trust=100;other.lifecycle.enabled=true;
  assert.equal(breedingStatus(s,a).reason,'no_compatible_mate');step(s);assert.equal(a.lifecycle.brood,null);assert.equal(other.lifecycle.brood,null);
  b.lifecycle.enabled=true;
  for(let i=0;i<3;i++)s.creatures.push({...structuredClone(other),id:`capacity-founder-${i}`,lifecycle:newLifecycle(),x:4+i,y:20});
  assert.equal(breedingStatus(s,a).reason,'pasture_crowded');check(s);
});

test('tame glazefoot transport physically crosses a latched gate and resumes after interruption',()=>{
  const {s,site,a,b,gate}=pen();a.lifecycle.enabled=b.lifecycle.enabled=false;a.x=10;a.y=18;
  a.husbandry.care=false;a.husbandry.harvest=false;const post=at(site,6,19);post.building='husbandryPost';
  assert.equal(animalPath(site,a,[[6,19]]),null);
  const request=executeAction(s,'husbandry.transport',{creature:a.id,x:6,y:19});assert.ok(request.ok,request.message);const j=s.jobs.find(j=>j.id===request.job);
  until(s,()=>j.phase==='escort');
  const copy=check(s);step(s,3);step(copy,3);assert.deepEqual(s,copy);
  const old=[a.x,a.y];setLabor(s,j.worker,'husbandry',false);assert.equal(j.phase,'collect');assert.deepEqual([a.x,a.y],old);
  until(s,()=>!s.jobs.includes(j));assert.deepEqual(a.husbandry.post,[6,19]);assert.equal(gate.gateMode,'latched');assert.ok(animalPasture(s,a).enclosed);assert.equal(observe(s).entities[a.id].derived.transport,null);check(s);
});

test('glazefoot care cancellation returns its exact staged fungal caps',()=>{
  const {s,site,a,depot}=colony(),post=at(site,10,15);post.building='husbandryPost';add(depot.stock,typedFood('fungalcap',1,120));syncResources(s);
  executeAction(s,'husbandry.assign',{creature:a.id,x:10,y:15});until(s,()=>care(s,a)?.materials.food===1);const j=care(s,a),before=totalResources(s).food;
  cancelJob(s,j.id);assert.equal(totalResources(s).food,before);assert.equal(foodOfKind(post.drop,'fungalcap'),1);assert.ok(foodLots(post.drop).find(l=>l.kind==='fungalcap').age>=120);assert.equal(a.husbandry.trust,0);check(s);
});
