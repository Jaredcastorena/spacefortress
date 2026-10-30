import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, serialize, deserialize } from '../src/simulation.js';
import { DEBRIS_FORECAST, HERD_WARNING_LEAD } from '../src/maintenance.js';
import { startRecording, stopRecording, exportRecording } from '../src/telemetry.js';
import { animalDetails } from '../src/husbandry-panels.js';

const herd = s => s.creatures.filter(a => a.species === 'bristleback' && a.health > 0 && a.site === 'surface');
const recorded = s => exportRecording(s).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).flatMap(row => row.event ? [row.event.id] : []);

test('a bristleback herd goes quiet before the debris forecast and resumes when the tile is posted', () => {
  const s = createGame();
  // A shortened synthetic debris clock tests the boundaries without an endurance run.
  s.debris.next = HERD_WARNING_LEAD + 2;
  const quietTick = s.debris.next - HERD_WARNING_LEAD;
  const forecastTick = s.debris.next - DEBRIS_FORECAST;
  assert.equal(herd(s).length, 3);
  assert.equal(s.debris.herdQuiet, false);
  step(s, quietTick - 1);
  assert.equal(s.tick, quietTick - 1);
  assert.equal(s.debris.herdQuiet, false);
  assert.equal(s.debris.target, null);
  assert.match(animalDetails(s, herd(s)[0], () => null), /Clicking/);
  const next = s.debris.next, count = s.debris.count;
  startRecording(s);
  step(s);
  assert.equal(s.tick, quietTick);
  assert.equal(s.debris.herdQuiet, true);
  assert.equal(s.debris.target, null);
  assert.equal(s.debris.next, next);
  assert.equal(s.debris.count, count);
  assert.equal(s.log.filter(entry => entry.message === 'The bristlebacks have stopped clicking in unison.').length, 1);
  assert.match(animalDetails(s, herd(s)[0], () => null), /Silent, in unison/);
  assert.equal(recorded(s).filter(id => id === 'herd.quiet').length, 1);
  stopRecording(s);
  const loaded = deserialize(serialize(s));
  assert.equal(loaded.debris.herdQuiet, true);
  assert.equal(loaded.debris.target, null);
  step(s);
  step(loaded);
  assert.equal(s.debris.herdQuiet, true);
  assert.equal(s.log.filter(entry => entry.message === 'The bristlebacks have stopped clicking in unison.').length, 1);
  assert.deepEqual(loaded, s);
  while (s.tick < forecastTick) step(s);
  assert.equal(s.tick, forecastTick);
  assert.ok(s.debris.target);
  assert.equal(s.debris.herdQuiet, false);
  assert.equal(s.log.filter(entry => entry.message === 'The bristlebacks are clicking again.').length, 1);
  const continued = deserialize(serialize(s));
  step(s);
  step(continued);
  assert.deepEqual(continued, s);
});

test('fewer than two living bristlebacks do not start the warning', () => {
  const s = createGame();
  s.debris.next = HERD_WARNING_LEAD + 2;
  s.creatures.filter(a => a.species === 'bristleback').slice(1).forEach(a => { a.health = 0; });
  step(s, s.debris.next - HERD_WARNING_LEAD);
  assert.equal(s.tick, s.debris.next - HERD_WARNING_LEAD);
  assert.equal(herd(s).length < 2, true);
  assert.equal(s.debris.herdQuiet, false);
  assert.equal(s.debris.target, null);
  assert.equal(s.log.some(entry => entry.message.includes('stopped clicking')), false);
});

test('a save without the herd flag still loads, and a forged warning is rejected unchanged', () => {
  const older = createGame();
  delete older.debris.herdQuiet;
  const legacy = serialize(older);
  const loaded = deserialize(legacy);
  assert.equal(loaded.debris.herdQuiet, undefined);
  assert.equal(serialize(loaded), legacy);
  step(loaded);
  assert.equal(loaded.debris.herdQuiet, undefined);
  const forged = createGame();
  forged.debris.herdQuiet = 'yes';
  const text = serialize(forged);
  assert.throws(() => deserialize(text), /Invalid herd warning/);
  assert.equal(serialize(forged), text);
  const early = createGame();
  early.debris.herdQuiet = true;
  const earlyText = serialize(early);
  assert.throws(() => deserialize(earlyText), /Invalid herd warning/);
  assert.equal(serialize(early), earlyText);
});


test('review: surface silence does not silence a bristleback inspected at another site', () => {
  const s = createGame();
  s.debris.next = HERD_WARNING_LEAD + 1;
  step(s);
  assert.equal(s.debris.herdQuiet, true);
  const local = herd(s)[0];
  assert.match(animalDetails(s, local, () => null), /Silent, in unison/);
  const remote = { ...structuredClone(local), site: 'wreck' };
  assert.match(animalDetails(s, remote, () => null), /<dt>Calls<\/dt><dd>Clicking<\/dd>/);
});

test('review: herd loss during ecology ends silence in that same saved tick', () => {
  const s = createGame();
  s.debris.next = HERD_WARNING_LEAD + 1;
  step(s);
  assert.equal(s.debris.herdQuiet, true);
  for (const animal of herd(s).slice(1)) {
    animal.fed = 0;
    animal.health = 0.1;
  }
  startRecording(s);
  step(s);
  assert.equal(herd(s).length, 1);
  assert.equal(s.debris.herdQuiet, false);
  const events = exportRecording(s).trim().split('\n').map(JSON.parse).filter(row => row.event).map(row => row.event);
  const resumed = events.filter(event => event.id === 'herd.calling');
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].reason, 'herd_lost');
  assert.deepEqual(resumed[0].animals, herd(s).map(a => a.id).sort());
  assert.equal(serialize(deserialize(serialize(s))), serialize(s));
});

test('review: silence cannot be forged without a living surface herd', () => {
  const s = createGame();
  s.debris.next = HERD_WARNING_LEAD;
  s.debris.herdQuiet = true;
  s.creatures = s.creatures.filter(a => a.species !== 'bristleback');
  const raw = serialize(s);
  assert.throws(() => deserialize(raw), /Invalid herd warning/);
  assert.equal(serialize(s), raw);
});
