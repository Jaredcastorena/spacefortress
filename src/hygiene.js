import { needsNursing, carriedBy } from './nursing.js';
import { breathable, roomAt } from './atmosphere.js';
import { thermalSafe } from './thermal.js';
import { remember } from './crew.js';
import { CARRY_CAPACITY, quantity } from './inventory.js';

export const HYGIENE_WORK = 8;
export const HYGIENE_RETRY = 120;
export function initializeHygiene(s) {
  for (const c of s.crew) c.sanitation.retryAt ??= 0;
}
export function hygienePatient(s, j) {
  const p = s.crew.find(c => c.id === j.patient);
  return p && p.site === j.site && needsNursing(s, p) && !carriedBy(s, p) && p.x === j.x && p.y === j.y && p.sanitation.waste >= .5 ? p : null;
}
export function hygieneReady(s, j, worker) {
  const p = hygienePatient(s, j), site = s.sites[j.site];
  return !!p && worker.site === j.site && !worker.carry && breathable(roomAt(site, p.x, p.y)) && thermalSafe(roomAt(site, p.x, p.y)) && breathable(roomAt(site, worker.x, worker.y)) && thermalSafe(roomAt(site, worker.x, worker.y));
}
export function completeHygiene(s, j, worker) {
  const p = hygienePatient(s, j);
  if (!p || worker.site !== j.site || worker.carry) return;
  const amount = Math.min(CARRY_CAPACITY, p.sanitation.waste);
  p.sanitation.waste -= amount;
  if (p.sanitation.waste < .5) p.sanitation.wait = 0;
  worker.carry = { waste: amount }; worker.delivery = null;
  remember(s, p, 'assisted-hygiene', 'A crewmate helped with personal care while I could not leave my bed.', 6);
  remember(s, worker, 'provided-hygiene', 'Helped a crewmate with personal care.', 3);
}
export function reconcileHygiene(s, cancelJob) {
  for (const j of [...s.jobs]) if (j.kind === 'hygiene' && !hygienePatient(s, j)) cancelJob(s, j.id, true);
}
export function prepareHygiene(s, order, cancelJob, release) {
  reconcileHygiene(s, cancelJob);
  for (const p of s.crew) if (needsNursing(s, p) && p.sanitation.waste >= .5 && s.tick >= p.sanitation.retryAt && !s.crew.some(c => c.rescue?.patient === p.id) && !s.jobs.some(j => j.kind === 'hygiene' && j.patient === p.id)) order(s, p.site, p.x, p.y, 'hygiene', p.id);
  // Let a sole medic interrupt nonurgent treatment when an overflow is approaching.
  // A hungry patient's meal retains precedence over hygiene.
  for (const j of s.jobs.filter(j => j.kind === 'hygiene' && !j.worker)) {
    const p = hygienePatient(s, j);
    if (!p || p.sanitation.wait < 60 || p.hunger < 35) continue;
    const treatment = s.jobs.find(j => j.kind === 'treat' && j.patient === p.id);
    const worker = s.crew.find(c => c.id === treatment?.worker);
    if (worker && !worker.carry) release(s, worker);
  }
}
export function validateHygiene(s) {
  for (const c of s.crew) if (!Number.isSafeInteger(c.sanitation.retryAt) || c.sanitation.retryAt < 0 || c.sanitation.retryAt > s.tick + HYGIENE_RETRY) throw new Error('Invalid hygiene retry time.');
  const patients = new Set();
  for (const j of s.jobs.filter(j => j.kind === 'hygiene')) {
    if (!s.sites[j.site] || !s.crew.some(c => c.id === j.patient && c.site === j.site) || patients.has(j.patient) || j.worker === j.patient || (j.worker && !s.crew.some(worker => worker.id === j.worker && worker.site === j.site)) || j.work !== HYGIENE_WORK || quantity(j.cost) || quantity(j.materials) || j.sources.length || j.building !== null) throw new Error('Invalid bedside hygiene order.');
    patients.add(j.patient);
  }
}
