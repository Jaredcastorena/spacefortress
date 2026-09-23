import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, at, step, pathTo, updateRooms, roomAt, serialize, deserialize} from '../src/simulation.js';
import {initializeStorage, totalResources, syncResources} from '../src/inventory.js';
import {initializeElectrical, refreshPower, previewPower, breakerConditions, setCableEnabled, validatePower} from '../src/power.js';
import {initializeBreakerTile, setBreaker, resetBreaker} from '../src/breakers.js';
import {initializePlumbingTile, newWaterPipe, setWaterIntake, setWaterOutlet} from '../src/plumbing.js';
import {wetCable} from '../src/liquids.js';
import {haul, setMachineEnabled} from '../src/industry.js';
import {setProductionOrder} from '../src/production.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function until(s,p,limit=120){for(let i=0;i<limit&&!p();i++)step(s);assert.ok(p(),`Condition not reached at tick ${s.tick}`);}
function balance(s,site){
 const e=site.energy,stored=site.tiles.reduce((sum,t)=>sum+(t.building==='battery'?t.charge:0),0);
 close(stored+e.consumed+e.curtailed+e.discarded,e.initial+e.generated+e.injected);validatePower(s,site);
}
function check(s){syncResources(s);refreshPower(s,s.sites.surface);deserialize(serialize(s));}
function install(s,kind,x,y){
 const t=at(s.sites.surface,x,y);assert.equal(t.building,null,`Occupied fixture at ${x},${y}`);
 t.building=kind;t.hp=100;initializeStorage(t);initializeElectrical(t);initializePlumbingTile(t);initializeBreakerTile(t);return t;
}
function wire(site,x,y){const t=at(site,x,y);t.cable={enabled:true,hp:100};return t;}
function delivered(s,c){for(let i=0;i<50&&(c.carry||c.intent?.type==='haul');i++)haul(s,c,s.sites.surface,pathTo);assert.equal(c.carry,null);assert.notEqual(c.intent?.type,'haul');}
function fixture(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles){t.cable=null;if(t.machine)t.machine.enabled=false;}
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 const source=install(s,'advanced',8,8),breaker=install(s,'breaker',10,8),intake=install(s,'waterIntake',10,10),outlet=install(s,'waterOutlet',11,9),tank=install(s,'waterTank',10,11);
 const node=at(site,10,9);node.waterPipe=newWaterPipe();
 // Two walls make the discharged puddle remain deep enough for the next real floor-flow tick.
 at(site,12,10).building='wall';at(site,13,9).building='wall';updateRooms(site);
 for(const [x,y] of [[7,8],[9,8],[8,9],[8,10],[9,10],[11,8],[12,8],[12,9],[13,9]])wire(site,x,y);
 const life=at(site,7,7),factory=at(site,13,10),wet=at(site,12,9);life.machine.enabled=true;factory.machine.enabled=true;
 const depot=at(site,8,10),hauler=s.crew[0];depot.stock.water=6;depot.stock.ore=1;
 // Tank refilling is an actual reserved pickup and walk, not a transfer into its buffer.
 hauler.labors.hauling=true;hauler.intent={type:'haul',source:'stock',target:[8,10],items:{water:6},destination:{kind:'input',target:[10,11]}};
 delivered(s,hauler);close(tank.machine.input.water,6);close(depot.stock.water||0,0);hauler.labors.hauling=false;
 setMachineEnabled(s,'surface',10,11,false);
 assert.ok(setWaterIntake(s,'surface',10,10,true,'north','inventory').ok);
 assert.ok(setWaterOutlet(s,'surface',11,9,true,'east','floor').ok);
 assert.ok(setBreaker(s,'surface',10,8,true,'east','wet_fault').ok);
 setProductionOrder(s,'surface',13,10,'batches',1);
 const room=roomAt(site,life.x,life.y);room.smoke+=1;site.fireSafety.smokeProduced+=1;
 syncResources(s);refreshPower(s,site);
 assert.equal(life.powered,true);assert.equal(factory.powered,true);assert.equal(intake.powered,true);assert.equal(outlet.powered,true);
 return {s,site,source,breaker,intake,outlet,tank,node,life,factory,wet,hauler};
}
function discharge(f){
 until(f.s,()=>f.wet.liquid>=.25,12);
 assert.equal(f.breaker.protection.tripped,false);assert.ok(f.site.plumbing.released>0);
 assert.ok(previewPower(f.s,f.site).suppliedFaults.has(f.wet));
}

test('a real water discharge trips its branch, preserves life support, and permits supplied production after flow is stopped and the contact reset',()=>{
 const f=fixture(),{s,site,breaker,life,factory,wet}=f,water=totalResources(s).water;discharge(f);
 const energy=site.liquids.faultEnergy,hp=wet.cable.hp,cleared=site.fireSafety.smokeCleared;
 assert.equal(breakerConditions(s,site,breaker).wouldTrip,true);step(s);
 assert.equal(breaker.protection.tripped,true);assert.equal(breaker.protection.cause,'wet_fault');
 assert.equal(life.powered,true);assert.equal(factory.powered,false);assert.equal(wet.cable.enabled,true);
 assert.ok(site.fireSafety.smokeCleared>cleared,'Powered life support must still perform filtration');
 close(site.liquids.faultEnergy,energy);close(wet.cable.hp,hp);close(totalResources(s).water+site.liquids.lost+site.liquids.quenched,water);
 assert.equal(factory.machine.completed,0);assert.deepEqual(factory.machine.batch,{});
 assert.ok(setWaterIntake(s,'surface',10,10,false,'north','inventory').ok);
 assert.ok(setWaterOutlet(s,'surface',11,9,false,'east','floor').ok);
 until(s,()=>!site.tiles.some(wetCable),60);
 assert.ok(resetBreaker(s,'surface',10,8).ok);assert.equal(breaker.protection.enabled,false);assert.equal(factory.powered,false);
 assert.ok(setBreaker(s,'surface',10,8,true,'east','wet_fault').ok);assert.equal(factory.powered,true);
 const c=f.hauler,alloy=totalResources(s).alloy;c.labors.hauling=true;
 c.intent={type:'haul',source:'stock',target:[8,10],items:{ore:1},destination:{kind:'input',target:[13,10]}};
 delivered(s,c);c.labors.hauling=false;close(factory.machine.input.ore,1);
 const worker=s.crew[1];worker.labors.production=true;until(s,()=>factory.machine.completed===1);
 close(factory.machine.output.alloy,2);close(totalResources(s).alloy,alloy+2);close(totalResources(s).ore,0);
 assert.equal(breaker.protection.tripped,false);assert.equal(life.powered,true);close(site.liquids.faultEnergy,energy);
 close(totalResources(s).water+site.liquids.lost+site.liquids.quenched,water);balance(s,site);check(s);
});

test('a physical bypass keeps a flooded branch powered and manual opening never disables remote cable',()=>{
 const f=fixture(),{s,site,breaker,wet,life}=f;
 for(const [x,y] of [[9,7],[10,7],[11,7]])wire(site,x,y);
 refreshPower(s,site);discharge(f);const before=site.liquids.faultEnergy,hp=wet.cable.hp;
 const conditions=breakerConditions(s,site,breaker);assert.equal(conditions.bypassed,true);assert.equal(conditions.wouldTrip,false);
 step(s);assert.equal(breaker.protection.tripped,false);close(site.liquids.faultEnergy-before,5);close(wet.cable.hp,hp-.25);assert.equal(life.powered,true);
 const cables=site.tiles.filter(t=>t.cable).map(t=>[t,t.cable.enabled]);
 assert.ok(setBreaker(s,'surface',10,8,false,'east','wet_fault').ok);
 assert.ok(previewPower(s,site).suppliedFaults.has(wet));for(const [tile,enabled] of cables)assert.equal(tile.cable.enabled,enabled);
 assert.ok(setCableEnabled(s,'surface',10,7,false).ok);
 assert.equal(previewPower(s,site).suppliedFaults.has(wet),false);assert.equal(life.powered,true);assert.equal(wet.cable.enabled,true);
 balance(s,site);check(s);
});

test('a downstream battery continues supplying a real wet fault after its upstream breaker trips',()=>{
 const f=fixture(),{s,site,breaker,wet,life,factory}=f;discharge(f);
 const bank=install(s,'battery',13,11);bank.charge=20;site.energy.injected+=20;refreshPower(s,site);
 const before=site.liquids.faultEnergy,hp=wet.cable.hp,charge=bank.charge,water=totalResources(s).water;
 assert.equal(breakerConditions(s,site,breaker).wouldTrip,true);step(s);
 assert.equal(breaker.protection.tripped,true);assert.equal(life.powered,true);assert.equal(factory.powered,true);
 close(site.liquids.faultEnergy-before,5);close(wet.cable.hp,hp-.25);close(bank.charge,charge-10);
 assert.equal(wet.cable.enabled,true);assert.ok(breakerConditions(s,site,breaker).sourceEntities.includes('tile:surface:13:11'));
 close(totalResources(s).water+site.liquids.lost+site.liquids.quenched,water);balance(s,site);check(s);
});
