import { HEAT_CAPACITY, KELVIN_ZERO } from './thermal-units.js';
export { HEAT_CAPACITY } from './thermal-units.js';
import { refreshAtmosphere } from './atmosphere.js';
import {materialProfile} from './materials.js';
import {SOLID_FLOOR_CONDUCTANCE} from './material-data.js';
import { siteKind } from './region.js';
import { stairLinks, stairOpen, STAIR } from './vertical.js';
import { tileAt, cellKey, positionOf } from './spatial.js';
import { roomAtPosition, roomCellKey, roomCellPosition } from './room-locations.js';
import { localTemperatureOffset } from './environment.js';
import { neighbors } from './geometry.js';
import { refreshPower } from './power.js';
import { BUILDINGS } from './data.js';

// Abstract habitat thermal mass, separate from the gas inventory. Values are game balance units.
const ZERO = KELVIN_ZERO;
const capacity = r => r.volume * HEAT_CAPACITY;
export const temperature = r => r ? r.heat / capacity(r) - ZERO : null;
export const thermalSafe = r => !!r && temperature(r) >= 5 && temperature(r) <= 35;
const roomHere = (site,x,y,z=0) => roomAtPosition(site,{x,y,z});
export function outsideTemperature(site, tick) {
  const kind = siteKind(typeof site === 'string' ? { id: site } : site);
  return kind === 'surface' ? (tick % 300 < 220 ? 8 : -35) : ({ wreck: -60, comet: -100, solar: 90 }[kind] ?? 8);
}
export const outsideTemperatureAt = (site, x, y, z=0) => site.thermal.ambient + localTemperatureOffset(tileAt(site,{x,y,z}));
export const temperatureAt = (site, x, y, z=0) => temperature(roomHere(site, x, y, z)) ?? outsideTemperatureAt(site,x,y,z);
export function initializeClimate(t) {
  if (t.building === 'climate') t.climate ??= { enabled: true, target: 20, status: 'Waiting for climate control' };
  else delete t.climate;
}
export function initializeThermal(s) {
  for (const site of Object.values(s.sites)) {
    for (const r of site.rooms) r.heat = capacity(r) * (20 + ZERO);
    site.thermal = { ambient: outsideTemperature(site, s.tick), initial: site.rooms.reduce((n, r) => n + r.heat, 0), added: 0, removed: 0, environmentIn: 0, environmentOut: 0, equipment: 0, combustion:0, heating: 0, cooling: 0 };
    site.tiles.forEach(initializeClimate); refreshAtmosphere(site);
  }
  for (const c of s.crew) c.thermalStress = 0;
}
// Each retained floor cell keeps its share. New thermal mass enters at exterior temperature.
export function remapThermal(site, old, rooms) {
  if (!site.thermal) return;
  const energy = new Map(); old.forEach(r => r.cells.forEach(k => energy.set(roomCellKey(r,k), r.heat / r.volume)));
  for (const r of rooms) {
    r.heat = 0;
    for (const cell of r.cells) {
      const k=roomCellKey(r,cell);
      if (energy.has(k)) { r.heat += energy.get(k); energy.delete(k); }
      else { const p=roomCellPosition(r,cell),added = HEAT_CAPACITY * (outsideTemperatureAt(site,p.x,p.y,p.z) + ZERO); r.heat += added; site.thermal.added += added; }
    }
  }
  for (const amount of energy.values()) site.thermal.removed += amount;
}
function links(site) {
  const owners = new Map(); site.rooms.forEach((r, i) => r.cells.forEach(k => owners.set(roomCellKey(r,k), i)));
  const at = (x,y,z) => tileAt(site,{x,y,z});
  const external = t => !t || (t.terrain !== 'floor' && !['wall', 'door'].includes(t.building));
  const result = [];
  for (const [cell, a] of owners) {
    const [x, y, z] = cell.split(',').map(Number);
    for (const [nx, ny] of neighbors(x, y)) {
      const outside=at(nx,ny,z);
      if (external(outside)) result.push({ a, b: null, rate: .6, offset: localTemperatureOffset(outside ?? at(x,y,z)) });
    }
  }
  for (const t of site.tiles) if (['wall', 'door'].includes(t.building)) {
    const sides = new Set(), exteriorOffsets=[];
    for (const [x, y] of neighbors(t.x, t.y)) {
      const z=positionOf(t).z,owner = owners.get(cellKey({x,y,z})),outside=at(x,y,z);
      if (owner !== undefined) sides.add(owner);
      else if (external(outside)) { sides.add(null); exteriorOffsets.push(localTemperatureOffset(outside ?? t)); }
    }
    const offset=exteriorOffsets.length?exteriorOffsets.reduce((sum,value)=>sum+value,0)/exteriorOffsets.length:0;
    const open = t.hp <= 0 || (t.building === 'door' && (t.doorMode === 'open' || (t.doorMode !== 'closed' && t.doorUntil > site.atmosphere.tick)));
    const rate = open ? .8 : .015 * materialProfile(t,'structure').structure.conductivity + .4 * (1 - t.hp / 100) ** 2, ids = [...sides];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      result.push({ a: ids[a] === null ? ids[b] : ids[a], b: ids[a] === null ? null : ids[b], rate: rate / Math.max(1, ids.length - 1), offset });
    }
  }
  // A constructed slab conducts heat between the rooms it separates. It
  // transfers no gas; stair openings use their own finite exchange below.
  for(const t of site.tiles)if(t.terrain==='floor'&&t.z>0&&!t.verticalLink){
    const a=owners.get(cellKey(positionOf(t))),b=owners.get(cellKey({...positionOf(t),z:t.z-1}));
    if(a!==undefined&&b!==undefined&&a!==b)result.push({a,b,rate:SOLID_FLOOR_CONDUCTANCE*materialProfile(t,'floor').structure.conductivity});
  }
  for(const link of stairLinks(site))if(stairOpen(site,link)){
    const a=owners.get(cellKey(link.lower))??null,b=owners.get(cellKey(link.upper))??null;
    if(a!==b)result.push({a:a===null?b:a,b:a===null?null:b,rate:STAIR.heatConductance,offset:localTemperatureOffset(tileAt(site,a===null?link.lower:link.upper))});
  }
  return result;
}
export function updateThermal(s) {
  for (const site of Object.values(s.sites)) {
    const ledger = site.thermal; ledger.ambient = outsideTemperature(site, s.tick);
    const temps = site.rooms.map(temperature), changes = site.rooms.map(() => 0), outgoing = site.rooms.map(() => 0), transfers = [];
    for (const link of links(site)) {
      let { a, b, rate } = link;
      const temp = i => i === null ? ledger.ambient + (link.offset ?? 0) : temps[i];
      if (temp(a) < temp(b)) [a, b] = [b, a];
      const difference = temp(a) - temp(b);
      const equalization = difference / ((a === null ? 0 : 1 / capacity(site.rooms[a])) + (b === null ? 0 : 1 / capacity(site.rooms[b])));
      const amount = Math.min(difference * rate, equalization);
      if (amount > 0) { transfers.push({ a, b, amount }); if (a !== null) outgoing[a] += amount; }
    }
    for (const { a, b, amount } of transfers) {
      const moved = amount * (a === null ? 1 : Math.min(1, site.rooms[a].heat * .25 / outgoing[a]));
      if (a === null) ledger.environmentIn += moved; else changes[a] -= moved;
      if (b === null) ledger.environmentOut += moved; else changes[b] += moved;
    }
    site.rooms.forEach((r, i) => r.heat += changes[i]);
    for (const t of site.tiles) {
      initializeClimate(t); const r = roomHere(site, t.x, t.y, positionOf(t).z);
      if (t.building === 'climate') {
        const unit = t.climate;
        if (t.fire) unit.status = 'Fire at equipment';
        else if (!unit.enabled) unit.status = 'Paused by player';
        else if (t.hp <= 0) unit.status = 'Needs repair';
        else if (!t.powered) unit.status = 'No power';
        else if (!r) unit.status = 'Needs a habitat compartment';
        else {
          const difference = (unit.target - temperature(r)) * capacity(r), amount = Math.min(Math.abs(difference), 12 * t.hp / 100);
          r.heat += Math.sign(difference) * amount; ledger[difference >= 0 ? 'heating' : 'cooling'] += amount;
          unit.status = amount < 1e-8 ? 'Target reached' : difference > 0 ? 'Heating compartment' : 'Cooling compartment';
        }
      } else if (r && t.powered && BUILDINGS[t.building]?.demand) {
        const heat = BUILDINGS[t.building].demand * .35; r.heat += heat; ledger.equipment += heat;
      }
    }
    refreshAtmosphere(site);
  }
}
// Pressure suits protect exterior work; indoor exposure slowly accumulates and recovers in safe shelter.
export function thermalExposure(c, site, suited) {
  const temp = temperatureAt(site, c.x, c.y, positionOf(c).z), low = suited ? -120 : 5, high = suited ? 100 : 35;
  const strain = temp < low ? (temp - low) * .012 : temp > high ? (temp - high) * .012 : 0;
  c.thermalStress = strain ? Math.max(-100, Math.min(100, c.thermalStress + strain)) : Math.sign(c.thermalStress) * Math.max(0, Math.abs(c.thermalStress) - .8);
  if(c.thermalStress===0)c.thermalStress=0; // JSON stores zero without a sign.
  return Math.abs(c.thermalStress) > 70 ? (Math.abs(c.thermalStress) - 70) * .006 : 0;
}
export function setClimate(s, siteId, x, y, target, enabled,z=0) {
  const t = tileAt(s.sites[siteId],{x,y,z});
  if (t?.building !== 'climate' || !Number.isInteger(target) || target < -20 || target > 35 || typeof enabled !== 'boolean') return { ok: false, message: 'Choose a climate unit and a target from -20 to 35 °C.' };
  t.climate.target = target; t.climate.enabled = enabled; t.climate.status = enabled ? 'Waiting for climate control' : 'Paused by player'; refreshPower(s, s.sites[siteId]); return { ok: true };
}
export function validateThermal(s) {
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  for (const site of Object.values(s.sites)) {
    const h = site.thermal, keys = ['initial', 'added', 'removed', 'environmentIn', 'environmentOut', 'equipment', 'combustion', 'heating', 'cooling'];
    if (!h || !keys.every(k => nonnegative(h[k])) || h.ambient !== outsideTemperature(site, s.tick) || site.rooms.some(r => !nonnegative(r.heat))) throw new Error('Invalid thermal state.');
    const expected = h.initial + h.added - h.removed + h.environmentIn - h.environmentOut + h.equipment + h.combustion + h.heating - h.cooling;
    const actual = site.rooms.reduce((n, r) => n + r.heat, 0);
    if (Math.abs(actual - expected) > 1e-6 + Math.abs(expected) * 1e-9) throw new Error('Stored heat does not balance.');
    for (const t of site.tiles) {
      const c = t.climate;
      if (t.building !== 'climate') { if (c !== undefined) throw new Error('Climate controls attached to a missing unit.'); }
      else if (!c || typeof c.enabled !== 'boolean' || !Number.isInteger(c.target) || c.target < -20 || c.target > 35 || typeof c.status !== 'string' || c.status.length > 100) throw new Error('Invalid climate controls.');
    }
  }
  if (s.crew.some(c => !Number.isFinite(c.thermalStress) || Math.abs(c.thermalStress) > 100)) throw new Error('Invalid crew thermal stress.');
}
