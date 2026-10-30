import { routePower } from './power-routing.js';
import { LIQUID, wetCable, shortCable } from './liquids.js';
import { initializeReactorTile, tripReactor, reactorBlock, reactorOutput, generateReactor } from './reactors.js';
import { initializeClimate } from './thermal.js';
import { initializeMaintenance } from './maintenance.js';
import { BUILDINGS } from './data.js';
import {isDay,solarStatus} from './solar.js';
export {isDay} from './solar.js';
import { buildPowerTopology, powerTileKey, breakerTerminals, breakerContactClosed, branchForBreaker } from './power-topology.js';
import { initializeBreakerTile, tripBreaker, overloadMode, wetFaultMode, BREAKER_OVERLOAD_TICKS } from './breakers.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { tileAt } from './geometry.js';
import { horizontalNeighbors, tileAt as tileAtPosition, positionOf } from './spatial.js';

export const BATTERY_CAPACITY = 120;
export const BATTERY_RATE = 20;
export const CELL_CHARGE = 100;
export const CELL_INSTALL_WORK = 4;
export const electrical = t => !!(BUILDINGS[t.building]?.output || BUILDINGS[t.building]?.demand || t.building === 'battery' || t.building === 'breaker');
export const key = powerTileKey;
const at = tileAt;
const neighbors = (site, t) => horizontalNeighbors(positionOf(t)).map(p => tileAtPosition(site,p)).filter(Boolean);
export function initializeElectrical(t) {
  initializeMaintenance(t); initializeClimate(t); initializeReactorTile(t); initializeBreakerTile(t);
  t.cable ??= null;
  if (t.building === 'battery') t.charge ??= 0;
  if (BUILDINGS[t.building]?.demand) t.powerPriority ??= t.building === 'scrubber' ? 5 : 3;
}
export function releaseBatteryEnergy(site, t) {
  site.energy.discarded += t.charge || 0; t.charge = 0;
}

// Allocation is a preview: it reads physical state and records a finite plan.
// Fault heat/damage, fuel and bank transfers belong only to commit below.
// Callers supply initialized state. This function never repairs or initializes it.
export function previewPower(s, site) {
  const topology = buildPowerTopology(site), networks = [], powered = new Set(), suppliedFaults = new Set();
  for (const network of topology.circuits) {
    const { tiles, id } = network;
    const banks = tiles.filter(t => t.building === 'battery' && t.hp > 0).sort((a, b) => a.y - b.y || a.x - b.x);
    const sources = new Map(tiles.map(t => [t, t.building === 'reactor' ? reactorOutput(site, t) : t.building === 'solar' && !(s.version<59) ? solarStatus(s,site,t).output : isDay(s) ? (BUILDINGS[t.building]?.output || 0) * t.hp / 100 : 0]));
    const output = [...sources.values()].reduce((a, b) => a + b, 0);
    const consumers = tiles.filter(t => BUILDINGS[t.building]?.demand && t.hp > 0 && t.machine?.enabled !== false && t.climate?.enabled !== false && t.gasDevice?.enabled !== false && t.waterDevice?.enabled !== false && (t.building !== 'airlockController' || t.airlock?.enabled === true));
    consumers.sort((a, b) => b.powerPriority - a.powerPriority || (b.building === 'scrubber' ? 1 : 0) - (a.building === 'scrubber' ? 1 : 0) || a.y - b.y || a.x - b.x);
    const faults = tiles.filter(wetCable), activeFaults = [];
    const demand = consumers.reduce((n, t) => n + BUILDINGS[t.building].demand, faults.length * LIQUID.faultPower);
    const storedSupply = banks.reduce((n, t) => n + Math.min(t.charge, BATTERY_RATE * t.hp / 100), 0);
    let available = output + storedSupply, used = 0;
    for (const t of faults) if (available + 1e-9 >= LIQUID.faultPower) {
      available = Math.max(0, available - LIQUID.faultPower); used += LIQUID.faultPower;
      suppliedFaults.add(t); activeFaults.push(t);
    }
    for (const t of consumers) {
      const required = BUILDINGS[t.building].demand;
      if (available + 1e-9 >= required) { powered.add(t); available = Math.max(0, available - required); used += required; }
    }
    let discharge = Math.max(0, used - output), surplus = Math.max(0, output - used), charged = 0;
    const transfers = [];
    for (const t of banks) {
      if (discharge > 0) {
        const n = Math.min(discharge, t.charge, BATTERY_RATE * t.hp / 100);
        transfers.push({ tile: t, amount: -n }); discharge -= n;
      } else if (surplus > 0) {
        const n = Math.min(surplus, BATTERY_CAPACITY - t.charge, BATTERY_RATE * t.hp / 100);
        transfers.push({ tile: t, amount: n }); surplus -= n; charged += n;
      }
    }
    networks.push({ id, tiles, cells: network.cells, sources, activeFaults, transfers, output, demand, used, storedSupply, curtailed: surplus, charging: charged });
  }
  const plan = { topology, networks, powered, suppliedFaults };
  return { ...plan, routing: routePower(plan) };
}

// Sources here mean available local supply, not a measurement of branch current.
// The optional plan is internal reuse; public callers can omit it for a fresh,
// read-only prediction with the current topology and physical inventories.
export function breakerConditions(s, site, t, plan = previewPower(s, site)) {
  if (t.building !== 'breaker') return null;
  const terminals = breakerTerminals(t), branch = branchForBreaker(site, t, plan.topology), protection = t.protection;
  const byPosition = (a, b) => a.y - b.y || a.x - b.x;
  const faultEntities = branch.tiles.filter(tile => plan.suppliedFaults.has(tile)).sort(byPosition).map(tile => tileEntityId(site.id, tile.x, tile.y, positionOf(tile).z));
  const available = new Set();
  for (const network of plan.networks) for (const [tile, output] of network.sources) if (output > 0) available.add(tile);
  const sourceEntities = branch.sources.filter(tile => tile.hp > 0 && (tile.building === 'battery' ? tile.charge > 0 : available.has(tile))).sort(byPosition).map(tile => tileEntityId(site.id, tile.x, tile.y, positionOf(tile).z));
  const connected = breakerContactClosed(t), bypassed = branch.bypassed;
  const routed = plan.routing.contacts.get(powerTileKey(t)) || { signed: 0, throughput: 0 };
  const rating = protection.overload?.rating ?? 8, effectiveRating = rating * t.hp / 100;
  const overloadTicks = protection.overload?.ticks || 0;
  const overloaded = connected && overloadMode(protection.mode) && routed.throughput > effectiveRating + 1e-9;
  const overloadWouldTrip = overloaded && overloadTicks + 1 >= BREAKER_OVERLOAD_TICKS;
  const wetFaultWouldTrip = connected && wetFaultMode(protection.mode) && !bypassed && faultEntities.length > 0;
  const wouldTrip = wetFaultWouldTrip || overloadWouldTrip;
  // Preserve legacy status text; new modes show their actual delayed protection.
  const blocked = t.hp <= 0 ? 'damaged' : protection.tripped ? 'tripped' : !protection.enabled ? 'open' :
    wetFaultWouldTrip ? 'wet_fault' : overloaded ? 'overload' : bypassed ? 'bypassed' : protection.mode === 'manual' ? 'manual' : 'clear';
  let status = { damaged: 'Needs repair', tripped: `Tripped: ${protection.cause === 'overload' ? 'branch overload' : 'wet fault in branch'}`,
    open: 'Open', bypassed: 'Bypass route: branch cannot be isolated', manual: 'Closed: manual isolation',
    wet_fault: 'Wet fault detected: trip on next tick', overload: `Overload: ${overloadTicks}/${BREAKER_OVERLOAD_TICKS} ticks${overloadWouldTrip ? '; trip on next tick' : ''}`,
    clear: 'Closed: wet-fault protection armed' }[blocked];
  if (blocked === 'clear' && overloadMode(protection.mode)) status = protection.mode === 'overload' ? 'Closed: overload protection armed' : 'Closed: wet-fault and overload protection armed';
  return { inputCircuit: plan.topology.membership.get(terminals.input) ?? null, outputCircuit: plan.topology.membership.get(terminals.output) ?? null,
    connected, bypassed, faultEntities, sourceEntities, wouldTrip, wetFaultWouldTrip, blocked, status,
    rating, effectiveRating, plannedThroughput: routed.throughput, signedThroughput: routed.signed,
    lastDeliveredThroughput: protection.overload?.lastThroughput ?? 0, lastDeliveredTick: protection.overload?.lastTick ?? null,
    overloadTicks, overloadDelay: BREAKER_OVERLOAD_TICKS, overloaded, overloadWouldTrip };

}

function protectedPlan(s, site, advance) {
  let plan = previewPower(s, site);
  if (!advance) return plan;
  const breakers = site.tiles.filter(t => t.building === 'breaker');
  const before = new Map(breakers.map(t => [t, t.protection.overload?.ticks || 0]));
  // Each pass opens at least one contact. Every preview reuses the same counters;
  // discarded plans never spend fuel/charge or apply fault heat and cable damage.
  for (let pass = 0; pass < breakers.length; pass++) {
    const due = [];
    for (const t of breakers) {
      if (!breakerContactClosed(t)) continue;
      const conditions = breakerConditions(s, site, t, plan);
      if (conditions.wetFaultWouldTrip) due.push({ tile: t, faults: conditions.faultEntities });
      else if (conditions.overloaded && before.get(t) + 1 >= BREAKER_OVERLOAD_TICKS)
        due.push({ tile: t, faults: [], details: { cause: 'overload', attemptedThroughput: conditions.plannedThroughput, effectiveRating: conditions.effectiveRating } });
    }
    if (!due.length) break;
    for (const { tile, faults, details } of due) tripBreaker(s, site, tile, faults, details);
    plan = previewPower(s, site);
  }
  for (const t of breakers) {
    const p = t.protection, metadata = p.overload;
    if (!metadata) continue;
    const flow = plan.routing.contacts.get(powerTileKey(t))?.throughput || 0;
    const connected = breakerContactClosed(t), overloaded = connected && overloadMode(p.mode) && flow > metadata.rating * t.hp / 100 + 1e-9;
    const ticks = overloaded ? before.get(t) + 1 : 0;
    p.overload = { ...metadata, ticks, lastThroughput: flow, lastTick: s.tick };
    if (ticks !== before.get(t) && !p.tripped) emitEvent(s, 'power.breaker.overload.changed', {
      entity: tileEntityId(site.id, t.x, t.y, positionOf(t).z), previousTicks: before.get(t), ticks,
      throughput: flow, effectiveRating: metadata.rating * t.hp / 100, delay: BREAKER_OVERLOAD_TICKS,
      reason: !connected ? 'open' : overloaded ? 'overload' : 'within_rating',
    });
  }
  return plan;
}

function calculate(s, site, advance, recordEvents=true) {
  const previousSolar=new Map(site.tiles.filter(t=>t.building==='solar').map(t=>[t,t.powerStatus??null]));
  for (const t of site.tiles) { initializeElectrical(t); t.powered = false; t.circuit = null; t.powerStatus = null; t.wetShort = false; }
  if (advance) for (const t of site.tiles) if (t.building === 'reactor') tripReactor(s, site, t);
  const plan = protectedPlan(s, site, advance), networks = [], operating = new Set();
  for (const network of plan.networks) {
    const { tiles, id, sources, output, demand, used, storedSupply, curtailed, charging } = network;
    if (advance) {
      for (const t of network.activeFaults) shortCable(s, site, t);
      for (const transfer of network.transfers) {
        transfer.tile.charge += transfer.amount;
        if (transfer.amount) operating.add(transfer.tile);
      }
      for (const [t, n] of sources) if (t.building === 'reactor') generateReactor(s, site, t, n);
      site.energy.generated += output; site.energy.consumed += used; site.energy.curtailed += curtailed;
    }
    const battery = tiles.reduce((n, t) => n + (t.building === 'battery' ? t.charge : 0), 0);
    const capacity = tiles.filter(t => t.building === 'battery').length * BATTERY_CAPACITY;
    for (const t of tiles) {
      t.powered = plan.powered.has(t); t.wetShort = plan.suppliedFaults.has(t);
      if (t.powered || sources.get(t) > 0) operating.add(t);
      t.circuit = id;
      if (advance && t.building === 'reactor') t.machine.status = reactorBlock(site, t) || 'Generating';
      if (!electrical(t)) { if (wetCable(t)) t.powerStatus = t.wetShort ? 'Wet cable short' : 'Wet cable — no fault power'; continue; }
      t.powerStatus = t.building === 'reactor' ? (sources.get(t) > 0 ? 'Generating' : reactorBlock(site, t)) : t.hp <= 0 ? 'Needs repair' : (t.machine?.enabled === false || t.climate?.enabled === false || t.gasDevice?.enabled === false || t.waterDevice?.enabled === false) ? 'Paused by player' :
        t.powered ? 'Powered' : BUILDINGS[t.building]?.demand ? (output + storedSupply > 0 ? 'Insufficient circuit supply' : 'No source on this circuit') :
        t.building === 'battery' ? `${t.charge > 0 ? 'Stored energy available' : 'Empty bank'}` : isDay(s) ? 'Generating' : 'No sunlight';
    }
    networks.push({ id, cells: network.cells, output, demand, used, battery, capacity, curtailed, charging });
  }
  for (const t of site.tiles) if (t.building === 'breaker') t.powerStatus = breakerConditions(s, site, t, plan).status;
  site.circuits = networks;
  site.power = { output: 0, demand: 0, used: 0, battery: 0, capacity: 0, curtailed: 0, networks: networks.length, brownouts: 0 };
  for (const circuit of networks) {
    for (const metric of ['output', 'demand', 'used', 'battery', 'capacity', 'curtailed']) site.power[metric] += circuit[metric];
    if (circuit.used < circuit.demand) site.power.brownouts++;
  }
  if(!(s.version<59))for(const [t,previous] of previousSolar){const status=solarStatus(s,site,t),p=status.blockedBy;t.powerStatus=status.status;if(recordEvents&&previous!==t.powerStatus)emitEvent(s,'power.solar.availability.changed',{entity:tileEntityId(site.id,t.x,t.y,t.z),previous,status:t.powerStatus,reason:status.reason,blockedBy:p?tileEntityId(site.id,p.x,p.y,p.z):null,availableOutput:status.output});}
  return operating;
}
export function refreshPower(s, site, recordEvents=true) { calculate(s, site, false,recordEvents); }
export function updatePower(s, site) { return calculate(s, site, true); }

// Commission only initial/legacy equipment. New construction needs player-installed routes.
export function seedPowerNetwork(site) {
  site.tiles.forEach(t => { t.cable = null; initializeElectrical(t); });
  const equipment = site.tiles.filter(t => electrical(t) && t.building !== 'breaker');
  const decks = new Map();
  for (const device of equipment) {
    const z=positionOf(device).z;if(!decks.has(z))decks.set(z,new Set());
    const connected=decks.get(z);
    if (!connected.size) { device.cable = { hp: 100, enabled: true }; connected.add(key(device)); continue; }
    const queue = [device], previous = new Map([[key(device), null]]); let endpoint = null;
    for (let i = 0; i < queue.length; i++) {
      const t = queue[i];
      if (connected.has(key(t))) { endpoint = t; break; }
      for (const n of neighbors(site, t)) if (!['void', 'rock'].includes(n.terrain) && !previous.has(key(n))) { previous.set(key(n), t); queue.push(n); }
    }
    if (!endpoint) { device.cable = { hp: 100, enabled: true }; continue; }
    let cursor = endpoint;
    while (cursor) { cursor.cable = { hp: 100, enabled: true }; connected.add(key(cursor)); cursor = previous.get(key(cursor)); }
  }
}
export function initializePower(s, site, charge = 0) {
  seedPowerNetwork(site);
  const banks = site.tiles.filter(t => t.building === 'battery');
  const perBank = banks.length ? Math.min(BATTERY_CAPACITY, charge / banks.length) : 0;
  banks.forEach(t => t.charge = perBank);
  site.energy = { initial: charge, generated: 0, consumed: 0, curtailed: 0, discarded: charge - perBank * banks.length, injected: 0 };
  refreshPower(s, site);
}
export function setCableEnabled(s, siteId, x, y, enabled,z=0) {
  const site = s.sites[siteId], t = site && at(site, x, y, z);
  if (!t?.cable || typeof enabled !== 'boolean') return { ok: false, message: 'Select an installed cable.' };
  if (!t.cable.hp) return { ok: false, message: 'Repair the damaged cable first.' };
  const previous = t.cable.enabled;
  t.cable.enabled = enabled;
  if (previous !== enabled) emitEvent(s, 'power.cable.changed', { entity: tileEntityId(siteId, x, y, z), previous, enabled });
  refreshPower(s, site); return { ok: true };
}
export function setPowerPriority(s, siteId, x, y, priority,z=0) {
  const site = s.sites[siteId], t = site && at(site, x, y, z);
  if (!BUILDINGS[t?.building]?.demand || ![1, 3, 5].includes(priority)) return { ok: false, message: 'Select a powered machine and a valid priority.' };
  t.powerPriority = priority; refreshPower(s, site); return { ok: true };
}
export function validatePower(s, site) {
  const amount = n => Number.isFinite(n) && n >= 0;
  const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) <= 1e-6 + Math.abs(b) * 1e-10;
  const fields = ['initial', 'generated', 'consumed', 'curtailed', 'discarded', 'injected'];
  if (!site.energy || !fields.every(k => amount(site.energy[k])) || !Array.isArray(site.circuits)) throw new Error('Invalid electrical history.');
  for (const t of site.tiles) {
    if (t.building === 'cable') throw new Error('Cable must be an overlay.');
    if (t.cable !== null && (!t.cable || typeof t.cable.enabled !== 'boolean' || !amount(t.cable.hp) || t.cable.hp > 100 || ['void', 'rock'].includes(t.terrain))) throw new Error('Invalid power cable.');
    if (t.building === 'battery' ? !amount(t.charge) || t.charge > BATTERY_CAPACITY : t.charge !== undefined) throw new Error('Invalid battery charge.');
    if (BUILDINGS[t.building]?.demand && ![1, 3, 5].includes(t.powerPriority)) throw new Error('Invalid power priority.');
  }
  const expected = { ...site, tiles: site.tiles.map(t => ({ ...t, ...(t.protection ? { protection: { ...t.protection } } : {}) })) }; refreshPower(s, expected,false);
  if (!Object.keys(expected.power).every(k => close(site.power[k], expected.power[k]))) throw new Error('Power totals do not match the connected circuits.');
  if (site.circuits.length !== expected.circuits.length) throw new Error('Invalid circuit count.');
  for (let i = 0; i < expected.circuits.length; i++) {
    const a = site.circuits[i], b = expected.circuits[i];
    if (!a || a.id !== b.id || !Array.isArray(a.cells) || a.cells.length !== b.cells.length || !a.cells.every((cell, index) => typeof cell === 'string' && cell === b.cells[index]) || !['output', 'demand', 'used', 'battery', 'capacity', 'curtailed', 'charging'].every(k => close(a[k], b[k]))) throw new Error('Invalid circuit state.');
  }
  for (let i = 0; i < site.tiles.length; i++) if (site.tiles[i].powered !== expected.tiles[i].powered || site.tiles[i].circuit !== expected.tiles[i].circuit || site.tiles[i].powerStatus !== expected.tiles[i].powerStatus || site.tiles[i].wetShort !== expected.tiles[i].wetShort) throw new Error('Invalid equipment power state.');
  const energy = site.energy;
  const stored = site.tiles.reduce((n, t) => n + (t.building === 'battery' ? t.charge : 0), 0);
  if (!close(stored + energy.consumed + energy.curtailed + energy.discarded, energy.initial + energy.generated + energy.injected)) throw new Error('Stored and spent energy do not balance.');
}
