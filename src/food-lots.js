import { validCrewId } from './crew-identity.js';
import { FOOD_KINDS, MEAL_RECIPES } from './food-data.js';
// Unlisted food is fresh, unprepared legacy ration. Typed fresh lots are explicit.
export const FOOD_LIFETIME = 3600;
export const lotQuantity = lots => (lots || []).reduce((sum, lot) => sum + lot.amount, 0);
const copyLot = lot => ({...lot,...(lot.meal ? {meal:structuredClone(lot.meal)} : {})});
export function foodLots(inventory) {
  const lots = (inventory?._food || []).map(copyLot);
  const fresh = (inventory?.food || 0) - lotQuantity(lots);
  if (fresh > 0) lots.push({ amount: fresh, age: 0 });
  return lots.sort((a, b) => b.age - a.age);
}
export const preparedFood = inventory => foodLots(inventory).filter(l=>l.meal).reduce((n,l)=>n+l.amount,0);
export const rawFood = inventory => foodLots(inventory).filter(l=>!l.meal).reduce((n,l)=>n+l.amount,0);
export const foodOfKind = (inventory, kind) => foodLots(inventory).filter(l => !l.meal && (l.kind || 'ration') === kind).reduce((n, l) => n + l.amount, 0);
export function typedFood(kind, amount, age = 0) {
  if (!Object.hasOwn(FOOD_KINDS, kind) || !Number.isFinite(amount) || amount < 0 || !Number.isFinite(age) || age < 0 || age >= FOOD_LIFETIME) throw new Error('Invalid typed food.');
  return amount ? { food: amount, _food: [{ kind, amount, age }] } : {};
}
export function storeLots(inventory, lots) {
  const merged = new Map();
  for (const lot of lots) if (lot.amount > 0 && (lot.age > 0 || lot.meal || lot.kind)) {
    const key=JSON.stringify([lot.age,lot.kind||null,lot.meal||null]), prior=merged.get(key);
    if(prior)prior.amount+=lot.amount;else merged.set(key,copyLot(lot));
  }
  const result = [...merged.values()].sort((a, b) => b.age - a.age);
  if (result.length) inventory._food = result; else delete inventory._food;
}
function selection(inventory, amount, selector) {
  if (!Number.isFinite(amount) || amount < 0 || selector !== false && selector !== true && (!selector || typeof selector !== 'object' || Array.isArray(selector))) return null;
  const kinds = typeof selector === 'object' ? selector.foodKinds : undefined;
  if (kinds !== undefined && (!kinds || Array.isArray(kinds) || typeof kinds !== 'object' || Object.entries(kinds).some(([kind, n]) => !Object.hasOwn(FOOD_KINDS, kind) || !Number.isFinite(n) || n <= 0) || Math.abs(Object.values(kinds).reduce((sum, n) => sum + n, 0) - amount) > 1e-9)) return null;
  const rawOnly = selector === true || selector?.rawOnly || kinds !== undefined;
  const needed = kinds && { ...kinds }, moved = [], remaining = [];
  let left = amount;
  for (const lot of foodLots(inventory)) {
    const kind = lot.kind || 'ration';
    const n = rawOnly && lot.meal ? 0 : Math.min(left, lot.amount, needed ? needed[kind] || 0 : left);
    if (n > 0) { moved.push({ ...copyLot(lot), amount: n }); left -= n; if (needed) needed[kind] -= n; }
    if (lot.amount > n) remaining.push({ ...copyLot(lot), amount: lot.amount - n });
  }
  return left > 1e-9 || needed && Object.values(needed).some(n => n > 1e-9) ? null : { moved, remaining };
}
export function planFoodSelection(inventory, amount, selector = false) {
  return selection(inventory, amount, selector)?.moved ?? null;
}
export function takeFoodLots(inventory, amount, selector = false) {
  const planned = selection(inventory, amount, selector);
  if (!planned) return null;
  storeLots(inventory, planned.remaining); return planned.moved;
}
export function validMeal(m) {
  if (!(m && /^meal-job-[1-9]\d*$/.test(m.id) && validCrewId(m.maker) && Number.isInteger(m.quality) && m.quality>=1 && m.quality<=4 && Number.isSafeInteger(m.created) && m.created>=0)) return false;
  if (m.recipeId === undefined && m.ingredients === undefined) return true;
  const recipe = Object.hasOwn(MEAL_RECIPES, m.recipeId) && MEAL_RECIPES[m.recipeId], ingredients = m.ingredients;
  return !!recipe && !!ingredients && typeof ingredients === 'object' && !Array.isArray(ingredients) && Object.entries(ingredients).every(([kind, n]) => Object.hasOwn(FOOD_KINDS, kind) && Number.isFinite(n) && n > 0) && Math.abs(Object.values(ingredients).reduce((n, value) => n + value, 0) - recipe.input.food) < 1e-8 && (!recipe.foodKinds || Object.keys(ingredients).length === Object.keys(recipe.foodKinds).length && Object.entries(recipe.foodKinds).every(([kind, n]) => Math.abs((ingredients[kind] || 0) - n) < 1e-8));
}
export function validFoodLots(inventory) {
  if (inventory._food === undefined) return true;
  return Array.isArray(inventory._food) && inventory._food.length > 0 && inventory._food.length <= 10000 && inventory._food.every(l => l && Number.isFinite(l.amount) && l.amount > 0 && Number.isFinite(l.age) && (l.age > 0 || l.age === 0 && (l.meal || l.kind)) && l.age < FOOD_LIFETIME && (l.kind === undefined || Object.hasOwn(FOOD_KINDS, l.kind) && !l.meal) && (l.meal===undefined||validMeal(l.meal))) && lotQuantity(inventory._food) <= (inventory.food || 0) + 1e-7;
}
export const foodAge = inventory => Math.max(0, ...(inventory?._food || []).map(lot => lot.age));
export const decayRate = temperature => temperature <= 0 ? .05 : temperature <= 5 ? .2 : temperature <= 25 ? 1 : temperature <= 40 ? 2 : 4;
