import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, serialize } from '../src/simulation.js';
import { tileAt } from '../src/spatial.js';
import { updateRooms } from '../src/atmosphere.js';
import { RESOURCES } from '../src/data.js';
import { executeAction, controlBindings, actionCatalog } from '../src/controls.js';
import { storageDetails } from '../src/industry-panels.js';
import { observe, startRecording, exportRecording, tileEntityId } from '../src/telemetry.js';

const coordinates = { site: 'surface', x: 8, y: 10, z: 1 };
const depot = (s, z = 1) => tileAt(s.sites.surface, { x: 8, y: 10, z });
function fixture() {
  const s = createGame(250), site = s.sites.surface;
  site.levels.push({ z: 1, name: 'Upper test deck' });
  site.tiles.push(...site.tiles.map(t => ({ ...structuredClone(t), z: 1 })));
  updateRooms(site);
  return s;
}
const act = (s, resource, limit, extra = {}) => executeAction(s, 'depot.limit', { ...coordinates, resource, limit, ...extra });
const records = s => exportRecording(s).trim().split('\n').map(JSON.parse);

test('depot limit catalog and player binding share integer, null and floor rules', () => {
  const entry = actionCatalog().find(a => a.id === 'depot.limit');
  assert.deepEqual(entry.parameters.required, ['site', 'x', 'y', 'resource', 'limit']);
  assert.deepEqual(entry.parameters.properties.limit, { type: ['integer', 'null'], minimum: 0, maximum: 320 });
  assert.deepEqual(entry.parameters.properties.resource.enum, RESOURCES);
  assert.equal(entry.parameters.properties.z.optional, true);

  const agent = fixture(), player = structuredClone(agent), lower = structuredClone(depot(agent, 0));
  for (const limit of [0, 80, 320, null]) {
    assert.equal(act(agent, 'ore', limit).ok, true);
    assert.equal(controlBindings(() => player).setDepotLimit(player, 'surface', 8, 10, 'ore', limit, 1).ok, true);
    assert.equal(serialize(agent), serialize(player));
    assert.equal(depot(agent).storage.limits.ore ?? null, limit);
    assert.deepEqual(depot(agent, 0), lower);
  }
  assert.equal(controlBindings(() => agent).setDepotLimit(agent, 'surface', 8, 10, 'ore', 12).ok, true);
  assert.equal(depot(agent, 0).storage.limits.ore, 12);
  assert.equal(Object.hasOwn(depot(agent).storage.limits, 'ore'), false);
});

test('shared depot limit action rejects malformed requests without changing state', () => {
  const s = fixture(); startRecording(s); const before = serialize(s);
  const bad = [
    ...[-1, 321, 1.5, '12', true, NaN, Infinity, {}, []].map(limit => ({ limit })),
    { resource: 'unknown' }, { resource: '__proto__' }, { z: 2 }, { z: 0.5 },
    { site: 'missing' }, { x: 999 }, { x: 3, y: 3 }, { limit: undefined }, { extra: true },
  ];
  for (const change of bad) {
    const result = act(s, 'ore', 10, change);
    assert.equal(result.ok, false, JSON.stringify(change));
    assert.equal(serialize(s), before);
  }
  const rejected = records(s).filter(row => row.kind === 'action.result');
  assert.equal(rejected.length, bad.length);
  assert.ok(rejected.every(row => !row.result.ok && row.changes.length === 0));
});

test('limit actions expose upper-floor policy and one semantic event per actual change', () => {
  const s = fixture(); startRecording(s);
  assert.equal(act(s, 'ore', 24).ok, true);
  const before = serialize(s), entity = tileEntityId('surface', 8, 10, 1), observed = observe(s).entities[entity];
  assert.equal(observed.storage.limits.ore, 24);
  assert.equal(observed.derived.depot.resources.ore.limit, 24);
  assert.equal(serialize(s), before);
  assert.equal(act(s, 'ore', 24).ok, true);
  assert.equal(act(s, 'ore', null).ok, true);
  assert.equal(act(s, 'ore', null).ok, true);
  const events = records(s).filter(row => row.event?.id === 'depot.limit.changed').map(row => row.event);
  assert.deepEqual(events, [
    { id: 'depot.limit.changed', entity, site: 'site:surface', resource: 'ore', previous: null, limit: 24 },
    { id: 'depot.limit.changed', entity, site: 'site:surface', resource: 'ore', previous: 24, limit: null },
  ]);
});

test('collapsed depot inspector renders actual-floor limits and stock, reservation and incoming counts', () => {
  const s = fixture(), t = depot(s);
  assert.equal(act(s, 'ore', 24).ok, true);
  assert.equal(act(s, 'alloy', 0).ok, true);
  t.stock = { ore: 12, alloy: 5 };
  // Synthetic claims isolate inspector accounting from hauling execution.
  s.jobs.push({ site: 'surface', sources: [{ kind: 'stock', x: 8, y: 10, z: 1, items: { ore: 3 } }] });
  s.crew[0].intent = { type: 'haul', destination: { kind: 'stock', target: { x: 8, y: 10, z: 1 } }, items: { ore: 4 } };
  s.crew[1].intent = { type: 'haul', destination: { kind: 'stock', target: { x: 8, y: 10, z: 0 } }, items: { ore: 9 } };
  const html = storageDetails(t, s, 'surface');
  assert.match(html, /<details data-panel-key="depot-limits"><summary>Delivery limits<\/summary>/);
  const form = resource => html.match(new RegExp(`<form[^>]*data-depot-limit-form[^>]*data-resource="${resource}"[^>]*>[\\s\\S]*?<\\/form>`))?.[0];
  assert.match(form('ore'), /data-simulation-action="depot.limit"/);
  assert.match(form('ore'), /min="0" max="320" step="1" value="24"/);
  assert.match(form('ore'), /Stored 12 · reserved 3 · incoming 4/);
  assert.match(form('alloy'), /value="0"/);
  assert.match(form('water'), /value="" placeholder="Shared capacity"/);
  assert.equal((html.match(/data-depot-limit-form/g) || []).length, RESOURCES.length);
  assert.match(html, /Lowering a limit keeps existing stock and reservations/);
});
