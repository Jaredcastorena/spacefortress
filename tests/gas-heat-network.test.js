import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { tileAt } from '../src/spatial.js';
import { GASES, emptyGas, gasAmount, mix, roomAt, refreshAtmosphere } from '../src/atmosphere.js';
import { GAS_REFERENCE_KELVIN, gasEnergy, roomHeatCapacity, roomKelvin, nodeKelvin, parcelHeat } from '../src/gas-thermal.js';
import { roomPressure } from '../src/room-pressure.js';
import { initializeGasTile, newPipe, gasNode, gasPayload, gasPressure, gasStatus, updateGasNetworks, releaseGas, removeGas, validateGasNetworks } from '../src/gas-networks.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

const close=(a,b,label='quantity')=>assert.ok(Math.abs(a-b)<1e-7,`${label}: ${a} != ${b}`);
const plus=(a,b)=>{for(const k of GASES)a[k]+=b[k];};
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
function fixture(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 return {s,site};
}
function pipe(site,x,y,z=0){const t=at(site,x,y,z);t.pipe=newPipe();return t;}
function device(site,kind,x=11,y=9,z=0){
 const t=at(site,x,y,z);assert.equal(t.building,null);t.building=kind;t.hp=100;t.powered=true;initializeGasTile(t);
 if(kind==='gasTank')t.machine={enabled:false,input:{},status:''};
 return t;
}
// Synthetic finite subsystem owners. Tests measure native transfers after this
// explicit species/energy boundary; these fixtures do not claim paid construction.
function seed(site,t,gas,kelvin,smoke=0){
 const node=gasNode(t);node.gas={...gas};node.heat=gasEnergy(gas,kelvin);node.smoke=smoke;
 plus(site.gasNetwork.loaded,gas);site.gasNetwork.smoke.captured+=smoke;site.thermal.gasLoaded+=node.heat;
}
function roomState(site,t,amount,kelvin,smoke=0){
 const room=roomAt(site,t.x,t.y,t.z);room.gas=mix(amount);room.smoke=smoke;room.heat=roomHeatCapacity(room)*kelvin;refreshAtmosphere(site);return room;
}
const energy=site=>site.rooms.reduce((n,r)=>n+r.heat,0)+site.tiles.reduce((n,t)=>n+(gasNode(t)?.heat||0),0)+site.thermal.gasVented-site.thermal.gasLoaded;
function species(site){
 const total={...site.gasNetwork.vented};for(const r of site.rooms)plus(total,r.gas);for(const t of site.tiles)if(gasNode(t))plus(total,gasNode(t).gas);return total;
}
function conserved(site,before){for(const k of GASES)close(species(site)[k],before[k],k);}
const record=s=>assert.equal(startRecording(s,{maxRecords:100,maxBytes:32000000}).active,true);
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('empty nodes have no temperature and occupied node pressure uses stored energy',()=>{
 const {s,site}=fixture(),a=pipe(site,9,9);assert.equal(a.pipe.heat,0);assert.equal(gasStatus(site,a).temperature,null);assert.equal(gasPressure(a),0);
 seed(site,a,mix(2),100);close(gasPressure(a),80*100/GAS_REFERENCE_KELVIN);close(gasStatus(site,a).temperature,-173.15);close(gasStatus(site,a).heat,40);validateGasNetworks(s);
});

test('passive flow follows hot gas pressure and conserves each species and heat',()=>{
 const {s,site}=fixture(),a=pipe(site,9,9),b=pipe(site,10,9);seed(site,a,mix(2),600);seed(site,b,{oxygen:0,inert:3,co2:1},100);
 const before=species(site),heat=energy(site);assert.ok(gasPressure(a)>gasPressure(b));updateGasNetworks(s);
 assert.ok(gasAmount(a.pipe.gas)<2);assert.ok(gasAmount(b.pipe.gas)>4);assert.ok(gasAmount(b.pipe.gas)-4<=2);conserved(site,before);close(energy(site),heat);validateGasNetworks(s);
});

test('identical gas mixtures exchange heat at equal pressure without changing quantities',()=>{
 const {s,site}=fixture(),a=pipe(site,9,9),b=pipe(site,10,9);seed(site,a,mix(2),600);seed(site,b,mix(4),300);
 const heat=energy(site),before=species(site);close(gasPressure(a),gasPressure(b));record(s);updateGasNetworks(s);
 close(gasAmount(a.pipe.gas),2);close(gasAmount(b.pipe.gas),4);assert.ok(nodeKelvin(a.pipe)<600);assert.ok(nodeKelvin(b.pipe)>300);close(energy(site),heat);conserved(site,before);
 const event=events(s).find(e=>e.id==='gas.mixed');assert.ok(event);close(event.forwardHeat,parcelHeat(.04,600));close(event.backwardHeat,parcelHeat(.04,300));validateGasNetworks(s);
});

test('isothermal passive transfer preserves both node temperatures',()=>{
 const {s,site}=fixture(),a=pipe(site,9,9),b=pipe(site,10,9);seed(site,a,mix(8),330);seed(site,b,mix(2),330);const before=energy(site);
 updateGasNetworks(s);close(gasAmount(a.pipe.gas),6);close(gasAmount(b.pipe.gas),4);close(nodeKelvin(a.pipe),330);close(nodeKelvin(b.pipe),330);close(energy(site),before);
});

test('pumps carry proportional gas energy while respecting payload rate and destination capacity',()=>{
 const {s,site}=fixture(),tank=device(site,'gasTank',11,8),pump=device(site,'gasPump',12,9),out=pipe(site,13,9);
 pump.gasDevice.direction='se';seed(site,tank,mix(4),600,2);seed(site,out,mix(8),100);const before=energy(site),gasBefore=species(site);
 assert.ok(gasPressure(tank)<gasPressure(out));record(s);updateGasNetworks(s);
 close(gasPayload(out),10);close(gasPayload(tank),4);close(out.pipe.heat,320);close(tank.gasStore.heat,320);close(energy(site),before);conserved(site,gasBefore);
 const event=events(s).find(e=>e.id==='gas.transferred'&&e.reason==='pump');assert.ok(event);close(event.amount,2);close(event.smoke,2/3);close(event.heat,160);validateGasNetworks(s);
});

for(const kelvin of [100,800])test(`vent at ${kelvin} K reaches target using final room temperature and finite gas`,()=>{
 const {s,site}=fixture(),vent=device(site,'gasVent'),room=roomAt(site,vent.x,vent.y,vent.z);
 roomState(site,vent,room.volume*10-.5,GAS_REFERENCE_KELVIN);seed(site,vent,mix(4),kelvin,1);const before=species(site),heat=energy(site),temperature=roomKelvin(room);
 updateGasNetworks(s);close(roomPressure(room),100);assert.ok(gasPayload(vent)>2);assert.ok(kelvin<temperature?roomKelvin(room)<temperature:roomKelvin(room)>temperature);
 close(energy(site),heat);conserved(site,before);assert.match(gasStatus(site,vent).blocked,/target pressure/);validateGasNetworks(s);
});

test('warm inlet gas heats a zero-K room within the finite vent rate',()=>{
 const {s,site}=fixture(),vent=device(site,'gasVent'),room=roomState(site,vent,0,0);seed(site,vent,mix(4),500,1);const heat=energy(site);
 assert.equal(gasStatus(site,vent).blocked,null);updateGasNetworks(s);close(gasPayload(vent),3);close(gasAmount(room.gas),1.6);assert.ok(roomKelvin(room)>0);assert.ok(roomPressure(room)>0);close(energy(site),heat);
});

for(const mode of ['filter','exhaust'])test(`${mode} extraction carries only gas energy and preserves source temperature`,()=>{
 const {s,site}=fixture(),extractor=device(site,'gasExtractor'),room=roomAt(site,extractor.x,extractor.y,extractor.z);extractor.gasDevice.mode=mode;
 roomState(site,extractor,room.volume*10,420,2);if(mode==='filter'){room.gas.oxygen-=2;room.gas.co2+=2;}
 const before=species(site),heat=energy(site);updateGasNetworks(s);close(gasPayload(extractor),2);close(roomKelvin(room),420);close(nodeKelvin(extractor.gasStore),420);close(energy(site),heat);conserved(site,before);validateGasNetworks(s);
});

test('full wall-pipe release divides heat between actual room and exterior and empties exactly',()=>{
 const {s,site}=fixture(),wall=pipe(site,11,12),room=roomAt(site,11,11);seed(site,wall,mix(4),500,2);const before=species(site),heat=energy(site),roomHeat=room.heat;
 record(s);releaseGas(s,site,wall,Infinity,'dismantled');
 assert.equal(wall.pipe.heat,0);assert.equal(gasAmount(wall.pipe.gas),0);assert.equal(wall.pipe.smoke,0);assert.ok(room.heat>roomHeat);assert.ok(site.thermal.gasVented>0);close(room.heat-roomHeat+site.thermal.gasVented,400);close(energy(site),heat);conserved(site,before);
 const released=events(s).filter(e=>e.id==='gas.released');assert.equal(released.length,2);close(released.reduce((n,e)=>n+e.heat,0),400);validateGasNetworks(s);
});

test('smoke-only diffusion and dismantling move no energy and leave no temperature',()=>{
 const {s,site}=fixture(),a=pipe(site,9,9),b=pipe(site,10,9);seed(site,a,emptyGas(),0,4);const heat=energy(site);
 updateGasNetworks(s);assert.ok(b.pipe.smoke>0);assert.equal(a.pipe.heat,0);assert.equal(b.pipe.heat,0);assert.equal(gasStatus(site,b).temperature,null);
 removeGas(s,site,a,true);assert.equal(a.pipe,null);close(energy(site),heat);validateGasNetworks(s);
});

test('delivered-air loading brings reference-temperature energy across the recorded boundary',()=>{
 const {s,site}=fixture(),tank=device(site,'gasTank');tank.machine.enabled=true;tank.machine.input.air=3;tank.gasStore.open=false;const heat=energy(site);
 record(s);updateGasNetworks(s);close(gasAmount(tank.gasStore.gas),2);close(tank.machine.input.air,1);close(nodeKelvin(tank.gasStore),GAS_REFERENCE_KELVIN);close(site.thermal.gasLoaded,parcelHeat(2,GAS_REFERENCE_KELVIN));close(energy(site),heat);
 const event=events(s).find(e=>e.id==='gas.loaded');close(event.heat,tank.gasStore.heat);validateGasNetworks(s);
});

test('vertical gas risers share heat transfer and isolation across actual floors',()=>{
 const {s,site}=fixture();site.levels.push({z:1,name:'Upper'});site.tiles.push(...site.tiles.map(t=>({...structuredClone(t),z:1})));site.rooms.push(...site.rooms.map(r=>({...structuredClone(r),z:1})));
 const lower=pipe(site,9,9),upper=pipe(site,9,9,1),link={id:'utility-1',kind:'gas',lower:{x:9,y:9,z:0},upper:{x:9,y:9,z:1},hp:100,enabled:false};
 site.utilityLinks.push(link);lower.risers={gas:link.id};upper.risers={gas:link.id};seed(site,lower,mix(2),600);const heat=energy(site);updateGasNetworks(s);assert.equal(upper.pipe.heat,0);
 link.enabled=true;record(s);updateGasNetworks(s);close(gasAmount(upper.pipe.gas),1);close(nodeKelvin(upper.pipe),600);close(energy(site),heat);
 const event=events(s).find(e=>e.id==='gas.transferred'&&e.connection===link.id);assert.ok(event);assert.equal(event.to,'tile:surface:9:9:1');close(event.heat,120);validateGasNetworks(s);
});

test('current network validation rejects missing, negative, nonfinite and empty-node energy',()=>{
 for(const value of [undefined,-1,Infinity,NaN,1]){
  const {s,site}=fixture(),t=pipe(site,9,9);if(value===undefined)delete t.pipe.heat;else t.pipe.heat=value;
  assert.throws(()=>validateGasNetworks(s),/pipe gas heat/);
 }
 const {s,site}=fixture(),t=pipe(site,9,9);delete t.pipe.heat;assert.doesNotThrow(()=>validateGasNetworks(s,{legacyHeat:true}));
 seed(site,t,mix(1),0);assert.doesNotThrow(()=>validateGasNetworks(s));assert.equal(gasPressure(t),0);
});
