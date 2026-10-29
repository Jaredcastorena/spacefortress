import {TOOL_RECIPES,DEFAULT_TOOL_RECIPE,isTool} from './tool-data.js';
import {finishToolBatch} from './tools.js';
import { sameCell, positionOf, tileAt, horizontalNeighbors, cellKey } from './spatial.js';
import { crewPathToPosition } from './navigation.js';
import { advanceCrewRoutePositions } from './crew-traversal.js';
import { rawFood, preparedFood, foodOfKind, foodLots, planFoodSelection, typedFood } from './food-lots.js';
import { CROPS, MEAL_RECIPES, FOOD_KINDS, DEFAULT_CROP, DEFAULT_MEAL } from './food-data.js';
import { cookMeal } from './meals.js';
import { craftKeepsake } from './possessions.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { cropRoomBlock } from './rooms.js';
import { temperatureAt } from './thermal.js';
import { RECIPES, BUILDINGS } from './data.js';
import { add, extract, contains, quantity, spill, OUTPUT_CAPACITY, initializeStorage } from './inventory.js';
import { hasOutgoingInventory } from './inventory-reservations.js';
import { breathable, roomAt } from './atmosphere.js';
import { workRate, gainExperience, remember, workReadiness } from './crew.js';

export const staffed = t => !!RECIPES[t.building] && !RECIPES[t.building].lifeSupport && !RECIPES[t.building].automatic;
export const newProductionOrder = () => ({ mode: 'continuous', limit: 0, remaining: 0, priority: 1 });
const recipeMachine = t => t.building === 'farm' || t.building === 'galley' || t.building === 'toolbench';
const recipesFor = t => t.building === 'farm' ? CROPS : t.building === 'galley' ? MEAL_RECIPES : t.building === 'toolbench' ? TOOL_RECIPES : null;
export function recipeFor(t, phase = 'active') {
  const registry = recipesFor(t);
  if (!registry) return RECIPES[t.building];
  const selected = t.machine?.recipeId || (t.building === 'farm' ? DEFAULT_CROP : t.building === 'toolbench' ? DEFAULT_TOOL_RECIPE : DEFAULT_MEAL);
  const id = phase === 'active' && quantity(t.machine?.batch) ? t.machine.batchRecipeId || selected : selected;
  const recipe = Object.hasOwn(registry, id) ? registry[id] : undefined;
  return id === 'legacy_crop' && t.machine?.legacyCrop && phase === 'active' && recipe ? { ...recipe, input: { water: 1 } } : recipe;
}
const foodSelector = recipe => ({ rawOnly: true, ...(recipe.foodKinds ? { foodKinds: recipe.foodKinds } : {}) });
export function initializeProduction(s) {
  for (const c of s.crew) {
    c.skills.production ??= { level: c.role === 'Botanist' || c.role === 'Technician' ? 3 : c.role === 'Engineer' ? 2 : 0, xp: 0 };
    c.labors.production ??= true;
  }
  for (const site of Object.values(s.sites)) for (const t of site.tiles) if (staffed(t)) {
    initializeStorage(t); t.machine.order ??= newProductionOrder(); t.machine.completed ??= 0;
    if (s.version === 40 && recipeMachine(t) && quantity(t.machine.batch)) t.machine.batchRecipeId ??= t.building === 'farm' ? 'legacy_crop' : DEFAULT_MEAL;
  }
}
const operationAt = (s, site, t) => s.jobs.find(j => j.kind === 'operate' && j.site === site.id && sameCell(positionOf(j),positionOf(t)));
const outputResource = t => Object.keys(recipeFor(t, 'selected').output)[0];
const matchesProduct = (candidate, desired) => !desired || (desired.outputKind ? candidate?.outputKind === desired.outputKind : desired.material ? candidate?.material === desired.material && candidate?.toolKind === desired.toolKind : desired.id && MEAL_RECIPES[desired.id] ? candidate?.id === desired.id : true);
function productAmount(inventory, resource, preparedOnly, recipe) {
  if(resource==='tools'&&recipe?.material)return (inventory?._items||[]).filter(i=>i.kind===recipe.toolKind&&i.material===recipe.material).length;
  if (recipe?.outputKind) return foodOfKind(inventory, recipe.outputKind);
  if (recipe?.id && MEAL_RECIPES[recipe.id]) return foodLots(inventory).reduce((n, lot) => n + (lot.meal && (lot.meal.recipeId || DEFAULT_MEAL) === recipe.id ? lot.amount : 0), 0);
  return preparedOnly ? preparedFood(inventory) : inventory?.[resource] || 0;
}
// Count available products once, including goods en route to storage and promised batch output.
// Ingredients and construction/shuttle reservations are already committed to another purpose.
export function projectedStock(s, site, resource, ignorePending = null, preparedOnly = false, recipe = null) {
  let total = 0;
  const amount = inventory => productAmount(inventory, resource, preparedOnly, recipe);
  for (const t of site.tiles) {
    total += amount(t.stock) + amount(t.drop) + amount(t.machine?.output) + (t.building === 'dock' ? amount(t.imports) : 0);
    if ((!preparedOnly || t.building==='galley') && staffed(t)) {
      const active=recipeFor(t);
      // Repair preserves an existing tool, so count its committed identity and
      // properties, never infer a new tool from the selected future recipe.
      if(active.repair){if(resource==='tools'&&quantity(t.machine?.batch))total+=amount(t.machine.batch);}
      else if(matchesProduct(active,recipe)&&(quantity(t.machine?.batch)||(t!==ignorePending&&operationAt(s,site,t))))total+=active.output[resource]||0;
    }
  }
  for (const c of s.crew) if (c.site === site.id && c.carry && (!c.delivery || c.delivery.kind === 'stock')) total += amount(c.carry);
  return total;
}
export function inputBatchesWanted(s, site, t) {
  const recipe = recipeFor(t, 'selected'), m = t.machine;
  if (!recipe || !m?.enabled) return 0;
  if (recipe.lifeSupport || recipe.automatic || m.order.mode === 'continuous') return 2;
  if (m.order.mode === 'batches') return Math.min(2, Math.max(0, m.order.remaining - (quantity(m.batch) ? 1 : 0)));
  const resource = outputResource(t);
  return Math.min(2, Math.max(0, Math.ceil((m.order.limit - projectedStock(s, site, resource, t, t.building==='galley', recipeMachine(t) ? recipe : null)) / recipe.output[resource])));
}
function wanted(s, site, t) {
  const m = t.machine;
  if (quantity(m.batch)) return true; // Finish already committed ingredients under any revised order.
  if (m.order.mode === 'continuous') return true;
  if (m.order.mode === 'batches') return m.order.remaining > 0;
  return projectedStock(s, site, outputResource(t), t, t.building==='galley', recipeMachine(t) ? recipeFor(t, 'selected') : null) < m.order.limit;
}
const eligibleOperators = (s, site, t, recipe) => s.crew.filter(c => c.site === site.id && c.health > 0 && c.labors?.production && (c.skills?.production?.level || 0) >= (recipe.minSkill || 0) && (positionOf(c).z === positionOf(t).z || crewPathToPosition(s,site,c,horizontalNeighbors(positionOf(t))) !== null));
function productionReason(s, site, t, recipe = recipeFor(t), checkLabor = true) {
  const block = (blockedCode, message) => ({ blockedCode, message });
  if (!staffed(t) || !t.machine) return block('unavailable', 'Workstation no longer exists');
  if (!recipe) return block('invalid_recipe', 'Choose a valid production recipe');
  const m = t.machine;
  if(t.fire)return block('fire', 'Fire at workstation');
  if (!m.enabled) return block('paused', 'Paused by player');
  if (s.jobs.some(j => j.site === site.id && sameCell(positionOf(j),positionOf(t)) && !['operate', 'feed', 'hygiene'].includes(j.kind))) return block('reserved', 'Reserved for construction or service');
  if (!t.hp) return block('repair', 'Needs repair');
  const roomBlock = cropRoomBlock(s, site, t); if (roomBlock) return block('room', roomBlock);
  if (!wanted(s, site, t)) return block('order_complete', m.order.mode === 'batches' ? 'Requested batches complete' : 'Stock target met');
  if (!t.powered) return block('power', 'No power');
  if (recipe.air && (!breathable(roomAt(site,t.x,t.y,t.z)) || (roomAt(site,t.x,t.y,t.z)?.air || 0) <= recipe.air)) return block('air', 'Needs breathable atmosphere');
  if (recipe.temperature) { const temp = temperatureAt(site,t.x,t.y,t.z); if (temp < recipe.temperature[0] || temp > recipe.temperature[1]) return block('temperature', `Needs ${recipe.temperature[0]}–${recipe.temperature[1]} °C`); }
  if (quantity(m.output) + quantity(recipe.output) > OUTPUT_CAPACITY) return block('output_full', 'Output full; needs hauling');
  if (checkLabor && !eligibleOperators(s, site, t, recipe).length) return block('no_qualified_operator', recipe.minSkill ? `Needs a local Production ${recipe.minSkill} operator with production labor enabled` : 'No local crew with production labor enabled');
  if (!quantity(m.batch) && t.building==='galley' && planFoodSelection(m.input, recipe.input.food, foodSelector(recipe)) === null) {
    const missing = recipe.foodKinds && Object.entries(recipe.foodKinds).filter(([kind, n]) => foodOfKind(m.input, kind) + 1e-9 < n).map(([kind]) => FOOD_KINDS[kind].name);
    return block('ingredients', missing?.length ? `Waiting for ingredients: ${missing.join(', ')}` : 'Waiting for unprepared food delivery');
  }
  if(!quantity(m.batch)&&recipe.repair&&!m.input._items?.some(i=>isTool(i)&&i.condition<100))return block('tool_condition','Waiting for a worn tool');
  if (!quantity(m.batch) && !contains(m.input, recipe.input)) return block('inputs', `Waiting for input delivery: ${Object.entries(recipe.input).filter(([r, n]) => (m.input[r] || 0) < n).map(([r]) => r).join(', ')}`);
  return null;
}
// An unstaffed queued operation still reserves its promised stock output. Skill
// is enforced when assigning/operating, while eligibility explains the wait.
export const productionBlock = (s, site, t) => productionReason(s, site, t, recipeFor(t), false)?.message || null;
export function productionEligibility(s, site, t, recipeId) {
  const registry = recipesFor(t), recipe = recipeId === undefined ? recipeFor(t) : registry && Object.hasOwn(registry, recipeId) ? registry[recipeId] : undefined;
  const result = { recipeId: recipe?.id || recipeId || t.building, minSkill: recipe?.minSkill || 0, eligibleCrewIds: [], crewReadiness: [], availableCrewIds: [], requirements: [], blockedCode: null, message: null };
  if (!recipe || !t.machine) return { ...result, blockedCode: 'invalid_recipe', message: 'Choose a valid production recipe' };
  const operators = eligibleOperators(s, site, t, recipe); result.eligibleCrewIds = operators.map(c => c.id);
  result.crewReadiness = operators.map(c => ({ id: c.id, ...workReadiness(c) }));
  result.availableCrewIds = result.crewReadiness.filter(c => c.available).map(c => c.id);
  const source = quantity(t.machine.batch) && recipeFor(t)?.id === recipe.id ? t.machine.batch : t.machine.input;
  const requirement = (resource, required, kind) => {
    const count = inv => kind ? foodOfKind(inv, kind) : resource === 'food' && t.building === 'galley' ? rawFood(inv) : inv?.[resource] || 0;
    const delivered = count(source);
    let available = 0;
    for (const tile of site.tiles) {
      const stores = ['stock', 'imports'].filter(slot => count(tile[slot]) > 0 && !hasOutgoingInventory(s, site.id, positionOf(tile), slot));
      if (!stores.length) continue;
      if (positionOf(tile).z === positionOf(t).z || crewPathToPosition(s,site,tile,[positionOf(t)]) !== null) for (const slot of stores) available += count(tile[slot]);
    }
    result.requirements.push({ resource, ...(kind ? { kind } : {}), required, delivered, available, missing: Math.max(0, required - delivered - available) });
  };
  for (const [resource, required] of Object.entries(recipe.input)) {
    if (resource === 'food' && recipe.foodKinds) for (const [kind, n] of Object.entries(recipe.foodKinds)) requirement(resource, n, kind);
    else requirement(resource, required);
  }
  const reason = productionReason(s, site, t, recipe);
  if (reason) Object.assign(result, reason);
  else {
    const job = operationAt(s, site, t);
    if (operators.length && operators.every(c => c.job && c.job !== job?.id || c.intent)) Object.assign(result, { blockedCode: 'busy', message: 'Qualified production operators are busy' });
    else if (!result.availableCrewIds.length && !operators.some((c, i) => job?.worker === c.id && c.job === job.id && result.crewReadiness[i].blockers.every(blocker => blocker === 'assigned_job'))) {
      Object.assign(result, { blockedCode: 'operators_unavailable', message: 'Qualified production operators are not ready for work' });
    }
  }
  return result;
}
export function releaseOperation(s, j) {
  for (const c of s.crew) if (c.job === j.id) { c.job = null; c.activity = 'Production interrupted'; }
  s.jobs = s.jobs.filter(other => other.id !== j.id);
}
export function releaseOperationsAt(s, siteId, x, y,z=0) {
  for (const j of [...s.jobs]) if (j.kind === 'operate' && j.site === siteId && sameCell(positionOf(j),{x,y,z})) releaseOperation(s, j);
}
export function scheduleProduction(s, order) {
  for (const j of [...s.jobs]) if (j.kind === 'operate') {
    const site = s.sites[j.site], t = tileAt(site,positionOf(j));
    if (t.building !== j.building || productionBlock(s, site, t)) releaseOperation(s, j);
  }
  for (const site of Object.values(s.sites)) for (const t of site.tiles) if (staffed(t)) {
    initializeStorage(t); const m = t.machine, blocked = productionBlock(s, site, t);
    if (blocked) { m.status = blocked; continue; }
    let j = operationAt(s, site, t);
    if (!j) { const result = order(s, site.id, t.x, t.y, 'operate', t.building, positionOf(t).z); if (result.ok) j = result.job; else m.status = result.message; }
    if (j) m.status = j.worker ? 'Operator assigned' : j.blockedReason || 'Waiting for a production operator';
  }
}
export function operateMachine(s, c, j, site, pathTo) {
  const t = tileAt(site,positionOf(j)), m = t.machine, blocked = productionBlock(s, site, t);
  if (blocked || t.building !== j.building) { if (m) m.status = blocked || 'Workstation replaced'; releaseOperation(s, j); return; }
  const recipe = recipeFor(t);
  if (!eligibleOperators(s, site, t, recipe).includes(c)) { c.job = null; j.worker = null; j.blockedReason = m.status = `Needs a Production ${recipe.minSkill || 0} operator`; return; }
  const goals = horizontalNeighbors(positionOf(t)), route = crewPathToPosition(s, site, c, goals);
  if (route === null) { c.job = null; j.worker = null; j.blockedReason = m.status = c.activity = 'Workstation route blocked'; return; }
  if (route.length) { advanceCrewRoutePositions(s, c, site, [route.at(-1)]); c.activity = `Going to ${BUILDINGS[t.building].name.toLowerCase()}`; return; }
  if (!quantity(m.batch)) {
    const request=recipe.repair?{...recipe.input,_items:[m.input._items?.find(i=>isTool(i)&&i.condition<100)]}:recipe.input;
    const batch = extract(m.input, request, t.building === 'galley' ? foodSelector(recipe) : false); if (!batch) return;
    m.batch = batch; if (recipeMachine(t)) m.batchRecipeId = recipe.id;
    m.progress = 0;
    emitEvent(s,'production.batch.started',{entity:tileEntityId(site.id,t.x,t.y,positionOf(t).z),actor:c.id,job:j.id,recipe:t.building,...(recipe.id ? { recipeId: recipe.id } : {}),input:batch});
  }
  const effort = Math.min(recipe.duration - m.progress, workRate(c, 'production'));
  m.progress += effort; j.remaining = Math.max(0, recipe.duration - m.progress); gainExperience(c, 'production', effort);
  c.activity = `Operating ${BUILDINGS[t.building].name.toLowerCase()}`; m.status = 'Processing with operator'; j.blockedReason = null;
  if (j.remaining < 1e-9) {
    const output = t.building === 'galley' ? cookMeal(s,c,j,m.batch,recipe.id) : t.building === 'farm' ? recipe.id === 'legacy_crop' ? { ...recipe.output } : typedFood(recipe.outputKind, recipe.output.food) : t.building === 'artisan' ? craftKeepsake(s,c) : t.building === 'toolbench' ? finishToolBatch(s,c,recipe,m.batch) : recipe.output;
    add(m.output, output); m.batch = {}; delete m.legacyCrop; delete m.batchRecipeId; m.progress = 0; m.completed++;
    if (m.order.mode === 'batches') m.order.remaining = Math.max(0, m.order.remaining - 1);
    m.status = 'Batch complete; output awaiting haul';
    emitEvent(s,'production.batch.completed',{entity:tileEntityId(site.id,t.x,t.y,positionOf(t).z),actor:c.id,job:j.id,recipe:t.building,...(recipe.id ? { recipeId: recipe.id } : {}),output});
    remember(s, c, 'production-work', 'Completed a production batch for the colony.', 3); releaseOperation(s, j); c.activity = 'Production batch complete';
  }
}
export function setProductionRecipe(s, siteId, x, y, recipeId,z=0) {
  const site = s.sites[siteId], t = tileAt(site,{x,y,z}), registry = t && recipesFor(t);
  if (!registry || !t.machine || !Object.hasOwn(registry, recipeId) || registry[recipeId].selectable === false) return { ok: false, message: 'Choose an available production recipe.' };
  const m = t.machine, recipe = registry[recipeId];
  if(recipe.repair&&m.order.mode==='stock')return {ok:false,message:'Use a batch or continuous order for tool repair.'};
  if (m.recipeId === recipeId) return { ok: true };
  const previous = m.recipeId;
  // Keep compatible waiting stock up to the next recipe's two-batch buffer.
  // Everything else is still physical inventory and can be hauled from here.
  const retained = {}, kinds = {};
  for (const [resource, n] of Object.entries(recipe.input)) {
    if (resource === 'food' && recipe.foodKinds) {
      for (const [kind, required] of Object.entries(recipe.foodKinds)) {
        const amount = Math.min(foodOfKind(m.input, kind), required * 2);
        if (amount > 0) kinds[kind] = amount;
      }
      const amount = Object.values(kinds).reduce((sum, n) => sum + n, 0); if (amount) retained.food = amount;
    } else {
      const amount = Math.min(resource === 'food' ? rawFood(m.input) : m.input[resource] || 0, n * 2);
      if (amount) retained[resource] = amount;
    }
  }
  const keep = extract(m.input, retained, retained.food ? { rawOnly: true, ...(recipe.foodKinds ? { foodKinds: kinds } : {}) } : false);
  if (!keep) return { ok: false, message: 'Waiting inputs changed; retry recipe selection.' };
  spill(t, m.input); m.input = keep; m.recipeId = recipeId;
  for (const c of s.crew) {
    const intent = c.intent, target = intent?.destination;
    if (c.site === siteId && !c.carry && intent?.type === 'haul' && target?.kind === 'input' && sameCell(target.target, {x,y,z})) c.intent = null;
  }
  if (!quantity(m.batch)) releaseOperationsAt(s, siteId, x, y, z);
  m.status = quantity(m.batch) ? 'Recipe selected; finishing current batch' : 'Recipe selected; waiting for ingredients';
  emitEvent(s, 'production.recipe.selected', { entity: tileEntityId(siteId,x,y,z), previous, recipeId, batchRecipeId: m.batchRecipeId || null });
  return { ok: true };
}
export function setProductionOrder(s, siteId, x, y, mode, limit,z=0) {
  const site = s.sites[siteId], t = tileAt(site,{x,y,z});
  if (!t || !staffed(t) || !t.machine || !['continuous', 'batches', 'stock'].includes(mode) || !Number.isInteger(limit) || limit < 0 || limit > 1000) return { ok: false, message: 'Choose continuous, batches, or stock and a whole-number amount from 0 to 1000.' };
  if(mode==='stock'&&recipeFor(t,'selected').repair)return {ok:false,message:'Use a batch or continuous order for tool repair.'};
  const m = t.machine; m.order = { mode, limit: mode === 'continuous' ? 0 : limit, remaining: mode === 'batches' ? limit : 0, priority: m.order.priority };
  if (!wanted(s, site, t)) releaseOperationsAt(s, siteId, x, y, z);
  m.status = quantity(m.batch) ? 'Order changed; retaining current batch' : 'Production order updated'; return { ok: true };
}
export function setProductionPriority(s, siteId, x, y, priority,z=0) {
  const site = s.sites[siteId], t = tileAt(site,{x,y,z});
  if (!t || !staffed(t) || !t.machine || ![1, 3, 5].includes(priority)) return { ok: false, message: 'Choose a workstation and a valid work priority.' };
  t.machine.order.priority = priority; const j = operationAt(s, site, t); if (j) j.priority = priority; return { ok: true };
}
export function validateProduction(s) {
  const seen = new Set();
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    if (!staffed(t)) continue;
    const m = t.machine, o = m.order;
    if(t.building==='galley'&&(preparedFood(m.input)>0||preparedFood(m.batch)>0||rawFood(m.output)>0))throw new Error('Invalid galley food state.');
    if (recipeMachine(t)) {
      const registry = recipesFor(t), selected = registry[m.recipeId];
      if (!Object.hasOwn(registry, m.recipeId) || selected.selectable === false) throw new Error('Invalid selected production recipe.');
      if (quantity(m.batch) ? !Object.hasOwn(registry, m.batchRecipeId) : m.batchRecipeId !== undefined) throw new Error('Invalid committed production recipe.');
      if (t.building === 'galley') {
        if (selected.foodKinds && foodLots(m.input).some(lot => !selected.foodKinds[lot.kind || 'ration']) || selected.foodKinds && Object.entries(selected.foodKinds).some(([kind, n]) => foodOfKind(m.input, kind) > n * 2 + 1e-9)) throw new Error('Invalid selected recipe ingredients.');
        if (quantity(m.batch) && planFoodSelection(m.batch, recipeFor(t).input.food, foodSelector(recipeFor(t))) === null) throw new Error('Invalid committed recipe ingredients.');
      }
    } else if (m.recipeId !== undefined || m.batchRecipeId !== undefined) throw new Error('Recipe selection on unsupported machine.');
    if(recipeFor(t,'selected').repair&&o?.mode==='stock')throw new Error('Invalid repair stock target.');
    if(recipeFor(t).repair&&quantity(m.batch)&&!m.batch._items?.some(i=>isTool(i)&&i.condition<100))throw new Error('Invalid committed tool repair.');
    if (!o || !['continuous', 'batches', 'stock'].includes(o.mode) || !Number.isInteger(o.limit) || o.limit < 0 || o.limit > 1000 || !Number.isInteger(o.remaining) || o.remaining < 0 || o.remaining > o.limit || (o.mode !== 'batches' && o.remaining !== 0) || (o.mode === 'continuous' && o.limit !== 0) || ![1, 3, 5].includes(o.priority) || !Number.isSafeInteger(m.completed) || m.completed < 0) throw new Error('Invalid production order.');
  }
  for (const j of s.jobs.filter(j => j.kind === 'operate')) {
    const site = s.sites[j.site], t = tileAt(site,positionOf(j)), key = `${j.site}/${cellKey(positionOf(j))}`;
    if (!staffed(t) || t.building !== j.building || seen.has(key) || quantity(j.cost) || quantity(j.materials) || j.sources.length || j.work !== recipeFor(t).duration || Math.abs(j.remaining - (j.work - t.machine.progress)) > 1e-7 || j.priority !== t.machine.order.priority) throw new Error('Invalid production assignment.');
    seen.add(key);
  }
}
