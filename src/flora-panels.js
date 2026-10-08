import { floraStatus, gatheringEligibility, plantingEligibility, wateringEligibility } from './flora.js';
import { CULTIVATION, FLORA } from './flora-data.js';
import { foodKindName } from './food-panels.js';
import { constructionSupplyLocations, siteWorkAllowed } from './construction.js';
import { availableInventory } from './inventory-reservations.js';
import { crewPathTo } from './navigation.js';
import { neighbors } from './geometry.js';
import { quantity } from './inventory.js';
import { inventoryText } from './industry-panels.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value.toFixed(2));
const edibleSpecies=Object.keys(FLORA).filter(species=>FLORA[species].foodKind);
const ordinaryJob=j=>!['feed','hygiene','operate','animalCare','animalHarvest','animalTreat','animalLead','extinguish'].includes(j.kind);
function designationStatus(s,site,tile,eligibility) {
  if(!eligibility.ok)return eligibility;
  if(!siteWorkAllowed(s,site.id)&&(s.mission?.site!==site.id||s.mission.phase!=='working'))return {ok:false,code:'field_work',message:'Resume field work before assigning expedition orders.'};
  if(s.jobs.some(j=>j.site===site.id&&j.x===tile.x&&j.y===tile.y&&ordinaryJob(j)))return {ok:false,code:'claimed',message:'Work already designated here.'};
  const goals=neighbors(tile.x,tile.y);
  if(!s.crew.some(c=>c.site===site.id&&c.health>0&&crewPathTo(s,site,c,goals)!==null))return {ok:false,code:'unreachable',message:'No crew can reach this tile. Clear a route or send crew here.'};
  const cost=eligibility.cost||{},selector=cost.food?{rawOnly:true,foodKinds:{[eligibility.foodKind]:cost.food}}:false;
  const sources=constructionSupplyLocations(s,site.id).filter(({t})=>crewPathTo(s,site,t,[[t.x,t.y]])!==null&&crewPathTo(s,site,t,goals)!==null);
  if(Object.entries(cost).some(([resource,amount])=>sources.reduce((sum,{t,kind})=>sum+availableInventory(s,site.id,[t.x,t.y],kind,resource,null,resource==='food'?selector:false),0)+1e-9<amount))return {ok:false,code:'supplies',message:cost.food?`Needs ${cost.food} reachable raw ${foodKindName(eligibility.foodKind)}. Prepared meals cannot be planted.`:`Needs ${cost.water} reachable water in a depot or loose pile.`};
  return eligibility;
}
function jobProgress(s,job,label) {
  const worker=s.crew.find(c=>c.id===job.worker),waiting=job.sources.reduce((sum,source)=>sum+quantity(source.items),0);
  const transit=Math.max(0,quantity(job.cost)-waiting-quantity(job.materials)-(job.missingFood||0));
  return `<div data-entity="${esc(job.id)}"><p>${esc(label)} · ${Math.round(100*(1-job.remaining/job.work))}% · ${worker?esc(worker.name):'Awaiting worker'}${job.blockedReason?` · ${esc(job.blockedReason)}`:''}</p>${quantity(job.cost)?`<dl><dt>Delivered supplies</dt><dd>${esc(inventoryText(job.materials))}</dd><dt>Awaiting pickup</dt><dd>${number(waiting)} units</dd><dt>In transit</dt><dd>${number(transit)} units</dd>${job.missingFood?`<dt>Replacement raw food</dt><dd>${number(job.missingFood)} ${esc(foodKindName(job.plantSpecies))}</dd>`:''}</dl>`:''}<button data-action="cancel" data-job="${esc(job.id)}" data-simulation-action="job.cancel">Cancel ${esc(label.toLowerCase())}</button></div>`;
}
export function floraDetails(s,site,tile) {
  const plants=floraStatus(s,site,tile),jobs=s.jobs.filter(j=>j.site===site.id&&j.x===tile.x&&j.y===tile.y);
  const suitable=tile.terrain==='ground'&&!tile.fire&&(!tile.building||['fence','pastureGate'].includes(tile.building));
  const cultivate=suitable&&!plants.some(plant=>plant.foodKind);
  const plantJob=jobs.find(j=>j.kind==='plant');
  const orphanJobs=jobs.filter(j=>['waterPlant','gather'].includes(j.kind)&&!plants.some(plant=>plant.species===j.plantSpecies));
  if(!plants.length&&!cultivate&&!plantJob&&!orphanJobs.length)return '';
  const choices=cultivate?`<details data-cultivation data-panel-key="cultivate:${esc(site.id)}:${tile.x}:${tile.y}"><summary>Cultivate · ground beds</summary><p class="crew-hint">Plant one food patch here. A Production worker carries matching raw food, then plants it. Dormant weather can pause later growth.</p>${edibleSpecies.map(species=>{
    const eligible=plantingEligibility(s,site,tile,species),status=designationStatus(s,site,tile,eligible),id=`cultivate:${site.id}:${tile.x}:${tile.y}:${species}:status`;
    return `<article><h3>${esc(foodKindName(eligible.foodKind))}</h3><p class="crew-hint">${eligible.cost.food} raw ${esc(foodKindName(eligible.foodKind))} · ${eligible.work} Production work</p><button data-action="plant" data-species="${esc(species)}" data-simulation-action="job.order" aria-describedby="${esc(id)}" ${!status.ok?'disabled':''}>Plant ${esc(foodKindName(eligible.foodKind))}</button><p class="crew-hint" id="${esc(id)}" data-plant-reason="${esc(plantJob?'pending':status.code||'ready')}">${esc(plantJob?'Planting already ordered.':status.message||'Ready for a Production worker.')}</p></article>`;
  }).join('')}<p class="crew-hint">Cultivated regrowth uses finite moisture. Watering costs ${CULTIVATION.waterDose} water and ${CULTIVATION.waterWork} Production work.</p></details>`:'';
  return `<section class="flora-panel"><hr><div class="eyebrow">${plants.some(p=>p.origin==='cultivated')?'FLORA & CULTIVATION':plants.length?'WILD FLORA':'CULTIVATION'}</div>${plants.map(plant=>{
    const cultivated=plant.origin==='cultivated',name=cultivated?`Cultivated ${foodKindName(plant.foodKind).toLowerCase()}`:plant.name;
    const job=jobs.find(j=>j.kind==='gather'&&j.plantSpecies===plant.species),waterJob=jobs.find(j=>j.kind==='waterPlant'&&j.plantSpecies===plant.species);
    const eligibility=plant.foodKind?designationStatus(s,site,tile,gatheringEligibility(s,site,tile,plant.species)):null;
    const reasonId=`${plant.id}:gather-status`;
    const water=cultivated?designationStatus(s,site,tile,wateringEligibility(s,site,tile,plant.species)):null,waterId=`${plant.id}:water-status`;
    return `<article data-entity="${esc(plant.id)}" data-generation="${esc(plant.generation)}"><h3>${esc(name)} · ${esc(plant.stage)}</h3><p class="crew-hint">${esc(cultivated?'A planted ground bed. Harvesting leaves living biomass for regrowth.':plant.description)}</p><dl><dt>Biomass</dt><dd>${number(plant.biomass)} / 100</dd><dt>Growth</dt><dd>${esc(plant.growthReason||(plant.growthAllowed?'Suitable growing conditions':'Growth paused'))}</dd>${cultivated?`<dt>Moisture</dt><dd>${number(plant.moisture)} / ${CULTIVATION.moistureCapacity} water</dd>`:''}${plant.foodKind?`<dt>Harvest</dt><dd>${plant.yield} ${esc(foodKindName(plant.foodKind))} · ${plant.work} Production work</dd>`:''}</dl>${water?`<button data-action="waterPlant" data-species="${esc(plant.species)}" data-simulation-action="job.order" aria-describedby="${esc(waterId)}" ${!water.ok||waterJob?'disabled':''}>Water · ${CULTIVATION.waterDose} water</button><p class="crew-hint" id="${esc(waterId)}" data-water-reason="${esc(waterJob?'pending':water.code||'ready')}">${esc(waterJob?'Watering already ordered.':water.message||'Ready for a Production worker.')} · ${CULTIVATION.waterWork} Production work</p>${waterJob?jobProgress(s,waterJob,'Watering'):''}`:''}${eligibility?`<button data-action="gather" data-species="${esc(plant.species)}" data-simulation-action="job.order" aria-describedby="${esc(reasonId)}" ${!eligibility.ok||job?'disabled':''}>Gather ${esc(name)}</button><p class="crew-hint" id="${esc(reasonId)}" data-gather-reason="${esc(job?'pending':eligibility.code||'ready')}">${esc(job?'Gathering already ordered.':eligibility.message||'Ready for a Production worker. Gathered food waits here for hauling.')}</p>${job?jobProgress(s,job,'Gathering'):''}`:'<p class="crew-hint">Supports grazing; lichen cannot be gathered for food.</p>'}</article>`;
  }).join('')}${choices}${plantJob?jobProgress(s,plantJob,'Planting'):''}${orphanJobs.map(job=>jobProgress(s,job,job.kind==='gather'?'Gathering':'Watering')).join('')}${plants.some(p=>p.origin!=='cultivated')?'<p class="crew-hint">Native regrowth uses no stored water or air. Harvested food keeps its age while carried or cooked.</p>':''}</section>`;
}
