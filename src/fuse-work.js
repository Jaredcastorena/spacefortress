import { FUSE_REPLACEMENT_COST, FUSE_REPLACEMENT_WORK } from './power-protection.js';
import { positionOf, tileAt } from './spatial.js';
import { emitEvent, tileEntityId } from './telemetry.js';

const exactCost = (cost, expected) => cost && typeof cost === 'object' && !Array.isArray(cost) && Object.keys(cost).length === Object.keys(expected).length && Object.entries(expected).every(([key,value]) => cost[key] === value);
export function fuseReplacementReady(tile) {
  if(tile?.building!=='fuseBox'||tile.protection?.kind!=='fuse'||!tile.protection.blown)return {ok:false,message:'Select a blown fuse.'};
  if(!(tile.hp>0))return {ok:false,message:'Repair the fuse box before replacing its cartridge.'};
  if(tile.protection.enabled!==false)return {ok:false,message:'Open the fuse box before replacing its cartridge.'};
  if(tile.fire)return {ok:false,message:'Suppress the fire before replacing the fuse.'};
  return {ok:true};
}
// Called while the job still owns its delivered material. A false result lets
// the simulation use ordinary cancellation to return every held resource.
export function completeFuseReplacement(s, crew, job, tile) {
  if(!fuseReplacementReady(tile).ok)return false;
  const previous={...tile.protection};
  tile.protection={...previous,enabled:false,blown:false,lastThroughput:0,lastTick:null};
  emitEvent(s,'power.fuse.replaced',{entity:tileEntityId(job.site,job.x,job.y,job.z),actor:crew.id,job:job.id,cost:{...job.cost},materials:{...job.cost},previous,next:{...tile.protection}});
  return true;
}
export function rejectLegacyFuses(s) {
  if(Object.values(s.sites).some(site=>site.tiles.some(tile=>tile.building==='fuseBox'||tile.protection?.kind==='fuse'))||s.jobs.some(job=>job.kind==='replaceFuse'||job.building==='fuseBox'))throw new Error('Legacy fuse state or work order.');
}
export function validateFuseWork(s) {
  for(const job of s.jobs) {
    const tile=tileAt(s.sites[job.site],positionOf(job));
    if(job.kind==='replaceFuse') {
      // Condition, requested power and fire can change after designation.
      // Keep those pending saves valid and revalidate before consuming material.
      if(tile?.building!=='fuseBox'||job.building!==null||job.work!==FUSE_REPLACEMENT_WORK||!exactCost(job.cost,FUSE_REPLACEMENT_COST)||job.missingFood!==0||job.foodSpoiled!==0||job.connection!==undefined||job.utilityConnection!==undefined)throw new Error('Invalid paid fuse replacement.');
    }
    if(job.kind==='build'&&job.building==='cable'&&tile?.building==='fuseBox')throw new Error('Cable cannot bypass a fuse contact.');
    if(tile?.building==='fuseBox'&&['repair','remove'].includes(job.kind)) {
      const repair=job.kind==='repair';
      if(job.building!==null||job.work!==5||!exactCost(job.cost,repair?{alloy:1}:{})||(repair&&tile.hp>=100))throw new Error('Invalid fuse work order.');
    }
  }
}
