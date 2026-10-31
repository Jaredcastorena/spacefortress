import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,serialize,order} from '../src/simulation.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {updateRooms,roomAt,fillRoom,emptyGas,refreshAtmosphere} from '../src/atmosphere.js';
import {refreshPower} from '../src/power.js';
import {HEAT_CAPACITY} from '../src/thermal.js';
import {productionEligibility,validateProduction} from '../src/production.js';
import {refillSuitFromSupply} from '../src/suit-supply.js';
import {executeAction} from '../src/controls.js';
import {startRecording,exportRecording,recordingStatus} from '../src/telemetry.js';
import {distance} from '../src/geometry.js';
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
// Missing records must not masquerade as stalled physical work.
const record=s=>{startRecording(s);assert.equal(recordingStatus(s).active,true);};
const events=s=>{assert.equal(recordingStatus(s).reason,null,'The bounded recording must retain every asserted event.');return exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);};
// Synthetic declared floor. Canonical saves still accept only deck zero.
function fixture(){
 const s=createGame(74219),site=s.sites.surface;
 site.levels.push({z:7,name:'Upper test deck'});
 // Natural ground conditions and pond water do not become an upstairs reservoir.
 site.tiles.push(...site.tiles.map(t=>{const upper={...structuredClone(t),z:7,liquid:0,wetShort:false};for(const key of ['biome','temperatureOffset','basin','initialWater'])delete upper[key];return upper;}));
 updateRooms(site);for(const r of site.rooms){fillRoom(r);r.heat=(20+273.15)*r.volume*HEAT_CAPACITY;}
 for(const c of s.crew){for(const k of Object.keys(c.labors))c.labors[k]=false;c.life.policy='work';c.hunger=c.energy=c.oxygen=100;}
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 const c=s.crew[0];Object.assign(c,{x:8,y:9,z:7,job:null,intent:null,carry:null,delivery:null});
 const machine=at(site,13,10,7),ground=at(site,13,10),store=at(site,8,10,7),lowerStore=at(site,8,10);
 refreshAtmosphere(site);refreshPower(s,site);return {s,site,c,machine,ground,store,lowerStore};
}
function until(f,p,limit=60){for(let n=0;n<limit&&!p();n++){const before=positionOf(f.c);step(f.s);assert.equal(f.c.z,7);assert.ok(distance([before.x,before.y],[f.c.x,f.c.y])<=1);}assert.ok(p(),`Stopped at tick ${f.s.tick}: ${f.c.activity}`);}
function enable(f){f.c.labors.production=true;f.machine.machine.enabled=true;f.machine.machine.input={ore:1};f.machine.machine.order={mode:'batches',limit:1,remaining:1,priority:3};refreshPower(f.s,f.site);}
const operate=s=>order(s,'surface',13,10,'operate',null,7);

test('an upstairs operator walks to a powered machine and converts one delivered batch',()=>{
 const f=fixture();enable(f);const {status:lowerStatus,...lower}=structuredClone(f.ground.machine);record(f.s);
 step(f.s);assert.ok(f.s.jobs.some(j=>j.kind==='operate'&&j.z===7));assert.equal(f.machine.machine.progress,0);
 until(f,()=>f.machine.machine.completed===1);assert.equal(f.machine.machine.input.ore||0,0);assert.deepEqual(f.machine.machine.batch,{});assert.ok(f.machine.machine.output.alloy>0);const {status,...lowerAfter}=f.ground.machine;assert.deepEqual(lowerAfter,lower);
 assert.equal(distance([f.c.x,f.c.y],[13,10]),1);assert.equal(f.machine.machine.order.remaining,0);
 for(const id of ['production.batch.started','production.batch.completed'])assert.equal(events(f.s).find(e=>e.id===id).entity,'tile:surface:13:10:7');
});

test('production readiness and ordering cannot borrow workers or supplies from downstairs',()=>{
 const f=fixture();enable(f);f.c.z=0;f.machine.machine.input={};f.store.stock={};
 for(const t of f.site.tiles.filter(t=>t.z===7)){if(t.stock)t.stock={};if(t.imports)t.imports={};}
 f.lowerStore.stock={ore:10};const status=productionEligibility(f.s,f.site,f.machine);
 assert.deepEqual(status.eligibleCrewIds,[]);assert.equal(status.blockedCode,'no_qualified_operator');assert.equal(status.requirements.find(r=>r.resource==='ore').available,0);
 f.machine.machine.input={ore:1};const before=serialize(f.s);assert.equal(operate(f.s).ok,false);assert.equal(serialize(f.s),before);
});

test('overlapping operations keep separate priority and cancellation',()=>{
 const f=fixture();enable(f);const a=operate(f.s);assert.equal(a.ok,true,a.message);
 f.ground.machine.enabled=true;f.ground.machine.input={ore:1};refreshPower(f.s,f.site);
 assert.equal(order(f.s,'surface',13,10,'operate').ok,true);assert.doesNotThrow(()=>validateProduction(f.s));
 const priority=f.ground.machine.order.priority;assert.equal(executeAction(f.s,'job.priority',{job:a.job.id,priority:5}).ok,true);assert.equal(f.machine.machine.order.priority,5);assert.equal(f.ground.machine.order.priority,priority);
 assert.equal(executeAction(f.s,'job.cancel',{job:a.job.id}).ok,true);assert.equal(f.machine.machine.enabled,false);assert.equal(f.ground.machine.enabled,true);assert.equal(f.machine.machine.input.ore,1);
});

test('meal recovery walks to and spends food only on the crew floor',()=>{
 const f=fixture();f.c.hunger=10;f.store.stock={food:2};f.lowerStore.stock={food:10};
 until(f,()=>f.c.intent?.type==='meal'&&f.c.intent.servings===8,15);
 assert.deepEqual(positionOf(f.c),{x:8,y:10,z:7});assert.equal(f.store.stock.food,1);assert.equal(f.lowerStore.stock.food,10);
 until(f,()=>f.c.intent?.type!=='meal',10);assert.ok(f.c.hunger>70);
});

test('a hungry upstairs crew member cannot eat a downstairs parcel at matching coordinates',()=>{
 const f=fixture();f.c.hunger=10;f.c.x=8;f.c.y=10;
 for(const t of f.site.tiles.filter(t=>t.z===7))for(const slot of ['stock','drop','imports'])if(t[slot])t[slot]={};
 f.lowerStore.stock={food:10};step(f.s,3);assert.equal(f.c.intent.servings,0);assert.equal(f.lowerStore.stock.food,10);assert.equal(f.c.z,7);assert.match(f.c.activity,/unreachable/);
});

test('bunk recovery uses an upstairs reservation despite a matching downstairs sleeper',()=>{
 const f=fixture(),bunk=f.site.tiles.find(t=>t.z===7&&t.building==='bunk'),p=positionOf(bunk);
 f.c.energy=5;f.s.crew[1].intent={type:'rest',target:{...p,z:0}};f.s.crew[1].energy=5;
 assert.equal(executeAction(f.s,'housing.assign',{site:'surface',...p,crew:f.c.id}).ok,true);
 until(f,()=>f.c.activity==='Sleeping until rested',20);assert.deepEqual(positionOf(f.c),p);assert.deepEqual(f.c.intent.target,p);
 const energy=f.c.energy;step(f.s,2);assert.ok(f.c.energy>energy);assert.equal(f.c.z,7);assert.ok(roomAt(f.site,p.x,p.y,7));
});

test('finite suit recovery walks to its own deck supply and rejects the overlapping lower depot',()=>{
 const f=fixture();for(const r of f.site.rooms)r.gas=emptyGas();refreshAtmosphere(f.site);
 f.c.oxygen=10;f.store.stock={air:2};f.lowerStore.stock={air:10};record(f.s);
 until(f,()=>events(f.s).some(e=>e.id==='crew.suit.refilled'),15);
 assert.deepEqual(positionOf(f.c),{x:8,y:10,z:7});assert.ok(f.store.stock.air<2);assert.equal(f.lowerStore.stock.air,10);
 assert.equal(events(f.s).find(e=>e.id==='crew.suit.refilled').target,'tile:surface:8:10:7');
 const before=serialize(f.s);assert.equal(refillSuitFromSupply(f.s,f.site,f.c,f.lowerStore),false);assert.equal(serialize(f.s),before);
});

test('downtime finds safe space on the current floor',()=>{
 const f=fixture();f.c.life.policy='rest';f.c.life.leisure=10;
 until(f,()=>f.c.intent?.type==='leisure'&&f.c.intent.rested>0,20);assert.equal(f.c.intent.target.z,7);assert.equal(f.c.z,7);
});
