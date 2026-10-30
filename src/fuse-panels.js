import { BUILDINGS } from './data.js';
import { FUSE_DIRECTIONS, FUSE_RATINGS } from './fuses.js';
import { protectionClosed, FUSE_REPLACEMENT_COST, FUSE_REPLACEMENT_WORK } from './power-protection.js';
import { fuseConditions } from './power.js';
import { breakerTerminals } from './power-topology.js';
import { tileAt, sameCell } from './spatial.js';
const directions={n:'N ↗',ne:'NE →',se:'SE ↘',s:'S ↙',sw:'SW ←',nw:'NW ↖'};
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function entityLabel(site,id){const [x,y,z=0]=id.split(':').slice(2).map(Number),t=tileAt(site,{x,y,z});return `${BUILDINGS[t?.building]?.name||'Cable'} ${x}/${y}${z?`/${z}`:''}${t?.building==='battery'?` · ${t.charge.toFixed(1)} kJ`:''}`;}
export function fuseDetails(s,site,t) {
 if(t.building!=='fuseBox')return '';
 const p=t.protection,closed=protectionClosed(t),info=fuseConditions(s,site,t),ports=breakerTerminals(t);
 const pending=s.jobs.some(j=>j.site===site.id&&j.kind==='replaceFuse'&&sameCell(j,t));
 const advisory=[info.bypassed?'A bypass route still connects this branch.':'',info.sourceEntities.length?`Output-side power ${info.sourceEntities.length===1?'source remains':'sources remain'}: ${info.sourceEntities.slice(0,2).map(id=>entityLabel(site,id)).join(', ')}${info.sourceEntities.length>2?` and ${info.sourceEntities.length-2} more`:''}.`:''].filter(Boolean).join(' ');
 return `<hr><section data-fuse-panel><div class="eyebrow">DISPOSABLE FUSE</div>
<p data-fuse-status data-blocked="${info.blocked}">${esc(info.status)}</p>${advisory?`<p data-fuse-advisory>${esc(advisory)}</p>`:''}
<dl><dt>Contact</dt><dd data-fuse-contact>${p.blown?'Blown open':closed?'Closed':'Open'}</dd><dt>Cartridge rating</dt><dd>${p.rating} kW · ${info.effectiveRating.toFixed(2)} kW at current condition</dd></dl>
<button data-action="fuse-toggle" data-fuse-focus="toggle" aria-pressed="${p.enabled}" ${!p.enabled&&(p.blown||t.hp<=0)?'disabled':''}>${p.enabled?'Open fuse switch':'Close fuse switch'}</button>
${p.blown?`<button data-action="order" data-kind="replaceFuse" data-simulation-action="job.order" data-fuse-focus="replace" ${pending||p.enabled||t.hp<=0||t.fire?'disabled':''}>${pending?'Replacement ordered':`Replace cartridge · ${FUSE_REPLACEMENT_COST.alloy} alloy`}</button><p class="crew-hint">Open the switch, repair the box and suppress any fire before replacement. A worker must deliver alloy and complete ${FUSE_REPLACEMENT_WORK} engineering work; the new cartridge stays open.</p>`:''}
<details data-fuse-diagnostics><summary data-fuse-focus="summary">Direction, rating and branch details</summary>
<div class="job-priority" aria-label="Fuse output direction">${Object.keys(FUSE_DIRECTIONS).map(direction=>`<button data-action="fuse-direction" data-direction="${direction}" data-fuse-focus="direction-${direction}" aria-pressed="${p.direction===direction}" ${closed?'disabled':''}>${directions[direction]}</button>`).join('')}</div>
<div class="job-priority" aria-label="Fuse cartridge rating">${FUSE_RATINGS.map(rating=>`<button data-action="fuse-rating" data-fuse-rating="${rating}" data-fuse-focus="rating-${rating}" aria-pressed="${p.rating===rating}" ${closed?'disabled':''}>${rating} kW</button>`).join('')}</div>
<dl><dt>Input terminal</dt><dd>${esc(ports.input)}</dd><dt>Output terminal</dt><dd>${esc(ports.output)}</dd><dt>Input circuit</dt><dd>${info.inputCircuit||'None'}</dd><dt>Output circuit</dt><dd>${info.outputCircuit||'None'}</dd><dt>External bypass</dt><dd data-fuse-bypass>${info.bypassed?'Present — this contact cannot isolate the branch':'No route around this contact'}</dd><dt>Next tick</dt><dd data-fuse-prediction>${info.wouldBlow?'Cartridge will blow from excessive contact flow':'No blow currently predicted'}</dd>
<dt>Planned contact flow</dt><dd data-fuse-planned-flow>${info.plannedThroughput.toFixed(2)} kW${info.signedThroughput>0?' · input → output':info.signedThroughput<0?' · output → input':''}</dd><dt>Last delivered flow</dt><dd data-fuse-delivered-flow>${info.lastDeliveredTick===null?'Not measured':`${info.lastDeliveredThroughput.toFixed(2)} kW · tick ${info.lastDeliveredTick}`}</dd><dt>Effective rating</dt><dd data-fuse-effective-rating>${info.effectiveRating.toFixed(2)} kW · ${info.rating} kW at full condition</dd></dl>
<p>Supplied wet faults in the output branch</p><ul data-fuse-faults>${info.faultEntities.map(id=>`<li data-entity="${esc(id)}">${esc(entityLabel(site,id))}</li>`).join('')||'<li>None detected</li>'}</ul>
<p>Sources on the output side with this contact open</p><ul data-fuse-sources>${info.sourceEntities.map(id=>`<li data-entity="${esc(id)}">${esc(entityLabel(site,id))}</li>`).join('')||'<li>No available source detected</li>'}</ul>
<p class="crew-hint">Open the contact before changing direction or rating. Only the two marked terminals connect. Excessive power in either direction blows the cartridge immediately; damage lowers its effective rating. An output-side battery or another route can keep wiring powered after this fuse opens. Repairing the box does not replace a blown cartridge.</p></details></section>`;
}
export function restoreFuseFocus(inspector,key) {
 if(!key)return;
 const controls=[...inspector.querySelectorAll('[data-fuse-focus]')];
 const target=controls.find(control=>control.dataset.fuseFocus===key&&!control.disabled)||controls.find(control=>control.dataset.fuseFocus==='summary');
 target?.focus({preventScroll:true});
}
