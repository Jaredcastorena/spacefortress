import test from 'node:test';
import assert from 'node:assert/strict';
import {GAS_REFERENCE_KELVIN, gasEnergy, roomHeatCapacity, roomKelvin, nodeKelvin, parcelHeat, pressureAfterGas, roomFillAmount, roomEqualizeAmount, initializeGasHeat} from '../src/gas-thermal.js';
const gas = n => ({oxygen:.21*n,inert:.79*n,co2:0});
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-8, `${a} != ${b}`);
const room = (n=10,kelvin=GAS_REFERENCE_KELVIN) => {const r={volume:1,gas:gas(n),gasThermal:true};r.heat=roomHeatCapacity(r)*kelvin;return r;};
test('isothermal gas addition and removal preserve temperature while carrying finite energy',()=>{
 for(const amount of [-4,4]){const r=room(),heat=parcelHeat(amount,roomKelvin(r));r.heat+=heat;r.gas=gas(10+amount);close(roomKelvin(r),GAS_REFERENCE_KELVIN);}
});
test('hot and cold inlet targets use predicted final pressure without mutating the source',()=>{
 for(const kelvin of [100,293.15,900]){const r=room(2),before=JSON.stringify(r),amount=roomFillAmount(r,100,kelvin,100);close(pressureAfterGas(r,amount,parcelHeat(amount,kelvin)),100);assert.equal(JSON.stringify(r),before);assert.ok(amount>0&&amount<100);}
});
test('finite fills stop at their source limit and handle unattainable zero-kelvin targets',()=>{
 const r=room(0,0);assert.equal(roomFillAmount(r,100,0,8),8);assert.equal(roomFillAmount(r,100,293.15,0),0);assert.equal(roomFillAmount(room(20),100,293.15,8),0);assert.throws(()=>roomFillAmount(r,100,293.15,Infinity),/Invalid/);
});
test('empty nodes have zero energy and no invented temperature; mixing conserves heat',()=>{
 assert.equal(nodeKelvin({gas:gas(0),heat:0}),null);const a={gas:gas(3),heat:gasEnergy(gas(3),100)},b={gas:gas(7),heat:gasEnergy(gas(7),500)};close(nodeKelvin({gas:gas(10),heat:a.heat+b.heat}),380);
});
test('legacy initialization preserves room temperature and registers newly modeled energy',()=>{
 const r={volume:2,gas:gas(13),heat:40*310},node={gas:gas(4)},site={rooms:[r],tiles:[{pipe:node}],thermal:{initial:r.heat}},s={sites:{surface:site}};
 initializeGasHeat(s,{legacy:true});close(roomKelvin(r),310);close(nodeKelvin(node),293.15);close(r.heat+node.heat,site.thermal.initial+site.thermal.gasInitial);assert.equal(r.gasThermal,true);assert.equal(site.thermal.gasLoaded,0);assert.equal(site.thermal.gasVented,0);
});

test('room equalization solves final mixed pressure for unlike temperatures',()=>{
 const a=room(20,500),b=room(2,100),moved=roomEqualizeAmount(a,b),heat=parcelHeat(moved,roomKelvin(a));
 close(pressureAfterGas(a,-moved,-heat),pressureAfterGas(b,moved,heat));assert.ok(moved>0&&moved<20);
 assert.equal(roomEqualizeAmount(b,a),0);assert.equal(roomEqualizeAmount(a,null),20);
});
