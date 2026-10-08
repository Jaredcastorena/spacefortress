import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo } from '../src/simulation.js';
import { haul } from '../src/industry.js';

function fixture(air) {
  const s = createGame(), site = s.sites.surface;
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  for (const c of s.crew) { c.intent = null; c.carry = null; c.delivery = null; }
  const c = s.crew[0], depot = at(site, 8, 10), scrubber = at(site, 7, 7), ore = at(site, 12, 10);
  c.x = depot.x; c.y = depot.y; c.labors.hauling = true;
  depot.stock = { air: 12 }; ore.drop = { ore: 5 };
  scrubber.machine.enabled = true; scrubber.machine.input = { air };
  return { s, site, c, depot, scrubber, ore };
}

function finishDelivery({ s, site, c }) {
  for (let i = 0; i < 30 && (c.intent || c.carry); i++) haul(s, c, site, pathTo);
  assert.equal(c.intent, null, 'pickup completes within the hauling call budget');
  assert.equal(c.carry, null, 'delivery completes within the hauling call budget');
}

test('roundoff after a real air delivery does not displace a useful ore shipment', () => {
  const f = fixture(3.99999999999997), { s, site, c, depot, scrubber, ore } = f;
  haul(s, c, site, pathTo);
  assert.deepEqual(c.carry, { air: 6 });
  finishDelivery(f);
  const filledAir = scrubber.machine.input.air;
  assert.ok(10 - filledAir > 0 && 10 - filledAir < 1e-9, 'ordinary delivery leaves a roundoff shortfall');
  assert.equal(depot.stock.air, 6);

  haul(s, c, site, pathTo);
  assert.deepEqual(c.intent?.items || c.carry, { ore: 5 }, 'real cargo wins over negligible air demand');
  finishDelivery(f);
  assert.equal(depot.stock.ore, 5);
  assert.equal(ore.drop, null);
  assert.equal(scrubber.machine.input.air, filledAir, 'skipping the roundoff demand does not round or add air');
  assert.equal(depot.stock.air, 6);
});

test('real air deficits still outrank ore and refill through ordinary hauling', () => {
  for (const air of [9.75, 10 - 1e-8]) {
    const f = fixture(air), { s, site, c, depot, scrubber, ore } = f, deficit = 10 - air;
    haul(s, c, site, pathTo);
    assert.deepEqual(c.carry, { air: deficit });
    finishDelivery(f);
    assert.equal(scrubber.machine.input.air, 10);
    assert.equal(depot.stock.air, 12 - deficit);
    assert.deepEqual(ore.drop, { ore: 5 });
  }
});
