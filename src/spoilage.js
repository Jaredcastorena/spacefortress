import { openedInventory, moveOpenedMeal, validateMeals } from './meals.js';
import { add, contains, quantity, spill } from './inventory.js';
import { foodLots, storeLots, FOOD_LIFETIME, decayRate } from './food-lots.js';
import { temperatureAt } from './thermal.js';
import { reserveConstruction } from './construction.js';

export function initializeFood(s) {
  s.foodSpoiled = 0;
  for (const j of s.jobs) { j.missingFood = 0; j.foodSpoiled = 0; }
  for (const c of s.crew) { c.medical.foodAge ??= 0; if (c.intent?.type === 'meal') c.intent.foodAge ??= 0; }
}
const location = (s, siteId, x, y) => ({ site: s.sites[siteId], x, y });
function shipLocation(s) {
  if (!s.mission) return location(s, 'surface', 16, 11);
  if (['outbound', 'returning'].includes(s.mission.phase)) return null;
  const site = s.sites[s.mission.site], dock = site.tiles.find(t => t.building === 'dock');
  return { site, x: dock.x, y: dock.y };
}
export function foodOwners(s) {
  const result = [], put = (inventory, place, extras = {}) => { if (inventory) result.push({ inventory, place, ...extras }); };
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    const place = { site, x: t.x, y: t.y };
    put(t.stock, place, { retainWaste: true }); put(t.drop, place, { retainWaste: true });
    if (t.machine) for (const kind of ['input', 'output', 'batch']) put(t.machine[kind], place, { machine: t, batch: kind === 'batch' });
  }
  for (const j of s.jobs) {
    put(j.materials, location(s, j.site, j.x, j.y), { job: j });
    for (const source of j.sources) put(source.items, location(s, j.site, source.x, source.y), { job: j });
  }
  for (const c of s.crew) {
    const job = c.delivery?.kind === 'job' && s.jobs.find(j => j.id === c.delivery.job);
    put(c.carry, c.site === 'transit' ? null : location(s, c.site, c.x, c.y), { job, crew: c, retainWaste: !job });
  }
  put(s.shuttle.supplies, shipLocation(s), { retainWaste: true });
  put(s.mission?.cargo, shipLocation(s), { retainWaste: true });
  return result;
}
function ageInventory(inventory, rate) {
  if (!inventory.food) return 0;
  let spoiled = 0; const remaining = [];
  for (const lot of foodLots(inventory)) {
    lot.age += rate;
    if (lot.age >= FOOD_LIFETIME) spoiled += lot.amount; else remaining.push(lot);
  }
  if (spoiled) { inventory.food = Math.max(0, inventory.food - spoiled); if (inventory.food < 1e-9) delete inventory.food; }
  storeLots(inventory, remaining); return spoiled;
}
const tileAt = place => place.site.tiles[place.y * place.site.size + place.x];
export function updateFood(s, pathTo) {
  let spoiledNow = 0;
  for (const owner of foodOwners(s)) {
    const { inventory, place, job, crew, machine, batch } = owner;
    const spoiled = ageInventory(inventory, decayRate(place ? temperatureAt(place.site, place.x, place.y) : 20));
    if (!spoiled) continue;
    spoiledNow += spoiled;
    if (owner.retainWaste) add(inventory, { waste: spoiled }); else spill(tileAt(place), { waste: spoiled });
    if (job) { job.missingFood += spoiled; job.foodSpoiled += spoiled; job.blockedReason = 'Food spoiled; awaiting replacement supplies'; }
    if (crew && !quantity(crew.carry)) { crew.carry = null; crew.delivery = null; }
    if (batch) {
      // A spoiled medical batch cannot finish. Recover its other ingredients physically.
      spill(tileAt(place), inventory); machine.machine.batch = {}; machine.machine.progress = 0;
      for (const j of s.jobs) if (j.kind === 'operate' && j.site === place.site.id && j.x === machine.x && j.y === machine.y) j.remaining = j.work;
      machine.machine.status = 'Batch spoiled; needs fresh ingredients';
    }
  }
  for (const c of s.crew) {
    const place = c.site === 'transit' ? null : location(s, c.site, c.x, c.y), rate = decayRate(place ? temperatureAt(place.site, c.x, c.y) : 20);
    for (const meal of [c.medical, c.intent?.type === 'meal' ? c.intent : null]) {
      if (!meal?.servings) { if (meal) meal.foodAge = 0; continue; }
      meal.foodAge = (meal.foodAge || 0) + rate;
      if(meal.openedFood){const lots=foodLots(meal.openedFood);for(const l of lots)l.age+=rate;storeLots(meal.openedFood,lots);}
      if (meal.foodAge < FOOD_LIFETIME) continue;
      const amount = meal.servings / 8; spoiledNow += amount;
      if (place) spill(tileAt(place), { waste: amount }); else add(s.shuttle.supplies, { waste: amount });
      meal.servings = 0; meal.foodAge = 0;delete meal.openedFood;delete meal.qualityTotal;
    }
    // Spoilage can invalidate an expedition pickup while its owner is recovering.
    if (c.intent?.type === 'salvage') {
      const tile = s.sites[c.site].tiles[c.intent.target[1] * s.sites[c.site].size + c.intent.target[0]];
      if (!tile.drop || !contains(tile.drop, c.intent.items)) c.intent = null;
    }
  }
  s.foodSpoiled += spoiledNow;
  if (spoiledNow && !s.log.some(e => e.message.startsWith('Food spoiled') && s.tick - e.tick < 60)) {
    s.log.unshift({ tick: s.tick, message: 'Food spoiled into waste. Inspect food age and storage temperature; jobs will request replacement ingredients.', type: 'danger' }); s.log = s.log.slice(0, 60);
  }
  for (const j of s.jobs) if (j.missingFood > 1e-9) {
    const replacement = reserveConstruction(s, j.site, j.x, j.y, { food: j.missingFood }, pathTo);
    if (replacement) { j.sources.push(...replacement); j.missingFood = 0; j.blockedReason = 'Collecting replacement food'; }
  }
}
export function validateFood(s) {
  validateMeals(s,foodOwners(s));
  if (!Number.isFinite(s.foodSpoiled) || s.foodSpoiled < 0) throw new Error('Invalid spoilage history.');
  for (const c of s.crew) for (const meal of [c.medical, c.intent?.type === 'meal' ? c.intent : null]) {
    if (meal?.foodAge !== undefined && (!Number.isFinite(meal.foodAge) || meal.foodAge < 0 || meal.foodAge >= FOOD_LIFETIME)) throw new Error('Invalid opened meal age.');
  }
  for (const j of s.jobs) if (![j.missingFood, j.foodSpoiled].every(n => Number.isFinite(n) && n >= 0) || j.missingFood > (j.cost.food || 0) + 1e-8 || j.missingFood > j.foodSpoiled + 1e-8 || (j.foodSpoiled && !j.cost.food)) throw new Error('Invalid replacement food reservation.');
}

export function preserveOpenedMeal(c) {
  if (c.intent?.type !== 'meal' || !c.intent.servings) return;
  moveOpenedMeal(c.intent,c.medical);
}
export function dropOpenedMeals(s, c) {
  const portions = (c.medical.servings || 0) + (c.intent?.type === 'meal' ? c.intent.servings : 0);
  if (!portions) return;
  const items={};add(items,openedInventory(c.medical));if(c.intent?.type==='meal')add(items,openedInventory(c.intent));
  spill(s.sites[c.site].tiles[c.y * s.sites[c.site].size + c.x], items);
  for(const meal of [c.medical,c.intent?.type==='meal'?c.intent:null])if(meal){meal.servings=0;meal.foodAge=0;delete meal.openedFood;delete meal.qualityTotal;}
}
