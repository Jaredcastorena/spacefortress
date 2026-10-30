import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createGame, at, order, step, cancelJob, serialize, deserialize} from '../src/simulation.js';
import {initializeElectrical, refreshPower} from '../src/power.js';
import {initializeStorage, syncResources, totalResources} from '../src/inventory.js';
import {startRecording, exportRecording} from '../src/telemetry.js';
import {laborFor} from '../src/crew.js';
import {dismantleRefund} from '../src/materials.js';
import {ignite, extinguish} from '../src/fire.js';
import {VERSION} from '../src/data.js';

const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function until(s,label,predicate,limit=120){for(let n=0;n<limit&&!predicate();n++)step(s);assert.ok(predicate(),`${label} at tick ${s.tick}`);}
function roundtrip(s){syncResources(s);for(const site of Object.values(s.sites))refreshPower(s,site);const raw=serialize(s);assert.equal(serialize(deserialize(raw)),raw);}
function base(){const s=createGame(),site=s.sites.surface;for(const t of site.tiles)if(t.machine)t.machine.enabled=false;for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}refreshPower(s,site);return {s,site};}
function fixture(){const f=base(),t=at(f.site,11,9);assert.equal(t.building,null);t.building='fuseBox';t.hp=63;initializeStorage(t);initializeElectrical(t);t.protection.blown=true;refreshPower(f.s,f.site);return {...f,t};}
function replacement(f){const r=order(f.s,'surface',f.t.x,f.t.y,'replaceFuse',null,f.t.z);assert.equal(r.ok,true,r.message);return r.job;}

// This small native colony path spends only the starting stock and uses the
// regular crew assignment, material carrying and work completion machinery.
test('paid fuse construction carries finite stock, starts open and forbids cable overlays',()=>{
 const {s,site}=base(),t=at(site,11,9),before=totalResources(s),r=order(s,'surface',11,9,'build','fuseBox');
 assert.equal(r.ok,true);assert.deepEqual(r.job.cost,{alloy:2,components:1});assert.equal(r.job.work,6);assert.deepEqual(r.job.materials,{});assert.equal(t.building,null);
 until(s,'physical construction supply',()=>Object.keys(r.job.materials).length>0);assert.equal(t.building,null);assert.equal(totalResources(s).alloy,before.alloy);
 roundtrip(s);until(s,'completed fuse box',()=>t.building==='fuseBox');
 assert.deepEqual(t.protection,{kind:'fuse',direction:'ne',enabled:false,blown:false,rating:8,lastThroughput:0,lastTick:null});
 assert.equal(totalResources(s).alloy,before.alloy-2);assert.equal(totalResources(s).components,before.components-1);
 assert.equal(order(s,'surface',11,9,'build','cable').ok,false);
 const wired=at(site,12,9);wired.cable={hp:100,enabled:true};assert.equal(order(s,'surface',12,9,'build','fuseBox').ok,false);
 assert.equal(order(s,'surface',12,14,'build','fuseBox').ok,false);roundtrip(s);
});

test('replacement consumes delivered alloy with engineering work, preserves condition and remains open',()=>{
 const f=fixture(),{s,t}=f,before=totalResources(s).alloy;startRecording(s);const job=replacement(f);
 assert.equal(laborFor(job),'engineering');assert.deepEqual(job.cost,{alloy:1});assert.equal(job.work,3);assert.deepEqual(job.materials,{});assert.equal(t.protection.blown,true);assert.equal(totalResources(s).alloy,before);
 until(s,'carried cartridge alloy',()=>s.crew.some(c=>c.delivery?.job===job.id&&c.carry?.alloy===1));roundtrip(s);
 until(s,'replacement finished',()=>!s.jobs.some(j=>j.id===job.id));
 assert.equal(t.hp,63);assert.equal(t.protection.blown,false);assert.equal(t.protection.enabled,false);assert.equal(totalResources(s).alloy,before-1);
 const event=events(s).find(e=>e.id==='power.fuse.replaced');assert.ok(event);assert.equal(event.job,job.id);assert.ok(s.crew.some(c=>c.id===event.actor));assert.equal(event.entity,'tile:surface:11:9');assert.deepEqual(event.cost,{alloy:1});assert.equal(event.next.lastThroughput,0);assert.equal(event.next.lastTick,null);
 assert.ok(events(s).some(e=>e.id==='job.completed'&&e.entity===job.id));roundtrip(s);
 assert.equal(order(s,'surface',11,9,'replaceFuse').ok,false);
});

for(const phase of ['reserved','carried','delivered'])test(`cancellation refunds ${phase} replacement material without resetting the fuse`,()=>{
 const f=fixture(),before=totalResources(f.s).alloy,job=replacement(f);
 if(phase==='carried')until(f.s,'carried supply',()=>f.s.crew.some(c=>c.delivery?.job===job.id&&c.carry?.alloy===1));
 if(phase==='delivered')until(f.s,'delivered supply',()=>job.materials.alloy===1);
 roundtrip(f.s);cancelJob(f.s,job.id);
 assert.equal(totalResources(f.s).alloy,before);assert.equal(f.t.protection.blown,true);assert.equal(f.t.hp,63);assert.equal(f.s.jobs.some(j=>j.id===job.id),false);roundtrip(f.s);
});

for(const change of ['broken box','already replaced','requested enabled'])test(`stale completion after ${change} refunds delivered material`,()=>{
 const f=fixture(),before=totalResources(f.s).alloy;startRecording(f.s);const job=replacement(f);
 until(f.s,'delivered supply',()=>job.materials.alloy===1);
 if(change==='broken box')f.t.hp=0;
 if(change==='already replaced')f.t.protection.blown=false;
 if(change==='requested enabled')f.t.protection.enabled=true;
 roundtrip(f.s);until(f.s,'stale order cancelled',()=>!f.s.jobs.some(j=>j.id===job.id));
 assert.equal(totalResources(f.s).alloy,before);assert.equal(events(f.s).some(e=>e.id==='power.fuse.replaced'),false);
 assert.ok(events(f.s).some(e=>e.id==='job.cancelled'&&e.entity===job.id&&e.automatic));roundtrip(f.s);
});

test('replacement eligibility rejects closed request, damage, fire and unreachable supply without reservations',()=>{
 for(const alter of [f=>{f.t.protection.enabled=true;},f=>{f.t.hp=0;},f=>{f.t.fire={};},f=>{f.t.protection.blown=false;},f=>{at(f.site,8,10).stock.alloy=0;syncResources(f.s);},f=>{f.t.building='battery';}]){
  const f=fixture();alter(f);const before=serialize(f.s);assert.equal(order(f.s,'surface',11,9,'replaceFuse').ok,false);assert.equal(serialize(f.s),before);
 }
});

test('generic paid repair leaves the blown cartridge spent and salvage subtracts it before rounding',()=>{
 const f=fixture(),before=totalResources(f.s).alloy,r=order(f.s,'surface',11,9,'repair');assert.equal(r.ok,true);roundtrip(f.s);
 until(f.s,'frame repaired',()=>!f.s.jobs.some(j=>j.id===r.job.id));assert.equal(f.t.hp,100);assert.equal(f.t.protection.blown,true);assert.equal(totalResources(f.s).alloy,before-1);
 assert.deepEqual(dismantleRefund(f.t),{alloy:0,components:0});const removal=order(f.s,'surface',11,9,'remove');assert.equal(removal.ok,true);roundtrip(f.s);
 until(f.s,'spent box removed',()=>f.t.building===null);assert.equal(totalResources(f.s).alloy,before-1);assert.equal(f.t.protection,undefined);roundtrip(f.s);
 const intact=fixture();intact.t.protection.blown=false;assert.deepEqual(dismantleRefund(intact.t),{alloy:1,components:0});
});

test('schema74 validates exact replacement, repair and removal contracts; schema73 cannot smuggle fuses',()=>{
 const f=fixture(),job=replacement(f);roundtrip(f.s);
 for(const alter of [j=>{j.work=j.remaining=1;},j=>{j.cost={};j.sources=[];},j=>{j.building='fuseBox';},j=>{j.missingFood=1;},j=>{j.connection='stair-1';}]){
  const bad=JSON.parse(serialize(f.s));alter(bad.jobs.find(j=>j.id===job.id));assert.throws(()=>deserialize(JSON.stringify(bad)));
 }
 for(const kind of ['repair','remove']){const g=fixture(),r=order(g.s,'surface',11,9,kind);assert.equal(r.ok,true);const bad=JSON.parse(serialize(g.s));bad.jobs.find(j=>j.id===r.job.id).work=bad.jobs.find(j=>j.id===r.job.id).remaining=7;assert.throws(()=>deserialize(JSON.stringify(bad)),/Invalid fuse work/);}
 for(const shadow of ['tile','cartridge','build','replacement']){const old=createGame();old.version=73;
  if(shadow==='tile')at(old.sites.surface,11,9).building='fuseBox';
  if(shadow==='cartridge')at(old.sites.surface,11,9).protection={kind:'fuse'};
  if(shadow==='build')old.jobs.push({kind:'build',building:'fuseBox'});
  if(shadow==='replacement')old.jobs.push({kind:'replaceFuse'});
  assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy fuse/);
 }
 const old=createGame();old.version=73;const expected=structuredClone(old);expected.version=VERSION;assert.equal(serialize(deserialize(JSON.stringify(old))),JSON.stringify(expected));
});

test('upper-floor fuse replacement consumes actual-floor material and preserves the ground tile',()=>{
 const s=deserialize(gunzipSync(readFileSync(new URL('./fixtures/tools-schema63.json.gz',import.meta.url))).toString());for(const job of [...s.jobs])cancelJob(s,job.id);
 const site=s.sites.surface,t=at(site,10,9,1),source=at(site,10,8,1),ground=at(site,10,9,0);t.building='fuseBox';delete t.machine;t.cable=null;t.hp=71;initializeStorage(t);initializeElectrical(t);t.protection.blown=true;
 source.drop={...(source.drop||{}),alloy:(source.drop?.alloy||0)+1};for(const c of s.crew)if(c.site==='surface'){c.labors.engineering=true;c.labors.hauling=true;}syncResources(s);refreshPower(s,site);
 const before=totalResources(s).alloy,groundBuilding=ground.building,job=replacement({s,site,t});assert.equal(job.z,1);roundtrip(s);
 until(s,'upper cartridge replaced',()=>!s.jobs.some(j=>j.id===job.id));assert.equal(t.hp,71);assert.equal(t.protection.blown,false);assert.equal(ground.building,groundBuilding);assert.equal(ground.protection,undefined);assert.equal(totalResources(s).alloy,before-1);roundtrip(s);
});

test('fire after designation preserves a valid paid replacement until the tile is safe',()=>{
 const f=fixture(),before=totalResources(f.s).alloy,job=replacement(f);
 assert.equal(ignite(f.s,f.site,f.t,'electrical_fault'),true);roundtrip(f.s);
 assert.equal(f.t.protection.blown,true);assert.equal(totalResources(f.s).alloy,before);
 extinguish(f.s,f.site,f.t,'suppressed');until(f.s,'replacement after suppression',()=>!f.s.jobs.some(j=>j.id===job.id));
 assert.equal(f.t.protection.blown,false);assert.equal(totalResources(f.s).alloy,before-1);roundtrip(f.s);
});
