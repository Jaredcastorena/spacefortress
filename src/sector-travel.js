import { SHUTTLE_FITS } from './data.js';
import { sectorWorld, sectorDefinition, sectorSiteId, sectorLanding } from './sector-sites.js';
import { routeDefinition } from './region.js';
import { planetSurveyStatus } from './satellites.js';
import { expeditionLaunchBlock } from './expedition-readiness.js';

export const SECTOR_LANDING_KIT = Object.freeze({ alloy: 6, components: 2 });
export const SECTOR_SAVE_HEADROOM = 1_000_000;
export const sectorKitRequired = (s, id) => !!s.sectorSites && Object.hasOwn(s.sectorSites, id) && !s.sites[id]?.explored;

// A route preview never creates physical maps, consumes supplies, or advances RNG.
export function surveyedSectorStatus(s, planetId, x, y) {
  const result = { ok: false, code: null, message: '', planetId, x, y, siteId: null, known: false, firstLanding: false, route: null, kit: {} };
  const reject = (code, message) => ({ ...result, code, message });
  let world;
  try { world = sectorWorld(s, planetId); } catch { return reject('unknown_planet', 'Select a known planet.'); }
  if (!world) return reject('unknown_planet', 'Select a known planet.');
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= world.width || y >= world.height) return reject('invalid_sector', 'Select a sector on this planet.');
  if (!planetSurveyStatus(s, planetId).unlocked) return reject('survey_locked', 'Launch a survey satellite before preparing a new landing.');
  const existing = sectorLanding(s, planetId, x, y), id = existing || sectorSiteId(planetId, x, y);
  result.siteId = id; result.known = !!existing;
  if (id === 'surface') return reject('home_sector', 'This sector is your home colony. Open its map.');
  const entry = { planetId, x, y };
  const view = existing ? s : { ...s, sectorSites: { ...(s.sectorSites || {}), [id]: entry } };
  if (!existing) sectorDefinition(s, entry);
  const route = routeDefinition(view, id), fit = SHUTTLE_FITS[s.shuttle.fit];
  if (!route || !fit) return reject('invalid_destination', 'No shuttle route is available.');
  result.route = { ...route, fuel: Math.max(1, route.fuel + fit.fuel), travel: route.travel + fit.travel };
  result.firstLanding = !existing || sectorKitRequired(s, id);
  result.kit = result.firstLanding ? { ...SECTOR_LANDING_KIT } : {};
  const blocked = expeditionLaunchBlock(view, id);
  if (blocked) return reject(blocked.code, blocked.message);
  return { ...result, ok: true, message: result.firstLanding ? 'Prepare a supplied expedition and landing kit.' : 'Prepare a supplied return visit to this saved destination.' };
}
