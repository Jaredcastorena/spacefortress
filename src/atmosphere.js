import { FIRE } from './fire.js';
import { remapThermal } from './thermal.js';
import { immobile, impaired } from './mobility.js';
// Game-scale gas units, not a chemistry or engineering model.
export const GASES = ['oxygen', 'inert', 'co2'];
export const GAS_PER_TILE = 10;
export const SUIT_PER_POINT = .1;
export const emptyGas = () => ({ oxygen: 0, inert: 0, co2: 0 });
export const gasAmount = gas => GASES.reduce((n, k) => n + gas[k], 0);
export const mix = amount => ({ oxygen: amount * .21, inert: amount * .79, co2: 0 });
const key = (x, y) => `${x},${y}`;
const adjacent = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
const at = (site, x, y) => x >= 0 && y >= 0 && x < site.size && y < site.size ? site.tiles[y * site.size + x] : null;
const addGas = (to, gas, factor = 1) => { for (const k of GASES) to[k] += gas[k] * factor; };
export function initializeAtmosphere(site) {
  if (!site.atmosphere) site.atmosphere = { tick: 0, vented: emptyGas(), injected: emptyGas(), breathed: 0, refilled: 0 };
  for (const t of site.tiles) if (t.building === 'door') { t.doorMode ??= 'auto'; t.doorUntil ??= 0; }
}
export function refreshRoom(r) {
  const amount = gasAmount(r.gas), nominal = r.volume * GAS_PER_TILE;
  r.pressure = amount / nominal * 100;
  r.oxygenFraction = amount ? r.gas.oxygen / amount : 0;
  r.co2Fraction = amount ? r.gas.co2 / amount : 0;
  r.air = Math.max(0, Math.min(100, r.pressure, r.gas.oxygen / (nominal * .21) * 100, (1 - r.co2Fraction / .04) * 100));
  if ((r.smoke||0)/r.volume>=FIRE.smokeLimit)r.air=0;
  if (r.pressure > 150 || r.gas.oxygen / nominal > .3) r.air = 0;
}
export function breathable(r) {
  if (!r) return false;
  const oxygenPressure = r.gas.oxygen / (r.volume * GAS_PER_TILE);
  // Recycling/refill arithmetic can leave the .16 floor one adjacent double
  // low. Allow only that comparison roundoff; never clamp the stored gas.
  const minimumOxygenPressure = .16 - Number.EPSILON * .16;
  return (r.smoke||0)/r.volume<FIRE.smokeLimit && r.pressure >= 55 && r.pressure <= 150 && oxygenPressure >= minimumOxygenPressure && oxygenPressure <= .3 && r.co2Fraction <= .02;
}
export const roomAt = (site, x, y) => site.rooms.find(r => r.cells.includes(key(x, y)));
export const doorOpen = (t, tick) => t.hp <= 0 || t.doorMode === 'open' || (t.doorMode !== 'closed' && t.doorUntil > tick);
export function moveCrew(c, site, next) {
  if (immobile(c) || ((impaired(c) || c.rescue?.carrying) && site.atmosphere.tick % 2 !== 0)) return false;
  for (const [x, y] of [[c.x, c.y], next]) {
    const t = at(site, x, y);
    if (t?.building === 'door' && t.doorMode !== 'closed' && t.doorMode !== 'open') t.doorUntil = site.atmosphere.tick + 3;
  }
  [c.x, c.y] = next; return true;
}
export function setDoorMode(s, siteId, x, y, mode) {
  const site = s.sites[siteId], t = site && at(site, x, y);
  if (t?.building !== 'door' || !['auto', 'open', 'closed'].includes(mode)) return { ok: false, message: 'Select a pressure door.' };
  if (mode === 'closed' && s.crew.some(c => c.site === siteId && c.health > 0 && c.x === x && c.y === y)) return { ok: false, message: 'Wait for the crew member to clear the doorway.' };
  t.doorMode = mode; t.doorUntil = 0; refreshAtmosphere(site); return { ok: true };
}

// Compartments exclude door/wall tiles. Ports connect them without merging stored gas.
function connections(site) {
  const roomsByCell = new Map();
  site.rooms.forEach((r, i) => { r.leakArea = 0; r.sealed = true; r.cells.forEach(k => roomsByCell.set(k, i)); });
  const links = [], add = (a, b, conductance) => { if (a !== b && conductance > 0) links.push({ a, b, conductance }); };
  for (const [cell, a] of roomsByCell) {
    for (const [x, y] of adjacent(...cell.split(',').map(Number))) {
      const t = at(site, x, y);
      if (!t || (!['wall', 'door'].includes(t.building) && t.terrain !== 'floor')) add(a, null, .25);
    }
  }
  for (const t of site.tiles) {
    if (!['wall', 'door'].includes(t.building)) continue;
    const conductance = t.building === 'door' && doorOpen(t, site.atmosphere.tick) ? .6 : t.hp <= 0 ? .6 : .025 * (1 - t.hp / 100) ** 2;
    if (!conductance) continue;
    const sides = new Set();
    for (const [x, y] of adjacent(t.x, t.y)) {
      const n = at(site, x, y), r = roomsByCell.get(key(x, y));
      if (r !== undefined) sides.add(r);
      else if (!n || (!['wall', 'door'].includes(n.building) && n.terrain !== 'floor')) sides.add(null);
    }
    const ids = [...sides];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const left = ids[a] === null ? ids[b] : ids[a], right = ids[a] === null ? null : ids[b];
      add(left, right, conductance / Math.max(1, ids.length - 1));
    }
  }
  const exposed = new Set(links.filter(l => l.b === null).map(l => l.a));
  for (const l of links) if (l.b === null) site.rooms[l.a].leakArea += l.conductance;
  let changed = true;
  while (changed) { changed = false; for (const l of links) if (l.b !== null && exposed.has(l.a) !== exposed.has(l.b)) { exposed.add(l.a); exposed.add(l.b); changed = true; } }
  site.rooms.forEach((r, i) => r.sealed = !exposed.has(i));
  return links;
}
export function refreshAtmosphere(site) {
  site.rooms.forEach(refreshRoom); connections(site);
  const volume = site.rooms.reduce((n, r) => n + r.volume, 0);
  site.air = volume ? Math.round(site.rooms.reduce((n, r) => n + r.air * r.volume, 0) / volume) : 0;
}
export function updateRooms(site) {
  initializeAtmosphere(site);
  const old = site.rooms, seen = new Set(), rooms = [];
  for (const t of site.tiles) {
    const start = key(t.x, t.y);
    if (seen.has(start) || t.terrain !== 'floor' || ['wall', 'door'].includes(t.building)) continue;
    const queue = [[t.x, t.y]], cells = []; seen.add(start);
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i]; cells.push(key(x, y));
      for (const [nx, ny] of adjacent(x, y)) {
        const n = at(site, nx, ny), k = key(nx, ny);
        if (n && n.terrain === 'floor' && !['wall', 'door'].includes(n.building) && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
      }
    }
    rooms.push({ cells, volume: cells.length, gas: emptyGas(), smoke:0, sealed: true, leakArea: 0, air: 0, pressure: 0, oxygenFraction: 0, co2Fraction: 0 });
  }
  const owners = new Map(); rooms.forEach((r, i) => r.cells.forEach(k => owners.set(k, i)));
  for (const previous of old) {
    const overlap = new Map();
    for (const k of previous.cells) if (owners.has(k)) { const i = owners.get(k); overlap.set(i, (overlap.get(i) || 0) + 1); }
    const retained = [...overlap.values()].reduce((n, v) => n + v, 0);
    if (!retained) {addGas(site.atmosphere.vented, previous.gas);if(site.fireSafety)site.fireSafety.smokeVented+=previous.smoke||0;}
    else for (const [i, count] of overlap) {addGas(rooms[i].gas, previous.gas, count / retained);rooms[i].smoke+=(previous.smoke||0)*count/retained;}
  }
  remapThermal(site, old, rooms);
  site.rooms = rooms; refreshAtmosphere(site);
}
export function fillRoom(r, pressure = 100) { r.gas = mix(r.volume * GAS_PER_TILE * pressure / 100); refreshRoom(r); }

function flow(site, links) {
  const smokeSnapshot=site.rooms.map(r=>r.smoke||0);
  const snapshot = site.rooms.map(r => ({ ...r.gas })), outgoing = site.rooms.map(() => 0), transfers = [];
  for (const link of links) {
    let { a, b } = link;
    const density = i => i === null ? 0 : gasAmount(snapshot[i]) / site.rooms[i].volume;
    if (density(a) < density(b)) [a, b] = [b, a];
    if (a === null) continue;
    const difference = density(a) - density(b);
    const equalization = b === null ? Infinity : difference / (1 / site.rooms[a].volume + 1 / site.rooms[b].volume);
    const amount = Math.min(difference * link.conductance, equalization);
    if (amount > 0) { transfers.push({ a, b, amount }); outgoing[a] += amount; }
    // Diffusion mixes composition even when both compartments have equal pressure.
    if (b !== null) {
      const exchange = link.conductance * .5 * Math.min(density(a), density(b));
      if (exchange > 0) { transfers.push({ a, b, amount: exchange }, { a: b, b: a, amount: exchange }); outgoing[a] += exchange; outgoing[b] += exchange; }
    }
  }
  for (const { a, b, amount } of transfers) {
    const total = gasAmount(snapshot[a]);
    const moved = amount * Math.min(1, total * .5 / outgoing[a]);
    const portion = moved / total;
    addGas(site.rooms[a].gas, snapshot[a], -portion);
    const smoke=smokeSnapshot[a]*portion;site.rooms[a].smoke-=smoke;if(b===null){if(site.fireSafety)site.fireSafety.smokeVented+=smoke;}else site.rooms[b].smoke+=smoke;
    addGas(b === null ? site.atmosphere.vented : site.rooms[b].gas, snapshot[a], portion);
  }
}
function lifeSupport(site) {
  for (const t of site.tiles) {
    if (t.building !== 'scrubber' || !t.machine) continue;
    const m = t.machine, r = roomAt(site, t.x, t.y);
    if(t.fire){m.status='Fire at equipment';continue;}
    if (!m.enabled) { m.status = 'Paused by player'; continue; }
    if (!t.hp) { m.status = 'Needs repair'; continue; }
    if (!t.powered) { m.status = 'No power'; continue; }
    if (!r) { m.status = 'Needs a habitat compartment'; continue; }
    const filtered=Math.min(r.smoke||0,FIRE.filterRate*t.hp/100);r.smoke-=filtered;if(site.fireSafety)site.fireSafety.smokeCleared+=filtered;
    const recycled = Math.min(r.gas.co2, .15 * t.hp / 100);
    r.gas.co2 -= recycled; r.gas.oxygen += recycled;
    const nominal = r.volume * GAS_PER_TILE, amount = gasAmount(r.gas);
    const deficientOxygen = r.gas.oxygen < nominal * .195;
    const requested = Math.min(2 * t.hp / 100, Math.max(0, nominal - amount) + (deficientOxygen ? 2 : 0));
    const supplied = Math.min(requested, m.input.air || 0);
    if (supplied > 0) {
      m.input.air -= supplied; if (m.input.air < 1e-12) delete m.input.air;
      const fresh = mix(supplied); addGas(r.gas, fresh); addGas(site.atmosphere.injected, fresh);
      const excess = Math.max(0, gasAmount(r.gas) - nominal);
      if (excess) { const vent = { ...r.gas }, fraction = excess / gasAmount(r.gas); addGas(r.gas, vent, -fraction); addGas(site.atmosphere.vented, vent, fraction);const smoke=(r.smoke||0)*fraction;r.smoke-=smoke;if(site.fireSafety)site.fireSafety.smokeVented+=smoke; }
    }
    m.status = requested > 1e-8 ? supplied ? 'Supplying breathing mix' : 'Breathing mix empty; recycling only' : 'Recycling exhaled gas';
  }
}
export function updateAtmosphere(s) {
  for (const site of Object.values(s.sites)) {
    site.atmosphere.tick = s.tick;
    flow(site, connections(site)); lifeSupport(site); refreshAtmosphere(site);
  }
}
export function breathe(site, c) {
  const r = roomAt(site, c.x, c.y), demand = c.site === 'solar' ? .018 : c.job ? .01 : .0075;
  if (breathable(r)) {
    const consumed = Math.min(demand, r.gas.oxygen);
    r.gas.oxygen -= consumed; r.gas.co2 += consumed; site.atmosphere.breathed += consumed;
    const refill = Math.min(2, 100 - c.oxygen, Math.max(0, r.gas.oxygen - r.volume * GAS_PER_TILE * .16) / SUIT_PER_POINT);
    c.oxygen += refill; r.gas.oxygen -= refill * SUIT_PER_POINT; site.atmosphere.refilled += refill * SUIT_PER_POINT;
    refreshRoom(r);
  } else {
    const consumed = Math.min(c.oxygen * SUIT_PER_POINT, demand);
    c.oxygen = Math.max(0, c.oxygen - consumed / SUIT_PER_POINT);
    site.atmosphere.vented.co2 += consumed; site.atmosphere.breathed += consumed;
  }
}
