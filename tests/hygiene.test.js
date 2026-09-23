import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, order, cancelJob, setLabor, serialize, deserialize } from '../src/simulation.js';
import { setMachineEnabled } from '../src/industry.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { injure } from '../src/medicine.js';
import { fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { carriedBy } from '../src/nursing.js';
import { setDepotAccepted } from '../src/storage.js';
import { HYGIENE_RETRY } from '../src/hygiene.js';

const check = s => { syncResources(s); return deserialize(serialize(s)); };
const until = (s, condition, limit = 180) => { for (let i=0;i<limit&&!condition();i++) { step(s); check(s); } assert.ok(condition(), `Condition missing at tick ${s.tick}`); };
const hygiene = (s,p) => s.jobs.find(j=>j.kind==='hygiene'&&j.patient===p.id);
function clinic() {
  const s=createGame(),site=s.sites.surface,p=s.crew[0],helper=s.crew[5],depot=at(site,8,10);
  for(const t of site.tiles) if(t.machine)setMachineEnabled(s,'surface',t.x,t.y,false);
  for(const c of s.crew)for(const labor of Object.keys(c.labors))setLabor(s,c.id,labor,false);
  const cot=at(site,10,9);cot.building='medicalCot';p.x=10;p.y=9;injure(s,p,65,'debris');p.medical.bed=[10,9];p.sanitation.waste=.5;
  return {s,site,p,helper,depot,cot};
}

test('hygiene waits for Medicine permission, an adjacent helper and completed work',()=>{
  const {s,p,helper,depot}=clinic();const before=totalResources(s);step(s,5);const j=hygiene(s,p);assert.ok(j);assert.equal(j.remaining,8);assert.equal(p.sanitation.waste,.5);assert.equal(j.worker,null);
  helper.x=8;helper.y=8;setLabor(s,helper.id,'medicine',true);step(s);assert.equal(j.worker,helper.id);assert.equal(j.remaining,8);
  until(s,()=>j.remaining<8);assert.equal(Math.abs(helper.x-p.x)+Math.abs(helper.y-p.y),1);assert.equal(p.sanitation.waste,.5);assert.equal(helper.carry,undefined);
  until(s,()=>!s.jobs.includes(j));assert.equal(p.sanitation.waste,0);assert.equal(p.sanitation.wait,0);assert.deepEqual(helper.carry,{waste:.5});assert.equal(depot.stock.waste||0,0);assert.equal(totalResources(s).waste,before.waste);
  assert.ok(helper.skills.medicine.xp>0);assert.ok(p.memories.some(m=>m.kind==='assisted-hygiene'));check(s);
  until(s,()=>!helper.carry);assert.equal(depot.stock.waste,.5);assert.equal(helper.labors.hauling,false);
});

test('food, treatment and hygiene share a cot without duplicate patient jobs',()=>{
  const {s,p}=clinic();p.hunger=20;step(s);
  for(const kind of ['treat','feed','hygiene'])assert.equal(s.jobs.filter(j=>j.kind===kind&&j.patient===p.id).length,1);
  assert.equal(order(s,'surface',p.x,p.y,'hygiene',p.id).ok,false);
  p.x++;assert.equal(order(s,'surface',p.x,p.y,'hygiene',p.id).ok,false);p.x--;
  step(s,8);assert.equal(s.jobs.filter(j=>j.kind==='hygiene').length,1);check(s);
});

test('a sole medic feeds a hungry patient before hygiene, then returns to treatment',()=>{
  const {s,p,helper}=clinic();p.hunger=20;setLabor(s,helper.id,'medicine',true);step(s);
  assert.equal(s.jobs.find(j=>j.id===helper.job).kind,'feed');until(s,()=>p.medical.servings>0);
  until(s,()=>p.sanitation.waste===0);assert.ok(helper.carry?.waste>0);until(s,()=>p.medical.treated>0);assert.ok(p.hunger>35);assert.equal(s.crew.filter(c=>c.labors.medicine).length,1);
});

test('urgent hygiene releases a sole medic from treatment without discarding staged medicine or progress',()=>{
  const {s,p,helper}=clinic();p.sanitation.waste=0;setLabor(s,helper.id,'medicine',true);
  until(s,()=>s.jobs.some(j=>j.kind==='treat'&&j.remaining<j.work));const treatment=s.jobs.find(j=>j.kind==='treat'),progress=treatment.remaining;const medicine=structuredClone(treatment.materials);
  p.sanitation.waste=.5;p.sanitation.wait=75;step(s);assert.equal(helper.job,hygiene(s,p).id);assert.equal(treatment.remaining,progress);assert.deepEqual(treatment.materials,medicine);
  until(s,()=>p.sanitation.waste===0);assert.equal(treatment.remaining,progress);until(s,()=>p.medical.treated>0);
});

test('helper exhaustion hands unfinished care to another medic without moving patient waste early',()=>{
  const {s,p,helper}=clinic();setLabor(s,helper.id,'medicine',true);until(s,()=>hygiene(s,p)?.remaining<7);const j=hygiene(s,p),remaining=j.remaining;
  helper.energy=1;step(s);assert.equal(helper.intent.type,'rest');assert.equal(j.remaining,remaining);assert.equal(p.sanitation.waste,.5);assert.equal(helper.carry,undefined);
  const next=s.crew[1];setLabor(s,next.id,'medicine',true);until(s,()=>!s.jobs.includes(j));assert.deepEqual(next.carry,{waste:.5});assert.equal(totalResources(s).waste,.5);
});

test('unsafe treatment conditions pause care and retain progress until the room recovers',()=>{
  const {s,site,p,helper}=clinic();setLabor(s,helper.id,'medicine',true);until(s,()=>hygiene(s,p)?.remaining<7);const j=hygiene(s,p),remaining=j.remaining;
  fillRoom(site.rooms[0],0);refreshAtmosphere(site);step(s,3);assert.equal(j.remaining,remaining);assert.equal(p.sanitation.waste,.5);assert.match(j.blockedReason,/safe hygiene/);
  fillRoom(site.rooms[0]);refreshAtmosphere(site);until(s,()=>p.sanitation.waste===0);assert.deepEqual(helper.carry,{waste:.5});
});

test('overflow or patient death cancels obsolete care without a duplicate waste pickup',()=>{
  for(const death of [false,true]){
    const {s,site,p,helper}=clinic();step(s);const j=hygiene(s,p);if(death)p.health=0;else p.sanitation.wait=119;
    step(s);assert.equal(s.jobs.includes(j),false);assert.equal(p.sanitation.waste,0);assert.equal(at(site,p.x,p.y).drop.waste,.5);assert.equal(helper.carry,undefined);assert.equal(totalResources(s).waste,.5);assert.equal(p.sanitation.retryAt,0);check(s);
  }
});

test('rescue movement invalidates the old bedside job and schedules care at the destination',()=>{
  const {s,site,p,helper}=clinic();p.x=10;p.y=15;p.medical.bed=null;step(s);const old=hygiene(s,p);assert.ok(old);
  setLabor(s,helper.id,'medicine',true);until(s,()=>carriedBy(s,p));assert.equal(s.jobs.includes(old),false);assert.equal(p.sanitation.waste,.5);
  until(s,()=>p.x===10&&p.y===9&&!carriedBy(s,p));until(s,()=>p.sanitation.waste===0);assert.equal(totalResources(s).waste,.5);assert.equal(at(site,10,15).drop,null);
});

test('cancelling care preserves retained waste and delays automatic retry without resetting overflow',()=>{
  const {s,p}=clinic();step(s);const j=hygiene(s,p),wait=p.sanitation.wait;cancelJob(s,j.id);
  assert.equal(p.sanitation.retryAt,s.tick+HYGIENE_RETRY);assert.equal(p.sanitation.wait,wait);assert.equal(p.sanitation.waste,.5);step(s,10);assert.equal(hygiene(s,p),undefined);check(s);
  const manual=order(s,'surface',p.x,p.y,'hygiene',p.id);assert.ok(manual.ok);check(s);
});

test('collected waste survives helper recovery and death after care completion',()=>{
  for(const death of [false,true]){
    const {s,site,p,helper}=clinic();setLabor(s,helper.id,'medicine',true);until(s,()=>p.sanitation.waste===0);const xy=[helper.x,helper.y];
    if(death)helper.health=0;else helper.energy=1;step(s);
    assert.equal(totalResources(s).waste,.5);if(death){assert.equal(at(site,...xy).drop.waste,.5);assert.equal(helper.carry,null);}else{assert.deepEqual(helper.carry,{waste:.5});assert.equal(helper.intent.type,'rest');}check(s);
  }
});

test('no accepting depot leaves collected waste at the helper position rather than erasing it',()=>{
  const {s,site,p,helper}=clinic();setDepotAccepted(s,'surface',8,10,'waste',false);setLabor(s,helper.id,'medicine',true);until(s,()=>p.sanitation.waste===0);
  const xy=[helper.x,helper.y];step(s);assert.equal(helper.carry,null);assert.equal(at(site,...xy).drop.waste,.5);assert.equal(totalResources(s).waste,.5);check(s);
});

test('oversized retained waste is collected in bounded shipments without resetting an unfinished need',()=>{
  const {s,p,helper}=clinic();p.sanitation.waste=7;p.sanitation.wait=50;setLabor(s,helper.id,'medicine',true);until(s,()=>helper.carry?.waste===6);
  assert.equal(p.sanitation.waste,1);assert.ok(p.sanitation.wait>50);assert.equal(totalResources(s).waste,7);check(s);
});

test('active hygiene and collected cargo continue deterministically across reload',()=>{
  const {s,p,helper}=clinic();setLabor(s,helper.id,'medicine',true);until(s,()=>hygiene(s,p)?.remaining<7);
  const copy=check(s);step(s,40);step(copy,40);assert.deepEqual(copy,s);
});

test('schema-eighteen migration preserves needs, tanks, inventories and pending care',()=>{
  const {s,p}=clinic();step(s);cancelJob(s,hygiene(s,p).id);s.version=18;for(const c of s.crew)delete c.sanitation.retryAt;
  const before=totalResources(s),wait=p.sanitation.wait,copy=check(s);assert.equal(copy.version, 36);assert.deepEqual(totalResources(copy),before);assert.equal(copy.crew[0].sanitation.wait,wait);assert.equal(copy.crew[0].sanitation.retryAt,0);
});

test('invalid retry times, patient references, work, inventory and duplicate hygiene orders are rejected',()=>{
  for(const change of [f=>f.p.sanitation.retryAt=-1,f=>f.p.sanitation.retryAt=f.s.tick+121,f=>hygiene(f.s,f.p).patient='missing',f=>hygiene(f.s,f.p).work=9,f=>hygiene(f.s,f.p).materials.waste=1,f=>{const j=structuredClone(hygiene(f.s,f.p));j.id=`job-${f.s.nextId++}`;f.s.jobs.push(j);}]){
    const f=clinic();step(f.s);change(f);assert.throws(()=>check(f.s));
  }
});
