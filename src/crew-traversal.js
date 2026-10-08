import { moveCrew } from './atmosphere.js';
import { pathTo, passable, planCrewRoute } from './navigation.js';
import { airlockDoorPermit, airlockRouteInfo } from './airlock-access.js';
import { requestAirlock, cancelAirlock } from './airlocks.js';

const result = (status, reason = null) => ({ status, reason });
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const position = c => [c.x, c.y];
const controller = (site, id) => site.tiles.find(t => `tile:${site.id}:${t.x}:${t.y}` === id && t.building === 'airlockController');
const waiting = (c, reason) => { c.activity = reason ? `Waiting for airlock: ${reason.replaceAll('_', ' ')}` : 'Waiting for airlock'; return result('waiting_airlock', reason); };

export function cancelCrewTraversal(s, c) {
  const site = s.sites[c.site], claim = c.airlockTraversal;
  const t = site && claim && controller(site, claim.controller);
  return t ? cancelAirlock(s, { site: site.id, x: t.x, y: t.y, crew: c.id }) : null;
}

function step(s, c, site, next) {
  if (!airlockDoorPermit(site, c, position(c), next)) return waiting(c, 'door_locked');
  if (!moveCrew(c, site, next)) return result('moving', 'mobility_wait');
  const patient = c.rescue?.carrying && s.crew.find(p => p.id === c.rescue.patient && p.health > 0 && p.site === c.site);
  if (patient) { patient.x = c.x; patient.y = c.y; patient.activity = `Being carried by ${c.name?.split(' ')[0] || c.id}`; }
  return result('moving');
}

/** Finish an existing physical traversal before ordinary work can replace it.
 * Needs/exposure still run each tick. No inventory or intent belongs here. */
export function continueCrewTraversal(s, c, site) {
  const claim = c.airlockTraversal; if (!claim) return null;
  if (s.crew.some(helper => helper.rescue?.carrying && helper.rescue.patient === c.id)) return waiting(c, 'carried_patient');
  const t = controller(site, claim.controller), a = t?.airlock;
  if (!a || a.binding !== claim.binding) return result('blocked', 'airlock_unavailable');
  const route = airlockRouteInfo(site, t);
  const party = a.party?.crew === c.id ? a.party : null;
  const queued = a.queue.find(p => p.crew === c.id);
  if (!party && !queued) return result('blocked', 'request_missing');
  if (!route) {
    const retainedInside = a.chamberCells.includes(position(c).join(',')) || ['inner', 'outer'].some(side => same(a.config[side], position(c)));
    if (retainedInside) return waiting(c, a.reason || 'layout_changed');
    cancelCrewTraversal(s, c); return result('blocked', a.reason || 'layout_changed');
  }
  const entryName = (party || queued).direction === 'outward' ? 'inner' : 'outer';
  const exitName = a.recoverySide || (entryName === 'inner' ? 'outer' : 'inner');
  const entry = route[entryName], exit = route[exitName];
  const inside = route.chamberCells.includes(position(c).join(',')) || [entry.door, exit.door].some(p => same(p, position(c)));
  const lostApproach = () => {
    cancelCrewTraversal(s, c);
    return result('blocked', 'route_unavailable');
  };
  if (party && ['prepare_entry', 'admit'].includes(a.phase) && !inside && !same(position(c), entry.outside)) {
    const approach = pathTo(site, c, [entry.outside]);
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
  const allowed = new Set([...route.chamberCells, ...[entry, exit].flatMap(side => [side.door, side.outside].map(p => p.join(',')))]);
  const canEnter = (current, x, y) => {
    if (!party) return passable(current, x, y);
    const tile = current.tiles[y * current.size + x];
    return x >= 0 && y >= 0 && x < current.size && y < current.size && allowed.has(`${x},${y}`) && !!tile && !tile.fire && !['void', 'rock'].includes(tile.terrain) && tile.building !== 'wall' && (tile.building !== 'door' || tile.hp > 0);
  };
  const path = pathTo(site, c, goals, canEnter);
  if (path === null) return !inside ? lostApproach() : waiting(c, 'route_unavailable');
  if (!path.length) return waiting(c, a.phase === 'admit' ? 'seal_entry' : 'cycle_completion');
  return step(s, c, site, path[0]);
}

/** Execute one ordinary walking step, or request/wait for a measured cycle. */
export function advanceCrewRoute(s, c, site, goals) {
  if (c.airlockTraversal) {
    const destination = c.airlockTraversal.destination;
    if (destination && !goals.some(goal => same(goal, destination))) {
      const t = controller(site, c.airlockTraversal.controller);
      if (t) cancelAirlock(s, { site: site.id, x: t.x, y: t.y, crew: c.id });
    }
    const continued = continueCrewTraversal(s, c, site); if (continued) return continued;
  }
  const route = planCrewRoute(s, site, c, goals);
  if (route === null) return result('blocked', 'route_unavailable');
  if (!route.path.length) return result('arrived');
  const first = route.segments[0];
  if (first.kind === 'walk') return step(s, c, site, first.path[0]);
  const t = controller(site, first.controller);
  if (!t) return result('blocked', 'airlock_unavailable');
  const requested = requestAirlock(s, { site: site.id, x: t.x, y: t.y, crew: c.id, direction: first.direction });
  if (!requested.ok) return result('blocked', requested.code || requested.reason || 'request_rejected');
  const destination = [...route.path.at(-1)], a = t.airlock;
  if (c.airlockTraversal) c.airlockTraversal.destination = destination;
  const party = a.party?.crew === c.id ? a.party : a.queue.find(p => p.crew === c.id);
  if (party) party.destination = [...destination];
  if (party?.patient) {
    const patient = s.crew.find(p => p.id === party.patient);
    if (patient?.airlockTraversal) patient.airlockTraversal.destination = [...destination];
  }
  return continueCrewTraversal(s, c, site) || waiting(c, 'queued');
}
