// Discrete items travel alongside resource counts. Never split a keepsake into fractions.
export const ITEM_STYLES = { art:'Prismatic knot', quiet:'Meditation ring', company:'Story tokens' };
export const fitAmount = (resource,amount,space) => resource==='keepsakes' ? Math.floor(Math.min(amount,space)+1e-9) : Math.min(amount,space);
export function validItemLots(inventory,physical=false) {
  const count=inventory.keepsakes===undefined?0:inventory.keepsakes,items=inventory._items;
  if(!Number.isSafeInteger(count)||count<0)return false;
  if(items===undefined)return !physical||count===0;
  return Array.isArray(items)&&items.length>0&&items.length===count&&items.every(i=>i&&/^item-[1-9]\d*$/.test(i.id)&&/^crew-[0-6]$/.test(i.maker)&&Object.hasOwn(ITEM_STYLES,i.style)&&Number.isInteger(i.quality)&&i.quality>=1&&i.quality<=4&&Number.isSafeInteger(i.created)&&i.created>=0);
}
export function takeItemLots(inventory,amount,requested=null) {
  if(!Number.isSafeInteger(amount)||amount<0||amount>(inventory._items?.length||0))return null;
  const ids=requested?.map(i=>i.id),chosen=ids?inventory._items.filter(i=>ids.includes(i.id)):inventory._items.slice(0,amount);
  if(chosen.length!==amount||ids&&new Set(ids).size!==amount)return null;
  const selected=new Set(chosen.map(i=>i.id)),left=inventory._items.filter(i=>!selected.has(i.id));
  if(left.length)inventory._items=left;else delete inventory._items;
  return chosen.map(i=>({...i}));
}
export function itemOwners(s) {
  const owners=[],put=(inventory,entity,slot)=>{if(inventory)owners.push({inventory,location:{entity,slot}});};
  for(const site of Object.values(s.sites))for(const t of site.tiles){const id=`tile:${site.id}:${t.x}:${t.y}`;put(t.stock,id,'stock');put(t.drop,id,'drop');put(t.imports,id,'imports');put(t.sanitary?.output,id,'sanitary.output');if(t.machine)for(const slot of ['input','output','batch'])put(t.machine[slot],id,`machine.${slot}`);}
  for(const c of s.crew){put(c.carry,c.id,'carry');put(c.possessions?.inventory,c.id,'pocket');}
  for(const j of s.jobs){put(j.materials,j.id,'materials');j.sources.forEach((source,i)=>put(source.items,j.id,`sources.${i}`));}
  // Freight is one durable owner, separate from flight service stores and salvage.
  put(s.mission?.cargo,'colony','mission.cargo');put(s.shuttle?.supplies,'colony','shuttle.supplies');put(s.shuttle?.freight,'colony','shuttle.freight');return owners;
}
