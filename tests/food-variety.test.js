import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, order, pathTo, setLabor, serialize, deserialize } from '../src/simulation.js';
import { add, extract, initializeStorage, totalResources, syncResources, quantity } from '../src/inventory.js';
import { foodLots, foodOfKind, typedFood, planFoodSelection, validFoodLots, FOOD_LIFETIME, foodAge } from '../src/food-lots.js';
import { CROPS, MEAL_RECIPES, mealQualityForLevel, nextQualityLevel } from '../src/food-data.js';
import { cookMeal, openMeal, eatPortion } from '../src/meals.js';
import { setProductionRecipe, recipeFor, operateMachine, productionEligibility, inputBatchesWanted, projectedStock } from '../src/production.js';
import { setMachineEnabled } from '../src/industry.js';
import { refreshPower } from '../src/power.js';
import { updateFood } from '../src/spoilage.js';

function kitchen() {
  const s = createGame(), site = s.sites.surface, t = at(site,12,10), c = s.crew[0];
  for (const tile of site.tiles) if (tile.machine && tile.building !== 'scrubber') setMachineEnabled(s,site.id,tile.x,tile.y,false);
  for (const crew of s.crew) { setLabor(s,crew.id,'production',false); setLabor(s,crew.id,'hauling',false); }
  t.building = 'galley'; initializeStorage(t); t.cable = {hp:100,enabled:true}; refreshPower(s,site);
  c.x=11;c.y=10;c.skills.production.level=3;setLabor(s,c.id,'production',true);
  return {s,site,t,c,m:t.machine};
}
function ingredients(kinds, water=.25, age=0) {
  const inv={water};for(const [kind,amount] of Object.entries(kinds))add(inv,typedFood(kind,amount,age));return inv;
}
const check = s => {syncResources(s);return deserialize(serialize(s));};

test('fresh typed portions survive mixing, partial pickup, serialization and merge without becoming ration',()=>{
  const source=ingredients({siltgrain:1,curd:1},0), destination={food:.5};
  assert.equal(validFoodLots(source),true);assert.equal(source._food.length,2);
  add(destination,extract(source,{food:.75},{rawOnly:true,foodKinds:{curd:.75}}));
  assert.equal(foodOfKind(source,'siltgrain'),1);assert.equal(foodOfKind(source,'curd'),.25);
  assert.equal(foodOfKind(destination,'ration'),.5);assert.equal(foodOfKind(destination,'curd'),.75);
  assert.equal(foodOfKind(JSON.parse(JSON.stringify(destination)),'curd'),.75);
  add(source,extract(destination,{food:.75},{rawOnly:true,foodKinds:{curd:.75}}));
  assert.equal(source.food,2);assert.equal(destination.food,.5);assert.equal(source._food.length,2);
});

test('mixed extraction is atomic across missing ingredients and keepsake identities and selects oldest matching food',()=>{
  const inv=ingredients({siltgrain:1,curd:1},1);add(inv,typedFood('curd',1,400));
  inv.keepsakes=1;inv._items=[{id:'item-1',maker:'crew-0',style:'art',quality:1,created:0}];
  const before=structuredClone(inv);
  assert.equal(extract(inv,{food:2,water:.25,keepsakes:1},{rawOnly:true,foodKinds:{sunberry:1,curd:1}}),null);
  assert.deepEqual(inv,before);
  assert.equal(extract(inv,{food:2,keepsakes:1,_items:[{id:'item-2'}]},{rawOnly:true,foodKinds:{siltgrain:1,curd:1}}),null);
  assert.deepEqual(inv,before);
  const plan=planFoodSelection(inv,2,{rawOnly:true,foodKinds:{siltgrain:1,curd:1}});
  assert.deepEqual(inv,before);assert.equal(plan.find(l=>l.kind==='curd').age,400);
  const moved=extract(inv,{food:2,water:.25,keepsakes:1},{rawOnly:true,foodKinds:{siltgrain:1,curd:1}});
  assert.equal(moved.food,2);assert.equal(inv.food,1);assert.equal(inv.water,.75);assert.equal(inv.keepsakes,undefined);
  assert.equal(foodAge(moved),400);assert.equal(foodOfKind(inv,'curd'),1);
});

test('cooked composition and independent comfort survive fractional portions without changing food or age',()=>{
  const {s,c}=kitchen(), input=ingredients({siltgrain:1,curd:1},.25,1234), j={id:`job-${s.nextId++}`,site:'surface',x:12,y:10};
  c.life.stress=30;const food=cookMeal(s,c,j,input,'curd_bake');
  assert.equal(food.food,2);assert.equal(foodAge(food),1234);assert.equal(validFoodLots(food),true);
  assert.deepEqual(food._food[0].meal.ingredients,{siltgrain:1,curd:1});
  const copy=foodLots(food);copy[0].meal.ingredients.curd=100;assert.equal(food._food[0].meal.ingredients.curd,1);
  assert.equal(planFoodSelection(food,1,true),null);
  const meal={servings:8};openMeal(s,c,meal,extract(food,{food:1}));meal.servings--;eatPortion(s,c,meal);
  assert.equal(meal.openedFood.food,7/8);assert.equal(meal.qualityTotal,2);
  assert.ok(Math.abs(c.life.stress-29.75)<1e-9);assert.equal(foodAge(meal.openedFood),1234);
  assert.equal(food.food+meal.openedFood.food+1/8,2);
});

test('invalid ingredient provenance and forged raw kinds reject while old prepared meals remain valid',()=>{
  const legacy={food:1,_food:[{amount:1,age:0,meal:{id:'meal-job-1',maker:'crew-0',quality:2,created:0}}]};
  assert.equal(validFoodLots(legacy),true);
  const invalid=typedFood('curd',1);invalid._food[0].kind='invented';assert.equal(validFoodLots(invalid),false);
  legacy._food[0].meal.recipeId='toString';legacy._food[0].meal.ingredients={ration:2};assert.equal(validFoodLots(legacy),false);
  legacy._food[0].meal.recipeId='curd_bake';assert.equal(validFoodLots(legacy),false);
});

test('changing the next recipe preserves committed ingredients and work, spills mismatches and clears unpaid claims',()=>{
  const {s,site,t,c,m}=kitchen();setProductionRecipe(s,site.id,t.x,t.y,'curd_bake');
  m.input=ingredients({siltgrain:2,curd:2});m.input.water=.5;
  const result=order(s,site.id,t.x,t.y,'operate');assert.equal(result.ok,true);
  const j=result.job;c.job=j.id;j.worker=c.id;operateMachine(s,c,j,site,pathTo);assert.ok(m.progress>0);
  const paid=structuredClone(m.batch), progress=m.progress, before=totalResources(s);
  s.crew[1].intent={type:'haul',target:[8,10],source:'stock',items:{food:1},destination:{kind:'input',target:[t.x,t.y]},recipeId:'curd_bake',foodKinds:{curd:1}};
  assert.equal(setProductionRecipe(s,site.id,t.x,t.y,'fungal_stew').ok,true);
  assert.equal(recipeFor(t).id,'curd_bake');assert.equal(recipeFor(t,'selected').id,'fungal_stew');assert.equal(j.work,32);
  assert.deepEqual(m.batch,paid);assert.equal(m.progress,progress);assert.equal(m.input.food,undefined);assert.equal(t.drop.food,2);
  assert.equal(s.crew[1].intent,null);assert.deepEqual(totalResources(s),before);
  assert.equal(productionEligibility(s,site,t,'fungal_stew').requirements.find(r=>r.kind==='fungalcap').delivered,0);
  for(let i=0;i<40&&quantity(m.batch);i++)operateMachine(s,c,j,site,pathTo);
  assert.equal(m.output.food,2);assert.equal(m.output._food[0].meal.recipeId,'curd_bake');assert.equal(m.batchRecipeId,undefined);check(s);
});

test('recipe skill gates apply to the actual operator and report the missing ingredient kind',()=>{
  const {s,site,t,c,m}=kitchen();setProductionRecipe(s,site.id,t.x,t.y,'colony_feast');
  assert.equal(productionEligibility(s,site,t).minSkill,6);assert.equal(productionEligibility(s,site,t).blockedCode,'no_qualified_operator');
  c.skills.production.level=6;
  assert.equal(productionEligibility(s,site,t).blockedCode,'ingredients');
  m.input=ingredients(MEAL_RECIPES.colony_feast.foodKinds,.5);
  const j=order(s,site.id,t.x,t.y,'operate').job;assert.ok(j);
  const unskilled=s.crew[1];unskilled.x=11;unskilled.y=10;setLabor(s,unskilled.id,'production',true);unskilled.skills.production.level=0;unskilled.job=j.id;j.worker=unskilled.id;
  operateMachine(s,unskilled,j,site,pathTo);assert.equal(m.progress,0);assert.equal(m.input.food,2);assert.equal(unskilled.job,null);
  c.job=j.id;j.worker=c.id;operateMachine(s,c,j,site,pathTo);assert.ok(m.progress>0);assert.equal(m.batchRecipeId,'colony_feast');
});

test('selected stock targets count only the matching recipe and matching promised production',()=>{
  const {s,site,t,c,m}=kitchen();const depot=at(site,8,10);setProductionRecipe(s,site.id,t.x,t.y,'curd_bake');
  add(depot.stock,cookMeal(s,c,{id:`job-${s.nextId++}`,site:site.id,x:t.x,y:t.y},{food:2}));
  m.order={mode:'stock',limit:2,remaining:0,priority:1};assert.equal(inputBatchesWanted(s,site,t),1);
  m.input=ingredients({siltgrain:1,curd:1});const j=order(s,site.id,t.x,t.y,'operate').job;c.job=j.id;j.worker=c.id;operateMachine(s,c,j,site,pathTo);
  assert.equal(projectedStock(s,site,'food',null,true,MEAL_RECIPES.curd_bake),2);
  assert.equal(inputBatchesWanted(s,site,t),0);
});

test('spoiled committed food loses its pinned assignment and returns other paid resources physically',()=>{
  const {s,site,t,c,m}=kitchen();setProductionRecipe(s,site.id,t.x,t.y,'curd_bake');m.input=ingredients({siltgrain:1,curd:1},.25,FOOD_LIFETIME-.1);
  const j=order(s,site.id,t.x,t.y,'operate').job;c.job=j.id;j.worker=c.id;operateMachine(s,c,j,site,pathTo);
  setProductionRecipe(s,site.id,t.x,t.y,'fungal_stew');updateFood(s,pathTo);
  assert.equal(m.batchRecipeId,undefined);assert.equal(m.progress,0);assert.deepEqual(m.batch,{});assert.equal(s.jobs.includes(j),false);
  assert.equal(t.drop.water,.25);assert.equal(t.drop.waste,2);assert.equal(m.output.food,undefined);check(s);
});

test('crop variants have real inputs, qualified work, fresh typed output and separate stock targets',()=>{
  const {s,site,c}=kitchen(),t=at(site,7,9),m=t.machine;setMachineEnabled(s,site.id,t.x,t.y,true);c.x=8;c.y=9;
  assert.equal(setProductionRecipe(s,site.id,t.x,t.y,'legacy_crop').ok,false);
  setProductionRecipe(s,site.id,t.x,t.y,'sunberry');m.input={water:1.5,fertilizer:.25};
  const state=productionEligibility(s,site,t);
  assert.equal(state.recipeId,'sunberry');assert.equal(state.minSkill,3);assert.equal(recipeFor(t).duration,40);
  assert.equal(Object.values(CROPS).filter(r=>r.selectable!==false).length,3);assert.equal(Object.keys(MEAL_RECIPES).length,8);
  assert.deepEqual([0,3,6,9].map(mealQualityForLevel),[1,2,3,4]);assert.equal(nextQualityLevel(6),9);assert.equal(nextQualityLevel(9),null);
  c.skills.production.level=9;
  const before=totalResources(s), result=order(s,site.id,t.x,t.y,'operate');assert.equal(result.ok,true,result.message);
  const j=result.job;c.job=j.id;j.worker=c.id;
  for(let i=0;i<50&&!m.completed;i++)operateMachine(s,c,j,site,pathTo);
  assert.equal(m.completed,1);assert.equal(foodOfKind(m.output,'sunberry'),2);assert.equal(foodAge(m.output),0);
  assert.equal(totalResources(s).food,before.food+2);assert.equal(totalResources(s).water,before.water-1.5);assert.equal(totalResources(s).fertilizer,before.fertilizer-.25);
  assert.equal(projectedStock(s,site,'food',null,false,CROPS.sunberry),2);assert.equal(projectedStock(s,site,'food',null,false,CROPS.fungalcap),0);check(s);
});
