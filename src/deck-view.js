import { stairAt, stairOpen, STAIR, STAIR_WORK } from './vertical.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// View state is deliberately absent from saves. A scope token expires even if
// the player changes floors and returns before releasing a pressed control.
export function createDeckView(getSite, changed=()=>{}) {
  let z=0, revision=0;
  const levels=()=>getSite()?.levels ?? (getSite()?[{z:0,name:'Landing deck'}]:[]);
  const capture=()=>({site:getSite()?.id,z,revision});
  const matches=token=>!!token&&token.site===getSite()?.id&&token.z===z&&token.revision===revision;
  function select(next,reset=false){
    if(!reset&&!levels().some(level=>level.z===next))return false;
    if(reset||next!==z){z=next;revision++;changed();}
    return true;
  }
  return {get z(){return z;},levels,capture,matches,select,
    reset:()=>select(0,true),
    step:direction=>{const list=[...levels()].sort((a,b)=>a.z-b.z),index=list.findIndex(l=>l.z===z);return select(list[index+direction]?.z);}};
}
export function stairDetails(site,t){
  const link=stairAt(site,t);if(!link)return '';
  return `<hr><div class="eyebrow">STAIRWELL · FLOORS ${link.lower.z} ↔ ${link.upper.z}</div><p>Condition ${Math.round(link.hp)}% · Hatch ${stairOpen(site,link)?'open':'closed'}. An open or damaged hatch shares air, heat and water between floors, and lets fire spread between nearby fittings.</p><div class="stair-controls">${['auto','open','closed'].map(mode=>`<button data-action="stair-hatch" data-simulation-action="vertical.hatch" data-connection="${esc(link.id)}" data-hatch-mode="${mode}" aria-pressed="${link.mode===mode}" ${link.hp<STAIR.minimumCondition?'disabled':''}>${mode==='auto'?'Automatic':mode==='open'?'Hold open':'Close'}</button>`).join('')}</div><p>Repair: ${STAIR_WORK.repair.cost.alloy} alloy and ${STAIR_WORK.repair.work} work. Dismantling uses ${STAIR_WORK.remove.cost.alloy} alloy to seal the opening and returns 3 alloy; both floors remain. Bring crew downstairs or provide another route first.</p>${link.hp<100?'<button data-action="stair-repair" data-simulation-action="job.order">Repair stairwell</button>':''}<button data-action="stair-remove" data-simulation-action="job.order">Dismantle and seal</button>`;
}

export function floorWarnings(s,site){
  const warnings=[];
  for(const t of site.tiles){
    const link=t.verticalLink&&stairAt(site,t);
    const labels=[link&&link.hp<STAIR.minimumCondition&&t.z===link.lower.z&&'Stair route blocked',t.fire&&'Fire',t.wetShort&&'Wet cable short',t.reactor?.tripped&&'Reactor shutdown'].filter(Boolean);
    if(labels.length)warnings.push({...t,label:labels.join(' / ')});
  }
  if(site.id==='surface'&&s.debris.target)warnings.unshift({...s.debris.target,label:`Debris in ${s.debris.next-s.tick}s`});
  return warnings.slice(0,3).map(p=>`<button class="env-chip warn" data-inspect-tile data-site="${esc(site.id)}" data-x="${p.x}" data-y="${p.y}" data-z="${p.z??0}">${esc(p.label)} · floor ${p.z??0} · ${p.x}/${p.y}</button>`).join('')+(warnings.length>3?`<span class="env-chip warn">+${warnings.length-3} hazards across all floors</span>`:'');
}
