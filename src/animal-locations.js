import { tileAt, validCellPosition } from './spatial.js';

export const validAnimalPosition = (site,p) => p?.z === 0 && validCellPosition(site,p);
export function validateAnimalLocations(s,{legacy=false}={}) {
  for (const a of s.creatures ?? []) {
    const post=a.husbandry?.post;
    if (post != null && !(legacy
      ? Array.isArray(post) && post.length === 2 && !!tileAt(s.sites.surface,{x:post[0],y:post[1],z:0})
      : validAnimalPosition(s.sites.surface,post)))
      throw new Error(legacy ? 'Invalid legacy animal post location.' : 'Invalid animal post location.');
    const owner=a.death?.owner;
    if (owner?.kind === 'tile' && ((legacy ? Object.hasOwn(owner,'z') : owner.z !== 0) ||
        !tileAt(s.sites[owner.site],{x:owner.x,y:owner.y,z:0})))
      throw new Error(legacy ? 'Invalid legacy carcass location.' : 'Invalid carcass location.');
  }
}
export function migrateAnimalLocations(s) {
  for (const a of s.creatures ?? []) {
    if (a.husbandry?.post != null) {
      const [x,y]=a.husbandry.post;a.husbandry.post={x,y,z:0};
    }
    if (a.death?.owner?.kind === 'tile') a.death.owner.z=0;
  }
}
