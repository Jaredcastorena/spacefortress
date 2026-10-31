import { distance } from './hex.js';
import { planetEnvironment, sectorEnvironment, surfaceLayout } from './world-generation.js';

const owns=(value,key)=>value!=null&&Object.hasOwn(value,key);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const exact=(value,keys)=>record(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>owns(value,key));
const planetKey=id=>typeof id==='string'&&/^[a-z][a-z0-9-]*$/.test(id);
const coordinates=(x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<24&&y>=0&&y<12;
const empty=Object.freeze({}),caches=new WeakMap();
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function context(s,planetId){
  if(!record(s)||!record(s.region)||!Number.isSafeInteger(s.seed)||s.region.seed!==s.seed||!planetKey(planetId)||!record(s.region.planets)||!owns(s.region.planets,planetId))throw new Error('Invalid sector planet.');
  const planet=s.region.planets[planetId];
  if(!record(planet)||planet.id!==planetId||typeof planet.name!=='string'||!record(s.region.sites)||!owns(s.region.sites,planet.home)||!record(s.region.sites[planet.home])||s.region.sites[planet.home].planetId!==planetId)throw new Error('Invalid sector planet.');
  if(!caches.has(s.region))caches.set(s.region,{worlds:new Map(),definitions:new Map(),routes:new Map(),catalogs:new WeakMap()});
  return {planet,cache:caches.get(s.region)};
}

export function sectorSiteId(planetId,x,y){
  if(!planetKey(planetId)||!coordinates(x,y))throw new Error('Invalid sector coordinates or planet identity.');
  return `sector-${planetId}-${x}-${y}`;
}

/** The same environment used by the atlas, including preserved legacy worlds. */
export function sectorWorld(s,planetId){
  const {planet,cache}=context(s,planetId);
  if(planet.world!==undefined){
    const w=planet.world;
    if(!exact(w,['schema','seed','width','height','landing'])||w.schema!==1||!Number.isInteger(w.seed)||w.seed<1||w.seed>0xffffffff||w.width!==24||w.height!==12||!exact(w.landing,['x','y'])||!coordinates(w.landing.x,w.landing.y))throw new Error('Invalid sector world.');
  }
  if(!cache.worlds.has(planetId))cache.worlds.set(planetId,freeze(structuredClone(planet.world??planetEnvironment(s.seed,planetId))));
  return cache.worlds.get(planetId);
}
function checkedEntry(s,entry){
  if(!exact(entry,['planetId','x','y']))throw new Error('Invalid sector registry entry.');
  const id=sectorSiteId(entry.planetId,entry.x,entry.y),world=sectorWorld(s,entry.planetId);
  return {id,world};
}
function landingFor(world,sector){
  let landing=null,nearest=Infinity;
  for(const tile of surfaceLayout(world,sector,48)){
    if(tile.terrain!=='ground'||tile.building||tile.deposit||tile.flora&&Object.keys(tile.flora).length||tile.basin||tile.initialWater||tile.liquid||tile.stock||tile.drop)continue;
    const separation=distance([tile.x,tile.y],[5,10]);
    if(separation<nearest||separation===nearest&&(tile.y<landing.y||tile.y===landing.y&&tile.x<landing.x)){
      landing={x:tile.x,y:tile.y,z:0};nearest=separation;
    }
  }
  if(!landing)throw new Error('Surveyed sector has no empty landing site.');
  return landing;
}

/** Metadata is derived once per region/sector. It never creates physical tiles. */
export function sectorDefinition(s,entry){
  const {id,world}=checkedEntry(s,entry),{planet,cache}=context(s,entry.planetId);
  if(cache.definitions.has(id))return cache.definitions.get(id);
  const sector={x:entry.x,y:entry.y},separation=distance([world.landing.x,world.landing.y],[entry.x,entry.y]);
  const parent=planet.home==='surface'?null:s.region.routes?.[`route-${planet.home}`];
  if(planet.home!=='surface'&&(!record(parent)||parent.from!=='surface'||parent.to!==planet.home||!Number.isSafeInteger(parent.fuel)||parent.fuel<=0||!Number.isSafeInteger(parent.travel)||parent.travel<=0))throw new Error('Invalid parent planetary route.');
  const environment=sectorEnvironment(world,entry.x,entry.y);
  const def=freeze({id,name:`${planet.name} / Sector ${entry.x}, ${entry.y}`,kind:'surface',template:'sector',size:48,planetId:entry.planetId,sector,
    fuel:(parent?.fuel??0)+Math.max(1,Math.ceil(separation/4)),travel:(parent?.travel??0)+12+2*separation,landing:landingFor(world,sector),worldSeed:world.seed,
    label:'SURVEYED SURFACE',sub:'Native terrain, finite resources and a supplied landing',color:environment.color,map:{x:(entry.x+.5)/world.width,y:(entry.y+.5)/world.height}});
  cache.definitions.set(id,def);
  cache.routes.set(id,freeze({id:`route-${id}`,from:'surface',to:id,fuel:def.fuel,travel:def.travel}));
  return def;
}
function registryEntries(s){
  if(!owns(s,'sectorSites'))return [];
  if(!record(s.sectorSites)||Reflect.ownKeys(s.sectorSites).some(id=>typeof id!=='string'))throw new Error('Invalid sector registry.');
  return Reflect.ownKeys(s.sectorSites).sort().map(id=>[id,s.sectorSites[id]]);
}

export function sectorDefinitions(s){
  const entries=registryEntries(s);if(!entries.length)return empty;
  const definitions={};let cache;
  for(const [id,entry] of entries){
    const checked=checkedEntry(s,entry);if(id!==checked.id)throw new Error('Invalid sector registry identity.');
    const current=context(s,entry.planetId);cache=current.cache;
    if(current.planet.home===id||entry.x===checked.world.landing.x&&entry.y===checked.world.landing.y||owns(s.region.sites,id))throw new Error('A sector cannot replace the original planetary landing.');
    definitions[id]=sectorDefinition(s,entry);
  }
  const signature=entries.map(([id])=>id).join('|'),previous=cache.catalogs.get(s.sectorSites);
  if(previous?.signature===signature)return previous.definitions;
  const result=freeze(definitions);cache.catalogs.set(s.sectorSites,{signature,definitions:result});return result;
}

/** Available for planning before registration; shared region routes remain registered-only. */
export function sectorRoute(s,id){
  if(typeof id!=='string')return undefined;
  const destination=id.startsWith('route-')?id.slice(6):id,match=/^sector-(.+)-(\d+)-(\d+)$/.exec(destination);
  if(!match)return undefined;
  const [ ,planetId,xText,yText]=match,x=Number(xText),y=Number(yText);
  if(!planetKey(planetId)||!coordinates(x,y)||sectorSiteId(planetId,x,y)!==destination||!owns(s?.region?.planets,planetId))return undefined;
  sectorDefinition(s,{planetId,x,y});return context(s,planetId).cache.routes.get(destination);
}

export function sectorLanding(s,planetId,x,y){
  const world=sectorWorld(s,planetId),id=sectorSiteId(planetId,x,y);
  if(x===world.landing.x&&y===world.landing.y)return context(s,planetId).planet.home;
  if(!owns(s.sectorSites,id))return null;
  const definitions=sectorDefinitions(s);return owns(definitions,id)?id:null;
}

export function validateSectorSites(s){
  if(!owns(s,'sectorSites'))return;
  if(!Number.isInteger(s.version)||s.version<77)throw new Error('Legacy surveyed-sector registry.');
  const definitions=sectorDefinitions(s);
  for(const [id,def] of Object.entries(definitions)){
    if(!record(s.satellites)||!owns(s.satellites,def.planetId)||!record(s.satellites[def.planetId]))throw new Error('Sector planet has no survey satellite.');
    const site=s.sites?.[id];
    if(!record(site)||site.id!==id||site.kind!==def.kind||site.size!==def.size||typeof site.explored!=='boolean')throw new Error('Invalid surveyed-sector site identity.');
  }
}
