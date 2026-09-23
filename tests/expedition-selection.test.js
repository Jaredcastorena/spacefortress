import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, launch, cancelDeparture, step, at, order, serialize, deserialize} from '../src/simulation.js';
import {extract, totalResources, syncResources} from '../src/inventory.js';
import {refillMix} from '../src/preflight.js';

const check=s=>deserialize(serialize(s));
const loading=s=>s.jobs.find(j=>j.kind==='loadShuttle');
const until=(s,p,max=250)=>{for(let i=0;i<max&&!p();i++)step(s);assert.ok(p(),`Condition not reached: ${s.departure?.status}`);};
function held(s,c){c.carry=extract(at(s.sites.surface,8,10).stock,{alloy:1});syncResources(s);}

test('explicit nonfirst crew and reversed order are preserved while their own suit deficits set finite supply targets',()=>{
 const s=createGame(),pair=[s.crew[6],s.crew[4]];pair[0].oxygen=60;pair[1].oxygen=80;
 const chosen=pair.map(c=>c.id),expected=[...chosen],before=totalResources(s);
 assert.equal(launch(s,'wreck',chosen).ok,true);assert.deepEqual(s.departure.crew,expected);
 assert.equal(s.departure.target.air,Math.ceil(10+refillMix(pair)));assert.equal(loading(s).cost.air,s.departure.target.air);
 assert.equal(s.mission,null);assert.ok(pair.every(c=>c.site==='surface'));assert.deepEqual(totalResources(s),before);
 chosen.reverse();assert.deepEqual(s.departure.crew,expected,'the manifest owns its copied order');check(s);
});

test('wrong-sized, duplicate, unknown and wrongly typed explicit manifests reject atomically',()=>{
 const ids=createGame().crew.map(c=>c.id);
 for(const chosen of [null,false,[],[ids[0]],[ids[0],ids[1],ids[2]],[ids[0],ids[0]],[ids[0],'crew-does-not-exist'],[ids[0],7],{0:ids[0],1:ids[1],length:2},[ids[0],undefined]]){
  const s=createGame(),before=structuredClone(s);
  assert.equal(launch(s,'wreck',chosen).ok,false,JSON.stringify(chosen));assert.deepEqual(s,before);
 }
});

test('an explicitly unavailable selected member is rejected without substituting a ready colonist',()=>{
 for(const makeUnavailable of [c=>c.life.policy='rest',c=>{c.health=99;c.medical.injury=1;},(c,s)=>held(s,c)]){
  const s=createGame(),selected=s.crew[5];makeUnavailable(selected,s);const before=structuredClone(s);
  assert.equal(launch(s,'wreck',[s.crew[4].id,selected.id]).ok,false);assert.deepEqual(s,before);
  assert.equal(s.departure,null);assert.equal(s.mission,null);assert.equal(loading(s),undefined);check(s);
 }
});

test('initial selection keeps the established readiness boundaries and rejects each blocking claim',()=>{
 const cases=[
  ['health at limit',c=>c.health=50,false],['health above limit',c=>c.health=51,true],
  ['dead',c=>c.health=0,false],
  ['oxygen at limit',c=>c.oxygen=50,false],['oxygen above limit',c=>c.oxygen=51,true],
  ['energy below limit',c=>c.energy=39.9,false],['energy at limit',c=>c.energy=40,true],
  ['hunger below limit',c=>c.hunger=39.9,false],['hunger at limit',c=>c.hunger=40,true],
  ['hot boundary',c=>c.thermalStress=45,false],['inside hot boundary',c=>c.thermalStress=44.9,true],
  ['cold boundary',c=>c.thermalStress=-45,false],['inside cold boundary',c=>c.thermalStress=-44.9,true],
  ['off duty',c=>c.life.policy='rest',false],['away',c=>c.site='wreck',false],
  ['injured',c=>{c.health=99;c.medical.injury=1;},false],
  ['recovery intent',c=>c.intent={type:'rest',target:null},false],
  ['rescue claim',c=>c.rescue={patient:'crew-1'},false],
  ['held cargo',(c,s)=>held(s,c),false],
 ];
 for(const [label,change,eligible] of cases){
  const s=createGame(),selected=s.crew[5];change(selected,s);const before=structuredClone(s),ids=[selected.id,s.crew[4].id];
  assert.equal(launch(s,'wreck',ids).ok,eligible,label);
  if(eligible){assert.deepEqual(s.departure.crew,ids,label);check(s);}else assert.deepEqual(s,before,label);
 }
});

test('omitting the manifest preserves the first eligible pair and explicit undefined has the same behavior',()=>{
 const a=createGame(),b=createGame();
 for(const s of [a,b]){s.crew[0].life.policy='rest';held(s,s.crew[2]);}
 assert.ok(launch(a,'wreck').ok);assert.ok(launch(b,'wreck',undefined).ok);
 assert.deepEqual(a.departure.crew,[a.crew[1].id,a.crew[3].id]);assert.deepEqual(a,b);check(a);
});

test('a real current job does not exclude otherwise ready crew from the chosen departure manifest',()=>{
 const s=createGame();for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 const result=order(s,'surface',11,9,'build','bunk');assert.ok(result.ok);
 until(s,()=>s.crew.some(c=>c.job===result.job.id&&!c.intent&&!c.carry));
 const worker=s.crew.find(c=>c.job===result.job.id&&!c.intent&&!c.carry),other=s.crew.find(c=>c!==worker&&!c.intent&&!c.carry);
 const job=worker.job;assert.ok(launch(s,'wreck',[other.id,worker.id]).ok);
 assert.deepEqual(s.departure.crew,[other.id,worker.id]);assert.equal(worker.job,job,'loading does not teleport or erase ordinary work');check(s);
});

test('cancelling a supplied manifest permits a different exact team while retaining real reserved and carried materials',()=>{
 const s=createGame(),first=[s.crew[6].id,s.crew[4].id],second=[s.crew[5].id,s.crew[3].id];
 assert.ok(launch(s,'wreck',first).ok);
 until(s,()=>s.crew.some(c=>c.delivery?.job===loading(s)?.id&&c.carry));
 const carrier=s.crew.find(c=>c.delivery?.job===loading(s)?.id&&c.carry),cargo=structuredClone(carrier.carry),before=totalResources(s);
 assert.ok(cancelDeparture(s).ok);assert.equal(s.departure,null);assert.equal(loading(s),undefined);
 assert.deepEqual(carrier.carry,cargo);assert.equal(carrier.delivery,null);assert.deepEqual(totalResources(s),before);
 // The new team is chosen from ready crew; the old load remains physically held.
 const replacement=second.includes(carrier.id)?s.crew.filter(c=>c!==carrier&&!first.includes(c.id)&&!c.intent&&!c.carry).slice(-2).map(c=>c.id):second;
 assert.ok(launch(s,'wreck',replacement).ok);assert.deepEqual(s.departure.crew,replacement);
 assert.notDeepEqual(s.departure.crew,first);assert.deepEqual(totalResources(s),before);assert.deepEqual(carrier.carry,cargo);check(s);
});

test('explicit selection retains initial destination, salvage, comet, shuttle condition and shuttle work gates',()=>{
 const cases=[
  {site:'surface',change:()=>{}},
  {site:'unknown',change:()=>{}},
  {site:'solar',change:()=>{}},
  {site:'comet',change:()=>{}},
  {site:'wreck',change:s=>at(s.sites.surface,16,11).hp=49},
  {site:'wreck',change:s=>{at(s.sites.surface,16,11).hp=70;assert.ok(order(s,'surface',16,11,'repair').ok);}},
 ];
 for(const entry of cases){
  const s=createGame();entry.change(s);const before=structuredClone(s);
  assert.equal(launch(s,entry.site,[s.crew[6].id,s.crew[4].id]).ok,false);assert.deepEqual(s,before);
 }
 const s=createGame();s.flags.salvageReturned=true;assert.ok(launch(s,'solar',[s.crew[6].id,s.crew[4].id]).ok);
 assert.deepEqual(s.departure.crew,[s.crew[6].id,s.crew[4].id]);assert.equal(s.departure.target.alloy,6);assert.equal(s.departure.target.components,2);check(s);
});

test('a pending selected manifest cannot be silently replaced by another launch request',()=>{
 const s=createGame(),first=[s.crew[6].id,s.crew[4].id];assert.ok(launch(s,'wreck',first).ok);const before=structuredClone(s);
 assert.equal(launch(s,'wreck',[s.crew[1].id,s.crew[2].id]).ok,false);assert.deepEqual(s,before);assert.deepEqual(s.departure.crew,first);check(s);
});
