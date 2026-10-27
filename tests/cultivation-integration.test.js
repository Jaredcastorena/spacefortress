import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import { projectPreDecks } from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, serialize, deserialize } from '../src/simulation.js';
import { add, extract, totalResources, syncResources } from '../src/inventory.js';
import { typedFood, foodOfKind, foodLots, FOOD_LIFETIME } from '../src/food-lots.js';
import { absorbCultivationWater } from '../src/flora.js';
import { CULTIVATION } from '../src/flora-data.js';
import { refreshPower } from '../src/power.js';
import { executeAction, actionCatalog, createAgentInterface } from '../src/controls.js';
import { observe, startRecording, exportRecording, systemFor } from '../src/telemetry.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const checked=s=>{syncResources(s);assert.equal(serialize(deserialize(serialize(s))),serialize(s));};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(row=>row.kind==='event').map(row=>row.event);
const until=(s,p,limit=80)=>{for(let i=0;i<limit&&!p();i++){step(s);checked(s);}assert.ok(p(),`Bounded job fixture did not finish by tick ${s.tick}`);};
const native=biomass=>({biomass,harvests:0,origin:'native',generation:'native'});
// Supplied integration fixture: one worker, a ground bed and one propagule.
// Air is transferred from stock into the existing scrubber; other work is paused.
function fixture({food=true,age=120,species='fungalcap'}={}){
  const s=createGame(821),site=s.sites.surface,t=at(site,10,15),c=s.crew[3],depot=at(site,8,10);
  s.creatures=[];t.terrain='ground';t.building=null;t.flora={lichen:native(10)};
  for(const tile of site.tiles)if(tile.machine&&tile.building!=='scrubber')tile.machine.enabled=false;
  for(const crew of s.crew)for(const labor of Object.keys(crew.labors))crew.labors[labor]=false;
  c.x=10;c.y=14;c.labors.production=true;c.hunger=100;c.energy=100;
  add(at(site,7,7).machine.input,extract(depot.stock,{air:10}));
  if(food)add(depot.stock,typedFood(species,1,age));syncResources(s);refreshPower(s,site);
  return {s,site,t,c,depot,species};
}
function order(f,kind='plant',species=f.species){
  const result=executeAction(f.s,'job.order',{site:'surface',x:f.t.x,y:f.t.y,kind,building:species},'test');
  return {...result,...(result.ok?{job:f.s.jobs.find(j=>j.id===result.job)}:{})};
}
const cancel=(f,j)=>executeAction(f.s,'job.cancel',{job:j.id},'test');
function planted(f){const result=order(f);assert.ok(result.ok);until(f.s,()=>!f.s.jobs.includes(result.job));return result.job;}

test('shared cultivation catalog rejects absent, wrong and prepared propagation food without mutation',()=>{
  const definition=actionCatalog().find(a=>a.id==='job.order');
  for(const kind of ['plant','waterPlant'])assert.ok(definition.parameters.properties.kind.enum.includes(kind));
  const f=fixture({food:false});assert.deepEqual(createAgentInterface(()=>f.s).definitions().cultivation,CULTIVATION);
  for(const species of [undefined,'lichen','siltgrain','unknown']){const before=serialize(f.s);assert.equal(order(f,'plant',species).ok,false);assert.equal(serialize(f.s),before);}
  assert.equal(order(f).ok,false);
  add(f.depot.stock,typedFood('sunberry',1));syncResources(f.s);const wrong=serialize(f.s);assert.equal(order(f).ok,false);assert.equal(serialize(f.s),wrong);
  add(f.depot.stock,{food:1,_food:[{amount:1,age:0,meal:{id:`meal-job-${f.s.nextId++}`,maker:f.c.id,quality:1,created:0}}]});syncResources(f.s);
  const prepared=serialize(f.s);assert.equal(order(f).ok,false);assert.equal(serialize(f.s),prepared);checked(f.s);
});

test('planting physically reserves, carries, stages and works before creating one generation',()=>{
  const f=fixture(),{s,t,c,depot}=f,before=totalResources(s),xp=c.skills.production.xp;startRecording(s);
  const {job,ok}=order(f);assert.ok(ok);assert.deepEqual(job.cost,{food:1});assert.deepEqual(job.foodKinds,{fungalcap:1});assert.equal(job.building,null);assert.equal(job.plantSpecies,'fungalcap');assert.equal(job.plantGeneration,undefined);
  assert.equal(foodOfKind(depot.stock,'fungalcap'),0);assert.equal(job.sources.reduce((n,source)=>n+foodOfKind(source.items,'fungalcap'),0),1);assert.equal(t.flora.fungalcap,undefined);assert.equal(totalResources(s).food,before.food);checked(s);
  until(s,()=>c.delivery?.job===job.id&&c.carry?.food===1);assert.equal(job.remaining,job.work);assert.equal(t.flora.fungalcap,undefined);checked(s);
  until(s,()=>job.materials.food===1);assert.equal(job.remaining,job.work);assert.equal(c.carry,null);assert.ok(foodLots(job.materials)[0].age>=120);checked(s);
  until(s,()=>job.remaining<job.work);assert.ok(job.remaining>0);assert.equal(t.flora.fungalcap,undefined);checked(s);
  until(s,()=>!s.jobs.includes(job));assert.deepEqual(t.flora.fungalcap,{biomass:20,harvests:0,origin:'cultivated',generation:job.id,moisture:0});assert.equal(t.flora.lichen.origin,'native');
  assert.equal(totalResources(s).food,before.food-1);assert.equal(totalResources(s).water,before.water);close(c.skills.production.xp-xp,10);assert.equal(s.sites.surface.cultivation.fungalcap.propagules,1);
  const event=events(s).find(e=>e.id==='flora.planted');assert.equal(event.job,job.id);assert.equal(event.actor,c.id);assert.equal(event.generation,job.id);assert.equal(event.propaguleFood,1);assert.deepEqual(event.from,{entity:job.id,slot:'materials'});checked(s);
});

test('cancelling each planting phase preserves the aged propagule and every physical resource',()=>{
  for(const phase of ['reserved','carried','staged','partial']){
    const f=fixture(),{s,t,c}=f,{job}=order(f);
    if(phase==='carried')until(s,()=>c.delivery?.job===job.id&&c.carry?.food===1);
    if(phase==='staged')until(s,()=>job.materials.food===1);
    if(phase==='partial')until(s,()=>job.remaining<job.work);
    const beforeCancel=totalResources(s);assert.ok(cancel(f,job).ok);assert.equal(t.flora.fungalcap,undefined);assert.deepEqual(totalResources(s),beforeCancel);
    const located=[f.depot.stock,t.drop,c.carry].filter(Boolean);assert.equal(located.reduce((n,inv)=>n+foodOfKind(inv,'fungalcap'),0),1);assert.ok(located.flatMap(foodLots).find(l=>l.kind==='fungalcap').age>=120);checked(s);
  }
});

test('exclusive tile ownership and labor interruption retain paid planting work',()=>{
  const f=fixture(),{s,c}=f,{job}=order(f);assert.equal(order(f).ok,false);assert.equal(order(f,'waterPlant').ok,false);
  assert.equal(executeAction(s,'job.order',{site:'surface',x:f.t.x,y:f.t.y,kind:'build',building:'floor'},'test').ok,false);
  until(s,()=>job.remaining<job.work);const remaining=job.remaining;
  assert.ok(executeAction(s,'crew.labor',{crew:c.id,labor:'production',enabled:false},'test').ok);assert.equal(job.remaining,remaining);assert.equal(job.worker,null);checked(s);
  assert.ok(executeAction(s,'crew.labor',{crew:c.id,labor:'production',enabled:true},'test').ok);until(s,()=>!s.jobs.includes(job));assert.equal(f.t.flora.fungalcap.generation,job.id);close(c.skills.production.xp,10);
});

test('permanent target changes cancel planting before another work credit and refund located materials',()=>{
  const f=fixture(),{s,t,c}=f,before=totalResources(s),{job}=order(f);until(s,()=>job.materials.food===1);const xp=c.skills.production.xp;t.building='husbandryPost';step(s);
  assert.equal(s.jobs.includes(job),false);assert.equal(c.skills.production.xp,xp);assert.equal(t.flora?.fungalcap,undefined);for(const [resource,n] of Object.entries(before))if(resource!=='air')close(totalResources(s)[resource],n);assert.equal(foodOfKind(t.drop,'fungalcap'),1);checked(s);
});

test('watering moves one real dose into held moisture and earns finite Production experience',()=>{
  const f=fixture(),{s,t,c}=f;const planting=planted(f),before=totalResources(s),xp=c.skills.production.xp;startRecording(s);
  const {job,ok}=order(f,'waterPlant');assert.ok(ok);assert.deepEqual(job.cost,{water:.5});assert.equal(job.plantGeneration,planting.id);assert.equal(t.flora.fungalcap.moisture,0);checked(s);
  until(s,()=>c.delivery?.job===job.id&&c.carry?.water===.5);assert.equal(t.flora.fungalcap.moisture,0);assert.equal(job.remaining,6);checked(s);
  until(s,()=>job.materials.water===.5);assert.equal(t.flora.fungalcap.moisture,0);checked(s);
  until(s,()=>job.remaining<job.work);assert.ok(job.remaining>0);until(s,()=>!s.jobs.includes(job));close(totalResources(s).water,before.water);close(c.skills.production.xp-xp,6);
  const event=events(s).find(e=>e.id==='flora.watered');assert.equal(event.generation,planting.id);assert.equal(event.paidWater,.5);assert.equal(event.amount,.5);assert.equal(event.actor,c.id);close(s.sites.surface.cultivation.fungalcap.delivered,.5);checked(s);
});

test('in-flight saturation keeps its order and returns the entire unused paid dose physically',()=>{
  const f=fixture(),{s,site,t,depot}=f;planted(f);const {job}=order(f,'waterPlant');until(s,()=>job.materials.water===.5);
  // Transfer actual stock water into a supplied puddle, then call the shared
  // absorption API. Its transfer debits the puddle and credits both ledgers.
  assert.equal(extract(depot.stock,{water:1.5}).water,1.5);t.liquid+=1.5;site.liquids.released+=1.5;assert.equal(absorbCultivationWater(s,site,t,1.5),1.5);const before=totalResources(s).water;checked(s);
  assert.equal(order(f,'waterPlant').ok,false);until(s,()=>!s.jobs.includes(job));close(totalResources(s).water,before);close(t.drop.water,.5);close(site.cultivation.fungalcap.delivered,.5);close(site.cultivation.fungalcap.returned,.5);checked(s);
});

test('replacement bed generations invalidate water orders before work and preserve the paid dose',()=>{
  const f=fixture(),{s,t,c}=f;planted(f);const before=totalResources(s).water,{job}=order(f,'waterPlant'),xp=c.skills.production.xp;t.flora.fungalcap.generation='job-999';step(s);
  assert.equal(s.jobs.includes(job),false);assert.equal(c.skills.production.xp,xp);close(totalResources(s).water,before);checked(s);
});

test('spoiled propagation food becomes waste and exact replacement must arrive before planting',()=>{
  const f=fixture({age:FOOD_LIFETIME-.1}),{s,t,depot}=f;add(depot.stock,typedFood('fungalcap',1));syncResources(s);const before=totalResources(s),{job}=order(f);step(s);
  assert.equal(job.foodSpoiled,1);assert.equal(t.flora.fungalcap,undefined);assert.equal(job.remaining,job.work);close(totalResources(s).food,before.food-1);close(totalResources(s).waste,before.waste+1);checked(s);
  until(s,()=>!s.jobs.includes(job));assert.equal(t.flora.fungalcap.origin,'cultivated');close(totalResources(s).food,before.food-2);assert.equal(siteLedger(f).propagules,1);checked(s);
});
const siteLedger=f=>f.site.cultivation[f.species];

function legacy(s,version){
  const old=projectPreDecks(s);old.version=version;
  for(const a of old.creatures){delete a.death;delete a.genetics;if(a.lifecycle?.brood)delete a.lifecycle.brood.inheritance;}
  for(const site of Object.values(old.sites)){
    delete site.cultivation;delete site.liquids.absorbed;
    for(const tile of site.tiles){
      if(version<=41){if(tile.flora?.lichen)tile.lichen=tile.flora.lichen.biomass;delete tile.flora;}
      else for(const patch of Object.values(tile.flora||{})){delete patch.origin;delete patch.generation;}
      if(version===40&&tile.machine){delete tile.machine.recipeId;delete tile.machine.batchRecipeId;}
    }
  }
  if(version<=42)for(const a of old.creatures)delete a.condition;
  for(const j of old.jobs)delete j.plantGeneration;
  return old;
}
test('schema40–43 migration adds only neutral cultivation state and preserves physical bytes after demotion',()=>{
  for(const version of [40,41,42,43]){
    const old=legacy(createGame(822),version),text=serialize(old),before=totalResources(old),loaded=deserialize(text);assert.equal(loaded.version,CURRENT_SAVE_VERSION);assert.equal(serialize(old),text);assert.deepEqual(legacy(loaded,version),old);assert.deepEqual(totalResources(loaded),before);checked(loaded);
  }
  const s=createGame(823),site=s.sites.surface,t=site.tiles.find(tile=>tile.flora?.fungalcap?.biomass===100);for(const crew of s.crew)for(const labor of Object.keys(crew.labors))crew.labors[labor]=false;
  assert.ok(executeAction(s,'job.order',{site:'surface',x:t.x,y:t.y,kind:'gather',building:'fungalcap'},'test').ok);const old=legacy(s,43),loaded=deserialize(serialize(old));assert.equal(loaded.jobs[0].plantGeneration,'native');assert.deepEqual(legacy(loaded,43),old);checked(loaded);
});

test('strict loading rejects malformed legacy patches and forged typed cultivation reservations',()=>{
  const f=fixture(),{s}=f;order(f);checked(s);
  const mutations=[state=>state.jobs[0].work++,state=>state.jobs[0].cost.food=2,state=>state.jobs[0].foodKinds={sunberry:1},state=>state.jobs[0].sources[0].items._food[0].kind='sunberry',state=>state.jobs[0].plantGeneration='native',state=>state.jobs[0].plantHarvests=0,state=>state.jobs[0].building='fungalcap',state=>state.jobs[0].plantSpecies='lichen',state=>state.jobs.push({...state.jobs[0],id:`job-${state.nextId++}`})];
  for(const mutate of mutations){const bad=structuredClone(s);mutate(bad);assert.throws(()=>deserialize(serialize(bad)));}
  const old=legacy(createGame(824),43),patch=Object.values(old.sites.surface.tiles.find(t=>t.flora)?.flora)[0];patch.origin='native';assert.throws(()=>deserialize(serialize(old)));
  assert.throws(()=>deserialize(serialize(legacy(s,43))),/Legacy cultivation order/);
});

test('cultivation observations and semantic recording preserve deterministic continuation after partial work',()=>{
  const f=fixture(),{s,t}=f,{job}=order(f);until(s,()=>job.remaining<job.work);const copy=deserialize(serialize(s));startRecording(s);step(s,12);step(copy,12);assert.equal(serialize(s),serialize(copy));
  const tile=observe(s).entities[`tile:surface:${t.x}:${t.y}`],flora=tile.derived.flora.find(p=>p.species==='fungalcap');assert.equal(flora.origin,'cultivated');assert.equal(flora.generation,job.id);assert.equal(flora.moisture,0);assert.equal(tile.derived.cultivation.fungalcap.planting.ok,false);assert.equal(tile.derived.cultivation.fungalcap.watering.ok,true);assert.equal(systemFor('site',['cultivation','fungalcap','delivered']),'flora');assert.ok(events(s).some(e=>e.id==='flora.planted'));checked(s);
});
