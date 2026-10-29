import { TOOL_MATERIALS } from './tool-data.js';
import { tileEntityId } from './spatial.js';

// Discrete items travel alongside resource counts. Never split a physical item into fractions.
export const ITEM_STYLES = { art:'Prismatic knot', quiet:'Meditation ring', company:'Story tokens' };
export const ITEM_RESOURCES = ['keepsakes', 'tools'];
export const discreteResource = resource => ITEM_RESOURCES.includes(resource);
export const itemResource = item => item && item.kind === undefined ? 'keepsakes' : item?.kind === 'mining_tool' ? 'tools' : null;
export const fitAmount = (resource,amount,space) => discreteResource(resource) ? Math.floor(Math.min(amount,space)+1e-9) : Math.min(amount,space);
const TOOL_KEYS = ['id','maker','kind','material','quality','condition','created'];
export function validItemLots(inventory,physical=false) {
  if (!inventory || typeof inventory !== 'object') return false;
  const counts = ITEM_RESOURCES.map(resource => inventory[resource] === undefined ? 0 : inventory[resource]), items = inventory._items;
  if (counts.some(count => !Number.isSafeInteger(count) || count < 0)) return false;
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (items === undefined) return !physical || total === 0;
  if (!Array.isArray(items) || !items.length || items.length !== total || new Set(items.map(item => item?.id)).size !== total) return false;
  if (!ITEM_RESOURCES.every((resource, index) => items.filter(item => itemResource(item) === resource).length === counts[index])) return false;
  return items.every(item => {
    if (!item || !/^item-[1-9]\d*$/.test(item.id) || !/^crew-[0-6]$/.test(item.maker) || !Number.isInteger(item.quality) || item.quality < 1 || item.quality > 4 || !Number.isSafeInteger(item.created) || item.created < 0) return false;
    if (itemResource(item) === 'keepsakes') return Object.hasOwn(ITEM_STYLES, item.style);
    return Object.keys(item).length === TOOL_KEYS.length && TOOL_KEYS.every(key => Object.hasOwn(item, key)) && Object.hasOwn(TOOL_MATERIALS,item.material) && Number.isFinite(item.condition) && item.condition >= 0 && item.condition <= 100;
  });
}
export function takeItemLots(inventory,amount,requested=null,resource='keepsakes') {
  if (!discreteResource(resource) || !Number.isSafeInteger(amount) || amount < 0 || requested !== null && (!Array.isArray(requested) || requested.some(item => !item || typeof item.id !== 'string'))) return null;
  if (inventory._items !== undefined && (!Array.isArray(inventory._items) || new Set(inventory._items.map(item => item?.id)).size !== inventory._items.length)) return null;
  const available = (inventory._items || []).filter(item => itemResource(item) === resource);
  if (amount > available.length) return null;
  const ids = requested?.map(item => item.id), chosen = ids ? available.filter(item => ids.includes(item.id)) : available.slice(0, amount);
  if (chosen.length !== amount || new Set(chosen.map(item => item.id)).size !== amount || ids && (ids.length !== amount || new Set(ids).size !== amount)) return null;
  const selected = new Set(chosen.map(item => item.id)), left = (inventory._items || []).filter(item => !selected.has(item.id));
  if (left.length) inventory._items = left; else delete inventory._items;
  return chosen.map(item => ({...item}));
}
export function itemOwners(s) {
  const owners=[],put=(inventory,entity,slot)=>{if(inventory)owners.push({inventory,location:{entity,slot}});};
  for(const site of Object.values(s.sites))for(const t of site.tiles){const id=tileEntityId(site.id,t.x,t.y,t.z);put(t.stock,id,'stock');put(t.drop,id,'drop');put(t.imports,id,'imports');put(t.sanitary?.output,id,'sanitary.output');if(t.machine)for(const slot of ['input','output','batch'])put(t.machine[slot],id,`machine.${slot}`);}
  for(const c of s.crew){put(c.carry,c.id,'carry');put(c.possessions?.inventory,c.id,'pocket');}
  for(const j of s.jobs){put(j.materials,j.id,'materials');(j.sources||[]).forEach((source,i)=>put(source.items,j.id,`sources.${i}`));}
  // Freight is one durable owner, separate from flight service stores and salvage.
  put(s.mission?.cargo,'colony','mission.cargo');put(s.shuttle?.supplies,'colony','shuttle.supplies');put(s.shuttle?.freight,'colony','shuttle.freight');return owners;
}
