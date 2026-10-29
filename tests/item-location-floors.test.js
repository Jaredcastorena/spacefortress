import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {deserialize,serialize,step} from '../src/simulation.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {craftKeepsake,collectPossession,setPossessionCollection} from '../src/possessions.js';
import {setLifePolicy} from '../src/crew-life.js';
import {spill,extract,syncResources,totalResources} from '../src/inventory.js';
import {cookMeal} from '../src/meals.js';
import {MEAL_RECIPES,DEFAULT_MEAL} from '../src/food-data.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {observe,startRecording,exportRecording,tileEntityId} from '../src/telemetry.js';
import {itemOwners} from '../src/item-lots.js';

// Paid stairs and existing enclosed floors come from the genuine fixture.
// Crafted item/meal payloads are explicit initial inputs, not manufacturing
// acceptance. Pickup, stair movement, release, death and hauling run native code.
const raw=gunzipSync(readFileSync(new URL('./fixtures/extraction-schema62.json.gz',import.meta.url))).toString();
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function fixture(){
 const s=deserialize(raw),site=s.sites.surface,c=s.crew[0],link=site.verticalLinks[0];
 for(const j of [...s.jobs])assert.equal(executeAction(s,'job.cancel',{job:j.id}).ok,true);
 for(const crew of s.crew){for(const labor of Object.keys(crew.labors))assert.equal(executeAction(s,'crew.labor',{crew:crew.id,labor,enabled:false}).ok,true);setPossessionCollection(s,crew.id,false);}
 setPossessionCollection(s,c.id,true);setLifePolicy(s,c.id,'rest');c.intent={type:'leisure',target:null,started:s.tick,rested:0};
 const upper=tileAt(site,{x:8,y:10,z:1}),lower=tileAt(site,{x:8,y:10,z:0}),payload=craftKeepsake(s,c),item=structuredClone(payload._items[0]);
 spill(upper,payload);syncResources(s);return {s,site,c,link,upper,lower,item};
}
function until(f,p,limit=70){for(let n=0;n<limit&&!p();n++)step(f.s);assert.ok(p(),`tick ${f.s.tick}: ${f.c.activity}`);}
function collect(f){collectPossession(f.s,f.c,f.site);until(f,()=>f.c.possessions.inventory.keepsakes===1);assert.equal(f.c.z,1);}
function owner(s,id){return itemOwners(s).filter(o=>o.inventory._items?.some(i=>i.id===id));}

test('stacked physical items and split meals report distinct actual-floor owners without mutating saves',()=>{
 const f=fixture(),other=craftKeepsake(f.s,f.c)._items[0];spill(f.lower,{keepsakes:1,_items:[other]});
 startRecording(f.s);
 const j={id:`job-${f.s.nextId++}`,site:'surface',...positionOf(f.upper)},meal=cookMeal(f.s,f.c,j,{food:MEAL_RECIPES[DEFAULT_MEAL].input.food});
 const batch=meal._food[0].meal.id;spill(f.upper,extract(meal,{food:1}));spill(f.lower,meal);syncResources(f.s);
 const before=serialize(f.s),o=observe(f.s);assert.equal(serialize(f.s),before);
 assert.deepEqual(o.entities[f.item.id].location,{entity:'tile:surface:8:10:1',slot:'drop'});
 assert.deepEqual(o.entities[other.id].location,{entity:'tile:surface:8:10',slot:'drop'});
 assert.deepEqual(new Set(o.entities[batch].locations.map(l=>l.entity)),new Set(['tile:surface:8:10','tile:surface:8:10:1']));
 assert.equal(events(f.s).find(e=>e.id==='meal.prepared').entity,'tile:surface:8:10:1');
 assert.equal(serialize(deserialize(before)),before);
});

test('personal pickup follows the native stair route and labels planning and ownership on the real floor',()=>{
 const f=fixture();startRecording(f.s);collectPossession(f.s,f.c,f.site);
 assert.equal(f.c.z,0);assert.equal(f.c.possessions.inventory.keepsakes||0,0);assert.equal(f.upper.drop.keepsakes,1);
 assert.deepEqual(f.c.intent.keepsake.target,positionOf(f.upper));
 const copy=deserialize(serialize(f.s));until(f,()=>f.c.possessions.inventory.keepsakes===1);
 const peer={...f,s:copy,c:copy.crew[0]};until(peer,()=>peer.c.possessions.inventory.keepsakes===1);
 assert.equal(serialize(copy),serialize(f.s));assert.equal(f.c.z,1);assert.deepEqual(f.c.possessions.inventory._items[0],f.item);
 for(const id of ['item.pickup.planned','item.owned'])assert.equal(events(f.s).find(e=>e.id===id).source,'tile:surface:8:10:1');
 assert.equal(owner(f.s,f.item.id).length,1);
});

test('shared release preserves the item upstairs, leaves the lower tile alone and matches the player binding',()=>{
 const f=fixture();collect(f);const copy=deserialize(serialize(f.s)),ground=structuredClone(f.lower.drop);startRecording(f.s);
 assert.equal(executeAction(f.s,'crew.possessions.release',{crew:f.c.id}).ok,true);
 assert.equal(controlBindings(()=>copy).releasePossession(copy,f.c.id).ok,true);
 assert.equal(serialize(copy),serialize(f.s));assert.deepEqual(f.lower.drop,ground);
 assert.deepEqual(f.upper.drop._items[0],f.item);assert.deepEqual(f.c.possessions.inventory,{});assert.equal(f.c.possessions.collect,false);
 assert.equal(events(f.s).find(e=>e.id==='item.released').target,'tile:surface:8:10:1');
 assert.deepEqual(owner(f.s,f.item.id)[0].location,{entity:'tile:surface:8:10:1',slot:'drop'});
 assert.equal(serialize(deserialize(serialize(f.s))),serialize(f.s));
});

test('death drops the same item upstairs before a living hauler carries it down through the stairs',()=>{
 const f=fixture();collect(f);const ground=structuredClone(f.lower.drop),count=totalResources(f.s).keepsakes;
 startRecording(f.s);f.c.health=0;step(f.s);
 assert.deepEqual(f.lower.drop,ground);assert.deepEqual(f.upper.drop._items[0],f.item);assert.deepEqual(f.c.possessions.inventory,{});
 const event=events(f.s).find(e=>e.id==='item.released');assert.equal(event.reason,'death');assert.equal(event.target,'tile:surface:8:10:1');
 const hauler=f.s.crew[1];assert.equal(executeAction(f.s,'crew.labor',{crew:hauler.id,labor:'hauling',enabled:true}).ok,true);
 until(f,()=>f.lower.stock._items?.some(i=>i.id===f.item.id));
 assert.equal(owner(f.s,f.item.id).length,1);assert.equal(totalResources(f.s).keepsakes,count);
 assert.deepEqual(f.lower.stock._items.find(i=>i.id===f.item.id),f.item);
 assert.equal(serialize(deserialize(serialize(f.s))),serialize(f.s));
});

test('closing the stair cancels an inaccessible personal claim without moving or duplicating its item',()=>{
 const f=fixture();collectPossession(f.s,f.c,f.site);assert.ok(f.c.intent.keepsake);
 assert.equal(executeAction(f.s,'vertical.hatch',{site:'surface',connection:f.link.id,mode:'closed'}).ok,true);
 startRecording(f.s);assert.equal(collectPossession(f.s,f.c,f.site),false);
 assert.equal(f.c.intent.keepsake,undefined);assert.equal(f.c.possessions.inventory.keepsakes||0,0);assert.deepEqual(f.upper.drop._items[0],f.item);
 assert.equal(events(f.s).find(e=>e.id==='item.pickup.cancelled').entity,f.item.id);assert.equal(owner(f.s,f.item.id).length,1);
 assert.equal(executeAction(f.s,'vertical.hatch',{site:'surface',connection:f.link.id,mode:'open'}).ok,true);
 setPossessionCollection(f.s,f.c.id,true);collect(f);assert.deepEqual(f.c.possessions.inventory._items[0],f.item);
});

test('release rejects a missing local tile without discarding the pocket item or changing collection policy',()=>{
 const f=fixture();collect(f);f.c.z=999;const before=serialize(f.s);
 const result=executeAction(f.s,'crew.possessions.release',{crew:f.c.id});
 assert.equal(result.ok,false);assert.equal(result.code,'simulation_rejected');assert.equal(result.reason,'missing_owner_tile');assert.equal(serialize(f.s),before);
 f.c.z=1;assert.equal(executeAction(f.s,'crew.possessions.release',{crew:f.c.id}).ok,true);
 assert.deepEqual(f.upper.drop._items[0],f.item);assert.equal(owner(f.s,f.item.id).length,1);
});
