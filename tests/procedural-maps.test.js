import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {executeAction,actionCatalog,createAgentInterface} from '../src/controls.js';
import {observe,TELEMETRY_VERSION,tileEntityId} from '../src/telemetry.js';
import {temperatureAt} from '../src/thermal.js';
import {WORLD_BIOMES} from '../src/world-generation.js';

const raw=gunzipSync(readFileSync(new URL('./fixtures/procedural-maps-schema75.json.gz',import.meta.url))).toString();
const sha=text=>createHash('sha256').update(text).digest('hex');
const freshText=serialize(createGame(74255));
const fresh=()=>deserialize(freshText);
const exact=s=>assert.equal(sha(serialize(deserialize(serialize(s)))),sha(serialize(s)),'save roundtrip changed state');
function rejectedEdit(source,edit,message){
  const changed=JSON.parse(source);edit(changed);const text=JSON.stringify(changed);
  assert.throws(()=>deserialize(text),message);assert.equal(JSON.stringify(changed),text,'validation changed its input');
}

test('new colonies install48/32 physical maps, bounded native fauna and accounted natural water',()=>{
  const s=fresh();assert.equal(s.version,VERSION);assert.equal(s.region.schema,3);assert.equal(s.sites.surface.size,48);
  assert.ok(s.creatures.length>5&&s.creatures.length<=12);
  for(const site of Object.values(s.sites)){
    assert.equal(site.size,site.id==='surface'?48:32);assert.equal(site.tiles.length,site.size**2);
    assert.ok(site.tiles.every(t=>!Object.hasOwn(t,'initialWater')));
    const water=site.tiles.reduce((sum,t)=>sum+t.liquid,0),ledger=site.liquids;
    assert.ok(Math.abs(water-((ledger.initial??0)+ledger.released-ledger.recovered-ledger.lost-ledger.quenched-ledger.absorbed))<1e-8);
  }
  const surface=s.sites.surface,biomes=new Set(surface.tiles.map(t=>t.biome).filter(Boolean));
  assert.equal(biomes.size,Object.keys(WORLD_BIOMES).length);assert.ok(surface.liquids.initial>0);
  for(const biome of biomes){
    const t=surface.tiles.find(t=>t.biome===biome&&(t.x>25||t.y>25)&&!t.building);
    assert.ok(t,biome);assert.equal(temperatureAt(surface,t.x,t.y,t.z),surface.thermal.ambient+t.temperatureOffset);
  }
  assert.equal(sha(serialize(createGame(74255))),sha(freshText));exact(s);
});

test('genuine schema75 save changes only version and retains old dimensions, resources and RNG',()=>{
  assert.equal(sha(raw),'f08fb39c5b12a7f138c097158dd4f18e60d31eb8d57bae440ac23fb27bc05341');
  const original=JSON.parse(raw);assert.equal(original.version,75);assert.equal(original.region.schema,2);
  const expected={...original,version:VERSION},s=deserialize(raw);
  assert.equal(sha(serialize(s)),sha(JSON.stringify(expected)),'old physical state was regenerated or changed');
  assert.equal(s.sites.surface.size,26);assert.ok(Object.values(s.sites).filter(t=>t.id!=='surface').every(t=>t.size===18));
  assert.equal(s.rng,original.rng);assert.equal(s.nextId,original.nextId);
  assert.ok(Object.values(s.sites).every(site=>!Object.hasOwn(site.liquids,'initial')&&site.tiles.every(t=>!Object.hasOwn(t,'biome'))));
  assert.equal(s.satellites,undefined);assert.ok(Object.values(s.region.planets).every(p=>p.world===undefined));exact(s);
});

test('legacy saves reject every new environment and satellite shadow before migration',()=>{
  const edits=[
    s=>s.region.schema=3,
    s=>s.satellites={},
    s=>s.jobs.push({kind:'launchSatellite'}),
    s=>s.sites.surface.liquids.initial=0,
    ...[['biome','lichen_plain'],['temperatureOffset',0],['basin',0],['initialWater',0]].map(([key,value])=>s=>s.sites.surface.tiles[0][key]=value),
  ];
  for(const edit of edits)rejectedEdit(raw,edit,/Legacy procedural environment or satellite state/);
});

test('new saves reject invalid biomes, temperatures, natural-water seeds and broken finite ledgers',()=>{
  const target=s=>s.sites.surface.tiles.find(t=>t.biome),water=s=>s.sites.surface.tiles.find(t=>t.liquid>0);
  for(const [key,value] of [['biome','earth_tree'],['biome',null],['temperatureOffset',1.5],['temperatureOffset',26],['temperatureOffset',-26],['basin',-1],['basin',3],['initialWater',0]]){
    rejectedEdit(freshText,s=>target(s)[key]=value,/Invalid (tile biome|local temperature offset|natural basin depth|unseeded natural water)/);
  }
  rejectedEdit(freshText,s=>s.sites.surface.liquids.initial=-1,/Invalid natural water ledger/);
  rejectedEdit(freshText,s=>s.sites.surface.liquids.initial=s.sites.surface.tiles.length*4+1,/Invalid natural water ledger/);
  rejectedEdit(freshText,s=>s.sites.surface.liquids.initial+=1,/Floor water does not balance/);
  rejectedEdit(freshText,s=>delete s.sites.surface.liquids.initial,/Floor water does not balance/);
  rejectedEdit(freshText,s=>water(s).liquid+=.25,/Floor water does not balance/);
});

test('new save dimensions remain canonical instead of accepting arbitrary tile arrays',()=>{
  rejectedEdit(freshText,s=>s.sites.surface.size=26,/Invalid region site identity/);
  rejectedEdit(freshText,s=>s.region.sites.surface.size=64,/Invalid immutable region metadata/);
  rejectedEdit(freshText,s=>s.sites.wreck.tiles.pop(),/Invalid site/);
  rejectedEdit(freshText,s=>s.sites.surface.tiles[48].x=1,/Invalid tile/);
});

test('husbandry actions accept coordinates above25 and enforce each loaded map boundary',()=>{
  const s=fresh(),site=s.sites.surface,animal=s.creatures.find(a=>a.id.startsWith('wild-'));
  const t=site.tiles.find(t=>t.x>25&&t.y>25&&t.terrain==='ground'&&!t.building&&!t.deposit&&!t.basin);
  assert.ok(t);assert.ok(animal);
  // Isolated coordinate/path fixture: a post exists, but no construction or care acceptance is claimed.
  t.building='husbandryPost';
  const result=executeAction(s,'husbandry.assign',{creature:animal.id,x:t.x,y:t.y});
  assert.equal(result.ok,true,result.message);assert.deepEqual(animal.husbandry.post,{x:t.x,y:t.y,z:0});
  const catalog=actionCatalog(s);
  for(const id of ['husbandry.assign','husbandry.butcher','husbandry.transport']){
    const schema=catalog.find(action=>action.id===id).parameters.properties;
    assert.ok(schema.x.maximum>=47&&schema.y.maximum>=47,id);
    const before=sha(serialize(s));
    if(id!=='husbandry.assign'){
      const domain=executeAction(s,id,{creature:animal.id,x:t.x,y:t.y});
      assert.equal(domain.ok,false,'a living untamed animal is not a carcass or ready for transport');
      assert.doesNotMatch(domain.message,/out of range|outside this site/,id);
    }
    const outside=executeAction(s,id,{creature:animal.id,x:48,y:t.y});
    assert.equal(outside.ok,false);assert.equal(outside.message,'Tile is outside this site.');assert.equal(sha(serialize(s)),before);
    const old=deserialize(raw),legacy=executeAction(old,id,{creature:old.creatures[0].id,x:26,y:16});
    assert.equal(legacy.ok,false);assert.equal(legacy.message,'Tile is outside this site.');
  }
});

test('expanded colonies continue identically across save/load without reseeding water or wildlife',()=>{
  const first=fresh(),second=deserialize(serialize(first)),initial=first.sites.surface.liquids.initial,ids=first.creatures.map(a=>a.id);
  step(first,3);step(second,3);
  assert.equal(sha(serialize(first)),sha(serialize(second)));assert.equal(first.sites.surface.liquids.initial,initial);
  assert.deepEqual(first.creatures.map(a=>a.id),ids);assert.ok(first.sites.surface.tiles.every(t=>!Object.hasOwn(t,'initialWater')));exact(first);
});

test('large-map observations and action definitions remain detached, deterministic and read-only',()=>{
  const s=fresh(),before=sha(serialize(s)),rng=s.rng,nextId=s.nextId,api=createAgentInterface(()=>s);
  const observation=observe(s),again=api.observe(),tile=s.sites.surface.tiles.find(t=>t.biome&&t.basin),id=tileEntityId('surface',tile.x,tile.y,0);
  assert.equal(observation.schemaVersion,TELEMETRY_VERSION);assert.equal(sha(JSON.stringify(observation)),sha(JSON.stringify(again)));
  assert.equal(observation.entities[id].biome,tile.biome);assert.equal(observation.entities[id].liquid,tile.liquid);
  assert.equal(Object.values(observation.entities).filter(e=>e.type==='tile').length,Object.values(s.sites).reduce((n,site)=>n+site.tiles.length,0));
  observation.entities[id].biome='detached';observation.entities[id].liquid=0;
  const definitions=api.definitions();assert.deepEqual(definitions.worldBiomes,WORLD_BIOMES);definitions.worldBiomes.lichen_plain.name='detached';assert.notEqual(WORLD_BIOMES.lichen_plain.name,'detached');
  actionCatalog(s);assert.equal(sha(serialize(s)),before);assert.equal(s.rng,rng);assert.equal(s.nextId,nextId);
});
