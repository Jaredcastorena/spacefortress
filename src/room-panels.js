import { ROOM_ROLES, roomStatus } from './rooms.js';
import { roomAt } from './atmosphere.js';
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function roomDetails(s, site, t) {
  const room = roomAt(site, t.x, t.y), marker = site.designations.find(d => d.x === t.x && d.y === t.y);
  if (!room) return marker ? `<hr><div class="eyebrow">DORMANT ROOM DESIGNATION</div><p>${esc(ROOM_ROLES[marker.role])} is anchored here. Restore habitat flooring or clear the designation.</p><button data-action="room-role" data-role="general">Clear designation</button>` : '';
  const status = roomStatus(s, site, room), effects = {
    general: 'Mixed use. Ordinary furniture, recovery and storage rules apply.',
    quarters: 'Ready quarters attract sleepers and restore 1.05 energy per tick in bunks. Needs four floor tiles per bunk, safe air and temperature, no industrial machinery and no exposed waste. Depots reject waste deliveries.',
    infirmary: 'Ready infirmaries attract patients and improve treated-injury recovery to 0.15 per tick. Needs cots, safe air and temperature, no industrial machinery and no exposed waste. Depots reject waste deliveries.',
    farm: 'Designated greenhouses pause crops until their requirements are met. Needs hydroponics, sealed breathable air, 10–35 °C, no other industrial machinery and no exposed waste. Depots reject waste deliveries.',
    waste: 'Bulk waste belongs here. Depots reject food and medicine deliveries. Bunks, medical cots, voluntary downtime and crop work are excluded. Place an accepting depot in a separate sealed compartment.',
    conflict: 'Resolve the merged room by choosing one purpose. Special room benefits stop; waste delivery and occupancy restrictions remain in force until resolved.',
  };
  return `<hr><div class="eyebrow">ROOM PURPOSE</div><p>${esc(ROOM_ROLES[status.role] || 'Conflicting designations')} · ${status.role === 'general' ? 'Mixed use' : status.ready ? 'Ready' : 'Requirements unmet'}</p><dl><dt>Floor area</dt><dd>${room.volume} tiles</dd><dt>Occupants now</dt><dd>${status.occupants}</dd><dt>Assigned residents</dt><dd>${status.residents}</dd>${status.markers.length ? `<dt>Markers</dt><dd>${status.markers.slice(0,4).map(d=>`${d.x}/${d.y}`).join(", ")}${status.markers.length>4?" …":""}</dd>` : ""}${!['general','conflict'].includes(status.role) ? `<dt>Required furnishings</dt><dd>${status.furnishings} working</dd>` : ''}</dl>
    ${status.issues.length ? `<ul>${status.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')}</ul>` : ''}
    <div class="storage-filters">${Object.entries(ROOM_ROLES).map(([role,label])=>`<button data-action="room-role" data-role="${role}" aria-pressed="${status.role===role}" class="${status.role===role?'active':''}">${label}</button>`).join('')}</div><p class="crew-hint">${effects[status.role]}</p><p class="crew-hint">Applies to this connected compartment. Its marker stays on the selected floor tile when walls split the room; different purposes conflict when rooms merge. Existing supplies and depot filters are preserved.</p>`;
}
