import { tileAt, validCellPosition } from './spatial.js';

export const AIRLOCK_CONFIG_KEYS = ['chamber','inner','outer','extractor','pump','reservoir','vent'];
export const validAirlockPosition = (site,p) => p?.z === 0 && validCellPosition(site,p);
export const airlockCellFromKey = key => {
  if (typeof key !== 'string' || !/^\d+,\d+,0$/.test(key)) return null;
  const [x,y,z]=key.split(',').map(Number);return {x,y,z};
};
// Explicit boundaries for the still-ground-only configure command and rooms.
export const groundAirlockConfig = args => Object.fromEntries(AIRLOCK_CONFIG_KEYS.map(k=>[k,{x:args[k][0],y:args[k][1],z:0}]));
export const groundAirlockCells = room => room.cells.map(k=>`${k},0`);

// Check original location shapes before any migration. Unknown owner/state
// fields are preserved here and rejected by the full semantic validator.
export function validateAirlockLocations(s,{legacy=false}={}) {
  const valid=(site,p)=>legacy
    ? Array.isArray(p)&&p.length===2&&!!tileAt(site,{x:p[0],y:p[1],z:0})
    : validAirlockPosition(site,p);
  const check=(site,p,destination=false)=>{if(!(destination&&!legacy?validCellPosition(site,p):valid(site,p)))throw new Error('Invalid '+(legacy?'legacy ':'')+'airlock location.');};
  for(const site of Object.values(s.sites))for(const t of site.tiles) {
    const a=t.airlock;if(!a)continue;
    for(const k of AIRLOCK_CONFIG_KEYS)check(site,a.config?.[k]);
    if(!Array.isArray(a.chamberCells))throw new Error('Invalid airlock chamber cells.');
    for(const key of a.chamberCells) {
      const p=legacy&&typeof key==='string'&&/^\d+,\d+$/.test(key)?key.split(',').map(Number):legacy?null:airlockCellFromKey(key);
      check(site,p);
    }
    if(!Array.isArray(a.ownedNodes))throw new Error('Invalid airlock owned references.');
    for(const ref of a.ownedNodes) {
      if(!ref||legacy&&Object.hasOwn(ref,'z')||!legacy&&ref.z!==0)throw new Error('Invalid '+(legacy?'legacy ':'')+'airlock owned location.');
      check(site,legacy?[ref.x,ref.y]:{x:ref.x,y:ref.y,z:ref.z});
    }
    for(const entry of [...(a.queue||[]),...(a.party?[a.party]:[])])if(entry.destination!=null)check(site,entry.destination,true);
  }
  for(const c of s.crew)if(c.airlockTraversal?.destination!=null)check(s.sites[c.site],c.airlockTraversal.destination,true);
}
export function migrateAirlockLocations(s) {
  const position=p=>({x:p[0],y:p[1],z:0});
  for(const site of Object.values(s.sites))for(const t of site.tiles) {
    const a=t.airlock;if(!a)continue;
    for(const k of AIRLOCK_CONFIG_KEYS)a.config[k]=position(a.config[k]);
    a.chamberCells=a.chamberCells.map(k=>`${k},0`);
    for(const ref of a.ownedNodes)ref.z=0;
    for(const entry of [...a.queue,...(a.party?[a.party]:[])])if(entry.destination!=null)entry.destination=position(entry.destination);
  }
  for(const c of s.crew)if(c.airlockTraversal?.destination!=null)c.airlockTraversal.destination=position(c.airlockTraversal.destination);
}
