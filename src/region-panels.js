import {siteDefinitions,siteDefinition,routeDefinition,planetDefinitions,planetSiteIds} from './region.js';
import {routeFuel,routeTime} from './expedition.js';
import {residentIds} from './outposts.js';
import {planetaryAtlas} from './satellite-atlas.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const supplies=survey=>Object.entries(survey||{}).filter(([r,n])=>r!=='label'&&typeof n==='number'&&n>0).map(([r,n])=>`${n} ${esc(r)}`).join(' · ')||'Established survey';
export function siteSurvey(s,id){
 const def=siteDefinition(s,id);if(!def?.survey)return '';
 const planet=planetDefinitions(s)[def.planetId];
 return `<details data-panel-key="survey-${esc(id)}"><summary>Initial orbital survey</summary>${planet?`<p>${esc(planet.name)} · ${esc(def.sub)}</p>`:''}<p>${supplies(def.survey)}</p><p>These are initial extractable amounts. Mining depletes the site; returning keeps its changed terrain, buildings and occupants.</p><dl><dt>Round-trip fuel</dt><dd>${routeFuel(s,id)}</dd><dt>Travel per leg</dt><dd>${routeTime(s,id)} ticks</dd><dt>Debris</dt><dd>${def.debris.damage} injury every ${def.debris.period} ticks outside shelter</dd></dl></details>`;
}
function destination(s,id){
 const d=siteDefinition(s,id);
 return `<section data-entity="site:${esc(id)}" data-route="${esc(routeDefinition(s,id)?.id||id)}"><h3>${esc(d.name)}</h3>${id==='surface'?'<p>Your home colony and expedition departure point.</p>':`<p>${routeFuel(s,id)} fuel round trip · ${routeTime(s,id)} ticks per leg${d.debris?` · debris every ${d.debris.period} ticks`:''}</p><p>${supplies(d.survey)}</p>`}<button data-action="inspect-site" data-site="${esc(id)}">Inspect ${esc(d.name)}</button></section>`;
}
export function regionOverview(s,planetId=null,sector=null){
 const planets=planetDefinitions(s),planet=Object.hasOwn(planets,planetId)?planets[planetId]:null;
 if(!planet)return `<div class="eyebrow">PLANETARY SYSTEM</div><h2>Known planets (${Object.keys(planets).length})</h2><p>Select a planet to inspect its landing sites and orbital destinations. Expeditions depart from the home colony and return there.</p>${Object.values(planets).map(p=>`<section data-entity="planet:${esc(p.id)}"><h3>${esc(p.name)}</h3><p>${planetSiteIds(s,p.id).length} known sites</p><button data-action="inspect-planet" data-ui-action="region.planet" data-planet="${esc(p.id)}">View ${esc(p.name)}</button></section>`).join('')}`;
 const ids=planetSiteIds(s,planetId);
 return `<div class="eyebrow">PLANETARY REGION</div><h2>${esc(planet.name)}</h2><button data-action="system-overview" data-ui-action="region.system">All planets</button><p>Compare this planet's finite opportunities. Routes depart from the home colony; direct travel between remote sites is not yet available.</p>${planetaryAtlas(s,planetId,sector)}<details open><summary>Known destinations (${ids.length})</summary>${ids.map(id=>destination(s,id)).join('')}</details>`;
}
export function regionNavigation(s,currentSite,currentPlanet=null,openIds=null){
 const planets=planetDefinitions(s),activePlanet=currentSite==='universe'?currentPlanet:siteDefinition(s,currentSite)?.planetId;
 const status=id=>id==='surface'?'PLANETARY COLONY':s.outposts[id]?s.outposts[id].established?`${residentIds(s,id).length} REGISTERED RESIDENTS`:siteDefinition(s,id).template?'INITIAL SURVEY AVAILABLE':'SATELLITE SALVAGE':id==='comet'?s.tick<s.comet.arrives?`ARRIVES IN ${s.comet.arrives-s.tick}s`:`DEPARTS IN ${s.comet.leaves-s.tick}s`:'ADVANCED SOLAR SITE';
 return `<button data-site="universe" class="${currentSite==='universe'&&!currentPlanet?'active':''}" style="--dot:#b2c3ca">System overview<small>${Object.keys(planets).length} KNOWN PLANETS</small></button>`+Object.values(planets).map(p=>`<details data-planet-group="${esc(p.id)}" ${(openIds?openIds.includes(p.id):p.id===activePlanet)?'open':''}><summary>${esc(p.name)}</summary><button data-planet="${esc(p.id)}" style="--dot:${p.color||'#b2c3ca'}">Planet map<small>${planetSiteIds(s,p.id).length} KNOWN SITES</small></button>${planetSiteIds(s,p.id).map(id=>{const d=siteDefinition(s,id);return `<button data-site="${esc(id)}" class="${currentSite===id?'active':''}" style="--dot:${d.color}">${esc(d.name)}<small>${status(id)}</small></button>`;}).join('')}</details>`).join('');
}
