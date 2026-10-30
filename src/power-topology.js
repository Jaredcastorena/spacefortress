import { isProtectionDevice, protectionClosed } from './power-protection.js';
import {activeUtilityLinks} from './utility-links.js';
import { BUILDINGS } from './data.js';
import { breakerClosed, BREAKER_DIRECTIONS } from './breakers.js';
import { DIRECTIONS, step, opposite } from './geometry.js';
import { tileAt, cellKey, positionOf, sameCell } from './spatial.js';

export { breakerClosed as breakerContactClosed, BREAKER_DIRECTIONS as POWER_DIRECTIONS };
// Keep existing ground graph IDs; other decks have distinct explicit keys.
export const powerTileKey = t => {const p=positionOf(t);return p.z===0?`${p.x},${p.y}`:cellKey(p);};
export const breakerTerminals = t => ({input:`${powerTileKey(t)}:input`,output:`${powerTileKey(t)}:output`});
const ordinaryElectrical = t => !!(BUILDINGS[t.building]?.output || BUILDINGS[t.building]?.demand || t.building==='battery');
const conducting = t => t.cable ? t.cable.enabled && t.cable.hp>0 : ordinaryElectrical(t) && t.hp>0;
const at = tileAt;

function facing(t,terminal) {
  const direction=t.protection?.direction;
  if(!Object.hasOwn(BREAKER_DIRECTIONS,direction))return null;
  const [x,y]=step(t.x,t.y,terminal==='input'?opposite(direction):direction);
  return {x,y,z:positionOf(t).z};
}
function matchingVertex(t,from) {
  if(!isProtectionDevice(t))return conducting(t)?powerTileKey(t):null;
  for(const terminal of ['input','output']) {
    const position=facing(t,terminal);
    if(position&&sameCell(position,positionOf(from)))return breakerTerminals(t)[terminal];
  }
  return null;
}

// Graph vertices refer to physical tiles, but graph construction never changes
// them. Broken/disabled ordinary equipment remains an isolated vertex exactly
// as in the legacy allocator. A protection device owns two vertices and no allocation tile.
export function buildPowerTopology(site,{openContacts=new Set()}={}) {
  const vertices=new Map(),adjacency=new Map(),membership=new Map();
  const riserNeighbors=new Map();
  for(const link of activeUtilityLinks(site,'power'))for(const [from,to] of [[link.lower,link.upper],[link.upper,link.lower]]){const k=powerTileKey(from);riserNeighbors.set(k,[...(riserNeighbors.get(k)||[]),to]);}
  for(const t of site.tiles) {
    if(isProtectionDevice(t)) {
      const terminals=breakerTerminals(t);
      for(const terminal of ['input','output'])vertices.set(terminals[terminal],{id:terminals[terminal],tile:t,terminal});
    }else if(t.cable||ordinaryElectrical(t)) {
      const id=powerTileKey(t);vertices.set(id,{id,tile:t,terminal:null});
    }
  }
  for(const [id,vertex] of vertices) {
    const {tile:t,terminal}=vertex,edges=[];
    if(terminal) {
      const position=facing(t,terminal);
      if(position) {
        const neighbor=at(site,position);
        const endpoint=neighbor&&matchingVertex(neighbor,t);
        if(endpoint&&vertices.has(endpoint))edges.push(endpoint);
      }
      if(protectionClosed(t)&&!openContacts.has(powerTileKey(t)))edges.push(breakerTerminals(t)[terminal==='input'?'output':'input']);
    }else if(conducting(t)) {
      for(const direction of DIRECTIONS) {
        const [x,y]=step(t.x,t.y,direction),neighbor=at(site,{x,y,z:positionOf(t).z}),endpoint=neighbor&&matchingVertex(neighbor,t);
        if(endpoint&&vertices.has(endpoint))edges.push(endpoint);
      }
    }
    if(!terminal&&conducting(t))for(const p of (riserNeighbors.get(powerTileKey(t))||[])){const n=at(site,p),endpoint=n&&matchingVertex(n,t);if(endpoint&&vertices.has(endpoint))edges.push(endpoint);}
    adjacency.set(id,edges);
  }
  const circuits=[];
  for(const [startId,start] of vertices) {
    if(membership.has(startId))continue;
    const z=positionOf(start.tile).z;
    const circuitId=`circuit-${start.tile.y*site.size+start.tile.x}${z===0?'':`-z${z}`}${start.terminal?`-${start.terminal}`:''}`;
    const cells=[startId],tiles=[],terminals=[];membership.set(startId,circuitId);
    for(let i=0;i<cells.length;i++) {
      const vertex=vertices.get(cells[i]);
      if(vertex.terminal)terminals.push(vertex.id);else tiles.push(vertex.tile);
      for(const next of adjacency.get(vertex.id))if(!membership.has(next)){membership.set(next,circuitId);cells.push(next);}
    }
    circuits.push({id:circuitId,tiles,terminals,cells});
  }
  return {circuits,membership,vertices,adjacency};
}

// Omit only the requested relay's own contact. Every other contact keeps the
// supplied graph's actual state. Reaching the input from the output proves an
// alternate path exists; no cable or other breaker is opened to invent isolation.
export function branchForBreaker(site,t,topology=buildPowerTopology(site)) {
  const terminals=breakerTerminals(t),reached=new Set(),tiles=[],terminalIds=[];
  if(!isProtectionDevice(t)||!topology.vertices.has(terminals.output))return {tiles,terminals:terminalIds,vertices:reached,bypassed:false,sources:[]};
  const queue=[terminals.output];reached.add(terminals.output);
  for(let i=0;i<queue.length;i++) {
    const current=queue[i],vertex=topology.vertices.get(current);
    if(vertex.terminal)terminalIds.push(current);else tiles.push(vertex.tile);
    for(const next of topology.adjacency.get(current)) {
      if(current===terminals.input&&next===terminals.output||current===terminals.output&&next===terminals.input)continue;
      if(!reached.has(next)){reached.add(next);queue.push(next);}
    }
  }
  // These are physical source candidates. Allocation determines whether day,
  // fuel, condition and retained battery charge make each one available now.
  const sources=tiles.filter(tile=>BUILDINGS[tile.building]?.output||tile.building==='battery');
  return {tiles,terminals:terminalIds,vertices:reached,bypassed:reached.has(terminals.input),sources};
}
