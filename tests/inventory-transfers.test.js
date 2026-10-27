import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, setLabor, serialize, deserialize, pathTo } from '../src/simulation.js';
import { initializeStorage, syncResources } from '../src/inventory.js';
import { haul, setMachineEnabled } from '../src/industry.js';
import { setProductionOrder } from '../src/production.js';
import { setLifePolicy } from '../src/crew-life.js';
import { craftKeepsake } from '../src/possessions.js';
import { initializeElectrical, refreshPower } from '../src/power.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';
import { executeAction } from '../src/controls.js';

// Synthetic fixtures isolate inventory movement; they are not colony acceptance.
function fixture() {
  const s = createGame(), site = s.sites.surface, c = s.crew[0], depot = at(site, 8, 10);
  for (const t of site.tiles) if (t.machine) setMachineEnabled(s, site.id, t.x, t.y, false);
  for (const crew of s.crew) {
    for (const labor of Object.keys(crew.labors)) setLabor(s, crew.id, labor, false);
    crew.energy = 90; crew.hunger = 90; crew.oxygen = 100;
    setLifePolicy(s, crew.id, 'work');
  }
  setLabor(s, c.id, 'hauling', true);
  return { s, site, c, depot };
}
const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const transfers = s => rows(s).filter(r => r.event?.id === 'inventory.transferred').map(r => r.event);
function pickup(c, source, items, destination = { x: 8, y: 10, z: 0 }, kind = 'output') {
  c.x = source.x; c.y = source.y;
  c.intent = { type: 'haul', target: { x: source.x, y: source.y, z: 0 }, source: kind, items, destination: { kind: 'stock', target: destination } };
}
function tick(s) { assert.equal(executeAction(s, 'simulation.step', { ticks: 1 }, 'agent').ok, true); }
function reconstruct(records) {
  const observation = structuredClone(records[0].observation);
  for (const record of records.slice(1, -1)) {
    for (const change of record.changes || []) {
      if (!change.path.length) {
        if (change.op === 'remove') delete observation.entities[change.entity];
        else observation.entities[change.entity] = structuredClone(change.value);
        continue;
      }
      let target = observation.entities[change.entity];
      for (const key of change.path.slice(0, -1)) target = target[key];
      const key = change.path.at(-1);
      if (change.op === 'remove') delete target[key]; else target[key] = structuredClone(change.value);
    }
    if (record.fromTick !== undefined) observation.tick = record.tick;
  }
  return observation;
}

test('native air pickup and delivery retain named quantities across reload and recording parity', () => {
  const { s, site, c, depot } = fixture(), processor = at(site, 13, 9);
  processor.building = 'atmosphere'; initializeStorage(processor); initializeElectrical(processor); processor.machine.enabled = false;
  processor.machine.output.air = 2; pickup(c, processor, { air: 2 }); refreshPower(s, site); syncResources(s);
  const unrecorded = deserialize(serialize(s)), initialStock = depot.stock.air || 0;
  startRecording(s, { maxRecords: 4000 }); tick(s); tick(unrecorded);
  assert.equal(c.carry.air, 2);
  const resumed = deserialize(serialize(s));
  for (let i = 0; c.carry && i < 40; i++) { tick(s); tick(unrecorded); tick(resumed); }
  assert.equal(c.carry, null); assert.equal(depot.stock.air, initialStock + 2);
  assert.equal(serialize(s), serialize(unrecorded)); assert.equal(serialize(s), serialize(resumed));
  const moves = transfers(s);
  assert.deepEqual(moves.map(e => [e.actor, e.from, e.to, e.resources]), [
    [c.id, { entity: 'tile:surface:13:9', slot: 'machine.output' }, { entity: c.id, slot: 'carry' }, { air: 2 }],
    [c.id, { entity: c.id, slot: 'carry' }, { entity: 'tile:surface:8:10', slot: 'stock' }, { air: 2 }]
  ]);
  const records = rows(s); assert.deepEqual(reconstruct(records), observe(s));
  assert.equal(records.filter(r => r.kind === 'external').length, 0);
  assert.ok(records.filter(r => r.event?.id === 'inventory.transferred').every(r => Number.isInteger(r.command)));
});

test('partial machine delivery records only water and fertilizer actually accepted', () => {
  const { s, site, c } = fixture(), farm = at(site, 7, 9);
  setMachineEnabled(s, site.id, 7, 9, true); setProductionOrder(s, site.id, 7, 9, 'batches', 1);
  c.x = 7; c.y = 9; c.carry = { water: 3, fertilizer: .75 }; c.delivery = { kind: 'input', target: { x: 7, y: 9, z: 0 } };
  startRecording(s); haul(s, c, site, pathTo);
  assert.deepEqual(c.carry, { water: 1, fertilizer: .25 });
  assert.deepEqual(farm.machine.input, { water: 2, fertilizer: .5 });
  assert.deepEqual(transfers(s), [{ id: 'inventory.transferred', entity: c.id, actor: c.id,
    from: { entity: c.id, slot: 'carry' }, to: { entity: 'tile:surface:7:9', slot: 'machine.input' }, resources: { water: 2, fertilizer: .5 } }]);
});

test('sanitary pickup identifies its real output inventory', () => {
  const { s, site, c } = fixture(), unit = at(site, 12, 10);
  unit.building = 'sanitary'; initializeStorage(unit); unit.sanitary.output.fertilizer = .25;
  pickup(c, unit, { fertilizer: .25 }); startRecording(s); haul(s, c, site, pathTo);
  assert.equal(c.carry.fertilizer, .25); assert.equal(unit.sanitary.output.fertilizer || 0, 0);
  assert.equal(transfers(s).length, 1);
  assert.deepEqual(transfers(s)[0].from, { entity: 'tile:surface:12:10', slot: 'sanitary.output' });
  assert.deepEqual(transfers(s)[0].resources, { fertilizer: .25 });
});

test('cargo setdown records a mixed physical parcel and preserves individual item identity', () => {
  const { s, site, c, depot } = fixture();
  depot.stock = { alloy: 320 }; c.x = 12; c.y = 9;
  c.carry = { air: 2, water: 1, fertilizer: .25, ...craftKeepsake(s, c) };
  const itemId = c.carry._items[0].id; c.delivery = { kind: 'stock', target: { x: 8, y: 10, z: 0 } };
  startRecording(s); haul(s, c, site, pathTo);
  assert.equal(c.carry, null); assert.equal(at(site, 12, 9).drop._items[0].id, itemId);
  const events = rows(s).filter(r => r.kind === 'event').map(r => r.event);
  const move = events.find(e => e.id === 'inventory.transferred');
  assert.deepEqual(move.resources, { air: 2, water: 1, fertilizer: .25, keepsakes: 1 });
  assert.deepEqual(move.to, { entity: 'tile:surface:12:9', slot: 'drop' });
  const items = events.filter(e => e.id === 'item.moved'); assert.equal(items.length, 1);
  assert.equal(items[0].entity, itemId); assert.deepEqual(items[0].from, move.from); assert.deepEqual(items[0].to, move.to);
});

test('unavailable reserved pickup emits no invented inventory transfer', () => {
  const { s, site, c } = fixture(), processor = at(site, 13, 9);
  processor.building = 'atmosphere'; initializeStorage(processor); processor.machine.enabled = false;
  pickup(c, processor, { air: 2 }); startRecording(s); haul(s, c, site, pathTo);
  assert.ok(!c.carry); assert.equal(c.intent, null); assert.deepEqual(transfers(s), []);
});
