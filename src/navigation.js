import { walkingNeighbors } from './vertical.js';
import { airlockCellFromKey } from './airlock-locations.js';
import { airlockDoorPermit, airlockRouteInfo } from './airlock-access.js';
import { tileAt as tileAtPosition, cellKey, horizontalNeighbors } from './spatial.js';

// Horizontal paths use explicit cells internally. Legacy coordinate pairs
// always mean deck zero; no implicit edge connects matching x/y across decks.
export function passablePosition(site, position) {
  const t=tileAtPosition(site,position);
  return !!t&&!t.fire&&!['void','rock'].includes(t.terrain)&&t.building!=='wall'&&!(t.building==='fence'&&t.hp>0)&&!(t.building==='door'&&t.doorMode==='closed'&&t.hp>0);
}
export function animalPassablePosition(site,position,species='bristleback') {
  const t=tileAtPosition(site,position);
  if(!t||t.fire||['void','rock'].includes(t.terrain)||t.building==='wall')return false;
  // Livestock cannot operate automatic pressure doors; pests can slip through.
  if(t.building==='door'&&t.hp>0&&(t.doorMode==='closed'||species!=='tibble'&&t.doorMode!=='open'))return false;
  if(species==='tibble')return true;
  return !(t.hp>0&&(t.building==='fence'||(t.building==='pastureGate'&&t.gateMode!=='open')));
}
export const passable=(site,x,y)=>passablePosition(site,{x,y,z:0});
export const animalPassable=(site,x,y,species='bristleback')=>animalPassablePosition(site,{x,y,z:0},species);

/** Read-only horizontal BFS. A blocked but existing origin may be evacuated.
 * Destinations/steps must exist and pass the supplied access rule. The returned
 * local positions are detached; this function never moves actors or opens doors. */
export function pathToPosition(site, from, goals, canEnter=passablePosition, neighborsFor=walkingNeighbors) {
  if (!tileAtPosition(site,from) || !Array.isArray(goals)) return null;
  const target = new Set(goals.filter(p=>tileAtPosition(site,p)&&canEnter(site,p)).map(cellKey));
  if (!target.size) return null;
  const start={x:from.x,y:from.y,z:from.z}, startKey=cellKey(start);
  const queue=[start], previous=new Map([[startKey,{parent:null,position:start}]]);
  for(let i=0;i<queue.length;i++) {
    const current=queue[i], k=cellKey(current);
    if(target.has(k)) {
      const result=[];
      for(let entry=previous.get(k);entry.parent!==null;entry=previous.get(entry.parent))result.push(entry.position);
      return result.reverse();
    }
    for(const next of neighborsFor(site,current)) {
      const nk=cellKey(next);
      if(previous.has(nk)||!tileAtPosition(site,next)||!canEnter(site,next))continue;
      previous.set(nk,{parent:k,position:next});queue.push(next);
    }
  }
  return null;
}
export const animalPathToPosition=(site,from,goals)=>pathToPosition(site,from,goals,(current,p)=>animalPassablePosition(current,p,from.species),walkingNeighbors);

// Pair-valued callers are deliberately restricted to the landing deck. They
// cannot erase an explicit actor level or silently truncate a third coordinate.
export function pathTo(site, from, goals, canEnter=passable) {
  if (!from || from.z!==undefined&&from.z!==0 || !Array.isArray(goals)) return null;
  const origin={...from,z:0};
  const targets=goals.filter(p=>Array.isArray(p)&&p.length===2).map(([x,y])=>({x,y,z:0}));
  const path=pathToPosition(site,origin,targets,(current,p)=>p.z===0&&canEnter(current,p.x,p.y));
  return path===null?null:path.map(p=>[p.x,p.y]);
}
export const animalPath=(site,from,goals)=>pathTo(site,from,goals,(current,x,y)=>animalPassable(current,x,y,from.species));

const groundCell = pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isSafeInteger)
  ? { x: pair[0], y: pair[1], z: 0 } : null;
const pair = p => [p.x, p.y];
const cell = p => ({ x: p.x, y: p.y, z: p.z });

/** Pure position-valued crew plan. Controller configuration and persisted
 * traversal claims still use ground pairs; convert those only at this boundary.
 * Automatic crossings retain their finite planning cost, not a readiness promise.
 * Manual release permits ordinary access through its one released side. */
export function planCrewRoutePositions(s, site, crew, goals) {
  if (!tileAtPosition(site, crew) || !Array.isArray(goals)) return null;
  const controllers = site.tiles.filter(t => t.building === 'airlockController' &&
    t.airlock?.binding);
  // Upper-deck controller configurations have no supported persistence contract yet.
  if (controllers.some(t=>(t.z??0)!==0)) return null;
  if (!controllers.length) {
    const path = pathToPosition(site, crew, goals);
    return path === null ? null : { path, cost: path.length, segments: path.length ? [{ kind: 'walk', path }] : [] };
  }
  const doors = new Set(), edges = new Map();
  const addEdge = (from, segment) => {
    const k = cellKey(from); if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(segment);
  };
  for (const t of controllers) {
    const a = t.airlock;
    // A damaged binding must not turn a shut door into a walking path.
    for (const side of ['inner', 'outer']) if (a.config?.[side]) {
      const door = a.config[side]; if (!door) return null;
      doors.add(cellKey(door));
    }
    const route = airlockRouteInfo(site, t); if (!route) continue;
    if (a.phase === 'paused' && a.reason === 'manual_release') {
      const side = route[a.recoverySide], traveler = crew.id ? crew : { id: 'planned-crew' };
      // Logistics may plan from a tile. Actual walking still requires the named
      // crew member's leaf permit, checked again immediately before movement.
      if (side && airlockDoorPermit(site, traveler, side.outside, side.door)) doors.delete(cellKey(side.door));
      continue;
    }
    const chamberCells = route.chamberCells.map(airlockCellFromKey);
    if (chamberCells.some(p => !p)) return null;
    const chamber = new Set(chamberCells.map(cellKey));
    const inside = (current, p) => passablePosition(current, p) && chamber.has(cellKey(p));
    const sidePositions = side => Object.fromEntries(['outside', 'door', 'inside'].map(k => [k, cell(side[k])]));
    for (const direction of ['outward', 'inward']) {
      const entry = sidePositions(route[direction === 'outward' ? 'inner' : 'outer']);
      const exit = sidePositions(route[direction === 'outward' ? 'outer' : 'inner']);
      if ([...Object.values(entry), ...Object.values(exit)].some(p => !p)) return null;
      const crossing = pathToPosition(site, entry.inside, [exit.inside], inside);
      if (crossing === null || !passablePosition(site, entry.outside) || !passablePosition(site, exit.outside)) continue;
      const descriptor = { kind: 'airlock', controller: `tile:${site.id}:${t.x}:${t.y}`, binding: a.binding, direction, destination: cell(exit.outside) };
      addEdge(entry.outside, { ...descriptor, path: [entry.door, entry.inside, ...crossing, exit.door, exit.outside].map(cell) });
      const start = cellKey(crew), entryKey = cellKey(entry.door), exitKey = cellKey(exit.door);
      if (chamber.has(start) || start === entryKey || start === exitKey) {
        const origin = start === entryKey ? entry.inside : start === exitKey ? exit.inside : crew;
        const remaining = pathToPosition(site, origin, [exit.inside], inside);
        if (remaining !== null) addEdge(crew, { ...descriptor, path: start === exitKey ? [cell(exit.outside)] : [...(start === entryKey ? [cell(entry.inside)] : []), ...remaining, cell(exit.door), cell(exit.outside)] });
      }
    }
  }
  const ordinary = p => passablePosition(site, p) && !doors.has(cellKey(p));
  const targets = new Set(goals.filter(ordinary).map(cellKey));
  if (!targets.size) return null;
  const start = cellKey(crew), best = new Map([[start, 0]]), previous = new Map();
  const queue = [{ at: cell(crew), cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift(), k = cellKey(current.at);
    if (current.cost !== best.get(k)) continue;
    if (targets.has(k)) {
      const segments = []; let cursor = k;
      while (cursor !== start) { const step = previous.get(cursor); segments.unshift(step.segment); cursor = step.from; }
      const merged = [];
      for (const segment of segments) {
        if (segment.kind === 'walk' && merged.at(-1)?.kind === 'walk') merged.at(-1).path.push(...segment.path);
        else merged.push(segment);
      }
      return { segments: merged, cost: current.cost, path: merged.flatMap(segment => segment.path) };
    }
    const options = walkingNeighbors(site,current.at).filter(ordinary).map(p => ({ kind: 'walk', path: [p] }));
    options.push(...(edges.get(k) || []));
    for (const segment of options) {
      const end = cellKey(segment.path.at(-1));
      const cost = current.cost + segment.path.length + (segment.kind === 'airlock' ? 20 : 0);
      if (cost >= (best.get(end) ?? Infinity)) continue;
      best.set(end, cost); previous.set(end, { from: k, segment }); queue.push({ at: segment.path.at(-1), cost });
    }
  }
  return null;
}

// Pair-valued compatibility for unconverted destination and inventory callers.
// It cannot discard a real deck coordinate. Plans never authorize a physical step.
export function planCrewRoute(s, site, crew, goals) {
  if (!crew || crew.z !== undefined && crew.z !== 0 || !Array.isArray(goals)) return null;
  const targets = goals.map(groundCell); if (targets.some(p => !p)) return null;
  const route = planCrewRoutePositions(s, site, { ...crew, z: 0 }, targets);
  if (route === null || route.path.some(p=>p.z!==0)) return null;
  return { ...route, path: route.path.map(pair), segments: route.segments.map(segment => ({
    ...segment, path: segment.path.map(pair), ...(segment.destination ? { destination: pair(segment.destination) } : {}),
  })) };
}
export const crewPathTo = (s, site, from, goals) => planCrewRoute(s, site, from, goals)?.path ?? null;
export const crewPathToPosition = (s, site, from, goals) => planCrewRoutePositions(s, site, from, goals)?.path ?? null;
