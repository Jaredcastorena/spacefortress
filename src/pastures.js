import { positionOf, cellKey, horizontalNeighbors, tileAt, sameCell } from './spatial.js';
import { isLivestock } from './livestock-data.js';
import { groundStep } from './spatial.js';
import { animalPassablePosition } from './navigation.js';
import { floraBiomass } from './flora.js';
import { emitEvent, recordingStatus, tileEntityId } from './telemetry.js';
// Derived animal-access regions. Neither regions nor observations own supplies or RNG.
export function pastureRegions(site) {
  const byCell=new Map(),regions=[];
  for(const tile of site.tiles){
    const start=cellKey(positionOf(tile));
    if(byCell.has(start)||!animalPassablePosition(site,positionOf(tile)))continue;
    const r={id:`pasture:${site.id}:${tile.x}:${tile.y}${positionOf(tile).z===0?'':`:${tile.z}`}`,z:positionOf(tile).z,cells:[],enclosed:true,lichen:0};
    const queue=[tile];byCell.set(start,r);
    for(let i=0;i<queue.length;i++){
      const t=queue[i];r.cells.push(positionOf(t));if(t.terrain==='ground'&&(!t.building||['fence','pastureGate','husbandryPost'].includes(t.building)))r.lichen+=floraBiomass(t);
      if(t.x===0||t.y===0||t.x===site.size-1||t.y===site.size-1)r.enclosed=false;
      for(const p of horizontalNeighbors(positionOf(t)))if(animalPassablePosition(site,p)&&!byCell.has(cellKey(p))){byCell.set(cellKey(p),r);queue.push(tileAt(site,p));}
    }
    regions.push(r);
  }
  return {byCell,regions};
}
export function animalPasture(s,a,regions=pastureRegions(s.sites.surface)) {
  const r=a.site==='surface'?regions.byCell.get(cellKey(positionOf(a))):null,post=a.husbandry?.post;
  return {region:r?.id||null,enclosed:!!r?.enclosed,tiles:r?.cells.length||0,lichen:r?.lichen||0,postReachable:post?!!r&&regions.byCell.get(cellKey(post))===r:null};
}
export function pastureSnapshot(s) {
  if(!recordingStatus(s).active)return null;
  const regions=pastureRegions(s.sites.surface);
  return new Map(s.creatures.filter(a=>isLivestock(a)&&a.health>0).map(a=>[a.id,animalPasture(s,a,regions)]));
}
export function recordPastureChanges(s,before) {
  if(!before)return;
  const regions=pastureRegions(s.sites.surface);
  for(const a of s.creatures.filter(a=>isLivestock(a)&&a.health>0)){
    const previous=before.get(a.id),current=animalPasture(s,a,regions);if(!previous)continue;
    if(previous.enclosed!==current.enclosed)emitEvent(s,current.enclosed?'animal.containment.gained':'animal.containment.lost',{entity:a.id,previous:previous.region,region:current.region});
    else if(previous.region!==current.region)emitEvent(s,'animal.pasture.changed',{entity:a.id,previous:previous.region,region:current.region,enclosed:current.enclosed});
    if(previous.postReachable!==current.postReachable)emitEvent(s,'animal.post.route_changed',{entity:a.id,previous:previous.postReachable,reachable:current.postReachable});
  }
}
export function moveAnimal(s,a,next,reason) {
  const destination=groundStep(s.sites[a.site],a,next);if(!destination)return false;
  next=[destination.x,destination.y];
  const from=tileEntityId(a.site,a.x,a.y);[a.x,a.y]=next;
  emitEvent(s,'animal.moved',{entity:a.id,from,to:tileEntityId(a.site,a.x,a.y),reason});return true;
}
export function setPastureGate(s,siteId,x,y,mode,z=0) {
  const site=s.sites[siteId],t=tileAt(site,{x,y,z});
  if(t?.building!=='pastureGate'||!['latched','open'].includes(mode))return {ok:false,message:'Select a pasture gate.'};
  if(mode==='latched'&&s.creatures.some(a=>a.site===siteId&&isLivestock(a)&&a.health>0&&sameCell(positionOf(a),{x,y,z})))return {ok:false,message:'Wait for the animal to clear the gate.'};
  const before=pastureSnapshot(s),previous=t.gateMode;t.gateMode=mode;
  if(previous!==mode)emitEvent(s,'pasture.gate.mode_changed',{entity:tileEntityId(siteId,x,y,z),previous,mode,effective:t.hp>0});
  recordPastureChanges(s,before);return {ok:true};
}
export function validatePastures(s) {
  for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.building==='pastureGate'?!['latched','open'].includes(t.gateMode):t.gateMode!==undefined)throw new Error('Invalid pasture gate.');
}
