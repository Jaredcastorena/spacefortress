import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import { projectPreDecks } from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize, order, setAnimalPost } from '../src/simulation.js';
import { initializeStorage, add, totalResources, syncResources } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
import { initializeReliability } from '../src/maintenance.js';
import { typedFood, foodOfKind } from '../src/food-lots.js';
import { CROPS, MEAL_RECIPES } from '../src/food-data.js';
import { actionCatalog, createAgentInterface, executeAction } from '../src/controls.js';
import { observe, startRecording, exportRecording } from '../src/telemetry.js';

// Explicit legacy schema construction: no historical/private colony is replayed.
function legacy40(waterOnly=false) {
  const s=projectPreDecks(createGame(701));s.version=40;s.creatures=s.creatures.filter(a=>a.species!=='glazefoot');
  const farm=at(s.sites.surface,7,9),galley=at(s.sites.surface,10,10);
  galley.building='galley';initializeStorage(galley);initializeReliability(s);refreshPower(s,s.sites.surface);
  farm.machine.batch=waterOnly?{water:1}:{water:1,fertilizer:.25};farm.machine.progress=11;
  if(waterOnly)farm.machine.legacyCrop=true;
  galley.machine.batch={food:2,water:.25,_food:[{amount:2,age:50}]};galley.machine.progress=7;
  const meal={id:'meal-job-1',maker:'crew-0',quality:2,created:0};s.nextId=2;
  galley.machine.output={food:.5,_food:[{amount:.5,age:50,meal}]};
  const medical=s.crew[1].medical;medical.servings=3;medical.foodAge=50;medical.openedFood={food:3/8,_food:[{amount:3/8,age:50,meal:{...meal}}]};medical.qualityTotal=2;
  for(const site of Object.values(s.sites))for(const tile of site.tiles)if(tile.machine){delete tile.machine.recipeId;delete tile.machine.batchRecipeId;}
  for(const site of Object.values(s.sites))for(const tile of site.tiles){if(tile.flora?.lichen)tile.lichen=tile.flora.lichen.biomass;delete tile.flora;}
  for(const a of s.creatures){delete a.condition;delete a.genetics;delete a.death;}
  for(const site of Object.values(s.sites)){delete site.cultivation;delete site.liquids.absorbed;}
  return s;
}
function withoutFoodSchema(s) {
  const copy=projectPreDecks(s);copy.version=40;
  for(const site of Object.values(copy.sites))for(const tile of site.tiles)if(tile.machine){delete tile.machine.recipeId;delete tile.machine.batchRecipeId;}
  for(const site of Object.values(copy.sites))for(const tile of site.tiles){if(tile.flora?.lichen)tile.lichen=tile.flora.lichen.biomass;delete tile.flora;}
  for(const a of copy.creatures){delete a.condition;delete a.genetics;delete a.death;}
  for(const site of Object.values(copy.sites)){delete site.cultivation;delete site.liquids.absorbed;}
  return copy;
}

test('schema40 hex migration changes only food schema defaults, retaining old batches, portions and animals',()=>{
  for(const waterOnly of [false,true]){
    const old=legacy40(waterOnly),text=serialize(old),before=totalResources(old),loaded=deserialize(text);
    assert.equal(loaded.version,CURRENT_SAVE_VERSION);assert.deepEqual(totalResources(loaded),before);
    assert.deepEqual(withoutFoodSchema(loaded),old);assert.equal(serialize(old),text);
    const farm=at(loaded.sites.surface,7,9),galley=at(loaded.sites.surface,10,10);
    assert.equal(farm.machine.recipeId,'fungalcap');assert.equal(farm.machine.batchRecipeId,'legacy_crop');
    assert.equal(galley.machine.recipeId,'basic_ration');assert.equal(galley.machine.batchRecipeId,'basic_ration');
    assert.equal(foodOfKind(galley.machine.batch,'ration'),2);assert.equal(loaded.creatures.some(a=>a.species==='glazefoot'),false);
    assert.equal(serialize(deserialize(serialize(loaded))),serialize(loaded));
  }
});

test('new colonies contain two deterministic adult glazefoots with no added food',()=>{
  const s=createGame(702),animals=s.creatures.filter(a=>a.species==='glazefoot');
  assert.equal(s.resources.food,24);assert.equal(animals.length,2);
  assert.deepEqual(animals.map(a=>[a.id,a.x,a.y]),[['glazefoot-0',12,18],['glazefoot-1',14,18]]);
  assert.ok(animals.every(a=>a.lifecycle.growth===600&&a.husbandry.trust===0));
  assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});

test('shared recipe action exposes crop and meal choices, exact requirements and skill observations',()=>{
  const s=createGame(703),farm=at(s.sites.surface,7,9),catalog=actionCatalog(),definition=catalog.find(a=>a.id==='production.recipe');
  assert.deepEqual(definition.parameters.properties.recipe.enum,[...Object.keys(CROPS).filter(id=>id!=='legacy_crop'),...Object.keys(MEAL_RECIPES)]);
  const definitions=createAgentInterface(()=>s).definitions();assert.ok(definitions.livestock.glazefoot);assert.ok(definitions.foodKinds.curd);
  startRecording(s);assert.equal(executeAction(s,'production.recipe',{site:'surface',x:7,y:9,recipe:'sunberry'},'test').ok,true);
  assert.equal(farm.machine.recipeId,'sunberry');const observed=observe(s).entities['tile:surface:7:9'].derived.production;
  assert.equal(observed.recipeId,'sunberry');assert.equal(observed.minSkill,3);assert.ok(observed.requirements.some(r=>r.resource==='water'&&r.required===1.5));
  assert.equal(observe(s).entities['glazefoot-0'].derived.productKind,'glazeegg');
  assert.ok(exportRecording(s).trim().split('\n').map(line=>JSON.parse(line)).some(record=>record.action?.id==='production.recipe'));
  for(const recipe of ['legacy_crop','invalid','curd_bake']){const before=serialize(s);assert.equal(executeAction(s,'production.recipe',{site:'surface',x:7,y:9,recipe},'test').ok,false);assert.equal(serialize(s),before);}
});

test('schema46 rejects malformed recipe pins, durations, ingredient claims and diets',()=>{
  const valid=deserialize(serialize(legacy40())),farm=at(valid.sites.surface,7,9);
  for(const mutate of [s=>at(s.sites.surface,7,9).machine.recipeId='unknown',s=>delete at(s.sites.surface,7,9).machine.recipeId,s=>at(s.sites.surface,7,9).machine.batchRecipeId='sunberry',s=>at(s.sites.surface,7,9).machine.progress=30]){
    const bad=structuredClone(valid);mutate(bad);assert.throws(()=>deserialize(serialize(bad)));
  }
  const s=createGame(704),site=s.sites.surface,a=s.creatures.find(a=>a.species==='glazefoot');
  const post=at(site,10,15);post.building='husbandryPost';add(at(site,8,10).stock,typedFood('fungalcap',1));syncResources(s);
  assert.equal(setAnimalPost(s,a.id,10,15).ok,true);const result=order(s,'surface',10,15,'animalCare',a.id);assert.equal(result.ok,true);
  assert.deepEqual(result.job.foodKinds,{fungalcap:1});assert.equal(serialize(deserialize(serialize(s))),serialize(s));
  for(const diet of [undefined,{ration:1},{fungalcap:.5},{fungalcap:1,curd:1}]){const bad=structuredClone(s);bad.jobs[0].foodKinds=diet;assert.throws(()=>deserialize(serialize(bad)));}
  const bad=structuredClone(s);bad.jobs[0].sources[0].items._food[0].kind='siltgrain';assert.throws(()=>deserialize(serialize(bad)));
  assert.equal(farm.machine.progress,11);
});


test('schema46 validates exact haul claims and actual operator skill while retaining old delivery recipe IDs',()=>{
  const s=createGame(705),site=s.sites.surface,t=at(site,10,10);t.building='galley';initializeStorage(t);initializeReliability(s);refreshPower(s,s.sites.surface);t.machine.recipeId='curd_bake';
  const c=s.crew[0];c.intent={type:'haul',target: { x: 8, y: 10, z: 0 },source:'stock',items:{food:1},foodKinds:{siltgrain:1},recipeId:'curd_bake',destination:{kind:'input',target: { x: 10, y: 10, z: 0 },recipeId:'curd_bake'}};
  assert.equal(serialize(deserialize(serialize(s))),serialize(s));
  for(const patch of [{foodKinds:{siltgrain:2}},{foodKinds:{unknown:1}},{foodKinds:{glazeegg:1}},{recipeId:'fungal_stew'},{destination:{kind:'input',target:{x:10,y:10,z:0},recipeId:'unknown'}}]){const bad=structuredClone(s);Object.assign(bad.crew[0].intent,patch);assert.throws(()=>deserialize(serialize(bad)));}
  c.intent=null;c.carry=typedFood('siltgrain',1);c.delivery={kind:'input',target: { x: 10, y: 10, z: 0 },recipeId:'grain_flatbread'};
  assert.equal(serialize(deserialize(serialize(s))),serialize(s));
  c.delivery.target={x:9,y:9,z:0};assert.equal(serialize(deserialize(serialize(s))),serialize(s));
  c.carry=null;c.delivery=null;const farm=at(site,7,9);farm.machine.recipeId='sunberry';farm.machine.batchRecipeId='sunberry';farm.machine.batch={water:1.5,fertilizer:.25};farm.machine.progress=1;
  const job={id:`job-${s.nextId++}`,site:'surface',x:7,y:9,z:0,kind:'operate',building:'farm',cost:{},sources:[],materials:{},work:40,remaining:39,worker:c.id,priority:1,blockedReason:null,missingFood:0,foodSpoiled:0};s.jobs.push(job);c.job=job.id;c.skills.production.level=3;
  assert.equal(serialize(deserialize(serialize(s))),serialize(s));c.skills.production.level=2;assert.throws(()=>deserialize(serialize(s)),/lacks recipe skill/);
});
