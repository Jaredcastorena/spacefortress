import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame,at,step,serialize,deserialize,setAnimalPost } from '../src/simulation.js';
import { BREEDING,newLifecycle,breedingStatus,updateBreeding } from '../src/breeding.js';
import { executeAction } from '../src/controls.js';
import { totalResources } from '../src/inventory.js';
import { setMachineEnabled } from '../src/industry.js';
import { startRecording,exportRecording,observe } from '../src/telemetry.js';
const check=s=>deserialize(serialize(s));
const until=(s,p,max=400)=>{for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),`Condition missing at ${s.tick}`);return check(s);};
function pen(){
 const s=createGame(),site=s.sites.surface,[a,b]=s.creatures;
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
 for(let y=15;y<=23;y++)for(let x=3;x<=9;x++){const t=at(site,x,y);t.terrain='ground';t.building=x===3||x===9||y===15||y===23?'fence':null;t.hp=100;t.lichen=80;}
 const gate=at(site,6,15);gate.building='pastureGate';gate.gateMode='latched';
 a.x=6;a.y=18;b.x=7;b.y=18;
 for(const animal of [a,b]){animal.husbandry.trust=100;animal.fed=100;animal.lifecycle.enabled=true;}
 return {s,site,a,b,gate};
}
const children=s=>s.creatures.filter(a=>a.lifecycle?.born!==null&&a.lifecycle);
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('founders begin adult and breeding is off until explicitly enabled',()=>{
 const s=createGame();assert.ok(s.creatures.every(a=>a.lifecycle.growth===600&&!a.lifecycle.enabled));step(s,100);assert.equal(s.creatures.length,3);check(s);
});

test('two nearby tame adults conceive one carried brood and spend nutrition',()=>{
 const {s,a,b}=pen(),food=totalResources(s).food;startRecording(s);step(s);assert.deepEqual(a.lifecycle.brood,{id:a.lifecycle.brood.id,mate:b.id,started:1,progress:0});assert.equal(b.lifecycle.brood,null);assert.equal(observe(s).entities[a.lifecycle.brood.id].carrier,a.id);assert.equal(a.lifecycle.cooldown,600);assert.ok(a.fed<91&&b.fed<91);assert.equal(totalResources(s).food,food);assert.equal(events(s).filter(e=>e.id==='animal.brood.started').length,1);check(s);
});

test('courtship walks through the pasture without teleporting or moving twice in a tick',()=>{
 const {s,a,b}=pen();a.x=4;a.y=16;b.x=8;b.y=22;startRecording(s);
 for(let i=0;i<80&&!a.lifecycle.brood;i++){const old=[a.x,a.y];step(s);assert.ok(Math.abs(a.x-old[0])+Math.abs(a.y-old[1])<=1);}
 assert.ok(a.lifecycle.brood);assert.ok(events(s).some(e=>e.id==='animal.moved'&&e.reason==='courtship'));check(s);
});

test('healthy broods take 300 development ticks and create a physical child with parentage',()=>{
 const {s,a,b}=pen();step(s);step(s,299);assert.equal(children(s).length,0);assert.equal(a.lifecycle.brood.progress,299);step(s);const child=children(s)[0];assert.ok(child);assert.deepEqual(child.lifecycle.parents,[a.id,b.id]);assert.equal(child.age,0);assert.equal(child.lifecycle.growth,0);assert.equal(child.husbandry.post,null);assert.equal(child.husbandry.trust,40);assert.equal(child.fed,40);assert.equal(a.lifecycle.brood,null);assert.equal(a.lifecycle.cooldown,600);assert.equal(Math.abs(child.x-a.x)+Math.abs(child.y-a.y),1);check(s);
});

test('wild, disabled, unwell and open-range pairs cannot start broods',()=>{
 for(const [mutate,reason] of [[f=>f.a.husbandry.trust=80,'untamed'],[f=>f.a.lifecycle.enabled=false,'disabled'],[f=>f.a.fed=60,'condition_low'],[f=>f.a.health=50,'condition_low'],[f=>f.gate.gateMode='open','open_range']]){const f=pen();mutate(f);assert.equal(breedingStatus(f.s,f.a).reason,reason);step(f.s,5);assert.equal(f.a.lifecycle.brood,null);assert.equal(f.b.lifecycle.brood,null);check(f.s);}
});

test('pregnancy pauses in open or poor conditions and resumes without resetting progress',()=>{
 const {s,a,gate}=pen();step(s,30);const progress=a.lifecycle.brood.progress;gate.gateMode='open';step(s,10);assert.equal(a.lifecycle.brood.progress,progress);assert.equal(breedingStatus(s,a).reason,'open_range');gate.gateMode='latched';a.health=30;step(s,10);assert.equal(a.lifecycle.brood.progress,progress);a.health=100;step(s);assert.equal(a.lifecycle.brood.progress,progress+1);check(s);
});

test('disabling new breeding retains an existing brood and prevents another pairing',()=>{
 const {s,a,b}=pen();step(s);for(const animal of [a,b])assert.ok(executeAction(s,'husbandry.breed',{creature:animal.id,enabled:false}).ok);until(s,()=>children(s).length===1);step(s,620);assert.equal(children(s).length,1);assert.equal(a.lifecycle.brood,null);check(s);
});

test('crowded pasture refuses a new brood and pending young consume breeding capacity',()=>{
 const {s,site,a,b}=pen();for(let y=16;y<=22;y++)at(site,5,y).building='fence';a.x=4;b.x=4;assert.equal(breedingStatus(s,a).reason,'pasture_crowded');step(s);assert.equal(a.lifecycle.brood,null);check(s);
});

test('ready brood waits for a vacant adjacent ground tile and births only after clearance',()=>{
 const {s,site,a}=pen();step(s,300);const positions=[[a.x+1,a.y],[a.x-1,a.y],[a.x,a.y+1],[a.x,a.y-1]];for(const [x,y]of positions)at(site,x,y).building='husbandryPost';step(s);assert.equal(children(s).length,0);assert.equal(a.lifecycle.brood.progress,300);assert.equal(breedingStatus(s,a).reason,'birth_tile_blocked');at(site,...positions[0]).building=null;step(s);assert.equal(children(s).length,1);check(s);
});

test('carrier death loses its brood once while death of the mate preserves it',()=>{
 const f=pen();step(f.s);startRecording(f.s);f.a.health=0;step(f.s,2);assert.equal(f.a.lifecycle.brood,null);assert.equal(events(f.s).filter(e=>e.id==='animal.brood.lost').length,1);check(f.s);
 const {s,a,b}=pen();step(s);b.health=0;until(s,()=>children(s).length===1);assert.equal(children(s)[0].lifecycle.parents[1],b.id);assert.ok(a.health>0);check(s);
});

test('juveniles graze, grow when nourished, and cannot produce curd before adulthood',()=>{
 const {s,a,b}=pen();step(s);a.lifecycle.enabled=b.lifecycle.enabled=false;until(s,()=>children(s).length===1);const child=children(s)[0];child.husbandry.trust=100;child.fed=100;
 step(s,100);assert.ok(child.lifecycle.growth>0&&child.lifecycle.growth<600);assert.equal(child.husbandry.product,0);
 child.health=30;const growth=child.lifecycle.growth;step(s,10);assert.equal(child.lifecycle.growth,growth);assert.equal(breedingStatus(s,child).reason,'growth_condition_low');child.health=100;child.fed=100;startRecording(s,{maxRecords:10000,maxBytes:64000000});until(s,()=>child.lifecycle.growth===600,650);assert.equal(events(s).filter(e=>e.id==='animal.matured'&&e.entity===child.id).length,1);step(s);assert.ok(child.husbandry.product>0);check(s);
});

test('a young animal can receive real handler feeding and trust before maturity',()=>{
 const {s,site,a,b}=pen();step(s);a.lifecycle.enabled=b.lifecycle.enabled=false;until(s,()=>children(s).length===1);const child=children(s)[0];at(site,6,19).building='husbandryPost';assert.ok(setAnimalPost(s,child.id,6,19).ok);until(s,()=>child.husbandry.trust===100);assert.ok(child.lifecycle.growth<600);assert.equal(child.husbandry.product,0);check(s);
});

test('direct parents and siblings are excluded from pairing',()=>{
 const {s,a,b}=pen();step(s);a.lifecycle.enabled=b.lifecycle.enabled=false;until(s,()=>children(s).length===1);const child=children(s)[0];until(s,()=>child.lifecycle.growth===600,700);child.lifecycle.enabled=true;child.husbandry.trust=100;child.fed=100;a.lifecycle.enabled=true;a.lifecycle.cooldown=0;a.fed=100;
 assert.equal(breedingStatus(s,child).reason,'no_compatible_mate');assert.equal(breedingStatus(s,a).reason,'no_compatible_mate');check(s);
});

test('herd and total creature limits prevent uncontrolled growth',()=>{
 const {s,a}=pen();for(let i=0;i<21;i++)s.creatures.push({...structuredClone(a),id:`extra-${i}`,lifecycle:newLifecycle()});assert.equal(breedingStatus(s,a).reason,'herd_limit');step(s);assert.equal(a.lifecycle.brood,null);check(s);
});

test('schema 27 migration preserves animals, supplies, jobs and RNG while adding adult lifecycle state',()=>{
 const {s}=pen();s.version=27;for(const a of s.creatures)delete a.lifecycle;const before=structuredClone(s),copy=check(s);assert.equal(copy.version,36);assert.deepEqual(totalResources(copy),totalResources(s));assert.equal(copy.rng,s.rng);assert.deepEqual(copy.jobs,s.jobs);for(let i=0;i<copy.creatures.length;i++){const {lifecycle,...animal}=copy.creatures[i];assert.deepEqual(animal,before.creatures[i]);assert.deepEqual(lifecycle,newLifecycle());}
});

test('partial broods and growing offspring reload deterministically and recording is observational',()=>{
 const {s}=pen();step(s,100);const copy=check(s);startRecording(s,{maxRecords:10000,maxBytes:64000000});step(s,300);step(copy,300);assert.deepEqual(s,copy);const child=children(s)[0];assert.ok(child);assert.equal(observe(s).entities[child.id].derived.breeding.phase,'juvenile');assert.ok(events(s).some(e=>e.id==='animal.born'&&e.entity===child.id));check(s);
});

test('malformed lifecycle, impossible offspring and juvenile product are rejected',()=>{
 for(const mutate of [a=>a.lifecycle.growth=-1,a=>a.lifecycle.cooldown=601,a=>a.lifecycle.enabled=1,a=>a.lifecycle.parents=['missing'],a=>a.lifecycle.brood={mate:a.id,started:0,progress:0},a=>a.lifecycle.brood={mate:'grazer-1',started:0,progress:1}]){const {s,a}=pen();mutate(a);assert.throws(()=>check(s));}
 const {s,a,b}=pen();step(s);a.lifecycle.enabled=b.lifecycle.enabled=false;until(s,()=>children(s).length===1);const child=children(s)[0];child.husbandry.product=1;assert.throws(()=>check(s),/Juvenile/);child.husbandry.product=0;child.lifecycle.parents[0]=child.id;assert.throws(()=>check(s),/parentage/);
});


test('pending broods reserve room so two pairs cannot overfill the same pasture',()=>{
 const {s,a,b}=pen(),c=s.creatures[2];c.x=4;c.y=20;c.fed=100;c.husbandry.trust=100;c.lifecycle.enabled=true;
 const d={...structuredClone(b),id:'fourth-founder',x:5,y:20};s.creatures.push(d);step(s);assert.equal(s.creatures.filter(a=>a.lifecycle?.brood).length,1);assert.equal(breedingStatus(s,c).reason,'pasture_crowded');check(s);
});

test('tibble reproduction has its own parent and offspring event label',()=>{
 const s=createGame();s.creatures.push({id:'tibble-parent',species:'tibble',site:'surface',x:8,y:10,health:100,fed:100,age:60});startRecording(s);step(s,5);const event=events(s).find(e=>e.id==='pest.born');assert.ok(event);assert.equal(event.parent,'tibble-parent');assert.ok(s.creatures.some(a=>a.id===event.entity));check(s);
});
