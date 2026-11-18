import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGas, mix, gasAmount } from '../src/gas-species.js';
import { gasEnergy, gasHeatCapacity, gasLatentHeat, roomStructureCapacity, VAPOR_LATENT_HEAT } from '../src/gas-thermal.js';
import { waterHeatAt, waterPhase, MELTING_KELVIN, WATER_LATENT_HEAT, storedWaterHeat } from '../src/water-thermal.js';
import { saturationPressure, vaporEquilibrium, advanceWaterVaporPair, initializeWaterVapor, updateWaterVapor, validateWaterVapor, releaseNodeCondensate, WATER_VAPOR } from '../src/water-vapor.js';
import { gasCapacity, gasVolumeForWater, gasVolume, newPipe } from '../src/gas-networks.js';
import { tileAt } from '../src/spatial.js';

const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);
const water=(amount,kelvin)=>({water:amount,heat:waterHeatAt(amount,kelvin)});
const gas=(vapor,kelvin,dry=0)=>{const gas={...mix(dry),vapor};return {gas,heat:gasEnergy(gas,kelvin)};};
const pairTotals=(w,g)=>[w.water+g.gas.vapor,w.heat+g.heat];
function conserved(before,w,g){const after=pairTotals(w,g);close(before[0],after[0]);close(before[1],after[1]);assert.ok(w.water>=0&&w.heat>=0&&g.gas.vapor>=0&&g.heat>=gasLatentHeat(g.gas));}
function fixture(){
 const site={id:'surface',size:5,levels:[{z:0},{z:1}],tiles:[],rooms:[],verticalLinks:[],utilityLinks:[],atmosphere:{tick:0,injected:emptyGas(),vented:emptyGas()},gasNetwork:{loaded:emptyGas(),extracted:emptyGas(),delivered:emptyGas(),vented:emptyGas()},thermal:{gasVented:0,waterRemoved:0},liquids:{released:0}};
 for(let z=0;z<=1;z++)for(let y=0;y<5;y++)for(let x=0;x<5;x++)site.tiles.push({x,y,z,terrain:'rock',building:null,hp:100,pipe:null,liquid:0,liquidHeat:0});
 const s={tick:0,sites:{surface:site},jobs:[],crew:[]};initializeWaterVapor(s);
 const floor=(x=2,y=2,z=0)=>{const t=tileAt(site,{x,y,z});t.terrain='floor';return t;};
 const room=(t,vapor=0,kelvin=293.15)=>{const r={id:site.rooms.length+1,z:t.z,cells:[`${t.x},${t.y}`],volume:1,gasThermal:true,smoke:0,...gas(vapor,kelvin,10)};r.heat+=roomStructureCapacity(r)*kelvin;site.rooms.push(r);site.vapor.initial+=vapor;return r;};
 const pipe=(t,vapor=0,kelvin=293.15)=>{t.pipe=newPipe();t.pipe.gas={...emptyGas(),vapor};t.pipe.heat=gasEnergy(t.pipe.gas,kelvin);site.vapor.initial+=vapor;return t.pipe;};
 return {s,site,floor,room,pipe};
}

test('saturation is finite, zero at absolute zero, monotone, and nominal at boiling',()=>{
 assert.equal(saturationPressure(0),0);close(saturationPressure(373.15),1);
 let previous=0;for(const k of [1,100,250,273.15,293.15,373.15,1000]){const value=saturationPressure(k);assert.ok(Number.isFinite(value)&&value>=previous);previous=value;}
 for(const bad of [-1,NaN,Infinity])assert.throws(()=>saturationPressure(bad));
});

test('closed floor evaporation reaches conservative common-temperature saturation',()=>{
 const w=water(3,320),g=gas(0,320,10),before=pairTotals(w,g),target=vaporEquilibrium(w,g,{volume:1});
 assert.ok(target.transfer>0&&target.transfer<3);close(target.residual,0);close(target.water+target.vapor,before[0]);close(target.waterHeat+target.gasHeat,before[1]);
 advanceWaterVaporPair(w,g,{volume:1,rate:1,maxTransfer:100});conserved(before,w,g);
 close(waterPhase(w).kelvin,(g.heat-gasLatentHeat(g.gas))/gasHeatCapacity(g.gas));
});

test('default phase contact applies one fraction to mass and both finite owner energies',()=>{
 const w=water(2,350),g=gas(0,280,10),before=pairTotals(w,g),start=structuredClone(w),initialGas=g.heat,target=vaporEquilibrium(w,g,{volume:1});
 const change=advanceWaterVaporPair(w,g,{volume:1});const fraction=Math.min(.02,.1/Math.abs(target.transfer));
 close(change.amount,target.transfer*fraction);close(w.heat,start.heat+(target.waterHeat-start.heat)*fraction);close(g.heat,initialGas+(target.gasHeat-initialGas)*fraction);conserved(before,w,g);
});

test('phase conversion is capped independently at one tenth water per owner',()=>{
 const w=water(100,1000),g=gas(0,1000,100),before=pairTotals(w,g);
 const change=advanceWaterVaporPair(w,g,{volume:1000});close(change.amount,.1);conserved(before,w,g);
});

test('condensation supports initially empty sinks and conserves heat and water',()=>{
 const w=water(0,0),g=gas(5,290,10),before=pairTotals(w,g),change=advanceWaterVaporPair(w,g,{volume:1});
 assert.ok(change.amount<0&&w.water>0&&w.heat>0);conserved(before,w,g);
});

test('common-temperature solve resolves the zero-Celsius latent melting interval',()=>{
 const w=water(1,MELTING_KELVIN-1);w.heat=MELTING_KELVIN-WATER_LATENT_HEAT;
 const g=gas(.1,MELTING_KELVIN),before=pairTotals(w,g),target=vaporEquilibrium(w,g,{volume:1});
 close(target.kelvin,MELTING_KELVIN);assert.ok(target.transfer<0);
 advanceWaterVaporPair(w,g,{volume:1,rate:1,maxTransfer:10});const phase=waterPhase(w);
 assert.equal(phase.phase,'mixed');assert.ok(phase.liquid>0&&phase.ice>0);conserved(before,w,g);
});

test('cold structures can freeze condensate while preserving the vapor latent floor',()=>{
 const w=water(0,0),g=gas(1,0),before=pairTotals(w,g);
 const change=advanceWaterVaporPair(w,g,{volume:1,structureCapacity:100,rate:1,maxTransfer:10});
 assert.ok(change.amount<0);assert.equal(waterPhase(w).phase,'solid');conserved(before,w,g);
});

test('existing solid ice never sublimes even beside hot undersaturated gas',()=>{
 const w=water(2,250),g=gas(0,1000,10),before=structuredClone({w,g});
 assert.equal(advanceWaterVaporPair(w,g,{volume:1}).amount,0);assert.deepEqual({w,g},before);
});

test('evaporation cannot consume more than the current liquid portion of slush',()=>{
 const w={water:2,heat:2*(MELTING_KELVIN-WATER_LATENT_HEAT)+.2*WATER_LATENT_HEAT},g=gas(0,1000,10),before=pairTotals(w,g);
 const change=advanceWaterVaporPair(w,g,{volume:1000,rate:1,maxTransfer:10});assert.ok(change.amount<=.2+1e-12);conserved(before,w,g);
});

test('no phase target leaves sensible-only contacts unchanged',()=>{
 const w=water(0,0),g=gas(0,300,10),before=structuredClone({w,g});
 assert.equal(advanceWaterVaporPair(w,g,{volume:1}).amount,0);assert.deepEqual({w,g},before);
});

test('bounded condensation respects a full floor and finite sink headroom',()=>{
 for(const amount of [4,3.99]){
  const w=water(amount,293.15),g=gas(4,293.15,10),before=pairTotals(w,g);
  const change=advanceWaterVaporPair(w,g,{volume:1,capacity:4,rate:1,maxTransfer:10});assert.ok(w.water<=4);conserved(before,w,g);
  if(amount===4)assert.equal(change.amount,0);else close(w.water,4);
 }
});

test('full liquid gas equipment cannot create gas in zero representable volume',()=>{
 const t={building:null,pipe:{}},w=water(10,293.15),g=gas(0,0),before=structuredClone({w,g});
 assert.equal(advanceWaterVaporPair(w,g,{capacity:gasCapacity(t),volumeForWater:m=>gasVolumeForWater(t,m)}).amount,0);assert.deepEqual({w,g},before);
});

test('gas condensate changes available physical volume without changing occupied capacity',()=>{
 const t={building:null,pipe:{}},w=water(0,0),g=gas(5,290),occupied=gasAmount(g.gas)+w.water,before=pairTotals(w,g);
 advanceWaterVaporPair(w,g,{capacity:10,volumeForWater:m=>gasVolumeForWater(t,m)});
 assert.ok(w.water>0);close(gasAmount(g.gas)+w.water,occupied);assert.ok(gasVolumeForWater(t,w.water)<.25);conserved(before,w,g);
});

test('invalid phase pairs and rates are rejected before mutation',()=>{
 for(const options of [{volume:-1},{volume:0},{volume:1,rate:2},{volume:1,maxTransfer:-1},{volume:1,capacity:.5}]){
  const w=water(1,300),g=gas(1,300),before=structuredClone({w,g});assert.throws(()=>advanceWaterVaporPair(w,g,options));assert.deepEqual({w,g},before);
 }
 for(const g of [{gas:emptyGas(),heat:1},{gas:{...emptyGas(),vapor:1},heat:539}])assert.throws(()=>vaporEquilibrium(water(1,300),g,{volume:1}));
});

test('initialization supplies canonical vapor owners and all exact counters without RNG access',()=>{
 const f=fixture(),t=f.floor(),r=f.room(t),node=f.pipe(t);
 delete r.gas.vapor;delete node.gas.vapor;delete node.condensate;delete f.site.vapor;delete f.site.atmosphere.injected.vapor;
 initializeWaterVapor(f.s);assert.equal(r.gas.vapor,0);assert.deepEqual(node.condensate,{water:0,heat:0});assert.equal(f.site.atmosphere.injected.vapor,0);validateWaterVapor(f.s);
 const before=JSON.stringify(f.s);initializeWaterVapor(f.s);assert.equal(JSON.stringify(f.s),before);
});

test('floor and node updates conserve combined water and finite energy on actual decks',()=>{
 const f=fixture(),lower=f.floor(2,2,0),upper=f.floor(2,2,1),r=f.room(upper),node=f.pipe(upper,1,293.15);
 upper.liquid=2;upper.liquidHeat=600;const waterBefore=upper.liquid+r.gas.vapor+node.gas.vapor,heatBefore=upper.liquidHeat+r.heat+node.heat;
 updateWaterVapor(f.s);assert.equal(lower.liquid,0);assert.ok(upper.liquid<2);assert.ok(node.condensate.water>0);
 close(upper.liquid+r.gas.vapor+node.gas.vapor+node.condensate.water,waterBefore);close(upper.liquidHeat+r.heat+node.heat+node.condensate.heat,heatBefore);validateWaterVapor(f.s);
 close(storedWaterHeat(f.site),upper.liquidHeat+node.condensate.heat);assert.ok(gasVolume(upper)<.25);
});

test('vacuum evaporation exports full vapor energy, cools retained water, and never emits frozen water',()=>{
 const f=fixture(),t=f.floor(),frozen=f.floor(3,2);t.liquid=1;t.liquidHeat=300;frozen.liquid=1;frozen.liquidHeat=waterHeatAt(1,250);
 const energy=t.liquidHeat+frozen.liquidHeat;updateWaterVapor(f.s);
 close(f.site.vapor.vacuumEvaporated,.02);close(t.liquid,.98);close(f.site.thermal.gasVented,.02*(300+VAPOR_LATENT_HEAT));close(t.liquidHeat+frozen.liquidHeat+f.site.thermal.gasVented,energy);assert.equal(frozen.liquid,1);assert.equal(f.site.atmosphere.vented.vapor,0);validateWaterVapor(f.s);
});

test('dismantling releases only into accessible same-deck floor capacity and loses excess with heat',()=>{
 const f=fixture(),lower=f.floor(2,2,0),t=f.floor(2,2,1),neighbor=f.floor(3,2,1),node=f.pipe(t);t.building='wall';t.hp=100;
 neighbor.liquid=3.5;neighbor.liquidHeat=3.5*300;node.condensate={water:2,heat:500};f.site.vapor.nodeCondensed=2;f.site.vapor.initial=2;
 const before=storedWaterHeat(f.site);close(releaseNodeCondensate(f.s,f.site,t,node),.5);close(neighbor.liquid,4);assert.equal(lower.liquid,0);assert.equal(t.liquid,0);
 close(f.site.vapor.condensateReleased,.5);close(f.site.vapor.condensateLost,1.5);close(f.site.thermal.waterRemoved,375);close(storedWaterHeat(f.site)+f.site.thermal.waterRemoved,before);assert.deepEqual(node.condensate,{water:0,heat:0});validateWaterVapor(f.s);
});

test('dismantling retains frozen condensate phase rather than melting or packaging it',()=>{
 const f=fixture(),t=f.floor(),node=f.pipe(t);node.condensate=water(1,250);f.site.vapor.nodeCondensed=1;f.site.vapor.initial=1;
 close(releaseNodeCondensate(f.s,f.site,t,node),1);close(waterPhase(t,{floor:true}).ice,1);assert.equal(f.site.thermal.waterRemoved,0);close(f.site.liquids.released,1);validateWaterVapor(f.s);
});

test('vapor admission rejects changed counters, hidden condensate keys, overflow, and unbalanced custody',()=>{
 const f=fixture(),t=f.floor(),node=f.pipe(t),baseline=structuredClone(f.s);
 const cases=[s=>s.sites.surface.vapor.extra=0,s=>s.sites.surface.vapor.nodeCondensed=-1,s=>s.sites.surface.vapor.initial=1,s=>s.sites.surface.tiles.find(t=>t.pipe).pipe.condensate.hidden=0,s=>s.sites.surface.tiles.find(t=>t.pipe).pipe.condensate={water:0,heat:1},s=>s.sites.surface.tiles.find(t=>t.pipe).pipe.condensate={water:11,heat:3300},s=>s.sites.surface.tiles.find(t=>t.pipe).pipe.condensate={water:10+1e-9,heat:3000}];
 for(const mutate of cases){const copy=structuredClone(baseline);mutate(copy);assert.throws(()=>validateWaterVapor(copy));}
 assert.equal(node.condensate.water,0);assert.equal(WATER_VAPOR.contact,.02);
});
