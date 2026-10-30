import { BUILDINGS } from './data.js';
import { BREAKER_DIRECTIONS, BREAKER_MODES, BREAKER_RATINGS, breakerClosed, breakerStatus, overloadMode } from './breakers.js';
import { breakerTerminals } from './power-topology.js';
import { tileAt } from './spatial.js';
const directions={n:'N ↗',ne:'NE →',se:'SE ↘',s:'S ↙',sw:'SW ←',nw:'NW ↖'};
const modeLabels={manual:'Manual',wet_fault:'Wet fault',overload:'Overload',wet_fault_and_overload:'Wet fault + overload'};
const protectionLabels={manual:'Manual disconnect',wet_fault:'Supplied wet-fault relay',overload:'Delayed overload relay',wet_fault_and_overload:'Wet-fault and delayed overload relay'};
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function entityLabel(site,id){const [x,y,z=0]=id.split(':').slice(2).map(Number),t=tileAt(site,{x,y,z});return `${BUILDINGS[t?.building]?.name||'Cable'} ${x}/${y}${z?`/${z}`:''}${t?.building==='battery'?` · ${t.charge.toFixed(1)} kJ`:''}`;}
export function breakerDetails(s,site,t){
  if(t.building!=='breaker')return '';
  const p=t.protection,closed=breakerClosed(t),info=breakerStatus(s,site,t),ports=breakerTerminals(t);
  const advisory=[info.bypassed?'Bypass route still connects this branch.':'',info.sourceEntities.length?`Output-side power ${info.sourceEntities.length===1?'source remains':'sources remain'}: ${info.sourceEntities.slice(0,2).map(id=>entityLabel(site,id)).join(', ')}${info.sourceEntities.length>2?` and ${info.sourceEntities.length-2} more`:''}.`:''].filter(Boolean).join(' ');
  const ratingControls=p.overload?`<div class="job-priority" aria-label="Breaker overload rating">${BREAKER_RATINGS.map(rating=>`<button data-action="breaker-rating" data-breaker-rating="${rating}" aria-pressed="${p.overload.rating===rating}" ${closed?'disabled':''}>${rating} kW</button>`).join('')}</div>`:'';
  const prediction=info.wouldTrip?(info.overloadWouldTrip?'Trip predicted for excessive contact flow':'Trip predicted for a supplied wet fault'):'No trip currently predicted';
  return `<hr><section data-breaker-panel><div class="eyebrow">BRANCH BREAKER</div>
<p data-breaker-status data-blocked="${info.blocked}">${esc(info.status)}</p>${advisory?`<p data-breaker-advisory>${esc(advisory)}</p>`:''}
<dl><dt>Contact</dt><dd data-breaker-contact>${p.tripped?'Tripped open':closed?'Closed':'Open'}</dd><dt>Condition</dt><dd>${t.hp.toFixed(1)}%</dd><dt>Protection</dt><dd>${protectionLabels[p.mode]}</dd><dt>Output side</dt><dd>${directions[p.direction]}</dd><dt>Input circuit</dt><dd data-breaker-input-circuit>${info.inputCircuit||'None'}</dd><dt>Output circuit</dt><dd data-breaker-output-circuit>${info.outputCircuit||'None'}</dd></dl>
<button data-action="breaker-toggle" aria-pressed="${p.enabled}" ${!p.enabled&&(p.tripped||t.hp<=0)?'disabled':''}>${p.enabled?'Open breaker':'Close breaker'}</button>${p.tripped?`<button data-action="breaker-reset" ${t.hp<=0||t.fire?'disabled':''}>Reset trip · stays open</button>`:''}
<div class="job-priority" aria-label="Breaker output direction">${Object.keys(BREAKER_DIRECTIONS).map(direction=>`<button data-action="breaker-direction" data-direction="${direction}" aria-pressed="${p.direction===direction}" ${closed?'disabled':''}>${directions[direction]}</button>`).join('')}</div>
<div class="job-priority" aria-label="Breaker protection mode">${BREAKER_MODES.map(mode=>`<button data-action="breaker-mode" data-breaker-mode="${mode}" aria-pressed="${p.mode===mode}" ${closed?'disabled':''}>${modeLabels[mode]}</button>`).join('')}</div>
<p class="crew-hint">${closed?'Open the contact before changing its direction, mode or rating.':'Only the two marked terminals connect; side neighbors do not.'} Reset clears the latch and leaves the contact open. Reclosing into an unresolved fault can trip again.${t.hp<100?' Repair preserves the requested switch setting and trip latch. An untripped breaker requested closed reconnects when repaired.':''}</p>
<details data-breaker-diagnostics><summary>Branch, flow and fault details</summary>
<dl><dt>Input terminal</dt><dd data-breaker-input-terminal>${esc(ports.input)}</dd><dt>Output terminal</dt><dd data-breaker-output-terminal>${esc(ports.output)}</dd><dt>External bypass</dt><dd data-breaker-bypass>${info.bypassed?'Present — this contact cannot isolate the branch':'No route around this contact'}</dd><dt>Next tick</dt><dd data-breaker-prediction>${prediction}</dd>
<dt>Planned contact flow</dt><dd data-breaker-planned-flow>${info.plannedThroughput.toFixed(2)} kW${info.signedThroughput>0?' · input → output':info.signedThroughput<0?' · output → input':''}</dd>
<dt>Last delivered flow</dt><dd data-breaker-delivered-flow>${info.lastDeliveredTick===null?'Not measured':`${info.lastDeliveredThroughput.toFixed(2)} kW · tick ${info.lastDeliveredTick}`}</dd>
<dt>Effective rating</dt><dd data-breaker-effective-rating>${info.effectiveRating.toFixed(2)} kW · ${info.rating} kW at full condition${overloadMode(p.mode)?'':' · overload protection off'}</dd>
<dt>Consecutive overloaded ticks</dt><dd data-breaker-overload-ticks>${info.overloadTicks} / ${info.overloadDelay}</dd></dl>${ratingControls}
<p>Supplied wet faults in the output branch</p><ul data-breaker-faults>${info.faultEntities.map(id=>`<li data-entity="${esc(id)}">${esc(entityLabel(site,id))}</li>`).join('')||'<li>None detected</li>'}</ul>
<p>Sources on the output side with this contact open</p><ul data-breaker-sources>${info.sourceEntities.map(id=>`<li data-entity="${esc(id)}">${esc(entityLabel(site,id))}</li>`).join('')||'<li>No available source detected</li>'}</ul>
<p class="crew-hint">An output-side battery or another route can keep wiring powered after this contact opens. Overload protection counts net power routed through this contact in either direction, including battery charging. Three consecutive excessive ticks trip it; damage lowers its effective rating. Unserved demand does not count. Wet-fault protection acts on supplied faults in the output branch when no bypass exists.</p></details></section>`;
}
