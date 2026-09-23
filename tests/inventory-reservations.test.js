import test from 'node:test';
import assert from 'node:assert/strict';
import { incomingInventory, outgoingInventory, hasOutgoingInventory } from '../src/inventory-reservations.js';
import { createGame, at, pathTo, setLabor } from '../src/simulation.js';
import { haul } from '../src/industry.js';
import { initializeStorage, extract, add, totalResources } from '../src/inventory.js';
import { foodLots } from '../src/food-lots.js';

const input = { kind: 'input', target: [7, 9] };
const depotDestination = { kind: 'stock', target: [8, 10] };
const pickup = (items, destination = input, source = 'output', target = [12, 10]) => ({ type: 'haul', target, source, items, destination });
const crew = (id, fields = {}) => ({ id, site: 'surface', health: 100, carry: null, delivery: null, intent: null, ...fields });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

function fixture() {
  const s = createGame(), site = s.sites.surface, depot = at(site, 8, 10);
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  for (const c of s.crew) { c.intent = null; c.carry = null; c.delivery = null; c.x = 8; c.y = 8; }
  depot.stock = {};
  return { s, site, depot, c: s.crew[0], other: s.crew[1] };
}

test('incoming claims count matching live pickup and actual carried quantities once', () => {
  const s = { crew: [
    crew('pickup', { intent: pickup({ water: 1.25, food: 2 }) }),
    crew('carrying', { carry: { water: .5 }, delivery: input, intent: { type: 'rest', target: [9, 9] } }),
    crew('other-site', { site: 'wreck', intent: pickup({ water: 9 }) }),
    crew('dead', { health: 0, carry: { water: 7 }, delivery: input }),
    crew('other-kind', { intent: pickup({ water: 8 }, { ...input, kind: 'stock' }) }),
    crew('other-tile', { intent: pickup({ water: 6 }, { ...input, target: [7, 10] }) }),
    crew('abandoned-cargo', { carry: { water: 4 }, delivery: null }),
    crew('job-cargo', { carry: { water: 3 }, delivery: { ...input, kind: 'job', job: 'job-1' } }),
  ] };
  assert.equal(incomingInventory(s, 'surface', input, 'water'), 1.75);
  assert.equal(incomingInventory(s, 'surface', input, 'food'), 2);
  assert.equal(incomingInventory(s, 'surface', input, 'ore'), 0);
  assert.equal(incomingInventory(s, 'wreck', input, 'water'), 9);
});

test('output claims reserve only pending pickups from the matching inventory owner', () => {
  const s = { crew: [
    crew('first', { intent: pickup({ water: 2, food: 1 }, depotDestination) }),
    crew('second', { intent: pickup({ water: .75 }, depotDestination) }),
    crew('carrying', { carry: { water: 6 }, delivery: depotDestination, intent: { type: 'air', target: null } }),
    crew('dead', { health: 0, intent: pickup({ water: 8 }, depotDestination) }),
    crew('stock', { intent: pickup({ water: 9 }, depotDestination, 'stock') }),
    crew('elsewhere', { intent: pickup({ water: 9 }, depotDestination, 'output', [12, 11]) }),
    crew('off-site', { site: 'wreck', intent: pickup({ water: 9 }, depotDestination) }),
  ] };
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', 'water'), 2.75);
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', 'food'), 1);
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'stock', 'water'), 9);
  assert.equal(hasOutgoingInventory(s, 'surface', [12, 10], 'output', s.crew[0]), true);
  s.crew[1].intent = null;
  assert.equal(hasOutgoingInventory(s, 'surface', [12, 10], 'output', s.crew[0]), false);
});

test('reservation reads preserve metadata, RNG and state while cargo takes precedence over a stale pickup', () => {
  const meal = { id: 'meal-job-1', maker: 'crew-1', quality: 2, created: 0 };
  const item = { id: 'item-1', style: 'orbital', maker: 'crew-1', quality: 2, created: 0 };
  const s = { rng: 1234, tick: 17, crew: [
    crew('pickup', { intent: pickup({ water: .5, food: 1, _food: [{ amount: 1, age: 100, meal }], keepsakes: 1, _items: [item] }) }),
    // Readers also avoid double counting during an external transition that
    // has installed carry/delivery before clearing an old pickup intent.
    crew('transition', { carry: { water: .25 }, delivery: input, intent: pickup({ water: 6 }) }),
  ] };
  const before = JSON.stringify(s); freeze(s);
  assert.equal(incomingInventory(s, 'surface', input, 'water'), .75);
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', 'water'), .5);
  assert.equal(incomingInventory(s, 'surface', input, 'food'), 1);
  assert.equal(incomingInventory(s, 'surface', input, '_food'), 0);
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', '_items'), 0);
  assert.equal(JSON.stringify(s), before);
});

test('the shared source claim leaves unpromised output available without duplicating the reserved haul', () => {
  const { s, site, depot, c, other } = fixture(), source = at(site, 12, 10);
  source.building = 'bilgePump'; initializeStorage(source); source.machine.enabled = false;
  source.machine.output = { water: 8 };
  const before = totalResources(s).water;
  haul(s, c, site, pathTo);
  assert.equal(c.intent.source, 'output'); assert.deepEqual(c.intent.items, { water: 6 });
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', 'water'), 6);
  haul(s, other, site, pathTo);
  assert.equal(other.intent, null, 'another hauler keeps the existing exclusive-source rule');
  const available = source.machine.output.water - outgoingInventory(s, 'surface', [12, 10], 'output', 'water');
  const separate = extract(source.machine.output, { water: available });
  assert.deepEqual(separate, { water: 2 });
  for (let i = 0; i < 30 && !c.carry; i++) haul(s, c, site, pathTo);
  assert.equal(c.carry.water, 6); assert.equal(source.machine.output.water || 0, 0);
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', 'water'), 0);
  assert.equal(incomingInventory(s, 'surface', depotDestination, 'water'), 6);
  for (let i = 0; i < 30 && c.carry; i++) haul(s, c, site, pathTo);
  assert.equal(depot.stock.water, 6);
  assert.equal(totalResources(s).water + separate.water, before);
});

test('cancelled or dead pickup claims release output for another hauler', () => {
  for (const release of ['cancel', 'death']) {
    const { s, site, c, other } = fixture(), source = at(site, 12, 10);
    source.building = 'bilgePump'; initializeStorage(source); source.machine.enabled = false; source.machine.output = { water: 6 };
    haul(s, c, site, pathTo); assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', 'water'), 6);
    if (release === 'cancel') setLabor(s, c.id, 'hauling', false); else c.health = 0;
    assert.equal(outgoingInventory(s, 'surface', [12, 10], 'output', 'water'), 0);
    haul(s, other, site, pathTo);
    assert.equal(other.intent.source, 'output'); assert.deepEqual(other.intent.items, { water: 6 });
    assert.equal(source.machine.output.water, 6, 'claiming does not remove physical material');
  }
});

test('haulers reserve only residual machine space after held and pending incoming shipments', () => {
  const { s, site, depot } = fixture(), farm = at(site, 7, 9), extra = at(site, 12, 11);
  farm.machine.enabled = true; farm.machine.input = { water: .25, fertilizer: .5 };
  extra.building = 'stockpile'; initializeStorage(extra); extra.stock = { water: 10 }; depot.stock = { water: 10 };
  s.crew[0].carry = { water: .75 }; s.crew[0].delivery = input; s.crew[0].intent = { type: 'rest', target: [9, 9] };
  s.crew[1].intent = pickup({ water: .5 }, input, 'stock', [8, 10]);
  assert.equal(incomingInventory(s, 'surface', input, 'water'), 1.25);
  haul(s, s.crew[2], site, pathTo);
  assert.deepEqual(s.crew[2].intent.items, { water: .5 });
  assert.deepEqual(s.crew[2].intent.target, [12, 11]);
  assert.equal(incomingInventory(s, 'surface', input, 'water') + farm.machine.input.water, 2);
  haul(s, s.crew[3], site, pathTo);
  assert.equal(s.crew[3].intent, null);
  s.crew[1].intent = null;
  assert.equal(incomingInventory(s, 'surface', input, 'water'), 1.25, 'cancelling only releases the matching pending half-unit');
});

test('interrupted deliveries remain reserved and food hauling retains its original lot metadata', () => {
  const { s, site, depot, c } = fixture(), source = at(site, 12, 10);
  const meal = { id: 'meal-job-2', maker: c.id, quality: 3, created: s.tick };
  source.drop = { food: 2, _food: [{ amount: 2, age: 120, meal }] };
  haul(s, c, site, pathTo);
  assert.equal(incomingInventory(s, 'surface', depotDestination, 'food'), 2);
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'drop', 'food'), 2);
  for (let i = 0; i < 30 && !c.carry; i++) haul(s, c, site, pathTo);
  assert.equal(outgoingInventory(s, 'surface', [12, 10], 'drop', 'food'), 0);
  c.intent = { type: 'rest', target: [9, 9] }; setLabor(s, c.id, 'hauling', false);
  assert.equal(incomingInventory(s, 'surface', depotDestination, 'food'), 2);
  assert.deepEqual(foodLots(c.carry), [{ amount: 2, age: 120, meal }]);
  for (let i = 0; i < 30 && c.carry; i++) haul(s, c, site, pathTo);
  assert.equal(incomingInventory(s, 'surface', depotDestination, 'food'), 0);
  assert.deepEqual(foodLots(depot.stock), [{ amount: 2, age: 120, meal }]);
  // Water-only extraction/addition does not rebuild unrelated metadata.
  add(depot.stock, { water: 1 }); const before = structuredClone(depot.stock._food);
  const water = extract(depot.stock, { water: .5 }); add(depot.stock, water);
  assert.deepEqual(depot.stock._food, before);
});
