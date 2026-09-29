import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, serialize, deserialize, setLabor, setAnimalPost, setAnimalPolicy, pathTo } from '../src/simulation.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { setMachineEnabled } from '../src/industry.js';
import { husbandryStatus } from '../src/husbandry.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
import { executeAction } from '../src/controls.js';
const check=s=>{syncResources(s);return deserialize(serialize(s));};
const until=(s,p,limit=240)=>{for(let i=0;i<limit&&!p();i++){step(s);check(s);}assert.ok(p(),`Condition missing at ${s.tick}`);};
function colony({post=true,hauling=false}={}){
 const s=createGame(),site=s.sites.surface,t=at(site,10,15),a=s.creatures[0];
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
 for(const c of s.crew)setLabor(s,c.id,'hauling',hauling);
 if(post)t.building='husbandryPost';
 return {s,site,t,a,h:a.husbandry,depot:at(site,8,10)};
}
const care=s=>s.jobs.find(j=>j.kind==='animalCare');

test('a constructed post needs physical materials and assignment does not teleport or tame an animal',()=>{
 const {s,site,t,a,h}=colony({post:false}),before=totalResources(s);const j=order(s,'surface',10,15,'build','husbandryPost').job;assert.ok(j);until(s,()=>!s.jobs.includes(j));assert.equal(totalResources(s).alloy,before.alloy-4);assert.equal(t.building,'husbandryPost');
 const position=[a.x,a.y];assert.ok(setAnimalPost(s,a.id,10,15).ok);assert.deepEqual([a.x,a.y],position);assert.equal(h.trust,0);assert.deepEqual(h.post,[10,15]);check(s);
});

test('three supplied care visits build trust and produce a tame animal through real handler work',()=>{
 const {s,a,h}=colony(),before=totalResources(s);setAnimalPost(s,a.id,10,15);until(s,()=>h.trust===100);assert.equal(totalResources(s).food,before.food-3);assert.equal(totalResources(s).waste,.375);assert.equal(a.x,10);assert.equal(a.y,15);assert.ok(s.crew.some(c=>c.skills.husbandry.xp>0||c.skills.husbandry.level>2));check(s);
});

test('missing husbandry labor leaves paid food physical and does not grant trust',()=>{
 const {s,a,h}=colony();for(const c of s.crew)setLabor(s,c.id,'husbandry',false);const before=totalResources(s);setAnimalPost(s,a.id,10,15);step(s,15);assert.equal(h.trust,0);assert.ok(care(s));assert.equal(totalResources(s).food,before.food);assert.match(care(s).blockedReason,/husbandry/);
 setLabor(s,s.crew[3].id,'husbandry',true);until(s,()=>h.trust>=40);check(s);
});

test('depot loss or missing food cannot create a free care visit',()=>{
 const {s,a,h,site}=colony();for(const t of site.tiles){if(t.stock)delete t.stock.food;if(t.drop)delete t.drop.food;}syncResources(s);setAnimalPost(s,a.id,10,15);step(s,20);assert.equal(h.trust,0);assert.equal(care(s),undefined);assert.match(husbandryStatus(s,a,pathTo),/supplies/);check(s);
});

test('cancelled feeding returns supplies and waits before automatic retry',()=>{
 const {s,a,h}=colony(),before=totalResources(s);setAnimalPost(s,a.id,10,15);until(s,()=>!!care(s));const j=care(s);cancelJob(s,j.id);assert.equal(totalResources(s).food,before.food);assert.equal(h.retryAt,s.tick+120);step(s,10);assert.equal(care(s),undefined);assert.equal(h.trust,0);check(s);
 setAnimalPolicy(s,a.id,'care',true);until(s,()=>h.trust>=40);
});

test('an animal must walk to the post before any handler can finish the visit',()=>{
 const {s,site,a,h}=colony();setAnimalPost(s,a.id,10,15);for(const [x,y] of [[9,15],[11,15],[10,14],[10,16]])at(site,x,y).building='wall';step(s,15);assert.equal(h.trust,0);assert.match(husbandryStatus(s,a,pathTo),/route blocked/);
 at(site,9,15).building=null;until(s,()=>h.trust>=40);check(s);
});

test('a damaged post stops work without deleting staged food and resumes after repair',()=>{
 const {s,t,a,h}=colony();setAnimalPost(s,a.id,10,15);until(s,()=>!!care(s)?.materials.food);const before=totalResources(s);t.hp=0;step(s);assert.equal(care(s),undefined);assert.deepEqual(h.post,[10,15]);assert.equal(totalResources(s).food,before.food);assert.match(husbandryStatus(s,a,pathTo),/damaged/);t.hp=100;until(s,()=>h.trust>=40);check(s);
});

test('tame healthy animals mature curd over time and handlers leave food and manure for hauling',()=>{
 const {s,a,h,t}=colony();setAnimalPost(s,a.id,10,15);until(s,()=>h.trust===100);const before=totalResources(s);assert.ok(h.product<1);until(s,()=>!!s.jobs.find(j=>j.kind==='animalHarvest'),450);const job=s.jobs.find(j=>j.kind==='animalHarvest');assert.equal(totalResources(s).food,before.food);until(s,()=>!s.jobs.includes(job));assert.equal(t.drop.food,2);assert.equal(totalResources(s).food,before.food+2);assert.ok(h.product<10);assert.equal(totalResources(s).waste,before.waste+.25);check(s);
 for(const c of s.crew)setLabor(s,c.id,'hauling',true);until(s,()=>!t.drop);assert.ok(s.resources.food>=2);
});

test('nutrition and health gate curd maturation and collection policy preserves ready output',()=>{
 const {s,a,h}=colony();h.trust=100;h.product=50;a.fed=30;setAnimalPost(s,a.id,10,15);setAnimalPolicy(s,a.id,'care',false);setAnimalPolicy(s,a.id,'harvest',false);
 for(const t of s.sites.surface.tiles)t.lichen=0;step(s,10);assert.equal(h.product,50);a.fed=90;a.health=30;step(s,5);assert.equal(h.product,50);a.health=100;h.product=99;step(s,4);assert.equal(h.product,100);assert.ok(!s.jobs.some(j=>j.kind==='animalHarvest'));setAnimalPolicy(s,a.id,'harvest',true);until(s,()=>h.product<100);check(s);
});

test('post reassignment and release preserve trust, product and resource ownership',()=>{
 const {s,site,a,h}=colony();at(site,12,15).building='husbandryPost';setAnimalPost(s,a.id,10,15);until(s,()=>h.trust>=40);const before=totalResources(s),trust=h.trust;assert.ok(setAnimalPost(s,a.id,12,15).ok);assert.deepEqual(totalResources(s),before);assert.equal(h.trust,trust);assert.deepEqual(h.post,[12,15]);setAnimalPost(s,a.id,null,null);assert.equal(h.post,null);assert.equal(care(s),undefined);check(s);
});

test('dismantling the post releases its assignment without losing the animal',()=>{
 const {s,a,h,t}=colony();setAnimalPost(s,a.id,10,15);setAnimalPolicy(s,a.id,'care',false);setAnimalPolicy(s,a.id,'harvest',false);const j=order(s,'surface',10,15,'remove').job;until(s,()=>!s.jobs.includes(j));assert.equal(t.building,null);assert.equal(h.post,null);assert.ok(a.health>0);check(s);
});

test('starvation kills once and cancels care without consuming its undelivered food',()=>{
 const {s,a,h}=colony();setAnimalPost(s,a.id,10,15);a.health=.1;a.fed=0;const before=totalResources(s);startRecording(s);step(s);assert.equal(a.health,0);assert.equal(care(s),undefined);assert.equal(totalResources(s).food,before.food);step(s,3);const events=exportRecording(s).trim().split('\n').map(JSON.parse);assert.equal(events.filter(r=>r.event?.id==='animal.died').length,1);check(s);
});

test('schema twenty-five migration adds wild state and duties without changing animal locations or supplies',()=>{
 const {s}=colony({post:false});s.version=25;for(const a of s.creatures)delete a.husbandry;for(const c of s.crew){delete c.skills.husbandry;delete c.labors.husbandry;}const before=totalResources(s),positions=s.creatures.map(a=>[a.x,a.y]);const copy=check(s);assert.equal(copy.version, VERSION);assert.deepEqual(totalResources(copy),before);assert.deepEqual(copy.creatures.map(a=>[a.x,a.y]),positions);assert.ok(copy.creatures.every(a=>a.husbandry.trust===0&&a.husbandry.post===null));assert.equal(copy.crew[3].skills.husbandry.level,2);
});

test('pending deliveries and partially handled animals continue deterministically after reload',()=>{
 const {s,a,h}=colony();setAnimalPost(s,a.id,10,15);until(s,()=>!!care(s)?.materials.food);const copy=check(s);step(s,50);step(copy,50);assert.deepEqual(copy,s);
});

test('invalid targets, duplicate post claims and malformed animal states are rejected',()=>{
 const {s,a}=colony();assert.equal(executeAction(s,'husbandry.assign',{creature:'missing',x:10,y:15}).code,'invalid_arguments');assert.equal(setAnimalPost(s,a.id,null,15).ok,false);assert.equal(setAnimalPost(s,a.id,8,10).ok,false);setAnimalPost(s,a.id,10,15);assert.equal(setAnimalPost(s,s.creatures[1].id,10,15).ok,false);
 for(const mutate of [s=>s.creatures[0].husbandry.product=101,s=>s.creatures[0].husbandry.trust=-1,s=>s.creatures[0].husbandry.post=[10,10],s=>s.creatures[1].husbandry.post=[10,15],s=>s.creatures[0].husbandry.retryAt=9999,s=>delete s.creatures[0].husbandry]){const f=colony();setAnimalPost(f.s,f.a.id,10,15);mutate(f.s);assert.throws(()=>check(f.s));}
});

test('stable animal actions and observations expose care, taming, ready product and collection events',()=>{
 const {s,a,h}=colony();startRecording(s,{maxRecords:10000,maxBytes:16000000});assert.ok(executeAction(s,'husbandry.assign',{creature:a.id,x:10,y:15},'agent').ok);until(s,()=>h.trust===100);h.product=99;until(s,()=>h.product<99);const entity=observe(s).entities[a.id];assert.equal(entity.husbandry.trust,100);assert.ok(entity.derived.husbandryStatus);
 const rows=exportRecording(s).trim().split('\n').map(JSON.parse);for(const name of ['animal.post.assigned','animal.care.completed','animal.tamed','animal.product.ready','animal.harvested'])assert.ok(rows.some(r=>r.event?.id===name),name);assert.ok(rows.some(r=>r.action?.id==='husbandry.assign'&&r.action.source==='agent'));
});
