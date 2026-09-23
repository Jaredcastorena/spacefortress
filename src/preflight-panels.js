import { departureReadiness } from './preflight.js';
import { SITES } from './data.js';
import { inventoryText } from './industry-panels.js';
import { quantity } from './inventory.js';
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function preflightDetails(s, siteId = null) {
  const d = s.departure; if (!d || (siteId && siteId !== d.site)) return '';
  const job = s.jobs.find(j => j.kind === 'loadShuttle'),readiness=departureReadiness(s);
  return `<hr><div class="eyebrow">DEPARTURE PREPARATION</div><h3>${SITES[d.site].name}</h3><p data-departure-status>${esc(readiness.reason||d.status)}</p><dl>${Object.entries(d.target).map(([r, n]) => `<dt>${r} loaded / needed</dt><dd>${(s.shuttle.supplies[r] || 0).toFixed(1)} / ${n.toFixed(1)}</dd>`).join('')}${job ? `<dt>Staged for loading</dt><dd>${esc(inventoryText(job.materials))}</dd>${job.blockedReason ? `<dt>Loading delayed</dt><dd>${esc(job.blockedReason)}</dd>` : ''}` : ''}</dl><ol data-departure-crew>${readiness.crew.map(member=>{const c=s.crew.find(c=>c.id===member.id);return `<li data-entity="${member.id}"><strong>${esc(c?.name||member.id)}</strong> · ${esc(c?.role||'Crew')}<br><span data-departure-crew-status>${!member.eligible?esc(member.reason):member.atShuttle?'At shuttle':member.routeBlocked?'Route to shuttle blocked':member.routeSteps===null?'Route not available':`${member.routeSteps} steps to shuttle`}</span></li>`;}).join('')}</ol><button data-action="inspect-maintenance" data-x="16" data-y="11">Inspect shuttle work</button><button data-action="cancel-departure">Cancel departure preparation</button><p class="crew-hint">Loaded stores stay aboard if cancelled. Unfinished deliveries return through normal hauling. The assigned team stays fixed. Liftoff waits for their readiness and a safe approach window; cancel to choose someone else.</p>`;
}
export function shipStores(s) {
  return `<hr><div class="eyebrow">SERVICE STORES ABOARD</div><p>${esc(inventoryText(s.shuttle.supplies))}</p>${s.mission ? `<p>Fuel reserved for return: ${s.mission.returnFuel}</p>` : `<button data-action="unload-shuttle" ${s.departure || !quantity(s.shuttle.supplies) ? 'disabled' : ''}>Unload service stores</button>`}<p class="crew-hint">Fuel and life-support supplies use dedicated service storage. Salvage uses the separate cargo hold.</p>`;
}
