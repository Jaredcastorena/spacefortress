import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {makeRegion,planetDefinitions,planetSiteIds,siteDefinition,routeDefinition} from '../src/region.js';
import {regionViewNodes,visibleMissionRoute} from '../src/region-view.js';
import {regionOverview,regionNavigation,siteSurvey} from '../src/region-panels.js';
import {Renderer} from '../src/render.js';
import {routeTime} from '../src/expedition.js';
import {totalResources} from '../src/inventory.js';
import {projectPreRegion} from './helpers/legacy-projection.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/planets-schema67.json.gz',import.meta.url))).toString();
const exact=s=>{const text=serialize(s);assert.equal(serialize(deserialize(text)),text);};

test('genuine six-site schema67 remains byte-equivalent apart from save version, with paid work intact',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'5a0542fa11df9f7b625de34faa6ff8f625b30b8e43153c01c2fa03d637ff5a91');
 const expected=JSON.parse(raw);expected.version=VERSION;const s=deserialize(raw);assert.deepEqual(s,expected);assert.equal(s.region.schema,1);assert.equal(Object.keys(s.sites).length,6);assert.equal(s.jobs[0].material,'composite');exact(s);
 const copy=deserialize(serialize(s));step(s,3);step(copy,3);assert.equal(serialize(s),serialize(copy));
});

test('new planetary generation preserves classic physical state, RNG and inventories while adding finite frontiers',()=>{
 const previous=createGame(74219,{regionSchema:1}),fresh=createGame(74219);assert.equal(fresh.region.schema,2);assert.equal(Object.keys(fresh.region.planets).length,3);assert.equal(Object.keys(fresh.sites).length,8);
 for(const id of ['surface','wreck','comet','solar'])assert.deepEqual(fresh.sites[id],previous.sites[id],id);
 for(const field of ['rng','nextId','nextItemId','crew','creatures'])assert.deepEqual(fresh[field],previous[field],field);
 assert.deepEqual(totalResources(fresh),totalResources(previous));assert.ok(serialize(fresh).length<5_000_000);exact(fresh);exact(previous);
 const home=siteDefinition(fresh,'surface').planetId;
 for(const p of Object.values(planetDefinitions(fresh))){const ids=planetSiteIds(fresh,p.id);assert.equal(ids.length,p.id===home?4:2);assert.ok(ids.includes(p.home));assert.ok(Object.isFrozen(p.map));
  for(const id of ids.filter(id=>id!=='surface')){const route=routeDefinition(fresh,id);assert.equal(route.from,'surface');assert.equal(route.to,id);}
 }
 assert.deepEqual(planetSiteIds(fresh,'constructor'),[]);
});

test('planet memberships, map coordinates, route identity and schema boundaries are strict and never repaired',()=>{
 const s=createGame(),planet=Object.keys(s.region.planets)[1],site=s.region.planets[planet].home;
 const edits=[x=>x.version=67,x=>x.region.schema=3,x=>x.region.legacy=true,x=>x.region.planets[planet].home='surface',x=>x.region.planets[planet].map.x=.01,x=>x.region.sites[site].planetId=x.region.sites.surface.planetId,x=>delete x.region.planets[planet],x=>x.region.planets[planet].extra=[],x=>x.region.routes['route-'+site].from=site,x=>delete x.sites[site]];
 for(const edit of edits){const changed=JSON.parse(serialize(s));edit(changed);const text=JSON.stringify(changed);assert.throws(()=>deserialize(text),/region|site|schema/i);assert.equal(JSON.stringify(changed),text);}
 assert.throws(()=>makeRegion(74219,true,2),/schema/);assert.throws(()=>makeRegion(74219,false,99),/schema/);
});

test('historical projections compare against their matching catalog and reject changed generated worlds',()=>{
 for(const schema of [1,2]){const s=createGame(74219,{regionSchema:schema}),before=serialize(s);const old=projectPreRegion(s,{allowUnvisited:true});assert.equal(Object.keys(old.sites).length,4);assert.equal(old.region,undefined);assert.equal(serialize(s),before);
  const d=Object.values(s.region.sites).find(d=>d.template);s.sites[d.id].tiles.find(t=>t.terrain==='ore').terrain='floor';assert.throws(()=>projectPreRegion(s,{allowUnvisited:true}),/changed generated site/);
 }
});

test('planet hierarchy, grouped drawers and surveys are detached and inspection consumes no state',()=>{
 const s=createGame(),before=serialize(s),planets=Object.keys(s.region.planets),top=regionViewNodes(s);assert.deepEqual(top.map(n=>n.id),planets);assert.ok(top.every(n=>n.type==='planet'));
 for(const id of planets){const nodes=regionViewNodes(s,id),ids=planetSiteIds(s,id);assert.deepEqual(nodes.filter(n=>!n.gateway).map(n=>n.id),ids);assert.equal(nodes[0].id,'surface');assert.ok(nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
  const html=regionOverview(s,id);assert.ok(html.includes(s.region.planets[id].name));for(const site of ids)assert.ok(html.includes(`data-site="${site}"`));
  for(const other of planets.filter(p=>p!==id))for(const site of planetSiteIds(s,other))assert.ok(!html.includes(`data-site="${site}"`));
  const nav=regionNavigation(s,'universe',id,[id]);assert.equal((nav.match(/ open>/g)||[]).length,1);assert.equal((nav.match(/data-planet-group=/g)||[]).length,3);
  nodes[0].x=999;
 }
 assert.match(regionOverview(s),/Known planets \(3\)/);assert.deepEqual(regionViewNodes(s,'stale-planet').map(n=>n.id),planets);
 const frontier=Object.values(s.region.sites).find(d=>d.template);assert.ok(siteSurvey(s,frontier.id).includes(s.region.planets[frontier.planetId].name));assert.equal(serialize(s),before);
 const old=deserialize(raw);assert.equal(regionViewNodes(old,planets[1]).length,1);assert.equal(regionViewNodes(old,Object.keys(old.region.planets)[0]).length,6);
});

test('transit rendering safely follows visible home routes and skips destinations outside the selected planet',()=>{
 // Rendering boundary only; native physical journeys are checked for all four destinations separately.
 const s=createGame(),planets=Object.keys(s.region.planets),destination=s.region.planets[planets[1]].home;
 const drawn=[],noop=()=>{},ctx=new Proxy({createRadialGradient:()=>({addColorStop:noop})},{get:(target,key)=>target[key]??noop});
 const renderer={ctx,w:1000,h:700,regionNodes:Renderer.prototype.regionNodes,structure:noop,hex:noop,polygon:points=>{assert.ok(points.flat().every(Number.isFinite));drawn.push(points);}};
 for(const phase of ['outbound','returning']){s.mission={site:destination,phase,fit:s.shuttle.fit,remaining:routeTime(s,destination)/2};const before=serialize(s);
  for(const selected of [null,...planets]){renderer.planetId=selected;const nodes=renderer.regionNodes(s),visible=visibleMissionRoute(s,nodes);assert.equal(!!visible,selected===null||selected===planets[1]);assert.doesNotThrow(()=>Renderer.prototype.universe.call(renderer,s));}
  assert.equal(serialize(s),before);
 }
 assert.ok(drawn.length>=4);s.mission.phase='working';assert.equal(visibleMissionRoute(s,regionViewNodes(s)),null);
});
