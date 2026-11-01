import {withTemperaturePressureReadings,withThermalRoundoff} from './helpers/pressure-migration.js';
import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import { TELEMETRY_VERSION as CURRENT_OBSERVATION_VERSION } from '../src/telemetry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {serialize,deserialize} from '../src/simulation.js';
import {validateAirlockLocations,migrateAirlockLocations} from '../src/airlock-locations.js';
import {airlockRoom,airlockPhysicalPath,airlockRouteInfo,airlockDoorPermit,airlockStatus} from '../src/airlock-access.js';
import {advanceCrewRoute,advanceCrewRoutePositions} from '../src/crew-traversal.js';
import {observe,startRecording,stopRecording,exportRecording} from '../src/telemetry.js';
import {fixture,refs,physicalTick,CONFIG,STAGING} from './helpers/airlock-fixture.js';
import {projectPreAirlockLocations} from './helpers/legacy-projection.js';

// Captured from source5cde617/schema50 after two synthetic subsystem ticks,
// during recovery with a traveler destination. Exact old reload verified first.
const original=gunzipSync(readFileSync(new URL('./fixtures/airlock-locations-schema50.json.gz',import.meta.url))).toString();
const fresh=()=>JSON.parse(original),hash=s=>createHash('sha256').update(s).digest('hex');
const controller=s=>s.sites.surface.tiles.find(t=>t.airlock);
const project=s=>{const old=projectPreAirlockLocations(s);old.version=50;return old;};
const position=([x,y])=>({x,y,z:0});

test('genuine schema50 in-progress migration preserves every unrelated state field',()=>{
  assert.equal(hash(original),'a9ca8219e45e94f0a45a08ab2e736814233457967d9a78b2657f8d6287e3ed19');
  const old=fresh(),s=deserialize(original),a=controller(s).airlock;
  assert.equal(old.version,50);assert.equal(s.version,CURRENT_SAVE_VERSION);assert.equal(a.phase,'recover');
  for(const key of Object.keys(a.config))assert.deepEqual(a.config[key],position(controller(old).airlock.config[key]));
  assert.deepEqual(a.chamberCells,controller(old).airlock.chamberCells.map(k=>`${k},0`));
  assert.ok(a.ownedNodes.every(n=>n.z===0));assert.deepEqual(a.party.destination,position(STAGING.outer));
  const expected=withTemperaturePressureReadings(old);
  assert.deepEqual(withThermalRoundoff(project(s),expected),expected);
  const saved=serialize(s);assert.equal(serialize(deserialize(saved)),saved);
});

// The immutable schema51 fixture captures the same recovery after its location
// conversion. Run both archived inputs under today's finite gas-energy model;
// historical tick hashes also included obsolete heat/pressure behavior.
test('eight physical ticks match the archived location conversion under current gas heat',()=>{
  const converted=gunzipSync(readFileSync(new URL('./fixtures/room-decks-schema51.json.gz',import.meta.url))).toString();
  assert.equal(hash(converted),'ec6da3ae9b4233d5f11ab1ca05af04517f5e62f52a50095637f3e176cbb1fd38');
  assert.equal(JSON.parse(converted).version,51);
  const f=refs(deserialize(original)),control=refs(deserialize(converted));
  assert.equal(serialize(f.s),serialize(control.s),'both archived inputs migrate to the same complete state');
  for(let tick=0;tick<8;tick++){
    physicalTick(f);physicalTick(control);
    assert.equal(serialize(f.s),serialize(control.s),`all gas, power, doors, travelers, heat and RNG at tick ${f.s.tick}`);
  }
});

test('current airlock locations reject ambiguous and unsupported coordinate shapes',()=>{
  const good=deserialize(original),p=controller(good).airlock.config.chamber;
  const targets=[s=>[controller(s).airlock.config,'chamber'],s=>[controller(s).airlock.party,'destination'],s=>[s.crew[0].airlockTraversal,'destination']];
  for(const target of targets)for(const bad of [[p.x,p.y],{x:p.x,y:p.y},{...p,z:1},{...p,z:-1},{...p,z:'0'},{...p,site:'surface'},{...p,x:-1}]){
    const s=structuredClone(good),[owner,key]=target(s);owner[key]=bad;
    assert.throws(()=>deserialize(serialize(s)),/Invalid airlock location/);
  }
  for(const mutate of [a=>delete a.ownedNodes[0].z,a=>a.ownedNodes[0].z=1,a=>a.ownedNodes[0].extra=true,a=>a.chamberCells[0]='7,7',a=>a.chamberCells[0]='7,7,1']){
    const s=structuredClone(good);mutate(controller(s).airlock);assert.throws(()=>deserialize(serialize(s)),/Invalid airlock/);
  }
});

test('legacy inputs cannot conceal new-format airlock references',()=>{
  for(const mutate of [s=>controller(s).airlock.config.inner=position(CONFIG.inner),s=>controller(s).airlock.chamberCells[0]+=',0',s=>controller(s).airlock.ownedNodes[0].z=0,s=>controller(s).airlock.party.destination=position(STAGING.outer),s=>s.crew[0].airlockTraversal.destination=position(STAGING.outer)]){
    const s=fresh();mutate(s);assert.throws(()=>deserialize(serialize(s)),/Invalid legacy airlock/);
  }
  const s=fresh();controller(s).airlock.ownedNodes[0].extra=true;
  assert.throws(()=>deserialize(serialize(s)),/Invalid airlock owned reference/);
});

test('queued, admitted and carried-party destinations migrate without reordering or replacing claims',()=>{
  const s=fresh(),a=controller(s).airlock;
  a.queue=[{crew:s.crew[1].id,destination:[4,5],patient:null,requestTick:1,emergency:true,direction:'outward'},{crew:s.crew[2].id,destination:null,patient:null,requestTick:2,emergency:false,direction:'outward'}];
  a.party.patient=s.crew[3].id;s.crew[3].airlockTraversal={...s.crew[0].airlockTraversal};
  const old=structuredClone(s);validateAirlockLocations(s,{legacy:true});migrateAirlockLocations(s);validateAirlockLocations(s);
  assert.deepEqual(project(s),old);assert.deepEqual(a.queue[0].destination,{x:4,y:5,z:0});assert.equal(a.queue[1].destination,null);
  assert.deepEqual(s.crew[3].airlockTraversal.destination,position(STAGING.outer));
});

test('ground bindings do not claim matching coordinates on another deck',()=>{
  const f=fixture({smoke:0}),route=airlockRouteInfo(f.site,f.controller),upper={...route.inner.door,z:1};
  assert.equal(airlockRoom(f.site,{...f.controller.airlock.config.chamber,z:1}),undefined);
  assert.equal(airlockRouteInfo(f.site,{...f.controller,z:1}),null);
  assert.equal(airlockPhysicalPath(f.site,upper,route.inner.outside),false);
  assert.equal(airlockDoorPermit(f.site,{id:'stranger'}, {...route.inner.outside,z:1},upper),true,'another floor does not touch this door');
  f.crew.z=1;assert.equal(advanceCrewRoutePositions(f.s,f.crew,f.site,[position(STAGING.outer)]).status,'blocked');
});

test('ordinary routes and detached observations expose full airlock positions',()=>{
  const f=fixture({smoke:0});advanceCrewRoute(f.s,f.crew,f.site,[STAGING.outer]);
  assert.deepEqual(f.crew.airlockTraversal.destination,position(STAGING.outer));
  assert.deepEqual(f.controller.airlock.queue[0].destination,position(STAGING.outer));
  const before=serialize(f.s),status=airlockStatus(f.s,f.site,f.controller),observation=observe(f.s);
  assert.deepEqual(status.doors.inner.tile,position(CONFIG.inner));assert.equal(status.route.inner.outside.z,0);
  status.config.inner.x=-1;assert.equal(serialize(f.s),before);
  assert.equal(observation.schemaVersion,CURRENT_OBSERVATION_VERSION);startRecording(f.s);stopRecording(f.s);
  const rows=exportRecording(f.s).trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].schemaVersion,CURRENT_OBSERVATION_VERSION);assert.equal(rows[0].gameVersion,CURRENT_SAVE_VERSION);assert.deepEqual(rows[0].observation,observation);assert.equal(serialize(f.s),before);
});
