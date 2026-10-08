import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { GRID, DIRECTIONS, neighbors, directionBetween } from '../src/geometry.js';
import { createGame, at, pathTo, serialize, deserialize, step } from '../src/simulation.js';
import { actionCatalog, createAgentInterface, executeAction } from '../src/controls.js';
import { observe, startRecording, exportRecording } from '../src/telemetry.js';
import { totalResources, initializeStorage } from '../src/inventory.js';
import { initializeElectrical } from '../src/power.js';
import { assertSquareProtected, legacyText } from './helpers/legacy-square.js';
import { projectPreAirlock, projectPreOutpost } from './helpers/legacy-projection.js';

test('new hex colonies keep every startup berth and resource reachable through six-edge routes', () => {
  const s=createGame(74219),site=s.sites.surface;
  assert.equal(s.grid,GRID);assert.equal(s.version,40);
  assert.equal(site.rooms.length,1);assert.equal(site.rooms[0].sealed,true);assert.equal(site.rooms[0].volume,35);
  for(const t of site.tiles.filter(t=>t.building)) {
    if(t.building==='wall')continue;
    const route=pathTo(site,s.crew[0],[[t.x,t.y]]);
    assert.ok(route,`surface ${t.building} ${t.x},${t.y}`);
    for(let i=1;i<route.length;i++)assert.ok(directionBetween(route[i-1],route[i]));
  }
  for(const site of Object.values(s.sites).filter(site=>site.id!=='surface')) {
    const dock=site.tiles.find(t=>t.building==='dock');assert.ok(dock);
    for(const t of site.tiles.filter(t=>['salvage','volatile','collector'].includes(t.building))) {
      assert.ok(pathTo(site,dock,neighbors(t.x,t.y)),`${site.id} target ${t.x},${t.y}`);
    }
  }
  assert.equal(at(site,16,11).building,'shuttle');
  for(const p of [[-1,1],[26,0],[0,-1],[0,26]])assert.equal(at(site,...p),null);
});

test('all square schemas reject before topology inspection and current saves require the exact grid', () => {
  for(let version=1;version<=39;version++)assert.throws(()=>deserialize(JSON.stringify({version,sites:null})),/Legacy square-grid saves/);
  const s=createGame(),before=serialize(s);
  for(const grid of [undefined,null,'square','hex-odd-r-v1']) {
    const altered={...s,grid};assert.throws(()=>deserialize(serialize(altered)),/Unsupported save topology/);
  }
  assert.equal(serialize(s),before);
  assert.throws(()=>projectPreAirlock(s,39),/Cannot project a hex colony/);
  assert.throws(()=>projectPreOutpost(s),/Cannot project a hex colony/);
});

test('every retained historical square fixture is rejected with original-byte export and replacement protection', () => {
  for(const name of readdirSync(new URL('./fixtures/',import.meta.url)).filter(name=>name.endsWith('.json.gz')))assertSquareProtected(legacyText(name.slice(0,-8)));
});

test('shared directional controls expose exactly six strict IDs and persist each valid direction', () => {
  const s=createGame(),site=s.sites.surface,definitions=createAgentInterface(()=>s).definitions();
  assert.equal(definitions.grid,GRID);assert.deepEqual(definitions.directions,DIRECTIONS);
  const deviceSpecs=[['gas.device','gasPump',9,9,{target:100}],['plumbing.pump','waterPump',10,9,{}],['plumbing.intake','waterIntake',11,9,{mode:'inventory'}],['plumbing.outlet','waterOutlet',12,9,{mode:'floor'}],['power.breaker','breaker',13,9,{mode:'manual'}]];
  for(const [action,building,x,y,options] of deviceSpecs) {
    const t=at(site,x,y);assert.equal(t.building,null);t.building=building;initializeStorage(t);initializeElectrical(t);
    assert.deepEqual(actionCatalog().find(a=>a.id===action).parameters.properties.direction.enum,DIRECTIONS);
    for(const direction of DIRECTIONS)assert.equal(executeAction(s,action,{site:'surface',x,y,enabled:false,direction,...options},'test').ok,true);
    for(const direction of ['north','east','south','west','up',null]) {
      const before=serialize(s);assert.equal(executeAction(s,action,{site:'surface',x,y,enabled:false,direction,...options},'test').ok,false);assert.equal(serialize(s),before);
    }
  }
});

test('hex recordings identify topology without changing deterministic simulation or save ownership', () => {
  const s=createGame(4091),copy=deserialize(serialize(s)),before=totalResources(s);
  const observation=observe(s);assert.equal(observation.grid,GRID);assert.equal(observation.entities.colony.grid,GRID);
  startRecording(s);step(s,6);step(copy,6);assert.equal(serialize(s),serialize(copy));
  const header=JSON.parse(exportRecording(s).split('\n')[0]);assert.equal(header.grid,GRID);assert.equal(header.initialState.grid,GRID);assert.equal(header.gameVersion,40);
  assert.deepEqual(totalResources(header.initialState),before);assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});
