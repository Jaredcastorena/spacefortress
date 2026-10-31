import {withTemperaturePressureReadings,withLegacyDensityReadings} from './helpers/pressure-migration.js';
import { VERSION as CURRENT_SAVE_VERSION } from '../src/data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createGame, order, serialize, deserialize, step } from '../src/simulation.js';
import { projectPreDecks, projectPreRegion, projectPreStructuralMaterials } from './helpers/legacy-projection.js';

// Synthetic seed74219, tick0, one paid wall order; produced by source31a3a27
// before schema47 edits. This is not a player save or an endurance trial.
const original = gunzipSync(readFileSync(new URL('./fixtures/decks-schema46-building.json.gz', import.meta.url))).toString();
const fresh = () => JSON.parse(original);
const primary = s => [...Object.values(s.sites).flatMap(site => site.tiles), ...s.crew, ...s.jobs, ...s.creatures];

test('genuine schema46 migration updates declared deck, shipment, crew, animal fields and derived room readings and preserves all ownership', () => {
  assert.equal(createHash('sha256').update(original).digest('hex'), 'b0365416427dbff85fd009314c9345a476c9eae7d697d637a6e91915f81dfe66');
  const old = fresh(), migrated = deserialize(original);
  assert.equal(old.version, 46); assert.equal(migrated.version, CURRENT_SAVE_VERSION);
  for (const site of Object.values(migrated.sites)) {
    assert.deepEqual(site.levels, [{ z: 0, name: 'Landing deck' }]);
    assert.deepEqual(site.verticalLinks, []);
  }
  assert.ok(primary(migrated).every(entity => entity.z === 0));
  const projected = projectPreDecks(migrated); projected.version = 46;
  assert.deepEqual(projected, withTemperaturePressureReadings(old), 'complete prior state, including RNG, timing and nested references');
  const saved = serialize(migrated); assert.equal(serialize(deserialize(saved)), saved);
  assert.equal(JSON.stringify(old), original, 'input is untouched');
});

test('migrated and newly constructed deck-zero colonies continue identically', () => {
  const migrated = deserialize(original), current = deserialize(JSON.stringify({...withLegacyDensityReadings(projectPreRegion(createGame(74219), {allowUnvisited:true})), version:64}));
  // The historical fixture omits the optional, inactive herd flag. Match that
  // representation without hiding any active warning or changing physical state.
  assert.equal(migrated.debris.herdQuiet, undefined); assert.equal(current.debris.herdQuiet, false);
  delete current.debris.herdQuiet;
  // Compare the same classic four-site boundary, then preserve the older depot's explicit resource filter when comparing colonies.
  for(const site of Object.values(current.sites))for(const t of site.tiles)if(t.storage)t.storage.accepted=t.storage.accepted.filter(r=>r!=='tools');
  assert.ok(order(current, 'surface', 5, 6, 'build', 'wall').ok);
  assert.deepEqual(projectPreStructuralMaterials(migrated), projectPreStructuralMaterials(current));
  step(migrated, 4); step(current, 4);
  assert.deepEqual(projectPreStructuralMaterials(migrated), projectPreStructuralMaterials(current));
  const saved = serialize(current); assert.equal(serialize(deserialize(saved)), saved);
});

test('canonical saves reject missing, malformed and unsupported primary deck coordinates', () => {
  const good = deserialize(original);
  for (const [kind, pick] of [
    ['tile', s => s.sites.surface.tiles[0]], ['crew', s => s.crew[0]],
    ['job', s => s.jobs[0]], ['creature', s => s.creatures[0]],
  ]) for (const z of [undefined, null, '0', 1, -1, .5]) {
    const s = structuredClone(good);
    if (z === undefined) delete pick(s).z; else pick(s).z = z;
    assert.throws(() => deserialize(serialize(s)), /deck|coordinate/i, `${kind}: ${z}`);
  }
  for (const change of [s => delete s.sites.surface.levels,
    s => s.sites.surface.levels = [], s => s.sites.surface.levels[0].name = '',
    s => delete s.sites.surface.verticalLinks, s => s.sites.surface.verticalLinks.push({ id: 'invented' })]) {
    const s = structuredClone(good); change(s);
    assert.throws(() => deserialize(serialize(s)), /deck|stairwell|site/i);
  }
});

test('legacy saves cannot smuggle future deck metadata through migration', () => {
  for (const change of [s => s.sites.surface.levels = [{ z: 0, name: 'Landing' }],
    s => s.sites.surface.verticalLinks = [],
    ...[0, null, 1].flatMap(z => [s => s.sites.surface.tiles[0].z = z,
      s => s.crew[0].z = z, s => s.jobs[0].z = z, s => s.creatures[0].z = z])]) {
    const s = fresh(); change(s);
    assert.throws(() => deserialize(serialize(s)), /Legacy save contains/);
  }
});
