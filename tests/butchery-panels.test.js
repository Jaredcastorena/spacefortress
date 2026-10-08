import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, at, pathTo } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { BUTCHERY, initializeAnimalDeaths, registerAnimalDeath, carcassPosition, dispatchEligibility, butcheryEligibility, discardEligibility } from '../src/animal-carcasses.js';
import { animalDetails, animalButcheryDetails, postDetails } from '../src/husbandry-panels.js';
import { FOOD_LIFETIME } from '../src/food-lots.js';
import { totalResources } from '../src/inventory.js';
import { Renderer } from '../src/render.js';

const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(species='bristleback',dead=false) {
  const s=createGame(),site=s.sites.surface,a=s.creatures.find(a=>a.species===species),post=at(site,12,10),source=at(site,13,10);
  post.building='husbandryPost';post.hp=100;post.fire=null;source.terrain='ground';source.building=null;source.fire=null;source.flora={};
  a.site=site.id;a.x=post.x;a.y=post.y;a.husbandry.post=[post.x,post.y];a.husbandry.trust=100;a.lifecycle.enabled=false;
  initializeAnimalDeaths(s);
  if(dead){a.x=source.x;a.y=source.y;assert.equal(registerAnimalDeath(s,a,'unknown'),true);}
  return {s,site,a,post,source};
}
function butcher(f) {
  const result=executeAction(f.s,'husbandry.butcher',{creature:f.a.id,x:f.post.x,y:f.post.y},'test');
  assert.equal(result.ok,true);const job=f.s.jobs.find(j=>j.id===result.job);assert.ok(job);return job;
}
function graphics() {
  const boxes=[],bodies=[],renderer=Object.create(Renderer.prototype);
  const ctx=new Proxy({}, {get(target,key){return target[key]??(key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{});}});
  renderer.ctx=ctx;Object.assign(renderer,{w:1440,h:1000,dpr:1,zoom:1,pan:{x:0,y:0},stars:[],cutaway:true});
  for(const name of ['diamond','hex','polygon','line'])renderer[name]=()=>{};
  renderer.box=(...args)=>boxes.push(args);renderer.carcassSprite=(a,x,y)=>bodies.push({id:a.id,x,y,owner:a.death.owner.kind});
  return {renderer,boxes,bodies,ctx};
}

test('living slaughter remains folded and clearly states permanent death, work and separate processing',()=>{
  const {s,a}=fixture(),before=JSON.stringify(a),html=animalButcheryDetails(s,a);
  assert.match(html,/<details class="animal-butchery"[^>]*><summary>Slaughter for meat/);
  assert.ok(!html.match(/<details[^>]* open/));assert.match(html,/Slaughter permanently kills this animal after 8 Husbandry work/);
  assert.match(html,/4 Bristleback meat/);assert.match(html,/20 Husbandry work · 0.25 waste/);
  assert.match(html,/data-action="animal-dispatch"[^>]*data-simulation-action="husbandry.dispatch"[^>]*>Slaughter for meat · 8 work/);
  assert.ok(!html.match(/data-action="animal-dispatch"[^>]*disabled/));assert.equal(JSON.stringify(a),before);
  assert.equal((animalDetails(s,a,pathTo).match(/class="animal-butchery"/g)||[]).length,1);
});

test('slaughter disabled reasons match shared rules for breeding, brood, juvenile and conflicting work',()=>{
  for(const change of [a=>a.lifecycle.enabled=true,a=>a.lifecycle.brood={id:'brood-test',mate:'bristleback-1',started:0,progress:1},a=>a.lifecycle.growth=1,a=>a.husbandry.trust=0,a=>a.husbandry.post=null]) {
    const {s,a}=fixture();change(a);const eligibility=dispatchEligibility(s,a),html=animalButcheryDetails(s,a);
    assert.equal(eligibility.ok,false);assert.match(html,/data-action="animal-dispatch"[^>]*disabled/);
    assert.ok(html.includes(`data-dispatch-reason="${eligibility.code}"`));assert.ok(html.includes(esc(eligibility.message)));
  }
  const f=fixture();f.a.condition.injury=10;f.a.health=90;
  assert.equal(dispatchEligibility(f.s,f.a).ok,true);
});

test('fresh bodies show frozen species yield, physical location, retained age and explicit processing costs',()=>{
  for(const [species,meat,yieldAmount] of [['bristleback','Bristleback meat',4],['glazefoot','Glazefoot meat',3]]) {
    const {s,a,source,post}=fixture(species,true);a.death.age=152.5;const before=JSON.stringify(a),html=animalButcheryDetails(s,a),eligibility=butcheryEligibility(s,a,post.x,post.y);
    assert.equal(eligibility.ok,true);assert.ok(html.includes(`data-entity="carcass:${a.id}"`));
    assert.ok(html.includes(`On tile surface ${source.x} / ${source.y}`));assert.match(html,/152.5 \/ 3600/);
    assert.ok(html.includes(`${yieldAmount} ${meat}`));assert.match(html,/20 Husbandry work after retrieval and carrying · 0.25 waste/);
    assert.match(html,/pickup and carrying produce no food/);assert.match(html,/data-action="animal-butcher"[^>]*data-simulation-action="husbandry.butcher"/);
    assert.ok(!html.match(/data-action="animal-butcher"[^>]*disabled/));assert.equal(JSON.stringify(a),before);
    assert.ok(!animalDetails(s,a,pathTo).includes('data-action="animal-treat"'));
  }
  const f=fixture();f.a.lifecycle.growth=1;assert.equal(registerAnimalDeath(f.s,f.a,'unknown'),true);
  assert.match(animalButcheryDetails(f.s,f.a),/Edible yield<\/dt><dd>1 Bristleback meat/);
});

test('spoiled bodies reject meat processing and expose the shared finite disposal order',()=>{
  const {s,a,post}=fixture('bristleback',true);a.death.age=FOOD_LIFETIME;a.death.disposition='spoiled';
  const html=animalButcheryDetails(s,a),eligibility=butcheryEligibility(s,a,post.x,post.y),discard=discardEligibility(s,a);
  assert.equal(eligibility.ok,false);assert.equal(discard.ok,true);assert.match(html,/Edible yield<\/dt><dd>0 Bristleback meat/);
  assert.match(html,/data-action="animal-butcher"[^>]*disabled/);assert.ok(html.includes(esc(eligibility.message)));
  assert.match(html,/data-action="animal-discard"[^>]*data-simulation-action="husbandry.discard"[^>]*>Dispose spoiled body · 4 work/);
  assert.match(html,/Disposal leaves 0.25 waste/);
  for(const disposition of ['butchered','discarded','legacy']) {
    a.death.disposition=disposition;a.death.owner=null;a.death.reservedBy=null;
    const terminal=animalButcheryDetails(s,a);assert.match(terminal,/No physical body remains/);assert.ok(!terminal.includes('data-action="animal-butcher"'));
    assert.ok(!terminal.includes('data-action="animal-discard"'));assert.match(terminal,/retained ancestry record has no body or further meat yield/);
  }
});

test('retrieval, carrier and staged phases show actual owner, partial work, escaped blockers and shared cancellation',()=>{
  const f=fixture('bristleback',true),{s,a,post}=f,job=butcher(f),worker=s.crew[0];worker.name='<handler>';job.worker=worker.id;job.blockedReason='<blocked> & waiting';
  for(const [phase,owner,label,location] of [
    ['collect',{kind:'tile',site:'surface',x:a.x,y:a.y},'Retrieving body','On tile surface 13 / 10'],
    ['carry',{kind:'crew',crew:worker.id},'Carrying body to post','Carried by &lt;handler&gt;'],
    ['process',{kind:'job',job:job.id},'Butchering at post','Staged at surface 12 / 10']
  ]) {
    job.phase=phase;a.death.owner=owner;job.remaining=10;const before=JSON.stringify(a),html=animalButcheryDetails(s,a);
    assert.ok(html.includes(`${label} · 50% work · &lt;handler&gt; · &lt;blocked&gt; &amp; waiting`));assert.ok(html.includes(location));
    assert.match(html,/data-action="cancel"[^>]*data-simulation-action="job.cancel">Cancel butchery/);
    assert.match(html,/data-butcher-reason="pending"/);assert.ok(!html.includes('<handler>'));assert.equal(JSON.stringify(a),before);
  }
  assert.match(postDetails(s,post,pathTo),/Reserved for butchery/);assert.ok(!postDetails(s,post,pathTo).includes('data-action="animal-assign"'));
});

test('actual player slaughter, butchery and disposal clicks each use one shared action without immediate food',()=>{
  for(const [action,id,dead,spoiled,kind] of [
    ['animal-dispatch','husbandry.dispatch',false,false,'animalDispatch'],
    ['animal-butcher','husbandry.butcher',true,false,'animalButcher'],
    ['animal-discard','husbandry.discard',true,true,'animalDiscard']
  ]) {
    const {s,a,post}=fixture('bristleback',dead);if(spoiled){a.death.age=FOOD_LIFETIME;a.death.disposition='spoiled';}
    const inspector={},calls=[],results=[],food=totalResources(s).food,health=a.health;
    const source=app.slice(app.indexOf("$('inspector').onclick ="),app.indexOf('let pointer = null;'));
    vm.runInNewContext(source,{$:()=>inspector,state:s,executeAction:(state,actionId,args,origin)=>{calls.push({actionId,args:structuredClone(args),origin});return executeAction(state,actionId,args,origin);},result:r=>results.push(r)});
    inspector.onclick({target:{closest:()=>({dataset:{action,animal:a.id,x:String(post.x),y:String(post.y)}})}});
    assert.equal(calls.length,1);assert.equal(calls[0].actionId,id);assert.equal(calls[0].origin,'player');assert.equal(calls[0].args.creature,a.id);
    if(action==='animal-butcher'){assert.equal(calls[0].args.x,post.x);assert.equal(calls[0].args.y,post.y);}
    assert.equal(results[0].ok,true);assert.equal(s.jobs.filter(j=>j.kind===kind).length,1);assert.equal(totalResources(s).food,food);assert.equal(a.health,health);
  }
});

test('renderer places one physical body at tile, carrier or job location and never draws ancestral copies',()=>{
  const f=fixture('bristleback',true),{s,a,site,source,post}=f,job=butcher(f),worker=s.crew[0];worker.x=14;worker.y=10;
  const oldDocument=globalThis.document;
  try {
    for(const [owner,position] of [
      [{kind:'tile',site:'surface',x:source.x,y:source.y},{x:source.x,y:source.y}],
      [{kind:'crew',crew:worker.id},{x:worker.x,y:worker.y}],
      [{kind:'job',job:job.id},{x:post.x,y:post.y}]
    ]) {
      a.death.owner=owner;const old=structuredClone(a);old.id='retained-ancestor';old.death.disposition='legacy';old.death.owner=null;old.death.reservedBy=null;s.creatures=[a,old];
      const g=graphics();globalThis.document={createElement:()=>({getContext:()=>g.ctx})};const before=JSON.stringify(a);g.renderer.draw(s,site.id,'inspect',null);
      const [x,y]=g.renderer.project(position.x,position.y);assert.deepEqual(g.bodies,[{id:a.id,x,y,owner:owner.kind}]);
      const [oldX,oldY]=g.renderer.project(a.x,a.y);assert.ok(!g.boxes.some(args=>args[0]===oldX&&args[1]===oldY-1&&args[4]===13&&args[5]==='#ab9b71'));
      assert.equal(JSON.stringify(a),before);
    }
    a.death.disposition='butchered';a.death.owner=null;a.death.reservedBy=null;const g=graphics();globalThis.document={createElement:()=>({getContext:()=>g.ctx})};g.renderer.draw(s,site.id,'inspect',null);assert.equal(g.bodies.length,0);
  } finally {if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('inspector body lookup follows physical owner rather than retained animal death coordinates',()=>{
  const f=fixture('bristleback',true),{s,a,post,source}=f,job=butcher(f);a.death.owner={kind:'job',job:job.id};job.phase='process';
  const start=app.indexOf('    const remains='),end=app.indexOf('    const creature =',start),lookup=app.slice(start,end)+'\nhtml=remains;';
  const inspect=t=>{const context={state:s,siteId:'surface',t,carcassPosition,animalButcheryDetails,html:''};vm.runInNewContext(lookup,context);return context.html;};
  assert.equal(inspect(source),'');assert.ok(inspect(post).includes(`data-entity="carcass:${a.id}"`));
  assert.equal((inspect(post).match(/class="animal-butchery"/g)||[]).length,1);
  assert.match(app,/c\.health>0\|\|!isLivestock\(c\)/);
});

test('pests have no slaughter or body controls and corpse art distinguishes species and spoilage',()=>{
  const {s}=fixture(),pest=s.creatures.find(a=>a.species==='tibble');assert.equal(animalButcheryDetails(s,pest),'');
  const shapes=[];
  for(const species of ['bristleback','glazefoot'])for(const disposition of ['fresh','spoiled']) {
    const g=graphics(),calls=[];g.renderer.box=(...args)=>calls.push(args);g.renderer.polygon=(...args)=>calls.push(args);g.renderer.line=(...args)=>calls.push(args);
    const a={species,death:{owner:{kind:'tile'},stage:'adult',disposition}},before=JSON.stringify(a);Renderer.prototype.carcassSprite.call(g.renderer,a,0,0);
    assert.equal(JSON.stringify(a),before);shapes.push(JSON.stringify(calls));
  }
  assert.equal(new Set(shapes).size,4);assert.equal(BUTCHERY.dispatchWork,8);
});
