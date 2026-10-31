import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {sameCell,positionOf} from '../src/spatial.js';
import { createGame, at, roomAt, pathTo } from '../src/simulation.js';
import { floraStatus, gatheringEligibility } from '../src/flora.js';
import { floraDetails } from '../src/flora-panels.js';
import { CULTIVATION } from '../src/flora-data.js';
import { typedFood } from '../src/food-lots.js';
import { add, totalResources } from '../src/inventory.js';
import { jobDetails } from '../src/crew-panels.js';
import { controlBindings } from '../src/controls.js';
import { livestockDef, isLivestock } from '../src/livestock-data.js';
import { SPECIES } from '../src/data.js';
import { Renderer } from '../src/render.js';

const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(species='fungalcap') {
  const s=createGame(),site=s.sites.surface;
  // Inspect an actual ripe patch reachable by the colony, wherever the new world placed it.
  const t=site.tiles.find(t=>t.flora?.[species]?.biomass===100&&gatheringEligibility(s,site,t,species).ok&&s.crew.some(c=>c.site===site.id&&c.health>0&&pathTo(site,c,[[t.x,t.y]])!==null));
  assert.ok(t,`New colony has reachable mature ${species}`);return {s,site,t};
}
function cultivationFixture(species='fungalcap',bed=false) {
  const s=createGame(),site=s.sites.surface,t=at(site,10,15),depot=at(site,8,10);
  t.terrain='ground';t.building=null;t.fire=null;t.flora={lichen:{biomass:12,harvests:0,origin:'native',generation:'native'}};
  if(bed)t.flora[species]={biomass:20,harvests:0,origin:'cultivated',generation:'job-900',moisture:0};
  add(depot.stock,typedFood(species,1));s.crew[3].x=10;s.crew[3].y=14;
  return {s,site,t,depot,species};
}
function graphics() {
  const commands=[],renderer=Object.create(Renderer.prototype);
  const ctx=new Proxy({}, {get(target,key){return target[key]??(key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{});}});
  ctx.fillRect=(...args)=>commands.push({name:'rect',args,fill:ctx.fillStyle});renderer.ctx=ctx;
  Object.assign(renderer,{w:1440,h:1000,dpr:1,zoom:1,pan:{x:0,y:0},stars:[],cutaway:true});
  for(const name of ['box','diamond','hex','polygon','line'])renderer[name]=(...args)=>commands.push({name,args});
  return {renderer,commands};
}

test('mature wild food inspector shows canonical plant identity, food/work and shared Gather action',()=>{
  const {s,site,t}=fixture(),before=JSON.stringify(t),html=floraDetails(s,site,t);
  const plant=floraStatus(s,site,t).find(p=>p.species==='fungalcap');
  assert.match(html,/Wild fungalcap · mature/);assert.ok(html.includes(`data-entity="${plant.id}"`));
  assert.match(html,/2 Fungalcap · 10 Production work/);assert.match(html,/Biomass<\/dt><dd>100 \/ 100/);
  assert.match(html,/data-action="gather"[^>]*data-simulation-action="job.order"[^>]*>Gather/);
  assert.ok(!html.match(/data-action="gather"[^>]*disabled/));
  assert.match(html,/Native regrowth uses no stored water or air/);assert.equal(JSON.stringify(t),before);
});

test('unready patches show shared growth and gathering reasons; lichen has no food action',()=>{
  const {s,site,t}=fixture('sunberry');s.tick=250;t.flora.sunberry.biomass=45;t.flora.lichen={biomass:12,harvests:0,origin:'native',generation:'native'};
  const html=floraDetails(s,site,t),plant=floraStatus(s,site,t).find(p=>p.species==='sunberry');
  assert.match(html,/Wild sunberry · growing/);assert.ok(html.includes(esc(plant.growthReason)));
  assert.ok(html.includes(esc(gatheringEligibility(s,site,t,'sunberry').message)));
  assert.match(html,/data-action="gather"[^>]*disabled/);assert.match(html,/lichen cannot be gathered for food/);
  assert.equal((html.match(/data-action="gather"/g)||[]).length,1);
  assert.match(floraDetails(s,site,{...t,flora:{}}),/Cultivate · ground beds/);
  assert.equal(floraDetails(s,site,{...t,terrain:'rock',flora:{}}),'');
});

test('cultivation choices are folded on suitable ground, use matching raw food and leave flora unchanged',()=>{
  const {s,site,t}=cultivationFixture(),before=JSON.stringify(t),html=floraDetails(s,site,t);
  assert.match(html,/<details data-cultivation data-panel-key="cultivate:surface:10:15">/);
  assert.ok(!html.match(/<details data-cultivation[^>]* open/));
  assert.match(html,/1 raw Fungalcap · 10 Production work/);
  assert.match(html,/1 raw Sunberry · 10 Production work/);
  assert.match(html,/data-action="plant" data-species="fungalcap"[^>]*data-simulation-action="job.order"[^>]*>Plant Fungalcap/);
  assert.match(html,/data-action="plant" data-species="sunberry"[^>]*disabled/);
  assert.match(html,/Needs 1 reachable raw Sunberry\. Prepared meals cannot be planted\./);
  assert.equal(JSON.stringify(t),before);assert.ok(t.flora.lichen);
  for(const change of [t=>t.terrain='floor',t=>t.building='farm',t=>t.fire={id:'test-fire'}]) {
    const f=cultivationFixture();change(f.t);assert.ok(!floraDetails(f.s,f.site,f.t).includes('data-cultivation'));
  }
  const f=fixture();assert.ok(!floraDetails(f.s,f.site,f.t).includes('data-cultivation'));
});

test('cultivated beds show finite watering, moisture, dry or dormant growth and capacity reasons',()=>{
  const {s,site,t}=cultivationFixture('fungalcap',true),before=JSON.stringify(t),html=floraDetails(s,site,t);
  assert.match(html,/Cultivated fungalcap · sparse/);assert.ok(!html.includes('Wild fungalcap'));
  assert.match(html,/Moisture<\/dt><dd>0 \/ 1.5 water/);assert.match(html,/Dry/i);
  assert.match(html,/data-action="waterPlant"[^>]*data-simulation-action="job.order"[^>]*>Water · 0.5 water/);
  assert.match(html,/6 Production work/);assert.ok(!html.match(/data-action="waterPlant"[^>]*disabled/));
  assert.equal(JSON.stringify(t),before);
  t.flora.fungalcap.moisture=CULTIVATION.moistureCapacity;
  const full=floraDetails(s,site,t);assert.match(full,/data-action="waterPlant"[^>]*disabled/);assert.match(full,/capacity|full|saturated/i);
  const berry=cultivationFixture('sunberry',true);berry.s.tick=250;berry.t.flora.sunberry.moisture=.5;
  assert.match(floraDetails(berry.s,berry.site,berry.t),/Dormant/);
});

test('planting and watering show actual partial work, delivery, escaped blockers and shared cancellation',()=>{
  for(const [kind,bed,label] of [['plant',false,'Planting'],['waterPlant',true,'Watering']]) {
    const {s,site,t}=cultivationFixture('fungalcap',bed),result=controlBindings(()=>s).order(s,site.id,t.x,t.y,kind,'fungalcap');
    assert.equal(result.ok,true);const job=s.jobs.find(j=>j.id===result.job);assert.ok(job);
    job.remaining=job.work/2;job.worker=s.crew[3].id;job.blockedReason='<blocked>';s.crew[3].name='<worker>';
    const html=floraDetails(s,site,t);
    assert.ok(html.includes(`${label} · 50% · &lt;worker&gt; · &lt;blocked&gt;`));
    assert.match(html,/Delivered supplies/);assert.match(html,/Awaiting pickup/);assert.match(html,/In transit<\/dt><dd>0 units/);
    assert.match(html,/data-action="cancel"[^>]*data-simulation-action="job.cancel"/);
    assert.match(html,new RegExp(`data-${kind==='plant'?'plant':'water'}-reason="pending"`));
    for(const source of job.sources){add(job.materials,source.items);source.items={};}
    assert.match(floraDetails(s,site,t),/Awaiting pickup<\/dt><dd>0 units/);
    assert.ok(!html.includes('<worker>'));assert.ok(!jobDetails(job).includes('waterPlant'));
  }
});

test('cultivation offers clear supply and reachability reasons through a read-only inspector',()=>{
  const f=cultivationFixture('fungalcap',true);
  for(const tile of f.site.tiles){if(tile.stock)delete tile.stock.water;if(tile.drop)delete tile.drop.water;}
  const before=JSON.stringify(f.t),html=floraDetails(f.s,f.site,f.t);
  assert.match(html,/data-water-reason="supplies"/);assert.match(html,/Needs 0.5 reachable water/);assert.equal(JSON.stringify(f.t),before);
  for(const c of f.s.crew)c.site='transit';
  const unreachable=floraDetails(f.s,f.site,f.t);
  assert.match(unreachable,/data-water-reason="unreachable"/);assert.match(unreachable,/No crew can reach this tile/);
});

test('actual cultivation clicks send one shared job order and wait for delivery and work',()=>{
  for(const [action,bed] of [['plant',false],['waterPlant',true]]) {
    const {s,site,t}=cultivationFixture('fungalcap',bed),inspector={contains:()=>true},bindings=controlBindings(()=>s),results=[];let calls=0;
    const source=app.slice(app.indexOf("$('inspector').onclick ="),app.indexOf('let pointer = null;')),before=JSON.stringify(t),water=totalResources(s).water;
    vm.runInNewContext(source,{$:()=>inspector,deckView:{matches:()=>true},inspectorView:{},state:s,siteId:site.id,selected:{site:site.id,x:t.x,y:t.y},order:(...args)=>{calls++;return bindings.order(...args);},result:r=>results.push(r)});
    inspector.onclick({target:{closest:()=>({dataset:{action,species:'fungalcap'}})}});
    assert.equal(calls,1);assert.equal(results[0].ok,true);assert.equal(s.jobs.filter(j=>j.kind===action).length,1);
    const job=s.jobs.find(j=>j.kind===action);assert.equal(job.plantSpecies,'fungalcap');assert.equal(job.remaining,job.work);
    assert.equal(JSON.stringify(t),before);assert.equal(totalResources(s).water,water);
  }
  assert.match(app,/plant:'job.order',waterPlant:'job.order'/);
  assert.match(app,/!\['operate','gather','plant','waterPlant'\]\.includes\(j.kind\)/);
});

test('pending gathering displays real job progress and cancellation with escaped text',()=>{
  const {s,site,t}=fixture(),bindings=controlBindings(()=>s),r=bindings.order(s,site.id,t.x,t.y,'gather','fungalcap');
  assert.equal(r.ok,true);const j=s.jobs.find(j=>j.id===r.job);assert.ok(j);
  j.remaining=5;j.worker=s.crew[0].id;j.blockedReason='<blocked>';s.crew[0].name='<worker>';
  const html=floraDetails(s,site,t);
  assert.match(html,/Gathering · 50% · &lt;worker&gt; · &lt;blocked&gt;/);
  assert.match(html,/data-gather-reason="pending"/);assert.match(html,/data-action="gather"[^>]*disabled/);
  assert.match(html,/data-action="cancel"[^>]*data-simulation-action="job.cancel"/);assert.ok(!html.includes('<worker>'));
});

test('actual inspector preserves flora information when a livestock animal shares its tile',()=>{
  const {s,site,t}=fixture(),a=s.creatures.find(a=>isLivestock(a));a.site=site.id;a.x=t.x;a.y=t.y;
  const source=app.slice(app.indexOf('function inspector() {'),app.indexOf('function refresh() {'));
  const context={state:s,siteId:site.id,selected:{site:site.id,x:t.x,y:t.y},mode:'inspect',at,sameCell,positionOf,roomAt,floraDetails,renderer:{},isLivestock,livestockDef,SPECIES,animalDetails:()=>'<p>Animal care controls</p>',pathTo,esc};
  vm.runInNewContext(source,context);const html=context.inspector();
  assert.match(html,/Animal care controls/);assert.match(html,/WILD FLORA/);assert.match(html,/data-action="gather"/);
  assert.match(app,/activeElement\.closest\?\.\('[^']*\[data-recipe-form\]/);
});

test('actual Gather click sends exactly one shared job.order and produces no food at designation',()=>{
  const {s,site,t}=fixture(),inspector={contains:()=>true},bindings=controlBindings(()=>s),results=[];let calls=0;
  const source=app.slice(app.indexOf("$('inspector').onclick ="),app.indexOf('let pointer = null;'));
  const before=JSON.stringify(t);
  vm.runInNewContext(source,{$:()=>inspector,deckView:{matches:()=>true},inspectorView:{},state:s,siteId:site.id,selected:{site:site.id,x:t.x,y:t.y},order:(...args)=>{calls++;return bindings.order(...args);},result:r=>results.push(r)});
  inspector.onclick({target:{closest:()=>({dataset:{action:'gather',species:'fungalcap'}})}});
  assert.equal(calls,1);assert.equal(results[0].ok,true);assert.equal(s.jobs.filter(j=>j.kind==='gather').length,1);
  assert.equal(s.jobs.find(j=>j.kind==='gather').plantSpecies,'fungalcap');assert.equal(JSON.stringify(t),before);
});

test('wild plant silhouettes differ by species and show each growth stage without changing state',()=>{
  const art={};
  for(const species of ['fungalcap','sunberry']) {
    art[species]=[];
    for(const biomass of [0,10,45,80,100]) {
      const t={flora:{[species]:{biomass,harvests:0}}},before=JSON.stringify(t),g=graphics();g.renderer.wildFlora(t,0,0);
      assert.ok(g.commands.length>0);assert.equal(JSON.stringify(t),before);art[species].push(g.commands);
    }
    for(let i=1;i<art[species].length;i++)assert.notDeepEqual(art[species][i],art[species][i-1]);
  }
  assert.notDeepEqual(art.fungalcap[4],art.sunberry[4]);
});

test('map lichen rendering uses only canonical biomass while edible plant art stays integrated',()=>{
  const {s,site,t}=fixture();s.crew=[];
  for(const tile of site.tiles)if(tile.flora)delete tile.flora.lichen;
  t.lichen=100;
  // This assertion concerns the selected patch, so keep it inside the culled viewport.
  const empty=graphics();empty.renderer.focus(site,t);empty.renderer.draw(s,site.id,'inspect',null);
  const lichenMarks=g=>g.commands.filter(c=>c.name==='rect'&&['#98a076','#788765','#a6a778','#748468'].includes(c.fill));
  assert.equal(lichenMarks(empty).length,0);
  t.flora.lichen={biomass:60,harvests:0};const grown=graphics();grown.renderer.focus(site,t);grown.renderer.draw(s,site.id,'inspect',null);
  assert.equal(lichenMarks(grown).length,3);
  assert.ok(grown.commands.some(c=>c.name==='polygon'&&c.args.includes('#ab98d6')));
});
