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
