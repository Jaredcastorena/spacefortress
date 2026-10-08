import test from 'node:test';
import assert from 'node:assert/strict';
import { FOOD_KINDS, MEAL_RECIPES } from '../src/food-data.js';
import { LIVESTOCK } from '../src/livestock-data.js';
import { typedFood, foodLots, foodOfKind, foodAge, planFoodSelection, validFoodLots, FOOD_LIFETIME } from '../src/food-lots.js';
import { add, extract, quantity } from '../src/inventory.js';
import { cookMeal, openMeal, eatPortion } from '../src/meals.js';

function cookFixture(level) {
  return {
    s: { tick: 900, nextId: 2 },
    c: { id: 'crew-3', skills: { production: { level, xp: 0 } }, life: { stress: 50 } },
    j: { id: 'job-1', site: 'surface', x: 10, y: 10 },
  };
}
function supply(kinds, water, age = 0) {
  const inventory = { water };
  for (const [kind, amount] of Object.entries(kinds)) add(inventory, typedFood(kind, amount, age));
  return inventory;
}

test('species yield definitions enter ordinary finite food storage with the inherited carcass age', () => {
  const stock = {}, expected = [['bristleback', 'bristlemeat', 4], ['glazefoot', 'glazemeat', 3]];
  for (const [species, kind, yieldAmount] of expected) {
    const def = LIVESTOCK[species];
    assert.equal(def.meatKind, kind); assert.equal(def.meatYield, yieldAmount); assert.equal(def.juvenileMeatYield, 1);
    assert.equal(FOOD_KINDS[kind].origin, 'animal');
    add(stock, typedFood(def.meatKind, def.meatYield, 247));
  }
  assert.equal(stock.food, 7); assert.equal(quantity(stock), 7); assert.equal(foodOfKind(stock, 'bristlemeat'), 4); assert.equal(foodOfKind(stock, 'glazemeat'), 3);
  assert.equal(foodAge(stock), 247); assert.equal(validFoodLots(stock), true);
  assert.deepEqual(JSON.parse(JSON.stringify(stock)), stock);
});

test('species-specific meat selects oldest matching portions and preserves younger and unrelated food', () => {
  const stock = supply({ bristlemeat: 1, glazemeat: 1 }, 0, 100);
  add(stock, typedFood('bristlemeat', 1, 800)); add(stock, typedFood('curd', 1, 900));
  const before = structuredClone(stock), plan = planFoodSelection(stock, 1, { rawOnly: true, foodKinds: { bristlemeat: 1 } });
  assert.deepEqual(stock, before); assert.equal(plan.length, 1); assert.equal(plan[0].age, 800);
  const moved = extract(stock, { food: 1 }, { rawOnly: true, foodKinds: { bristlemeat: 1 } });
  assert.equal(foodAge(moved), 800); assert.equal(foodOfKind(stock, 'bristlemeat'), 1); assert.equal(foodOfKind(stock, 'glazemeat'), 1); assert.equal(foodOfKind(stock, 'curd'), 1);
  assert.equal(stock.food + moved.food, before.food);
});

test('a wrong species or animal product cannot replace meat and a missing plant leaves every input intact', () => {
  const recipe = MEAL_RECIPES.bristlecap_braise;
  assert.deepEqual(recipe.foodKinds, { bristlemeat: 1, fungalcap: 1 });
  const stock = supply({ glazemeat: 1, curd: 1, fungalcap: 1 }, 1, 321), before = structuredClone(stock);
  assert.equal(extract(stock, recipe.input, { rawOnly: true, foodKinds: recipe.foodKinds }), null); assert.deepEqual(stock, before);
  const missingPlant = supply({ bristlemeat: 2, siltgrain: 1 }, .5, 122), pending = structuredClone(missingPlant);
  assert.equal(extract(missingPlant, recipe.input, { rawOnly: true, foodKinds: recipe.foodKinds }), null); assert.deepEqual(missingPlant, pending);
});

for (const [recipeId, meatKind, plantKind, water, work, minSkill, comfort] of [
  ['bristlecap_braise', 'bristlemeat', 'fungalcap', .5, 40, 3, .06],
  ['sunberry_glaze_roast', 'glazemeat', 'sunberry', .25, 44, 6, .08],
]) test(`${recipeId} consumes its exact mixture and retains oldest age, batch provenance and finite output`, () => {
  const recipe = MEAL_RECIPES[recipeId], stock = supply({ [meatKind]: 3 }, 2, 640);
  add(stock, typedFood(plantKind, 1, 250)); const initialFood = stock.food;
  assert.equal(recipe.input.water, water); assert.equal(recipe.duration, work); assert.equal(recipe.minSkill, minSkill); assert.equal(recipe.comfort, comfort);
  const batch = extract(stock, recipe.input, { rawOnly: true, foodKinds: recipe.foodKinds });
  assert.ok(batch); assert.equal(batch.water, water); assert.equal(stock.water, 2 - water);
  const { s, c, j } = cookFixture(minSkill), output = cookMeal(s, c, j, batch, recipeId), lot = foodLots(output)[0];
  assert.equal(stock.food + output.food, initialFood); assert.equal(output.food, 2); assert.equal(foodAge(output), 640);
  assert.deepEqual(lot.meal, { id: 'meal-job-1', maker: c.id, quality: 1 + minSkill / 3, created: 900, recipeId, ingredients: { [meatKind]: 1, [plantKind]: 1 } });
  assert.equal(validFoodLots(output), true); assert.equal(planFoodSelection(output, 1, true), null);
  const portion = extract(output, { food: .375 }); add(stock, portion);
  assert.equal(output.food, 1.625); assert.equal(stock.food, initialFood - 2 + .375);
  assert.equal(foodOfKind(stock, meatKind), 2); assert.equal(foodAge(portion), 640);
  portion._food[0].meal.ingredients[meatKind] = 10;
  assert.equal(foodLots(stock).find(l => l.meal).meal.ingredients[meatKind], 1);
});

test('higher cooking quality changes meal metadata without multiplying meat or prepared yield', () => {
  const recipe = MEAL_RECIPES.bristlecap_braise, input = supply(recipe.foodKinds, recipe.input.water, 300);
  for (const [level, quality] of [[3, 2], [6, 3], [9, 4]]) {
    const { s, c, j } = cookFixture(level), before = structuredClone(input), output = cookMeal(s, c, j, input, recipe.id);
    assert.equal(output.food, 2); assert.equal(output._food[0].meal.quality, quality); assert.equal(output._food[0].meal.ingredients.bristlemeat, 1);
    assert.equal(foodAge(output), 300); assert.deepEqual(input, before); assert.equal(c.skills.production.xp, 0);
  }
});

test('a meat meal portion has explicit comfort without changing consumed food or inherited freshness', () => {
  const recipe = MEAL_RECIPES.sunberry_glaze_roast, { s, c, j } = cookFixture(6), output = cookMeal(s, c, j, supply(recipe.foodKinds, recipe.input.water, 700), recipe.id);
  const meal = { servings: 8 }; openMeal(s, c, meal, extract(output, { food: 1 })); meal.servings--; eatPortion(s, c, meal);
  assert.equal(output.food, 1); assert.equal(meal.openedFood.food, .875); assert.equal(meal.qualityTotal, 3);
  assert.ok(Math.abs(c.life.stress - 49.62) < 1e-9); assert.equal(foodAge(meal.openedFood), 700);
  assert.equal(output.food + meal.openedFood.food + .125, 2);
});

test('expired meat cannot be emitted fresh and forged meat meal composition rejects', () => {
  assert.throws(() => typedFood('bristlemeat', 4, FOOD_LIFETIME), /Invalid typed food/);
  const recipe = MEAL_RECIPES.bristlecap_braise, { s, c, j } = cookFixture(3);
  const output = cookMeal(s, c, j, supply(recipe.foodKinds, recipe.input.water, FOOD_LIFETIME - 1), recipe.id);
  assert.equal(foodAge(output), FOOD_LIFETIME - 1); assert.equal(validFoodLots(output), true);
  output._food[0].meal.ingredients = { glazemeat: 1, fungalcap: 1 }; assert.equal(validFoodLots(output), false);
  assert.throws(() => cookMeal(s, c, j, supply({ glazemeat: 1, fungalcap: 1 }, .5), recipe.id), /ingredients do not match/);
  const legacy = { food: 1, _food: [{ amount: 1, age: 200, meal: { id: 'meal-job-1', maker: 'crew-3', quality: 2, created: 10 } }] };
  assert.equal(validFoodLots(legacy), true);
});
