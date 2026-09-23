import { SANITARY_CAPACITY, SANITARY_GRACE, exposedWaste, sanitaryBlock } from './sanitation.js';
import { roomAt } from './atmosphere.js';
const number = n => Number(n.toFixed(2));
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function sanitationRoomDetails(s, site, t) {
  const room = roomAt(site, t.x, t.y), waste = exposedWaste(s, site, room, t);
  return `<dt>Exposed waste${room ? ' in room' : ''}</dt><dd>${number(waste)} units${waste && room ? ' · haul to a separate waste depot or recycle' : ''}</dd>`;
}
export function sanitaryDetails(s, site, t) {
  if (t.building !== 'sanitary') return '';
  const user = s.crew.find(c => c.health > 0 && c.site === site.id && c.intent?.type === 'sanitation' && c.intent.target?.[0] === t.x && c.intent.target?.[1] === t.y);
  const block = sanitaryBlock(s, site, t, user);
  return `<hr><div class="eyebrow">SANITATION</div><p>${esc(block || (user ? `Reserved by ${user.name}` : 'Available'))}</p><dl><dt>Sealed tank</dt><dd>${number(t.sanitary.output.waste || 0)} / ${SANITARY_CAPACITY} waste</dd></dl><p class="crew-hint">Crew walk here for a private six-second visit. Haulers empty the tank into a depot accepting waste, then supply the nutrient recycler. Bulk waste in a depot exposes its compartment; keep waste storage separate from living spaces. A broken tank seal exposes its contents. This dry unit uses no water or electricity.</p>`;
}
export function crewSanitationDetails(c, tick = 0) {
  const n = c.sanitation;
  return `<hr><div class="eyebrow">SANITATION</div><dl><dt>Waste retained</dt><dd>${number(n.waste)} units</dd><dt>Facility need</dt><dd>${n.waste >= .5 ? `Due · ${SANITARY_GRACE - n.wait}s before overflow` : 'Comfortable'}</dd><dt>Waste exposure</dt><dd>${number(n.exposure)} / 100</dd>${n.retryAt > tick ? `<dt>Hygiene retry</dt><dd>In ${n.retryAt - tick}s</dd>` : ""}<dt>Work penalty</dt><dd>${number(n.exposure * .2)}%</dd></dl><p class="crew-hint">Use a safe sanitary unit before retained waste overflows into a local pile. Medicine workers provide bedside hygiene for dependent patients and carry the waste away. Uncollected waste in breathable compartments builds exposure; clean surroundings let it decline. Prolonged high exposure causes injuries needing care.</p>`;
}
