import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createGame, serialize, deserialize, step } from '../src/simulation.js';
import { executeAction, controlBindings, createAgentInterface, actionCatalog } from '../src/controls.js';
import { add, syncResources, totalResources, quantity } from '../src/inventory.js';
import { siteDefinition } from '../src/region.js';
import { SATELLITE_COST, planetSurveyStatus } from '../src/satellites.js';
import { startRecording, exportRecording, observe, recordingStatus, TELEMETRY_VERSION } from '../src/telemetry.js';

const records = s => exportRecording(s).trim().split('\n').map(JSON.parse);
const counts = s => Object.fromEntries(Object.keys(SATELLITE_COST).map(resource => [resource, totalResources(s)[resource]]));
const exact = s => { const text = serialize(s), copy = deserialize(text); assert.equal(serialize(copy), text); return copy; };
function fixture(regionSchema = 3, withCell = true) {
  const s = createGame(74219, { regionSchema }), site = s.sites.surface;
  // Synthetic finite recovered-cell fixture only. The remainder of this test
  // uses actual shared commands, crew travel, delivery and engineering work;
  // it does not demonstrate a fresh colony acquiring its first orbital cell.
  if (withCell) { add(site.tiles.find(t => t.building === 'stockpile').stock, { cells: 1 }); syncResources(s); }
  const tile = site.tiles.find(t => t.building === 'shuttle'), planetId = siteDefinition(s, site.id).planetId;
  return { s, site, tile, planetId, args: { site: site.id, x: tile.x, y: tile.y, z: tile.z } };
}
function until(s, label, predicate, cap = 160) {
  for (let n = 0; n < cap && !predicate(); n++) step(s);
  assert.ok(predicate(), `${label}; first stop tick ${s.tick}, pending ${s.jobs.filter(j => j.kind === 'launchSatellite').map(j => `${j.id}:remaining=${j.remaining}:blocked=${j.blockedReason}`).join(';')}`);
}
function optionalFixture(s, suffix) {
  const destination = process.env.SPACEFORTRESS_SATELLITE_FIXTURE_PATH;
  if (destination) writeFileSync(`${destination}.${suffix}.json`, serialize(s));
}

test('larger-world player and agent satellite orders use physical crew delivery and unlock only after paid work', () => {
  const f = fixture(), { s, args, planetId } = f, twin = exact(s), initial = counts(s);
  assert.equal(f.site.size, 48); assert.equal(s.region.schema, 3);
  assert.equal(planetSurveyStatus(s, planetId).unlocked, false);
  const player = controlBindings(() => s), agent = createAgentInterface(() => twin);
  startRecording(s, { maxRecords: 8000, maxBytes: 64_000_000 }); startRecording(twin);
  const ordered = player.launchSatellite(s, args.site, args.x, args.y, args.z);
  const paired = agent.act('satellite.launch', args);
  assert.equal(ordered.ok, true, ordered.message); assert.equal(paired.ok, true, paired.message);
  assert.equal(serialize(s), serialize(twin)); assert.equal(records(s)[1].action.source, 'player'); assert.equal(records(twin)[1].action.source, 'agent');
  const jobId = ordered.job, orderedJob = s.jobs.find(job => job.id === jobId);
  assert.deepEqual(orderedJob.materials, {}); assert.equal(orderedJob.remaining, 16); assert.deepEqual(counts(s), initial);
  assert.equal(Object.hasOwn(s, 'satellites'), false); exact(s);
  const flight = executeAction(s, 'expedition.launch', { site: 'wreck' }); assert.equal(flight.ok, false);
  until(s, 'native carrier holds satellite supplies', () => s.crew.some(c => c.delivery?.job === jobId && quantity(c.carry) > 0));
  assert.equal(planetSurveyStatus(s, planetId).unlocked, false); assert.deepEqual(counts(s), initial);
  const pendingCopy = exact(s); optionalFixture(s, 'pending');
  step(s, 3); step(pendingCopy, 3); assert.equal(serialize(s), serialize(pendingCopy), 'saved carry continues identically');
  until(s, 'supplied satellite launch', () => planetSurveyStatus(s, planetId).unlocked);
  assert.equal(s.jobs.some(j => j.id === jobId), false);
  for (const [resource, amount] of Object.entries(SATELLITE_COST)) assert.equal(counts(s)[resource], initial[resource] - amount, resource);
  exact(s); optionalFixture(s, 'launched');
  const log = records(s), launchEvents = log.filter(r => r.event?.id === 'satellite.launched');
  assert.equal(log[0].schemaVersion, TELEMETRY_VERSION); assert.equal(recordingStatus(s).reason, null);
  assert.equal(launchEvents.length, 1); const launched = launchEvents[0].event;
  assert.equal(launched.job, jobId); assert.equal(launched.entity, `planet:${planetId}`); assert.deepEqual(launched.cost, SATELLITE_COST);
  assert.ok(s.crew.some(c => c.id === launched.actor)); assert.ok(log.some(r => r.event?.id === 'job.completed' && r.event.entity === jobId));
  const beforeObservation = serialize(s), observation = observe(s);
  assert.ok(observation.entities[`planet:${planetId}`]); assert.equal(serialize(s), beforeObservation);
  assert.ok(log.some(r => r.changes?.some(c => c.system === 'planetary_survey')), 'structured survey state change');
  const duplicate = executeAction(s, 'satellite.launch', args); assert.equal(duplicate.ok, false); assert.equal(duplicate.code, 'simulation_rejected'); assert.equal(duplicate.reason, 'satellite_launched');
  assert.equal(serialize(s), beforeObservation, 'duplicate preserves physical state');
});

test('shared cancellation refunds reserved and partially delivered satellite materials without unlocking', () => {
  for (const stage of ['reserved', 'carried', 'delivered']) {
    const f = fixture(2), before = counts(f.s), result = executeAction(f.s, 'satellite.launch', f.args);
    assert.equal(result.ok, true, result.message); const jobId = result.job;
    if (stage === 'carried') until(f.s, stage, () => f.s.crew.some(c => c.delivery?.job === jobId && quantity(c.carry) > 0));
    if (stage === 'delivered') until(f.s, stage, () => quantity(f.s.jobs.find(j => j.id === jobId)?.materials) > 0);
    exact(f.s); assert.equal(executeAction(f.s, 'job.cancel', { job: jobId }).ok, true);
    assert.deepEqual(counts(f.s), before, stage); assert.equal(planetSurveyStatus(f.s, f.planetId).unlocked, false);
    assert.equal(f.s.jobs.some(j => j.id === jobId), false); exact(f.s);
  }
});

test('shared launch rejects missing finite cell and invalid targets without altering the colony', () => {
  const f = fixture(2, false), before = serialize(f.s);
  assert.equal(executeAction(f.s, 'satellite.launch', f.args).ok, false); assert.equal(serialize(f.s), before);
  for (const args of [{ ...f.args, z: 1 }, { ...f.args, site: 'missing' }, { ...f.args, x: 999 }, { ...f.args, grant: true }]) {
    assert.equal(executeAction(f.s, 'satellite.launch', args).ok, false); assert.equal(serialize(f.s), before);
  }
  assert.equal(Object.hasOwn(f.s, 'satellites'), false); exact(f.s);
});

test('satellite action and generic job action share the exact paid order and strict pending-save validation', () => {
  const a = fixture(2), b = exact(a.s);
  assert.equal(executeAction(a.s, 'satellite.launch', a.args).ok, true);
  assert.equal(executeAction(b, 'job.order', { ...a.args, kind: 'launchSatellite' }).ok, true);
  assert.equal(serialize(a.s), serialize(b)); exact(a.s);
  assert.ok(actionCatalog(a.s).find(action => action.id === 'satellite.launch'));
  const raw = serialize(a.s);
  for (const edit of [s => { s.jobs[0].cost.cells = 0; }, s => { s.jobs[0].work = 1; }, s => { s.jobs[0].building = 'shuttle'; }, s => { s.version = 75; }]) {
    const changed = JSON.parse(raw); edit(changed); assert.throws(() => deserialize(JSON.stringify(changed)), /satellite|reservation|order|work/i);
  }
});
