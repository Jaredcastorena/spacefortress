import { stairDestination, stairAt } from './vertical.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { moveCrew } from './atmosphere.js';
import { pathToPosition, passablePosition, planCrewRoutePositions } from './navigation.js';
import { groundStep, horizontalStep, tileAt, sameCell, positionOf, cellKey } from './spatial.js';
import { airlockDoorPermit, airlockRouteInfo } from './airlock-access.js';
import { requestAirlock, cancelAirlock } from './airlocks.js';

const result = (status, reason = null) => ({ status, reason });
const same = sameCell;
const position = positionOf;
const groundCell = p => Array.isArray(p) && p.length === 2 ? { x: p[0], y: p[1], z: 0 } : null;
const origin = c => ({ ...c, z: c.z ?? 0 });
const controller = (site, id) => site.tiles.find(t => position(t).z===0 && `tile:${site.id}:${t.x}:${t.y}` === id && t.building === 'airlockController');
const waiting = (c, reason) => { c.activity = reason ? `Waiting for airlock: ${reason.replaceAll('_', ' ')}` : 'Waiting for airlock'; return result('waiting_airlock', reason); };

export function cancelCrewTraversal(s, c) {
  const site = s.sites[c.site], claim = c.airlockTraversal;
  const t = site && claim && controller(site, claim.controller);
  return t ? cancelAirlock(s, { site: site.id, x: t.x, y: t.y, crew: c.id }) : null;
}

function step(s, c, site, next) {
  const from=position(c),destination = horizontalStep(site, c, next)||stairDestination(site,c,next);
  if (!destination) return result('blocked', 'route_unavailable');
  if (!airlockDoorPermit(site, c, position(c), destination)) return waiting(c, 'door_locked');
  if (!moveCrew(c, site, destination)) return result('moving', 'mobility_wait');
  const patient = c.rescue?.carrying && s.crew.find(p => p.id === c.rescue.patient && p.health > 0 && p.site === c.site);
  if (patient) { patient.x = c.x; patient.y = c.y; patient.z = c.z ?? 0; patient.activity = `Being carried by ${c.name?.split(' ')[0] || c.id}`; }
  if(from.z!==destination.z)emitEvent(s,'vertical.traversed',{entity:c.id,actor:c.id,connection:stairAt(site,destination).id,from:tileEntityId(site.id,from.x,from.y,from.z),to:tileEntityId(site.id,destination.x,destination.y,destination.z),patient:patient?.id||null});
  return result('moving');
}

/** Finish an existing physical traversal before ordinary work can replace it.
 * Needs/exposure still run each tick. No inventory or intent belongs here. */
export function continueCrewTraversal(s, c, site) {
  const claim = c.airlockTraversal; if (!claim) return null;
  if (!groundStep(site, c, position(c))) return result('blocked', 'route_unavailable');
  if (s.crew.some(helper => helper.rescue?.carrying && helper.rescue.patient === c.id)) return waiting(c, 'carried_patient');
  const t = controller(site, claim.controller), a = t?.airlock;
  if (!a || a.binding !== claim.binding) return result('blocked', 'airlock_unavailable');
  const route = airlockRouteInfo(site, t);
  const party = a.party?.crew === c.id ? a.party : null;
  const queued = a.queue.find(p => p.crew === c.id);
  if (!party && !queued) return result('blocked', 'request_missing');
  if (!route) {
    const retainedInside = a.chamberCells.includes(cellKey(position(c))) || ['inner', 'outer'].some(side => same(a.config[side], position(c)));
    if (retainedInside) return waiting(c, a.reason || 'layout_changed');
    cancelCrewTraversal(s, c); return result('blocked', a.reason || 'layout_changed');
  }
  const entryName = (party || queued).direction === 'outward' ? 'inner' : 'outer';
  const exitName = a.recoverySide || (entryName === 'inner' ? 'outer' : 'inner');
  const entry = route[entryName], exit = route[exitName];
  const inside = route.chamberCells.includes(cellKey(position(c))) || [entry.door, exit.door].some(p => same(p, position(c)));
  const lostApproach = () => {
    cancelCrewTraversal(s, c);
    return result('blocked', 'route_unavailable');
  };
  if (party && ['prepare_entry', 'admit'].includes(a.phase) && !inside && !same(position(c), entry.outside)) {
    const approach = pathToPosition(site, origin(c), [entry.outside]);
    return approach?.length ? step(s, c, site, approach[0]) : lostApproach();
  }
  let goals;
  if (!party) {
    if (same(position(c), entry.outside)) return waiting(c, a.reason || 'queued');
    goals = [entry.outside];
  } else if (a.phase === 'admit') goals = [entry.inside];
  else if (a.phase === 'release' || a.phase === 'paused' && a.reason === 'manual_release') goals = [exit.outside];
  else return waiting(c, a.reason || a.phase);
  // Only the named chamber and selected side are considered while crossing.
  // The authoritative leaf permit is checked again immediately before moving.
  const allowed = new Set([...route.chamberCells, ...[entry, exit].flatMap(side => [side.door, side.outside].map(p => cellKey(p)))]);
  const canEnter = (current, p) => {
    if (!party) return passablePosition(current, p);
    const tile = tileAt(current, p);
    return p.z === 0 && allowed.has(cellKey(p)) && !!tile && !tile.fire && !['void', 'rock'].includes(tile.terrain) && tile.building !== 'wall' && (tile.building !== 'door' || tile.hp > 0);
  };
  const path = pathToPosition(site, origin(c), goals, canEnter);
  if (path === null) return !inside ? lostApproach() : waiting(c, 'route_unavailable');
  if (!path.length) return waiting(c, a.phase === 'admit' ? 'seal_entry' : 'cycle_completion');
  return step(s, c, site, path[0]);
}

/** Execute one ordinary walking step, or request/wait for a measured cycle. */
export function advanceCrewRoutePositions(s, c, site, goals) {
  if (!Array.isArray(goals) || goals.some(p => !sameCell(p,p) || p.site !== undefined && p.site !== site.id) ||
      !horizontalStep(site, c, position(c))) return result('blocked', 'route_unavailable');
  if (c.airlockTraversal) {
    const destination = c.airlockTraversal.destination;
    if (destination && !goals.some(goal => sameCell(goal, destination))) {
      const t = controller(site, c.airlockTraversal.controller);
      if (t) cancelAirlock(s, { site: site.id, x: t.x, y: t.y, crew: c.id });
    }
    const continued = continueCrewTraversal(s, c, site); if (continued) return continued;
  }
  const route = planCrewRoutePositions(s, site, origin(c), goals);
  if (route === null) return result('blocked', 'route_unavailable');
  if (!route.path.length) return result('arrived');
  const first = route.segments[0];
  if (first.kind === 'walk') return step(s, c, site, first.path[0]);
  const t = controller(site, first.controller);
  if (!t) return result('blocked', 'airlock_unavailable');
  const requested = requestAirlock(s, { site: site.id, x: t.x, y: t.y, crew: c.id, direction: first.direction });
  if (!requested.ok) return result('blocked', requested.code || requested.reason || 'request_rejected');
  // Persist the complete endpoint shared by traveler, party and carried patient.
  const endpoint = route.path.at(-1), destination = position(endpoint), a = t.airlock;
  if (c.airlockTraversal) c.airlockTraversal.destination = destination;
  const party = a.party?.crew === c.id ? a.party : a.queue.find(p => p.crew === c.id);
  if (party) party.destination = {...destination};
  if (party?.patient) {
    const patient = s.crew.find(p => p.id === party.patient);
    if (patient?.airlockTraversal) patient.airlockTraversal.destination = {...destination};
  }
  return continueCrewTraversal(s, c, site) || waiting(c, 'queued');
}

// Unconverted needs/controller callers still provide ground coordinate pairs.
export function advanceCrewRoute(s,c,site,goals) {
  return advanceCrewRoutePositions(s,c,site,Array.isArray(goals)?goals.map(groundCell):goals);
}
