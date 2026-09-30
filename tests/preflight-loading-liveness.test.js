import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { departureCrew, refillMix } from '../src/preflight.js';
import { totalResources, quantity } from '../src/inventory.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

const crewIds = ['crew-0', 'crew-6'];
function act(s, id, args = {}) {
  const result = executeAction(s, id, args, 'test');
  assert.equal(result.ok, true, `${id}: ${JSON.stringify(result)}`);
  return result;
}
function delayedDeparture() {
  const s = createGame();
  // Ordinary labor and mining orders leave two selected miners outside. While
  // hauling is disabled, their real suits keep supplying their oxygen needs.
  for (const c of s.crew) {
    act(s, 'crew.labor', { crew: c.id, labor: 'hauling', enabled: false });
    act(s, 'crew.labor', { crew: c.id, labor: 'mining', enabled: crewIds.includes(c.id) });
  }
  for (const [x, y] of [[17, 7], [18, 8]]) act(s, 'job.order', { site: 'surface', x, y, kind: 'mine' });
  step(s, 80);
  act(s, 'expedition.launch', { site: 'wreck', crewIds });
  step(s, 170);
  assert.equal(s.mission, null);
  assert.equal(quantity(s.shuttle.supplies), 0);
  assert.ok(refillMix(departureCrew(s)) > 10, 'real suit use exhausted the initial loading margin');
  assert.deepEqual(s.departure.crew, crewIds);
  return s;
}
function resumeHauling(s) {
  for (const c of s.crew) act(s, 'crew.labor', { crew: c.id, labor: 'hauling', enabled: true });
}
const loading = s => s.jobs.find(j => j.kind === 'loadShuttle');
const carrying = s => s.crew.find(c => c.delivery?.kind === 'job' && c.delivery.job === loading(s)?.id && c.carry);

test('delayed physical loading catches real suit consumption with paid batches and deterministic reload', () => {
  const s = delayedDeparture(), restored = deserialize(serialize(s));
  startRecording(s, { maxRecords: 10000, maxBytes: 32_000_000 });
  resumeHauling(s); resumeHauling(restored);
  const fuelBefore = totalResources(s).fuel;
  let sawCarry = false, sawStaging = false, previousTarget = s.departure.target.air, targetChanges = 0;
  for (let i = 0; i < 400 && !s.mission; i++) {
    step(s); step(restored);
    sawCarry ||= !!carrying(s);
    sawStaging ||= quantity(loading(s)?.materials) > 0;
    if (s.departure && s.departure.target.air !== previousTarget) {
      assert.ok(s.departure.target.air >= previousTarget + 9, 'top-ups retain a useful haulable reserve');
      previousTarget = s.departure.target.air; targetChanges++;
    }
    if (s.tick % 30 === 0 || s.mission) assert.equal(serialize(deserialize(serialize(s))), serialize(s));
  }
  assert.equal(s.mission?.phase, 'outbound', 'available finite stock and working haulers must eventually catch the refill requirement');
  assert.ok(sawCarry && sawStaging, 'supplies pass through real carried and staged owners');
  assert.ok(targetChanges > 0 && targetChanges < 5, 'loading does not chase a new tiny target every few ticks');
  assert.deepEqual(s.mission.crew, crewIds);
  assert.equal(serialize(restored), serialize(s));
  assert.ok(s.crew.filter(c => crewIds.includes(c.id)).every(c => c.site === 'transit' && c.oxygen === 100));
  assert.equal(totalResources(s).fuel, fuelBefore - 1, 'outbound consumes the existing half-route fuel cost');
  assert.equal(s.shuttle.supplies.fuel, s.mission.returnFuel, 'the other leg remains physically aboard');
  const rows = exportRecording(s).trim().split('\n').map(JSON.parse);
  const changes = rows.filter(row => row.event?.id === 'expedition.preparation.supplies_changed');
  assert.equal(changes.length, targetChanges);
  assert.ok(changes.every(row => row.event.resource === 'air' && row.event.next > row.event.previous && row.event.crewIds.join() === crewIds.join()));
  const departure = rows.find(row => row.event?.id === 'expedition.departed').event;
  assert.ok(departure.consumed.air > 20, 'actual depleted suits are refilled from the paid loaded mix');
  assert.equal(departure.consumed.food, 2);
});

test('cancelling delayed buffered loading preserves every reserved and held parcel', () => {
  const s = delayedDeparture(); resumeHauling(s);
  for (let i = 0; i < 100 && !carrying(s); i++) step(s);
  const carrier = carrying(s); assert.ok(carrier, 'a real worker picked up reserved supplies');
  const held = structuredClone(carrier.carry), aboard = structuredClone(s.shuttle.supplies), before = totalResources(s);
  act(s, 'expedition.cancel_departure');
  assert.equal(s.departure, null); assert.equal(s.mission, null); assert.equal(loading(s), undefined);
  assert.deepEqual(carrier.carry, held); assert.equal(carrier.delivery, null);
  assert.deepEqual(s.shuttle.supplies, aboard);
  assert.deepEqual(totalResources(s), before);
  assert.equal(serialize(deserialize(serialize(s))), serialize(s));
});
