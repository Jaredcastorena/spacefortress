import { BUILDINGS } from './data.js';
import { SERVICE_INTERVAL } from './maintenance.js';
const damageNames={waterPipe:'water pipe',pipe:'gas pipe',cable:'power cable',structure:'structure'};
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function maintenanceDetails(s, site, t) {
  const m = t.maintenance, incident = site.incidents.find(i => i.x === t.x && i.y === t.y);
  if (!m && !incident && (!t.building || t.hp >= 100)) return '';
  return `<hr><div class="eyebrow">CONDITION & SERVICE</div>
    ${m ? `<dl><dt>Operating time</dt><dd>${m.usage} / ${SERVICE_INTERVAL}s between services</dd><dt>Last serviced</dt><dd>${m.servicedAt === null ? 'Not yet serviced' : `Colony time ${m.servicedAt}s`}</dd></dl><p>${m.usage >= SERVICE_INTERVAL ? 'Service overdue. Continued operation wears equipment down.' : 'Service before the interval expires to prevent wear.'}</p><button data-action="auto-service" aria-pressed="${m.auto}">Automatic service: ${m.auto ? 'On' : 'Off'}</button>${m.blocked ? `<p>${esc(m.blocked)}</p>` : ''}${t.hp > 0 && m.usage > 0 ? '<button data-action="service">Service equipment · 1 alloy</button>' : ''}<p class="crew-hint">Engineers deliver supplies before servicing. Automatic service queues work when due or below 51% condition. Cancelling its order also turns automatic service off.</p>` : ''}
    ${t.building && t.hp < 100 ? '<button data-action="repair-structure">Repair structure · 1 alloy</button>' : ''}
    ${incident ? `<p>Last recorded damage: ${incident.cause === 'wear' ? 'overdue service' : incident.cause === 'fire' ? 'fire' : incident.cause === 'water' ? 'wet cable short' : 'debris impact'} to ${damageNames[incident.target]||incident.target} at ${incident.tick}s (−${incident.amount.toFixed(incident.amount < 1 ? 2 : 0)} condition).</p>` : ''}`;
}
export function maintenanceOverview(s) {
  const site = s.sites.surface, tiles = site.tiles.filter(t => (t.building && t.hp < 75) || (t.cable && t.cable.hp < 100) || (t.pipe && t.pipe.hp < 100) || (t.waterPipe && t.waterPipe.hp < 100) || t.maintenance?.usage >= SERVICE_INTERVAL);
  tiles.sort((a, b) => a.hp - b.hp || a.y - b.y || a.x - b.x);
  return `<hr><div class="eyebrow">MAINTENANCE · ${tiles.length} NEED ATTENTION</div>${tiles.slice(0, 6).map(t => `<button data-action="inspect-maintenance" data-x="${t.x}" data-y="${t.y}">${esc((BUILDINGS[t.building]?.name || (t.waterPipe?'Water pipe':t.pipe?'Gas pipe':'Power cable'))+(t.building&&t.waterPipe?.hp<100?' · water pipe damage':''))} · ${t.x}/${t.y}</button>`).join('') || '<p>No overdue service or major damage.</p>'}${s.debris.target ? `<p>Debris impact forecast in ${s.debris.next - s.tick}s.</p><button data-action="inspect-maintenance" data-x="${s.debris.target.x}" data-y="${s.debris.target.y}">Inspect forecast tile ${s.debris.target.x}/${s.debris.target.y}</button>` : ''}`;
}
