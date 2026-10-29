import { cellKey, positionOf } from './spatial.js';
import { airlockStatus, airlockControlOwner } from './airlock-access.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number = (value, digits=1) => Number.isFinite(value) ? value.toFixed(digits) : '—';
export const AIRLOCK_REFERENCES = [['chamber','Chamber tile'],['inner','Inner door'],['outer','Outer door'],['extractor','Extractor'],['pump','Pump'],['reservoir','Reservoir'],['vent','Vent']];
const phases = {idle:'Ready',prepare_entry:'Matching entry pressure',admit:'Admitting crew',seal_entry:'Sealing entry',recover:'Recovering chamber gas',refill:'Refilling chamber',release:'Releasing crew',paused:'Paused'};
const blockers = {
  no_power:'Restore wired power to the controller and gas devices.', reservoir_full:'Free reservoir capacity before resuming.', supply_empty:'Refill the isolated supply before resuming.',
  contaminated_mix:'Check oxygen, carbon dioxide and smoke; replace the unsafe mixture.', unsafe_temperature:'Bring the chamber and habitat to 5–35°C.', door_obstructed:'Clear the occupied doorway.',
  seal_broken:'Repair both pressure doors and the chamber seals.', equipment_damaged:'Repair the damaged controller, gas equipment or pipe.', layout_changed:'Restore the chamber and isolated gas route, then set up again.',
  route_unavailable:'Clear the chamber and both staging routes.', insufficient_suit:'Restore the traveler’s suit oxygen before admission.', pressure_mismatch:'Wait for chamber pressure to match the permitted side.',
  manual_release:'Manual release active. Close the released door by resuming when safe.', disabled:'Paused by command. Resume to recheck the assembly.'
};
const label = value => esc(phases[value] || String(value || 'Unknown').replaceAll('_',' '));
const focus = key => `data-airlock-focus="${key}"`;

export function airlockOwnershipDetails(site,t,layer='building') {
  const owner=site&&airlockControlOwner(site,t,layer); if(!owner)return '';
  const [, ,x,y,z='0']=owner.controller.split(':');
  return `<p class="crew-hint" data-airlock-owner>Airlock control · ${esc(x)} / ${esc(y)} · floor ${esc(z)} · ${label(owner.phase)}. Use the controller to pause, resume or release control.</p><button data-action="inspect-outpost-tile" data-site="${esc(site.id)}" data-x="${esc(x)}" data-y="${esc(y)}" data-z="${esc(z)}">Inspect airlock controller</button>`;
}

// Translate UI drafts to the same strict actions exposed to local agents.
// Drafts live in the view only; this function never reads or mutates simulation state.
export function airlockFormAction(operation,values,target,direction) {
  if(operation==='configure') {
    const args={...target};
    for(const [key] of AIRLOCK_REFERENCES) {
      const pair=['x','y'].map(axis=>values[`${key}-${axis}`]);
      if(pair.some(value=>value===undefined||String(value).trim()===''||!Number.isInteger(Number(value))||Number(value)<0))return null;
      args[key]=pair.map(Number);
    }
    return {id:'airlock.configure',args};
  }
  if(operation==='request'&&values.crew&&['inward','outward'].includes(direction))return {id:'airlock.request',args:{...target,crew:values.crew,direction}};
  if(operation==='release'&&['inner','outer'].includes(values.side)&&values.acceptAtmosphereLoss===true)return {id:'airlock.release',args:{...target,side:values.side,acceptAtmosphereLoss:true}};
  return null;
}

export function airlockDetails(s,site,t,draft={}) {
  if(t.building!=='airlockController')return '';
  const a=airlockStatus(s,site,t),crewName=id=>s.crew.find(c=>c.id===id)?.name||id;
  const field=(key,axis)=>draft[`${key}-${axis}`]??a?.config[key]?.[axis]??'';
  const setup=`<details class="outpost-section" data-panel-key="airlock-setup"><summary>Set up airlock${a?' · bound assembly':''}</summary><p class="crew-hint">Bind existing equipment. Choose any tile inside the sealed chamber, its habitat door and its exterior door. The extractor and vent share one isolated pump branch; a passive reservoir or gas supply tank is on the other. Supply tanks load delivered breathing mix between cycles while preserving recovery space. Use tile X / Y coordinates from floor ${t.z??0}. All parts must share this floor; the chamber must have no stairs or gas risers bypassing its controlled route.</p><form class="production-form" data-airlock-form="configure" data-simulation-action="airlock.configure">${AIRLOCK_REFERENCES.map(([key,name])=>`<div style="display:grid;grid-template-columns:minmax(0,1fr) 58px 58px;gap:6px;align-items:center"><span style="font-size:11px">${name}</span>${['x','y'].map(axis=>`<label>${axis.toUpperCase()}<input ${focus(`${key}-${axis}`)} name="${key}-${axis}" aria-label="${name} ${axis.toUpperCase()}" type="number" required min="0" max="${site.size-1}" step="1" value="${esc(field(key,axis))}"></label>`).join('')}</div>`).join('')}<button type="submit" ${focus('configure')}>Bind assembly</button></form><p class="crew-hint">The assembly must be idle and empty. Setup validates both doors and the full pipe route; it supplies no gas.</p></details>`;
  if(!a)return `<hr><section data-airlock-panel><div class="eyebrow">AIRLOCK</div><p>Not configured. Build the chamber and isolated gas assembly, then set it up here.</p>${setup}</section>`;
  const queue=a.queue||[],party=a.party,local=s.crew.filter(c=>c.site===site.id&&c.health>0);
  const occupied=new Set([...(a.chamberCells||[]),...Object.values(a.doors).map(d=>cellKey(d.tile))]);
  const canUnbind=!party&&!queue.length&&['idle','paused'].includes(a.phase)&&Object.values(a.doors).every(d=>d.intact&&!d.open)&&!s.crew.some(c=>c.site===site.id&&occupied.has(cellKey(positionOf(c))));
  const chosenCrew=local.some(c=>c.id===draft.crew)?draft.crew:local[0]?.id;
  const releaseSide=draft.side||'inner',opposite=a.doors[releaseSide==='inner'?'outer':'inner'],canRelease=opposite.intact&&!opposite.open;
  const gas=a.chamber?.gas,total=gas?gas.oxygen+gas.inert+gas.co2:0;
  const composition=gas?`O₂ ${number(total?gas.oxygen/total*100:0)}% · CO₂ ${number(total?gas.co2/total*100:0,2)}%`: 'No chamber reading';
  const requestRow=(q,active=false)=>`<li style="margin:8px 0;overflow-wrap:anywhere">${esc(crewName(q.crew))}${q.patient?` + ${esc(crewName(q.patient))}`:''} · ${q.direction==='inward'?'inward':'outward'}${q.emergency?' · low suit reserve':''}<br><button type="button" data-action="airlock-cancel" data-crew="${esc(q.crew)}" data-simulation-action="airlock.cancel" ${focus(`cancel-${esc(q.crew)}`)}>${active?'Request safe return':'Cancel request'}</button></li>`;
  return `<hr><section class="outpost-section" data-airlock-panel><div class="eyebrow">AIRLOCK</div><p data-airlock-phase>${label(a.phase)}${a.direction?` · ${a.direction==='inward'?'inward':'outward'}`:''}</p>${a.blocker?`<p data-airlock-blocker>${esc(blockers[a.blocker]||String(a.blocker).replaceAll('_',' '))}</p>`:''}<dl><dt>Chamber</dt><dd>${number(a.chamber?.pressure)}% nominal · ${number(a.chamber?.temperature)}°C</dd><dt>Mixture</dt><dd>${composition}${a.chamber?` · ${a.chamber.breathable?'breathable':'suit required'}`:''}</dd><dt>Reservoir free</dt><dd>${number(a.reservoir?.free)} / ${number(a.reservoir?.capacity,0)} units</dd><dt>Controller power</dt><dd>${a.powered?'Online':'Offline'}</dd><dt>Doors</dt><dd>${['inner','outer'].map(side=>`${side==='inner'?'Inner':'Outer'}: ${!a.doors[side].intact?'damaged':a.doors[side].open?'open':'shut'}${a.permissions[side]?' · permitted':' · locked'}`).join('<br>')}</dd><dt>Crew</dt><dd>${party?esc(crewName(party.crew)):'Chamber idle'} · ${queue.length} waiting</dd></dl><button type="button" data-action="airlock-enable" data-simulation-action="airlock.enable" aria-pressed="${a.enabled}" ${focus('enable')}>${a.enabled?'Pause airlock':'Resume airlock'}</button>
  <details data-panel-key="airlock-queue"><summary>Crew requests · ${queue.length} waiting</summary>${party||queue.length?`<ul style="padding-left:18px">${party?requestRow(party,true):''}${queue.map(q=>requestRow(q)).join('')}</ul>`:'<p>No waiting crew.</p>'}<form class="production-form" data-airlock-form="request" data-simulation-action="airlock.request"><label>Traveler<select name="crew" ${focus('crew')} ${!local.length?'disabled':''}>${local.map(c=>`<option value="${esc(c.id)}" ${chosenCrew===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><div style="display:flex;flex-wrap:wrap;gap:6px">${['inward','outward'].map(direction=>`<button type="submit" data-direction="${direction}" ${focus(`request-${direction}`)} ${!local.length?'disabled':''}>Cycle ${direction}</button>`).join('')}</div></form><p class="crew-hint">Crew must reach the requested side. A queued request preserves their task and carried supplies.</p></details>
  <details data-panel-key="airlock-gas"><summary>Measured gas stores</summary>${[['Chamber',a.chamber],['Habitat',a.habitat],['Reservoir',a.reservoir]].map(([name,store])=>`<p>${name}</p><dl>${['oxygen','inert','co2'].map(key=>`<dt>${{oxygen:'Oxygen',inert:'Inert gas',co2:'Carbon dioxide'}[key]}</dt><dd>${number(store?.gas?.[key],3)} units</dd>`).join('')}<dt>Smoke</dt><dd>${number(store?.smoke,3)} units</dd>${store?.pressure!==undefined?`<dt>Pressure</dt><dd>${number(store.pressure)}% nominal</dd>`:''}</dl>`).join('')}</details>
  ${setup}<details data-panel-key="airlock-manual"><summary>Manual release / unbind</summary><p>Manual release opens one side and stops the cycle. Pressure differences and contamination can expose crew or lose atmosphere. The opposite door must be shut and intact.</p><form class="production-form" data-airlock-form="release" data-simulation-action="airlock.release"><label>Release side<select name="side" ${focus('release-side')}><option value="inner" ${releaseSide==='inner'?'selected':''}>Inner · habitat</option><option value="outer" ${releaseSide==='outer'?'selected':''}>Outer · exterior</option></select></label><label style="display:flex;align-items:flex-start;gap:8px"><input style="width:auto" type="checkbox" name="acceptAtmosphereLoss" required ${focus('accept-loss')} ${draft.acceptAtmosphereLoss?'checked':''}>I accept atmosphere loss and exposure.</label><button type="submit" ${focus('release')} ${canRelease?'':'disabled'}>Release selected door</button><p class="crew-hint" data-airlock-release-guard ${canRelease?'hidden':''}>Opposite door is open or damaged. Restore its seal first.</p></form><button type="button" data-action="airlock-unbind" data-simulation-action="airlock.unbind" ${focus('unbind')} ${canUnbind?'':'disabled'}>Unbind assembly</button><p class="crew-hint">Unbinding requires an empty chamber and doorways, no requests or active party, and both doors shut. Stored gas remains in its equipment.</p></details></section>`;
}
