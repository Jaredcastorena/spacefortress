import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,serialize} from '../src/simulation.js';
import {tileAt} from '../src/spatial.js';
import {initializeStorage,totalResources} from '../src/inventory.js';
import {initializeElectrical} from '../src/power.js';
import {updateRooms,roomAt} from '../src/atmosphere.js';
import {roomDesignation} from '../src/rooms.js';
import {bunkOwner} from '../src/housing.js';
import {scheduleProduction} from '../src/production.js';
import {executeAction,controlBindings,actionCatalog} from '../src/controls.js';

const specs=[
 ['depot.accept','setDepotAccepted','stockpile',{resource:'waste',enabled:false},t=>t.storage.accepted.includes('waste'),false],
 ['depot.priority','setDepotPriority','stockpile',{priority:5},t=>t.storage.priority,5],
 ['production.recipe','setProductionRecipe','farm',{recipe:'sunberry'},t=>t.machine.recipeId,'sunberry'],
 ['production.order','setProductionOrder','farm',{mode:'batches',limit:2},t=>t.machine.order.remaining,2],
 ['production.priority','setProductionPriority','farm',{priority:5},t=>t.machine.order.priority,5],
 ['production.enable','setMachineEnabled','farm',{enabled:false},t=>t.machine.enabled,false],
 ['maintenance.auto','setAutoService','refinery',{enabled:true},t=>t.maintenance.auto,true],
 ['room.designate','setRoomDesignation',null,{role:'quarters'},(t,s)=>roomDesignation(s.sites.surface,roomAt(s.sites.surface,t.x,t.y,t.z)).role,'quarters',[8,8]],
 ['housing.assign','setBunkOwner','bunk',{crew:'crew-0'},(t,s)=>bunkOwner(s,'surface',t.x,t.y,t.z)?.id||null,'crew-0'],
 ['pasture.gate','setPastureGate','pastureGate',{mode:'open'},t=>t.gateMode,'open'],
 ['door.mode','setDoorMode','door',{mode:'closed'},t=>t.doorMode,'closed'],
];
const point=spec=>spec[6]||[3,3];
const tile=(s,spec,z)=>tileAt(s.sites.surface,{x:point(spec)[0],y:point(spec)[1],z});
function fixture(spec){
 const s=createGame(74219),site=s.sites.surface;site.levels.push({z:7,name:'Upper test deck'});site.tiles.push(...site.tiles.map(t=>({...structuredClone(t),z:7})));updateRooms(site);
 for(const z of [0,7]){const t=tile(s,spec,z);t.building=spec[2];t.hp=100;if(spec[0]!=='room.designate')t.terrain='ground';initializeStorage(t);initializeElectrical(t);if(t.building==='pastureGate')t.gateMode='latched';if(t.building==='door'){t.doorMode='auto';t.doorUntil=0;}}
 return s;
}
const act=(s,spec,z=7)=>executeAction(s,spec[0],{site:'surface',x:point(spec)[0],y:point(spec)[1],...spec[3],z});
for(const spec of specs)test(`${spec[0]} changes only the selected deck with player/agent parity`,()=>{
 const s=fixture(spec),copy=structuredClone(s),before=structuredClone(spec[4](tile(s,spec,0),s));
 const a=act(s,spec),b=controlBindings(()=>copy)[spec[1]](copy,'surface',...point(spec),...Object.values(spec[3]),7);assert.equal(a.ok,true,a.message);assert.equal(b.ok,true,b.message);
 assert.deepEqual(spec[4](tile(s,spec,0),s),before);assert.deepEqual(spec[4](tile(s,spec,7),s),spec[5]);assert.equal(serialize(s),serialize(copy));
});

test('colony controls retain ground defaults and reject undeclared decks without mutation',()=>{
 for(const spec of specs){const s=fixture(spec),before=serialize(s),upper=structuredClone(spec[4](tile(s,spec,7),s));assert.equal(act(s,spec,8).code,'invalid_arguments');assert.equal(serialize(s),before);
  const definition=actionCatalog().find(a=>a.id===spec[0]);assert.ok(!definition.parameters.required.includes('z'));
  assert.equal(controlBindings(()=>s)[spec[1]](s,'surface',...point(spec),...Object.values(spec[3])).ok,true);assert.deepEqual(spec[4](tile(s,spec,7),s),upper);
 }
});

function jobPair(s){
 s.jobs=[0,7].map((z,i)=>({id:`operation-${z}`,kind:'operate',site:'surface',x:3,y:3,z,building:'farm',worker:s.crew[i].id,priority:1,materials:{},sources:[]}));
 s.crew[0].job=s.jobs[0].id;s.crew[1].job=s.jobs[1].id;return s.jobs;
}

test('pausing and stopping production release only the actual workstation and operator',()=>{
 for(const id of ['production.enable','production.order']){const spec=specs.find(p=>p[0]===id),s=fixture(spec),[ground,upper]=jobPair(s),lower=structuredClone(ground);
  const params=id==='production.enable'?{enabled:false}:{mode:'batches',limit:0};const result=executeAction(s,id,{site:'surface',x:3,y:3,z:7,...params});assert.equal(result.ok,true);assert.deepEqual(s.jobs,[lower]);assert.equal(s.crew[0].job,ground.id);assert.equal(s.crew[1].job,null);assert.ok(!s.jobs.includes(upper));
 }
 const spec=specs.find(p=>p[0]==='production.priority'),s=fixture(spec),[ground,upper]=jobPair(s);assert.equal(act(s,spec).ok,true);assert.equal(ground.priority,1);assert.equal(upper.priority,5);
});

test('recipe changes preserve committed material and clear only matching waiting haul claims',()=>{
 const spec=specs.find(p=>p[0]==='production.recipe'),s=fixture(spec),lower=tile(s,spec,0),upper=tile(s,spec,7);
 upper.machine.input={water:8,fertilizer:1};upper.machine.batch={water:1,fertilizer:.25};upper.machine.batchRecipeId='fungalcap';upper.machine.progress=3;
 for(const [i,z] of [0,7].entries())s.crew[i].intent={type:'haul',destination:{kind:'input',target:{x:3,y:3,z}},items:{water:1}};
 const before=totalResources(s),old=structuredClone(lower.machine),batch=structuredClone(upper.machine.batch);assert.equal(act(s,spec).ok,true);
 assert.deepEqual(totalResources(s),before);assert.deepEqual(lower.machine,old);assert.deepEqual(upper.machine.batch,batch);assert.equal(upper.machine.batchRecipeId,'fungalcap');assert.equal(upper.machine.progress,3);assert.equal(upper.drop.water,5);assert.equal(lower.drop,null);
 assert.ok(s.crew[0].intent);assert.equal(s.crew[1].intent,null);
});

test('room clearing and doorway occupancy distinguish upstairs and downstairs',()=>{
 const spec=specs.find(p=>p[0]==='room.designate'),s=fixture(spec);act(s,spec,0);act(s,spec,7);
 assert.equal(executeAction(s,'room.designate',{site:'surface',x:8,y:8,z:7,role:'general'}).ok,true);assert.deepEqual(s.sites.surface.designations,[{x:8,y:8,z:0,role:'quarters'}]);
 const door=specs.find(p=>p[0]==='door.mode'),d=fixture(door);Object.assign(d.crew[0],{site:'surface',x:3,y:3,z:0});assert.equal(act(d,door).ok,true);
 tile(d,door,7).doorMode='auto';d.crew[0].z=7;const before=serialize(d);assert.equal(act(d,door).ok,false);assert.equal(serialize(d),before);
});

test('upper automatic production preserves the deck in its scheduled order',()=>{
 const spec=[...specs.find(p=>p[0]==='production.order')];spec[2]='refinery';const s=fixture(spec),calls=[];
 for(const t of s.sites.surface.tiles)if(t.machine)t.machine.enabled=false;
 const upper=tile(s,spec,7);upper.machine.enabled=true;upper.powered=true;upper.machine.input={ore:1};
 scheduleProduction(s,(...args)=>{calls.push(args);return {ok:false,message:'No worker route'};});
 assert.equal(calls.length,1,upper.machine.status);assert.equal(calls[0][6],7);assert.match(upper.machine.status,/No worker route/);
});
