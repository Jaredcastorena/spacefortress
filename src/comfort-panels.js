import { roomComfort, COMFORT_PREFERENCES } from './comfort.js';
import { roomAt } from './atmosphere.js';
export function comfortDetails(s,site,t,c=null) {
  const room=roomAt(site,t.x,t.y); if (!room) return '';
  const comfort=roomComfort(s,site,room,c);
  return `<hr><div class="eyebrow">ROOM COMFORT</div><dl><dt>${c?'Personal comfort':'General comfort'}</dt><dd>${comfort.usable ? `${comfort.score.toFixed(1)} · ${comfort.score>=2?'Restorative':comfort.score<=-2?'Uncomfortable':'Plain'}` : 'Unsafe for rest'}</dd><dt>Art condition</dt><dd>${comfort.art.toFixed(1)} / 2</dd><dt>Machine hum</dt><dd>${comfort.noise ? `${comfort.noise} source${comfort.noise===1?'':'s'}` : 'Quiet'}</dd><dt>Crowding</dt><dd>${comfort.crowding ? 'Cramped' : 'Enough floor space'}</dd><dt>Private sleeping space</dt><dd>${comfort.private?'One bed, one occupant at most':'Shared or no bed'}</dd><dt>Common table</dt><dd>${comfort.shared?'Available':'None'}</dd><dt>Exposed waste</dt><dd>${comfort.dirty?'Present':'None'}</dd></dl><p class="crew-hint">${c?COMFORT_PREFERENCES[c.housing.preference]+'. ':''}Art, privacy and shared tables appeal to different crew. Furnishing condition and powered displays affect comfort. Sleep and downtime change stress and create memories. Repeating the same decoration does not stack its benefit.</p>`;
}
