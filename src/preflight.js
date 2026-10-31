import { sectorKitRequired, SECTOR_LANDING_KIT } from './sector-travel.js';
import { sameCell, tileAt, positionOf } from './spatial.js';
import { shipmentPosition } from './shipment-locations.js';
import { siteDefinition, routeDefinition } from './region.js';
import { crewPathToPosition as crewPathTo } from './navigation.js';
import { advanceCrewRoutePositions as advanceCrewRoute } from './crew-traversal.js';
import { validFoodLots } from './food-lots.js';
import { RESOURCES, SHUTTLE_FITS } from './data.js';
import { contains, quantity, take } from './inventory.js';
import { constructionResources } from './construction.js';
import { SUIT_PER_POINT } from './atmosphere.js';
import { suitRefillPlan } from './suit-supply.js';
import { routeFuel, routeTime, initializeReturnCrew } from './expedition.js';
import { expeditionCrewStatus, expeditionCrewCountAllowed } from './expedition-readiness.js';
import { emitEvent, tileEntityId } from './telemetry.js';
const departureBerth = Object.freeze({ x: 16, y: 11, z: 0 });
const atDepartureBerth = p => sameCell(shipmentPosition(p), departureBerth);
export const DEPARTURE_AIR_RESERVE = 10;
const requiresKit = (s, id) => id === 'solar' || sectorKitRequired(s,id);
const kitCost = (s, id) => requiresKit(s,id) ? { ...SECTOR_LANDING_KIT } : {};
export const SHIP_SUPPLIES = ['fuel', 'food', 'air', 'alloy', 'components'];
export const refillMix = crew => crew.reduce((n, c) => n + suitRefillPlan(c).air, 0);
export const departureCrew = s => (s.departure?.crew || []).map(id=>s.crew.find(c=>c.id===id)).filter(Boolean);
export const boardingDeparture = (s, c) => s.departure?.stage === 'boarding' && !c.rescue && !c.medical?.injury && c.life?.policy !== 'rest' && s.departure.crew.includes(c.id);
const context=(s,plan=s.departure)=>({entity:'colony',crewIds:[...plan.crew],site:`site:${plan.site}`,route:routeDefinition(s,plan.site)?.id,tick:s.tick});
function setStage(s,stage) {
  const d=s.departure;if(d.stage===stage)return;
  const previous=d.stage;d.stage=stage;
  emitEvent(s,'expedition.preparation.stage_changed',{...context(s),previous,next:stage,reason:stage==='boarding'?'supplies_loaded':'supplies_required'});
}
// Derived preparation diagnostics: no claims, events, initialization or RNG.
export function departureReadiness(s) {
  const d=s.departure;
  if(!d)return {stage:null,status:null,crewIds:[],crew:[],missingSupplies:{},shuttleWork:null,blocked:'no_departure',reason:'No departure preparation',ready:false};
  const site=s.sites.surface,ship=site.tiles[11*site.size+16];
  const crew=d.crew.map(id=>{
    const c=s.crew.find(c=>c.id===id);
    if(!c)return {id,eligible:false,blocked:'missing',reason:'Assigned crew unavailable',atShuttle:false,routeSteps:null,routeBlocked:false,ready:false};
    const status=expeditionCrewStatus(c,{boarding:true}),route=c.site==='surface'&&c.health>0?crewPathTo(s, site,c,[departureBerth]):null;
    const atShuttle=c.site==='surface'&&atDepartureBerth(c),routeBlocked=c.site==='surface'&&c.health>0&&route===null;
    return {...status,atShuttle,routeSteps:route?.length??null,routeBlocked,ready:status.eligible&&atShuttle};
  });
  const missingSupplies={};
  for(const r of SHIP_SUPPLIES){const n=Math.max(0,(d.target[r]||0)-(s.shuttle.supplies[r]||0));if(n>1e-8)missingSupplies[r]=n;}
  const work=s.jobs.find(j=>j.site==='surface'&&atDepartureBerth(j));
  const unavailable=!expeditionCrewCountAllowed(s,d.site,crew.length)||d.crew.some(id=>{const c=s.crew.find(c=>c.id===id);return !c||c.health<=0||c.site!=='surface';});
  let blocked=null,reason='Ready for departure';
  if(unavailable){blocked='crew_unavailable';reason='Assigned crew unavailable. Cancel preparation and choose another team.';}
  else if(quantity(missingSupplies)){blocked='missing_supplies';reason=work?.blockedReason||d.status||'More loaded supplies required';}
  else if(work){blocked='shuttle_work';reason=work.blockedReason||'Waiting for shuttle work to finish';}
  else if(ship?.building!=='shuttle'||ship.hp<50){blocked='shuttle_damaged';reason='Shuttle damaged; repair before departure';}
  else if(d.site==='comet'&&(s.tick<s.comet.arrives||s.tick+routeTime(s,d.site)*2+20>=s.comet.leaves)){blocked='window_closed';reason='Comet approach window closed; cancel or wait for another pass';}
  else if(crew.some(c=>!c.eligible)){blocked='crew_not_ready';reason=crew.find(c=>!c.eligible).reason;}
  else if(crew.some(c=>c.routeBlocked)){blocked='route_blocked';reason='Assigned crew cannot reach the shuttle';}
  else if(crew.some(c=>!c.atShuttle)){blocked='crew_not_aboard';reason='Supplied; waiting for crew at shuttle';}
  else if(d.stage!=='boarding'){blocked='loading';reason='Supplies ready; waiting for boarding stage';}
  return {stage:d.stage,status:d.status,crewIds:[...d.crew],crew,missingSupplies,shuttleWork:work?.id||null,blocked,reason,ready:blocked===null&&d.stage==='boarding'};
}
export function initializePreflight(s) {
  s.departure = null; s.shuttle.supplies = {};
  if (s.mission) { s.mission.returnFuel = 0; s.mission.kitReserved = false; }
}
export function planDeparture(s, site, crew) {
  s.departure = { site, crew: crew.map(c => c.id), stage: 'loading', target: { fuel: routeFuel(s, site), food: crew.length, air: Math.ceil(DEPARTURE_AIR_RESERVE + refillMix(crew)), ...kitCost(s,site) }, status: 'Waiting for supplies to be loaded' };
  emitEvent(s,'expedition.preparation.started',{...context(s),previous:null,next:'loading',target:{...s.departure.target},reason:'manifest_selected'});
}
export function loadingCost(s) {
  const available = constructionResources(s), target = s.departure?.target || {}, result = {};
  for (const r of SHIP_SUPPLIES) { const n = Math.min(available[r], Math.max(0, (target[r] || 0) - (s.shuttle.supplies[r] || 0))); if (n > 1e-8) result[r] = n; }
  return result;
}
export function updateDeparture(s, order, release) {
  const d = s.departure; if (!d) return;
  const crew = departureCrew(s);
  if (crew.length!==d.crew.length||!expeditionCrewCountAllowed(s,d.site,crew.length)||crew.some(c => c.health <= 0 || c.site !== 'surface')) { d.status = 'Assigned crew unavailable. Cancel preparation and choose another team.'; return; }
  // Replenish the paid loading margin in batches. Chasing a one-unit deficit
  // every tick can create parcels slower to haul than the crew use suit air.
  const refill = refillMix(crew);
  if (refill + 1 > d.target.air) {
    const previous = d.target.air;
    d.target.air = Math.ceil(refill + DEPARTURE_AIR_RESERVE);
    emitEvent(s, 'expedition.preparation.supplies_changed', { ...context(s), resource: 'air', previous, next: d.target.air, reason: 'suit_refill_margin' });
  }
  const work = s.jobs.find(j => j.site === 'surface' && atDepartureBerth(j));
  if (!contains(s.shuttle.supplies, d.target)) {
    setStage(s,'loading');
    if (work) { d.status = work.blockedReason || (work.kind === 'loadShuttle' ? 'Haulers are loading supplies' : 'Waiting for other shuttle work'); return; }
    if (!quantity(loadingCost(s))) { d.status = 'Missing supplies in depots or loose piles'; return; }
    const result = order(s, 'surface', 16, 11, 'loadShuttle');
    d.status = result.ok ? 'Haulers are loading supplies' : result.message === 'No crew can reach that tile. Send an expedition or clear a route.' ? 'No crew can reach the surface shuttle. Clear a route to load supplies.' : result.message;
    return;
  }
  setStage(s,'boarding');
  for (const c of crew) { if (c.job) release(s, c); if (c.intent?.type === 'haul' && !c.carry) c.intent = null; }
  d.status = work ? 'Waiting for shuttle work to finish' : 'Supplied; waiting for crew at shuttle';
}
export function walkToDeparture(s, c, pathTo) {
  const site = s.sites.surface, path = crewPathTo(s, site, c, [departureBerth]);
  const aboard=atDepartureBerth(c),origin=tileEntityId('surface',c.x,c.y,shipmentPosition(c).z);
  c.activity = path === null ? 'Departure route blocked' : path.length ? 'Walking to shuttle for departure' : 'Aboard; awaiting departure checks';
  if (path?.length) advanceCrewRoute(s, c, site, [path.at(-1)]);
  if(!aboard&&atDepartureBerth(c))emitEvent(s,'expedition.crew.boarded',{...context(s),actor:c.id,from:{entity:origin,slot:'location'},to:{entity:tileEntityId('surface',16,11),slot:'boarding'},reason:'outbound'});
}
export function tryDeparture(s, log) {
  const d = s.departure; if (!d || d.stage !== 'boarding') return;
  const crew = departureCrew(s), ship = s.sites.surface.tiles[11 * s.sites.surface.size + 16];
  if(crew.length!==d.crew.length||!expeditionCrewCountAllowed(s,d.site,crew.length)||crew.some(c=>c.health<=0||c.site!=='surface')){d.status='Assigned crew unavailable. Cancel preparation and choose another team.';return;}
  if (s.jobs.some(j => j.site === 'surface' && atDepartureBerth(j))) return;
  if (ship?.building !== 'shuttle' || ship.hp < 50) { d.status = 'Shuttle damaged; repair before departure'; return; }
  if (d.site === 'comet' && (s.tick < s.comet.arrives || s.tick + routeTime(s, d.site) * 2 + 20 >= s.comet.leaves)) { d.status = 'Comet approach window closed; cancel or wait for another pass'; return; }
  const readiness=crew.map(c=>expeditionCrewStatus(c,{boarding:true}));
  if(readiness.some(r=>!r.eligible)){d.status=`Waiting for assigned crew: ${readiness.find(r=>!r.eligible).reason}`;return;}
  if (crew.some(c => c.airlockTraversal || !atDepartureBerth(c))) return;
  const air = refillMix(crew), fuel = routeFuel(s, d.site), cost = { fuel: fuel / 2, food: crew.length, air };
  if (!contains(s.shuttle.supplies, { ...cost, fuel, ...kitCost(s,d.site) })) { d.status = 'More loaded supplies required'; return; }
  take(s.shuttle.supplies, cost); s.sites.surface.atmosphere.vented.inert += air * .79;
  for (const c of crew) { c.oxygen = suitRefillPlan(c).to; c.hunger = Math.max(80, c.hunger); c.medical.bed = null; c.site = 'transit'; c.z = 0; c.activity = `In transit to ${siteDefinition(s, d.site).name}`; }
  s.mission = { site: d.site, phase: 'outbound', remaining: routeTime(s, d.site), fit: s.shuttle.fit, capacity: SHUTTLE_FITS[s.shuttle.fit].capacity, legacyCapacity: false, crew: [...d.crew], cargo: {}, collector: false, heat: 0, returnFuel: fuel / 2, kitReserved: requiresKit(s,d.site) };
  initializeReturnCrew(s.mission);
  emitEvent(s,'expedition.departed',{...context(s,d),previous:'boarding',next:'outbound',from:{entity:tileEntityId('surface',16,11),slot:'shuttle'},to:{entity:`site:${d.site}`,slot:'transit'},consumed:{...cost},returnFuel:fuel/2,fit:s.shuttle.fit,reason:'ready'});
  s.departure = null; log(s, `Loaded shuttle departed for ${siteDefinition(s, d.site).name}. ${crew.length === 1 ? 'One crew member' : 'Two crew'} aboard.`, 'discovery');
}
export function spendReturnFuel(s) {
  const m = s.mission;
  if (!take(s.shuttle.supplies, { fuel: m.returnFuel })) return false;
  if(m.returnFuel>0)emitEvent(s,'expedition.fuel.consumed',{...context(s,m),amount:m.returnFuel,resource:'fuel',from:{entity:'colony',slot:'shuttle.supplies'},reason:'return'});
  m.returnFuel = 0; return true;
}
export function deployKit(s) {
  const m = s.mission;
  if (!m.kitReserved) return;
  const sector = sectorKitRequired(s,m.site), site = s.sites[m.site];
  const landing = sector ? tileAt(site,siteDefinition(s,m.site).landing) : null;
  if (sector && (!landing || landing.building)) return false;
  if(!take(s.shuttle.supplies, SECTOR_LANDING_KIT))return false;
  m.kitReserved = false;
  if (sector) { landing.building = 'dock'; landing.hp = 100; landing.imports = {}; }
  else m.collector = true;
  emitEvent(s,'expedition.kit.deployed',{...context(s,m),cargo:{...SECTOR_LANDING_KIT},from:{entity:'colony',slot:'shuttle.supplies'},to:{entity:sector?tileEntityId(site.id,landing.x,landing.y,positionOf(landing).z):`site:${m.site}`,slot:sector?'dock':'collector'},reason:'arrival'});return true;
}
export function validatePreflight(s) {
  const inventory = (v, waste = false) => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([r, n]) => r === '_food' || ((SHIP_SUPPLIES.includes(r) || (waste && r === 'waste')) && Number.isFinite(n) && n >= 0)) && validFoodLots(v);
  if (!inventory(s.shuttle.supplies, true)) throw new Error('Invalid shuttle service stores.');
  const d = s.departure;
  if (d !== null) {
    if (!d || s.mission || !routeDefinition(s, d.site)?.fuel || !Array.isArray(d.crew) || !expeditionCrewCountAllowed(s,d.site,d.crew.length) || new Set(d.crew).size !== d.crew.length || !d.crew.every(id => s.crew.some(c => c.id === id && c.site === 'surface')) || !['loading', 'boarding'].includes(d.stage) || !inventory(d.target) || d.target.fuel !== routeFuel(s, d.site) || d.target.food !== d.crew.length || !Number.isInteger(d.target.air) || d.target.air < 10 || d.target.air > Math.ceil(10 + d.crew.length * 100 * SUIT_PER_POINT / .21) || (requiresKit(s,d.site) ? d.target.alloy !== 6 || d.target.components !== 2 : (d.target.alloy || 0) !== 0 || (d.target.components || 0) !== 0) || typeof d.status !== 'string' || d.status.length > 250) throw new Error('Invalid departure plan.');
  }
  const m = s.mission;
  if(m&&sectorKitRequired(s,m.site)&&(!['outbound','returning'].includes(m.phase)||!m.kitReserved))throw new Error('First sector landing requires its reserved kit.');
  if (m && (!Number.isFinite(m.returnFuel) || m.returnFuel < 0 || m.returnFuel > routeFuel(s, m.site) / 2 || typeof m.kitReserved !== 'boolean' || (m.phase === 'returning' && m.returnFuel !== 0) || (m.kitReserved && (!requiresKit(s,m.site) || !['outbound', 'returning'].includes(m.phase))) || !contains(s.shuttle.supplies, { fuel: m.returnFuel, ...(m.kitReserved ? { alloy: 6, components: 2 } : {}) }))) throw new Error('Invalid onboard mission supplies.');
  for (const j of s.jobs) if (['loadShuttle', 'unloadShuttle'].includes(j.kind)) {
    if (j.site !== 'surface' || !atDepartureBerth(j) || s.mission || (j.kind === 'loadShuttle' ? !d || !inventory(j.cost) || !quantity(j.cost) || RESOURCES.some(r => (j.cost[r] || 0) > (d.target[r] || 0)) : d || quantity(j.cost))) throw new Error('Invalid shuttle supply job.');
  }
}
