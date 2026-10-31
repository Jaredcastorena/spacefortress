import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {executeAction,controlBindings,createAgentInterface} from '../src/controls.js';
import {sectorWorld,sectorSiteId} from '../src/sector-sites.js';
import {surveyedSectorStatus,SECTOR_SAVE_HEADROOM} from '../src/sector-travel.js';
import {siteDefinition} from '../src/region.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {crewPathToPosition} from '../src/navigation.js';
import {initializeStorage,add,syncResources,totalResources} from '../src/inventory.js';
import {routeFuel} from '../src/expedition.js';
import {MAX_SAVE_BYTES,VERSION} from '../src/data.js';
import {startRecording,stopRecording,exportRecording} from '../src/telemetry.js';

function fixture(unlocked=true){
  const s=createGame(74257),planetId=siteDefinition(s,'surface').planetId,world=sectorWorld(s,planetId);
  // This boundary fixture starts with a survey already unlocked. It does not
  // claim another paid satellite launch; that has its own integration gate.
  if(unlocked)s.satellites={[planetId]:{launchedAt:0,site:'surface',position:{x:16,y:11,z:0}}};
  return {s,args:{planetId,x:(world.landing.x+1)%world.width,y:world.landing.y},world};
}
const act=(s,id,args={})=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);return r;};
const exact=s=>{const raw=serialize(s);assert.ok(serialize(deserialize(raw))===raw,'exact physical save continuation');};
function until(s,predicate,label,cap=240){for(let i=0;i<cap&&!predicate();i++)step(s);assert.ok(predicate(),`${label}: tick${s.tick}, ${s.departure?.status||s.mission?.phase||'idle'}`);}
const eventRows=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('genuine schema76 maps and physical state migrate unchanged; old versions reject sector and off-home wildlife shadows',()=>{
  const raw=gunzipSync(readFileSync(new URL('./fixtures/sector-travel-schema76.json.gz',import.meta.url))).toString();
  assert.equal(createHash('sha256').update(raw).digest('hex'),'906a7a43b49349346c5dbb5a55cbe89176304b3acd9fff47cc5356d47d18f7b3');
  const before=JSON.parse(raw),expected=structuredClone(before);expected.version=VERSION;
  assert.ok(serialize(deserialize(raw))===serialize(expected));
  before.sectorSites={};assert.throws(()=>deserialize(JSON.stringify(before)),/Legacy sector/);delete before.sectorSites;
  before.creatures[0].site='wreck';assert.throws(()=>deserialize(JSON.stringify(before)),/Legacy sector/);
});

test('survey, coordinates, crew and busy gates reject without creating physical destinations',()=>{
  const locked=fixture(false),before=serialize(locked.s);
  assert.equal(executeAction(locked.s,'expedition.surveyed',locked.args).reason,'survey_locked');assert.equal(serialize(locked.s),before);
  const {s,args,world}=fixture(),unchanged=serialize(s);
  assert.equal(surveyedSectorStatus(s,args.planetId,world.landing.x,world.landing.y).code,'home_sector');
  assert.equal(executeAction(s,'expedition.surveyed',{...args,x:24}).ok,false);
  assert.equal(executeAction(s,'expedition.surveyed',{...args,crewIds:['crew-0']}).ok,false);
  assert.equal(serialize(s),unchanged);
  const id=act(s,'expedition.surveyed',args).site,prepared=serialize(s);
  assert.equal(executeAction(s,'expedition.surveyed',{...args,x:(args.x+1)%24}).reason,'expedition_busy');assert.equal(serialize(s),prepared);
  assert.ok(s.sites[id]);exact(s);
});

test('preparation owns one empty destination; cancellation and renewed preparation retain terrain and require the unpaid kit',()=>{
  const {s,args}=fixture(),oldSites=Object.keys(s.sites),rng=s.rng,prior=totalResources(s),id=act(s,'expedition.surveyed',args).site,site=s.sites[id];
  assert.equal(s.rng,rng);assert.deepEqual(Object.keys(s.sites),[...oldSites,id]);assert.equal(site.size,48);assert.equal(site.kind,'surface');
  assert.equal(site.tiles.some(t=>t.building),false);assert.equal(site.power.battery,0);assert.deepEqual(s.outposts[id],{established:false,residents:[]});
  assert.equal(s.departure.target.alloy,6);assert.equal(s.departure.target.components,2);
  for(const key of ['alloy','components','food','fuel','air'])assert.equal(totalResources(s)[key],prior[key],key);
  const terrain=JSON.stringify(site.tiles),animals=JSON.stringify(s.creatures.filter(a=>a.site===id));exact(s);
  act(s,'expedition.cancel_departure');act(s,'expedition.launch',{site:id});
  assert.equal(s.sites[id],site);assert.equal(JSON.stringify(site.tiles),terrain);assert.equal(JSON.stringify(s.creatures.filter(a=>a.site===id)),animals);exact(s);
});

test('player and agent surveyed-sector commands share physical state and named preparation events',()=>{
  const {s,args}=fixture(),twin=deserialize(serialize(s));startRecording(s);startRecording(twin);
  const player=controlBindings(()=>s),agent=createAgentInterface(()=>twin);
  assert.equal(player.launchSurveyedSector(s,args.planetId,args.x,args.y).ok,true);assert.equal(agent.act('expedition.surveyed',args).ok,true);
  assert.ok(serialize(s)===serialize(twin));const id=sectorSiteId(args.planetId,args.x,args.y);
  assert.ok(eventRows(s).some(e=>e.id==='world.sector.prepared'&&e.entity===`site:${id}`));
  assert.ok(agent.actions().find(a=>a.id==='expedition.launch').parameters.properties.site.enum.includes(id));
});

test('actual supplied landing, local construction, paid return and revisit preserve the generated sector',()=>{
  const {s,args}=fixture(),ids=['crew-0','crew-1'],fuel=totalResources(s).fuel;
  // Disable starter production through controls for this bounded route check;
  // finite starter air remains available. This is not an endurance scenario.
  for(const t of s.sites.surface.tiles)if(t.machine)act(s,'production.enable',{site:'surface',...positionOf(t),enabled:false});
  for(const c of s.crew){for(const labor of Object.keys(c.labors))act(s,'crew.labor',{crew:c.id,labor,enabled:false});act(s,'crew.routine',{crew:c.id,policy:'work'});act(s,'crew.labor',{crew:c.id,labor:'hauling',enabled:true});}
  act(s,'crew.labor',{crew:ids[1],labor:'construction',enabled:true});
  act(s,'freight.load',{items:{alloy:1}});until(s,()=>s.shuttle.freight.alloy===1,'freight loading');
  const id=act(s,'expedition.surveyed',{...args,crewIds:ids}).site,site=s.sites[id];exact(s);
  until(s,()=>s.mission?.phase==='outbound'&&s.mission.remaining===1,'paid outbound transit');
  assert.equal(s.mission.kitReserved,true);assert.equal(site.tiles.some(t=>t.building==='dock'),false);exact(s);
  const alloy=s.shuttle.supplies.alloy,components=s.shuttle.supplies.components;startRecording(s);step(s);stopRecording(s);
  assert.equal(s.mission.phase,'working');assert.equal(s.mission.collector,false);assert.equal(s.mission.kitReserved,false);
  assert.equal(s.shuttle.supplies.alloy||0,alloy-6);assert.equal(s.shuttle.supplies.components||0,components-2);
  const dock=site.tiles.find(t=>t.building==='dock');assert.ok(dock);assert.deepEqual(dock.imports,{});
  assert.ok(eventRows(s).some(e=>e.id==='expedition.kit.deployed'&&e.to.slot==='dock'&&e.to.entity===`tile:${id}:${dock.x}:${dock.y}`));
  assert.ok(ids.every(id=>s.crew.find(c=>c.id===id).health>0));exact(s);
  act(s,'freight.unload',{site:id,items:{alloy:1}});until(s,()=>dock.imports.alloy===1&&!s.jobs.some(j=>j.kind==='unloadCargo'),'freight unloading');
  const builder=s.crew.find(c=>c.id===ids[1]),target=site.tiles.filter(t=>t.terrain==='ground'&&!t.building&&!t.deposit&&!t.basin&&!t.flora).map(t=>({t,path:crewPathToPosition(s,site,builder,horizontalNeighbors(t))})).filter(o=>o.path!==null).sort((a,b)=>a.path.length-b.path.length)[0].t;
  const job=act(s,'job.order',{site:id,...positionOf(target),kind:'build',building:'floor'}).job;
  until(s,()=>!s.jobs.some(j=>j.id===job),'paid local floor');assert.equal(target.terrain,'floor');assert.equal(dock.imports.alloy||0,0);exact(s);
  const saved=deserialize(serialize(s));step(s,2);step(saved,2);assert.ok(serialize(s)===serialize(saved),'native remote continuation');
  act(s,'expedition.recall');until(s,()=>s.mission===null,'paid return');assert.equal(totalResources(s).fuel,fuel-routeFuel(s,id));
  const oldSite=site,animalIds=s.creatures.filter(a=>a.site===id).map(a=>a.id);assert.equal(target.terrain,'floor');
  assert.deepEqual(surveyedSectorStatus(s,args.planetId,args.x,args.y).kit,{});
  act(s,'expedition.launch',{site:id});assert.equal(s.departure.target.alloy||0,0);assert.equal(s.departure.target.components||0,0);
  until(s,()=>s.mission?.phase==='working','second arrival');assert.equal(s.sites[id],oldSite);assert.equal(target.terrain,'floor');
  assert.deepEqual(s.creatures.filter(a=>a.site===id).map(a=>a.id),animalIds);assert.ok(s.crew.every(c=>c.health>0));exact(s);
  if(process.env.SPACEFORTRESS_SECTOR_FIXTURE)writeFileSync(process.env.SPACEFORTRESS_SECTOR_FIXTURE,serialize(s));
});

test('remote traps consume only reachable local bait and emit local capture identity',()=>{
  const {s,args}=fixture(),id=act(s,'expedition.surveyed',args).site;act(s,'expedition.cancel_departure');
  const site=s.sites[id],p=siteDefinition(s,id).landing,trap=tileAt(site,p),stock=site.tiles.find(t=>t!==trap&&t.terrain==='ground'&&!t.building&&!t.flora&&!t.deposit&&!t.basin&&Math.abs(t.x-p.x)+Math.abs(t.y-p.y)<=3);
  assert.ok(stock);trap.building='trap';stock.building='stockpile';initializeStorage(stock);add(stock.stock,{food:1});syncResources(s);
  const food=s.resources.food,pest={id:`tibble-${s.nextId++}`,species:'tibble',site:id,...p,health:100,fed:0,age:0};s.creatures.push(pest);
  startRecording(s);step(s,10);stopRecording(s);
  assert.equal(s.creatures.some(a=>a.id===pest.id),false);assert.equal(stock.stock.food,.75);assert.equal(s.resources.food,food);
  assert.ok(eventRows(s).some(e=>e.id==='pest.captured'&&e.target===`tile:${id}:${p.x}:${p.y}`));exact(s);
});
