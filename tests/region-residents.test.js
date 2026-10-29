import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, serialize, deserialize, step} from '../src/simulation.js';
import {executeAction} from '../src/controls.js';
import {siteDefinitions} from '../src/region.js';
import {horizontalNeighbors, positionOf} from '../src/spatial.js';
import {crewPathToPosition} from '../src/navigation.js';
import {extractionStatus} from '../src/extraction.js';
import {syncResources} from '../src/inventory.js';

for (const template of ['outcrop', 'derelict']) test(`registered ${template} residents save and work locally without a shuttle`, () => {
  const s = createGame(74219), def = Object.values(siteDefinitions(s)).find(d => d.template === template), site = s.sites[def.id], resident = s.crew[0];
  // Synthetic residence boundary isolates post-departure work and persistence.
  // Native supplied arrival/return/revisit is covered separately.
  Object.assign(resident, {site:site.id, x:4, y:10, z:0});
  s.outposts[site.id] = {established:true, residents:[resident.id]};
  for (const c of s.crew) for (const labor of Object.keys(c.labors)) c.labors[labor] = false;
  resident.labors.mining = true;
  assert.equal(executeAction(s, 'crew.routine', {crew:resident.id, policy:'work'}).ok, true);
  const raw = serialize(s);
  assert.equal(serialize(deserialize(raw)), raw);
  const bad = JSON.parse(raw); bad.crew[0].site = 'wreck';
  assert.throws(() => deserialize(JSON.stringify(bad)), /resident is in the wrong location/);
  const target = site.tiles.filter(t => template === 'outcrop' ? t.terrain === 'ore' && !t.building : t.building === 'salvage')
    .map(t => ({t, path:crewPathToPosition(s, site, resident, horizontalNeighbors(t))})).filter(o => o.path !== null).sort((a,b) => a.path.length-b.path.length)[0].t;
  const before = extractionStatus(target), result = executeAction(s, 'job.order', {site:site.id, ...positionOf(target), kind:'mine'});
  assert.equal(result.ok, true, result.message);
  for (let i=0; i<80 && s.jobs.some(j => j.id === result.job); i++) step(s);
  assert.equal(s.jobs.some(j => j.id === result.job), false);
  assert.equal(extractionStatus(target), null);
  for (const [resource, amount] of Object.entries(before.output)) assert.ok(target.drop[resource] >= amount);
  assert.equal(s.mission, null); assert.equal(resident.site, site.id);
  for (const [id, outpost] of Object.entries(s.outposts)) if (id !== site.id) assert.deepEqual(outpost.residents, []);
  syncResources(s); assert.equal(serialize(deserialize(serialize(s))), serialize(s));
});
