import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createGame,deserialize,serialize} from '../src/simulation.js';
import {roomKelvin} from '../src/gas-thermal.js';
import {refreshAtmosphere} from '../src/atmosphere.js';
import {validateThermal} from '../src/thermal.js';
import {validateGasWork} from '../src/gas-compression.js';
import {updatePower,refreshPower} from '../src/power.js';
import {availablePowerWork,claimPowerWork} from '../src/power-work.js';

const fixture=name=>gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`,import.meta.url))).toString();
const bytes=()=>fixture('compression-schema81');
const fields=['allocated','work','motorRoom','motorSpace'];
const empty=()=>({allocated:0,work:0,motorRoom:0,motorSpace:0});
const current=()=>deserialize(bytes());

function neutralProjection(s){
  const old=structuredClone(s);old.version=81;
  for(const site of Object.values(old.sites)){
    assert.deepEqual(site.gasWork,empty());assert.equal(site.thermal.compression,0);
    delete site.gasWork;delete site.thermal.compression;
  }
  return old;
}

test('authentic schema81 migration preserves all physical state, prior heat, phase history and RNG',()=>{
  const raw=bytes(),provenance=JSON.parse(readFileSync(new URL('./fixtures/compression-schema81.provenance.json',import.meta.url)));
  const sha=createHash('sha256').update(raw).digest('hex');
  assert.equal(sha,'806069c873c67432876e0dff4ae833b8f4452a27e2ba55a7d5dcb36576bf5b3b');assert.equal(sha,provenance.jsonSha256);
  const old=JSON.parse(raw),s=deserialize(raw);assert.equal(old.version,81);assert.equal(old.tick,2);assert.equal(s.version,82);
  assert.ok(isDeepStrictEqual(neutralProjection(s),old),'only the version and new zero compression fields change');
  assert.equal(s.rng,old.rng);assert.ok(old.sites.surface.vapor.vacuumEvaporated>0,'authentic fixture already has physical phase history');
  for(const [id,site] of Object.entries(s.sites))site.rooms.forEach((room,i)=>assert.equal(roomKelvin(room),roomKelvin(old.sites[id].rooms[i])));
  validateThermal(s);validateGasWork(s);assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});

test('fresh schema82 colonies initialize exact zero compression ledgers on every site',()=>{
  const s=createGame(74264);assert.equal(s.version,82);
  for(const site of Object.values(s.sites)){assert.deepEqual(site.gasWork,empty());assert.equal(site.thermal.compression,0);}
  validateThermal(s);validateGasWork(s);assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});

test('legacy saves reject compression ledger and heat shadows before neutral initialization',()=>{
  for(const name of ['compression-schema81','water-vapor-schema80'])for(const value of [null,0,{},empty()])for(const field of ['gasWork','compression']){
    const s=JSON.parse(fixture(name)),site=s.sites.surface;
    if(field==='gasWork')site.gasWork=value;else site.thermal.compression=value;
    const raw=serialize(s);assert.throws(()=>deserialize(raw),/Legacy save contains gas compression state/);assert.equal(serialize(s),raw);
  }
});

test('schema81 admission validates the historical thermal ledger before adding compression defaults',()=>{
  for(const change of [site=>site.rooms[0].heat+=1,site=>site.thermal.initial+=1,site=>site.thermal.equipment+=1,site=>delete site.thermal.equipment]){
    const s=JSON.parse(bytes());change(s.sites.surface);refreshAtmosphere(s.sites.surface);
    assert.throws(()=>deserialize(serialize(s)),/thermal|heat/i,'new zero fields must not repair a forged old heat balance');
  }
});

test('schema82 rejects missing, malformed and extra compression fields without repairing callers',()=>{
  const baseline=current(),mutations=[
    s=>delete s.sites.surface.gasWork,s=>delete s.sites.surface.thermal.compression,
    ...[null,[],{},0,'empty',{...empty(),extra:0}].map(value=>s=>s.sites.surface.gasWork=value),
    ...fields.map(key=>s=>delete s.sites.surface.gasWork[key]),
    ...fields.flatMap(key=>[-1,null,'0',NaN,Infinity].map(value=>s=>s.sites.surface.gasWork[key]=value)),
    ...[-1,null,'0',NaN,Infinity].map(value=>s=>s.sites.surface.thermal.compression=value),
  ];
  for(const [index,change] of mutations.entries()){
    const s=structuredClone(baseline);change(s);const raw=serialize(s);
    assert.throws(()=>deserialize(raw),/compression|thermal/i,`malformed compression case ${index}`);assert.equal(serialize(s),raw);
  }
});

test('schema82 rejects unbalanced work disposition, useful-work excess and cross-ledger claims',()=>{
  const mutations=[
    site=>{site.gasWork.allocated=1;},
    site=>{site.gasWork={allocated:1,work:.66,motorRoom:0,motorSpace:.34};site.thermal.compression=.66;},
    site=>{const amount=site.energy.consumed+1;site.gasWork={allocated:amount,work:0,motorRoom:0,motorSpace:amount};},
    site=>{site.thermal.compression=1;},
    site=>{const amount=site.thermal.equipment+1;site.gasWork={allocated:amount,work:0,motorRoom:amount,motorSpace:0};},
  ];
  const baseline=current();
  for(const [index,change] of mutations.entries()){
    const s=structuredClone(baseline);change(s.sites.surface);
    assert.throws(()=>validateGasWork(s),/Gas compression energy does not balance/,`cross-ledger case ${index}`);
    assert.throws(()=>deserialize(serialize(s)),`current admission case ${index}`);
  }
});

test('current thermal admission counts retained compression heat exactly once',()=>{
  // Explicit accounting fixture, not a paid-device operation. Existing
  // electrical consumption bounds the synthetic recorded disposition.
  const s=current(),site=s.sites.surface;assert.ok(site.energy.consumed>=2);
  site.gasWork={allocated:2,work:1,motorRoom:0,motorSpace:1};site.thermal.compression=1;site.rooms[0].heat+=1;refreshAtmosphere(site);
  validateThermal(s);validateGasWork(s);const saved=serialize(s);assert.equal(serialize(deserialize(saved)),saved);
  const omitted=structuredClone(s);omitted.sites.surface.thermal.compression=0;assert.throws(()=>validateThermal(omitted),/Stored heat does not balance/);
  const duplicated=structuredClone(s);duplicated.sites.surface.thermal.compression=2;assert.throws(()=>validateThermal(duplicated),/Stored heat does not balance/);
});

test('paid work grants are absent after clone, migration reload and power preview',()=>{
  const s=current(),site=s.sites.surface;updatePower(s,site);
  const index=site.tiles.findIndex(tile=>availablePowerWork(s,site,tile)>0);assert.ok(index>=0,'actual paid power creates a grant');
  const tile=site.tiles[index],allocation=availablePowerWork(s,site,tile),saved=serialize(s),reloaded=deserialize(saved),copy=structuredClone(s);
  assert.equal(serialize(reloaded),saved);assert.ok(allocation>0);
  for(const state of [reloaded,copy]){
    const other=state.sites.surface,target=other.tiles[index];assert.equal(availablePowerWork(state,other,target),0);
    refreshPower(state,other);assert.equal(claimPowerWork(state,other,target),0,'preview never recreates the paid epoch');
  }
  assert.equal(claimPowerWork(s,site,tile),allocation);assert.equal(claimPowerWork(s,site,tile),0);assert.equal(serialize(s),saved,'claiming an ephemeral grant changes no saved field');
});
