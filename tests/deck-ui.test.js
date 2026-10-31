import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,serialize,deserialize} from '../src/simulation.js';
import {executeAction} from '../src/controls.js';
import {refreshPower} from '../src/power.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {createDeckView,stairDetails,floorWarnings} from '../src/deck-view.js';
import {Renderer} from '../src/render.js';
import {damage} from '../src/maintenance.js';
import {updateRooms} from '../src/atmosphere.js';
import {maintenanceOverview} from '../src/maintenance-panels.js';

function colony(){
  const s=createGame(74219),site=s.sites.surface;
  for(const c of s.crew){for(const labor of Object.keys(c.labors))c.labors[labor]=false;c.life.policy='work';}
  s.crew[0].labors.construction=true;
  for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
  refreshPower(s,site);
  function build(p,building){
    const action=executeAction(s,'job.order',{site:site.id,...positionOf(p),kind:'build',building});assert.equal(action.ok,true,action.message);
    for(let n=0;n<100&&s.jobs.some(j=>j.id===action.job);n++)step(s);
    assert.ok(!s.jobs.some(j=>j.id===action.job),`Unfinished ${building}`);
  }
  const landing=site.tiles.find(t=>t.terrain==='floor'&&!t.building&&!t.drop&&!t.pipe&&!t.waterPipe);
  build(landing,'stairwell');const upper=site.verticalLinks[0].upper;
  const supported=horizontalNeighbors(upper).filter(p=>tileAt(site,{...p,z:0})?.terrain==='floor');
  build(supported[0],'floor');build(supported[0],'bunk');
  return {s,site,upper,bunk:supported[0],extension:supported[1]};
}

test('view changes are physical no-ops and invalidate held gestures, including a return to the same floor',()=>{
  const s=createGame(),site=s.sites.surface;site.levels.push({z:1,name:'Upper'});let current=site,changes=0;
  const view=createDeckView(()=>current,()=>changes++),before=serialize(s),press=view.capture();
  assert.equal(view.select(2),false);assert.equal(view.matches(press),true);
  assert.equal(view.step(1),true);assert.equal(view.z,1);assert.equal(view.step(1),false);
  view.select(0);assert.equal(view.matches(press),false);assert.equal(changes,2);assert.equal(serialize(s),before);
  const floor0=view.capture();current=s.sites.wreck;assert.equal(view.matches(floor0),false);view.reset();assert.equal(view.z,0);
});

test('stairs and hazard navigation expose exact floor and connection identities',()=>{
  const f=colony(),link=f.site.verticalLinks[0];
  const html=stairDetails(f.site,tileAt(f.site,f.upper));
  assert.match(html,/data-simulation-action="vertical.hatch"/);assert.match(html,new RegExp(`data-connection="${link.id}"`));
  assert.match(html,/FLOORS 0 ↔ 1/);assert.equal((html.match(/data-hatch-mode=/g)||[]).length,3);
  tileAt(f.site,f.bunk).hp=60;tileAt(f.site,f.bunk).fire={};
  assert.match(maintenanceOverview(f.s),/data-z="1"/);
  assert.match(floorWarnings(f.s,f.site),/data-z="1">Fire · floor 1/);
});

// A small DOM boundary runs app.js itself: real handlers, controls, save load,
// paid construction and inspection. Canvas pixels/layout are covered separately.
function dom(saved){
  const elements=new Map(),frames=[],windowEvents={},documentEvents={};let storage=saved;
  const context=new Proxy({}, {get:(t,k)=>t[k]??(k==='createRadialGradient'?()=>({addColorStop(){}}):()=>{})});
  const element=(id='')=>({id,tagName:'DIV',dataset:{},innerHTML:'',textContent:'',style:{},events:{},open:false,disabled:false,
    classList:{contains:()=>false,add(){},remove(){},toggle(){}},
    addEventListener(name,handler){this.events[name]=handler;},setAttribute(){},getAttribute(){},
    querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,contains(node){return node?.parent===this;},
    focus(){document.activeElement=this;},blur(){document.activeElement=document.body;},
    getBoundingClientRect:()=>({width:1200,height:800}),getContext:()=>context,toDataURL:()=>'',
    setPointerCapture(){},insertAdjacentHTML(_where,html){this.innerHTML+=html;},showModal(){},close(){},click(){}});
  const get=id=>{if(!elements.has(id))elements.set(id,element(id));return elements.get(id);};
  const document={body:element('body'),hidden:false,getElementById:get,createElement:()=>element(),
    querySelector:selector=>selector==='dialog[open]'?null:get(selector),querySelectorAll:()=>[],
    addEventListener:(name,handler)=>documentEvents[name]=handler};document.activeElement=document.body;
  const window={addEventListener:(name,handler)=>windowEvents[name]=handler};
  const globals={document,window,indexedDB:undefined,localStorage:{getItem:()=>storage,setItem:(_key,value)=>storage=value},
    requestAnimationFrame:fn=>frames.push(fn),ResizeObserver:class{observe(){}},devicePixelRatio:1,
    location:{search:'?preview'},setTimeout:()=>0,clearTimeout:()=>{}};
  const old=Object.fromEntries(Object.keys(globals).map(key=>[key,globalThis[key]]));Object.assign(globalThis,globals);
  function node(dataset,parent){const n={...element(),dataset,parent};n.closest=()=>n;return n;}
  return {get,window,document,frames,node,keydown:key=>documentEvents.keydown({key,code:key,preventDefault(){}}),
    save:async()=>{await get('save').onclick();return deserialize(storage);},restore:()=>Object.assign(globalThis,old)};
}

test('actual UI follows floors, routes upper orders/controls and rejects clicks held across a floor change',async()=>{
  const f=colony();damage(f.s,f.site,tileAt(f.site,f.upper),'structure',10,'debris');updateRooms(f.site);const ui=dom(serialize(f.s));
  try{
    await import('../src/app.js');
    const {get,node}=ui,world=get('world'),inspector=get('inspector');
    // Match the app's colony-focused initial view before projecting real clicks.
    const camera=new Renderer(world);camera.center(f.site,f.s.crew.find(c=>c.site===f.site.id&&c.health>0)||f.site.tiles.find(t=>['shuttle','dock'].includes(t.building)));
    const point=p=>{const o=camera.origin(f.site),[x,y]=camera.project(p.x,p.y);return {offsetX:o.x+x*camera.zoom,offsetY:o.y+y*camera.zoom,button:0,pointerId:1};};
    const click=p=>{const e=point(p);world.events.pointerdown(e);world.events.pointerup(e);};
    const choose=z=>get('floor-list').onclick({target:node({floor:String(z)},get('floor-list'))});
    const before=serialize(await ui.save());choose(1);assert.equal(get('floor-label').textContent,'Floor 1');assert.equal(serialize(await ui.save()),before,'viewing does not tick or change the colony');
    click(f.bunk);assert.match(inspector.innerHTML,new RegExp(`TILE ${f.bunk.x} / ${f.bunk.y} / 1`));
    const owner=f.s.crew[1].id,button=node({action:'bunk-owner',owner},inspector);
    inspector.onclick({target:button});let saved=await ui.save();assert.deepEqual(saved.crew.find(c=>c.id===owner).housing.bunk,f.bunk);
    assert.deepEqual(tileAt(saved.sites.surface,{...f.bunk,z:0}),tileAt(f.site,{...f.bunk,z:0}),'ground tile is untouched');
    world.events.pointerdown(point(f.bunk));choose(0);world.events.pointerup(point(f.bunk));assert.doesNotMatch(inspector.innerHTML,/TILE /,'held map click expires');
    inspector.onclick({target:button});assert.deepEqual((await ui.save()).crew.find(c=>c.id===owner).housing.bunk,f.bunk,'stale inspector command does not retarget');
    choose(1);get('build-menu').events.click({target:node({building:'floor'},get('build-menu'))});click(f.extension);
    saved=await ui.save();assert.ok(saved.jobs.some(j=>j.kind==='build'&&j.building==='floor'&&j.z===1&&j.x===f.extension.x&&j.y===f.extension.y));
    ui.keydown('1');choose(0);click({...f.upper,z:0});
    inspector.onclick({target:node({action:'stair-repair'},inspector)});
    const repair=(await ui.save()).jobs.find(j=>j.connection===f.site.verticalLinks[0].id);assert.ok(repair);assert.equal(repair.z,0);
    choose(1);click(f.upper);assert.ok(inspector.innerHTML.includes(repair.id),'opposite landing shows shared work and cancellation');
    inspector.onclick({target:node({action:'cancel',job:repair.id},inspector)});assert.ok(!(await ui.save()).jobs.some(j=>j.id===repair.id));
    choose(0);const upperCrew=saved.crew.find(c=>c.z===1);assert.ok(upperCrew);
    get('crew-list').onclick({target:node({crew:upperCrew.id},get('crew-list'))});assert.equal(get('floor-label').textContent,'Floor 1');
    ui.document.activeElement={tagName:'INPUT'};ui.keydown('PageDown');assert.equal(get('floor-label').textContent,'Floor 1','editing a field blocks floor shortcuts');
    ui.document.activeElement=ui.document.body;ui.keydown('PageDown');assert.equal(get('floor-label').textContent,'Floor 0');
    assert.equal(ui.document.body.dataset.runtimeError,undefined);
  }finally{ui.restore();}
});
