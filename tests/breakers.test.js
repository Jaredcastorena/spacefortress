import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, at, step, order, serialize, deserialize} from '../src/simulation.js';
import {initializeStorage, totalResources, syncResources} from '../src/inventory.js';
import {initializeElectrical, refreshPower, updatePower} from '../src/power.js';
import {initializeBreakerTile, setBreaker, resetBreaker, breakerClosed} from '../src/breakers.js';
import {newPipe} from '../src/gas-networks.js';
import {newWaterPipe} from '../src/plumbing.js';
import {ignite, extinguish} from '../src/fire.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function check(s){syncResources(s);for(const site of Object.values(s.sites))refreshPower(s,site);return deserialize(serialize(s));}
function base(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 refreshPower(s,site);return {s,site};
}
function install(s,kind,x,y){
 const t=at(s.sites.surface,x,y);assert.equal(t.building,null);t.building=kind;t.hp=100;
 initializeStorage(t);initializeElectrical(t);initializeBreakerTile(t);return t;
}
function fixture(){
 const f=base();for(const t of f.site.tiles)t.cable=null;
 const source=install(f.s,'advanced',9,9),breaker=install(f.s,'breaker',10,9),load=install(f.s,'scrubber',11,9);
 refreshPower(f.s,f.site);return {...f,source,breaker,load};
}
function wetFault(f){
 f.load.cable={enabled:true,hp:100};f.load.liquid=.5;f.site.liquids.released+=.5;
 at(f.site,8,10).stock.water-=.5;syncResources(f.s);
 assert.ok(setBreaker(f.s,'surface',10,9,true,'east','wet_fault').ok);updatePower(f.s,f.site);
 assert.equal(f.breaker.protection.tripped,true);assert.equal(f.breaker.protection.cause,'wet_fault');
 assert.equal(f.breaker.protection.enabled,true);assert.equal(breakerClosed(f.breaker),false);
}
function until(s,p,max=240){for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),'Condition not reached');}

test('breaker construction requires delivered finite materials and starts open in manual mode',()=>{
 const {s,site}=base(),t=at(site,11,9),before=totalResources(s),result=order(s,'surface',11,9,'build','breaker');
 assert.ok(result.ok);assert.deepEqual(result.job.cost,{alloy:4,components:1});assert.equal(result.job.work,8);
 assert.deepEqual(result.job.materials,{});assert.equal(t.protection,undefined);assert.equal(t.building,null);
 until(s,()=>Object.keys(result.job.materials).length>0);assert.equal(t.building,null);close(totalResources(s).alloy,before.alloy);
 until(s,()=>t.building==='breaker');
 assert.deepEqual(t.protection,{kind:'breaker',direction:'east',enabled:false,mode:'manual',tripped:false,cause:null});
 assert.equal(breakerClosed(t),false);assert.equal(t.charge,undefined);assert.equal(t.machine,undefined);assert.equal(t.maintenance,undefined);
 close(totalResources(s).alloy,before.alloy-4);close(totalResources(s).components,before.components-1);
 assert.equal(order(s,'surface',12,14,'build','breaker').ok,false);check(s);
});

test('breaker and cable construction reject an overlay bypass in either order while fluid pipes remain independent',()=>{
 const {s,site}=base(),wired=at(site,11,9);wired.cable={enabled:true,hp:100};
 assert.equal(order(s,'surface',11,9,'build','breaker').ok,false);assert.equal(s.jobs.length,0);
 const t=at(site,12,9);t.pipe=newPipe();t.waterPipe=newWaterPipe();
 assert.ok(order(s,'surface',12,9,'build','breaker').ok);until(s,()=>t.building==='breaker');
 assert.ok(t.pipe);assert.ok(t.waterPipe);assert.equal(t.cable,null);
 assert.equal(order(s,'surface',12,9,'build','cable').ok,false);assert.equal(t.cable,null);check(s);
});

test('invalid breaker controls are atomic and no-op settings preserve simulation state',()=>{
 const {s,breaker}=fixture();const initial=structuredClone(s);
 for(const [enabled,direction,mode] of [['yes','east','manual'],[true,'up','manual'],[true,'east','overload'],[true,'east',null]]){
  assert.equal(setBreaker(s,'surface',10,9,enabled,direction,mode).ok,false);assert.deepEqual(s,initial);
 }
 assert.equal(setBreaker(s,'surface',11,9,true,'east','manual').ok,false);assert.deepEqual(s,initial);
 assert.ok(setBreaker(s,'surface',10,9,false,'east','manual').ok);assert.deepEqual(s,initial);
 assert.ok(resetBreaker(s,'surface',10,9).ok);assert.deepEqual(s,initial);
 assert.equal(breaker.protection.enabled,false);check(s);
});

test('direction and mode changes require a contact that was open before the command',()=>{
 const {s,breaker}=fixture();assert.ok(setBreaker(s,'surface',10,9,true,'east','manual').ok);
 const closed=structuredClone(s);assert.equal(breakerClosed(breaker),true);
 for(const setting of [[true,'north','manual'],[true,'east','wet_fault'],[false,'north','wet_fault']]){
  assert.equal(setBreaker(s,'surface',10,9,...setting).ok,false);assert.deepEqual(s,closed);
 }
 assert.ok(setBreaker(s,'surface',10,9,false,'east','manual').ok);
 assert.ok(setBreaker(s,'surface',10,9,false,'north','wet_fault').ok);
 assert.equal(breaker.protection.direction,'north');assert.equal(breaker.protection.mode,'wet_fault');assert.equal(breakerClosed(breaker),false);
 assert.ok(setBreaker(s,'surface',10,9,true,'west','manual').ok);assert.equal(breakerClosed(breaker),true);check(s);
});

test('manual opening immediately isolates its branch without consuming energy or moving stored charge',()=>{
 const {s,site,breaker,load}=fixture();assert.equal(load.powered,false);
 const energy=structuredClone(site.energy),bank=at(site,13,7).charge;
 assert.ok(setBreaker(s,'surface',10,9,true,'east','manual').ok);assert.equal(load.powered,true);
 assert.ok(setBreaker(s,'surface',10,9,false,'east','manual').ok);assert.equal(load.powered,false);
 assert.equal(breakerClosed(breaker),false);assert.deepEqual(site.energy,energy);close(at(site,13,7).charge,bank);check(s);
});

test('a broken breaker cannot close or reset and zero condition opens an existing contact',()=>{
 const {s,site,breaker,load}=fixture();setBreaker(s,'surface',10,9,true,'east','manual');assert.equal(load.powered,true);
 breaker.hp=0;refreshPower(s,site);assert.equal(breakerClosed(breaker),false);assert.equal(load.powered,false);
 const broken=structuredClone(s);
 assert.equal(setBreaker(s,'surface',10,9,true,'east','manual').ok,false);assert.deepEqual(s,broken);
 assert.equal(resetBreaker(s,'surface',10,9).ok,false);assert.deepEqual(s,broken);
 assert.ok(setBreaker(s,'surface',10,9,false,'east','manual').ok);check(s);
});

test('physical repair preserves a wet-fault latch and reset leaves the repaired breaker open',()=>{
 const f=fixture(),{s,site,breaker}=f;wetFault(f);breaker.hp=0;refreshPower(s,site);
 const before=totalResources(s).alloy,result=order(s,'surface',10,9,'repair','breaker');assert.ok(result.ok);assert.equal(result.job.building,null);
 assert.deepEqual(result.job.cost,{alloy:1});assert.equal(breaker.hp,0);
 until(s,()=>result.job.materials.alloy===1);assert.equal(breaker.hp,0);close(totalResources(s).alloy,before);
 until(s,()=>breaker.hp===100);close(totalResources(s).alloy,before-1);
 assert.equal(breaker.protection.tripped,true);assert.equal(breaker.protection.cause,'wet_fault');assert.equal(breakerClosed(breaker),false);
 const tripped=structuredClone(s);assert.equal(setBreaker(s,'surface',10,9,true,'east','wet_fault').ok,false);assert.deepEqual(s,tripped);
 assert.ok(resetBreaker(s,'surface',10,9).ok);assert.equal(breaker.protection.tripped,false);assert.equal(breaker.protection.cause,null);
 assert.equal(breaker.protection.enabled,false);assert.equal(breakerClosed(breaker),false);check(s);
});

test('reset rejects a closed contact or burning breaker atomically and can clear an open trip after fire removal',()=>{
 const f=fixture(),{s,site,breaker}=f;
 setBreaker(s,'surface',10,9,true,'east','manual');const closed=structuredClone(s);
 assert.equal(resetBreaker(s,'surface',10,9).ok,false);assert.deepEqual(s,closed);
 setBreaker(s,'surface',10,9,false,'east','manual');wetFault(f);
 assert.ok(ignite(s,site,breaker));const burning=structuredClone(s);
 assert.equal(resetBreaker(s,'surface',10,9).ok,false);assert.deepEqual(s,burning);
 extinguish(s,site,breaker,'test_fixture');assert.ok(resetBreaker(s,'surface',10,9).ok);
 assert.equal(breaker.protection.enabled,false);assert.equal(breaker.protection.tripped,false);assert.equal(breakerClosed(breaker),false);check(s);
});
