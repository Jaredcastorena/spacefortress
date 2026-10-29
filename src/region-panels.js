import {siteDefinitions,siteDefinition,routeDefinition} from './region.js';
import {routeFuel,routeTime} from './expedition.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const supplies=survey=>Object.entries(survey||{}).filter(([r,n])=>r!=='label'&&typeof n==='number'&&n>0).map(([r,n])=>`${n} ${esc(r)}`).join(' · ')||'Established survey';
export function siteSurvey(s,id){
 const def=siteDefinition(s,id);if(!def?.survey)return '';
 return `<details data-panel-key="survey-${esc(id)}"><summary>Initial orbital survey</summary><p>${supplies(def.survey)}</p><p>These are initial extractable amounts. Mining depletes the site; returning keeps its changed terrain, buildings and occupants.</p><dl><dt>Round-trip fuel</dt><dd>${routeFuel(s,id)}</dd><dt>Travel per leg</dt><dd>${routeTime(s,id)} ticks</dd><dt>Debris</dt><dd>${def.debris.damage} injury every ${def.debris.period} ticks outside shelter</dd></dl></details>`;
}
export function regionOverview(s){
 const planet=Object.values(s.region?.planets||{})[0],destinations=Object.entries(siteDefinitions(s)).filter(([id])=>id!=='surface');
 return `<div class="eyebrow">PLANETARY REGION</div><h2>${esc(planet?.name||'The Kepler frontier')}</h2><p>Compare known routes, then inspect a destination to prepare its supplied expedition. Settlements on this map share a planetary region.</p><details open><summary>Known destinations (${destinations.length})</summary>${destinations.map(([id,d])=>`<section data-entity="site:${esc(id)}" data-route="${esc(routeDefinition(s,id)?.id||id)}"><h3>${esc(d.name)}</h3><p>${routeFuel(s,id)} fuel round trip · ${routeTime(s,id)} ticks per leg${d.debris?` · debris every ${d.debris.period} ticks`:''}</p><p>${supplies(d.survey)}</p><button data-action="inspect-site" data-site="${esc(id)}">Inspect ${esc(d.name)}</button></section>`).join('')}</details>`;
}
