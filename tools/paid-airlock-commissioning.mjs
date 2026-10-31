#!/usr/bin/env node
import { groundAirlockConfig, groundAirlockCells } from '../src/airlock-locations.js';
// Finite commissioning of the existing paid example. No traveler is requested;
// this checkpoint does not establish a passage or sustained habitation.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { tileAt } from '../src/geometry.js';
import { roomAt } from '../src/atmosphere.js';
import { crewPathTo } from '../src/navigation.js';
import { constructionSupplyLocations } from '../src/construction.js';
import { airlockLayout, airlockSideBlock, airlockPayload, airlockNode } from '../src/airlock-access.js';
import { airlockResourceStatus } from '../src/airlocks.js';
import { physicalMaterialOwners, physicalBalances } from './paid-air-recovery.mjs';
import { startRecording, stopRecording, exportRecording, recordingStatus } from '../src/telemetry.js';

export const LIMITS = Object.freeze({ ticks: 47, attempts: 90, commands: 35, gasTicks: 47 });
const CONFIG = Object.freeze({ site: 'surface', x: 10, y: 10, chamber: [10, 13], inner: [10, 12], outer: [12, 14], extractor: [10, 13], pump: [10, 15], reservoir: [10, 16], vent: [11, 13] });
const PRODUCTION = ['crew-0', 'crew-1', 'crew-2', 'crew-4', 'crew-5'];
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const empty = inv => !Object.values(inv || {}).some(n => typeof n === 'number' && n > 0);
class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }

// The helper uses the controller's actual finite targets and admission rules.
const resourceBlock = layout => airlockResourceStatus(layout);

function context(state) {
  const s = state, site = s.sites.surface, t = (x, y) => tileAt(site, x, y), at = p => tileAt(site,p.x,p.y,p.z), controller = t(10, 10);
  const chamber = roomAt(site, ...CONFIG.chamber);
  if (!chamber || controller?.building !== 'airlockController') return { layout: { ok: false, reason: 'layout_changed' } };
  const prospective = { ...controller, airlock: { config: groundAirlockConfig(CONFIG), chamberCells: groundAirlockCells(chamber).sort() } };
  const layout = airlockLayout(site, controller.airlock ? controller : prospective, !!controller.airlock);
  function habitatReturned(layout) {
    const cells = new Set(layout.habitat.cells);
    return s.crew.every(c => c.site === 'surface' && cells.has(`${c.x},${c.y}`)) && [...s.crew, ...s.creatures].filter(c => c.health > 0 && c.site === 'surface').every(c => !['10,13', '11,13', '10,12', '12,14'].includes(`${c.x},${c.y}`));
  }
  function finalPredicate() {
    const controller = t(10, 10), a = controller.airlock, layout = airlockLayout(site, controller);
    if (!layout.ok) return { ok: false, reason: layout.reason };
    const r = resourceBlock(layout), restored = s.crew.every(c => c.life.policy === 'balanced') && t(7, 9).machine.enabled === true, life = t(7, 7);
    const reachable = constructionSupplyLocations(s).filter(v => v.kind === 'stock' && crewPathTo(s, site, v.t, [[v.t.x, v.t.y]]) !== null).reduce((n, v) => n + (v.t.stock.air || 0), 0) + (life.machine.input.air || 0);
    return { ok: !r.blocker && a.phase === 'idle' && !a.party && !a.queue.length && !a.reason && ['inner', 'outer'].every(k => at(a.config[k]).hp === 100 && at(a.config[k]).doorMode === 'closed') && r.chamber.pressure <= 1 + 1e-9 && habitatReturned(layout) && r.habitat.breathable && r.habitat.thermalSafe && controller.powered && life.powered && life.hp === 100 && life.machine.enabled !== false && t(13, 7).charge === 120 && reachable >= 5 && restored && s.jobs.length === 0, r, reachableAir: reachable, bank: t(13, 7).charge, restored, jobs: s.jobs.length, layoutOK: true, ownedNodes: layout.ownedNodes };
  }
  return { site, t, controller, prospective, layout, habitatReturned, finalPredicate };
}

/** Pure, detached observations. No initialization, refresh, command or tick. */
export function commissioningStatus(state) {
  try {
    const c = context(state), { layout } = c;
    if (!layout.ok) return { ok: false, reason: layout.reason, bound: !!c.controller?.airlock, layout: { ok: false, reason: layout.reason } };
    const bound = !!c.controller.airlock, r = resourceBlock(layout), final = bound ? c.finalPredicate() : { ok: false };
    const healthy = state.crew.length === 7 && state.crew.every(actor => actor.site === 'surface' && actor.health === 100 && (actor.medical?.injury || 0) === 0);
    const productionLabors = PRODUCTION.every(id => state.crew.find(actor => actor.id === id)?.labors.production === true);
    const equipmentReady = c.controller.hp === 100 && c.controller.airlock?.enabled === true && c.controller.powered && c.t(7, 7).hp === 100 && c.t(7, 7).powered && c.t(7, 7).machine.enabled === true;
    const fixedBinding = !bound || Object.keys(CONFIG).filter(k => Array.isArray(CONFIG[k])).every(k => JSON.stringify(c.controller.airlock.config[k]) === JSON.stringify(groundAirlockConfig(CONFIG)[k]));
    return clone({ ...final, ok: !!(final.ok && healthy && productionLabors && equipmentReady && fixedBinding), bound, healthy, productionLabors, equipmentReady: !!equipmentReady, fixedBinding,
      habitatReturned: c.habitatReturned(layout), readyToBind: r.chamber.pressure <= 1 + 1e-9 && !r.blocker,
      innerSideBlock: airlockSideBlock(c.site, bound ? c.controller : c.prospective, 'inner'), r,
      layout: { ok: true, reason: null, ownedNodes: layout.ownedNodes, recoveryDirection: layout.recoveryDirection, phaseNodes: Object.fromEntries(Object.entries(layout.phaseNodes).map(([key, nodes]) => [key, nodes.map(n => [n.x, n.y])])) },
      controller: c.controller.airlock || null, farmEnabled: c.t(7, 9).machine.enabled, scrubberEnabled: c.t(7, 7).machine.enabled });
  } catch (error) { return { ok: false, reason: 'invalid_input', message: String(error.message).slice(0, 160) }; }
}

function optionsFor(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['limits', 'record'].includes(k)) || options.record !== undefined && typeof options.record !== 'boolean') throw new TypeError('Expected limits and optional boolean record.');
  const requested = options.limits === undefined ? {} : options.limits;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).some(k => !Object.hasOwn(LIMITS, k))) throw new TypeError('Unknown commissioning limit.');
  const limits = { ...LIMITS, ...requested };
  for (const [key, value] of Object.entries(limits)) if (!Number.isInteger(value) || value < 0 || value > LIMITS[key]) throw new TypeError(`${key} must be an integer from 0 to ${LIMITS[key]}.`);
  return { limits, record: options.record === true };
}

// Configuration and ownership are compared against predicted command effects.
// Physical gas, inventory, movement and derived readings remain observable.
function configuration(state) {
  return clone({ crew: Object.fromEntries(state.crew.map(c => [c.id, { labors: c.labors, policy: c.life.policy }])),
    tiles: Object.fromEntries(Object.values(state.sites).flatMap(site => site.tiles.map(t => [`${site.id}:${t.x}:${t.y}`, {
      terrain: t.terrain, building: t.building, hp: t.hp, fire: t.fire, cable: t.cable, powerPriority: t.powerPriority,
      pipe: t.pipe && { hp: t.pipe.hp, open: t.pipe.open, airlockOwner: t.pipe.airlockOwner }, gasStore: t.gasStore && { open: t.gasStore.open },
      waterPipe: t.waterPipe && { hp: t.waterPipe.hp, open: t.waterPipe.open }, waterDevice: t.waterDevice, gasDevice: t.gasDevice,
      doorMode: t.doorMode, airlockOwner: t.airlockOwner, airlock: t.airlock,
      machine: t.machine && { enabled: t.machine.enabled, order: t.machine.order, completed: t.machine.completed, recipeId: t.machine.recipeId }
    }])))});
}

function predict(expected, state, id, args) {
  const tile = (x, y) => expected.tiles[`surface:${x}:${y}`], q = args.x === undefined ? null : tile(args.x, args.y);
  if (id === 'production.enable') q.machine.enabled = args.enabled;
  else if (id === 'door.mode') q.doorMode = args.mode;
  else if (id === 'gas.valve') (q.pipe || q.gasStore).open = args.open;
  else if (id === 'gas.extractor') q.gasDevice = { enabled: args.enabled, mode: args.mode, target: args.target };
  else if (id === 'gas.device') q.gasDevice = q.building === 'gasPump' ? { enabled: args.enabled, direction: args.direction } : { enabled: args.enabled, target: args.target };
  else if (id === 'crew.labor') expected.crew[args.crew].labors[args.labor] = args.enabled;
  else if (id === 'crew.routine') expected.crew[args.crew].policy = args.policy;
  else if (id === 'airlock.configure') {
    const c = context(state), binding = `airlock-${state.nextId}`, config = groundAirlockConfig(CONFIG);
    q.airlock = { binding, config, chamberCells: groundAirlockCells(c.layout.room).sort(), ownedNodes: c.layout.ownedNodes, enabled: true, phase: 'idle', direction: null, party: null, queue: [], nextCycle: 1, cycle: null, resumePhase: null, recoverySide: null, reason: null };
    for (const ref of c.layout.ownedNodes) {
      const n = tile(ref.x, ref.y), holder = ref.layer === 'pipe' ? n.pipe : n;
      holder.airlockOwner = { controller: 'tile:surface:10:10', binding };
      if (n.pipe || n.gasStore) (n.pipe || n.gasStore).open = false;
      if (n.gasDevice) n.gasDevice.enabled = false;
    }
    tile(...CONFIG.inner).doorMode = 'closed'; tile(...CONFIG.outer).doorMode = 'closed';
  }
}

function needed(state, id, a) {
  const t = a.x === undefined ? null : tileAt(state.sites.surface, a.x, a.y);
  if (id === 'production.enable') return t.machine.enabled !== a.enabled;
  if (id === 'door.mode') return t.doorMode !== a.mode || t.doorUntil !== 0;
  if (id === 'gas.valve') return airlockNode(t).open !== a.open;
  if (id === 'gas.extractor') return JSON.stringify(t.gasDevice) !== JSON.stringify({ enabled: a.enabled, mode: a.mode, target: a.target });
  if (id === 'gas.device') return JSON.stringify(t.gasDevice) !== JSON.stringify(t.building === 'gasPump' ? { enabled: a.enabled, direction: a.direction } : { enabled: a.enabled, target: a.target });
  if (id === 'crew.labor') return state.crew.find(c => c.id === a.crew)?.labors[a.labor] !== a.enabled;
  if (id === 'crew.routine') return state.crew.find(c => c.id === a.crew)?.life.policy !== a.policy;
  return true;
}

/** Shared commands only; failed endpoints retain every current flag and policy. */
export function commissionPaidAirlock(state, options = {}) {
  const { limits, record } = optionsFor(options), actions = [];
  let attempts = 0, commands = 0, gasTicks = 0, failure = null, stage = 'preflight', initialTick = state?.tick, inputSha256 = null, expected = null, baseline = null, latest = null, balance = null, recording = false;
  function inspect() {
    latest = commissioningStatus(state);
    if (!latest.layout?.ok) throw new Stop('layout_changed', latest.reason || 'The physical layout changed.');
    if (!latest.healthy) throw new Stop('crew_harmed', 'A surface crew member died, lost health or gained an injury.');
    if (state.jobs.length || state.crew.some(actor => actor.carry && !empty(actor.carry))) throw new Stop('unexpected_work', 'Unexpected jobs or carried material appeared.');
    if (!isDeepStrictEqual(configuration(state), expected)) throw new Stop('configuration_changed', 'Unrelated equipment, ownership, labor or routine changed.');
    if (!latest.layout?.ok || !latest.fixedBinding) throw new Stop('layout_changed', latest.reason || 'The physical layout or binding changed.');
    if (!latest.habitatReturned) throw new Stop('occupant_changed', 'Crew left the habitat or a living local occupant entered the chamber or doors.');
    balance = physicalBalances(state);
    if (Math.abs(balance.gas - baseline.gas) > 1e-7 || !Number.isFinite(balance.gas) || Object.values(balance.energy).some(error => !Number.isFinite(error) || Math.abs(error) > 1e-7)) throw new Stop('conservation_mismatch', 'Whole gas or stored/spent energy no longer balances.');
    const text = serialize(state);
    if (serialize(deserialize(text)) !== text) throw new Stop('invalid_state', 'The stopped state is not canonical.');
    if (recording && !recordingStatus(state).active) throw new Stop('recording_limit', 'The complete local recording budget was exhausted.');
    return latest;
  }
  function act(id, args) {
    if (attempts >= limits.attempts) throw new Stop('attempt_limit', 'The shared-action attempt budget was reached.');
    if (id !== 'simulation.step' && commands >= limits.commands) throw new Stop('command_limit', 'The non-step command budget was reached.');
    if (id === 'simulation.step') {
      if (state.tick - initialTick >= limits.ticks) throw new Stop('tick_limit', 'The added-tick budget was reached.');
      if (gasTicks >= limits.gasTicks) throw new Stop('gas_tick_limit', 'The active-gas tick budget was reached.');
    }
    attempts++; if (id !== 'simulation.step') commands++; else gasTicks++;
    predict(expected, state, id, args);
    const entry = { tick: state.tick, id, args, ok: false, code: 'exception' }; actions.push(entry);
    const result = executeAction(state, id, args, 'agent');
    Object.assign(entry, { tick: state.tick, ok: result.ok, code: result.code });
    if (!result.ok) throw new Stop('action_rejected', `${id}: ${result.message || result.code}`);
    return inspect();
  }
  const command = (id, args) => { if (needed(state, id, args)) return act(id, args); return latest; };
  const xy = ([x, y]) => ({ site: 'surface', x, y });
  try {
    if (!state?.sites?.surface || !Number.isSafeInteger(initialTick)) throw new Stop('invalid_input', 'Expected an existing canonical colony state.');
    const text = serialize(state);
    try { if (serialize(deserialize(text)) !== text) throw new Error('Noncanonical state.'); } catch (error) { throw new Stop('invalid_input', error.message); }
    inputSha256 = hash(text); expected = configuration(state); baseline = physicalBalances(state);
    if (record) { startRecording(state, { maxRecords: 12000, maxBytes: 128_000_000 }); recording = true; }
    inspect();
    if (!latest.ok) {
      const c = context(state);
      if (latest.bound || latest.innerSideBlock || c.layout.ownedNodes.some(ref => { const t = c.t(ref.x, ref.y); return airlockNode(t) && airlockPayload(t) !== 0; }) || state.jobs.length || state.crew.some(actor => actor.carry && !empty(actor.carry)) || c.site.tiles.some(t => t.machine && t.building !== 'scrubber' && t.machine.enabled)) throw new Stop('input_mismatch', 'Begin with an unbound, clear, pressure-matched layout, empty gas stores and paused industry without jobs or cargo.');
      stage = 'isolate';
      command('production.enable', { ...xy([7, 7]), enabled: false });
      for (const p of [CONFIG.inner, CONFIG.outer]) command('door.mode', { ...xy(p), mode: 'closed' });
      command('gas.valve', { ...xy(CONFIG.vent), open: false });
      for (const p of [CONFIG.extractor, [10, 14], CONFIG.reservoir]) command('gas.valve', { ...xy(p), open: true });
      command('gas.extractor', { ...xy(CONFIG.extractor), enabled: true, mode: 'exhaust', target: 0 });
      command('gas.device', { ...xy(CONFIG.pump), enabled: true, direction: 's', target: 100 });
      stage = 'capture_and_drain';
      while (!latest.readyToBind) act('simulation.step', { ticks: 1 });
      stage = 'stop_and_bind';
      command('gas.extractor', { ...xy(CONFIG.extractor), enabled: false, mode: 'exhaust', target: 0 });
      command('gas.device', { ...xy(CONFIG.pump), enabled: false, direction: 's', target: 100 });
      for (const p of [CONFIG.extractor, [10, 14], CONFIG.reservoir, CONFIG.vent]) command('gas.valve', { ...xy(p), open: false });
      command('airlock.configure', clone(CONFIG));
      stage = 'restore';
      for (const crew of PRODUCTION) command('crew.labor', { crew, labor: 'production', enabled: true });
      for (const actor of state.crew) command('crew.routine', { crew: actor.id, policy: 'balanced' });
      command('production.enable', { ...xy([7, 9]), enabled: true });
      command('production.enable', { ...xy([7, 7]), enabled: true });
      if (!inspect().ok) throw new Stop('checkpoint_not_reached', 'The restored endpoint does not satisfy the exact final predicates.');
    }
    stage = 'commissioned';
  } catch (error) { failure = { code: error.code || 'commissioning_error', message: String(error.message).slice(0, 240) }; }
  if (expected) { latest = commissioningStatus(state); try { balance = physicalBalances(state); } catch { /* Preserve the original failure and exact endpoint. */ } }
  if (recording) stopRecording(state);
  const summary = { ok: failure === null, goal: 'finite airlock commissioning only', travelerEstablished: false, safeHabitationEstablished: false, initialTick, tick: state?.tick, addedTicks: state?.tick - initialTick, attempts, commands, gasTicks, limits, stage, status: latest,
    balances: balance && { gasError: balance.gas - baseline.gas, energyErrors: balance.energy, owners: physicalMaterialOwners(state) }, inputSha256, actionSha256: hash(JSON.stringify(actions)), actionTickConvention: 'post-command', ...(failure ? { failure } : {}) };
  return { state, summary, actions, ...(recording ? { recording: exportRecording(state) } : {}) };
}

export function parseArguments(args) {
  const parsed = {}, limits = {}, names = { '--input': 'input', '--save': 'save', '--record': 'record' };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!value || value.startsWith('--')) throw new TypeError('Usage: --input PATH [--save PATH] [--record PATH] [--ticks N] [--attempts N] [--commands N] [--gasTicks N]');
    if (names[flag] && parsed[names[flag]] === undefined) parsed[names[flag]] = value;
    else if (flag.startsWith('--') && Object.hasOwn(LIMITS, flag.slice(2)) && limits[flag.slice(2)] === undefined && /^\d+$/.test(value)) limits[flag.slice(2)] = Number(value);
    else throw new TypeError('Unknown, repeated or invalid commissioning argument.');
  }
  if (!parsed.input) throw new TypeError('--input PATH is required.');
  const paths = [parsed.input, parsed.save, parsed.record].filter(Boolean).map(p => resolve(p));
  if (new Set(paths).size !== paths.length) throw new TypeError('Input, save and recording paths must be distinct.');
  optionsFor({ limits }); return { ...parsed, limits };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { input, save, record, limits } = parseArguments(args), text = await readFile(input, 'utf8'), state = deserialize(text);
    if (serialize(state) !== text) throw new TypeError('Input must be an exact canonical save.');
    const output = commissionPaidAirlock(state, { limits, record: !!record });
    if (save) await writeFile(save, serialize(state), 'utf8');
    if (record) await writeFile(record, output.recording || '', 'utf8');
    console.log(JSON.stringify({ ...output.summary, ...(save ? { saved: true } : {}), ...(record ? { recorded: true } : {}) }));
    return output.summary.ok ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ ok: false, failure: { code: 'cli_error', message: String(error.message).slice(0, 240) } })); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
