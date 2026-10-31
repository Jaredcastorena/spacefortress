import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { planetDefinitions } from '../src/region.js';
import { planetAtlasData, planetaryAtlas, satelliteLaunchDetails } from '../src/satellite-atlas.js';
import { surfaceSurvey } from '../src/world-generation.js';
import { extractTile } from '../src/extraction.js';
import { Renderer,projectedBounds,projectTile } from '../src/render.js';

const fixture=()=>{const s=createGame(74219),planet=Object.values(planetDefinitions(s)).find(p=>p.home==='surface');return {s,planet};};
const unlock=(s,planet)=>{s.satellites={[planet.id]:{launchedAt:s.tick,site:'surface',position:{x:16,y:11,z:0}}};};
test('planetary atlas hides generated sectors until completed launch, including pending assembly',()=>{
  const {s,planet}=fixture(),before=s.rng;
  assert.deepEqual(planetAtlasData(s,planet.id),{planetId:planet.id,unlocked:false,launchedAt:null,site:null,position:null,available:false});
  const locked=planetaryAtlas(s,planet.id);
  assert.doesNotMatch(locked,/<svg|data-action="atlas-sector"/);
  assert.match(locked,/data-simulation-action="satellite.launch"/);
  assert.match(locked,/6 alloy · 2 components · 1 cells · 2 fuel/);
  s.jobs.push({id:'pending-satellite',kind:'launchSatellite',site:'surface',x:16,y:11,z:0});
  const pending=planetaryAtlas(s,planet.id);
  assert.doesNotMatch(pending,/<svg/);assert.match(pending,/disabled/);assert.equal(s.rng,before);
});
test('unvisited sectors use the physical generator and remain detached survey-only previews',()=>{
  const {s,planet}=fixture();unlock(s,planet);
  const selected={x:(planet.world.landing.x+1)%planet.world.width,y:planet.world.landing.y},before=JSON.stringify(s);
  const atlas=planetAtlasData(s,planet.id,selected);
  assert.equal(atlas.sectors.length,planet.world.width*planet.world.height);
  assert.deepEqual(atlas.survey,surfaceSurvey(planet.world,selected));
  assert.equal(atlas.live,false);assert.equal(atlas.site,null);
  atlas.survey.resources.ore=999999;
  assert.notEqual(planetAtlasData(s,planet.id,selected).survey.resources.ore,999999);
  const html=planetaryAtlas(s,planet.id,selected);
  assert.match(html,/initial survey only/);assert.match(html,/no colony or travel route exists here/);
  assert.doesNotMatch(html,/data-action="inspect-site"/);
  assert.equal((html.match(/data-action="atlas-sector"/g)||[]).length,288);
  assert.equal(JSON.stringify(s),before);
});
test('known landing survey reads depletion, liquid changes and living patches from actual tiles',()=>{
  const {s,planet}=fixture();unlock(s,planet);
  const site=s.sites.surface,initial=planetAtlasData(s,planet.id);
  assert.equal(initial.live,true);assert.equal(initial.site,'surface');assert.equal(initial.survey.size,48);
  const ore=site.tiles.find(t=>!t.building&&t.terrain==='ore'&&!t.deposit);
  const water=site.tiles.find(t=>t.liquid>0),waterBefore=water.liquid;
  const plant=site.tiles.find(t=>Object.values(t.flora||{}).some(p=>p.biomass>0)),species=Object.keys(plant.flora).find(id=>plant.flora[id].biomass>0),animal=s.creatures.find(a=>a.site==='surface'&&a.health>0);
  extractTile(ore);water.liquid=0;plant.flora[species].biomass=0;animal.health=0;
  const next=planetAtlasData(s,planet.id);
  assert.equal(initial.survey.resources.ore-next.survey.resources.ore,5);
  assert.equal(initial.survey.flora[species]-(next.survey.flora[species]||0),1);
  assert.equal(initial.survey.wildlife[animal.species]-(next.survey.wildlife[animal.species]||0),1);
  assert.ok(Math.abs(initial.survey.resources.water-next.survey.resources.water-waterBefore)<1e-7);
  assert.match(planetaryAtlas(s,planet.id),/data-action="inspect-site"[^>]*data-site="surface"/);
  assert.match(planetaryAtlas(s,planet.id),/Current ground temperature/);
});
test('legacy colonies gain a deterministic orbital atlas while keeping physical maps unchanged',()=>{
  for(const regionSchema of [1,2]){
    const s=createGame(74219,{regionSchema}),planet=Object.values(planetDefinitions(s)).find(p=>p.home==='surface');unlock(s,planet);
    const before=JSON.stringify(s),atlas=planetAtlasData(s,planet.id);
    assert.equal(atlas.available,true);assert.equal(atlas.legacy,true);assert.equal(atlas.sectors.length,288);
    assert.equal(atlas.live,true);assert.equal(atlas.survey.size,26);
    const other={x:0,y:0};assert.equal(planetAtlasData(s,planet.id,other).live,false);
    assert.deepEqual(planetAtlasData(s,planet.id,other),planetAtlasData(structuredClone(s),planet.id,other));
    assert.match(planetaryAtlas(s,planet.id),/preserves your existing colony map/);
    const tile=s.sites.surface.tiles.find(t=>t.building==='shuttle');
    assert.doesNotMatch(satelliteLaunchDetails(s,s.sites.surface,tile),/data-action="satellite-launch"/);
    assert.equal(JSON.stringify(s),before);
  }
});

function camera(width=1000,height=700){const r=Object.create(Renderer.prototype);Object.assign(r,{w:width,h:height,zoom:1,pan:{x:0,y:0}});return r;}
test('large-map camera focuses on the colony, zooms at the cursor and reveals the whole terrain at minimum',()=>{
  const r=camera(),site={size:48},focus={x:12,y:11};r.center(site,focus);
  const [fx,fy]=projectTile(focus.x,focus.y),origin=r.origin(site);
  assert.ok(Math.abs(origin.x+fx*r.zoom-r.w/2)<1e-8);assert.ok(Math.abs(origin.y+fy*r.zoom-r.h/2)<1e-8);
  const px=310,py=350,world=[(px-origin.x)/r.zoom,(py-origin.y)/r.zoom];r.zoomAt(site,1.5,px,py);
  const next=r.origin(site);assert.ok(Math.abs(next.x+world[0]*r.zoom-px)<1e-8);assert.ok(Math.abs(next.y+world[1]*r.zoom-py)<1e-8);
  r.zoomAt(site,.001);assert.deepEqual(r.pan,{x:0,y:0});assert.ok(r.zoom<.35);
  const bounds=projectedBounds(site.size),fit=r.origin(site);
  assert.ok(fit.x+bounds.left*r.zoom>=0&&fit.x+bounds.right*r.zoom<=r.w);
  assert.ok(fit.y+bounds.top*r.zoom>=0&&fit.y+bounds.bottom*r.zoom<=r.h);
});
test('rendering culls offscreen terrain and draws every terrain tile at the fitted overview',()=>{
  const {s}=fixture(),site=s.sites.surface,r=camera(),drawn=[];
  s.crew=[];s.creatures=[];
  Object.assign(r,{dpr:1,stars:[],cutaway:true,ctx:new Proxy({},{get:(target,key)=>target[key]??(key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{})})});
  r.hexPrism=(x,y)=>drawn.push([x,y]);r.structure=()=>{};r.wildFlora=()=>{};
  r.center(site,{x:12,y:11});r.draw(s,'surface','inspect',null);
  const count=site.tiles.filter(t=>t.terrain!=='void').length;
  assert.ok(drawn.length>0&&drawn.length<count/2);
  r.zoomAt(site,.001);drawn.length=0;r.draw(s,'surface','inspect',null);
  assert.equal(drawn.length,count);
});
