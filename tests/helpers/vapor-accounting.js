// totalResources already includes retained room/node vapor and condensate.
// Node exterior releases also enter atmosphere.vented; counting gasNetwork.vented
// again would duplicate them. Internal phase transfers are not boundary exports.
export function vaporWaterExports(s){
  return Object.values(s.sites).reduce((total,site)=>total+site.atmosphere.vented.vapor+site.vapor.vacuumEvaporated+site.vapor.condensateLost,0);
}
