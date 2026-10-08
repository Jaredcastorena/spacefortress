import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, serialize, deserialize } from '../src/simulation.js';
import { add, extract, totalResources, syncResources } from '../src/inventory.js';
import { foodOfKind } from '../src/food-lots.js';
import { refreshPower } from '../src/power.js';
import { executeAction, actionCatalog, createAgentInterface } from '../src/controls.js';
import { observe, startRecording, exportRecording, systemFor } from '../src/telemetry.js';
const checked=s=>{syncResources(s);assert.equal(serialize(deserialize(serialize(s))),serialize(s));};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.kind==='event').map(r=>r.event);
const until=(s,p,limit)=>{for(let i=0;i<limit&&!p();i++){step(s);checked(s);}assert.ok(p(),`Bounded fixture did not finish by tick ${s.tick}`);};
// Explicit test fixture: one existing skilled worker beside a mature patch,
// other labors paused, and scrubber air physically transferred from the depot.
function fixture(species='fungalcap'){
  const s=createGame(813),site=s.sites.surface,t=at(site,10,15),c=s.crew[3],depot=at(site,8,10);
  s.creatures=[];t.terrain='ground';t.building=null;t.flora={[species]:{biomass:100,harvests:0,origin:'native',generation:'native'}};
  for(const tile of site.tiles)if(tile.machine&&tile.building!=='scrubber')tile.machine.enabled=false;
  for(const crew of s.crew)for(const labor of Object.keys(crew.labors))crew.labors[labor]=false;
  c.x=10;c.y=14;c.labors.production=true;c.hunger=100;c.energy=100;
  add(at(site,7,7).machine.input,extract(depot.stock,{air:10}));syncResources(s);refreshPower(s,site);
  return {s,site,t,c,depot,species};
}
const gather=f=>{const response=executeAction(f.s,'job.order',{site:'surface',x:f.t.x,y:f.t.y,kind:'gather',building:f.species},'test');return {...response,...(response.ok?{job:f.s.jobs.find(j=>j.id===response.job)}:{})};};
const cancel=(s,id)=>executeAction(s,'job.cancel',{job:id},'test');

test('shared gather action requires edible mature plants and one exclusive tile designation',()=>{
  const f=fixture(),{s,t}=f;
  assert.ok(actionCatalog().find(a=>a.id==='job.order').parameters.properties.kind.enum.includes('gather'));
  assert.equal(createAgentInterface(()=>s).definitions().flora.fungalcap.foodKind,'fungalcap');
  for(const species of [undefined,'lichen','sunberry','unknown']){const before=serialize(s);assert.equal(executeAction(s,'job.order',{site:'surface',x:t.x,y:t.y,kind:'gather',building:species},'test').ok,false);assert.equal(serialize(s),before);}
  t.flora.fungalcap.biomass=99;assert.equal(gather(f).ok,false);t.flora.fungalcap.biomass=100;
  const result=gather(f);assert.equal(result.ok,true);assert.equal(result.job.building,null);assert.equal(result.job.plantSpecies,'fungalcap');assert.equal(result.job.plantHarvests,0);assert.equal(result.job.plantGeneration,'native');assert.deepEqual(result.job.cost,{});assert.deepEqual(result.job.sources,[]);
  assert.equal(gather(f).ok,false);assert.equal(executeAction(s,'job.order',{site:'surface',x:t.x,y:t.y,kind:'build',building:'floor'},'test').ok,false);
  assert.equal(t.drop,null);assert.equal(t.flora.fungalcap.biomass,100);checked(s);
});

test('real Production work spills exactly two typed food, then ordinary hauling delivers it',()=>{
  const f=fixture(),{s,t,c,depot}=f,before=totalResources(s).food;startRecording(s);
  const result=gather(f);assert.equal(result.ok,true);step(s);assert.ok(result.job.remaining<result.job.work);assert.ok(result.job.remaining>0);assert.equal(t.drop,null);checked(s);
  until(s,()=>!s.jobs.some(j=>j.id===result.job.id),60);
  assert.equal(t.flora.fungalcap.biomass,20);assert.equal(t.flora.fungalcap.harvests,1);assert.equal(foodOfKind(t.drop,'fungalcap'),2);assert.equal(totalResources(s).food,before+2);assert.equal(foodOfKind(depot.stock,'fungalcap'),0);
  const harvest=events(s).find(e=>e.id==='flora.harvested');assert.equal(harvest.actor,c.id);assert.equal(harvest.job,result.job.id);assert.equal(harvest.entity,'flora:surface:10:15:fungalcap');assert.deepEqual(harvest.output,{food:2});assert.equal(harvest.biomassBefore,100);assert.equal(harvest.biomassAfter,20);
  assert.equal(executeAction(s,'crew.labor',{crew:c.id,labor:'hauling',enabled:true},'test').ok,true);
  until(s,()=>foodOfKind(depot.stock,'fungalcap')===2,80);assert.equal(totalResources(s).food,before+2);assert.equal(t.drop,null);
});

test('gather cancellation yields nothing and labor interruption preserves partial work for replacement',()=>{
  const f=fixture('sunberry'),{s,t,c}=f,before=totalResources(s).food;let result=gather(f);step(s);const partial=result.job.remaining;
  assert.ok(partial>0&&partial<result.job.work);assert.equal(cancel(s,result.job.id).ok,true);assert.equal(t.drop,null);assert.equal(t.flora.sunberry.biomass,100);assert.equal(totalResources(s).food,before);checked(s);
  result=gather(f);step(s);const remaining=result.job.remaining;
  assert.equal(executeAction(s,'crew.labor',{crew:c.id,labor:'production',enabled:false},'test').ok,true);assert.equal(c.job,null);assert.equal(result.job.worker,null);assert.equal(result.job.remaining,remaining);checked(s);
  const replacement=s.crew[6];replacement.x=10;replacement.y=14;assert.equal(executeAction(s,'crew.labor',{crew:replacement.id,labor:'production',enabled:true},'test').ok,true);
  until(s,()=>!s.jobs.some(j=>j.id===result.job.id),60);assert.equal(foodOfKind(t.drop,'sunberry'),2);assert.equal(totalResources(s).food,before+2);
});

test('a deceased gatherer leaves the plant and pending job for another real worker',()=>{
  const f=fixture(),{s,t,c}=f,result=gather(f);step(s);c.health=0;step(s);assert.equal(result.job.worker,null);assert.equal(t.drop,null);assert.equal(t.flora.fungalcap.biomass,100);checked(s);
  const replacement=s.crew[6];replacement.x=10;replacement.y=14;executeAction(s,'crew.labor',{crew:replacement.id,labor:'production',enabled:true},'test');
  until(s,()=>!s.jobs.some(j=>j.id===result.job.id),60);assert.equal(foodOfKind(t.drop,'fungalcap'),2);
});

test('changed harvest cycles and incompatible ground cancel before work or XP and reconcile before reload',()=>{
  for(const change of [t=>t.flora.fungalcap.harvests++,t=>delete t.flora.fungalcap,t=>t.building='husbandryPost']){
    const f=fixture(),{s,t,c}=f,result=gather(f),xp=c.skills.production.xp;startRecording(s);change(t);step(s);
    assert.equal(s.jobs.some(j=>j.id===result.job.id),false);assert.equal(c.skills.production.xp,xp);assert.equal(t.drop,null);assert.equal(events(s).some(e=>e.id==='flora.harvested'),false);checked(s);
    if(t.building==='husbandryPost')assert.equal(t.flora,undefined);
  }
});

function legacy(version){
  const s=createGame(814);s.version=version;for(const a of s.creatures)delete a.condition;
  for(const site of Object.values(s.sites)){delete site.cultivation;delete site.liquids.absorbed;}
  for(const site of Object.values(s.sites))for(const t of site.tiles){if(t.flora?.lichen)t.lichen=t.flora.lichen.biomass;delete t.flora;if(version===40&&t.machine){delete t.machine.recipeId;delete t.machine.batchRecipeId;}}
  at(s.sites.surface,8,10).lichen=12.5;at(s.sites.surface,6,16).lichen=0;return s;
}
function demote(s,version){const copy=structuredClone(s);copy.version=version;for(const site of Object.values(copy.sites)){delete site.cultivation;delete site.liquids.absorbed;}for(const a of copy.creatures)delete a.condition;for(const site of Object.values(copy.sites))for(const t of site.tiles){if(t.flora?.lichen)t.lichen=t.flora.lichen.biomass;delete t.flora;if(version===40&&t.machine){delete t.machine.recipeId;delete t.machine.batchRecipeId;}}return copy;}

test('schema40 and41 migration preserves covered and zero lichen, physical goods and RNG without edible gifts',()=>{
  for(const version of [40,41]){
    const old=legacy(version),text=serialize(old),loaded=deserialize(text);assert.equal(loaded.version,44);assert.deepEqual(demote(loaded,version),old);assert.equal(serialize(old),text);assert.deepEqual(totalResources(loaded),totalResources(old));assert.equal(loaded.rng,old.rng);
    assert.equal(at(loaded.sites.surface,8,10).flora.lichen.biomass,12.5);assert.equal(at(loaded.sites.surface,6,16).flora.lichen.biomass,0);
    assert.ok(Object.values(loaded.sites).flatMap(site=>site.tiles).every(t=>!t.flora||Object.keys(t.flora).every(id=>id==='lichen')));checked(loaded);
  }
});

test('schema44 rejects malformed flora and forged gathering reservations',()=>{
  const f=fixture(),{s,t}=f;assert.equal(gather(f).ok,true);checked(s);
  const mutations=[state=>at(state.sites.surface,t.x,t.y).flora.fungalcap.biomass=101,state=>at(state.sites.surface,t.x,t.y).flora.fungalcap.harvests=-1,state=>at(state.sites.surface,t.x,t.y).flora.sunberry={biomass:100,harvests:0,origin:'native',generation:'native'},state=>at(state.sites.surface,t.x,t.y).lichen=1,state=>state.jobs[0].plantHarvests++,state=>state.jobs[0].work++,state=>state.jobs[0].building='fungalcap',state=>delete state.jobs[0].plantSpecies,state=>state.jobs.push({...state.jobs[0],id:`job-${state.nextId++}`})];
  for(const mutate of mutations){const bad=structuredClone(s);mutate(bad);assert.throws(()=>deserialize(serialize(bad)));}
});

test('flora observations and recording stay deterministic across partial-work reload',()=>{
  const f=fixture(),{s,t}=f;gather(f);step(s);checked(s);const clone=deserialize(serialize(s));startRecording(s);step(s,14);step(clone,14);assert.equal(serialize(s),serialize(clone));
  const state=observe(s),flora=state.entities[`tile:surface:${t.x}:${t.y}`].derived.flora.find(row=>row.species==='fungalcap');assert.equal(flora.foodKind,'fungalcap');assert.equal(flora.stage,'sparse');assert.equal(flora.harvestable,false);assert.equal(systemFor('tile',['flora','fungalcap','biomass']),'flora');assert.ok(events(s).some(e=>e.id==='flora.harvested'));checked(s);
});

test('bristleback nutrition scales with the actual canonical lichen bite',()=>{
  const s=createGame(815),a=s.creatures[0],t=at(s.sites.surface,a.x,a.y);s.creatures=[a];a.fed=50;t.flora={lichen:{biomass:2,harvests:0,origin:'native',generation:'native'}};
  step(s,9);assert.equal(t.flora.lichen.biomass,0);assert.ok(Math.abs(a.fed-(50-9*.015+4*2/5))<1e-8);checked(s);
});
