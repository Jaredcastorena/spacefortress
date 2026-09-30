import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { extract, add, totalResources, syncResources } from '../src/inventory.js';
import { fillRoom, refreshAtmosphere, breathable, roomAt } from '../src/atmosphere.js';
import { startRecording, exportRecording, tileEntityId } from '../src/telemetry.js';
import { refreshPower } from '../src/power.js';

const act = (s, id, args = {}) => {
  const result = executeAction(s, id, args, 'test');
  assert.ok(result.ok, `${id}: ${result.message}`); return result;
};
const tick = (s, ticks = 1) => act(s, 'simulation.step', { ticks });
const saved = s => { syncResources(s); return deserialize(serialize(s)); };
const events = s => exportRecording(s).trim().split('\n').map(JSON.parse).filter(r => r.event).map(r => r.event);
const until = (s, predicate, limit = 100) => {
  for (let i = 0; i < limit && !predicate(); i++) tick(s);
  assert.ok(predicate(), `Condition missing by ${s.tick}`);
};

// Synthetic invariant setup: an exhausted courier, reduced atmosphere and an
// isolated finite parcel. Genuine action-generated recovery is checked by the
// ordinary journey/probe; this fixture is not colony commissioning acceptance.
function courier({ unsafe = true } = {}) {
  const s = createGame(), site = s.sites.surface, c = s.crew[0], helper = s.crew[5], depot = at(site, 8, 10);
  for (const p of s.crew) for (const labor of Object.keys(p.labors)) p.labors[labor] = false;
  for (const t of site.tiles) if (t.machine && t.building !== 'scrubber') t.machine.enabled = false;
  c.carry = extract(depot.stock, { air: 6 });
  // Scarcity is deliberately seeded for this boundary: no second air source.
  delete depot.stock.air;
  c.delivery = { kind: 'input', target: [7, 7] }; c.energy = 1;
  c.intent = { type: 'rest', target: null }; c.x = 8; c.y = 9;
  if (unsafe) { fillRoom(site.rooms[0], 76.15); refreshAtmosphere(site); }
  refreshPower(s, site);
  return { s, site, c, helper, depot };
}

test('blocked saved rest sets down the sole six-air parcel at its actual tile for another hauler', () => {
  const { s, site, c, helper } = courier(); saved(s); startRecording(s);
  const before = totalResources(s).air, position = [c.x, c.y]; tick(s);
  assert.equal(c.carry, null); assert.equal(c.delivery, null);
  assert.deepEqual([c.x, c.y], position); assert.equal(c.intent.type, 'rest'); assert.ok(c.energy < 1);
  assert.deepEqual(at(site, ...position).drop, { air: 6 }); assert.equal(totalResources(s).air, before);
  const handoffs = events(s).filter(e => e.id === 'crew.recovery.cargo_set_down');
  assert.equal(handoffs.length, 1); assert.equal(handoffs[0].entity, c.id); assert.equal(handoffs[0].kind, 'rest');
  assert.equal(handoffs[0].reason, 'recovery_blocked'); assert.deepEqual(handoffs[0].cargo, { air: 6 });
  assert.deepEqual(handoffs[0].from, { entity: c.id, slot: 'carry' });
  assert.deepEqual(handoffs[0].to, { entity: tileEntityId('surface', ...position), slot: 'drop' });
  act(s, 'crew.labor', { crew: helper.id, labor: 'hauling', enabled: true });
  until(s, () => helper.carry?.air > 0); assert.equal(c.carry, null);
  until(s, () => breathable(roomAt(site, c.x, c.y)) && c.energy > 2);
  assert.equal(events(s).filter(e => e.id === 'crew.recovery.cargo_set_down' && e.entity === c.id).length, 1);
  assert.ok(site.atmosphere.injected.oxygen > 0); assert.ok(totalResources(s).air < before);
  assert.deepEqual(saved(s), s);
});

test('critical air and temperature recovery put cargo down without forcing its delivery or changing needs', () => {
  for (const kind of ['air', 'temperature']) {
    const { s, site, c } = courier(); c.energy = 80;
    c.intent = { type: kind, target: null };
    if (kind === 'air') c.oxygen = 10; else c.thermalStress = 50;
    const position = [c.x, c.y], before = totalResources(s); startRecording(s); tick(s);
    assert.equal(c.carry, null); assert.equal(c.delivery, null); assert.equal(c.intent.type, kind);
    assert.deepEqual([c.x, c.y], position); assert.deepEqual(at(site, ...position).drop, { air: 6 });
    assert.equal(totalResources(s).air, before.air);
    if (kind === 'air') assert.ok(c.oxygen < 10); else assert.ok(c.thermalStress >= 45);
    assert.equal(events(s).filter(e => e.id === 'crew.recovery.cargo_set_down').length, 1);
    tick(s, 2); assert.equal(events(s).filter(e => e.id === 'crew.recovery.cargo_set_down').length, 1);
    assert.deepEqual(saved(s), s);
  }
});

function metadata(s, inventory) {
  const meal = { id: `meal-job-${s.nextId++}`, maker: 'crew-5', quality: 3, created: s.tick };
  inventory._food = [{ amount: 2, age: 37, meal }];
  const item = { id: `item-${s.nextItemId++}`, maker: 'crew-5', quality: 2, style: 'art', created: s.tick };
  add(inventory, { keepsakes: 1, _items: [item] }); return { meal, item };
}

test('ordinary parcel handoff preserves prepared-food age and physical item identity with one movement label', () => {
  const { s, site, c, depot } = courier(); add(depot.stock, c.carry);
  const { meal, item } = metadata(s, depot.stock);
  c.carry = extract(depot.stock, { food: 2, keepsakes: 1 }); c.delivery = { kind: 'stock', target: [8, 10] };
  const initial = structuredClone(c.carry), before = totalResources(s); startRecording(s); tick(s);
  const pile = at(site, c.x, c.y).drop;
  assert.equal(pile.food, 2); assert.equal(pile.keepsakes, 1); assert.deepEqual(pile._items, [item]);
  assert.deepEqual(pile._food, [{ amount: 2, age: 38, meal }]);
  assert.equal(totalResources(s).food, before.food); assert.equal(totalResources(s).keepsakes, before.keepsakes);
  const moves = events(s).filter(e => e.id === 'item.moved' && e.entity === item.id);
  assert.equal(moves.length, 1); assert.deepEqual(moves[0].from, { entity: c.id, slot: 'carry' });
  assert.deepEqual(moves[0].to, { entity: tileEntityId('surface', c.x, c.y), slot: 'drop' });
  assert.deepEqual(initial._food, [{ amount: 2, age: 37, meal }], 'detached prior metadata stays unchanged');
  assert.deepEqual(saved(s), s);
});

test('blocked freight courier keeps the exact job reservation and metadata at the set-down location', () => {
  const { s, site, c, depot } = courier({ unsafe: false });
  add(depot.stock, c.carry); c.carry = null; c.delivery = null; c.intent = null; c.energy = 90;
  const { meal, item } = metadata(s, depot.stock); c.labors.hauling = true;
  const id = act(s, 'freight.load', { items: { food: 2, keepsakes: 1 } }).job;
  until(s, () => c.delivery?.job === id); const j = s.jobs.find(j => j.id === id);
  const before = structuredClone(c.carry), position = [c.x, c.y], total = totalResources(s);
  fillRoom(site.rooms[0], 76.15); refreshAtmosphere(site); c.energy = 1; startRecording(s); tick(s);
  assert.equal(c.carry, null); assert.equal(c.delivery, null); assert.equal(c.job, null); assert.equal(c.intent.type, 'rest');
  assert.ok(s.jobs.includes(j)); assert.deepEqual(s.shuttle.freight, {}); assert.equal(j.materials.food, undefined);
  const source = j.sources.find(source => source.kind === 'drop' && source.x === position[0] && source.y === position[1]);
  assert.ok(source); assert.equal(source.kind, 'drop'); assert.equal(source.items.food, 2); assert.deepEqual(source.items._items, [item]);
  assert.deepEqual(source.items._food, [{ amount: 2, age: before._food[0].age + 1, meal }]);
  assert.equal(at(site, ...position).drop, null, 'reserved cargo is not also a free pile');
  assert.equal(totalResources(s).food, total.food); assert.equal(totalResources(s).keepsakes, total.keepsakes);
  const handoff = events(s).find(e => e.id === 'crew.recovery.cargo_set_down');
  assert.deepEqual(handoff.to, { entity: id, slot: `sources.${j.sources.indexOf(source)}` });
  assert.equal(events(s).filter(e => e.id === 'item.moved' && e.entity === item.id && e.to.entity === id).length, 1);
  assert.deepEqual(saved(s), s);
  act(s, 'job.cancel', { job: id });
  assert.deepEqual(at(site, ...position).drop._items, [item]); assert.equal(totalResources(s).food, total.food);
  assert.deepEqual(saved(s), s);
});

test('blocked construction courier leaves an exclusive local source claim which survives reload', () => {
  const { s, site, c, depot } = courier({ unsafe: false });
  add(depot.stock, c.carry); c.carry = null; c.delivery = null; c.intent = null; c.energy = 90; c.labors.construction = true;
  const id = act(s, 'job.order', { site: 'surface', x: 11, y: 14, kind: 'build', building: 'solar' }).job;
  until(s, () => c.delivery?.job === id);
  const position = [c.x, c.y], total = totalResources(s).alloy;
  fillRoom(site.rooms[0], 76.15); refreshAtmosphere(site); c.energy = 1; tick(s);
  const j = s.jobs.find(j => j.id === id);
  assert.equal(c.carry, null); assert.equal(c.job, null); assert.equal(j.worker, null);
  assert.deepEqual(j.sources.filter(source => source.items.alloy), [{ x: position[0], y: position[1], kind: 'drop', items: { alloy: 5 } }]);
  assert.equal(j.remaining, j.work); assert.equal(at(site, ...position).drop, null); assert.equal(totalResources(s).alloy, total);
  assert.deepEqual(saved(s), s);
});

test('blocked meal recovery releases a nonfood parcel without creating or consuming food', () => {
  const { s, site, c, depot } = courier({ unsafe: false });
  delete depot.stock.food; c.energy = 90; c.hunger = 5; c.intent = { type: 'meal', target: null, servings: 0 };
  startRecording(s); tick(s);
  assert.equal(c.carry, null); assert.deepEqual(at(site, c.x, c.y).drop, { air: 6 });
  assert.equal(c.intent.type, 'meal'); assert.equal(c.intent.servings, 0); assert.ok(c.hunger < 5);
  assert.equal(events(s).find(e => e.id === 'crew.recovery.cargo_set_down').kind, 'meal');
  assert.deepEqual(saved(s), s);
});

test('a hungry freight courier sets reserved food down without eating or freeing the job claim', () => {
  const { s, site, c, depot } = courier({ unsafe: false });
  add(depot.stock, c.carry); c.carry = null; c.delivery = null; c.intent = null; c.energy = 90;
  const { meal, item } = metadata(s, depot.stock); c.labors.hauling = true;
  const id = act(s, 'freight.load', { items: { food: 2, keepsakes: 1 } }).job;
  until(s, () => c.delivery?.job === id);
  // Synthetic shortage starts after genuine job pickup. Reserved freight is
  // the sole remaining food and must stay unavailable to normal meal recovery.
  delete depot.stock.food; delete depot.stock._food; c.hunger = 5;
  const position = [c.x, c.y], age = c.carry._food[0].age, before = totalResources(s), copy = saved(s);
  startRecording(s); tick(s); tick(copy); assert.deepEqual(s, copy);
  const job = s.jobs.find(j => j.id === id), sourceIndex = job.sources.findIndex(source => source.kind === 'drop');
  const source = job.sources[sourceIndex];
  assert.equal(c.carry, null); assert.equal(c.delivery, null); assert.equal(c.job, null);
  assert.equal(c.intent.type, 'meal'); assert.equal(c.intent.servings, 0); assert.ok(c.hunger < 5);
  assert.deepEqual([c.x, c.y], position); assert.equal(job.worker, null);
  assert.deepEqual(source, { x: position[0], y: position[1], kind: 'drop', items: {
    food: 2, _food: [{ amount: 2, age: age + 1, meal }], keepsakes: 1, _items: [item]
  } });
  assert.equal(at(site, ...position).drop, null); assert.deepEqual(s.shuttle.freight, {});
  assert.equal(totalResources(s).food, before.food); assert.equal(totalResources(s).keepsakes, before.keepsakes);
  const handoffs = events(s).filter(e => e.id === 'crew.recovery.cargo_set_down');
  assert.equal(handoffs.length, 1); assert.equal(handoffs[0].kind, 'meal');
  assert.deepEqual(handoffs[0].to, { entity: id, slot: `sources.${sourceIndex}` });
  assert.equal(events(s).filter(e => e.id === 'item.moved' && e.entity === item.id).length, 1);
  const reloaded = saved(s); tick(s, 2); tick(reloaded, 2); assert.deepEqual(s, reloaded);
  assert.equal(c.intent.servings, 0); assert.equal(totalResources(s).food, before.food);
  assert.equal(events(s).filter(e => e.id === 'crew.recovery.cargo_set_down').length, 1);
});

test('reachable recovery retains a parcel and recording stays outside the deterministic state', () => {
  const { s, c } = courier({ unsafe: false }); const before = structuredClone(c.carry), copy = saved(s);
  startRecording(s); tick(s, 5); tick(copy, 5);
  assert.deepEqual(s, copy); assert.deepEqual(c.carry, before); assert.equal(c.intent.type, 'rest');
  assert.ok(c.energy > 1); assert.equal(events(s).filter(e => e.id === 'crew.recovery.cargo_set_down').length, 0);
  assert.deepEqual(saved(s), s);
});
