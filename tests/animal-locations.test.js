import {withTemperaturePressureReadings} from './helpers/pressure-migration.js';
import { TELEMETRY_VERSION as CURRENT_OBSERVATION_VERSION } from '../src/telemetry.js';
import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {serialize,deserialize} from '../src/simulation.js';
import {migrateAnimalLocations,validateAnimalLocations} from '../src/animal-locations.js';
import {carcassPosition,releaseCarcass} from '../src/animal-carcasses.js';
import {postReserved,transportRoute} from '../src/animal-transport.js';
import {observe,startRecording,stopRecording,exportRecording} from '../src/telemetry.js';
import {projectPreAnimalLocations} from './helpers/legacy-projection.js';

// Synthetic source625a4fa/schema49, tick0, one assigned post and one physical
// carcass. Old-format exact reload verified before the schema50 edit.
const original=gunzipSync(readFileSync(new URL('./fixtures/animal-locations-schema49.json.gz',import.meta.url))).toString();
const fresh=()=>JSON.parse(original);
const body=s=>s.creatures.find(a=>a.death?.owner);
const assigned=s=>s.creatures.find(a=>a.husbandry?.post);

test('genuine schema49 migration preserves animal health, body yield and every unrelated field',()=>{
  assert.equal(createHash('sha256').update(original).digest('hex'),'5eccd52aeb5fed86929682ba7f8dccc73ecc039525e680f8bc3941ff03392df4');
  const old=fresh(),current=deserialize(original);assert.equal(old.version,49);assert.equal(current.version,CURRENT_SAVE_VERSION);
  const post=assigned(old).husbandry.post;assert.deepEqual(assigned(current).husbandry.post,{x:post[0],y:post[1],z:0});
  assert.deepEqual(body(current).death.owner,{...body(old).death.owner,z:0});
  const projected=projectPreAnimalLocations(current);projected.version=49;assert.deepEqual(projected,withTemperaturePressureReadings(old));
  const saved=serialize(current);assert.equal(serialize(deserialize(saved)),saved);
});

test('only tile carcass owners gain z; crew and job owners retain their ID-only form',()=>{
  for(const owner of [{kind:'tile',site:'surface',x:8,y:9},{kind:'crew',crew:'crew-0'},{kind:'job',job:'job-1'}]){
    const old=fresh();body(old).death.owner=structuredClone(owner);const current=structuredClone(old);
    validateAnimalLocations(current,{legacy:true});migrateAnimalLocations(current);validateAnimalLocations(current);
    assert.deepEqual(body(current).death.owner,owner.kind==='tile'?{...owner,z:0}:owner);
    assert.deepEqual(projectPreAnimalLocations(current),old);
  }
});

test('canonical post and carcass locations reject missing, extra and unsupported coordinates',()=>{
  const good=deserialize(original),post=assigned(good).husbandry.post;
  for(const p of [[post.x,post.y],{x:post.x,y:post.y},{...post,z:1},{...post,z:-1},{...post,z:'0'},{...post,site:'surface'},{...post,x:-1}]){
    const s=structuredClone(good);assigned(s).husbandry.post=p;
    assert.throws(()=>deserialize(serialize(s)),/Invalid animal post location/);
  }
  for(const z of [undefined,null,1,-1,'0']){
    const s=structuredClone(good);if(z===undefined)delete body(s).death.owner.z;else body(s).death.owner.z=z;
    assert.throws(()=>deserialize(serialize(s)),/Invalid carcass location/);
  }
  const s=structuredClone(good);body(s).death.owner.extra=true;
  assert.throws(()=>deserialize(serialize(s)),/Invalid carcass owner/);
});

test('legacy animal positions cannot contain future object or owner-z shadows',()=>{
  for(const mutate of [s=>assigned(s).husbandry.post={x:8,y:9,z:0},s=>body(s).death.owner.z=0]){
    const s=fresh();mutate(s);assert.throws(()=>deserialize(serialize(s)),/Invalid legacy (animal post|carcass) location/);
  }
});

test('interrupted carcasses retain the actual crew or job deck without duplicated ownership',()=>{
  const s=deserialize(original),a=body(s),c=s.crew[0],j={id:'job-location',kind:'animalButcher',animal:a.id,site:'surface',x:9,y:10,z:7,phase:'carry'};
  s.jobs.push(j);a.death.reservedBy=j.id;a.death.owner={kind:'crew',crew:c.id};c.x=8;c.y=9;c.z=4;
  const before={yield:a.death.yield,age:a.death.age};
  assert.deepEqual(carcassPosition(s,a),{site:'surface',x:8,y:9,z:4});
  releaseCarcass(s,j,c);assert.deepEqual(a.death.owner,{kind:'tile',site:'surface',x:8,y:9,z:4});assert.equal(j.phase,'collect');
  a.death.owner={kind:'job',job:j.id};j.phase='process';
  assert.deepEqual(carcassPosition(s,a),{site:'surface',x:9,y:10,z:7});
  releaseCarcass(s,j,c,'cancelled');assert.deepEqual(a.death.owner,{kind:'tile',site:'surface',x:9,y:10,z:7});assert.equal(a.death.reservedBy,null);
  assert.deepEqual({yield:a.death.yield,age:a.death.age},before);
});

test('post reservations and handler routes do not alias a different deck or site',()=>{
  const s=deserialize(original),a=assigned(s),p=a.husbandry.post;
  const j={id:'job-location',kind:'animalLead',animal:a.id,site:'surface',...p,z:4};s.jobs.push(j);
  assert.equal(postReserved(s,p.x,p.y,'other',0),false);assert.equal(postReserved(s,p.x,p.y,'other',4),true);
  a.husbandry.trust=100;j.z=0;const c=s.crew[0];c.x=p.x;c.y=p.y;c.site='wreck';
  assert.equal(transportRoute(s,j,c),null);
});

test('observation4 exposes animal locations without changing simulation state',()=>{
  const s=deserialize(original),before=serialize(s),a=body(s),observation=observe(s);
  assert.equal(observation.schemaVersion,CURRENT_OBSERVATION_VERSION);assert.equal(observation.entities[`carcass:${a.id}`].z,0);
  assert.equal(observation.entities[assigned(s).id].husbandry.post.z,0);
  startRecording(s);stopRecording(s);const rows=exportRecording(s).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].schemaVersion,CURRENT_OBSERVATION_VERSION);assert.equal(rows[0].gameVersion,CURRENT_SAVE_VERSION);assert.deepEqual(rows[0].observation,observation);assert.equal(serialize(s),before);
});
