import { BUILDINGS, RESOURCES, RECIPES, SITES } from './data.js';
import { inventoryText } from './industry-panels.js';
import { quantity } from './inventory.js';
import { freightStatus } from './freight.js';
import { residentIds, residentSite, shuttlePresence } from './outposts.js';
import { outpostReadiness } from './outpost-readiness.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amount = value => Number(value || 0).toFixed(1).replace(/\.0$/, '');
const names = (s, ids) => ids.map(id => esc(s.crew.find(c => c.id === id)?.name || id)).join(' · ') || 'None';
const inventory = (site, slot) => {
  const total = {};
  for (const tile of site.tiles) for (const resource of RESOURCES) total[resource] = (total[resource] || 0) + (tile[slot]?.[resource] || 0);
  return total;
};
export const localDepotStock = (s, siteId) => inventory(s.sites[siteId], 'stock');
const freightReason = status => typeof status.blocked === 'object' ? status.blocked?.message : ({
  shuttle_in_transit:'The shuttle is in transit.', shuttle_elsewhere:'The shuttle is at another site.',
  terminal_missing:'No shuttle terminal remains here.', terminal_destroyed:'Repair this shuttle terminal before moving freight.',
  terminal_busy:'Finish or cancel the terminal job first.', freight_pending:'Finish or cancel the freight job first.', expedition_not_working:'Resume field work before unloading freight.', terminal_broken:'Repair this shuttle terminal before moving freight.', departure_pending:'Cancel departure preparation before changing freight.',
})[status.blocked] || (status.blocked ? String(status.blocked).replaceAll('_',' ') : '');

function manifestEditor(siteId, operation, draft, enabled) {
  const items = draft?.items || {}, total = quantity(items);
  return `<details data-panel-key="freight-${siteId}-${operation}"><summary>${operation === 'load' ? 'Prepare a freight manifest' : 'Choose a partial unload'}</summary>
    <form class="production-form freight-form" data-freight-form data-site="${siteId}" data-operation="${operation}">
      <label>Material<select name="freight-resource">${RESOURCES.map(r => `<option value="${r}" ${r === (draft?.resource || 'alloy') ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label>Units<input name="freight-amount" type="number" min="0.25" step="any" value="${esc(draft?.amount ?? 1)}" required></label>
      <button type="submit" data-ui-action="freight.manifest.add">Add to manifest</button>
    </form>
    <ul class="freight-manifest" data-freight-manifest>${Object.entries(items).map(([r,n]) => `<li><span>${esc(r)} · ${amount(n)}</span><button data-action="freight-draft-remove" data-ui-action="freight.manifest.remove" data-site="${siteId}" data-operation="${operation}" data-resource="${r}" aria-label="Remove ${r} from manifest">×</button></li>`).join('') || '<li>No materials selected.</li>'}</ul>
    <button data-action="freight-${operation}" data-site="${siteId}" ${!enabled || !total ? 'disabled' : ''}>${operation === 'load' ? 'Load manifest aboard' : 'Unload manifest here'} · ${amount(total)} units</button>
    <p class="crew-hint">This is a request for physical hauling. Adding a material to this list does not move it or reserve it.</p>
  </details>`;
}

export function freightDetails(s, siteId, drafts = {}) {
  if (!s.sites[siteId]) return '';
  const status = freightStatus(s, siteId), presence = shuttlePresence(s, siteId);
  const job = s.jobs.find(j => ['loadCargo','unloadCargo'].includes(j.kind) && j.site === siteId);
  const idle = siteId === 'surface' ? !s.mission && !s.departure : s.mission?.site === siteId && s.mission.phase === 'working';
  const enabled = presence.usable && idle && !job;
  const imports = inventory(s.sites[siteId], 'imports'), stock = localDepotStock(s, siteId);
  const waiting = job ? job.sources.reduce((sum, source) => sum + quantity(source.items), 0) : 0;
  const carried = job ? Math.max(0, quantity(job.cost) - waiting - quantity(job.materials) - (job.missingFood || 0)) : 0;
  return `<details data-panel-key="freight-${siteId}" class="outpost-section"><summary>Freight & local supplies</summary>
    <dl><dt>Shuttle location</dt><dd>${esc(SITES[presence.location]?.name || 'In transit')}${presence.present ? ' · present' : ''}</dd>
    <dt>Freight aboard</dt><dd data-freight-onboard>${esc(inventoryText(s.shuttle.freight))}</dd>
    <dt>Salvage aboard</dt><dd>${esc(inventoryText(s.mission?.cargo))}</dd>
    <dt>Hold available</dt><dd>${amount(status.free)} / ${amount(status.capacity)} units</dd>
    <dt>Salvage pickup claims</dt><dd>${amount(status.claimed)} units</dd><dt>Freight reserved</dt><dd>${amount(status.reserved)} units</dd>
    ${siteId !== 'surface' ? `<dt>Unloaded at docks</dt><dd data-dock-imports>${esc(inventoryText(imports))}</dd>` : ''}
    <dt>${esc(SITES[siteId].name)} depots</dt><dd data-local-stock>${esc(inventoryText(stock))}</dd></dl>
    <p class="crew-hint">Onboard freight is unavailable to local construction and machines until a crew member unloads it. Service fuel and breathing stores are separate. Loose piles and reserved materials are shown at their tiles.</p>
    ${freightReason(status) ? `<p data-freight-blocked>${esc(freightReason(status))}</p>` : ''}
    ${job ? `<div data-freight-job="${esc(job.id)}"><strong>${job.kind === 'loadCargo' ? 'Loading freight' : 'Unloading freight'}</strong><p>${esc(job.blockedReason || 'Crew collect, carry and finish this terminal job.')}</p><dl><dt>Awaiting pickup</dt><dd>${amount(waiting)} units</dd><dt>Carried</dt><dd>${amount(carried)} units</dd><dt>Staged at terminal</dt><dd>${esc(inventoryText(job.materials))}</dd></dl><button data-action="cancel" data-job="${esc(job.id)}">Cancel freight job</button><p class="crew-hint">Cancellation preserves goods at their physical owners; carried or staged supplies may remain here.</p></div>` : ''}
    ${siteId === 'surface' ? manifestEditor(siteId, 'load', drafts.load, enabled) : ''}
    <button data-action="freight-unload-all" data-site="${siteId}" ${!enabled || !quantity(s.shuttle.freight) ? 'disabled' : ''}>Unload all freight here</button>
    ${manifestEditor(siteId, 'unload', drafts.unload, enabled)}
  </details>`;
}

export function returnManifestDetails(s, siteId, draft = []) {
  const m = s.mission;
  if (!m || m.site !== siteId) return '';
  const editable = ['working','boarding'].includes(m.phase), current = m.returnCrew;
  const available = s.crew.filter(c => c.site === siteId && c.health > 0);
  return `<details data-panel-key="return-${siteId}" class="outpost-section"><summary>Return team · ${current.length} / 2 seats</summary>
    <p>Assigned: <span data-return-assigned>${names(s,current)}</span></p>
    ${editable ? `<p class="crew-hint">Choose one or two people physically here. Station a visitor before leaving them off this list. Selected residents remain here until they actually board and depart.</p>
    <div class="crew-list">${available.map(c => `<button class="crew-row" data-action="return-crew-draft" data-crew="${esc(c.id)}" data-entity="${esc(c.id)}" data-ui-action="expedition.return_crew.select" aria-pressed="${draft.includes(c.id)}" ${!draft.includes(c.id) && draft.length >= 2 ? 'disabled' : ''}><span aria-hidden="true">${draft.includes(c.id) ? '☑' : '☐'}</span><span class="crew-text"><strong>${esc(c.name)}</strong><small>${residentSite(s,c.id) === siteId ? 'Resident' : 'Visitor'} · ${esc(c.activity)}</small></span></button>`).join('')}</div>
    <button data-action="return-crew-apply" ${draft.length < 1 || draft.length > 2 ? 'disabled' : ''}>Assign selected return team</button>` : '<p>Return selection is locked while the shuttle is in transit.</p>'}
  </details>`;
}

function readinessDetails(s, siteId, crewIds, r = outpostReadiness(s,siteId,crewIds)) {
  return `<div data-habitat-readiness="${r.ready ? 'ready' : 'blocked'}"><strong>${r.ready ? 'Ready for this crew now' : 'Habitat needs attention'}</strong><p class="crew-hint">Checked for: ${names(s,crewIds)}. Conditions and finite reserves can change.</p>${r.blockers.length ? `<ul class="outpost-blockers">${r.blockers.map(b => `<li data-readiness-code="${esc(b.code)}">${esc(b.message)}</li>`).join('')}</ul>` : '<p>Measured shelter, temperature, air, supplies and beds meet the current checks.</p>'}
    <dl><dt>Safe reachable bunks</dt><dd>${r.bunks.available} / ${r.bunks.required} needed</dd>${Object.entries(r.provisions.required).filter(([resource,needed])=>needed>0).map(([resource,needed])=>`<dt>Local ${esc(resource)} reserve</dt><dd>${amount(r.provisions.available[resource])} / ${amount(needed)} minimum</dd>`).join('')}<dt>Habitat circuit supply</dt><dd>${amount(r.power.output)} / ${amount(r.power.demand)} kW</dd><dt>Habitat battery charge</dt><dd>${amount(r.power.storedEnergy)} kJ</dd></dl>
    <p class="crew-hint">Reserves count reachable, unpromised local supplies. These minimums are commissioning checks, not an endurance forecast.</p>
    <details data-panel-key="habitat-rooms"><summary>Measured compartments · ${r.rooms.length}</summary>${r.rooms.map(room=>{const position=room.entity.split(':')[2], [x,y]=position.split(',');return `<div class="habitat-reading"><strong>Compartment ${esc(position)}</strong><dl><dt>Temperature</dt><dd>${amount(room.temperature)} °C</dd><dt>Pressure</dt><dd>${amount(room.pressure)}%</dd><dt>Oxygen partial pressure</dt><dd>${amount(room.oxygenPartialPressure)}%</dd><dt>Hull</dt><dd>${room.sealed?'Sealed':'Unsealed'}</dd></dl>${room.blockers.map(b=>`<p>${esc(b.message)}</p>`).join('')}<button data-action="inspect-outpost-tile" data-ui-action="site.tile.inspect" data-site="${siteId}" data-x="${x}" data-y="${y}">Inspect compartment</button></div>`;}).join('') || '<p>No habitat compartments built.</p>'}</details></div>`;
}

export function residentDetails(s, siteId) {
  if (siteId !== 'wreck') return '';
  const ids = residentIds(s,siteId), present = s.crew.filter(c => c.site === siteId && c.health > 0);
  const candidate = present.find(c => !ids.includes(c.id));
  const checked = ids.length ? ids : candidate ? [candidate.id] : [];
  const checks = new Map(), check = list => { const key=list.join(','); if(!checks.has(key)) checks.set(key,outpostReadiness(s,siteId,list)); return checks.get(key); };
  const people = s.crew.filter(c=>ids.includes(c.id) || present.includes(c));
  return `<details data-panel-key="residents-${siteId}" class="outpost-section"><summary>Residents & habitat · ${ids.length} registered</summary>
    <dl><dt>Residents</dt><dd>${names(s,ids)}</dd><dt>Living crew present</dt><dd>${names(s,present.map(c=>c.id))}</dd></dl>
    ${readinessDetails(s,siteId,checked,check(checked))}
    ${people.map(c => {
      const resident = ids.includes(c.id), proposed = resident ? ids.filter(id=>id!==c.id) : [...ids,c.id];
      const mission = s.mission, visiting = mission?.site === siteId && mission.phase === 'working';
      const hasReturn = mission?.site === siteId && ['working','boarding'].includes(mission.phase) && mission.returnCrew.includes(c.id);
      const otherTraveler = mission?.returnCrew.some(id=>id!==c.id && s.crew.some(person=>person.id===id && person.health>0 && person.site===siteId));
      const proposedReadiness = resident ? null : check(proposed);
      const ready = resident ? c.health <= 0 || c.site === 'surface' : visiting && otherTraveler && proposedReadiness.ready;
      const needsPickup = resident && c.health > 0 && c.site !== 'surface';
      const pickupAvailable = mission?.site === siteId && ['working','boarding'].includes(mission.phase) && c.site === siteId;
      const reason = resident ? 'Select this resident for the present shuttle return team first.' : !visiting ? 'Station new residents during a working visit.' : !otherTraveler ? 'Keep at least one other living return traveler.' : proposedReadiness?.blockers[0]?.message || 'Resolve the measured habitat requirements first.';
      return `<div class="resident-row" data-entity="${esc(c.id)}"><strong>${esc(c.name)}</strong><small>${esc(c.role)} · ${resident ? 'Resident' : 'Visitor'}${c.health <= 0 ? ' · Deceased' : c.site !== siteId ? ` · ${esc(SITES[c.site]?.name || 'In transit')}` : ''}</small>${needsPickup ? `<button data-action="show-return-team" data-ui-action="expedition.return_crew.review" ${pickupAvailable ? '' : 'disabled'}>${hasReturn ? 'Review assigned return seat' : 'Choose a return seat'}</button><small>${hasReturn ? 'Residence ends only after physical boarding and departure.' : pickupAvailable ? 'Select this resident in Return team, then recall.' : 'Send the shuttle to pick up this resident.'}</small>` : `<button data-action="resident-toggle" data-crew="${esc(c.id)}" data-site="${siteId}" ${ready ? '' : 'disabled'}>${resident ? 'Remove residence record' : 'Station here'}</button>${!ready ? `<small>${esc(reason)}</small>` : ''}`}</div>`;
    }).join('')}
    <p class="crew-hint">Stationing changes who stays; it does not build shelter or supply food, heat or air. Keep at least one living return traveler. Pickups require the shuttle and physical boarding.</p>
  </details>`;
}

export function residenceLabel(s, c) {
  const site = residentSite(s,c.id);
  return site ? `<p class="crew-hint" data-crew-residence>Resident of ${esc(SITES[site].name)} · ${c.site === site ? 'currently on site' : `currently ${esc(SITES[c.site]?.name || 'in transit')}`}</p>` : '';
}

export function outpostGuide() {
  const buildingIds=['floor','wall','door','stockpile','bunk','scrubber','climate','cable','solar','battery','reactor','radiator','atmosphere','iceProcessor','farm'];
  return `<details data-panel-key="habitat-guide" class="outpost-section"><summary>How to supply a wreck habitat</summary>
    <ol class="outpost-guide"><li>Load a manifest at the surface shuttle. Wait for physical loading, then prepare the expedition. First visits need two crew; an established wreck can receive one crew member with a spare return seat for pickup. Freight and salvage share the hold; service fuel is separate.</li><li>At Relay K-07, unload into dock imports. Keep Construction and Hauling duties on. Build on this site's map using its imported supplies or loose salvage. A local depot lets haulers feed machines.</li><li>Enclose habitat floors with intact walls and an accessible door. Keep a path between the dock, supplies and work positions. New floors have no air and begin at the wreck's ambient temperature.</li><li>Wire generation to climate and life support. Deliver real fuel if using a reactor, with suitable cooling. Warm the room before filling it with breathing mix; safe air alone does not prevent cold injury.</li><li>Supply life support, food and a safe bunk for each resident. Breathing mix can be imported or produced from delivered water by an atmosphere processor; machines need their actual inputs and workers. Open Residents & habitat for measured blockers, then choose Station here. Select the actual return team before recalling.</li><li>Check the site while the shuttle is away. Food, packaged air, fuel and other inputs remain finite. Return with supplies or select a resident for physical pickup before reserves run out.</li></ol>
    <details data-panel-key="habitat-costs"><summary>Current construction costs</summary><dl>${buildingIds.map(id=>`<dt>${esc(BUILDINGS[id].name)}</dt><dd>${esc(inventoryText(BUILDINGS[id].cost))}</dd>`).join('')}</dl><p class="crew-hint">Costs are per structure, not a complete blueprint. Layout, gas volume, warming time and reserves determine how many supplied trips you need.</p><dl>${['atmosphere','iceProcessor','farm'].map(id=>`<dt>${esc(BUILDINGS[id].name)}</dt><dd>${esc(inventoryText(RECIPES[id].input))} → ${esc(inventoryText(RECIPES[id].output))}</dd>`).join('')}</dl><p class="crew-hint">Production needs delivered inputs, enabled Production duty and power. Hydroponics also requires breathable air and 10–35 °C. Check each machine inspector; these recipes do not create a self-sufficient habitat.</p></details>
  </details>`;
}

export function outpostWarning(s, viewedSite) {
  if (viewedSite === 'wreck') return '';
  const ids = residentIds(s,'wreck'); if (!ids.length) return '';
  const status = outpostReadiness(s,'wreck',ids);
  if (status.ready) return '';
  return `<button class="outpost-warning" data-outpost-warning="wreck" data-ui-action="site.inspect" title="Open Relay K-07 status">Relay K-07: ${esc(status.blockers[0]?.message || 'Check residents and habitat')} →</button>`;
}
