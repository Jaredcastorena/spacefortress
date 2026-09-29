import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, setLabor, serialize, deserialize } from '../src/simulation.js';
import { setProductionOrder, setProductionPriority, projectedStock } from '../src/production.js';
import { setMachineEnabled } from '../src/industry.js';
import { totalResources, syncResources, initializeStorage, take } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
const depot = s => at(s.sites.surface, 8, 10);
const until = (s, predicate, limit = 250) => { for (let i = 0; i < limit && !predicate(); i++) { step(s); deserialize(serialize(s)); } assert.ok(predicate(), `Expected condition by tick ${s.tick}`); };
function workshop() {
  const s = createGame(), t = at(s.sites.surface, 13, 10); setMachineEnabled(s, 'surface', 7, 9, false);
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', false)); t.machine.input.ore = 2;
  return { s, t, m: t.machine };
}
const operators = (s, enabled) => s.crew.forEach(c => setLabor(s, c.id, 'production', enabled));
const operation = (s, t) => s.jobs.find(j => j.kind === 'operate' && j.x === t.x && j.y === t.y);

test('a supplied powered machine waits for a permitted operator physically at its workstation', () => {
  const { s, t, m } = workshop(); operators(s, false); step(s, 10); assert.equal(m.progress, 0); assert.equal(m.input.ore, 2); assert.deepEqual(m.batch, {}); assert.match(m.status, /production/i);
  const c = s.crew[2]; c.x = 8; c.y = 8; setLabor(s, c.id, 'production', true); step(s); assert.equal(m.progress, 0); assert.equal(operation(s, t).worker, c.id);
  until(s, () => m.progress > 0); assert.equal(Math.abs(c.x - t.x) + Math.abs(c.y - t.y), 1); assert.equal(m.input.ore, 1); assert.deepEqual(m.batch, { ore: 1 });
});

test('operator skill affects throughput and learns from actual processing work', () => {
  const a = workshop(), b = workshop();
  for (const [fixture, level] of [[a, 0], [b, 3]]) { operators(fixture.s, false); const c = fixture.s.crew[0]; c.x = 12; c.y = 10; c.skills.production.level = level; setLabor(fixture.s, c.id, 'production', true); step(fixture.s, 8); }
  assert.ok(b.m.progress > a.m.progress); assert.ok(a.s.crew[0].skills.production.xp > 0); assert.ok(b.s.crew[0].skills.production.xp > a.s.crew[0].skills.production.xp);
});

test('recovery releases an operator while a replacement resumes the same ingredients and progress', () => {
  const { s, t, m } = workshop(); operators(s, false); const c = s.crew[0]; setLabor(s, c.id, 'production', true); until(s, () => m.progress > 2);
  const progress = m.progress, ore = totalResources(s).ore; c.energy = 1; step(s); assert.equal(c.intent.type, 'rest'); assert.equal(m.progress, progress); assert.deepEqual(m.batch, { ore: 1 });
  const replacement = s.crew[1]; setLabor(s, replacement.id, 'production', true); until(s, () => m.progress > progress); assert.equal(operation(s, t).worker, replacement.id); assert.equal(totalResources(s).ore, ore);
});

test('fixed work orders complete exactly the requested number of batches then release staff', () => {
  const { s, t, m } = workshop(); const alloy = totalResources(s).alloy; setProductionOrder(s, 'surface', t.x, t.y, 'batches', 2);
  until(s, () => m.completed === 2); step(s, 15); assert.equal(m.order.remaining, 0); assert.equal(m.output.alloy, 4); assert.equal(totalResources(s).alloy, alloy + 4); assert.equal(operation(s, t), undefined); assert.equal(m.status, 'Requested batches complete');
});

test('finite orders only request enough new input deliveries for their remaining batches', () => {
  const { s, t, m } = workshop(); m.input = {}; depot(s).stock.ore = 10; syncResources(s); s.crew.forEach(c => setLabor(s, c.id, 'hauling', true)); setProductionOrder(s, 'surface', t.x, t.y, 'batches', 1);
  until(s, () => m.completed === 1); step(s, 25); assert.equal(totalResources(s).ore, 9); assert.equal(m.input.ore || 0, 0); assert.equal(s.crew.filter(c => c.carry?.ore || c.intent?.items?.ore).length, 0);
});

test('stock targets include loose or finished products and restart when products are used', () => {
  const { s, t, m } = workshop(); setProductionOrder(s, 'surface', t.x, t.y, 'stock', 40);
  until(s, () => m.completed === 2); step(s, 3); assert.equal(projectedStock(s, s.sites.surface, 'alloy'), 40); assert.equal(m.status, 'Stock target met');
  take(depot(s).stock, { alloy: 2 }); syncResources(s); m.input.ore = 1; until(s, () => m.completed === 3); assert.equal(projectedStock(s, s.sites.surface, 'alloy'), 40);
});

test('two machines with the same stock target reserve promised output without duplicating a batch', () => {
  const { s, t, m } = workshop(); const second = at(s.sites.surface, 12, 10); second.building = 'refinery'; initializeStorage(second); second.machine.input.ore = 1; refreshPower(s, s.sites.surface);
  operators(s, false); for (const tile of [t, second]) setProductionOrder(s, 'surface', tile.x, tile.y, 'stock', 38);
  step(s); assert.equal(s.jobs.filter(j => j.kind === 'operate').length, 1); assert.equal(m.progress, 0); assert.equal(second.machine.progress, 0);
  operators(s, true); until(s, () => m.completed + second.machine.completed === 1); step(s, 25); assert.equal(m.completed + second.machine.completed, 1); assert.equal(projectedStock(s, s.sites.surface, 'alloy'), 38);
});

test('stock accounting includes goods in transit to storage but excludes committed building supplies', () => {
  const { s, t, m } = workshop(); take(depot(s).stock, { alloy: 5 }); syncResources(s); const c = s.crew[0]; c.carry = { alloy: 5 }; c.delivery = { kind: 'stock', target: [8, 10] }; c.x = 10; c.y = 14;
  setProductionOrder(s, 'surface', t.x, t.y, 'stock', 36); step(s); assert.equal(operation(s, t), undefined); assert.equal(m.progress, 0);
  until(s, () => !c.carry); order(s, 'surface', 11, 14, 'build', 'solar'); step(s); assert.ok(operation(s, t)); assert.ok(projectedStock(s, s.sites.surface, 'alloy') < 36);
});

test('changing an active order to zero new batches finishes the committed batch without losing inputs', () => {
  const { s, t, m } = workshop(); until(s, () => m.progress > 2); const progress = m.progress;
  assert.ok(setProductionOrder(s, 'surface', t.x, t.y, 'batches', 0).ok); assert.equal(m.progress, progress); assert.deepEqual(m.batch, { ore: 1 });
  until(s, () => m.completed === 1); step(s, 20); assert.equal(m.completed, 1); assert.equal(m.input.ore, 1);
});

test('pausing or cancelling an operation frees the worker but retains the active batch', () => {
  const { s, t, m } = workshop(); until(s, () => m.progress > 2); const j = operation(s, t), c = s.crew.find(c => c.id === j.worker), progress = m.progress;
  cancelJob(s, j.id); assert.equal(m.enabled, false); assert.equal(c.job, null); step(s, 10); assert.equal(m.progress, progress); assert.deepEqual(m.batch, { ore: 1 });
  setMachineEnabled(s, 'surface', t.x, t.y, true); until(s, () => m.completed === 1);
});

test('engineering service suspends production while preserving the unfinished batch', () => {
  const { s, t, m } = workshop(); until(s, () => m.progress > 2); const progress = m.progress; t.hp = 70; const service = order(s, 'surface', t.x, t.y, 'repair'); assert.ok(service.ok);
  step(s); assert.equal(operation(s, t), undefined); assert.equal(m.progress, progress); until(s, () => !s.jobs.includes(service.job)); assert.equal(m.progress, progress); assert.equal(t.hp, 100);
  until(s, () => m.progress > progress); assert.deepEqual(m.batch, { ore: 1 });
});

test('a higher production priority assigns the available operator without resetting batch counts', () => {
  const { s, t, m } = workshop(), second = at(s.sites.surface, 12, 10); second.building = 'refinery'; initializeStorage(second); second.machine.input.ore = 1; refreshPower(s, s.sites.surface);
  operators(s, false); const c = s.crew[0]; setLabor(s, c.id, 'production', true); setProductionOrder(s, 'surface', t.x, t.y, 'batches', 3); setProductionPriority(s, 'surface', second.x, second.y, 5);
  step(s); assert.equal(operation(s, second).worker, c.id); assert.equal(operation(s, t).worker, null); assert.equal(m.order.remaining, 3);
});

test('life support remains automatic without anyone assigned to production', () => {
  const { s } = workshop(); operators(s, false); const scrubber = at(s.sites.surface, 7, 7); scrubber.machine.input.air = 5; const before = s.sites.surface.atmosphere.injected.oxygen;
  s.crew.forEach(c => c.oxygen = 50); step(s, 5); assert.ok(s.sites.surface.atmosphere.injected.oxygen > before || scrubber.machine.status.includes('Recycling')); assert.equal(s.jobs.some(j => j.kind === 'operate' && j.building === 'scrubber'), false);
});

test('work orders, active operators and fractional progress continue deterministically after reload', () => {
  const { s, t, m } = workshop(); setProductionOrder(s, 'surface', t.x, t.y, 'batches', 2); until(s, () => m.progress > 2);
  const copy = deserialize(serialize(s)); step(s, 50); step(copy, 50); assert.deepEqual(copy, s);
});

test('schema-twelve migration preserves inventory and batch progress while adding work orders and duties', () => {
  const { s, m } = workshop(); m.batch = { ore: 1 }; m.progress = 7; s.version = 12;
  for (const site of Object.values(s.sites)) for (const tile of site.tiles) if (tile.machine) { delete tile.machine.order; delete tile.machine.completed; }
  for (const c of s.crew) { delete c.skills.production; delete c.labors.production; }
  const before = totalResources(s), copy = deserialize(serialize(s)); assert.equal(copy.version, VERSION); assert.deepEqual(totalResources(copy), before); assert.equal(at(copy.sites.surface, 13, 10).machine.progress, 7); assert.equal(copy.crew[3].skills.production.level, 3); assert.equal(copy.crew[0].labors.production, true);
});

test('invalid production limits, priorities, completion counts and mismatched work progress are rejected', () => {
  for (const corrupt of [m => m.order.mode = 'random', m => m.order.limit = 1001, m => m.order.remaining = 1, m => m.order.priority = 2, m => m.completed = -1]) { const { s, m } = workshop(); corrupt(m); assert.throws(() => deserialize(serialize(s))); }
  const { s, t, m } = workshop(); assert.equal(setProductionOrder(s, 'surface', t.x, t.y, 'stock', 1.5).ok, false); until(s, () => m.progress > 0); operation(s, t).remaining--; assert.throws(() => deserialize(serialize(s)));
});
