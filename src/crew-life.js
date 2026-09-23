import { releaseTransport } from './animal-transport.js';
import { collectPossession, usePossession } from './possessions.js';
import { roomComfort, experienceComfort } from './comfort.js';
import { livingAllowed } from './rooms.js';
import { thermalSafe } from './thermal.js';
import { immobile } from './mobility.js';
import { roomAt, breathable, moveCrew } from './atmosphere.js';
import { remember, updateMorale } from './crew.js';
export const PASTIMES = { quiet: 'Quiet reflection', games: 'Pattern games', stories: 'Trading stories' };
export const LIFE_POLICIES = { balanced: 'Balanced', work: 'Focus on work', rest: 'Off duty' };
const clamp = (n, low = 0, high = 100) => Math.max(low, Math.min(high, n));
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export function initializeCrewLife(s) {
  for (const c of s.crew) {
    c.life = { leisure: 80, company: 80, stress: 0, nextBreak: 0, policy: 'balanced', pastime: c.temperament === 'social' ? 'stories' : c.temperament === 'cautious' ? 'quiet' : 'games', losses: [] };
    c.relationships = Object.fromEntries(s.crew.filter(other => other.id !== c.id).map(other => [other.id, { affinity: 0, interactions: 0, lastInteraction: null }]));
  }
}
export function setLifePolicy(s, id, policy) {
  const c = s.crew.find(c => c.id === id);
  if (!c || c.site !== 'surface' || c.health <= 0 || !Object.hasOwn(LIFE_POLICIES, policy)) return { ok: false, message: 'Select a valid crew work routine.' };
  c.life.policy = policy;
  if (policy === 'work' && c.intent?.type === 'leisure') c.intent = null;
  if (policy === 'rest' && !c.carry) { const j = s.jobs.find(j => j.id === c.job); if (j) { releaseTransport(s,j,'routine_changed'); j.worker = null; } c.job = null; if (c.intent?.type === 'haul') c.intent = null; }
  return { ok: true };
}
export function prepareDowntime(s, release) {
  for (const c of s.crew) {
    if (c.site !== 'surface' || c.health <= 0 || c.medical?.bed || immobile(c) || c.rescue || c.carry || c.intent || (s.departure?.stage === 'boarding' && s.departure.crew.includes(c.id) && c.life.policy !== 'rest')) continue;
    const life = c.life, j = s.jobs.find(j => j.id === c.job);
    const voluntaryBreaks = s.crew.filter(other => other.intent?.type === 'leisure' && other.life.policy === 'balanced').length;
    if (life.policy === 'balanced' && (voluntaryBreaks >= 2 || life.nextBreak > s.tick || !s.sites.surface.rooms.some(breathable))) continue;
    const needs = life.leisure < 25 || life.company < 25 || life.stress >= 80;
    if (life.policy === 'work' || (life.policy !== 'rest' && !needs) || (life.policy !== 'rest' && j?.priority === 5 && life.stress < 95)) continue;
    release(s, c); c.intent = { type: 'leisure', target: null, started: s.tick, rested: 0 };
  }
}
const commonsNear = (site, t) => site.tiles.some(other => other.building === 'commons' && other.hp > 0 && distance(t, other) <= 1 && roomAt(site,t.x,t.y) === roomAt(site,other.x,other.y));
export function leisure(s, c, site, pathTo) {
  const intent = c.intent; if (intent?.type !== 'leisure') return false;
  if(collectPossession(s,c,site,pathTo))return true;
  const safe = t => t && livingAllowed(site, t.x, t.y) && !['wall', 'door'].includes(t.building) && breathable(roomAt(site, t.x, t.y)) && thermalSafe(roomAt(site, t.x, t.y));
  const claimed = new Set(s.crew.filter(other => other.id !== c.id && other.site === c.site && other.intent?.type === 'leisure' && other.intent.target).map(other => other.intent.target.join(',')));
  let target = intent.target && site.tiles[intent.target[1] * site.size + intent.target[0]];
  if (target && (!safe(target) || claimed.has(intent.target.join(',')) || pathTo(site, c, [intent.target]) === null)) { intent.target = null; target = null; }
  if (!target) {
    const candidates = site.rooms.filter(breathable).flatMap(r => r.cells.map(k => site.tiles[Number(k.split(',')[1]) * site.size + Number(k.split(',')[0])])).filter(t => safe(t) && !claimed.has(`${t.x},${t.y}`)).map(t => ({ t, route: pathTo(site, c, [[t.x, t.y]]) })).filter(o => o.route !== null);
    const comfort = new Map(site.rooms.map(r=>[r,roomComfort(s,site,r,c).score]));
    const appeal = t => 2*Number(commonsNear(site,t)) + (comfort.get(roomAt(site,t.x,t.y)) || 0);
    candidates.sort((a, b) => appeal(b.t) - appeal(a.t) || a.route.length - b.route.length || a.t.y - b.t.y || a.t.x - b.t.x);
    target = candidates[0]?.t;
    if (!target) { c.activity = 'No reachable safe place for downtime'; if (c.life.policy !== 'rest') { c.intent = null; return false; } return true; }
    intent.target = [target.x, target.y];
  }
  const route = pathTo(site, c, [intent.target]);
  if (route.length) { moveCrew(c, site, route[0]); c.activity = 'Going to a safe place for downtime'; return true; }
  const furnished = commonsNear(site, target);
  experienceComfort(s,c,site); usePossession(s,c);
  c.life.leisure = clamp(c.life.leisure + (furnished ? .7 : c.life.pastime === 'quiet' ? .45 : .2));
  c.life.stress = clamp(c.life.stress - (furnished ? .4 : .2)); intent.rested++;
  c.activity = `${PASTIMES[c.life.pastime]}${furnished ? ' at the common table' : ' during a quiet break'}`;
  if (c.life.policy !== 'rest' && intent.rested >= 30 && c.life.leisure >= 75 && c.life.stress <= 30) {
    c.intent = null; c.life.nextBreak = s.tick + 120; remember(s, c, 'downtime', 'Had time for something I enjoy.', furnished ? 7 : 3);
  }
  return true;
}
function socialReady(site, c) {
  if (c.health <= 0 || c.job || c.carry || !breathable(roomAt(site, c.x, c.y))) return false;
  return !c.intent || (c.intent.type === 'meal' && c.intent.servings > 0) || (c.intent.type === 'leisure' && c.intent.target?.[0] === c.x && c.intent.target?.[1] === c.y);
}
export function socialize(s) {
  if (s.tick % 30) return;
  const matched = new Set();
  for (const c of s.crew) {
    const site = s.sites[c.site]; if (!site || matched.has(c.id) || !socialReady(site, c)) continue;
    const options = s.crew.filter(other => other.id !== c.id && other.site === c.site && !matched.has(other.id) && distance(c, other) <= 2 && roomAt(site, c.x, c.y) === roomAt(site, other.x, other.y) && socialReady(site, other));
    options.sort((a, b) => (c.relationships[a.id].lastInteraction ?? -1) - (c.relationships[b.id].lastInteraction ?? -1) || c.relationships[b.id].affinity - c.relationships[a.id].affinity || a.id.localeCompare(b.id));
    const other = options[0]; if (!other) continue;
    matched.add(c.id); matched.add(other.id);
    const tense = c.life.stress > 65 && other.life.stress > 65 && c.temperament !== other.temperament;
    for (const [person, companion] of [[c, other], [other, c]]) {
      const bond = person.relationships[companion.id], supportive = !tense && bond.affinity >= 20 && person.life.stress > 30;
      bond.affinity = clamp(bond.affinity + (tense ? -2 : commonsNear(site, person) ? 3 : 2), -100, 100); bond.interactions++; bond.lastInteraction = s.tick;
      person.life.company = clamp(person.life.company + (tense ? 2 : person.temperament === 'social' ? 8 : 5));
      person.life.stress = clamp(person.life.stress + (tense ? 2 : supportive ? -6 : -1));
      remember(s, person, `${tense ? 'argument' : supportive ? 'support' : 'company'}-${companion.id}`, `${tense ? 'Argued with' : supportive ? 'Was reassured by' : 'Spent time with'} ${companion.name}.`, tense ? -6 : supportive ? 8 : 3);
    }
  }
}
export function updateCrewLife(s) {
  for (const c of s.crew) {
    if (c.health <= 0 || c.site === 'transit') continue;
    const life = c.life, safe = breathable(roomAt(s.sites[c.site], c.x, c.y)) && thermalSafe(roomAt(s.sites[c.site], c.x, c.y));
    life.leisure = clamp(life.leisure - (c.job || c.carry ? .035 : .01));
    life.company = clamp(life.company - (c.temperament === 'social' ? .03 : .015));
    const strain = (safe ? 0 : .14) + (c.hunger < 35 ? .1 : 0) + (c.energy < 25 ? .06 : 0) + (c.job ? .015 : 0) + (life.leisure < 25 || life.company < 25 ? .04 : 0);
    life.stress = clamp(life.stress + strain - (safe && !c.job && !c.carry ? .06 : 0));
    for (const lost of s.crew.filter(other => other.id !== c.id && other.health <= 0)) if (!life.losses.some(loss => loss.id === lost.id)) {
      const affinity = c.relationships[lost.id].affinity;
      life.losses.push({ id: lost.id, tick: s.tick, strength: 4 + Math.max(0, affinity) * .17 });
      remember(s, c, `loss-${lost.id}`, `Heard that ${lost.name} died.`, -6 - Math.max(0, affinity) * .08);
    }
  }
  socialize(s);
  for (const c of s.crew) if (c.health > 0) updateMorale(s, c);
}
export function validateCrewLife(s) {
  const percent = n => Number.isFinite(n) && n >= 0 && n <= 100, time = n => Number.isSafeInteger(n) && n >= 0 && n <= s.tick;
  const seats = new Set();
  for (const c of s.crew) {
    const life = c.life, peers = s.crew.filter(other => other.id !== c.id).map(other => other.id);
    if (!life || ![life.leisure, life.company, life.stress].every(percent) || !Number.isSafeInteger(life.nextBreak) || life.nextBreak < 0 || life.nextBreak > s.tick + 120 || !Object.hasOwn(LIFE_POLICIES, life.policy) || !Object.hasOwn(PASTIMES, life.pastime) || !Array.isArray(life.losses) || life.losses.length > peers.length || new Set(life.losses.map(l => l.id)).size !== life.losses.length || life.losses.some(l => !peers.includes(l.id) || s.crew.find(p => p.id === l.id).health > 0 || !time(l.tick) || !Number.isFinite(l.strength) || l.strength < 4 || l.strength > 21)) throw new Error('Invalid personal needs or loss history.');
    if (!c.relationships || Object.keys(c.relationships).length !== peers.length || peers.some(id => { const b = c.relationships[id]; return !b || !Number.isFinite(b.affinity) || Math.abs(b.affinity) > 100 || !Number.isSafeInteger(b.interactions) || b.interactions < 0 || (b.lastInteraction !== null && !time(b.lastInteraction)); })) throw new Error('Invalid crew relationships.');
    if (c.intent?.type === 'leisure') {
      if (!time(c.intent.started) || !Number.isSafeInteger(c.intent.rested) || c.intent.rested < 0 || c.intent.rested > s.tick - c.intent.started + 1 || c.carry) throw new Error('Invalid downtime activity.');
      if (c.intent.target) { const seat = `${c.site}/${c.intent.target.join(',')}`; if (seats.has(seat)) throw new Error('Downtime place claimed twice.'); seats.add(seat); }
    }
  }
}
