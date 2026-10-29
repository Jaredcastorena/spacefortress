import { SITES } from './data.js';
import { distance } from './hex.js';

const CLASSIC_IDS = Object.keys(SITES);
const SIZE = 18;
const DOCK = { x: 4, y: 11 };
const owns = (value, key) => value != null && Object.hasOwn(value, key);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validSeed = seed => Number.isSafeInteger(seed);

// All region randomness is local. Surveying or validating a region must never
// advance the colony RNG or allocate a crew, job, item or shipment identity.
function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0) || 1;
}
function generator(seed) {
  let value = seed >>> 0;
  return limit => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) % limit;
  };
}
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function sameMetadata(actual, expected) {
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (!record(actual)) return false;
  const keys = Reflect.ownKeys(actual), expectedKeys = Object.keys(expected);
  return keys.length === expectedKeys.length && expectedKeys.every(key => owns(actual, key) && sameMetadata(actual[key], expected[key]));
}
function exactKeys(actual, expected) {
  return record(actual) && Reflect.ownKeys(actual).length === expected.length && expected.every(key => owns(actual, key));
}

/** Full landing grid of partial tiles; callers add ordinary mutable tile state. */
export function generatedLayout(def) {
  if (!record(def) || def.size !== SIZE || def.kind !== 'wreck' || !['outcrop', 'derelict'].includes(def.template) || !Number.isInteger(def.layoutSeed) || def.layoutSeed < 1 || def.layoutSeed > 0xffffffff) throw new Error('Invalid generated site layout.');
  const next = generator(def.layoutSeed);
  const center = [10 + next(3), 7 + next(4)], radius = 3 + next(2);
  const tiles = Array.from({ length: SIZE * SIZE }, (_, i) => {
    const x = i % SIZE, y = Math.floor(i / SIZE);
    const land = distance([x, y], [6, 10]) <= 3 || distance([x, y], center) <= radius;
    return { x, y, z: 0, terrain: land ? (def.template === 'outcrop' ? 'ground' : 'deck') : 'void', building: null, variant: next(4) };
  });
  const dock = tiles[DOCK.y * SIZE + DOCK.x];
  dock.building = 'dock';
  const candidates = tiles.filter(tile => tile.terrain !== 'void' && distance([tile.x, tile.y], [DOCK.x, DOCK.y]) > 1);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = next(i + 1); [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  if (def.template === 'outcrop') {
    const oreCount = 8 + next(8), iceCount = 4 + next(5);
    for (const tile of candidates.splice(0, oreCount)) tile.terrain = 'ore';
    for (const tile of candidates.splice(0, iceCount)) tile.deposit = { resource: 'ice', remaining: 6 + next(7) };
  } else {
    for (const tile of candidates.slice(0, 7 + next(8))) tile.building = 'salvage';
  }
  return tiles;
}
function initialSurvey(def) {
  const survey = { label: 'Initial survey', ore: 0, ice: 0, components: 0, alloy: 0 };
  for (const tile of generatedLayout(def)) {
    if (tile.terrain === 'ore') survey.ore += 5;
    if (tile.deposit?.resource === 'ice') survey.ice += tile.deposit.remaining;
    if (tile.building === 'salvage') { survey.components += 3; survey.alloy += 2; }
  }
  return survey;
}

/** Seeded, immutable catalog. Physical site state always lives in s.sites. */
function makeRegionV1(seed, legacy = false) {
  if (!validSeed(seed) || typeof legacy !== 'boolean') throw new Error('Invalid region seed or mode.');
  seed = seed === 0 ? 0 : seed;
  const token = `${seed < 0 ? 'n' : 'p'}${Math.abs(seed).toString(36)}`;
  const planetId = `home-${token}`;
  const planets = { [planetId]: { id: planetId, name: SITES.surface.name, home: 'surface' } };
  const positions = { surface: [.15, .7], wreck: [.4, .3], comet: [.72, .2], solar: [.87, .65] };
  const sites = {};
  for (const id of CLASSIC_IDS) {
    const [x, y] = positions[id];
    sites[id] = { id, kind: id, ...SITES[id], planetId, map: { x, y }, size: id === 'surface' ? 26 : SIZE };
    if (id === 'wreck') sites[id].debris = { period: 65, damage: 4 };
  }
  if (!legacy) for (const template of ['outcrop', 'derelict']) {
    const next = generator(hash(`${seed}:${template}:metadata`));
    const id = `${template}-${token}`, outcrop = template === 'outcrop';
    const def = sites[id] = {
      id, kind: 'wreck', name: `${outcrop ? 'Cinder Outcrop' : 'Drift Array'} ${token.toUpperCase()}`,
      label: outcrop ? '05 / RESOURCE OUTCROP' : '06 / DERELICT',
      sub: outcrop ? 'Finite ore and ice seams · exposed ground' : 'Finite components and alloy · exposed deck',
      color: outcrop ? '#c6a078' : '#a7b4d3', planetId,
      map: { x: (outcrop ? 48 : 70) / 100 + next(9) / 100, y: (outcrop ? 70 : 43) / 100 + next(8) / 100 },
      size: SIZE, fuel: (outcrop ? 3 : 5) + next(2), travel: (outcrop ? 26 : 36) + next(9),
      debris: { period: (outcrop ? 85 : 48) + next(16), damage: outcrop ? 2 : 5 },
      template, layoutSeed: hash(`${seed}:${template}:layout`),
    };
    def.survey = initialSurvey(def);
  }
  const routes = {};
  for (const def of Object.values(sites)) if (def.id !== 'surface') {
    const id = `route-${def.id}`;
    routes[id] = { id, from: 'surface', to: def.id, fuel: def.fuel, travel: def.travel };
  }
  return freeze({ schema: 1, seed, legacy, planets, sites, routes });
}

// Schema1 is an immutable compatibility boundary. New worlds use a wider
// catalog; loading an existing colony never creates those additional sites.
export function makeRegion(seed, legacy = false, schema = legacy ? 1 : 2) {
  if (![1,2].includes(schema) || schema===2 && legacy) throw new Error('Unsupported planetary region schema.');
  const original=makeRegionV1(seed,legacy);
  if(schema===1)return original;
  const token=`${seed<0?'n':'p'}${Math.abs(seed).toString(36)}`,homeId=`home-${token}`;
  const home={...original.planets[homeId],map:{x:.22,y:.59},color:'#b6b897',label:'HOME PLANET'};
  const planets={[homeId]:home},sites={};
  for(const id of CLASSIC_IDS)sites[id]=original.sites[id];
  for(const [index,letter] of ['a','b'].entries()){
    const next=generator(hash(`${seed}:planet:${letter}`)),names=index?['Vesper','Oriel','Thalos','Nacre']:['Ilex','Cinder','Orison','Aster'];
    const planetId=`planet-${letter}-${token}`,suffix=index?'-b':'';
    const planet=planets[planetId]={id:planetId,name:`${names[next(names.length)]} ${token.toUpperCase()}`,home:`outcrop-${token}${suffix}`,map:index?{x:.79,y:.63}:{x:.55,y:.3},color:index?'#a9b9d1':'#c5a17b',label:index?'OUTER FRONTIER':'INNER FRONTIER'};
    for(const template of ['outcrop','derelict']){
      const outcrop=template==='outcrop',id=`${template}-${token}${suffix}`,originalDef=original.sites[`${template}-${token}`];
      const def=sites[id]={...originalDef,id,planetId,name:`${planet.name} / ${outcrop?'Landing':'Drift Array'}`,label:`${index*2+(outcrop?5:6)} / ${outcrop?'RESOURCE LANDING':'ORBITAL DERELICT'}`,
        sub:outcrop?'Finite ore and ice · exposed landing':'Finite components and alloy · exposed orbital deck',
        color:planet.color,map:outcrop?{x:.43,y:.61}:{x:.76,y:.31},
        fuel:(index?6:4)+next(2)+(index||outcrop?0:1),travel:(index?38:27)+next(8)+(outcrop?0:5),
        debris:{period:(index?55:85)+next(16)-(outcrop?0:15),damage:index?(outcrop?3:6):(outcrop?2:4)},
        layoutSeed:hash(`${seed}:planet:${letter}:${template}:layout`)};
      def.survey=initialSurvey(def);
    }
  }
  const routes={};
  for(const def of Object.values(sites))if(def.id!=='surface'){
    const id=`route-${def.id}`;routes[id]={id,from:'surface',to:def.id,fuel:def.fuel,travel:def.travel};
  }
  return freeze({schema:2,seed:original.seed,legacy:false,planets,sites,routes});
}
export function planetDefinitions(s){
  if(owns(s,'region'))return s.region.planets;
  return {home:{id:'home',name:SITES.surface.name,home:'surface'}};
}
export function planetSiteIds(s,planetId){
  const planets=planetDefinitions(s);if(!owns(planets,planetId))return [];
  return Object.entries(siteDefinitions(s)).filter(([,def])=>s.region?def.planetId===planetId:true).map(([id])=>id);
}

export function siteDefinitions(s) {
  return owns(s, 'region') ? s.region?.sites : SITES;
}
export function siteDefinition(s, id) {
  const definitions = siteDefinitions(s);
  return owns(definitions, id) ? definitions[id] : undefined;
}
export function siteKind(site) {
  return owns(site, 'kind') ? site.kind : owns(SITES, site?.id) ? site.id : undefined;
}
export function settlementSite(site) {
  return ['surface', 'wreck'].includes(siteKind(site));
}
export function outpostSiteIds(s) {
  return Object.values(s?.sites ?? {}).filter(site => site.id !== 'surface' && settlementSite(site)).map(site => site.id);
}
export function routeDefinition(s, id) {
  if (owns(s, 'region')) {
    const routes = s.region?.routes;
    if (owns(routes, id)) return routes[id];
    return owns(routes, `route-${id}`) ? routes[`route-${id}`] : undefined;
  }
  const destination = typeof id === 'string' && id.startsWith('route-') ? id.slice(6) : id;
  const def = siteDefinition(s, destination);
  return def?.fuel ? { id: `route-${destination}`, from: 'surface', to: destination, fuel: def.fuel, travel: def.travel } : undefined;
}

/** Validate canonical metadata only; depletion, exploration and buildings vary. */
export function validateRegion(s) {
  if (!record(s) || !validSeed(s.seed) || !record(s.region) || typeof s.region.legacy !== 'boolean') throw new Error('Invalid region.');
  const expected = makeRegion(s.seed, s.region.legacy, s.region.schema);
  if (!sameMetadata(s.region, expected)) throw new Error('Invalid immutable region metadata.');
  if (!exactKeys(s.sites, Object.keys(expected.sites))) throw new Error('Invalid region site catalog.');
  for (const [id, def] of Object.entries(expected.sites)) {
    const site = s.sites[id];
    if (!record(site) || site.id !== id || !owns(site, 'kind') || site.kind !== def.kind || site.size !== def.size) throw new Error('Invalid region site identity.');
  }
}

/** Admit old catalogs without generating any new physical state or discovery. */
export function migrateRegion(s) {
  if (!record(s) || !Number.isInteger(s.version) || s.version < 40 || s.version >= 65 || !validSeed(s.seed) || owns(s, 'region') || !exactKeys(s.sites, CLASSIC_IDS)) throw new Error('Invalid legacy region.');
  for (const id of CLASSIC_IDS) {
    const site = s.sites[id];
    if (!record(site) || site.id !== id || site.size !== (id === 'surface' ? 26 : SIZE) || owns(site, 'kind')) throw new Error('Invalid legacy site identity.');
  }
  const region = makeRegion(s.seed, true, 1);
  for (const id of CLASSIC_IDS) s.sites[id].kind = id;
  s.region = region;
}
