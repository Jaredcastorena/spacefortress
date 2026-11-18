import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION} from '../src/data.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {deserialize,serialize,step} from '../src/simulation.js';
import {roomKelvin} from '../src/gas-thermal.js';
import {validateThermal} from '../src/thermal.js';
import {validateWaterVapor} from '../src/water-vapor.js';
import {projectPreWaterVapor} from './helpers/legacy-projection.js';

const bytes=()=>gunzipSync(readFileSync(new URL('./fixtures/water-vapor-schema80.json.gz',import.meta.url))).toString();
const raw=()=>JSON.parse(bytes());
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const counters=['initial','floorEvaporated','floorCondensed','nodeEvaporated','nodeCondensed','vacuumEvaporated','condensateReleased','condensateLost'];
function legacyProjection(s){
 // The shared projection also checks compression: only canonical zero work,
 // vapor and condensate additions may be omitted from the old-format view.
 const old=projectPreWaterVapor(s);old.version=80;return old;
}
// The committed fixture is untouched. This explicit old-format extension
// exercises an owned dry-gas pipe that the authentic initial colony lacks.
function withHistoricalPipe(){
 const s=raw(),site=s.sites.surface,t=site.tiles.find(t=>t.terrain==='floor'&&!t.building&&!t.pipe&&t.liquid===0);
 t.pipe={gas:{oxygen:.21,inert:.79,co2:0},smoke:0,heat:.2*293.15,open:false,hp:100};
 site.gasNetwork.loaded.oxygen+=.21;site.gasNetwork.loaded.inert+=.79;site.thermal.gasLoaded+=t.pipe.heat;
 return s;
}
const pipe=s=>s.sites.surface.tiles.find(t=>t.pipe).pipe;

test('authentic schema80 migration preserves every prior physical field, thermal ledger, RNG and room temperature',()=>{
 const source=bytes(),provenance=JSON.parse(readFileSync(new URL('./fixtures/water-vapor-schema80-provenance.json',import.meta.url)));
 assert.equal(createHash('sha256').update(source).digest('hex'),'7a0c4c3081e044ad17eca536bd77faf611a97f64a95921c0a35fa91e420b1fae');assert.equal(provenance.sha256,createHash('sha256').update(source).digest('hex'));assert.equal(provenance.schema,80);
 const old=JSON.parse(source),loaded=deserialize(source);assert.equal(old.version,80);assert.equal(loaded.version,VERSION);
 assert.ok(isDeepStrictEqual(legacyProjection(loaded),old),'admission only adds explicit zero vapor/compression, empty owners and ledgers');assert.equal(loaded.rng,old.rng);
 let wet=0;
 for(const [id,site] of Object.entries(loaded.sites)){
  assert.deepEqual(Object.keys(site.vapor).sort(),[...counters].sort());assert.ok(Object.values(site.vapor).every(value=>value===0));
  for(const [index,room] of site.rooms.entries()){assert.equal(room.gas.vapor,0);close(roomKelvin(room),roomKelvin(old.sites[id].rooms[index]));}
  for(const t of site.tiles)if(t.liquid>0)wet++;
 }
 assert.ok(wet>0,'the historical save contains finite, thermally owned floor water');validateWaterVapor(loaded);validateThermal(loaded);
 assert.equal(serialize(deserialize(serialize(loaded))),serialize(loaded));
});

test('historical dry-gas nodes gain empty condensate owners without thermal resets or inventory changes',()=>{
 const old=withHistoricalPipe(),s=deserialize(serialize(old));assert.deepEqual(pipe(s).condensate,{water:0,heat:0});assert.equal(pipe(s).gas.vapor,0);
 assert.ok(isDeepStrictEqual(legacyProjection(s),old));close(pipe(s).heat,pipe(old).heat);validateThermal(s);validateWaterVapor(s);
 const copy=deserialize(serialize(s));step(s,5);step(copy,5);assert.equal(serialize(s),serialize(copy),'migrated dry-gas pipe continuation is deterministic');
});

test('schema80 rejects shadow vapor, condensate and vapor ledgers before adding defaults',()=>{
 const corrupt=[s=>s.sites.surface.vapor={},s=>s.sites.surface.rooms[0].gas.vapor=0,s=>pipe(s).gas.vapor=0,s=>pipe(s).condensate={water:0,heat:0},
  ...['injected','vented'].map(key=>s=>s.sites.surface.atmosphere[key].vapor=0),...['loaded','extracted','delivered','vented'].map(key=>s=>s.sites.surface.gasNetwork[key].vapor=0)];
 for(const [index,alter] of corrupt.entries()){const s=withHistoricalPipe();alter(s);assert.throws(()=>deserialize(serialize(s)),`legacy shadow ${index}`);}
});

test('schema80 does not repair forged historical gas custody, water custody or energy',()=>{
 const corrupt=[s=>s.sites.surface.gasNetwork.loaded.oxygen+=1,s=>s.sites.surface.liquids.released+=1,s=>pipe(s).heat+=1,s=>s.sites.surface.rooms[0].heat+=1];
 for(const [index,alter] of corrupt.entries()){const s=withHistoricalPipe();alter(s);assert.throws(()=>deserialize(serialize(s)),`historical corruption ${index}`);}
});

test('current admission rejects malformed vapor species, missing ledgers and impossible latent energy',()=>{
 const initial=deserialize(serialize(withHistoricalPipe()));
 const corrupt=[s=>delete pipe(s).gas.vapor,s=>delete s.sites.surface.rooms[0].gas.vapor,s=>pipe(s).gas.vapor=-1,s=>pipe(s).gas.vapor=NaN,s=>pipe(s).gas.vapor=Infinity,
  s=>s.sites.surface.vapor.extra=0,...counters.map(key=>s=>delete s.sites.surface.vapor[key]),...counters.map(key=>s=>s.sites.surface.vapor[key]=-1),
  s=>{const site=s.sites.surface,node=pipe(s);node.gas.vapor=1;site.gasNetwork.loaded.vapor=1;site.thermal.gasLoaded+=539-node.heat;node.heat=539;},
  s=>{const site=s.sites.surface,room=site.rooms[0],before=room.heat;room.gas.vapor=1;site.atmosphere.injected.vapor=1;room.heat=539;site.thermal.removed+=before-539;},
  s=>{const node=pipe(s);node.gas={oxygen:0,inert:0,co2:0,vapor:0};s.sites.surface.gasNetwork.loaded={...node.gas};}];
 for(const [index,alter] of corrupt.entries()){const s=structuredClone(initial);alter(s);assert.throws(()=>deserialize(serialize(s)),`current vapor corruption ${index}`);}
});

test('current admission rejects ownerless, over-capacity or unbalanced retained condensate',()=>{
 const initial=deserialize(serialize(withHistoricalPipe()));
 const corrupt=[s=>delete pipe(s).condensate,s=>pipe(s).condensate={water:0},s=>pipe(s).condensate={water:0,heat:1},s=>pipe(s).condensate={water:-1,heat:0},
  s=>pipe(s).condensate={water:NaN,heat:0},s=>pipe(s).condensate={water:1,heat:Infinity},s=>pipe(s).condensate.extra=0,
  s=>{const site=s.sites.surface,node=pipe(s);node.condensate={water:10,heat:3000};site.vapor.nodeCondensed=10;site.gasNetwork.loaded.vapor=10;site.thermal.waterLoaded+=3000;},
  s=>{const site=s.sites.surface,node=pipe(s);node.condensate={water:1,heat:300};site.thermal.waterLoaded+=300;},
  s=>s.sites.surface.vapor.nodeCondensed=1,s=>s.sites.surface.vapor.condensateReleased=1,s=>s.sites.surface.vapor.condensateLost=1];
 for(const [index,alter] of corrupt.entries()){const s=structuredClone(initial);alter(s);assert.throws(()=>deserialize(serialize(s)),`current condensate corruption ${index}`);}
});
