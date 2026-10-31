import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,at,updateRooms,serialize,deserialize,step} from '../src/simulation.js';
import {refreshAtmosphere,roomAt,gasAmount,mix} from '../src/atmosphere.js';
import {roomKelvin,roomHeatCapacity,gasEnergy,exportRoomHeat,GAS_REFERENCE_KELVIN} from '../src/gas-thermal.js';
import {updateThermal,validateThermal,thermalSafe} from '../src/thermal.js';
import {newPipe,gasNode} from '../src/gas-networks.js';
import {gasDetails} from '../src/gas-panels.js';
import {executeAction,createAgentInterface} from '../src/controls.js';
import {observe,startRecording,exportRecording} from '../src/telemetry.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const stateHeat=site=>site.rooms.reduce((n,r)=>n+r.heat,0)+site.tiles.reduce((n,t)=>n+(gasNode(t)?.heat||0),0);
const oldBytes=()=>gunzipSync(readFileSync(new URL('./fixtures/gas-heat-schema77.json.gz',import.meta.url))).toString();

test('genuine schema77 migration preserves physical owners, quantities and temperatures with an explicit energy baseline',()=>{
 const raw=oldBytes();assert.equal(createHash('sha256').update(raw).digest('hex'),'f49dcdde34be2e94098e7e3e11c10f74e16196b256308dfb3c281ffb3f2703e1');
 const old=JSON.parse(raw),s=deserialize(raw),projected=structuredClone(s);projected.version=77;
 for(const [id,site] of Object.entries(s.sites)){
  close(stateHeat(site),site.thermal.initial+site.thermal.gasInitial);
  for(let i=0;i<site.rooms.length;i++){const r=site.rooms[i],prior=old.sites[id].rooms[i];close(roomKelvin(r),prior.heat/(20*prior.volume));const p=projected.sites[id].rooms[i];delete p.gasThermal;p.heat=prior.heat;p.pressure=prior.pressure;p.air=prior.air;}
  projected.sites[id].air=old.sites[id].air;
  for(const key of ['gasInitial','gasLoaded','gasVented'])delete projected.sites[id].thermal[key];
  for(const tile of projected.sites[id].tiles)for(const node of [tile.pipe,tile.gasStore])if(node)delete node.heat;
 }
 assert.deepEqual(projected,old);assert.ok(serialize(deserialize(serialize(s)))===serialize(s),'exact save');
});

test('future thermal fields in old saves and missing or forged current heat balances reject',()=>{
 for(const alter of [s=>s.sites.surface.rooms[0].gasThermal=true,s=>s.sites.surface.thermal.gasLoaded=0,s=>s.sites.surface.tiles.find(t=>t.pipe).pipe.heat=0]){const old=JSON.parse(oldBytes());alter(old);assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy save contains gas thermal state/);}
 for(const alter of [s=>delete s.sites.surface.rooms[0].gasThermal,s=>s.sites.surface.rooms[0].heat+=1,s=>delete s.sites.surface.thermal.gasLoaded]){const s=createGame(74258);alter(s);assert.throws(()=>deserialize(serialize(s)));}
});

test('topology retains gas energy across surviving floors and vents it only when its room is completely lost',()=>{
 const s=createGame(74258),site=s.sites.surface,r=site.rooms[0],kelvin=323.15,heat=roomHeatCapacity(r)*kelvin;site.thermal.added+=heat-r.heat;r.heat=heat;const gasBefore=gasAmount(r.gas),vented=site.thermal.gasVented;
 for(let y=7;y<=11;y++)at(site,10,y).building='wall';updateRooms(site);
 close(site.rooms.reduce((n,r)=>n+gasAmount(r.gas),0),gasBefore);site.rooms.forEach(r=>close(roomKelvin(r),kelvin));close(site.thermal.gasVented,vented);validateThermal(s);
 const energy=site.rooms.reduce((n,r)=>n+gasEnergy(r.gas,roomKelvin(r)),0);
 for(const t of site.tiles)if(t.terrain==='floor')t.terrain='ground';updateRooms(site);assert.equal(site.rooms.length,0);close(site.thermal.gasVented-vented,energy);validateThermal(s);
});

test('hot pipes conduct finite heat to their local room while exterior exchange remains accounted',()=>{
 const s=createGame(74258),site=s.sites.surface,t=site.tiles.find(t=>t.terrain==='floor'&&!t.building),r=roomAt(site,t.x,t.y),before=roomKelvin(r);
 t.pipe=newPipe();t.pipe.gas=mix(4);t.pipe.heat=gasEnergy(t.pipe.gas,700);site.gasNetwork.loaded=mix(4);site.thermal.gasLoaded+=t.pipe.heat;
 const initial=t.pipe.heat,total=stateHeat(site),envIn=site.thermal.environmentIn,envOut=site.thermal.environmentOut,equipment=site.thermal.equipment;updateThermal(s);
 assert.ok(t.pipe.heat<initial&&t.pipe.heat>0);assert.ok(roomKelvin(r)>before);close(stateHeat(site)-total,(site.thermal.environmentIn-envIn)-(site.thermal.environmentOut-envOut)+(site.thermal.equipment-equipment));validateThermal(s);
});

test('suit releases have player-agent parity, finite imported heat and labeled observations',()=>{
 const s=createGame(74258),site=s.sites.surface,c=s.crew[0],r=roomAt(site,c.x,c.y),removed=gasAmount(r.gas)*.1;exportRoomHeat(site,r,removed,{boundary:true});for(const k of ['oxygen','inert','co2']){const quantity=r.gas[k]*.1;r.gas[k]-=quantity;site.atmosphere.vented[k]+=quantity;}refreshAtmosphere(site);
 const a=deserialize(serialize(s)),b=deserialize(serialize(s));assert.equal(startRecording(a).active,true,'default recording budget admits the observation header');
 assert.ok(executeAction(a,'crew.suit.release',{crew:c.id,points:10},'player').ok);assert.ok(createAgentInterface(()=>b).act('crew.suit.release',{crew:c.id,points:10}).ok);assert.ok(serialize(a)===serialize(b),'player/agent exact physical parity');validateThermal(a);
 const event=exportRecording(a).split('\n').filter(Boolean).map(JSON.parse).find(row=>row.event?.id==='crew.suit.released').event;assert.ok(event.heat>0);
 const before=serialize(a),view=observe(a),roomEntity=Object.values(view.entities).find(e=>e.type==='room');assert.equal(view.schemaVersion,12);assert.ok(roomEntity.derived.heatCapacity>roomEntity.volume*20);assert.equal(serialize(a),before);
});

test('gas inspection exposes cold and empty temperatures without changing the simulation',()=>{
 const s=createGame(74258),site=s.sites.surface,t=at(site,20,20);t.pipe=newPipe();assert.match(gasDetails(site,t),/data-gas-temperature>Empty/);
 t.pipe.gas=mix(2);t.pipe.heat=gasEnergy(t.pipe.gas,173.15);const before=serialize(s);assert.match(gasDetails(site,t),/data-gas-temperature>-100.0°C/);assert.equal(serialize(s),before);
});

test('a current colony and migrated pipes continue with exact saves and conserved heat',()=>{
 for(const s of [createGame(74258),deserialize(oldBytes())]){const reloaded=deserialize(serialize(s));step(s,12);step(reloaded,12);assert.ok(serialize(s)===serialize(reloaded),'saved continuation');validateThermal(s);assert.ok(serialize(deserialize(serialize(s)))===serialize(s),'exact save');}
});

test('gas inside an enclosed partition exchanges with its adjacent rooms without an exterior heat sink',()=>{
 const s=createGame(74258),site=s.sites.surface;for(let y=7;y<=11;y++)at(site,10,y).building='wall';updateRooms(site);
 const control=deserialize(serialize(s)),other=control.sites.surface,t=at(site,10,9);t.pipe=newPipe();t.pipe.gas=mix(4);t.pipe.heat=gasEnergy(t.pipe.gas,700);site.gasNetwork.loaded=mix(4);site.thermal.gasLoaded+=t.pipe.heat;
 const before=t.pipe.heat;updateThermal(s);updateThermal(control);
 close(site.thermal.environmentIn,other.thermal.environmentIn);close(site.thermal.environmentOut,other.thermal.environmentOut);
 assert.ok(t.pipe.heat<before);close(site.rooms.reduce((n,r)=>n+r.heat,0)-other.rooms.reduce((n,r)=>n+r.heat,0),before-t.pipe.heat);validateThermal(s);
});

test('thermal safety tolerates roundoff at an exact boundary but rejects physically hotter or colder rooms',()=>{
 const room={volume:2,gas:mix(19),gasThermal:true};
 for(const celsius of [5,35]){room.heat=roomHeatCapacity(room)*(273.15+celsius);assert.ok(thermalSafe(room));room.heat+=celsius===35?Number.EPSILON*room.heat:-Number.EPSILON*room.heat;assert.ok(thermalSafe(room));}
 for(const celsius of [4.999999,35.000001]){room.heat=roomHeatCapacity(room)*(273.15+celsius);assert.equal(thermalSafe(room),false);}
});
