import { depart as launch } from './helpers/depart.js';
import { releaseBatteryEnergy } from '../src/power.js';
import { totalResources } from '../src/inventory.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, order, cancelJob, at, updateRooms, pathTo,  recall, serialize, deserialize, dischargeCell, resolveSignal } from '../src/simulation.js';

test('seeded generation is reproducible and different seeds change terrain', () => {
  assert.equal(serialize(createGame(11)), serialize(createGame(11)));
  assert.notEqual(serialize(createGame(11)), serialize(createGame(12)));
});
test('construction reserves materials once, completes through crew jobs, and refunds cancellation', () => {
  const s = createGame(); const before = s.resources.alloy;
  const a = order(s, 'surface', 11, 14, 'build', 'solar'); assert.equal(a.ok, true);
  assert.equal(s.resources.alloy, before - 5);
  assert.equal(order(s, 'surface', 11, 14, 'build', 'solar').ok, false);
  cancelJob(s, a.job.id); assert.equal(s.resources.alloy, before);
  assert.equal(order(s, 'surface', 11, 14, 'build', 'solar').ok, true);
  step(s, 60); assert.equal(at(s.sites.surface, 11, 14).building, 'solar');
  assert.equal(s.jobs.filter(j => j.kind !== 'operate').length, 0); assert.equal(s.stats.built, 1);
});
test('ore extraction yields hauled cargo and refinery output, without duplicated resources', () => {
  const s = createGame(); const before = s.resources.alloy;
  assert.equal(order(s, 'surface', 4, 10, 'mine').ok, true);
  step(s, 120);
  assert.equal(at(s.sites.surface, 4, 10).terrain, 'ground');
  assert.equal(at(s.sites.surface, 4, 10).drop, null);
  assert.equal(totalResources(s).ore * 2 + totalResources(s).alloy - before, 10);
  assert.equal(s.stats.mined, 1);
});
test('sealed habitat retains air; an actual wall breach vents it', () => {
  const s = createGame(), site = s.sites.surface;
  assert.equal(site.rooms.length, 1); assert.equal(site.rooms[0].sealed, true);
  step(s, 5); assert.equal(site.air, 100);
  at(site, 9, 6).building = null; updateRooms(site); assert.equal(site.rooms[0].sealed, false);
  at(site, 7, 7).machine.enabled = false;
  const before = site.rooms[0].pressure; step(s, 15); assert.ok(site.rooms[0].pressure < before); assert.ok(site.atmosphere.vented.oxygen > 0);
  step(s, 200); assert.ok(site.rooms[0].pressure < 30);
});
test('walls block routes and doors permit them', () => {
  const s = createGame(), site = s.sites.surface, c = s.crew[0];
  assert.notEqual(pathTo(site, c, [[10, 14]]), null);
  at(site, 10, 12).building = 'wall';
  assert.equal(pathTo(site, c, [[10, 14]]), null);
  assert.equal(order(s, 'surface', 11, 14, 'build', 'solar').ok, false);
});
test('expedition travel, salvage, delivery, and in-flight saves conserve crew and cargo', () => {
  let s = createGame(); const parts = s.resources.components;
  assert.equal(launch(s, 'wreck').ok, true); assert.equal(launch(s, 'wreck').ok, false);
  assert.equal(s.crew.filter(c => c.site === 'transit').length, 2);
  step(s, 10); s = deserialize(serialize(s)); step(s, 12);
  assert.equal(s.mission.phase, 'working'); assert.equal(s.crew.filter(c => c.site === 'wreck').length, 2);
  assert.equal(order(s, 'wreck', 5, 6, 'mine').ok, true); step(s, 35);
  assert.equal(s.resources.components, parts); assert.equal(s.mission.cargo.components, 3);
  assert.equal(recall(s).ok, true); step(s, 10); s = deserialize(serialize(s)); step(s, 12);
  for (let i = 0; i < 60 && s.mission; i++) step(s);
  assert.equal(s.mission, null); assert.equal(s.resources.components, parts);
  assert.equal(at(s.sites.surface, 16, 11).drop.components, 3);
  step(s, 40); assert.equal(s.resources.components, parts + 3);
  assert.equal(s.crew.filter(c => c.site === 'surface').length, 7); assert.equal(s.flags.salvageReturned, true);
});
test('comet departure automatically recalls crew with a safe transit margin', () => {
  const s = createGame(); assert.equal(launch(s, 'comet').ok, false);
  s.tick = 200; assert.equal(launch(s, 'comet').ok, true); step(s, 240);
  assert.equal(s.mission, null); assert.equal(s.crew.filter(c => c.site === 'surface').length, 7);
});
test('solar collection requires recovery, uses supplies, and returns physical power cells', () => {
  const s = createGame(); assert.equal(launch(s, 'solar').ok, false);
  s.flags.salvageReturned = true; assert.equal(launch(s, 'solar').ok, true);
  step(s, 90); assert.ok(s.mission.cargo.cells > 0); assert.equal(s.resources.cells, 0);
  recall(s); for (let i = 0; i < 80 && s.mission; i++) step(s); assert.equal(s.resources.cells, 0); assert.ok(at(s.sites.surface, 16, 11).drop.cells > 0);
  step(s, 40); assert.ok(s.resources.cells > 0);
  releaseBatteryEnergy(s.sites.surface, at(s.sites.surface, 13, 7)); const cells = s.resources.cells;
  assert.equal(dischargeCell(s).ok, true); assert.equal(s.resources.cells, cells - 1); assert.equal(s.sites.surface.power.battery, 100);
});
test('save round trip continues deterministically; incompatible and malformed saves are rejected', () => {
  const a = createGame(); order(a, 'surface', 4, 10, 'mine'); step(a, 6);
  const b = deserialize(serialize(a)); step(a, 30); step(b, 30); assert.deepEqual(b, a);
  assert.throws(() => deserialize('{"version":999}'));
  const bad = createGame(); bad.resources.alloy = -4; assert.throws(() => deserialize(serialize(bad)));
});
test('bristlebacks consume local lichen without draining colony food', () => {
  const s = createGame(), t = at(s.sites.surface, 6, 16), lichen = t.lichen;
  step(s, 9); assert.ok(t.lichen < lichen); assert.equal(s.resources.food, 24);
});
test('tibbles consume biomass, multiply, and can be caught with a constructed trap', () => {
  const s = createGame(); s.creatures.push({ id: 'test-tibble', species: 'tibble', site: 'surface', x: 8, y: 10, health: 100, fed: 60, age: 59 });
  // Isolate food losses from crop production.
  at(s.sites.surface, 7, 9).machine.enabled = false; const food = s.resources.food;
  step(s, 60); assert.ok(s.resources.food < food); assert.ok(s.creatures.filter(c => c.species === 'tibble').length > 1);
  assert.equal(order(s, 'surface', 9, 10, 'build', 'trap').ok, true);
  step(s, 60); assert.equal(s.creatures.filter(c => c.species === 'tibble').length, 0); assert.ok(s.stats.trapped >= 2);
});
test('signal choice has consequences and cannot be collected twice', () => {
  const s = createGame(); step(s, 95); assert.equal(s.anomaly.resolved, false);
  const fuel = s.resources.fuel, components = s.resources.components, energy = s.crew[0].energy;
  assert.equal(resolveSignal(s, true).ok, true); assert.equal(totalResources(s).fuel, fuel + 3); assert.equal(s.resources.components, components - 1); assert.equal(s.crew[0].energy, energy - 8);
  assert.equal(resolveSignal(s, true).ok, false); assert.equal(totalResources(s).fuel, fuel + 3);
});
test('corrupt orders, atmosphere, wildlife, and cargo are rejected before import', () => {
  const mutate = fn => { const s = createGame(); fn(s); assert.throws(() => deserialize(serialize(s))); };
  mutate(s => s.sites.surface.rooms[0].air = 'bad');
  mutate(s => s.creatures[0].species = 'unknown');
  mutate(s => s.jobs.push({ id: 'bad' }));
  mutate(s => { launch(s, 'wreck'); s.mission.cargo = { alloy: -20 }; });
  mutate(s => { launch(s, 'wreck'); s.crew[0].site = 'surface'; });
});
