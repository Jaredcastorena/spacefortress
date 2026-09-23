// Unlisted food is fresh and unprepared. Prepared lots retain their batch identity.
export const FOOD_LIFETIME = 3600;
export const lotQuantity = lots => (lots || []).reduce((sum, lot) => sum + lot.amount, 0);
const copyLot = lot => ({...lot,...(lot.meal ? {meal:{...lot.meal}} : {})});
export function foodLots(inventory) {
  const lots = (inventory?._food || []).map(copyLot);
  const fresh = (inventory?.food || 0) - lotQuantity(lots);
  if (fresh > 1e-9) lots.push({ amount: fresh, age: 0 });
  return lots.sort((a, b) => b.age - a.age);
}
export const preparedFood = inventory => foodLots(inventory).filter(l=>l.meal).reduce((n,l)=>n+l.amount,0);
export const rawFood = inventory => foodLots(inventory).filter(l=>!l.meal).reduce((n,l)=>n+l.amount,0);
export function storeLots(inventory, lots) {
  const merged = new Map();
  for (const lot of lots) if (lot.amount > 1e-9 && (lot.age > 0 || lot.meal)) {
    const key=JSON.stringify([lot.age,lot.meal||null]), prior=merged.get(key);
    if(prior)prior.amount+=lot.amount;else merged.set(key,copyLot(lot));
  }
  const result = [...merged.values()].sort((a, b) => b.age - a.age);
  if (result.length) inventory._food = result; else delete inventory._food;
}
export function takeFoodLots(inventory, amount, rawOnly = false) {
  const moved = [], remaining = [];
  for (const lot of foodLots(inventory)) {
    const n = rawOnly && lot.meal ? 0 : Math.min(amount, lot.amount);
    if (n > 0) moved.push({...copyLot(lot), amount:n});
    if (lot.amount > n) remaining.push({...copyLot(lot),amount:lot.amount-n}); amount -= n;
  }
  storeLots(inventory, remaining); return moved;
}
export function validMeal(m) {
  return m && /^meal-job-[1-9]\d*$/.test(m.id) && /^crew-[0-6]$/.test(m.maker) && Number.isInteger(m.quality) && m.quality>=1 && m.quality<=4 && Number.isSafeInteger(m.created) && m.created>=0;
}
export function validFoodLots(inventory) {
  if (inventory._food === undefined) return true;
  return Array.isArray(inventory._food) && inventory._food.length > 0 && inventory._food.length <= 10000 && inventory._food.every(l => l && Number.isFinite(l.amount) && l.amount > 0 && Number.isFinite(l.age) && (l.age > 0 || l.age === 0 && l.meal) && l.age < FOOD_LIFETIME && (l.meal===undefined||validMeal(l.meal))) && lotQuantity(inventory._food) <= (inventory.food || 0) + 1e-7;
}
export const foodAge = inventory => Math.max(0, ...(inventory?._food || []).map(lot => lot.age));
export const decayRate = temperature => temperature <= 0 ? .05 : temperature <= 5 ? .2 : temperature <= 25 ? 1 : temperature <= 40 ? 2 : 4;
