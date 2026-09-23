import { COMFORT_PREFERENCES } from './comfort.js';
import { comfortDetails } from './comfort-panels.js';
import { bunkOwner, housingObstruction } from './housing.js';
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function bunkDetails(s, site, t) {
  if (site.id !== 'surface' || t.building !== 'bunk') return '';
  const owner = bunkOwner(s,site.id,t.x,t.y);
  const sleeper = s.crew.find(c=>c.health>0 && c.site===site.id && c.intent?.type==='rest' && c.intent.target?.[0]===t.x && c.intent.target?.[1]===t.y);
  return `<hr><div class="eyebrow">BUNK ASSIGNMENT</div><dl><dt>Owner</dt><dd>${owner ? esc(owner.name) : 'Communal'}</dd><dt>Current sleep claim</dt><dd>${sleeper ? esc(sleeper.name) : 'Available'}</dd></dl>
    <details data-bunk-assignment><summary>Change assignment</summary><div class="storage-filters">${[{id:'',name:'Communal'},...s.crew.filter(c=>c.health>0)].map(c=>`<button data-action="bunk-owner" data-owner="${esc(c.id)}" aria-pressed="${(owner?.id || '')===c.id}" class="${(owner?.id || '')===c.id?'active':''}">${esc(c.name)}</button>`).join('')}</div></details>
    <p class="crew-hint">Personal bunks are reserved even while their owner is away. Each crew member can own one. If home is unsafe or unreachable, they use a communal bunk or floor rest.</p>`;
}

export function crewHousingDetails(s, c, pathTo) {
  return `<hr><div class="eyebrow">HOUSING</div><dl><dt>Values</dt><dd>${COMFORT_PREFERENCES[c.housing.preference]}</dd><dt>Home bunk</dt><dd>${c.housing.bunk ? `Surface · ${c.housing.bunk.join(' / ')}` : 'None assigned'}</dd><dt>Availability</dt><dd>${esc(housingObstruction(s,c,pathTo) || 'Ready for rest')}</dd></dl><p class="crew-hint">Select a surface bunk to change its assignment.</p>${c.housing.bunk ? comfortDetails(s,s.sites.surface,{x:c.housing.bunk[0],y:c.housing.bunk[1]},c) : ''}`;
}
