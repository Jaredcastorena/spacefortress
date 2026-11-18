import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION} from '../src/data.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createGame,at,updateRooms,serialize,deserialize,step} from '../src/simulation.js';
import {roomAt} from '../src/atmosphere.js';
import {roomKelvin} from '../src/gas-thermal.js';
import {updateThermal,validateThermal,outsideTemperatureAt} from '../src/thermal.js';
import {newWaterPipe} from '../src/plumbing.js';
import {waterKelvin,waterHeatAt,parcelHeat,putWater,storedWaterHeat,WATER_REFERENCE_KELVIN} from '../src/water-thermal.js';
import {liquidDetails} from '../src/liquid-panels.js';
import {plumbingDetails} from '../src/plumbing-panels.js';
import {executeAction,createAgentInterface} from '../src/controls.js';
import {observe,startRecording,exportRecording,capture,tileEntityId} from '../src/telemetry.js';
import {projectPreWaterVapor} from './helpers/legacy-projection.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const oldBytes=()=>gunzipSync(readFileSync(new URL('./fixtures/water-heat-schema78.json.gz',import.meta.url))).toString();
const stateHeat=site=>site.rooms.reduce((n,r)=>n+r.heat,0)+site.tiles.reduce((n,t)=>n+(t.pipe?.heat||0)+(t.gasStore?.heat||0),0)+storedWaterHeat(site);
const roomHeat=site=>site.rooms.reduce((n,r)=>n+r.heat,0);
const emptyFloor=site=>site.tiles.find(t=>t.terrain==='floor'&&!t.building&&!t.waterPipe&&t.liquid===0);
// Controlled initial parcels are tracked in both physical and energy ledgers.
function seed(site,t,amount,kelvin,{floor=false}={}) {
 const owner=floor?t:(t.waterPipe??=newWaterPipe()),heat=waterHeatAt(amount,kelvin);
 putWater(owner,amount,heat,{floor});site.thermal.waterLoaded+=heat;
 if(floor)site.liquids.released+=amount;else site.plumbing.loaded+=amount;
 return owner;
}
function withoutWaterFields(s) {
 const copy=projectPreWaterVapor(s);copy.version=78;
 for(const site of Object.values(copy.sites)) {
  for(const key of ['waterInitial','waterLoaded','waterRemoved'])delete site.thermal[key];
  for(const t of site.tiles){delete t.liquidHeat;for(const node of [t.waterPipe,t.waterStore])if(node)delete node.heat;}
 }
 return copy;
}

test('authentic schema78 migration preserves every old field and gives water an explicit 20C baseline',()=>{
 const raw=oldBytes();assert.equal(createHash('sha256').update(raw).digest('hex'),'859539dba0d194752d180ce42d3d5e51cde55f18e5d9314c152d2dccf476d8d2');
 const old=JSON.parse(raw),s=deserialize(raw);assert.equal(old.version,78);assert.equal(s.version,VERSION);
 assert.ok(isDeepStrictEqual(withoutWaterFields(s),old),'migration preserves quantities, rooms, topology and RNG exactly');
 let wet=0,nodes=0;
 for(const site of Object.values(s.sites)) {
  close(site.thermal.waterInitial,storedWaterHeat(site));assert.equal(site.thermal.waterLoaded,0);assert.equal(site.thermal.waterRemoved,0);
  for(const t of site.tiles) {
   close(t.liquidHeat,parcelHeat(t.liquid));if(t.liquid>0){wet++;close(waterKelvin(t,{floor:true}),WATER_REFERENCE_KELVIN);}
   for(const node of [t.waterPipe,t.waterStore])if(node){nodes++;close(node.heat,parcelHeat(node.water));if(node.water>0)close(waterKelvin(node),293.15);}
  }
 }
 assert.ok(wet>0&&nodes>0,'fixture exercises both floor water and pipe contents');validateThermal(s);
 assert.ok(serialize(deserialize(serialize(s)))===serialize(s),'migration is idempotent after saving');
});

test('old saves reject shadow water fields and invalid old balances before migration',()=>{
 const shadow=[s=>s.sites.surface.tiles[0].liquidHeat=0,s=>s.sites.surface.tiles.find(t=>t.waterPipe).waterPipe.heat=0,s=>s.sites.surface.tiles[0].waterStore={heat:0},
  ...['waterInitial','waterLoaded','waterRemoved'].map(key=>s=>s.sites.surface.thermal[key]=0)];
 for(const alter of shadow){const old=JSON.parse(oldBytes());alter(old);assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy save contains water thermal state/);}
 for(const alter of [s=>s.sites.surface.plumbing.loaded+=1,s=>s.sites.surface.rooms[0].heat+=100]) {
  const old=JSON.parse(oldBytes());alter(old);assert.throws(()=>deserialize(JSON.stringify(old)),'invalid historical custody must not be repaired by migration');
 }
});

test('current saves reject missing, negative, nonfinite, ownerless and unbalanced water energy',()=>{
 const initial=deserialize(oldBytes()),wet=s=>s.sites.surface.tiles.find(t=>t.liquid>0),dry=s=>s.sites.surface.tiles.find(t=>t.liquid===0),pipe=s=>s.sites.surface.tiles.find(t=>t.waterPipe).waterPipe;
 const corrupt=[s=>delete wet(s).liquidHeat,s=>delete dry(s).liquidHeat,s=>delete pipe(s).heat,
  s=>wet(s).liquidHeat=-1,s=>pipe(s).heat=-1,s=>wet(s).liquidHeat=NaN,s=>pipe(s).heat=Infinity,
  s=>dry(s).liquidHeat=1,s=>{pipe(s).water=0;},s=>wet(s).liquidHeat+=100,s=>pipe(s).heat+=100,
  ...['waterInitial','waterLoaded','waterRemoved'].map(key=>s=>delete s.sites.surface.thermal[key]),s=>s.sites.surface.thermal.waterLoaded+=100];
 for(const [index,alter] of corrupt.entries()){const s=structuredClone(initial);alter(s);assert.throws(()=>deserialize(serialize(s)),`corruption ${index}`);}
});

test('floor water and plumbing exchange finite heat with their room and conserve combined energy',()=>{
 const s=createGame(74261),site=s.sites.surface,t=emptyFloor(site),r=roomAt(site,t.x,t.y),control=structuredClone(s);
 const node=seed(site,t,2,700);seed(site,t,2,600,{floor:true});const before=stateHeat(site),added=storedWaterHeat(site)-storedWaterHeat(control.sites.surface),water=t.liquid,nodeWater=node.water,ledger={...site.thermal};
 updateThermal(s);updateThermal(control);
 assert.ok(waterKelvin(node)<700&&waterKelvin(node)>roomKelvin(r));assert.ok(waterKelvin(t,{floor:true})<600&&waterKelvin(t,{floor:true})>roomKelvin(r));
 assert.equal(node.water,nodeWater);assert.equal(t.liquid,water);
 close(roomHeat(site)-roomHeat(control.sites.surface),added-storedWaterHeat(site)+storedWaterHeat(control.sites.surface));
 close(stateHeat(site)-before,site.thermal.environmentIn-ledger.environmentIn-site.thermal.environmentOut+ledger.environmentOut+site.thermal.equipment-ledger.equipment+site.thermal.heating-ledger.heating-site.thermal.cooling+ledger.cooling);
 validateThermal(s);
});

test('a water pipe inside a partition warms adjacent rooms without inventing an exterior sink',()=>{
 const s=createGame(74261),site=s.sites.surface;for(let y=7;y<=11;y++)at(site,10,y).building='wall';updateRooms(site);
 const control=structuredClone(s),other=control.sites.surface,t=at(site,10,9),node=seed(site,t,2,700),before=node.heat;
 updateThermal(s);updateThermal(control);
 close(site.thermal.environmentIn,other.thermal.environmentIn);close(site.thermal.environmentOut,other.thermal.environmentOut);
 assert.ok(node.heat<before);assert.ok(node.heat>0);close(roomHeat(site)-roomHeat(other),before-node.heat);validateThermal(s);
});

test('exterior hot and cold water exchange only their finite energy difference with local ambient',()=>{
 for(const kelvin of [100,700]) {
  const s=createGame(74261),site=s.sites.surface,t=site.tiles.find(t=>t.terrain==='ground'&&!t.building&&t.liquid===0),control=structuredClone(s),other=control.sites.surface;
  const node=seed(site,t,2,kelvin);seed(site,t,2,kelvin,{floor:true});const before=node.heat+t.liquidHeat;
  updateThermal(s);updateThermal(control);
  const ambient=outsideTemperatureAt(site,t.x,t.y,t.z)+273.15;
  for(const actual of [waterKelvin(node),waterKelvin(t,{floor:true})])assert.ok(actual>Math.min(ambient,kelvin)&&actual<Math.max(ambient,kelvin));
  close(roomHeat(site),roomHeat(other));
  close(before-node.heat-t.liquidHeat,site.thermal.environmentOut-other.thermal.environmentOut-site.thermal.environmentIn+other.thermal.environmentIn);validateThermal(s);
 }
});

function upperDeck(s,{exterior=false}={}) {
 const site=s.sites.surface;site.levels.push({z:1,name:'Thermal test deck'});
 site.tiles.push(...site.tiles.map(t=>{
  const upper={...structuredClone(t),z:1,liquid:0,liquidHeat:0,powered:false,...(exterior?{terrain:'ground',building:null}:{})};
  for(const key of ['biome','temperatureOffset','basin','initialWater'])delete upper[key];return upper;
 }));
 updateRooms(site);return site;
}

test('upper floor water heats its actual room without transferring directly to the room below',()=>{
 const s=createGame(74261),site=upperDeck(s),lower=emptyFloor(site),t=at(site,lower.x,lower.y,1),control=structuredClone(s),node=seed(site,t,2,700),before=node.heat;
 updateThermal(s);updateThermal(control);
 close(roomAt(site,t.x,t.y,0).heat,roomAt(control.sites.surface,t.x,t.y,0).heat);
 close(roomAt(site,t.x,t.y,1).heat-roomAt(control.sites.surface,t.x,t.y,1).heat,before-node.heat);assert.ok(before>node.heat);validateThermal(s);
});

test('upper exterior water uses its own ambient even above a ground floor room',()=>{
 const s=createGame(74261),site=upperDeck(s,{exterior:true}),lower=emptyFloor(site),t=at(site,lower.x,lower.y,1),control=structuredClone(s),node=seed(site,t,2,287);
 updateThermal(s);updateThermal(control);
 assert.ok(waterKelvin(node)<287,'cold upper exterior removes heat while the lower habitat would add it');
 close(roomHeat(site),roomHeat(control.sites.surface));validateThermal(s);
});

test('migrated and new water domains continue deterministically through saves',()=>{
 for(const s of [createGame(74261),deserialize(oldBytes())]) {
  const copy=deserialize(serialize(s));step(s,12);step(copy,12);assert.ok(serialize(s)===serialize(copy),'identical saved continuation');validateThermal(s);
  assert.ok(serialize(deserialize(serialize(s)))===serialize(s),'exact round trip');
 }
});

test('water inspection and observation expose cold, hot and empty temperatures without mutation',()=>{
 const s=deserialize(oldBytes()),site=s.sites.surface,t=site.tiles.find(t=>t.waterPipe),wet=site.tiles.find(t=>t.liquid>0);
 const setHeat=(owner,key,heat)=>{site.thermal.waterInitial+=heat-owner[key];owner[key]=heat;};
 setHeat(t.waterPipe,'heat',parcelHeat(t.waterPipe.water,323.15));setHeat(wet,'liquidHeat',waterHeatAt(wet.liquid,173.15));
 const empty=at(site,20,20);empty.waterPipe=newWaterPipe();const before=serialize(s),view=observe(s);
 assert.equal(view.schemaVersion,16);assert.match(plumbingDetails(s,site,t),/data-plumbing-temperature>50.0\s*°C/);assert.match(liquidDetails(wet),/data-water-temperature>-100.0\s*°C/);assert.match(plumbingDetails(s,site,empty),/data-plumbing-temperature>Empty/);
 const floor=view.entities[tileEntityId(site.id,wet.x,wet.y,wet.z)],pipe=view.entities[tileEntityId(site.id,t.x,t.y,t.z)],dry=view.entities[tileEntityId(site.id,empty.x,empty.y,empty.z)];
 close(floor.derived.water.temperature,-100);assert.equal(floor.derived.water.heat,wet.liquidHeat);close(pipe.derived.plumbing.temperature,50);assert.equal(pipe.derived.plumbing.heat,t.waterPipe.heat);assert.equal(dry.derived.plumbing.temperature,null);
 assert.ok(serialize(s)===before,'inspection leaves saved state unchanged');validateThermal(s);
});

test('water recording labels heat changes and preserves player-agent physical parity and RNG',()=>{
 const s=deserialize(oldBytes()),copy=deserialize(serialize(s)),site=s.sites.surface,t=site.tiles.find(t=>t.waterPipe),args={site:site.id,x:t.x,y:t.y,z:t.z,open:false},before=serialize(s);
 assert.equal(startRecording(s).active,true);assert.ok(serialize(s)===before,'recording setup leaves saved state unchanged');
 assert.equal(executeAction(s,'plumbing.valve',args,'player').ok,true);assert.equal(createAgentInterface(()=>copy).act('plumbing.valve',args).ok,true);
 updateThermal(s);updateThermal(copy);capture(s,'tick');assert.ok(serialize(s)===serialize(copy),'recording preserves player-agent parity');
 const rows=exportRecording(s).trim().split('\n').map(JSON.parse),changes=rows.flatMap(row=>row.changes||[]);
 assert.equal(rows[0].schemaVersion,16);assert.equal(rows[0].observation.entities[tileEntityId(site.id,t.x,t.y,t.z)].waterPipe.heat,parcelHeat(1));
 assert.ok(changes.some(change=>change.path[0]==='liquidHeat'&&change.system==='temperature'));
 assert.ok(changes.some(change=>change.path[0]==='waterPipe'&&change.path[1]==='heat'&&change.system==='plumbing'));
 assert.equal(s.rng,copy.rng);validateThermal(s);
});
