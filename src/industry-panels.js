import { itemsDetails } from './possession-panels.js';
import { foodDetails } from './food-panels.js';
import { temperatureAt } from './thermal.js';
import { DEPOT_CAPACITY, depotUsage } from './storage.js';
import { RECIPES, RESOURCES } from './data.js';
import { OUTPUT_CAPACITY } from './industry.js';
import { quantity, resourceEntries } from './inventory.js';

export const inventoryText = items => resourceEntries(items).filter(([, n]) => n > 0).map(([r, n]) => `${Number(n.toFixed(2))} ${r === 'air' ? 'breathing mix' : r}`).join(', ') || 'Empty';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function storageDetails(t, s = null, siteId = null) {
  const temp = s ? temperatureAt(s.sites[siteId], t.x, t.y) : 20;
  if (t.building === 'stockpile') {
    const usage = s ? depotUsage(s, siteId, t) : { used: quantity(t.stock), reserved: 0, incoming: 0 };
    return `<hr><div class="eyebrow">DEPOT STORAGE</div><p>${esc(inventoryText(t.stock))}</p>${foodDetails(t.stock, temp)}${itemsDetails(t.stock)}
      <dl><dt>Occupied</dt><dd>${Number(usage.used.toFixed(2))} / ${DEPOT_CAPACITY} units</dd><dt>Reserved for jobs</dt><dd>${Number(usage.reserved.toFixed(2))}</dd><dt>On the way</dt><dd>${Number(usage.incoming.toFixed(2))}</dd></dl>
      <div class="eyebrow">ACCEPTED RESOURCES</div><div class="storage-filters">${RESOURCES.map(r => `<button data-action="depot-filter" data-resource="${r}" aria-pressed="${t.storage.accepted.includes(r)}" class="${t.storage.accepted.includes(r) ? 'active' : ''}">${r === 'air' ? 'Breathing mix' : r}</button>`).join('')}</div>
      <p class="crew-hint">Room purpose can further restrict deliveries. Rejected stock stays usable until hauled to another accepting depot. Full depots leave excess cargo on the ground. Reserved supplies occupy space until collected.</p>
      <div class="eyebrow">HAULING PRIORITY</div><div class="job-priority">${[[1, 'Low'], [3, 'Normal'], [5, 'Urgent']].map(([n, label]) => `<button data-action="depot-priority" data-priority="${n}" aria-pressed="${t.storage.priority === n}" class="${t.storage.priority === n ? 'active' : ''}">${label}</button>`).join('')}</div>
      <p class="crew-hint">Haulers prefer urgent destinations and restock higher-priority depots from lower-priority ones. Life-support deliveries are urgent; other machine deliveries follow their production priority. The resource bar counts available depot stock.</p>`;
  }
  const recipe = RECIPES[t.building], m = t.machine;
  if (!recipe || !m || recipe.automatic) return '';
  if (recipe.lifeSupport) return `<hr><div class="eyebrow">LIFE SUPPORT</div><p>${esc(m.status)}</p><dl><dt>Make-up supply</dt><dd>${esc(inventoryText(m.input))}</dd></dl><p class="crew-hint">Power recycles exhaled gas. Crew deliver breathing mix to replace leaks and suit refills. Make more in an atmosphere processor.</p><button data-action="machine" aria-pressed="${m.enabled}">${m.enabled ? 'Pause life support' : 'Resume life support'}</button>`;
  const job = s?.jobs.find(j => j.kind === 'operate' && j.site === siteId && j.x === t.x && j.y === t.y);
  const operator = s?.crew.find(c => c.id === job?.worker), o = m.order;
  return `<hr><div class="eyebrow">PRODUCTION</div><p>${esc(m.status)}</p><p>${inventoryText(recipe.input)} → ${inventoryText(recipe.output)} · ${recipe.duration} work</p>
    <dl><dt>Operator</dt><dd>${operator ? esc(operator.name) : "Unassigned"}</dd><dt>Completed batches</dt><dd>${m.completed}</dd>${o.mode === "batches" ? `<dt>Batches remaining</dt><dd>${o.remaining}</dd>` : ""}<dt>Input buffer</dt><dd>${esc(inventoryText(m.input))}</dd><dt>Active batch</dt><dd>${esc(inventoryText(m.batch))}</dd><dt>Progress</dt><dd>${m.progress.toFixed(1)} / ${recipe.duration} work</dd><dt>Output (${quantity(m.output)} / ${OUTPUT_CAPACITY})</dt><dd>${esc(inventoryText(m.output))}</dd></dl>
    ${t.building==='galley'?'<p class="crew-hint">Uses unprepared food only. Stock target counts prepared food; cooking preserves ingredient age. Quality benefits crew when eaten.</p>':''}
    ${m.legacyCrop ? '<p class="crew-hint">This crop was started before nutrient supplies were introduced. It finishes with its original water; the next crop needs fertilizer.</p>' : ''}
    ${foodDetails(m.input, temp, "Input food")}${foodDetails(m.batch, temp, "Batch ingredients")}${foodDetails(m.output, temp, "Output food")}${itemsDetails(m.output)}
    <p class="crew-hint">Enable Production for operators and Hauling for deliveries. Skill and recovery affect throughput. Started batches keep their ingredients and work.</p>
    <form class="production-form" data-production-form>
      <label>Production order<select name="production-mode" aria-label="Production order">${[['continuous', 'Continuous'], ['batches', 'Fixed batches'], ['stock', 'Stock target']].map(([mode, name]) => `<option value="${mode}" ${o.mode === mode ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
      <label>Batch count / stock target<input name="production-limit" aria-label="Batch count or stock target" type="number" required min="0" max="1000" step="1" value="${o.limit}"></label>
      <p class="crew-hint">Continuous ignores the amount. Stock targets count available products and promised output on this site. Existing batches finish when you change an order.</p><button type="submit">Apply order</button>
    </form><div class="job-priority" aria-label="Production priority">${[[1, 'Low'], [3, 'Normal'], [5, 'Urgent']].map(([n, label]) => `<button data-action="production-priority" data-priority="${n}" aria-pressed="${o.priority === n}" class="${o.priority === n ? 'active' : ''}">${label}</button>`).join('')}</div><button data-action="machine" aria-pressed="${m.enabled}">${m.enabled ? 'Pause production' : 'Resume production'}</button>`;
}
