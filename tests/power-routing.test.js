import test from 'node:test';
import assert from 'node:assert/strict';
import { routePower } from '../src/power-routing.js';
import { buildPowerTopology, powerTileKey as key, breakerTerminals } from '../src/power-topology.js';
import { step, opposite } from '../src/geometry.js';
import { tileAt } from '../src/spatial.js';
import { LIQUID } from '../src/liquids.js';

const tile = (x, y, building = null, z = 0) => ({ x, y, z, building, hp: 100, powerPriority: 3 });
const relay = (x, y, z = 0) => ({ ...tile(x, y, 'breaker', z), protection: { kind: 'breaker', direction: 'ne', enabled: true, mode: 'manual', tripped: false, cause: null } });
const input = t => breakerTerminals(t).input, output = t => breakerTerminals(t).output;
const total = routes => routes.reduce((sum, route) => sum + route.amount, 0);
function fromTopology(topology, { generation = [], faults = [], transfers = [], powered = [] } = {}) {
  return { topology, powered: new Set(powered), networks: topology.circuits.map(circuit => ({
    ...circuit, sources: new Map(generation.filter(([t]) => circuit.tiles.includes(t))),
    activeFaults: faults.filter(t => circuit.tiles.includes(t)), transfers: transfers.filter(({ tile: t }) => circuit.tiles.includes(t)),
  })) };
}
function graph(tiles, edges, options) {
  const vertices = new Map(), adjacency = new Map(), membership = new Map(), circuits = [];
  for (const t of tiles) {
    if (t.building === 'breaker') for (const terminal of ['input', 'output']) {
      const id = breakerTerminals(t)[terminal]; vertices.set(id, { id, tile: t, terminal });
    } else vertices.set(key(t), { id: key(t), tile: t, terminal: null });
  }
  for (const id of vertices.keys()) adjacency.set(id, []);
  for (const [a, b] of edges) { adjacency.get(a).push(b); adjacency.get(b).push(a); }
  for (const id of vertices.keys()) {
    if (membership.has(id)) continue;
    const circuit = { id: `circuit-${circuits.length}`, cells: [id], tiles: [], terminals: [] };
    membership.set(id, circuit.id);
    for (let i = 0; i < circuit.cells.length; i++) {
      const current = circuit.cells[i], vertex = vertices.get(current);
      if (vertex.terminal) circuit.terminals.push(current); else circuit.tiles.push(vertex.tile);
      for (const next of adjacency.get(current)) if (!membership.has(next)) { membership.set(next, circuit.id); circuit.cells.push(next); }
    }
    circuits.push(circuit);
  }
  return fromTopology({ vertices, adjacency, membership, circuits }, options);
}
const branch = (source, breaker, sink) => [[key(source), input(breaker)], [input(breaker), output(breaker)], [output(breaker), key(sink)]];
function frozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (value instanceof Map) for (const [k, v] of value) { frozen(k, seen); frozen(v, seen); }
  else if (value instanceof Set) for (const v of value) frozen(v, seen);
  else for (const v of Object.values(value)) frozen(v, seen);
  Object.freeze(value);
}

test('separate branches measure accepted loads and leave unserved, disconnected and open contacts at zero', () => {
  const source = tile(0, 0, 'reactor'), a = relay(1, 0), b = relay(1, 3), open = relay(5, 5), isolated = relay(6, 6);
  const industry = tile(2, 0, 'fabricator'), life = tile(2, 3, 'scrubber'), unserved = tile(2, 4, 'fuelSynthesizer');
  const plan = graph([source, a, b, open, isolated, industry, life, unserved], [
    ...branch(source, a, industry), ...branch(source, b, life), [output(b), key(unserved)],
    [key(source), input(open)], [input(isolated), output(isolated)],
  ], { generation: [[source, 7]], powered: [industry, life] });
  const result = routePower(plan);
  assert.deepEqual(result.contacts.get(key(a)), { signed: 4, throughput: 4 });
  assert.deepEqual(result.contacts.get(key(b)), { signed: 3, throughput: 3 });
  for (const contact of [open, isolated]) assert.deepEqual(result.contacts.get(key(contact)), { signed: 0, throughput: 0 });
  assert.equal(total(result.routes), 7); assert.ok(result.routes.every(r => r.sink !== key(unserved)));
});

test('finite generators retain source-map order and route no curtailed generation', () => {
  const first = tile(9, 0, 'solar'), second = tile(0, 0, 'reactor'), load = tile(5, 0, 'fabricator'), bank = tile(6, 0, 'battery');
  const plan = graph([first, second, load, bank], [[key(first), key(load)], [key(second), key(load)], [key(load), key(bank)]], {
    generation: [[first, 2], [bank, 0], [second, 10]], powered: [load], transfers: [{ tile: bank, amount: 3 }],
  });
  const { routes } = routePower(plan);
  assert.deepEqual(routes.map(({ source, sink, amount }) => [source, sink, amount]), [
    [key(first), key(load), 2], [key(second), key(load), 2], [key(second), key(bank), 3],
  ]);
  assert.equal(total(routes), 7); assert.equal(12 - total(routes), 5);
});

test('discharging banks follow generators in transfer order and cannot exceed their planned withdrawals', () => {
  const generator = tile(0, 0, 'solar'), first = tile(9, 0, 'battery'), second = tile(1, 0, 'battery'), load = tile(3, 0, 'fabricator');
  const plan = graph([generator, first, second, load], [generator, first, second].map(t => [key(t), key(load)]), {
    generation: [[second, 0], [generator, 1], [first, 0]], powered: [load], transfers: [{ tile: first, amount: -2 }, { tile: second, amount: -1 }],
  });
  assert.deepEqual(routePower(plan).routes.map(({ source, amount }) => [source, amount]), [[key(generator), 1], [key(first), 2], [key(second), 1]]);
});

test('same-vertex faults cancel locally before remote source pairing', () => {
  const earlier = tile(0, 0, 'reactor'), local = tile(4, 0, 'reactor'), breaker = relay(2, 0), load = tile(0, 1, 'scrubber');
  const plan = graph([earlier, breaker, local, load], [...branch(earlier, breaker, local), [key(earlier), key(load)]], {
    generation: [[earlier, 40], [local, 8]], faults: [local], powered: [load],
  });
  const { routes, contacts } = routePower(plan);
  assert.deepEqual(routes, [
    { source: key(local), sink: key(local), amount: LIQUID.faultPower, path: [key(local)] },
    { source: key(earlier), sink: key(load), amount: 3, path: [key(earlier), key(load)] },
  ]);
  assert.deepEqual(contacts.get(key(breaker)), { signed: 0, throughput: 0 });
});

test('sinks preserve supplied-fault order, consumer priority and scrubber/y/x ties, then charging order', () => {
  const source = tile(0, 0, 'reactor'), faultA = tile(1, 0), faultB = tile(2, 0), high = tile(8, 8, 'holo'); high.powerPriority = 5;
  const scrubber = tile(8, 7, 'scrubber'), left = tile(3, 2, 'galley'), right = tile(4, 2, 'galley'), lower = tile(0, 3, 'refinery');
  const bankA = tile(7, 0, 'battery'), bankB = tile(6, 0, 'battery'), unserved = tile(9, 9, 'fuelSynthesizer');
  const others = [faultA, faultB, lower, right, left, scrubber, high, bankA, bankB, unserved];
  const plan = graph([source, ...others], others.map(t => [key(source), key(t)]), {
    generation: [[source, 40]], faults: [faultB, faultA], powered: [lower, right, left, scrubber, high],
    transfers: [{ tile: bankA, amount: 1 }, { tile: bankB, amount: 2 }],
  });
  assert.deepEqual(routePower(plan).routes.map(r => r.sink), [faultB, faultA, high, scrubber, left, right, lower, bankA, bankB].map(key));
});

test('charging and battery backfeed cross a contact in reverse with finite signed flow', () => {
  for (const charging of [true, false]) {
    const breaker = relay(2, 0), left = tile(0, 0, charging ? 'battery' : 'scrubber'), right = tile(4, 0, charging ? 'solar' : 'battery');
    const amount = charging ? 4 : 3, plan = graph([left, breaker, right], branch(left, breaker, right), charging ? {
      generation: [[right, amount]], transfers: [{ tile: left, amount }],
    } : { transfers: [{ tile: right, amount: -amount }], powered: [left] });
    const result = routePower(plan);
    assert.deepEqual(result.contacts.get(key(breaker)), { signed: -amount, throughput: amount });
    assert.deepEqual(result.routes[0].path, [key(right), output(breaker), input(breaker), key(left)]);
  }
});

test('equal-length parallel contacts choose z/y/x order independent of adjacency insertion', () => {
  for (const positions of [[[1, 2, 0], [1, 2, 1]], [[1, 2, 0], [0, 3, 0]], [[1, 2, 0], [2, 2, 0]]]) {
    const source = tile(0, 0, 'solar'), sink = tile(5, 5, 'scrubber');
    const [a, b] = positions.map(([x, y, z]) => relay(x, y, z));
    const plan = graph([source, b, a, sink], [...branch(source, b, sink), ...branch(source, a, sink)], { generation: [[source, 4]], powered: [sink] });
    const first = routePower(plan);
    assert.equal(first.contacts.get(key(a)).throughput, 3); assert.equal(first.contacts.get(key(b)).throughput, 0);
    for (const edges of plan.topology.adjacency.values()) edges.reverse();
    assert.deepEqual(routePower(plan), first);
  }
});

test('shortest path wins before coordinate order and terminal ties prefer input to output', () => {
  const source = tile(0, 0, 'solar'), sink = tile(5, 5, 'scrubber'), a = relay(1, 1), b = relay(1, 2), extra = tile(2, 1);
  const plan = graph([source, a, b, extra, sink], [
    [key(source), input(a)], [input(a), output(a)], [output(a), key(extra)], [key(extra), key(sink)], ...branch(source, b, sink),
  ], { generation: [[source, 4]], powered: [sink] });
  const result = routePower(plan); assert.equal(result.contacts.get(key(a)).throughput, 0); assert.equal(result.contacts.get(key(b)).throughput, 3);
  const terminalTie = graph([source, a, sink], [[key(source), output(a)], [output(a), key(sink)], [key(source), input(a)], [input(a), key(sink)]], {
    generation: [[source, 4]], powered: [sink],
  });
  assert.deepEqual(routePower(terminalTie).routes[0].path, [key(source), input(a), key(sink)]);
});

test('opposing transfers cancel at a contact before absolute throughput is measured', () => {
  const left = tile(0, 0, 'reactor'), right = tile(4, 0, 'solar'), breaker = relay(2, 0), fault = tile(4, 1), load = tile(0, 1, 'scrubber');
  const plan = graph([left, right, breaker, fault, load], [...branch(left, breaker, right), [key(right), key(fault)], [key(left), key(load)]], {
    generation: [[left, 5], [right, 3]], faults: [fault], powered: [load],
  });
  const result = routePower(plan);
  assert.deepEqual(result.routes.map(r => r.amount), [5, 3]); assert.equal(total(result.routes), 8);
  assert.deepEqual(result.contacts.get(key(breaker)), { signed: 2, throughput: 2 });
});

test('real two-terminal topology retains floor separation and routes an enabled upper riser', () => {
  const site = { id: 'surface', size: 7, levels: [{ z: 0 }, { z: 1 }], utilityLinks: [], tiles: [] };
  for (const { z } of site.levels) for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) site.tiles.push({ ...tile(x, y, null, z), terrain: 'floor', cable: null });
  const at = (x, y, z) => tileAt(site, { x, y, z }), lower = at(3, 3, 0), upper = at(3, 3, 1);
  Object.assign(lower, relay(3, 3, 0)); Object.assign(upper, relay(3, 3, 1));
  const [ix, iy] = step(3, 3, opposite('ne')), [ox, oy] = step(3, 3, 'ne');
  const source = at(ix, iy, 0), sink = at(ix, iy, 1), bottom = at(ox, oy, 0), top = at(ox, oy, 1);
  source.building = 'solar'; sink.building = 'scrubber';
  for (const t of [bottom, top]) { t.cable = { hp: 100, enabled: true }; t.risers = { power: 'utility-1' }; }
  const options = { generation: [[source, 4]], powered: [] };
  let result = routePower(fromTopology(buildPowerTopology(site), options));
  assert.equal(result.routes.length, 0); assert.equal(result.contacts.size, 2);
  site.utilityLinks.push({ id: 'utility-1', kind: 'power', lower: { x: ox, y: oy, z: 0 }, upper: { x: ox, y: oy, z: 1 }, hp: 100, enabled: true });
  options.powered = [sink]; result = routePower(fromTopology(buildPowerTopology(site), options));
  assert.deepEqual(result.contacts.get(key(lower)), { signed: 3, throughput: 3 });
  assert.deepEqual(result.contacts.get(key(upper)), { signed: -3, throughput: 3 });
  const path = result.routes[0].path; assert.equal(path[path.indexOf(key(bottom)) + 1], key(top));
  assert.equal(total(result.routes), 3);
});

test('routing is pure on frozen input and its detached result cannot change later previews', () => {
  const source = tile(0, 0, 'reactor'), breaker = relay(2, 0), sink = tile(4, 0, 'scrubber');
  const plan = graph([source, breaker, sink], branch(source, breaker, sink), { generation: [[source, 8]], powered: [sink] });
  const before = structuredClone(plan); frozen(plan);
  const first = routePower(plan), expected = structuredClone(first);
  first.routes[0].path.pop(); first.routes[0].amount = 99; first.contacts.get(key(breaker)).signed = -99;
  assert.deepEqual(routePower(plan), expected); assert.deepEqual(plan, before);
});
