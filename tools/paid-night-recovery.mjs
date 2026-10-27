#!/usr/bin/env node
// Finish paid air delivery and recover finite standby through the next dawn.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { isDay } from '../src/power.js';
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

export const LIMITS = Object.freeze({ ticks: 220, commands: 35, attempts: 260 });
const POINTS = Object.freeze({ processor: [13, 9], habitat: [10, 11], chamber: [10, 13], bank: [13, 7], farm: [7, 9], scrubber: [7, 7], controller: [10, 10] });
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const amount = (inv, resource) => inv?.[resource] || 0;
const empty = inv => !Object.values(inv || {}).some(n => typeof n === 'number' && n > 0);
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-7;
class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }
function configuration(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'limits')) throw new TypeError('Expected optional lowered limits.');
  const requested = options.limits ?? {};
  if (!requested || typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).some(k => !Object.hasOwn(LIMITS, k))) throw new TypeError('Unknown night limit.');
  const limits = { ...LIMITS, ...requested };
  for (const [key, value] of Object.entries(limits)) if (!Number.isInteger(value) || value < 0 || value > LIMITS[key]) throw new TypeError(`${key} must be an integer from 0 to ${LIMITS[key]}.`);
  return limits;
}
function sourceFingerprint() {
  const root = new URL('../', import.meta.url);
  const names = readdirSync(new URL('src/', root)).filter(n => n.endsWith('.js')).map(n => `src/${n}`).sort();
  names.push('tools/paid-air-recovery.mjs', 'tools/paid-night-recovery.mjs');
  return hash(names.map(name => `${name}\0${hash(readFileSync(new URL(name, root)))}`).join('\n'));
}
function assembly(state) {
  return hash(JSON.stringify({ crew: state.crew.map(c => [c.id, c.labors]), sites: Object.values(state.sites).map(site => ({ id: site.id, tiles: site.tiles.map(t => ({
    x: t.x, y: t.y, terrain: t.terrain, building: t.building, hp: t.hp, cable: t.cable, powerPriority: t.powerPriority,
    pipe: t.pipe && { hp: t.pipe.hp, open: t.pipe.open, airlockOwner: t.pipe.airlockOwner },
    gasStore: t.gasStore && { open: t.gasStore.open }, waterPipe: t.waterPipe && { hp: t.waterPipe.hp, open: t.waterPipe.open },
    waterDevice: t.waterDevice, gasDevice: t.gasDevice, doorMode: t.doorMode, airlockOwner: t.airlockOwner,
    airlock: t.airlock && { binding: t.airlock.binding, config: t.airlock.config, chamberCells: t.airlock.chamberCells, ownedNodes: t.airlock.ownedNodes, nextCycle: t.airlock.nextCycle },
    machine: t.machine && { enabled: ['farm', 'scrubber'].includes(t.building) ? undefined : t.machine.enabled, order: t.machine.order, recipeId: t.machine.recipeId }
  })) })) }));
}
function species(state) {
  const result = { oxygen: 0, inert: 0, co2: 0 }, add = gas => { for (const k of Object.keys(result)) result[k] += gas?.[k] || 0; };
  const air = physicalMaterialOwners(state).reduce((n, row) => n + row.air, 0); add({ oxygen: air * .21, inert: air * .79 });
  for (const site of Object.values(state.sites)) {
    site.rooms.forEach(r => add(r.gas)); site.tiles.forEach(t => add(gasNode(t)?.gas)); add(site.atmosphere.vented); add(site.gasNetwork.vented);
  }
  add({ oxygen: state.crew.reduce((n, c) => n + c.oxygen * SUIT_PER_POINT, 0) }); return result;
}
function fertilizer(state) {
  const inv = Object.values(state.sites).flatMap(s => s.tiles.flatMap(t => [t.stock, t.drop, t.imports, t.machine?.input, t.machine?.output, t.machine?.batch, t.sanitary?.output]));
  inv.push(...state.crew.flatMap(c => [c.carry, c.possessions?.inventory]), ...state.jobs.flatMap(j => [j.materials, ...j.sources.map(s => s.items)]), state.mission?.cargo, state.shuttle?.supplies, state.shuttle?.freight);
  return inv.reduce((n, i) => n + amount(i, 'fertilizer'), 0);
}
const water = balances => balances.owners.reduce((n, row) => n + row.water, 0);

/** Mutates only through shared commands and full ticks. Failure retains the
 * exact first stopped paid state and temporary controls, without cleanup.
 */
export function recoverPaidNight(state, options = {}) {
  const limits = configuration(options), actions = [], transfers = [], tagged = new Map();
  let site, processor, farm, scrubber, controller, baseline, initialSpecies, farmBefore, processorBefore, initialFertilizer;
  let initialTick = state?.tick, inputSha256 = null, sourceSha256 = null, assemblySha256 = null, finalBalances = null, finalSpecies = null;
  let inputMode = null, deliveryTarget = 0, initialCarry = 0, initialOutput = 0, pickedUp = 0, delivered = 0, attempts = 0, commands = 0, stage = 'preflight', failure = null, recording = false, restored = false;
  const home = c => c.site === 'surface' && roomAt(site, ...POINTS.habitat)?.cells.includes(`${c.x},${c.y}`) && tileAt(site, c.x, c.y)?.building !== 'door';
  const quiet = () => state.jobs.length === 0 && state.crew.every(c => !c.job && empty(c.carry));
  const pending = () => amount(processor.machine.output, 'air') + state.crew.reduce((n, c) => n + amount(c.carry, 'air'), 0);
  const farmCommitted = () => ({ batch: copy(farm.machine.batch), completed: farm.machine.completed, progress: farm.machine.progress });
  const checkpoint = () => ({ daylight: isDay(state), home: state.crew.filter(home).length, jobs: state.jobs.length, carries: state.crew.filter(c => !empty(c.carry)).length,
    bank: tileAt(site, ...POINTS.bank).charge, habitat: airlockRoomReading(roomAt(site, ...POINTS.habitat)), chamber: airlockRoomReading(roomAt(site, ...POINTS.chamber)),
    pendingAir: pending(), processorPaused: !processor.machine.enabled, farmEnabled: farm.machine.enabled, scrubberEnabled: scrubber.machine.enabled,
    controllerEnabled: controller.airlock.enabled, controllerPhase: controller.airlock.phase, policies: state.crew.map(c => ({ crew: c.id, policy: c.life.policy })) });
  function inspect() {
    const text = serialize(state);
    try { if (serialize(deserialize(text)) !== text) throw new Error('Noncanonical endpoint.'); } catch (e) { throw new Stop('canonical_mismatch', e.message); }
    if (state.crew.length !== 7 || state.crew.some(c => c.health !== 100 || (c.medical?.injury || 0) !== 0)) throw new Stop('crew_harmed', 'Crew health or injury deteriorated.');
    if (state.crew.some(c => !home(c) || c.airlockTraversal)) throw new Stop('crew_left_habitat', 'A crew member left the habitat or began a traversal.');
    if (state.crew.some(c => pending() > 0 && c.energy < 25 || c.hunger < 35 || c.oxygen < airThreshold(c))) throw new Stop('work_recovery', 'A native energy, hunger or suit recovery threshold was reached.');
    const temp = temperature(roomAt(site, ...POINTS.habitat));
    if (temp === null || temp < 5 || temp > 35) throw new Stop('unsafe_temperature', 'Habitat temperature is outside 5..35C.');
    const a = controller.airlock;
    if (assembly(state) !== assemblySha256 || !airlockLayout(site, controller).ok || a.party || a.queue.length || a.direction || a.cycle !== null || ['inner', 'outer'].some(side => tileAt(site, a.config[side].x, a.config[side].y, a.config[side].z).doorMode !== 'closed')) throw new Stop('assembly_changed', 'Protected structure, ownership, doors or traversal state changed.');
    if (JSON.stringify({ ...processor.machine, output: undefined, status: undefined }) !== processorBefore || !restored && JSON.stringify(farmCommitted()) !== JSON.stringify(farmBefore)) throw new Stop('paid_batch_changed', 'A paused paid production state changed.');
    if (!near(amount(processor.machine.output, 'air') + pickedUp, initialOutput) || !near(pending() + delivered, deliveryTarget)) throw new Stop('delivery_mismatch', 'The pending paid air units lost their physical transfer chain.');
    finalBalances = physicalBalances(state); finalSpecies = species(state);
    const completed = farm.machine.completed - farmBefore.completed;
    if (!near(finalBalances.gas, baseline.gas) || !near(water(finalBalances), water(baseline) - completed) || !near(fertilizer(state), initialFertilizer - completed * .25) || Object.values(finalBalances.energy).some(n => !near(n, 0)) || !near(finalSpecies.inert, initialSpecies.inert) || !near(finalSpecies.oxygen + finalSpecies.co2, initialSpecies.oxygen + initialSpecies.co2)) throw new Stop('conservation_mismatch', 'Gas species, physical water/fertilizer or stored/spent energy no longer balance.');
    if (!recordingStatus(state).active) throw new Stop('recording_limit', 'The complete recording budget was exhausted.');
  }
  function track(before) {
    for (const c of state.crew) {
      const prev = before.find(p => p.id === c.id), gain = amount(c.carry, 'air') - amount(prev.carry, 'air');
      if (gain > 0) {
        const intent = prev.intent, matches = intent?.type === 'haul' && intent.source === 'output' && sameCell(intent.target, {x:POINTS.processor[0],y:POINTS.processor[1],z:0});
        if (!c.delivery || prev.site !== 'surface' || !(matches || !intent && c.x === processor.x && c.y === processor.y)) throw new Stop('delivery_mismatch', 'Air pickup did not originate at the paid processor.');
        tagged.set(c.id, (tagged.get(c.id) || 0) + gain); pickedUp += gain;
        transfers.push({ tick: state.tick, actor: c.id, amount: gain, from: `tile:surface:${processor.x}:${processor.y}/machine.output`, to: `${c.id}/carry` });
      }
      if (gain < 0) {
        const d = prev.delivery, target = d && shipmentTile(site, d.target), valid = target && (d.kind === 'stock' && target.building === 'stockpile' && acceptsResource(target, 'air', site) || d.kind === 'input' && target.building === 'scrubber');
        const owned = tagged.get(c.id) || 0;
        if (!valid || c.x !== target.x || c.y !== target.y || -gain > owned) throw new Stop('delivery_mismatch', 'Paid air left carry without a native accepting delivery.');
        tagged.set(c.id, owned + gain); delivered -= gain;
        transfers.push({ tick: state.tick, actor: c.id, amount: -gain, from: `${c.id}/carry`, to: `tile:surface:${target.x}:${target.y}/${d.kind === 'input' ? 'machine.input' : 'stock'}` });
      }
    }
  }
  function act(id, args) {
    if (id === 'simulation.step' && state.tick - initialTick >= limits.ticks) throw new Stop('tick_limit', 'Added tick cap reached.');
    if (attempts >= limits.attempts) throw new Stop('attempt_limit', 'Shared action attempt cap reached.');
    if (id !== 'simulation.step' && commands >= limits.commands) throw new Stop('command_limit', 'Command cap reached.');
    const before = state.crew.map(c => ({ id: c.id, site: c.site, carry: copy(c.carry), delivery: copy(c.delivery), intent: copy(c.intent) }));
    attempts++; if (id !== 'simulation.step') commands++;
    const action = { tick: state.tick, id, args, ok: false, code: 'exception' }; actions.push(action);
    const result = executeAction(state, id, args, 'agent'); Object.assign(action, { tick: state.tick, ok: result.ok, code: result.code });
    if (!result.ok) throw new Stop('action_rejected', `${id}: ${result.message || result.code}`);
    if (id === 'simulation.step') track(before); inspect();
  }
  const enable = (point, enabled) => act('production.enable', { site: 'surface', x: point[0], y: point[1], enabled });
  const routine = policy => { for (const c of state.crew) if (c.life.policy !== policy) act('crew.routine', { crew: c.id, policy }); };
  const ready = () => { const c = checkpoint(); return c.daylight && c.bank === 120 && c.home === 7 && quiet() && c.pendingAir === 0 && delivered === deliveryTarget && c.habitat.thermalSafe && c.chamber.thermalSafe; };
  const recovered = () => ready() && checkpoint().habitat.breathable && checkpoint().chamber.pressure === 0 && controller.airlock.enabled && controller.airlock.phase === 'idle' && scrubber.machine.enabled;
  const accepted = () => recovered() && farm.machine.enabled;
  try {
    if (!state?.sites?.surface || !Number.isSafeInteger(initialTick)) throw new Stop('invalid_input', 'Expected a canonical colony state.');
    const text = serialize(state); try { if (serialize(deserialize(text)) !== text) throw new Error('Input is not canonical.'); } catch (e) { throw new Stop('invalid_input', e.message); }
    inputSha256 = hash(text); sourceSha256 = sourceFingerprint(); site = state.sites.surface;
    [processor, farm, scrubber, controller] = ['processor', 'farm', 'scrubber', 'controller'].map(k => tileAt(site, ...POINTS[k]));
    if (processor?.building !== 'atmosphere' || farm?.building !== 'farm' || scrubber?.building !== 'scrubber' || controller?.building !== 'airlockController' || !controller.airlock || !airlockLayout(site, controller).ok || tileAt(site, ...POINTS.bank)?.building !== 'battery' || !roomAt(site, ...POINTS.habitat) || !roomAt(site, ...POINTS.chamber)) throw new Stop('invalid_input', 'The existing paid layout and rooms are required.');
    const m = processor.machine, a = controller.airlock;
    initialCarry = state.crew.reduce((n, c) => n + amount(c.carry, 'air'), 0); initialOutput = amount(m.output, 'air');
    deliveryTarget = initialCarry + initialOutput;
    const night = !isDay(state) && near(deliveryTarget, 10) && state.crew.every(c => c.life.policy === 'work') && farm.machine.enabled && scrubber.machine.enabled;
    const day = isDay(state) && deliveryTarget === 0 && quiet() && state.crew.every(c => c.life.policy === 'rest') && !farm.machine.enabled && !scrubber.machine.enabled;
    if (!state.crew.every(c => !c.job && home(c)) || state.jobs.length || m.enabled || !empty(m.batch) || !empty(m.input) || m.order.remaining || Object.keys(m.output).some(k => k !== 'air' && amount(m.output, k)) || site.tiles.some(t => ![farm, scrubber].includes(t) && t.machine?.enabled) || !a.enabled || a.phase !== 'idle' || a.party || a.queue.length || checkpoint().chamber.pressure !== 0 || !night && !day) throw new Stop('invalid_input', 'Expected the existing night delivery profile or daylight off-duty continuation profile with paused production and enabled idle closed assembly.');
    inputMode = night ? 'night' : 'day';
    for (const c of state.crew) if (amount(c.carry, 'air')) { tagged.set(c.id, amount(c.carry, 'air')); transfers.push({ tick: state.tick, actor: c.id, amount: amount(c.carry, 'air'), from: 'initial-paid-carry', to: `${c.id}/carry` }); }
    baseline = physicalBalances(state); initialSpecies = species(state); initialFertilizer = fertilizer(state); farmBefore = farmCommitted(); processorBefore = JSON.stringify({ ...m, output: undefined, status: undefined }); assemblySha256 = assembly(state);
    // Output can change only by the native paid-air pickup tracked below.
    startRecording(state, { maxRecords: 16000, maxBytes: 128_000_000 }); recording = true; inspect();
    if (inputMode === 'night') {
      stage = 'pause'; enable(POINTS.farm, false); enable(POINTS.scrubber, false); act('airlock.enable', { site: 'surface', x: controller.x, y: controller.y, enabled: false });
      stage = 'delivery'; while (delivered !== deliveryTarget || !quiet() || pending() !== 0) act('simulation.step', { ticks: 1 });
      stage = 'standby'; routine('rest'); while (!isDay(state)) act('simulation.step', { ticks: 1 });
      stage = 'daylight'; act('airlock.enable', { site: 'surface', x: controller.x, y: controller.y, enabled: true });
    }
    stage = 'daylight';
    while (!ready()) act('simulation.step', { ticks: 1 });
    stage = 'restore-scrubber'; enable(POINTS.scrubber, true);
    do { act('simulation.step', { ticks: 1 }); } while (!recovered());
    stage = 'balanced'; restored = true; enable(POINTS.farm, true); routine('balanced'); inspect(); if (!accepted()) throw new Stop('acceptance_changed', 'Final shared routines changed recovery acceptance.'); stage = 'recovered';
  } catch (e) { failure = { code: e.code || 'night_error', message: String(e.message).slice(0, 240) }; }
  if (baseline) { try { finalBalances = physicalBalances(state); finalSpecies = species(state); } catch { /* Retain the first failure. */ } }
  if (recording) stopRecording(state);
  const recorded = recording ? exportRecording(state) : null, endpoint = (() => { try { return serialize(state); } catch { return null; } })();
  const farmCompleted = farmBefore ? farm.machine.completed - farmBefore.completed : null;
  const summary = { ok: !failure, goal: 'paid air continuation and finite daylight recovery', commissioned: false, safeHabitationEstablished: false,
    inputMode, initialTick, tick: state?.tick, addedTicks: state?.tick - initialTick, attempts, commands, limits, stage, inputSha256, sourceSha256, assemblySha256,
    endpointSha256: endpoint && hash(endpoint), actionSha256: hash(JSON.stringify(actions)), recordingSha256: recorded && hash(recorded),
    delivery: { target: deliveryTarget, initialCarry, initialOutput, pickedUp, delivered, transfers }, checkpoint: baseline ? checkpoint() : null,
    farm: farmBefore && { before: farmBefore, after: farmCommitted(), nativeCompleted: farmCompleted },
    accounting: finalBalances && { gasError: finalBalances.gas - baseline.gas, waterError: water(finalBalances) - water(baseline) + farmCompleted, fertilizerError: fertilizer(state) - initialFertilizer + farmCompleted * .25, energyErrors: finalBalances.energy,
      species: { before: initialSpecies, after: finalSpecies, inertError: finalSpecies.inert - initialSpecies.inert, oxygenCo2Error: finalSpecies.oxygen + finalSpecies.co2 - initialSpecies.oxygen - initialSpecies.co2 }, materialsBefore: baseline.owners, materialsAfter: finalBalances.owners }, ...(failure ? { failure } : {}) };
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
    const output = recoverPaidNight(state, { limits });
    await writeFile(join(outputDir, 'input.json'), text, { flag: 'wx' });
    await writeFile(join(outputDir, 'endpoint.json'), output.endpoint, { flag: 'wx' });
    await writeFile(join(outputDir, 'summary.json'), JSON.stringify(output.summary, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(outputDir, 'actions.json'), JSON.stringify(output.actions, null, 2) + '\n', { flag: 'wx' });
    if (output.recording) await writeFile(join(outputDir, 'recording.ndjson'), output.recording, { flag: 'wx' });
    console.log(JSON.stringify(output.summary)); return output.summary.ok ? 0 : 1;
  } catch (error) { console.log(JSON.stringify({ ok: false, failure: { code: 'cli_error', message: String(error.message).slice(0, 240) } })); return 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
