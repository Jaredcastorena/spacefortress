import { animalPassable } from './navigation.js';
import { emitEvent, recordingStatus, tileEntityId } from './telemetry.js';
const adjacent=(x,y)=>[[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
// Derived animal-access regions. Neither regions nor observations own supplies or RNG.
export function pastureRegions(site) {
  const byCell=new Map(),regions=[];
  for(const tile of site.tiles){
    const start=tile.y*site.size+tile.x;
    if(byCell.has(start)||!animalPassable(site,tile.x,tile.y))continue;
    const r={id:`pasture:${site.id}:${tile.x}:${tile.y}`,cells:[],enclosed:true,lichen:0};
    const queue=[tile];byCell.set(start,r);
    for(let i=0;i<queue.length;i++){
      const t=queue[i];r.cells.push([t.x,t.y]);if(t.terrain==='ground'&&(!t.building||['fence','pastureGate','husbandryPost'].includes(t.building)))r.lichen+=t.lichen||0;
      if(t.x===0||t.y===0||t.x===site.size-1||t.y===site.size-1)r.enclosed=false;
      for(const [x,y] of adjacent(t.x,t.y))if(animalPassable(site,x,y)&&!byCell.has(y*site.size+x)){byCell.set(y*site.size+x,r);queue.push(site.tiles[y*site.size+x]);}
    }
    regions.push(r);
  }
  return {byCell,regions};
}
export function animalPasture(s,a,regions=pastureRegions(s.sites.surface)) {
  const size=s.sites.surface.size,r=regions.byCell.get(a.y*size+a.x),post=a.husbandry?.post;
  return {region:r?.id||null,enclosed:!!r?.enclosed,tiles:r?.cells.length||0,lichen:r?.lichen||0,postReachable:post?!!r&&regions.byCell.get(post[1]*size+post[0])===r:null};
}
export function pastureSnapshot(s) {
  if(!recordingStatus(s).active)return null;
  const regions=pastureRegions(s.sites.surface);
  return new Map(s.creatures.filter(a=>a.species==='bristleback'&&a.health>0).map(a=>[a.id,animalPasture(s,a,regions)]));
}
export function recordPastureChanges(s,before) {
  if(!before)return;
  const regions=pastureRegions(s.sites.surface);
  for(const a of s.creatures.filter(a=>a.species==='bristleback'&&a.health>0)){
    const previous=before.get(a.id),current=animalPasture(s,a,regions);if(!previous)continue;
    if(previous.enclosed!==current.enclosed)emitEvent(s,current.enclosed?'animal.containment.gained':'animal.containment.lost',{entity:a.id,previous:previous.region,region:current.region});
    else if(previous.region!==current.region)emitEvent(s,'animal.pasture.changed',{entity:a.id,previous:previous.region,region:current.region,enclosed:current.enclosed});
    if(previous.postReachable!==current.postReachable)emitEvent(s,'animal.post.route_changed',{entity:a.id,previous:previous.postReachable,reachable:current.postReachable});
  }
}
export function moveAnimal(s,a,next,reason) {
  const from=tileEntityId(a.site,a.x,a.y);[a.x,a.y]=next;
  emitEvent(s,'animal.moved',{entity:a.id,from,to:tileEntityId(a.site,a.x,a.y),reason});
}
export function setPastureGate(s,siteId,x,y,mode) {
  const site=s.sites[siteId],t=site&&x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
  if(t?.building!=='pastureGate'||!['latched','open'].includes(mode))return {ok:false,message:'Select a pasture gate.'};
  if(mode==='latched'&&s.creatures.some(a=>a.site===siteId&&a.species==='bristleback'&&a.health>0&&a.x===x&&a.y===y))return {ok:false,message:'Wait for the bristleback to clear the gate.'};
  const before=pastureSnapshot(s),previous=t.gateMode;t.gateMode=mode;
  if(previous!==mode)emitEvent(s,'pasture.gate.mode_changed',{entity:tileEntityId(siteId,x,y),previous,mode,effective:t.hp>0});
  recordPastureChanges(s,before);return {ok:true};
}
export function validatePastures(s) {
  for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.building==='pastureGate'?!['latched','open'].includes(t.gateMode):t.gateMode!==undefined)throw new Error('Invalid pasture gate.');
}
