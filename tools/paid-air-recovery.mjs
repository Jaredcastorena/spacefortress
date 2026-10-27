#!/usr/bin/env node
// Offline recovery of an existing, paid atmosphere processor. This milestone
// does not commission an airlock or establish sustained habitation.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { RECIPES } from '../src/data.js';
import { neighbors, tileAt } from '../src/geometry.js';
import { roomAt, gasAmount, SUIT_PER_POINT } from '../src/atmosphere.js';
import { airlockRoomReading } from '../src/airlock-access.js';
import { gasNode } from '../src/gas-networks.js';
import { waterNode } from '../src/plumbing.js';
import { crewPathTo } from '../src/navigation.js';
import { availableInventory } from '../src/inventory-reservations.js';
import { startRecording, stopRecording, exportRecording, recordingStatus } from '../src/telemetry.js';

export const LIMITS = Object.freeze({ ticks: 180, attempts: 230, commands: 35, batches: 6 });
const DEFAULTS = Object.freeze({ processor: [13, 9], habitat: [10, 11], chamber: [10, 13], bank: [13, 7] });
const amount = (inv, resource) => inv?.[resource] || 0;
const empty = inv => !Object.values(inv || {}).some(n => typeof n === 'number' && n > 0);
const hash = text => createHash('sha256').update(text).digest('hex');
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-7;
class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }

function configuration(options) {
  const keys = [...Object.keys(DEFAULTS), 'limits', 'record'];
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !keys.includes(k))) throw new TypeError('Expected geometry, limits and optional boolean record options.');
  if (options.record !== undefined && typeof options.record !== 'boolean') throw new TypeError('record must be boolean.');
  const geometry = {};
  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    const value = options[name] === undefined ? fallback : options[name];
    if (!Array.isArray(value) || value.length !== 2 || !value.every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) throw new TypeError(`${name} must contain two nonnegative integer coordinates.`);
    geometry[name] = [...value];
  }
  const requested = options.limits === undefined ? {} : options.limits;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).some(k => !Object.hasOwn(LIMITS, k))) throw new TypeError('Unknown recovery limit.');
  const limits = { ...LIMITS, ...requested };
  for (const [key, value] of Object.entries(limits)) if (!Number.isInteger(value) || value < 0 || value > LIMITS[key]) throw new TypeError(`${key} must be an integer from 0 to ${LIMITS[key]}.`);
  return { ...geometry, limits, record: options.record === true };
}

// Physical material owners, without projected stock or promised recipe output.
function located(state) {
  const rows = [];
  const add = (owner, inventory) => {
    const air = amount(inventory, 'air'), water = amount(inventory, 'water');
    if (air || water) rows.push({ owner, air, water });
  };
  for (const site of Object.values(state.sites)) for (const t of site.tiles) {
    const owner = `tile:${site.id}:${t.x}:${t.y}`;
    for (const slot of ['stock', 'drop', 'imports']) add(`${owner}/${slot}`, t[slot]);
    for (const slot of ['input', 'output', 'batch']) add(`${owner}/machine.${slot}`, t.machine?.[slot]);
    add(`${owner}/sanitary.output`, t.sanitary?.output);
    add(`${owner}/liquid`, { water: t.liquid || 0 });
    add(`${owner}/water.node`, { water: waterNode(t)?.water || 0 });
    for (const [species, patch] of Object.entries(t.flora || {})) if (patch.origin === 'cultivated') add(`${owner}/flora.${species}`, { water: patch.moisture });
  }
  for (const c of state.crew) { add(`${c.id}/carry`, c.carry); add(`${c.id}/possessions`, c.possessions?.inventory); }
  for (const j of state.jobs) {
    add(`${j.id}/materials`, j.materials);
    j.sources.forEach((source, i) => add(`${j.id}/sources.${i}`, source.items));
  }
  add('mission/cargo', state.mission?.cargo);
  add('shuttle/supplies', state.shuttle?.supplies); add('shuttle/freight', state.shuttle?.freight);
  return rows;
}

function balances(state) {
  const owners = located(state);
  let gas = owners.reduce((n, row) => n + row.air, 0);
  const energy = {};
  for (const site of Object.values(state.sites)) {
    gas += site.rooms.reduce((n, room) => n + gasAmount(room.gas), 0);
    gas += site.tiles.reduce((n, tile) => n + (gasNode(tile) ? gasAmount(gasNode(tile).gas) : 0), 0);
    gas += gasAmount(site.atmosphere.vented) + gasAmount(site.gasNetwork.vented);
    const e = site.energy, stored = site.tiles.reduce((n, t) => n + (t.building === 'battery' ? t.charge : 0), 0);
    energy[site.id] = stored + e.consumed + e.curtailed + e.discarded - e.initial - e.generated - e.injected;
  }
  gas += state.crew.reduce((n, c) => n + c.oxygen * SUIT_PER_POINT, 0);
  return { gas, energy, owners };
}

function equipment(state, processor) {
  return hash(JSON.stringify(Object.values(state.sites).map(site => ({ id: site.id, tiles: site.tiles.map(t => ({
    x: t.x, y: t.y, terrain: t.terrain, building: t.building, hp: t.hp, cable: t.cable,
    pipe: t.pipe && { hp: t.pipe.hp, open: t.pipe.open }, waterPipe: t.waterPipe && { hp: t.waterPipe.hp, open: t.waterPipe.open },
    gasDevice: t.gasDevice, waterDevice: t.waterDevice, doorMode: t.doorMode, airlock: t.airlock,
    machine: t.machine && { enabled: t === processor ? undefined : t.machine.enabled, order: t === processor ? undefined : t.machine.order, completed: t === processor ? undefined : t.machine.completed, recipeId: t.machine.recipeId }
  })) }))));
}

function checkpoint(state, config, processor) {
  const site = state.sites.surface, habitat = roomAt(site, ...config.habitat), chamber = roomAt(site, ...config.chamber);
  const home = c => c.site === site.id && habitat?.cells.includes(`${c.x},${c.y}`) && tileAt(site, c.x, c.y)?.building !== 'door';
  const healthy = state.crew.length === 7 && state.crew.every(c => c.site === site.id && c.health === 100 && (c.medical?.injury || 0) === 0);
  const homeCrew = state.crew.filter(home);
  const reachable = t => homeCrew.some(c => crewPathTo(state, site, c, [[t.x, t.y]]) !== null);
  let reachableAir = 0;
  for (const t of site.tiles) if (['stockpile', 'scrubber'].includes(t.building) && reachable(t)) {
    if (t.building === 'stockpile') reachableAir += availableInventory(state, site.id, [t.x, t.y], 'stock', 'air');
    if (t.building === 'scrubber') reachableAir += amount(t.machine?.input, 'air');
  }
  const reading = room => { const r = airlockRoomReading(room); return r && { breathable: r.breathable, thermalSafe: r.thermalSafe, pressure: r.pressure }; };
  const habitatReading = reading(habitat), chamberReading = reading(chamber);
  const paused = processor?.machine?.enabled === false && empty(processor.machine.batch) && !state.jobs.some(j => j.site === site.id && j.kind === 'operate' && j.x === processor.x && j.y === processor.y);
  const bank = tileAt(site, ...config.bank)?.charge;
  const clearanceCells = new Set(chamber?.cells || []);
  for (const cell of chamber?.cells || []) for (const [x, y] of neighbors(...cell.split(',').map(Number))) {
    if (tileAt(site, x, y)?.building === 'door') clearanceCells.add(`${x},${y}`);
  }
  const clear = ![...state.crew, ...state.creatures].some(actor => actor.site === site.id && actor.health > 0 && clearanceCells.has(`${actor.x},${actor.y}`));
  const sufficient = healthy && habitatReading?.breathable && habitatReading.thermalSafe && chamberReading?.breathable && chamberReading.thermalSafe && reachableAir >= 5 && bank === 120 && paused;
  return { ok: !!(sufficient && homeCrew.length === 7 && clear), sufficient: !!sufficient, healthy, home: homeCrew.length, clear, reachableAir, bank, paused, habitat: habitatReading, chamber: chamberReading };
}

/** Mutates only the supplied state through shared agent commands and full ticks.
 * Geometry defaults to the existing paid example; limits may only be lowered.
 * Returns { state, summary, actions, recording? }. Failure preserves the first
 * stopped state, including temporary policies; success restores those policies.
 */
export function recoverPaidAir(state, options = {}) {
  const config = configuration(options), actions = [], policies = new Map();
  let failure = null, attempts = 0, commands = 0, completed = 0, started = 0, stage = 'preflight';
  let initialTick = state?.tick, initialHash = null, initialGas = 0, initialCompleted = 0, source = null, labors = null, processor = null;
  let previousCarry = new Map(), previousInput = 0, previousCompleted = 0;
  const work = { waterDeliveredToProcessor: 0, observedAirCarryPickups: 0, observedAirCarryDeliveries: 0 };
  let finalCheckpoint = null, finalBalances = null, recordingStarted = false;
  function inspect() {
    if (state.crew.length !== 7 || state.crew.some(c => c.site !== 'surface' || c.health !== 100 || (c.medical?.injury || 0) !== 0)) throw new Stop('crew_harmed', 'A surface crew member died, lost health or gained an injury.');
    if (equipment(state, processor) !== source || JSON.stringify(state.crew.map(c => [c.id, c.labors])) !== labors) throw new Stop('equipment_changed', 'Unrelated geometry, equipment or labor settings changed.');
    const m = processor.machine, batch = !empty(m.batch);
    completed = m.completed - initialCompleted;
    if (!Number.isInteger(completed) || completed < previousCompleted || completed > config.limits.batches || (batch && (m.batch.water !== 1 || Object.keys(m.batch).some(k => k !== 'water')))) throw new Stop('recipe_mismatch', 'The finite water-to-air batch no longer matches its recipe.');
    started = completed + Number(batch);
    if (started > config.limits.batches || completed - previousCompleted > 1) throw new Stop('batch_limit', 'The new air-batch budget was exceeded.');
    const supplied = amount(m.input, 'water') + Number(batch) + completed;
    work.waterDeliveredToProcessor += Math.max(0, supplied - previousInput);
    previousInput = supplied; previousCompleted = completed;
    for (const c of state.crew) {
      const before = previousCarry.get(c.id) || 0, now = amount(c.carry, 'air');
      work.observedAirCarryPickups += Math.max(0, now - before);
      work.observedAirCarryDeliveries += Math.max(0, before - now);
      previousCarry.set(c.id, now);
    }
    finalBalances = balances(state);
    if (!near(finalBalances.gas, initialGas + completed * 10) || Object.values(finalBalances.energy).some(error => !near(error, 0))) throw new Stop('conservation_mismatch', 'Whole gas or stored/spent energy no longer balances.');
    if (recordingStarted && !recordingStatus(state).active) throw new Stop('recording_limit', 'The complete local recording budget was exhausted.');
    finalCheckpoint = checkpoint(state, config, processor);
    return finalCheckpoint;
  }
  function act(id, args) {
    if (id === 'simulation.step' && state.tick - initialTick >= config.limits.ticks) throw new Stop('tick_limit', 'The added-tick budget was reached.');
    if (attempts >= config.limits.attempts) throw new Stop('attempt_limit', 'The shared-action attempt budget was reached.');
    if (id !== 'simulation.step' && commands >= config.limits.commands) throw new Stop('command_limit', 'The non-step command budget was reached.');
    attempts++; if (id !== 'simulation.step') commands++;
    const action = { tick: state.tick, id, args, ok: false, code: 'exception' };
    actions.push(action);
    const result = executeAction(state, id, args, 'agent');
    Object.assign(action, { tick: state.tick, ok: result.ok, code: result.code });
    if (!result.ok) throw new Stop('action_rejected', `${id}: ${result.message || result.code}`);
    return inspect();
  }
  function policy(c, value) {
    if (c.life.policy === value) return;
    if (!policies.has(c.id)) policies.set(c.id, c.life.policy);
    act('crew.routine', { crew: c.id, policy: value });
  }
  try {
    if (!state?.sites?.surface || !Number.isSafeInteger(initialTick)) throw new Stop('invalid_input', 'Expected a canonical colony state with a surface site.');
    const text = serialize(state);
    let canonical;
    try { canonical = serialize(deserialize(text)); } catch (error) { throw new Stop('invalid_input', `Invalid colony save: ${error.message}`); }
    if (canonical !== text) throw new Stop('invalid_input', 'Input is not a canonical current colony save.');
    initialHash = hash(text);
    const site = state.sites.surface;
    processor = tileAt(site, ...config.processor);
    if (processor?.building !== 'atmosphere' || !processor.machine || !roomAt(site, ...config.habitat) || !roomAt(site, ...config.chamber) || tileAt(site, ...config.bank)?.building !== 'battery') throw new Stop('invalid_input', 'Existing processor, habitat, chamber and battery are required.');
    if (JSON.stringify(RECIPES.atmosphere) !== JSON.stringify({ input: { water: 1 }, output: { air: 10 }, duration: 25 })) throw new Stop('source_mismatch', 'Review the changed atmosphere recipe.');
    if (processor.machine.enabled || !empty(processor.machine.batch) || state.jobs.some(j => j.kind === 'operate' && j.site === site.id && j.x === processor.x && j.y === processor.y)) throw new Stop('invalid_input', 'Begin with the existing processor paused and its committed batch empty.');
    initialCompleted = processor.machine.completed;
    initialGas = balances(state).gas; source = equipment(state, processor); labors = JSON.stringify(state.crew.map(c => [c.id, c.labors]));
    previousInput = amount(processor.machine.input, 'water');
    previousCarry = new Map(state.crew.map(c => [c.id, amount(c.carry, 'air')]));
    if (config.record) { startRecording(state, { maxRecords: 12000, maxBytes: 128_000_000 }); recordingStarted = true; }
    inspect();
    while (!finalCheckpoint.ok) {
      const m = processor.machine;
      if (empty(m.batch) && m.order.remaining === 0 && m.enabled) act('production.enable', { site: 'surface', x: processor.x, y: processor.y, enabled: false });
      if (finalCheckpoint.ok) break;
      const pendingAir = amount(m.output, 'air') + state.crew.reduce((n, c) => n + amount(c.carry, 'air'), 0);
      if (!m.enabled && empty(m.batch) && pendingAir === 0) {
        if (finalCheckpoint.sufficient) {
          stage = 'return';
          for (const c of state.crew) if (!roomAt(site, ...config.habitat).cells.includes(`${c.x},${c.y}`)) policy(c, 'rest');
        } else {
          if (completed >= config.limits.batches) throw new Stop('batch_limit', 'Delivered air did not reach the recovery checkpoint within the new-batch budget.');
          stage = 'production';
          for (const c of state.crew) if (c.site === site.id && c.health === 100 && (c.labors.hauling || c.labors.production && c.skills.production.level >= (RECIPES.atmosphere.minSkill || 0))) policy(c, 'work');
          act('production.order', { site: 'surface', x: processor.x, y: processor.y, mode: 'batches', limit: 1 });
          act('production.enable', { site: 'surface', x: processor.x, y: processor.y, enabled: true });
        }
      } else if (!m.enabled) stage = 'delivery';
      if (finalCheckpoint.ok) break;
      act('simulation.step', { ticks: 1 });
    }
    stage = 'restore';
    for (const [id, value] of policies) policy(state.crew.find(c => c.id === id), value);
    if (!inspect().ok) throw new Stop('checkpoint_lost', 'The checkpoint changed while restoring temporary routines.');
    stage = 'recovered';
  } catch (error) { failure = { code: error.code || 'recovery_error', message: String(error.message).slice(0, 240) }; }
  // Read the stopped endpoint even when an early invariant check failed.
  if (processor) {
    try { finalBalances = balances(state); finalCheckpoint = checkpoint(state, config, processor); } catch { /* Preserve the original failure and exact state. */ }
  }
  if (recordingStarted) stopRecording(state);
  const summary = { ok: failure === null, goal: 'paid air recovery only', commissioned: false, safeHabitationEstablished: false,
    initialTick, tick: state?.tick, addedTicks: state?.tick - initialTick, attempts, commands, limits: config.limits, stage,
    recipes: { started, completed, waterConsumed: completed, airProduced: completed * 10 }, work,
    checkpoint: finalCheckpoint, policies: [...policies].map(([crew, original]) => ({ crew, original, current: state.crew.find(c => c.id === crew)?.life.policy })),
    balances: finalBalances && { gasError: finalBalances.gas - initialGas - completed * 10, energyErrors: finalBalances.energy, owners: finalBalances.owners },
    inputSha256: initialHash, actionSha256: hash(JSON.stringify(actions)), ...(failure ? { failure } : {}) };
  return { state, summary, actions, ...(recordingStarted ? { recording: exportRecording(state) } : {}) };
}

export function parseArguments(args) {
  const parsed = {}, limits = {}, names = { '--input': 'input', '--save': 'save', '--record': 'record' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!value || value.startsWith('--')) throw new TypeError('Usage: --input PATH [--save PATH] [--record PATH] [--ticks N] [--attempts N] [--commands N] [--batches N]');
    if (names[flag] && parsed[names[flag]] === undefined) parsed[names[flag]] = value;
    else if (flag.startsWith('--') && Object.hasOwn(LIMITS, flag.slice(2)) && limits[flag.slice(2)] === undefined && /^\d+$/.test(value)) limits[flag.slice(2)] = Number(value);
    else throw new TypeError('Unknown, repeated or invalid recovery argument.');
  }
  if (!parsed.input) throw new TypeError('--input PATH is required.');
  const paths = [parsed.input, parsed.save, parsed.record].filter(Boolean).map(p => resolve(p));
  if (new Set(paths).size !== paths.length) throw new TypeError('Input, save and recording paths must be distinct.');
  configuration({ limits });
  return { ...parsed, limits };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { input, save, record, limits } = parseArguments(args), text = await readFile(input, 'utf8'), state = deserialize(text);
    if (serialize(state) !== text) throw new TypeError('Input must be an exact canonical save.');
    const output = recoverPaidAir(state, { limits, record: !!record });
    if (save) await writeFile(save, serialize(state), 'utf8');
    if (record) await writeFile(record, output.recording || '', 'utf8');
    console.log(JSON.stringify({ ...output.summary, ...(save ? { saved: true } : {}), ...(record ? { recorded: true } : {}) }));
    return output.summary.ok ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ ok: false, failure: { code: 'cli_error', message: String(error.message).slice(0, 240) } })); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

export { located as physicalMaterialOwners, balances as physicalBalances };
