import test from 'node:test';
import assert from 'node:assert/strict';
import {takeWater,putWater,loadWater,unloadWater,waterKelvin,parcelHeat} from '../src/water-thermal.js';

test('mixing conserves energy and complete emptying leaves no ghost heat',()=>{
  const hot={water:2,heat:parcelHeat(2,400)},cold={water:3,heat:parcelHeat(3,250)};
  const energy=hot.heat+cold.heat;
  putWater(cold,1,takeWater(hot,1));
  assert.equal(waterKelvin(hot),400);assert.equal(waterKelvin(cold),287.5);
  assert.equal(hot.heat+cold.heat,energy);
  putWater(cold,hot.water,takeWater(hot,hot.water));
  assert.deepEqual(hot,{water:0,heat:0});assert.equal(waterKelvin(hot),null);
  assert.equal(cold.water,5);assert.equal(cold.heat,energy);
});

test('finite repeated transfers preserve water and heat including sub-unit parcels',()=>{
  const floor={liquid:1,liquidHeat:parcelHeat(1,280)},node={water:0,heat:0};
  for(let i=0;i<200;i++){
    const n=Math.min(.0037,floor.liquid);
    putWater(node,n,takeWater(floor,n,{floor:true}));
    putWater(floor,n,takeWater(node,n),{floor:true});
  }
  assert.equal(floor.liquid,1);assert.ok(Math.abs(floor.liquidHeat-280)<1e-9);
  assert.deepEqual(node,{water:0,heat:0});
});

test('boundary imports and exports account energy once at actual export temperature',()=>{
  const site={thermal:{waterLoaded:0,waterRemoved:0}},floor={liquid:0,liquidHeat:0};
  loadWater(site,floor,1,{floor:true});assert.equal(site.thermal.waterLoaded,293.15);
  floor.liquidHeat=400;
  assert.equal(unloadWater(site,floor,.25,{floor:true}),100);
  assert.equal(site.thermal.waterRemoved,100);assert.equal(waterKelvin(floor,{floor:true}),400);
});

test('invalid parcels and invalid owners fail before any quantity or heat changes',()=>{
  for(const action of [o=>takeWater(o,3),o=>takeWater(o,-1),o=>takeWater(o,NaN),o=>putWater(o,0,1),o=>putWater(o,1,Infinity),o=>putWater(o,-1,2)]){
    const owner={water:2,heat:500},before=structuredClone(owner);
    assert.throws(()=>action(owner));assert.deepEqual(owner,before);
  }
  assert.throws(()=>takeWater({water:0,heat:1},0));
  assert.throws(()=>putWater({water:0},1,293));
});
