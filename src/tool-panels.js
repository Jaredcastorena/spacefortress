import {TOOL_MATERIALS,TOOL_KINDS,isTool} from './tool-data.js';
import {equippedTool,toolStatus} from './tools.js';
import {tileAt,positionOf} from './spatial.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const toolName=i=>`${TOOL_MATERIALS[i.material].name} ${TOOL_KINDS[i.kind].name}`;
export function toolDetails(s,c){
 const item=equippedTool(c),status=toolStatus(c),t=c.site==='transit'?null:tileAt(s.sites[c.site],positionOf(c));
 const available=[];
 if(t&&!item&&c.health>0&&!status.pickup)for(const owner of s.sites[c.site].tiles)for(const [source,inventory] of [['stock',owner.stock],['drop',owner.drop],['output',owner.machine?.output]])for(const tool of inventory?._items||[])if(isTool(tool))available.push(`<button data-action="tool-equip" data-simulation-action="crew.tools.equip" data-crew="${esc(c.id)}" data-item="${esc(tool.id)}" data-source="${source}">Collect ${esc(toolName(tool))} · ${Math.round(tool.condition)}% · floor ${owner.z??0} · ${owner.x}/${owner.y}</button>`);
 return `<hr><div class="eyebrow">WORK TOOL</div>${item?`<p data-entity="${esc(item.id)}">${esc(toolName(item))} · quality ${item.quality}/4<br>Condition ${item.condition.toFixed(1)}% · ${TOOL_KINDS[item.kind].work} speed ×${status.multiplier.toFixed(2)}</p><p class="crew-hint">${status.broken?'Broken: work continues at normal speed.':'Condition wears only during matching construction, maintenance or mining work.'} Put it down for delivered repair at a tool workshop; repair preserves this item’s identity.</p>${c.health>0&&t?`<button data-action="tool-release" data-simulation-action="crew.tools.release" data-crew="${esc(c.id)}">Put tool down here</button>`:''}`:status.pickup?`<p>Collecting ${esc(status.pickup.item)} on floor ${status.pickup.target.z}.</p><button data-action="tool-cancel" data-simulation-action="crew.tools.cancel" data-crew="${esc(c.id)}">Cancel tool pickup</button>`:`<p>No work tool equipped. Choose a reachable local tool; this crew member will walk to collect it.</p><details><summary>Choose a work tool (${available.length})</summary>${available.join('')}</details>`}`;
}
