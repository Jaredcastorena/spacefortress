#!/usr/bin/env node
// One finite native atmosphere batch and its physical delivery.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { RECIPES } from '../src/data.js';
import { tileAt } from '../src/geometry.js';
import { tileAt as shipmentTile, sameCell } from '../src/spatial.js';
import { roomAt, SUIT_PER_POINT } from '../src/atmosphere.js';
import { temperature } from '../src/thermal.js';
import { gasNode } from '../src/gas-networks.js';
import { airThreshold } from '../src/crew.js';
import { acceptsResource } from '../src/storage.js';
import { airlockLayout, airlockRoomReading } from '../src/airlock-access.js';
import { physicalBalances, physicalMaterialOwners } from './paid-air-recovery.mjs';
import { startRecording, stopRecording, exportRecording, recordingStatus } from '../src/telemetry.js';

export const LIMITS = Object.freeze({ ticks: 180, commands: 35, attempts: 230 });
const DEFAULTS = Object.freeze({ processor: [13, 9], delivery: [8, 10], habitat: [10, 11], chamber: [10, 13], bank: [13, 7] });
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const amount = (inv, resource) => inv?.[resource] || 0;
const empty = inv => !Object.values(inv || {}).some(n => typeof n === 'number' && n > 0);
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-7;
class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }

function configuration(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => ![...Object.keys(DEFAULTS), 'limits'].includes(k))) throw new TypeError('Expected geometry and optional lowered limits.');
  const config = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = options[key] ?? fallback;
    if (!Array.isArray(value) || value.length !== 2 || !value.every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) throw new TypeError(`${key} must be two nonnegative integer coordinates.`);
    config[key] = [...value];
  }
  const limits = options.limits === undefined ? {} : options.limits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits) || Object.keys(limits).some(k => !Object.hasOwn(LIMITS, k))) throw new TypeError('Unknown batch limit.');
  config.limits = { ...LIMITS, ...limits };
  for (const [key, value] of Object.entries(config.limits)) if (!Number.isInteger(value) || value < 0 || value > LIMITS[key]) throw new TypeError(`${key} must be an integer from 0 to ${LIMITS[key]}.`);
  return config;
}

function sourceFingerprint() {
  const root = new URL('../', import.meta.url);
  const names = readdirSync(new URL('src/', root)).filter(n => n.endsWith('.js')).map(n => `src/${n}`).sort();
  names.push('tools/paid-air-recovery.mjs', 'tools/paid-air-batch.mjs');
  return hash(names.map(name => `${name}\0${hash(readFileSync(new URL(name, root)))}`).join('\n'));
}

function assembly(state, processor) {
  return hash(JSON.stringify({ crew: state.crew.map(c => [c.id, c.labors]), sites: Object.values(state.sites).map(site => ({ id: site.id, tiles: site.tiles.map(t => ({
    x: t.x, y: t.y, terrain: t.terrain, building: t.building, hp: t.hp, cable: t.cable, powerPriority: t.powerPriority,
    pipe: t.pipe && { hp: t.pipe.hp, open: t.pipe.open, airlockOwner: t.pipe.airlockOwner },
    gasStore: t.gasStore && { open: t.gasStore.open }, waterPipe: t.waterPipe && { hp: t.waterPipe.hp, open: t.waterPipe.open },
    waterDevice: t.waterDevice, gasDevice: t.gasDevice, doorMode: t.doorMode, airlockOwner: t.airlockOwner, airlock: t.airlock,
    machine: t.machine && { enabled: t === processor ? undefined : t.machine.enabled, order: t === processor ? undefined : t.machine.order, recipeId: t.machine.recipeId }
  })) })) }));
}

// Breathing and scrubbing exchange oxygen with CO2; their sum and inert gas
// remain separately conserved, including suits, packaged air and vented gas.
function species(state) {
  const result = { oxygen: 0, inert: 0, co2: 0 };
  const add = gas => { for (const key of Object.keys(result)) result[key] += gas?.[key] || 0; };
  const air = physicalMaterialOwners(state).reduce((n, row) => n + row.air, 0);
  add({ oxygen: air * .21, inert: air * .79 });
  for (const site of Object.values(state.sites)) {
    site.rooms.forEach(r => add(r.gas)); site.tiles.forEach(t => add(gasNode(t)?.gas));
    add(site.atmosphere.vented); add(site.gasNetwork.vented);
  }
  add({ oxygen: state.crew.reduce((n, c) => n + c.oxygen * SUIT_PER_POINT, 0) });
  return result;
}

/** Only shared commands and full ticks mutate the supplied canonical state.
 * A failure preserves its first endpoint and any temporary routines/paid work.
 */
export function runPaidAirBatch(state, options = {}) {
  const config = configuration(options), actions = [], transfers = [], policies = new Map(), tagged = new Map();
  let initialTick = state?.tick, inputSha256 = null, sourceSha256 = null, assemblySha256 = null;
  let baseline = null, initialSpecies = null, finalBalances = null, finalSpecies = null, processor = null, controller = null, site = null;
  let initialCompleted = 0, completed = 0, started = 0, pickedUp = 0, delivered = 0, commands = 0, attempts = 0, failure = null, stage = 'preflight', recording = false;
  const home = c => c.site === 'surface' && roomAt(site, ...config.habitat)?.cells.includes(`${c.x},${c.y}`) && tileAt(site, c.x, c.y)?.building !== 'door';
  const checkpoint = () => ({ home: state.crew.filter(home).length, jobs: state.jobs.length, bank: tileAt(site, ...config.bank)?.charge,
    habitat: airlockRoomReading(roomAt(site, ...config.habitat)), chamber: airlockRoomReading(roomAt(site, ...config.chamber)),
    paused: !processor.machine.enabled, outputAir: amount(processor.machine.output, 'air'), carriedAir: state.crew.reduce((n, c) => n + amount(c.carry, 'air'), 0),
    routinesRestored: state.crew.every(c => !policies.has(c.id) || c.life.policy === policies.get(c.id)) });
  function inspect() {
    const text = serialize(state);
    try { if (serialize(deserialize(text)) !== text) throw new Error('Noncanonical endpoint.'); }
    catch (error) { throw new Stop('canonical_mismatch', error.message); }
    if (state.crew.length !== 7 || state.crew.some(c => c.site !== 'surface' || c.health !== 100 || (c.medical?.injury || 0) !== 0)) throw new Stop('crew_harmed', 'Crew health or injury deteriorated.');
    if (state.crew.some(c => c.energy < 25 || c.hunger < 35 || c.oxygen < airThreshold(c))) throw new Stop('work_recovery', 'A native energy, hunger or suit work recovery threshold was reached.');
    for (const point of [config.habitat, config.chamber]) { const value = temperature(roomAt(site, ...point)); if (value === null || value < 5 || value > 35) throw new Stop('unsafe_temperature', 'A habitat or chamber temperature is outside 5..35C.'); }
    if (assembly(state, processor) !== assemblySha256 || !airlockLayout(site, controller).ok || ['inner', 'outer'].some(side => tileAt(site, controller.airlock.config[side].x, controller.airlock.config[side].y, controller.airlock.config[side].z).doorMode !== 'closed')) throw new Stop('assembly_changed', 'Layout, equipment, ownership, modes or closed doors changed.');
    if (!controller.powered && (controller.airlock.party || controller.airlock.queue.length || state.crew.some(c => c.airlockTraversal))) throw new Stop('controller_unpowered', 'A requested traversal lost controller power.');
    const m = processor.machine, active = !empty(m.batch);
    completed = m.completed - initialCompleted; started = completed + Number(active);
    if (!Number.isInteger(completed) || completed < 0 || started > 1 || active && (m.batch.water !== 1 || Object.keys(m.batch).some(k => k !== 'water')) || amount(m.output, 'air') + pickedUp !== completed * 10 || delivered > pickedUp) throw new Stop('recipe_mismatch', 'The single water-to-air batch or its physical transfers no longer balance.');
    finalBalances = physicalBalances(state); finalSpecies = species(state);
    if (!near(finalBalances.gas, baseline.gas + completed * 10) || Object.values(finalBalances.energy).some(error => !near(error, 0)) || !near(finalSpecies.inert, initialSpecies.inert + completed * 7.9) || !near(finalSpecies.oxygen + finalSpecies.co2, initialSpecies.oxygen + initialSpecies.co2 + completed * 2.1)) throw new Stop('conservation_mismatch', 'Material gas species or stored/spent energy no longer balance.');
    if (!recordingStatus(state).active) throw new Stop('recording_limit', 'The bounded recording was exhausted.');
  }
  function track(before) {
    for (const c of state.crew) {
      const prev = before.find(p => p.id === c.id), gain = amount(c.carry, 'air') - amount(prev.carry, 'air');
      if (gain > 0 && c.delivery && prev.site === 'surface') {
        // Pickup may be selected and completed in this same native tick.
        const intentMatches = prev.intent?.type === 'haul' && prev.intent.source === 'output' && sameCell(prev.intent.target, {x:config.processor[0],y:config.processor[1],z:0});
        if (intentMatches || !prev.intent && c.x === processor.x && c.y === processor.y) {
          tagged.set(c.id, (tagged.get(c.id) || 0) + gain); pickedUp += gain;
          transfers.push({ tick: state.tick, actor: c.id, amount: gain, from: `tile:surface:${processor.x}:${processor.y}/machine.output`, to: `${c.id}/carry` });
        }
      }
      const loss = -gain, carried = tagged.get(c.id) || 0;
      if (loss > 0 && carried > 0) {
        const d = prev.delivery, target = d && shipmentTile(site, d.target), valid = target && (d.kind === 'stock' && target.building === 'stockpile' && acceptsResource(target, 'air', site) || d.kind === 'input' && target.building === 'scrubber');
        if (!valid || c.x !== target.x || c.y !== target.y) throw new Stop('delivery_mismatch', 'Produced air left carry without a native accepting delivery.');
        const n = Math.min(loss, carried); tagged.set(c.id, carried - n); delivered += n;
        transfers.push({ tick: state.tick, actor: c.id, amount: n, from: `${c.id}/carry`, to: `tile:surface:${target.x}:${target.y}/${d.kind === 'input' ? 'machine.input' : 'stock'}` });
      }
    }
  }
  function act(id, args) {
    if (id === 'simulation.step' && state.tick - initialTick >= config.limits.ticks) throw new Stop('tick_limit', 'Added tick cap reached.');
    if (attempts >= config.limits.attempts) throw new Stop('attempt_limit', 'Shared action attempt cap reached.');
    if (id !== 'simulation.step' && commands >= config.limits.commands) throw new Stop('command_limit', 'Command cap reached.');
    const before = state.crew.map(c => ({ id: c.id, site: c.site, carry: copy(c.carry), delivery: copy(c.delivery), intent: copy(c.intent) })); before.output = amount(processor.machine.output, 'air');
    attempts++; if (id !== 'simulation.step') commands++;
    const action = { tick: state.tick, id, args, ok: false, code: 'exception' }; actions.push(action);
    const result = executeAction(state, id, args, 'agent'); Object.assign(action, { tick: state.tick, ok: result.ok, code: result.code });
    if (!result.ok) throw new Stop('action_rejected', `${id}: ${result.message || result.code}`);
    if (id === 'simulation.step') track(before);
    inspect();
  }
  const routine = (c, policy) => { if (c.life.policy !== policy) { if (!policies.has(c.id)) policies.set(c.id, c.life.policy); act('crew.routine', { crew: c.id, policy }); } };
  try {
    if (!state?.sites?.surface || !Number.isSafeInteger(initialTick)) throw new Stop('invalid_input', 'Expected a canonical colony state.');
    const text = serialize(state);
    try { if (serialize(deserialize(text)) !== text) throw new Error('Input is not a canonical current save.'); }
    catch (error) { throw new Stop('invalid_input', error.message); }
    inputSha256 = hash(text); sourceSha256 = sourceFingerprint(); site = state.sites.surface; processor = tileAt(site, ...config.processor);
    const controllers = site.tiles.filter(t => t.airlock?.config.chamber.x === config.chamber[0] && t.airlock.config.chamber.y === config.chamber[1] && t.airlock.config.chamber.z === 0); controller = controllers[0];
    if (processor?.building !== 'atmosphere' || !processor.machine || tileAt(site, ...config.delivery)?.building !== 'stockpile' || tileAt(site, ...config.bank)?.building !== 'battery' || !roomAt(site, ...config.habitat) || !roomAt(site, ...config.chamber) || controllers.length !== 1 || !airlockLayout(site, controller).ok) throw new Stop('invalid_input', 'Existing processor, depot, rooms, battery and owned airlock layout are required.');
    if (JSON.stringify(RECIPES.atmosphere) !== JSON.stringify({ input: { water: 1 }, output: { air: 10 }, duration: 25 })) throw new Stop('source_mismatch', 'The fixed atmosphere recipe changed.');
    const m = processor.machine, a = controller.airlock;
    if (m.enabled || !empty(m.batch) || !empty(m.input) || !empty(m.output) || m.order.remaining || state.jobs.length || state.crew.some(c => c.job || !empty(c.carry) || !home(c)) || site.tiles.some(t => t !== processor && !['scrubber', 'farm'].includes(t.building) && t.machine?.enabled) || a.phase !== 'idle' || a.party || a.queue.length || ['inner', 'outer'].some(side => tileAt(site, a.config[side].x, a.config[side].y, a.config[side].z).doorMode !== 'closed')) throw new Stop('invalid_input', 'Begin healthy at home with no work/carry, a paused empty processor, other production paused and an idle owned closed airlock.');
    initialCompleted = m.completed; baseline = physicalBalances(state); initialSpecies = species(state); assemblySha256 = assembly(state, processor);
    startRecording(state, { maxRecords: 12000, maxBytes: 128_000_000 }); recording = true; inspect();
    stage = 'production';
    for (const c of state.crew) if (c.labors.hauling || c.labors.production) routine(c, 'work');
    act('production.order', { site: 'surface', x: processor.x, y: processor.y, mode: 'batches', limit: 1 });
    act('production.enable', { site: 'surface', x: processor.x, y: processor.y, enabled: true });
    while (true) {
      if (completed === 1 && m.enabled) { stage = 'delivery'; act('production.enable', { site: 'surface', x: processor.x, y: processor.y, enabled: false }); }
      if (completed === 1 && delivered === 10 && empty(m.batch) && empty(m.input) && empty(m.output) && !state.crew.some(c => amount(c.carry, 'air')) && !state.jobs.some(j => j.kind === 'operate' && j.x === processor.x && j.y === processor.y)) {
        if (state.jobs.length === 0 && state.crew.every(c => home(c) && !c.job && empty(c.carry))) break;
        stage = 'return'; for (const c of state.crew) routine(c, 'rest');
      }
      act('simulation.step', { ticks: 1 });
    }
    stage = 'restore'; for (const [id, policy] of policies) routine(state.crew.find(c => c.id === id), policy);
    inspect(); stage = 'delivered';
  } catch (error) { failure = { code: error.code || 'batch_error', message: String(error.message).slice(0, 240) }; }
  if (baseline) {
    // Read the actual first stopped endpoint even if a transfer/check failed.
    try { completed = processor.machine.completed - initialCompleted; started = completed + Number(!empty(processor.machine.batch)); finalBalances = physicalBalances(state); finalSpecies = species(state); } catch { /* Keep the original first failure. */ }
  }
  if (recording) stopRecording(state);
  const recorded = recording ? exportRecording(state) : null;
  const endpoint = (() => { try { return serialize(state); } catch { return null; } })();
  const summary = { ok: !failure, goal: 'one paid atmosphere batch and native delivery', commissioned: false, safeHabitationEstablished: false,
    initialTick, tick: state?.tick, addedTicks: state?.tick - initialTick, attempts, commands, limits: config.limits, stage,
    inputSha256, sourceSha256, assemblySha256, endpointSha256: endpoint && hash(endpoint), actionSha256: hash(JSON.stringify(actions)), recordingSha256: recorded && hash(recorded),
    recipes: { started, completed, waterConsumed: completed, waterCommitted: started - completed, airProduced: completed * 10, duration: 25 },
    delivery: { pickedUp, delivered, transfers }, checkpoint: processor && site && controller ? checkpoint() : null,
    policies: [...policies].map(([crew, original]) => ({ crew, original, current: state.crew.find(c => c.id === crew)?.life.policy })),
    accounting: finalBalances && { gasError: finalBalances.gas - baseline.gas - completed * 10, energyErrors: finalBalances.energy,
      species: { before: initialSpecies, after: finalSpecies, inertError: finalSpecies.inert - initialSpecies.inert - completed * 7.9, oxygenCo2Error: finalSpecies.oxygen + finalSpecies.co2 - initialSpecies.oxygen - initialSpecies.co2 - completed * 2.1 },
      materialsBefore: baseline.owners, materialsAfter: finalBalances.owners }, ...(failure ? { failure } : {}) };
  return { state, endpoint, summary, actions, ...(recorded ? { recording: recorded } : {}) };
}

export function parseArguments(args) {
  const parsed = {}, limits = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!value || value.startsWith('--')) throw new TypeError('Usage: --input PATH --output-dir PATH [--ticks N] [--commands N] [--attempts N]');
    if (['--input', '--output-dir'].includes(key)) { const name = key === '--input' ? 'input' : 'outputDir'; if (parsed[name]) throw new TypeError('Duplicate path.'); parsed[name] = value; }
    else if (Object.hasOwn(LIMITS, key.slice(2)) && key.startsWith('--') && /^\d+$/.test(value)) { const name = key.slice(2); if (Object.hasOwn(limits, name)) throw new TypeError('Duplicate limit.'); limits[name] = Number(value); }
    else throw new TypeError('Unknown argument.');
  }
  configuration({ limits });
  if (!parsed.input || !parsed.outputDir || resolve(parsed.input) === resolve(parsed.outputDir)) throw new TypeError('Distinct input and new output directory are required.');
  return { ...parsed, limits };
}

export async function main(args = process.argv.slice(2)) {
  try {
    const { input, outputDir, limits } = parseArguments(args), text = await readFile(input, 'utf8'), state = deserialize(text);
    if (serialize(state) !== text) throw new TypeError('Input must be an exact canonical save.');
    await mkdir(outputDir); // A fresh directory protects all existing inputs/evidence.
    const output = runPaidAirBatch(state, { limits });
    await writeFile(join(outputDir, 'input.json'), text, { flag: 'wx' });
    await writeFile(join(outputDir, 'endpoint.json'), output.endpoint, { flag: 'wx' });
    await writeFile(join(outputDir, 'summary.json'), JSON.stringify(output.summary, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(outputDir, 'actions.json'), JSON.stringify(output.actions, null, 2) + '\n', { flag: 'wx' });
    if (output.recording) await writeFile(join(outputDir, 'recording.ndjson'), output.recording, { flag: 'wx' });
    console.log(JSON.stringify(output.summary)); return output.summary.ok ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ ok: false, failure: { code: 'cli_error', message: String(error.message).slice(0, 240) } })); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
