import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,serialize} from '../src/simulation.js';
import {tileAt} from '../src/spatial.js';
import {initializeStorage} from '../src/inventory.js';
import {initializeElectrical} from '../src/power.js';
import {newPipe} from '../src/gas-networks.js';
import {newWaterPipe} from '../src/plumbing.js';
import {executeAction,controlBindings,actionCatalog} from '../src/controls.js';
import {startRecording,exportRecording} from '../src/telemetry.js';

const specs=[
 ['gas.valve','setGasValve','gasPipe',{open:false},t=>t.pipe.open,false,'gas.valve.changed'],
 ['gas.device','setGasDevice','gasPump',{enabled:false,direction:'se',target:90},t=>t.gasDevice,{enabled:false,direction:'se'},'gas.device.changed'],
 ['gas.extractor','setGasExtractor','gasExtractor',{enabled:false,mode:'exhaust',target:50},t=>t.gasDevice,{enabled:false,mode:'exhaust',target:50},'gas.extractor.changed'],
 ['plumbing.valve','setWaterValve','waterPipe',{open:false},t=>t.waterPipe.open,false,'plumbing.valve.changed'],
 ['plumbing.pump','setWaterPump','waterPump',{enabled:false,direction:'se'},t=>t.waterDevice,{enabled:false,direction:'se'},'plumbing.device.changed'],
 ['plumbing.intake','setWaterIntake','waterIntake',{enabled:false,direction:'se',mode:'floor'},t=>t.waterDevice,{enabled:false,direction:'se',mode:'floor'},'plumbing.device.changed'],
 ['plumbing.outlet','setWaterOutlet','waterOutlet',{enabled:false,direction:'se',mode:'floor'},t=>t.waterDevice,{enabled:false,direction:'se',mode:'floor'},'plumbing.device.changed'],
 ['water.tank','setTank','waterTank',{fill:false,drain:true},t=>({fill:t.machine.enabled,drain:t.tank.drain}),{fill:false,drain:true},'water.tank.changed'],
 ['reactor.configure','setReactor','reactor',{percent:25,enabled:false},t=>({percent:t.reactor.output,enabled:t.machine.enabled}),{percent:25,enabled:false},'reactor.controls.changed'],
 ['reactor.reset','resetReactor','reactor',{},t=>t.reactor.tripped,false,'reactor.reset'],
 ['radiator.configure','setRadiator','radiator',{enabled:false},t=>t.radiator.enabled,false,'radiator.controls.changed'],
 ['climate.configure','setClimate','climate',{target:12,enabled:false},t=>({target:t.climate.target,enabled:t.climate.enabled}),{target:12,enabled:false}],
 ['power.priority','setPowerPriority','scrubber',{priority:5},t=>t.powerPriority,5],
 ['power.breaker','setBreaker','breaker',{enabled:false,direction:'se',mode:'wet_fault'},t=>({enabled:t.protection.enabled,direction:t.protection.direction,mode:t.protection.mode}),{enabled:false,direction:'se',mode:'wet_fault'},'power.breaker.changed'],
 ['power.breaker.reset','resetBreaker','breaker',{},t=>t.protection.tripped,false,'power.breaker.reset'],
 ['power.cable','setCableEnabled','cable',{enabled:false},t=>t.cable.enabled,false,'power.cable.changed'],
];
const tile=(s,z)=>tileAt(s.sites.surface,{x:3,y:3,z});
function fixture(spec){
 const s=createGame(74219),site=s.sites.surface,blank=site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.flora);
 site.levels.push({z:7,name:'Upper test deck'});
 for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z:7,terrain:'ground',building:null});
 for(const z of [0,7]){
  const t=tile(s,z);t.building=['gasPipe','waterPipe','cable'].includes(spec[2])?null:spec[2];t.terrain='ground';t.hp=100;initializeStorage(t);initializeElectrical(t);
  if(spec[2]==='gasPipe')t.pipe=newPipe();if(spec[2]==='waterPipe')t.waterPipe=newWaterPipe();if(spec[2]==='cable')t.cable={hp:100,enabled:true};
  if(spec[0]==='reactor.reset')t.reactor.tripped=true;if(spec[0]==='power.breaker.reset'){t.protection.tripped=true;t.protection.cause='wet_fault';}
 }
 return s;
}
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

for(const spec of specs)test(`${spec[0]} targets the named deck with identical player and agent results`,()=>{
 const [id,binding,,params,read,expected,event]=spec,s=fixture(spec),copy=structuredClone(s),ground=structuredClone(read(tile(s,0)));
 startRecording(s);const result=executeAction(s,id,{site:'surface',x:3,y:3,...params,z:7});assert.equal(result.ok,true,result.message);
 const player=controlBindings(()=>copy)[binding](copy,'surface',3,3,...Object.values(params),7);assert.equal(player.ok,true,player.message);
 assert.deepEqual(read(tile(s,0)),ground);assert.deepEqual(read(tile(s,7)),expected);assert.equal(serialize(s),serialize(copy));
 if(event)assert.equal(events(s).find(e=>e.id===event).entity,'tile:surface:3:3:7');
});

test('omitted deck preserves legacy ground targeting and catalog advertises optional deck',()=>{
 for(const spec of specs){const s=fixture(spec),before=structuredClone(spec[4](tile(s,7))),definition=actionCatalog().find(a=>a.id===spec[0]);
  assert.equal(definition.parameters.properties.z.type,'integer');assert.ok(!definition.parameters.required.includes('z'));
  assert.equal(controlBindings(()=>s)[spec[1]](s,'surface',3,3,...Object.values(spec[3])).ok,true);
  assert.deepEqual(spec[4](tile(s,0)),spec[5]);assert.deepEqual(spec[4](tile(s,7)),before);
 }
});

test('malformed or undeclared decks reject before any equipment state changes',()=>{
 for(const spec of specs){const s=fixture(spec),before=serialize(s);
  for(const z of [null,'7',.5,8,-1,Number.MAX_SAFE_INTEGER+1]){const result=executeAction(s,spec[0],{site:'surface',x:3,y:3,...spec[3],z});assert.equal(result.code,'invalid_arguments');assert.equal(serialize(s),before);}
 }
 const s=createGame(),before=serialize(s);assert.equal(executeAction(s,'job.order',{site:'surface',x:3,y:3,z:8,kind:'build',building:'wall'}).code,'invalid_arguments');assert.equal(serialize(s),before);
});

test('upper breaker and reactor safety checks cannot be bypassed by selecting another deck',()=>{
 const breaker=specs.find(s=>s[0]==='power.breaker'),s=fixture(breaker),upper=tile(s,7);upper.protection.enabled=true;
 let before=serialize(s);let result=executeAction(s,breaker[0],{site:'surface',x:3,y:3,z:7,...breaker[3]});assert.equal(result.ok,false);assert.match(result.message,/Open the breaker/);assert.equal(serialize(s),before);
 const reactor=specs.find(s=>s[0]==='reactor.reset'),r=fixture(reactor);tile(r,7).reactor.heat=1000;before=serialize(r);result=executeAction(r,reactor[0],{site:'surface',x:3,y:3,z:7});assert.equal(result.ok,false);assert.match(result.message,/cool/);assert.equal(serialize(r),before);
});
