import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createGame,serialize,deserialize,step} from '../src/simulation.js';
import {executeAction,actionCatalog,createAgentInterface} from '../src/controls.js';
import {miningEffort,equippedTool,toolStatus,advanceToolPickup} from '../src/tools.js';
import {toolDetails} from '../src/tool-panels.js';
import {dropPossession,releasePossession} from '../src/possessions.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {syncResources,totalResources} from '../src/inventory.js';
import {observe,startRecording,exportRecording} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/tools-schema63.json.gz',import.meta.url))).toString();
const tool=(condition=100,material='alloy')=>({id:'item-1',maker:'crew-0',kind:'mining_tool',material,quality:1,condition,created:0});
function pocket(s,condition=100,material='alloy'){const c=s.crew[0];c.possessions.inventory={tools:1,_items:[tool(condition,material)]};s.nextItemId=2;syncResources(s);return c;}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const call=(s,id,args)=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,r.message);return r;};

test('genuine schema63 migration changes only version and neutral tool resource total',()=>{
 const prior=JSON.parse(raw),expected=structuredClone(prior);expected.version=64;expected.resources.tools=0;
 const s=deserialize(raw);assert.deepEqual(JSON.parse(serialize(s)),expected);
 const copy=deserialize(serialize(s));step(s,2);step(copy,2);assert.equal(serialize(s),serialize(copy));
});

test('material wear spends actual work and stops its bonus exactly when a tool breaks',()=>{
 const s=createGame(),c=pocket(s,.5);startRecording(s);
 close(miningEffort(s,c,{id:'job-1',remaining:20},1),1.1);assert.equal(equippedTool(c).condition,0);
 close(miningEffort(s,c,{id:'job-1',remaining:20},1),1);assert.equal(toolStatus(c).multiplier,1);
 c.possessions.inventory._items[0]=tool(100,'composite');close(miningEffort(s,c,{id:'job-2',remaining:.3},1),.3);close(equippedTool(c).condition,99.85);
 const rows=exportRecording(s).trim().split('\n').map(JSON.parse);assert.equal(rows.filter(r=>r.event?.id==='tool.broken').length,1);
});

test('ordinary non-mining ticks never wear an equipped tool',()=>{
 const s=createGame(),c=pocket(s);for(const labor of Object.keys(c.labors))c.labors[labor]=false;
 step(s,3);assert.equal(equippedTool(c).condition,100);assert.equal(totalResources(s).tools,1);
 assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});

test('native pickup claims are exclusive, cancellable and preserve source identity',()=>{
 const s=createGame(),site=s.sites.surface,t=tileAt(site,{x:8,y:10,z:0}),c=s.crew[0];
 t.stock.tools=1;t.stock._items=[tool()];s.nextItemId=2;syncResources(s);
 call(s,'crew.tools.equip',{crew:c.id,source:'stock',item:'item-1'});
 const denied=executeAction(s,'crew.tools.equip',{crew:s.crew[1].id,source:'stock',item:'item-1'});assert.equal(denied.ok,false);
 assert.equal(t.stock.tools,1);assert.equal(equippedTool(c),null);assert.equal(serialize(deserialize(serialize(s))),serialize(s));
 call(s,'crew.tools.cancel',{crew:c.id});assert.equal(c.intent,null);assert.equal(t.stock.tools,1);
 call(s,'crew.tools.equip',{crew:c.id,source:'stock',item:'item-1'});
 for(let n=0;n<40&&c.intent;n++)advanceToolPickup(s,c);
 assert.equal(equippedTool(c)?.id,'item-1');assert.deepEqual(positionOf(c),positionOf(t));assert.equal(totalResources(s).tools,1);
});

test('tool and keepsake slots coexist and death releases both onto the actual floor',()=>{
 const s=deserialize(raw),c=pocket(s),site=s.sites.surface,t=site.tiles.find(t=>t.z===1&&t.terrain==='floor');
 Object.assign(c,positionOf(t));c.job=null;c.intent=null;c.possessions.inventory.keepsakes=1;c.possessions.inventory._items.push({id:'item-2',maker:'crew-0',style:'art',quality:1,created:0});s.nextItemId=3;syncResources(s);
 assert.equal(releasePossession(s,c.id).ok,true);assert.equal(equippedTool(c).id,'item-1');assert.equal(t.drop.keepsakes,1);
 assert.equal(dropPossession(s,c),true);assert.equal(t.drop.tools,1);assert.equal(equippedTool(c),null);assert.equal(totalResources(s).tools,1);
});

test('malformed tools, duplicate ownership and unsupported legacy tool state reject saves',()=>{
 const s=createGame();pocket(s);const stable=JSON.parse(serialize(s));
 for(const edit of [x=>x.crew[0].possessions.inventory._items[0].condition=-1,x=>x.crew[0].possessions.inventory._items[0].material='unknown',x=>x.crew[1].possessions.inventory=structuredClone(x.crew[0].possessions.inventory),x=>x.version=63]){
  const invalid=structuredClone(stable);edit(invalid);assert.throws(()=>deserialize(JSON.stringify(invalid)));
 }
});

test('inspection and shared catalog expose tool controls without changing simulation',()=>{
 const s=createGame(),c=pocket(s,0),before=serialize(s),html=toolDetails(s,c),view=observe(s);
 assert.match(html,/Broken: mining continues at normal speed/);assert.match(html,/crew.tools.release/);assert.equal(view.entities[c.id].derived.tool.broken,true);assert.equal(serialize(s),before);
 const definitions=createAgentInterface(()=>s).definitions();assert.equal(definitions.toolMaterials.composite.wear,.5);assert.equal(definitions.toolRecipes.repair_pick.input.alloy,1);
 const catalog=actionCatalog();for(const id of ['crew.tools.equip','crew.tools.cancel','crew.tools.release'])assert.ok(catalog.some(a=>a.id===id));
 for(const id of ['alloy_pick','composite_pick','repair_pick'])assert.ok(catalog.find(a=>a.id==='production.recipe').parameters.properties.recipe.enum.includes(id));
});


test('normal crew recovery interrupts a pending tool pickup without moving the tool',()=>{
 const s=createGame(),c=s.crew[0],t=tileAt(s.sites.surface,{x:8,y:10,z:0});
 t.stock.tools=1;t.stock._items=[tool()];s.nextItemId=2;syncResources(s);c.energy=15;
 call(s,'crew.tools.equip',{crew:c.id,source:'stock',item:'item-1'});step(s);
 assert.notEqual(c.intent?.type,'equipTool');assert.equal(equippedTool(c),null);assert.equal(t.stock.tools,1);
});
