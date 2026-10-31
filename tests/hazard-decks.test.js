import {withTemperaturePressureReadings} from './helpers/pressure-migration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {DIRECTIONS,step,neighbors} from '../src/geometry.js';
import {updateRooms,fillRoom,roomAt} from '../src/atmosphere.js';
import {initializeStorage} from '../src/inventory.js';
import {initializeElectrical} from '../src/power.js';
import {ignite,updateFire,fireJobValid,evadeFire,prepareFire} from '../src/fire.js';
import {scheduleMaintenance,updateDebris,SERVICE_INTERVAL} from '../src/maintenance.js';
import {initializeReactorTile,radiatorTargets,updateReactorCooling} from '../src/reactors.js';
import {newPipe} from '../src/gas-networks.js';
import {newWaterPipe} from '../src/plumbing.js';
import {observe,startRecording,exportRecording,tileEntityId,TELEMETRY_VERSION} from '../src/telemetry.js';
import {projectPreHazardLocations} from './helpers/legacy-projection.js';

// Genuine schema52 serialization from source ea421fa: synthetic tick0 forecast
// and one native damage record, exact old-format reload verified before edits.
const original=gunzipSync(readFileSync(new URL('./fixtures/hazard-locations-schema52.json.gz',import.meta.url))).toString();
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
function stacked(){
  const s=createGame(74219),site=s.sites.surface,blank=structuredClone(site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.flora));
  site.levels.push({...site.levels[0],z:7});
  for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z:7,terrain:'ground',building:null,hp:100,cable:null,pipe:null,waterPipe:null,liquid:0,wetShort:false});
  return {s,site};
}
function building(site,x,y,z,kind){const t=at(site,x,y,z);t.terrain='ground';t.building=kind;t.hp=100;initializeStorage(t);initializeElectrical(t);return t;}
function compartments(){
  const f=stacked(),cells=[[3,3],[4,3]];
  for(const z of [0,7]){
    for(const [x,y] of cells)for(const [nx,ny] of neighbors(x,y))if(!cells.some(([cx,cy])=>cx===nx&&cy===ny)){const t=at(f.site,nx,ny,z);t.terrain='floor';t.building='wall';t.hp=100;}
    for(const [x,y] of cells)building(f.site,x,y,z,'farm').terrain='floor';
  }
  updateRooms(f.site);for(const z of [0,7])fillRoom(roomAt(f.site,3,3,z));
  return f;
}
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('schema52 hazard migration preserves forecast timing, damage and every unrelated field',()=>{
  assert.equal(createHash('sha256').update(original).digest('hex'),'b66097e34db8ad11e7d55c4c74b8e4192316012b6d76c649bb786c7dd26dd0d6');
  const old=JSON.parse(original),s=deserialize(original);assert.equal(old.version,52);assert.equal(s.version,VERSION);
  assert.deepEqual(s.debris.target,{...old.debris.target,z:0});assert.deepEqual(s.sites.surface.incidents[0],{...old.sites.surface.incidents[0],z:0});
  const projected=projectPreHazardLocations(s);projected.version=52;assert.deepEqual(projected,withTemperaturePressureReadings(old));
  const raw=serialize(s);assert.equal(serialize(deserialize(raw)),raw);const observation=observe(s);assert.equal(observation.schemaVersion,TELEMETRY_VERSION);
});

test('hazard locations reject incomplete or unsupported current coordinates and legacy z shadows',()=>{
  const good=deserialize(original);
  for(const z of [undefined,null,1,7,-1,'0'])for(const target of [s=>s.debris.target,s=>s.sites.surface.incidents[0]]){
    const s=structuredClone(good),p=target(s);if(z===undefined)delete p.z;else p.z=z;assert.throws(()=>deserialize(serialize(s)),/Invalid hazard location/);
  }
  for(const target of [s=>s.debris.target,s=>s.sites.surface.incidents[0]]){const s=JSON.parse(original);target(s).z=0;assert.throws(()=>deserialize(serialize(s)),/Invalid legacy hazard location/);}
  const s=structuredClone(good);s.debris.target.site='surface';assert.throws(()=>deserialize(serialize(s)),/Invalid debris forecast/);
});

test('fire spreads and records damage only within its actual deck compartment',()=>{
  const {s,site}=compartments(),upper=at(site,3,3,7),next=at(site,4,3,7),lower=at(site,3,3),lowerRoom=roomAt(site,3,3);
  const gas=structuredClone(lowerRoom.gas),heat=lowerRoom.heat;startRecording(s);assert.equal(ignite(s,site,upper,'test'),true);upper.fire.age=29;upper.fire.intensity=60;
  updateFire(s);assert.ok(next.fire);assert.equal(next.fire.age,0);assert.equal(lower.fire,undefined);assert.equal(lower.hp,100);assert.equal(at(site,4,3).fire,undefined);
  assert.deepEqual(lowerRoom.gas,gas);assert.equal(lowerRoom.heat,heat);assert.ok(site.incidents.every(i=>i.z===7));
  const ignitions=events(s).filter(e=>e.id==='fire.ignited');assert.equal(ignitions.length,2);assert.ok(ignitions.every(e=>e.target.endsWith(':7')));
  assert.equal(fireJobValid(s,{site:'surface',x:3,y:3,z:7,fire:upper.fire.id}),true);assert.equal(fireJobValid(s,{site:'surface',x:3,y:3,z:0,fire:upper.fire.id}),false);
});

test('upper fire and service responses target their actual floor and retain route isolation',()=>{
  const {s,site}=compartments(),upper=at(site,3,3,7);ignite(s,site,upper,'test');
  const calls=[],order=(...args)=>{calls.push(args);return {ok:false,message:'test'};};prepareFire(s,order,()=>{});assert.equal(calls.length,1);assert.equal(calls[0][4],'extinguish');assert.equal(calls[0][6],7);assert.equal(upper.fire.blocked,'test');
  upper.maintenance.auto=true;upper.maintenance.usage=SERVICE_INTERVAL;s.jobs.push({id:'ground-repair',kind:'repair',site:'surface',x:3,y:3,z:0});
  scheduleMaintenance(s,order);assert.equal(calls.length,2);assert.equal(calls[1][4],'service');assert.equal(calls[1][6],7);assert.equal(upper.maintenance.blocked,'test');
  const actor={...s.crew[0],site:'surface',x:3,y:3,z:7},ground={...actor,z:0},before=positionOf(actor);let releases=0;
  assert.equal(evadeFire(s,ground,site,null,()=>{releases++;}),false);assert.equal(releases,0);
  assert.equal(evadeFire(s,actor,site,null,()=>{releases++;}),true);assert.equal(releases,1);assert.notDeepEqual(positionOf(actor),before);assert.equal(actor.z,7);assert.equal(actor.activity,'Escaping a fire');
});

test('radiator feedthroughs in all hex directions cool only the matching deck and conserve reactor heat',()=>{
  for(const direction of DIRECTIONS){
    const {s,site}=stacked(),near=step(14,14,direction),far=step(...near,direction);
    const lower=building(site,...far,0,'reactor'),upper=building(site,...far,7,'reactor');
    for(const z of [0,7])building(site,...near,z,'wall');
    const radiator=building(site,14,14,7,'radiator');initializeReactorTile(radiator);lower.reactor.heat=100;upper.reactor.heat=100;site.reactorLedger.heatMade=200;
    assert.deepEqual(radiatorTargets(site,radiator),[upper]);startRecording(s);updateReactorCooling(s);
    assert.equal(lower.reactor.heat,100);assert.equal(upper.reactor.heat,68);assert.equal(site.reactorLedger.radiated,32);assert.equal(lower.reactor.heat+upper.reactor.heat+site.reactorLedger.radiated,200);
    const event=events(s).find(e=>e.id==='reactor.heat.radiated');assert.equal(event.entity,tileEntityId(site.id,14,14,7));assert.equal(event.from,tileEntityId(site.id,upper.x,upper.y,7));
  }
});

test('debris forecasts retain the chosen deck and impact only that location and its overlays',()=>{
  const {s,site}=stacked();for(const t of site.tiles){t.terrain='floor';if(t.building==='wall')t.building=null;}
  const lower=building(site,12,13,0,'solar'),upper=building(site,12,13,7,'solar');lower.terrain='floor';
  for(const t of [lower,upper]){t.cable={hp:100,enabled:true};t.pipe=newPipe();t.waterPipe=newWaterPipe();}
  s.debris.next=90;updateDebris(s);assert.deepEqual(s.debris.target,{x:12,y:13,z:7});s.tick=90;updateDebris(s);
  assert.deepEqual([lower.hp,lower.cable.hp,lower.pipe.hp,lower.waterPipe.hp],[100,100,100,100]);assert.deepEqual([upper.hp,upper.cable.hp,upper.pipe.hp,upper.waterPipe.hp],[65,40,40,40]);
  assert.equal(site.incidents.length,4);assert.ok(site.incidents.every(i=>i.x===12&&i.y===13&&i.z===7&&i.cause==='debris'));assert.equal(s.debris.target,null);assert.equal(s.debris.count,1);
});
