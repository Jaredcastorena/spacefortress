import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,at,serialize,deserialize,step} from '../src/simulation.js';
import {roomAt,refreshAtmosphere} from '../src/atmosphere.js';
import {emptyGas,addGas} from '../src/gas-species.js';
import {gasEnergy,roomKelvin} from '../src/gas-thermal.js';
import {newPipe,removeGas,validateGasNetworks} from '../src/gas-networks.js';
import {newWaterPipe} from '../src/plumbing.js';
import {waterHeatAt,waterPhase} from '../src/water-thermal.js';
import {updateWaterVapor,validateWaterVapor} from '../src/water-vapor.js';
import {validateThermal} from '../src/thermal.js';
import {totalResources} from '../src/inventory.js';
import {observe,startRecording,exportRecording,capture,tileEntityId,roomEntityId} from '../src/telemetry.js';
import {executeAction,createAgentInterface} from '../src/controls.js';

const close=(a,b,message='')=>assert.ok(Math.abs(a-b)<1e-6,`${message}: ${a} != ${b}`);
const dryFloor=site=>site.tiles.find(t=>t.terrain==='floor'&&!t.building&&!t.pipe&&!t.waterPipe&&t.liquid===0&&roomAt(site,t.x,t.y,t.z));
const rows=s=>exportRecording(s).trim().split('\n').map(JSON.parse);
// Sum physical owners independently of the production accounting helpers.
function physical(s){
 const total={water:0,heat:0,vacuum:0,gasExport:0,waterExport:0};
 for(const site of Object.values(s.sites)){
  for(const room of site.rooms){total.water+=room.gas.vapor;total.heat+=room.heat;}
  for(const t of site.tiles){
   total.water+=t.liquid;total.heat+=t.liquidHeat;
   for(const n of [t.waterPipe,t.waterStore])if(n){total.water+=n.water;total.heat+=n.heat;}
   for(const n of [t.pipe,t.gasStore])if(n){total.water+=n.gas.vapor+n.condensate.water;total.heat+=n.heat+n.condensate.heat;}
  }
  total.vacuum+=site.vapor.vacuumEvaporated;total.gasExport+=site.thermal.gasVented;total.waterExport+=site.thermal.waterRemoved;
 }
 return total;
}
function seedFloor(site,t,mass,kelvin){
 const heat=waterHeatAt(mass,kelvin);t.liquid+=mass;t.liquidHeat+=heat;site.liquids.released+=mass;site.thermal.waterLoaded+=heat;
}
function seedPipe(site,t,vapor=2,kelvin=200){
 const node=t.pipe=newPipe();node.open=false;node.gas={oxygen:.21,inert:.79,co2:0,vapor};node.heat=gasEnergy(node.gas,kelvin);
 addGas(site.gasNetwork.loaded,node.gas);site.thermal.gasLoaded+=node.heat;return node;
}

test('floor evaporation and retained node condensation conserve combined physical water and enthalpy through finite contacts',()=>{
 const s=createGame(74263),site=s.sites.surface,floor=dryFloor(site);seedFloor(site,floor,2,400);
 const other=site.tiles.find(t=>t!==floor&&t.terrain==='floor'&&!t.building&&!t.pipe&&!t.waterPipe&&t.liquid===0),node=seedPipe(site,other);
 other.waterPipe=newWaterPipe();other.waterPipe.water=1;other.waterPipe.heat=waterHeatAt(1,200);site.plumbing.loaded+=1;site.thermal.waterLoaded+=other.waterPipe.heat;
 const sealed={...other.waterPipe},before=physical(s),inventory=totalResources(s),dry={...node.gas};
 for(let i=0;i<12;i++)updateWaterVapor(s);
 const after=physical(s),remaining=totalResources(s);
 assert.ok(site.vapor.floorEvaporated>0);assert.ok(site.vapor.nodeCondensed>0);assert.ok(node.condensate.water>0);assert.ok(node.gas.vapor<2);
 close(after.water+after.vacuum-before.vacuum,before.water,'water including exterior loss');
 close(after.heat+after.gasExport-before.gasExport+after.waterExport-before.waterExport,before.heat,'full sensible and latent energy');
 close(remaining.water+after.vacuum-before.vacuum,inventory.water,'resource inventory follows both vapor owners');close(remaining.air,inventory.air,'water vapor never becomes breathing-mix stock');
 for(const key of ['oxygen','inert','co2'])close(node.gas[key],dry[key],key);
 assert.deepEqual(other.waterPipe,sealed,'sealed water plumbing gains no invented headspace or condensate');
 validateWaterVapor(s);validateGasNetworks(s);validateThermal(s);
});

test('vacuum evaporation exports full vapor enthalpy and leaves frozen-only exterior water intact',()=>{
 const s=createGame(74263),site=s.sites.surface;
 const exterior=site.tiles.filter(t=>t.terrain==='ground'&&!t.building&&t.liquid===0&&!roomAt(site,t.x,t.y,t.z)).slice(0,2);assert.equal(exterior.length,2);
 const [warm,ice]=exterior;seedFloor(site,warm,2,300);seedFloor(site,ice,2,100);
 const before=physical(s),initialHeat=warm.liquidHeat,frozen={mass:ice.liquid,heat:ice.liquidHeat};
 assert.equal(startRecording(s).active,true);updateWaterVapor(s);
 const evaporated=2-warm.liquid,after=physical(s);assert.ok(evaporated>0&&evaporated<=.1);
 close(initialHeat-warm.liquidHeat,evaporated*(300+540));assert.deepEqual({mass:ice.liquid,heat:ice.liquidHeat},frozen);
 close(after.water+after.vacuum-before.vacuum,before.water);close(after.heat+after.gasExport-before.gasExport,before.heat);
 const event=rows(s).find(row=>row.event?.id==='water.evaporated'&&row.event.from===tileEntityId(site.id,warm.x,warm.y,warm.z))?.event;
 assert.ok(event);assert.equal(event.to,`space:${site.id}`);assert.equal(event.toSlot,'vacuum');close(event.amount,evaporated);close(event.energy,evaporated*840);close(event.latentEnergy,evaporated*540);
 validateWaterVapor(s);validateThermal(s);
});

test('dismantled upper-deck condensate uses only local floor capacity and explicitly exports inaccessible remainder',()=>{
 const site={id:'custody',size:5,tiles:[],rooms:[],verticalLinks:[],utilityLinks:[],atmosphere:{tick:0,injected:emptyGas(),vented:emptyGas(),breathed:0,refilled:0},gasNetwork:{loaded:emptyGas(),extracted:emptyGas(),delivered:emptyGas(),vented:emptyGas(),smoke:{captured:0,released:0,vented:0}},thermal:{gasVented:0,gasLoaded:0,waterRemoved:0},fireSafety:{smokeVented:0},liquids:{released:0},vapor:{initial:0,floorEvaporated:0,floorCondensed:0,nodeEvaporated:0,nodeCondensed:5,vacuumEvaporated:0,condensateReleased:0,condensateLost:0}};
 for(let z=0;z<2;z++)for(let y=0;y<5;y++)for(let x=0;x<5;x++)site.tiles.push({x,y,z,terrain:'floor',building:z?'wall':null,hp:100,pipe:null,liquid:0,liquidHeat:0});
 site.levels=[{z:0,name:'Ground'},{z:1,name:'Upper deck'}];
 const s={tick:0,sites:{custody:site},crew:[],jobs:[]},upper=at(site,2,2,1),lower=at(site,2,2,0);upper.building=null;upper.pipe=newPipe();upper.pipe.condensate={water:5,heat:1500};site.gasNetwork.loaded.vapor=5;
 // A disconnected water pipe is an independent owner, even at the release tile.
 upper.waterPipe=newWaterPipe();upper.waterPipe.water=1;upper.waterPipe.heat=200;const sealed={...upper.waterPipe};
 removeGas(s,site,upper,true);
 assert.equal(upper.pipe,null);close(upper.liquid,4);close(upper.liquidHeat,1200);close(lower.liquid,0);close(lower.liquidHeat,0);
 close(site.vapor.condensateReleased,4);close(site.vapor.condensateLost,1);close(site.liquids.released,4);close(site.thermal.waterRemoved,300);
 close(upper.liquid+site.vapor.condensateLost,5);close(upper.liquidHeat+site.thermal.waterRemoved,1500);assert.deepEqual(upper.waterPipe,sealed);
 assert.ok(site.tiles.filter(t=>t!==upper).every(t=>t.liquid===0),'no remote floor receives a spill');validateWaterVapor(s);validateGasNetworks(s);
});

test('observations and named conversions retain stable owners, quantities and enthalpy without changing the simulation',()=>{
 const s=createGame(74263),site=s.sites.surface,t=dryFloor(site),node=seedPipe(site,t);seedFloor(site,t,1,350);const control=structuredClone(s);
 assert.equal(startRecording(s).active,true);updateWaterVapor(s);updateWaterVapor(control);capture(s,'tick');
 assert.equal(serialize(s),serialize(control),'recording cannot alter phase changes, ledgers or RNG');
 const saved=serialize(s),view=observe(s),id=tileEntityId(site.id,t.x,t.y,t.z),entry=view.entities[id],phase=waterPhase(node.condensate);
 assert.equal(view.schemaVersion,16);close(entry.pipe.gas.vapor,node.gas.vapor);close(entry.pipe.condensate.water,phase.total);close(entry.pipe.condensate.heat,node.condensate.heat);close(entry.derived.condensate,node.condensate.water);
 assert.equal(entry.derived.condensatePhase.phase,phase.phase);close(entry.derived.condensatePhase.liquid,phase.liquid);close(entry.derived.condensatePhase.ice,phase.ice);close(entry.derived.condensateTemperature,phase.kelvin-273.15);
 const room=roomAt(site,t.x,t.y,t.z),roomId=roomEntityId(site.id,room),vapor=view.entities[roomId].derived.vapor;
 assert.ok(room.gas.vapor>0);close(vapor.amount,room.gas.vapor);assert.ok(vapor.partialPressure>0&&Number.isFinite(vapor.partialPressure));assert.ok(vapor.saturationPressure>0&&Number.isFinite(vapor.saturationPressure));
 close(vapor.partialPressure,room.gas.vapor/(10*room.volume)*roomKelvin(room)/293.15);close(vapor.relativeHumidity,vapor.partialPressure/vapor.saturationPressure);
 const zero=structuredClone(s),zeroRoom=zero.sites.surface.rooms.find(r=>roomEntityId(site.id,r)===roomId);zeroRoom.heat=zeroRoom.gas.vapor*540;
 const zeroVapor=observe(zero).entities[roomId].derived.vapor;close(zeroVapor.partialPressure,0);close(zeroVapor.saturationPressure,0);assert.equal(zeroVapor.relativeHumidity,null);
 const event=rows(s).find(row=>row.event?.id==='water.condensed'&&row.event.from===id&&row.event.to===id)?.event;
 assert.ok(event);assert.equal(event.fromSlot,'pipe.gas');assert.equal(event.toSlot,'pipe.condensate');assert.ok(Number.isFinite(event.temperature));assert.ok(event.energy>0);close(event.amount,node.condensate.water);close(event.latentEnergy,event.amount*540);
 assert.ok(rows(s).some(row=>row.changes?.some(change=>change.entity===id&&change.path?.includes('condensate'))),'typed state changes preserve retained-water ownership');
 assert.equal(serialize(s),saved,'observation never stores derived phases');validateThermal(s);validateWaterVapor(s);
});

test('player and agent valve actions and full ticks continue identically after a vapor-bearing save reload',()=>{
 const s=createGame(74263),site=s.sites.surface,t=dryFloor(site);seedPipe(site,t);seedFloor(site,t,1,350);updateWaterVapor(s);refreshAtmosphere(site);
 assert.ok(t.pipe.condensate.water>0);const copy=deserialize(serialize(s));assert.equal(serialize(copy),serialize(s));
 const args={site:site.id,x:t.x,y:t.y,z:t.z,open:true};assert.equal(startRecording(s).active,true);
 assert.equal(executeAction(s,'gas.valve',args,'player').ok,true);assert.equal(createAgentInterface(()=>copy).act('gas.valve',args).ok,true);
 step(s,6);step(copy,6);assert.equal(serialize(s),serialize(copy),'save continuation preserves RNG, coupled physics, controls and ledgers exactly');
 assert.equal(serialize(deserialize(serialize(s))),serialize(s));validateThermal(s);validateWaterVapor(s);
});
