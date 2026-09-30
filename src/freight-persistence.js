import { RESOURCES } from './data.js';
import { validFoodLots } from './food-lots.js';
import { validItemLots } from './item-lots.js';
import { shuttlePresence } from './outposts.js';

export const FREIGHT_JOB_KINDS = Object.freeze(['loadCargo', 'unloadCargo']);
export const FREIGHT_SOURCE_KIND = 'freight';
export const FREIGHT_WORK = 3;

const JOB_FIELDS = Object.freeze([
  'id', 'site', 'x', 'y', 'kind', 'building', 'cost', 'sources',
  'materials', 'work', 'remaining', 'worker', 'priority', 'blockedReason',
  'missingFood', 'foodSpoiled',
]);
const SOURCE_FIELDS = Object.freeze(['x', 'y', 'kind', 'items']);
const record = value => value !== null && typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => record(value) && Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const denseArray = value => Array.isArray(value) && Object.keys(value).length === value.length;
const amount = value => Number.isFinite(value) && value >= 0;
const inventory = value => record(value) && Object.entries(value).every(([resource, value]) =>
  resource === '_food' || resource === '_items' || RESOURCES.includes(resource) && amount(value)) &&
  validFoodLots(value) && validItemLots(value, true);
const inventoryQuantity = value => RESOURCES.reduce((total, resource) => total + (value[resource] || 0), 0);
const requestedResources = value => record(value) && Object.keys(value).length > 0 &&
  Object.entries(value).every(([resource, value]) => RESOURCES.includes(resource) &&
    Number.isFinite(value) && value > 0 && (resource !== 'keepsakes' || Number.isInteger(value)));

function freightJob(job) {
  return record(job) && FREIGHT_JOB_KINDS.includes(job.kind);
}

// Old saves must never smuggle new owners through a version downgrade. This
// assertion is read-only and runs before any deliberate migration.
export function assertLegacyFreightState(state) {
  if (state?.version >= 38) return;
  if (state.departure?.crew?.length === 1 || state.mission?.crew?.length === 1) {
    throw new Error('A one-person outbound roster is not valid in this older save.');
  }
  if (!Array.isArray(state?.jobs)) return;
  for (const job of state.jobs) {
    if (freightJob(job) || Array.isArray(job?.sources) &&
        job.sources.some(source => source?.kind === FREIGHT_SOURCE_KIND)) {
      throw new Error('Freight work is not valid in this older save.');
    }
  }
}

// Schema 38 adds only freight job/source vocabulary. It does not initialize,
// normalize or grant any inventory, roster, resource, RNG or identity field.
export function migrateFreightState(state) {
  if (state?.version !== 37) return false;
  assertLegacyFreightState(state);
  state.version = 38;
  return true;
}

function terminalFor(state, job) {
  let presence;
  try {
    presence = shuttlePresence(state, job.site);
  } catch (error) {
    throw new Error('Invalid freight terminal state.', { cause: error });
  }
  if (!presence.usable || !presence.terminal || presence.terminal.x !== job.x || presence.terminal.y !== job.y) {
    throw new Error('Freight work must remain at the usable present shuttle terminal.');
  }
  if (job.site === 'surface') {
    if (state.mission != null || state.departure != null) throw new Error('Surface freight work requires an idle shuttle.');
  } else if (state.mission?.site !== job.site || state.mission.phase !== 'working' || state.departure != null) {
    throw new Error('Remote freight work requires a working expedition at that site.');
  }
  return presence.terminal;
}

function validateSources(state, job, terminal) {
  if (!denseArray(job.sources)) throw new Error('Invalid freight material sources.');
  const allowed = job.kind === 'loadCargo'
    ? new Set(['stock', 'drop'])
    : new Set([FREIGHT_SOURCE_KIND, 'stock', 'imports', 'drop']);
  const site = state.sites?.[job.site];
  for (const source of job.sources) {
    if (!exact(source, SOURCE_FIELDS) || !Number.isInteger(source.x) || !Number.isInteger(source.y) ||
        source.x < 0 || source.y < 0 || source.x >= site.size || source.y >= site.size ||
        !allowed.has(source.kind) || !inventory(source.items) || !Number.isFinite(inventoryQuantity(source.items))) {
      throw new Error('Invalid freight material source.');
    }
    if (source.kind === FREIGHT_SOURCE_KIND &&
        (job.kind !== 'unloadCargo' || source.x !== terminal.x || source.y !== terminal.y)) {
      throw new Error('Reserved shuttle freight must belong to the unload terminal.');
    }
  }
}

// Generic work-order, carried-delivery and total-capacity checks remain in the
// central loader. This validator owns the stricter freight-only vocabulary and
// permits physical recovery sources created by death or food replacement.
export function validateFreightState(state) {
  if (!Array.isArray(state?.jobs)) return;
  const jobs = state.jobs.filter(freightJob);
  if (jobs.length > 1) throw new Error('Only one shuttle freight order may exist at a time.');
  for (const job of state.jobs) {
    if (!freightJob(job)) {
      if (Array.isArray(job?.sources) && job.sources.some(source => source?.kind === FREIGHT_SOURCE_KIND)) {
        throw new Error('Invalid freight reservation: reserved shuttle freight belongs only to an unload order.');
      }
      continue;
    }
    if (!exact(job, JOB_FIELDS) || job.building !== null || job.work !== FREIGHT_WORK ||
        !amount(job.remaining) || job.remaining > FREIGHT_WORK || !requestedResources(job.cost) ||
        !inventory(job.materials)) {
      throw new Error('Invalid freight work order.');
    }
    if (job.kind === 'loadCargo' && job.site !== 'surface') {
      throw new Error('Freight loading belongs to the surface shuttle.');
    }
    const terminal = terminalFor(state, job);
    validateSources(state, job, terminal);
  }
}
