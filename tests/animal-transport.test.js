import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import {createGame,at,step,serialize,deserialize,setLabor,setAnimalPost,transportAnimalToPost,cancelJob} from '../src/simulation.js';
import {animalPath} from '../src/navigation.js';
import {transportFor} from '../src/animal-transport.js';
import {setMachineEnabled} from '../src/industry.js';
import {totalResources} from '../src/inventory.js';
import {executeAction} from '../src/controls.js';
import {startRecording,exportRecording,observe} from '../src/telemetry.js';
const check=s=>deserialize(serialize(s));
const until=(s,p,max=240)=>{for(let i=0;i<max&&!p();i++){step(s);check(s);}assert.ok(p(),`Condition missing at ${s.tick}`);};
function pen(){
 const s=createGame(),site=s.sites.surface,a=s.creatures[0];
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
 for(const c of s.crew)setLabor(s,c.id,'hauling',false);
 for(let y=15;y<=23;y++)for(let x=3;x<=9;x++){const t=at(site,x,y);t.terrain='ground';t.building=x===3||x===9||y===15||y===23?'fence':null;t.hp=100;t.lichen=80;}
 const gate=at(site,6,15);gate.building='pastureGate';gate.gateMode='latched';const post=at(site,6,19);post.building='husbandryPost';a.x=10;a.y=18;a.husbandry.trust=100;a.husbandry.care=false;a.husbandry.harvest=false;
 return {s,site,a,gate,post};
}
const request=f=>{const result=transportAnimalToPost(f.s,f.a.id,6,19);assert.ok(result.ok,result.message);return result.job;};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('orders reserve a post without teleporting, granting trust or changing assignment',()=>{
 const f=pen(),{s,a}=f,before=[a.x,a.y],supplies=totalResources(s),j=request(f);assert.deepEqual([a.x,a.y],before);assert.equal(a.husbandry.post,null);assert.equal(a.husbandry.trust,100);assert.deepEqual(totalResources(s),supplies);assert.equal(j.phase,'collect');check(s);
});

test('handler must reach the animal, attach a lead and physically cross a latched gate',()=>{
 const f=pen(),{s,a,site,gate}=f;assert.equal(animalPath(site,a,[[6,19]]),null);const j=request(f);
 until(s,()=>!s.jobs.includes(j)); // Every tick is save-validated by the helper.
 assert.deepEqual(a.husbandry.post,[6,19]);assert.equal(gate.gateMode,'latched');assert.equal(a.x,6);assert.equal(a.y,19);assert.ok(s.crew.some(c=>c.x===6&&c.y===19));check(s);
});

test('escort movement stays with its handler and advances at most one tile each three ticks',()=>{
 const f=pen(),{s,a}=f,j=request(f);until(s,()=>j.phase==='escort');let count=0;
 while(s.jobs.includes(j)&&count++<160){const old=[a.x,a.y],worker=s.crew.find(c=>c.id===j.worker);step(s);if(s.jobs.includes(j)){const distance=Math.abs(a.x-old[0])+Math.abs(a.y-old[1]);assert.ok(distance<=1);if(distance)assert.equal(s.tick%3,0);assert.equal(a.x,worker.x);assert.equal(a.y,worker.y);}check(s);}
 assert.ok(!s.jobs.includes(j));
});

test('missing husbandry duty leaves a pending order without capturing the animal',()=>{
 const f=pen(),{s,a}=f;for(const c of s.crew)setLabor(s,c.id,'husbandry',false);const j=request(f);step(s,15);assert.equal(j.worker,null);assert.equal(j.remaining,6);assert.match(j.blockedReason,/husbandry/);assert.equal(a.husbandry.post,null);setLabor(s,s.crew[3].id,'husbandry',true);until(s,()=>!s.jobs.includes(j));
});

test('disabling the handler duty interrupts at the current position and another handler resumes',()=>{
 const f=pen(),{s,a}=f,j=request(f);startRecording(s);until(s,()=>j.phase==='escort');const worker=j.worker,position=[a.x,a.y];setLabor(s,worker,'husbandry',false);assert.deepEqual([a.x,a.y],position);assert.equal(j.phase,'collect');assert.equal(j.worker,null);assert.equal(j.remaining,6);check(s);until(s,()=>!s.jobs.includes(j));assert.ok(events(s).some(e=>e.id==='animal.transport.interrupted'&&e.actor===worker));
});

test('crew recovery interrupts transport rather than taking the animal to a bunk',()=>{
 const f=pen(),{s,a}=f,j=request(f);until(s,()=>j.phase==='escort');const c=s.crew.find(c=>c.id===j.worker),position=[a.x,a.y];c.energy=0;step(s);assert.notEqual(j.worker,c.id);assert.equal(j.phase,'collect');assert.ok(Math.abs(a.x-position[0])+Math.abs(a.y-position[1])<=1);check(s);until(s,()=>!s.jobs.includes(j));
});

test('cancellation releases the post and animal without deleting supplies or its old home',()=>{
 const f=pen(),{s,site,a}=f;at(site,12,18).terrain='ground';at(site,12,18).building='husbandryPost';assert.ok(setAnimalPost(s,a.id,12,18).ok);const j=request(f);until(s,()=>j.phase==='escort');const position=[a.x,a.y],supplies=totalResources(s);cancelJob(s,j.id);assert.deepEqual([a.x,a.y],position);assert.deepEqual(a.husbandry.post,[12,18]);assert.deepEqual(totalResources(s),supplies);assert.equal(transportFor(s,a),undefined);check(s);
});

test('post reservation rejects competing assignment or transport and releases on cancellation',()=>{
 const f=pen(),{s}=f,j=request(f),b=s.creatures[1];b.husbandry.trust=100;assert.equal(setAnimalPost(s,b.id,6,19).ok,false);assert.equal(transportAnimalToPost(s,b.id,6,19).ok,false);assert.equal(transportAnimalToPost(s,f.a.id,6,19).ok,false);cancelJob(s,j.id);assert.ok(setAnimalPost(s,b.id,6,19).ok);check(s);
});

test('a blocked escort route releases the lead and waits until the route reopens',()=>{
 const f=pen(),{s,gate}=f,j=request(f);until(s,()=>j.phase==='escort');gate.building='wall';delete gate.gateMode;step(s);assert.equal(j.phase,'collect');assert.equal(j.worker,null);step(s,10);assert.ok(s.jobs.includes(j));gate.building='pastureGate';gate.gateMode='latched';until(s,()=>!s.jobs.includes(j));check(s);
});

test('damaged posts retain the order, while dismantled posts cancel it',()=>{
 const f=pen(),{s,post}=f,j=request(f);post.hp=0;step(s,10);assert.equal(j.worker,null);assert.ok(s.jobs.includes(j));post.hp=100;until(s,()=>j.phase==='escort');post.building=null;step(s);assert.ok(!s.jobs.includes(j));assert.equal(f.a.husbandry.post,null);check(s);
});

test('animal death cancels transport; handler death leaves a recoverable order',()=>{
 const f=pen(),j=request(f);until(f.s,()=>j.phase==='escort');f.a.health=0;step(f.s);assert.ok(!f.s.jobs.includes(j));check(f.s);
 const g=pen(),job=request(g);until(g.s,()=>job.phase==='escort');g.s.crew.find(c=>c.id===job.worker).health=0;step(g.s);assert.equal(job.phase,'collect');until(g.s,()=>!g.s.jobs.includes(job));check(g.s);
});

test('transport cancels old care with reserved food preserved and suppresses repeat care during travel',()=>{
 const f=pen(),{s,site,a}=f;at(site,12,18).terrain='ground';at(site,12,18).building='husbandryPost';setAnimalPost(s,a.id,12,18);a.fed=20;a.husbandry.care=true;step(s);assert.ok(s.jobs.some(j=>j.kind==='animalCare'));const supplies=totalResources(s),j=request(f);assert.deepEqual(totalResources(s),supplies);step(s,5);assert.ok(!s.jobs.some(j=>j.kind==='animalCare'&&j.animal===a.id));assert.ok(s.jobs.includes(j));check(s);
});

test('releasing a post assignment cancels pending transport without moving the animal',()=>{
 const f=pen(),j=request(f);until(f.s,()=>j.phase==='escort');const before=[f.a.x,f.a.y];assert.ok(setAnimalPost(f.s,f.a.id,null,null).ok);assert.deepEqual([f.a.x,f.a.y],before);assert.ok(!f.s.jobs.includes(j));check(f.s);
});

test('wild animals, non-posts and unreachable destinations are rejected without disturbing old work',()=>{
 const f=pen();f.a.husbandry.trust=40;assert.equal(transportAnimalToPost(f.s,f.a.id,6,19).ok,false);f.a.husbandry.trust=100;assert.equal(transportAnimalToPost(f.s,f.a.id,8,10).ok,false);f.gate.building='wall';delete f.gate.gateMode;assert.equal(transportAnimalToPost(f.s,f.a.id,6,19).ok,false);assert.equal(f.s.jobs.length,0);check(f.s);
});

test('saved attached transports resume deterministically with optional records',()=>{
 const f=pen(),{s}=f,j=request(f);until(s,()=>j.phase==='escort');const copy=check(s);startRecording(s,{maxRecords:10000,maxBytes:32000000});step(s,100);step(copy,100);assert.deepEqual(s,copy);assert.ok(events(s).some(e=>e.id==='animal.transport.delivered'));assert.ok(events(s).some(e=>e.id==='animal.moved'&&e.reason==='handler_escort'));check(s);
});

test('shared action and observation label the order and all physical stages',()=>{
 const {s,a}=pen();startRecording(s,{maxRecords:10000,maxBytes:32000000});const result=executeAction(s,'husbandry.transport',{creature:a.id,x:6,y:19},'agent');assert.ok(result.ok);assert.equal(observe(s).entities[a.id].derived.transport.job,result.job);until(s,()=>!transportFor(s,a));for(const id of ['animal.transport.ordered','animal.transport.attached','animal.transport.delivered'])assert.ok(events(s).some(e=>e.id===id),id);check(s);
});

test('schema 28 migration preserves the colony and malformed escort ownership is rejected',()=>{
 const s=createGame();s.version=28;const old=structuredClone(s),copy=check(s);assert.equal(copy.version, VERSION);old.version=VERSION;assert.deepEqual(copy,old);
 for(const mutate of [j=>j.phase='fly',j=>j.work=1,j=>j.animal='missing',j=>j.cost={food:1},j=>j.phase='escort']){const f=pen(),j=request(f);mutate(j);assert.throws(()=>check(f.s));}
 const f=pen(),j=request(f);until(f.s,()=>j.phase==='escort');f.a.x++;assert.throws(()=>check(f.s),/escort/);
});


test('changing the handler routine releases escort immediately, before another simulation tick',()=>{
 const f=pen(),{s,a}=f,j=request(f);until(s,()=>j.phase==='escort');const worker=j.worker,position=[a.x,a.y];startRecording(s);assert.ok(executeAction(s,'crew.routine',{crew:worker,policy:'rest'},'player').ok);assert.equal(j.phase,'collect');assert.equal(j.worker,null);assert.deepEqual([a.x,a.y],position);check(s);assert.ok(events(s).some(e=>e.id==='animal.transport.interrupted'&&e.reason==='routine_changed'));until(s,()=>!s.jobs.includes(j));
});
