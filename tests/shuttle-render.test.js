import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at } from '../src/simulation.js';
import { Renderer } from '../src/render.js';

const terminals = { surface: [16, 11], wreck: [4, 11], comet: [5, 10], solar: [5, 10] };
const project = ([x, y]) => [(x - y) * 32, (x + y) * 16];
function fixture() {
  const s = createGame();
  // This graphics harness has no DOM sprite factory; crew behavior is not under test.
  s.crew = [];
  return s;
}
function graphics() {
  const commands = [], crafts = [], renderer = Object.create(Renderer.prototype);
  renderer.ctx = new Proxy({}, { get(target, key) { return target[key] ?? (key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}); } });
  Object.assign(renderer, { w: 1440, h: 1000, dpr: 1, zoom: 1, pan: { x: 0, y: 0 }, stars: [], cutaway: true });
  for (const name of ['box', 'diamond', 'polygon']) renderer[name] = (...args) => commands.push({ name, args });
  renderer.shuttleCraft = (x, y) => crafts.push([x, y]);
  return { renderer, commands, crafts };
}
function draw(s, site) {
  const graphicsResult = graphics();
  graphicsResult.renderer.draw(s, site, 'inspect', null);
  return graphicsResult;
}
function assertBerth(commands, site) {
  const [x, y] = project(terminals[site]);
  assert.ok(commands.some(({ name, args }) => site === 'surface'
    ? name === 'box' && args[0] === x && args[1] === y + 3 && args[5] === '#536874'
    : name === 'diamond' && args[0] === x && args[1] === y && args[2] === '#536772'), `${site} permanent berth remains visible`);
}

test('idle and departure preparation draw one surface craft and retain every empty remote berth', () => {
  for (const stage of [null, 'loading', 'boarding']) {
    const s = fixture();
    if (stage) s.departure = { site: 'wreck', stage };
    const before = structuredClone(s);
    for (const site of Object.keys(terminals)) {
      const { crafts, commands } = draw(s, site);
      assert.deepEqual(crafts, site === 'surface' ? [project(terminals.surface)] : []);
      assertBerth(commands, site);
    }
    assert.deepEqual(s, before, 'Drawing must not change simulation state');
  }
});

test('mission phases draw the craft only at the destination or in transit, even at zero timer', () => {
  for (const destination of ['wreck', 'comet', 'solar']) {
    for (const phase of ['outbound', 'working', 'boarding', 'returning']) {
      const s = fixture();
      s.mission = { site: destination, phase, remaining: 0, fit: 'standard' };
      const before = structuredClone(s);
      for (const site of Object.keys(terminals)) {
        const { crafts, commands } = draw(s, site);
        const landed = ['working', 'boarding'].includes(phase) && site === destination;
        assert.deepEqual(crafts, landed ? [project(terminals[site])] : [], `${destination}/${phase} viewed from ${site}`);
        assertBerth(commands, site);
      }
      assert.deepEqual(s, before);
    }
  }
});

test('one selected terminal receives the craft; destroyed terminals do not relocate it', () => {
  const s = fixture(); s.mission = { site: 'wreck', phase: 'working', remaining: 0, fit: 'standard' };
  const original = at(s.sites.wreck, ...terminals.wreck), extra = at(s.sites.wreck, 5, 11);
  extra.building = 'dock'; original.hp = 0;
  assert.deepEqual(draw(s, 'wreck').crafts, [project([5, 11])], 'Usable terminal receives the single craft');
  extra.hp = 0;
  assert.deepEqual(draw(s, 'wreck').crafts, [project(terminals.wreck)], 'Physical presence survives unusable terminals');
  assert.deepEqual(draw(s, 'surface').crafts, [], 'Damage never returns the craft to the surface');
  original.building = null; extra.building = null;
  assert.deepEqual(draw(s, 'wreck').crafts, [], 'No arbitrary tile becomes a replacement berth');
});

test('system map draws a travel marker only during actual outbound or return transit', () => {
  for (const phase of [null, 'outbound', 'working', 'boarding', 'returning']) {
    const s = fixture();
    if (phase) s.mission = { site: 'wreck', phase, remaining: 0, fit: 'standard' };
    const { renderer, commands } = graphics();
    renderer.universe(s);
    const markers = commands.filter(({ name, args }) => name === 'polygon' && args[1] === '#d6e9cf');
    assert.equal(markers.length, ['outbound', 'returning'].includes(phase) ? 1 : 0);
  }
});
