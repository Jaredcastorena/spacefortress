import { settlementSite } from './region.js';
import {tileAt} from './spatial.js';
import {validateVerticalLinks,MAX_DECKS} from './vertical.js';
// Validate declared floors before validating their named position references.
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value, key) => Object.hasOwn(value, key);

function primaryEntities(state) {
  if (!Array.isArray(state.creatures)) throw new Error('Invalid creatures.');
  return [
    ...Object.values(state.sites).flatMap(site => site.tiles),
    ...state.crew, ...state.jobs, ...state.creatures,
  ];
}

export function validateDeckState(state, { legacy = false } = {}) {
  if(state.version<55&&(Object.values(state.sites).some(site=>site.tiles?.some(t=>owns(t,'verticalLink')))||state.jobs.some(j=>j.building==='stairwell')))throw new Error('Legacy save contains stairwell fields.');
  if(state.version<56&&state.jobs.some(j=>owns(j,'connection')||j.building==='stairwell'&&j.kind!=='build'))throw new Error('Legacy save contains stairwell maintenance fields.');
  const linkIds=new Set();
  for (const site of Object.values(state.sites)) {
    if (legacy) {
      if (owns(site, 'levels') || owns(site, 'verticalLinks')) {
        throw new Error('Legacy save contains unsupported deck metadata.');
      }
    } else if(state.version>=55) {
      if(!Array.isArray(site.levels)||!site.levels.length||site.levels.length>MAX_DECKS||site.levels.some((level,i)=>!record(level)||Object.keys(level).length!==2||level.z!==i||typeof level.name!=='string'||!level.name.trim()||level.name.length>80)||site.tiles.length!==site.size**2*site.levels.length)throw new Error('Invalid declared deck layout.');
      if(!settlementSite(site)&&site.levels.length!==1)throw new Error('This site cannot contain constructed decks.');
      validateVerticalLinks(site);
      for(const link of site.verticalLinks){if(linkIds.has(link.id)||Number(link.id.slice(9))>=state.nextId||link.openUntil>state.tick+3)throw new Error('Invalid stairwell identity or hatch time.');linkIds.add(link.id);}
    } else {
      const levels = site.levels;
      if (!Array.isArray(levels) || levels.length !== 1 || !record(levels[0]) ||
          levels[0].z !== 0 || typeof levels[0].name !== 'string' ||
          !levels[0].name.trim() || levels[0].name.length > 80 ||
          !Array.isArray(site.verticalLinks) || site.verticalLinks.length !== 0) {
        throw new Error('Only an unconnected deck zero is supported by this save schema.');
      }
    }
  }
  for (const entity of primaryEntities(state)) {
    if (!record(entity)) throw new Error('Invalid located entity.');
    if (legacy ? owns(entity, 'z') : state.version>=55 ? !Number.isSafeInteger(entity.z)||entity.z<0 : entity.z !== 0) {
      throw new Error(legacy ? 'Legacy save contains an unsupported deck coordinate.' :
        'Located entities must explicitly occupy deck zero.');
    }
  }
  if(state.version>=55){
    for(const site of Object.values(state.sites))for(const t of site.tiles)if(tileAt(site,t)!==t)throw new Error('Invalid tile deck ownership.');
    for(const c of state.crew)if(c.site==='transit'?c.z!==0:!tileAt(state.sites[c.site],c))throw new Error('Invalid crew deck.');
    for(const j of state.jobs)if(!tileAt(state.sites[j.site],j))throw new Error('Invalid job deck.');
    for(const a of state.creatures)if(state.version<58?a.z!==0:!tileAt(state.sites[a.site],a))throw new Error('Animal execution currently requires deck zero.');
    for(const site of Object.values(state.sites))for(const t of site.tiles)if(state.version<60&&t.z!==0&&t.building==='airlockController')throw new Error('Upper airlock execution is not supported by this save schema.');
    if(state.version<60&&state.jobs.some(j=>j.z!==0&&j.kind==='build'&&j.building==='airlockController'))throw new Error('Legacy upper airlock construction.');
  }
}

// Called only after validation of legacy fields. No recursive tuple rewriting:
// nested ownership, route, room and network references remain unchanged.
export function migrateDeckZero(state) {
  for (const site of Object.values(state.sites)) {
    site.levels = [{ z: 0, name: 'Landing deck' }];
    site.verticalLinks = [];
  }
  for (const entity of primaryEntities(state)) entity.z = 0;
}
