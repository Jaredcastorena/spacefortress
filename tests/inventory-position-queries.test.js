import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingInventory, outgoingInventory, hasOutgoingInventory, availableInventory, inventoryPosition, sameInventoryLocation } from '../src/inventory-reservations.js';
import { depotUsage } from '../src/storage.js';
import { constructionResources } from '../src/construction.js';
import { tileAt } from '../src/spatial.js';

// Synthetic accounting fixture, not a loadable multi-deck colony. Saved hauling
// and job-source references still need their separate field-specific migration.
const low={x:1,y:1,z:0},high={x:1,y:1,z:4};
function fixture() {
  const size=3,levels=[4,0].map(z=>({z,name:`Deck ${z}`}));
  const site={id:'surface',size,levels,viewZ:4,tiles:levels.flatMap(({z})=>Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),z,terrain:'floor',building:null,hp:100})))};
  Object.assign(tileAt(site,low),{building:'stockpile',stock:{alloy:10}});
  Object.assign(tileAt(site,high),{building:'stockpile',stock:{alloy:30},drop:{alloy:20}});
  return {site,s:{sites:{surface:site},crew:[],jobs:[]}};
}
const crew=(id,extra={})=>({id,site:'surface',x:0,y:0,z:0,health:100,carry:null,intent:null,...extra});
const haul=(target,items,destination={kind:'stock',target:low},source='stock')=>({type:'haul',source,target,items,destination});

test('physical stock and outgoing claims stay separate by deck and owner slot',()=>{
  const {s,site}=fixture();
  s.crew=[crew('ground',{z:4,intent:haul([1,1],{alloy:3})}),crew('upper',{intent:haul({...high,site:'surface'},{alloy:7})}),
    crew('drop',{intent:haul(high,{alloy:8},undefined,'drop')}),crew('foreign',{site:'wreck',intent:haul(high,{alloy:99})}),
    crew('dead',{health:0,intent:haul(high,{alloy:99})}),crew('carrying',{carry:{alloy:5},intent:haul(high,{alloy:99})})];
  const before=JSON.stringify(s);
  assert.equal(outgoingInventory(s,'surface',low,'stock','alloy'),3);
  assert.equal(outgoingInventory(s,'surface',high,'stock','alloy'),7);
  assert.equal(outgoingInventory(s,'surface',high,'stock','alloy',s.crew[1]),0);
  assert.equal(hasOutgoingInventory(s,'surface',high,'stock'),true);
  assert.equal(hasOutgoingInventory(s,'surface',high,'stock',s.crew[1]),false);
  assert.equal(availableInventory(s,'surface',low,'stock','alloy'),7);
  assert.equal(availableInventory(s,'surface',high,'stock','alloy'),23);
  assert.equal(availableInventory(s,'surface',high,'drop','alloy'),12);
  assert.equal(availableInventory(s,'surface',[1,1],'stock','alloy'),7,'legacy references do not inherit actor/viewed level');
  assert.equal(constructionResources(s).alloy,42,'each physical source contributes once');
  assert.equal(JSON.stringify(s),before);assert.equal(site.levels[0].z,4);
});

test('incoming space follows the actual delivery instead of a stale pickup intent',()=>{
  const {s}=fixture();
  s.crew=[crew('carrying',{z:4,carry:{alloy:4},delivery:{kind:'stock',target:[1,1]},intent:haul(high,{alloy:90},{kind:'stock',target:high})}),
    crew('reserved',{intent:haul(low,{alloy:6},{kind:'stock',target:high})})];
  const before=JSON.stringify(s);
  assert.equal(incomingInventory(s,'surface',{kind:'stock',target:low},'alloy'),4);
  assert.equal(incomingInventory(s,'surface',{kind:'stock',target:high},'alloy'),6);
  assert.equal(incomingInventory(s,'surface',{kind:'stock',target:[1,1]},'alloy'),4);
  assert.equal(incomingInventory(s,'surface',{kind:'input',target:high},'alloy'),0);
  assert.equal(incomingInventory(s,'surface',{kind:'stock',target:high},'alloy',null,s.crew[1]),0);
  assert.equal(JSON.stringify(s),before);
});

test('depot capacity includes only reservations and incoming cargo for that deck',()=>{
  const {s,site}=fixture();s.jobs=[{site:'surface',sources:[{x:1,y:1,kind:'stock',items:{alloy:8}},{...high,kind:'stock',items:{alloy:5}}]}];
  s.crew=[crew('lower',{carry:{alloy:4},delivery:{kind:'stock',target:[1,1]}}),crew('upper',{intent:haul(low,{alloy:6},{kind:'stock',target:high})})];
  const before=JSON.stringify(s);
  assert.deepEqual(depotUsage(s,'surface',tileAt(site,low)),{stored:10,reserved:8,incoming:4,used:18,free:298});
  assert.deepEqual(depotUsage(s,'surface',tileAt(site,high)),{stored:30,reserved:5,incoming:6,used:35,free:279});
  assert.equal(depotUsage(s,'surface',tileAt(site,high),s.crew[1]).free,285);
  assert.equal(JSON.stringify(s),before);
});

test('food projection resolves the destination galley on its actual deck',()=>{
  const {s,site}=fixture(),source=tileAt(site,high),destination={x:2,y:1,z:4};
  source.stock={food:4,_food:[{amount:2,age:50,meal:{id:'meal-job-1',maker:'crew-0',quality:1,created:0}},{amount:2,age:0,kind:'fungalcap'}]};
  tileAt(site,destination).building='galley';tileAt(site,{...destination,z:0}).building='stockpile';
  s.crew=[crew('cook',{intent:haul(high,{food:1},{kind:'input',target:destination})})];
  const before=JSON.stringify(s),selector={rawOnly:true,foodKinds:{fungalcap:10}};
  assert.equal(availableInventory(s,'surface',high,'stock','food',null,selector),1,'galley pickup reserves raw food and leaves prepared portions');
  assert.equal(JSON.stringify(s),before);
  s.crew[0].intent.destination.target=[2,1];
  assert.equal(availableInventory(s,'surface',high,'stock','food',null,selector),2,'ground non-galley pickup selects the older prepared portion');
});

test('foreign, malformed and missing-deck queries never alias stock',()=>{
  const {s}=fixture();s.crew=[crew('claim',{intent:haul(high,{alloy:3})})];
  for(const bad of [null,[],[1],[1,1,4],{x:1,y:1},{...high,z:null},{...high,z:'4'},{...high,z:99},{...high,x:.5},{...high,site:'wreck'}]) {
    assert.equal(availableInventory(s,'surface',bad,'stock','alloy'),0);
    assert.equal(outgoingInventory(s,'surface',bad,'stock','alloy'),0);
    assert.equal(hasOutgoingInventory(s,'surface',bad,'stock'),false);
    assert.equal(incomingInventory(s,'surface',{kind:'stock',target:bad},'alloy'),0);
  }
  assert.equal(sameInventoryLocation('surface',high,{...high,site:'wreck'}),false);
  assert.equal(sameInventoryLocation('surface',high,{...high,site:'surface'}),true);
  const p=inventoryPosition('surface',high);p.x=99;assert.equal(high.x,1);
});
