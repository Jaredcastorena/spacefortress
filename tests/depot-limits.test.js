import {withTemperaturePressureReadings} from './helpers/pressure-migration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { VERSION, RESOURCES } from '../src/data.js';
import { createGame, at, order, cancelJob, step, serialize, deserialize } from '../src/simulation.js';
import { tileAt } from '../src/spatial.js';
import { initializeStorage, syncResources, totalResources } from '../src/inventory.js';
import { refreshPower } from '../src/power.js';
import { updateRooms, refreshAtmosphere } from '../src/atmosphere.js';
import { haul } from '../src/industry.js';
import { setDepotLimit, depotResourceUsage, depotUsage, acceptsShipment } from '../src/storage.js';
import { executeAction } from '../src/controls.js';

const raw70 = gunzipSync(readFileSync(new URL('./fixtures/depot-schema70.json.gz', import.meta.url))).toString();
const exact = s => assert.equal(serialize(deserialize(serialize(s))), serialize(s));
// Synthetic supplies/layouts isolate reservations and routing; the final test uses
// a fresh colony's existing supplies and paid construction through shared actions.
function fixture() {
  const s = createGame(), site = s.sites.surface, d = at(site, 8, 10);
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  d.stock = {}; syncResources(s); refreshPower(s, site);
  return { s, site, d, c: s.crew[0] };
}
function haulTick(s, crew = s.crew) {
  for (const c of crew) haul(s, c, s.sites[c.site]);
  syncResources(s); refreshPower(s, s.sites.surface);
}
function deliver(s, done, crew = s.crew, limit = 80) {
  for (let i = 0; i < limit && !done(); i++) haulTick(s, crew);
  assert.ok(done(), 'Expected finite haul to finish within the bound');
}

test('schema70 migration adds empty limits without changing physical custody or claims', () => {
  assert.equal(createHash('sha256').update(raw70).digest('hex'), '50d261aa3e746af369e7f6d0e83992d395ab3a7f8c6f6e4a73c67427644e7c75');
  const expected = JSON.parse(raw70);
  assert.equal(expected.version, 70);
  assert.ok(expected.jobs.some(j => j.sources.length));
  expected.version = VERSION;
  for (const site of Object.values(expected.sites)) for (const t of site.tiles) if (t.storage) t.storage.limits = {};
  const migrated = deserialize(raw70);
  assert.ok(serialize(migrated) === JSON.stringify(withTemperaturePressureReadings(expected)), 'Only version, empty depot limit maps and derived room readings change');
  const resumed = deserialize(serialize(migrated)); step(migrated); step(resumed);
  assert.ok(serialize(migrated) === serialize(resumed), 'Continuation stays deterministic');
  const forged = JSON.parse(raw70);
  forged.sites.surface.tiles.find(t => t.storage).storage.limits = {};
  assert.throws(() => deserialize(JSON.stringify(forged)), /Legacy depot delivery limits/);
});

test('current saves reject malformed limit policies without altering the caller state', () => {
  const s = createGame(), original = serialize(s);
  for (const limits of [null, [], { ore: -1 }, { ore: 321 }, { ore: 0.5 }, { ore: '2' }, { ore: null }, { imaginary: 2 }]) {
    const bad = JSON.parse(original);
    bad.sites.surface.tiles.find(t => t.storage).storage.limits = limits;
    assert.throws(() => deserialize(JSON.stringify(bad)), /Invalid depot delivery limits/);
  }
  const missing = JSON.parse(original); delete missing.sites.surface.tiles.find(t => t.storage).storage.limits;
  assert.throws(() => deserialize(JSON.stringify(missing)), /Invalid depot delivery limits/);
  assert.equal(serialize(s), original);
});

test('concurrent pickups obey independent resource caps and preserve all loose supplies', () => {
  const { s, site, d } = fixture();
  d.storage.accepted = ['components', 'alloy'];
  setDepotLimit(s, 'surface', d.x, d.y, 'components', 5);
  setDepotLimit(s, 'surface', d.x, d.y, 'alloy', 2);
  at(site, 11, 10).drop = { components: 12 };
  at(site, 12, 10).drop = { alloy: 10 };
  const before = totalResources(s); haulTick(s);
  assert.equal(depotResourceUsage(s, 'surface', d, 'components').incoming, 5);
  assert.equal(depotResourceUsage(s, 'surface', d, 'alloy').incoming, 2);
  exact(s);
  deliver(s, () => d.stock.components === 5 && d.stock.alloy === 2);
  haulTick(s);
  assert.equal(s.crew.some(c => c.intent?.type === 'haul' || c.carry), false);
  assert.deepEqual(totalResources(s), before); exact(s);
});

test('reserved materials occupy quota headroom and lowering a limit preserves cancellation refunds', () => {
  const { s, site, d } = fixture(); d.stock.alloy = 12; syncResources(s);
  setDepotLimit(s, 'surface', d.x, d.y, 'alloy', 12);
  const before = totalResources(s), result = order(s, 'surface', 11, 14, 'build', 'solar');
  assert.equal(result.ok, true);
  let usage = depotResourceUsage(s, 'surface', d, 'alloy');
  assert.equal(usage.stored, 7); assert.equal(usage.reserved, 5); assert.equal(usage.free, 0);
  at(site, 11, 10).drop = { alloy: 1 };
  setDepotLimit(s, 'surface', d.x, d.y, 'alloy', 6);
  assert.equal(acceptsShipment(s, 'surface', d, { alloy: 1 }), false);
  cancelJob(s, result.job.id);
  usage = depotResourceUsage(s, 'surface', d, 'alloy');
  assert.equal(d.stock.alloy, 12); assert.equal(usage.reserved, 0); assert.equal(usage.free, 0);
  assert.equal(totalResources(s).alloy, before.alloy + 1); exact(s);
});

test('lowering a quota cancels unpicked claims and reroutes already carried cargo after reload', () => {
  let { s, site, d, c } = fixture();
  const second = at(site, 12, 11); second.building = 'stockpile'; initializeStorage(second); second.storage.accepted = [];
  at(site, 11, 10).drop = { components: 6 };
  const before = totalResources(s); haulTick(s, [c]);
  assert.equal(c.intent?.type, 'haul');
  setDepotLimit(s, 'surface', d.x, d.y, 'components', 0); haulTick(s, [c]);
  assert.equal(c.intent, null); assert.equal(at(site, 11, 10).drop.components, 6);
  setDepotLimit(s, 'surface', d.x, d.y, 'components', 6);
  deliver(s, () => !!c.carry, [c]);
  assert.equal(acceptsShipment(s, 'surface', d, c.carry, c), true, 'Delivery does not count its own promise twice');
  setDepotLimit(s, 'surface', d.x, d.y, 'components', 0); second.storage.accepted = ['components'];
  s = deserialize(serialize(s)); site = s.sites.surface; c = s.crew.find(x => x.id === c.id);
  deliver(s, () => at(site, 12, 11).stock.components === 6, [c]);
  assert.equal(at(site, 8, 10).stock.components, undefined);
  assert.deepEqual(totalResources(s), before); exact(s);
});

test('fractional bulk and the shared capacity still constrain individually allowed resources', () => {
  const { s, site, d } = fixture(); d.stock = { ore: 319, water: 0.75 };
  setDepotLimit(s, 'surface', d.x, d.y, 'water', 1);
  assert.equal(depotResourceUsage(s, 'surface', d, 'water').free, 0.25);
  assert.equal(acceptsShipment(s, 'surface', d, { water: 0.25 }), true);
  assert.equal(acceptsShipment(s, 'surface', d, { water: 0.5 }), false);
  assert.equal(acceptsShipment(s, 'surface', d, { water: 0.25, alloy: 1 }), false);
  at(site, 11, 10).drop = { water: 1 }; const before = totalResources(s);
  deliver(s, () => d.stock.water === 1);
  assert.equal(depotUsage(s, 'surface', d).free, 0);
  assert.equal(at(site, 11, 10).drop.water, 0.75);
  assert.deepEqual(totalResources(s), before); exact(s);
});

test('a stair-connected upper depot keeps separate quotas and physical supplies through reload', () => {
  const raw = gunzipSync(readFileSync(new URL('./fixtures/stairs-schema55.json.gz', import.meta.url))).toString();
  const s = deserialize(raw), site = s.sites.surface, lower = at(site, 8, 10);
  for (const t of site.tiles) if (t.machine) t.machine.enabled = false;
  for (const y of [8, 9, 10]) tileAt(site, { x: 8, y, z: 1 }).terrain = 'floor';
  const upper = tileAt(site, { x: 8, y: 10, z: 1 }); upper.building = 'stockpile'; upper.hp = 100; initializeStorage(upper);
  upper.storage.accepted = ['alloy']; upper.storage.priority = 5;
  setDepotLimit(s, 'surface', 8, 10, 'alloy', 2, 1);
  setDepotLimit(s, 'surface', 8, 10, 'alloy', 0, 0);
  updateRooms(site); refreshAtmosphere(site); refreshPower(s, site);
  const before = totalResources(s); const c = s.crew[0];
  c.labors.hauling = true;
  deliver(s, () => upper.stock.alloy === 2, [c]);
  assert.equal(upper.storage.limits.alloy, 2); assert.equal(lower.storage.limits.alloy, 0);
  assert.equal(depotResourceUsage(s, 'surface', upper, 'alloy').free, 0);
  updateRooms(site); refreshAtmosphere(site);
  assert.deepEqual(totalResources(s), before); exact(s);
});

test('native paid depot construction and shared limit commands physically restock to the cap', () => {
  const s = createGame(74250), site = s.sites.surface, before = totalResources(s);
  const action = (id, args) => { const result = executeAction(s, id, args); assert.equal(result.ok, true, result.message); return result; };
  for (const t of site.tiles) if (t.machine) action('production.enable', { site: 'surface', x: t.x, y: t.y, z: t.z, enabled: false });
  action('job.order', { site: 'surface', x: 12, y: 11, kind: 'build', building: 'stockpile' });
  for (let n = 0; n < 120 && at(site, 12, 11).building !== 'stockpile'; n++) step(s);
  const target = at(site, 12, 11); assert.equal(target.building, 'stockpile');
  for (const resource of RESOURCES) if (resource !== 'alloy') action('depot.accept', { site: 'surface', x: 12, y: 11, resource, enabled: false });
  action('depot.limit', { site: 'surface', x: 12, y: 11, resource: 'alloy', limit: 3 });
  action('depot.priority', { site: 'surface', x: 12, y: 11, priority: 5 });
  for (let n = 0; n < 120 && target.stock.alloy !== 3; n++) step(s);
  assert.equal(target.stock.alloy, 3);
  assert.equal(totalResources(s).alloy, before.alloy - 2, 'Only the new depot construction spent alloy');
  assert.ok(s.crew.every(c => c.health === 100)); exact(s);
});
