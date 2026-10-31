import { roomPressure } from './room-pressure.js';
import { breathingStatus, doorOpen } from './atmosphere.js';
import { airlockControlOwner } from './airlock-access.js';
import { airlockOwnershipDetails } from './airlock-panels.js';

const breathingReasons={
  exterior:'No room atmosphere here. Use a suit or enter a breathable room.',
  smoke:'Smoke makes this room unsafe. Suppress the fire and clear smoke with filtering or exhaust.',
  low_pressure:'Pressure is too low. Deliver breathing mix to life support and isolate exterior leaks.',
  high_pressure:'Pressure is too high. Reduce gas input and vent excess gas.',
  low_oxygen:'Too little oxygen at this pressure. Stored breathing mix must reach life support; isolate exterior door losses.',
  high_oxygen:'Oxygen is too high at this pressure. Reduce oxygen input and vent excess gas.',
  high_co2:'Exhaled gas is too high. Run powered life support to recycle it; repair damaged equipment.'
};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function atmosphereDetails(room) {
  const status=breathingStatus(room),reason=status.block?`<dt class="breathing-limit">Breathing limit</dt><dd class="breathing-limit" data-breathing-block="${esc(status.block)}">${esc(breathingReasons[status.block])}</dd>`:'';
  if (!room) return `<dt>Atmosphere</dt><dd>Exterior · suit required</dd>${reason}`;
  const range=`${(status.minimumOxygenPressure*100).toFixed(0)}–${(status.maximumOxygenPressure*100).toFixed(0)}%`;
  return `<dt>Breathing</dt><dd>${status.breathable ? 'Breathable' : 'Suit required'}</dd><dt title="Gas quantity and room temperature determine pressure.">Pressure</dt><dd>${roomPressure(room).toFixed(1)}% of nominal</dd><dt>Oxygen concentration</dt><dd>${(room.oxygenFraction * 100).toFixed(1)}%</dd><dt>Oxygen at this pressure</dt><dd>${(status.oxygenPressure*100).toFixed(2)}% of nominal · safe range ${range}</dd>${reason}<dt>Exhaled gas</dt><dd>${(room.co2Fraction * 100).toFixed(2)}%</dd><dt>Smoke</dt><dd>${((room.smoke||0)/room.volume).toFixed(3)} per tile</dd><dt>Compartment</dt><dd>${room.volume} tiles · ${room.sealed ? 'sealed' : 'open to exterior'}</dd>`;
}
export function doorDetails(t, tick, site=null) {
  if (t.building !== 'door') return '';
  const owner=site&&airlockControlOwner(site,t);
  return `<hr><div class="eyebrow">PRESSURE DOOR</div><p>${doorOpen(t, tick) ? 'Open; gas can flow.' : 'Shut; atmosphere isolated.'}${t.hp < 100 ? ' Damaged seals may leak.' : ''}</p>
    ${airlockOwnershipDetails(site,t)}<div class="job-priority">${[['auto', 'Automatic'], ['open', 'Hold open'], ['closed', 'Seal shut']].map(([mode, label]) => `<button data-action="door" ${owner?'disabled':''} data-door-mode="${mode}" aria-pressed="${t.doorMode === mode}" class="${t.doorMode === mode ? 'active' : ''}">${label}</button>`).join('')}</div><p class="crew-hint">${owner?'The controller owns this door’s interlock. Repair work remains available.':'Automatic doors open for passing crew. Sealed doors block routes. A configured airlock cycles its chamber before admitting crew.'}</p>`;
}
