import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import {createGame, at, step, order, serialize, deserialize, pathTo} from '../src/simulation.js';
import {initializeStorage, totalResources, syncResources} from '../src/inventory.js';
import {initializeElectrical, refreshPower, updatePower} from '../src/power.js';
import {haul} from '../src/industry.js';
import {GASES, GAS_PER_TILE, emptyGas, gasAmount, roomAt, refreshAtmosphere} from '../src/atmosphere.js';
import {GAS_NETWORK, gasPayload, gasStatus, updateGasNetworks, setGasValve, setGasExtractor} from '../src/gas-networks.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const check=s=>{syncResources(s);return deserialize(serialize(s));};
function base(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 refreshPower(s,site);return {s,site};
}
function install(s,kind,x=11,y=9){
 const t=at(s.sites.surface,x,y);assert.equal(t.building,null);t.building=kind;t.hp=100;
 initializeStorage(t);initializeElectrical(t);return t;
}
function fixture(){
 const f=base(),extractor=install(f.s,'gasExtractor'),room=roomAt(f.site,11,9);
 for(let x=8;x<=13;x++)at(f.site,x,9).cable={enabled:true,hp:100};
 refreshPower(f.s,f.site);return {...f,extractor,room};
}
function pollute(site,room,co2=6,smoke=2){
 // Convert existing oxygen into the contaminant fixture; smoke has its own ledger.
 room.gas.oxygen-=co2;room.gas.co2+=co2;room.smoke+=smoke;
 site.fireSafety.smokeProduced+=smoke;refreshAtmosphere(site);
}
function until(s,p,max=240){for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),'Condition not reached');}

test('extractors and empty reservoirs require physically delivered construction supplies',()=>{
 const {s,site}=base(),before=totalResources(s);
 const result=order(s,'surface',11,9,'build','gasExtractor');assert.ok(result.ok);
 assert.deepEqual(result.job.cost,{alloy:6,components:1});assert.equal(result.job.work,10);
 assert.equal(at(site,11,9).gasStore,undefined);assert.deepEqual(result.job.materials,{});
 until(s,()=>Object.keys(result.job.materials).length>0);assert.equal(at(site,11,9).building,null);
 close(totalResources(s).alloy,before.alloy);until(s,()=>at(site,11,9).building==='gasExtractor');
 assert.deepEqual(at(site,11,9).gasDevice,{enabled:true,mode:'filter',target:100});
 assert.deepEqual(at(site,11,9).gasStore.gas,emptyGas());close(at(site,11,9).gasStore.smoke,0);
 const receiver=order(s,'surface',12,9,'build','gasReservoir');assert.ok(receiver.ok);
 assert.deepEqual(receiver.job.cost,{alloy:6,components:1});assert.equal(receiver.job.work,10);
 until(s,()=>at(site,12,9).building==='gasReservoir');
 assert.deepEqual(at(site,12,9).gasStore.gas,emptyGas());close(at(site,12,9).gasStore.smoke,0);
 assert.equal(at(site,12,9).machine,undefined);assert.equal(at(site,12,9).gasDevice,undefined);
 close(totalResources(s).alloy,before.alloy-12);close(totalResources(s).components,before.components-2);
 assert.equal(order(s,'surface',11,9,'build','gasPipe').ok,false);
 assert.equal(order(s,'surface',12,14,'build','gasExtractor').ok,false);
 assert.equal(order(s,'surface',12,14,'build','gasReservoir').ok,false);check(s);
});

test('a passive reservoir never requests breathing mix or fills itself from depot stock',()=>{
 const {s,site}=base(),reservoir=install(s,'gasReservoir'),c=s.crew[1],before=totalResources(s).air;
 c.labors.hauling=true;c.x=8;c.y=10;
 for(let i=0;i<25;i++){assert.equal(haul(s,c,site,pathTo),false);updateGasNetworks(s);}
 close(gasPayload(reservoir),0);close(totalResources(s).air,before);
 assert.equal(reservoir.machine,undefined);assert.equal(reservoir.powered,false);check(s);
});

test('filter captures a finite CO2 and smoke payload while preserving room oxygen and inert gas',()=>{
 const {s,site,extractor,room}=fixture();pollute(site,room,6,2);
 const initial={...room.gas},used=site.energy.consumed;
 updatePower(s,site);assert.equal(extractor.powered,true);close(site.energy.consumed-used,3);
 updateGasNetworks(s);close(gasPayload(extractor),GAS_NETWORK.extract);
 close(extractor.gasStore.gas.co2,1.5);close(extractor.gasStore.smoke,.5);
 close(room.gas.oxygen,initial.oxygen);close(room.gas.inert,initial.inert);close(room.gas.co2,4.5);close(room.smoke,1.5);
 close(site.gasNetwork.extracted.co2,1.5);close(site.gasNetwork.smoke.captured,.5);
 close(site.fireSafety.smokeCleared,0);close(site.fireSafety.smokeVented,0);
 for(let i=0;i<8;i++)updateGasNetworks(s);
 close(room.gas.co2,0);close(room.smoke,0);close(gasPayload(extractor),8);
 assert.ok(gasStatus(site,extractor).blocked);check(s);
});

test('a full extractor stops capture until its retained contents have an outlet',()=>{
 const {s,site,extractor,room}=fixture();pollute(site,room,18,6);
 for(let i=0;i<8;i++)updateGasNetworks(s);
 close(gasPayload(extractor),GAS_NETWORK.pipeCapacity);assert.match(gasStatus(site,extractor).blocked,/full/i);
 const retained=structuredClone(extractor.gasStore),remaining={gas:{...room.gas},smoke:room.smoke};
 for(let i=0;i<8;i++)updateGasNetworks(s);
 assert.deepEqual(extractor.gasStore,retained);assert.deepEqual({gas:room.gas,smoke:room.smoke},remaining);check(s);
});

test('exhaust removes the room mixture proportionally and stops exactly at its target pressure',()=>{
 const {s,site,extractor,room}=fixture();pollute(site,room,8,4);
 const target=99,amount=gasAmount(room.gas),initial={...room.gas},smoke=room.smoke;
 assert.ok(setGasExtractor(s,'surface',11,9,true,'exhaust',target).ok);
 for(let i=0;i<8;i++)updateGasNetworks(s);
 const expected=amount-room.volume*GAS_PER_TILE*target/100;
 for(const k of GASES)close(extractor.gasStore.gas[k],initial[k]*expected/amount);
 close(extractor.gasStore.smoke,smoke*expected/amount);close(room.pressure,target);
 assert.match(gasStatus(site,extractor).blocked,/target pressure/i);
 const retained=structuredClone(extractor.gasStore);updateGasNetworks(s);assert.deepEqual(extractor.gasStore,retained);check(s);
});

test('exhaust at target does not remove smoke, while filter mode can collect it',()=>{
 const {s,site,extractor,room}=fixture();pollute(site,room,0,4);
 setGasExtractor(s,'surface',11,9,true,'exhaust',100);updateGasNetworks(s);
 close(gasPayload(extractor),0);close(room.smoke,4);
 setGasExtractor(s,'surface',11,9,true,'filter',100);updateGasNetworks(s);
 close(gasAmount(extractor.gasStore.gas),0);close(extractor.gasStore.smoke,2);close(room.smoke,2);check(s);
});

test('disabled, isolated and unpowered extractors stop capture and expose their obstruction',()=>{
 const {s,site,extractor,room}=fixture();pollute(site,room);
 assert.ok(setGasExtractor(s,'surface',11,9,false,'filter',100).ok);
 const used=site.energy.consumed;updatePower(s,site);close(site.energy.consumed,used);close(site.power.demand,0);
 updateGasNetworks(s);close(gasPayload(extractor),0);assert.match(gasStatus(site,extractor).blocked,/disabled/i);
 setGasExtractor(s,'surface',11,9,true,'filter',100);setGasValve(s,'surface',11,9,false);
 updateGasNetworks(s);close(gasPayload(extractor),0);assert.match(gasStatus(site,extractor).blocked,/valve closed/i);
 setGasValve(s,'surface',11,9,true);extractor.cable.enabled=false;refreshPower(s,site);
 updateGasNetworks(s);close(gasPayload(extractor),0);assert.match(gasStatus(site,extractor).blocked,/no power/i);
 extractor.cable.enabled=true;refreshPower(s,site);updateGasNetworks(s);close(gasPayload(extractor),2);check(s);
});

test('damaged extractor throughput scales with condition without granting replacement gas',()=>{
 const {s,site,extractor,room}=fixture();pollute(site,room);extractor.hp=50;
 updateGasNetworks(s);close(gasPayload(extractor),GAS_NETWORK.extract*.5);
 close(extractor.gasStore.gas.co2,.75);close(extractor.gasStore.smoke,.25);check(s);
});

test('dismantling an isolated extractor releases its retained contaminants into the compartment',()=>{
 const {s,site,extractor,room}=fixture();pollute(site,room,3,1);updateGasNetworks(s);
 const gas={...extractor.gasStore.gas},smoke=extractor.gasStore.smoke;
 setGasExtractor(s,'surface',11,9,false,'filter',100);setGasValve(s,'surface',11,9,false);
 assert.ok(order(s,'surface',11,9,'remove').ok);until(s,()=>extractor.building===null);
 assert.equal(extractor.gasStore,undefined);assert.equal(extractor.gasDevice,undefined);
 for(const k of GASES)close(site.gasNetwork.delivered[k],gas[k]);close(site.gasNetwork.smoke.released,smoke);
 close(site.gasNetwork.smoke.vented,0);check(s);
});

test('active finite extraction resumes deterministically after saving with retained contaminants',()=>{
 const {s,site,room}=fixture();pollute(site,room,4,1);step(s,3);
 const copy=check(s);assert.equal(copy.version, VERSION);step(s,35);step(copy,35);assert.deepEqual(s,copy);check(s);
});
