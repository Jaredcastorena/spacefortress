import { breathable, doorOpen } from './atmosphere.js';

export function atmosphereDetails(room) {
  if (!room) return '<dt>Atmosphere</dt><dd>Exterior · suit required</dd>';
  return `<dt>Breathing</dt><dd>${breathable(room) ? 'Breathable' : 'Suit required'}</dd><dt>Pressure</dt><dd>${room.pressure.toFixed(1)}% of nominal</dd><dt>Oxygen</dt><dd>${(room.oxygenFraction * 100).toFixed(1)}%</dd><dt>Exhaled gas</dt><dd>${(room.co2Fraction * 100).toFixed(2)}%</dd><dt>Smoke</dt><dd>${((room.smoke||0)/room.volume).toFixed(3)} per tile</dd><dt>Compartment</dt><dd>${room.volume} tiles · ${room.sealed ? 'sealed' : 'open to exterior'}</dd>`;
}
export function doorDetails(t, tick) {
  if (t.building !== 'door') return '';
  return `<hr><div class="eyebrow">PRESSURE DOOR</div><p>${doorOpen(t, tick) ? 'Open; gas can flow.' : 'Shut; atmosphere isolated.'}${t.hp < 100 ? ' Damaged seals may leak.' : ''}</p>
    <div class="job-priority">${[['auto', 'Automatic'], ['open', 'Hold open'], ['closed', 'Seal shut']].map(([mode, label]) => `<button data-action="door" data-door-mode="${mode}" aria-pressed="${t.doorMode === mode}" class="${t.doorMode === mode ? 'active' : ''}">${label}</button>`).join('')}</div><p class="crew-hint">Automatic doors open for passing crew. Sealed doors block routes. Two doors with a chamber between them can reduce gas loss.</p>`;
}
