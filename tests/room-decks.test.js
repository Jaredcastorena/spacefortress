import {withTemperaturePressureReadings,withThermalRoundoff} from './helpers/pressure-migration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {serialize,deserialize} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {observe,TELEMETRY_VERSION} from '../src/telemetry.js';
import {updateRooms,fillRoom,roomAt,updateAtmosphere,breatheBatch} from '../src/atmosphere.js';
import {initializeThermal,updateThermal,temperatureAt,thermalExposure} from '../src/thermal.js';
import {gasEnergy,roomKelvin,roomHeatCapacity,roomStructureCapacity} from '../src/gas-thermal.js';
import {roomAtPosition,roomCellKey} from '../src/room-locations.js';
import {tileAt} from '../src/spatial.js';
import {neighbors} from '../src/hex.js';
import {refs,physicalTick} from './helpers/airlock-fixture.js';
import {projectPreRoomDecks} from './helpers/legacy-projection.js';

const original=gunzipSync(readFileSync(new URL('./fixtures/room-decks-schema51.json.gz',import.meta.url))).toString();
const hash=text=>createHash('sha256').update(text).digest('hex');
const withRoomRoundoff=(actual,expected)=>withThermalRoundoff({sites:{surface:{rooms:actual}}},{sites:{surface:{rooms:expected}}}).sites.surface.rooms;

// Two isolated, overlapping horizontal compartments; no power/network/crew
// movement system or supported multi-deck save is implied by this fixture.
function stacked() {
  const size=7,site={id:'surface',size,levels:[{z:0},{z:7}],tiles:[],rooms:[],fireSafety:{smokeVented:0,smokeCleared:0}};
  for(const {z} of site.levels)for(let y=0;y<size;y++)for(let x=0;x<size;x++)site.tiles.push({x,y,z,terrain:'ground',building:null,hp:100,powered:false});
  const perimeter=neighbors(3,3),door=perimeter[0];
  for(const {z} of site.levels){tileAt(site,{x:3,y:3,z}).terrain='floor';for(const [x,y] of perimeter)tileAt(site,{x,y,z}).building='wall';}
  updateRooms(site);const s={tick:0,sites:{surface:site},crew:[]};
  fillRoom(roomAt(site,3,3,0),100);fillRoom(roomAt(site,3,3,7),35);
  initializeThermal(s); // Account for the fixture's complete structure and gas energy.
  return {s,site,lower:roomAt(site,3,3,0),upper:roomAt(site,3,3,7),door:{x:door[0],y:door[1],z:7}};
}

test('schema51 room migration preserves every prior value and exact reload',()=>{
  assert.equal(hash(original),'ec6da3ae9b4233d5f11ab1ca05af04517f5e62f52a50095637f3e176cbb1fd38');const old=JSON.parse(original),s=deserialize(original);
  assert.equal(old.version,51);assert.equal(s.version,VERSION);assert.ok(Object.values(s.sites).every(site=>site.rooms.every(r=>r.z===0)));
  const projected=projectPreRoomDecks(s),expected=withTemperaturePressureReadings(old);projected.version=51;assert.deepEqual(withThermalRoundoff(projected,expected),expected);
  const text=serialize(s);assert.equal(serialize(deserialize(text)),text);
  const observation=observe(s);assert.equal(observation.schemaVersion,TELEMETRY_VERSION);
  assert.ok(Object.values(observation.entities).filter(e=>e.type==='room').every(e=>e.z===0));
});

// Compare automatic migration with an explicit ground-deck annotation of the
// immutable input. Both paths use today's gas energy and pressure model;
// historical tick hashes also included the older thermal behavior.
test('eight subsystem ticks match explicit room-deck conversion under current gas heat',()=>{
  const annotated=JSON.parse(original);annotated.version=52;
  for(const site of Object.values(annotated.sites))for(const room of site.rooms)room.z=0;
  const f=refs(deserialize(original)),control=refs(deserialize(JSON.stringify(annotated)));
  assert.equal(serialize(f.s),serialize(control.s));
  for(let tick=0;tick<8;tick++){
    physicalTick(f);physicalTick(control);
    assert.equal(serialize(f.s),serialize(control.s),`all gas, power, doors, travelers, heat and RNG at tick ${f.s.tick}`);
  }
});

test('save room ownership rejects missing, malformed and unsupported decks and legacy shadows',()=>{
  const good=deserialize(original);
  for(const z of [undefined,null,-1,1,7,'0',.5]){const s=structuredClone(good),r=s.sites.surface.rooms[0];if(z===undefined)delete r.z;else r.z=z;assert.throws(()=>deserialize(serialize(s)),/Invalid room deck/);}
  const old=JSON.parse(original);old.sites.surface.rooms[0].z=0;assert.throws(()=>deserialize(serialize(old)),/Invalid legacy room deck/);
});

test('rooms at matching coordinates on distinct declared decks remain separate and stable',()=>{
  const f=stacked();assert.equal(f.site.rooms.length,2);assert.deepEqual(f.site.rooms.map(r=>r.z),[0,7]);
  assert.equal(f.lower.volume,1);assert.equal(f.upper.volume,1);assert.equal(f.lower.sealed,true);assert.equal(f.upper.sealed,true);
  assert.notEqual(roomCellKey(f.lower,'3,3'),roomCellKey(f.upper,'3,3'));
  assert.equal(roomAtPosition(f.site,{x:3,y:3,z:7}),f.upper);assert.equal(roomAt(f.site,3,3,1),undefined);
  const before=structuredClone(f.site.rooms);updateRooms(f.site);assert.deepEqual(withRoomRoundoff(f.site.rooms,before),before);
});

test('an upper opening vents only its own gas and smoke; lower thermal transfer is unchanged',()=>{
  const f=stacked();f.upper.smoke=.4;const before=structuredClone(f.lower.gas),control=structuredClone(f.s);
  Object.assign(tileAt(f.site,f.door),{building:'door',doorMode:'open',doorUntil:0});f.s.tick=1;updateAtmosphere(f.s);
  assert.deepEqual(f.lower.gas,before);assert.ok(f.upper.pressure<35);assert.ok(f.site.fireSafety.smokeVented>0);
  for(const k of Object.keys(before))assert.ok(Math.abs(f.lower.gas[k]+f.upper.gas[k]+f.site.atmosphere.vented[k]-(before[k]+control.sites.surface.rooms[1].gas[k]))<1e-12);
  assert.ok(Math.abs(f.upper.smoke+f.site.fireSafety.smokeVented-.4)<1e-12);
  control.tick=1;updateAtmosphere(control);updateThermal(f.s);updateThermal(control);
  assert.equal(f.lower.heat,control.sites.surface.rooms[0].heat);assert.notEqual(f.upper.heat,control.sites.surface.rooms[1].heat);
});

test('removing an upper floor vents its inventory and removes its heat without stealing from below',()=>{
  const f=stacked();f.upper.smoke=.25;const lower=structuredClone(f.lower),upper=structuredClone(f.upper),removed=f.site.thermal.removed,vented=f.site.thermal.gasVented;
  tileAt(f.site,{x:3,y:3,z:7}).terrain='ground';updateRooms(f.site);
  assert.equal(f.site.rooms.length,1);assert.deepEqual(withRoomRoundoff(f.site.rooms,[lower]),[lower]);assert.deepEqual(f.site.atmosphere.vented,upper.gas);
  assert.equal(f.site.fireSafety.smokeVented,.25);
  assert.equal(f.site.thermal.removed-removed,roomStructureCapacity(upper)*roomKelvin(upper));
  assert.equal(f.site.thermal.gasVented-vented,gasEnergy(upper.gas,roomKelvin(upper)));
  assert.ok(Math.abs(f.site.thermal.removed-removed+f.site.thermal.gasVented-vented-upper.heat)<=8*Number.EPSILON*Math.max(1,upper.heat));
});

test('breathing and thermal exposure use the actual actor deck',()=>{
  const f=stacked(),gas=structuredClone(f.lower.gas),actor={id:'upper',site:'surface',x:3,y:3,z:7,health:100,oxygen:50,thermalStress:0};
  breatheBatch(f.site,[actor]);assert.deepEqual(f.lower.gas,gas);assert.ok(actor.oxygen<50);
  f.upper.heat=roomHeatCapacity(f.upper)*(273.15-30);
  assert.ok(Math.abs(temperatureAt(f.site,3,3,7)+30)<1e-10);assert.equal(temperatureAt(f.site,3,3,0),20);
  thermalExposure(actor,f.site,false);assert.ok(actor.thermalStress<0);
});
