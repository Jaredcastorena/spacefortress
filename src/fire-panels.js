import { FIRE } from './fire.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function fireDetails(s,site,t){
 if(!t.fire&&!t.fireFault)return '';
 if(!t.fire)return `<hr><div class="eyebrow">ELECTRICAL FAULT</div><p>Damaged equipment has remained powered for ${t.fireFault} / ${FIRE.faultTicks} ticks toward ignition. Isolate its power or repair it.</p>`;
 const f=t.fire,j=s.jobs.find(j=>j.kind==='extinguish'&&j.fire===f.id);
 return `<section data-entity="${esc(f.id)}"><hr><div class="eyebrow">ACTIVE FIRE</div><p>Intensity ${f.intensity.toFixed(0)} / 100 · burning for ${f.age} ticks.</p><p>${esc(j?.blockedReason||f.blocked||(j?'Suppression ordered':s.tick<f.retryAt?'Automatic retry delayed':'Awaiting suppression'))}</p>${j?'':`<button data-action="fire-suppress">Order suppression · 2 water</button>`}<p class="crew-hint">An engineer must deliver water and work beside the fire. Burning fittings consume oxygen and create heat and smoke. Isolate damaged equipment, ventilate carefully, and repair after suppression.</p></section>`;
}
export function fireOverview(site){return `<hr><div class="eyebrow">FIRE RESPONSE</div><p>${site.tiles.filter(t=>t.fire).length} active fires · ${site.rooms.reduce((n,r)=>n+(r.smoke||0),0).toFixed(2)} smoke units.</p><button data-action="fire-response" data-site="${site.id}" aria-pressed="${site.fireSafety.automatic}">${site.fireSafety.automatic?'Disable':'Enable'} automatic suppression</button><p class="crew-hint">Automatic orders use Engineering duty and two delivered water. Existing orders remain when automatic response is disabled.</p>`;}
