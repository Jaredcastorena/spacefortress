import { itemsDetails } from './possession-panels.js';
import { crewSanitationDetails } from './sanitation-panels.js';
import { foodDetails } from './food-panels.js';
import { mobilityLabel } from './mobility.js';
import { lifeDetails } from './crew-life-panels.js';
import { LABORS } from './crew.js';
import { inventoryText } from './industry-panels.js';
import { quantity } from './inventory.js';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function crewDetails(c, location, crew = [], temperature = 20, careJobs = [], tick = 0, housing = '', routineLocal = c.site === 'surface') {
  return `<div class="eyebrow">${esc(c.role)} · ${esc(c.temperament)}</div><h2>${esc(c.name)}</h2><p>${esc(c.activity)}</p>
    <dl><dt>Location</dt><dd>${esc(location)}</dd><dt>Health</dt><dd>${Math.round(c.health)}%</dd><dt>Suit air</dt><dd>${Math.round(c.oxygen)}%</dd><dt>Fed</dt><dd>${Math.round(c.hunger)}%</dd><dt>Energy</dt><dd>${Math.round(c.energy)}%</dd><dt>Thermal strain</dt><dd>${Math.round(Math.abs(c.thermalStress))}%${c.thermalStress < 0 ? " · cold" : c.thermalStress > 0 ? " · heat" : ""}</dd><dt>Morale</dt><dd>${Math.round(c.morale)}%</dd></dl>
    ${c.medical.injury ? `<hr><div class="eyebrow">MEDICAL CARE</div><p>${esc(c.medical.status)}</p><dl><dt>Mobility</dt><dd>${mobilityLabel(c)}</dd><dt>Meal portions</dt><dd>${c.medical.servings} remaining</dd><dt>Cause</dt><dd>${esc(c.medical.cause)}</dd><dt>Injury remaining</dt><dd>${c.medical.injury.toFixed(1)}</dd><dt>Treated</dt><dd>${c.medical.treated.toFixed(1)}</dd><dt>Reserved cot</dt><dd>${c.medical.bed ? c.medical.bed.join(", ") : "None"}</dd></dl>` : ""}
    ${c.rescue ? `<p>Rescue: ${c.rescue.carrying ? "carrying" : "approaching"} ${esc(crew.find(p => p.id === c.rescue.patient)?.name || "patient")}</p>` : ""}
    ${c.carry ? `<p>Carrying: ${esc(inventoryText(c.carry))}</p>${foodDetails(c.carry, temperature)}${itemsDetails(c.carry)}` : ''}<hr><div class="eyebrow">SKILLS & LABOR</div><p class="crew-hint">Enabled duties are assigned by skill and distance. Recovery takes precedence.</p>
    <div class="labor-controls">${Object.entries(LABORS).map(([id, name]) => `<button data-action="labor" data-crew="${esc(c.id)}" data-labor="${id}" aria-pressed="${c.labors[id]}" title="${c.labors[id] ? 'Disable' : 'Enable'} ${name.toLowerCase()}; ${Math.floor(c.skills[id].xp)} experience toward the next level" class="${c.labors[id] ? 'active' : ''}"><span>${name}${c.favoriteLabor === id ? ' ★' : ''}</span><span>Lv ${c.skills[id].level} · ${c.labors[id] ? 'On' : 'Off'}</span></button>`).join('')}</div>
    ${housing}${crewSanitationDetails(c, tick)}${careJobs.length ? `<hr><div class="eyebrow">CARE ORDERS</div>${careJobs.map(jobDetails).join("<hr>")}` : ""}${lifeDetails(c, crew, routineLocal)}<hr><div class="eyebrow">RECENT MEMORIES</div><ul class="crew-memories">${c.memories.length ? c.memories.slice(0, 4).map(m => `<li class="${m.mood < 0 ? 'unhappy' : ''}">${esc(m.text)}</li>`).join('') : '<li>Still getting to know this frontier.</li>'}</ul><button data-action="clear">Back to region</button>`;
}
export function jobDetails(j) {
  const waiting = j.sources.reduce((sum, source) => sum + quantity(source.items), 0);
  const transit = quantity(j.cost) - waiting - quantity(j.materials);
  return `<p>${esc(({ extinguish:'Fire suppression',animalLead:'Animal transport',operate: 'Operate workstation', hygiene: 'Bedside hygiene', feed: 'Bedside meal', treat: 'Medical treatment' })[j.kind] || j.kind)} · ${j.kind==='animalLead'?(j.phase==='escort'?'Escorting to destination':`${Math.round(100*(1-j.remaining/j.work))}% lead preparation`):`${Math.round(100*(1-j.remaining/j.work))}% complete`}${j.blockedReason ? `<br>${esc(j.blockedReason)}` : ''}</p>
    ${quantity(j.cost) ? `<dl><dt>Delivered supplies</dt><dd>${esc(inventoryText(j.materials))}</dd><dt>Awaiting pickup</dt><dd>${waiting} units</dd><dt>In transit</dt><dd>${Math.max(0, transit - j.missingFood)} units</dd>${j.missingFood ? `<dt>Replacement food needed</dt><dd>${j.missingFood}</dd>` : ""}</dl>` : ''}
    <div class="job-priority" aria-label="Work priority">${[[1, 'Low'], [3, 'Normal'], [5, 'Urgent']].map(([n, text]) => `<button data-action="priority" data-job="${esc(j.id)}" data-priority="${n}" class="${j.priority === n ? 'active' : ''}" aria-pressed="${j.priority === n}" title="Priority when assigning the next available worker">${text}</button>`).join('')}</div><button data-action="cancel" data-job="${esc(j.id)}">Cancel order</button>`;
}
