import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { GASES, gasAmount, mix, roomAt, refreshAtmosphere } from '../src/atmosphere.js';
import { GAS_HEAT_CAPACITY, gasEnergy, roomHeatCapacity, roomKelvin, nodeKelvin, parcelHeat } from '../src/gas-thermal.js';
import { REFERENCE_KELVIN, gasAtRoomPressure, roomPressure } from '../src/room-pressure.js';
import { initializeGasTile, gasNode, gasPressure, gasStatus, updateGasNetworks } from '../src/gas-networks.js';
import { suitReleaseStatus } from '../src/suit-release-status.js';
import { releaseSuitOxygen } from '../src/suit-supply.js';
import { tileAt } from '../src/spatial.js';
import { initializeElectrical, initializePower, updatePower, refreshPower } from '../src/power.js';
import { availablePowerWork } from '../src/power-work.js';
import { validateGasWork } from '../src/gas-compression.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
// Synthetic finite subsystem boundary: only temperature, existing gas and installed
// equipment and one finite 12-unit bank are specified before acceptance.
// Each operating assertion uses native paid allocation on the actual deck.
function heat(site, room, factor) {
  const value = roomHeatCapacity(room) * REFERENCE_KELVIN * factor;
  const delta = value - room.heat;
  site.thermal[delta >= 0 ? 'added' : 'removed'] += Math.abs(delta);
  room.heat = value;
}
function supply(site, tile, amount, kelvin=REFERENCE_KELVIN) {
  tile.gasStore.gas=mix(amount);tile.gasStore.heat=gasEnergy(tile.gasStore.gas,kelvin);
  for(const k of GASES)site.gasNetwork.loaded[k]+=tile.gasStore.gas[k];
  site.thermal.gasLoaded+=tile.gasStore.heat;
}
function fixture({ building = 'gasVent', factor = 1, upper = false } = {}) {
  const s = createGame(), site = s.sites.surface;
  if (upper) {
    site.levels.push({ z: 1, name: 'Upper deck' });
    site.tiles.push(...site.tiles.map(tile => ({ ...structuredClone(tile), z: 1 })));
    site.rooms.push(...site.rooms.map(room => ({ ...structuredClone(room), z: 1 })));
  }
  const z = upper ? 1 : 0, tile = tileAt(site, { x: 11, y: 9, z });
  assert.equal(tile.building, null);
  for(const current of site.tiles){
    if(current.machine)current.machine.enabled=false;
    if(current.climate)current.climate.enabled=false;
    if(current.gasDevice)current.gasDevice.enabled=false;
    if(current.building==='solar')current.hp=0;
  }
  tile.building = building; tile.hp = 100;
  initializeElectrical(tile);initializeGasTile(tile);
  const bank=tileAt(site,{x:12,y:9,z});assert.equal(bank.building,null);
  bank.building='battery';bank.hp=100;initializeElectrical(bank);
  initializePower(s,site,0);bank.charge=12;site.energy.initial+=12;refreshPower(s,site);
  assert.equal(tile.powered,true,'the same-deck finite bank can fund this device');
  if (building === 'gasExtractor') tile.gasDevice.mode = 'exhaust';
  const room = roomAt(site, tile.x, tile.y, z), c = s.crew[0];
  Object.assign(c, { x: tile.x, y: tile.y, z, oxygen: 20 });
  heat(site, room, factor);
  return { s, site, tile, room, c };
}
function paidGasPass(s,site,tile){
  const allocated=tile.building==='gasVent'?2:3,bank=tileAt(site,{x:12,y:9,z:tile.z??0});
  const charge=bank.charge,consumed=site.energy.consumed,before=site.gasWork.allocated;
  updatePower(s,site);close(availablePowerWork(s,site,tile),allocated);
  updateGasNetworks(s);close(bank.charge,charge-allocated);close(site.energy.consumed-consumed,allocated);
  close(site.gasWork.allocated-before,allocated);close(availablePowerWork(s,site,tile),0);validateGasWork(s);
}
const combined = (room, tile) => Object.fromEntries(GASES.map(k => [k, room.gas[k] + gasNode(tile).gas[k]]));
function conserved(before, room, tile) {
  const after = combined(room, tile);
  for (const key of GASES) close(after[key], before[key]);
}

for (const factor of [.5, 2]) test(`vent reaches its pressure target at temperature factor ${factor}, conserving gas and smoke`, () => {
  const { s, site, tile, room } = fixture({ factor });
  const target = gasAtRoomPressure(room, 100);
  room.gas = mix(target - .75); room.smoke = 0; room.pressure = 999;heat(site,room,factor);
  supply(site,tile,4);tile.gasStore.smoke = 1;
  const before = combined(room, tile), storedHeat = room.heat, storedGasHeat=tile.gasStore.heat, initialAmount=gasAmount(room.gas), pipePressure = gasPressure(tile), state = structuredClone(s);
  assert.equal(gasStatus(site, tile).blocked, null);
  assert.deepEqual(s, state, 'readiness must remain pure despite stale pressure');
  close(pipePressure, 160, 'supplied gas begins at reference temperature');
  paidGasPass(s,site,tile);
  const moved=gasAmount(room.gas)-initialAmount;close(roomPressure(room),100);
  assert.ok(moved>0&&moved*1.25<=2);assert.ok(factor<1?moved<.75:moved>.75,'inlet heat changes the finite gas requirement');
  close(gasAmount(tile.gasStore.gas),4-moved);close(room.smoke,moved/4);
  close(room.smoke+tile.gasStore.smoke,1);close(room.heat+tile.gasStore.heat,storedHeat+storedGasHeat+2);
  close(room.heat-storedHeat,parcelHeat(moved,REFERENCE_KELVIN)+2);
  conserved(before, room, tile);
  assert.match(gasStatus(site, tile).blocked, /target pressure/);
  const stopped = structuredClone(room.gas); updateGasNetworks(s); assert.deepEqual(room.gas, stopped);
});

for (const factor of [.5, 2]) test(`exhaust reaches its pressure target at temperature factor ${factor}, conserving gas and smoke`, () => {
  const { s, site, tile, room } = fixture({ building: 'gasExtractor', factor });
  const target = gasAtRoomPressure(room, 100), total = target + .75;
  room.gas = mix(total); room.smoke = total / 4; room.pressure = 0;heat(site,room,factor);
  const before = combined(room, tile), storedHeat = room.heat, smoke = room.smoke, state = structuredClone(s);
  assert.equal(gasStatus(site, tile).blocked, null); assert.deepEqual(s, state);
  paidGasPass(s,site,tile);
  // Final source temperature includes retained paid motor heat. The pressure
  // target remains exact; fixed .75 removal is no longer the same boundary.
  const finalTarget=gasAtRoomPressure(room,100),moved=total-finalTarget,work=site.gasWork.work,motor=3-work;
  close(gasAmount(room.gas),finalTarget);close(roomPressure(room),100);
  assert.ok(moved>.75&&moved*1.25<=2,'source motor heat requires a finite extra withdrawal within the original cap');
  close(gasAmount(tile.gasStore.gas),moved);close(tile.gasStore.smoke,moved/4);
  close(room.smoke+tile.gasStore.smoke,smoke);close(room.heat+tile.gasStore.heat,storedHeat+3);
  close(roomKelvin(room),REFERENCE_KELVIN*factor+motor/roomHeatCapacity(room));
  close(nodeKelvin(tile.gasStore),REFERENCE_KELVIN*factor+work/(GAS_HEAT_CAPACITY*moved));
  close(tile.gasStore.heat,parcelHeat(moved,REFERENCE_KELVIN*factor)+work);
  conserved(before, room, tile);
  assert.match(gasStatus(site, tile).blocked, /target pressure/);
});

test('temperature-dependent target conversions preserve physical vent and exhaust rate caps', () => {
  for (const building of ['gasVent', 'gasExtractor']) {
    const { s, site, tile, room } = fixture({ building, factor: 2 });
    const target = gasAtRoomPressure(room, 100);
    room.gas = mix(target + (building === 'gasVent' ? -10 : 10)); room.smoke = 0;heat(site,room,2);
    if (building === 'gasVent') supply(site,tile,4);
    const before = gasAmount(room.gas);
    paidGasPass(s,site,tile);
    close(Math.abs(gasAmount(room.gas) - before), 2);
  }
});

test('zero-K room venting uses finite warm gas and exhaust requires no gas removal', () => {
  for (const building of ['gasVent', 'gasExtractor']) {
    const { s, site, tile, room } = fixture({ building, factor: 0 });
    supply(site,tile,4);room.pressure=100;
    // Test the zero-K/zero-target guard while the physical room is still at 0 K,
    // before a paid blocked drive legitimately warms it without moving gas.
    close(roomPressure(room),0);assert.equal(room.heat,0);assert.equal(gasAtRoomPressure(room,100),null);
    tile.gasDevice.target=0;assert.match(gasStatus(site,tile).blocked,/target pressure/);tile.gasDevice.target=100;
    const initial=structuredClone(s),before=combined(room,tile),heatBefore=room.heat+tile.gasStore.heat,gasBefore=gasAmount(room.gas);
    if(building==='gasVent')assert.equal(gasStatus(site,tile).blocked,null);
    else assert.match(gasStatus(site,tile).blocked,/target pressure/);
    assert.deepEqual(s,initial);paidGasPass(s,site,tile);conserved(before,room,tile);
    close(room.heat+tile.gasStore.heat,heatBefore+(building==='gasVent'?2:3));
    if(building==='gasVent'){
      close(gasAmount(tile.gasStore.gas),2);close(room.heat,parcelHeat(2,REFERENCE_KELVIN)+2);
      assert.ok(roomPressure(room)>0&&roomPressure(room)<100);assert.ok(Number.isFinite(roomKelvin(room)));
      tile.gasDevice.target=0;assert.match(gasStatus(site,tile).blocked,/target pressure/);
    }else{
      close(gasAmount(tile.gasStore.gas),4);close(gasAmount(room.gas),gasBefore);
      close(room.heat,3);close(site.gasWork.work,0);close(site.gasWork.motorRoom,3);
      close(roomKelvin(room),3/roomHeatCapacity(room));assert.ok(roomPressure(room)>0&&roomPressure(room)<100);
      assert.match(gasStatus(site,tile).blocked,/target pressure/);
    }
  }
});

for (const factor of [.5, 2]) test(`suit advertised maximum and shared release agree at temperature factor ${factor}`, () => {
  const { s, site, c, room } = fixture({ factor });
  room.gas = mix(gasAtRoomPressure(room, 100) - .35); room.pressure = 0;heat(site,room,factor);
  const before = structuredClone(s), status = suitReleaseStatus(s, c.id), initialOxygen = room.gas.oxygen;
  assert.equal(status.maxPoints, 3); assert.deepEqual(s, before);
  assert.equal(executeAction(s, 'crew.suit.release', { crew: c.id, points: 4 }).reason, 'room_full');
  assert.deepEqual(s, before, 'rejected shared action is atomic');
  const agent = structuredClone(s);
  assert.equal(executeAction(s, 'crew.suit.release', { crew: c.id, points: status.maxPoints }, 'player').ok, true);
  assert.equal(executeAction(agent, 'crew.suit.release', { crew: c.id, points: status.maxPoints }, 'agent').ok, true);
  assert.deepEqual(agent, s, 'player and agent use identical transfer rules');
  close(c.oxygen, 17); close(room.gas.oxygen - initialOxygen, .3);
  close(site.atmosphere.injected.oxygen - before.sites.surface.atmosphere.injected.oxygen, .3);
  assert.ok(roomPressure(room) <= 100); assert.equal(suitReleaseStatus(s, c.id).maxPoints, 0);
  close(room.heat-before.sites.surface.rooms.find(r=>r.cells.includes('11,9')).heat,parcelHeat(.3,REFERENCE_KELVIN));
  close(site.thermal.gasLoaded-before.sites.surface.thermal.gasLoaded,parcelHeat(.3,REFERENCE_KELVIN));
});

test('zero-K suit release carries finite warm oxygen and excess requests remain atomic', () => {
  const {s,site,c,room}=fixture({factor:0}),before=structuredClone(s),oxygen=room.gas.oxygen;
  const status=suitReleaseStatus(s,c.id);assert.equal(status.available,true);assert.equal(status.maxPoints,20);
  assert.equal(releaseSuitOxygen(s,c.id,21).code,'insufficient_suit_oxygen');
  assert.equal(executeAction(s,'crew.suit.release',{crew:c.id,points:21}).reason,'insufficient_suit_oxygen');
  assert.deepEqual(s,before);assert.equal(releaseSuitOxygen(s,c.id,1).ok,true);
  close(c.oxygen,19);close(room.gas.oxygen-oxygen,.1);close(room.heat,parcelHeat(.1,REFERENCE_KELVIN));
  close(site.thermal.gasLoaded-before.sites.surface.thermal.gasLoaded,room.heat);
  assert.ok(roomPressure(room)>0&&roomPressure(room)<=100);assert.ok(Number.isFinite(roomKelvin(room)));
});

test('upper-floor vent and suit release use upper temperature and retain upper destination IDs', () => {
  const { s, site, tile, room, c } = fixture({ upper: true, factor: 2 });
  const ground = roomAt(site, tile.x, tile.y, 0), lower = structuredClone(ground);
  room.gas = mix(gasAtRoomPressure(room, 100) - .75); room.smoke = 0;heat(site,room,2);
  const initialAmount=gasAmount(room.gas),initialHeat=room.heat,initialCapacity=roomHeatCapacity(room);
  supply(site,tile,.4);paidGasPass(s,site,tile);close(gasAmount(room.gas),initialAmount+.4);close(tile.gasStore.heat,0);
  const status = suitReleaseStatus(s, c.id);
  assert.equal(status.maxPoints, 3);
  assert.equal(status.destination.tile, 'tile:surface:11:9:1');
  assert.equal(status.destination.room, 'room:surface:7,7:1');
  assert.equal(executeAction(s, 'crew.suit.release', { crew: c.id, points: 3 }).ok, true);
  assert.deepEqual(ground, lower);
  close(gasAmount(room.gas),initialAmount+.7);close(room.heat,initialHeat+parcelHeat(.7,REFERENCE_KELVIN)+2);
  const finalKelvin=(initialHeat+parcelHeat(.7,REFERENCE_KELVIN)+2)/(initialCapacity+GAS_HEAT_CAPACITY*.7);
  close(roomPressure(room),100*(initialAmount+.7)/(10*room.volume)*finalKelvin/REFERENCE_KELVIN);
  assert.ok(roomPressure(room)<=100);assert.equal(suitReleaseStatus(s,c.id).maxPoints,0);
  refreshAtmosphere(site); assert.deepEqual(ground, lower);
});
