import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {deserialize} from '../src/simulation.js';
import {projectPreWaterVapor,projectPreWaterHeat,projectPreGasHeat,projectPreRegion,projectPreAirlock} from './helpers/legacy-projection.js';

const counters=['initial','floorEvaporated','floorCondensed','nodeEvaporated','nodeCondensed','vacuumEvaporated','condensateReleased','condensateLost'];
const gas=()=>({oxygen:2,inert:7,co2:1,vapor:0});
const node=()=>({gas:gas(),heat:586.3,smoke:0,open:true,condensate:{water:0,heat:0}});
function fixture(){
  return {version:81,sites:{surface:{
    rooms:[{gas:gas(),heat:10000,pressure:100}],
    tiles:[{pipe:node(),liquid:2,liquidHeat:800},{gasStore:node()}],
    atmosphere:{injected:gas(),vented:gas()},
    gasNetwork:Object.fromEntries(['loaded','extracted','delivered','vented'].map(key=>[key,gas()])),
    vapor:Object.fromEntries(counters.map(key=>[key,0])),
    liquids:{initial:2,released:3},thermal:{initial:10000,gasInitial:586.3,waterInitial:800},
  }}};
}
const slots=s=>{
  const site=s.sites.surface;
  return [site.rooms[0].gas,site.tiles[0].pipe.gas,site.tiles[1].gasStore.gas,site.atmosphere.injected,site.atmosphere.vented,...['loaded','extracted','delivered','vented'].map(key=>site.gasNetwork[key])];
};

test('neutral vapor projection removes only empty schema81 additions without mutating its caller',()=>{
  const s=fixture(),before=structuredClone(s),expected=structuredClone(s),site=expected.sites.surface;
  for(const gases of slots(expected))delete gases.vapor;
  delete site.vapor;delete site.tiles[0].pipe.condensate;delete site.tiles[1].gasStore.condensate;
  assert.deepEqual(projectPreWaterVapor(s),expected);assert.deepEqual(s,before);
  assert.deepEqual(projectPreWaterVapor(expected),expected,'already historical shapes are unchanged');
});

test('vapor projection preserves the authentic schema80 fixture exactly after admission',()=>{
  const bytes=gunzipSync(readFileSync(new URL('./fixtures/water-vapor-schema80.json.gz',import.meta.url))).toString();
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'7a0c4c3081e044ad17eca536bd77faf611a97f64a95921c0a35fa91e420b1fae');
  const expected=JSON.parse(bytes),s=deserialize(bytes),projected=projectPreWaterVapor(s);projected.version=80;
  assert.ok(isDeepStrictEqual(projected,expected),'all historical physical quantities, heat, ledgers and RNG remain exact');
});

test('vapor projection rejects every retained or boundary vapor slot, including malformed zero substitutes',()=>{
  for(let index=0;index<slots(fixture()).length;index++)for(const value of [.001,-1,NaN,Infinity,null,undefined,'0']){
    const s=fixture();slots(s)[index].vapor=value;const before=structuredClone(s);
    assert.throws(()=>projectPreWaterVapor(s),/water vapor/,`gas slot ${index}: ${value}`);assert.deepEqual(s,before);
  }
});

test('vapor projection rejects nonzero phase history even when no vapor or condensate remains',()=>{
  for(const key of counters){const s=fixture();s.sites.surface.vapor[key]=.001;assert.throws(()=>projectPreWaterVapor(s),/water vapor history/,key);}
  const s=fixture();s.sites.surface.vapor.floorEvaporated=1;s.sites.surface.vapor.floorCondensed=1;
  assert.throws(()=>projectPreWaterVapor(s),/water vapor history/,'net-zero phase history is still physical work');
});

test('vapor projection rejects malformed ledgers instead of hiding their admission errors',()=>{
  for(const ledger of [null,[],{},Object.fromEntries(counters.map(key=>[key,'0'])),{...fixture().sites.surface.vapor,extra:0}]){
    const s=fixture();s.sites.surface.vapor=ledger;assert.throws(()=>projectPreWaterVapor(s),/water vapor history/);
  }
});

test('vapor projection rejects retained condensate, stored energy and malformed owner records',()=>{
  for(const slot of ['pipe','gasStore'])for(const value of [{water:1,heat:0},{water:0,heat:1},{water:0,heat:-1},{water:-1,heat:0},{water:0,heat:NaN},{water:0,heat:0,extra:0},{water:0},{water:'0',heat:0},null,[]]){
    const s=fixture(),tile=s.sites.surface.tiles.find(tile=>tile[slot]);tile[slot].condensate=value;
    assert.throws(()=>projectPreWaterVapor(s),/condensate/);
  }
});

test('older projections apply the same vapor guard before dropping their historical fields',()=>{
  for(const project of [projectPreWaterHeat,projectPreGasHeat,projectPreRegion,projectPreAirlock]){
    const s=fixture();s.sites.surface.tiles[0].pipe.condensate={water:1,heat:800};
    assert.throws(()=>project(s),/condensate/,project.name);
  }
});
