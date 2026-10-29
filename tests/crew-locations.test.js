import { TELEMETRY_VERSION as CURRENT_OBSERVATION_VERSION } from '../src/telemetry.js';
import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { serialize, deserialize } from '../src/simulation.js';
import { CARE_INTENTS, migrateCrewLocations, validateCrewLocations } from '../src/crew-locations.js';
import { bunkOwner, housingObstruction } from '../src/housing.js';
import { treatmentPatient } from '../src/medicine.js';
import { atCot } from '../src/nursing.js';
import { observe, startRecording, stopRecording, exportRecording } from '../src/telemetry.js';
import { projectPreCrewLocations } from './helpers/legacy-projection.js';

// Synthetic source3e8124b/schema48, tick0, home assignment and injured
// patient with a reserved cot. Exact old-format reload verified before edits.
const original=gunzipSync(readFileSync(new URL('./fixtures/crew-locations-schema48.json.gz',import.meta.url))).toString();
const fresh=()=>JSON.parse(original);

test('genuine schema48 migration preserves every field outside named crew and animal locations',()=>{
  assert.equal(createHash('sha256').update(original).digest('hex'),'d91ff6fdfde5567e7a1f0819961021576936aba8a8251b62c62a8b71a954e249');
  const old=fresh(), current=deserialize(original);assert.equal(old.version,48);assert.equal(current.version,CURRENT_SAVE_VERSION);
  assert.deepEqual(current.crew[0].housing.bunk,{x:10,y:7,z:0});
  assert.deepEqual(current.crew[1].medical.bed,{x:9,y:7,z:0});
  assert.deepEqual(current.crew[1].intent.target,current.crew[1].medical.bed);
  const projected=projectPreCrewLocations(current);projected.version=48;
  assert.deepEqual(projected,old,'includes health, injury, food, RNG, timing and job ownership');
  const saved=serialize(current);assert.equal(serialize(deserialize(saved)),saved);
});

test('migration covers named care and keepsake references without rewriting other locations',()=>{
  for(const type of CARE_INTENTS.filter(type=>type!=='equipTool')){
    const old=fresh();old.crew[2].intent={type,target:[11,8]};
    old.crew[3].intent={type:'leisure',target:null,keepsake:{id:'item-1',source:'stock',target:[8,10]}};
    old.crew[4].delivery={kind:'stock',target:{x:8,y:10,z:0}};
    old.crew[5].intent={type:'haul',target:{x:8,y:10,z:0},destination:{kind:'stock',target:{x:9,y:10,z:0}}};
    const current=structuredClone(old);validateCrewLocations(current,{legacy:true});migrateCrewLocations(current);validateCrewLocations(current);
    assert.deepEqual(current.crew[2].intent.target,{x:11,y:8,z:0});
    assert.deepEqual(current.crew[3].intent.keepsake.target,{x:8,y:10,z:0});
    assert.deepEqual(projectPreCrewLocations(current),old);
  }
});

test('canonical crew fields reject pair, missing, extra and unsupported positions',()=>{
  const good=deserialize(original);
  for(const mutate of [
    (s,p)=>s.crew[0].housing.bunk=p, (s,p)=>s.crew[1].medical.bed=p,
    (s,p)=>s.crew[0].intent.target=p,
    (s,p)=>s.crew[2].intent={type:'leisure',target:null,keepsake:{id:'item-1',source:'stock',target:p}},
  ])for(const p of [[10,7],{x:10,y:7},{x:10,y:7,z:1},{x:10,y:7,z:-1},{x:10,y:7,z:'0'},{x:10,y:7,z:0,site:'surface'},{x:-1,y:7,z:0}]){
    const s=structuredClone(good);mutate(s,p);
    assert.throws(()=>deserialize(serialize(s)),/Invalid crew location/);
  }
});

test('legacy crew location shadows are rejected before migration',()=>{
  for(const mutate of [
    s=>s.crew[0].housing.bunk={x:10,y:7,z:0},
    s=>s.crew[1].medical.bed={x:9,y:7,z:0},
    ...CARE_INTENTS.map(type=>s=>s.crew[2].intent={type,target:{x:11,y:8,z:0}}),
    s=>s.crew[2].intent={type:'leisure',target:null,keepsake:{id:'item-1',source:'stock',target:{x:8,y:10,z:0}}},
  ]){const s=fresh();mutate(s);assert.throws(()=>deserialize(serialize(s)),/Invalid legacy crew location/);}
});

test('home claims remain surface-owned while away and distinguish deck coordinates',()=>{
  const s=deserialize(original), owner=s.crew[0];owner.site='wreck';owner.intent=null;
  validateCrewLocations(s);
  assert.equal(bunkOwner(s,'surface',10,7,0),owner);
  assert.equal(bunkOwner(s,'wreck',10,7,0),null);
  assert.equal(bunkOwner(s,'surface',10,7,4),undefined);
  assert.equal(housingObstruction(s,owner),'Home reserved while away');
  const patient=s.crew[1];patient.x=9;patient.y=7;
  assert.equal(atCot(s,patient),true);patient.z=4;assert.equal(atCot(s,patient),false);
  assert.equal(treatmentPatient(s,{site:'surface',x:9,y:7,z:4,patient:patient.id}),null);
});

test('current observation exposes care objects without changing health, RNG or state',()=>{
  const s=deserialize(original), before=serialize(s), observation=observe(s);
  assert.equal(observation.schemaVersion,CURRENT_OBSERVATION_VERSION);
  assert.deepEqual(observation.entities[s.crew[1].id].medical.bed,{x:9,y:7,z:0});
  startRecording(s);stopRecording(s);
  const records=exportRecording(s).trim().split('\n').map(JSON.parse);
  assert.equal(records[0].schemaVersion,CURRENT_OBSERVATION_VERSION);assert.equal(records[0].gameVersion,CURRENT_SAVE_VERSION);
  assert.deepEqual(records[0].observation,observation);assert.equal(serialize(s),before);
});
