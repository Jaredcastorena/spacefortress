import { crewStartTicks } from './crew-identity.js';
import { foodLots, foodAge, storeLots, validFoodLots, planFoodSelection } from './food-lots.js';
import { DEFAULT_MEAL, MEAL_RECIPES, mealQualityForLevel } from './food-data.js';
import { extract, add } from './inventory.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { remember } from './crew.js';

export function cookMeal(s,c,j,ingredients,recipeId=DEFAULT_MEAL) {
  const recipe = Object.hasOwn(MEAL_RECIPES, recipeId) && MEAL_RECIPES[recipeId];
  if (!recipe || ingredients.food !== recipe.input.food || planFoodSelection(ingredients, recipe.input.food, { rawOnly: true, ...(recipe.foodKinds ? { foodKinds: recipe.foodKinds } : {}) }) === null) throw new Error('Meal ingredients do not match the recipe.');
  const composition = {};
  for (const lot of foodLots(ingredients)) composition[lot.kind || 'ration'] = (composition[lot.kind || 'ration'] || 0) + lot.amount;
  const meal={id:`meal-${j.id}`,maker:c.id,quality:mealQualityForLevel(c.skills.production.level),created:s.tick,recipeId,ingredients:composition};
  const result={food:recipe.output.food};storeLots(result,[{amount:result.food,age:foodAge(ingredients),meal}]);
  emitEvent(s,'meal.prepared',{entity:tileEntityId(j.site,j.x,j.y,j.z),actor:c.id,job:j.id,batch:meal.id,quality:meal.quality,food:result.food,age:foodAge(ingredients),recipeId,ingredients:composition});
  return result;
}
export function openedInventory(meal) {
  if(meal.openedFood)return meal.openedFood;
  const result={food:(meal.servings||0)/8};
  if(meal.foodAge&&result.food)storeLots(result,[{amount:result.food,age:meal.foodAge}]);
  return result;
}
export function openMeal(s,c,meal,food) {
  meal.openedFood=structuredClone(food);meal.qualityTotal=0;meal.foodAge=foodAge(food);
  emitEvent(s,'meal.opened',{entity:c.id,actor:c.id,food:food.food,lots:foodLots(food)});
}
export function eatPortion(s,c,meal) {
  const portion=extract(meal.openedFood||openedInventory({...meal,servings:meal.servings+1}),{food:1/8});
  if(meal.openedFood)meal.foodAge=foodAge(meal.openedFood);
  const quality=portion?foodLots(portion).reduce((n,l)=>n+l.amount*(l.meal?.quality||0),0)*8:0;
  const comfort=portion?foodLots(portion).reduce((n,l)=>n+l.amount*(MEAL_RECIPES[l.meal?.recipeId]?.comfort||0),0)*8:0;
  meal.qualityTotal=(meal.qualityTotal||0)+quality;
  c.life.stress=Math.max(0,c.life.stress-quality*.1-comfort);
  emitEvent(s,'meal.portion.eaten',{entity:c.id,actor:c.id,food:1/8,quality,comfort,lots:portion?foodLots(portion):[]});
  // Called after the existing physiology decrements servings.
  if(!meal.servings) {
    if(meal.qualityTotal>0)remember(s,c,'prepared-meal','Enjoyed a meal prepared by a crewmate.',2+Math.ceil(meal.qualityTotal/8));
    emitEvent(s,'meal.finished',{entity:c.id,actor:c.id,preparedQuality:meal.qualityTotal/8});
    delete meal.openedFood;delete meal.qualityTotal;
  }
}
export function moveOpenedMeal(source,destination) {
  const food=structuredClone(openedInventory(source));
  const existing=structuredClone(openedInventory(destination));add(existing,food);
  destination.openedFood=existing;destination.qualityTotal=(destination.qualityTotal||0)+(source.qualityTotal||0);
  destination.servings+=source.servings;destination.foodAge=foodAge(existing);
  source.servings=0;source.foodAge=0;delete source.openedFood;delete source.qualityTotal;
}
export function validateMeals(s,owners) {
  const metadata=new Map(),makers=crewStartTicks(s);
  const validateInventory=inv=>{
    if(!validFoodLots(inv))throw new Error('Invalid prepared food.');
    for(const lot of foodLots(inv))if(lot.meal){const m=lot.meal;if(!makers.has(m.maker)||m.created<makers.get(m.maker)||m.created>s.tick||Number(m.id.slice(9))>=s.nextId)throw new Error('Invalid meal batch identity.');const previous=metadata.get(m.id);if(previous&&JSON.stringify(previous)!==JSON.stringify(m))throw new Error('Conflicting meal batch metadata.');metadata.set(m.id,m);}
  };
  for(const owner of owners)validateInventory(owner.inventory);
  for(const c of s.crew)for(const meal of [c.medical,c.intent?.type==='meal'?c.intent:null])if(meal){
    if(meal.qualityTotal!==undefined&&(!Number.isFinite(meal.qualityTotal)||meal.qualityTotal<0||meal.qualityTotal>32))throw new Error('Invalid meal enjoyment.');
    if(meal.openedFood!==undefined){const inv=meal.openedFood;if(!inv||Array.isArray(inv)||typeof inv!=='object'||Object.keys(inv).some(k=>!['food','_food'].includes(k))||!Number.isFinite(inv.food)||Math.abs(inv.food-meal.servings/8)>1e-8||foodAge(inv)>(meal.foodAge||0)+1e-8)throw new Error('Invalid opened food portions.');validateInventory(inv);}
  }
}
