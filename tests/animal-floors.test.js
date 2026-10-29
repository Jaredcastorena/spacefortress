import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {deserialize,serialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {FOOD_LIFETIME} from '../src/food-lots.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {tileAt,positionOf,horizontalNeighbors,sameCell} from '../src/spatial.js';
import {animalPathToPosition,passablePosition} from '../src/navigation.js';
import {pastureRegions,animalPasture,moveAnimal} from '../src/pastures.js';
import {registerAnimalDeath,carcassPosition,updateCarcasses} from '../src/animal-carcasses.js';
import {injureAnimal} from '../src/animal-health.js';
import {refreshAtmosphere} from '../src/atmosphere.js';
import {postDetails,transportDetails} from '../src/husbandry-panels.js';
import {startRecording,exportRecording} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/animals-schema57.json.gz',import.meta.url))).toString();
const reload=s=>deserialize(serialize(s));
function parts(s){const site=s.sites.surface,stair=site.verticalLinks[0];return {s,site,stair,c:s.crew[0],a:s.creatures.find(a=>a.species==='bristleback')};}
function until(f,p,max=140){for(let i=0;i<max&&!p();i++)step(f.s);assert.ok(p(),`tick${f.s.tick}: ${f.c.activity}; ${f.s.jobs.map(j=>j.blockedReason).join(',')}`);}
function act(f,id,args){const r=executeAction(f.s,id,args);assert.equal(r.ok,true,r.message);return r;}
function build(f,building,p){const r=act(f,'job.order',{site:'surface',...p,kind:'build',building}),j=f.s.jobs.find(j=>j.id===r.job);until(f,()=>!f.s.jobs.includes(j));}
function colony(){const f=parts(deserialize(raw));f.c.labors.husbandry=true;f.c.labors.medicine=true;f.c.labors.engineering=true;
 for(const a of f.s.creatures){if(a.husbandry){a.husbandry.care=false;a.husbandry.harvest=false;}if(a.lifecycle)a.lifecycle.enabled=false;}
 const p=horizontalNeighbors(f.stair.upper).find(p=>tileAt(f.site,{...p,z:0})?.terrain==='floor');build(f,'floor',p);build(f,'husbandryPost',p);return serialize(f.s);}
const saved=colony();
// Boundary actor setup; floors, stairs and the upper post were paid native jobs.
function fixture(){const f=parts(deserialize(saved));Object.assign(f.a,f.stair.lower);f.a.husbandry.trust=100;f.a.husbandry.post=null;f.a.fed=100;f.post=f.site.tiles.find(t=>t.z===1&&t.building==='husbandryPost');return f;}
function assigned(f){act(f,'husbandry.assign',{creature:f.a.id,...positionOf(f.post)});until(f,()=>f.a.z===1);return f;}
function events(s){return exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);}

test('genuine schema57 migration preserves all physical state and rejects legacy upper animals',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'3c4fa43f0bfcfb9cf126a5b69a3849389db3b814e6cae2b27646cf87c30f5825');
 const old=JSON.parse(raw),s=deserialize(raw);assert.equal(old.version,57);old.version=VERSION;old.resources.tools=0;assert.deepEqual(s,old);assert.equal(serialize(reload(s)),serialize(s));
 const bad=JSON.parse(raw);Object.assign(bad.creatures[0],bad.sites.surface.verticalLinks[0].upper);assert.throws(()=>deserialize(serialize(bad)),/Animal execution/);
});
test('animal steps use real stairs, respect closure/damage, open automatic hatches and label both decks',()=>{
 const f=fixture();startRecording(f.s,{maxRecords:10000,maxBytes:16000000});const before=positionOf(f.a);
 assert.equal(moveAnimal(f.s,f.a,{...f.stair.upper,x:f.stair.upper.x+1},'test'),false);
 f.stair.mode='closed';assert.equal(animalPathToPosition(f.site,f.a,[positionOf(f.post)]),null);assert.equal(moveAnimal(f.s,f.a,f.stair.upper,'post'),false);
 f.stair.mode='auto';f.stair.hp=49;assert.equal(moveAnimal(f.s,f.a,f.stair.upper,'post'),false);f.stair.hp=100;
 assert.deepEqual(positionOf(f.a),before);assert.equal(moveAnimal(f.s,f.a,f.stair.upper,'post'),true);assert.ok(f.stair.openUntil>f.site.atmosphere.tick);
 assert.equal(f.a.z,1);refreshAtmosphere(f.site);assert.equal(serialize(reload(f.s)),serialize(f.s));assert.ok(events(f.s).some(e=>e.id==='animal.moved'&&e.to.endsWith(':1')));
});
test('assignment uses the shared command and connects pasture regions through the actual hatch',()=>{
 const f=fixture();assert.match(postDetails(f.s,f.post),/data-action="animal-assign"[^>]*data-z="1"/);assert.match(transportDetails(f.s,f.a),/floor 1/);const copy=deserialize(serialize(f.s)),args={creature:f.a.id,...positionOf(f.post)};
 assert.deepEqual(executeAction(f.s,'husbandry.assign',args,'player'),executeAction(copy,'husbandry.assign',args,'agent'));assert.equal(serialize(f.s),serialize(copy));
 until(f,()=>f.a.z===1);assert.deepEqual(f.a.husbandry.post,positionOf(f.post));assert.equal(animalPasture(f.s,f.a).postReachable,true);
 const open=pastureRegions(f.site);assert.equal(open.byCell.get(`${f.stair.lower.x},${f.stair.lower.y},0`),open.byCell.get(`${f.stair.upper.x},${f.stair.upper.y},1`));
 f.stair.mode='closed';refreshAtmosphere(f.site);const shut=pastureRegions(f.site);assert.notEqual(shut.byCell.get(`${f.stair.lower.x},${f.stair.lower.y},0`),shut.byCell.get(`${f.stair.upper.x},${f.stair.upper.y},1`));
 assert.match(postDetails(f.s,f.post),/HUSBANDRY/);assert.equal(serialize(reload(f.s)),serialize(f.s));
});
test('handler escort keeps crew and animal together through paid stairs and reloads while attached',()=>{
 const f=fixture();const r=act(f,'husbandry.transport',{creature:f.a.id,...positionOf(f.post)}),j=f.s.jobs.find(j=>j.id===r.job);let attached=0,up=0;
 for(let i=0;i<150&&f.s.jobs.includes(j);i++){step(f.s);if(j.phase==='escort'&&j.worker){const c=f.s.crew.find(c=>c.id===j.worker);assert.ok(sameCell(c,f.a));attached++;if(c.z===1)up++;}reload(f.s);}
 assert.ok(attached&&up);assert.ok(!f.s.jobs.includes(j));assert.ok(sameCell(f.a,f.post));assert.deepEqual(f.a.husbandry.post,positionOf(f.post));
});
test('supplied feeding, veterinary care and product collection finish at the upstairs post',()=>{
 const f=assigned(fixture());f.a.fed=25;f.a.husbandry.care=true;f.a.husbandry.harvest=true;f.a.husbandry.product=100;injureAnimal(f.s,f.a,5,'fire');
 const r=act(f,'husbandry.treat',{creature:f.a.id}),j=f.s.jobs.find(j=>j.id===r.job);assert.equal(j.z,1);assert.equal(j.cost.medicine,1);
 startRecording(f.s,{maxRecords:10000,maxBytes:16000000});until(f,()=>!f.s.jobs.includes(j),220);assert.ok(f.a.fed>=40);assert.equal(f.a.z,1);
 until(f,()=>f.a.husbandry.product<100,160);assert.ok(events(f.s).some(e=>e.id==='animal.harvested'&&e.target.endsWith(':1')));assert.ok(events(f.s).some(e=>e.id==='animal.care.completed'));assert.ok(events(f.s).some(e=>e.id==='animal.treatment.completed'&&e.target.endsWith(':1')));reload(f.s);
});
test('upper carcasses retain their floor, age and support paid butchery without duplicate ownership',()=>{
 const f=assigned(fixture());Object.assign(f.a,positionOf(f.post));registerAnimalDeath(f.s,f.a,'dispatch');assert.equal(carcassPosition(f.s,f.a).z,1);const age=f.a.death.age;updateCarcasses(f.s);assert.ok(f.a.death.age>age);reload(f.s);
 const r=act(f,'husbandry.butcher',{creature:f.a.id,...positionOf(f.post)}),j=f.s.jobs.find(j=>j.id===r.job);assert.equal(j.z,1);until(f,()=>!f.s.jobs.includes(j));assert.equal(f.a.death.disposition,'butchered');assert.equal(f.a.death.owner,null);assert.ok(f.post.drop.food>0);reload(f.s);
});
test('stair dismantling refuses to strand an upstairs animal',()=>{
 const f=assigned(fixture());Object.assign(f.a,positionOf(f.post));for(const c of f.s.crew)if(c.z>0||sameCell(c,f.stair.lower))Object.assign(c,horizontalNeighbors(f.stair.lower).find(p=>passablePosition(f.site,p)));
 const r=executeAction(f.s,'job.order',{site:'surface',...f.stair.lower,kind:'remove'});assert.equal(r.ok,false);assert.match(r.message,/upstairs crew and animals/);
});

test('upper slaughter and spoiled-body disposal use the real post and leave located waste',()=>{
 const f=assigned(fixture()),r=act(f,'husbandry.dispatch',{creature:f.a.id}),j=f.s.jobs.find(j=>j.id===r.job);assert.equal(j.z,1);assert.ok(f.a.health>0);
 until(f,()=>!f.s.jobs.includes(j));assert.equal(f.a.health,0);assert.deepEqual(carcassPosition(f.s,f.a),{site:'surface',...positionOf(f.post)});reload(f.s);
 // Boundary aging setup avoids an unrelated long endurance run.
 f.a.death.age=FOOD_LIFETIME;updateCarcasses(f.s);assert.equal(f.a.death.disposition,'spoiled');
 const disposal=act(f,'husbandry.discard',{creature:f.a.id}),work=f.s.jobs.find(j=>j.id===disposal.job);assert.equal(work.z,1);until(f,()=>!f.s.jobs.includes(work));assert.equal(f.a.death.disposition,'discarded');assert.equal(f.a.death.owner,null);assert.ok(f.post.drop.waste>=.25);reload(f.s);
});

test('unassigned livestock wanders on constructed upper floors without crossing a closed hatch',()=>{
 const f=fixture();Object.assign(f.a,positionOf(f.post));f.stair.mode='closed';refreshAtmosphere(f.site);startRecording(f.s);
 until(f,()=>!sameCell(f.a,f.post),20);assert.equal(f.a.z,1);assert.equal(f.a.husbandry.post,null);assert.ok(events(f.s).some(e=>e.id==='animal.moved'&&e.reason==='grazing'&&e.to.endsWith(':1')));reload(f.s);
});
