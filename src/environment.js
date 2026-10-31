import { WORLD_BIOMES } from './world-generation.js';
import { positionOf } from './spatial.js';

const fields = ['biome', 'temperatureOffset', 'basin', 'initialWater'];
const amount = (value, maximum) => Number.isFinite(value) && value >= 0 && value <= maximum;
const owns = (tile, field) => Object.hasOwn(tile, field);

// Biome conditions belong to the ground deck. Built floors keep the underlying
// metadata, but only exposed ground can retain a natural pool.
export const localTemperatureOffset = tile => tile && positionOf(tile).z === 0 ? tile.temperatureOffset ?? 0 : 0;
export const retainedWaterDepth = tile => tile?.terrain === 'ground' && positionOf(tile).z === 0 ? tile.basin ?? 0 : 0;

function validateTile(tile, { transient = false } = {}) {
  if (!fields.some(field => owns(tile, field))) return;
  if (positionOf(tile).z !== 0) throw new Error('Natural environment belongs to the ground deck.');
  if (owns(tile, 'biome') && (typeof tile.biome !== 'string' || !Object.hasOwn(WORLD_BIOMES, tile.biome))) throw new Error('Invalid tile biome.');
  if (owns(tile, 'temperatureOffset') && (!Number.isInteger(tile.temperatureOffset) || tile.temperatureOffset < -25 || tile.temperatureOffset > 25)) throw new Error('Invalid local temperature offset.');
  if (owns(tile, 'basin') && !amount(tile.basin, 2)) throw new Error('Invalid natural basin depth.');
  if (owns(tile, 'initialWater') && (!transient || !amount(tile.initialWater, 4) || tile.initialWater > 0 && tile.terrain !== 'ground')) throw new Error('Invalid unseeded natural water.');
}

// Only the new-map constructor calls this, after ordinary liquid initialization.
// Consuming the transient seed makes a second call a no-op; loaded saves never
// acquire water from biome metadata or refill a depleted basin.
export function seedNaturalLiquids(site) {
  const seeds = site.tiles.filter(tile => owns(tile, 'initialWater'));
  if (!seeds.length) return 0;
  if (!site.liquids || owns(site.liquids, 'initial') && !amount(site.liquids.initial, site.tiles.length * 4)) throw new Error('Natural water needs an initialized liquid ledger.');
  let initial = 0;
  for (const tile of seeds) {
    validateTile(tile, { transient: true });
    if (!amount(tile.liquid, 4) || tile.liquid + tile.initialWater > 4) throw new Error('Natural water exceeds tile capacity.');
    initial += tile.initialWater;
  }
  if ((site.liquids.initial ?? 0) + initial > site.tiles.length * 4) throw new Error('Invalid natural water ledger.');
  for (const tile of seeds) { tile.liquid += tile.initialWater; delete tile.initialWater; }
  if (initial > 0) site.liquids.initial = (site.liquids.initial ?? 0) + initial;
  return initial;
}

export function validateEnvironment(s) {
  for (const site of Object.values(s.sites)) {
    for (const tile of site.tiles) validateTile(tile);
    if (site.liquids && owns(site.liquids, 'initial') && !amount(site.liquids.initial, site.tiles.length * 4)) throw new Error('Invalid natural water ledger.');
  }
}
