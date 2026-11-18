import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, at, updateRooms, serialize, deserialize} from '../src/simulation.js';
import {executeAction} from '../src/controls.js';
import {roomAt, refreshAtmosphere} from '../src/atmosphere.js';
import {roomHeatCapacity} from '../src/gas-thermal.js';
import {updateThermal} from '../src/thermal.js';
import {flowPlumbing, operatePlumbing, plumbingStatus, initializePlumbingTile, newWaterPipe} from '../src/plumbing.js';
import {MELTING_KELVIN, WATER_LATENT_HEAT, putWater, waterPhase} from '../src/water-thermal.js';
import {startRecording, exportRecording, tileEntityId} from '../src/telemetry.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const events = state => exportRecording(state).trim().split('\n').map(JSON.parse).flatMap(row => row.event || []);
const volume = node => node.water + .09 * waterPhase(node).ice;

test('a saved colony executes the same pipe burst through player and agent steps and retains the damage', () => {
  const player = createGame(74262);
  const site = player.sites.surface;
  const tile = site.tiles.find(t => t.terrain === 'floor' && !t.building && !t.waterPipe && !t.cable && !t.liquid);
  tile.waterPipe = newWaterPipe();
  tile.waterPipe.open = false;
  fill(tile.waterPipe, 2, 1);
  site.plumbing.loaded += 2;
  site.thermal.waterLoaded += tile.waterPipe.heat;

  const agent = deserialize(serialize(player));
  for (const [state, source] of [[player, 'player'], [agent, 'agent']]) {
    assert.equal(executeAction(state, 'simulation.step', {ticks:1}, source).ok, true);
    const incident = state.sites.surface.incidents.find(i => i.target === 'waterPipe');
    assert.deepEqual([incident.x, incident.y, incident.z, incident.amount, incident.cause],
      [tile.x, tile.y, tile.z, 100, 'water']);
  }
  const endpoint = serialize(player);
  assert.ok(endpoint === serialize(agent), 'both input paths produce identical physical state');
  const resumed = deserialize(endpoint);
  assert.equal(at(resumed.sites.surface, tile.x, tile.y, tile.z).waterPipe.hp, 0);
  assert.ok(serialize(resumed) === endpoint, 'damage and water custody survive reloading');
});

function fixture() {
  const state = createGame(74262), site = state.sites.surface;
  const blank = site.tiles.find(tile => tile.terrain === 'ground' && !tile.building && !tile.cable && !tile.liquid);
  const upper = site.tiles.map(({x, y}) => ({...structuredClone(blank), x, y, z:1, terrain:'void'}));
  site.levels.push({z:1, name:'Upper deck'});
  site.tiles.push(...upper);
  const floor = (x, y, z = 1) => Object.assign(at(site, x, y, z), {terrain:'floor', building:null});
  function pipe(x, y, z = 1) {
    const tile = floor(x, y, z);
    tile.waterPipe = newWaterPipe();
    return tile;
  }
  return {state, site, floor, pipe};
}

// At the melting point, each unit of ice has given up exactly one unit's latent heat.
function fill(node, mass, ice = 0) {
  putWater(node, mass, mass * MELTING_KELVIN - ice * WATER_LATENT_HEAT);
}

test('thermal contact freezes a closed upper pipe and the burst releases only liquid on that deck', () => {
  const {state, site, pipe} = fixture(), tile = pipe(3, 3), node = tile.waterPipe;
  updateRooms(site);
  state.tick = 220;
  const room = roomAt(site, tile.x, tile.y, tile.z);
  const coldHeat = roomHeatCapacity(room) * 150;
  site.thermal.removed += room.heat - coldHeat;
  room.heat = coldHeat;
  refreshAtmosphere(site);
  node.open = false;
  node.hp = 73;
  fill(node, 2);
  site.plumbing.loaded += node.water;
  site.thermal.waterLoaded += node.heat;

  assert.equal(startRecording(state).active, true);
  assert.equal(waterPhase(node).ice, 0);
  updateThermal(state);
  const ice = waterPhase(node).ice, occupied = volume(node), heat = node.heat;
  assert.ok(ice > 0 && ice < 2);
  const below = at(site, tile.x, tile.y, 0), lowerWater = below.liquid;
  flowPlumbing(state);
  assert.equal(node.hp, 0);
  assert.equal(tile.hp, 100);
  assert.equal(below.liquid, lowerWater);
  assert.ok(tile.liquid > 0);
  close(waterPhase(node).ice, ice);
  close(node.water + tile.liquid, 2);
  close(node.heat + tile.liquidHeat, heat);
  const id = tileEntityId(site.id, tile.x, tile.y, tile.z);
  const transitions = events(state).filter(event => event.entity === id);
  assert.ok(transitions.some(event => event.id === 'water.froze'));
  assert.ok(transitions.some(event => event.id === 'structure.damaged' && event.target === 'waterPipe' && event.condition === 0));
  const bursts = transitions.filter(event => event.id === 'plumbing.pipe_burst');
  assert.equal(bursts.length, 1);
  close(bursts[0].ice, ice);
  close(bursts[0].occupiedVolume, occupied);
  assert.equal(bursts[0].capacity, 2);
  assert.equal(bursts[0].previousCondition, 73);
});

test('open pipes and risers can relieve freezing pressure before damage', () => {
  for (const riser of [false, true]) {
    const {state, site, pipe} = fixture(), source = pipe(3, 3);
    const destination = riser ? pipe(3, 3, 0) : pipe(3, 4);
    if (riser) {
      const id = 'utility-1';
      site.utilityLinks.push({id, kind:'water', enabled:true, hp:100, lower:{x:3,y:3,z:0}, upper:{x:3,y:3,z:1}});
      source.risers = {water:id};
      destination.risers = {water:id};
    }
    fill(source.waterPipe, 2, 1);
    const heat = source.waterPipe.heat;
    flowPlumbing(state);
    assert.equal(source.waterPipe.hp, 100);
    assert.ok(volume(source.waterPipe) <= 2);
    close(waterPhase(source.waterPipe).ice, 1);
    close(destination.waterPipe.water + source.waterPipe.water, 2);
    close(destination.waterPipe.heat + source.waterPipe.heat, heat);

    // Now put the nearly full icy pipe on the receiving end of the same edge.
    source.waterPipe = newWaterPipe();
    destination.waterPipe = newWaterPipe();
    fill(source.waterPipe, 2);
    fill(destination.waterPipe, 1.90, 1);
    flowPlumbing(state);
    assert.ok(destination.waterPipe.water > 1.90);
    assert.ok(volume(destination.waterPipe) <= 2 + 1e-9);
    assert.equal(destination.waterPipe.hp, 100);
    close(destination.waterPipe.water + source.waterPipe.water, 3.90);
  }
});

test('a pump and a floor intake stop at the physical headroom of a mixed pipe', () => {
  for (const building of ['waterPump', 'waterIntake']) {
    const {state, site, floor, pipe} = fixture();
    const target = pipe(3, 2), device = floor(3, 3);
    fill(target.waterPipe, 1.90, 1);
    device.building = building;
    device.powered = true;
    initializePlumbingTile(device);
    device.waterDevice.direction = 'n';
    if (building === 'waterIntake') {
      device.waterDevice.mode = 'floor';
      putWater(floor(3, 4), 1, MELTING_KELVIN, {floor:true});
    } else {
      fill(pipe(3, 4).waterPipe, 1);
    }
    close(plumbingStatus(state, site, device).targetFree, .01);
    operatePlumbing(state);
    close(target.waterPipe.water, 1.91);
    close(volume(target.waterPipe), 2);
    close(plumbingStatus(state, site, target).targetFree, 0);
    assert.equal(plumbingStatus(state, site, device).blockedCode, 'target_full');
    operatePlumbing(state);
    close(target.waterPipe.water, 1.91);
  }
});

test('fully frozen pipes break once above capacity and stay intact at capacity, while reservoirs keep full ice', () => {
  const {state, site, floor, pipe} = fixture(), full = pipe(2, 2), safe = pipe(4, 4);
  const reservoir = floor(6, 6);
  reservoir.building = 'waterReservoir';
  initializePlumbingTile(reservoir);
  fill(safe.waterPipe, 2 / 1.09, 2 / 1.09);
  // Saved mass can exceed the nominal capacity by its validation roundoff.
  const warm = pipe(8, 8);
  fill(warm.waterPipe, 2 + 5e-9);
  fill(reservoir.waterStore, 32, 32);
  fill(full.waterPipe, 2, 2);
  const heat = full.waterPipe.heat;
  assert.equal(startRecording(state).active, true);
  flowPlumbing(state);
  flowPlumbing(state);
  assert.equal(events(state).filter(event => event.id === 'plumbing.pipe_burst').length, 1);
  assert.equal(full.waterPipe.hp, 0);
  close(full.waterPipe.water, 2);
  close(full.waterPipe.heat, heat);
  close(full.liquid, 0);
  assert.equal(safe.waterPipe.hp, 100);
  assert.equal(warm.waterPipe.hp, 100);
  assert.equal(reservoir.hp, 100);
  close(reservoir.waterStore.water, 32);
  close(reservoir.liquid, 0);
});
