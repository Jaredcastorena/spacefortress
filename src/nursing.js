import { openMeal, moveOpenedMeal } from './meals.js';
import { foodAge } from './food-lots.js';
import { thermalSafe } from './thermal.js';
import { roomAt, breathable, moveCrew } from './atmosphere.js';
import { safeBed, medicalRest } from './medicine.js';
import { immobile, impaired } from './mobility.js';
import { airThreshold, remember, gainExperience } from './crew.js';
import { dropCarriedMaterials } from './construction.js';

const xy = c => [c.x, c.y];
const adjacent = c => [[c.x + 1, c.y], [c.x - 1, c.y], [c.x, c.y + 1], [c.x, c.y - 1]];
export const carriedBy = (s, patient) => s.crew.find(c => c.rescue?.carrying && c.rescue.patient === patient.id);
export const atCot = (s, c) => c.site === 'surface' && c.medical.bed?.[0] === c.x && c.medical.bed?.[1] === c.y && safeBed(s.sites.surface, c.medical.bed);
export const needsNursing = (s, c) => c.health > 0 && c.site === 'surface' && (immobile(c) || atCot(s, c));
export function initializeNursing(s) {
  for (const c of s.crew) { c.rescue = null; c.medical.servings = 0; c.medical.feedRetryAt = 0; }
}
function capable(c) {
  return c.health > 0 && Math.abs(c.thermalStress) < 45 && !impaired(c) && c.labors.medicine && c.life.policy !== 'rest' && c.hunger >= 35 && c.energy >= 25 && c.oxygen >= airThreshold(c) && !c.medical.bed;
}
function destination(s, p, pathTo) {
  const site = s.sites[p.site];
  if (p.site !== 'surface') {
    const dock = site.tiles.find(t => t.building === 'dock' && t.hp > 0);
    return dock && pathTo(site, p, [xy(dock)]) !== null ? xy(dock) : null;
  }
  if (safeBed(site, p.medical.bed) && pathTo(site, p, [p.medical.bed]) !== null) return [...p.medical.bed];
  const cells = site.rooms.filter(r => breathable(r) && thermalSafe(r)).flatMap(r => r.cells.map(k => k.split(',').map(Number)));
  const route = pathTo(site, p, cells);
  return route === null ? null : route.length ? route.at(-1) : xy(p);
}
export function feedPatient(s, j) {
  const p = s.crew.find(c => c.id === j.patient);
  return p && needsNursing(s, p) && p.x === j.x && p.y === j.y && !carriedBy(s, p) && p.medical.servings === 0 ? p : null;
}
export function completeFeeding(s, j) {
  const p = feedPatient(s, j); if (!p) return;
  p.medical.servings = 8; openMeal(s,p,p.medical,j.materials);
  remember(s, p, 'nursed-meal', 'A crewmate brought food while I could not fetch a meal.', 6);
}
export function reconcileNursing(s, cancelJob) {
  for (const c of s.crew) if (c.rescue) {
    const p = s.crew.find(p => p.id === c.rescue.patient);
    if (!p || p.health <= 0 || c.health <= 0 || c.site !== p.site || c.site === 'transit' || !capable(c)) {c.rescue = null;}
  }
  for (const j of [...s.jobs]) if (j.kind === 'feed' && !feedPatient(s, j)) cancelJob(s, j.id, true);
}
export function prepareNursing(s, order, cancelJob, release, pathTo) {
  reconcileNursing(s, cancelJob);
  for (const p of s.crew) if (p.health > 0 && p.site !== 'transit' && immobile(p)) {
    release(s, p);
    // Incapacitated carriers put their supplies down at their actual position.
    if (p.carry) dropCarriedMaterials(s, p);
    if (p.intent?.type !== 'medical' && !(p.intent?.type === 'meal' && p.intent.servings > 0)) p.intent = null;
  }
  for (const p of [...s.crew].filter(p => p.health > 0 && p.site !== 'transit' && immobile(p)).sort((a, b) => a.health - b.health || a.id.localeCompare(b.id))) {
    if (s.crew.some(c => c.rescue?.patient === p.id)) continue;
    const target = destination(s, p, pathTo);
    if (!target || (p.x === target[0] && p.y === target[1])) continue;
    const site = s.sites[p.site];
    const helpers = s.crew.filter(c => c.id !== p.id && c.site === p.site && capable(c) && !c.rescue && !c.carry && (!c.intent || ['haul', 'leisure', 'salvage'].includes(c.intent.type)))
      .map(c => ({ c, path: pathTo(site, c, adjacent(p)) })).filter(o => o.path !== null)
      .sort((a, b) => a.path.length - b.path.length || b.c.skills.medicine.level - a.c.skills.medicine.level || a.c.id.localeCompare(b.c.id));
    if (!helpers.length) { p.medical.status = 'Waiting for an available rescuer assigned to medicine'; continue; }
    const c = helpers[0].c; release(s, c); c.intent = null; c.rescue = { patient: p.id, carrying: false }; p.medical.status = 'Rescuer approaching';
  }
  for (const p of s.crew) if (needsNursing(s, p) && !carriedBy(s, p) && p.hunger < 45 && s.tick >= p.medical.feedRetryAt && !p.medical.servings && !(p.intent?.type === 'meal' && p.intent.servings > 0) && !s.jobs.some(j => j.kind === 'feed' && j.patient === p.id)) {
    const result = order(s, 'surface', p.x, p.y, 'feed', p.id);
    if (!result.ok && p.hunger < 35) p.medical.status = `Needs food: ${result.message}`;
  }
  // A sole medic must be able to feed the patient whose treatment is waiting for food.
  for (const meal of s.jobs.filter(j => j.kind === 'feed' && !j.worker)) {
    const p = s.crew.find(c => c.id === meal.patient);
    const treatment = s.jobs.find(j => j.kind === 'treat' && j.patient === meal.patient);
    const worker = s.crew.find(c => c.id === treatment?.worker);
    if (p.hunger < 35 && worker && !worker.carry) release(s, worker);
  }
}
export function rescue(s, c, site, pathTo) {
  const r = c.rescue; if (!r) return false;
  const p = s.crew.find(p => p.id === r.patient);
  if (!p || p.health <= 0 || !capable(c) || c.site !== p.site) { c.rescue = null; return false; }
  if (!r.carrying) {
    const route = pathTo(site, c, adjacent(p));
    if (route === null) { c.rescue = null; c.activity = 'Rescue route blocked'; return true; }
    if (route.length) { moveCrew(c, site, route[0]); c.activity = `Reaching ${p.name.split(' ')[0]} for rescue`; return true; }
    if (p.carry) dropCarriedMaterials(s, p);
    // Pickup crosses only the one adjacent tile separating patient and rescuer.
    p.x = c.x; p.y = c.y;
    if (p.intent?.type === 'meal' && p.intent.servings > 0) { moveOpenedMeal(p.intent,p.medical); }
    p.intent = null; r.carrying = true;
    c.activity = `Lifting ${p.name.split(' ')[0]}`; p.activity = `Being carried by ${c.name.split(' ')[0]}`; return true;
  }
  const target = destination(s, p, pathTo);
  const route = target && pathTo(site, c, [target]);
  if (route === null || !target) { c.activity = 'Rescue destination blocked; holding patient'; return true; }
  if (route.length) {
    moveCrew(c, site, route[0]); p.x = c.x; p.y = c.y;
    c.activity = `Carrying ${p.name.split(' ')[0]} to ${c.site === 'surface' ? 'shelter' : 'shuttle'}`;
    p.activity = `Being carried by ${c.name.split(' ')[0]}`; return true;
  }
  c.rescue = null; p.medical.status = atCot(s, p) ? 'Delivered to medical cot' : 'Delivered to shelter';
  gainExperience(c, 'medicine', 5); remember(s, p, 'rescued', `${c.name} carried me to safety.`, 8);
  c.activity = 'Patient delivered'; return true;
}
export function dependentCare(s, c, site, pathTo, release) {
  const carrier = carriedBy(s, c);
  if (carrier) { c.activity = `Being carried by ${carrier.name.split(' ')[0]}`; return true; }
  if (!immobile(c) && !atCot(s, c)) return false;
  release(s, c);
  if (c.intent?.type === 'meal' && c.intent.servings > 0) return false; // Finish a ration already paid for.
  if (atCot(s, c)) {
    c.intent = { type: 'medical', target: [...c.medical.bed] };
    medicalRest(s, c, site, pathTo);
    if (c.hunger < 35) c.activity = 'Waiting for a bedside meal';
    return true;
  }
  c.intent = null; c.activity = 'Unable to walk; needs rescue';
  if (breathable(roomAt(site, c.x, c.y))) c.energy = Math.min(100, c.energy + .18);
  return true;
}
export function validateNursing(s) {
  const claims = new Set(), meals = new Set();
  for (const c of s.crew) {
    if (!Number.isSafeInteger(c.medical.feedRetryAt) || c.medical.feedRetryAt < 0 || c.medical.feedRetryAt > s.tick + 120 || !Number.isInteger(c.medical.servings) || c.medical.servings < 0 || c.medical.servings > 8) throw new Error('Invalid nursing meal.');
    const r = c.rescue;
    if (r !== null) {
      const p = s.crew.find(p => p.id === r?.patient);
      if (!r || !p || p.id === c.id || c.site === 'transit' || c.site !== p.site || c.job || c.intent || c.carry || p.rescue || claims.has(p.id) || typeof r.carrying !== 'boolean' || (r.carrying && (p.x !== c.x || p.y !== c.y || p.carry))) throw new Error('Invalid patient transport.');
      claims.add(p.id);
    }
  }
  for (const j of s.jobs.filter(j => j.kind === 'feed')) {
    if (j.site !== 'surface' || !s.crew.some(c => c.id === j.patient && c.site === 'surface') || meals.has(j.patient) || j.worker === j.patient || j.work !== 8 || Object.keys(j.cost).length !== 1 || j.cost.food !== 1) throw new Error('Invalid bedside meal order.');
    meals.add(j.patient);
  }
}
