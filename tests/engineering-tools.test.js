import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {TOOL_KINDS,TOOL_RECIPES,toolSupports} from '../src/tool-data.js';
import {workEffort,toolStatus,equippedTool} from '../src/tools.js';
import {executeAction,controlBindings,createAgentInterface} from '../src/controls.js';
import {projectedStock} from '../src/production.js';
import {initializeStorage,syncResources,totalResources,add} from '../src/inventory.js';
import {validItemLots} from '../src/item-lots.js';
import {tileAt,positionOf,tileEntityId} from '../src/spatial.js';
import {damage} from '../src/maintenance.js';
import {toolDetails} from '../src/tool-panels.js';
import {itemsDetails} from '../src/possession-panels.js';
import {observe,startRecording,exportRecording} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/equipment-schema66.json.gz',import.meta.url))).toString();
const kit=(id=1,condition=100,material='alloy',kind='engineering_tool')=>({id:`item-${id}`,maker:'crew-0',kind,material,quality:1,condition,created:0});
const cargo=(...items)=>({tools:items.length,_items:items});
const act=(s,id,args)=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);return r;};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(row=>row.event).map(row=>row.event);
const exact=s=>{syncResources(s);const text=serialize(s);assert.equal(serialize(deserialize(text)),text);};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const until=(s,label,p,limit=180)=>{for(let n=0;n<limit&&!p();n++)step(s);assert.ok(p(),`${label} stopped at tick${s.tick}: ${s.crew.map(c=>c.activity).join('; ')}`);};

test('engineering capability affects matching work only, with finite wear and broken-tool fallback',()=>{
 const s=createGame(),c=s.crew[0];c.possessions.inventory=cargo(kit());s.nextItemId=2;syncResources(s);startRecording(s);
 for(const kind of ['build','remove','repair','service','repairCable','removeCable','repairPipe','removePipe','repairWaterPipe','removeWaterPipe']){const before=equippedTool(c).condition;close(workEffort(s,c,{id:'job-1',kind,remaining:9},1),1.25);close(before-equippedTool(c).condition,1.25);}
 const before=equippedTool(c).condition;
 for(const kind of ['mine','treat','feed','hygiene','plant','gather','extinguish']){close(workEffort(s,c,{id:'job-2',kind,remaining:9},1),1);assert.equal(toolSupports(equippedTool(c),kind),false);}
 assert.equal(equippedTool(c).condition,before);assert.equal(toolStatus(c,'mine').multiplier,1);
 equippedTool(c).condition=.5;close(workEffort(s,c,{id:'job-3',kind:'repair',remaining:9},1),1.1);assert.equal(equippedTool(c).condition,0);close(workEffort(s,c,{id:'job-3',kind:'repair',remaining:9},1),1);
 c.possessions.inventory=cargo(kit(1,100,'composite'));close(workEffort(s,c,{id:'job-4',kind:'build',remaining:.3},1),.3);close(equippedTool(c).condition,99.85);
 c.possessions.inventory=cargo(kit(1,100,'alloy','mining_tool'));close(workEffort(s,c,{id:'job-5',kind:'build',remaining:9},1),1);assert.equal(equippedTool(c).condition,100);
 assert.equal(events(s).filter(e=>e.id==='tool.broken').length,1);assert.ok(events(s).filter(e=>e.id==='tool.used').every(e=>e.kind==='engineering_tool'&&TOOL_KINDS.engineering_tool.jobs.includes(e.workKind)));
});

test('genuine schema66 migrates without modifying physical state and rejects premature equipment ownership',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'76398f6deffe88bba805805ce1b54cd09082c423fe7ee33daf6dce78d93c8572');
 const expected=JSON.parse(raw);expected.version=VERSION;for(const site of Object.values(expected.sites))for(const t of site.tiles)if(t.building==='stockpile')t.storage.limits={};const s=deserialize(raw);assert.deepEqual(s,expected);exact(s);
 for(const change of [state=>{state.crew[0].possessions.inventory=cargo(kit());state.nextItemId=2;syncResources(state);},state=>{state.sites.surface.tiles.find(t=>t.machine).machine.recipeId='alloy_kit';},state=>{state.sites.surface.tiles.find(t=>t.machine).machine.batchRecipeId='composite_kit';}]){
  const old=JSON.parse(raw);change(old);assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy engineering equipment/);
 }
 const copy=deserialize(serialize(s));step(s,3);step(copy,3);assert.equal(serialize(copy),serialize(s));
});

test('stock targets distinguish equipment family and material, including selected versus committed repair output',()=>{
 // Synthetic inventory/commitment boundary; no claim of native manufacturing.
 const s=createGame(),site=s.sites.surface,store=tileAt(site,{x:8,y:10,z:0}),bench=tileAt(site,{x:12,y:8,z:0});bench.building='toolbench';initializeStorage(bench);
 add(store.stock,cargo(kit(1),kit(2,100,'alloy','mining_tool')));
 const count=id=>projectedStock(s,site,'tools',null,false,TOOL_RECIPES[id]);
 assert.equal(count('alloy_kit'),1);assert.equal(count('alloy_pick'),1);assert.equal(count('composite_kit'),0);
 bench.machine.batch={alloy:2,components:2};bench.machine.batchRecipeId='composite_kit';bench.machine.recipeId='alloy_pick';
 assert.equal(count('composite_kit'),1);assert.equal(count('composite_pick'),0);assert.equal(count('alloy_pick'),1);
 bench.machine.batch={...cargo(kit(3,20,'composite')),alloy:1};bench.machine.batchRecipeId='repair_pick';bench.machine.recipeId='composite_pick';
 assert.equal(count('composite_kit'),1);assert.equal(count('composite_pick'),0);assert.equal(projectedStock(s,site,'tools'),3);
});

test('equipment pickup uses shared controls, exclusive slots, exact saved claims and correctly named inspection',()=>{
 // Synthetic stock at an existing physical depot; commands and walking are real.
 const a=createGame(),store=tileAt(a.sites.surface,{x:8,y:10,z:0});add(store.stock,cargo(kit()));a.nextItemId=2;syncResources(a);const b=deserialize(serialize(a));
 act(a,'crew.tools.equip',{crew:'crew-0',source:'stock',item:'item-1'});assert.ok(controlBindings(()=>b).equipTool(b,'crew-0','stock','item-1').ok);assert.equal(serialize(a),serialize(b));exact(a);
 assert.equal(executeAction(a,'crew.tools.equip',{crew:'crew-1',source:'stock',item:'item-1'}).ok,false);
 until(a,'kit pickup',()=>equippedTool(a.crew[0]));assert.equal(equippedTool(a.crew[0]).kind,'engineering_tool');assert.equal(totalResources(a).tools,1);exact(a);
 const before=serialize(a),view=observe(a),html=toolDetails(a,a.crew[0]);assert.match(html,/Alloy engineering kit/);assert.match(html,/construction and maintenance/);assert.match(itemsDetails(a.crew[0].possessions.inventory),/Alloy engineering kit/);assert.equal(view.entities['crew-0'].derived.tool.kind,'engineering_tool');assert.equal(serialize(a),before);
 const definitions=createAgentInterface(()=>a).definitions();definitions.toolKinds.engineering_tool.jobs.length=0;assert.ok(TOOL_KINDS.engineering_tool.jobs.length>0);
 assert.equal(validItemLots(cargo({...kit(),kind:'invented'}),true),false);
 const stable=serialize(a),denied=executeAction(a,'crew.tools.equip',{crew:'crew-0',source:'stock',item:'item-1'});assert.equal(denied.ok,false);assert.match(denied.message,/Put down the current tool/);assert.equal(serialize(a),stable);
 act(a,'crew.tools.release',{crew:'crew-0'});assert.equal(totalResources(a).tools,1);exact(a);
});

test('native paid kit manufacture improves construction and maintenance, then repairs the same identity',()=>{
 const s=createGame(12345),site=s.sites.surface,store=tileAt(site,{x:8,y:10,z:0}),builder=s.crew[0],operator=s.crew[3];
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')act(s,'production.enable',{site:site.id,...positionOf(t),enabled:false});
 for(const c of s.crew){for(const labor of Object.keys(c.labors))act(s,'crew.labor',{crew:c.id,labor,enabled:false});act(s,'crew.routine',{crew:c.id,policy:'work'});}
 for(const labor of ['construction','engineering'])act(s,'crew.labor',{crew:builder.id,labor,enabled:true});act(s,'crew.labor',{crew:operator.id,labor:'production',enabled:true});
 for(const c of s.crew.filter(c=>c!==builder&&c!==operator))act(s,'crew.labor',{crew:c.id,labor:'hauling',enabled:true});
 startRecording(s);const initial=totalResources(s),place=(x,y,kind,building)=>act(s,'job.order',{site:site.id,x,y,kind,...(building?{building}:{})});
 const construction=place(12,8,'build','toolbench');until(s,'paid workshop',()=>!s.jobs.some(j=>j.id===construction.job));const bench=tileAt(site,{x:12,y:8,z:0});
 act(s,'production.recipe',{site:site.id,...positionOf(bench),recipe:'alloy_kit'});act(s,'production.order',{site:site.id,...positionOf(bench),mode:'batches',limit:1});
 until(s,'kit commitment',()=>bench.machine.batchRecipeId==='alloy_kit');exact(s);
 act(s,'production.recipe',{site:site.id,...positionOf(bench),recipe:'composite_pick'});const during=deserialize(serialize(s));step(s,2);step(during,2);assert.equal(serialize(s),serialize(during));
 until(s,'manufacture',()=>bench.machine.completed===1);act(s,'production.enable',{site:site.id,...positionOf(bench),enabled:false});until(s,'kit storage',()=>store.stock._items?.some(i=>i.kind==='engineering_tool'));
 const made=structuredClone(store.stock._items.find(i=>i.kind==='engineering_tool'));assert.equal(made.material,'alloy');close(totalResources(s).alloy,initial.alloy-8);close(totalResources(s).components,initial.components-2);
 act(s,'crew.tools.equip',{crew:builder.id,source:'stock',item:made.id});until(s,'builder pickup',()=>equippedTool(builder));exact(s);
 const bare=deserialize(serialize(s));act(bare,'crew.tools.release',{crew:builder.id});
 const wall=place(5,6,'build','wall'),bareWall=act(bare,'job.order',{site:site.id,x:5,y:6,kind:'build',building:'wall'}),start=s.tick;
 until(s,'kit wall construction',()=>!s.jobs.some(j=>j.id===wall.job));until(bare,'hand construction',()=>!bare.jobs.some(j=>j.id===bareWall.job));assert.ok(s.tick-start<bare.tick-start,'kit shortens the same native build');
 const t=tileAt(site,{x:5,y:6,z:0});damage(s,site,t,'structure',10,'debris');const repair=place(5,6,'repair');until(s,'supplied structure repair',()=>!s.jobs.some(j=>j.id===repair.job));assert.equal(t.hp,100);assert.ok(equippedTool(builder).condition<100);exact(s);
 act(s,'crew.tools.release',{crew:builder.id});act(s,'production.recipe',{site:site.id,...positionOf(bench),recipe:'repair_pick'});act(s,'production.order',{site:site.id,...positionOf(bench),mode:'batches',limit:1});act(s,'production.enable',{site:site.id,...positionOf(bench),enabled:true});
 until(s,'committed kit repair',()=>bench.machine.batch._items?.some(i=>i.id===made.id));exact(s);until(s,'repair completion',()=>bench.machine.completed===2);act(s,'production.enable',{site:site.id,...positionOf(bench),enabled:false});until(s,'repaired kit storage',()=>store.stock._items?.some(i=>i.id===made.id&&i.condition===100));
 assert.deepEqual(store.stock._items.find(i=>i.id===made.id),made);assert.equal(s.nextItemId,2);assert.equal(totalResources(s).tools,1);close(totalResources(s).alloy,initial.alloy-12);exact(s);
 const log=events(s);assert.ok(log.some(e=>e.id==='tool.crafted'&&e.kind==='engineering_tool'));assert.ok(log.some(e=>e.id==='tool.used'&&e.workKind==='repair'));assert.ok(log.some(e=>e.id==='tool.repaired'&&e.kind==='engineering_tool'));assert.ok(s.crew.every(c=>c.health>0));
});


test('engineering kits travel through existing stairs and retain actual-floor pickup, save and release custody',()=>{
 // Explicit upper-habitat fixture and one synthetic kit; movement/claims remain native.
 const s=deserialize(gunzipSync(readFileSync(new URL('./fixtures/tools-schema63.json.gz',import.meta.url))).toString()),site=s.sites.surface,c=s.crew[1],t=tileAt(site,{x:9,y:7,z:1});
 for(const j of [...s.jobs])act(s,'job.cancel',{job:j.id});
 for(const crew of s.crew)for(const labor of Object.keys(crew.labors))act(s,'crew.labor',{crew:crew.id,labor,enabled:false});
 const item=kit(s.nextItemId++,50,'composite');t.drop=cargo(item);syncResources(s);startRecording(s);
 act(s,'crew.tools.equip',{crew:c.id,source:'drop',item:item.id});exact(s);
 until(s,'upper landing',()=>c.z===1);exact(s);until(s,'upper kit pickup',()=>equippedTool(c));assert.deepEqual(positionOf(c),positionOf(t));assert.deepEqual(equippedTool(c),item);
 const copy=deserialize(serialize(s));step(s,2);step(copy,2);assert.equal(serialize(s),serialize(copy));assert.equal(equippedTool(c).condition,50);
 const location=positionOf(c);act(s,'crew.tools.release',{crew:c.id});const owner=tileAt(site,location);assert.ok(owner.drop._items.some(i=>i.id===item.id));assert.equal(totalResources(s).tools,1);exact(s);
 assert.ok(events(s).some(e=>e.id==='tool.equipped'&&e.source===tileEntityId(site.id,t.x,t.y,t.z)));
 assert.ok(events(s).some(e=>e.id==='tool.released'&&e.target===tileEntityId(site.id,location.x,location.y,location.z)));
});
