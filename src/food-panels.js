import { foodAge, foodLots, preparedFood, decayRate, FOOD_LIFETIME } from './food-lots.js';
import { FOOD_KINDS, MEAL_RECIPES } from './food-data.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount=value=>Number(value.toFixed(3));
const freshness=age=>Math.max(0,Math.floor((1-age/FOOD_LIFETIME)*100));
export const foodKindName=kind=>FOOD_KINDS[kind]?.name || kind;
export const foodComposition=ingredients=>Object.entries(ingredients).map(([kind,n])=>`${amount(n)} ${foodKindName(kind)}`).join(' + ');
export function foodDetails(inventory, temperature = 20, label = 'Food') {
  if (!inventory?.food) return '';
  const age = foodAge(inventory), rate = decayRate(temperature), seconds = Math.max(0, Math.ceil((FOOD_LIFETIME - age) / rate));
  const lots=foodLots(inventory),prepared=preparedFood(inventory);
  return `<details data-food-list data-panel-key="food-${esc(label)}"><summary>${esc(label)} · ${amount(inventory.food)} units · ${freshness(age)}% oldest freshness</summary><p class="crew-hint">About ${Math.ceil(seconds / 60)} min until the oldest lot spoils at ${temperature.toFixed(1)} °C. Cold storage slows aging; moving or mixing food never restores freshness.</p>${lots.some(l=>!l.meal)?`<ul class="crew-memories">${lots.filter(l=>!l.meal).map(l=>`<li>${amount(l.amount)} ${esc(foodKindName(l.kind||'ration'))} · ${freshness(l.age)}% freshness</li>`).join('')}</ul>`:''}${prepared>0?`<details data-meal-list data-panel-key="meals-${esc(label)}"><summary>${amount(prepared)} prepared food</summary><ul class="crew-memories">${lots.filter(l=>l.meal).map(l=>`<li data-entity="${esc(l.meal.id)}">${amount(l.amount)} ${esc(MEAL_RECIPES[l.meal.recipeId]?.name||'Prepared meal')} · quality ${l.meal.quality}/4 · ${freshness(l.age)}% freshness${l.meal.ingredients?`<br><small>Batch ingredients: ${esc(foodComposition(l.meal.ingredients))}</small>`:''}<br><small>${esc(l.meal.id)} · cook ${esc(l.meal.maker)}</small></li>`).join('')}</ul></details>`:''}</details>`;
}
