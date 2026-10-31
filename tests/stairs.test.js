import {withTemperaturePressureReadings,withLegacyDensityReadings} from './helpers/pressure-migration.js';
import {projectPreRegion} from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,step,serialize,deserialize} from '../src/simulation.js';
import {VERSION,BUILDINGS} from '../src/data.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {totalResources} from '../src/inventory.js';
import {refreshPower} from '../src/power.js';
import {startRecording,exportRecording} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/stairs-schema54.json.gz',import.meta.url))).toString();
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function fixture(classic=false){
 const fresh=createGame(74219),s=classic?deserialize(JSON.stringify({...withLegacyDensityReadings(projectPreRegion(fresh,{allowUnvisited:true})),version:64})):fresh,site=s.sites.surface;
 for(const c of s.crew){for(const k of Object.keys(c.labors))c.labors[k]=false;c.life.policy='work';}
 const c=s.crew[0];c.labors.construction=true;for(const t of site.tiles)if(t.machine)t.machine.enabled=false;refreshPower(s,site);
 const landing=site.tiles.find(t=>t.terrain==='floor'&&!t.building&&!t.drop&&!t.pipe&&!t.waterPipe);
 return {s,site,c,landing};
}
function build(f,p=f.landing,building='stairwell'){const r=executeAction(f.s,'job.order',{site:'surface',...positionOf(p),kind:'build',building});assert.equal(r.ok,true,r.message);return f.s.jobs.find(j=>j.id===r.job);}
function until(f,p,limit=80){for(let i=0;i<limit&&!p();i++)step(f.s);assert.ok(p(),`Tick ${f.s.tick}: ${f.c.activity}; ${f.s.jobs.map(j=>j.blockedReason).join(', ')}`);}
function completeStairs(classic=false){const f=fixture(classic),job=build(f);until(f,()=>!f.s.jobs.includes(job));assert.equal(f.site.verticalLinks.length,1);return f;}

test('genuine schema54 migration preserves the paid pending order and all physical state',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'d88a01906892db7301d22a511e7316386f2694070322d856cd38292d3fdfb73c');
 const old=JSON.parse(raw),s=deserialize(raw);assert.equal(old.version,54);old.version=VERSION;old.resources.tools=0;for(const site of Object.values(old.sites))site.utilityLinks=[];assert.deepEqual(projectPreRegion(s),withTemperaturePressureReadings(old));assert.equal(serialize(deserialize(serialize(s))),serialize(s));
 for(const mutate of [v=>v.sites.surface.tiles[0].verticalLink='vertical-1',v=>v.jobs[0].building='stairwell']){const v=JSON.parse(raw);mutate(v);assert.throws(()=>deserialize(JSON.stringify(v)),/Legacy.*stairwell/);}
});

test('paid stair completion creates one empty upper grid and landing without free supplies or gas',()=>{
 const f=fixture(),before=totalResources(f.s),copy=structuredClone(f.s);startRecording(f.s);const job=build(f);
 const peer=controlBindings(()=>copy).order(copy,'surface',f.landing.x,f.landing.y,'build','stairwell',0);assert.equal(peer.ok,true);assert.equal(serialize(f.s),serialize(copy));
 assert.equal(f.site.levels.length,1);assert.equal(f.site.verticalLinks.length,0);assert.equal(totalResources(f.s).alloy,before.alloy);assert.equal(serialize(deserialize(serialize(f.s))),serialize(f.s));
 until(f,()=>!f.s.jobs.includes(job));const link=f.site.verticalLinks[0];assert.equal(f.site.levels.length,2);assert.deepEqual(link.lower,positionOf(f.landing));assert.equal(link.upper.z,1);
 const upper=f.site.tiles.filter(t=>t.z===1);assert.equal(upper.length,f.site.size**2);assert.equal(upper.filter(t=>t.terrain==='floor').length,1);
 assert.ok(upper.every(t=>!t.building&&!t.drop&&!t.stock&&!t.machine&&!t.cable&&!t.pipe&&!t.waterPipe&&t.liquid===0&&!t.powered));
 assert.deepEqual(f.site.rooms.filter(r=>r.z===1).map(r=>r.gas),[{oxygen:0,inert:0,co2:0}]);
 for(const [resource,n] of Object.entries(BUILDINGS.stairwell.cost))assert.equal(totalResources(f.s)[resource],before[resource]-n);
 assert.equal(events(f.s).find(e=>e.id==='vertical.constructed').connection,link.id);assert.equal(serialize(deserialize(serialize(f.s))),serialize(f.s));
});

test('an upper floor is paid and built from its reachable landing, then survives deterministic reload',()=>{
 const f=completeStairs(),link=f.site.verticalLinks[0],p=horizontalNeighbors(link.upper).find(p=>tileAt(f.site,{...p,z:0})?.terrain==='floor'),before=totalResources(f.s).alloy;
 assert.ok(p);const j=build(f,p,'floor');assert.ok(j.sources.every(source=>source.z===0));until(f,()=>!f.s.jobs.includes(j));assert.equal(tileAt(f.site,p).terrain,'floor');assert.equal(totalResources(f.s).alloy,before-BUILDINGS.floor.cost.alloy);assert.equal(f.c.z,1);
 const copy=deserialize(serialize(f.s));step(f.s,4);step(copy,4);assert.equal(serialize(f.s),serialize(copy));
});

test('unsupported floors and work on a reserved stair endpoint reject without consuming supplies',()=>{
 const f=completeStairs(),link=f.site.verticalLinks[0];
 const unsupported=f.site.tiles.find(t=>t.z===1&&t.terrain==='void'&&tileAt(f.site,{...positionOf(t),z:0}).terrain==='ground'&&!tileAt(f.site,{...positionOf(t),z:0}).building);
 let before=serialize(f.s);assert.equal(executeAction(f.s,'job.order',{site:'surface',...positionOf(unsupported),kind:'build',building:'floor'}).reason,'unsupported_floor');assert.equal(serialize(f.s),before);
 const lower=horizontalNeighbors(link.lower).map(p=>tileAt(f.site,p)).find(t=>t?.terrain==='floor'&&!t.building&&!t.drop&&!t.verticalLink&&!t.pipe&&!t.waterPipe);assert.ok(lower);const j=build(f,lower);before=serialize(f.s);
 assert.equal(executeAction(f.s,'job.order',{site:'surface',x:lower.x,y:lower.y,z:1,kind:'build',building:'floor'}).reason,'stair_endpoint_reserved');assert.equal(serialize(f.s),before);
 assert.equal(executeAction(f.s,'job.cancel',{job:j.id}).ok,true);
});

test('cancelling a stair before completion creates no upper grid and preserves material custody',()=>{
 for(const carried of [false,true]){const f=fixture(),before=totalResources(f.s),j=build(f);if(carried)until(f,()=>!!f.c.carry,30);
  assert.equal(executeAction(f.s,'job.cancel',{job:j.id}).ok,true);assert.equal(f.site.levels.length,1);assert.equal(f.site.verticalLinks.length,0);assert.equal(totalResources(f.s).alloy,before.alloy);assert.equal(totalResources(f.s).components,before.components);assert.equal(serialize(deserialize(serialize(f.s))),serialize(f.s));
 }
});

test('current saves reject inconsistent decks, links and located references',()=>{
 // Build in a classic catalog before demotion; do not erase evolved sites.
 const f=completeStairs(true),saved=serialize(f.s);
 const changes=[s=>s.sites.surface.levels[1].z=7,s=>s.sites.surface.tiles.pop(),s=>s.sites.surface.tiles.at(-1).z=0,s=>delete tileAt(s.sites.surface,s.sites.surface.verticalLinks[0].upper).verticalLink,s=>s.sites.surface.verticalLinks.push(structuredClone(s.sites.surface.verticalLinks[0])),s=>s.sites.surface.verticalLinks[0].upper.z=2,s=>tileAt(s.sites.surface,s.sites.surface.verticalLinks[0].upper).terrain='void',s=>s.sites.surface.verticalLinks[0].openUntil=s.tick+4,s=>s.nextId=1,s=>s.crew[0].z=2,s=>s.creatures[0].z=2,s=>s.sites.surface.rooms[0].z=2];
 for(const change of changes){const s=JSON.parse(saved);change(s);assert.throws(()=>deserialize(JSON.stringify(s)));}
 const old=withLegacyDensityReadings(projectPreRegion(JSON.parse(saved)));old.version=54;assert.throws(()=>deserialize(JSON.stringify(old)));
});
