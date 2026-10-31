import test from 'node:test';
import assert from 'node:assert/strict';
import { airlockResourceStatus } from '../src/airlocks.js';
import { airlockGasQuantities, airlockRoomReading } from '../src/airlock-access.js';
import { gasEnergy, gasQuantity, GAS_REFERENCE_KELVIN, roomHeatCapacity } from '../src/gas-thermal.js';
import { releaseGas } from '../src/gas-networks.js';

const mix=(amount,oxygen=.21)=>({oxygen:amount*oxygen,inert:amount*(1-oxygen),co2:0});
const close=(actual,expected,label='value')=>assert.ok(Math.abs(actual-expected)<1e-8,`${label}: ${actual} != ${expected}`);
function room(amount,celsius=20,cells=['0,0','0,1']) {
 const r={volume:2,cells,z:0,sealed:true,gas:mix(amount),smoke:0,gasThermal:true};
 r.heat=roomHeatCapacity(r)*(celsius+273.15);return r;
}
function reserve(amount,celsius=20,oxygen=.21,x=0) {
 const gas=mix(amount,oxygen);
 return {x,y:0,z:0,building:'gasTank',hp:100,gasStore:{gas,smoke:0,heat:gasEnergy(gas,celsius+273.15),open:true},machine:{input:{air:0}}};
}
function layout(nodes=[reserve(30)],chamber=room(.2),habitat=room(20,20,['2,0','2,1'])) {
 return {room:chamber,habitat,recoveryNodes:[],storageNodes:nodes,phaseNodes:{recover:nodes,refill:nodes}};
}
function releaseEnvironment(l) {
 const zero=()=>mix(0),site={id:'surface',rooms:[l.room,l.habitat],atmosphere:{injected:zero(),vented:zero()},gasNetwork:{delivered:zero(),vented:zero(),smoke:{released:0,vented:0}},thermal:{gasVented:0},fireSafety:{smokeVented:0}};
 return {s:{tick:0},site};
}

for(const celsius of [-30,70])test(`finite ${celsius}C refill predicts the actual released species, energy and pressure`,()=>{
 const source=reserve(30,celsius),l=layout([source]),before=JSON.stringify(l),r=airlockResourceStatus(l,'refill',false);
 assert.equal(r.blocker,null);assert.equal(r.target,100);assert.equal(r.fillReachable,true);
 assert.equal(JSON.stringify(l),before,'diagnostics do not transfer gas or heat');
 assert.ok(r.predicted.fillAmount>0&&r.predicted.fillAmount<r.supply);
 assert.ok(celsius<20?r.predicted.fillAmount>19.8:r.predicted.fillAmount<19.8,'inlet temperature changes the finite amount needed');
 const totalGas=gasQuantity(l.room.gas)+gasQuantity(source.gasStore.gas),totalHeat=l.room.heat+source.gasStore.heat,{s,site}=releaseEnvironment(l);
 releaseGas(s,site,source,r.predicted.fillAmount,'vent');
 const actual=airlockRoomReading(l.room);
 for(const key of ['pressure','oxygenPressure','temperature','heat','heatCapacity'])close(actual[key],r.predicted[key],key);
 for(const key of ['oxygen','inert','co2'])close(actual.gas[key],r.predicted.gas[key],key);
 close(actual.pressure,100);close(actual.oxygenPressure,.21);
 close(gasQuantity(l.room.gas)+gasQuantity(source.gasStore.gas),totalGas,'finite gas');
 close(l.room.heat+source.gasStore.heat,totalHeat,'combined heat');
});

test('mixed finite reserves weight species and energy together and ignore packaged input',()=>{
 const a=reserve(10,-20,.1),b=reserve(20,60,.265,4);a.machine.input.air=1000;
 a.gasStore.smoke=.02;b.gasStore.smoke=.04;
 const l=layout([a,b],room(0)),before=JSON.stringify(l),r=airlockResourceStatus(l,'refill',false),fraction=r.predicted.fillAmount/30;
 close(r.supply,30);close(r.supplyHeat,a.gasStore.heat+b.gasStore.heat);
 for(const k of ['oxygen','inert','co2'])close(r.predicted.gas[k],(a.gasStore.gas[k]+b.gasStore.gas[k])*fraction,k);
 close(r.predicted.fillHeat,(a.gasStore.heat+b.gasStore.heat)*fraction);close(r.predicted.smoke,.06*fraction);
 close(r.predicted.heat,l.room.heat+r.predicted.fillHeat);assert.equal(JSON.stringify(l),before);
});

test('a short finite reserve cannot pass admission merely because the request is bounded',()=>{
 const source=reserve(5),l=layout([source],room(0)),r=airlockResourceStatus(l);
 assert.equal(r.blocker,'supply_empty');assert.equal(r.fillReachable,false);assert.equal(r.predicted.targetReachable,false);
 close(r.fillNeeded,5);close(r.predicted.fillAmount,5);close(r.predicted.pressure,25);
 close(r.predicted.fillHeat,source.gasStore.heat);assert.equal(r.target,100);
});

test('zero-energy reserve remains finite and cannot claim an unreachable pressure',()=>{
 const source=reserve(30,-273.15),l=layout([source],room(0)),r=airlockResourceStatus(l);
 assert.equal(r.fillReachable,true,'room structural heat can give zero-K gas a finite pressure');
 assert.equal(r.blocker,'unsafe_temperature');close(r.predicted.fillHeat,0);
 assert.ok(Number.isFinite(r.fillNeeded)&&r.fillNeeded<=r.supply);assert.ok(r.predicted.temperature<5);
 const empty=airlockResourceStatus(layout([reserve(0)],room(0)));
 assert.equal(empty.blocker,'supply_empty');assert.equal(empty.fillReachable,false);close(empty.predicted.fillAmount,0);close(empty.predicted.fillHeat,0);
});

test('a hot reserve is blocked by predicted temperature even with safe current rooms',()=>{
 const l=layout([reserve(30,1000)]),r=airlockResourceStatus(l);
 assert.equal(r.chamber.thermalSafe,true);assert.equal(r.habitat.thermalSafe,true);assert.equal(r.predicted.breathable,true);
 assert.equal(r.predicted.thermalSafe,false);assert.equal(r.blocker,'unsafe_temperature');assert.ok(r.predicted.temperature>35);
});

test('integer target selection preserves oxygen partial-pressure and contamination gates',()=>{
 const l=layout([reserve(25,40,.161)],room(0));l.habitat.heat*=.994;
 const r=airlockResourceStatus(l);assert.equal(r.target,100);assert.equal(r.blocker,null);close(r.predicted.oxygenPressure,.161);
 const dirty=reserve(30);dirty.gasStore.gas={oxygen:6,inert:22,co2:2};dirty.gasStore.heat=gasEnergy(dirty.gasStore.gas,GAS_REFERENCE_KELVIN);
 assert.equal(airlockResourceStatus(layout([dirty],room(0))).blocker,'contaminated_mix');
});

test('minimum pressure tolerance and smoke recovery headroom keep their physical bounds',()=>{
 const enough=airlockResourceStatus(layout([reserve(19.6)],room(0)));
 assert.equal(enough.fillReachable,true);assert.equal(enough.blocker,null);close(enough.predicted.pressure,98);
 const short=airlockResourceStatus(layout([reserve(19.6-1e-7)],room(0)));
 assert.equal(short.fillReachable,false);assert.equal(short.blocker,'supply_empty');
 const chamber=room(20,35);chamber.smoke=2;const l=layout([reserve(60)],chamber),q=airlockGasQuantities(l);
 close(q.recoverNeeded,(20-20/airlockRoomReading(chamber).pressure)*1.1);
 close(q.headroom,20);assert.equal(airlockResourceStatus(l,'recover',false).blocker,'reservoir_full');
});
