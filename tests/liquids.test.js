import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, serialize, deserialize, pathTo } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources } from '../src/inventory.js';
import { refreshPower, updatePower, setCableEnabled } from '../src/power.js';
import { haul } from '../src/industry.js';
import { ignite, updateFire, prepareFire } from '../src/fire.js';
import { cancelJob } from '../src/simulation.js';
import { setTank, releaseWater, flowLiquids, pumpLiquids, liquidOpen, validateLiquids } from '../src/liquids.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
import { executeAction } from '../src/controls.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const check=s=>deserialize(serialize(s));
const wetTotal=site=>site.tiles.reduce((n,t)=>n+t.liquid,0);
function install(s,kind,x,y){const t=at(s.sites.surface,x,y);t.building=kind;t.hp=100;initializeStorage(t);refreshPower(s,s.sites.surface);return t;}
function fixture(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 const tank=install(s,'waterTank',11,9),pump=install(s,'bilgePump',12,9);
 for(let y=9;y<=10;y++)at(site,12,y).cable={enabled:true,hp:100};refreshPower(s,site);
 return {s,site,tank,pump};
}
function fill(s,t,n=4){t.machine.input.water=n;at(s.sites.surface,8,10).stock.water-=n;syncResources(s);}
function puddle(s,t,n){t.liquid=n;s.sites.surface.liquids.released+=n;at(s.sites.surface,8,10).stock.water-=n;syncResources(s);}
function until(s,condition,max=200){for(let i=0;i<max&&!condition();i++)step(s);assert.ok(condition(),'Condition not reached');}

test('tank and pump construction use delivered supplies and commission empty',()=>{
 const s=createGame(),site=s.sites.surface;for(const c of s.crew)c.labors.hauling=false;
 const before=totalResources(s),job=order(s,'surface',11,9,'build','waterTank');assert.ok(job.ok);assert.deepEqual(job.job.cost,{alloy:6,components:1});
 until(s,()=>at(site,11,9).building==='waterTank');const tank=at(site,11,9);assert.deepEqual(tank.machine.input,{});assert.equal(tank.tank.drain,false);close(totalResources(s).alloy,before.alloy-6);
 assert.ok(order(s,'surface',12,9,'build','bilgePump').ok);until(s,()=>at(site,12,9).building==='bilgePump');assert.deepEqual(at(site,12,9).machine.output,{});assert.equal(order(s,'surface',12,14,'build','waterTank').ok,false);check(s);
});

test('haulers physically fill a tank and paused filling assigns no new water shipment',()=>{
 const {s,site,tank}=fixture(),c=s.crew[1],before=totalResources(s).water;c.labors.hauling=true;c.x=8;c.y=10;
 haul(s,c,site,pathTo);assert.ok(c.carry.water>0);assert.equal(tank.machine.input.water,undefined);
 for(let i=0;i<30&&c.carry;i++)haul(s,c,site,pathTo);assert.ok(tank.machine.input.water>0);close(totalResources(s).water,before);
 setTank(s,'surface',11,9,false,false);assert.equal(haul(s,c,site,pathTo),false);syncResources(s);check(s);
});

test('opening a drain releases actual buffered water; closed undamaged tanks retain it',()=>{
 const {s,site,tank}=fixture();fill(s,tank);const before=totalResources(s).water;flowLiquids(s);close(wetTotal(site),0);
 setTank(s,'surface',11,9,false,true);flowLiquids(s);close(tank.machine.input.water,3.5);close(wetTotal(site),.5);close(totalResources(s).water,before);validateLiquids(s);
 setTank(s,'surface',11,9,false,false);flowLiquids(s);close(tank.machine.input.water,3.5);check(s);
});

test('damage leaks with refill and valve disabled, repair stops further release, and empty tanks create none',()=>{
 const {s,site,tank}=fixture();fill(s,tank,1);setTank(s,'surface',11,9,false,false);tank.hp=25;flowLiquids(s);close(site.liquids.released,.25);tank.hp=100;flowLiquids(s);close(site.liquids.released,.25);
 tank.hp=0;for(let i=0;i<10;i++)flowLiquids(s);close(site.liquids.released,1);close(tank.machine.input.water||0,0);validateLiquids(s);refreshPower(s,site);check(s);
});

test('floor water levels conservatively and intact walls or closed doors trap contents',()=>{
 const {s,site,pump}=fixture();pump.machine.enabled=false;puddle(s,at(site,9,9),3);const before=wetTotal(site);
 for(let i=0;i<10;i++){s.tick++;flowLiquids(s);}close(wetTotal(site),before);assert.ok(at(site,8,9).liquid>0);assert.equal(at(site,6,9).liquid,0);
 const door=at(site,10,12);door.doorMode='closed';door.liquid=1;site.liquids.released+=1;const held=door.liquid;flowLiquids(s);close(door.liquid,held);
 door.doorMode='open';flowLiquids(s);assert.ok(door.liquid<held);validateLiquids(s);
});

test('automatic doors pass liquid only while physically open, and broken doors pass liquid',()=>{
 const {site}=fixture(),door=at(site,10,12);door.doorMode='auto';door.doorUntil=3;
 assert.equal(liquidOpen(site,door,2),true);assert.equal(liquidOpen(site,door,3),false);door.doorMode='closed';assert.equal(liquidOpen(site,door,2),false);door.hp=0;assert.equal(liquidOpen(site,door,2),true);
});

test('ground and space losses are explicit and preserve the water ledger',()=>{
 const {s,site}=fixture();puddle(s,at(site,16,14),2);flowLiquids(s);assert.ok(site.liquids.lost>0);close(wetTotal(site)+site.liquids.lost,2);
 const space=at(site,16,14);space.terrain='void';flowLiquids(s);assert.equal(space.liquid,0);close(wetTotal(site)+site.liquids.lost,2);validateLiquids(s);
});

test('a powered pump recovers physical floor water into a bounded output for hauling',()=>{
 const {s,site,pump}=fixture();puddle(s,at(site,11,9),2);const before=totalResources(s).water;updatePower(s,site);assert.ok(pump.powered);pumpLiquids(s);
 close(pump.machine.output.water,.5);close(wetTotal(site),1.5);close(site.liquids.recovered,.5);close(totalResources(s).water,before);refreshPower(s,site);check(s);
 const c=s.crew[1];c.labors.hauling=true;c.x=12;c.y=9;setTank(s,'surface',11,9,false,false);haul(s,c,site,pathTo);assert.equal(c.carry.water,.5);
 for(let i=0;i<30&&c.carry;i++)haul(s,c,site,pathTo);close(totalResources(s).water,before);syncResources(s);check(s);
});

test('pump pauses, lost power, blocked intakes and full output retain floor water',()=>{
 const {s,site,pump}=fixture();puddle(s,at(site,11,9),2);pump.machine.enabled=false;refreshPower(s,site);pumpLiquids(s);close(wetTotal(site),2);
 pump.machine.enabled=true;pump.cable.enabled=false;refreshPower(s,site);pumpLiquids(s);close(wetTotal(site),2);
 pump.cable.enabled=true;refreshPower(s,site);const t=at(site,11,9);delete t.tank;delete t.machine;t.building='door';t.doorMode='closed';t.doorUntil=0;pumpLiquids(s);close(wetTotal(site),2);
 t.doorMode='open';pump.machine.output.water=12;pumpLiquids(s);close(wetTotal(site),2);assert.match(pump.machine.status,/Output full/);validateLiquids(s);
});

test('wet cable faults consume circuit energy, make accounted room heat and damage only energized cable',()=>{
 const {s,site,pump}=fixture();pump.machine.enabled=false;const cable=at(site,12,10);puddle(s,cable,1);refreshPower(s,site);const hp=cable.cable.hp,heat=site.thermal.equipment,used=site.energy.consumed;
 updatePower(s,site);assert.equal(cable.wetShort,true);close(cable.cable.hp,hp-.25);close(site.energy.consumed-used,5);close(site.liquids.faultEnergy,5);close(site.thermal.equipment-heat,5);
 setCableEnabled(s,'surface',12,10,false);updatePower(s,site);close(cable.cable.hp,hp-.25);close(site.liquids.faultEnergy,5);assert.equal(cable.wetShort,false);refreshPower(s,site);check(s);
});

test('wet faults can deprive machines of power without overdrawing a battery',()=>{
 const {s,site,pump}=fixture();for(const t of site.tiles){if(['solar'].includes(t.building))t.hp=0;if(t.building==='battery'){site.energy.discarded+=t.charge-6;t.charge=6;}}
 puddle(s,at(site,12,10),1);refreshPower(s,site);updatePower(s,site);assert.equal(pump.powered,false);close(site.energy.consumed,5);close(site.power.battery,1);refreshPower(s,site);check(s);
});

test('floor water quenches a fire and releases a now-unneeded supplied suppression order',()=>{
 const {s,site}=fixture(),t=install(s,'commons',9,9);assert.ok(ignite(s,site,t));const job=order(s,'surface',9,9,'extinguish');assert.ok(job.ok);puddle(s,t,1);const before=totalResources(s).water;
 updateFire(s);assert.equal(t.fire,undefined);close(site.liquids.quenched,.25);close(totalResources(s).water,before-.25);prepareFire(s,order,cancelJob);assert.equal(s.jobs.some(j=>j.id===job.job.id),false);
 assert.equal(ignite(s,site,t),false);refreshPower(s,site);check(s);
});

test('demolition preserves packaged tank water and existing puddles for later recovery',()=>{
 const {s,site,tank,pump}=fixture();pump.machine.enabled=false;fill(s,tank);puddle(s,tank,1);setTank(s,'surface',11,9,false,false);const before=totalResources(s).water;assert.ok(order(s,'surface',11,9,'remove').ok);until(s,()=>tank.building===null);
 assert.equal(tank.tank,undefined);assert.equal(tank.machine,undefined);assert.ok(tank.drop.water>0);close(totalResources(s).water+site.liquids.lost,before);check(s);
});

test('water controls and transient transfers have stable IDs; recording does not change outcomes',()=>{
 const {s:a,tank}=fixture();fill(a,tank);const b=check(a);startRecording(a,{maxRecords:20000,maxBytes:32000000});
 for(const s of [a,b]){assert.equal(executeAction(s,'water.tank',{site:'surface',x:11,y:9,fill:'no',drain:true}).ok,false);executeAction(s,'water.tank',{site:'surface',x:11,y:9,fill:false,drain:true},'player');step(s,3);}
 assert.deepEqual(a,b);const rows=exportRecording(a).trim().split('\n').map(JSON.parse);
 for(const id of ['water.tank.changed','water.released','water.flowed','water.pumped'])assert.ok(rows.some(r=>r.event?.id===id),id);
 assert.ok(rows.some(r=>r.action?.id==='water.tank'&&r.action.source==='player'));assert.ok(observe(a).entities['tile:surface:11:9'].liquid>=0);check(a);
});

test('liquid, tank and pump state survive deterministic reload and schema 31 gains no water or equipment',()=>{
 const {s,tank}=fixture();fill(s,tank);setTank(s,'surface',11,9,false,true);step(s,8);const copy=check(s);step(s,10);step(copy,10);assert.deepEqual(s,copy);
 const old=createGame();old.version=31;for(const site of Object.values(old.sites)){delete site.liquids;for(const t of site.tiles){delete t.liquid;delete t.wetShort;}}
 const before=totalResources(old),migrated=check(old);assert.equal(migrated.version, VERSION);assert.deepEqual(totalResources(migrated),before);assert.equal(wetTotal(migrated.sites.surface),0);assert.equal(migrated.rng,old.rng);assert.deepEqual(check(migrated),migrated);
});

test('malformed floor water, ledgers and tank controls are rejected',()=>{
 for(const change of [({tank})=>tank.liquid=-1,({tank})=>tank.liquid=5,({tank})=>tank.liquid=1,({tank})=>tank.tank.drain='yes',({site})=>site.liquids.lost=-1,({site})=>at(site,9,9).tank={drain:false},({tank})=>tank.machine.input.water=9]){const f=fixture();change(f);assert.throws(()=>check(f.s));}
});
