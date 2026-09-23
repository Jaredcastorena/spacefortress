import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize } from '../src/simulation.js';
import { initializeStorage } from '../src/inventory.js';
import {
  initializePower, initializeElectrical, refreshPower, previewPower,
  breakerConditions, updatePower, validatePower,
} from '../src/power.js';
import { REACTOR, validateReactors } from '../src/reactors.js';
import { roomAt } from '../src/atmosphere.js';
import { HEAT_CAPACITY } from '../src/thermal.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';

const close=(actual,expected,label='amount')=>assert.ok(Math.abs(actual-expected)<1e-7,`${label}: ${actual} != ${expected}`);
function grid() {
  const s=createGame(),site=s.sites.surface;
  // A controlled electrical fixture: retained room heat and all energy
  // ledgers remain real, while unrelated consumers/routes are removed.
  for(const t of site.tiles) {
    t.building=null; t.cable=null; t.terrain='floor';
    for(const key of ['charge','powerPriority','machine','stock','protection','reactor','radiator']) delete t[key];
  }
  initializePower(s,site,0);
  return {s,site};
}
function device(site,x,y,kind,charge=0) {
  const t=at(site,x,y); t.building=kind; t.hp=100;
  initializeStorage(t); initializeElectrical(t);
  if(kind==='battery') {t.charge=charge;site.energy.initial+=charge;}
  if(kind==='reactor') t.machine.input.fuel=1;
  return t;
}
function breaker(site,x,y,mode='wet_fault',direction='east') {
  const t=device(site,x,y,'breaker');
  t.protection={kind:'breaker',direction,enabled:true,mode,tripped:false,cause:null};
  return t;
}
function wire(site,x,y,wet=false) {
  const t=at(site,x,y);t.cable={enabled:true,hp:100};
  if(wet) {t.liquid=1;site.liquids.released+=1;}
  return t;
}
function balance(s,site) {
  const e=site.energy,stored=site.tiles.reduce((n,t)=>n+(t.building==='battery'?t.charge:0),0);
  close(stored+e.consumed+e.curtailed+e.discarded,e.initial+e.generated+e.injected,'energy invariant');
  for(const t of site.tiles) if(t.building==='battery') assert.ok(t.charge>=0&&t.charge<=120);
  refreshPower(s,site); validatePower(s,site); validateReactors(s);
}
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.kind==='event').map(r=>r.event);
function heat(site) {return site.rooms.reduce((n,r)=>n+r.heat,0);}
function overheatHabitat(site,t) {
  const room=roomAt(site,t.x,t.y),next=(REACTOR.tripTemperature+273.15)*room.volume*HEAT_CAPACITY;
  site.thermal.added+=next-room.heat;room.heat=next;
}
function branch({source='reactor',bank=0,load=null}={}) {
  const f=grid(),{s,site}=f;
  const generator=device(site,7,8,source), relay=breaker(site,8,8), fault=wire(site,9,8,true);
  const battery=bank?device(site,10,8,'battery',bank):null;
  const consumer=load?device(site,9,9,load):null;
  refreshPower(s,site);
  return {...f,generator,relay,fault,battery,consumer};
}

test('power previews, breaker inspection and power validation leave physical state, events and RNG untouched',()=>{
  const {s,site,relay}=branch({bank:11,load:'scrubber'});
  refreshPower(s,site); startRecording(s,{maxRecords:5000,maxBytes:32000000});
  const before=structuredClone(s), recording=exportRecording(s);
  for(let i=0;i<20;i++) {
    assert.ok(previewPower(s,site).suppliedFaults.size>0);
    assert.equal(breakerConditions(s,site,relay).wouldTrip,true);
    refreshPower(s,site); validatePower(s,site); serialize(s); observe(s);
  }
  assert.deepEqual(s,before);
  assert.equal(exportRecording(s),recording);
  assert.equal(relay.protection.tripped,false);
});

test('a discarded supplied-fault preview produces no phantom battery discharge, fault heat or cable damage',()=>{
  const {s,site}=grid(),bank=device(site,7,8,'battery',8),relay=breaker(site,8,8),fault=wire(site,9,8,true);
  refreshPower(s,site);const initialHeat=heat(site),hp=fault.cable.hp;
  assert.ok(previewPower(s,site).suppliedFaults.has(fault));
  updatePower(s,site);
  assert.equal(relay.protection.tripped,true);close(bank.charge,8);
  close(site.energy.consumed,0);close(site.liquids.faultEnergy,0);
  close(heat(site),initialHeat);close(fault.cable.hp,hp);balance(s,site);
});

test('output-side battery backfeed commits one real wet fault after upstream protection opens',()=>{
  const {s,site,generator,relay,fault,battery,consumer}=branch({source:'advanced',bank:8,load:'scrubber'});
  const initialHeat=heat(site); startRecording(s,{maxRecords:1000,maxBytes:32000000});
  updatePower(s,site);
  assert.equal(relay.protection.tripped,true);assert.equal(consumer.powered,true);
  close(battery.charge,0);close(site.energy.consumed,8);close(site.energy.generated,12);close(site.energy.curtailed,12);
  close(site.liquids.faultEnergy,5);close(heat(site)-initialHeat,5);close(fault.cable.hp,99.75);
  assert.equal(events(s).filter(e=>e.id==='power.wet_short').length,1);
  assert.equal(generator.building,'advanced');balance(s,site);
});

test('an alternate generator on the isolated output still feeds real faults, loads and battery charging',()=>{
  const {s,site,generator,relay,fault,consumer}=branch({source:'solar',load:'scrubber'});
  const downstream=device(site,10,8,'advanced'),bank=device(site,11,8,'battery',0),initialHeat=heat(site);
  refreshPower(s,site);updatePower(s,site);
  assert.equal(relay.protection.tripped,true);assert.equal(consumer.powered,true);
  close(site.energy.generated,16);close(site.energy.consumed,8);close(bank.charge,4);close(site.energy.curtailed,4);
  close(site.liquids.faultEnergy,5);close(heat(site)-initialHeat,5);close(fault.cable.hp,99.75);
  assert.equal(generator.building,'solar');assert.equal(downstream.building,'advanced');balance(s,site);
});

test('a denied wet fault cannot trip a relay or consume energy even when a smaller load can run',()=>{
  const {s,site,relay,fault,consumer}=branch({source:'solar',load:'scrubber'}),initialHeat=heat(site);
  assert.equal(previewPower(s,site).suppliedFaults.has(fault),false);
  updatePower(s,site);
  assert.equal(relay.protection.tripped,false);assert.equal(consumer.powered,true);
  close(site.energy.generated,4);close(site.energy.consumed,3);close(site.energy.curtailed,1);
  close(site.liquids.faultEnergy,0);close(fault.cable.hp,100);close(heat(site),initialHeat);balance(s,site);
});

for(const spec of [
  {hp:10,consumed:1,remaining:49,faultEnergy:0,load:true},
  {hp:25,consumed:5,remaining:45,faultEnergy:5,load:false},
]) test(`final protection plan honors a ${spec.hp}% bank rate and all-or-nothing fault/load demand`,()=>{
  const {s,site,relay,fault,battery,consumer}=branch({source:'solar',bank:50,load:'holo'});
  battery.hp=spec.hp; refreshPower(s,site);const initialHeat=heat(site);
  assert.ok(previewPower(s,site).suppliedFaults.has(fault),'combined pretrip supply can serve the fault');
  updatePower(s,site);
  assert.equal(relay.protection.tripped,true);assert.equal(consumer.powered,spec.load);
  close(battery.charge,spec.remaining);close(site.energy.consumed,spec.consumed);close(site.energy.curtailed,4);
  close(site.liquids.faultEnergy,spec.faultEnergy);close(heat(site)-initialHeat,spec.faultEnergy);
  close(fault.cable.hp,spec.faultEnergy?99.75:100);balance(s,site);
});

test('series relays batch-trip deterministically and the discarded plan cannot duplicate reactor fuel or heat',()=>{
  const {s:a,site}=grid(),reactor=device(site,7,8,'reactor'),first=breaker(site,8,8),second=breaker(site,10,8);
  wire(site,9,8);const fault=wire(site,11,8,true);refreshPower(a,site);
  const b=structuredClone(a),initialHeat=heat(site);
  for(const s of [a,b]) {startRecording(s,{maxRecords:1000,maxBytes:32000000});updatePower(s,s.sites.surface);}
  assert.deepEqual(a,b);assert.equal(first.protection.tripped,true);assert.equal(second.protection.tripped,true);
  close(reactor.machine.input.fuel,1-REACTOR.fuelRate);close(reactor.reactor.heat,REACTOR.heat);
  close(site.reactorLedger.generated,REACTOR.supply);close(site.energy.generated,40);close(site.energy.curtailed,40);
  close(site.energy.consumed,0);close(site.liquids.faultEnergy,0);close(fault.cable.hp,100);close(heat(site),initialHeat);
  const record=events(a);assert.equal(record.filter(e=>e.id==='power.breaker.tripped').length,2);
  assert.equal(record.filter(e=>e.id==='reactor.generated').length,1);
  assert.deepEqual(record,events(b));balance(a,site);
});

test('a second fault revealed by the first trip causes another plan but only one finite reactor commit',()=>{
  const {s,site}=grid(),reactor=device(site,7,9,'reactor');reactor.reactor.output=15;
  wire(site,8,9);wire(site,8,8);wire(site,8,10);
  const first=breaker(site,9,8),second=breaker(site,9,10),a=wire(site,10,8,true),b=wire(site,10,10,true);
  refreshPower(s,site);assert.equal(previewPower(s,site).suppliedFaults.size,1,'six units supply can serve only one five-unit fault');
  startRecording(s,{maxRecords:1000,maxBytes:32000000});updatePower(s,site);
  assert.equal(first.protection.tripped,true);assert.equal(second.protection.tripped,true);
  close(site.energy.generated,6);close(site.energy.curtailed,6);close(site.energy.consumed,0);
  close(reactor.machine.input.fuel,.997);close(reactor.reactor.heat,3.6);
  close(site.reactorLedger.fuelUsed,.003);close(site.reactorLedger.heatMade,3.6);
  close(site.liquids.faultEnergy,0);close(a.cable.hp,100);close(b.cable.hp,100);
  assert.equal(events(s).filter(e=>e.id==='power.breaker.tripped').length,2);
  assert.equal(events(s).filter(e=>e.id==='reactor.generated').length,1);balance(s,site);
});

test('reactor thermal shutdown precedes breaker detection and neither preview nor replanning burns its fuel',()=>{
  const {s,site,generator,relay,fault,battery}=branch({bank:5});
  overheatHabitat(site,generator);
  refreshPower(s,site);const before=structuredClone(generator.reactor),fuel=generator.machine.input.fuel;
  for(let i=0;i<5;i++) previewPower(s,site);
  assert.deepEqual(generator.reactor,before);assert.equal(generator.reactor.tripped,false);
  startRecording(s,{maxRecords:1000,maxBytes:32000000});updatePower(s,site);
  assert.equal(generator.reactor.tripped,true);assert.equal(relay.protection.tripped,true);
  close(generator.machine.input.fuel,fuel);close(generator.reactor.heat,before.heat);
  close(site.energy.generated,0);close(site.reactorLedger.fuelUsed,0);close(battery.charge,0);
  close(site.energy.consumed,5);close(site.liquids.faultEnergy,5);close(fault.cable.hp,99.75);
  const record=events(s),reactorIndex=record.findIndex(e=>e.id==='reactor.tripped'),breakerIndex=record.findIndex(e=>e.id==='power.breaker.tripped');
  assert.ok(reactorIndex>=0&&breakerIndex>reactorIndex,'thermal latch precedes branch protection');
  assert.equal(record.filter(e=>e.id==='reactor.generated').length,0);balance(s,site);
});

test('a hot reactor without any alternate source leaves an unpowered wet branch untripped',()=>{
  const {s,site,generator,relay,fault}=branch();
  overheatHabitat(site,generator);
  const before=heat(site);refreshPower(s,site);updatePower(s,site);
  assert.equal(generator.reactor.tripped,true);assert.equal(relay.protection.tripped,false);
  close(site.energy.generated,0);close(site.energy.consumed,0);close(generator.machine.input.fuel,1);
  close(site.liquids.faultEnergy,0);close(fault.cable.hp,100);close(heat(site),before);balance(s,site);
});
