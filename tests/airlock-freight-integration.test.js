import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { tileAt } from '../src/geometry.js';
import { initializeStorage, syncResources } from '../src/inventory.js';
import { initializeElectrical, initializePower, refreshPower } from '../src/power.js';
import { initializeProduction } from '../src/production.js';
import { initializeAirlocks } from '../src/airlock-persistence.js';
import { updateRooms, roomAt, fillRoom, refreshAtmosphere } from '../src/atmosphere.js';
import { initializeThermal } from '../src/thermal.js';
import { roomPressureFactor } from '../src/room-pressure.js';
import { gasNode, newPipe } from '../src/gas-networks.js';
import { executeAction } from '../src/controls.js';
import { freightStatus } from '../src/freight.js';
import { suitReleaseStatus } from '../src/suit-release-status.js';
import { planCrewRoute } from '../src/navigation.js';
import { airlockRoomReading, airlockTankMakeupAllowance } from '../src/airlock-access.js';
import { startRecording, stopRecording, exportRecording, recordingStatus } from '../src/telemetry.js';
import { PLACEMENTS } from '../tools/paid-airlock-example.mjs';
import { physicalBalances, physicalMaterialOwners } from '../tools/paid-air-recovery.mjs';
import { commissionPaidAirlock, commissioningStatus } from '../tools/paid-airlock-commissioning.mjs';

const LIMITS = Object.freeze({ ticks: 180, attempts: 220, commands: 40, gasTicks: 160 });
const hash = text => createHash('sha256').update(text).digest('hex');
const copy = value => structuredClone(value);
const production = ['crew-0', 'crew-1', 'crew-2', 'crew-4', 'crew-5'];


// SYNTHETIC mechanics only. Fresh seed, installed paid geometry, finite prepared
// needs/gas/stock/charge; no ordinary save is cloned or advanced. The shuttle is
// the seed's existing healthy surface terminal at 16,11. All writes end before
// the canonical input is frozen. Gameplay then uses registered agent actions.
function synthetic(nearThreshold, supplyTank = false) {
  const state = createGame(74219), site = state.sites.surface;
  for (const p of PLACEMENTS) {
    const t = tileAt(site, p.x, p.y);
    if (p.building === 'floor') t.terrain = 'floor';
    else if (p.building === 'cable') t.cable = { enabled: true, hp: 100 };
    else if (p.building === 'gasPipe') t.pipe = newPipe();
    else t.building = p.building;
    t.hp = 100; initializeStorage(t); initializeElectrical(t);
  }
  if (supplyTank) {
    const tank = tileAt(site, 10, 16);
    tank.building = 'gasTank'; initializeStorage(tank);
  }
  const processor = tileAt(site, 13, 9);
  processor.building = 'atmosphere'; initializeStorage(processor); initializeElectrical(processor);
  initializeProduction(state); initializeAirlocks(state);
  for (const t of site.tiles) {
    if (t.machine) t.machine.enabled = false;
    for (const inv of [t.stock, t.drop, t.imports, t.machine?.input, t.machine?.output]) if (inv) delete inv.alloy;
    if (t.stock) { t.stock.air = 4; t.stock.water = 22; }
    if (t.building === 'door') { t.doorMode = 'closed'; t.doorUntil = 0; }
    if (t.gasDevice) t.gasDevice.enabled = false;
  }
  tileAt(site, 8, 10).stock.alloy = 1;
  tileAt(site, 7, 7).machine.input = { air: 6 };
  tileAt(site, 10, 13).gasDevice = { enabled: false, mode: 'exhaust', target: 0 };
  tileAt(site, 10, 15).gasDevice = { enabled: false, direction: 's' };
  for (const c of state.crew) {
    Object.assign(c, { x: 8, y: 10, oxygen: 90, energy: 90, job: null, intent: null });
    c.life.policy = 'balanced'; c.labors.production = production.includes(c.id);
  }
  state.creatures = []; state.jobs = [];
  updateRooms(site); initializeThermal(state);
  fillRoom(roomAt(site, 10, 11)); fillRoom(roomAt(site, 10, 13));
  if (nearThreshold) {
    // Finite synthetic near-floor pressure/composition at the initial ambient
    // temperature. The original20C boundary cools below breathable pressure;
    // this separate8C setup isolates freight, without later gas/heat changes.
    for (const room of site.rooms) room.heat = room.volume * 20 * (site.thermal.ambient + 273.15);
    site.thermal.initial = site.rooms.reduce((sum, room) => sum + room.heat, 0);
    const habitat = roomAt(site, 10, 11), chamber = roomAt(site, 10, 13);
    for (const [room, original] of [[habitat, { oxygen: 52.800000000000004, inert: 277.0263378661494, co2: .051891004317951676 }],
      [chamber, { oxygen: 3.2000012535583635, inert: 16.789462193476677, co2: .0031412554525990922 }]]) {
      room.gas = Object.fromEntries(Object.entries(original).map(([species, amount]) => [species, amount / roomPressureFactor(room)]));
    }
  }
  refreshAtmosphere(site); initializePower(state, site, 120); refreshPower(state, site); syncResources(state);
  return deserialize(serialize(state));
}

function alloyOwners(s) {
  const rows = [], add = (owner, inv) => { if (inv?.alloy) rows.push({ owner, amount: inv.alloy }); };
  for (const [id, site] of Object.entries(s.sites)) for (const t of site.tiles) {
    for (const slot of ['stock', 'drop', 'imports']) add(`tile:${id}:${t.x}:${t.y}/${slot}`, t[slot]);
    for (const slot of ['input', 'output']) add(`tile:${id}:${t.x}:${t.y}/machine.${slot}`, t.machine?.[slot]);
  }
  for (const c of s.crew) add(`${c.id}/carry`, c.carry);
  for (const j of s.jobs) {
    add(`${j.id}/materials`, j.materials);
    j.sources?.forEach((source, index) => add(`${j.id}/sources.${index}`, source.items));
  }
  add('colony/shuttle.freight', s.shuttle.freight); add('colony/mission.cargo', s.mission?.cargo);
  return rows;
}

async function freeze(name, text) {
  const directory = process.env.AIRLOCK_FREIGHT_OUTPUT_DIR;
  if (!directory) return null;
  await mkdir(directory, { recursive: true });
  const sha256 = hash(text), path = join(directory, `${name}-sha256-${sha256}.txt`);
  try { await writeFile(path, text, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.equal(hash(await readFile(path, 'utf8')), sha256, 'frozen evidence copy verified');
  await chmod(path, 0o444);
  return { path, sha256, bytes: Buffer.byteLength(text) };
}

async function run(label, nearThreshold) {
  let s, input, failure = null, commission = null, stage = 'fixture', recording = false;
  let attempts = 0, commands = 0, gasTicks = 0, initialTick = 0;
  let loadJob = null, unloadJob = null, startGas = null, originalModes = null;
  const actions = [], trace = [], operations = [];
  let release = null, helperStage = 0, helperDelivered = false;
  const stop = (code, detail) => { const e = new Error(detail); e.code = code; throw e; };
  const t = (x, y) => tileAt(s.sites.surface, x, y);
  function inspect() {
    const owners = alloyOwners(s), actor = s.crew.find(c => c.id === 'crew-1'), a = t(10, 10).airlock;
    trace.push({ tick: s.tick, stage, owners, crew: s.crew.map(c => ({ id: c.id, x: c.x, y: c.y, health: c.health, injury: c.medical.injury, oxygen: c.oxygen, energy: c.energy, carry: copy(c.carry), delivery: copy(c.delivery), job: c.job, intent: copy(c.intent) })), controller: copy(a), jobs: s.jobs.map(j => ({ id: j.id, kind: j.kind, worker: j.worker, remaining: j.remaining, materials: copy(j.materials), sources: copy(j.sources) })) });
    if (nearThreshold) trace.at(-1).lifeSupport = { enabled: t(7, 7).machine.enabled, inputAir: t(7, 7).machine.input.air || 0, finiteAirOwners: physicalMaterialOwners(s).filter(row => row.air), habitatGas: copy(roomAt(s.sites.surface, 8, 10).gas), injected: copy(s.sites.surface.atmosphere.injected), vented: copy(s.sites.surface.atmosphere.vented), breathed: s.sites.surface.atmosphere.breathed };
    if (s.crew.some(c => c.health !== 100 || c.medical.injury !== 0)) stop('crew_harmed', `Crew harmed at tick ${s.tick}.`);
    if (Math.abs(owners.reduce((n, row) => n + row.amount, 0) - 1) > 1e-8) stop('parcel_conservation', `Singleton custody changed at tick ${s.tick}.`);
    if (a?.reason) stop('native_airlock_blockage', `${a.phase}: ${a.reason} at tick ${s.tick}.`);
    const balance = physicalBalances(s);
    if (startGas !== null && (Math.abs(balance.gas - startGas) > 1e-7 || Object.values(balance.energy).some(n => !Number.isFinite(n) || Math.abs(n) > 1e-7))) stop('physical_conservation', `Gas/energy accounting changed at tick ${s.tick}.`);
    if (serialize(deserialize(serialize(s))) !== serialize(s)) stop('invalid_state', `Noncanonical state at tick ${s.tick}.`);
    if (recording && !recordingStatus(s).active) stop('recording_limit', 'Complete recording reached its limit.');
    return { owners, actor, a };
  }
  function act(id, args) {
    if (attempts >= LIMITS.attempts) stop('attempt_limit', '220 attempts reached.');
    if (id !== 'simulation.step' && commands >= LIMITS.commands) stop('command_limit', '40 non-step commands reached.');
    const activeGas = s.sites.surface.tiles.some(t => t.gasDevice?.enabled);
    if (id === 'simulation.step' && s.tick - initialTick >= LIMITS.ticks) stop('tick_limit', '180 full ticks reached.');
    if (id === 'simulation.step' && activeGas && gasTicks >= LIMITS.gasTicks) stop('gas_tick_limit', '160 active gas ticks reached.');
    attempts++; if (id !== 'simulation.step') commands++; else if (activeGas) gasTicks++;
    const entry = { tick: s.tick, id, args: copy(args) }; actions.push(entry);
    const result = executeAction(s, id, args, 'agent');
    Object.assign(entry, { postTick: s.tick, ok: result.ok, code: result.code, reason: result.reason, message: result.message, job: result.job });
    if (!result.ok) stop('action_rejected', `${id}: ${result.reason || result.code || result.message}`);
    inspect(); return result;
  }
  function step() {
    const result = act('simulation.step', { ticks: 1 });
    if (!nearThreshold) return result;
    const a = t(10, 10).airlock, actor = s.crew.find(c => c.id === 'crew-1'), helper = s.crew.find(c => c.id === 'crew-2');
    if (!release && a.direction === 'outward' && a.phase === 'recover' && a.cycle === 1 && a.party?.crew === actor.id) {
      const chamber = roomAt(s.sites.surface, a.config.chamber.x, a.config.chamber.y), status = suitReleaseStatus(s, actor.id);
      const sealed = chamber?.sealed && roomAt(s.sites.surface, actor.x, actor.y) === chamber && [a.config.inner, a.config.outer].every(p => t(p.x,p.y).doorMode === 'closed');
      if (sealed && t(a.config.extractor.x,a.config.extractor.y).gasDevice.enabled && t(a.config.pump.x,a.config.pump.y).gasDevice.enabled && status.maxPoints >= 20) {
        const before = { tick: s.tick, suit: actor.oxygen, chamber: copy(chamber.gas), extracted: copy(s.sites.surface.gasNetwork.extracted) };
        act('crew.suit.release', { crew: actor.id, points: 20 });
        assert.equal(actor.oxygen, before.suit - 20);
        assert.ok(Math.abs(chamber.gas.oxygen - before.chamber.oxygen - 2) < 1e-8);
        assert.equal(chamber.gas.inert, before.chamber.inert); assert.equal(chamber.gas.co2, before.chamber.co2);
        release = { before, after: { suit: actor.oxygen, chamber: copy(chamber.gas) }, captured: null }; operations.push({ kind: 'suit-release', ...release });
      }
    }
    if (release && !release.captured && s.sites.surface.gasNetwork.extracted.oxygen > release.before.extracted.oxygen && a.phase === 'recover') {
      release.captured = { tick: s.tick, extracted: copy(s.sites.surface.gasNetwork.extracted), extractor: copy(gasNode(t(a.config.extractor.x,a.config.extractor.y)).gas), reservoir: copy(gasNode(t(a.config.reservoir.x,a.config.reservoir.y)).gas) };
      operations.push({ kind: 'oxygen-capture', ...release.captured });
    }
    if (!helperStage && unloadJob && actor.job === unloadJob) {
      helperStage = 1; act('crew.routine', { crew: helper.id, policy: 'work' });
    }
    if (helperStage && !helperDelivered) {
      if (helper.job || helper.carry && (helper.carry.air !== 4 || Object.entries(helper.carry).some(([r,n]) => !r.startsWith('_') && r !== 'air' && n))) stop('helper_conflict', 'Helper took conflicting cargo or job.');
      if (helperStage === 1 && helper.carry?.air === 4) {
        if (helper.delivery?.kind !== 'input' || helper.delivery.target.x !== 7 || helper.delivery.target.y !== 7 || helper.delivery.target.z !== 0) stop('helper_conflict', 'Helper air has an incompatible delivery.');
        operations.push({ kind: 'helper-air-pickup', tick: s.tick, carry: copy(helper.carry), delivery: copy(helper.delivery), stockAir: t(8, 10).stock.air || 0 });
        helperStage = 2; act('crew.routine', { crew: helper.id, policy: 'rest' });
        assert.equal(helper.carry.air, 4); assert.equal(helper.delivery.kind, 'input');
      } else if (helperStage === 2 && !helper.carry) {
        assert.equal(helper.delivery, null); assert.equal(t(7, 7).machine.input.air, 4, 'native helper deposited all four air');
        helperDelivered = true; operations.push({ kind: 'helper-air-delivery', tick: s.tick, inputAir: t(7, 7).machine.input.air });
      }
    }
    return result;
  }
  try {
    s = synthetic(nearThreshold); initialTick = s.tick; input = serialize(s);
    await freeze(`${label}-input`, input);
    assert.equal(freightStatus(s).usable, true); assert.equal(freightStatus(s).free, 18);
    assert.deepEqual(s.sites.surface.tiles.filter(t => t.building === 'door').map(t => [t.x, t.y]), [[10, 12], [12, 14]], 'same two existing door capabilities');
    startRecording(s, { maxRecords: 12000, maxBytes: 128_000_000 }); recording = true;
    startGas = physicalBalances(s).gas;
    stage = 'commission';
    commission = commissionPaidAirlock(s, { record: false });
    attempts = commission.summary.attempts; commands = commission.summary.commands; gasTicks = commission.summary.gasTicks;
    actions.push(...commission.actions);
    if (!commission.summary.ok) stop('commissioning_failed', JSON.stringify(commission.summary.failure));
    inspect();
    stage = 'route_setup';
    const modes = () => ({ crew: s.crew.map(c => ({ id: c.id, routine: c.life.policy, labors: copy(c.labors) })), machines: s.sites.surface.tiles.filter(t => t.machine).map(t => ({ x: t.x, y: t.y, enabled: t.machine.enabled })), doors: s.sites.surface.tiles.filter(t => t.building === 'door').map(t => ({ x: t.x, y: t.y, mode: t.doorMode })) });
    originalModes = modes();
    const outward = planCrewRoute(s, s.sites.surface, s.crew.find(c => c.id === 'crew-1'), [[16, 11]]);
    assert.ok(outward?.segments.some(segment => segment.kind === 'airlock' && segment.direction === 'outward'), 'outward native plan crosses the real bound controller');
    // No unowned bypass doors exist in this matched geometry. Preserve the
    // original modes so a future fixture with such a door must restore them.
    const bypass = s.sites.surface.tiles.filter(t => t.building === 'door' && !t.airlockOwner).map(t => ({ x: t.x, y: t.y, mode: t.doorMode }));
    for (const door of bypass) act('door.mode', { site: 'surface', x: door.x, y: door.y, mode: 'closed' });
    for (const c of s.crew.filter(c => c.id !== 'crew-1')) act('crew.routine', { crew: c.id, policy: 'rest' });
    act('production.enable', { site: 'surface', x: 7, y: 9, enabled: false });
    if (!nearThreshold) act('production.enable', { site: 'surface', x: 7, y: 7, enabled: false });
    stage = 'load'; loadJob = act('freight.load', { items: { alloy: 1 } }).job;
    while (s.jobs.some(j => j.id === loadJob)) step();
    assert.equal(s.shuttle.freight.alloy, 1, 'singleton reached existing shuttle freight');
    stage = 'unload'; unloadJob = act('freight.unload', { site: 'surface', items: { alloy: 1 } }).job;
    while (s.jobs.some(j => j.id === unloadJob)) step();
    stage = 'return';
    while (!(t(8, 10).stock.alloy === 1 && !s.crew.some(c => c.carry?.alloy) && t(10, 10).airlock.phase === 'idle' && !t(10, 10).airlock.party && s.crew.every(c => roomAt(s.sites.surface, c.x, c.y) === roomAt(s.sites.surface, 8, 10)))) step();
    if (nearThreshold) { assert.ok(release?.captured, 'one finite release physically captured'); assert.equal(helperDelivered, true); }
    stage = 'restore';
    for (const door of bypass) act('door.mode', { site: 'surface', x: door.x, y: door.y, mode: door.mode });
    for (const c of s.crew.filter(c => c.life.policy !== 'balanced')) act('crew.routine', { crew: c.id, policy: 'balanced' });
    act('production.enable', { site: 'surface', x: 7, y: 9, enabled: true });
    act('production.enable', { site: 'surface', x: 7, y: 7, enabled: true });
    inspect();
    const home = roomAt(s.sites.surface, 8, 10), reading = airlockRoomReading(home), control = t(10, 10), a = control.airlock;
    assert.equal(s.crew.length, 7); assert.ok(s.crew.every(c => c.health === 100 && c.medical.injury === 0 && c.site === 'surface' && roomAt(s.sites.surface, c.x, c.y) === home));
    assert.ok(reading.breathable && reading.thermalSafe, 'source habitat remains safe at the completed cargo checkpoint');
    assert.equal(control.hp, 100); assert.equal(a.enabled, true); assert.equal(a.phase, 'idle'); assert.equal(a.party, null); assert.equal(a.queue.length, 0); assert.equal(a.reason, null);
    for (const ref of a.ownedNodes) { const n = t(ref.x, ref.y), owner = (ref.layer === 'pipe' ? n.pipe : n).airlockOwner; assert.equal(owner.binding, a.binding); assert.equal(owner.controller, 'tile:surface:10:10'); }
    for (const point of [a.config.inner, a.config.outer]) { const door = t(point.x,point.y); assert.equal(door.building, 'door'); assert.equal(door.hp, 100); assert.equal(door.doorMode, 'closed'); }
    assert.deepEqual(modes(), originalModes, 'original routines, labors, machines and door modes restored');
    assert.equal(s.jobs.length, 0);
    stage = 'complete';
  } catch (error) { failure = { code: error.code || 'assertion_or_fixture', message: String(error.message).slice(0, 600), tick: s?.tick, stage }; }
  if (recording) stopRecording(s);
  const recordingText = recording ? exportRecording(s) : '';
  let events = [];
  if (recordingText) {
    const rows = recordingText.trim().split('\n').map(row => JSON.parse(row));
    events = rows.filter(row => row.kind === 'event').map(row => row.event);
    if (!failure) try {
      const records = rows.slice(1, -1);
      records.forEach((row, i) => assert.equal(row.sequence, i + 1));
      assert.equal(rows.at(-1).reason, 'stopped');
      assert.equal(records.filter(row => row.kind === 'external').length, 0);
      assert.equal(records.filter(row => row.kind === 'action.requested').length, attempts);
      assert.equal(records.filter(row => row.kind === 'simulation.tick').length, s.tick - initialTick);
      assert.ok(records.filter(row => row.kind === 'action.requested').every(row => row.action.source === 'agent'));
      for (const [job, name] of [[loadJob, 'freight.loaded'], [unloadJob, 'freight.unloaded']]) {
        const event = events.find(e => e.id === name && e.entity === job);
        assert.equal(event?.cargo.alloy, 1); assert.equal(event.actor, 'crew-1');
      }
      for (const direction of ['outward', 'inward']) {
        const traversed = events.find(e => e.id === 'airlock.traversed' && e.crew === 'crew-1' && e.direction === direction && trace.some(row => row.tick === e.tick && row.crew.some(c => c.id === 'crew-1' && c.carry?.alloy === 1)));
        assert.ok(traversed, `typed ${direction} traversal exists`);
        assert.ok(trace.some(row => row.tick === traversed.tick && row.crew.some(c => c.id === 'crew-1' && c.carry?.alloy === 1)), `same singleton physically carried on ${direction} traversal tick`);
      }
      if (nearThreshold) { const releases = events.filter(e => e.id === 'crew.suit.released'); assert.equal(releases.length, 1); assert.equal(releases[0].points, 20); assert.equal(releases[0].oxygen, 2); assert.equal(actions.filter(a => a.id === 'crew.routine' && a.args.crew === 'crew-2' && ['work','rest'].includes(a.args.policy)).length, 3); }
      assert.equal(s.shuttle.freight.alloy || 0, 0); assert.equal(t(8, 10).stock.alloy, 1);
    } catch (error) { failure = { code: 'proof_invariant', message: String(error.message).slice(0, 600), tick: s.tick, stage }; }
  }
  const refs = {};
  for (const [name, text] of Object.entries({ operations: JSON.stringify(operations), source: await readFile(new URL(import.meta.url), 'utf8'), actions: JSON.stringify(actions), trace: JSON.stringify(trace), endpoint: s ? serialize(s) : '', recording: recordingText, events: JSON.stringify(events.filter(e => e.id.startsWith('freight.') || e.id.startsWith('airlock.') || e.id === 'crew.suit.released' || e.id === 'gas.extracted')) })) refs[name] = await freeze(`${label}-${name}`, text);
  const summary = { label, strategy: nearThreshold ? 'finite-suit-makeup-and-native-resupply' : 'paused-scrubber-through-cargo', synthetic: true, ordinaryFeasibilityProved: false, ok: !failure, failure, initialTick, tick: s?.tick, addedTicks: s ? s.tick - initialTick : 0, attempts, commands, gasTicks, limits: LIMITS, loadJob, unloadJob, operations, commission: commission?.summary, inputSha256: input ? hash(input) : null, refs };
  await freeze(`${label}-summary`, JSON.stringify(summary, null, 2));
  return summary;
}

test('synthetic native freight round trips with finite operations', async () => {
  for (const [label, nearThreshold] of [['synthetic-rich-gas-roundtrip', false], ['synthetic-near-threshold-roundtrip', true]]) {
    const output = await run(label, nearThreshold);
    assert.equal(output.ok, true, JSON.stringify(output.failure));
    assert.ok(output.addedTicks <= LIMITS.ticks && output.attempts <= LIMITS.attempts && output.commands <= LIMITS.commands && output.gasTicks <= LIMITS.gasTicks);
  }
});

// One fixed-resource SYNTHETIC trial: tank deliveries and both cargo rounds use
// full shared-engine steps. The ordinary colony endpoint is never loaded.
async function runRepeatedTankCargo() {
  const label = 'synthetic-rich-tank-two-rounds';
  const limits = Object.freeze({ ticks: 260, attempts: 340, commands: 80, gasTicks: 220 });
  const config = { site: 'surface', x: 10, y: 10, chamber: [10, 13], inner: [10, 12], outer: [12, 14], extractor: [10, 13], pump: [10, 15], reservoir: [10, 16], vent: [11, 13] };
  let s, input, baseline, originalModes, commission, failure = null, stage = 'fixture', recording = false;
  let attempts = 0, commands = 0, gasTicks = 0, initialTick = 0, round = 0, sawPickup = false;
  const actions = [], trace = [], rounds = [], operations = [];
  const t = (x, y) => tileAt(s.sites.surface, x, y);
  const actor = () => s.crew.find(c => c.id === 'crew-1');
  const stop = (code, message) => { const error = new Error(message); error.code = code; throw error; };
  const modes = () => ({ crew: s.crew.map(c => ({ id: c.id, routine: c.life.policy, labors: copy(c.labors) })), machines: s.sites.surface.tiles.filter(t => t.machine).map(t => ({ x: t.x, y: t.y, enabled: t.machine.enabled })), doors: s.sites.surface.tiles.filter(t => t.building === 'door').map(t => ({ x: t.x, y: t.y, mode: t.doorMode })) });
  function speciesBalance() {
    const packaged = physicalMaterialOwners(s).reduce((n, row) => n + row.air, 0);
    const gas = { oxygen: packaged * .21, inert: packaged * .79, co2: 0 };
    const add = inventory => { for (const key of Object.keys(gas)) gas[key] += inventory[key]; };
    for (const site of Object.values(s.sites)) {
      for (const room of site.rooms) add(room.gas);
      for (const tile of site.tiles) if (gasNode(tile)) add(gasNode(tile).gas);
      add(site.atmosphere.vented); add(site.gasNetwork.vented);
      gas.oxygen += site.atmosphere.breathed; gas.co2 -= site.atmosphere.breathed;
    }
    gas.oxygen += s.crew.reduce((n, c) => n + c.oxygen * .1, 0);
    return gas;
  }
  function inspect() {
    const a = t(10, 10).airlock, balance = physicalBalances(s), species = speciesBalance();
    const row = { tick: s.tick, stage, round, controller: copy(a), owners: alloyOwners(s), crew: s.crew.map(c => ({ id: c.id, x: c.x, y: c.y, site: c.site, health: c.health, injury: c.medical.injury, oxygen: c.oxygen, energy: c.energy, carry: copy(c.carry), delivery: copy(c.delivery), job: c.job, intent: copy(c.intent) })), jobs: s.jobs.map(j => ({ id: j.id, kind: j.kind, worker: j.worker })), tank: { enabled: t(10, 16).machine.enabled, input: copy(t(10, 16).machine.input), gas: copy(gasNode(t(10, 16)).gas), owner: copy(t(10, 16).airlockOwner) }, loaded: copy(s.sites.surface.gasNetwork.loaded), finiteAirOwners: balance.owners.filter(row => row.air), species, gasBalance: balance.gas, energy: balance.energy, bank: t(13, 7).charge, habitat: airlockRoomReading(roomAt(s.sites.surface, 8, 10)), chamber: airlockRoomReading(roomAt(s.sites.surface, 10, 13)) };
    trace.push(row);
    if (s.crew.some(c => c.health !== 100 || c.medical.injury !== 0)) stop('crew_harmed', `Crew harmed at tick ${s.tick}.`);
    if (Math.abs(row.owners.reduce((n, owner) => n + owner.amount, 0) - 1) > 1e-7) stop('parcel_conservation', 'Singleton custody changed.');
    const waiting = a?.phase === 'paused' && a.reason === 'supply_empty' && !a.party && a.resumePhase === 'idle' && a.queue.length > 0 && airlockTankMakeupAllowance(s.sites.surface, t(10, 16)) > 0;
    if (a?.reason && !waiting) stop('native_airlock_blockage', `${a.phase}: ${a.reason} at tick ${s.tick}.`);
    if (baseline && (Math.abs(balance.gas - baseline.gas) > 1e-7 || Object.values(balance.energy).some(n => !Number.isFinite(n) || Math.abs(n) > 1e-7) || Object.keys(species).some(key => !Number.isFinite(species[key]) || Math.abs(species[key] - baseline.species[key]) > 1e-7))) stop('physical_conservation', 'Gas species/material/energy changed.');
    const canonical = serialize(s);
    if (serialize(deserialize(canonical)) !== canonical) stop('invalid_state', 'Noncanonical state.');
    if (recording && !recordingStatus(s).active) stop('recording_limit', 'Complete recording reached its limit.');
    if (stage === 'tank_delivery' && actor().carry?.air === 4) {
      assert.equal(actor().delivery?.kind, 'input'); assert.deepEqual(actor().delivery.target, { x: 10, y: 16, z: 0 });
      sawPickup = true;
    }
  }
  function act(id, args) {
    if (attempts >= limits.attempts) stop('attempt_limit', '340 attempts reached.');
    if (id !== 'simulation.step' && commands >= limits.commands) stop('command_limit', '80 nonstep commands reached.');
    const activeGas = s.sites.surface.tiles.some(tile => tile.gasDevice?.enabled);
    if (id === 'simulation.step' && s.tick - initialTick >= limits.ticks) stop('tick_limit', '260 full ticks reached.');
    if (id === 'simulation.step' && activeGas && gasTicks >= limits.gasTicks) stop('gas_tick_limit', '220 gas-active ticks reached.');
    attempts++; if (id !== 'simulation.step') commands++; else if (activeGas) gasTicks++;
    const entry = { tick: s.tick, stage, round, id, args: copy(args) }; actions.push(entry);
    const result = executeAction(s, id, args, 'agent');
    Object.assign(entry, { postTick: s.tick, ok: result.ok, code: result.code, reason: result.reason, message: result.message, job: result.job });
    if (!result.ok) stop('action_rejected', `${id}: ${result.reason || result.code || result.message}`);
    inspect(); return result;
  }
  const step = () => act('simulation.step', { ticks: 1 });
  const homeIdle = () => { const a = t(10, 10).airlock, home = roomAt(s.sites.surface, 8, 10); return a?.phase === 'idle' && !a.party && !a.queue.length && !a.reason && s.crew.every(c => c.site === 'surface' && roomAt(s.sites.surface, c.x, c.y) === home); };
  try {
    s = synthetic(false, true); initialTick = s.tick; input = serialize(s);
    await freeze(`${label}-input`, input);
    assert.equal(s.tick, 0); assert.equal(t(10, 16).building, 'gasTank'); assert.equal(t(10, 16).machine.enabled, false);
    assert.deepEqual(t(10, 16).machine.input, {}); assert.deepEqual(gasNode(t(10, 16)).gas, { oxygen: 0, inert: 0, co2: 0 });
    baseline = { gas: physicalBalances(s).gas, species: speciesBalance() };
    startRecording(s, { maxRecords: 20000, maxBytes: 128_000_000 }); recording = true;
    inspect(); stage = 'commission';
    commission = commissionPaidAirlock(s, { record: false });
    attempts = commission.summary.attempts; commands = commission.summary.commands; gasTicks = commission.summary.gasTicks;
    actions.push(...commission.actions);
    if (!commission.summary.ok) stop('commissioning_failed', JSON.stringify(commission.summary.failure));
    inspect(); originalModes = modes();
    stage = 'tank_enable';
    act('airlock.unbind', { site: 'surface', x: 10, y: 10 });
    act('production.enable', { site: 'surface', x: 10, y: 16, enabled: true });
    act('airlock.configure', config);
    for (const c of s.crew.filter(c => c.id !== 'crew-1')) act('crew.routine', { crew: c.id, policy: 'rest' });
    act('production.enable', { site: 'surface', x: 7, y: 9, enabled: false });
    act('production.enable', { site: 'surface', x: 7, y: 7, enabled: false });
    if (!actor().labors.hauling) act('crew.labor', { crew: actor().id, labor: 'hauling', enabled: true });
    act('crew.routine', { crew: actor().id, policy: 'work' });
    stage = 'tank_delivery';
    while (!(sawPickup && !actor().carry && (t(8, 10).stock.air || 0) === 0 && (t(10, 16).machine.input.air || 0) + Object.values(s.sites.surface.gasNetwork.loaded).reduce((n, value) => n + value, 0) >= 4 - 1e-7)) step();
    operations.push({ kind: 'finite-air-delivered', tick: s.tick, stockAir: t(8, 10).stock.air || 0, tankInput: t(10, 16).machine.input.air || 0 });
    act('crew.routine', { crew: actor().id, policy: 'rest' });
    stage = 'supply_return';
    while (!homeIdle() || Object.values(s.sites.surface.gasNetwork.loaded).reduce((n, value) => n + value, 0) < 4 - 1e-7) step();
    assert.equal(t(10, 16).machine.input.air || 0, 0);
    act('crew.routine', { crew: actor().id, policy: 'balanced' });
    for (round = 1; round <= 2; round++) {
      const proof = { round, startTick: s.tick };
      stage = 'load'; proof.loadJob = act('freight.load', { items: { alloy: 1 } }).job;
      while (s.jobs.some(job => job.id === proof.loadJob)) step();
      assert.equal(s.shuttle.freight.alloy, 1);
      stage = 'unload'; proof.unloadJob = act('freight.unload', { site: 'surface', items: { alloy: 1 } }).job;
      while (s.jobs.some(job => job.id === proof.unloadJob)) step();
      stage = 'return';
      while (!(t(8, 10).stock.alloy === 1 && !s.crew.some(c => c.carry?.alloy) && homeIdle())) step();
      proof.endTick = s.tick; rounds.push(proof);
    }
    stage = 'restore';
    act('airlock.unbind', { site: 'surface', x: 10, y: 10 });
    act('production.enable', { site: 'surface', x: 10, y: 16, enabled: false });
    act('airlock.configure', config);
    for (const original of originalModes.crew) {
      const c = s.crew.find(c => c.id === original.id);
      if (c.life.policy !== original.routine) act('crew.routine', { crew: c.id, policy: original.routine });
      for (const [labor, enabled] of Object.entries(original.labors)) if (c.labors[labor] !== enabled) act('crew.labor', { crew: c.id, labor, enabled });
    }
    for (const machine of originalModes.machines) if (t(machine.x, machine.y).machine.enabled !== machine.enabled) act('production.enable', { site: 'surface', x: machine.x, y: machine.y, enabled: machine.enabled });
    inspect();
    const control = t(10, 10), a = control.airlock, home = airlockRoomReading(roomAt(s.sites.surface, 8, 10));
    assert.equal(s.crew.length, 7); assert.ok(homeIdle() && home.breathable && home.thermalSafe);
    assert.equal(control.hp, 100); assert.equal(a.enabled, true); assert.equal(s.jobs.length, 0);
    for (const ref of a.ownedNodes) { const node = t(ref.x, ref.y), owner = (ref.layer === 'pipe' ? node.pipe : node).airlockOwner; assert.equal(owner.binding, a.binding); assert.equal(owner.controller, 'tile:surface:10:10'); }
    for (const point of [a.config.inner, a.config.outer]) { const door = t(point.x,point.y); assert.equal(door.building, 'door'); assert.equal(door.hp, 100); assert.equal(door.doorMode, 'closed'); }
    assert.deepEqual(modes(), originalModes); assert.equal(t(8, 10).stock.alloy, 1); assert.equal(s.shuttle.freight.alloy || 0, 0);
    stage = 'complete';
  } catch (error) { failure = { code: error.code || 'assertion_or_fixture', message: String(error.message).slice(0, 600), tick: s?.tick, stage, round }; }
  if (recording) stopRecording(s);
  const recordingText = recording ? exportRecording(s) : '';
  const rows = recordingText ? recordingText.trim().split('\n').map(JSON.parse) : [];
  const events = rows.filter(row => row.kind === 'event').map(row => row.event);
  if (!failure) try {
    const records = rows.slice(1, -1);
    records.forEach((row, i) => assert.equal(row.sequence, i + 1));
    assert.equal(rows.at(-1).reason, 'stopped'); assert.equal(records.filter(row => row.kind === 'external').length, 0);
    const requested = records.filter(row => row.kind === 'action.requested');
    assert.equal(requested.length, attempts); assert.ok(requested.every(row => row.action.source === 'agent'));
    assert.equal(records.filter(row => row.kind === 'simulation.tick').length, s.tick - initialTick);
    assert.equal(rounds.length, 2); assert.equal(new Set(rounds.flatMap(row => [row.loadJob, row.unloadJob])).size, 4);
    for (const proof of rounds) {
      for (const [job, id] of [[proof.loadJob, 'freight.loaded'], [proof.unloadJob, 'freight.unloaded']]) { const event = events.find(event => event.id === id && event.entity === job); assert.equal(event?.cargo.alloy, 1); assert.equal(event.actor, 'crew-1'); }
      for (const [direction, job] of [['outward', proof.loadJob], ['inward', proof.unloadJob]]) {
        const event = events.find(event => event.id === 'airlock.traversed' && event.crew === 'crew-1' && event.direction === direction && event.tick > proof.startTick && event.tick <= proof.endTick && trace.some(row => row.tick === event.tick && row.round === proof.round && row.crew.some(c => c.id === 'crew-1' && c.carry?.alloy === 1 && (direction === 'inward' || c.job === job))));
        assert.ok(event, `round ${proof.round} native ${direction} traversal carried the round singleton`);
      }
    }
    const loads = events.filter(event => event.id === 'gas.loaded' && event.amount > 0);
    assert.ok(loads.length > 0);
    assert.ok(events.some(event => event.id === 'airlock.traversed' && event.crew === 'crew-1' && event.direction === 'outward' && trace.some(row => row.tick === event.tick && row.stage === 'tank_delivery' && row.crew.some(c => c.id === 'crew-1' && c.carry?.air === 4))), 'native exterior delivery crosses while carrying the finite air');
    assert.ok(loads.every(event => trace.some(row => row.tick === event.tick && row.tank.owner?.binding === event.binding && row.controller?.binding === event.binding)));
    assert.ok(Math.abs(loads.reduce((n, event) => n + event.amount, 0) - 4) < 1e-7);
    assert.equal(events.filter(event => event.id === 'crew.suit.released').length, 0);
    assert.ok(!actions.some(action => action.id === 'production.enable' && action.args.x === 13 && action.args.y === 9 && action.args.enabled));
  } catch (error) { failure = { code: 'proof_invariant', message: String(error.message).slice(0, 600), tick: s.tick, stage, round }; }
  const refs = {};
  for (const [name, text] of Object.entries({ source: await readFile(new URL(import.meta.url), 'utf8'), actions: JSON.stringify(actions), trace: JSON.stringify(trace), endpoint: s ? serialize(s) : '', recording: recordingText, events: JSON.stringify(events) })) refs[name] = await freeze(`${label}-${name}`, text);
  const summary = { label, synthetic: true, ordinaryFeasibilityProved: false, ok: !failure, failure, stage, initialTick, tick: s?.tick, addedTicks: s ? s.tick - initialTick : 0, attempts, commands, gasTicks, limits, rounds, operations, commission: commission?.summary, inputSha256: input ? hash(input) : null, refs };
  await freeze(`${label}-summary`, JSON.stringify(summary, null, 2));
  return summary;
}

test('synthetic bound supply tank supports two complete native cargo rounds with fixed resources', async () => {
  const output = await runRepeatedTankCargo();
  assert.equal(output.ok, true, JSON.stringify(output.failure));
});
