import {roomComfort} from '../src/comfort.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, serialize, deserialize, pathTo, setLabor } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources } from '../src/inventory.js';
import { initializeElectrical, refreshPower, updatePower } from '../src/power.js';
import { haul } from '../src/industry.js';
import { temperature, HEAT_CAPACITY } from '../src/thermal.js';
import { reactorTemperature, setReactor, resetReactor, setRadiator, updateReactorCooling, radiatorBlock, radiatorTargets, releaseReactorHeat, validateReactors } from '../src/reactors.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
import { executeAction, actionCatalog } from '../src/controls.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const check=s=>deserialize(serialize(s));
function install(s,kind,x,y){const t=at(s.sites.surface,x,y);t.building=kind;t.hp=100;initializeStorage(t);initializeElectrical(t);return t;}
function fixture(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 const r=install(s,'reactor',12,11),rad=install(s,'radiator',12,13);
 for(let x=8;x<=12;x++)at(site,x,11).cable={enabled:true,hp:100};
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 refreshPower(s,site);return {s,site,r,rad};
}
function fuel(s,r,n=2){const d=at(s.sites.surface,8,10);d.stock.fuel-=n;r.machine.input.fuel=n;syncResources(s);refreshPower(s,s.sites.surface);}
function hotRoom(site,room,temp){const heat=(temp+273.15)*room.volume*HEAT_CAPACITY,delta=heat-room.heat;site.thermal[delta>=0?'added':'removed']+=Math.abs(delta);room.heat=heat;}
function until(s,condition,max=200){for(let i=0;i<max&&!condition();i++)step(s);assert.ok(condition(),'Condition not reached');}

test('new reactors need delivered construction supplies and start without fuel or stored heat',()=>{
 const s=createGame(),site=s.sites.surface,before=totalResources(s);for(const c of s.crew)c.labors.hauling=false;
 const j=order(s,'surface',12,11,'build','reactor');assert.ok(j.ok);assert.deepEqual(j.job.cost,{alloy:10,components:2});assert.equal(at(site,12,11).reactor,undefined);
 until(s,()=>at(site,12,11).building==='reactor');const r=at(site,12,11);assert.deepEqual(r.machine.input,{});assert.equal(r.reactor.heat,0);assert.equal(totalResources(s).alloy,before.alloy-10);assert.equal(totalResources(s).components,before.components-2);check(s);
 assert.equal(order(s,'surface',12,14,'build','reactor').ok,false);assert.ok(order(s,'surface',12,13,'build','radiator').ok);until(s,()=>at(site,12,13).building==='radiator');check(s);
});

test('haulers physically collect and deliver fuel into the reactor buffer',()=>{
 const {s,site,r}=fixture(),c=s.crew[1],depot=at(site,8,10);c.x=9;c.y=10;c.labors.hauling=true;const before=totalResources(s).fuel;
 assert.equal(r.machine.input.fuel,undefined);haul(s,c,site,pathTo);assert.ok(c.intent?.type==='haul'||c.carry);assert.equal(r.machine.input.fuel,undefined);
 for(let i=0;i<30&&!(r.machine.input.fuel>0);i++)haul(s,c,site,pathTo);
 assert.equal(r.machine.input.fuel,4);assert.equal(depot.stock.fuel,before-4);assert.equal(totalResources(s).fuel,before);syncResources(s);refreshPower(s,site);check(s);
});

test('day and night reactor generation consumes only its input fuel and balances core, room and electrical energy',()=>{
 const {s,site,r}=fixture();fuel(s,r);const before=totalResources(s).fuel,room=site.rooms[0],initialTemp=temperature(room);step(s,20);
 close(site.reactorLedger.generated,800);close(site.reactorLedger.fuelUsed,.4);close(totalResources(s).fuel+.4,before);assert.ok(site.reactorLedger.radiated>0);assert.ok(site.reactorLedger.toRooms>0);assert.equal(r.reactor.tripped,false);assert.ok(temperature(room)!==initialTemp);check(s);
 // Direct power allocation at night leaves all solar generation at zero.
 s.tick=220;const generated=site.energy.generated;updatePower(s,site);close(site.energy.generated-generated,40);validateReactors(s);
});

test('refreshing power and observations never consumes reactor fuel, adds heat or changes its ledger',()=>{
 const {s,site,r}=fixture();fuel(s,r);const before=serialize(s);for(let i=0;i<8;i++){refreshPower(s,site);observe(s);}assert.equal(serialize(s),before);check(s);
});

test('damage and throttle scale generation; partial fuel exhaustion cannot produce free energy',()=>{
 const {s,site,r}=fixture();fuel(s,r,.005);setReactor(s,'surface',r.x,r.y,50,true);r.hp=50;refreshPower(s,site);step(s);close(site.reactorLedger.generated,10);close(r.machine.input.fuel||0,0);const output=site.reactorLedger.generated;step(s,5);close(site.reactorLedger.generated,output);assert.match(r.powerStatus,/fuel delivery/);check(s);
});

test('paused and zero-output reactors retain fuel and release their output without clearing a trip',()=>{
 const {s,site,r}=fixture();fuel(s,r);setReactor(s,'surface',r.x,r.y,0,true);step(s,2);close(r.machine.input.fuel,2);setReactor(s,'surface',r.x,r.y,100,false);step(s,2);close(r.machine.input.fuel,2);close(site.reactorLedger.generated,0);check(s);
});

test('hot surroundings trip before fuel use and require cooling plus an explicit reset',()=>{
 const {s,site,r}=fixture();fuel(s,r);hotRoom(site,site.rooms[0],125);site.fireSafety.automatic=false;
 const before=r.machine.input.fuel;updatePower(s,site);assert.equal(r.reactor.tripped,true);close(r.machine.input.fuel,before);assert.equal(resetReactor(s,'surface',r.x,r.y).ok,false);
 setReactor(s,'surface',r.x,r.y,100,false);setReactor(s,'surface',r.x,r.y,100,true);assert.equal(r.reactor.tripped,true);
 hotRoom(site,site.rooms[0],20);refreshPower(s,site);assert.equal(resetReactor(s,'surface',r.x,r.y).ok,true);step(s);assert.ok(r.machine.input.fuel<before);check(s);
});

test('removing radiator cooling can overheat a reactor in a hot room; cooling retains the latch until reset',()=>{
 const {s,site,r,rad}=fixture();fuel(s,r);hotRoom(site,site.rooms[0],85);site.fireSafety.automatic=false;setRadiator(s,'surface',rad.x,rad.y,false);
 until(s,()=>r.reactor.tripped,120);assert.equal(r.powerStatus,'Overheat shutdown');const used=site.reactorLedger.fuelUsed;
 setRadiator(s,'surface',rad.x,rad.y,true);hotRoom(site,site.rooms[0],20);step(s,30);close(site.reactorLedger.fuelUsed,used);assert.ok(reactorTemperature(site,r)<=60);assert.ok(resetReactor(s,'surface',r.x,r.y).ok);step(s);assert.ok(site.reactorLedger.fuelUsed>used);check(s);
});

test('radiator heat links need adjacency or an intact wall feedthrough; disabled, broken and pressurized radiators stop',()=>{
 const {s,site,r,rad}=fixture();fuel(s,r);assert.deepEqual(radiatorTargets(site,rad),[r]);step(s);assert.ok(site.reactorLedger.radiated>0);
 for(const block of [()=>setRadiator(s,'surface',rad.x,rad.y,false),()=>{rad.radiator.enabled=true;rad.hp=0;},()=>{rad.hp=100;at(site,12,12).hp=0;}]){
  block();updatePower(s,site);const before=site.reactorLedger.radiated;updateReactorCooling(s);close(site.reactorLedger.radiated,before);
 }
 at(site,12,12).hp=100;rad.hp=100;install(s,'radiator',11,11);const indoor=at(site,11,11);assert.deepEqual(radiatorTargets(site,indoor),[r]);updateReactorCooling(s);assert.equal(indoor.radiator.status,'Needs exterior or near-vacuum');
 // Diagonal/range-three tiles do not gain hidden thermal connections.
 assert.equal(radiatorTargets(site,{x:13,y:13}).length,0);assert.equal(radiatorTargets(site,{x:12,y:14}).length,0);refreshPower(s,site);check(s);
});

test('physical demolition retains fuel in loose storage and accounts for remaining core heat',()=>{
 const {s,site,r}=fixture();fuel(s,r);step(s,2);setReactor(s,'surface',r.x,r.y,100,false);const before=totalResources(s).fuel;
 assert.ok(order(s,'surface',r.x,r.y,'remove').ok);until(s,()=>r.building===null);assert.equal(r.reactor,undefined);assert.equal(r.machine,undefined);close(totalResources(s).fuel,before);assert.ok(r.drop.fuel>0);check(s);
});

test('carried fuel survives a missing reactor destination and returns to storage',()=>{
 const {s,site,r}=fixture(),c=s.crew[0];c.labors.hauling=true;c.x=8;c.y=10;haul(s,c,site,pathTo);assert.equal(c.carry.fuel,4);
 setReactor(s,'surface',r.x,r.y,100,false);releaseReactorHeat(s,site,r);r.building=null;delete r.machine;const before=totalResources(s).fuel;
 for(let i=0;i<20&&c.carry;i++)haul(s,c,site,pathTo);assert.equal(c.carry,null);close(totalResources(s).fuel,before);refreshPower(s,site);check(s);
});

test('new controls, observations and semantic events are shared and recording does not change simulation',()=>{
 const {s:a,r}=fixture();fuel(a,r);const b=check(a);startRecording(a,{maxRecords:10000,maxBytes:32000000});
 for(const s of [a,b]){
  assert.equal(executeAction(s,'reactor.configure',{site:'surface',x:12,y:11,percent:101,enabled:true},'agent').ok,false);
  assert.ok(executeAction(s,'reactor.configure',{site:'surface',x:12,y:11,percent:50,enabled:true},'player').ok);step(s,3);
 }
 assert.deepEqual(a,b);const rows=exportRecording(a).trim().split('\n').map(JSON.parse);
 for(const type of ['reactor.controls.changed','reactor.generated','reactor.heat.radiated','reactor.heat.transferred'])assert.ok(rows.some(r=>r.event?.type===type||r.event?.id===type),type);
 assert.ok(actionCatalog().some(a=>a.id==='reactor.reset'));assert.ok(observe(a).entities['tile:surface:12:11'].derived.reactorTemperature>=20);
});

test('reactor state continues deterministically after save/reload and old saves gain no equipment or fuel',()=>{
 const {s,r}=fixture();fuel(s,r);step(s,10);const copy=check(s);step(s,12);step(copy,12);assert.deepEqual(s,copy);
 const legacy=createGame();legacy.version=30;for(const site of Object.values(legacy.sites))delete site.reactorLedger;const before=totalResources(legacy),migrated=check(legacy);assert.equal(migrated.version, VERSION);assert.deepEqual(totalResources(migrated),before);assert.ok(migrated.sites.surface.tiles.every(t=>!t.reactor&&!t.radiator));assert.equal(migrated.rng,legacy.rng);assert.deepEqual(check(migrated),migrated);
});

test('malformed reactor controls, buffers, unattached components and heat/energy accounting are rejected',()=>{
 for(const change of [({r})=>r.reactor.output=101,({r})=>r.reactor.tripped='yes',({r})=>r.reactor.heat++,({r})=>r.machine.input.fuel=5,({site})=>site.reactorLedger.generated++,({site})=>at(site,8,9).reactor={heat:0,output:100,tripped:false},({rad})=>rad.radiator.enabled=1]){
  const f=fixture();change(f);assert.throws(()=>check(f.s));
 }
});


test('normal colony ticks refill reactor fuel in useful batches, with no tiny idle deliveries',()=>{
 const {s,site,r}=fixture(),before=totalResources(s).fuel;s.crew[1].labors.hauling=true;
 until(s,()=>site.reactorLedger.generated>0,100);close(totalResources(s).fuel+site.reactorLedger.fuelUsed,before);check(s);
 const c=s.crew[1];c.intent=null;c.carry=null;c.delivery=null;
 // Stop producing while leaving the automatic buffer enabled. A nearly full buffer needs no trip.
 setReactor(s,'surface',r.x,r.y,0,true);r.machine.input.fuel=3.5;assert.equal(haul(s,c,site,pathTo),false);
});

test('radiator near-vacuum threshold uses colony pressure percentages correctly',()=>{
 const {site}=fixture();const rad=install({sites:{surface:site}},'radiator',11,11);
 const withPressure=pressure=>({...site,rooms:site.rooms.map(r=>({...r,pressure}))});
 assert.equal(radiatorBlock(withPressure(5),rad),null);assert.match(radiatorBlock(withPressure(5.01),rad),/near-vacuum/);
});

test('running reactors add machinery noise, while pausing releases that comfort penalty',()=>{
 const {s,site,r}=fixture();fuel(s,r);assert.equal(roomComfort(s,site,site.rooms[0]).noise,2);
 setReactor(s,'surface',r.x,r.y,100,false);assert.equal(roomComfort(s,site,site.rooms[0]).noise,0);check(s);
});
