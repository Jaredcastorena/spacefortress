import { floraStatus, gatheringEligibility } from './flora.js';
import { foodKindName } from './food-panels.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value.toFixed(1));
export function floraDetails(s,site,tile) {
  const plants=floraStatus(s,site,tile);
  if(!plants.length)return '';
  return `<section class="flora-panel"><hr><div class="eyebrow">WILD FLORA</div>${plants.map(plant=>{
    const job=s.jobs.find(j=>j.kind==='gather'&&j.site===site.id&&j.x===tile.x&&j.y===tile.y&&j.plantSpecies===plant.species);
    const eligibility=plant.foodKind?gatheringEligibility(s,site,tile,plant.species):null;
    const reason=job?'Gathering already ordered.':eligibility?.message;
    const reasonId=`${plant.id}:gather-status`;
    const worker=job&&s.crew.find(c=>c.id===job.worker);
    return `<article data-entity="${esc(plant.id)}"><h3>${esc(plant.name)} · ${esc(plant.stage)}</h3><p class="crew-hint">${esc(plant.description)}</p><dl><dt>Biomass</dt><dd>${number(plant.biomass)} / 100</dd><dt>Growth</dt><dd>${esc(plant.growthReason||(plant.growthAllowed?'Suitable growing conditions':'Growth paused'))}</dd>${plant.foodKind?`<dt>Harvest</dt><dd>${plant.yield} ${esc(foodKindName(plant.foodKind))} · ${plant.work} Production work</dd>`:''}</dl>${eligibility?`<button data-action="gather" data-species="${esc(plant.species)}" data-simulation-action="job.order" aria-describedby="${esc(reasonId)}" ${!eligibility.ok||job?'disabled':''}>Gather ${esc(plant.name)}</button><p class="crew-hint" id="${esc(reasonId)}" data-gather-reason="${esc(job?'pending':eligibility.code||'ready')}">${esc(reason||'Ready for a Production worker. Gathered food waits here for hauling.')}</p>${job?`<p data-entity="${esc(job.id)}">Gathering · ${Math.round(100*(1-job.remaining/job.work))}% · ${worker?esc(worker.name):'Awaiting worker'}${job.blockedReason?` · ${esc(job.blockedReason)}`:''}</p><button data-action="cancel" data-job="${esc(job.id)}" data-simulation-action="job.cancel">Cancel gathering</button>`:''}`:'<p class="crew-hint">Supports grazing; lichen cannot be gathered for food.</p>'}</article>`;
  }).join('')}<p class="crew-hint">Native regrowth uses no stored water or air. Harvested food keeps its age while carried or cooked.</p></section>`;
}
