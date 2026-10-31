import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo } from '../src/simulation.js';
import { haul } from '../src/industry.js';
import { totalResources, CARRY_CAPACITY } from '../src/inventory.js';

function setup({ buffered = 0, available = 20 } = {}) {
  const s = createGame(), site = s.sites.surface;
  const depot = at(site, 8, 10), scrubber = at(site, 7, 7), refinery = at(site, 13, 10);
  for (const tile of site.tiles) if (tile.machine) tile.machine.enabled = false;
  scrubber.machine.enabled = refinery.machine.enabled = true;
  scrubber.machine.input = { air: buffered }; refinery.machine.input = {};
  depot.stock.air = available; depot.stock.ore = 1;
  for (const c of s.crew) {
    c.carry = c.delivery = c.intent = null;
    c.x = depot.x; c.y = depot.y; c.labors.hauling = true;
  }
  return { s, site, depot, scrubber, refinery, carrier: s.crew[0] };
}

function deliver(s, site, carrier) {
  for (let i = 0; i < 20 && carrier.carry; i++) haul(s, carrier, site, pathTo);
  assert.equal(carrier.carry, null, 'shipment reaches its destination');
}

test('nearly full life support leaves the depot available for an industrial delivery', () => {
  const { s, site, depot, scrubber, refinery, carrier } = setup({ buffered: 9.997 });
  const before = totalResources(s);
  assert.equal(haul(s, carrier, site, pathTo), true);
  assert.deepEqual(carrier.carry, { ore: 1 });
  deliver(s, site, carrier);
  assert.equal(refinery.machine.input.ore, 1);
  assert.equal(scrubber.machine.input.air, 9.997);
  assert.equal(depot.stock.air, 20);
  assert.deepEqual(totalResources(s), before);
});

test('life support retains priority when a full replenishment batch is needed', () => {
  const { s, site, depot, scrubber, carrier } = setup({ buffered: 5 });
  const before = totalResources(s);
  haul(s, carrier, site, pathTo);
  assert.deepEqual(carrier.carry, { air: 5 });
  assert.equal(depot.stock.ore, 1);
  deliver(s, site, carrier);
  assert.equal(scrubber.machine.input.air, 10);
  assert.deepEqual(totalResources(s), before);
});

test('an empty life-support buffer can receive less than a batch from a finite source', () => {
  const { s, site, depot, scrubber, carrier } = setup({ available: .125 });
  const before = totalResources(s);
  haul(s, carrier, site, pathTo);
  assert.deepEqual(carrier.carry, { air: .125 });
  assert.equal(depot.stock.air || 0, 0);
  deliver(s, site, carrier);
  assert.equal(scrubber.machine.input.air, .125);
  assert.deepEqual(totalResources(s), before);
});

test('incoming life-support cargo suppresses small duplicate top-ups without blocking other inputs', () => {
  const { s, site, scrubber, refinery, carrier } = setup();
  const before = totalResources(s), other = s.crew[1];
  haul(s, carrier, site, pathTo);
  assert.deepEqual(carrier.carry, { air: CARRY_CAPACITY });
  haul(s, other, site, pathTo);
  assert.deepEqual(other.carry, { ore: 1 });
  deliver(s, site, carrier); deliver(s, site, other);
  assert.equal(scrubber.machine.input.air, CARRY_CAPACITY);
  assert.equal(refinery.machine.input.ore, 1);
  assert.deepEqual(totalResources(s), before);
});


test('staffed fractional recipes remain eligible while a nearly full scrubber waits', () => {
  const { s, site, scrubber, refinery, carrier } = setup({ buffered: 9.997 });
  const farm = at(site, 7, 9);
  refinery.machine.enabled = false; farm.machine.enabled = true;
  farm.machine.input = { water: 2, fertilizer: .49 };
  const before = totalResources(s);
  haul(s, carrier, site, pathTo);
  assert.ok(Math.abs(carrier.carry.fertilizer - .01) < 1e-12);
  deliver(s, site, carrier);
  assert.equal(farm.machine.input.fertilizer, .5);
  assert.equal(scrubber.machine.input.air, 9.997);
  assert.deepEqual(totalResources(s), before);
});
