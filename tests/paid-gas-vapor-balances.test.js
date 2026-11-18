import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { tileAt } from '../src/spatial.js';
import { updateWaterVapor } from '../src/water-vapor.js';
import { totalResources } from '../src/inventory.js';
import { gasEnergy, GAS_REFERENCE_KELVIN as K } from '../src/gas-thermal.js';
import { addGas, mix } from '../src/gas-species.js';
import { newPipe, releaseGas, removeGas } from '../src/gas-networks.js';
import { physicalBalances, physicalMaterialOwners, physicalDryGasSpecies } from '../tools/paid-air-recovery.mjs';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const water=balance=>balance.owners.reduce((sum,row)=>sum+row.water,0);
function fixture(){
 const s=createGame(),site=s.sites.surface;s.sites={surface:site};
 // Synthetic subsystem baseline: no unrelated exterior pool phase changes.
 for(const t of site.tiles){t.liquid=0;t.liquidHeat=0;}
 const r=site.rooms[0],[x,y]=r.cells[0].split(',').map(Number),inside=tileAt(site,{x,y,z:r.z??0}),outside=tileAt(site,{x:0,y:0,z:0});
 return {s,site,r,inside,outside};
}

test('paid helper keeps dry gas and physical water conserved through internal evaporation',()=>{
 const {s,site,inside}=fixture();inside.liquid=1;inside.liquidHeat=K;
 const before=physicalBalances(s),initialSpecies=physicalDryGasSpecies(s),actual=totalResources(s).water;
 updateWaterVapor(s);const after=physicalBalances(s);
 assert.ok(site.vapor.floorEvaporated>0);close(after.gas,before.gas);close(water(after),water(before));close(totalResources(s).water,actual);
 assert.deepEqual(physicalDryGasSpecies(s),initialSpecies);close(after.waterExported,before.waterExported);
});

test('paid helper counts node exterior discharge once in dry species and vapor boundaries',()=>{
 const {s,site,outside}=fixture();outside.pipe=newPipe();outside.pipe.gas={...mix(2),vapor:1};outside.pipe.heat=gasEnergy(outside.pipe.gas,K);addGas(site.gasNetwork.loaded,outside.pipe.gas);
 const before=physicalBalances(s),initialSpecies=physicalDryGasSpecies(s);
 releaseGas(s,site,outside,Infinity,'damaged');const after=physicalBalances(s),finalSpecies=physicalDryGasSpecies(s);
 for(const k of ['oxygen','inert','co2'])close(finalSpecies[k],initialSpecies[k]);close(after.gas,before.gas);
 close(site.atmosphere.vented.vapor,1);close(site.gasNetwork.vented.vapor,1);close(after.waterExported-before.waterExported,1);
 close(water(after)+after.waterExported,water(before)+before.waterExported);
});

test('paid helper retains node condensate ownership and accounts explicit inaccessible dismantling loss',()=>{
 const {s,site,outside}=fixture();outside.pipe=newPipe();outside.pipe.condensate={water:2,heat:2*K};
 const before=physicalBalances(s);assert.ok(physicalMaterialOwners(s).some(row=>row.owner.endsWith('/gas.condensate')&&row.water===2));
 removeGas(s,site,outside,true);const after=physicalBalances(s);
 close(site.vapor.condensateLost,2);close(after.waterExported-before.waterExported,2);close(water(after)+after.waterExported,water(before)+before.waterExported);
});

test('paid helper records finite vacuum evaporation as water export without dry gas creation',()=>{
 const {s,site,outside}=fixture();outside.liquid=1;outside.liquidHeat=K;const before=physicalBalances(s);
 updateWaterVapor(s);const after=physicalBalances(s);assert.ok(site.vapor.vacuumEvaporated>0);
 close(after.gas,before.gas);close(after.waterExported-before.waterExported,site.vapor.vacuumEvaporated);
 close(water(after)+after.waterExported,water(before)+before.waterExported);
});
