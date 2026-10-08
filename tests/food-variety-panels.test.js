import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, at, pathTo } from '../src/simulation.js';
import { initializeStorage, add } from '../src/inventory.js';
import { typedFood } from '../src/food-lots.js';
import { controlBindings } from '../src/controls.js';
import { storageDetails } from '../src/industry-panels.js';
import { foodDetails } from '../src/food-panels.js';
import { crewDetails } from '../src/crew-panels.js';
import { animalDetails, postDetails, pastureDetails } from '../src/husbandry-panels.js';

function workstation(building='galley') {
  const s=createGame(),site=s.sites.surface,t=at(site,12,10);
  t.building=building;t.hp=100;initializeStorage(t);
  return {s,site,t,m:t.machine};
}
const render=f=>storageDetails(f.t,f.s,'surface');
const recipeOptions=html=>html.match(/<select name="production-recipe"[^>]*>([\s\S]*?)<\/select>/)[1];

test('farm inspector offers exactly the three selectable crops with requirements and shared action label',()=>{
  const f=workstation('farm'),html=render(f),options=recipeOptions(html);
  assert.equal((options.match(/<option /g)||[]).length,3);
  for(const id of ['fungalcap','siltgrain','sunberry'])assert.ok(options.includes(`value="${id}"`));
  assert.ok(!options.includes('legacy_crop'));
  assert.match(html,/aria-label="Crop"/);assert.match(html,/data-simulation-action="production.recipe"/);
  assert.match(html,/Sunberry · tier 2 · Production 3/);
  assert.match(html,/Needs 1 · 0 delivered/);
  assert.match(html,/aria-label="Recipe requirements"/);
});

test('galley inspector names missing physical ingredients and minimum operator skill',()=>{
  const f=workstation();f.m.recipeId='curd_bake';
  add(f.m.input,typedFood('siltgrain',1));add(f.m.input,typedFood('curd',.25));
  for(const site of Object.values(f.s.sites))for(const t of site.tiles)if(t.stock)t.stock={};
  for(const c of f.s.crew)c.skills.production.level=0;
  const html=render(f);
  assert.equal((recipeOptions(html).match(/<option /g)||[]).length,8);
  assert.match(html,/requires Production 3/);
  assert.match(html,/<dt>Bristleback curd<\/dt><dd>Needs 1 · 0.25 delivered · 0 available · 0.75 missing/);
  assert.match(html,/data-production-reason="[^\"]+"/);
  assert.match(html,/Production 3/);
});

test('pending recipe display preserves the pinned current batch and progress without mutation',()=>{
  const f=workstation();f.m.recipeId='curd_bake';f.m.batchRecipeId='basic_ration';
  f.m.batch={food:2,water:.25};f.m.progress=7;
  const before=JSON.stringify(f.m),html=render(f);
  assert.match(html,/<dt>Current batch<\/dt><dd>Basic ration/);
  assert.match(html,/<dt>Next batch<\/dt><dd>Curd bake/);
  assert.match(html,/<dt>Progress<\/dt><dd>7.0 \/ 24 work/);
  assert.match(html,/aria-label="Next batch requirements"/);
  assert.equal(JSON.stringify(f.m),before);
  f.m.recipeId='basic_ration';
  assert.match(render(f),/aria-label="Current batch requirements"/);
});

test('collapsed food details show raw kinds, recipe provenance, per-lot freshness and legacy meals',()=>{
  const inventory=typedFood('sunberry',1,1000);
  add(inventory,{food:2,_food:[{amount:2,age:2000,meal:{id:'meal-<safe>',maker:'crew-<safe>',quality:3,created:0,recipeId:'berry_curd',ingredients:{sunberry:1,curd:1}}}]});
  add(inventory,{food:1,_food:[{amount:1,age:3000,meal:{id:'legacy',maker:'crew-1',quality:1,created:0}}]});
  const html=foodDetails(inventory);
  assert.match(html,/<details data-food-list data-panel-key="food-Food">/);
  assert.match(html,/1 Sunberry/);assert.match(html,/Berry curd · quality 3\/4/);
  assert.match(html,/Batch ingredients: 1 Sunberry \+ 1 Bristleback curd/);
  assert.match(html,/Prepared meal · quality 1\/4/);assert.match(html,/freshness/);
  assert.ok(!html.includes('<safe>'));assert.match(html,/meal-&lt;safe&gt;/);
});

test('crew inspector uses current and next cooking quality plus actual upcoming recipes',()=>{
  const s=createGame(),c=s.crew[0];c.skills.production.level=2;
  let html=crewDetails(c,'Surface',s.crew);
  assert.match(html,/Cooking quality 1\/4 · Next quality tier: Production 3/);
  assert.match(html,/Sunberry · Curd bake · Berry curd · Glaze omelet/);
  c.skills.production.level=9;html=crewDetails(c,'Surface',s.crew);
  assert.match(html,/Cooking quality 4\/4 · Highest quality tier/);
  assert.ok(!html.includes('Next crops and recipes'));
});

test('species panels expose glazefoot feed, eggs and juvenile limits alongside bristlebacks',()=>{
  const s=createGame(),a=s.creatures.find(a=>a.species==='glazefoot');assert.ok(a);
  a.lifecycle.growth=0;
  const html=animalDetails(s,a,pathTo);
  assert.match(html,/GLAZEFOOT HUSBANDRY/);assert.match(html,/Glaze eggs/);
  assert.match(html,/Care feed<\/dt><dd>1 Fungalcap per visit/);
  assert.match(html,/Growing; production begins in adulthood/);
  assert.match(html,/Lichen cannot feed this species/);assert.ok(!html.includes('Available lichen'));
  const post=at(s.sites.surface,12,10);post.building='husbandryPost';post.hp=100;
  const choices=postDetails(s,post,pathTo);assert.match(choices,/Assign Glazefoot/);assert.match(choices,/Assign Bristleback/);
  assert.match(pastureDetails(s,{building:'pastureGate',hp:100,gateMode:'latched'}),/crew can pass; livestock cannot/);
});

test('actual inspector submission dispatches one shared recipe action and retains the production order',()=>{
  const f=workstation(),inspector={},app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf("$('inspector').onsubmit ="),app.indexOf("$('inspector').onclick ="));
  const bindings=controlBindings(()=>f.s),order=JSON.stringify(f.m.order),results=[];
  let calls=0,prevented=0,blurred=0;
  vm.runInNewContext(source,{$:()=>inspector,state:f.s,siteId:'surface',selected:{x:f.t.x,y:f.t.y},document:{activeElement:{blur:()=>blurred++}},setProductionRecipe:(...args)=>{calls++;return bindings.setProductionRecipe(...args);},result:r=>results.push(r)});
  const form={elements:{'production-recipe':{value:'curd_bake'}}};
  inspector.onsubmit({target:{closest:selector=>selector==='[data-recipe-form]'?form:null},preventDefault:()=>prevented++});
  assert.equal(calls,1);assert.equal(prevented,1);assert.equal(blurred,1);assert.equal(results[0].ok,true);
  assert.equal(f.m.recipeId,'curd_bake');assert.equal(JSON.stringify(f.m.order),order);
  assert.match(app,/activeElement\.closest\?\.\('\[data-recipe-form\]/);
  assert.match(app,/hasAttribute\('data-recipe-form'\)\?'production.recipe'/);
  assert.match(app,/openPanels\.get\(details\.dataset\.panelKey\)/);
});
