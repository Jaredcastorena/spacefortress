import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, serialize } from '../src/simulation.js';
import { controlBindings } from '../src/controls.js';
import { planetDefinitions } from '../src/region.js';
import { sectorWorld, sectorDefinition, sectorSiteId } from '../src/sector-sites.js';
import { createSectorSite } from '../src/sector-generation.js';
import { surveyedSectorStatus } from '../src/sector-travel.js';
import { planetAtlasData, planetaryAtlas, surveyedSectorDetails } from '../src/satellite-atlas.js';
import { extractTile } from '../src/extraction.js';

const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
function fixture(unlocked=true){
  const s=createGame(74219),planet=Object.values(planetDefinitions(s)).find(p=>p.home==='surface'),world=sectorWorld(s,planet.id),selection={x:(world.landing.x+1)%world.width,y:world.landing.y};
  if(unlocked)s.satellites={[planet.id]:{launchedAt:s.tick,site:'surface',position:{x:16,y:11,z:0}}};
  return {s,planet,world,selection};
}
test('selected-sector travel stays collapsed and exposes exact shared fuel, time and finite first-landing kit',()=>{
  const {s,planet,world,selection}=fixture(),before=serialize(s),status=surveyedSectorStatus(s,planet.id,selection.x,selection.y),html=planetaryAtlas(s,planet.id,selection);
  assert.ok(status.route);assert.deepEqual(status.kit,{alloy:6,components:2});
  assert.match(html,new RegExp(`<details data-panel-key="sector-expedition-${planet.id}-${selection.x}-${selection.y}">`));
  assert.ok(html.includes(`<dt>Round-trip fuel</dt><dd>${status.route.fuel} units</dd>`));
  assert.ok(html.includes(`<dt>Travel per leg</dt><dd>${status.route.travel} ticks</dd>`));
  assert.match(html,/6 alloy · 2 components/);assert.match(html,/First arrival consumes it to deploy an empty dock/);
  assert.match(html,/data-action="sector-launch" data-simulation-action="expedition.surveyed"/);
  assert.match(html,/data-atlas-status="survey"/);assert.doesNotMatch(html,/data-action="inspect-site"/);
  assert.equal((html.match(/tabindex="0"/g)||[]).length,1,'keyboard keeps one selected sector stop');
  assert.equal(surveyedSectorDetails(s,planet.id,world.landing.x,world.landing.y),'','home has no expedition-to-home control');
  assert.equal(serialize(s),before,'viewing a route cannot prepare or reserve anything');
  delete s.satellites;assert.doesNotMatch(planetaryAtlas(s,planet.id,selection),/sector-launch|sector-expedition/);
});
test('prepared sectors remain initial surveys until explored, then use their persisted live resources',()=>{
  const {s,planet,selection}=fixture(),entry={planetId:planet.id,...selection},definition=sectorDefinition(s,entry),generated=createSectorSite(s,definition),id=sectorSiteId(planet.id,selection.x,selection.y);
  s.sectorSites={[id]:entry};s.sites[id]=generated.site;s.creatures.push(...generated.creatures);s.outposts[id]={established:false,residents:[]};
  const prepared=planetAtlasData(s,planet.id,selection),html=planetaryAtlas(s,planet.id,selection);
  assert.equal(prepared.site,id);assert.equal(prepared.prepared,true);assert.equal(prepared.live,false);
  assert.match(html,/data-atlas-status="prepared"/);assert.match(html,/Prepared destination · not yet visited/);
  assert.doesNotMatch(html,/Current ground temperature|data-action="inspect-site"/);
  // This fixture isolates the UI transition; paid arrival is covered by travel integration.
  generated.site.explored=true;
  const before=planetAtlasData(s,planet.id,selection),ore=generated.site.tiles.find(t=>t.terrain==='ore'&&!t.deposit&&!t.building);
  assert.ok(ore);extractTile(ore);
  const after=planetAtlasData(s,planet.id,selection),visited=planetaryAtlas(s,planet.id,selection);
  assert.equal(after.prepared,false);assert.equal(after.live,true);assert.equal(before.survey.resources.ore-after.survey.resources.ore,5);
  assert.match(visited,/data-atlas-status="live"/);assert.ok(visited.includes(`data-site="${id}"`));assert.match(visited,/Current ground temperature/);
});
test('actual selected-sector click uses one shared player command with exact coordinates and preserves rejection state',()=>{
  const {s,planet,selection}=fixture(false),bindings=controlBindings(()=>s),calls=[],results=[],inspector={contains:()=>true},before=serialize(s);
  const source=app.slice(app.indexOf("$('inspector').onclick ="),app.indexOf('let pointer = null;'));
  vm.runInNewContext(source,{$:()=>inspector,deckView:{matches:()=>true},inspectorView:{},state:s,launchSurveyedSector(...args){calls.push(args);return bindings.launchSurveyedSector(...args);},result:r=>results.push(r)});
  inspector.onclick({target:{closest:()=>({dataset:{action:'sector-launch',planet:planet.id,x:String(selection.x),y:String(selection.y)}})}});
  assert.equal(calls.length,1);assert.deepEqual(calls[0],[s,planet.id,selection.x,selection.y]);
  assert.equal(results[0].ok,false,'a stale locked button still passes through shared validation');assert.equal(serialize(s),before);
});
