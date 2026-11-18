// Paid work is transient: previews, serialized saves and cloned objects cannot
// carry a grant. A new electrical commit replaces the previous site's epoch.
const states = new WeakMap();
const object = value => value !== null && typeof value === 'object';
const ownsSite = (state, site) => object(state) && object(site) && state.sites?.[site.id] === site;
const position = tile => ({ x: tile.x, y: tile.y, z: tile.z ?? 0 });
const ownsTile = (site, tile) => object(tile) && Array.isArray(site.tiles) && site.tiles.includes(tile);

export function commitPowerWork(state, site, allocations) {
  if (!ownsSite(state, site) || !Number.isSafeInteger(state.tick) || state.tick < 0)
    throw new TypeError('Paid work requires the current state and site.');
  const grants = new Map();
  for (const [tile, amount] of allocations) {
    if (!ownsTile(site, tile) || typeof tile.building !== 'string' || !tile.building ||
        !Object.values(position(tile)).every(Number.isSafeInteger) ||
        !Number.isFinite(amount) || amount < 0 || grants.has(tile))
      throw new TypeError('Invalid paid work allocation.');
    grants.set(tile, { amount, building: tile.building, ...position(tile) });
  }
  let sites = states.get(state);
  if (!sites) { sites = new WeakMap(); states.set(state, sites); }
  sites.set(site, { tick: state.tick, siteId: site.id, grants });
}

function grantFor(state, site, tile) {
  if (!ownsSite(state, site) || !ownsTile(site, tile)) return null;
  const epoch = states.get(state)?.get(site), grant = epoch?.grants.get(tile);
  if (!grant || epoch.tick !== state.tick || epoch.siteId !== site.id || grant.building !== tile.building) return null;
  const p = position(tile);
  return grant.x === p.x && grant.y === p.y && grant.z === p.z ? grant : null;
}

export function availablePowerWork(state, site, tile) {
  return grantFor(state, site, tile)?.amount ?? 0;
}

export function claimPowerWork(state, site, tile) {
  const grant = grantFor(state, site, tile);
  if (!grant) return 0;
  const amount = grant.amount; grant.amount = 0; return amount;
}

export function closePowerWork(state, site) {
  states.get(state)?.delete(site);
}
