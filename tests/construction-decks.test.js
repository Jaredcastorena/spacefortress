import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,serialize,cancelJob} from '../src/simulation.js';
import {tileAt,positionOf,horizontalStep} from '../src/spatial.js';
import {advanceCrewRoutePositions} from '../src/crew-traversal.js';
import {moveCrew} from '../src/atmosphere.js';
import {initializeStorage,totalResources,syncResources} from '../src/inventory.js';
import {dropCarriedMaterials} from '../src/construction.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {startRecording,exportRecording} from '../src/telemetry.js';
import {BUILDINGS} from '../src/data.js';
import {distance} from '../src/geometry.js';
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function fixture(){
 const s=createGame(74219),site=s.sites.surface,blank=site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.flora);
 site.levels.push({z:1,name:'Upper test deck'});
 for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z:1,terrain:'ground',building:null});
 for(const z of [0,1]){const t=at(site,4,4,z);t.terrain='ground';t.building='stockpile';initializeStorage(t);t.stock={alloy:z===0?10:4};Object.assign(at(site,6,4,z),{terrain:z===0?'floor':'ground',building:null,drop:null});}
 for(const c of s.crew)for(const k of Object.keys(c.labors))c.labors[k]=false;
 const c=s.crew[0];Object.assign(c,{site:'surface',x:3,y:4,z:1,job:null,carry:null,delivery:null,intent:null});c.labors.construction=true;c.labors.engineering=true;
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')t.machine.enabled=false;
 syncResources(s);return {s,site,c,store:at(site,4,4,1),ground:at(site,4,4)};
}
const order=(s,kind='build',building='floor',z=1)=>executeAction(s,'job.order',{site:'surface',x:6,y:4,z,kind,building});
function until(f,p,limit=60){for(let n=0;n<limit&&!p();n++){const before=positionOf(f.c);step(f.s);assert.equal(f.c.z,1);assert.ok(distance([before.x,before.y],[f.c.x,f.c.y])<=1);}assert.ok(p(),`Stopped at tick ${f.s.tick}: ${f.c.activity}`);}

test('a worker physically fetches paid materials and builds on its own upper deck',()=>{
 const f=fixture(),{s,site,c,store,ground}=f,before=totalResources(s).alloy;startRecording(s);
 const result=order(s);assert.equal(result.ok,true,result.message);const j=s.jobs.find(j=>j.id===result.job);assert.equal(j.z,1);assert.ok(j.sources.every(p=>p.z===1));assert.equal(ground.stock.alloy,10);
 until(f,()=>!s.jobs.includes(j));assert.equal(at(site,6,4,1).terrain,'floor');assert.equal(at(site,6,4).terrain,'floor');assert.equal(store.stock.alloy,4-BUILDINGS.floor.cost.alloy);assert.equal(ground.stock.alloy,10);assert.equal(totalResources(s).alloy,before-BUILDINGS.floor.cost.alloy);assert.equal(c.carry,null);
 for(const id of ['job.created','job.completed'])assert.equal(events(s).find(e=>e.id===id&&e.entity===j.id).target,'tile:surface:6:4:1');
});

test('upper construction cannot borrow downstairs supplies or a downstairs worker',()=>{
 const f=fixture();f.store.stock={};syncResources(f.s);let before=serialize(f.s);assert.equal(order(f.s).ok,false);assert.equal(serialize(f.s),before);
 f.store.stock={alloy:4};f.c.z=0;syncResources(f.s);before=serialize(f.s);assert.equal(order(f.s).ok,false);assert.equal(serialize(f.s),before);
});

test('player and agent construction calls agree while empty extraction and floor jumps reject',()=>{
 const f=fixture(),copy=structuredClone(f.s),a=order(f.s),b=controlBindings(()=>copy).order(copy,'surface',6,4,'build','floor',1);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(serialize(f.s),serialize(copy));
 const clean=fixture(),before=serialize(clean.s);assert.equal(order(clean.s,'mine',null).reason,'no_extractable_material');assert.equal(serialize(clean.s),before);
 assert.equal(order(clean.s,'build','floor',8).code,'invalid_arguments');assert.equal(serialize(clean.s),before);
 assert.equal(horizontalStep(clean.site,clean.c,{x:3,y:4,z:0}),null);assert.equal(advanceCrewRoutePositions(clean.s,clean.c,clean.site,[{x:3,y:4,z:0}]).status,'blocked');assert.equal(serialize(clean.s),before);
});

test('cancelling upper reservations refunds their owner while carried materials remain physical',()=>{
 for(const carried of [false,true]){const f=fixture(),before=totalResources(f.s).alloy,result=order(f.s,'build','wall'),j=f.s.jobs.find(j=>j.id===result.job);assert.equal(result.ok,true,result.message);
  if(carried)until(f,()=>!!f.c.carry?.alloy);
  cancelJob(f.s,j.id);assert.equal(totalResources(f.s).alloy,before);assert.equal(f.ground.stock.alloy,10);
  if(carried){assert.ok(f.c.carry.alloy>0);const p=positionOf(f.c),n=f.c.carry.alloy;dropCarriedMaterials(f.s,f.c);assert.equal(at(f.site,p.x,p.y,1).drop.alloy,n);assert.equal(f.c.carry,null);assert.equal(totalResources(f.s).alloy,before);}else assert.equal(f.store.stock.alloy,4);
 }
});

test('overlapping construction designations do not conflict and boundary occupancy is deck-specific',()=>{
 const f=fixture();Object.assign(f.s.crew[1],{site:'surface',x:6,y:4,z:0});f.s.crew[1].labors.construction=false;
 const upper=order(f.s,'build','wall'),lower=order(f.s,'build','bunk',0);assert.equal(upper.ok,true,upper.message);assert.equal(lower.ok,true,lower.message);
 const j=f.s.jobs.find(j=>j.id===upper.job);until(f,()=>!f.s.jobs.includes(j));assert.equal(at(f.site,6,4,1).building,'wall');assert.equal(at(f.site,6,4).building,null);assert.ok(f.s.jobs.some(j=>j.id===lower.job));
});

test('walking opens only the door on the actor deck and never accepts a legacy ground destination upstairs',()=>{
 const {s,site,c}=fixture();for(const z of [0,1])Object.assign(at(site,4,4,z),{building:'door',doorMode:'auto',doorUntil:0});
 assert.equal(moveCrew(c,site,[4,4]),false);assert.equal(advanceCrewRoutePositions(s,c,site,[{x:4,y:4,z:1}]).status,'moving');assert.deepEqual(positionOf(c),{x:4,y:4,z:1});assert.ok(at(site,4,4,1).doorUntil>0);assert.equal(at(site,4,4).doorUntil,0);
});
