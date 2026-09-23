import { transportFor } from './animal-transport.js';
import { BREEDING, breedingStatus, adult } from './breeding.js';
import { animalPasture, pastureRegions } from './pastures.js';
import { husbandryStatus } from './husbandry.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function animalDetails(s,a,pathTo) {
  const h=a.husbandry;if(!h)return '';
  const job=s.jobs.find(j=>j.animal===a.id),pasture=animalPasture(s,a);
  return `<section data-entity="${esc(a.id)}"><hr><div class="eyebrow">BRISTLEBACK HUSBANDRY</div><p>${esc(a.id)} · ${esc(husbandryStatus(s,a,pathTo))}</p><dl><dt>Health</dt><dd>${a.health.toFixed(1)}%</dd><dt>Fed</dt><dd>${a.fed.toFixed(1)}%</dd><dt>Trust</dt><dd>${h.trust} / 100</dd><dt>Nutrient curd</dt><dd>${h.product.toFixed(1)} / 100</dd><dt>Pasture</dt><dd>${pasture.enclosed?`Enclosed · ${pasture.tiles} tiles`:'Open range'}</dd><dt>Available lichen</dt><dd>${Math.floor(pasture.lichen)}</dd><dt>Post route</dt><dd>${pasture.postReachable===null?'No post':pasture.postReachable?'Reachable':'Blocked'}</dd><dt>Assigned post</dt><dd>${h.post?h.post.join(' / '):'None'}</dd></dl>${a.health>0?`<button data-action="animal-policy" data-animal="${esc(a.id)}" data-policy="care" aria-pressed="${h.care}">${h.care?'Pause care':'Enable care'}</button><button data-action="animal-policy" data-animal="${esc(a.id)}" data-policy="harvest" aria-pressed="${h.harvest}">${h.harvest?'Pause collection':'Enable collection'}</button>${h.post?`<button data-action="animal-release" data-animal="${esc(a.id)}">Release from post</button>`:''}`:''}${transportDetails(s,a)}${breedingDetails(s,a)}${job?`<p>Handler work: ${job.kind==='animalLead'?(job.phase==='escort'?'escorting to post':'collecting and attaching lead'):job.kind==='animalCare'?'feeding and trust':'curd collection'} · ${job.kind==='animalLead'&&job.phase==='escort'?'lead attached':`${Math.round(100*(1-job.remaining/job.work))}%`}</p><button data-action="cancel" data-job="${job.id}">Cancel animal work</button>`:''}<p class="crew-hint">Handlers bring one food for each care visit. Three visits tame a wild animal. Healthy, well-fed tame bristlebacks slowly produce curd; a handler collects two food and leaves manure to haul. Nearby lichen supports grazing. Cancelling care or collection delays automatic retry for 120 seconds.</p></section>`;
}
export function postDetails(s,t,pathTo) {
  if(t.building!=='husbandryPost')return '';
  const assigned=s.creatures.find(a=>a.health>0&&a.husbandry?.post?.[0]===t.x&&a.husbandry.post[1]===t.y);
  const incoming=s.jobs.find(j=>j.kind==='animalLead'&&j.x===t.x&&j.y===t.y);
  if(incoming)return `<hr><div class="eyebrow">HUSBANDRY POST</div><p>Reserved for incoming ${esc(incoming.animal)}.</p>${animalDetails(s,s.creatures.find(a=>a.id===incoming.animal),pathTo)}`;
  return `<hr><div class="eyebrow">HUSBANDRY POST</div>${assigned?animalDetails(s,assigned,pathTo):`<p>One animal per post. Assignment does not move or tame the animal instantly.</p>${s.creatures.filter(a=>a.species==='bristleback'&&a.health>0).map(a=>`<button data-action="animal-assign" data-animal="${esc(a.id)}" data-x="${t.x}" data-y="${t.y}">Assign ${esc(a.id)}${a.husbandry.post?' · reassign':''}</button>${a.husbandry.trust===100?`<button data-action="animal-transport" data-animal="${esc(a.id)}" data-x="${t.x}" data-y="${t.y}">Send handler for ${esc(a.id)}</button>`:''}`).join('')}`}`;
}

export function pastureDetails(s,t) {
  if(!['fence','pastureGate','husbandryPost'].includes(t.building))return '';
  let content='';
  if(t.building==='husbandryPost'){
    const site=s.sites.surface,r=pastureRegions(site).byCell.get(t.y*site.size+t.x);
    content=`<p>${r?.enclosed?`Enclosed pasture · ${r.cells.length} accessible tiles · ${Math.floor(r.lichen)} lichen`:'Open range: animals have a route to the map edge.'}</p>`;
  }
  if(t.building==='pastureGate')content=`<p>${t.hp<=0?'Broken gate: animals can pass.':t.gateMode==='latched'?'Latched: crew can pass; bristlebacks cannot.':'Held open: crew and animals can pass.'}</p><button data-action="pasture-gate" data-gate-mode="${t.gateMode==='latched'?'open':'latched'}">${t.gateMode==='latched'?'Hold gate open':'Latch gate'}</button>`;
  return `<hr><div class="eyebrow">PASTURE BOUNDARY</div>${content}<p class="crew-hint">Intact fences and latched gates contain bristlebacks. Broken segments leave gaps. Tibbles slip through. Fences and gates do not seal atmosphere; enclosure does not guarantee enough grazing or handler access.</p>`;
}

const breedingReasons={dead:'Deceased',juvenile:'Growing; cannot breed yet',disabled:'New breeding disabled',cooldown:'Recovering between broods',untamed:'Needs taming',condition_low:'Needs better nutrition and health',open_range:'Needs an enclosed pasture',handler_work:'Waiting for handler work',herd_limit:'Herd safety limit reached',pasture_crowded:'Needs more pasture space',birth_tile_blocked:'Needs an empty adjacent ground tile',no_compatible_mate:'Needs an enabled, healthy, unrelated adult mate',growth_condition_low:'Growth paused: needs at least 40 nutrition and health'};
export function breedingDetails(s,a){
 const l=a.lifecycle;if(!l)return '';const status=breedingStatus(s,a);
 return `<details class="animal-breeding"><summary>Growth and breeding · ${adult(a)?'Adult':'Hatchling'}</summary><dl><dt>Growth</dt><dd>${l.growth} / ${BREEDING.maturity}</dd><dt>Parents</dt><dd>${l.parents.length?l.parents.map(esc).join(' · '):'Founding herd'}</dd><dt>Breeding</dt><dd>${esc(breedingReasons[status.reason]||(status.phase==='brooding'?'Carrying a brood':'Seeking mate'))}</dd>${l.brood?`<dt>Brood</dt><dd>${l.brood.progress} / ${BREEDING.gestation} · mate ${esc(l.brood.mate)}</dd>`:''}${l.cooldown?`<dt>Recovery</dt><dd>${l.cooldown} ticks</dd>`:''}</dl>${a.health>0?`<button data-action="animal-breed" data-animal="${esc(a.id)}" aria-pressed="${l.enabled}">${l.enabled?'Disable new breeding':'Enable breeding'}</button>`:''}<p class="crew-hint">Two tame adults need good health, nutrition and six enclosed tiles per animal, including pending young. Either adult can carry one brood. Growth takes 600 well-fed ticks; a brood takes 300. Disabling breeding prevents new pairings; an existing brood continues. Young must grow before producing curd.</p></details>`;
}

export function transportDetails(s,a){
 if(a.health<=0||a.husbandry.trust<100)return '';
 const j=transportFor(s,a),posts=s.sites.surface.tiles.filter(t=>t.building==='husbandryPost'&&t.hp>0&&!s.creatures.some(o=>o!==a&&o.health>0&&o.husbandry?.post?.[0]===t.x&&o.husbandry.post[1]===t.y));
 return `<details class="animal-transport"><summary>Handler transport${j?' · ordered':''}</summary>${j?`<p data-entity="${esc(j.id)}">${j.phase==='escort'?'Escorting':'Collecting'} · destination ${j.x} / ${j.y}${j.blockedReason?` · ${esc(j.blockedReason)}`:''}</p>`:posts.map(t=>`<button data-action="animal-transport" data-animal="${esc(a.id)}" data-x="${t.x}" data-y="${t.y}">Escort to post ${t.x} / ${t.y}</button>`).join('')||'<p>Build an available husbandry post first.</p>'}<p class="crew-hint">A handler collects a tame animal and uses a lead to escort it through crew gates. The post is reserved until delivery; assignment changes on arrival. Cancel to release it at its current position. Interruptions require attaching the lead again.</p></details>`;
}
