import { refreshPower } from '../src/power.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, pathTo, order, cancelJob, serialize, deserialize, step, setLabor } from '../src/simulation.js';
import { initializeStorage, totalResources, syncResources, quantity, take } from '../src/inventory.js';
import { haul, spillStorage } from '../src/industry.js';
import { depotUsage, DEPOT_CAPACITY, setDepotAccepted, setDepotPriority } from '../src/storage.js';

function setup() {
  const s = createGame(), site = s.sites.surface, d = at(site, 8, 10);
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  d.stock = {}; syncResources(s); refreshPower(s, site);
  return { s, site, d, c: s.crew[0] };
}
const depot = (site, x, y) => { const t = at(site, x, y); t.building = 'stockpile'; initializeStorage(t); return t; };
function tickHaul(s, crew = s.crew) {
  for (const c of crew) haul(s, c, s.sites.surface, pathTo);
  syncResources(s); refreshPower(s, s.sites.surface); deserialize(serialize(s));
}
function deliver(s, condition, crew = s.crew, limit = 80) {
  for (let i = 0; i < limit && !condition(); i++) tickHaul(s, crew);
  assert.ok(condition(), 'Expected haul to complete');
}

test('pickup claims share finite depot capacity before any goods arrive', () => {
  const { s, site, d } = setup(); d.stock.ore = DEPOT_CAPACITY - 8;
  at(site, 11, 10).drop = { components: 12 }; at(site, 12, 10).drop = { components: 12 };
  const before = totalResources(s); tickHaul(s);
  assert.equal(depotUsage(s, 'surface', d).incoming, 8);
  deliver(s, () => quantity(d.stock) === DEPOT_CAPACITY); tickHaul(s);
  assert.equal(s.crew.some(c => c.intent?.type === 'haul' || c.carry), false);
  assert.equal(site.tiles.reduce((n, t) => n + (t.drop?.components || 0), 0), 16);
  assert.deepEqual(totalResources(s), before);
});

test('reserved construction goods retain space until collection and can be refunded while full', () => {
  const { s, site, d } = setup(); d.stock.alloy = DEPOT_CAPACITY; syncResources(s);
  const j = order(s, 'surface', 11, 14, 'build', 'solar').job;
  assert.ok(j); assert.equal(depotUsage(s, 'surface', d).reserved, 5);
  assert.equal(depotUsage(s, 'surface', d).free, 0);
  at(site, 11, 10).drop = { components: 6 }; tickHaul(s);
  assert.equal(depotUsage(s, 'surface', d).incoming, 0);
  setDepotAccepted(s, 'surface', 8, 10, 'alloy', false);
  cancelJob(s, j.id); assert.equal(d.stock.alloy, DEPOT_CAPACITY);
  assert.equal(depotUsage(s, 'surface', d).reserved, 0); deserialize(serialize(s));
});

test('filters split mixed loose cargo between accepting depots and retain unaccepted goods', () => {
  const { s, site, d } = setup(), second = depot(site, 12, 11);
  d.storage.accepted = ['ore']; second.storage.accepted = ['food'];
  const pile = at(site, 10, 10); pile.drop = { ore: 7, food: 4, fuel: 3 };
  const before = totalResources(s); deliver(s, () => d.stock.ore === 7 && second.stock.food === 4);
  assert.deepEqual(pile.drop, { fuel: 3 }); assert.deepEqual(totalResources(s), before);
});

test('higher-priority depots attract stock; equal-priority depots do not shuttle it back', () => {
  const { s, site, d } = setup(), second = depot(site, 12, 11); d.stock.ore = 9;
  setDepotPriority(s, 'surface', 12, 11, 5);
  deliver(s, () => second.stock.ore === 9); tickHaul(s);
  assert.equal(s.crew.some(c => c.intent?.type === 'haul' || c.carry), false);
  setDepotPriority(s, 'surface', 8, 10, 5); tickHaul(s);
  assert.equal(second.stock.ore, 9); assert.equal(s.crew.some(c => c.intent?.type === 'haul'), false);
});

test('rejected existing stock evacuates physically without becoming unusable or vanishing', () => {
  const { s, site, d, c } = setup(), second = depot(site, 12, 11); d.stock.ore = 6; syncResources(s);
  setDepotAccepted(s, 'surface', 8, 10, 'ore', false);
  assert.equal(s.resources.ore, 6); assert.equal(d.stock.ore, 6);
  deliver(s, () => !!c.carry, [c]); assert.equal(s.resources.ore, 0);
  deliver(s, () => second.stock.ore === 6, [c]); assert.equal(totalResources(s).ore, 6);
});

test('filter edits invalidate pending pickups and reroute cargo already in hand', () => {
  const { s, site, d, c } = setup(), second = depot(site, 12, 11); second.storage.accepted = [];
  at(site, 11, 10).drop = { components: 6 }; c.x = 8; c.y = 8; tickHaul(s, [c]);
  assert.equal(c.intent.type, 'haul'); setDepotAccepted(s, 'surface', 8, 10, 'components', false);
  tickHaul(s, [c]); assert.equal(c.intent, null); assert.equal(at(site, 11, 10).drop.components, 6);
  setDepotAccepted(s, 'surface', 8, 10, 'components', true);
  deliver(s, () => !!c.carry, [c]); setDepotAccepted(s, 'surface', 8, 10, 'components', false);
  setDepotAccepted(s, 'surface', 12, 11, 'components', true);
  deliver(s, () => second.stock.components === 6, [c]); assert.equal(d.stock.components, undefined);
});

test('undeliverable held cargo is placed locally and hauling resumes when storage opens', () => {
  const { s, site, d, c } = setup(); d.stock.ore = DEPOT_CAPACITY;
  c.carry = { components: 6 }; c.delivery = { kind: 'stock', target: [8, 10] }; c.x = 11; c.y = 10;
  const before = totalResources(s); tickHaul(s, [c]);
  assert.equal(c.carry, null); assert.equal(at(site, 11, 10).drop.components, 6);
  assert.deepEqual(totalResources(s), before); take(d.stock, { ore: 6 });
  deliver(s, () => d.stock.components === 6, [c]); assert.equal(quantity(d.stock), DEPOT_CAPACITY);
});

test('recovery keeps held cargo capacity reserved and deterministic across saves', () => {
  const { s, site, d, c } = setup(); d.stock.ore = DEPOT_CAPACITY - 6;
  c.carry = { components: 6 }; c.delivery = { kind: 'stock', target: [8, 10] }; c.energy = 1;
  at(site, 11, 10).drop = { components: 6 }; syncResources(s); step(s);
  assert.equal(c.intent.type, 'rest'); assert.equal(depotUsage(s, 'surface', d).incoming, 6);
  const copy = deserialize(serialize(s)); step(s, 130); step(copy, 130);
  assert.deepEqual(copy, s); assert.equal(d.stock.components, 6); assert.equal(at(site, 11, 10).drop.components, 6);
});

test('urgent life-support supply wins over equally urgent storage collection', () => {
  const { s, site, d, c } = setup(); d.stock.air = 10; at(site, 7, 7).machine.enabled = true;
  at(site, 10, 10).drop = { ore: 10 }; d.storage.priority = 5; c.x = 8; c.y = 8;
  tickHaul(s, [c]); assert.equal(c.intent.destination.kind, 'input'); assert.deepEqual(c.intent.items, { air: 6 });
});

test('production priority orders machine shipments ahead of less urgent storage', () => {
  const { s, site, d, c } = setup(); const m = at(site, 13, 10).machine; m.enabled = true; m.order.priority = 5;
  d.stock.ore = 2; at(site, 10, 10).drop = { components: 6 }; c.x = 8; c.y = 8;
  tickHaul(s, [c]); assert.equal(c.intent.destination.kind, 'input'); assert.deepEqual(c.intent.items, { ore: 2 });
});

test('storage congestion stops production at its output buffer; freeing space restarts it', () => {
  const { s, site, d } = setup(), m = at(site, 13, 10).machine;
  d.stock.ore = DEPOT_CAPACITY; m.enabled = true; m.output.alloy = 12; m.input.ore = 2;
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', false)); syncResources(s); step(s, 8);
  assert.match(m.status, /Output full/);
  s.crew.forEach(c => setLabor(s, c.id, 'hauling', true)); step(s, 8);
  assert.equal(m.progress, 0); assert.equal(m.output.alloy, 12);
  const extra = depot(site, 12, 11); extra.storage.accepted = ['alloy'];
  for (let i = 0; i < 50 && m.completed === 0; i++) { step(s); deserialize(serialize(s)); }
  assert.ok(m.completed > 0); assert.ok(extra.stock.alloy > 0);
});

test('depot loss preserves supplies and redirects pending cargo', () => {
  const { s, site, d, c } = setup(), second = depot(site, 12, 11);
  d.stock.ore = 2; c.carry = { components: 6 }; c.delivery = { kind: 'stock', target: [8, 10] };
  const before = totalResources(s); spillStorage(d); d.building = null;
  deliver(s, () => second.stock.components === 6, [c]); assert.deepEqual(totalResources(s), before);
});

test('schema-thirteen migration preserves overfull depots and in-flight shipments without granting space', () => {
  const { s, d, c } = setup(); d.stock.ore = 400; c.carry = { components: 6 }; c.delivery = { kind: 'stock', target: [8, 10] };
  s.version = 13; delete d.storage; syncResources(s); const before = totalResources(s), copy = deserialize(serialize(s));
  assert.equal(copy.version, VERSION); assert.deepEqual(totalResources(copy), before);
  assert.equal(depotUsage(copy, 'surface', at(copy.sites.surface, 8, 10)).free, 0);
  tickHaul(copy, [copy.crew[0]]); assert.equal(copy.crew[0].carry, null); assert.deepEqual(totalResources(copy), before);
});

test('malformed storage filters, priorities and orphan policies fail save validation', () => {
  for (const change of [d => d.storage.accepted.push('ore'), d => d.storage.accepted.push('plutonium'), d => d.storage.priority = 4, d => delete d.storage, d => { d.building = null; delete d.stock; }]) {
    const { s, d } = setup(); change(d); assert.throws(() => deserialize(serialize(s)), /depot|Storage/);
  }
});
