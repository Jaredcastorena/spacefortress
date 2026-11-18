import test from 'node:test';
import assert from 'node:assert/strict';
import {waterPhase,waterKelvin,waterHeatAt,parcelHeat,takeWater,putWater,exchangeWaterHeat,WATER_LATENT_HEAT,ICE_HEAT_CAPACITY} from '../src/water-thermal.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
const melting=273.15,cold=melting-WATER_LATENT_HEAT;

test('melting uses finite latent energy at zero Celsius before warming liquid',()=>{
 const owner={water:2,heat:2*cold};assert.equal(waterPhase(owner).ice,2);
 owner.heat+=WATER_LATENT_HEAT;let p=waterPhase(owner);close(p.liquid,1);close(p.ice,1);close(p.kelvin,melting);
 owner.heat+=WATER_LATENT_HEAT;p=waterPhase(owner);close(p.liquid,2);assert.equal(p.ice,0);close(p.kelvin,melting);
 owner.heat+=20;close(waterKelvin(owner),melting+10);
});

test('ice has nonnegative energy down to absolute zero and empty owners have no phase temperature',()=>{
 for(const kelvin of [0,1,100,263.15]){const owner={water:3,heat:waterHeatAt(3,kelvin)};assert.ok(owner.heat>=0);close(waterKelvin(owner),kelvin);assert.equal(waterPhase(owner).ice,3);}
 assert.deepEqual(waterPhase({water:0,heat:0}),{total:0,liquid:0,ice:0,kelvin:null,phase:'empty'});
});

test('a liquid withdrawal from slush retains all ice and its energy',()=>{
 const owner={water:1,heat:cold+WATER_LATENT_HEAT*.5},heat=owner.heat;
 const carried=takeWater(owner,.25);close(carried,.25*melting);close(owner.heat+carried,heat);
 close(waterPhase(owner).ice,.5);close(waterPhase(owner).liquid,.25);
 const before=structuredClone(owner);assert.throws(()=>takeWater(owner,.5));assert.deepEqual(owner,before);
});

test('adding hot liquid melts ice by its actual finite energy while retaining total mass',()=>{
 const owner={water:1,heat:waterHeatAt(1,263.15)},before=owner.heat;
 putWater(owner,1,parcelHeat(1,300));const p=waterPhase(owner);
 assert.equal(p.total,2);close(owner.heat,before+300);assert.ok(p.ice>0&&p.ice<1);close(p.kelvin,melting);
});

test('liquid cannot be extracted from solid ice and zero withdrawal changes nothing',()=>{
 const owner={water:2,heat:waterHeatAt(2,260)},before=structuredClone(owner);
 assert.throws(()=>takeWater(owner,.001));assert.equal(takeWater(owner,0),0);assert.deepEqual(owner,before);
});

test('finite room exchange conserves energy and cannot overshoot either initial temperature',()=>{
 for(const mass of [1e-9,1,32])for(const from of [0,200,melting,300,900])for(const to of [0,250,melting,350]){
  const owner={water:mass,heat:waterHeatAt(mass,from)},roomCapacity=20,initial=owner.heat+roomCapacity*to;
  const moved=exchangeWaterHeat(owner,to,roomCapacity,.8),room=to+moved/roomCapacity,t=waterKelvin(owner);
  close(owner.heat+roomCapacity*room,initial);assert.ok(t>=Math.min(from,to)-1e-7&&t<=Math.max(from,to)+1e-7);assert.ok(room>=Math.min(from,to)-1e-7&&room<=Math.max(from,to)+1e-7);
 }
});

test('full exchange reaches a common temperature through the melting plateau',()=>{
 const owner={water:2,heat:2*cold},roomCapacity=1,to=melting+40,initial=owner.heat+roomCapacity*to;
 const moved=exchangeWaterHeat(owner,to,roomCapacity,1),p=waterPhase(owner);
 close(p.kelvin,melting);close(to+moved/roomCapacity,melting);close(p.liquid,.5);close(owner.heat+roomCapacity*(to+moved/roomCapacity),initial);
});

test('an exactly zero-Celsius contact does not invent phase conversion in tiny slush parcels',()=>{
 const owner={water:1e-9,heat:1e-9*(cold+WATER_LATENT_HEAT*.5)},before=structuredClone(owner);
 assert.equal(exchangeWaterHeat(owner,melting,100000,1),0);assert.deepEqual(owner,before);
 assert.equal(exchangeWaterHeat(owner,melting,Infinity,1),0);assert.deepEqual(owner,before);
});

test('cold exterior freezes water without changing its quantity and warm exterior thaws it',()=>{
 const owner={water:1,heat:parcelHeat(1,300)},initial=owner.heat;
 const removed=exchangeWaterHeat(owner,250,Infinity,1);assert.equal(owner.water,1);close(owner.heat+removed,initial);close(waterPhase(owner).ice,1);close(waterKelvin(owner),250);
 const added=-exchangeWaterHeat(owner,300,Infinity,1);close(added,removed);close(owner.heat,initial);assert.equal(waterPhase(owner).ice,0);
});

test('invalid thermal contact is rejected before mutation',()=>{
 for(const [k,c,r] of [[-1,20,.1],[300,0,.1],[300,NaN,.1],[300,20,2]]){
  const owner={water:1,heat:300};assert.throws(()=>exchangeWaterHeat(owner,k,c,r));assert.deepEqual(owner,{water:1,heat:300});
 }
 assert.ok(ICE_HEAT_CAPACITY>0&&ICE_HEAT_CAPACITY<1);
});
