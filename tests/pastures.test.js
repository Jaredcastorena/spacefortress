import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, serialize, deserialize, setAnimalPost, setLabor, updateRooms } from '../src/simulation.js';
import { passable, pathTo, animalPassable, animalPath } from '../src/navigation.js';
import { animalPasture, setPastureGate, pastureRegions } from '../src/pastures.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
import { setMachineEnabled } from '../src/industry.js';
import { executeAction } from '../src/controls.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
const check=s=>{syncResources(s);return deserialize(serialize(s));};
const until=(s,p,max=180)=>{for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),`Condition missing at tick ${s.tick}`);check(s);};
function pen(){
 const s=createGame(),site=s.sites.surface,a=s.creatures[0];
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
 for(const c of s.crew)setLabor(s,c.id,'hauling',false);
 for(let y=14;y<=20;y++)for(let x=3;x<=9;x++){const t=at(site,x,y);t.terrain='ground';t.building=x===3||x===9||y===14||y===20?'fence':null;t.hp=100;t.lichen=80;delete t.maintenance;}
 const gate=at(site,6,14);gate.building='pastureGate';gate.gateMode='latched';
 const post=at(site,6,17);post.building='husbandryPost';a.x=6;a.y=16;
 refreshPower(s,site);
 return {s,site,a,gate,post};
}
const gateAction=(s,mode)=>executeAction(s,'pasture.gate',{site:'surface',x:6,y:14,mode},'test');
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.kind==='event').map(r=>r.event);

test('fences and crew wickets provide distinct crew, grazer and pest routes',()=>{
 const {s,site,a}=pen();assert.equal(passable(site,3,16),false);assert.equal(animalPassable(site,3,16,'tibble'),true);
 assert.ok(pathTo(site,{x:6,y:13},[[6,17]]));assert.equal(animalPath(site,{...a,x:6,y:13},[[6,17]]),null);
 assert.ok(animalPath(site,{species:'tibble',x:2,y:16},[[6,17]]));assert.equal(animalPasture(s,a).enclosed,true);assert.equal(animalPasture(s,a).tiles,25);
 assert.ok(gateAction(s,'open').ok);assert.ok(animalPath(site,{...a,x:6,y:13},[[6,17]]));assert.equal(animalPasture(s,a).enclosed,false);check(s);
});

test('construction consumes delivered alloy and leaves a latched gate without free starting fences',()=>{
 const s=createGame(),site=s.sites.surface;for(const c of s.crew)setLabor(s,c.id,'hauling',false);
 const before=totalResources(s);assert.ok(!site.tiles.some(t=>['fence','pastureGate'].includes(t.building)));
 for(const [x,building] of [[11,'fence'],[12,'pastureGate']]){const result=order(s,'surface',x,15,'build',building);assert.ok(result.ok);until(s,()=>!s.jobs.includes(result.job));assert.equal(at(site,x,15).building,building);}
 assert.equal(totalResources(s).alloy,before.alloy-3);assert.equal(at(site,12,15).gateMode,'latched');check(s);
});

test('handlers physically enter a latched pasture, deliver feed and tame the resident',()=>{
 const {s,a}=pen();assert.ok(setAnimalPost(s,a.id,6,17).ok);until(s,()=>a.husbandry.trust===100);assert.equal(animalPasture(s,a).enclosed,true);assert.ok(s.crew.some(c=>c.y>=15&&c.x>3&&c.x<9));check(s);
});

test('animal assignment requires its own route and never teleports through a latched gate',()=>{
 const {s,a}=pen();a.x=6;a.y=13;const before=[a.x,a.y];assert.equal(setAnimalPost(s,a.id,6,17).ok,false);assert.deepEqual([a.x,a.y],before);
 gateAction(s,'open');assert.ok(setAnimalPost(s,a.id,6,17).ok);until(s,()=>a.y>=15);assert.ok(gateAction(s,'latched').ok);until(s,()=>a.husbandry.trust>=40);check(s);
});

test('wild grazers remain enclosed during repeated grazing and movement',()=>{
 const {s,a}=pen();for(let i=0;i<180;i++){step(s);assert.ok(a.x>3&&a.x<9&&a.y>14&&a.y<20);}assert.equal(animalPasture(s,a).enclosed,true);check(s);
});

test('an assigned animal can graze beyond the soft post radius inside a physical pasture',()=>{
 const {s,site,a}=pen();a.x=4;a.y=19;setAnimalPost(s,a.id,6,17);a.husbandry.trust=100;a.husbandry.care=false;a.husbandry.harvest=false;const t=at(site,a.x,a.y),lichen=t.lichen;step(s,9);assert.equal(a.x,4);assert.equal(a.y,19);assert.equal(t.lichen,lichen-5);check(s);
});

test('broken fences open a route, and supplied repair restores containment',()=>{
 const {s,site,a}=pen(),t=at(site,3,17);t.hp=0;assert.equal(passable(site,3,17),true);assert.equal(animalPasture(s,a).enclosed,false);
 const j=order(s,'surface',3,17,'repair').job;assert.ok(j);until(s,()=>!s.jobs.includes(j));assert.equal(t.hp,100);assert.equal(animalPasture(s,a).enclosed,true);check(s);
});

test('broken gates ignore their latch until repaired and dismantling removes gate state',()=>{
 const {s,gate,a}=pen();gate.hp=0;assert.equal(animalPasture(s,a).enclosed,false);gateAction(s,'latched');assert.ok(animalPassable(s.sites.surface,6,14));
 const repair=order(s,'surface',6,14,'repair').job;until(s,()=>!s.jobs.includes(repair));assert.equal(animalPasture(s,a).enclosed,true);
 const remove=order(s,'surface',6,14,'remove').job;until(s,()=>!s.jobs.includes(remove));assert.equal(gate.building,null);assert.equal(gate.gateMode,undefined);assert.equal(animalPasture(s,a).enclosed,false);check(s);
});

test('a gate cannot latch around a living grazer; crew and tibbles may use the wicket',()=>{
 const {s,a,gate}=pen();gateAction(s,'open');a.x=6;a.y=14;assert.equal(gateAction(s,'latched').ok,false);assert.equal(gate.gateMode,'open');a.y=15;s.crew[0].x=6;s.crew[0].y=14;assert.ok(gateAction(s,'latched').ok);check(s);
});

test('fence and gate construction waits for an occupied target instead of embedding an animal',()=>{
 const {s,site,a}=pen();const t=at(site,5,16);a.x=t.x;a.y=t.y;const j=order(s,'surface',t.x,t.y,'build','fence').job;assert.ok(j);step(s,30);assert.equal(t.building,null);assert.ok(s.jobs.includes(j));a.x=6;a.y=16;until(s,()=>!s.jobs.includes(j));assert.equal(t.building,'fence');check(s);
});

test('pasture structures neither divide compartments nor hold atmosphere',()=>{
 const s=createGame(),site=s.sites.surface,before=structuredClone(site.rooms);at(site,11,9).building='fence';updateRooms(site);assert.deepEqual(site.rooms.map(r=>r.cells),before.map(r=>r.cells));
 const wall=at(site,6,9);wall.building='pastureGate';wall.gateMode='latched';updateRooms(site);assert.ok(site.rooms.some(r=>!r.sealed));check(s);
});

test('gate controls label boundary loss separately from movement and derived pasture entities',()=>{
 const {s,a}=pen();startRecording(s);const initial=observe(s),id=initial.entities[a.id].derived.pasture.region;assert.equal(initial.entities[id].type,'pasture');assert.equal(initial.entities[id].cells.length,25);
 assert.ok(gateAction(s,'open').ok);assert.equal(events(s).filter(e=>e.id==='animal.containment.lost'&&e.entity===a.id).length,1);assert.ok(!events(s).some(e=>e.id==='animal.moved'));gateAction(s,'latched');assert.ok(events(s).some(e=>e.id==='animal.containment.gained'));assert.ok(events(s).some(e=>e.id==='pasture.gate.mode_changed'));check(s);
});

test('recording adds movement records without changing simulation outcomes or saves',()=>{
 const {s,site,a}=pen();at(site,a.x,a.y).lichen=0;const copy=check(s);startRecording(s,{maxRecords:10000,maxBytes:16000000});step(s,160);step(copy,160);assert.deepEqual(s,copy);assert.ok(events(s).some(e=>e.id==='animal.moved'));check(s);
});

test('save migration preserves supplies and animals; gate validation rejects malformed state',()=>{
 const s=createGame();s.version=26;const resources=totalResources(s),animals=structuredClone(s.creatures),copy=check(s);assert.equal(copy.version, VERSION);assert.deepEqual(totalResources(copy),resources);assert.deepEqual(copy.creatures,animals);
 for(const mode of [null,undefined,'closed',5]){const {s,gate}=pen();gate.gateMode=mode;assert.throws(()=>check(s),/pasture gate/);}
 const f=pen();f.post.gateMode='open';assert.throws(()=>check(f.s),/pasture gate/);
});

test('open and damaged boundaries and pending work continue deterministically after reload',()=>{
 const {s,gate,site,a}=pen();gateAction(s,'open');at(site,3,17).hp=0;setAnimalPost(s,a.id,6,17);step(s,5);const copy=check(s);step(s,50);step(copy,50);assert.deepEqual(copy,s);assert.equal(gate.gateMode,'open');
 assert.equal(executeAction(s,'pasture.gate',{site:'surface',x:6,y:14,mode:'teleport'}).code,'invalid_arguments');assert.equal(setPastureGate(s,'surface',6,17,'open').ok,false);
});


test('closing a gate marks a blocked post route while preserving feeding supplies',()=>{
 const {s,a}=pen();a.x=6;a.y=13;gateAction(s,'open');setAnimalPost(s,a.id,6,17);const before=totalResources(s);startRecording(s);gateAction(s,'latched');
 assert.equal(animalPasture(s,a).postReachable,false);assert.ok(events(s).some(e=>e.id==='animal.post.route_changed'&&e.entity===a.id&&e.reachable===false));step(s,20);assert.equal(a.husbandry.trust,0);assert.equal(totalResources(s).food,before.food);assert.equal(observe(s).entities[a.id].derived.husbandryStatus,'Post route blocked');
 gateAction(s,'open');until(s,()=>a.husbandry.trust>=40);check(s);
});

test('repair waits for crew occupying a broken fence and exposes the blocked work',()=>{
 const {s,site}=pen(),c=s.crew[0],t=at(site,3,17);t.hp=0;c.x=3;c.y=17;c.life.policy='work';for(const labor of Object.keys(c.labors))setLabor(s,c.id,labor,false);
 const j=order(s,'surface',3,17,'repair').job;assert.ok(j);step(s,25);assert.equal(t.hp,0);assert.match(j.blockedReason,/occupied boundary/);c.x=2;until(s,()=>!s.jobs.includes(j));assert.equal(t.hp,100);check(s);
});
