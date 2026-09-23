import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { VERSION } from '../src/data.js';
import { at, deserialize, serialize } from '../src/simulation.js';
import { totalResources } from '../src/inventory.js';

// These frozen files prove capture/current-schema compatibility. They are not
// acceptance evidence for an outpost migration. A future schema must get an
// explicit migration check rather than relabeling or rewriting these fixtures.
const provenance = JSON.parse(readFileSync(new URL('./fixtures/outpost-pre36-provenance.json', import.meta.url), 'utf8'));
const phases = ['outbound', 'working-pile', 'working-carried', 'working-cargo', 'returning'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(phase) {
  const compressed = readFileSync(new URL(`./fixtures/outpost-pre36-${phase}.json.gz`, import.meta.url));
  const bytes = gunzipSync(compressed), text = bytes.toString('utf8');
  return { compressed, bytes, text, state: JSON.parse(text) };
}

test('pre-outpost schema 36 captures match their original byte hashes and source provenance', () => {
  assert.equal(provenance.schema, 36);
  assert.equal(provenance.validatedWithOriginalSchema36, true);
  assert.deepEqual(provenance.snapshots.map(row => row.phase), phases);
  assert.ok(Object.keys(provenance.sourceHashes).length >= 75);
  for (const hash of Object.values(provenance.sourceHashes)) assert.match(hash, /^[a-f0-9]{64}$/);
  for (const row of provenance.snapshots) {
    const f = fixture(row.phase);
    assert.equal(f.compressed.length, row.compressedBytes);
    assert.equal(f.bytes.length, row.uncompressedBytes);
    assert.equal(digest(f.compressed), row.sha256Compressed);
    assert.equal(digest(f.bytes), row.sha256Uncompressed);
    assert.equal(f.state.version, 36);
    assert.equal(f.state.tick, row.tick);
    assert.deepEqual(f.state.mission.crew, ['crew-4', 'crew-2']);
    assert.equal(f.state.mission.phase, row.missionPhase);
  }
});

test('capture-only: schema 36 roundtrips preserve expedition bytes, resources and RNG exactly', {
  skip: VERSION !== 36 && 'Capture-only schema 36 check; later schemas require separate migration acceptance tests.',
}, () => {
  for (const phase of phases) {
    const { text, state } = fixture(phase), loaded = deserialize(text);
    assert.deepEqual(loaded, state, phase);
    assert.equal(serialize(loaded), text, `${phase} original save bytes`);
    assert.equal(loaded.rng, state.rng);
    assert.deepEqual(totalResources(loaded), totalResources(state));
    assert.equal(serialize(deserialize(serialize(loaded))), text);
  }
});

test('captured salvage moves from a real remote pile through crew cargo to the shuttle while alloy stays on site', () => {
  const outbound = fixture('outbound').state;
  const mined = fixture('working-pile').state;
  const carried = fixture('working-carried').state;
  const docked = fixture('working-cargo').state;
  const returning = fixture('returning').state;
  assert.deepEqual(outbound.mission.cargo, {});
  assert.deepEqual(at(mined.sites.wreck, 8, 10).drop, { components: 3, alloy: 2 });
  assert.deepEqual(mined.mission.cargo, {});
  const hauler = carried.crew.find(c => c.id === 'crew-4');
  assert.deepEqual(hauler.carry, { components: 3 });
  assert.deepEqual(hauler.delivery, { kind: 'shuttle', target: [4, 11] });
  assert.deepEqual(carried.mission.cargo, {});
  for (const s of [carried, docked, returning]) assert.deepEqual(at(s.sites.wreck, 8, 10).drop, { alloy: 2 });
  for (const s of [docked, returning]) assert.deepEqual(s.mission.cargo, { components: 3 });
  assert.equal(returning.mission.phase, 'returning');
  assert.equal(returning.mission.returnFuel, 0);
  assert.ok(returning.mission.crew.every(id => returning.crew.find(c => c.id === id).site === 'transit'));
  assert.equal(totalResources(mined).components, totalResources(outbound).components + 3);
  assert.equal(totalResources(returning).components, totalResources(mined).components);
  assert.equal(totalResources(returning).alloy, totalResources(mined).alloy);
});
