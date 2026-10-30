import { itemsDetails } from './possession-panels.js';
import { crewSanitationDetails } from './sanitation-panels.js';
import { foodDetails } from './food-panels.js';
import { mobilityLabel } from './mobility.js';
import { lifeDetails } from './crew-life-panels.js';
import { LABORS } from './crew.js';
import { inventoryText } from './industry-panels.js';
import { quantity } from './inventory.js';
import { CROPS, MEAL_RECIPES, mealQualityForLevel, nextQualityLevel } from './food-data.js';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Keep these drafts in the view; simulation status and commands remain authoritative.
export function createSuitReleaseView() {
  const drafts = new Map();
  const draft = crewId => drafts.get(crewId) || {};
  return {
    draft,
    remember(inspector, activeElement) {
      const panel = inspector.querySelector('[data-suit-release-panel]');
      if (!panel) return false;
      const current = { ...draft(panel.dataset.crew), points: panel.querySelector('[name="points"]').value, open: panel.open };
      const focused = panel.contains(activeElement);
      if (focused) current.focus = activeElement.dataset?.suitReleaseFocus || null;
      else if (inspector.contains(activeElement)) current.focus = null;
      drafts.set(panel.dataset.crew, current);
      return focused;
    },
    restore(inspector, restoreFocus = false) {
      const panel = inspector.querySelector('[data-suit-release-panel]');
      if (!panel) return;
      const current = draft(panel.dataset.crew);
      panel.open = !!current.open;
      if (!restoreFocus || !current.focus) return;
      const field = [...panel.querySelectorAll('[data-suit-release-focus]')].find(el => el.dataset.suitReleaseFocus === current.focus);
      if (field && !field.disabled && (panel.open || field.tagName === 'SUMMARY')) field.focus({ preventScroll: true });
    }
  };
}

export function suitReleaseFormAction(crew, value) {
  if (typeof crew !== 'string' || !crew || !['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;
  const points = Number(value);
  if (!Number.isInteger(points) || points < 1 || points > 100) return null;
  return { id: 'crew.suit.release', args: { crew, points } };
}

export function suitReleaseDetails(c, status, draft = {}) {
  const points = draft.points ?? (status.available ? Math.min(10, status.maxPoints) : '');
  return `<details data-panel-key="suit-release-${esc(c.id)}" data-suit-release-panel data-crew="${esc(c.id)}"${draft.open ? ' open' : ''}><summary data-suit-release-focus="summary">Emergency oxygen</summary><p class="crew-hint">Releasing oxygen spends this crew member’s suit reserve. They may need that reserve to survive later.</p><p class="crew-hint">Pure oxygen can make the room’s air oxygen-rich and unsafe to breathe.</p>${status.available ? `<p class="crew-hint">At most ${status.maxPoints} suit points can be released here now. Each point supplies ${status.oxygenPerPoint} oxygen units.</p>` : `<p data-suit-release-blocker data-blocked-code="${esc(status.blockedCode)}">${esc(status.message || 'Suit oxygen cannot be released here.')}</p>`}<form class="production-form" data-suit-release-form data-crew="${esc(c.id)}" data-simulation-action="crew.suit.release"><label>Suit points<input type="number" name="points" required min="1" max="${status.maxPoints}" step="1" value="${esc(points)}" data-suit-release-focus="points"${status.available ? '' : ' disabled'}></label><button type="submit" data-suit-release-focus="release"${status.available ? '' : ' disabled'}>Release suit oxygen into this room</button></form></details>`;
}

function productionProgress(c) {
  const level=c.skills.production.level,next=nextQualityLevel(level);
  const choices=[...Object.values(CROPS),...Object.values(MEAL_RECIPES)].filter(r=>r.selectable!==false&&r.minSkill>level);
  const nextSkill=choices.length?Math.min(...choices.map(r=>r.minSkill)):null;
  return `<p class="crew-hint">Cooking quality ${mealQualityForLevel(level)}/4 · ${next===null?'Highest quality tier':`Next quality tier: Production ${next}`}.</p>${nextSkill===null?'':`<details data-production-progression data-panel-key="production-progression"><summary>Next crops and recipes · Production ${nextSkill}</summary><p>${choices.filter(r=>r.minSkill===nextSkill).map(r=>esc(r.name)).join(' · ')}</p><p class="crew-hint">The operator needs this skill and enabled Production labor. Farming and cooking both build Production experience.</p></details>`}`;
}
export function crewDetails(c, location, crew = [], temperature = 20, careJobs = [], tick = 0, housing = '', routineLocal = c.site === 'surface', emergencyOxygen = '') {
  return `<div class="eyebrow">${esc(c.role)} · ${esc(c.temperament)}</div><h2>${esc(c.name)}</h2><p>${esc(c.activity)}</p>
    <dl><dt>Location</dt><dd>${esc(location)}</dd><dt>Health</dt><dd>${Math.round(c.health)}%</dd><dt>Suit air</dt><dd>${Math.round(c.oxygen)}%</dd><dt>Fed</dt><dd>${Math.round(c.hunger)}%</dd><dt>Energy</dt><dd>${Math.round(c.energy)}%</dd><dt>Thermal strain</dt><dd>${Math.round(Math.abs(c.thermalStress))}%${c.thermalStress < 0 ? " · cold" : c.thermalStress > 0 ? " · heat" : ""}</dd><dt>Morale</dt><dd>${Math.round(c.morale)}%</dd></dl>
    ${emergencyOxygen}${c.medical.injury ? `<hr><div class="eyebrow">MEDICAL CARE</div><p>${esc(c.medical.status)}</p><dl><dt>Mobility</dt><dd>${mobilityLabel(c)}</dd><dt>Meal portions</dt><dd>${c.medical.servings} remaining</dd><dt>Cause</dt><dd>${esc(c.medical.cause)}</dd><dt>Injury remaining</dt><dd>${c.medical.injury.toFixed(1)}</dd><dt>Treated</dt><dd>${c.medical.treated.toFixed(1)}</dd><dt>Reserved cot</dt><dd>${c.medical.bed ? [c.medical.bed.x,c.medical.bed.y].join(", ") : "None"}</dd></dl>` : ""}
    ${c.rescue ? `<p>Rescue: ${c.rescue.carrying ? "carrying" : "approaching"} ${esc(crew.find(p => p.id === c.rescue.patient)?.name || "patient")}</p>` : ""}
    ${c.carry ? `<p>Carrying: ${esc(inventoryText(c.carry))}</p>${foodDetails(c.carry, temperature)}${itemsDetails(c.carry)}` : ''}<hr><div class="eyebrow">SKILLS & LABOR</div><p class="crew-hint">Enabled duties are assigned by skill and distance. Recovery takes precedence.</p>
    <div class="labor-controls">${Object.entries(LABORS).map(([id, name]) => `<button data-action="labor" data-crew="${esc(c.id)}" data-labor="${id}" aria-pressed="${c.labors[id]}" title="${c.labors[id] ? 'Disable' : 'Enable'} ${name.toLowerCase()}; ${Math.floor(c.skills[id].xp)} experience toward the next level" class="${c.labors[id] ? 'active' : ''}"><span>${name}${c.favoriteLabor === id ? ' ★' : ''}</span><span>Lv ${c.skills[id].level} · ${c.labors[id] ? 'On' : 'Off'}</span></button>`).join('')}</div>
    ${productionProgress(c)}${housing}${crewSanitationDetails(c, tick)}${careJobs.length ? `<hr><div class="eyebrow">CARE ORDERS</div>${careJobs.map(jobDetails).join("<hr>")}` : ""}${lifeDetails(c, crew, routineLocal)}<hr><div class="eyebrow">RECENT MEMORIES</div><ul class="crew-memories">${c.memories.length ? c.memories.slice(0, 4).map(m => `<li class="${m.mood < 0 ? 'unhappy' : ''}">${esc(m.text)}</li>`).join('') : '<li>Still getting to know this frontier.</li>'}</ul><button data-action="clear">Back to region</button>`;
}
export function jobDetails(j) {
  const waiting = j.sources.reduce((sum, source) => sum + quantity(source.items), 0);
  const transit = quantity(j.cost) - waiting - quantity(j.materials);
  return `<p>${esc(({ replaceFuse:'Fuse replacement',plant:'Planting',waterPlant:'Plant watering',gather:'Gathering',extinguish:'Fire suppression',animalLead:'Animal transport',animalTreat:'Veterinary treatment',animalCare:'Animal feeding',animalHarvest:'Animal product collection',operate: 'Operate workstation', hygiene: 'Bedside hygiene', feed: 'Bedside meal', treat: 'Medical treatment' })[j.kind] || j.kind)} · ${j.kind==='animalLead'?(j.phase==='escort'?'Escorting to destination':`${Math.round(100*(1-j.remaining/j.work))}% lead preparation`):`${Math.round(100*(1-j.remaining/j.work))}% complete`}${j.blockedReason ? `<br>${esc(j.blockedReason)}` : ''}</p>
    ${quantity(j.cost) ? `<dl><dt>Delivered supplies</dt><dd>${esc(inventoryText(j.materials))}</dd><dt>Awaiting pickup</dt><dd>${waiting} units</dd><dt>In transit</dt><dd>${Math.max(0, transit - j.missingFood)} units</dd>${j.missingFood ? `<dt>Replacement food needed</dt><dd>${j.missingFood}</dd>` : ""}</dl>` : ''}
    <div class="job-priority" aria-label="Work priority">${[[1, 'Low'], [3, 'Normal'], [5, 'Urgent']].map(([n, text]) => `<button data-action="priority" data-job="${esc(j.id)}" data-priority="${n}" class="${j.priority === n ? 'active' : ''}" aria-pressed="${j.priority === n}" title="Priority when assigning the next available worker">${text}</button>`).join('')}</div><button data-action="cancel" data-job="${esc(j.id)}">Cancel order</button>`;
}
