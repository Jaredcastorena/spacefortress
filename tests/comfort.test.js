import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, step, at, order, cancelJob, serialize, deserialize, updateRooms, pathTo, setLabor } from '../src/simulation.js';
import { roomComfort, experienceComfort } from '../src/comfort.js';
import { roomAt, fillRoom } from '../src/atmosphere.js';
import { refreshPower, initializeElectrical } from '../src/power.js';
import { spillStorage, setMachineEnabled } from '../src/industry.js';
import { totalResources, syncResources, quantity } from '../src/inventory.js';
import { materialsReady } from '../src/construction.js';
import { setBunkOwner } from '../src/housing.js';
import { setLifePolicy, leisure } from '../src/crew-life.js';
import { setRoomDesignation } from '../src/rooms.js';

function fixture() {
  const s=createGame(),site=s.sites.surface,c=s.crew[0];
  for(const t of site.tiles)if(t.machine && t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
  refreshPower(s,site);return {s,site,c};
}
function place(site,x,y,building) { const t=at(site,x,y);spillStorage(t);t.building=building;t.hp=100;initializeElectrical(t);return t; }
const comfort=(s,c=s.crew[0],x=c.x,y=c.y)=>roomComfort(s,s.sites.surface,roomAt(s.sites.surface,x,y),c);
const until=(s,p,limit=180)=>{for(let i=0;i<limit&&!p();i++)step(s);assert.ok(p(),`Condition missing at tick ${s.tick}`);};
const check=s=>{syncResources(s);return deserialize(serialize(s));};

test('decorations require habitat floor, delivered supplies and actual construction work',()=>{
  const {s,site}=fixture();assert.equal(order(s,'surface',18,14,'build','sculpture').ok,false);
  const before=totalResources(s),j=order(s,'surface',12,9,'build','holo').job;assert.ok(j);
  assert.equal(at(site,12,9).building,null);assert.equal(comfort(s).art,0);
  until(s,()=>s.crew.some(c=>c.delivery?.job===j.id));assert.equal(j.remaining,j.work);assert.equal(materialsReady(j),false);assert.deepEqual(totalResources(s),before);
  until(s,()=>!s.jobs.includes(j));assert.equal(at(site,12,9).building,'holo');assert.equal(totalResources(s).alloy,before.alloy-3);assert.equal(totalResources(s).components,before.components-1);check(s);
});

test('cancelling a decoration with carried materials preserves them and grants no art',()=>{
  const {s}=fixture(),before=totalResources(s),j=order(s,'surface',12,9,'build','sculpture').job;
  until(s,()=>s.crew.some(c=>c.delivery?.job===j.id));cancelJob(s,j.id);assert.equal(comfort(s).art,0);assert.deepEqual(totalResources(s),before);check(s);
});

test('art preference, furnishing condition and distinct styles determine comfort without stacking copies',()=>{
  const {s,site,c}=fixture();place(site,11,9,'sculpture');place(site,12,9,'sculpture');
  assert.equal(comfort(s).art,1);assert.equal(comfort(s).score,2);c.housing.preference='quiet';assert.equal(comfort(s).score,1);
  at(site,11,9).hp=25;at(site,12,9).hp=50;assert.equal(comfort(s).art,.5);at(site,12,9).hp=0;assert.equal(comfort(s).art,.25);check(s);
});

test('holo art depends on its real circuit and condition and consumes electrical energy',()=>{
  const {s,site}=fixture(),holo=place(site,13,8,'holo');refreshPower(s,site);assert.equal(holo.powered,true);assert.equal(comfort(s).art,1);
  const before=site.energy.consumed;step(s);assert.ok(site.energy.consumed>=before+4);assert.equal(holo.maintenance.usage,1);
  holo.hp=40;refreshPower(s,site);assert.equal(comfort(s).art,.4);
  for(const t of site.tiles){if(t.building==='solar')t.hp=0;if(t.building==='battery'){site.energy.discarded+=t.charge;t.charge=0;}}
  refreshPower(s,site);assert.equal(holo.powered,false);assert.equal(comfort(s).art,0);check(s);
});

test('powered industrial hum bothers quiet crew most and pausing machinery removes it',()=>{
  const {s,site,c}=fixture();c.housing.preference='quiet';setMachineEnabled(s,'surface',13,10,true);refreshPower(s,site);
  assert.equal(comfort(s).noise,1);assert.equal(comfort(s).score,-2);c.housing.preference='art';assert.equal(comfort(s).score,-1);
  setMachineEnabled(s,'surface',13,10,false);refreshPower(s,site);assert.equal(comfort(s).noise,0);check(s);
});

test('walls isolate hum and decorations; room merging recomputes both',()=>{
  const {s,site,c}=fixture();c.x=8;c.y=8;place(site,8,9,'sculpture');setMachineEnabled(s,'surface',13,10,true);
  for(let y=7;y<=11;y++)place(site,10,y,'wall');updateRooms(site);refreshPower(s,site);
  assert.equal(comfort(s).art,1);assert.equal(comfort(s).noise,0);assert.equal(comfort(s,c,12,8).art,0);assert.equal(comfort(s,c,12,8).noise,1);
  place(site,10,9,null);updateRooms(site);assert.equal(comfort(s).art,1);assert.equal(comfort(s).noise,1);check(s);
});

test('crowding counts beds and living occupants; quiet privacy and shared-table preferences differ',()=>{
  const {s,site,c}=fixture();for(const t of site.tiles)if(t.building==='bunk'&&t.x!==9)place(site,t.x,t.y,null);
  c.housing.preference='quiet';for(const other of s.crew.slice(1)){other.x=16;other.y=11;}
  assert.equal(comfort(s).private,true);assert.equal(comfort(s).score,1);
  c.housing.preference='company';place(site,11,9,'commons');assert.equal(comfort(s).shared,true);assert.equal(comfort(s).score,1);
  for(const t of site.tiles.filter(t=>t.terrain==='floor'&&!t.building).slice(0,12))place(site,t.x,t.y,'bunk');assert.ok(comfort(s).crowding>0);
});

test('exposed waste reduces comfort; sealed sanitary tanks do not',()=>{
  const {s,site}=fixture();place(site,11,9,'sculpture');const clean=comfort(s).score;
  at(site,8,8).drop={waste:1};assert.equal(comfort(s).score,clean-2);at(site,8,8).drop=null;
  const unit=place(site,11,10,'sanitary');unit.sanitary={output:{waste:1}};assert.equal(comfort(s).score,clean);
  unit.hp=0;assert.equal(comfort(s).score,clean-2);
});

test('unsafe or waste-designated rooms give no positive rest comfort',()=>{
  const {s,site,c}=fixture();place(site,11,9,'sculpture');c.life.stress=50;const r=roomAt(site,c.x,c.y);fillRoom(r,0);
  experienceComfort(s,c,site);assert.equal(c.life.stress,50);assert.ok(!c.memories.some(m=>m.kind==='comfortable-room'));
  fillRoom(r,100);setRoomDesignation(s,'surface',8,8,'waste');assert.equal(comfort(s).usable,false);
});

test('comfort affects actual sleep, stress and morale memories but not idle ownership',()=>{
  const {s,site,c}=fixture();place(site,11,9,'sculpture');setBunkOwner(s,'surface',12,7,c.id);assert.ok(!c.memories.some(m=>m.kind==='comfortable-room'));
  for(const p of s.crew)for(const labor of Object.keys(p.labors))setLabor(s,p.id,labor,false);
  c.x=12;c.y=7;c.energy=10;c.life.stress=50;step(s);assert.ok(c.life.stress<50);assert.ok(c.memories.some(m=>m.kind==='comfortable-room'));assert.ok(c.memories.some(m=>m.kind==='personal-bunk'));check(s);
});

test('new downtime seeks reachable rooms that suit the person and keeps a settled place',()=>{
  const {s,site,c}=fixture();for(let y=7;y<=11;y++)place(site,10,y,'wall');const door=place(site,10,9,'door');door.doorMode='auto';door.doorUntil=0;
  place(site,12,9,'sculpture');updateRooms(site);c.x=8;c.y=8;setLifePolicy(s,c.id,'rest');c.life.leisure=10;step(s);
  assert.ok(c.intent.target[0]>10);until(s,()=>c.intent.rested>0);const target=[...c.intent.target];at(site,12,9).hp=0;step(s);assert.deepEqual(c.intent.target,target);check(s);
});

test('uncomfortable downtime remains restorative enough for balanced breaks to finish',()=>{
  const {s,site,c}=fixture();c.housing.preference='quiet';setMachineEnabled(s,'surface',13,10,true);refreshPower(s,site);
  c.life.stress=35;c.life.leisure=80;c.intent={type:'leisure',target:[c.x,c.y],started:0,rested:0};
  for(let i=0;i<200&&c.intent;i++){s.tick++;leisure(s,c,site,pathTo);}
  assert.equal(c.intent,null);assert.ok(c.life.stress<=30);assert.ok(c.memories.some(m=>m.kind==='uncomfortable-room'));
});

test('dismantling art removes its benefit and leaves ordinary salvage',()=>{
  const {s,site}=fixture();place(site,12,9,'sculpture');const before=totalResources(s).alloy,j=order(s,'surface',12,9,'remove').job;
  until(s,()=>!s.jobs.includes(j));assert.equal(comfort(s).art,0);assert.equal(totalResources(s).alloy,before+2);check(s);
});

test('comfort preferences and effects persist deterministically; schema twenty-one migration preserves housing',()=>{
  const {s,site,c}=fixture();place(site,12,9,'sculpture');setBunkOwner(s,'surface',12,7,c.id);c.energy=10;step(s,10);const copy=check(s);step(s,30);step(copy,30);assert.deepEqual(copy,s);
  s.version=21;for(const p of s.crew)delete p.housing.preference;const supplies=totalResources(s),bunk=[...c.housing.bunk],intent=structuredClone(c.intent),migrated=check(s);
  assert.equal(migrated.version, VERSION);assert.deepEqual(totalResources(migrated),supplies);assert.deepEqual(migrated.crew[0].housing.bunk,bunk);assert.deepEqual(migrated.crew[0].intent,intent);assert.equal(migrated.crew[0].housing.preference,'art');
  for(const value of [null,'luxury',12]){migrated.crew[0].housing.preference=value;assert.throws(()=>check(migrated));}
});
