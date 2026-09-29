import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, setLabor, serialize, deserialize, updateRooms, pathTo } from '../src/simulation.js';
import { craftKeepsake, collectPossession, setPossessionCollection, releasePossession, usePossession } from '../src/possessions.js';
import { add, extract, spill, totalResources, syncResources, quantity } from '../src/inventory.js';
import { itemOwners } from '../src/item-lots.js';
import { setLifePolicy } from '../src/crew-life.js';
import { setMachineEnabled, haul, spillStorage } from '../src/industry.js';
import { setProductionOrder } from '../src/production.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
import { executeAction } from '../src/controls.js';
import { haulSalvage, dockAt, setCargoAccepted } from '../src/expedition.js';
import { depart } from './helpers/depart.js';
const check=s=>{syncResources(s);return deserialize(serialize(s));};
const until=(s,p,limit=180)=>{for(let i=0;i<limit&&!p();i++){step(s);check(s);}assert.ok(p(),`Condition missing at ${s.tick}`);};
function fixture(){const s=createGame(),site=s.sites.surface,c=s.crew[0];for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);for(const c of s.crew)for(const labor of Object.keys(c.labors))setLabor(s,c.id,labor,false);return {s,site,c,depot:at(site,8,10)};}
function give(s,inventory,style='art',quality=2){const payload=craftKeepsake(s,s.crew[0]);payload._items[0].style=style;payload._items[0].quality=quality;add(inventory,payload);return payload._items[0].id;}
function breaking(s,c){c.intent={type:'leisure',target:null,started:s.tick,rested:0};c.life.policy='rest';}

test('workstation is built from deliveries, staffed, supplied and produces an item that is hauled then owned',()=>{
  const {s,site,c,depot}=fixture(),before=totalResources(s);setLabor(s,c.id,'construction',true);const job=order(s,'surface',13,8,'build','artisan').job;assert.ok(job);until(s,()=>!s.jobs.includes(job));
  const t=at(site,13,8);assert.equal(t.building,'artisan');assert.equal(totalResources(s).alloy,before.alloy-6);assert.equal(totalResources(s).components,before.components-1);
  setProductionOrder(s,'surface',13,8,'batches',1);setLabor(s,c.id,'production',true);setLabor(s,s.crew[1].id,'hauling',true);until(s,()=>t.machine.completed===1);
  const id=[...itemOwners(s)].flatMap(o=>o.inventory._items||[])[0].id;assert.equal(totalResources(s).keepsakes,1);assert.equal(totalResources(s).alloy,before.alloy-8);assert.equal(totalResources(s).components,before.components-2);
  until(s,()=>depot.stock.keepsakes===1);assert.equal(depot.stock._items[0].id,id);setLifePolicy(s,c.id,'rest');until(s,()=>c.possessions.inventory.keepsakes===1);assert.equal(c.possessions.inventory._items[0].id,id);assert.equal(depot.stock.keepsakes||0,0);assert.equal(totalResources(s).keepsakes,1);check(s);
});

test('production pause and interruption retain the same batch and create only one identity on completion',()=>{
  const {s,site,c}=fixture();setLabor(s,c.id,'construction',true);const j=order(s,'surface',13,8,'build','artisan').job;until(s,()=>!s.jobs.includes(j));const t=at(site,13,8);
  setProductionOrder(s,'surface',13,8,'batches',1);setLabor(s,c.id,'production',true);setLabor(s,s.crew[1].id,'hauling',true);until(s,()=>t.machine.progress>2);const batch=structuredClone(t.machine.batch),progress=t.machine.progress;
  setMachineEnabled(s,'surface',13,8,false);step(s,8);assert.deepEqual(t.machine.batch,batch);assert.equal(t.machine.progress,progress);assert.equal(s.nextItemId,1);setMachineEnabled(s,'surface',13,8,true);until(s,()=>t.machine.completed===1);assert.equal(s.nextItemId,2);assert.equal(totalResources(s).keepsakes,1);
});

test('quality and style come from the finishing maker and survive ordinary inventory transfers',()=>{
  const {s,c}=fixture();c.skills.production.level=9;c.housing.preference='quiet';const a=craftKeepsake(s,c),identity=structuredClone(a._items[0]),b={},before=structuredClone(a);
  assert.equal(identity.quality,4);assert.equal(identity.style,'quiet');add(b,extract(a,{keepsakes:1}));assert.deepEqual(b._items[0],identity);assert.equal(quantity(a),0);assert.equal(a._items,undefined);
  const bad=structuredClone(b);assert.equal(extract(b,{keepsakes:.5}),null);assert.deepEqual(b,bad);assert.notDeepEqual(a,before);
});

test('personal pickup walks to the source, prioritizes preference over quality and never teleports supplies',()=>{
  const {s,site,c,depot}=fixture();c.x=12;c.y=8;const matching=give(s,depot.stock,'art',1);give(s,depot.stock,'quiet',4);breaking(s,c);
  collectPossession(s,c,site,pathTo);assert.equal(c.possessions.inventory.keepsakes||0,0);assert.equal(c.intent.keepsake.id,matching);assert.equal(depot.stock.keepsakes,2);
  until(s,()=>c.possessions.inventory.keepsakes===1);assert.equal(c.possessions.inventory._items[0].id,matching);assert.equal(c.x,8);assert.equal(c.y,10);check(s);
});

test('multiple crew claim different item IDs while a hauler respects their pickup buffer',()=>{
  const {s,site,c,depot}=fixture(),b=s.crew[1],hauler=s.crew[2];give(s,depot.stock);give(s,depot.stock);c.x=b.x=12;c.y=b.y=8;breaking(s,c);breaking(s,b);
  collectPossession(s,c,site,pathTo);collectPossession(s,b,site,pathTo);assert.notEqual(c.intent.keepsake.id,b.intent.keepsake.id);setLabor(s,hauler.id,'hauling',true);haul(s,hauler,site,pathTo);assert.ok(!(hauler.intent?.type==='haul'&&hauler.intent.source==='stock'&&hauler.intent.target.join(',')==='8,10'));
  until(s,()=>c.possessions.inventory.keepsakes&&b.possessions.inventory.keepsakes);assert.equal(totalResources(s).keepsakes,2);check(s);
});

test('emergency recovery drops a pending claim without losing the physical item',()=>{
  const {s,site,c,depot}=fixture();give(s,depot.stock);c.x=12;c.y=8;breaking(s,c);collectPossession(s,c,site,pathTo);assert.ok(c.intent.keepsake);c.energy=1;step(s);
  assert.equal(c.intent.type,'rest');assert.equal(c.possessions.inventory.keepsakes||0,0);assert.equal(depot.stock.keepsakes,1);check(s);
});

test('blocked or removed pickup sources fall back to downtime instead of trapping crew',()=>{
  const {s,site,c,depot}=fixture();give(s,depot.stock);c.x=12;c.y=8;breaking(s,c);collectPossession(s,c,site,pathTo);
  spillStorage(depot);depot.building=null;step(s);assert.equal(c.intent.keepsake,undefined);assert.equal(totalResources(s).keepsakes,1);until(s,()=>c.intent?.rested>0);check(s);
});

test('fractional remaining depot space cannot split an item during hauling',()=>{
  const {s,site,c,depot}=fixture();depot.stock={alloy:319.5};const tile=at(site,12,9);tile.drop={};give(s,tile.drop);setLabor(s,c.id,'hauling',true);c.x=12;c.y=9;
  haul(s,c,site,pathTo);assert.ok(!c.carry);assert.equal(tile.drop.keepsakes,1);delete depot.stock.alloy;haul(s,c,site,pathTo);assert.equal(c.carry.keepsakes,1);until(s,()=>!c.carry);assert.equal(depot.stock.keepsakes,1);check(s);
});

test('releasing ownership creates a local pile, disables collection and retains identity',()=>{
  const {s,site,c}=fixture();const id=give(s,c.possessions.inventory);const before=totalResources(s);assert.equal(executeAction(s,'crew.possessions.release',{crew:c.id}).ok,true);
  assert.equal(c.possessions.collect,false);assert.deepEqual(c.possessions.inventory,{});assert.equal(at(site,c.x,c.y).drop._items[0].id,id);assert.deepEqual(totalResources(s),before);assert.equal(setPossessionCollection(s,c.id,true).ok,true);check(s);
});

test('only using an owned keepsake during actual downtime grants enjoyment',()=>{
  const {s,c}=fixture();give(s,c.possessions.inventory);assert.ok(!c.memories.some(m=>m.kind==='keepsake-use'));c.life.leisure=20;c.life.stress=50;setLifePolicy(s,c.id,'rest');until(s,()=>c.intent?.rested>0);
  assert.ok(c.memories.some(m=>m.kind==='keepsake-use'));const before=c.life.leisure;step(s);assert.ok(c.life.leisure-before>.3);const count=c.memories.filter(m=>m.kind==='keepsake-use').length;step(s,5);assert.equal(c.memories.filter(m=>m.kind==='keepsake-use').length,count);check(s);
});

test('death releases the owned item once at the real local position',()=>{
  const {s,site,c}=fixture();const id=give(s,c.possessions.inventory);c.health=0;step(s);assert.equal(at(site,c.x,c.y).drop._items[0].id,id);assert.equal(quantity(c.possessions.inventory),0);step(s,3);assert.equal(totalResources(s).keepsakes,1);check(s);
});

test('owned pocket items travel with expedition crew and remain identifiable',()=>{
  const s=createGame(),c=s.crew[0],id=give(s,c.possessions.inventory);assert.ok(depart(s,'wreck').ok);assert.equal(c.site,'transit');assert.equal(c.possessions.inventory._items[0].id,id);assert.equal(totalResources(s).keepsakes,1);
  until(s,()=>c.site==='wreck');assert.equal(c.possessions.inventory._items[0].id,id);c.health=0;step(s);assert.equal(at(s.sites.wreck,c.x,c.y).drop._items[0].id,id);check(s);
});

test('identity, pending pickup, personal use and counts continue deterministically after reload',()=>{
  const {s,site,c,depot}=fixture();give(s,depot.stock);c.x=12;c.y=8;breaking(s,c);collectPossession(s,c,site,pathTo);const copy=check(s);step(s,20);step(copy,20);assert.deepEqual(copy,s);
});

test('version twenty-two migration grants no items and expands only unrestricted filters',()=>{
  const {s,site,depot}=fixture();s.version=22;delete s.nextItemId;delete s.resources.keepsakes;for(const c of s.crew)delete c.possessions;depot.storage.accepted=depot.storage.accepted.filter(r=>r!=='keepsakes');const before=totalResources(s),copy=check(s);assert.equal(copy.version, VERSION);assert.deepEqual(totalResources(copy),before);assert.ok(at(copy.sites.surface,8,10).storage.accepted.includes('keepsakes'));
  depot.storage.accepted=['alloy'];const selective=check(s);assert.deepEqual(at(selective.sites.surface,8,10).storage.accepted,['alloy']);
});

test('malformed, fractional, missing and duplicate physical items are rejected',()=>{
  for(const corrupt of [s=>s.crew[0].possessions.inventory={keepsakes:.5},s=>s.crew[0].possessions.inventory={keepsakes:1},s=>s.crew[0].possessions.inventory=[],s=>{const d=at(s.sites.surface,8,10);give(s,d.stock);add(s.crew[0].possessions.inventory,{keepsakes:1,_items:[{...d.stock._items[0]}]});},s=>{give(s,s.crew[0].possessions.inventory);s.nextItemId=1;},s=>{give(s,s.crew[0].possessions.inventory);s.crew[0].possessions.inventory._items[0].quality=99;},s=>{delete s.crew[0].possessions;}]){const {s}=fixture();corrupt(s);assert.throws(()=>check(s));}
});

test('recording exposes individual item locations and explicit crafting, ownership, use and release events',()=>{
  const {s,site,c,depot}=fixture();startRecording(s);const id=give(s,depot.stock);c.x=8;c.y=10;breaking(s,c);collectPossession(s,c,site,pathTo);usePossession(s,c);releasePossession(s,c.id);
  const item=observe(s).entities[id];assert.equal(item.type,'item');assert.deepEqual(item.location,{entity:'tile:surface:8:10',slot:'drop'});
  const events=exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.kind==='event').map(r=>r.event.id);for(const id of ['item.crafted','item.owned','item.enjoyed','item.released'])assert.ok(events.includes(id));
});


test('remote cargo capacity preserves whole item IDs and records collection, delivery and overflow',()=>{
  const s=createGame(),c=s.crew[0];assert.ok(depart(s,'wreck').ok);until(s,()=>c.site==='wreck');
  const site=s.sites.wreck,dock=dockAt(site);c.intent=null;c.x=dock.x;c.y=dock.y;setLabor(s,c.id,'hauling',true);setCargoAccepted(s,'keepsakes',true);
  dock.drop={};const id=give(s,dock.drop);s.mission.cargo={alloy:17.5};startRecording(s);
  haulSalvage(s,c,site,pathTo);assert.ok(!c.carry);assert.equal(dock.drop._items[0].id,id);
  s.mission.cargo={alloy:17};haulSalvage(s,c,site,pathTo);assert.equal(c.carry._items[0].id,id);check(s);
  s.mission.cargo.alloy=17.5;haulSalvage(s,c,site,pathTo);assert.ok(!c.carry);assert.equal(dock.drop._items[0].id,id);assert.equal(s.mission.cargo.keepsakes,undefined);check(s);
  s.mission.cargo.alloy=17;haulSalvage(s,c,site,pathTo);haulSalvage(s,c,site,pathTo);assert.equal(s.mission.cargo._items[0].id,id);assert.equal(quantity(s.mission.cargo),18);check(s);
  const moves=exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event?.id==='item.moved');
  assert.equal(moves.length,4);assert.ok(moves.every(r=>r.event.entity===id));
});
