import {projectPreRegion} from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {deserialize,serialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {damage as rawDamage,updateDebris} from '../src/maintenance.js';
import {updateRooms} from '../src/atmosphere.js';
const damage=(s,site,...args)=>{rawDamage(s,site,...args);updateRooms(site);};
import {stairAt,stairOpen,stairDestination,STAIR_WORK} from '../src/vertical.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {totalResources} from '../src/inventory.js';
import {startRecording,exportRecording} from '../src/telemetry.js';
import {stairDetails,floorWarnings} from '../src/deck-view.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/stairs-schema55.json.gz',import.meta.url))).toString();
function fixture(){const s=deserialize(raw),site=s.sites.surface,c=s.crew[0],link=site.verticalLinks[0];c.labors.engineering=true;return {s,site,c,link};}
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function order(f,kind,p=f.link.lower,building=null){return executeAction(f.s,'job.order',{site:'surface',...p,kind,building});}
function job(f,kind,p=f.link.lower,building=null){const r=order(f,kind,p,building);assert.equal(r.ok,true,r.message);return f.s.jobs.find(j=>j.id===r.job);}
function until(f,p,limit=100){for(let i=0;i<limit&&!p();i++)step(f.s);assert.ok(p(),`Tick${f.s.tick}: ${f.c.activity}; ${f.s.jobs.map(j=>j.blockedReason).join(', ')}`);}
function build(f,p,building){const j=job(f,'build',p,building);until(f,()=>!f.s.jobs.includes(j));}
const reload=s=>deserialize(serialize(s));

test('genuine schema55 stairs migrate without physical changes and reject future maintenance fields',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'77a7b11c85a21a8e166cb2f761034a010fb3e8145924225e62ca177015ee9cb3');
 const old=JSON.parse(raw),s=deserialize(raw);assert.equal(old.version,55);old.version=VERSION;old.resources.tools=0;for(const site of Object.values(old.sites))site.utilityLinks=[];assert.deepEqual(projectPreRegion(s),old);
 const future=JSON.parse(raw);future.jobs=[{connection:future.sites.surface.verticalLinks[0].id}];assert.throws(()=>deserialize(JSON.stringify(future)),/Legacy.*maintenance/);
});

test('damage at either landing changes one stair condition; paid repair restores routing and records the transition',()=>{
 const f=fixture();startRecording(f.s);damage(f.s,f.site,tileAt(f.site,f.link.upper),'structure',60,'debris');
 assert.equal(stairAt(f.site,f.link.lower),stairAt(f.site,f.link.upper));assert.equal(f.link.hp,40);assert.equal(stairDestination(f.site,f.link.lower,f.link.upper),null);assert.equal(stairOpen(f.site,f.link),true);
 assert.equal(events(f.s).filter(e=>e.id==='vertical.blocked').length,1);assert.match(floorWarnings(f.s,f.site),/Stair route blocked · floor 0/);
 const before=totalResources(f.s).alloy,copy=reload(f.s),j=job(f,'repair');
 assert.equal(j.connection,f.link.id);assert.deepEqual(j.cost,STAIR_WORK.repair.cost);
 const peer=controlBindings(()=>copy).order(copy,'surface',j.x,j.y,'repair',null,j.z);assert.equal(peer.ok,true);assert.equal(serialize(copy),serialize(f.s));
 assert.match(stairDetails(f.site,tileAt(f.site,f.link.upper)),/Repair stairwell/);
 assert.equal(order(f,'repair',f.link.upper).ok,false,'both ends share the reservation');assert.equal(order(f,'build',f.link.upper,'cable').ok,false);
 assert.equal(serialize(reload(f.s)),serialize(f.s));until(f,()=>!f.s.jobs.includes(j));assert.equal(f.link.hp,100);assert.equal(totalResources(f.s).alloy,before-1);
 assert.doesNotMatch(floorWarnings(f.s,f.site),/Stair route blocked/);assert.deepEqual(stairDestination(f.site,f.link.lower,f.link.upper),f.link.upper);assert.equal(events(f.s).filter(e=>e.id==='vertical.repaired').length,1);
 const resumed=reload(f.s);for(let n=0;n<4;n++){step(f.s);step(resumed);}assert.equal(serialize(f.s),serialize(resumed));
});

test('upper repair orders can reserve upstairs supplies and survive reload',()=>{
 const f=fixture(),p=horizontalNeighbors(f.link.upper).find(p=>tileAt(f.site,{...p,z:0})?.terrain==='floor');build(f,p,'floor');
 // Isolate upper material custody with a conserved fixture transfer; this is
 // a save/repair boundary check, not an ordinary colony acceptance run.
 const before=totalResources(f.s).alloy,stock=f.site.tiles.find(t=>t.stock?.alloy>=1);stock.stock.alloy-=1;tileAt(f.site,p).drop={alloy:1};
 damage(f.s,f.site,tileAt(f.site,f.link.lower),'structure',60,'debris');
 const j=job(f,'repair',f.link.upper);assert.ok(j.sources.some(source=>source.z===1));assert.equal(totalResources(f.s).alloy,before);
 assert.equal(serialize(reload(f.s)),serialize(f.s));until(f,()=>!f.s.jobs.includes(j));assert.equal(f.link.hp,100);assert.equal(totalResources(f.s).alloy,before-1);
});

test('different-floor work at the same x/y is not a duplicate save reservation',()=>{
 const f=fixture(),p=horizontalNeighbors(f.link.upper).find(p=>tileAt(f.site,{...p,z:0})?.terrain==='floor');build(f,p,'floor');job(f,'build',f.link.lower,'cable');job(f,'build',f.link.upper,'cable');
 assert.equal(serialize(reload(f.s)),serialize(f.s));
});

test('dismantling from either landing works below, pays for sealing and retains both floors',()=>{
 const f=fixture(),before=totalResources(f.s).alloy;startRecording(f.s);const j=job(f,'remove',f.link.upper);
 assert.deepEqual(positionOf(j),f.link.lower);assert.equal(j.cost.alloy,1);assert.equal(f.site.verticalLinks.length,1);assert.equal(serialize(reload(f.s)),serialize(f.s));
 until(f,()=>!f.s.jobs.includes(j));assert.equal(f.site.verticalLinks.length,0);assert.equal(f.site.levels.length,2);
 for(const p of [f.link.lower,f.link.upper]){assert.equal(tileAt(f.site,p).terrain,'floor');assert.equal(tileAt(f.site,p).verticalLink,undefined);}
 assert.equal(totalResources(f.s).alloy,before-1+3);assert.equal(events(f.s).filter(e=>e.id==='vertical.removed'&&e.sealed).length,1);assert.equal(serialize(reload(f.s)),serialize(f.s));
});

test('occupied and newly stranded upper crew block removal without consuming the delivered seal material',()=>{
 const f=fixture(),j=job(f,'remove'),other=f.s.crew[1],home=positionOf(other),before=totalResources(f.s).alloy;
 until(f,()=>j.remaining<=2);Object.assign(other,f.link.upper);step(f.s);step(f.s);
 assert.ok(f.s.jobs.includes(j));assert.equal(f.link.hp,100);assert.match(j.blockedReason,/Clear both/);assert.equal(j.materials.alloy,1);assert.equal(totalResources(f.s).alloy,before);assert.equal(serialize(reload(f.s)),serialize(f.s));
 const p=horizontalNeighbors(f.link.upper)[0];tileAt(f.site,p).terrain='floor';Object.assign(other,p);step(f.s);
 assert.match(j.blockedReason,/another usable route/);assert.equal(f.site.verticalLinks.length,1);assert.equal(j.materials.alloy,1);
 Object.assign(other,home);until(f,()=>!f.s.jobs.includes(j));assert.equal(f.site.verticalLinks.length,0);
});

test('cancelling paid stair work preserves connection, condition and material custody',()=>{
 for(const kind of ['repair','remove'])for(const phase of ['reserved','carried']){
  const f=fixture();if(kind==='repair')damage(f.s,f.site,tileAt(f.site,f.link.lower),'structure',60,'debris');const hp=f.link.hp,before=totalResources(f.s).alloy,j=job(f,kind);
  if(phase==='carried')until(f,()=>f.c.delivery?.job===j.id);
  assert.equal(executeAction(f.s,'job.cancel',{job:j.id}).ok,true);assert.equal(f.site.verticalLinks.length,1);assert.equal(f.link.hp,hp);assert.equal(totalResources(f.s).alloy,before);assert.equal(serialize(reload(f.s)),serialize(f.s));
 }
});

test('save validation rejects forged targets, work prices and conflicting stair endpoints',()=>{
 const f=fixture();damage(f.s,f.site,tileAt(f.site,f.link.lower),'structure',20,'debris');job(f,'repair');const valid=serialize(f.s);
 for(const mutate of [s=>s.jobs[0].connection='vertical-9999',s=>s.jobs[0].cost.alloy=0,s=>s.jobs[0].work=9,s=>s.jobs[0].building=null,s=>s.jobs[0].kind='build',s=>{const j=structuredClone(s.jobs[0]);j.id=`job-${s.nextId++}`;Object.assign(j,f.link.upper);s.jobs.push(j);},s=>{delete s.jobs[0].connection;}]){
  const broken=JSON.parse(valid);mutate(broken);assert.throws(()=>deserialize(JSON.stringify(broken)),/stairwell/i);
 }
});


test('exposed upper stairs participate in the ordinary debris forecast and shared damage path',()=>{
 const f=fixture();f.s.debris.next=f.s.tick+90;
 // Search the bounded deterministic forecast cycle, without ticking a colony.
 for(let count=0;count<200;count++){
  f.s.debris.count=count;f.s.debris.target=null;updateDebris(f.s);
  if(f.s.debris.target?.z===1)break;
 }
 assert.deepEqual(f.s.debris.target,f.link.upper);const before=f.link.hp;
 f.s.debris.next=f.s.tick;updateDebris(f.s);updateRooms(f.site);
 assert.equal(f.link.hp,before-35);assert.equal(stairAt(f.site,f.link.lower).hp,f.link.hp);
 assert.equal(serialize(reload(f.s)),serialize(f.s));
});

test('an alternate paid stair route allows removal while crew remain upstairs',()=>{
 const f=fixture(),second=horizontalNeighbors(f.link.lower).find(p=>{const t=tileAt(f.site,p);return t?.terrain==='floor'&&!t.building&&!t.drop&&!t.verticalLink;});
 assert.ok(second);build(f,second,'stairwell');const alternate=f.site.verticalLinks.find(link=>link!==f.link);
 // Isolate the graph guard with crew on the alternate landing. Both stair
 // connections and their floors were constructed through paid native jobs.
 const ground=f.site.tiles.find(t=>t.z===0&&t.terrain==='floor'&&!t.verticalLink&&!t.building);
 Object.assign(f.c,positionOf(ground));const upstairs=f.s.crew[1];Object.assign(upstairs,alternate.upper);
 const j=job(f,'remove');until(f,()=>!f.s.jobs.includes(j));
 assert.deepEqual(f.site.verticalLinks.map(link=>link.id),[alternate.id]);assert.equal(upstairs.z,1);
 assert.deepEqual(stairDestination(f.site,alternate.upper,alternate.lower),alternate.lower);assert.equal(serialize(reload(f.s)),serialize(f.s));
});
