import { herdMemberQuiet } from './maintenance.js';
import { cellKey, positionOf, sameCell } from './spatial.js';
import { transportFor } from './animal-transport.js';
import { breedingStatus, adult } from './breeding.js';
import { livestockDef, isLivestock, VETERINARY } from './livestock-data.js';
import { animalHealthStatus, animalTreatmentEligibility } from './animal-health.js';
import { ANIMAL_TRAITS, animalTraits } from './animal-traits.js';
import { BUTCHERY, carcassPosition, carcassStatus, dispatchEligibility, butcheryEligibility, discardEligibility } from './animal-carcasses.js';
import { FOOD_LIFETIME } from './food-lots.js';
import { foodComposition, foodKindName } from './food-panels.js';
import { animalPasture, pastureRegions } from './pastures.js';
import { husbandryStatus } from './husbandry.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>Number(value.toFixed(1));
const injuryAmount=value=>value>0&&value<.1?'<0.1':number(value);
const rate=value=>Number(value.toFixed(4));
const thermalLabel=expression=>expression<0?'Cold adapted':expression>0?'Heat adapted':'Balanced thermal tolerance';
const paceLabel=expression=>expression<0?'Slow pace':expression>0?'Fast pace':'Balanced pace';
function traitProfileDetails(profile) {
  const shift=ANIMAL_TRAITS.thermalShift*profile.thermalExpression,pace=Math.round((profile.paceMultiplier-1)*100);
  const thermalReason=shift<0?'Colder temperatures tolerated; the heat limit also moves lower.':shift>0?'Hotter temperatures tolerated; the cold limit also moves higher.':'Balanced temperature limits.';
  return `<dl><dt>Phenotype</dt><dd>${thermalLabel(profile.thermalExpression)} · ${paceLabel(profile.paceExpression)}</dd><dt>Temperature range</dt><dd>${esc(profile.temperatureRange.map(number).join('–'))} °C · ${shift>0?'+':''}${number(shift)} °C shift</dd><dt>Product and feed pace</dt><dd>${pace>0?'+':''}${pace}% from species base</dd><dt>Product progress</dt><dd>${rate(profile.productRate)} / tick</dd><dt>Adult feed drain</dt><dd>${rate(profile.metabolism)} nutrition / tick</dd><dt>Hatchling feed drain</dt><dd>${rate(profile.juvenileMetabolism)} nutrition / tick</dd></dl><p class="crew-hint">${thermalReason} ${pace>0?'Faster product progress costs faster feed drain.':pace<0?'Slower product progress reduces feed drain.':'Product progress and feed drain use the species base rates.'} Existing health, nutrition and activity requirements still apply.</p>`;
}
export function animalTraitDetails(a) {
  const profile=animalTraits(a);if(!profile)return '';
  const inheritance=a.lifecycle?.brood?.inheritance,child=inheritance&&animalTraits({...a,genetics:inheritance.child});
  const origin=({founder:'Founding herd',inherited:'Inherited from parents',legacy:'Balanced established traits'})[a.genetics?.origin]||'Balanced established traits';
  return `<details class="animal-traits" data-panel-key="animal-traits:${esc(a.id)}"><summary>Inherited traits · ${thermalLabel(profile.thermalExpression)} · ${paceLabel(profile.paceExpression)}</summary><dl><dt>Trait source</dt><dd>${origin}</dd><dt>Parents</dt><dd>${a.lifecycle?.parents?.length?a.lifecycle.parents.map(esc).join(' · '):'Founding herd'}</dd></dl>${traitProfileDetails(profile)}${child?`<section data-entity="${esc(a.lifecycle.brood.id)}"><h3>Pending brood traits</h3><dl><dt>Brood</dt><dd>${esc(a.lifecycle.brood.id)}</dd><dt>Parents</dt><dd>${inheritance.parents.map(parent=>esc(parent.id)).join(' · ')}</dd></dl>${traitProfileDetails(child)}<p class="crew-hint">The brood's inherited traits were fixed at conception. Birth preserves these traits.</p></section>`:''}<p class="crew-hint">Each parent passes one allele for temperature and one for pace. Balanced parents can have young with different traits. Temperature traits shift both limits together; pace changes product progress and adult and hatchling feed drain together.</p></details>`;
}
export function animalHealthDetails(s,a) {
  if(!isLivestock(a))return '';
  const health=animalHealthStatus(s,a),eligibility=animalTreatmentEligibility(s,a),reasonId=`${a.id}:treatment-status`;
  return `<div class="eyebrow">HEALTH & RECOVERY</div><dl><dt>Injury</dt><dd>${esc(injuryAmount(health.injury))} · ${esc(injuryAmount(health.treated))} covered by treatment</dd><dt>Temperature</dt><dd>${number(health.temperature)} °C · tolerates ${health.temperatureRange.join('–')} °C</dd><dt>Thermal strain</dt><dd>${health.thermalStress>0?'+':''}${number(health.thermalStress)} / 100 · ${esc(health.thermalState)}</dd><dt>Recovery</dt><dd>${esc(health.recoveryReason)}</dd></dl>${health.activityAllowed?'':'<p class="crew-hint">Injury or thermal strain pauses products, collection, growth and breeding. Feeding remains available.</p>'}<button data-action="animal-treat" data-animal="${esc(a.id)}" data-simulation-action="husbandry.treat" aria-describedby="${esc(reasonId)}" ${eligibility.ok?'':'disabled'}>Treat · ${VETERINARY.medicine} medicine</button><p class="crew-hint" id="${esc(reasonId)}" data-treatment-reason="${esc(eligibility.code)}">${esc(eligibility.message)}</p><p class="crew-hint">${VETERINARY.work} Medicine work · covers up to ${VETERINARY.maxDose} injury. A medic carries medicine to the post. Recovery is gradual while the animal rests there, well fed and at a safe temperature.</p>`;
}
const butcheryKinds=['animalDispatch','animalButcher','animalDiscard'];
function butcheryJobDetails(s,job) {
  const phase=job.kind==='animalDispatch'?'Slaughter work':job.kind==='animalDiscard'?'Disposal work':({collect:'Retrieving body',carry:'Carrying body to post',process:'Butchering at post'})[job.phase]||job.phase;
  const worker=s.crew.find(c=>c.id===job.worker),cancel=job.kind==='animalDispatch'?'slaughter':job.kind==='animalDiscard'?'disposal':'butchery';
  return `<div data-entity="${esc(job.id)}"><p>${esc(phase)} · ${Math.round(100*(1-job.remaining/job.work))}% work · ${worker?esc(worker.name):'Awaiting handler'}${job.blockedReason?` · ${esc(job.blockedReason)}`:''}</p><button data-action="cancel" data-job="${esc(job.id)}" data-simulation-action="job.cancel">Cancel ${cancel}</button></div>`;
}
export function animalButcheryDetails(s,a) {
  const def=livestockDef(a);if(!def)return '';
  const job=s.jobs.find(j=>j.animal===a.id&&butcheryKinds.includes(j.kind));
  if(a.health>0){
    const eligibility=dispatchEligibility(s,a),reasonId=`${a.id}:dispatch-status`;
    return `<details class="animal-butchery" data-panel-key="butchery:${esc(a.id)}"><summary>Slaughter for meat${job?' · ordered':''}</summary><p class="crew-hint">Slaughter permanently kills this animal after ${BUTCHERY.dispatchWork} Husbandry work at its assigned post. No supplies are consumed. A handler must then retrieve and butcher the body before meat appears.</p><dl><dt>Adult meat yield</dt><dd>${def.meatYield} ${esc(foodKindName(def.meatKind))}</dd><dt>Butchery</dt><dd>${BUTCHERY.processWork} Husbandry work · ${BUTCHERY.waste} waste</dd></dl><button data-action="animal-dispatch" data-animal="${esc(a.id)}" data-simulation-action="husbandry.dispatch" aria-describedby="${esc(reasonId)}" ${eligibility.ok&&!job?'':'disabled'}>Slaughter for meat · ${BUTCHERY.dispatchWork} work</button><p class="crew-hint" id="${esc(reasonId)}" data-dispatch-reason="${esc(job?'pending':eligibility.code)}">${esc(job?'Slaughter already ordered.':eligibility.message)}</p>${job?butcheryJobDetails(s,job):''}</details>`;
  }
  const status=carcassStatus(s,a);if(!status)return '';
  const position=carcassPosition(s,a),owner=status.owner;
  const location=owner?.kind==='crew'?`Carried by ${s.crew.find(c=>c.id===owner.crew)?.name||owner.crew}`:position?`${owner?.kind==='job'?'Staged at':'On tile'} ${position.site} ${position.x} / ${position.y}`:'No physical body remains';
  const physical=['fresh','spoiled'].includes(status.disposition),posts=s.sites.surface.tiles.filter(t=>t.building==='husbandryPost');
  const discard=discardEligibility(s,a),discardId=`${status.id}:discard-status`;
  return `<details class="animal-butchery" data-panel-key="butchery:${esc(a.id)}" data-entity="${esc(status.id)}"><summary>Corpse handling · ${esc(status.disposition)}</summary><dl><dt>Animal</dt><dd>${esc(def.name)} ${esc(a.id)}</dd><dt>Body location</dt><dd>${esc(location)}</dd><dt>Freshness age</dt><dd>${number(status.age)} / ${FOOD_LIFETIME}</dd><dt>Edible yield</dt><dd>${status.edibleYield} ${esc(foodKindName(status.meatKind))}</dd><dt>Body state</dt><dd>${esc(status.disposition)}</dd>${status.reservedBy?`<dt>Reserved by</dt><dd>${esc(status.reservedBy)}</dd>`:''}</dl>${physical?`<p class="crew-hint">${BUTCHERY.processWork} Husbandry work after retrieval and carrying · ${BUTCHERY.waste} waste. Fresh meat keeps the body's accumulated age; pickup and carrying produce no food.</p>${posts.map(t=>{
    const eligibility=butcheryEligibility(s,a,t.x,t.y,t.z),id=`${status.id}:butcher:${t.x}:${t.y}`;
    return `<button data-action="animal-butcher" data-animal="${esc(a.id)}" data-x="${t.x}" data-y="${t.y}" data-z="${t.z}" data-simulation-action="husbandry.butcher" aria-describedby="${esc(id)}" ${eligibility.ok&&!job?'':'disabled'}>Butcher at post ${t.x} / ${t.y} · floor ${t.z}</button><p class="crew-hint" id="${esc(id)}" data-butcher-reason="${esc(job?'pending':eligibility.code)}">${esc(job?'Body handling already ordered.':eligibility.message)}</p>`;
  }).join('')||'<p class="crew-hint">Build an intact unoccupied surface husbandry post for butchery.</p>'}<button data-action="animal-discard" data-animal="${esc(a.id)}" data-simulation-action="husbandry.discard" aria-describedby="${esc(discardId)}" ${discard.ok&&!job?'':'disabled'}>Dispose spoiled body · ${BUTCHERY.discardWork} work</button><p class="crew-hint" id="${esc(discardId)}" data-discard-reason="${esc(job?'pending':discard.code)}">${esc(job?'Body handling already ordered.':discard.message)} Disposal leaves ${BUTCHERY.waste} waste.</p>`:'<p class="crew-hint">This retained ancestry record has no body or further meat yield.</p>'}${job?butcheryJobDetails(s,job):''}</details>`;
}
function animalJobDetails(job,def) {
  const label=job.kind==='animalLead'?(job.phase==='escort'?'Escorting to post':'Collecting and attaching lead'):job.kind==='animalCare'?'Feeding and trust':job.kind==='animalTreat'?'Veterinary treatment':`${def.productName} collection`;
  const cancel=job.kind==='animalCare'?'Cancel feeding':job.kind==='animalTreat'?'Cancel treatment':job.kind==='animalLead'?'Cancel transport':'Cancel collection';
  return `<p data-entity="${esc(job.id)}">${esc(label)} · ${job.kind==='animalLead'&&job.phase==='escort'?'Lead attached':`${Math.round(100*(1-job.remaining/job.work))}%`}${job.blockedReason?` · ${esc(job.blockedReason)}`:''}</p><button data-action="cancel" data-job="${esc(job.id)}" data-simulation-action="job.cancel">${cancel}</button>`;
}
export function animalDetails(s,a,pathTo) {
  const h=a?.husbandry,def=livestockDef(a);if(!h||!def)return '';
  if(a.health<=0)return `<section data-entity="${esc(a.id)}"><hr><div class="eyebrow">${esc(def.name.toUpperCase())} REMAINS</div><p>${esc(a.id)} · Deceased</p>${animalButcheryDetails(s,a)}${animalTraitDetails(a)}${breedingDetails(s,a)}</section>`;
  const feed=def.feedKinds?foodComposition(def.feedKinds):`${def.careFood} ${def.feedName}`;
  const jobs=s.jobs.filter(j=>j.animal===a.id),pasture=animalPasture(s,a);
  const calls=a.species==='bristleback'?`<dt>Calls</dt><dd>${herdMemberQuiet(s,a)?'Silent, in unison':'Clicking'}</dd>`:'';
  return `<section data-entity="${esc(a.id)}"><hr><div class="eyebrow">${esc(def.name.toUpperCase())} HUSBANDRY</div><p>${esc(a.id)} · ${esc(husbandryStatus(s,a,pathTo))}</p><dl><dt>Health</dt><dd>${a.health.toFixed(1)}%</dd>${calls}<dt>Fed</dt><dd>${a.fed.toFixed(1)}%</dd><dt>Trust</dt><dd>${h.trust} / 100</dd><dt>${esc(def.productName)}</dt><dd>${adult(a)?`${h.product.toFixed(1)} / 100`:'Growing; production begins in adulthood'}</dd><dt>Care feed</dt><dd>${esc(feed)} per visit</dd><dt>Pasture</dt><dd>${pasture.enclosed?`Enclosed · ${pasture.tiles} tiles`:'Open range'}</dd>${def.grazesLichen?`<dt>Available lichen</dt><dd>${Math.floor(pasture.lichen)}</dd>`:''}<dt>Post route</dt><dd>${pasture.postReachable===null?'No post':pasture.postReachable?'Reachable':'Blocked'}</dd><dt>Assigned post</dt><dd>${h.post?[h.post.x,h.post.y].join(' / '):'None'}</dd></dl>${a.health>0?`<button data-action="animal-policy" data-animal="${esc(a.id)}" data-policy="care" aria-pressed="${h.care}">${h.care?'Pause care':'Enable care'}</button><button data-action="animal-policy" data-animal="${esc(a.id)}" data-policy="harvest" aria-pressed="${h.harvest}">${h.harvest?'Pause collection':'Enable collection'}</button>${h.post?`<button data-action="animal-release" data-animal="${esc(a.id)}">Release from post</button>`:''}`:''}${animalHealthDetails(s,a)}${animalTraitDetails(a)}${transportDetails(s,a)}${breedingDetails(s,a)}${animalButcheryDetails(s,a)}${jobs.filter(job=>!butcheryKinds.includes(job.kind)).map(job=>animalJobDetails(job,def)).join('')}${jobs.some(j=>j.kind==='animalCare')&&jobs.some(j=>j.kind==='animalTreat')?'<p class="crew-hint">Feeding finishes before veterinary treatment.</p>':''}<p class="crew-hint">Handlers deliver ${esc(feed)} per care visit. ${Math.ceil(100/def.careTrust)} visits tame a wild animal. Healthy, well-fed tame adults produce ${esc(def.productName.toLowerCase())}; a handler collects ${def.productFood} food and leaves manure to haul. ${def.grazesLichen?'Nearby lichen supports grazing.':'Lichen cannot feed this species; gather or grow fungal caps for handler deliveries.'} Cancelling care or collection delays automatic retry for 120 seconds.</p></section>`;
}
export function postDetails(s,t,pathTo) {
  if(t.building!=='husbandryPost')return '';
  const assigned=s.creatures.find(a=>a.health>0&&sameCell(a.husbandry?.post,positionOf(t)));
  const incoming=s.jobs.find(j=>j.kind==='animalLead'&&sameCell(positionOf(j),positionOf(t)));
  const processing=s.jobs.find(j=>j.kind==='animalButcher'&&j.site==='surface'&&sameCell(positionOf(j),positionOf(t)));
  if(processing)return `<hr><div class="eyebrow">HUSBANDRY POST</div><p>Reserved for butchery of ${esc(processing.animal)}.</p>`;
  if(incoming)return `<hr><div class="eyebrow">HUSBANDRY POST</div><p>Reserved for incoming ${esc(incoming.animal)}.</p>${animalDetails(s,s.creatures.find(a=>a.id===incoming.animal),pathTo)}`;
  return `<hr><div class="eyebrow">HUSBANDRY POST</div>${assigned?animalDetails(s,assigned,pathTo):`<p>One animal per post. Assignment does not move or tame the animal instantly.</p>${s.creatures.filter(a=>isLivestock(a)&&a.health>0).map(a=>`<button data-action="animal-assign" data-animal="${esc(a.id)}" data-x="${t.x}" data-y="${t.y}" data-z="${t.z}">Assign ${esc(livestockDef(a).name)} ${esc(a.id)}${a.husbandry.post?' · reassign':''}</button>${a.husbandry.trust===100?`<button data-action="animal-transport" data-animal="${esc(a.id)}" data-x="${t.x}" data-y="${t.y}" data-z="${t.z}">Send handler for ${esc(a.id)}</button>`:''}`).join('')}`}`;
}

export function pastureDetails(s,t) {
  if(!['fence','pastureGate','husbandryPost'].includes(t.building))return '';
  let content='';
  if(t.building==='husbandryPost'){
    const site=s.sites.surface,r=pastureRegions(site).byCell.get(cellKey(positionOf(t)));
    content=`<p>${r?.enclosed?`Enclosed pasture · ${r.cells.length} accessible tiles · ${Math.floor(r.lichen)} lichen`:'Open range: animals have a route to the map edge.'}</p>`;
  }
  if(t.building==='pastureGate')content=`<p>${t.hp<=0?'Broken gate: animals can pass.':t.gateMode==='latched'?'Latched: crew can pass; livestock cannot.':'Held open: crew and animals can pass.'}</p><button data-action="pasture-gate" data-gate-mode="${t.gateMode==='latched'?'open':'latched'}">${t.gateMode==='latched'?'Hold gate open':'Latch gate'}</button>`;
  return `<hr><div class="eyebrow">PASTURE BOUNDARY</div>${content}<p class="crew-hint">Intact fences and latched gates contain livestock. Broken segments leave gaps. Tibbles slip through. Fences and gates do not seal atmosphere; enclosure does not guarantee enough grazing or handler access.</p>`;
}

const breedingReasons={injured:'Paused: injury needs recovery',thermal_stress:'Paused: temperature strain needs to ease',dead:'Deceased',juvenile:'Growing; cannot breed yet',disabled:'New breeding disabled',cooldown:'Recovering between broods',untamed:'Needs taming',condition_low:'Needs better nutrition and health',open_range:'Needs an enclosed pasture',handler_work:'Waiting for handler work',herd_limit:'Herd safety limit reached',pasture_crowded:'Needs more pasture space',birth_tile_blocked:'Needs an empty adjacent ground tile',no_compatible_mate:'Needs an enabled, healthy, unrelated adult of the same species',growth_condition_low:'Growth paused: needs at least 40 nutrition and health'};
export function breedingDetails(s,a){
 const l=a.lifecycle,def=livestockDef(a);if(!l||!def)return '';const status=breedingStatus(s,a);
 return `<details class="animal-breeding"><summary>Growth and breeding · ${adult(a)?'Adult':'Hatchling'}</summary><dl><dt>Growth</dt><dd>${l.growth} / ${def.maturity}</dd><dt>Parents</dt><dd>${l.parents.length?l.parents.map(esc).join(' · '):'Founding herd'}</dd><dt>Breeding</dt><dd>${esc(breedingReasons[status.reason]||(status.phase==='brooding'?'Carrying a brood':'Seeking mate'))}</dd>${l.brood?`<dt>Brood</dt><dd>${l.brood.progress} / ${def.gestation} · mate ${esc(l.brood.mate)}</dd>`:''}${l.cooldown?`<dt>Recovery</dt><dd>${l.cooldown} ticks</dd>`:''}</dl>${a.health>0?`<button data-action="animal-breed" data-animal="${esc(a.id)}" aria-pressed="${l.enabled}">${l.enabled?'Disable new breeding':'Enable breeding'}</button>`:''}<p class="crew-hint">Two unrelated tame adults of the same species need good health, nutrition and ${def.tilesPerAnimal} enclosed tiles per animal, including pending young of either species. Either adult can carry one brood. Growth takes ${def.maturity} well-fed ticks; a brood takes ${def.gestation}. Disabling breeding prevents new pairings; an existing brood continues. Young must grow before producing ${esc(def.productName.toLowerCase())}.</p></details>`;
}

export function transportDetails(s,a){
 if(a.health<=0||a.husbandry.trust<100)return '';
 const j=transportFor(s,a),posts=s.sites.surface.tiles.filter(t=>t.building==='husbandryPost'&&t.hp>0&&!s.creatures.some(o=>o!==a&&o.health>0&&sameCell(o.husbandry?.post,positionOf(t))));
 return `<details class="animal-transport"><summary>Handler transport${j?' · ordered':''}</summary>${j?`<p data-entity="${esc(j.id)}">${j.phase==='escort'?'Escorting':'Collecting'} · destination ${j.x} / ${j.y} · floor ${j.z}${j.blockedReason?` · ${esc(j.blockedReason)}`:''}</p>`:posts.map(t=>`<button data-action="animal-transport" data-animal="${esc(a.id)}" data-x="${t.x}" data-y="${t.y}" data-z="${t.z}">Escort to post ${t.x} / ${t.y} · floor ${t.z}</button>`).join('')||'<p>Build an available husbandry post first.</p>'}<p class="crew-hint">A handler collects a tame animal and uses a lead to escort it through crew gates. The post is reserved until delivery; assignment changes on arrival. Cancel to release it at its current position. Interruptions require attaching the lead again.</p></details>`;
}
