import {withTemperaturePressureReadings} from './helpers/pressure-migration.js';
import {projectPreRegion} from './helpers/legacy-projection.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {deserialize,serialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {totalResources,syncResources} from '../src/inventory.js';
import {initializeElectrical,refreshPower} from '../src/power.js';
import {damage} from '../src/maintenance.js';
import {gasNode,updateGasNetworks} from '../src/gas-networks.js';
import {waterNode,flowPlumbing} from '../src/plumbing.js';
import {activeUtilityLinks,utilityActive,utilityDetails,RISER_KIND} from '../src/utility-links.js';
import {startRecording,exportRecording,observe} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/utilities-schema56.json.gz',import.meta.url))).toString();
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function parts(s){const site=s.sites.surface,stair=site.verticalLinks[0];return {s,site,stair,c:s.crew[0],lower:tileAt(site,stair.lower),upper:tileAt(site,stair.upper)};}
function until(f,p,limit=120){for(let n=0;n<limit&&!p();n++)step(f.s);assert.ok(p(),`Tick${f.s.tick}: ${f.c.activity}; ${f.s.jobs.map(j=>j.blockedReason).join(', ')}`);}
function order(f,building,kind='build',p=f.stair.lower){const r=executeAction(f.s,'job.order',{site:'surface',...p,kind,building});assert.equal(r.ok,true,r.message);return f.s.jobs.find(j=>j.id===r.job);}
function build(f,building,p=f.stair.lower){const j=order(f,building,'build',p);until(f,()=>!f.s.jobs.includes(j));return f.site.utilityLinks.at(-1);}
function portColony(){
 const f=parts(deserialize(raw));f.c.labors.engineering=true;
 const floor=horizontalNeighbors(f.stair.upper).find(p=>tileAt(f.site,{...p,z:0})?.terrain==='floor');build(f,'floor',floor);
 for(const [building,field] of [['cable','cable'],['gasPipe','pipe'],['waterPipe','waterPipe']])for(const p of [f.stair.lower,f.stair.upper])if(!tileAt(f.site,p)[field])build(f,building,p);
 return serialize(f.s);
}
const ports=portColony(),fixture=()=>parts(deserialize(ports));
const command=(f,link,enabled)=>executeAction(f.s,'utility.configure',{site:'surface',connection:link.id,enabled});
const reload=s=>deserialize(serialize(s));
const records=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('genuine schema56 migration adds empty utility lists, refreshes derived room readings and rejects future riser bytes',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'2dafa2bc4ebc1da00997dbb03f79b6b79a665d69db026675dc3285917fb970d6');
 const before=JSON.parse(raw),s=deserialize(raw);assert.equal(before.version,56);before.version=VERSION;before.resources.tools=0;for(const site of Object.values(before.sites))site.utilityLinks=[];assert.deepEqual(projectPreRegion(s),withTemperaturePressureReadings(before));
 for(const mutate of [s=>s.sites.surface.utilityLinks=[],s=>s.sites.surface.tiles[0].risers={},s=>s.jobs.push({building:'powerRiser'})]){const old=JSON.parse(raw);mutate(old);assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy.*utility/);}
});

for(const [building,kind] of Object.entries(RISER_KIND))test(`paid ${kind} riser claims both ports, preserves their contents and survives reload`,()=>{
 const f=fixture(),before=totalResources(f.s).alloy,copy=reload(f.s);startRecording(f.s);const j=order(f,building);
 const peer=controlBindings(()=>copy).order(copy,'surface',j.x,j.y,'build',building,j.z);assert.equal(peer.ok,true);assert.equal(serialize(f.s),serialize(copy));
 assert.equal(f.site.utilityLinks.length,0);assert.equal(executeAction(f.s,'job.order',{site:'surface',...f.stair.upper,kind:'removeCable'}).ok,false);
 assert.equal(serialize(reload(f.s)),serialize(f.s));until(f,()=>!f.s.jobs.includes(j));const link=f.site.utilityLinks[0];
 assert.equal(link.kind,kind);assert.equal(f.lower.risers[kind],link.id);assert.equal(f.upper.risers[kind],link.id);assert.equal(totalResources(f.s).alloy,before-2);
 assert.equal(gasNode(f.upper).gas.oxygen,0);assert.equal(waterNode(f.upper).water,0);assert.equal(records(f.s).filter(e=>e.id==='utility.constructed').length,1);
 assert.equal(serialize(reload(f.s)),serialize(f.s));assert.match(utilityDetails(f.site,f.upper),/data-simulation-action="utility.configure"/);
});

test('power riser connects an upstairs load; isolation and cable switches separate it without changing stair mode',()=>{
 const f=fixture(),link=build(f,'powerRiser'),p=horizontalNeighbors(f.stair.upper).find(p=>tileAt(f.site,p)?.terrain==='floor'),load=tileAt(f.site,p);
 // A static allocation fixture uses existing paid ports and downstairs solar.
 load.building='holo';initializeElectrical(load);refreshPower(f.s,f.site);assert.equal(load.powered,true);assert.equal(load.circuit,f.lower.circuit);
 assert.equal(executeAction(f.s,'vertical.hatch',{site:'surface',connection:f.stair.id,mode:'closed'}).ok,true);assert.equal(utilityActive(f.site,link),true);
 assert.equal(command(f,link,false).ok,true);assert.equal(load.powered,false);assert.notEqual(load.circuit,f.lower.circuit);assert.equal(f.stair.mode,'closed');
 assert.equal(command(f,link,true).ok,true);assert.equal(load.powered,true);
 assert.equal(executeAction(f.s,'power.cable',{site:'surface',...f.stair.upper,enabled:false}).ok,true);assert.equal(load.powered,false);
});

test('gas riser conserves each species and smoke while obeying isolation and endpoint valves',()=>{
 const f=fixture(),link=build(f,'gasRiser');assert.equal(executeAction(f.s,'vertical.hatch',{site:'surface',connection:f.stair.id,mode:'closed'}).ok,true);
 // Finite seeded parcels isolate transport; no claim of a native filling run.
 Object.assign(f.lower.pipe.gas,{oxygen:1,inert:3,co2:.5});f.lower.pipe.smoke=.2;
 const totals=()=>['oxygen','inert','co2'].map(k=>f.lower.pipe.gas[k]+f.upper.pipe.gas[k]).concat(f.lower.pipe.smoke+f.upper.pipe.smoke),before=totals();startRecording(f.s);
 updateGasNetworks(f.s);assert.ok(f.upper.pipe.gas.oxygen>0);totals().forEach((n,i)=>close(n,before[i]));assert.ok(records(f.s).some(e=>e.id==='gas.transferred'&&e.connection===link.id));
 command(f,link,false);const frozen=JSON.stringify([f.lower.pipe,f.upper.pipe]);updateGasNetworks(f.s);assert.equal(JSON.stringify([f.lower.pipe,f.upper.pipe]),frozen);
 command(f,link,true);executeAction(f.s,'gas.valve',{site:'surface',...f.stair.upper,open:false});const closed=JSON.stringify([f.lower.pipe,f.upper.pipe]);updateGasNetworks(f.s);assert.equal(JSON.stringify([f.lower.pipe,f.upper.pipe]),closed);
});

test('water riser has a finite edge cap in both directions and never becomes floor water',()=>{
 const f=fixture(),link=build(f,'waterRiser');f.lower.waterPipe.water=2;startRecording(f.s);flowPlumbing(f.s);
 close(f.upper.waterPipe.water,.5);close(f.lower.waterPipe.water+f.upper.waterPipe.water,2);assert.equal(f.lower.liquid+f.upper.liquid,0);
 Object.assign(f.lower.waterPipe,{water:0});Object.assign(f.upper.waterPipe,{water:2});flowPlumbing(f.s);close(f.lower.waterPipe.water,.5);close(f.upper.waterPipe.water,1.5);
 assert.ok(records(f.s).some(e=>e.id==='plumbing.transferred'&&e.connection===link.id));command(f,link,false);const before=[f.lower.waterPipe.water,f.upper.waterPipe.water];flowPlumbing(f.s);assert.deepEqual([f.lower.waterPipe.water,f.upper.waterPipe.water],before);
 command(f,link,true);executeAction(f.s,'plumbing.valve',{site:'surface',...f.stair.lower,open:false});flowPlumbing(f.s);assert.deepEqual([f.lower.waterPipe.water,f.upper.waterPipe.water],before);
});

test('shared riser damage and paid repair preserve isolation and upper work custody',()=>{
 const f=fixture(),link=build(f,'powerRiser');command(f,link,false);damage(f.s,f.site,f.lower,'cable',60,'debris');refreshPower(f.s,f.site);
 assert.equal(link.hp,40);assert.equal(command(f,link,true).ok,false);const before=totalResources(f.s).alloy,j=order(f,'powerRiser','repair',f.stair.upper);
 assert.equal(j.utilityConnection,link.id);assert.equal(observe(f.s).entities[j.id].utilityConnection,link.id);assert.equal(serialize(reload(f.s)),serialize(f.s));
 until(f,()=>!f.s.jobs.includes(j));assert.equal(link.hp,100);assert.equal(link.enabled,false);assert.equal(totalResources(f.s).alloy,before-1);assert.equal(command(f,link,true).ok,true);assert.equal(activeUtilityLinks(f.site,'power').length,1);
});

test('dismantling refunds installed metal while retaining pipes and all their contents',()=>{
 const f=fixture(),link=build(f,'waterRiser'),stock=f.site.tiles.find(t=>t.stock?.water>=2);stock.stock.water-=2;f.site.plumbing.loaded+=2;f.lower.waterPipe.water=1;f.upper.waterPipe.water=1;syncResources(f.s);command(f,link,false);
 const before=totalResources(f.s).alloy,nodes=JSON.stringify([f.lower.waterPipe,f.upper.waterPipe]),j=order(f,'waterRiser','remove',f.stair.upper);
 until(f,()=>!f.s.jobs.includes(j));assert.equal(f.site.utilityLinks.length,0);assert.equal(f.lower.risers,undefined);assert.equal(f.upper.risers,undefined);assert.equal(JSON.stringify([f.lower.waterPipe,f.upper.waterPipe]),nodes);assert.equal(totalResources(f.s).alloy,before+1);assert.equal(serialize(reload(f.s)),serialize(f.s));
});

test('cancelled riser construction preserves paid ports and supplies before and during hauling',()=>{
 for(const phase of ['reserved','carried']){const f=fixture(),before=totalResources(f.s).alloy,j=order(f,'gasRiser');if(phase==='carried')until(f,()=>f.c.delivery?.job===j.id);assert.equal(executeAction(f.s,'job.cancel',{job:j.id}).ok,true);assert.equal(f.site.utilityLinks.length,0);assert.equal(f.lower.risers,undefined);assert.equal(totalResources(f.s).alloy,before);assert.equal(serialize(reload(f.s)),serialize(f.s));}
});

test('missing floor/ports reject placement; losing a port during work retains delivered materials',()=>{
 const f=fixture(),before=serialize(f.s);const impossible=executeAction(f.s,'job.order',{site:'surface',...f.stair.upper,kind:'build',building:'gasRiser'});assert.equal(impossible.ok,false);assert.equal(serialize(f.s),before);
 const j=order(f,'gasRiser');until(f,()=>j.remaining<=2);f.upper.pipe=null;step(f.s);step(f.s);assert.ok(f.s.jobs.includes(j));assert.match(j.blockedReason,/pipe/);assert.equal(j.materials.alloy,2);assert.equal(f.site.utilityLinks.length,0);assert.equal(serialize(reload(f.s)),serialize(f.s));
});

test('save validation rejects orphan ports, malformed links, unpaid jobs and cross-endpoint conflicts',()=>{
 const f=fixture();build(f,'powerRiser');const valid=serialize(f.s);
 for(const mutate of [s=>s.sites.surface.utilityLinks[0].upper.z=0,s=>s.sites.surface.utilityLinks[0].enabled='yes',s=>delete tileAt(s.sites.surface,f.stair.upper).risers,s=>s.sites.surface.utilityLinks[0].id='utility-999999',s=>s.sites.surface.tiles[0].risers={power:s.sites.surface.utilityLinks[0].id},s=>tileAt(s.sites.surface,f.stair.upper).building='powerRiser']){const bad=JSON.parse(valid);mutate(bad);assert.throws(()=>deserialize(JSON.stringify(bad)),/utility|riser/i);}
 const pending=fixture(),j=order(pending,'waterRiser');for(const mutate of [s=>s.jobs[0].cost.alloy=0,s=>s.jobs[0].work=99,s=>s.jobs[0].utilityConnection='utility-1',s=>{const other=structuredClone(s.jobs[0]);other.id=`job-${s.nextId++}`;other.z=1;s.jobs.push(other);}]){const bad=JSON.parse(serialize(pending.s));mutate(bad);assert.throws(()=>deserialize(JSON.stringify(bad)),/utility/i);}
});
