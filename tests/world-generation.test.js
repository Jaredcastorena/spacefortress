import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {neighbors} from '../src/hex.js';
import {WORLD_BIOMES,planetEnvironment,sectorEnvironment,surfaceLayout,surfaceSurvey,expandedSiteLayout} from '../src/world-generation.js';
import {makeRegion,generatedLayout,validateRegion} from '../src/region.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const state=region=>({seed:region.seed,region,sites:Object.fromEntries(Object.values(region.sites).map(d=>[d.id,{id:d.id,kind:d.kind,size:d.size}]))});
const available=t=>!!t&&!['void','rock'].includes(t.terrain)&&t.building!=='wall';
function reachable(tiles,size,start){
  const seen=new Set([`${start.x},${start.y}`]),queue=[start];
  for(const t of queue)for(const [x,y] of neighbors(t.x,t.y)){
    const key=`${x},${y}`,next=x>=0&&y>=0&&x<size&&y<size?tiles[y*size+x]:null;
    if(available(next)&&!seen.has(key)){seen.add(key);queue.push(next);}
  }
  return seen;
}
const plainTile=(x,y,terrain='ground')=>({x,y,z:0,terrain,building:null,hp:100,drop:null,variant:0,powered:false,cable:null});
function oldCore(size,orbital=false){
  const tiles=Array.from({length:size*size},(_,i)=>plainTile(i%size,Math.floor(i/size),orbital?'void':'ground'));
  if(orbital)for(let y=7;y<=11;y++)for(let x=4;x<=10;x++)tiles[y*size+x].terrain='deck';
  tiles[9*size+8].building=orbital?'dock':'shuttle';
  Object.assign(tiles[9*size+9],{terrain:'floor',building:'stockpile',stock:{ore:3},hp:73});
  tiles[8*size+8].deposit={resource:'ore',remaining:6};
  return tiles;
}

// SHA256 values captured from committed233760b, before introducing schema3.
test('region1/2 metadata and generated18-cell layouts retain their historical bytes',()=>{
  const snapshots=[
    [74219,false,1,'0d46da98dd5b6a76fc2b30620c049a68e1a7bc1aba25b6892a4594022b89a887','33906de4e738cdb6b84dae926dba6426b84dbcd19e5a07aa1776dd4f265a80cf'],
    [74219,false,2,'e148a25065ff45e044ad95881e51b8c9def8a487583367efc753ef93e77b2fea','c3d3106cea45c5b91388ae2e68c86339efedbbe1400188d140a23325843ae2bd'],
    [-17,false,2,'c5fdca692ce149523bd932aba197612610f5967a7e50a4604e9fd27144fa15eb','b5c57ee4a61e7d8aed6e4d977c57d246fe85777405292f9d08f9d1dbcdca09aa'],
    [0,true,1,'e220580677ea97d286dba442945a4a6ad8b6c279ca4324733ad77b4536ae2538','44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'],
  ];
  for(const [seed,legacy,schema,metadata,layout] of snapshots){
    const region=makeRegion(seed,legacy,schema),layouts=Object.fromEntries(Object.values(region.sites).filter(d=>d.template).map(d=>[d.id,generatedLayout(d)]));
    assert.equal(digest(region),metadata);assert.equal(digest(layouts),layout);validateRegion(state(region));
  }
});

test('new regions carry deterministic frozen48/32 layouts and canonical planetary environments',()=>{
  for(const seed of [0,74219,-17,Number.MAX_SAFE_INTEGER,Number.MIN_SAFE_INTEGER]){
    const region=makeRegion(seed);assert.equal(region.schema,3);assert.deepEqual(region,makeRegion(seed));validateRegion(state(region));
    assert.equal(region.sites.surface.size,48);assert.ok(Object.isFrozen(region));
    for(const planet of Object.values(region.planets)){
      assert.deepEqual(planet.world,planetEnvironment(seed,planet.id));assert.ok(Object.isFrozen(planet.world.landing));
      assert.equal(planet.world.width,24);assert.equal(planet.world.height,12);
    }
    for(const def of Object.values(region.sites)){
      assert.equal(def.size,def.id==='surface'?48:32);const world=region.planets[def.planetId].world;
      assert.equal(def.worldSeed,world.seed);assert.deepEqual(def.sector,world.landing);
    }
  }
  assert.notEqual(digest(makeRegion(74219)),digest(makeRegion(74220)));
});

test('canonical world and size mutations are rejected without changing the submitted state',()=>{
  const region=makeRegion(74219),planet=region.sites.surface.planetId;
  for(const edit of [s=>s.region.planets[planet].world.seed++,s=>s.region.sites.surface.size=64,s=>s.region.sites.surface.sector.x++,s=>s.region.sites.surface.worldSeed++,s=>s.sites.wreck.size=18]){
    const changed=structuredClone(state(region));edit(changed);const before=JSON.stringify(changed);
    assert.throws(()=>validateRegion(changed),/Invalid/);assert.equal(JSON.stringify(changed),before);
  }
  assert.throws(()=>makeRegion(74219,true,3),/schema/);
});

test('atlas sectors vary and their surveys count the same actual flora and finite resources as layouts',()=>{
  const world=planetEnvironment(74219,'home'),before=JSON.stringify(world),sectors=new Set();
  for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++)sectors.add(sectorEnvironment(world,x,y).biome);
  assert.equal(sectors.size,5);
  for(const sector of [world.landing,{x:0,y:0},{x:14,y:8}]){
    const tiles=surfaceLayout(world,sector),survey=surfaceSurvey(world,sector),counts={ore:0,ice:0,water:0},plants={lichen:0,fungalcap:0,sunberry:0};
    assert.deepEqual(tiles,surfaceLayout(world,sector));assert.equal(tiles.length,48**2);assert.equal(Object.keys(survey.biomes).length,5);
    for(const [i,t] of tiles.entries()){
      assert.deepEqual([t.x,t.y,t.z],[i%48,Math.floor(i/48),0]);assert.ok(WORLD_BIOMES[t.biome]);
      assert.ok(Number.isInteger(t.temperatureOffset)&&t.temperatureOffset>=-25&&t.temperatureOffset<=25);
      if(t.terrain==='ore')counts.ore+=5;
      if(t.deposit){assert.equal(t.deposit.resource,'ice');assert.ok(t.deposit.remaining>=1&&t.deposit.remaining<=12);counts.ice+=t.deposit.remaining;}
      if(t.initialWater){assert.equal(t.terrain,'ground');assert.equal(t.basin,2);assert.equal(t.initialWater,2);counts.water+=t.initialWater;}
      for(const [species,patch] of Object.entries(t.flora??{})){plants[species]++;assert.equal(patch.origin,'native');assert.equal(patch.generation,'native');assert.ok(patch.biomass>=0&&patch.biomass<=100);}
    }
    assert.deepEqual(survey.resources,counts);assert.deepEqual(survey.flora,plants);
    for(const count of Object.values(counts))assert.ok(count>0);
    for(const count of Object.values(plants))assert.ok(count>0);
    for(const species of ['fungalcap','sunberry']){
      const patches=tiles.flatMap(t=>t.flora?.[species]?[t.flora[species]]:[]);
      assert.ok(patches.some(p=>p.biomass===100),`${species} has an immediately harvestable native patch`);
      assert.ok(patches.some(p=>p.biomass<100),`${species} has native patches that still need to grow`);
    }
    assert.equal(survey.temperature.min,Math.min(...tiles.map(t=>-35+t.temperatureOffset)));
    assert.equal(survey.temperature.max,Math.max(...tiles.map(t=>8+t.temperatureOffset)));
  }
  assert.equal(JSON.stringify(world),before);
});

test('surface expansion preserves the entire existing core and adds reachable species-compatible wildlife',()=>{
  for(const seed of [1,42,74219,99999]){
    const world=planetEnvironment(seed,'home'),original=oldCore(26),before=JSON.stringify(original),def={id:'surface',kind:'surface',size:48,sector:world.landing};
    const expanded=expandedSiteLayout(def,world,original,26),reachableTiles=reachable(expanded.tiles,48,expanded.tiles[9*48+8]);
    assert.deepEqual(expanded,expandedSiteLayout(def,world,original,26));assert.equal(expanded.tiles.length,48**2);
    for(const t of original)assert.deepEqual(expanded.tiles[t.y*48+t.x],t);
    assert.ok(expanded.wildlife.length>=4&&expanded.wildlife.length<=6);assert.ok(5+expanded.wildlife.length<=12);
    assert.equal(new Set(expanded.wildlife.map(a=>a.id)).size,expanded.wildlife.length);
    for(const a of expanded.wildlife){
      assert.ok(a.x>=26||a.y>=26);assert.equal(a.site,'surface');assert.equal(a.z,0);assert.ok(reachableTiles.has(`${a.x},${a.y}`));
      const t=expanded.tiles[a.y*48+a.x];assert.equal(t.terrain,'ground');assert.ok(t.flora[a.species==='bristleback'?'lichen':'fungalcap']);
    }
    for(const t of expanded.tiles.filter(t=>t.x>=26||t.y>=26))assert.ok(reachableTiles.has(`${t.x},${t.y}`));
    expanded.tiles[9*48+9].stock.ore=999;assert.equal(JSON.stringify(original),before);
  }
});

test('all generated32-cell frontiers connect added finite resources to their original dock',()=>{
  for(const seed of [0,7,74219]){
    const current=makeRegion(seed),previous=makeRegion(seed,false,2);
    for(const def of Object.values(current.sites).filter(d=>d.template)){
      const tiles=generatedLayout(def),old=generatedLayout(previous.sites[def.id]),seen=reachable(tiles,32,tiles[11*32+4]);
      assert.equal(tiles.length,32**2);assert.equal(tiles.filter(t=>t.building==='dock').length,1);
      for(const t of old)if(t.terrain!=='void')assert.deepEqual(tiles[t.y*32+t.x],t);
      const resources=tiles.filter(t=>(t.x>=18||t.y>=18)&&(t.terrain==='ore'||t.deposit||t.building==='salvage'));
      assert.ok(resources.length>0);
      for(const t of resources)assert.ok(seen.has(`${t.x},${t.y}`),`${def.id} resource ${t.x}/${t.y}`);
      const total={ore:0,ice:0,components:0,alloy:0};
      for(const t of tiles){if(t.terrain==='ore')total.ore+=5;if(t.deposit?.resource==='ice')total.ice+=t.deposit.remaining;if(t.building==='salvage'){total.components+=3;total.alloy+=2;}}
      assert.deepEqual(def.survey,{label:'Initial survey',...total});
    }
  }
});

test('orbital growth bridges only empty void and preserves every original owned tile',()=>{
  const world=planetEnvironment(74219,'home');
  for(const kind of ['wreck','comet','solar']){
    const original=oldCore(18,true),before=JSON.stringify(original),def={id:kind,kind,size:32,sector:world.landing};
    const result=expandedSiteLayout(def,world,original,18),seen=reachable(result.tiles,32,result.tiles[9*32+8]);let bridges=0;
    assert.deepEqual(result.wildlife,[]);
    for(const old of original){const t=result.tiles[old.y*32+old.x];if(old.terrain!=='void')assert.deepEqual(t,old);else if(t.terrain!=='void'){bridges++;assert.deepEqual({...t,terrain:'void'},old);}}
    assert.ok(bridges>0&&bridges<=10);
    const extension=result.tiles.filter(t=>(t.x>=18||t.y>=18)&&available(t));assert.ok(extension.length>200);
    for(const t of extension)assert.ok(seen.has(`${t.x},${t.y}`));assert.equal(JSON.stringify(original),before);
  }
});

test('generator rejects invalid worlds, coordinates and unbounded allocations',()=>{
  const world=planetEnvironment(1,'home');
  for(const seed of [null,NaN,Infinity,1.5])assert.throws(()=>planetEnvironment(seed,'home'));
  for(const sector of [{x:-1,y:0},{x:24,y:0},{x:0,y:12},{x:0.5,y:0}])assert.throws(()=>surfaceLayout(world,sector));
  for(const size of [0,17,65,Infinity,48.5])assert.throws(()=>surfaceLayout(world,world.landing,size));
  assert.throws(()=>surfaceLayout({...world,seed:0},world.landing));
  assert.throws(()=>expandedSiteLayout({id:'surface',size:48},world,[],26));
});
