import { airlockDoorPermit, airlockRouteInfo } from './airlock-access.js';

// Orthogonal routes share one BFS; barriers differ for crew and wildlife.
const key=(x,y)=>`${x},${y}`;
const neighbors=(x,y)=>[[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
const tile=(site,x,y)=>x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
export function passable(site,x,y) {
  const t=tile(site,x,y);
  return !!t&&!t.fire&&!['void','rock'].includes(t.terrain)&&t.building!=='wall'&&!(t.building==='fence'&&t.hp>0)&&!(t.building==='door'&&t.doorMode==='closed'&&t.hp>0);
}
export function animalPassable(site,x,y,species='bristleback') {
  const t=tile(site,x,y);
  if(!t||t.fire||['void','rock'].includes(t.terrain)||t.building==='wall')return false;
  // Bristlebacks cannot operate automatic pressure doors. Tiny pests retain their
  // existing ability to slip through automatic doorways, but a sealed door stops both.
  if(t.building==='door'&&t.hp>0&&(t.doorMode==='closed'||species!=='tibble'&&t.doorMode!=='open'))return false;
  if(species==='tibble')return true;
  return !(t.hp>0&&(t.building==='fence'||(t.building==='pastureGate'&&t.gateMode!=='open')));
}
export function pathTo(site, from, goals, canEnter=passable) {
  const target = new Set(goals.filter(([x, y]) => canEnter(site, x, y)).map(([x, y]) => key(x, y)));
  if (!target.size) return null;
  const start = key(from.x, from.y), queue = [[from.x, from.y]], previous = new Map([[start, null]]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i], k = key(x, y);
    if (target.has(k)) {
      const result = []; let cursor = k;
      while (previous.get(cursor) !== null) { result.unshift(cursor.split(',').map(Number)); cursor = previous.get(cursor); }
      return result;
    }
    for (const [nx, ny] of neighbors(x, y)) { const nk = key(nx, ny); if (canEnter(site, nx, ny) && !previous.has(nk)) { previous.set(nk, k); queue.push([nx, ny]); } }
  }
  return null;
}
export const animalPath=(site,from,goals)=>pathTo(site,from,goals,(current,x,y)=>animalPassable(current,x,y,from.species));

/** A pure crew plan. Automatic cycles use complete chamber crossings.
 * Manual release provides ordinary walking access through its one permitted
 * side for chamber service; it never requests a disabled automatic cycle.
 * Neither form changes physical/animal reachability. */
export function planCrewRoute(s, site, crew, goals) {
  if (!site || !crew || !Array.isArray(goals)) return null;
  const controllers = site.tiles.filter(t => t.building === 'airlockController' && t.airlock?.binding);
  if (!controllers.length) {
    const path = pathTo(site, crew, goals);
    return path === null ? null : { path, cost: path.length, segments: path.length ? [{ kind: 'walk', path }] : [] };
  }
  const doors = new Set(), edges = new Map();
  const addEdge = (from, segment) => {
    const k = key(...from); if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(segment);
  };
  for (const t of controllers) {
    const a = t.airlock;
    // Even a damaged binding must not turn a shut door into a physical path.
    for (const side of ['inner', 'outer']) if (a.config?.[side]) doors.add(key(...a.config[side]));
    const route = airlockRouteInfo(site, t); if (!route) continue;
    if (a.phase === 'paused' && a.reason === 'manual_release') {
      const side = route[a.recoverySide], traveler = crew.id ? crew : { id: 'planned-crew' };
      // Source-to-destination logistics queries may have a tile as their origin.
      // The actual named crew member still needs the leaf permit on every step.
      if (side && airlockDoorPermit(site, traveler, side.outside, side.door)) doors.delete(key(...side.door));
      continue;
    }
    const chamber = new Set(route.chamberCells);
    const inside = (current, x, y) => chamber.has(key(x, y)) && passable(current, x, y);
    for (const direction of ['outward', 'inward']) {
      const entry = route[direction === 'outward' ? 'inner' : 'outer'];
      const exit = route[direction === 'outward' ? 'outer' : 'inner'];
      const crossing = pathTo(site, { x: entry.inside[0], y: entry.inside[1] }, [exit.inside], inside);
      if (crossing === null || !passable(site, ...entry.outside) || !passable(site, ...exit.outside)) continue;
      const descriptor = { kind: 'airlock', controller: `tile:${site.id}:${t.x}:${t.y}`, binding: a.binding, direction, destination: [...exit.outside] };
      addEdge(entry.outside, { ...descriptor, path: [entry.door, entry.inside, ...crossing, exit.door, exit.outside].map(p => [...p]) });
      const start = key(crew.x, crew.y);
      if (chamber.has(start) || start === key(...entry.door) || start === key(...exit.door)) {
        const origin = start === key(...entry.door) ? entry.inside : start === key(...exit.door) ? exit.inside : [crew.x, crew.y];
        const remaining = pathTo(site, { x: origin[0], y: origin[1] }, [exit.inside], inside);
        if (remaining !== null) addEdge([crew.x, crew.y], { ...descriptor, path: start === key(...exit.door) ? [[...exit.outside]] : [...(start === key(...entry.door) ? [[...entry.inside]] : []), ...remaining, [...exit.door], [...exit.outside]] });
      }
    }
  }
  const ordinary = (x, y) => !doors.has(key(x, y)) && passable(site, x, y);
  const targets = new Set(goals.filter(([x, y]) => ordinary(x, y)).map(p => key(...p)));
  if (!targets.size) return null;
  const start = key(crew.x, crew.y), best = new Map([[start, 0]]), previous = new Map();
  const queue = [{ at: [crew.x, crew.y], cost: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift(), k = key(...current.at);
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
    const options = neighbors(...current.at).filter(([x, y]) => ordinary(x, y)).map(p => ({ kind: 'walk', path: [p] }));
    options.push(...(edges.get(k) || []));
    for (const segment of options) {
      const end = key(...segment.path.at(-1));
      // Finite planning cost only; physical controller measures actual readiness.
      const cost = current.cost + segment.path.length + (segment.kind === 'airlock' ? 20 : 0);
      if (cost >= (best.get(end) ?? Infinity)) continue;
      best.set(end, cost); previous.set(end, { from: k, segment }); queue.push({ at: segment.path.at(-1), cost });
    }
  }
  return null;
}

// Compatibility adapter for crew destination selectors and carried supplies.
// Returned coordinates are a plan, never authority for an actual step.
export const crewPathTo = (s, site, from, goals) => planCrewRoute(s, site, from, goals)?.path ?? null;
