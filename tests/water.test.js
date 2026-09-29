import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, serialize, deserialize, setLabor, recall } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources, quantity } from '../src/inventory.js';
import { setMachineEnabled } from '../src/industry.js';
import { setProductionOrder } from '../src/production.js';
import { refreshPower, setCableEnabled } from '../src/power.js';
import { setDepotAccepted } from '../src/storage.js';
import { waterSupply, initializeWater } from '../src/water.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
import { executeAction } from '../src/controls.js';
import { depart } from './helpers/depart.js';

const check = s => deserialize(serialize(s));
const until = (s, predicate, limit = 220) => {
  for (let i = 0; i < limit && !predicate(); i++) { step(s); check(s); }
  assert.ok(predicate(), `Condition missing at tick ${s.tick}`);
};
function colony({ processor = true, hauling = true } = {}) {
  const s = createGame(), site = s.sites.surface, depot = at(site,8,10), tile = at(site,12,10);
  for (const t of site.tiles) if (t.machine && t.building !== 'scrubber') setMachineEnabled(s,'surface',t.x,t.y,false);
  for (const c of s.crew) setLabor(s,c.id,'hauling',hauling);
  if (processor) install(s,tile,'iceProcessor');
  return { s, site, depot, tile, m: tile.machine };
}
function install(s,t,building) {
  t.building = building; initializeStorage(t); t.cable = { hp:100, enabled:true }; refreshPower(s,s.sites.surface);
}

test('finite reserves are separate from inventories, and processing needs delivered construction supplies', () => {
  const {s,site,depot,tile} = colony({processor:false}); const before = totalResources(s);
  assert.equal(before.ice,0); assert.equal(waterSupply(s).unminedIce,72); assert.equal(waterSupply(s).processors,0); assert.ok(quantity(depot.stock)<320);
  assert.equal(order(s,'surface',17,14,'build','floor').ok,false);
  assert.equal(order(s,'surface',11,14,'build','iceProcessor').ok,false);
  const job = order(s,'surface',12,10,'build','iceProcessor').job; assert.ok(job); assert.equal(totalResources(s).alloy,before.alloy);
  until(s,()=>!s.jobs.includes(job)); assert.equal(tile.building,'iceProcessor'); assert.equal(totalResources(s).alloy,before.alloy-6); assert.equal(totalResources(s).components,before.components-1); check(s);
});

test('mining cancellation preserves reserves; completed extraction leaves physical ice and exhausts the seam', () => {
  const {s,site} = colony({processor:false,hauling:false}), seam=at(site,17,14);
  const job = order(s,'surface',17,14,'mine').job; step(s); cancelJob(s,job.id); assert.equal(seam.deposit.remaining,12); assert.equal(totalResources(s).ice,0);
  for (const expected of [6,0]) {
    const j=order(s,'surface',17,14,'mine').job; assert.ok(j); until(s,()=>!s.jobs.includes(j)); assert.equal(seam.deposit.remaining,expected); assert.equal(seam.drop.ice,12-expected); assert.equal(s.resources.ice,0);
  }
  assert.equal(order(s,'surface',17,14,'mine').ok,false); assert.equal(totalResources(s).ice,12); initializeWater(s); assert.equal(seam.deposit.remaining,0);check(s);
});

test('real extraction and hauling feed a processor before recovered water reaches crops', () => {
  const {s,site,depot,m}=colony(); depot.stock.water=0; syncResources(s);
  const farm=at(site,7,9);setMachineEnabled(s,'surface',7,9,true);setProductionOrder(s,'surface',7,9,'batches',1);setProductionOrder(s,'surface',12,10,'batches',1);
  const before=totalResources(s);const j=order(s,'surface',17,14,'mine').job;assert.ok(j);
  until(s,()=>m.progress>0);assert.equal(totalResources(s).water,0);assert.equal(totalResources(s).ice,6);assert.equal(farm.machine.completed,0);
  until(s,()=>farm.machine.completed===1);assert.equal(m.completed,1);assert.equal(totalResources(s).ice,4);assert.equal(totalResources(s).water,1);assert.equal(totalResources(s).food,before.food+2);check(s);
});

test('a processor waits for a full delivered batch and an adjacent operator',()=>{
  const {s,m,tile}=colony({hauling:false});m.input.ice=1;step(s,5);assert.match(m.status,/ice/);assert.equal(m.input.ice,1);assert.equal(m.progress,0);
  m.input.ice=2;for(const c of s.crew)setLabor(s,c.id,'production',false);step(s,5);assert.equal(m.progress,0);
  const c=s.crew[6];setLabor(s,c.id,'production',true);until(s,()=>m.progress>0);assert.equal(Math.abs(c.x-tile.x)+Math.abs(c.y-tile.y),1);assert.deepEqual(m.batch,{ice:2});
  until(s,()=>m.completed===1);assert.equal(m.output.water,2);assert.equal(totalResources(s).ice,0);check(s);
});

test('power loss preserves frozen ingredients and progress while thirsty crops wait',()=>{
  const {s,site,depot,m}=colony();depot.stock.water=0;depot.stock.ice=2;syncResources(s);const farm=at(site,7,9);setMachineEnabled(s,'surface',7,9,true);setProductionOrder(s,'surface',7,9,'batches',1);setProductionOrder(s,'surface',12,10,'batches',1);
  until(s,()=>m.progress>2);const progress=m.progress;setCableEnabled(s,'surface',12,10,false);step(s,15);assert.equal(m.progress,progress);assert.deepEqual(m.batch,{ice:2});assert.equal(farm.machine.completed,0);assert.match(farm.machine.status,/water/);
  setCableEnabled(s,'surface',12,10,true);until(s,()=>farm.machine.completed===1);assert.equal(m.completed,1);assert.equal(totalResources(s).ice,0);assert.equal(totalResources(s).water,1);
});

test('ice output also supplies medicine, nutrient recycling and atmosphere production through depots',()=>{
  for(const [building,input,output] of [['medlab',{food:1},{medicine:2}],['recycler',{waste:1},{fertilizer:.25}],['atmosphere',{}, {air:10}]]) {
    const {s,site,depot,m}=colony();depot.stock.water=0;depot.stock.ice=2;Object.assign(depot.stock,input);syncResources(s);
    const consumer=at(site,13,8);install(s,consumer,building);setProductionOrder(s,'surface',13,8,'batches',1);setProductionOrder(s,'surface',12,10,'batches',1);
    until(s,()=>consumer.machine.completed===1);assert.equal(m.completed,1);assert.equal(totalResources(s).ice,0);assert.deepEqual(consumer.machine.output,output);assert.ok(totalResources(s).water>0);check(s);
  }
});

test('depot rejection blocks mined ice until accepted without teleporting it to the processor',()=>{
  const {s,site,m}=colony();setDepotAccepted(s,'surface',8,10,'ice',false);const job=order(s,'surface',17,14,'mine').job;until(s,()=>!s.jobs.includes(job));step(s,10);
  assert.equal(at(site,17,14).drop.ice,6);assert.equal(m.completed,0);setDepotAccepted(s,'surface',8,10,'ice',true);until(s,()=>m.completed===1);check(s);
});

test('blocked water storage fills output, halts new batches and resumes after acceptance',()=>{
  const {s,depot,m}=colony();delete depot.stock.water;depot.stock.ice=16;syncResources(s);setDepotAccepted(s,'surface',8,10,'water',false);
  until(s,()=>m.completed===6);step(s,8);assert.equal(m.output.water,12);assert.match(m.status,/Output full/);assert.equal(totalResources(s).ice,4);
  setDepotAccepted(s,'surface',8,10,'water',true);until(s,()=>m.completed===7);check(s);
});

test('stock targets count promised water and pause/resume never duplicates a started batch',()=>{
  const {s,depot,m}=colony();depot.stock.water=0;depot.stock.ice=8;syncResources(s);setProductionOrder(s,'surface',12,10,'stock',4);
  until(s,()=>m.progress>0);setMachineEnabled(s,'surface',12,10,false);const batch=structuredClone(m.batch),progress=m.progress;step(s,8);assert.deepEqual(m.batch,batch);assert.equal(m.progress,progress);
  setMachineEnabled(s,'surface',12,10,true);until(s,()=>m.completed===2);step(s,12);assert.equal(m.completed,2);assert.equal(totalResources(s).water,4);assert.equal(totalResources(s).ice,4);assert.match(m.status,/Stock target/);
});

test('dismantling a processor releases unfinished ice and completed water once',()=>{
  const {s,tile,m}=colony({hauling:false});m.input={ice:4};m.output={water:2};until(s,()=>m.progress>2);setMachineEnabled(s,'surface',12,10,false);
  const before=totalResources(s),j=order(s,'surface',12,10,'remove').job;assert.ok(j);until(s,()=>!s.jobs.includes(j));assert.equal(tile.machine,undefined);assert.equal(totalResources(s).ice,before.ice);assert.equal(totalResources(s).water,before.water);assert.equal(tile.drop.ice,4);check(s);
});

test('comet ice is extracted, hauled into the hold, flown home and unloaded without becoming water',()=>{
  const s=createGame();step(s,180);assert.ok(depart(s,'comet').ok);until(s,()=>s.mission?.phase==='working');
  const site=s.sites.comet,t=site.tiles.find(t=>t.deposit?.remaining>0&&Math.abs(t.x-5)+Math.abs(t.y-10)===1);assert.ok(t);
  const water=totalResources(s).water,j=order(s,'comet',t.x,t.y,'mine').job;assert.ok(j);until(s,()=>s.mission.cargo.ice===6);assert.equal(t.deposit.remaining,6);assert.equal(s.resources.ice,0);
  assert.ok(recall(s).ok);until(s,()=>!s.mission);assert.equal(at(s.sites.surface,16,11).drop.ice,6);assert.equal(totalResources(s).ice,6);assert.ok(totalResources(s).water<=water);until(s,()=>s.resources.ice===6);check(s);
});

test('schema twenty-three migration preserves supplies, occupied terrain, orders and selective filters',()=>{
  const {s,site,depot}=colony({processor:false});s.version=23;delete s.resources.ice;
  for(const current of Object.values(s.sites))for(const t of current.tiles){delete t.deposit;if(t.storage)t.storage.accepted=t.storage.accepted.filter(r=>r!=='ice');}
  s.shuttle.accepted=s.shuttle.accepted.filter(r=>r!=='ice');const occupied=at(site,17,14);occupied.building='solar';refreshPower(s,site);
  const before=totalResources(s),copy=check(s);assert.equal(copy.version, VERSION);assert.deepEqual(totalResources(copy),before);assert.equal(at(copy.sites.surface,17,14).deposit,undefined);assert.equal(at(copy.sites.surface,17,14).building,'solar');assert.equal(waterSupply(copy).unminedIce,60);assert.ok(at(copy.sites.surface,8,10).storage.accepted.includes('ice'));assert.ok(copy.shuttle.accepted.includes('ice'));assert.deepEqual(check(copy),copy);
  depot.storage.accepted=['water'];s.shuttle.accepted=['components'];const selective=check(s);assert.deepEqual(at(selective.sites.surface,8,10).storage.accepted,['water']);assert.deepEqual(selective.shuttle.accepted,['components']);
});

test('partly depleted seams and partly processed batches continue deterministically after save',()=>{
  const {s,site,m}=colony();order(s,'surface',17,14,'mine');until(s,()=>m.progress>1);assert.equal(at(site,17,14).deposit.remaining,6);const copy=check(s);step(s,30);step(copy,30);assert.deepEqual(copy,s);
});

test('invalid reserve quantities and malformed ice processing batches are rejected',()=>{
  for(const change of [t=>t.deposit.remaining=-1,t=>t.deposit.remaining=.5,t=>t.deposit.remaining=13,t=>t.deposit.resource='water',t=>t.building='wall',t=>t.terrain='void']) {
    const {s,site}=colony();change(at(site,17,14));assert.throws(()=>check(s));
  }
  const {s,m}=colony();m.batch={ice:1};m.progress=2;assert.throws(()=>check(s));
});

test('agent extraction records action identity, output, reserve changes and depletion markers',()=>{
  const {s}=colony({processor:false,hauling:false});startRecording(s,{maxRecords:2000,maxBytes:16000000});
  for(let i=0;i<2;i++){const result=executeAction(s,'job.order',{site:'surface',x:17,y:14,kind:'mine'},'agent');assert.ok(result.ok);until(s,()=>!s.jobs.some(j=>j.kind==='mine'));}
  const observation=observe(s);assert.equal(observation.entities['tile:surface:17:14'].deposit.remaining,0);assert.equal(observation.entities['site:surface'].waterSupply.unminedIce,60);
  const rows=exportRecording(s).trim().split('\n').map(JSON.parse);assert.equal(rows.filter(r=>r.event?.id==='resource.extracted').length,2);assert.equal(rows.filter(r=>r.event?.id==='deposit.depleted').length,1);assert.ok(rows.some(r=>r.changes?.some(c=>c.system==='geology')));assert.ok(rows.some(r=>r.action?.source==='agent'&&r.action.id==='job.order'));check(s);
});

test('an unfinished legacy comet volatile order retains work and now yields finite raw ice and fuel',()=>{
  const s=createGame();step(s,180);assert.ok(depart(s,'comet').ok);until(s,()=>s.mission?.phase==='working');
  const job=order(s,'comet',8,7,'mine').job;assert.ok(job);until(s,()=>job.remaining<job.work&&s.jobs.includes(job));
  s.version=23;delete s.mission.returnCrew;delete s.resources.ice;for(const site of Object.values(s.sites))for(const t of site.tiles)delete t.deposit;
  const before=totalResources(s),copy=check(s),savedJob=copy.jobs.find(j=>j.id===job.id);assert.equal(savedJob.remaining,job.remaining);assert.deepEqual(totalResources(copy),before);
  until(copy,()=>!copy.jobs.some(j=>j.id===job.id));const source=at(copy.sites.comet,8,7);assert.equal(source.building,null);assert.equal(source.deposit,undefined);assert.equal(totalResources(copy).ice,12);assert.equal(totalResources(copy).fuel,before.fuel+3);assert.equal(order(copy,'comet',8,7,'mine').ok,false);
  until(copy,()=>copy.mission.cargo.ice===12&&copy.mission.cargo.fuel===3);assert.equal(quantity(copy.mission.cargo),15);check(copy);
});
