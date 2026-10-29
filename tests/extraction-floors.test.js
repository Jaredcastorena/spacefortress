import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {deserialize,serialize,step,updateRooms} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {tileAt} from '../src/spatial.js';
import {extractionStatus,extractTile,depositImpactOre,IMPACT_ORE_AMOUNT} from '../src/extraction.js';
import {totalResources,spill} from '../src/inventory.js';
import {waterSupply} from '../src/water.js';
import {depositDetails} from '../src/water-panels.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {startRecording,exportRecording,observe,systemFor} from '../src/telemetry.js';

const raw=gunzipSync(readFileSync(new URL('./fixtures/extraction-schema62.json.gz',import.meta.url))).toString();
const target={site:'surface',x:8,y:9,z:1};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
const structureAndStock=t=>{const copy=structuredClone(t);if(copy.stock)delete copy.stock._food;return copy;};
const valid=s=>assert.equal(serialize(deserialize(serialize(s))),serialize(s));
const until=(s,p,limit=100)=>{for(let n=0;n<limit&&!p();n++)step(s);assert.ok(p(),`Condition missing at tick ${s.tick}`);};
function fresh(){const s=deserialize(raw);until(s,()=>!s.jobs.length);const site=s.sites.surface;return {s,site,t:tileAt(site,target),c:s.crew[0]};}
function impact(f,p=target){f.s.debris.next=f.s.tick+1;f.s.debris.target={x:p.x,y:p.y,z:p.z};step(f.s);return tileAt(f.site,p);}
function mine(s,p=target){const r=executeAction(s,'job.order',{...p,kind:'mine'});assert.equal(r.ok,true,r.message);return s.jobs.find(j=>j.id===r.job);}

// Genuine62 contains native paid upstairs construction and ground ice work in
// flight. The inherited enclosed upper-room fixture is synthetic, not endurance.
test('genuine schema62 migration preserves a paid upper planter and partial ground mining exactly',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'5511a56c1d751bcdf2cb58afafd8b9b1567ed87f6f936a0dcbaefcb180c7b7a2');
 const old=JSON.parse(raw),s=deserialize(raw);assert.equal(old.version,62);old.version=VERSION;assert.deepEqual(s,old);assert.ok(s.jobs.some(j=>j.kind==='mine'&&j.remaining<j.work));valid(s);
});

test('an actual impact deposits finite upper ore, miners preserve the paid fitting, and hauling crosses stairs',()=>{
 const f=fresh(),{s,site,t,c}=f,lower=tileAt(site,{...target,z:0}),lowerHp=lower.hp,ore=totalResources(s).ore,ice=waterSupply(s).unminedIce;startRecording(s);impact(f);
 assert.equal(t.hp,65);assert.equal(lower.hp,lowerHp);assert.deepEqual(t.deposit,{resource:'ore',remaining:3});assert.equal(waterSupply(s).unminedIce,ice);assert.equal(totalResources(s).ore,ore);
 const e=events(s).find(e=>e.id==='deposit.arrived');assert.equal(e.entity,'tile:surface:8:9:1');assert.equal(e.source,'orbital_debris');assert.equal(e.retained+e.loose+e.lost,3);
 const j=mine(s);until(s,()=>!s.jobs.includes(j));assert.equal(t.deposit.remaining,0);assert.equal(t.drop.ore,3);assert.equal(t.building,'planter');assert.equal(t.terrain,'floor');assert.equal(t.hp,65);
 assert.equal(executeAction(s,'crew.labor',{crew:c.id,labor:'hauling',enabled:true}).ok,true);until(s,()=>tileAt(site,{x:8,y:10,z:0}).stock.ore===3);assert.equal(totalResources(s).ore,ore+3);assert.ok(!t.drop?.ore);
 assert.ok(events(s).some(e=>e.id==='resource.extracted'&&e.job===j.id&&e.entity==='tile:surface:8:9:1'&&e.output.ore===3));assert.ok(events(s).some(e=>e.id==='deposit.depleted'&&e.resource==='ore'));valid(s);
});

test('partial upper recovery reloads exactly and manual cancellation leaves the reserve intact',()=>{
 for(const cancel of [false,true]){const f=fresh();impact(f);const j=mine(f.s);until(f.s,()=>j.remaining<j.work);const copy=deserialize(serialize(f.s));assert.equal(serialize(copy),serialize(f.s));
  if(cancel){assert.equal(executeAction(f.s,'job.cancel',{job:j.id}).ok,true);assert.equal(f.t.deposit.remaining,3);assert.equal(f.t.drop?.ore,undefined);valid(f.s);}
  else{for(let n=0;n<30&&f.s.jobs.includes(j);n++){step(f.s);step(copy);}assert.equal(f.t.deposit.remaining,0);assert.equal(serialize(copy),serialize(f.s));valid(f.s);}
 }
});

test('closed stairs refuse upper extraction and player/agent orders use the same floor',()=>{
 const f=fresh();impact(f);const {s,site}=f,link=site.verticalLinks[0];assert.equal(executeAction(s,'vertical.hatch',{site:'surface',connection:link.id,mode:'closed'}).ok,true);let before=serialize(s);
 assert.equal(executeAction(s,'job.order',{...target,kind:'mine'}).ok,false);assert.equal(serialize(s),before);assert.equal(executeAction(s,'vertical.hatch',{site:'surface',connection:link.id,mode:'auto'}).ok,true);
 const copy=deserialize(serialize(s));assert.equal(executeAction(s,'job.order',{...target,kind:'mine'}).ok,true);assert.equal(controlBindings(()=>copy).order(copy,'surface',8,9,'mine',null,1).ok,true);assert.equal(serialize(copy),serialize(s));valid(s);
});

test('an exhausted source cancels stale mining without inventing ore or deleting its underlying structure',()=>{
 const f=fresh();impact(f);const j=mine(f.s),taken=extractTile(f.t);spill(f.t,taken.output);const ore=totalResources(f.s).ore;valid(f.s);step(f.s);
 assert.equal(f.s.jobs.some(k=>k.id===j.id),false);assert.equal(f.t.building,'planter');assert.equal(f.t.deposit.remaining,0);assert.equal(totalResources(f.s).ore,ore);assert.equal(f.t.drop.ore,3);valid(f.s);
});

for(const source of ['rock','ore','ice','salvage','volatile'])test(`declared upper ${source} sources extract only their own finite material`,()=>{
 const f=fresh(),{s,site}=f,p={...target,y:10},t=tileAt(site,p),ground=tileAt(site,{...p,z:0}),groundBefore=structureAndStock(ground);
 // Explicit initial geology/salvage boundary; ordinary upper grids start empty.
 if(['rock','ore'].includes(source))t.terrain=source;else if(source==='ice')t.deposit={resource:'ice',remaining:12};else t.building=source;
 updateRooms(site);valid(s);const expected=extractionStatus(t).output,j=mine(s,p);until(s,()=>!s.jobs.includes(j));for(const [r,n] of Object.entries(expected))assert.equal(t.drop[r],n);
 assert.deepEqual(structureAndStock(ground),groundBefore);if(source==='ice'){assert.equal(t.deposit.remaining,6);assert.equal(t.terrain,'floor');}else if(['rock','ore'].includes(source))assert.equal(t.terrain,'ground');else {assert.equal(t.building,null);assert.equal(t.terrain,'floor');}valid(s);
});

test('ore arriving during construction pauses work without consuming staged supplies or creating a structure',()=>{
 const f=fresh(),{s,site,c}=f,p={...target,y:10},t=tileAt(site,p);const result=executeAction(s,'job.order',{...p,kind:'build',building:'planter'});assert.equal(result.ok,true,result.message);const j=s.jobs.find(j=>j.id===result.job);until(s,()=>j.remaining<j.work);
 const remaining=j.remaining,materials=structuredClone(j.materials),alloy=totalResources(s).alloy,xp=c.skills.construction.xp;impact(f,p);step(s,2);
 assert.ok(s.jobs.includes(j));assert.equal(j.remaining,remaining);assert.deepEqual(j.materials,materials);assert.match(j.blockedReason,/mineral reserve/);assert.equal(c.skills.construction.xp,xp);assert.equal(t.building,null);assert.equal(totalResources(s).alloy,alloy);valid(s);
 assert.equal(executeAction(s,'job.cancel',{job:j.id}).ok,true);const recovery=mine(s,p);until(s,()=>!s.jobs.includes(recovery));assert.equal(t.deposit.remaining,0);assert.equal(t.drop.ore,3);assert.equal(t.drop.alloy,2);assert.equal(t.drop.fertilizer,1);assert.equal(totalResources(s).alloy,alloy);valid(s);
});

test('repeat impacts cap reserves, preserve ice, and account for loose or lost incoming material',()=>{
 const f=fresh();startRecording(f.s);for(let n=0;n<5;n++)impact(f);assert.equal(f.t.deposit.remaining,12);assert.equal(f.t.drop.ore,3);
 const arrival=events(f.s).filter(e=>e.id==='deposit.arrived');assert.equal(arrival.reduce((n,e)=>n+e.retained+e.loose+e.lost,0),5*IMPACT_ORE_AMOUNT);valid(f.s);
 const iceTile={terrain:'floor',building:null,deposit:{resource:'ice',remaining:12}};assert.deepEqual(depositImpactOre(iceTile),{retained:0,loose:3,lost:0});assert.equal(iceTile.deposit.remaining,12);
 const voidTile={terrain:'void',building:null};assert.deepEqual(depositImpactOre(voidTile),{retained:0,loose:0,lost:3});assert.equal(voidTile.deposit,undefined);
});

test('inspection and recording expose source, work, floor and original raw-input cultivation on empty planters',()=>{
 const f=fresh();assert.equal(observe(f.s).entities['tile:surface:8:9:1'].derived.cultivation.fungalcap.planting.ok,true);impact(f);const before=serialize(f.s),entry=observe(f.s).entities['tile:surface:8:9:1'];
 assert.deepEqual(entry.derived.extraction,{source:'deposit',kind:'ore',work:7,output:{ore:3},remaining:3});assert.equal(systemFor('tile',['derived','extraction']),'geology');assert.match(depositDetails(f.t),/IMPACT ORE · FLOOR 1/);assert.match(depositDetails(f.t),/preserves the structure/);assert.equal(serialize(f.s),before);
});

test('new upper orders and impact reserves reject legacy labels, malformed quantities and void ownership',()=>{
 const f=fresh();impact(f);let old=JSON.parse(serialize(f.s));old.version=62;assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy impact ore/);mine(f.s);old=JSON.parse(serialize(f.s));old.version=62;delete tileAt(old.sites.surface,target).deposit;assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy impact ore/);
 for(const mutate of [t=>t.deposit.remaining=-1,t=>t.deposit.remaining=.5,t=>t.deposit.remaining=13,t=>t.deposit.extra=true,t=>t.terrain='void']){const copy=JSON.parse(serialize(f.s));mutate(tileAt(copy.sites.surface,target));assert.throws(()=>deserialize(JSON.stringify(copy)));}
 const covered={terrain:'ore',building:'wall',hp:100};assert.equal(extractionStatus(covered),null);assert.equal(extractTile(covered),null);assert.equal(covered.building,'wall');
});
