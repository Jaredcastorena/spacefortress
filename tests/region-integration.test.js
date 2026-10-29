import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {executeAction,createAgentInterface,actionCatalog} from '../src/controls.js';
import {makeRegion,siteDefinitions,siteDefinition,routeDefinition,outpostSiteIds} from '../src/region.js';
import {regionOverview,siteSurvey} from '../src/region-panels.js';
import {positionOf,horizontalNeighbors,tileAt} from '../src/spatial.js';
import {crewPathToPosition} from '../src/navigation.js';
import {extractionStatus} from '../src/extraction.js';
import {syncResources,totalResources} from '../src/inventory.js';
import {routeFuel} from '../src/expedition.js';
import {observe,startRecording,exportRecording} from '../src/telemetry.js';
const legacy=gunzipSync(readFileSync(new URL('./fixtures/region-schema64.json.gz',import.meta.url))).toString();
const generated=s=>Object.values(siteDefinitions(s)).filter(d=>d.template);
const action=(s,id,args={})=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);return r;};
const check=s=>{syncResources(s);const raw=serialize(s);assert.ok(serialize(deserialize(raw))===raw,'exact region save roundtrip');};
function until(s,label,p,limit=200){for(let n=0;n<limit&&!p();n++)step(s);assert.ok(p(),`${label} stopped at ${s.tick}: ${s.crew.map(c=>c.activity).join('; ')}; ${s.departure?.status||s.mission?.phase||'idle'}`);}
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('genuine schema64 migration keeps four physical sites and all prior state without spawning resources',()=>{
 assert.equal(createHash('sha256').update(legacy).digest('hex'),'75e2645acaea6baa19f61fc75252f840fe80d5cd03ca17af20135ffad98e4c3f');
 const before=JSON.parse(legacy),expected=structuredClone(before);expected.version=65;expected.region=makeRegion(before.seed,true);
 for(const site of Object.values(expected.sites))site.kind=site.id;
 const s=deserialize(legacy);assert.ok(serialize(s)===serialize(expected));assert.equal(Object.keys(s.sites).length,4);assert.deepEqual(totalResources(s),totalResources(before));check(s);
});

test('dynamic commands, observations and compact route panels expose all persistent destinations',()=>{
 const s=createGame(74219),api=createAgentInterface(()=>s),before=serialize(s),catalog=api.actions();
 assert.equal(Object.keys(s.sites).length,6);assert.equal(outpostSiteIds(s).length,3);
 for(const def of generated(s)){
  assert.ok(catalog.find(a=>a.id==='expedition.launch').parameters.properties.site.enum.includes(def.id));
  assert.ok(catalog.find(a=>a.id==='outpost.residents').parameters.properties.site.enum.includes(def.id));
  assert.equal(api.definitions().sites[def.id].planetId,s.region.sites.surface.planetId);
  const view=observe(s);assert.ok(view.entities[`site:${def.id}`]);assert.ok(view.entities.colony.region.routes[routeDefinition(s,def.id).id]);
  assert.match(regionOverview(s),new RegExp(def.id));assert.match(siteSurvey(s,def.id),/Initial orbital survey/);
 }
 assert.equal(serialize(s),before);assert.equal(executeAction(s,'expedition.launch',{site:'unknown-region'}).ok,false);assert.equal(serialize(s),before);check(s);
});

test('generated site metadata, routes and cross-settlement resident aliases reject without repair',()=>{
 const s=createGame(74219),ids=generated(s).map(d=>d.id),good=JSON.parse(serialize(s));
 for(const edit of [x=>delete x.region,x=>x.region.sites[ids[0]].fuel++,x=>x.sites[ids[1]].kind='surface',x=>{x.version=64;}]){
  const bad=structuredClone(good);edit(bad);assert.throws(()=>deserialize(JSON.stringify(bad)));
 }
 const duplicate=structuredClone(good);for(const id of ids){duplicate.outposts[id].established=true;duplicate.outposts[id].residents=['crew-0'];}assert.throws(()=>deserialize(JSON.stringify(duplicate)),/multiple outpost residences/);
});

function travelFixture(template){
 const s=createGame(74219),definition=generated(s).find(d=>d.template===template),ids=['crew-2','crew-4'];
 // Ordinary finite starter stores; only shared labor, routine and machine
 // commands configure the run. No supplies, health or positions are edited.
 for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.machine)action(s,'production.enable',{site:site.id,...positionOf(t),enabled:false});
 for(const c of s.crew){for(const labor of Object.keys(c.labors))action(s,'crew.labor',{crew:c.id,labor,enabled:false});action(s,'crew.routine',{crew:c.id,policy:'work'});if(!ids.includes(c.id))action(s,'crew.labor',{crew:c.id,labor:'hauling',enabled:true});}
 action(s,'crew.labor',{crew:ids[0],labor:'mining',enabled:true});action(s,'crew.labor',{crew:ids[1],labor:'construction',enabled:true});
 return {s,definition,ids,site:s.sites[definition.id]};
}
for(const template of ['outcrop','derelict'])test(`native supplied visit, extraction, construction, return and persistent revisit at generated ${template}`,()=>{
 const {s,definition,ids,site}=travelFixture(template),fuel=totalResources(s).fuel;
 const untouched=generated(s).find(d=>d.id!==definition.id),otherBefore=JSON.stringify(s.sites[untouched.id].tiles.map(t=>({terrain:t.terrain,building:t.building,deposit:t.deposit})));
 startRecording(s,{maxRecords:10000,maxBytes:32_000_000});
 // Idle production, including life support, leaves the finite starter air
 // available to haulers for this bounded route check; no endurance claim.
 action(s,'freight.load',{items:{alloy:1}});until(s,'freight loading',()=>s.shuttle.freight.alloy===1);check(s);
 action(s,'expedition.launch',{site:definition.id,crewIds:ids});until(s,'first arrival',()=>s.mission?.phase==='working');
 assert.equal(s.mission.site,definition.id);assert.ok(ids.every(id=>s.crew.find(c=>c.id===id).site===definition.id));assert.equal(site.explored,true);check(s);
 action(s,'crew.labor',{crew:ids[1],labor:'hauling',enabled:true});action(s,'freight.unload',{site:definition.id,items:{alloy:1}});
 until(s,'freight unloading',()=>!s.shuttle.freight.alloy&&!s.jobs.some(j=>j.kind==='unloadCargo'));
 const miner=s.crew.find(c=>c.id===ids[0]),target=site.tiles.filter(t=>template==='outcrop'?t.terrain==='ore'&&!t.building:t.building==='salvage').map(t=>({t,path:crewPathToPosition(s,site,miner,horizontalNeighbors(t))})).filter(o=>o.path!==null).sort((a,b)=>a.path.length-b.path.length)[0].t;
 const yieldBefore=extractionStatus(target),mining=action(s,'job.order',{site:site.id,...positionOf(target),kind:'mine'});
 until(s,'finite extraction',()=>!s.jobs.some(j=>j.id===mining.job));assert.equal(extractionStatus(target),null);
 until(s,'native cargo pickup',()=>Object.entries(yieldBefore.output).every(([r,n])=>(s.mission.cargo[r]||0)>=n));check(s);
 const building=action(s,'job.order',{site:site.id,...positionOf(target),kind:'build',building:'floor'});
 until(s,'paid remote floor',()=>!s.jobs.some(j=>j.id===building.job));assert.equal(target.terrain,'floor');
 const saved=deserialize(serialize(s));step(s,2);step(saved,2);assert.ok(serialize(saved)===serialize(s),'field continuation');
 action(s,'crew.labor',{crew:ids[1],labor:'hauling',enabled:false});action(s,'expedition.recall');until(s,'paid return',()=>!s.mission);
 assert.ok(Math.abs(totalResources(s).fuel-(fuel-routeFuel(s,definition.id)))<1e-8);assert.equal(target.terrain,'floor');check(s);
 const preserved=JSON.stringify({terrain:target.terrain,building:target.building,deposit:target.deposit});
 action(s,'expedition.launch',{site:definition.id});until(s,'second arrival',()=>s.mission?.phase==='working');
 assert.equal(JSON.stringify({terrain:target.terrain,building:target.building,deposit:target.deposit}),preserved);assert.equal(extractionStatus(target),null);
 assert.equal(JSON.stringify(s.sites[untouched.id].tiles.map(t=>({terrain:t.terrain,building:t.building,deposit:t.deposit}))),otherBefore);
 assert.ok(s.crew.every(c=>c.health>0));check(s);
 const log=events(s);assert.ok(log.some(e=>e.id==='resource.extracted'&&e.entity===`tile:${site.id}:${target.x}:${target.y}`));
 assert.ok(log.some(e=>e.id==='expedition.arrived'&&e.to===`site:${site.id}`&&e.route===routeDefinition(s,site.id).id));
});
