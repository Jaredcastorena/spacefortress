import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const captures = s => rows(s).filter(r => r.event?.id === 'pest.captured');
const act = (s, id, args) => {
  const result = executeAction(s, id, args, 'test');
  assert.equal(result.ok, true, id);
  return result;
};
function colony({ hp = 100, food = .75, pests = 1 } = {}) {
  const s = createGame(), site = s.sites.surface, trap = at(site, 8, 9), depot = at(site, 8, 10);
  at(site, 7, 9).machine.enabled = false;
  trap.building = 'trap'; trap.hp = hp;
  depot.stock.food = food; syncResources(s);
  s.creatures = Array.from({ length: pests }, (_, i) => ({ id: `test-tibble-${i}`, species: 'tibble', site: 'surface', z: 0, x: 8, y: 9, health: 100, fed: 20, age: 0 }));
  startRecording(s);
  return { s, site, trap, depot };
}

test('a destroyed trap neither captures a live pest nor spends physical bait', () => {
  const { s, depot } = colony({ hp: 0 }), before = totalResources(s).food;
  step(s, 10);
  assert.equal(s.creatures.length, 1);
  assert.equal(s.creatures[0].id, 'test-tibble-0');
  assert.equal(s.stats.trapped, 0);
  assert.equal(depot.stock.food, before);
  assert.equal(totalResources(s).food, before);
  assert.equal(captures(s).length, 0);
});

test('a positive-HP trap captures on its cadence and records its quarter-food cost', () => {
  const { s, depot } = colony({ hp: 1 }), before = totalResources(s).food;
  step(s, 9);
  assert.equal(s.creatures.length, 1);
  assert.equal(totalResources(s).food, before);
  assert.equal(captures(s).length, 0);
  step(s);
  assert.equal(s.creatures.length, 0);
  assert.equal(s.stats.trapped, 1);
  assert.equal(depot.stock.food, before - .25);
  assert.equal(totalResources(s).food, before - .25);
  const [capture] = captures(s);
  assert.equal(captures(s).length, 1);
  assert.equal(capture.tick, 10);
  assert.deepEqual(capture.event, { id: 'pest.captured', entity: 'test-tibble-0', target: 'tile:surface:8:9', food: .25 });
});

for (const food of [0, .24]) test(`a healthy trap with ${food} food cannot capture or spend partial bait`, () => {
  const { s, depot } = colony({ food });
  step(s, 10);
  assert.equal(s.creatures.length, 1);
  assert.equal(s.stats.trapped, 0);
  assert.equal(depot.stock.food, food);
  assert.equal(totalResources(s).food, food);
  assert.equal(captures(s).length, 0);
});

test('multiple traps consume exactly one physical lure for each distinct captured pest', () => {
  const { s, site } = colony({ food: .5, pests: 3 });
  const second = at(site, 9, 9); second.building = 'trap'; second.hp = 100;
  step(s, 10);
  const captured = captures(s).map(r => r.event);
  assert.equal(s.creatures.length, 1);
  assert.equal(s.stats.trapped, 2);
  assert.equal(new Set(captured.map(e => e.entity)).size, 2);
  assert.deepEqual(captured.map(e => e.target), ['tile:surface:8:9', 'tile:surface:9:9']);
  assert.equal(captured.reduce((n, e) => n + e.food, 0), .5);
  assert.equal(totalResources(s).food, 0);
  step(s, 10);
  assert.equal(s.creatures.length, 1);
  assert.equal(captures(s).length, 2);
});

test('shared paid repair physically restores a destroyed trap before capture resumes', () => {
  const { s, trap } = colony({ hp: 0 });
  act(s, 'simulation.step', { ticks: 10 });
  assert.equal(s.creatures.length, 1);
  assert.equal(trap.hp, 0);
  const before = totalResources(s), result = act(s, 'job.order', { site: 'surface', x: trap.x, y: trap.y, kind: 'repair' });
  const job = s.jobs.find(j => j.id === result.job);
  assert.ok(job);
  assert.deepEqual(job.cost, { alloy: 1 });
  assert.deepEqual(job.materials, {});
  assert.equal(totalResources(s).alloy, before.alloy);
  let delivered = false, completedAt = null;
  for (let i = 0; i < 80 && s.creatures.length; i++) {
    act(s, 'simulation.step', { ticks: 1 });
    delivered ||= s.crew.some(c => c.delivery?.job === job.id && c.carry?.alloy === 1) || job.materials.alloy === 1;
    if (s.jobs.includes(job)) {
      assert.equal(trap.hp, 0);
      assert.equal(captures(s).length, 0);
      assert.equal(totalResources(s).alloy, before.alloy);
    } else completedAt ??= s.tick;
  }
  assert.ok(delivered, 'repair requires transported or staged physical alloy');
  assert.ok(completedAt !== null, 'repair completes within the bounded public-command run');
  assert.equal(trap.hp, 100);
  assert.equal(s.creatures.length, 0);
  assert.equal(s.stats.trapped, 1);
  assert.equal(totalResources(s).alloy, before.alloy - 1);
  assert.equal(totalResources(s).food, before.food - .25);
  const [capture] = captures(s);
  assert.ok(capture.tick >= completedAt);
  assert.equal(capture.tick % 10, 0);
  assert.equal(capture.event.food, .25);
  assert.ok(rows(s).some(r => r.kind === 'action.requested' && r.action.id === 'job.order' && r.action.args.kind === 'repair'));
  assert.ok(capture.command !== null, 'capture remains associated with the shared simulation command');
});
