import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {crewPathToPosition} from '../src/navigation.js';
import {syncResources,totalResources} from '../src/inventory.js';
import {equippedTool,toolStatus} from '../src/tools.js';
import {startRecording,exportRecording,observe} from '../src/telemetry.js';
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function action(s,id,args){const result=executeAction(s,id,args);assert.equal(result.ok,true,`${id}: ${result.message}`);return result;}
function until(s,label,p,limit=160){for(let n=0;n<limit&&!p();n++)step(s);assert.ok(p(),`${label} stopped at ${s.tick}: ${s.crew.map(c=>c.activity).join('; ')} / ${s.sites.surface.tiles.filter(t=>t.machine?.enabled).map(t=>t.building+': '+t.machine.status).join('; ')} / ${JSON.stringify(s.crew.filter(c=>c.carry||c.intent).map(c=>({id:c.id,x:c.x,y:c.y,z:c.z,oxygen:c.oxygen,energy:c.energy,carry:c.carry,delivery:c.delivery,intent:c.intent})))}`);}
function workOrder(s,t,n){action(s,'production.order',{site:'surface',...positionOf(t),mode:'batches',limit:n});}
function enabled(s,t,value){action(s,'production.enable',{site:'surface',...positionOf(t),enabled:value});}
function check(s){const raw=serialize(s);assert.equal(serialize(deserialize(raw)),raw);}
function oreFor(s,c){return s.sites.surface.tiles.filter(t=>t.terrain==='ore'&&!t.building).map(t=>({t,path:crewPathToPosition(s,s.sites.surface,c,horizontalNeighbors(t))})).filter(o=>o.path!==null).sort((a,b)=>a.path.length-b.path.length)[0].t;}
function labor(s,c,name,on=true){action(s,'crew.labor',{crew:c.id,labor:name,enabled:on});}

test('finite extraction becomes a manufactured tool, native pickup, mining wear and supplied repair of the same identity',()=>{
 const s=createGame(12345),site=s.sites.surface,store=tileAt(site,{x:8,y:10,z:0});
 // Explicit initial construction budget: two workshops consume all available
 // alloy/components. Subsequent tool inputs must come from native extraction,
 // refining and fabrication. No resource, health or position edits after this.
 store.stock.alloy=14;store.stock.components=3;syncResources(s);
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')enabled(s,t,false);
 for(const c of s.crew){for(const name of Object.keys(c.labors))labor(s,c,name,false);action(s,'crew.routine',{crew:c.id,policy:'work'});}
 const builder=s.crew[1],miner=s.crew[2],operator=s.crew[3],haulers=[s.crew[0],s.crew[4],s.crew[5],s.crew[6]];
 labor(s,builder,'construction');labor(s,miner,'mining');labor(s,operator,'production');
 startRecording(s);
 const build=(x,y,building)=>{const result=action(s,'job.order',{site:'surface',x,y,kind:'build',building});until(s,building,()=>!s.jobs.some(j=>j.id===result.job));return tileAt(site,{x,y,z:0});};
 const fabricator=build(12,8,'fabricator');enabled(s,fabricator,false);
 const bench=build(13,8,'toolbench');enabled(s,bench,false);labor(s,builder,'construction',false);
 close(totalResources(s).alloy,0);close(totalResources(s).components,0);
 // Staff supply and return trips together; life support retains its priority.
 for(const hauler of haulers)labor(s,hauler,'hauling');
 const first=oreFor(s,miner),mine=action(s,'job.order',{site:'surface',...positionOf(first),kind:'mine'});
 until(s,'ore extraction',()=>!s.jobs.some(j=>j.id===mine.job));
 const refinery=site.tiles.find(t=>t.building==='refinery');workOrder(s,refinery,3);enabled(s,refinery,true);
 until(s,'refining',()=>refinery.machine.completed===3);enabled(s,refinery,false);
 workOrder(s,fabricator,1);enabled(s,fabricator,true);
 until(s,'component fabrication',()=>fabricator.machine.completed===1);enabled(s,fabricator,false);
 workOrder(s,bench,1);enabled(s,bench,true);
 until(s,'partial tool manufacture',()=>bench.machine.progress>0);check(s);
 const continuation=deserialize(serialize(s));step(s,3);step(continuation,3);assert.equal(serialize(continuation),serialize(s));
 until(s,'tool manufacture',()=>bench.machine.completed===1);enabled(s,bench,false);
 until(s,'tool delivery',()=>store.stock.tools===1);
 const item=structuredClone(store.stock._items.find(i=>i.kind==='mining_tool'));
 assert.equal(item.condition,100);assert.equal(item.material,'alloy');assert.equal(totalResources(s).tools,1);
 const peer=deserialize(serialize(s));
 action(s,'crew.tools.equip',{crew:miner.id,source:'stock',item:item.id});
 assert.equal(controlBindings(()=>peer).equipTool(peer,miner.id,'stock',item.id).ok,true);
 assert.equal(serialize(peer),serialize(s));assert.equal(equippedTool(miner),null);assert.equal(store.stock.tools,1);check(s);
 until(s,'physical tool pickup',()=>!!equippedTool(miner));assert.equal(equippedTool(miner).id,item.id);assert.equal(store.stock.tools||0,0);
 assert.ok(toolStatus(miner).multiplier>1);const before=serialize(s);observe(s);assert.equal(serialize(s),before);
 const second=oreFor(s,miner),nextMine=action(s,'job.order',{site:'surface',...positionOf(second),kind:'mine'});
 until(s,'equipped extraction',()=>!s.jobs.some(j=>j.id===nextMine.job));
 close(equippedTool(miner).condition,93);assert.equal(totalResources(s).tools,1);
 action(s,'crew.tools.release',{crew:miner.id});assert.equal(equippedTool(miner),null);
 action(s,'production.recipe',{site:'surface',...positionOf(bench),recipe:'repair_pick'});workOrder(s,bench,1);enabled(s,bench,true);
 until(s,'partial repair',()=>bench.machine.progress>0);assert.equal(bench.machine.batch._items[0].id,item.id);check(s);
 const repairedCopy=deserialize(serialize(s));step(s,2);step(repairedCopy,2);assert.equal(serialize(repairedCopy),serialize(s));
 until(s,'tool repair',()=>bench.machine.completed===2);enabled(s,bench,false);
 until(s,'repaired tool return',()=>store.stock._items?.some(i=>i.id===item.id&&i.condition===100));
 assert.deepEqual(store.stock._items.find(i=>i.id===item.id),item);assert.equal(s.nextItemId,2);assert.equal(totalResources(s).tools,1);check(s);
 const log=events(s),started=log.filter(e=>e.id==='production.batch.started');
 assert.ok(log.some(e=>e.id==='resource.extracted'&&e.output.ore));
 assert.ok(started.some(e=>e.recipe==='refinery'&&e.input.ore));assert.ok(started.some(e=>e.recipe==='fabricator'&&e.input.alloy));
 assert.deepEqual(started.find(e=>e.recipeId==='alloy_pick').input,{alloy:2,components:1});
 assert.equal(log.filter(e=>e.id==='tool.crafted').length,1);assert.equal(log.filter(e=>e.id==='tool.repaired').length,1);
 close(log.filter(e=>e.id==='tool.used').reduce((n,e)=>n+e.wear,0),7);
 assert.ok(s.crew.every(c=>c.health>0));
});
