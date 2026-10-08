import { breathable, doorOpen } from './atmosphere.js';
import { airlockControlOwner } from './airlock-access.js';
import { airlockOwnershipDetails } from './airlock-panels.js';

export function atmosphereDetails(room) {
  if (!room) return '<dt>Atmosphere</dt><dd>Exterior · suit required</dd>';
  return `<dt>Breathing</dt><dd>${breathable(room) ? 'Breathable' : 'Suit required'}</dd><dt>Pressure</dt><dd>${room.pressure.toFixed(1)}% of nominal</dd><dt>Oxygen</dt><dd>${(room.oxygenFraction * 100).toFixed(1)}%</dd><dt>Exhaled gas</dt><dd>${(room.co2Fraction * 100).toFixed(2)}%</dd><dt>Smoke</dt><dd>${((room.smoke||0)/room.volume).toFixed(3)} per tile</dd><dt>Compartment</dt><dd>${room.volume} tiles · ${room.sealed ? 'sealed' : 'open to exterior'}</dd>`;
}
export function doorDetails(t, tick, site=null) {
  if (t.building !== 'door') return '';
  const owner=site&&airlockControlOwner(site,t);
  return `<hr><div class="eyebrow">PRESSURE DOOR</div><p>${doorOpen(t, tick) ? 'Open; gas can flow.' : 'Shut; atmosphere isolated.'}${t.hp < 100 ? ' Damaged seals may leak.' : ''}</p>
    ${airlockOwnershipDetails(site,t)}<div class="job-priority">${[['auto', 'Automatic'], ['open', 'Hold open'], ['closed', 'Seal shut']].map(([mode, label]) => `<button data-action="door" ${owner?'disabled':''} data-door-mode="${mode}" aria-pressed="${t.doorMode === mode}" class="${t.doorMode === mode ? 'active' : ''}">${label}</button>`).join('')}</div><p class="crew-hint">${owner?'The controller owns this door’s interlock. Repair work remains available.':'Automatic doors open for passing crew. Sealed doors block routes. A configured airlock cycles its chamber before admitting crew.'}</p>`;
}
