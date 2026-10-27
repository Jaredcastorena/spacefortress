/** Offline, bounded containment through ordinary surface freight work. */
import { createHash } from 'node:crypto';
import { serialize, deserialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { roomAt } from '../src/atmosphere.js';
import { exposedWaste } from '../src/sanitation.js';
import { freightRequest } from '../src/freight.js';
import { startRecording, stopRecording, exportRecording, recordingStatus } from '../src/telemetry.js';

export const LIMITS = Object.freeze({ ticks: 120, commands: 2, attempts: 122 });
const waste = inventory => inventory?.waste || 0;
const near = (a, b) => Math.abs(a - b) < 1e-8;
const hash = text => createHash('sha256').update(text).digest('hex');
class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }

function configuration(options) {
  const keys = ['crew', 'habitat', 'limits', 'additionalSanitationInjury', 'record'];
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !keys.includes(k))) throw new TypeError('Expected crew, habitat, limits and optional recording/injury options.');
  if (typeof options.crew !== 'string' || !options.crew) throw new TypeError('crew must identify one surface worker.');
  if (!Array.isArray(options.habitat) || options.habitat.length !== 2 || !options.habitat.every(n => Number.isSafeInteger(n) && n >= 0)) throw new TypeError('habitat must contain two nonnegative integer surface coordinates.');
  if (options.record !== undefined && typeof options.record !== 'boolean') throw new TypeError('record must be boolean.');
  const allowance = options.additionalSanitationInjury ?? 0;
  if (!Number.isFinite(allowance) || allowance < 0 || allowance > .1) throw new TypeError('additionalSanitationInjury must be between 0 and 0.1 per crew member.');
  const requested = options.limits ?? {};
  if (typeof requested !== 'object' || Array.isArray(requested) || Object.keys(requested).some(k => !Object.hasOwn(LIMITS, k))) throw new TypeError('Unknown containment limit.');
  const limits = {};
  for (const [key, maximum] of Object.entries(LIMITS)) {
    const value = requested[key] ?? maximum;
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TypeError(`${key} must be an integer from 0 to ${maximum}.`);
    limits[key] = value;
  }
  return { crew: options.crew, habitat: [...options.habitat], limits, allowance, record: options.record === true };
}

/**
 * Mutates the supplied canonical state; never rewinds, grants or cleans up.
 * Required options: { crew: 'crew-…', habitat: [x,y] }. Limits may be lowered.
 * Default stops on any added injury/health loss; an explicit allowance permits
 * at most 0.1 additional sanitation injury per person, never another cause.
 * Success ends at sealed carry or shuttle ownership plus declining exposure.
 * Pending freight and the worker's work routine deliberately remain explicit.
 * Returns { state, endpoint, summary, actions, recording? } on the first stop.
 */
export function containHabitatWaste(state, options) {
  const config = configuration(options), actions = [], baselines = new Map(), exposures = new Map();
  const initialTick = state?.tick;
  let input = null, endpoint = null, failure = null, jobId = null, worker = null, originalPolicy = null;
  let requested = 0, onboardBefore = 0, attempts = 0, commands = 0, recordingStarted = false, checkpoint = null;
  const site = state?.sites?.surface;
  const habitat = () => roomAt(site, ...config.habitat);
  function snapshot() {
    const room = habitat(), job = state.jobs.find(j => j.id === jobId);
    const carries = state.crew.filter(c => c.delivery?.kind === 'job' && c.delivery.job === jobId && waste(c.carry) > 0)
      .map(c => ({ crew: c.id, amount: waste(c.carry), site: c.site, position: [c.x, c.y] }));
    const reserved = job?.sources.reduce((n, source) => n + waste(source.items), 0) || 0;
    const staged = waste(job?.materials), carried = carries.reduce((n, c) => n + c.amount, 0);
    const onboard = waste(state.shuttle.freight) - onboardBefore;
    const occupants = [...exposures].map(([id, before]) => {
      const c = state.crew.find(c => c.id === id), current = c?.sanitation.exposure;
      before.peak = Math.max(before.peak, current ?? before.peak);
      return { crew: id, initial: before.initial, peak: before.peak, current, declined: before.peak === 0 || current < before.peak };
    });
    return { tick: state.tick, exposedWaste: room ? exposedWaste(state, site, room) : null,
      parcel: { requested, reserved, staged, carried, onboard, total: reserved + staged + carried + onboard, carries },
      occupants, freight: job ? { id: job.id, pending: true, remaining: job.remaining, worker: job.worker, blockedReason: job.blockedReason } : { id: jobId, pending: false },
      routine: { crew: config.crew, original: originalPolicy, current: worker?.life.policy } };
  }
  function inspect() {
    checkpoint = snapshot();
    for (const [id, before] of baselines) {
      const c = state.crew.find(c => c.id === id);
      if (!c || c.health <= 0) throw new Stop('crew_harmed', 'A previously living crew member died or disappeared.');
      const injury = c.medical.injury - before.previousInjury, loss = before.previousHealth - c.health;
      before.added += Math.max(0, injury, loss);
      before.previousInjury = c.medical.injury; before.previousHealth = c.health;
      if (before.added > config.allowance + 1e-8 ||
          ((injury > 1e-8 || loss > 1e-8) && c.medical.cause !== 'unsanitary exposure')) throw new Stop('crew_harmed', 'Added injury or health loss exceeded the selected sanitation-only allowance.');
    }
    if (checkpoint.exposedWaste === null) throw new Stop('habitat_missing', 'The selected habitat is no longer a room.');
    if (jobId && !near(checkpoint.parcel.total, requested)) throw new Stop('parcel_changed', 'The requested waste no longer has its exact freight, carry and shuttle owners.');
    if (recordingStarted && !recordingStatus(state).active) throw new Stop('recording_limit', 'The optional recording reached its finite limit.');
  }
  function act(id, args) {
    if (id === 'simulation.step' && state.tick - initialTick >= config.limits.ticks) throw new Stop('tick_limit', 'The added-tick cap was reached.');
    if (attempts >= config.limits.attempts) throw new Stop('attempt_limit', 'The shared-action attempt cap was reached.');
    if (id !== 'simulation.step' && commands >= config.limits.commands) throw new Stop('command_limit', 'The non-step command cap was reached.');
    attempts++; if (id !== 'simulation.step') commands++;
    const row = { tick: state.tick, id, args: structuredClone(args), ok: false };
    actions.push(row);
    const result = executeAction(state, id, args, 'agent');
    Object.assign(row, { postTick: state.tick, ok: result.ok, ...(result.code ? { code: result.code } : {}) });
    if (!result.ok) throw new Stop('action_rejected', `${id}: ${result.message || result.code}`);
    if (id === 'freight.load') jobId = result.job;
    inspect();
  }
  try {
    if (!site || !Number.isSafeInteger(initialTick)) throw new Stop('invalid_input', 'Expected a canonical colony state with a surface site.');
    input = serialize(state);
    let probe;
    try { probe = deserialize(input); } catch (error) { throw new Stop('invalid_input', `Invalid colony save: ${error.message}`); }
    if (serialize(probe) !== input) throw new Stop('invalid_input', 'Input must already be a canonical current colony save.');
    if (config.record && recordingStatus(state).reason !== 'not_started') throw new Stop('recording_exists', 'An existing recording must not be replaced or reset.');
    const room = habitat();
    if (!room) throw new Stop('invalid_input', 'habitat must anchor an existing surface room.');
    worker = state.crew.find(c => c.id === config.crew);
    if (!worker || worker.site !== 'surface' || worker.health <= 0 || !worker.labors.hauling) throw new Stop('invalid_worker', 'Select a living surface worker with hauling enabled.');
    originalPolicy = worker.life.policy;
    if (worker.job || worker.carry || worker.delivery || worker.rescue || worker.airlockTraversal || worker.medical.bed ||
        (worker.intent && worker.intent.type !== 'leisure')) throw new Stop('worker_busy', 'The selected worker already has conflicting work or care.');
    requested = exposedWaste(state, site, room); onboardBefore = waste(state.shuttle.freight);
    if (!(requested > 0)) throw new Stop('no_exposed_waste', 'The selected habitat has no exposed waste to contain.');
    const request = freightRequest(state, 'surface', 'loadCargo', { waste: requested });
    if (!request.ok) throw new Stop(request.code, request.message);
    // One no-tick native preflight on a detached canonical copy verifies supply
    // reservations before changing the caller. It is never used as a restart.
    const planned = executeAction(probe, 'freight.load', { items: { waste: requested } }, 'agent');
    if (!planned.ok) throw new Stop('preflight_rejected', planned.message || planned.code);
    if (probe.jobs.find(j => j.id === planned.job).sources.some(source => !room.cells.includes(`${source.x},${source.y}`))) throw new Stop('source_mismatch', 'Native freight would reserve waste outside the selected habitat.');
    for (const c of state.crew) {
      if (c.health > 0) baselines.set(c.id, { previousHealth: c.health, previousInjury: c.medical.injury, added: 0 });
      if (c.health > 0 && c.site === 'surface' && room.cells.includes(`${c.x},${c.y}`)) exposures.set(c.id, { initial: c.sanitation.exposure, peak: c.sanitation.exposure });
    }
    if (config.record) { startRecording(state, { maxRecords: 12000, maxBytes: 128_000_000 }); recordingStarted = true; }
    inspect();
    if (worker.life.policy !== 'work') act('crew.routine', { crew: worker.id, policy: 'work' });
    act('freight.load', { items: { waste: requested } });
    const contained = () => checkpoint.exposedWaste === 0 && near(checkpoint.parcel.carried + checkpoint.parcel.onboard, requested) && checkpoint.occupants.every(c => c.declined);
    while (!contained()) act('simulation.step', { ticks: 1 });
  } catch (error) {
    failure = { code: error.code || 'invalid_input', message: error.message, tick: state?.tick };
  }
  if (recordingStarted) stopRecording(state);
  try { endpoint = serialize(state); } catch { /* Preserve the original failure. */ }
  const summary = { ok: failure === null, goal: 'habitat waste containment only', safeHabitationEstablished: false, medicalRecoveryEstablished: false,
    initialTick, tick: state?.tick, addedTicks: state?.tick - initialTick, attempts, commands, limits: config.limits,
    additionalSanitationInjury: config.allowance, checkpoint, ...(failure ? { failure } : {}),
    inputSha256: input && hash(input), endpointSha256: endpoint && hash(endpoint), actionSha256: hash(JSON.stringify(actions)),
    limitation: 'Sealed carry is containment, not completed freight. Pending delivery, routines, medical care and sustained habitation need separate review.' };
  return { state, endpoint, summary, actions, ...(recordingStarted ? { recording: exportRecording(state) } : {}) };
}
