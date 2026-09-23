import { temperatureAt, thermalSafe } from './thermal.js';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function thermalDetails(site, t) {
  const room = site.rooms.find(r => r.cells.includes(`${t.x},${t.y}`));
  return `<dt>Temperature</dt><dd>${temperatureAt(site, t.x, t.y).toFixed(1)} °C${room && !thermalSafe(room) ? ' · unsafe' : ''}</dd><dt>Exterior</dt><dd>${site.thermal.ambient} °C</dd>`;
}
export function climateDetails(t) {
  if (t.building !== 'climate') return '';
  const c = t.climate;
  return `<hr><div class="eyebrow">CLIMATE CONTROL</div><p>${esc(c.status)}</p>
    <form class="production-form" data-climate-form><label>Target temperature (°C)<input name="climate-target" aria-label="Target temperature" type="number" required min="-20" max="35" step="1" value="${c.target}"></label><button type="submit">Apply temperature</button></form>
    <button data-action="climate-toggle" aria-pressed="${c.enabled}">${c.enabled ? 'Pause climate control' : 'Resume climate control'}</button>
    <p class="crew-hint">Regulates this compartment. Needs 2 kW while enabled; pauses release that load. Damage reduces heating and cooling. Open doors and broken hulls lose heat faster. Targets below 5 °C preserve food; keep cold stores separate from living rooms. Crops need 10–35 °C; crew recover best at 5–35 °C.</p>`;
}
