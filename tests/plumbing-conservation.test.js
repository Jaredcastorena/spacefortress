import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, serialize, deserialize } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources, take, add } from '../src/inventory.js';
import { initializeElectrical, refreshPower, updatePower } from '../src/power.js';
import { flowLiquids, pumpLiquids, validateLiquids, liquidOpen } from '../src/liquids.js';
import { ignite, updateFire } from '../src/fire.js';
import {
  newWaterPipe, waterNode, waterCapacity, flowPlumbing, operatePlumbing,
  setWaterValve, setWaterPump, setWaterIntake, setWaterOutlet,
  validatePlumbing,
} from '../src/plumbing.js';

const close = (actual, expected, label='water') => assert.ok(
  Math.abs(actual-expected)<1e-7, `${label}: ${actual} != ${expected}`,
);
function base() {
  const s=createGame(), site=s.sites.surface;
  for(const t of site.tiles) if(t.machine) t.machine.enabled=false;
  for(const c of s.crew) { c.labors.hauling=false; c.labors.production=false; }
  refreshPower(s,site);
  return {s,site};
}
function install(s,kind,x,y) {
  const t=at(s.sites.surface,x,y); assert.equal(t.building,null);
  t.building=kind; t.hp=100; initializeStorage(t); initializeElectrical(t); return t;
}
function pipe(site,x,y) { const t=at(site,x,y); t.waterPipe=newWaterPipe(); return t; }
function debit(s,n) { assert.ok(take(at(s.sites.surface,8,10).stock,{water:n})); syncResources(s); }
function seedNode(s,t,n) {
  debit(s,n); waterNode(t).water+=n; s.sites.surface.plumbing.loaded+=n;
}
function puddle(s,t,n) { debit(s,n); t.liquid+=n; s.sites.surface.liquids.released+=n; }
function buffer(s,t,n,slot='input') { debit(s,n); add(t.machine[slot],{water:n}); }
function accounted(s) {
  return totalResources(s).water+Object.values(s.sites).reduce((n,site)=>n+site.liquids.lost+site.liquids.quenched,0);
}
function conserved(s,before) {
  close(accounted(s),before,'all stored water plus explicit sinks');
  for(const site of Object.values(s.sites)) for(const t of site.tiles) if(waterNode(t)) {
    assert.ok(waterNode(t).water>=0,'nonnegative retained water');
    assert.ok(waterNode(t).water<=waterCapacity(t)+1e-8,'finite node capacity');
  }
  validatePlumbing(s); validateLiquids(s);
}
function wire(site,cells) {
  for(const [x,y] of cells) at(site,x,y).cable={enabled:true,hp:100};
}

function chain() {
  const f=base(),{s,site}=f;
  const tank=install(s,'waterTank',8,8), intake=install(s,'waterIntake',9,8);
  const inlet=pipe(site,10,8), pump=install(s,'waterPump',11,8), reservoir=install(s,'waterReservoir',12,8);
  const outlet=install(s,'waterOutlet',12,9), floor=at(site,12,10);
  wire(site,[[9,8],[10,8],[11,8],[12,8],[12,9],[12,10]]);
  assert.ok(setWaterOutlet(s,site.id,12,9,true,'south','floor').ok);
  refreshPower(s,site); updatePower(s,site);
  return {...f,tank,intake,inlet,pump,reservoir,outlet,floor};
}

test('unequal water-node capacities level fill without overshoot, and isolation retains exact ownership',()=>{
  const {s,site}=base(), small=pipe(site,9,9), reservoir=install(s,'waterReservoir',10,9);
  seedNode(s,small,2); const before=accounted(s);
  assert.ok(setWaterValve(s,site.id,10,9,false).ok);
  for(let i=0;i<8;i++) flowPlumbing(s);
  close(small.waterPipe.water,2); close(reservoir.waterStore.water,0); conserved(s,before);
  assert.ok(setWaterValve(s,site.id,10,9,true).ok);
  for(let i=0;i<60;i++) {
    const gap=small.waterPipe.water/2-reservoir.waterStore.water/32;
    s.tick++; flowPlumbing(s); conserved(s,before);
    const after=small.waterPipe.water/2-reservoir.waterStore.water/32;
    assert.ok(after>=-1e-9&&after<=gap+1e-9,'equal-fill transfer is bounded');
  }
  close(small.waterPipe.water/2,reservoir.waterStore.water/32,'final fill');
  seedNode(s,small,2-small.waterPipe.water); seedNode(s,reservoir,32-reservoir.waterStore.water);
  for(let i=0;i<10;i++) flowPlumbing(s);
  close(small.waterPipe.water,2); close(reservoir.waterStore.water,32); conserved(s,before);
});


test('damage behind a closed valve retains overflow when its own floor is saturated',()=>{
  const {s,site}=base(), t=pipe(site,9,9); seedNode(s,t,2); puddle(s,t,4);
  t.waterPipe.hp=0; assert.ok(setWaterValve(s,site.id,t.x,t.y,false).ok);
  const before=accounted(s), released=site.plumbing.released;
  for(let i=0;i<12;i++) flowPlumbing(s);
  close(t.waterPipe.water,2); close(t.liquid,4); close(site.plumbing.released,released); conserved(s,before);
  // Recovery elsewhere can make room; the next damaged leak releases only
  // that newly available floor capacity, without packaging or deleting water.
  t.liquid-=.2; site.liquids.recovered+=.2; add(at(site,8,10).stock,{water:.2}); syncResources(s);
  flowPlumbing(s); close(t.waterPipe.water,1.8); close(t.liquid,4); close(site.plumbing.released,released+.2); conserved(s,before);
});

for(const boundary of [{name:'wall',x:11,y:12},{name:'closed door',x:10,y:12}])
test(`a ruptured water pipe under a ${boundary.name} uses open neighbor capacity and retains all excess`,()=>{
  const {s,site}=base(), t=pipe(site,boundary.x,boundary.y);
  if(t.building==='door') { t.doorMode='closed'; t.doorUntil=0; }
  seedNode(s,t,2); t.waterPipe.hp=0; t.waterPipe.open=false;
  const targets=[[t.x+1,t.y],[t.x-1,t.y],[t.x,t.y+1],[t.x,t.y-1]]
    .map(([x,y])=>at(site,x,y)).filter(n=>liquidOpen(site,n,s.tick));
  assert.ok(targets.length>0); for(const n of targets) puddle(s,n,4);
  const before=accounted(s);
  flowPlumbing(s); close(t.waterPipe.water,2); close(t.liquid,0); conserved(s,before);
  const free=targets[0]; free.liquid-=.125; site.liquids.recovered+=.125;
  add(at(site,8,10).stock,{water:.125}); syncResources(s);
  flowPlumbing(s); close(t.waterPipe.water,1.875); close(free.liquid,4); close(t.liquid,0); conserved(s,before);
});




test('bilge output can circulate through plumbing and floor discharge without inventing or losing water',()=>{
  const {s,site}=base(), bilge=install(s,'bilgePump',12,9), intake=install(s,'waterIntake',12,8);
  const a=pipe(site,12,7), b=pipe(site,11,7), outlet=install(s,'waterOutlet',11,8), floor=at(site,11,9);
  wire(site,[[12,7],[12,8],[12,9],[12,10],[11,8]]);
  assert.ok(setWaterIntake(s,site.id,intake.x,intake.y,true,'north','inventory').ok);
  assert.ok(setWaterOutlet(s,site.id,outlet.x,outlet.y,true,'south','floor').ok);
  puddle(s,floor,2); const before=accounted(s);
  for(let i=0;i<80;i++) {
    s.tick++; flowPlumbing(s); updatePower(s,site); pumpLiquids(s); operatePlumbing(s); conserved(s,before);
  }
  assert.ok(site.liquids.recovered>2,'the same finite water can complete more than one recovery cycle');
  assert.ok(site.plumbing.loaded>2); assert.ok(site.plumbing.released>2);
  assert.ok((bilge.machine.output.water||0)+a.waterPipe.water+b.waterPipe.water+floor.liquid>0);
  close(site.liquids.lost,0); close(site.liquids.quenched,0);
});

for(const mode of ['intake','outlet'])
test(`competing floor ${mode}s share only the actual water or free space on their one selected tile`,()=>{
  const {s,site}=base(), kind=mode==='intake'?'waterIntake':'waterOutlet';
  const west=install(s,kind,9,9), north=install(s,kind,10,8), floor=at(site,10,9), untouched=at(site,11,9);
  const a=pipe(site,8,9), b=pipe(site,10,7), before=accounted(s);
  wire(site,[[9,9],[10,9],[11,9],[12,9],[12,10],[10,8]]);
  if(mode==='intake') {
    puddle(s,floor,.75); puddle(s,untouched,2);
    assert.ok(setWaterIntake(s,site.id,west.x,west.y,true,'west','floor').ok);
    assert.ok(setWaterIntake(s,site.id,north.x,north.y,true,'north','floor').ok);
  } else {
    puddle(s,floor,3.75); seedNode(s,a,1); seedNode(s,b,1);
    assert.ok(setWaterOutlet(s,site.id,west.x,west.y,true,'east','floor').ok);
    assert.ok(setWaterOutlet(s,site.id,north.x,north.y,true,'south','floor').ok);
  }
  // Use one real allocation; overlapping adapters then see prior transfers
  // immediately, even though both were eligible at the beginning of the tick.
  refreshPower(s,site); updatePower(s,site); assert.ok(west.powered&&north.powered);
  operatePlumbing(s); conserved(s,before);
  if(mode==='intake') {
    close(floor.liquid,0); close(untouched.liquid,2);
    assert.deepEqual([a.waterPipe.water,b.waterPipe.water].sort((x,y)=>x-y),[.25,.5]);
    close(site.plumbing.recovered,.75); close(site.liquids.recovered,.75);
  } else {
    close(floor.liquid,4); close(a.waterPipe.water+b.waterPipe.water,1.75);
    close(site.plumbing.released,.25);
  }
});

test('floor outlet water reaches an active fire before suppression and records one explicit quenching sink',()=>{
  const {s,site}=base(), source=pipe(site,11,7), outlet=install(s,'waterOutlet',11,8), burning=install(s,'commons',11,9);
  wire(site,[[11,8],[12,8],[12,9],[12,10]]); seedNode(s,source,2);
  assert.ok(setWaterOutlet(s,site.id,outlet.x,outlet.y,true,'south','floor').ok);
  assert.ok(ignite(s,site,burning)); const before=accounted(s);
  updatePower(s,site); operatePlumbing(s); close(burning.liquid,.5);
  updateFire(s); assert.equal(burning.fire,undefined); close(site.liquids.quenched,.25);
  close(source.waterPipe.water,1.5); close(burning.liquid,.25); conserved(s,before);
});

test('released plumbing water follows the existing exterior loss sink without counting a second network loss',()=>{
  const {s,site}=base(), source=pipe(site,15,13); seedNode(s,source,2); source.waterPipe.hp=0; source.waterPipe.open=false;
  const before=accounted(s);
  for(let i=0;i<40;i++) { s.tick++; flowPlumbing(s); flowLiquids(s); conserved(s,before); }
  close(source.waterPipe.water,0); close(site.plumbing.released,2);
  assert.ok(site.liquids.lost>1.5); close(site.plumbing.delivered,0); close(site.plumbing.recovered,0);
  assert.ok(!Object.hasOwn(site.plumbing,'lost'),'only the floor ledger owns exterior loss');
});

test('mixed directional controls, leaks, floor transfers and save continuation preserve finite water deterministically',()=>{
  const f=chain(), {s:a,tank}=f; buffer(a,tank,8); const before=accounted(a);
  const b=deserialize(serialize(a));
  for(let i=0;i<90;i++) for(const s of [a,b]) {
    const site=s.sites.surface;
    if(i%13===0) assert.ok(setWaterValve(s,site.id,10,8,i%26===0).ok);
    if(i%17===0) assert.ok(setWaterPump(s,site.id,11,8,true,i%34===0?'east':'west').ok);
    if(i%23===0) assert.ok(setWaterOutlet(s,site.id,12,9,i%46===0,'south','floor').ok);
    at(site,10,8).waterPipe.hp=i>=35&&i<55?25:100;
    step(s); conserved(s,before);
  }
  assert.deepEqual(a,b); assert.ok(a.sites.surface.plumbing.loaded>0);
  assert.ok(a.sites.surface.plumbing.released>0);
  assert.deepEqual(deserialize(serialize(a)),a);
});
