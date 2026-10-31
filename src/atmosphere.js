import { roomPressure, roomOxygenPressure, roomPressureFactor, gasAtRoomPressure } from './room-pressure.js';
import {roomKelvin,roomHeatCapacity,roomEqualizeAmount,parcelHeat,roomFillAmount,exportRoomHeat,importRoomHeat,GAS_REFERENCE_KELVIN} from './gas-thermal.js';
export { GAS_PER_TILE } from './room-pressure.js';
import { neighbors } from './geometry.js';
import { stairDestination, touchStairHatch, stairLinks, stairOpen, STAIR } from './vertical.js';
import { horizontalStep, tileAt, cellKey, positionOf } from './spatial.js';
import { roomAtPosition, roomCellKey } from './room-locations.js';
import { FIRE } from './fire.js';
import { remapThermal } from './thermal.js';
import { immobile, impaired } from './mobility.js';
import { airlockDoorPermit, airlockControlOwner } from './airlock-access.js';
// Game-scale gas units, not a chemistry or engineering model.
export const GASES = ['oxygen', 'inert', 'co2'];
export const SUIT_PER_POINT = .1;
export const emptyGas = () => ({ oxygen: 0, inert: 0, co2: 0 });
export const gasAmount = gas => GASES.reduce((n, k) => n + gas[k], 0);
export const mix = amount => ({ oxygen: amount * .21, inert: amount * .79, co2: 0 });
const key = (x, y) => `${x},${y}`;
const adjacent = neighbors;
const at = (site,x,y,z=0) => tileAt(site,{x,y,z});
const addGas = (to, gas, factor = 1) => { for (const k of GASES) to[k] += gas[k] * factor; };
export function initializeAtmosphere(site) {
  if (!site.atmosphere) site.atmosphere = { tick: 0, vented: emptyGas(), injected: emptyGas(), breathed: 0, refilled: 0 };
  for (const t of site.tiles) if (t.building === 'door') { t.doorMode ??= 'auto'; t.doorUntil ??= 0; }
}
export function refreshRoom(r) {
  const amount = gasAmount(r.gas);
  r.pressure = roomPressure(r);
  r.oxygenFraction = amount ? r.gas.oxygen / amount : 0;
  r.co2Fraction = amount ? r.gas.co2 / amount : 0;
  r.air = Math.max(0, Math.min(100, r.pressure, roomOxygenPressure(r) / .21 * 100, (1 - r.co2Fraction / .04) * 100));
  if ((r.smoke||0)/r.volume>=FIRE.smokeLimit)r.air=0;
  if (r.pressure > 150 || roomOxygenPressure(r) > .3) r.air = 0;
}
export function breathingBlock(r) {
  if (!r) return 'exterior';
  const oxygenPressure = roomOxygenPressure(r), pressure = roomPressure(r);
  // Recycling/refill arithmetic can leave the .16 floor one adjacent double
  // low. Allow only that comparison roundoff; never clamp the stored gas.
  const minimumOxygenPressure = .16 - Number.EPSILON * .16;
  if (!((r.smoke||0)/r.volume < FIRE.smokeLimit)) return 'smoke';
  if (!(pressure >= 55)) return 'low_pressure';
  if (!(pressure <= 150)) return 'high_pressure';
  if (!(oxygenPressure >= minimumOxygenPressure)) return 'low_oxygen';
  if (!(oxygenPressure <= .3)) return 'high_oxygen';
  const amount=gasAmount(r.gas),co2Fraction=amount?r.gas.co2/amount:0;
  if (!(co2Fraction <= .02)) return 'high_co2';
  return null;
}
export const breathable = r => breathingBlock(r) === null;
export function breathingStatus(r) {
  const block = breathingBlock(r);
  return { breathable: block === null, block, oxygenPressure: roomOxygenPressure(r),
    minimumOxygenPressure: .16, maximumOxygenPressure: .3 };
}
export const roomAt = (site,x,y,z=0) => roomAtPosition(site,{x,y,z});
export const doorOpen = (t, tick) => t.hp <= 0 || t.doorMode === 'open' || (t.doorMode !== 'closed' && t.doorUntil > tick);
export function moveCrew(c, site, next) {
  const from=positionOf(c),destination=horizontalStep(site,c,next)||stairDestination(site,c,next);if(!destination)return false;
  next=[destination.x,destination.y];
  if (!airlockDoorPermit(site, c, {x:c.x,y:c.y,z:c.z??0}, destination)) return false;
  if (immobile(c) || ((impaired(c) || c.rescue?.carrying) && site.atmosphere.tick % 2 !== 0)) return false;
  if(from.z!==destination.z&&!touchStairHatch(site,from,destination))return false;
  for (const p of [from,destination]) {
    const t = tileAt(site,p);
    if (t?.building === 'door' && t.doorMode !== 'closed' && t.doorMode !== 'open') t.doorUntil = site.atmosphere.tick + 3;
  }
  [c.x, c.y] = next; c.z = destination.z; return true;
}
export function setDoorMode(s, siteId, x, y, mode,z=0) {
  const site = s.sites[siteId], t = site && at(site, x, y, z);
  if (t?.building !== 'door' || !['auto', 'open', 'closed'].includes(mode)) return { ok: false, message: 'Select a pressure door.' };
  if (airlockControlOwner(site,t,'building')) return {ok:false,code:'airlock_controlled',message:'This door is controlled by its airlock. Pause, release one side, or unbind at the controller.'};
  if (mode === 'closed' && s.crew.some(c => c.site === siteId && c.health > 0 && c.x === x && c.y === y && positionOf(c).z === z)) return { ok: false, message: 'Wait for the crew member to clear the doorway.' };
  t.doorMode = mode; t.doorUntil = 0; refreshAtmosphere(site); return { ok: true };
}

// Compartments exclude door/wall tiles. Ports connect them without merging stored gas.
function connections(site) {
  const roomsByCell = new Map();
  site.rooms.forEach((r, i) => { r.leakArea = 0; r.sealed = true; r.cells.forEach(k => roomsByCell.set(roomCellKey(r,k), i)); });
  const links = [], add = (a, b, conductance) => { if (a !== b && conductance > 0) links.push({ a, b, conductance }); };
  for (const [cell, a] of roomsByCell) {
    const [cx,cy,z]=cell.split(',').map(Number);
    for (const [x, y] of adjacent(cx,cy)) {
      const t = at(site, x, y, z);
      if (!t || (!['wall', 'door'].includes(t.building) && t.terrain !== 'floor')) add(a, null, .25);
    }
  }
  for (const t of site.tiles) {
    if (!['wall', 'door'].includes(t.building)) continue;
    const conductance = t.building === 'door' && doorOpen(t, site.atmosphere.tick) ? .6 : t.hp <= 0 ? .6 : .025 * (1 - t.hp / 100) ** 2;
    if (!conductance) continue;
    const sides = new Set();
    for (const [x, y] of adjacent(t.x, t.y)) {
      const z=positionOf(t).z, n = at(site, x, y, z), r = roomsByCell.get(cellKey({x,y,z}));
      if (r !== undefined) sides.add(r);
      else if (!n || (!['wall', 'door'].includes(n.building) && n.terrain !== 'floor')) sides.add(null);
    }
    const ids = [...sides];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const left = ids[a] === null ? ids[b] : ids[a], right = ids[a] === null ? null : ids[b];
      add(left, right, conductance / Math.max(1, ids.length - 1));
    }
  }
  for(const link of stairLinks(site))if(stairOpen(site,link)){
    const lower=roomsByCell.get(cellKey(link.lower))??null,upper=roomsByCell.get(cellKey(link.upper))??null;
    add(lower===null?upper:lower,lower===null?null:upper,STAIR.gasConductance);
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
    const z=positionOf(t).z, start = cellKey(positionOf(t));
    if (seen.has(start) || t.terrain !== 'floor' || ['wall', 'door'].includes(t.building)) continue;
    const queue = [[t.x, t.y]], cells = []; seen.add(start);
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i]; cells.push(key(x, y));
      for (const [nx, ny] of adjacent(x, y)) {
        const n = at(site, nx, ny, z), k = cellKey({x:nx,y:ny,z});
        if (n && n.terrain === 'floor' && !['wall', 'door'].includes(n.building) && !seen.has(k)) { seen.add(k); queue.push([nx, ny]); }
      }
    }
    rooms.push({ z, cells, volume: cells.length, gas: emptyGas(), smoke:0, sealed: true, leakArea: 0, air: 0, pressure: 0, oxygenFraction: 0, co2Fraction: 0 });
  }
  const owners = new Map(); rooms.forEach((r, i) => r.cells.forEach(k => owners.set(roomCellKey(r,k), i)));
  for (const previous of old) {
    const overlap = new Map();
    for (const k of previous.cells) if (owners.has(roomCellKey(previous,k))) { const i = owners.get(roomCellKey(previous,k)); overlap.set(i, (overlap.get(i) || 0) + 1); }
    const retained = [...overlap.values()].reduce((n, v) => n + v, 0);
    if (!retained) {addGas(site.atmosphere.vented, previous.gas);if(site.fireSafety)site.fireSafety.smokeVented+=previous.smoke||0;}
    else for (const [i, count] of overlap) {addGas(rooms[i].gas, previous.gas, count / retained);rooms[i].smoke+=(previous.smoke||0)*count/retained;}
  }
  remapThermal(site, old, rooms);
  site.rooms = rooms; refreshAtmosphere(site);
}
export function fillRoom(r, pressure = 100) { const amount=gasAtRoomPressure(r,pressure);if(amount===null)throw new Error('Room pressure target cannot be reached at this temperature.');const kelvin=roomKelvin(r);r.gas=mix(amount);if(r.heat!==undefined)r.heat=roomHeatCapacity(r)*kelvin;refreshRoom(r); }

function flow(site, links) {
  const smokeSnapshot=site.rooms.map(r=>r.smoke||0), factors=site.rooms.map(roomPressureFactor), kelvins=site.rooms.map(roomKelvin);
  const snapshot = site.rooms.map(r => ({ ...r.gas })), outgoing = site.rooms.map(() => 0), transfers = [];
  for (const link of links) {
    let { a, b } = link;
    const density = i => i === null ? 0 : gasAmount(snapshot[i]) / site.rooms[i].volume;
    const pressureDensity = i => i === null ? 0 : density(i) * factors[i];
    if (pressureDensity(a) < pressureDensity(b)) [a, b] = [b, a];
    if (a === null) continue;
    const difference = pressureDensity(a) - pressureDensity(b);
    const equalization = b === null ? Infinity : roomEqualizeAmount(site.rooms[a],site.rooms[b]);
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
    const heat=parcelHeat(moved,kelvins[a]);site.rooms[a].heat-=heat;
    if(b===null)site.thermal.gasVented+=heat;else site.rooms[b].heat+=heat;
    addGas(site.rooms[a].gas, snapshot[a], -portion);
    const smoke=smokeSnapshot[a]*portion;site.rooms[a].smoke-=smoke;if(b===null){if(site.fireSafety)site.fireSafety.smokeVented+=smoke;}else site.rooms[b].smoke+=smoke;
    addGas(b === null ? site.atmosphere.vented : site.rooms[b].gas, snapshot[a], portion);
  }
}
function lifeSupport(site) {
  for (const t of site.tiles) {
    if (t.building !== 'scrubber' || !t.machine) continue;
    const m = t.machine, r = roomAt(site, t.x, t.y, positionOf(t).z);
    if(t.fire){m.status='Fire at equipment';continue;}
    if (!m.enabled) { m.status = 'Paused by player'; continue; }
    if (!t.hp) { m.status = 'Needs repair'; continue; }
    if (!t.powered) { m.status = 'No power'; continue; }
    if (!r) { m.status = 'Needs a habitat compartment'; continue; }
    const filtered=Math.min(r.smoke||0,FIRE.filterRate*t.hp/100);r.smoke-=filtered;if(site.fireSafety)site.fireSafety.smokeCleared+=filtered;
    const recycled = Math.min(r.gas.co2, .15 * t.hp / 100);
    r.gas.co2 -= recycled; r.gas.oxygen += recycled;
    const deficientOxygen = roomOxygenPressure(r) < .195;
    const rate=2*t.hp/100,requested=deficientOxygen?rate:roomFillAmount(r,100,GAS_REFERENCE_KELVIN,rate);
    const supplied=Math.min(requested,m.input.air||0);
    if (supplied > 0) {
      m.input.air -= supplied; if (m.input.air < 1e-12) delete m.input.air;
      const fresh = mix(supplied); addGas(r.gas, fresh); addGas(site.atmosphere.injected, fresh);importRoomHeat(site,r,parcelHeat(supplied,GAS_REFERENCE_KELVIN),{boundary:true});
      const nominal=gasAtRoomPressure(r,100),excess=nominal===null?0:Math.max(0,gasAmount(r.gas)-nominal);
      if (excess) { exportRoomHeat(site,r,excess,{boundary:true}); const vent = { ...r.gas }, fraction = excess / gasAmount(r.gas); addGas(r.gas, vent, -fraction); addGas(site.atmosphere.vented, vent, fraction);const smoke=(r.smoke||0)*fraction;r.smoke-=smoke;if(site.fireSafety)site.fireSafety.smokeVented+=smoke; }
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
// Plan transfers against the existing safety predicate. If boundary arithmetic
// rounds outward, reduce the transfer rather than repairing stored gas afterward.
function safeOxygenBudget(r, requested, breathing) {
  if (!breathable(r)) return 0;
  const amount = gasAmount(r.gas);
  const maximum = Math.max(0, Math.min(requested, r.gas.oxygen - gasAtRoomPressure(r,16),
    breathing ? amount * .02 - r.gas.co2 : amount - r.gas.co2 / .02,
    breathing ? Infinity : amount - gasAtRoomPressure(r,55)));
  const safe = transfer => {
    const probe = { ...r, gas: { ...r.gas, oxygen: r.gas.oxygen - transfer,
      co2: r.gas.co2 + (breathing ? transfer : 0) } };
    if(!breathing)probe.heat-=parcelHeat(transfer,roomKelvin(r));
    refreshRoom(probe); return breathable(probe);
  };
  // Preserve the existing one-ULP oxygen allowance when a complete breath is
  // safe; subtracting the nominal floor first can manufacture a tiny shortage.
  if (safe(requested)) return requested;
  if (safe(maximum)) return maximum;
  let low = 0, high = maximum;
  for (let i = 0; i < 53; i++) {
    const middle = low + (high - low) / 2;
    if (middle === low || middle === high) break;
    if (safe(middle)) low = middle; else high = middle;
  }
  return low;
}
function shareOxygen(entries, field, budget, request) {
  const requests = entries.map(request), total = requests.reduce((sum, n) => sum + n, 0);
  let used = 0;
  entries.forEach((entry, i) => {
    const amount = budget >= total ? requests[i]
      : Math.min(requests[i], Math.max(0, budget - used), total ? budget * requests[i] / total : 0);
    entry.result[field] = amount; used += amount;
  });
  return used;
}
export function breatheBatch(site, crew) {
  const entries = crew.filter(c => c.site === site.id && c.site !== 'transit' && (c.health === undefined || c.health > 0))
    .map(c => ({ c, room: roomAt(site, c.x, c.y, positionOf(c).z), demand: c.site === 'solar' ? .018 : c.job ? .01 : .0075,
      result: { roomOxygen: 0, suitOxygen: 0, refillOxygen: 0, unmetOxygen: 0 } }))
    .sort((a, b) => a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0);
  const groups = new Map();
  for (const entry of entries) if (breathable(entry.room)) {
    if (!groups.has(entry.room)) groups.set(entry.room, []);
    groups.get(entry.room).push(entry);
  }
  // All bodily demand is allocated before any optional charging. Positions and
  // demands are a snapshot; crew movement cannot change this tick's allocation.
  for (const [r, occupants] of groups) {
    const demand = occupants.reduce((sum, entry) => sum + entry.demand, 0);
    const consumed = shareOxygen(occupants, 'roomOxygen', safeOxygenBudget(r, demand, true), entry => entry.demand);
    r.gas.oxygen -= consumed; r.gas.co2 += consumed;
    refreshRoom(r);
  }
  for (const { c, demand, result } of entries) {
    const remaining = demand - result.roomOxygen;
    result.suitOxygen = Math.min(c.oxygen * SUIT_PER_POINT, remaining);
    result.unmetOxygen = remaining - result.suitOxygen;
    c.oxygen = Math.max(0, c.oxygen - result.suitOxygen / SUIT_PER_POINT);
    site.atmosphere.vented.co2 += result.suitOxygen;
    site.atmosphere.breathed += result.roomOxygen + result.suitOxygen;
  }
  for (const [r, occupants] of groups) {
    const request = entry => Math.min(2, 100 - entry.c.oxygen) * SUIT_PER_POINT;
    const requested = occupants.reduce((sum, entry) => sum + request(entry), 0);
    const refilled = shareOxygen(occupants, 'refillOxygen', safeOxygenBudget(r, requested, false), request);
    for (const { c, result } of occupants) c.oxygen = Math.min(100, c.oxygen + result.refillOxygen / SUIT_PER_POINT);
    exportRoomHeat(site,r,refilled,{boundary:true});r.gas.oxygen -= refilled; site.atmosphere.refilled += refilled;
    refreshRoom(r);
  }
  return new Map(entries.map(({ c, result }) => [c.id, result]));
}
export function breathe(site, c) { return breatheBatch(site, [c]).get(c.id); }
