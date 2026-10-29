import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {deserialize,serialize,step} from '../src/simulation.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {roomAt,refreshRoom} from '../src/atmosphere.js';
import {ignite,extinguish,updateFire,combustible} from '../src/fire.js';
import {stairDestination,STAIR} from '../src/vertical.js';
import {LIQUID} from '../src/liquids.js';
import {executeAction} from '../src/controls.js';
import {startRecording,exportRecording,observe,tileEntityId} from '../src/telemetry.js';
import {stairDetails} from '../src/deck-view.js';
import {fireDetails} from '../src/fire-panels.js';

// Existing paid stairs and upper fittings; sealed rooms, wet adjacent fittings
// and mature initial fire are explicit synthetic boundaries, not endurance proof.
const raw=gunzipSync(readFileSync(new URL('./fixtures/extraction-schema62.json.gz',import.meta.url))).toString();
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function wet(site,t){const added=Math.max(0,LIQUID.wet-t.liquid);t.liquid+=added;site.liquids.released+=added;}
function fixture(sourceZ=0){
 const s=deserialize(raw),site=s.sites.surface,link=site.verticalLinks[0];
 const lower=tileAt(site,{x:9,y:7,z:0}),upper=tileAt(site,{x:8,y:8,z:1});
 const source=sourceZ===0?lower:upper,target=sourceZ===0?upper:lower;
 link.mode='open';site.fireSafety.automatic=false;
 for(const p of horizontalNeighbors(source)){const t=tileAt(site,p);if(combustible(t))wet(site,t);}
 assert.ok(ignite(s,site,source));source.fire.started=s.tick-29;source.fire.age=29;source.fire.intensity=60;
 return {s,site,link,source,target};
}
function burn(f){startRecording(f.s);updateFire(f.s);return events(f.s);}

for(const z of [0,1])test(`open stairs spread fire from floor ${z} with source and connection identity`,()=>{
 const f=fixture(z),r=roomAt(f.site,f.target.x,f.target.y,f.target.z),before={gas:{...r.gas},heat:r.heat,smoke:r.smoke};
 const records=burn(f),ignitions=records.filter(e=>e.id==='fire.ignited');
 assert.equal(ignitions.length,1);assert.equal(f.target.fire.age,0);
 assert.equal(ignitions[0].cause,'stair_spread');assert.equal(ignitions[0].parent,f.source.fire.id);
 assert.equal(ignitions[0].connection,f.link.id);assert.equal(ignitions[0].target,tileEntityId('surface',f.target.x,f.target.y,f.target.z));
 assert.deepEqual({gas:r.gas,heat:r.heat,smoke:r.smoke},before,'new flame burns on the next tick');
 const burned=f.site.fireSafety.oxygenBurned;f.s.tick++;updateFire(f.s);
 assert.equal(f.target.fire.age,1);assert.ok(f.site.fireSafety.oxygenBurned>burned);
 near(Object.values(r.gas).reduce((a,b)=>a+b,0),Object.values(before.gas).reduce((a,b)=>a+b,0));
 assert.ok(r.heat>before.heat);assert.ok(r.smoke>before.smoke);
});

test('intact closed and expired auto hatches contain flames; currently open auto hatches admit them',()=>{
 for(const [mode,remaining,expected] of [['closed',100,false],['auto',0,false],['auto',-1,false],['auto',1,true]]){
  const f=fixture();f.link.mode=mode;f.link.openUntil=f.site.atmosphere.tick+remaining;burn(f);
  assert.equal(!!f.target.fire,expected,`${mode}/${remaining}`);
 }
});

test('broken hatches transmit flames even when their stairs cannot carry crew',()=>{
 for(const [hp,expected] of [[STAIR.minimumCondition-1,true],[STAIR.minimumCondition,false]]){
  const f=fixture();f.link.mode='closed';f.link.hp=hp;
  assert.equal(stairDestination(f.site,f.link.lower,f.link.upper),null);burn(f);
  assert.equal(!!f.target.fire,expected,`condition ${hp}`);
 }
});

test('stacked floors without a commissioned connection cannot spread flames across the ceiling',()=>{
 const f=fixture();for(const p of [f.link.lower,f.link.upper])delete tileAt(f.site,p).verticalLink;
 f.site.verticalLinks=[];burn(f);assert.equal(f.target.fire,undefined);
});

test('vertical ignition still requires dry fuel and enough oxygen on the destination floor',()=>{
 for(const condition of ['wet','destroyed','oxygen']){
  const f=fixture();
  if(condition==='wet')wet(f.site,f.target);
  if(condition==='destroyed')f.target.hp=0;
  if(condition==='oxygen'){const r=roomAt(f.site,f.target.x,f.target.y,f.target.z);r.gas.inert+=r.gas.oxygen;r.gas.oxygen=0;refreshRoom(r);}
  burn(f);assert.equal(f.target.fire,undefined,condition);
 }
});

test('flames cannot skip a landing neighbor to reach distant fittings in the other room',()=>{
 const f=fixture(),far=tileAt(f.site,{x:8,y:9,z:1});assert.equal(far.building,'planter');
 wet(f.site,f.target);burn(f);assert.equal(far.fire,undefined);assert.equal(f.target.fire,undefined);
});

test('horizontal spread retains priority and a source creates at most one fire per interval',()=>{
 const f=fixture(),next=tileAt(f.site,{x:10,y:7,z:0});
 f.site.liquids.released-=next.liquid;next.liquid=0;
 const records=burn(f),ignitions=records.filter(e=>e.id==='fire.ignited');
 assert.equal(ignitions.length,1);assert.equal(ignitions[0].cause,'spread');
 assert.equal(ignitions[0].connection,undefined);assert.ok(next.fire);assert.equal(f.target.fire,undefined);
});

test('closing a hatch through the shared action blocks spread and preserves the source fire',()=>{
 const f=fixture();const result=executeAction(f.s,'vertical.hatch',{site:'surface',connection:f.link.id,mode:'closed'});
 assert.equal(result.ok,true,result.message);burn(f);assert.ok(f.source.fire);assert.equal(f.target.fire,undefined);
 assert.match(stairDetails(f.site,tileAt(f.site,f.link.lower)),/fire spread between nearby fittings/);
 assert.match(fireDetails(f.s,f.site,f.source),/close intact stair hatches/);
});

test('cross-floor ignition preserves save continuation, observation purity and existing suppression orders',()=>{
 const f=fixture();burn(f);
 const saved=serialize(f.s),copy=deserialize(saved);assert.equal(serialize(copy),saved);
 const before=serialize(copy),observation=observe(copy);
 assert.equal(serialize(copy),before);assert.ok(observation.entities[tileEntityId('surface',f.target.x,f.target.y,f.target.z)].fire);
 const result=executeAction(f.s,'job.order',{site:'surface',...positionOf(f.target),kind:'extinguish'});
 assert.equal(result.ok,true,result.message);
 const job=f.s.jobs.find(j=>j.id===result.job);assert.equal(job.z,f.target.z);assert.equal(job.fire,f.target.fire.id);assert.deepEqual(job.cost,{water:2});
 const continuation=deserialize(serialize(f.s));step(f.s,3);step(continuation,3);
 assert.equal(serialize(continuation),serialize(f.s));
});


test('a distant source cannot reach the stair opening through an otherwise shared room',()=>{
 const f=fixture(),far=tileAt(f.site,{x:10,y:7,z:0});
 extinguish(f.s,f.site,f.source,'suppressed');f.site.liquids.released-=far.liquid;far.liquid=0;
 for(const p of horizontalNeighbors(far)){const t=tileAt(f.site,p);if(combustible(t))wet(f.site,t);}
 assert.ok(ignite(f.s,f.site,far));far.fire.started=f.s.tick-29;far.fire.age=29;far.fire.intensity=60;
 burn(f);assert.equal(f.target.fire,undefined);
});

test('a wet destination fitting does not hide another dry fitting beside the same landing',()=>{
 const f=fixture(1),other=tileAt(f.site,{x:7,y:7,z:0});assert.equal(other.building,'scrubber');
 wet(f.site,f.target);const records=burn(f);
 assert.equal(f.target.fire,undefined);assert.ok(other.fire);assert.equal(records.filter(e=>e.id==='fire.ignited').length,1);
});
