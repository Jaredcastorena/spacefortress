import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, setLabor, serialize, deserialize, updateRooms, roomAt, pathTo } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources } from '../src/inventory.js';
import { setMachineEnabled, spillStorage, haul } from '../src/industry.js';
import { updateSanitation, exposedWaste, SANITARY_GRACE, SANITARY_VISIT } from '../src/sanitation.js';
import { workRate } from '../src/crew.js';
import { injure } from '../src/medicine.js';
import { fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { setProductionOrder } from '../src/production.js';
import { refreshPower } from '../src/power.js';
const check = s => { syncResources(s); return deserialize(serialize(s)); };
const until = (s, condition, limit = 220) => { for (let i = 0; i < limit && !condition(); i++) { step(s); check(s); } assert.ok(condition(), `Condition missing at tick ${s.tick}`); };
function fixture(withUnit = true) {
  const s = createGame(), site = s.sites.surface, c = s.crew[0], depot = at(site, 8, 10), unit = at(site, 12, 10);
  for (const t of site.tiles) if (t.machine) setMachineEnabled(s, 'surface', t.x, t.y, false);
  for (const p of s.crew) for (const labor of Object.keys(p.labors)) setLabor(s, p.id, labor, false);
  if (withUnit) { unit.building = 'sanitary'; initializeStorage(unit); }
  return { s, site, c, depot, unit };
}

test('sanitary units cost delivered materials, start empty, and do not change power demand', () => {
  const { s, site, unit } = fixture(false), before = totalResources(s); const power = site.power.demand;
  setLabor(s, s.crew[1].id, 'construction', true); const build = order(s, 'surface', 12, 10, 'build', 'sanitary'); assert.ok(build.ok);
  assert.equal(totalResources(s).alloy, before.alloy); until(s, () => unit.building === 'sanitary');
  assert.deepEqual(unit.sanitary.output, {}); assert.equal(totalResources(s).alloy, before.alloy - 4); assert.equal(totalResources(s).components, before.components - 1); assert.equal(site.power.demand, power);
  assert.equal(order(s, 'surface', 11, 14, 'build', 'sanitary').ok, false);
});

test('crew walk to a private unit and deposit retained meal waste only after a complete visit', () => {
  const { s, site, c, unit } = fixture(); c.sanitation.waste = .5; c.x = 8; c.y = 8;
  const before = totalResources(s).waste; step(s); assert.equal(c.intent.type, 'sanitation'); assert.equal(c.sanitation.waste, .5); assert.equal(unit.sanitary.output.waste, undefined);
  until(s, () => c.x === unit.x && c.y === unit.y); assert.equal(c.intent.remaining, SANITARY_VISIT);
  step(s, SANITARY_VISIT - 1); assert.equal(unit.sanitary.output.waste, undefined); step(s);
  assert.equal(c.intent, null); assert.equal(c.sanitation.waste, 0); assert.equal(unit.sanitary.output.waste, .5); assert.equal(totalResources(s).waste, before); assert.equal(exposedWaste(s, site, roomAt(site, c.x, c.y)), 0);
});

test('one facility serves competing crew sequentially without overlapping claims or duplicated waste', () => {
  const { s, unit } = fixture(); for (const c of s.crew) c.sanitation.waste = .5;
  for (let i = 0; i < 110 && s.crew.some(c => c.sanitation.waste); i++) { step(s); assert.ok(s.crew.filter(c => c.intent?.type === 'sanitation').length <= 1); check(s); }
  assert.ok(s.crew.every(c => c.sanitation.waste === 0)); assert.equal(unit.sanitary.output.waste, 3.5); assert.equal(totalResources(s).waste, 3.5);
});

test('blocked, unsafe and full facilities leave waste with crew and allow other work', () => {
  for (const kind of ['blocked', 'unsafe', 'full']) {
    const { s, site, c, unit } = fixture(); c.sanitation.waste = .5;
    if (kind === 'blocked') { for (const [x,y] of [[11,10],[13,10],[12,9],[12,11]]) { const t = at(site,x,y); spillStorage(t); t.building='wall'; } updateRooms(site); }
    if (kind === 'unsafe') { fillRoom(roomAt(site, unit.x, unit.y), 0); refreshAtmosphere(site); }
    if (kind === 'full') unit.sanitary.output.waste = 8;
    step(s, 5); assert.notEqual(c.intent?.type, 'sanitation'); assert.equal(c.sanitation.waste, .5);
    assert.equal(unit.sanitary.output.waste || 0, kind === 'full' ? 8 : 0); check(s);
  }
});

test('unavailable facilities eventually leave local waste without stopping jobs forever', () => {
  const { s, site, c } = fixture(false); c.sanitation.waste = .5; c.x = 10; c.y = 9;
  step(s, SANITARY_GRACE - 1); assert.equal(c.sanitation.waste, .5); assert.equal(at(site, c.x, c.y).drop, null);
  step(s); assert.equal(c.sanitation.waste, 0); assert.equal(c.sanitation.wait, 0); assert.equal(at(site, c.x, c.y).drop.waste, .5); assert.equal(totalResources(s).waste, .5); assert.ok(c.memories.some(m => m.kind === 'sanitation-accident'));
});

test('air emergencies interrupt sanitary visits without losing waste, and visits resume later', () => {
  const { s, c, unit } = fixture(); c.sanitation.waste = .5; c.x = unit.x; c.y = unit.y; step(s); assert.equal(c.intent.remaining, 5);
  c.oxygen = 1; step(s); assert.equal(c.intent.type, 'air'); assert.equal(c.sanitation.waste, .5); assert.equal(unit.sanitary.output.waste, undefined);
  until(s, () => c.sanitation.waste === 0); assert.equal(unit.sanitary.output.waste, .5); assert.equal(totalResources(s).waste, .5);
});

test('a carried shipment survives the sanitary detour and is delivered afterward', () => {
  const { s, c, depot, unit } = fixture(); c.sanitation.waste = .5; c.carry = { ore: 3 }; c.delivery = { kind: 'stock', target: [depot.x, depot.y] };
  step(s); assert.equal(c.intent.type, 'sanitation'); assert.deepEqual(c.carry, { ore: 3 }); check(s);
  until(s, () => unit.sanitary.output.waste === .5); assert.deepEqual(c.carry, { ore: 3 }); until(s, () => !c.carry); assert.equal(depot.stock.ore, 3);
});

test('haulers empty full tanks and feed the existing nutrient chain without teleporting supplies', () => {
  const { s, site, c, depot, unit } = fixture(); unit.sanitary.output.waste = 8; c.sanitation.waste = .5; depot.stock.fertilizer = 0;
  unit.cable = { hp:100, enabled:true }; const recycler = at(site, 11, 10); recycler.building = 'recycler'; initializeStorage(recycler); recycler.cable = { hp:100, enabled:true }; refreshPower(s, site);
  setProductionOrder(s, 'surface', 11, 10, 'batches', 1); setLabor(s, s.crew[6].id, 'production', true); setLabor(s, s.crew[4].id, 'hauling', true);
  until(s, () => s.crew[4].carry?.waste > 0); assert.equal(recycler.machine.completed, 0); assert.equal(totalResources(s).waste, 8.5);
  until(s, () => c.sanitation.waste === 0 && recycler.machine.completed === 1); assert.equal(totalResources(s).waste, 7.5); assert.equal(totalResources(s).fertilizer, .25); check(s);
});

test('damaged and dismantled tanks expose contents while preserving quantities', () => {
  const { s, site, unit } = fixture(); unit.sanitary.output.waste = 3; const room = roomAt(site, unit.x, unit.y);
  assert.equal(exposedWaste(s, site, room), 0); unit.hp = 0; assert.equal(exposedWaste(s, site, room), 3);
  const before = totalResources(s); spillStorage(unit); unit.building = null; assert.deepEqual(totalResources(s), before); assert.equal(exposedWaste(s, site, room), 3); check(s);
});

test('room partitions isolate waste exposure; cleaning permits recovery but does not erase injuries', () => {
  const { s, site, c, depot } = fixture(false);
  for (let y=7;y<=11;y++) at(site,10,y).building='wall'; updateRooms(site); c.x=8;c.y=9; const other=s.crew[1];other.x=12;other.y=9;
  depot.stock.waste=10; const left=roomAt(site,c.x,c.y), right=roomAt(site,other.x,other.y);
  assert.notEqual(left,right); assert.equal(exposedWaste(s,site,left),10); assert.equal(exposedWaste(s,site,right),0);
  const baseline=workRate(c,'construction'); for(let i=0;i<100;i++) updateSanitation(s);
  assert.equal(c.sanitation.exposure,100); assert.equal(other.sanitation.exposure,0); assert.ok(c.medical.injury>0); assert.equal(c.medical.cause,'unsanitary exposure'); assert.ok(workRate(c,'construction')<baseline); const injury=c.medical.injury;
  delete depot.stock.waste; for(let i=0;i<501;i++) updateSanitation(s); assert.equal(c.sanitation.exposure,0); assert.equal(c.medical.injury,injury); check(s);
});

test('bulk waste becomes exposed after hauling while cargo in transit stays sealed', () => {
  const { s, site, c, depot } = fixture(); c.carry={waste:2};c.delivery={kind:'stock',target:[8,10]};c.x=8;c.y=10;
  const room=roomAt(site,8,10); assert.equal(exposedWaste(s,site,room),0); haul(s,c,site,pathTo); assert.equal(exposedWaste(s,site,room),2); assert.equal(depot.stock.waste,2);
  fillRoom(room,0);refreshAtmosphere(site);updateSanitation(s);assert.equal(c.sanitation.exposure,0); check(s);
});

test('immobile patients retain waste until overflow and death releases retained waste once', () => {
  const { s, site, c, unit } = fixture(); injure(s,c,65,'debris');c.sanitation.waste=.5;
  step(s,SANITARY_GRACE);assert.equal(c.sanitation.waste,0);assert.equal(unit.sanitary.output.waste,undefined);assert.equal(totalResources(s).waste,.5);
  c.sanitation.waste=.25;c.health=0;const before=totalResources(s).waste;step(s);assert.equal(c.sanitation.waste,0);assert.equal(totalResources(s).waste,before);step(s,3);assert.equal(totalResources(s).waste,before);assert.equal(at(site,c.x,c.y).drop.waste,.75);check(s);
});

test('active visits, retained cargo, tanks and exposure continue deterministically after saving', () => {
  const { s,c,unit }=fixture();c.sanitation.waste=.5;c.sanitation.exposure=35;c.x=unit.x;c.y=unit.y;step(s,2);assert.equal(c.intent.remaining,4);
  const copy=check(s);step(s,12);step(copy,12);assert.deepEqual(copy,s);
});

test('schema-seventeen migration adds empty needs without changing existing waste or food', () => {
  const { s,depot }=fixture(false);depot.stock.waste=3;syncResources(s);s.version=17;for(const c of s.crew)delete c.sanitation;
  const before=totalResources(s),copy=check(s);assert.equal(copy.version, VERSION);assert.deepEqual(totalResources(copy),before);assert.ok(copy.crew.every(c=>c.sanitation.waste===0&&c.sanitation.exposure===0));
});

test('invalid needs, tank owners, overfilled tanks and duplicate visits are rejected', () => {
  for(const change of [f=>f.c.sanitation.waste=-1,f=>f.c.sanitation.wait=120,f=>f.c.sanitation.exposure=101,f=>f.unit.sanitary.output.waste=8.5,f=>f.unit.sanitary.output.food=1,f=>f.unit.building=null,f=>{for(const c of f.s.crew.slice(0,2))c.intent={type:'sanitation',target:[12,10],remaining:3};}]){const f=fixture();change(f);assert.throws(()=>check(f.s));}
});
