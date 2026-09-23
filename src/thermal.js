import { refreshPower } from './power.js';
import { BUILDINGS } from './data.js';

// Abstract habitat thermal mass, separate from the gas inventory. Values are game balance units.
export const HEAT_CAPACITY = 20;
const ZERO = 273.15;
const capacity = r => r.volume * HEAT_CAPACITY;
export const temperature = r => r ? r.heat / capacity(r) - ZERO : null;
export const thermalSafe = r => !!r && temperature(r) >= 5 && temperature(r) <= 35;
const roomHere = (site, x, y) => site.rooms.find(r => r.cells.includes(`${x},${y}`));
export const outsideTemperature = (siteId, tick) => siteId === 'surface' ? (tick % 300 < 220 ? 8 : -35) : ({ wreck: -60, comet: -100, solar: 90 }[siteId] ?? 8);
export const temperatureAt = (site, x, y) => temperature(roomHere(site, x, y)) ?? site.thermal.ambient;
export function initializeClimate(t) {
  if (t.building === 'climate') t.climate ??= { enabled: true, target: 20, status: 'Waiting for climate control' };
  else delete t.climate;
}
export function initializeThermal(s) {
  for (const site of Object.values(s.sites)) {
    for (const r of site.rooms) r.heat = capacity(r) * (20 + ZERO);
    site.thermal = { ambient: outsideTemperature(site.id, s.tick), initial: site.rooms.reduce((n, r) => n + r.heat, 0), added: 0, removed: 0, environmentIn: 0, environmentOut: 0, equipment: 0, combustion:0, heating: 0, cooling: 0 };
    site.tiles.forEach(initializeClimate);
  }
  for (const c of s.crew) c.thermalStress = 0;
}
// Each retained floor cell keeps its share. New thermal mass enters at exterior temperature.
export function remapThermal(site, old, rooms) {
  if (!site.thermal) return;
  const energy = new Map(); old.forEach(r => r.cells.forEach(k => energy.set(k, r.heat / r.volume)));
  for (const r of rooms) {
    r.heat = 0;
    for (const k of r.cells) {
      if (energy.has(k)) { r.heat += energy.get(k); energy.delete(k); }
      else { const added = HEAT_CAPACITY * (site.thermal.ambient + ZERO); r.heat += added; site.thermal.added += added; }
    }
  }
  for (const amount of energy.values()) site.thermal.removed += amount;
}
function links(site) {
  const owners = new Map(); site.rooms.forEach((r, i) => r.cells.forEach(k => owners.set(k, i)));
  const at = (x, y) => x >= 0 && y >= 0 && x < site.size && y < site.size ? site.tiles[y * site.size + x] : null;
  const neighbors = t => [[t.x + 1, t.y], [t.x - 1, t.y], [t.x, t.y + 1], [t.x, t.y - 1]];
  const external = t => !t || (t.terrain !== 'floor' && !['wall', 'door'].includes(t.building));
  const result = [];
  for (const [cell, a] of owners) {
    const [x, y] = cell.split(',').map(Number);
    for (const [nx, ny] of neighbors({ x, y })) if (external(at(nx, ny))) result.push({ a, b: null, rate: .6 });
  }
  for (const t of site.tiles) if (['wall', 'door'].includes(t.building)) {
    const sides = new Set();
    for (const [x, y] of neighbors(t)) { const owner = owners.get(`${x},${y}`); if (owner !== undefined) sides.add(owner); else if (external(at(x, y))) sides.add(null); }
    const open = t.hp <= 0 || (t.building === 'door' && (t.doorMode === 'open' || (t.doorMode !== 'closed' && t.doorUntil > site.atmosphere.tick)));
    const rate = open ? .8 : .015 + .4 * (1 - t.hp / 100) ** 2, ids = [...sides];
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      result.push({ a: ids[a] === null ? ids[b] : ids[a], b: ids[a] === null ? null : ids[b], rate: rate / Math.max(1, ids.length - 1) });
    }
  }
  return result;
}
export function updateThermal(s) {
  for (const site of Object.values(s.sites)) {
    const ledger = site.thermal; ledger.ambient = outsideTemperature(site.id, s.tick);
    const temps = site.rooms.map(temperature), changes = site.rooms.map(() => 0), outgoing = site.rooms.map(() => 0), transfers = [];
    for (const link of links(site)) {
      let { a, b, rate } = link;
      const temp = i => i === null ? ledger.ambient : temps[i];
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
      initializeClimate(t); const r = roomHere(site, t.x, t.y);
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
  }
}
// Pressure suits protect exterior work; indoor exposure slowly accumulates and recovers in safe shelter.
export function thermalExposure(c, site, suited) {
  const temp = temperatureAt(site, c.x, c.y), low = suited ? -120 : 5, high = suited ? 100 : 35;
  const strain = temp < low ? (temp - low) * .012 : temp > high ? (temp - high) * .012 : 0;
  c.thermalStress = strain ? Math.max(-100, Math.min(100, c.thermalStress + strain)) : Math.sign(c.thermalStress) * Math.max(0, Math.abs(c.thermalStress) - .8);
  return Math.abs(c.thermalStress) > 70 ? (Math.abs(c.thermalStress) - 70) * .006 : 0;
}
export function setClimate(s, siteId, x, y, target, enabled) {
  const t = s.sites[siteId]?.tiles.find(t => t.x === x && t.y === y);
  if (t?.building !== 'climate' || !Number.isInteger(target) || target < -20 || target > 35 || typeof enabled !== 'boolean') return { ok: false, message: 'Choose a climate unit and a target from -20 to 35 °C.' };
  t.climate.target = target; t.climate.enabled = enabled; t.climate.status = enabled ? 'Waiting for climate control' : 'Paused by player'; refreshPower(s, s.sites[siteId]); return { ok: true };
}
export function validateThermal(s) {
  const nonnegative = n => Number.isFinite(n) && n >= 0;
  for (const site of Object.values(s.sites)) {
    const h = site.thermal, keys = ['initial', 'added', 'removed', 'environmentIn', 'environmentOut', 'equipment', 'combustion', 'heating', 'cooling'];
    if (!h || !keys.every(k => nonnegative(h[k])) || h.ambient !== outsideTemperature(site.id, s.tick) || site.rooms.some(r => !nonnegative(r.heat))) throw new Error('Invalid thermal state.');
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
