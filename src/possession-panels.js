import { ITEM_STYLES } from './item-lots.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function itemsDetails(inventory) {
  const items=inventory?._items||[];if(!items.length)return '';
  return `<details data-item-list><summary>${items.length} crafted ${items.length===1?'keepsake':'keepsakes'}</summary><ul class="crew-memories">${items.map(i=>`<li data-entity="${esc(i.id)}">${esc(ITEM_STYLES[i.style])} · quality ${i.quality}/4<br><small>${esc(i.id)} · made by ${esc(i.maker)}</small></li>`).join('')}</ul></details>`;
}
export function possessionDetails(c,crew) {
  const item=c.possessions.inventory._items?.[0];
  return `<hr><div class="eyebrow">PERSONAL KEEPSAKE</div>${item?`<p data-entity="${esc(item.id)}">${esc(ITEM_STYLES[item.style])} · quality ${item.quality}/4</p><p class="crew-hint">${esc(item.id)} · made by ${esc(crew.find(p=>p.id===item.maker)?.name||item.maker)}. ${item.style===c.housing.preference?'Matches my preference.':'A different style from my preference.'}</p>`:'<p>None owned. Available keepsakes can be collected during a new break.</p>'}
  ${c.health>0?`<button data-action="possession-policy" data-crew="${esc(c.id)}" aria-pressed="${c.possessions.collect}">${c.possessions.collect?'Stop collecting keepsakes':'Collect a keepsake during downtime'}</button>${item&&c.site!=='transit'?`<button data-action="possession-release" data-crew="${esc(c.id)}">Put keepsake down here</button>`:''}`:''}
  <p class="crew-hint">One personal pocket item. Actual downtime provides enjoyment; quality and matching style help. Putting it down disables collection until enabled again.</p>`;
}
