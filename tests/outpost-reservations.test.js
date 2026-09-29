import test from 'node:test';
import assert from 'node:assert/strict';
import { availableInventory, hasOutgoingInventory, incomingInventory, outgoingInventory, shuttleCargoClaims } from '../src/inventory-reservations.js';
import { add, extract } from '../src/inventory.js';

const xy = [1, 1];
const input = { kind: 'input', target: [2, 1] };
const crew = (id, fields = {}) => ({ id, site: 'wreck', health: 100, carry: null, delivery: null, intent: null, ...fields });
const haul = (source, items, destination = input) => ({ type: 'haul', target: [...xy], source, items, destination });
const salvage = items => ({ type: 'salvage', target: [...xy], items });
const tile = (s, site = 'wreck') => s.sites[site].tiles[5];
function fixture() {
  const makeSite = id => ({ id, size: 4, tiles: Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4), building: null })) });
  const s = { tick: 23, rng: 123456, crew: [], jobs: [], sites: { surface: makeSite('surface'), wreck: makeSite('wreck') }, mission: null };
  for (const site of ['surface', 'wreck']) Object.assign(tile(s, site), { building: 'dock', imports: { alloy: 12, water: 9 }, drop: { alloy: 10, water: 10 } });
  return s;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

test('same coordinates on different sites and import/drop slots have independent availability', () => {
  const s = fixture();
  s.crew.push(crew('surface', { site: 'surface', intent: haul('imports', { alloy: 7 }) }),
    crew('imports', { intent: haul('imports', { alloy: 3 }) }),
    crew('local-pile', { intent: haul('drop', { alloy: 2 }) }),
    crew('salvage', { intent: salvage({ alloy: 4 }) }));
  assert.equal(availableInventory(s, 'surface', xy, 'imports', 'alloy'), 5);
  assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'alloy'), 9);
  assert.equal(availableInventory(s, 'wreck', xy, 'drop', 'alloy'), 4);
  assert.equal(availableInventory(s, 'surface', xy, 'drop', 'alloy'), 10);
  assert.equal(outgoingInventory(s, 'wreck', xy, 'drop', 'alloy'), 6);
  assert.equal(outgoingInventory(s, 'wreck', xy, 'drop', 'alloy', s.crew[2]), 4);
  assert.equal(availableInventory(s, 'wreck', xy, 'drop', 'alloy', s.crew[3]), 8);
  assert.equal(hasOutgoingInventory(s, 'surface', xy, 'drop'), false);
});

test('shared source exclusion protects both local and shuttle pending pickups', () => {
  const s = fixture(), local = crew('local', { intent: haul('drop', { water: 3 }) }), ship = crew('ship', { intent: salvage({ water: 2 }) });
  s.crew.push(local);
  assert.equal(hasOutgoingInventory(s, 'wreck', xy, 'drop', ship), true, 'salvage sees an existing local claim');
  s.crew = [ship];
  assert.equal(hasOutgoingInventory(s, 'wreck', xy, 'drop', local), true, 'ordinary hauling sees a salvage claim');
  assert.equal(hasOutgoingInventory(s, 'wreck', xy, 'imports', local), false, 'salvage never claims imports at the same tile');
  assert.equal(hasOutgoingInventory(s, 'surface', xy, 'drop', local), false);
  assert.equal(hasOutgoingInventory(s, 'wreck', xy, 'drop', ship), false);
});

test('pickup, held local shipment and job reservation never debit physical source twice', () => {
  const s = fixture(), c = crew('local', { intent: haul('imports', { alloy: 4 }) }); s.crew.push(c);
  assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'alloy'), 8);
  c.carry = extract(tile(s).imports, c.intent.items); c.delivery = { kind: 'job', job: 'build-1', target: [2, 2] };
  // Deliberately retain the old intent across this boundary: actual carry wins.
  assert.equal(outgoingInventory(s, 'wreck', xy, 'imports', 'alloy'), 0);
  assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'alloy'), 8);
  s.mission = { site: 'wreck', crew: [c.id] };
  assert.equal(shuttleCargoClaims(s), 0, 'construction cargo is not a shuttle commitment');
  const reserved = extract(tile(s).imports, { alloy: 3 });
  const j = { id: 'build-1', site: 'wreck', sources: [{ x: 1, y: 1, kind: 'imports', items: reserved }], materials: {} }; s.jobs.push(j);
  assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'alloy'), 5, 'job.sources already owns extracted goods');
  add(j.materials, c.carry); c.carry = null; c.delivery = null; c.intent = null;
  assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'alloy'), 5);
  assert.equal(tile(s).imports.alloy + j.sources[0].items.alloy + j.materials.alloy, 12);
});

test('cancelled and dead claims release availability without moving or granting material', () => {
  const s = fixture(), c = crew('ship', { intent: salvage({ water: 6 }) }); s.crew.push(c);
  const before = structuredClone(tile(s).drop);
  assert.equal(availableInventory(s, 'wreck', xy, 'drop', 'water'), 4);
  c.health = 0;
  assert.equal(availableInventory(s, 'wreck', xy, 'drop', 'water'), 10);
  assert.equal(hasOutgoingInventory(s, 'wreck', xy, 'drop'), false);
  c.health = 100; c.intent = null;
  assert.equal(availableInventory(s, 'wreck', xy, 'drop', 'water'), 10);
  assert.deepEqual(tile(s).drop, before);
});

test('source availability requires the actual site, valid owner slot and bounded coordinates', () => {
  const s = fixture(), t = tile(s);
  t.stock = { water: 8 }; t.machine = { input: { water: 2 }, output: { water: 5 } };
  assert.equal(availableInventory(s, 'wreck', xy, 'stock', 'water'), 0, 'stale stock outside a depot is unavailable');
  t.building = 'stockpile';
  assert.equal(availableInventory(s, 'wreck', xy, 'stock', 'water'), 8);
  assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'water'), 0, 'stale imports outside a dock are unavailable');
  assert.equal(availableInventory(s, 'wreck', xy, 'input', 'water'), 0, 'stale machine data outside a recipe owner is unavailable');
  t.building = 'farm';
  assert.equal(availableInventory(s, 'wreck', xy, 'input', 'water'), 2);
  assert.equal(availableInventory(s, 'wreck', xy, 'output', 'water'), 5);
  t.building = 'sanitary'; t.sanitary = { output: { waste: 3 } };
  assert.equal(availableInventory(s, 'wreck', xy, 'output', 'waste'), 3);
  for (const [site, point, kind] of [['missing', xy, 'drop'], ['wreck', [-1, 1], 'drop'], ['wreck', [4, 0], 'drop'], ['wreck', [1.5, 1], 'drop'], ['wreck', [1], 'drop'], ['wreck', xy, 'batch']]) {
    assert.equal(availableInventory(s, site, point, kind, 'water'), 0);
  }
  s.crew.push(crew('overclaim', { intent: haul('drop', { water: 20 }) }));
  assert.equal(availableInventory(s, 'wreck', xy, 'drop', 'water'), 0, 'unavailable quantities never become negative');
});

test('hold claims include only selected living site passengers with a shuttle destination', () => {
  const s = fixture();
  s.crew = [
    crew('pickup', { intent: salvage({ alloy: 2, water: .5 }) }),
    crew('held', { carry: { components: 1 }, delivery: { kind: 'shuttle', target: xy }, intent: { type: 'rest' } }),
    crew('transition', { carry: { fuel: 1.5 }, delivery: { kind: 'shuttle', target: xy }, intent: salvage({ fuel: 6 }) }),
    crew('builder', { carry: { alloy: 6 }, delivery: { kind: 'job', job: 'build-1', target: xy } }),
    crew('input', { carry: { water: 5 }, delivery: input }),
    crew('stock', { carry: { food: 4 }, delivery: { kind: 'stock', target: xy } }),
    crew('orphan', { carry: { food: 3 }, intent: salvage({ food: 6 }) }),
    crew('dead', { health: 0, intent: salvage({ components: 6 }) }),
    crew('surface', { site: 'surface', intent: salvage({ components: 6 }) }),
    crew('resident', { intent: salvage({ components: 6 }) }),
  ];
  s.mission = { site: 'wreck', crew: s.crew.filter(c => c.id !== 'resident').map(c => c.id) };
  assert.equal(shuttleCargoClaims(s), 5);
  assert.equal(shuttleCargoClaims(s, 'wreck', ['held']), 1);
  assert.equal(shuttleCargoClaims(s, 'wreck', []), 0);
  assert.equal(shuttleCargoClaims(s, 'surface', ['surface']), 6);
  s.mission = null;
  assert.equal(shuttleCargoClaims(s), 0);
});

test('incoming local input and depot capacity stay independent of shuttle and other-site cargo', () => {
  const s = fixture();
  s.crew = [crew('input', { carry: { water: 2 }, delivery: input }),
    crew('surface-input', { site: 'surface', carry: { water: 7 }, delivery: input }),
    crew('ship', { carry: { water: 4 }, delivery: { ...input, kind: 'shuttle' } }),
    crew('pickup', { intent: haul('imports', { water: 1 }, input) }),
    crew('stock', { intent: haul('imports', { water: 3 }, { ...input, kind: 'stock' }) })];
  assert.equal(incomingInventory(s, 'wreck', input, 'water'), 3);
  assert.equal(incomingInventory(s, 'surface', input, 'water'), 7);
  assert.equal(incomingInventory(s, 'wreck', { ...input, kind: 'stock' }, 'water'), 3);
});

test('repeated frozen reservation reads preserve imports, food/item metadata, IDs and RNG', () => {
  const s = fixture();
  const meal = { id: 'meal-job-4', maker: 'crew-1', quality: 2, created: 5 };
  const item = { id: 'item-4', maker: 'crew-1', quality: 2, created: 5, style: 'orbital' };
  tile(s).imports = { food: 3, keepsakes: 1, _food: [{ amount: 3, age: 84, meal }], _items: [item], _metadata: 999 };
  s.crew.push(crew('local', { intent: haul('imports', { food: 1 }) }), crew('ship', { carry: { food: 2, _food: [{ amount: 2, age: 100, meal }] }, delivery: { kind: 'shuttle', target: xy } }));
  s.mission = { site: 'wreck', crew: ['ship'] };
  const before = JSON.stringify(s); freeze(s);
  for (let i = 0; i < 3; i++) {
    assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'food'), 2);
    assert.equal(availableInventory(s, 'wreck', xy, 'imports', 'keepsakes'), 1);
    assert.equal(availableInventory(s, 'wreck', xy, 'imports', '_metadata'), 0);
    assert.equal(outgoingInventory(s, 'wreck', xy, 'imports', 'food'), 1);
    assert.equal(hasOutgoingInventory(s, 'wreck', xy, 'imports'), true);
    assert.equal(incomingInventory(s, 'wreck', input, 'food'), 1);
    assert.equal(shuttleCargoClaims(s), 2);
  }
  assert.equal(JSON.stringify(s), before);
});
