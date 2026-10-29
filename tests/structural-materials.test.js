import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {MATERIALS} from '../src/material-data.js';
import {TOOL_MATERIALS} from '../src/tool-data.js';
import {constructionSpec,materialId,materialStatus,installMaterial,clearMaterial,dismantleRefund} from '../src/materials.js';
import {executeAction,controlBindings,createAgentInterface} from '../src/controls.js';
import {materialChoice,materialDetails} from '../src/material-panels.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {totalResources,syncResources} from '../src/inventory.js';
import {damage} from '../src/maintenance.js';
import {observe,startRecording,exportRecording} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/materials-schema65.json.gz',import.meta.url))).toString();
const act=(s,id,args={})=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);return r;};
const valid=s=>{syncResources(s);const text=serialize(s);assert.equal(serialize(deserialize(text)),text);};
const until=(s,p,limit=100)=>{for(let i=0;i<limit&&!p();i++)step(s);assert.ok(p(),`Stopped at ${s.tick}: ${s.crew[0].activity}`);};
function staffed(s=createGame()) {
  for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.machine)act(s,'production.enable',{site:site.id,...positionOf(t),enabled:false});
  for(const c of s.crew){for(const labor of Object.keys(c.labors))act(s,'crew.labor',{crew:c.id,labor,enabled:false});act(s,'crew.routine',{crew:c.id,policy:'work'});}
  act(s,'crew.labor',{crew:'crew-0',labor:'construction',enabled:true});
  act(s,'crew.labor',{crew:'crew-0',labor:'engineering',enabled:true});
  for(const c of s.crew.slice(1,4))act(s,'crew.labor',{crew:c.id,labor:'hauling',enabled:true});
  return s;
}
const order=(s,p,kind,building,material)=>act(s,'job.order',{site:'surface',...p,kind,...(building?{building}:{}),...(material?{material}:{})});
const finish=(s,r)=>until(s,()=>!s.jobs.some(j=>j.id===r.job));

test('shared material vocabulary retains tool behavior and computes detached paid structure specifications',()=>{
 assert.deepEqual(TOOL_MATERIALS,{alloy:{name:'Alloy',speed:1.25,wear:1},composite:{name:'Composite',speed:1.5,wear:.5}});
 assert.ok(Object.isFrozen(MATERIALS.composite.structure.extraCost));
 for(const [building,alloy,work] of [['floor',1,3],['wall',2,5],['door',3,5]]){
  assert.deepEqual(constructionSpec(building),{cost:{alloy},work,material:'alloy'});
  const spec=constructionSpec(building,'composite');assert.deepEqual(spec.cost,{alloy,components:1});assert.equal(spec.work,Math.ceil(work*1.5));spec.cost.components=99;
  assert.equal(constructionSpec(building,'composite').cost.components,1);
 }
 assert.throws(()=>constructionSpec('reactor','composite'));assert.throws(()=>constructionSpec('wall','__proto__'));
});

test('genuine65 migration changes only version and retains pending paid work, terrain and inventories',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'4c9abd7ea43f85b38c68f7987489e54bfb3f6f95f7ab9283612a038dbdf27c16');
 const expected=JSON.parse(raw);assert.equal(expected.version,65);expected.version=VERSION;
 const s=deserialize(raw);assert.equal(serialize(s),serialize(expected));valid(s);
 const copy=deserialize(serialize(s));step(s,3);step(copy,3);assert.equal(serialize(copy),serialize(s));
});

test('floor and structure material owners remain independent with detached inspection',()=>{
 const tile={terrain:'floor',building:'wall'};assert.equal(materialId(tile,'floor'),'alloy');
 installMaterial(tile,'floor','composite');installMaterial(tile,'structure','alloy');
 const view=materialStatus(tile);view.floor.id='invented';assert.equal(materialId(tile,'floor'),'composite');
 clearMaterial(tile,'structure');tile.building=null;assert.deepEqual(tile.materials,{floor:'composite'});
 assert.match(materialDetails(tile),/Composite/);assert.match(materialChoice(),/building-material/);
 assert.deepEqual(dismantleRefund({building:'wall',materials:{structure:'composite'}}),{alloy:1,components:0});
});

test('player positional z and agent material arguments select the same paid job and reject incompatible choices without mutation',()=>{
 const a=createGame(),b=createGame(),p={x:5,y:6,z:0};
 act(a,'job.order',{site:'surface',...p,kind:'build',building:'wall',material:'composite'});
 const binding=controlBindings(()=>b);assert.equal(binding.order(b,'surface',p.x,p.y,'build','wall',0,'composite').ok,true);
 assert.equal(serialize(a),serialize(b));assert.equal(a.jobs[0].z,0);assert.equal(a.jobs[0].material,'composite');
 const api=createAgentInterface(()=>a);assert.equal(api.definitions().materials.composite.structure.conductivity,.25);
 assert.deepEqual(Object.keys(api.actions().find(x=>x.id==='job.order').parameters.properties),['site','x','y','kind','building','z','material']);
 for(const args of [{kind:'build',building:'wall',material:'unknown'},{kind:'build',building:'reactor',material:'composite'},{kind:'repair',material:'alloy'}]){
  const before=serialize(a);assert.equal(executeAction(a,'job.order',{site:'surface',x:5,y:7,...args}).ok,false);assert.equal(serialize(a),before);
 }
 valid(a);
});

test('cancelled composite construction returns every reserved material and installs nothing',()=>{
 const s=createGame(),before=totalResources(s),p={x:5,y:6,z:0},r=order(s,p,'build','wall','composite');
 assert.deepEqual(s.jobs[0].cost,{alloy:2,components:1});act(s,'job.cancel',{job:r.job});
 assert.deepEqual(totalResources(s),before);assert.equal(tileAt(s.sites.surface,p).materials,undefined);valid(s);
});

test('native paid floor, wall, repair and dismantling preserve slab ownership and exact supplies',()=>{
 const s=staffed(),p={x:5,y:6,z:0},tile=tileAt(s.sites.surface,p),before=totalResources(s);
 startRecording(s,{maxRecords:12000,maxBytes:32_000_000});
 for(const building of ['floor','wall']){const job=order(s,p,'build',building,'composite');valid(s);finish(s,job);valid(s);}
 assert.deepEqual(tile.materials,{floor:'composite',structure:'composite'});
 assert.equal(totalResources(s).alloy,before.alloy-3);assert.equal(totalResources(s).components,before.components-2);
 damage(s,s.sites.surface,tile,'structure',10,'debris');assert.equal(tile.hp,94);
 const repair=order(s,p,'repair');assert.deepEqual(s.jobs.find(j=>j.id===repair.job).cost,{alloy:1,components:1});valid(s);finish(s,repair);assert.equal(tile.hp,100);assert.equal(materialId(tile,'structure'),'composite');
 const removal=order(s,p,'remove');finish(s,removal);assert.equal(tile.building,null);assert.equal(tile.terrain,'floor');assert.deepEqual(tile.materials,{floor:'composite'});
 assert.equal(totalResources(s).alloy,before.alloy-3);assert.equal(totalResources(s).components,before.components-3);valid(s);
 const log=exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
 assert.equal(log.filter(e=>e.id==='construction.material.installed').length,2);
 assert.ok(log.some(e=>e.id==='construction.material.removed'&&e.material==='composite'&&e.refund.components===0));
 assert.ok(log.some(e=>e.id==='structure.damaged'&&e.rawAmount===10&&e.amount===6&&e.material==='composite'));
 assert.equal(observe(s).entities['tile:surface:5:6'].derived.materials.floor.id,'composite');
});

test('a supplied composite upper slab is built through existing stairs and retains its exact floor in saves and events',()=>{
 const s=staffed(deserialize(gunzipSync(readFileSync(new URL('./fixtures/stairs-schema55.json.gz',import.meta.url))).toString())),site=s.sites.surface,link=site.verticalLinks[0];
 const p=horizontalNeighbors(link.upper).find(p=>tileAt(site,{...p,z:0})?.terrain==='floor'&&tileAt(site,p)?.terrain==='void'),before=totalResources(s);
 assert.ok(p);startRecording(s,{maxRecords:5000,maxBytes:16_000_000});const r=order(s,p,'build','floor','composite');valid(s);finish(s,r);
 assert.deepEqual(tileAt(site,p).materials,{floor:'composite'});assert.equal(totalResources(s).alloy,before.alloy-1);assert.equal(totalResources(s).components,before.components-1);valid(s);
 const event=exportRecording(s).trim().split('\n').map(JSON.parse).find(r=>r.event?.id==='construction.material.installed').event;
 assert.equal(event.entity,`tile:surface:${p.x}:${p.y}:1`);assert.equal(event.layer,'floor');
 const copy=deserialize(serialize(s));step(s,2);step(copy,2);assert.equal(serialize(s),serialize(copy));
});

test('material metadata cannot forge owners, omit paid components or enter pre66 saves',()=>{
 const s=createGame(),r=order(s,{x:5,y:6,z:0},'build','wall','composite'),good=JSON.parse(serialize(s));
 const edits=[
  x=>{x.version=65;},
  x=>{x.jobs[0].material='unknown';},
  x=>{x.jobs[0].kind='mine';},
  x=>{delete x.jobs[0].cost.components;delete x.jobs[0].sources[0].items.components;},
  x=>{x.jobs[0].work=5;x.jobs[0].remaining=5;},
  x=>{x.sites.surface.tiles[0].materials={floor:'composite'};},
  x=>{x.sites.surface.tiles.find(t=>t.terrain==='floor').materials={extra:'alloy'};},
  x=>{x.sites.surface.tiles.find(t=>t.building==='wall').materials={structure:'__proto__'};},
 ];
 for(const edit of edits){const bad=structuredClone(good);edit(bad);assert.throws(()=>deserialize(JSON.stringify(bad)));}
 const old=JSON.parse(raw);old.sites.surface.tiles.find(t=>t.terrain==='floor').materials={floor:'alloy'};assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy structural material/);
 assert.equal(s.jobs[0].id,r.job);valid(s);
});
