import { foodAge, foodLots, preparedFood, decayRate, FOOD_LIFETIME } from './food-lots.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function foodDetails(inventory, temperature = 20, label = 'Food') {
  if (!inventory?.food) return '';
  const age = foodAge(inventory), rate = decayRate(temperature), seconds = Math.max(0, Math.ceil((FOOD_LIFETIME - age) / rate));
  return `<p class="crew-hint">${label}: oldest lot ${Math.max(0, Math.floor((1 - age / FOOD_LIFETIME) * 100))}% freshness · about ${Math.ceil(seconds / 60)} min until spoilage at ${temperature.toFixed(1)} °C. Cold storage slows aging; moving or mixing food never restores freshness.</p>${preparedFood(inventory)>0?`<details data-meal-list><summary>${Number(preparedFood(inventory).toFixed(2))} prepared food</summary><ul class="crew-memories">${foodLots(inventory).filter(l=>l.meal).map(l=>`<li data-entity="${esc(l.meal.id)}">${Number(l.amount.toFixed(3))} food · quality ${l.meal.quality}/4<br><small>${esc(l.meal.id)} · cook ${esc(l.meal.maker)}</small></li>`).join('')}</ul></details>`:''}`;
}
