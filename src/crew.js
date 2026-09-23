import { emitEvent } from './telemetry.js';
import { immobile } from './mobility.js';
// Crew capabilities and memories are persistent simulation data, not UI labels.
export const LABORS = { mining: 'Extraction', construction: 'Construction', engineering: 'Engineering', hauling: 'Hauling', medicine: 'Medicine', production: 'Production', husbandry: 'Husbandry' };
const PROFILES = [
  { strengths: { construction: 2, engineering: 1 }, favorite: 'construction', temperament: 'steady' },
  { strengths: { production: 2, engineering: 3, construction: 2 }, favorite: 'engineering', temperament: 'cautious' },
  { strengths: { mining: 3, hauling: 2 }, favorite: 'mining', temperament: 'driven' },
  { strengths: { husbandry: 2, production: 3, hauling: 2, construction: 1 }, favorite: 'hauling', temperament: 'social' },
  { strengths: { hauling: 3, mining: 1 }, favorite: 'hauling', temperament: 'steady' },
  { strengths: { medicine: 3, engineering: 2, hauling: 1 }, favorite: 'medicine', temperament: 'social' },
  { strengths: { production: 3, construction: 3, engineering: 2 }, favorite: 'construction', temperament: 'cautious' },
];
export function initializeCrew(c, index) {
  const profile = PROFILES[index];
  c.skills = Object.fromEntries(Object.keys(LABORS).map(id => [id, { level: profile.strengths[id] || 0, xp: 0 }]));
  c.labors = Object.fromEntries(Object.keys(LABORS).map(id => [id, true]));
  c.favoriteLabor = profile.favorite; c.temperament = profile.temperament;
  c.intent = null; c.morale = 72; c.memories = [];
}
export const laborFor = job => ({ extinguish:'engineering',animalLead:'husbandry',animalCare:'husbandry',animalHarvest:'husbandry',operate: 'production', hygiene: 'medicine', feed: 'medicine', treat: 'medicine', mine: 'mining', build: 'construction', remove: 'construction', repair: 'engineering', service: 'engineering', refit: 'engineering', loadShuttle: 'hauling', unloadShuttle: 'hauling', repairWaterPipe:'engineering',removeWaterPipe:'construction',repairPipe:'engineering',removePipe:'construction',repairCable: 'engineering', removeCable: 'construction' })[job.kind];
export const airThreshold = c => c.temperament === 'cautious' ? 35 : 25;
export function availableForWork(c) {
  return c.health > 0 && Math.abs(c.thermalStress || 0) < 45 && !immobile(c) && !c.rescue && !c.medical?.bed && c.life?.policy !== 'rest' && c.site !== 'transit' && !c.intent && !c.carry && !c.job && c.oxygen >= airThreshold(c) && c.hunger >= 35 && c.energy >= 25;
}
export function workRate(c, labor) {
  return (1 - (c.sanitation?.exposure || 0) * .002) * (1 - Math.abs(c.thermalStress || 0) * .004) * (.8 + c.skills[labor].level * .28) * (.65 + c.health * .0035) * (.65 + c.energy * .0035) * (.8 + c.morale * .004);
}
export function gainExperience(c, labor, effort) {
  const skill = c.skills[labor];
  skill.xp += effort;
  while (skill.level < 10 && skill.xp >= 20 + skill.level * 15) { skill.xp -= 20 + skill.level * 15; skill.level++; }
  if (skill.level === 10) skill.xp = Math.min(skill.xp, 170);
}
export function remember(s, c, kind, text, mood) {
  if (c.memories.some(m => m.kind === kind && s.tick - m.tick < 120)) return;
  c.memories.unshift({ tick: s.tick, kind, text, mood }); c.memories = c.memories.slice(0, 8);
  emitEvent(s,'crew.memory.created',{actor:c.id,memory:{kind,text,mood}});
}
export function updateMorale(s, c) {
  c.memories = c.memories.filter(m => s.tick - m.tick < 600);
  const life = c.life, losses = life ? life.losses.reduce((n, loss) => n + loss.strength * Math.max(0, 1 - (s.tick - loss.tick) / 2400), 0) : 0;
  const strain = life ? life.stress * .25 + Math.max(0, 40 - life.leisure) * .3 + Math.max(0, 40 - life.company) * (c.temperament === 'social' ? .45 : .2) + Math.min(35, losses) : 0;
  c.morale = Math.max(0, Math.min(100, 72 - strain + c.memories.reduce((sum, m) => sum + m.mood * (1 - (s.tick - m.tick) / 600), 0)));
}
