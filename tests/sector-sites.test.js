import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRegion, validateRegion, siteDefinitions, siteDefinition, routeDefinition, planetSiteIds, outpostSiteIds } from '../src/region.js';
import { sectorSiteId, sectorWorld, sectorDefinition, sectorDefinitions, sectorRoute, sectorLanding, validateSectorSites } from '../src/sector-sites.js';
import { planetEnvironment, surfaceLayout } from '../src/world-generation.js';
import { distance } from '../src/hex.js';

function state(seed=817,schema=3,legacy=false){
  const region=makeRegion(seed,legacy,schema);
  return {version:77,seed,rng:701,nextId:11,tick:90,region,sites:Object.fromEntries(Object.values(region.sites).map(d=>[d.id,{id:d.id,kind:d.kind,size:d.size}])),satellites:{}};
}
function entry(s,offset=1,planetId=s.region.sites.surface.planetId){
  const world=sectorWorld(s,planetId);
  return {planetId,x:(world.landing.x+offset)%world.width,y:world.landing.y};
}
function register(s,e=entry(s)){
  const def=sectorDefinition(s,e);
  s.sectorSites??={};s.sectorSites[def.id]={...e};
  s.satellites[e.planetId]={launchedAt:0,site:s.region.planets[e.planetId].home,x:5,y:10,z:0};
  s.sites[def.id]={id:def.id,kind:def.kind,size:def.size,tiles:[{terrain:'ground',stock:{ore:2}}],explored:false};
  return def;
}
function immutable(value){
  if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value;
}

test('absent sector registry preserves every old region catalog and physical site unchanged',()=>{
  for(const [schema,legacy] of [[1,true],[1,false],[2,false],[3,false]]){
    const s=state(817,schema,legacy);s.version=76;const before=JSON.stringify(s);
    assert.equal(siteDefinitions(s),s.region.sites);assert.deepEqual(sectorDefinitions(s),{});
    validateSectorSites(s);validateRegion(s);
    for(const planet of Object.values(s.region.planets)){
      const world=sectorWorld(s,planet.id);
      assert.deepEqual(world,planet.world??planetEnvironment(s.seed,planet.id));
      assert.equal(sectorLanding(s,planet.id,world.landing.x,world.landing.y),planet.home);
    }
    assert.equal(Object.hasOwn(s,'sectorSites'),false);assert.equal(JSON.stringify(s),before);
  }
});

test('world, destination and route observations are deterministic, frozen and consume no colony state',()=>{
  for(const seed of [0,-1,Number.MAX_SAFE_INTEGER]){
    const s=state(seed),e=entry(s),before=JSON.stringify(s);immutable(s);
    const world=sectorWorld(s,e.planetId),def=sectorDefinition(s,e),route=sectorRoute(s,def.id);
    assert.equal(sectorWorld(s,e.planetId),world);assert.equal(sectorDefinition(s,{...e}),def);
    assert.equal(sectorRoute(s,`route-${def.id}`),route);assert.equal(routeDefinition(s,def.id),undefined);
    assert.ok(Object.isFrozen(world)&&Object.isFrozen(world.landing)&&Object.isFrozen(def)&&Object.isFrozen(def.landing)&&Object.isFrozen(route));
    assert.throws(()=>{def.landing.x++;},TypeError);
    const loaded=JSON.parse(before);assert.deepEqual(sectorDefinition(loaded,e),def);assert.deepEqual(sectorRoute(loaded,def.id),route);
    assert.equal(sectorLanding(s,e.planetId,e.x,e.y),null);assert.equal(JSON.stringify(s),before);
    assert.equal(Object.hasOwn(s.sites,def.id),false);
  }
});

test('landing is the nearest empty natural ground with deterministic y/x tie ordering',()=>{
  const s=state(74219);
  for(const planetId of Object.keys(s.region.planets))for(const offset of [1,7]){
    const e=entry(s,offset,planetId),world=sectorWorld(s,planetId),def=sectorDefinition(s,e);
    const candidates=surfaceLayout(world,{x:e.x,y:e.y},48).filter(t=>t.terrain==='ground'&&!t.building&&!t.deposit&&!Object.keys(t.flora??{}).length&&!t.basin&&!t.initialWater&&!t.liquid&&!t.stock&&!t.drop);
    candidates.sort((a,b)=>distance([a.x,a.y],[5,10])-distance([b.x,b.y],[5,10])||a.y-b.y||a.x-b.x);
    assert.ok(candidates.length>0);assert.deepEqual(def.landing,{x:candidates[0].x,y:candidates[0].y,z:0});
    assert.equal(def.kind,'surface');assert.equal(def.template,'sector');assert.equal(def.size,48);
    assert.equal(def.worldSeed,world.seed);assert.deepEqual(def.sector,{x:e.x,y:e.y});
  }
});

test('sector routes add finite local travel to each parent planetary route',()=>{
  const s=state(918);
  for(const planet of Object.values(s.region.planets))for(const offset of [1,11]){
    const e=entry(s,offset,planet.id),world=sectorWorld(s,planet.id),def=sectorDefinition(s,e),route=sectorRoute(s,def.id);
    const d=distance([world.landing.x,world.landing.y],[e.x,e.y]),parent=s.region.routes[`route-${planet.home}`];
    assert.deepEqual(route,{id:`route-${def.id}`,from:'surface',to:def.id,fuel:(parent?.fuel??0)+Math.max(1,Math.ceil(d/4)),travel:(parent?.travel??0)+12+2*d});
    assert.equal(def.fuel,route.fuel);assert.equal(def.travel,route.travel);assert.ok(Number.isSafeInteger(route.fuel)&&Number.isSafeInteger(route.travel));
  }
  for(const id of ['surface','sector-unknown-1-2','sector-home-pi-01-2','sector-home-pi-24-2',null,{},'route-'])assert.equal(sectorRoute(s,id),undefined);
});

test('registered sites merge without replacing base metadata and more than four remain valid',()=>{
  const s=state(817),base=JSON.stringify(s.region),baseDefinitions=s.region.sites,first=register(s),a=sectorDefinitions(s);
  assert.equal(sectorDefinitions(s),a);assert.equal(a[first.id],first);
  for(let offset=2;offset<=6;offset++)register(s,entry(s,offset));
  const b=sectorDefinitions(s);assert.notEqual(b,a);assert.equal(Object.keys(b).length,6);assert.equal(Object.keys(a).length,1);
  assert.ok(Object.isFrozen(b));assert.equal(b[first.id],first);validateRegion(s);
  assert.equal(Object.keys(siteDefinitions(s)).length,Object.keys(baseDefinitions).length+6);
  for(const [id,def] of Object.entries(baseDefinitions))assert.equal(siteDefinition(s,id),def);
  for(const def of Object.values(b)){
    assert.equal(siteDefinition(s,def.id),def);assert.equal(routeDefinition(s,def.id),sectorRoute(s,def.id));
    assert.equal(routeDefinition(s,`route-${def.id}`),sectorRoute(s,def.id));
    assert.equal(sectorLanding(s,def.planetId,def.sector.x,def.sector.y),def.id);
    assert.ok(planetSiteIds(s,def.planetId).includes(def.id));assert.ok(outpostSiteIds(s).includes(def.id));
  }
  assert.equal(JSON.stringify(s.region),base);assert.equal(s.region.sites,baseDefinitions);
});

test('registry validation rejects malformed records, coordinates, aliases, original landings and locked planets',()=>{
  const seed=state(817),def=register(seed),e=seed.sectorSites[def.id];
  const cases=[
    s=>{s.sectorSites=null;},s=>{s.sectorSites=[];},s=>{s.sectorSites='bad';},
    s=>{s.sectorSites[def.id]=null;},s=>{s.sectorSites[def.id]={...e,extra:true};},
    s=>{s.sectorSites[def.id].x=-1;},s=>{s.sectorSites[def.id].x=24;},s=>{s.sectorSites[def.id].y=12;},s=>{s.sectorSites[def.id].x=1.5;},
    s=>{s.sectorSites[def.id].planetId='unknown';},s=>{s.sectorSites.alias={...e};},
    s=>{const world=sectorWorld(s,e.planetId);s.sectorSites[sectorSiteId(e.planetId,world.landing.x,world.landing.y)]={planetId:e.planetId,...world.landing};},
    s=>{delete s.satellites[e.planetId];},s=>{s.satellites[e.planetId]=null;},
    s=>{s.sectorSites[Symbol('hidden')]={...e};},
    s=>{Object.defineProperty(s.sectorSites,'hidden',{value:{...e},enumerable:false});},
    s=>{Object.defineProperty(s.sectorSites[def.id],'extra',{value:true,enumerable:false});}
  ];
  for(const mutate of cases){const s=structuredClone(seed);mutate(s);assert.throws(()=>validateSectorSites(s));}
  const empty=state();empty.sectorSites={};assert.doesNotThrow(()=>validateSectorSites(empty));
  for(const version of [40,65,75,76]){empty.version=version;assert.throws(()=>validateSectorSites(empty),/Legacy/);}
});

test('physical sector catalog must match registry exactly and retain immutable base metadata',()=>{
  const original=state(),def=register(original);
  for(const mutate of [s=>{delete s.sites[def.id];},s=>{s.sites[def.id].id='surface';},s=>{s.sites[def.id].kind='wreck';},s=>{s.sites[def.id].size=32;},s=>{s.sites.orphan={id:'orphan',kind:'surface',size:48};},s=>{delete s.sectorSites;},s=>{s.region.sites.surface.size=49;}]){
    const s=structuredClone(original);sectorDefinition(s,s.sectorSites[def.id]);mutate(s);assert.throws(()=>validateRegion(s));
  }
  const restored=JSON.parse(JSON.stringify(original)),tiles=restored.sites[def.id].tiles;
  tiles[0].stock.ore=0;restored.sites[def.id].explored=true;
  const before=JSON.stringify(restored);validateRegion(restored);siteDefinitions(restored);sectorDefinitions(restored);sectorLanding(restored,def.planetId,def.sector.x,def.sector.y);
  assert.equal(restored.sites[def.id].tiles,tiles);assert.equal(JSON.stringify(restored),before);
});

test('invalid planet and world inputs fail without changing state or cached metadata',()=>{
  const s=state(),planetId=s.region.sites.surface.planetId,before=JSON.stringify(s);
  for(const id of ['',null,'surface','__proto__','unknown'])assert.throws(()=>sectorWorld(s,id));
  for(const args of [[planetId,-1,0],[planetId,24,0],[planetId,0,12],[planetId,0.1,0],['bad:planet',0,0]])assert.throws(()=>sectorSiteId(...args));
  for(const mutate of [s=>{s.seed++;},s=>{s.region.planets[planetId].world.width=25;},s=>{s.region.planets[planetId].world.landing.z=0;},s=>{s.region.planets[planetId].world.seed=0;},s=>{s.region.sites.surface=null;}]){
    const bad=structuredClone(s);mutate(bad);assert.throws(()=>sectorWorld(bad,planetId));
  }
  assert.equal(JSON.stringify(s),before);
});
