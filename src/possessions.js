import { add, extract, spill, quantity } from './inventory.js';
import { ITEM_STYLES, validItemLots, itemOwners } from './item-lots.js';
import { roomAt, breathable, moveCrew } from './atmosphere.js';
import { thermalSafe } from './thermal.js';
import { livingAllowed } from './rooms.js';
import { remember } from './crew.js';
import { emitEvent, tileEntityId } from './telemetry.js';

export function initializePossessions(s) {s.nextItemId ??= 1;for(const c of s.crew)c.possessions ??= {inventory:{},collect:true};}
export function craftKeepsake(s,c) {
  const item={id:`item-${s.nextItemId++}`,maker:c.id,style:c.housing.preference,quality:Math.min(4,1+Math.floor(c.skills.production.level/3)),created:s.tick};
  emitEvent(s,'item.crafted',{entity:item.id,actor:c.id,style:item.style,quality:item.quality});return {keepsakes:1,_items:[item]};
}
const sourceInventory=(t,source)=>source==='output'?t.machine?.output:t[source];
export function collectPossession(s,c,site,pathTo) {
  const intent=c.intent,p=c.possessions;
  if(intent?.type!=='leisure'||!p.collect||p.inventory.keepsakes||c.carry||intent.rested>0)return false;
  if(!intent.keepsake&&!intent.searchedKeepsake) {
    intent.searchedKeepsake=true;
    const claimed=new Set(s.crew.filter(o=>o!==c).map(o=>o.intent?.keepsake?.id).filter(Boolean)),options=[];
    for(const t of site.tiles)for(const source of ['stock','drop','output']) {
      const inventory=sourceInventory(t,source);
      if(!inventory?._items?.length||!livingAllowed(site,t.x,t.y)||!breathable(roomAt(site,t.x,t.y))||!thermalSafe(roomAt(site,t.x,t.y)))continue;
      if(s.crew.some(o=>o!==c&&o.site===site.id&&o.intent?.type==='haul'&&o.intent.source===source&&o.intent.target[0]===t.x&&o.intent.target[1]===t.y))continue;
      const route=pathTo(site,c,[[t.x,t.y]]);if(route===null)continue;
      for(const item of inventory._items)if(!claimed.has(item.id))options.push({item,t,source,distance:route.length});
    }
    options.sort((a,b)=>Number(b.item.style===c.housing.preference)-Number(a.item.style===c.housing.preference)||b.item.quality-a.item.quality||a.distance-b.distance||a.item.id.localeCompare(b.item.id));
    if(options.length){const {item,t,source}=options[0];intent.keepsake={id:item.id,target:[t.x,t.y],source};intent.target=null;emitEvent(s,'item.pickup.planned',{entity:item.id,actor:c.id,source:tileEntityId(site.id,t.x,t.y)});}
  }
  const claim=intent.keepsake;if(!claim)return false;
  const t=site.tiles[claim.target[1]*site.size+claim.target[0]],inventory=sourceInventory(t,claim.source),item=inventory?._items?.find(i=>i.id===claim.id),route=pathTo(site,c,[claim.target]);
  if(!item||route===null||!livingAllowed(site,t.x,t.y)||!breathable(roomAt(site,t.x,t.y))||!thermalSafe(roomAt(site,t.x,t.y))){delete intent.keepsake;emitEvent(s,'item.pickup.cancelled',{entity:claim.id,actor:c.id,reason:'unavailable'});return false;}
  if(route.length){moveCrew(c,site,route[0]);c.activity='Collecting a personal keepsake';return true;}
  const shipment=extract(inventory,{keepsakes:1,_items:[item]});if(!shipment){delete intent.keepsake;return false;}
  add(p.inventory,shipment);if(claim.source==='drop'&&!quantity(t.drop))t.drop=null;delete intent.keepsake;
  c.activity='Picked up a personal keepsake';emitEvent(s,'item.owned',{entity:item.id,actor:c.id,source:tileEntityId(site.id,t.x,t.y)});return true;
}
export function usePossession(s,c) {
  const item=c.possessions.inventory._items?.[0];if(!item)return;
  const match=item.style===c.housing.preference;
  c.life.leisure=Math.min(100,c.life.leisure+.03*item.quality+(match?.08:0));c.life.stress=Math.max(0,c.life.stress-.01*item.quality-(match?.02:0));
  if(!c.memories.some(m=>m.kind==='keepsake-use'&&s.tick-m.tick<120)) {
    remember(s,c,'keepsake-use',`Enjoyed my ${ITEM_STYLES[item.style].toLowerCase()}${match?'; it suits me':''}.`,item.quality+(match?3:0));
    emitEvent(s,'item.enjoyed',{entity:item.id,actor:c.id,matchedPreference:match,quality:item.quality});
  }
}
export function setPossessionCollection(s,id,enabled) {
  const c=s.crew.find(c=>c.id===id&&c.health>0);if(!c||typeof enabled!=='boolean')return {ok:false,message:'Choose a living crew member and collection policy.'};
  c.possessions.collect=enabled;if(c.intent?.keepsake&&!enabled){emitEvent(s,'item.pickup.cancelled',{entity:c.intent.keepsake.id,actor:c.id,reason:'policy'});delete c.intent.keepsake;}
  if(enabled&&c.intent?.type==='leisure'&&!c.intent.rested)delete c.intent.searchedKeepsake;return {ok:true};
}
export function dropPossession(s,c,reason='death') {
  if(c.site==='transit'||!c.possessions.inventory.keepsakes)return;
  const item=c.possessions.inventory._items[0],site=s.sites[c.site];spill(site.tiles[c.y*site.size+c.x],c.possessions.inventory);c.possessions.inventory={};
  emitEvent(s,'item.released',{entity:item.id,actor:c.id,target:tileEntityId(c.site,c.x,c.y),reason});
}
export function releasePossession(s,id) {
  const c=s.crew.find(c=>c.id===id&&c.health>0);if(!c||c.site==='transit'||!c.possessions.inventory.keepsakes)return {ok:false,message:'Choose a living owner at a local site.'};
  dropPossession(s,c,'player');c.possessions.collect=false;return {ok:true};
}
export function validatePossessions(s) {
  if(!Number.isSafeInteger(s.nextItemId)||s.nextItemId<1)throw new Error('Invalid item sequence.');
  const ids=new Set(),claims=new Set();
  for(const {inventory} of itemOwners(s)) {
    if(!validItemLots(inventory,true))throw new Error('Item count does not match physical items.');
    for(const item of inventory._items||[]){if(ids.has(item.id)||Number(item.id.slice(5))>=s.nextItemId||item.created>s.tick)throw new Error('Invalid or duplicated item identity.');ids.add(item.id);}
  }
  for(const c of s.crew){const p=c.possessions;if(!p||typeof p.collect!=='boolean'||!p.inventory||typeof p.inventory!=='object'||Array.isArray(p.inventory)||Object.keys(p.inventory).some(k=>!['keepsakes','_items'].includes(k))||(p.inventory.keepsakes||0)>1)throw new Error('Invalid personal inventory.');
    const claim=c.intent?.keepsake;if(claim){if(c.intent.type!=='leisure'||!p.collect||p.inventory.keepsakes||!/^item-[1-9]\d*$/.test(claim.id)||!['stock','drop','output'].includes(claim.source)||!Array.isArray(claim.target)||claim.target.length!==2||!claim.target.every(n=>Number.isInteger(n)&&n>=0&&n<s.sites[c.site].size)||claims.has(claim.id))throw new Error('Invalid personal pickup claim.');claims.add(claim.id);}
    if(c.intent?.searchedKeepsake!==undefined&&(c.intent.type!=='leisure'||typeof c.intent.searchedKeepsake!=='boolean'))throw new Error('Invalid personal search state.');
  }
}
