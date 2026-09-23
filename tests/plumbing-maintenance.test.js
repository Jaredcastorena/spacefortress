import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, order, cancelJob, setLabor, serialize, deserialize } from '../src/simulation.js';
import { damage, updateDebris, validateReliability } from '../src/maintenance.js';
import { ignite, updateFire, setFireResponse } from '../src/fire.js';
import { laborFor } from '../src/crew.js';
import { newWaterPipe } from '../src/plumbing.js';
import { newPipe } from '../src/gas-networks.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
const check = s => deserialize(serialize(s));
const until = (s, condition, limit = 120) => {
  for (let i = 0; i < limit && !condition(); i++) step(s);
  assert.ok(condition(), `Condition not reached at tick ${s.tick}`);
};
function fixture() {
  const s = createGame(), site = s.sites.surface, t = at(site, 11, 9);
  for (const tile of site.tiles) if (tile.machine) tile.machine.enabled = false;
  for (const c of s.crew) { c.labors.hauling = false; c.labors.production = false; }
  setFireResponse(s, 'surface', false);
  t.building = 'commons';
  t.waterPipe = newWaterPipe(); t.pipe = newPipe(); t.cable = { hp: 100, enabled: true };
  refreshPower(s, site);
  return { s, site, t };
}
function seedWater(s, t, amount) {
  at(s.sites.surface, 8, 10).stock.water -= amount;
  t.waterPipe.water += amount;
  s.sites.surface.plumbing.loaded += amount;
  syncResources(s);
}
const events = s => exportRecording(s).trim().split('\n').map(JSON.parse).filter(r => r.kind === 'event').map(r => r.event);

test('water-pipe damage keeps gas pipe, cable and fitting condition independent and labeled', () => {
  const { s, site, t } = fixture(); startRecording(s);
  damage(s, site, t, 'waterPipe', 60, 'debris');
  assert.equal(t.waterPipe.hp, 40);
  assert.equal(t.pipe.hp, 100); assert.equal(t.cable.hp, 100); assert.equal(t.hp, 100);
  assert.deepEqual(site.incidents[0], { tick: 0, x: 11, y: 9, target: 'waterPipe', cause: 'debris', amount: 60 });
  assert.ok(s.log.some(e => e.message.startsWith('Water pipe at 11/9:')));
  assert.ok(events(s).some(e => e.id === 'structure.damaged' && e.entity === 'tile:surface:11:9' && e.target === 'waterPipe' && e.amount === 60 && e.condition === 40));
  damage(s, site, t, 'pipe', 20, 'fire'); assert.equal(t.pipe.hp, 80); assert.equal(t.waterPipe.hp, 40);
  check(s);
});

test('unknown damage targets and invalid damage amounts do not damage or heal neighboring assets', () => {
  const { s, site, t } = fixture(), before = structuredClone(t);
  damage(s, site, t, 'water-pipe', 30, 'debris');
  for (const amount of [0, -10, NaN, Infinity]) damage(s, site, t, 'waterPipe', amount, 'fire');
  assert.deepEqual(t, before); assert.deepEqual(site.incidents, []);
});

test('an exposed water pipe alone can receive a debris forecast and independent impact', () => {
  const { s, site } = fixture();
  for (const t of site.tiles) { t.building = null; t.cable = null; t.pipe = null; t.waterPipe = null; }
  const t = at(site, 2, 2); t.terrain = 'ground'; t.waterPipe = newWaterPipe();
  s.debris = { next: 5, count: 0, target: null };
  updateDebris(s); assert.deepEqual(s.debris.target, { x: 2, y: 2 });
  s.tick = 5; updateDebris(s);
  assert.equal(t.waterPipe.hp, 40); assert.equal(t.hp, 100);
  assert.equal(site.incidents.length, 1); assert.equal(site.incidents[0].target, 'waterPipe');
  assert.equal(s.debris.count, 1); assert.equal(s.debris.target, null);
});

test('fire damages each co-located utility overlay once and labels the water pipe separately', () => {
  const { s, site, t } = fixture(); startRecording(s);
  assert.ok(ignite(s, site, t)); s.tick++; updateFire(s);
  const overlayDamage = t.fire.intensity * .003;
  close(t.waterPipe.hp, 100 - overlayDamage); close(t.pipe.hp, 100 - overlayDamage); close(t.cable.hp, 100 - overlayDamage);
  close(t.hp, 100 - t.fire.intensity * .005);
  for (const target of ['structure', 'pipe', 'waterPipe', 'cable']) {
    assert.equal(site.incidents.filter(i => i.target === target && i.cause === 'fire').length, 1);
    assert.equal(events(s).filter(e => e.id === 'structure.damaged' && e.target === target && e.cause === 'fire').length, 1);
  }
  validateReliability(s);
});

test('water-pipe repair requires enabled engineering, hauled alloy and completed work', () => {
  const { s, site, t } = fixture(); t.waterPipe.hp = 65; t.pipe.hp = 70; t.cable.hp = 80; t.hp = 90;
  for (const c of s.crew) setLabor(s, c.id, 'engineering', false);
  const before = totalResources(s).alloy, result = order(s, 'surface', t.x, t.y, 'repairWaterPipe');
  assert.ok(result.ok); const j = result.job;
  assert.equal(laborFor(j), 'engineering'); assert.deepEqual(j.cost, { alloy: 1 }); assert.equal(j.work, 3);
  assert.deepEqual(j.materials, {}); close(totalResources(s).alloy, before);
  step(s, 2); assert.equal(j.worker, null); assert.match(j.blockedReason, /engineering/i); assert.equal(t.waterPipe.hp, 65);
  setLabor(s, s.crew[1].id, 'engineering', true);
  until(s, () => s.crew.some(c => c.delivery?.job === j.id));
  assert.equal(j.remaining, j.work); assert.equal(t.waterPipe.hp, 65); close(totalResources(s).alloy, before);
  until(s, () => !s.jobs.includes(j));
  assert.equal(t.waterPipe.hp, 100); assert.equal(t.pipe.hp, 70); assert.equal(t.cable.hp, 80); assert.equal(t.hp, 90);
  close(totalResources(s).alloy, before - 1); check(s);
});

test('water-pipe repair rejects missing material without creating a job or restoring condition', () => {
  const { s, site, t } = fixture(); t.waterPipe.hp = 65;
  at(site, 8, 10).stock.alloy = 0; syncResources(s);
  const result = order(s, 'surface', t.x, t.y, 'repairWaterPipe');
  assert.equal(result.ok, false); assert.match(result.message, /supplies/);
  assert.equal(s.jobs.length, 0); assert.equal(t.waterPipe.hp, 65); close(totalResources(s).alloy, 0);
});

test('cancelling water-pipe repair preserves reserved, carried and delivered alloy', () => {
  for (const phase of ['reserved', 'carried', 'delivered']) {
    const { s, t } = fixture(); t.waterPipe.hp = 65; t.waterPipe.open = false; seedWater(s, t, 1);
    const before = totalResources(s), j = order(s, 'surface', t.x, t.y, 'repairWaterPipe').job;
    assert.ok(j);
    if (phase === 'carried') until(s, () => s.crew.some(c => c.delivery?.job === j.id));
    if (phase === 'delivered') until(s, () => j.materials.alloy === 1);
    assert.equal(t.waterPipe.hp, 65); cancelJob(s, j.id);
    close(totalResources(s).alloy, before.alloy); close(totalResources(s).water, before.water);
    assert.equal(t.waterPipe.hp, 65); assert.equal(t.waterPipe.water, 1);
    assert.ok(!s.jobs.includes(j)); assert.ok(!s.crew.some(c => c.delivery?.job === j.id)); check(s);
  }
});

test('water-pipe removal recovers stored water and a finite refund without removing other assets', () => {
  const { s, site, t } = fixture(); t.waterPipe.open = false; seedWater(s, t, 2);
  const before = totalResources(s), pipe = structuredClone(t.pipe), cable = structuredClone(t.cable);
  const j = order(s, 'surface', t.x, t.y, 'removeWaterPipe').job;
  assert.ok(j); assert.equal(laborFor(j), 'construction'); assert.deepEqual(j.cost, {}); assert.equal(j.work, 3);
  until(s, () => !!j.worker); const worker = s.crew.find(c => c.id === j.worker);
  until(s, () => !s.jobs.includes(j));
  assert.equal(t.waterPipe, null); assert.equal(t.building, 'commons'); assert.deepEqual(t.pipe, pipe); assert.deepEqual(t.cable, cable);
  close(totalResources(s).water, before.water); close(totalResources(s).alloy, before.alloy + .5);
  close(at(site, worker.x, worker.y).drop.water, 2); close(site.plumbing.delivered, 2); check(s);
});

test('water-pipe work validates its precise overlay, work, cost and repair condition', () => {
  for (const kind of ['repairWaterPipe', 'removeWaterPipe']) {
    const { s, t } = fixture(); t.waterPipe.hp = 65;
    const result = order(s, 'surface', t.x, t.y, kind, 'commons'); assert.ok(result.ok); assert.equal(result.job.building, null);
    check(s);
    for (const corrupt of [
      copy => { copy.jobs[0].work = 4; copy.jobs[0].remaining = 4; },
      copy => { copy.jobs[0].building = 'commons'; },
      copy => { at(copy.sites.surface, t.x, t.y).waterPipe = null; },
    ]) { const copy = check(s); corrupt(copy); assert.throws(() => check(copy)); }
    const wrongCost = check(s); wrongCost.jobs[0].cost = kind === 'repairWaterPipe' ? {} : { alloy: 1 };
    assert.throws(() => check(wrongCost));
    if (kind === 'repairWaterPipe') { const healthy = check(s); at(healthy.sites.surface, t.x, t.y).waterPipe.hp = 100; assert.throws(() => check(healthy)); }
  }
});

test('water-pipe incidents survive reload while invalid target and incident fields are rejected', () => {
  const { s, site, t } = fixture(); damage(s, site, t, 'waterPipe', 25, 'fire');
  assert.deepEqual(check(s).sites.surface.incidents, site.incidents);
  for (const change of [
    i => { i.target = 'water-pipe'; }, i => { i.cause = 'unknown'; }, i => { i.amount = 0; },
    i => { i.amount = 101; }, i => { i.tick = 1; }, i => { i.x = site.size; },
  ]) { const copy = check(s); change(copy.sites.surface.incidents[0]); assert.throws(() => check(copy), /Invalid damage history/); }
});
