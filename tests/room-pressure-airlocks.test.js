import test from 'node:test';
import assert from 'node:assert/strict';
import { airlockGasQuantities, airlockLayout, airlockRoomReading, airlockSideBlock, airlockStatus, airlockOpen } from '../src/airlock-access.js';
import { prepareAirlocks, reconcileAirlocks, airlockResourceStatus } from '../src/airlocks.js';
import { mix, breathable, refreshRoom, roomAt } from '../src/atmosphere.js';
import { roomPressure } from '../src/room-pressure.js';
import { gasNode } from '../src/gas-networks.js';
import { roomHeatCapacity, gasEnergy, GAS_REFERENCE_KELVIN } from '../src/gas-thermal.js';
import { fixture, CONFIG, STAGING, request, close, ledger, assertLedger } from './helpers/airlock-fixture.js';
import { floorFixture, floorRefs } from './helpers/airlock-floor-fixture.js';

const setTemperature=(room,celsius)=>{room.heat=roomHeatCapacity(room)*(273.15+celsius);};
const total=gas=>gas.oxygen+gas.inert+gas.co2;

test('airlock readings use live shared breathing rules without refreshing or mutating caches',()=>{
 const f=fixture({smoke:0}),r=f.chamber;
 r.gas={oxygen:3.1,inert:16.9,co2:0};refreshRoom(r);assert.equal(breathable(r),false);
 setTemperature(r,35);const before=JSON.stringify(r),reading=airlockRoomReading(r);
 close(reading.pressure,100*308.15/293.15);assert.equal(reading.breathable,true);assert.equal(reading.breathable,breathable(r));
 assert.equal(JSON.stringify(r),before);assert.equal(r.pressure,100);
 r.gas={oxygen:4.2,inert:15.3,co2:.5};assert.equal(r.co2Fraction,0);
 assert.equal(airlockRoomReading(r).breathable,false,'live CO2 also controls detached mixture predictions');
});

for(const celsius of [5,35])test(`airlock gas budgets invert receiving temperature at ${celsius} C and preserve smoke payload`,()=>{
 const f=fixture({chamberGas:10,smoke:2});setTemperature(f.chamber,celsius);setTemperature(f.habitat,30);
 const before=JSON.stringify(f.s),q=airlockGasQuantities(airlockLayout(f.site,f.controller));
 const residual=.2*293.15/(273.15+celsius),target=100*303.15/293.15-2;
 const finalAmount=10+q.fillNeeded,finalHeat=f.chamber.heat+.2*q.fillNeeded*293.15,finalKelvin=finalHeat/(40+.2*finalAmount);
 close(q.recoverNeeded,(10-residual)*1.2);close(finalAmount/20*100*finalKelvin/293.15,target);assert.equal(q.fillReachable,true);close(q.supply,35);
 assert.equal(JSON.stringify(f.s),before,'quantity previews preserve physical and cached state');
});

for(const [celsius,mode] of [[5,'refill'],[35,'recover']])test(`entry matching chooses ${mode} from live ${celsius} C pressure despite stale cache`,()=>{
 const f=fixture({smoke:0});setTemperature(f.chamber,celsius);
 assert.equal(f.chamber.pressure,f.habitat.pressure);assert.equal(airlockSideBlock(f.site,f.controller,'inner'),'pressure_mismatch');
 const before=ledger(f);request(f);prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,null);assert.equal(f.controller.airlock.phase,'prepare_entry');
 assert.equal(f.extractor.gasDevice.enabled,mode==='recover');assert.equal(f.vent.gasDevice.enabled,mode==='refill');assertLedger(f,before);
});

test('commanded refill target follows live habitat pressure while the cached reading is stale',()=>{
 const f=fixture({smoke:0});setTemperature(f.habitat,35);close(f.habitat.pressure,100);
 const before=ledger(f);request(f);prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,null);assert.equal(f.vent.gasDevice.enabled,true);assert.equal(f.vent.gasDevice.target,105);assertLedger(f,before);
});

for(const [celsius,oxygenPressure,expected] of [[5,.161,null],[35,.159,'contaminated_mix']])test(`finite refill prediction respects ${celsius} C oxygen partial pressure`,()=>{
 const f=fixture({chamberGas:.2,smoke:0});setTemperature(f.chamber,celsius);f.chamber.gas={oxygen:0,inert:.2,co2:0};
 const target=20*293.15/(273.15+celsius),supply=expected===null?target+.1:target-.2,fraction=oxygenPressure*target/(target-.2);
 for(const t of f.site.tiles)if(gasNode(t)){gasNode(t).gas=mix(0);gasNode(t).smoke=0;gasNode(t).heat=0;}
 f.reservoir.gasStore.gas={oxygen:supply*fraction,inert:supply*(1-fraction),co2:0};f.reservoir.gasStore.heat=gasEnergy(f.reservoir.gasStore.gas,273.15+celsius);
 [f.crew.x,f.crew.y]=CONFIG.chamber;const before=ledger(f);request(f,'inward');prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,expected);assert.equal(!!f.controller.airlock.party,expected===null);assertLedger(f,before);
});

for(const [fraction,target] of [[.21,99],[.161,100]])test(`finite target selection uses ${target} for oxygen fraction ${fraction} at habitat pressure 99.4`,()=>{
 const f=fixture({chamberGas:0,smoke:0});setTemperature(f.habitat,293.15*.994-273.15);
 f.reservoir.gasStore.gas={oxygen:20*fraction,inert:20*(1-fraction),co2:0};f.reservoir.gasStore.heat=gasEnergy(f.reservoir.gasStore.gas,GAS_REFERENCE_KELVIN);[f.crew.x,f.crew.y]=CONFIG.chamber;
 const before=ledger(f);request(f,'inward');prepareAirlocks(f.s);reconcileAirlocks(f.s);prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,null);assert.equal(f.vent.gasDevice.target,target);assert.equal(f.vent.gasDevice.enabled,true);
 assert.ok(Math.abs(target-roomPressure(f.habitat))<=2);assertLedger(f,before);
});

test('an unsafe finite mixture is not rescued by a target outside the two-point interlock range',()=>{
 const f=fixture({chamberGas:0,smoke:0});setTemperature(f.habitat,293.15*.97-273.15);
 f.reservoir.gasStore.gas={oxygen:20*.161,inert:20*.839,co2:0};f.reservoir.gasStore.heat=gasEnergy(f.reservoir.gasStore.gas,GAS_REFERENCE_KELVIN);[f.crew.x,f.crew.y]=CONFIG.chamber;
 const before=ledger(f);request(f,'inward');prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,'contaminated_mix');assert.equal(f.controller.airlock.party,null);assertLedger(f,before);
});

for(const celsius of [5,35])test(`suit-duration admission follows the finite chamber target at ${celsius} C`,()=>{
 const f=fixture({chamberGas:.2,smoke:0});setTemperature(f.chamber,celsius);[f.crew.x,f.crew.y]=CONFIG.chamber;
 const layout=airlockLayout(f.site,f.controller),count=layout.recoveryNodes.length+layout.storageNodes.length;
 const finalAmount=.2+airlockResourceStatus(layout).predicted.fillAmount;
 const ticks=Math.ceil((.2+finalAmount)/2)+f.chamber.cells.length+6+2*count,required=.18*(Math.ceil(1.25*ticks)+20);
 f.crew.oxygen=required-.001;request(f,'inward');assert.equal(f.controller.airlock.queue[0].emergency,true);prepareAirlocks(f.s);
 assert.equal(f.controller.airlock.reason,'insufficient_suit');assert.equal(f.controller.airlock.party,null);
 f.crew.oxygen=required;prepareAirlocks(f.s);assert.equal(f.controller.airlock.reason,null);assert.equal(f.controller.airlock.party.crew,f.crew.id);
});

test('zero Kelvin recovery needs no extraction and unsafe refill pauses without spending supply or nonfinite diagnostics',()=>{
 const f=fixture({smoke:1});f.chamber.heat=0;const before=ledger(f),q=airlockGasQuantities(airlockLayout(f.site,f.controller));
 assert.equal(q.recoverNeeded,0);assert.equal(q.fillNeeded,q.supply);assert.equal(q.fillReachable,false);assert.equal(airlockRoomReading(f.chamber).pressure,0);
 request(f);prepareAirlocks(f.s);assert.equal(f.controller.airlock.reason,'unsafe_temperature');assert.equal(f.controller.airlock.party,null);
 assert.equal(f.extractor.gasDevice.enabled,false);assert.equal(f.vent.gasDevice.enabled,false);assert.equal(f.pump.gasDevice.enabled,false);assertLedger(f,before);
 const status=airlockStatus(f.s,f.site,f.controller);assert.equal(status.chamber.temperature,-273.15);
 const finite=value=>{if(typeof value==='number')assert.ok(Number.isFinite(value));else if(value&&typeof value==='object')for(const child of Object.values(value))finite(child);};finite(status);
});

test('heat-driven exit drift seals the whole party before finite correction and preserves its identity',()=>{
 const f=fixture({smoke:0});[f.crew.x,f.crew.y]=CONFIG.chamber;request(f,'inward');prepareAirlocks(f.s);reconcileAirlocks(f.s);
 assert.equal(f.controller.airlock.phase,'release');assert.equal(airlockOpen(f.site,f.inner),true);
 const cycle=f.controller.airlock.cycle,party=JSON.stringify(f.controller.airlock.party),before=ledger(f);
 setTemperature(f.chamber,35);close(f.chamber.pressure,100);reconcileAirlocks(f.s);
 assert.equal(f.controller.airlock.phase,'refill');assert.equal(airlockOpen(f.site,f.inner),false);assert.equal(airlockOpen(f.site,f.outer),false);
 assert.equal(f.controller.airlock.cycle,cycle);assert.equal(JSON.stringify(f.controller.airlock.party),party);
 prepareAirlocks(f.s);assert.equal(f.extractor.gasDevice.enabled,true);assert.equal(f.vent.gasDevice.enabled,false);assertLedger(f,before);
});

test('upper-floor outer interlock measures exterior temperature independently of the ground assembly',()=>{
 const f=floorFixture(),ground=floorRefs(f.s,0),outside=roomAt(f.site,...STAGING.outer,1);
 f.chamber.gas=mix(0);outside.gas=mix(outside.volume*.09);setTemperature(outside,20);refreshRoom(outside);
 assert.equal(airlockSideBlock(f.site,f.controller,'outer'),null);const groundBefore=JSON.stringify(ground.controller.airlock);
 setTemperature(outside,100);assert.ok(roomPressure(outside)>1);assert.ok(outside.pressure<1);
 const before=JSON.stringify(f.s);assert.equal(airlockSideBlock(f.site,f.controller,'outer'),'pressure_mismatch');airlockStatus(f.s,f.site,f.controller);
 assert.equal(JSON.stringify(f.s),before);assert.equal(JSON.stringify(ground.controller.airlock),groundBefore);close(total(f.chamber.gas),0);
});
