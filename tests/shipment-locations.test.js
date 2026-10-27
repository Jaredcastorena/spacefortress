import { TELEMETRY_VERSION as CURRENT_OBSERVATION_VERSION } from '../src/telemetry.js';
import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { serialize, deserialize } from '../src/simulation.js';
import { migrateShipmentLocations, validateShipmentLocations } from '../src/shipment-locations.js';
import { observe, startRecording, stopRecording, exportRecording } from '../src/telemetry.js';
import { exposedWaste } from '../src/sanitation.js';
import { projectPreShipments } from './helpers/legacy-projection.js';

// Captured under source6e85514: synthetic seed74219/tick8, paid construction
// reservation and a carried input shipment. Never a player colony.
const original = gunzipSync(readFileSync(new URL('./fixtures/shipments-schema47-owned.json.gz', import.meta.url))).toString();
const fresh = () => JSON.parse(original);
const carrier = s => s.crew.find(c => c.delivery);

test('genuine schema47 migration preserves complete state outside named shipment, crew and animal fields', () => {
  assert.equal(createHash('sha256').update(original).digest('hex'), '0e0092ad9e70c07a702ddf029ec9e5de1f69de297d18e69d0127c8c7b8624775');
  const old = fresh(), current = deserialize(original);
  assert.equal(old.version, 47); assert.equal(current.version, CURRENT_SAVE_VERSION);
  assert.ok(old.jobs.some(j => j.sources.length)); assert.ok(carrier(old));
  assert.ok(current.jobs.every(j => j.sources.every(source => source.z === 0)));
  assert.deepEqual(carrier(current).delivery.target, {x:carrier(old).delivery.target[0], y:carrier(old).delivery.target[1], z:0});
  const projected = projectPreShipments(current); projected.version = 47;
  assert.deepEqual(projected, old, 'includes every resource owner, metadata, RNG and tick');
  const saved = serialize(current); assert.equal(serialize(deserialize(saved)), saved);
});

test('named pickup, destination and delivery migration leaves unrelated references untouched', () => {
  const old = fresh();
  old.crew[0].intent = {type:'haul', target:[8,10], source:'stock', items:{ore:1}, destination:{kind:'stock',target:[9,10]}};
  old.crew[1].intent = {type:'salvage', target:[7,9], items:{alloy:1}};
  old.crew[2].intent = {type:'leisure', target:[6,8], keepsake:{source:'stock',target:[8,10]}};
  const migrated = structuredClone(old);
  validateShipmentLocations(migrated, {legacy:true}); migrateShipmentLocations(migrated);
  validateShipmentLocations(migrated);
  assert.deepEqual(migrated.crew[0].intent.target, {x:8,y:10,z:0});
  assert.deepEqual(migrated.crew[0].intent.destination.target, {x:9,y:10,z:0});
  assert.deepEqual(migrated.crew[1].intent.target, {x:7,y:9,z:0});
  assert.deepEqual(migrated.crew[2].intent, old.crew[2].intent);
  assert.deepEqual(projectPreShipments(migrated), old);
});

test('canonical save rejects pair, missing, extra and unsupported shipment coordinates', () => {
  const good = deserialize(original), p = carrier(good).delivery.target;
  for (const target of [[p.x,p.y], {x:p.x,y:p.y}, {...p,z:1}, {...p,z:-1}, {...p,z:'0'}, {...p,site:'surface'}, {...p,x:-1}, null]) {
    const s = structuredClone(good); carrier(s).delivery.target = target;
    assert.throws(() => deserialize(serialize(s)), /Invalid shipment location/);
  }
  for (const z of [undefined, null, 1, -1, '0']) {
    const s = structuredClone(good), source = s.jobs.find(j => j.sources.length).sources[0];
    if (z === undefined) delete source.z; else source.z = z;
    assert.throws(() => deserialize(serialize(s)), /Invalid material location/);
  }
  for (const type of ['haul','salvage']) {
    const s = structuredClone(good); s.crew[0].intent = {type,target:[8,10]};
    assert.throws(() => deserialize(serialize(s)), /Invalid shipment location/);
  }
  const s = structuredClone(good);
  s.crew[0].intent = {type:'haul',target:{x:8,y:10,z:0},destination:{kind:'stock',target:[8,10]}};
  assert.throws(() => deserialize(serialize(s)), /Invalid shipment location/);
});

test('legacy save rejects future shipment fields before migration', () => {
  for (const edit of [
    s => s.jobs.find(j => j.sources.length).sources[0].z = 0,
    s => carrier(s).delivery.target = {x:8,y:10,z:0},
    s => s.crew[0].intent = {type:'haul',target:{x:8,y:10,z:0}},
    s => s.crew[0].intent = {type:'salvage',target:{x:8,y:10,z:0}},
    s => s.crew[0].intent = {type:'haul',target:[8,10],destination:{kind:'stock',target:{x:8,y:10,z:0}}},
  ]) {
    const s = fresh(); edit(s);
    assert.throws(() => deserialize(serialize(s)), /Invalid legacy (shipment|material) location/);
  }
});

test('current observation and recording expose shipment fields without changing state', () => {
  const s = deserialize(original), before = serialize(s), c = carrier(s), job = s.jobs.find(j => j.sources.length);
  const observation = observe(s); assert.equal(observation.schemaVersion, CURRENT_OBSERVATION_VERSION);
  assert.deepEqual(observation.entities[c.id].delivery.target, c.delivery.target);
  assert.equal(observation.entities[job.id].sources[0].z, 0);
  startRecording(s); stopRecording(s);
  const records = exportRecording(s).trim().split('\n').map(JSON.parse);
  assert.equal(records[0].schemaVersion, CURRENT_OBSERVATION_VERSION); assert.equal(records[0].gameVersion, CURRENT_SAVE_VERSION);
  assert.deepEqual(records[0].observation, observation); assert.equal(records.at(-1).schemaVersion, CURRENT_OBSERVATION_VERSION);
  assert.equal(serialize(s), before);
});

test('ground room exposure cannot alias an upper-deck reserved waste parcel', () => {
  const s = {jobs:[{site:'surface',x:1,y:1,z:0,materials:{},sources:[
    {x:1,y:1,z:0,items:{waste:2}}, {x:1,y:1,z:4,items:{waste:7}},
  ]}]}, site = {id:'surface',tiles:[]};
  assert.equal(exposedWaste(s,site,{cells:['1,1']}), 2);
  assert.equal(exposedWaste(s,site,null,{x:1,y:1,z:4}), 7);
});
