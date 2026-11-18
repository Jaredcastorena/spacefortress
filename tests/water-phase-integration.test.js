import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION} from '../src/data.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createGame,at,updateRooms,serialize,deserialize,step} from '../src/simulation.js';
import {roomAt,refreshAtmosphere} from '../src/atmosphere.js';
import {roomKelvin,roomHeatCapacity} from '../src/gas-thermal.js';
import {updateThermal,validateThermal} from '../src/thermal.js';
import {newWaterPipe,flowPlumbing} from '../src/plumbing.js';
import {waterPhase,waterHeatAt,putWater,storedWaterHeat,exchangeWaterHeat,MELTING_KELVIN,WATER_LATENT_HEAT} from '../src/water-thermal.js';
import {recordWaterPhase} from '../src/water-phase-events.js';
import {plumbingDetails} from '../src/plumbing-panels.js';
import {liquidDetails} from '../src/liquid-panels.js';
import {neighbors} from '../src/geometry.js';
import {observe,startRecording,exportRecording,capture,tileEntityId} from '../src/telemetry.js';
import {executeAction,createAgentInterface} from '../src/controls.js';
import {projectPreWaterVapor} from './helpers/legacy-projection.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const oldBytes=()=>gunzipSync(readFileSync(new URL('./fixtures/water-phase-schema79.json.gz',import.meta.url))).toString();
const mixedHeat=mass=>mass*(MELTING_KELVIN-WATER_LATENT_HEAT/2);
const stateHeat=site=>site.rooms.reduce((n,r)=>n+r.heat,0)+site.tiles.reduce((n,t)=>n+(t.pipe?.heat||0)+(t.gasStore?.heat||0),0)+storedWaterHeat(site);
const roomHeat=site=>site.rooms.reduce((n,r)=>n+r.heat,0);
const emptyFloor=site=>site.tiles.find(t=>t.terrain==='floor'&&!t.building&&!t.waterPipe&&t.liquid===0);
const phaseEvents=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(row=>row.event?.id==='water.froze'||row.event?.id==='water.thawed');
function seed(site,t,mass,heat,{floor=false}={}) {
 const owner=floor?t:(t.waterPipe??=newWaterPipe());putWater(owner,mass,heat,{floor});site.thermal.waterLoaded+=heat;
 site[floor?'liquids':'plumbing'][floor?'released':'loaded']+=mass;return owner;
}
function setRoom(site,room,kelvin) {
 const heat=roomHeatCapacity(room)*kelvin,delta=heat-room.heat;site.thermal[delta>=0?'added':'removed']+=Math.abs(delta);room.heat=heat;refreshAtmosphere(site);
}
function boundaryDelta(before,after) {
 return after.environmentIn-before.environmentIn-after.environmentOut+before.environmentOut+after.equipment-before.equipment+after.heating-before.heating-after.cooling+before.cooling;
}

test('authentic schema79 admission preserves all saved mass, energy, rooms and RNG while deriving cold phases',()=>{
 const raw=oldBytes();assert.equal(createHash('sha256').update(raw).digest('hex'),'405b28fc6630216298c87518fa3ad54f3088de4b9bed0f32186436cbd686f9bd');
 const old=JSON.parse(raw),s=deserialize(raw),projected=projectPreWaterVapor(s);assert.equal(old.version,79);assert.equal(s.version,VERSION);projected.version=79;
 assert.ok(isDeepStrictEqual(projected,old),'only the schema marker and neutral vapor/compression additions change; no prior physical state or energy reset');
 for(const [id,site] of Object.entries(s.sites)) {
  close(storedWaterHeat(site),storedWaterHeat(old.sites[id]));site.rooms.forEach((room,index)=>close(roomKelvin(room),roomKelvin(old.sites[id].rooms[index])));
 }
 const node=s.sites.surface.tiles.find(t=>t.waterPipe).waterPipe,p=waterPhase(node);
 assert.equal(node.water,1);assert.equal(node.heat,200);assert.equal(p.phase,'mixed');close(p.kelvin,273.15);close(p.ice+p.liquid,1);
 close(p.liquid,(200-(273.15-80))/80);validateThermal(s);
 assert.ok(serialize(deserialize(serialize(s)))===serialize(s),'derived phases survive an exact current-schema round trip');
});

test('actual room exchange crosses the latent plateau without losing mass or overshooting either temperature',()=>{
 for(const [initialRoom,finalPhase,eventId] of [[360,'liquid','water.thawed'],[150,'solid','water.froze']]) {
  const s=createGame(74262),site=s.sites.surface,t=emptyFloor(site),room=roomAt(site,t.x,t.y);setRoom(site,room,initialRoom);
  const node=seed(site,t,1,mixedHeat(1));seed(site,t,2,mixedHeat(2),{floor:true});const initial=stateHeat(site),ledger={...site.thermal};
  assert.equal(startRecording(s).active,true);
  for(let tick=0;tick<8;tick++) {
   const before=waterPhase(t,{floor:true});updateThermal(s);const after=waterPhase(t,{floor:true}),nodePhase=waterPhase(node),roomAfter=roomKelvin(room);
   assert.equal(after.total,2);assert.equal(nodePhase.total,1);close(after.ice+after.liquid,2);close(nodePhase.ice+nodePhase.liquid,1);
   if(initialRoom>273.15)assert.ok(after.kelvin>=before.kelvin-1e-9&&after.kelvin<=roomAfter);
   else assert.ok(after.kelvin<=before.kelvin+1e-9&&after.kelvin>=roomAfter);
   if(after.phase==='mixed')close(after.kelvin,273.15);
  }
  assert.equal(waterPhase(t,{floor:true}).phase,finalPhase);assert.equal(waterPhase(node).phase,'mixed');
  close(stateHeat(site)-initial,boundaryDelta(ledger,site.thermal));validateThermal(s);
  const events=phaseEvents(s).filter(row=>row.event.entity===tileEntityId(site.id,t.x,t.y,t.z));
  assert.ok(events.some(row=>row.event.id===eventId&&row.event.slot==='liquid'));assert.ok(events.some(row=>row.event.id===eventId&&row.event.slot==='waterPipe'));
  for(const {event} of events){assert.ok(event.amount>0);close(event.latentHeat,event.amount*80);assert.ok(typeof event.cause==='string'&&event.cause.length>0);}
 }
});

test('a partition pipe melts using finite adjacent-room energy without an exterior sink',()=>{
 const s=createGame(74262),site=s.sites.surface;for(let y=7;y<=11;y++)at(site,10,y).building='wall';updateRooms(site);
 const control=structuredClone(s),other=control.sites.surface,t=at(site,10,9),node=seed(site,t,2,mixedHeat(2)),before=node.heat;
 updateThermal(s);updateThermal(control);assert.ok(node.heat>before);assert.ok(waterPhase(node).ice<1);close(waterPhase(node).kelvin,273.15);
 close(site.thermal.environmentIn,other.thermal.environmentIn);close(site.thermal.environmentOut,other.thermal.environmentOut);close(roomHeat(other)-roomHeat(site),node.heat-before);validateThermal(s);
});

test('upper floor ice takes latent heat from its actual room and leaves the lower room unchanged in that contact pass',()=>{
 const s=createGame(74262),site=s.sites.surface;site.levels.push({z:1,name:'Phase test deck'});
 site.tiles.push(...site.tiles.map(t=>{
  const upper={...structuredClone(t),z:1,liquid:0,liquidHeat:0,powered:false};for(const key of ['biome','temperatureOffset','basin','initialWater'])delete upper[key];return upper;
 }));updateRooms(site);
 const base=emptyFloor(site),t=at(site,base.x,base.y,1),upper=roomAt(site,t.x,t.y,1);setRoom(site,upper,350);
 const control=structuredClone(s),node=seed(site,t,1,mixedHeat(1));seed(site,t,2,mixedHeat(2),{floor:true});const before=node.heat+t.liquidHeat;
 updateThermal(s);updateThermal(control);
 close(roomAt(site,t.x,t.y,0).heat,roomAt(control.sites.surface,t.x,t.y,0).heat);
 close(roomAt(control.sites.surface,t.x,t.y,1).heat-upper.heat,node.heat+t.liquidHeat-before);
 assert.ok(waterPhase(t,{floor:true}).ice<1);assert.ok(waterPhase(node).ice<.5);close(waterPhase(t,{floor:true}).kelvin,273.15);validateThermal(s);
});

test('liquid that mixes into a colder frozen pipe emits its actual freezing transition',()=>{
 const s=createGame(74262),site=s.sites.surface,a=emptyFloor(site),b=neighbors(a.x,a.y).map(([x,y])=>at(site,x,y)).find(t=>t?.terrain==='floor'&&!t.building&&!t.waterPipe);
 assert.ok(b);const source=seed(site,a,2,waterHeatAt(2,300)),destination=seed(site,b,1,waterHeatAt(1,100)),before=source.heat+destination.heat;
 assert.equal(startRecording(s).active,true);flowPlumbing(s);const p=waterPhase(destination);
 close(source.water+destination.water,3);close(source.heat+destination.heat,before);assert.equal(p.phase,'solid');assert.ok(destination.water>1);
 const events=phaseEvents(s).filter(row=>row.event.entity===tileEntityId(site.id,b.x,b.y,b.z)&&row.event.slot==='waterPipe');
 assert.equal(events.length,1);assert.equal(events[0].event.id,'water.froze');close(events[0].event.amount,destination.water-1);close(events[0].event.latentHeat,80*(destination.water-1));validateThermal(s);
});

test('freezing and thawing in one tick remain separate semantic events even when the owner returns to its initial state',()=>{
 const s=createGame(74262),site=s.sites.surface,t=emptyFloor(site),node=seed(site,t,2,mixedHeat(2)),initial={...node},entity=tileEntityId(site.id,t.x,t.y,t.z);
 assert.equal(startRecording(s).active,true);let before=waterPhase(node).ice;
 const removed=exchangeWaterHeat(node,200,Infinity,1);site.thermal.environmentOut+=removed;recordWaterPhase(s,site,t,'waterPipe',before,'integration.cooling');
 assert.ok(waterPhase(node).ice>before);before=waterPhase(node).ice;
 const destination=273.15+initial.heat-node.heat,returned=exchangeWaterHeat(node,destination,1,1);site.thermal.environmentIn-=returned;recordWaterPhase(s,site,t,'waterPipe',before,'integration.warming');
 close(node.heat,initial.heat);assert.equal(node.water,initial.water);capture(s,'tick');
 const rows=phaseEvents(s).filter(row=>row.event.entity===entity);assert.equal(rows.length,2);assert.deepEqual(rows.map(row=>row.event.id),['water.froze','water.thawed']);assert.ok(rows.every(row=>row.tick===s.tick));
 close(rows[0].event.amount,rows[1].event.amount);close(rows[0].event.latentHeat,rows[1].event.latentHeat);validateThermal(s);
});

test('migrated mixed ice and new colonies continue identically through save reloads',()=>{
 for(const s of [deserialize(oldBytes()),createGame(74262)]) {
  const copy=deserialize(serialize(s));step(s,8);step(copy,8);assert.ok(serialize(s)===serialize(copy),'saved phase continuation is exact');validateThermal(s);
  assert.ok(serialize(deserialize(serialize(s)))===serialize(s),'current phase save is stable');
 }
});

test('observation16 and inspectors expose phase amounts and temperatures without mutating canonical owners',()=>{
 const s=deserialize(oldBytes()),site=s.sites.surface,t=site.tiles.find(t=>t.waterPipe),floor=emptyFloor(site);seed(site,floor,2,waterHeatAt(2,173.15),{floor:true});
 const before=serialize(s),view=observe(s),pipe=view.entities[tileEntityId(site.id,t.x,t.y,t.z)],wet=view.entities[tileEntityId(site.id,floor.x,floor.y,floor.z)],p=waterPhase(t.waterPipe);
 assert.equal(view.schemaVersion,16);assert.equal(pipe.derived.plumbing.phase,'mixed');close(pipe.derived.plumbing.liquid,p.liquid);close(pipe.derived.plumbing.ice,p.ice);close(pipe.derived.plumbing.temperature,0);
 assert.equal(wet.derived.water.phase,'solid');assert.equal(wet.derived.water.ice,2);assert.equal(wet.derived.water.liquid,0);close(wet.derived.water.temperature,-100);
 assert.match(plumbingDetails(s,site,t),/Ice/i);assert.match(plumbingDetails(s,site,t),/Liquid/i);assert.match(plumbingDetails(s,site,t),/data-plumbing-temperature>0.0\s*°C/);
 assert.match(liquidDetails(floor),/Ice/i);assert.match(liquidDetails(floor),/data-water-temperature>-100.0\s*°C/);assert.ok(serialize(s)===before,'inspection creates no stored ice or phase fields');validateThermal(s);
});

test('mixed-phase valve actions and recording preserve identical player-agent gameplay state',()=>{
 const s=deserialize(oldBytes()),copy=deserialize(serialize(s)),site=s.sites.surface,t=site.tiles.find(t=>t.waterPipe),args={site:site.id,x:t.x,y:t.y,z:t.z,open:false},before=serialize(s);
 assert.equal(startRecording(s).active,true);assert.ok(serialize(s)===before);assert.equal(executeAction(s,'plumbing.valve',args,'player').ok,true);assert.equal(createAgentInterface(()=>copy).act('plumbing.valve',args).ok,true);
 step(s,2);step(copy,2);assert.ok(serialize(s)===serialize(copy),'recording and player/agent source never change mass, heat, RNG or saves');
 const rows=exportRecording(s).trim().split('\n').map(JSON.parse);assert.equal(rows[0].schemaVersion,16);assert.ok(rows.some(row=>row.event?.id==='water.thawed'&&row.event.entity===tileEntityId(site.id,t.x,t.y,t.z)));validateThermal(s);
});
