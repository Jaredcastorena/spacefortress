import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {deserialize,serialize,step,order,cancelJob} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {tileAt} from '../src/spatial.js';
import {prepareFire,extinguish,FIRE} from '../src/fire.js';
import {damage,scheduleMaintenance,SERVICE_INTERVAL} from '../src/maintenance.js';
import {totalResources,syncResources} from '../src/inventory.js';
import {executeAction} from '../src/controls.js';
import {startRecording,exportRecording,observe} from '../src/telemetry.js';
import {fireDetails} from '../src/fire-panels.js';

// Genuine schema60: native paid stairs/holo, synthetic sealed upper room and ignition.
// Finite resources and actual stair delivery; this is not ordinary colony endurance.
const raw=gunzipSync(readFileSync(new URL('./fixtures/hazard-response-schema60.json.gz',import.meta.url))).toString();
const target={site:'surface',x:8,y:8,z:1};
const fresh=(staffed=true)=>{const s=deserialize(raw),site=s.sites.surface;if(staffed)assert.equal(executeAction(s,'crew.labor',{crew:'crew-0',labor:'engineering',enabled:true}).ok,true);return {s,site,t:tileAt(site,target),lower:tileAt(site,{...target,z:0})};};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
const valid=s=>assert.equal(serialize(deserialize(serialize(s))),serialize(s));
const until=(s,p,cap=100)=>{for(let n=0;n<cap&&!p();n++)step(s);assert.ok(p(),`Condition missing at tick ${s.tick}`);};
const manual=s=>{const r=executeAction(s,'job.order',{...target,kind:'extinguish'});assert.equal(r.ok,true,r.message);return s.jobs.find(j=>j.id===r.job);};

test('genuine schema60 migrates without resetting the fire, resources or physical state',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'8590df3a0edfc034fa62ec77c5a88cf2ae84f66883846f41c3a8254a581eb89e');
 const old=JSON.parse(raw),{s,t}=fresh(false);assert.equal(old.version,60);old.version=VERSION;old.resources.tools=0;
 assert.deepEqual(s,old);assert.match(t.fire.blocked,/not available/);valid(s);
});

for(const automatic of [false,true])test(`${automatic?'automatic':'manual'} upstairs suppression delivers two water through stairs and labels the actual floor`,()=>{
 const {s,site,t,lower}=fresh(),water=totalResources(s).water,lowerHp=lower.hp,fire=t.fire.id;
 site.fireSafety.automatic=automatic;startRecording(s);
 assert.equal(observe(s).entities[fire].tile,'tile:surface:8:8:1');assert.match(fireDetails(s,site,t),/Floor 1/);
 if(automatic)prepareFire(s,order,cancelJob);else manual(s);
 const j=s.jobs.find(j=>j.kind==='extinguish');assert.ok(j);assert.equal(j.z,1);assert.ok(j.sources.every(p=>p.z===0));
 prepareFire(s,order,cancelJob);assert.equal(s.jobs.filter(j=>j.kind==='extinguish').length,1);
 until(s,()=>!t.fire);assert.equal(totalResources(s).water,water-2);assert.equal(lower.hp,lowerHp);assert.equal(lower.building,'solar');
 assert.ok(events(s).some(e=>e.id==='fire.extinguished'&&e.entity===fire&&e.actor&&e.target==='tile:surface:8:8:1'));
 assert.ok(events(s).some(e=>e.id==='job.completed'&&e.entity===j.id&&e.target==='tile:surface:8:8:1'));valid(s);
});

test('missing reachable water and closed stairs block upper response without spending supplies',()=>{
 for(const blocked of ['water','stairs']){const {s,site,t}=fresh();
  if(blocked==='water'){for(const t of site.tiles)if(t.stock)delete t.stock.water;syncResources(s);}else site.verticalLinks[0].mode='closed';
  const before=serialize(s),water=totalResources(s).water;assert.equal(order(s,'surface',8,8,'extinguish',null,1).ok,false);assert.equal(serialize(s),before);
  prepareFire(s,order,cancelJob);assert.ok(t.fire.blocked);assert.equal(s.jobs.some(j=>j.kind==='extinguish'),false);assert.equal(totalResources(s).water,water);
  if(blocked==='stairs'){site.verticalLinks[0].mode='auto';prepareFire(s,order,cancelJob);assert.equal(s.jobs.filter(j=>j.kind==='extinguish').length,1);valid(s);}
 }
});

test('an upstairs suppression reload during delivery retains custody and deterministic completion',()=>{
 const {s,site,t}=fresh();site.fireSafety.automatic=false;manual(s);until(s,()=>s.crew.some(c=>c.carry?.water));
 const copy=deserialize(serialize(s)),water=totalResources(s).water;assert.equal(serialize(copy),serialize(s));
 for(let n=0;n<100&&t.fire;n++){step(s);step(copy);}assert.equal(t.fire,undefined);assert.equal(totalResources(s).water,water-2);assert.equal(serialize(copy),serialize(s));valid(s);
});

test('upper suppression cancellation or an ended fire preserves carried water and its owner',()=>{
 for(const ended of [false,true]){const {s,site,t}=fresh();site.fireSafety.automatic=false;const j=manual(s);until(s,()=>s.crew.some(c=>c.carry?.water));const water=totalResources(s).water;
  if(ended){extinguish(s,site,t,'fixture_ended');prepareFire(s,order,cancelJob);}else {cancelJob(s,j.id);assert.equal(t.fire.retryAt,s.tick+FIRE.retry);site.fireSafety.automatic=true;prepareFire(s,order,cancelJob);}
  assert.equal(s.jobs.some(k=>k.id===j.id),false);assert.equal(totalResources(s).water,water);assert.ok(s.crew.some(c=>c.carry?.water));valid(s);
 }
});

for(const kind of ['repair','service'])test(`automatic upper ${kind} consumes one delivered alloy and leaves overlapping ground equipment intact`,()=>{
 const {s,site,t,lower}=fresh();extinguish(s,site,t,'fixture_setup');if(kind==='repair')damage(s,site,t,'structure',55,'debris');else t.maintenance.usage=SERVICE_INTERVAL;
 const alloy=totalResources(s).alloy,lowerHp=lower.hp;assert.equal(executeAction(s,'maintenance.auto',{...target,enabled:true}).ok,true);startRecording(s);scheduleMaintenance(s,order);
 const j=s.jobs.find(j=>j.automaticMaintenance);assert.equal(j.kind,kind);assert.equal(j.z,1);scheduleMaintenance(s,order);assert.equal(s.jobs.filter(j=>j.automaticMaintenance).length,1);
 valid(s);until(s,()=>!s.jobs.includes(j));assert.equal(t.hp,100);assert.equal(t.maintenance.usage,0);assert.equal(totalResources(s).alloy,alloy-1);assert.equal(lower.hp,lowerHp);
 assert.ok(events(s).some(e=>e.id==='job.completed'&&e.entity===j.id&&e.target==='tile:surface:8:8:1'));valid(s);
});

test('legacy schemas cannot claim new upper response jobs and current fire jobs cannot alias ground tiles',()=>{
 const {s}=fresh();manual(s);const legacy=JSON.parse(serialize(s));legacy.version=60;assert.throws(()=>deserialize(JSON.stringify(legacy)),/Legacy upper hazard response/);
 const wrong=JSON.parse(serialize(s));wrong.jobs.find(j=>j.kind==='extinguish').z=0;assert.throws(()=>deserialize(JSON.stringify(wrong)));
 const f=fresh();extinguish(f.s,f.site,f.t,'fixture_setup');damage(f.s,f.site,f.t,'structure',55,'debris');f.t.maintenance.auto=true;scheduleMaintenance(f.s,order);
 const automatic=JSON.parse(serialize(f.s));automatic.version=60;assert.throws(()=>deserialize(JSON.stringify(automatic)),/Legacy upper hazard response/);
 delete automatic.jobs.find(j=>j.automaticMaintenance).automaticMaintenance;assert.doesNotThrow(()=>deserialize(JSON.stringify(automatic)));
});
