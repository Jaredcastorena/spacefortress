import { livingAllowed, roomBenefit } from './rooms.js';
import { thermalSafe } from './thermal.js';
import { breathable, roomAt, moveCrew } from './atmosphere.js';
import { remember } from './crew.js';

const tileAt = (site, xy) => site.tiles[xy[1] * site.size + xy[0]];
const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
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
export const safeBed = (site, bed) => bed && livingAllowed(site, ...bed) && tileAt(site, bed)?.building === 'medicalCot' && tileAt(site, bed).hp > 0 && breathable(roomAt(site, ...bed)) && thermalSafe(roomAt(site, ...bed));
export function treatmentPatient(s, j) {
  const c = s.crew.find(c => c.id === j.patient);
  return c && c.health > 0 && c.site === 'surface' && same(c.medical.bed, [j.x, j.y]) && safeBed(s.sites.surface, c.medical.bed) ? c : null;
}
export function treatmentReady(s, j, worker) {
  const c = treatmentPatient(s, j);
  return !!c && c.x === j.x && c.y === j.y && c.intent?.type === 'medical' && c.oxygen > 0 && c.hunger >= 35 && breathable(roomAt(s.sites.surface, worker.x, worker.y));
}
export function completeTreatment(s, j) {
  const c = treatmentPatient(s, j);
  if (!c) return;
  c.medical.treated = Math.min(c.medical.injury, c.medical.treated + j.dose);
  c.medical.status = 'Treatment complete; recovering';
  remember(s, c, 'medical-care', 'A crewmate treated my injuries.', 7);
}
export function prepareMedicine(s, order, cancelJob, release, pathTo) {
  const site = s.sites.surface;
  for (const c of s.crew) {
    const m = c.medical;
    if (m.bed && (c.health <= 0 || c.site !== 'surface' || !m.injury || !safeBed(site, m.bed) || pathTo(site, c, [m.bed]) === null)) {
      m.bed = null;
      if (c.intent?.type === 'medical') c.intent = null;
    }
  }
  for (const j of [...s.jobs]) if (j.kind === 'treat' && !treatmentPatient(s, j)) cancelJob(s, j.id, true);
  for (const c of [...s.crew].sort((a, b) => a.health - b.health || a.id.localeCompare(b.id))) {
    const m = c.medical;
    if (c.rescue || c.health <= 0 || c.site !== 'surface' || !m.injury) continue;
    if (!m.bed && s.tick >= m.retryAt) {
      const options = site.tiles.filter(t => safeBed(site, [t.x, t.y]) && !s.crew.some(other => same(other.medical.bed, [t.x, t.y])) && !s.jobs.some(j => j.site === 'surface' && j.x === t.x && j.y === t.y))
        .map(t => ({ t, path: pathTo(site, c, [[t.x, t.y]]) })).filter(o => o.path !== null).sort((a, b) => Number(roomBenefit(s, site, b.t, 'infirmary')) - Number(roomBenefit(s, site, a.t, 'infirmary')) || a.path.length - b.path.length);
      if (options.length) m.bed = [options[0].t.x, options[0].t.y];
      else m.status = 'Needs an available, reachable cot in safe air and temperature';
    }
    if (!m.bed) continue;
    // Finish held shipments and essential meals/sleep before occupying the reserved cot.
    if (!s.crew.some(other => other.rescue?.carrying && other.rescue.patient === c.id) && !c.carry && (!c.intent || ['haul', 'leisure'].includes(c.intent.type))) {
      release(s, c); c.intent = { type: 'medical', target: [...m.bed] };
    }
    if (m.injury - m.treated > 1e-8 && !s.jobs.some(j => j.site === 'surface' && j.x === m.bed[0] && j.y === m.bed[1]) && s.tick >= m.retryAt) {
      const result = order(s, 'surface', ...m.bed, 'treat', c.id);
      m.status = result.ok ? 'Awaiting medicine and a medic' : result.message;
    }
  }
}
export function medicalRest(s, c, site, pathTo) {
  if (c.intent?.type !== 'medical') return false;
  const m = c.medical;
  if (!safeBed(site, m.bed)) { c.intent = null; return false; }
  const path = pathTo(site, c, [m.bed]);
  if (path === null) { m.bed = null; c.intent = null; m.status = 'Cot route blocked'; return false; }
  if (path.length) { moveCrew(c, site, path[0]); c.activity = 'Walking to medical cot'; return true; }
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
      if (c.site !== 'surface' || !Array.isArray(m.bed) || m.bed.length !== 2 || !m.bed.every(n => Number.isInteger(n) && n >= 0 && n < s.sites.surface.size) || claims.has(m.bed.join(','))) throw new Error('Invalid medical cot claim.');
      claims.add(m.bed.join(','));
    }
    if (c.intent?.type === 'medical' && (!same(c.intent.target, m.bed) || c.carry || !m.injury)) throw new Error('Invalid patient intention.');
  }
  for (const j of s.jobs.filter(j => j.kind === 'treat')) {
    const c = s.crew.find(c => c.id === j.patient);
    if (j.site !== 'surface' || !c || !same(c.medical.bed, [j.x, j.y]) || patients.has(j.patient) || j.worker === j.patient || !Number.isFinite(j.dose) || j.dose <= 0 || j.dose > 25 || j.work !== 20 || j.cost.medicine !== 1 || Object.keys(j.cost).length !== 1) throw new Error('Invalid treatment order.');
    patients.add(j.patient);
  }
}
