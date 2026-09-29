import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import {createGame,at,step,order,cancelJob,setLabor,serialize,deserialize,updateRooms} from '../src/simulation.js';
import {FIRE,ignite,extinguish,setFireResponse} from '../src/fire.js';
import {gasAmount,roomAt,refreshAtmosphere,breathable,setDoorMode} from '../src/atmosphere.js';
import {temperature} from '../src/thermal.js';
import {setMachineEnabled} from '../src/industry.js';
import {totalResources,syncResources} from '../src/inventory.js';
import {pathTo} from '../src/navigation.js';
import {startRecording,exportRecording,observe} from '../src/telemetry.js';
import {executeAction} from '../src/controls.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const check=s=>{syncResources(s);return deserialize(serialize(s));};
const until=(s,p,max=200)=>{for(let i=0;i<max&&!p();i++){step(s);check(s);}assert.ok(p(),`Condition missing at ${s.tick}`);};
function fixture(){const s=createGame(),site=s.sites.surface,t=at(site,11,9);t.building='commons';setFireResponse(s,'surface',false);for(const t of site.tiles)if(t.machine)setMachineEnabled(s,'surface',t.x,t.y,false);for(const c of s.crew)setLabor(s,c.id,'hauling',false);return {s,site,t,r:roomAt(site,11,9)};}
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
const gas=s=>totalResources(s).air+s.crew.reduce((n,c)=>n+c.oxygen*.1,0)+Object.values(s.sites).reduce((n,site)=>n+gasAmount(site.atmosphere.vented)+site.rooms.reduce((n,r)=>n+gasAmount(r.gas),0),0);

test('damaged powered equipment ignites after sustained fault time, and isolation resets it',()=>{
 const {s,site}=fixture(),t=at(site,13,10);t.hp=25;setMachineEnabled(s,'surface',13,10,true);step(s,60);assert.equal(t.fireFault,60);assert.equal(t.fire,undefined);setMachineEnabled(s,'surface',13,10,false);step(s);assert.equal(t.fireFault,undefined);setMachineEnabled(s,'surface',13,10,true);until(s,()=>!!t.fire,125);assert.equal(t.fire.age,1);check(s);
});

test('combustion conserves total gas and accounts for heat, oxygen conversion and smoke',()=>{
 const {s,site,t,r}=fixture(),before=gas(s),temp=temperature(r);assert.ok(ignite(s,site,t));step(s,12);close(gas(s),before);assert.ok(site.fireSafety.oxygenBurned>0);close(site.thermal.combustion,site.fireSafety.oxygenBurned*1000);assert.ok(temperature(r)>temp);close(r.smoke,site.fireSafety.smokeProduced-site.fireSafety.smokeCleared-site.fireSafety.smokeVented);assert.ok(t.hp<100);check(s);
});

test('oxygen-poor rooms and exposed terrain cannot ignite, and existing flames starve',()=>{
 const {s,site,t,r}=fixture();assert.ok(ignite(s,site,t));r.gas.inert+=r.gas.oxygen;r.gas.oxygen=0;refreshAtmosphere(site);step(s,2);assert.equal(t.fire,undefined);assert.equal(ignite(s,site,t),false);assert.equal(ignite(s,site,at(site,7,14)),false);check(s);
});

test('fire spreads to adjacent combustible fittings and records parent fire identity',()=>{
 const {s,site,t}=fixture(),n=at(site,12,9);n.building='commons';startRecording(s);ignite(s,site,t);const id=t.fire.id;step(s,30);assert.ok(n.fire);assert.equal(n.fire.age,0);assert.ok(events(s).some(e=>e.id==='fire.ignited'&&e.cause==='spread'&&e.parent===id));check(s);
});

test('a consumed fitting extinguishes without removing its inventory or room volume',()=>{
 const {s,site,t}=fixture();t.hp=.1;const volume=site.rooms[0].volume;startRecording(s);ignite(s,site,t);step(s);assert.equal(t.hp,0);assert.equal(t.fire,undefined);assert.equal(t.building,'commons');assert.equal(site.rooms[0].volume,volume);assert.ok(events(s).some(e=>e.id==='fire.extinguished'&&e.reason==='fuel_exhausted'));check(s);
});

test('dense smoke makes the compartment unsafe and crew consume suit air',()=>{
 const {s,site,r}=fixture(),c=s.crew[0];r.smoke=4;site.fireSafety.smokeProduced=4;refreshAtmosphere(site);assert.equal(breathable(r),false);const air=c.oxygen;step(s);assert.ok(c.oxygen<air);assert.equal(r.air,0);check(s);
});

test('powered life support filters smoke with an explicit clearing ledger',()=>{
 const {s,site,r}=fixture();r.smoke=3;site.fireSafety.smokeProduced=3;refreshAtmosphere(site);setMachineEnabled(s,'surface',7,7,true);step(s,10);assert.ok(r.smoke<3);assert.ok(site.fireSafety.smokeCleared>0);close(r.smoke+site.fireSafety.smokeCleared+site.fireSafety.smokeVented,3);check(s);
});

test('smoke follows door flow, stays isolated behind sealed doors and vents to exterior',()=>{
 const {s,site}=fixture();for(const c of s.crew){c.x=7;c.y=8;}for(let y=7;y<=11;y++)at(site,10,y).building='wall';at(site,10,9).building='door';at(site,6,9).building='door';updateRooms(site);setDoorMode(s,'surface',6,9,'closed');setDoorMode(s,'surface',10,9,'closed');const left=roomAt(site,8,9),right=roomAt(site,12,9);left.smoke=3;site.fireSafety.smokeProduced=3;refreshAtmosphere(site);step(s,3);assert.equal(right.smoke,0);setDoorMode(s,'surface',10,9,'open');step(s,3);assert.ok(right.smoke>0);close(left.smoke+right.smoke+site.fireSafety.smokeVented,3);setDoorMode(s,'surface',6,9,'open');step(s,3);assert.ok(site.fireSafety.smokeVented>0);check(s);
});

test('splitting, merging and deleting room volume preserve or account for smoke',()=>{
 const {s,site,r}=fixture();r.smoke=10;site.fireSafety.smokeProduced=10;refreshAtmosphere(site);for(let y=7;y<=11;y++)at(site,10,y).building='wall';updateRooms(site);close(site.rooms.reduce((n,r)=>n+r.smoke,0),10);for(let y=7;y<=11;y++)at(site,10,y).building=null;updateRooms(site);close(site.rooms[0].smoke,10);for(const t of site.tiles)if(t.terrain==='floor')t.building='wall';updateRooms(site);close(site.fireSafety.smokeVented,10);assert.equal(site.rooms.length,0);
});

test('suppression requires physically delivered water and actual engineering work',()=>{
 const {s,site,t}=fixture(),before=totalResources(s).water;ignite(s,site,t);const j=order(s,'surface',t.x,t.y,'extinguish','commons').job;assert.ok(j);assert.equal(j.building,null);assert.equal(j.materials.water,undefined);assert.ok(t.fire);until(s,()=>j.materials.water===2);assert.ok(t.fire);assert.equal(totalResources(s).water,before);until(s,()=>!t.fire);assert.equal(totalResources(s).water,before-2);assert.ok(!s.jobs.includes(j));check(s);
});

test('automatic response creates urgent jobs and missing duty or water leaves labeled obstructions',()=>{
 const {s,site,t}=fixture();for(const c of s.crew)setLabor(s,c.id,'engineering',false);setFireResponse(s,'surface',true);ignite(s,site,t);step(s,2);const j=s.jobs.find(j=>j.kind==='extinguish');assert.equal(j.priority,5);assert.match(j.blockedReason,/engineering/);setLabor(s,s.crew[1].id,'engineering',true);until(s,()=>!t.fire);check(s);
 const f=fixture();delete at(f.site,8,10).stock.water;syncResources(f.s);setFireResponse(f.s,'surface',true);ignite(f.s,f.site,f.t);step(f.s);assert.match(f.t.fire.blocked,/supplies/);assert.ok(!f.s.jobs.some(j=>j.kind==='extinguish'));check(f.s);
});

test('cancellation preserves water and delays automatic retry; a manual order bypasses it',()=>{
 const {s,site,t}=fixture();setFireResponse(s,'surface',true);ignite(s,site,t);step(s);const j=s.jobs.find(j=>j.kind==='extinguish'),water=totalResources(s).water;cancelJob(s,j.id);assert.equal(totalResources(s).water,water);assert.equal(t.fire.retryAt,s.tick+120);step(s,5);assert.ok(!s.jobs.some(j=>j.kind==='extinguish'));assert.ok(order(s,'surface',t.x,t.y,'extinguish').ok);check(s);
});

test('a fire ending during delivery cancels only its own job and preserves reserved water',()=>{
 const {s,site,t}=fixture();ignite(s,site,t);const j=order(s,'surface',t.x,t.y,'extinguish').job;until(s,()=>!!j.materials.water);const water=totalResources(s).water;extinguish(s,site,t,'oxygen_starved');step(s);assert.ok(!s.jobs.includes(j));assert.equal(totalResources(s).water,water);check(s);
});

test('burning tiles block routes and ordinary work; a crew member standing there is injured and escapes',()=>{
 const {s,site,t}=fixture(),c=s.crew[0];c.x=t.x;c.y=t.y;startRecording(s);ignite(s,site,t);assert.equal(pathTo(site,s.crew[1],[[t.x,t.y]]),null);assert.equal(order(s,'surface',t.x,t.y,'remove').ok,false);step(s);assert.ok(c.medical.injury>0);assert.ok(c.x!==t.x||c.y!==t.y);assert.ok(events(s).some(e=>e.id==='fire.evacuated'&&e.actor===c.id));check(s);
});

test('suppression interrupted by recovery retains its delivered supplies and can finish later',()=>{
 const {s,site,t}=fixture();ignite(s,site,t);const j=order(s,'surface',t.x,t.y,'extinguish').job;until(s,()=>!!j.materials.water);const c=s.crew.find(c=>c.id===j.worker),water=totalResources(s).water;c.energy=0;step(s);assert.equal(totalResources(s).water,water);until(s,()=>!t.fire);assert.equal(totalResources(s).water,water-2);check(s);
});

test('burning production stops while retaining batch ingredients',()=>{
 const {s,site}=fixture(),t=at(site,13,10);setMachineEnabled(s,'surface',13,10,true);t.machine.batch={ore:1};t.machine.progress=2;const before=totalResources(s).ore;ignite(s,site,t);step(s,2);assert.equal(t.machine.progress,2);assert.equal(totalResources(s).ore,before);assert.match(t.machine.status,/Fire/);check(s);
});

test('fire state, partial suppression and smoke reload deterministically; recording changes no outcomes',()=>{
 const {s,site,t}=fixture();ignite(s,site,t);order(s,'surface',t.x,t.y,'extinguish');step(s,3);const copy=check(s);startRecording(s,{maxRecords:10000,maxBytes:32000000});step(s,50);step(copy,50);assert.deepEqual(copy,s);assert.ok(events(s).some(e=>e.id==='fire.burned'));assert.ok(events(s).some(e=>e.id==='fire.extinguished'&&e.actor));check(s);
});

test('migration adds no smoke or heat and malformed fire ledgers and orders are rejected',()=>{
 const {s}=fixture();s.version=29;for(const site of Object.values(s.sites)){delete site.fireSafety;delete site.thermal.combustion;for(const r of site.rooms)delete r.smoke;}const resources=totalResources(s),copy=check(s);assert.equal(copy.version, VERSION);assert.deepEqual(totalResources(copy),resources);assert.equal(copy.sites.surface.fireSafety.smokeProduced,0);
 for(const mutate of [f=>f.site.fireSafety.smokeProduced=1,f=>f.r.smoke=-1,f=>f.t.fire.intensity=101,f=>f.t.fire.started=9999,f=>f.t.fire.id='fire-9999',f=>f.site.thermal.combustion=1]){const f=fixture();ignite(f.s,f.site,f.t);mutate(f);assert.throws(()=>check(f.s));}
});

test('shared response controls and normalized fire entities carry stable labels',()=>{
 const {s,site,t}=fixture();startRecording(s);assert.ok(executeAction(s,'fire.response',{site:'surface',enabled:true},'player').ok);ignite(s,site,t);const id=t.fire.id;assert.equal(observe(s).entities[id].tile,`tile:surface:${t.x}:${t.y}`);until(s,()=>!t.fire);for(const id of ['fire.ignited','fire.burned','structure.damaged','fire.extinguished'])assert.ok(events(s).some(e=>e.id===id),id);assert.equal(observe(s).entities[id],undefined);check(s);
});
