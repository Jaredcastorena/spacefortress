import { tileAt, validCellPosition } from './spatial.js';

export const validHazardPosition = (site,p) => validCellPosition(site,p);
export function validateHazardLocations(s,{legacy=false}={}) {
  const check=(site,p)=>{
    if(!p||(legacy?Object.hasOwn(p,'z'):!Number.isSafeInteger(p.z))||!tileAt(site,{x:p.x,y:p.y,z:legacy?0:p.z}))
      throw new Error('Invalid '+(legacy?'legacy ':'')+'hazard location.');
  };
  if(s.debris?.target!=null)check(s.sites.surface,s.debris.target);
  for(const site of Object.values(s.sites))for(const incident of site.incidents||[])check(site,incident);
}
export function migrateHazardLocations(s) {
  if(s.debris?.target!=null)s.debris.target.z=0;
  for(const site of Object.values(s.sites))for(const incident of site.incidents)incident.z=0;
}
