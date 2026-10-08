import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, at, roomAt, pathTo } from '../src/simulation.js';
import { floraStatus, gatheringEligibility } from '../src/flora.js';
import { floraDetails } from '../src/flora-panels.js';
import { controlBindings } from '../src/controls.js';
import { livestockDef, isLivestock } from '../src/livestock-data.js';
import { SPECIES } from '../src/data.js';
import { Renderer } from '../src/render.js';

const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(species='fungalcap') {
  const s=createGame(),site=s.sites.surface,t=site.tiles.find(t=>t.flora?.[species]?.biomass===100);
  assert.ok(t,`New colony has mature ${species}`);return {s,site,t};
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
  const {s,site,t}=fixture('sunberry');s.tick=250;t.flora.sunberry.biomass=45;t.flora.lichen={biomass:12,harvests:0};
  const html=floraDetails(s,site,t),plant=floraStatus(s,site,t).find(p=>p.species==='sunberry');
  assert.match(html,/Wild sunberry · growing/);assert.ok(html.includes(esc(plant.growthReason)));
  assert.ok(html.includes(esc(gatheringEligibility(s,site,t,'sunberry').message)));
  assert.match(html,/data-action="gather"[^>]*disabled/);assert.match(html,/lichen cannot be gathered for food/);
  assert.equal((html.match(/data-action="gather"/g)||[]).length,1);
  assert.equal(floraDetails(s,site,{...t,flora:{}}),'');
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
  const context={state:s,siteId:site.id,selected:{site:site.id,x:t.x,y:t.y},mode:'inspect',at,roomAt,floraDetails,renderer:{},isLivestock,livestockDef,SPECIES,animalDetails:()=>'<p>Animal care controls</p>',pathTo,esc};
  vm.runInNewContext(source,context);const html=context.inspector();
  assert.match(html,/Animal care controls/);assert.match(html,/WILD FLORA/);assert.match(html,/data-action="gather"/);
  assert.match(app,/activeElement\.closest\?\.\('\[data-recipe-form\]/);
});

test('actual Gather click sends exactly one shared job.order and produces no food at designation',()=>{
  const {s,site,t}=fixture(),inspector={},bindings=controlBindings(()=>s),results=[];let calls=0;
  const source=app.slice(app.indexOf("$('inspector').onclick ="),app.indexOf('let pointer = null;'));
  const before=JSON.stringify(t);
  vm.runInNewContext(source,{$:()=>inspector,state:s,siteId:site.id,selected:{site:site.id,x:t.x,y:t.y},order:(...args)=>{calls++;return bindings.order(...args);},result:r=>results.push(r)});
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
  const empty=graphics();empty.renderer.draw(s,site.id,'inspect',null);
  const lichenMarks=g=>g.commands.filter(c=>c.name==='rect'&&['#98a076','#788765','#a6a778','#748468'].includes(c.fill));
  assert.equal(lichenMarks(empty).length,0);
  t.flora.lichen={biomass:60,harvests:0};const grown=graphics();grown.renderer.draw(s,site.id,'inspect',null);
  assert.equal(lichenMarks(grown).length,3);
  assert.ok(grown.commands.some(c=>c.name==='polygon'&&c.args.includes('#ab98d6')));
});
