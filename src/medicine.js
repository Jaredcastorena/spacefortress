import { tileAt, positionOf, sameCell, cellKey, validCellPosition } from './spatial.js';
import { validCrewPosition } from './crew-locations.js';
import { crewPathToPosition as crewPathTo } from './navigation.js';
import { advanceCrewRoutePositions as advanceCrewRoute } from './crew-traversal.js';
import { livingAllowed, roomBenefit } from './rooms.js';
import { thermalSafe } from './thermal.js';
import { breathable, roomAt } from './atmosphere.js';
import { remember } from './crew.js';
import { shuttlePresence } from './outposts.js';

const same = sameCell;
export function initializeMedicine(s) {
  for (const c of s.crew) {
    c.medical = { injury: 0, treated: 0, cause: null, bed: null, retryAt: 0, status: 'No injuries' };
    c.skills.medicine ??= { level: c.role === 'Medic' ? 3 : 0, xp: 0 };
    c.labors.medicine ??= true;
  }
}
export function injure(s, c, amount, cause) {
  if (c.health <= 0 || amount <= 0) return;
  const loss = Math.min(c.health, amount);
  c.health -= loss; c.medical.injury += loss; c.medical.cause = cause;
  c.medical.status = 'Needs treatment';
  remember(s, c, 'injury', `Hurt by ${cause}.`, -5);
}
export const safeBed = (site, bed) => !!site && validCellPosition(site,bed) && livingAllowed(site, bed.x, bed.y, bed.z) && tileAt(site, bed)?.building === 'medicalCot' && tileAt(site, bed).hp > 0 && breathable(roomAt(site,bed.x,bed.y,bed.z)) && thermalSafe(roomAt(site,bed.x,bed.y,bed.z));
export const boardingPatient = (s, c) => s.mission?.phase === 'boarding' && s.mission.site === c.site && s.mission.returnCrew?.includes(c.id) && shuttlePresence(s, c.site).usable;
export function treatmentPatient(s, j) {
  const c = s.crew.find(c => c.id === j.patient);
  return c && c.health > 0 && c.site === j.site && same(c.medical.bed, positionOf(j)) && safeBed(s.sites[j.site], c.medical.bed) ? c : null;
}
export function treatmentReady(s, j, worker) {
  const c = treatmentPatient(s, j);
  return !!c && worker?.site === j.site && positionOf(worker).z === positionOf(j).z && same(positionOf(c), positionOf(j)) && c.intent?.type === 'medical' && c.oxygen > 0 && c.hunger >= 35 && breathable(roomAt(s.sites[j.site],worker.x,worker.y,worker.z));
}
export function completeTreatment(s, j) {
  const c = treatmentPatient(s, j);
  if (!c) return;
  c.medical.treated = Math.min(c.medical.injury, c.medical.treated + j.dose);
  c.medical.status = 'Treatment complete; recovering';
  remember(s, c, 'medical-care', 'A crewmate treated my injuries.', 7);
}
export function prepareMedicine(s, order, cancelJob, release, pathTo) {
  for (const c of s.crew) {
    const m = c.medical, site = s.sites[c.site];
    if (m.bed && (c.health <= 0 || !site || boardingPatient(s, c) || !m.injury || !safeBed(site, m.bed) || crewPathTo(s, site, c, [m.bed]) === null)) {
      m.bed = null;
      if (c.intent?.type === 'medical') c.intent = null;
    }
  }
  for (const j of [...s.jobs]) if (j.kind === 'treat' && !treatmentPatient(s, j)) cancelJob(s, j.id, true);
  for (const c of [...s.crew].sort((a, b) => a.health - b.health || a.id.localeCompare(b.id))) {
    const m = c.medical, site = s.sites[c.site];
    if (c.rescue || c.airlockTraversal || c.health <= 0 || !site || boardingPatient(s, c) || !m.injury) continue;
    if (!m.bed && s.tick >= m.retryAt) {
      const options = site.tiles.filter(t => safeBed(site, positionOf(t)) && !s.crew.some(other => other.site === c.site && same(other.medical.bed, positionOf(t))) && !s.jobs.some(j => j.site === c.site && same(positionOf(j), positionOf(t))))
        .map(t => ({ t, path: crewPathTo(s, site, c, [positionOf(t)]) })).filter(o => o.path !== null).sort((a, b) => Number(roomBenefit(s, site, b.t, 'infirmary')) - Number(roomBenefit(s, site, a.t, 'infirmary')) || a.path.length - b.path.length);
      if (options.length) m.bed = positionOf(options[0].t);
      else m.status = 'Needs an available, reachable cot in safe air and temperature';
    }
    if (!m.bed) continue;
    // Finish held shipments and essential meals/sleep before occupying the reserved cot.
    if (!s.crew.some(other => other.rescue?.carrying && other.rescue.patient === c.id) && !c.carry && (!c.intent || ['haul', 'leisure'].includes(c.intent.type))) {
      release(s, c); c.intent = { type: 'medical', target: {...m.bed} };
    }
    if (m.injury - m.treated > 1e-8 && !s.jobs.some(j => j.site === c.site && same(positionOf(j),m.bed)) && s.tick >= m.retryAt) {
      const result = order(s, c.site, m.bed.x, m.bed.y, 'treat', c.id, m.bed.z);
      m.status = result.ok ? 'Awaiting medicine and a medic' : result.message;
    }
  }
}
export function medicalRest(s, c, site, pathTo) {
  if (c.intent?.type !== 'medical') return false;
  const m = c.medical;
  if (!safeBed(site, m.bed)) { c.intent = null; return false; }
  const path = crewPathTo(s, site, c, [m.bed]);
  if (path === null) { m.bed = null; c.intent = null; m.status = 'Cot route blocked'; return false; }
  if (path.length) { advanceCrewRoute(s, c, site, [path.at(-1)]); c.activity = 'Walking to medical cot'; return true; }
  c.energy = Math.min(100, c.energy + .5);
  c.activity = m.treated > 0 ? 'Recovering from treated injuries' : 'Waiting for medical care';
  if (m.treated > 0 && c.hunger >= 35 && c.oxygen > 0) {
    const recovered = Math.min(roomBenefit(s, site, c, 'infirmary') ? .15 : .12, m.treated, m.injury, 100 - c.health);
    c.health += recovered; m.injury = Math.max(0, m.injury - recovered); m.treated = Math.max(0, m.treated - recovered);
    if (m.injury < 1e-8) { m.injury = m.treated = 0; m.bed = null; m.cause = null; m.status = 'Recovered'; c.intent = null; remember(s, c, 'recovered', 'Recovered after medical care.', 5); }
  }
  return true;
}
export function validateMedicine(s) {
  const claims = new Set(), patients = new Set();
  for (const c of s.crew) {
    const m = c.medical;
    if (!m || ![m.injury, m.treated].every(n => Number.isFinite(n) && n >= 0 && n <= 100) || m.treated > m.injury + 1e-8 || m.injury + c.health > 100 + 1e-7 || !Number.isSafeInteger(m.retryAt) || m.retryAt < 0 || m.retryAt > s.tick + 120 || (m.cause !== null && (typeof m.cause !== 'string' || m.cause.length > 100)) || typeof m.status !== 'string' || m.status.length > 200) throw new Error('Invalid medical state.');
    if (m.bed !== null) {
      const site = s.sites[c.site], claim = validCrewPosition(site,m.bed) ? `${c.site}/${cellKey(m.bed)}` : null;
      if (!claim || claims.has(claim)) throw new Error('Invalid medical cot claim.');
      claims.add(claim);
    }
    if (c.intent?.type === 'medical' && (!same(c.intent.target, m.bed) || c.carry || !m.injury)) throw new Error('Invalid patient intention.');
  }
  for (const j of s.jobs.filter(j => j.kind === 'treat')) {
    const c = s.crew.find(c => c.id === j.patient);
    if (!s.sites[j.site] || !c || c.site !== j.site || !same(c.medical.bed, positionOf(j)) || patients.has(j.patient) || j.worker === j.patient || (j.worker && !s.crew.some(worker => worker.id === j.worker && worker.site === j.site)) || !Number.isFinite(j.dose) || j.dose <= 0 || j.dose > 25 || j.work !== 20 || j.cost.medicine !== 1 || Object.keys(j.cost).length !== 1) throw new Error('Invalid treatment order.');
    patients.add(j.patient);
  }
}
