import { BUILDINGS } from './data.js';
import { breakerClosed, BREAKER_DIRECTIONS } from './breakers.js';

export { breakerClosed as breakerContactClosed, BREAKER_DIRECTIONS as POWER_DIRECTIONS };
export const powerTileKey = t => `${t.x},${t.y}`;
export const breakerTerminals = t => ({input:`${powerTileKey(t)}:input`,output:`${powerTileKey(t)}:output`});
const ordinaryElectrical = t => !!(BUILDINGS[t.building]?.output || BUILDINGS[t.building]?.demand || t.building==='battery');
const conducting = t => t.cable ? t.cable.enabled && t.cable.hp>0 : ordinaryElectrical(t) && t.hp>0;
const at = (site,x,y) => x>=0&&y>=0&&x<site.size&&y<site.size ? site.tiles[y*site.size+x] : null;
// Preserve the original power allocator's neighbor order exactly.
const STEPS = [[1,0],[-1,0],[0,1],[0,-1]];

function facing(t,terminal) {
  const direction=BREAKER_DIRECTIONS[t.protection?.direction];
  if(!direction)return null;
  const sign=terminal==='input'?-1:1;
  return [direction[0]*sign,direction[1]*sign];
}
function matchingVertex(t,from) {
  if(t.building!=='breaker')return conducting(t)?powerTileKey(t):null;
  for(const terminal of ['input','output']) {
    const direction=facing(t,terminal);
    if(direction&&t.x+direction[0]===from.x&&t.y+direction[1]===from.y)return breakerTerminals(t)[terminal];
  }
  return null;
}

// Graph vertices refer to physical tiles, but graph construction never changes
// them. Broken/disabled ordinary equipment remains an isolated vertex exactly
// as in the legacy allocator. A breaker owns two vertices and no allocation tile.
export function buildPowerTopology(site,{openContacts=new Set()}={}) {
  const vertices=new Map(),adjacency=new Map(),membership=new Map();
  for(const t of site.tiles) {
    if(t.building==='breaker') {
      const terminals=breakerTerminals(t);
      for(const terminal of ['input','output'])vertices.set(terminals[terminal],{id:terminals[terminal],tile:t,terminal});
    }else if(t.cable||ordinaryElectrical(t)) {
      const id=powerTileKey(t);vertices.set(id,{id,tile:t,terminal:null});
    }
  }
  for(const [id,vertex] of vertices) {
    const {tile:t,terminal}=vertex,edges=[];
    if(terminal) {
      const direction=facing(t,terminal);
      if(direction) {
        const neighbor=at(site,t.x+direction[0],t.y+direction[1]);
        const endpoint=neighbor&&matchingVertex(neighbor,t);
        if(endpoint&&vertices.has(endpoint))edges.push(endpoint);
      }
      if(breakerClosed(t)&&!openContacts.has(powerTileKey(t)))edges.push(breakerTerminals(t)[terminal==='input'?'output':'input']);
    }else if(conducting(t)) {
      for(const [dx,dy] of STEPS) {
        const neighbor=at(site,t.x+dx,t.y+dy),endpoint=neighbor&&matchingVertex(neighbor,t);
        if(endpoint&&vertices.has(endpoint))edges.push(endpoint);
      }
    }
    adjacency.set(id,edges);
  }
  const circuits=[];
  for(const [startId,start] of vertices) {
    if(membership.has(startId))continue;
    const circuitId=`circuit-${start.tile.y*site.size+start.tile.x}${start.terminal?`-${start.terminal}`:''}`;
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
  if(t.building!=='breaker'||!topology.vertices.has(terminals.output))return {tiles,terminals:terminalIds,vertices:reached,bypassed:false,sources:[]};
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
