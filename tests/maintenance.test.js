import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, order, cancelJob, serialize, deserialize, setLabor } from '../src/simulation.js';
import { SERVICE_INTERVAL, recordOperation, setAutoService, scheduleMaintenance } from '../src/maintenance.js';
import { setMachineEnabled } from '../src/industry.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { breathable } from '../src/atmosphere.js';
import { refreshPower } from '../src/power.js';
const until = (s, predicate, limit = 200) => { for (let i = 0; i < limit && !predicate(); i++) step(s); assert.ok(predicate(), 'Expected state before tick limit'); };
const fixture = () => { const s = createGame(), site = s.sites.surface; return { s, site, life: at(site, 7, 7), bank: at(site, 13, 7), depot: at(site, 8, 10) }; };

test('operating time counts supplied machines and actual battery transfers, not UI refreshes', () => {
  const { s, site, life, bank } = fixture(); step(s);
  assert.equal(life.maintenance.usage, 1); assert.equal(bank.maintenance.usage, 1);
  for (let i = 0; i < 10; i++) refreshPower(s, site);
  assert.equal(life.maintenance.usage, 1); assert.equal(bank.maintenance.usage, 1);
  step(s, 5); assert.equal(bank.charge, 120); const usage = bank.maintenance.usage;
  step(s, 3); assert.equal(bank.maintenance.usage, usage);
  setMachineEnabled(s, 'surface', 7, 7, false); const previous = life.maintenance.usage; step(s, 5);
  assert.equal(life.maintenance.usage, previous);
});

test('overdue operation reduces condition at a known rate and shutdown stops the wear', () => {
  const { s, site, life } = fixture(); life.maintenance.usage = SERVICE_INTERVAL - 1;
  step(s); assert.equal(life.hp, 100); assert.ok(s.log.some(e => e.message.includes('due for service')));
  step(s, 30); assert.equal(life.hp, 99); assert.equal(site.incidents[0].cause, 'wear');
  setMachineEnabled(s, 'surface', 7, 7, false); step(s, 35); assert.equal(life.hp, 99);
  const copy = deserialize(serialize(s)); assert.deepEqual(copy, s);
});

test('neglected wear can break equipment while retaining its delivered input and production batch', () => {
  const { s, site } = fixture(), farm = at(site, 7, 9);
  farm.hp = 1; farm.maintenance.usage = SERVICE_INTERVAL + 29; farm.machine.batch = { water: 1, fertilizer: .25 }; farm.machine.progress = 4;
  recordOperation(s, site, new Set([farm])); assert.equal(farm.hp, 0); step(s);
  assert.equal(farm.machine.status, 'Needs repair'); assert.deepEqual(farm.machine.batch, { water: 1, fertilizer: .25 }); assert.equal(farm.machine.progress, 4);
  const repair = order(s, 'surface', 7, 9, 'repair'); assert.equal(repair.ok, true);
  until(s, () => !s.jobs.includes(repair.job)); assert.equal(farm.hp, 100); assert.equal(farm.maintenance.usage, 0);
});

test('manual service requires a physical delivery and resets wear only when the engineer finishes', () => {
  const { s, life } = fixture(); life.maintenance.usage = SERVICE_INTERVAL; life.hp = 80;
  const before = totalResources(s).alloy, j = order(s, 'surface', 7, 7, 'service').job;
  assert.ok(j); assert.equal(life.hp, 80); assert.equal(totalResources(s).alloy, before);
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); assert.equal(j.remaining, j.work); assert.ok(life.maintenance.usage >= SERVICE_INTERVAL);
  until(s, () => !s.jobs.includes(j)); assert.equal(life.hp, 100); assert.equal(life.maintenance.usage, 0); assert.equal(life.maintenance.servicedAt, s.tick); assert.equal(totalResources(s).alloy, before - 1);
});

test('automatic service makes one engineering job and reports unavailable resources without creating supplies', () => {
  const { s, life, depot } = fixture(); life.maintenance.usage = SERVICE_INTERVAL; depot.stock.alloy = 0; syncResources(s);
  setAutoService(s, 'surface', 7, 7, true); scheduleMaintenance(s, order);
  assert.equal(s.jobs.length, 0); assert.match(life.maintenance.blocked, /supplies/);
  depot.stock.alloy = 2; syncResources(s); scheduleMaintenance(s, order); scheduleMaintenance(s, order);
  assert.equal(s.jobs.length, 1); const j = s.jobs[0]; assert.equal(j.kind, 'service'); assert.equal(j.automaticMaintenance, true); assert.equal(j.priority, 5); assert.equal(life.maintenance.blocked, null);
  for (const c of s.crew) setLabor(s, c.id, 'engineering', false); step(s);
  assert.equal(j.worker, null); assert.match(j.blockedReason, /engineering/i);
  setLabor(s, s.crew[1].id, 'engineering', true); until(s, () => !s.jobs.includes(j)); assert.equal(life.maintenance.usage, 0);
});

test('cancelling automatic service returns reserved supplies and disables repeated requeueing', () => {
  const { s, life } = fixture(); life.maintenance.usage = SERVICE_INTERVAL; setAutoService(s, 'surface', 7, 7, true);
  const before = totalResources(s).alloy; scheduleMaintenance(s, order); const j = s.jobs[0];
  until(s, () => s.crew.some(c => c.delivery?.job === j.id)); cancelJob(s, j.id); step(s, 4);
  assert.equal(life.maintenance.auto, false); assert.equal(s.jobs.length, 0); assert.equal(totalResources(s).alloy, before); assert.ok(life.maintenance.usage >= SERVICE_INTERVAL);
});

test('automatic repair handles broken equipment and retains battery energy through repair', () => {
  const { s, site, bank } = fixture(); bank.hp = 0; setAutoService(s, 'surface', 13, 7, true); const before = bank.charge;
  scheduleMaintenance(s, order); const j = s.jobs[0]; assert.equal(j.kind, 'repair'); step(s); assert.equal(bank.charge, before);
  until(s, () => !s.jobs.includes(j)); assert.equal(bank.hp, 100); assert.equal(bank.charge, before); assert.equal(bank.maintenance.usage, 0); assert.equal(site.energy.discarded, 0);
});

test('forecast identifies a tile in advance and impact damage is recorded there', () => {
  const { s, site } = fixture(); s.debris.next = 100; step(s, 9); assert.equal(s.debris.target, null);
  step(s); const target = { ...s.debris.target }, tile = at(site, target.x, target.y), hp = tile.hp;
  assert.ok(s.log.some(e => e.message.includes('Impact in 90s'))); step(s, 89); assert.equal(tile.hp, hp);
  const cableHp = tile.cable?.hp; step(s);
  if (tile.building) assert.equal(tile.hp, hp - 35);
  if (tile.cable) assert.equal(tile.cable.hp, Math.max(0, cableHp - 60));
  assert.equal(s.debris.count, 1); assert.equal(s.debris.next, 1300); assert.equal(s.debris.target, null);
  assert.ok(site.incidents.some(i => i.x === target.x && i.y === target.y && i.cause === 'debris'));
  assert.deepEqual(deserialize(serialize(s)), s);
});

test('damage to the outdoor cable interrupts life support; crew repair restores the atmosphere', () => {
  const { s, site, life } = fixture(), cable = at(site, 7, 13);
  assert.ok(cable.cable); cable.cable.hp = 40; s.debris = { next: 1, target: { x: 7, y: 13 }, count: 0 };
  step(s, 175); assert.equal(cable.cable.hp, 0); assert.equal(life.powered, false); assert.equal(breathable(site.rooms[0]), false);
  const j = order(s, 'surface', 7, 13, 'repairCable').job; assert.ok(j);
  until(s, () => cable.cable.hp === 100 && breathable(site.rooms[0]), 220);
  assert.equal(life.powered, true); assert.ok(site.incidents.some(i => i.target === 'cable' && i.cause === 'debris'));
});

test('hull impact leaks atmosphere and delivered repair supplies restore the seal', () => {
  const { s, site } = fixture(), wall = at(site, 6, 9); s.debris = { next: 1, target: { x: 6, y: 9 }, count: 0 };
  step(s); assert.equal(wall.hp, 65); assert.ok(site.rooms[0].leakArea > 0); const escaped = site.atmosphere.vented.oxygen;
  step(s, 10); assert.ok(site.atmosphere.vented.oxygen > escaped);
  const j = order(s, 'surface', 6, 9, 'repair').job; until(s, () => !s.jobs.includes(j)); assert.equal(wall.hp, 100); assert.equal(site.rooms[0].leakArea, 0);
});

test('pending service deliveries and forecast impacts continue identically after reload', () => {
  const { s, life } = fixture(); life.maintenance.usage = SERVICE_INTERVAL; s.debris.next = 50; setAutoService(s, 'surface', 7, 7, true);
  step(s, 2); assert.ok(s.jobs.some(j => j.automaticMaintenance)); assert.ok(s.debris.target);
  const copy = deserialize(serialize(s)); step(s, 100); step(copy, 100); assert.deepEqual(copy, s);
});

test('schema-six migration adds fresh service records and a future forecast without changing inventories or energy', () => {
  const { s } = fixture(); step(s, 10); s.version = 6; delete s.debris;
  for (const site of Object.values(s.sites)) { delete site.incidents; for (const t of site.tiles) delete t.maintenance; }
  const before = totalResources(s), energy = s.sites.surface.energy, copy = deserialize(serialize(s));
  assert.equal(copy.version, VERSION); assert.deepEqual(totalResources(copy), before); assert.deepEqual(copy.sites.surface.energy, energy);
  assert.equal(at(copy.sites.surface, 7, 7).maintenance.usage, 0); assert.equal(copy.debris.next, 1210); assert.deepEqual(deserialize(serialize(copy)), copy);
});

test('invalid usage, service dates, incident records and forecasts are rejected', () => {
  for (const corrupt of [
    s => { at(s.sites.surface, 7, 7).maintenance.usage = -1; },
    s => { at(s.sites.surface, 7, 7).maintenance.servicedAt = 1; },
    s => { at(s.sites.surface, 7, 7).maintenance.auto = 'yes'; },
    s => { s.debris.next = 0; },
    s => { s.debris.target = { x: 100, y: 1 }; },
    s => { s.sites.surface.incidents = [{ tick: 0, x: 7, y: 7, target: 'structure', cause: 'debris', amount: 999 }]; },
  ]) { const s = createGame(); corrupt(s); assert.throws(() => deserialize(serialize(s))); }
});
