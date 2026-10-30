import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, step, serialize, deserialize} from '../src/simulation.js';
import {executeAction} from '../src/controls.js';
import {positionOf, tileAt} from '../src/spatial.js';
import {totalResources, syncResources} from '../src/inventory.js';
import {itemOwners} from '../src/item-lots.js';
import {startRecording, exportRecording, observe} from '../src/telemetry.js';
import {injure} from '../src/medicine.js';

const act=(s,id,args={})=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);return r;};
const at=(s,x,y)=>tileAt(s.sites.surface,{x,y,z:0});
const records=s=>exportRecording(s).trim().split('\n').map(JSON.parse);
const events=s=>records(s).filter(r=>r.event).map(r=>r.event);
const exact=s=>{syncResources(s);const text=serialize(s);assert.ok(serialize(deserialize(text))===text,'current colony roundtrip is byte-exact');};
function until(s,label,p,limit=180){for(let n=0;n<limit&&!p();n++)step(s);assert.ok(p(),`${label} missing at tick ${s.tick}: ${s.crew.at(-1).activity}`);}
function quietIndustry(s){
  for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')act(s,'production.enable',{site:site.id,...positionOf(t),enabled:false});
}
function recruit(s){act(s,'population.contact');act(s,'population.respond',{offer:s.population.offer.id,accept:true});}

// Native player actions, original supplies and ordinary ticks only. No spawned equipment,
// granted resources, moved people, repaired health or changed needs in this scenario.
test('a newcomer lands, eats finite food, owns a bunk and manufactures through paid industry',()=>{
  const s=createGame(74251);quietIndustry(s);startRecording(s);
  for(const c of s.crew)act(s,'crew.labor',{crew:c.id,labor:'production',enabled:false});
  const before=totalResources(s);
  for(const [x,building] of [[11,'toolbench'],[12,'galley']])act(s,'job.order',{site:'surface',x,y:8,z:0,kind:'build',building});
  recruit(s);
  let configured=0;
  for(let n=0;n<30;n++){
    step(s);
    for(const [index,x] of [11,12].entries())if(!(configured&(1<<index))&&at(s,x,8).machine){
      act(s,'production.order',{site:'surface',x,y:8,z:0,mode:'batches',limit:1});configured|=1<<index;
    }
  }
  assert.equal(configured,3,'both paid workstations constructed before landing');
  const c=s.crew[7];assert.equal(c.id,'crew-7');assert.equal(s.crew.length,8);
  assert.equal(c.health,100);assert.equal(c.site,'surface');
  const arrivals=events(s).filter(e=>e.id==='crew.arrived');assert.equal(arrivals.length,1);
  assert.deepEqual(arrivals[0].landing,{x:16,y:11,z:0});assert.equal(arrivals[0].actor,c.id);
  assert.equal(arrivals[0].target,'tile:surface:16:11');
  act(s,'housing.assign',{site:'surface',x:9,y:7,z:0,crew:c.id});
  exact(s);
  until(s,'newcomer finishes first meal',()=>c.hunger>35&&c.intent?.type!=='meal',70);
  assert.ok(c.hunger>35);assert.ok(c.x!==16||c.y!==11,'walked away from the landing pad');
  const portions=events(s).filter(e=>e.id==='meal.portion.eaten'&&e.actor===c.id);
  assert.equal(portions.reduce((sum,e)=>sum+e.food,0),1,'eight finite portions consumed');
  until(s,'newcomer completes both production batches',()=>at(s,11,8).machine.completed===1&&at(s,12,8).machine.completed===1,180);
  for(const id of ['tool.crafted','meal.prepared'])assert.ok(events(s).some(e=>e.id===id&&e.actor===c.id),id);
  assert.equal(totalResources(s).alloy,before.alloy-14);assert.equal(totalResources(s).components,before.components-3);
  assert.ok(totalResources(s).food<=before.food-1,'cooking did not create extra rations');
  assert.deepEqual(c.housing.bunk,{x:9,y:7,z:0});
  const tool=itemOwners(s).flatMap(o=>o.inventory?._items||[]).find(i=>i.maker===c.id);
  assert.ok(tool,'post-founder item has physical custody');exact(s);
  const beforeObservation=serialize(s);observe(s);assert.equal(serialize(s),beforeObservation);
  for(const field of ['_items','_food'])for(const invalid of ['unknown','predates']){
    const bad=JSON.parse(serialize(s));let changed=false;
    function forge(value){if(!value||typeof value!=='object')return;if(Array.isArray(value[field]))for(const lot of value[field]){const metadata=field==='_items'?lot:lot.meal;if(metadata?.maker===c.id){if(invalid==='unknown')metadata.maker='crew-63';else metadata.created=29;changed=true;}}for(const child of Object.values(value))if(child&&typeof child==='object')forge(child);}
    forge(bad);assert.ok(changed,`${field} maker exists`);assert.throws(()=>deserialize(JSON.stringify(bad)),/meal|item|provenance/i);
  }
  for(const peer of s.crew)act(s,'crew.routine',{crew:peer.id,policy:'rest'});
  until(s,'newcomer forms a social bond',()=>Object.values(c.relationships).some(b=>b.interactions>0),90);
  const [peerId,bond]=Object.entries(c.relationships).find(([,b])=>b.interactions>0);
  assert.ok(bond.affinity>0);assert.ok(s.crew.find(peer=>peer.id===peerId).relationships[c.id].interactions>0);exact(s);
});

test('a recruited patient uses a paid cot and existing medicine custody',()=>{
  const s=createGame(74252);quietIndustry(s);
  act(s,'job.order',{site:'surface',x:10,y:9,z:0,kind:'build',building:'medicalCot'});recruit(s);step(s,30);
  const c=s.crew[7];until(s,'arrival eats',()=>c.hunger>70,70);
  assert.equal(at(s,10,9).building,'medicalCot');
  const medicine=totalResources(s).medicine;
  // Controlled injury isolates the existing treatment path; no healing or movement grants.
  injure(s,c,30,'recruitment integration fixture');
  until(s,'newcomer receives delivered medicine',()=>c.medical.treated>0,160);
  assert.equal(totalResources(s).medicine,medicine-1);assert.ok(c.health<100);
  assert.ok(s.crew.some(peer=>peer.id!==c.id&&peer.skills.medicine.xp>0));exact(s);
});
