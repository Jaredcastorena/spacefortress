import { expeditionLaunchBlock, selectExpeditionCrew } from './expedition-readiness.js';
import { validateBreakers } from './breakers.js';
import { initializePlumbing, newWaterPipe, waterEquipment, flowPlumbing, operatePlumbing, removePlumbing, validatePlumbing } from './plumbing.js';
import { initializeGasNetworks, initializeGasExhaust, newPipe, gasEquipment, updateGasNetworks, removeGas, validateGasNetworks } from './gas-networks.js';
import { initializeLiquids, flowLiquids, pumpLiquids, validateLiquids } from './liquids.js';
import { initializeReactors, updateReactorCooling, releaseReactorHeat, validateReactors } from './reactors.js';
import { FIRE, initializeFire, updateFire, prepareFire, fireJobValid, extinguish, evadeFire, validateFire } from './fire.js';
import { transportJob, requestTransport, transportRoute, releaseTransport, reconcileTransport, heldForTransport, actTransport, completeTransport, validateTransport } from './animal-transport.js';
import { initializeBreeding, updateBreeding, validateBreeding, adult } from './breeding.js';
import { passable, pathTo, animalPassable, animalPath } from './navigation.js';
export { passable, pathTo } from './navigation.js';
import { pastureSnapshot, recordPastureChanges, moveAnimal, validatePastures, pastureRegions } from './pastures.js';
import { initializeHusbandry, animalJob, animalJobValid, animalForJob, assignAnimal, animalPolicy, prepareHusbandry, completeAnimalJob, moveAssignedAnimal, animalCondition, validateHusbandry } from './husbandry.js';
import { openMeal, eatPortion } from './meals.js';
import { initializeWater, validateWater, iceAvailable, ICE_EXTRACTION_AMOUNT } from './water.js';
import { initializePossessions, validatePossessions, dropPossession } from './possessions.js';
import { validItemLots } from './item-lots.js';
import { capture, emitEvent, tileEntityId } from './telemetry.js';
import { initializeComfort, validateComfort, experienceComfort } from './comfort.js';
import { initializeHousing, reconcileHousing, validateHousing, bunkAccessible, ownsBunk, housingObstruction, rememberHousingSleep } from './housing.js';
import { initializeDesignations, validateDesignations, livingAllowed, roomBenefit } from './rooms.js';
import { initializeHygiene, hygienePatient, hygieneReady, completeHygiene, prepareHygiene, reconcileHygiene, validateHygiene, HYGIENE_WORK, HYGIENE_RETRY } from './hygiene.js';
import { initializeSanitation, digestPortion, dropSanitation, updateSanitation, useSanitation, validateSanitation } from './sanitation.js';
import { initializeFood, updateFood, validateFood, preserveOpenedMeal, dropOpenedMeals } from './spoilage.js';
import { validFoodLots, foodAge } from './food-lots.js';
import { initializeThermal, updateThermal, validateThermal, thermalSafe, thermalExposure } from './thermal.js';
import { validateStorage } from './storage.js';
import { initializeProduction, productionBlock, operateMachine, validateProduction } from './production.js';
import { initializeNursing, prepareNursing, reconcileNursing, rescue, dependentCare, feedPatient, completeFeeding, validateNursing } from './nursing.js';
import { initializeMedicine, injure, prepareMedicine, treatmentPatient, treatmentReady, completeTreatment, medicalRest, validateMedicine } from './medicine.js';
import { VERSION, RESOURCES, BUILDINGS, SITES, CREW_NAMES, ROLES, RECIPES, SHUTTLE_FITS } from './data.js';
import { LABORS, initializeCrew, laborFor, airThreshold, availableForWork, workRate, gainExperience, remember, updateMorale } from './crew.js';

import { add, addCounts, extract, resourceEntries, take, spill, initializeStorage, stores, syncResources, spend, quantity } from './inventory.js';
import { updateIndustry, haul, spillStorage, CARRY_CAPACITY, OUTPUT_CAPACITY } from './industry.js';

import { reserveConstruction, materialsReady, materialRoute, materialObstruction, fetchMaterials, cancelMaterials, dropCarriedMaterials, reservedAt } from './construction.js';

import { updateRooms, roomAt, initializeAtmosphere, fillRoom, refreshAtmosphere, updateAtmosphere, breathable, breathe, moveCrew, GASES, gasAmount, refreshRoom, SUIT_PER_POINT } from './atmosphere.js';
export { updateRooms, roomAt } from './atmosphere.js';

import { isDay, updatePower, refreshPower, initializePower, initializeElectrical, releaseBatteryEnergy, BATTERY_CAPACITY, validatePower } from './power.js';
import { initializeReliability, maintainable, completeService, recordOperation, updateDebris, scheduleMaintenance, validateReliability } from './maintenance.js';
import { initializeShuttle, routeTime, routeFuel, haulSalvage, boardShuttle, returnWalk, dockAt, validateShuttle } from './expedition.js';
import { initializePreflight, planDeparture, loadingCost, updateDeparture, walkToDeparture, boardingDeparture, tryDeparture, spendReturnFuel, deployKit, validatePreflight } from './preflight.js';
import { initializeCrewLife, prepareDowntime, leisure, updateCrewLife, validateCrewLife } from './crew-life.js';
export { isDay, updatePower } from './power.js';

export const key = (x, y) => `${x},${y}`;
export const at = (site, x, y) => site.tiles[y * site.size + x];
export const inside = (site, x, y) => x >= 0 && y >= 0 && x < site.size && y < site.size;
export const neighbors = (x, y) => [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];

export function random(s) {
  let x = s.rng | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  s.rng = x >>> 0; return s.rng / 4294967296;
}
function createSite(id, size) {
  return { id, size, air: 0, power: { output: 0, demand: 0, battery: 0, capacity: 0 }, rooms: [], explored: id === 'surface' || id === 'wreck', tiles: Array.from({ length: size * size }, (_, i) => ({ x: i % size, y: Math.floor(i / size), terrain: id === 'surface' ? 'ground' : 'void', building: null, hp: 100, drop: null, variant: i % 4, powered: false, cable: null })) };
}
export function createGame(seed = 74219) {
  const s = { version: VERSION, seed, rng: seed || 1, tick: 0, nextId: 1, resources: { alloy: 36, ore: 0, components: 3, food: 24, water: 40, fuel: 14, cells: 0, air: 160, medicine: 4, waste: 0, fertilizer: 8, keepsakes: 0, ice: 0 }, sites: {}, crew: [], creatures: [], anomaly: null, jobs: [], log: [], mission: null, stats: { built: 0, mined: 0, returned: 0, solarCells: 0, trapped: 0 }, comet: { arrives: 180, leaves: 480 }, flags: {}, objectives: {} };
  const ground = s.sites.surface = createSite('surface', 26);
  for (const t of ground.tiles) {
    const edge = t.x < 4 || t.y < 3 || t.x > 20 || t.y > 20;
    t.variant = Math.floor(random(s) * 4);
    if (random(s) < (edge ? .36 : .08)) t.terrain = random(s) < .35 ? 'ore' : 'rock';
  }
  for (let y = 5; y <= 16; y++) for (let x = 5; x <= 18; x++) { const t = at(ground, x, y); t.terrain = 'ground'; }
  for (let y = 6; y <= 12; y++) for (let x = 6; x <= 14; x++) {
    const t = at(ground, x, y); t.terrain = 'floor';
    if (x === 6 || x === 14 || y === 6 || y === 12) t.building = 'wall';
  }
  at(ground, 10, 12).building = 'door';
  const initial = [[7, 7, 'scrubber'], [9, 7, 'bunk'], [10, 7, 'bunk'], [11, 7, 'bunk'], [12, 7, 'bunk'], [13, 7, 'battery'], [7, 9, 'farm'], [8, 10, 'stockpile'], [13, 10, 'refinery'], [7, 14, 'solar'], [8, 14, 'solar'], [9, 14, 'solar'], [16, 11, 'shuttle']];
  for (const [x, y, b] of initial) at(ground, x, y).building = b;
  for (const [x, y] of [[4, 10], [4, 11], [3, 12], [17, 7], [18, 8], [19, 8]]) at(ground, x, y).terrain = 'ore';
  for (const t of ground.tiles) if (t.terrain === 'ground' && !t.building && t.variant === 2) t.lichen = 60;
  for (const [i, x, y] of [[0, 6, 16], [1, 8, 17], [2, 10, 18]]) { at(ground, x, y).terrain = 'ground'; at(ground, x, y).lichen = 90; s.creatures.push({ id: `grazer-${i}`, species: 'bristleback', site: 'surface', x, y, health: 100, fed: 65, age: 0 }); }
  s.crew = CREW_NAMES.map((name, i) => ({ id: `crew-${i}`, name, role: ROLES[i], color: ['#dfb06d', '#8dccc3', '#e89577', '#9cb778', '#a6a6de', '#df99ad', '#b4c0c8'][i], site: 'surface', x: 8 + i % 5, y: 9 + Math.floor(i / 5), health: 100, hunger: 90, energy: 90, oxygen: 100, job: null, activity: 'Settling in', skill: 1 + (i % 3) * .25 }));
  s.crew.forEach(initializeCrew); initializeCrewLife(s); initializeMedicine(s); initializeNursing(s);
  const wreck = s.sites.wreck = createSite('wreck', 18);
  for (let y = 5; y <= 12; y++) for (let x = 3; x <= 14; x++) { const t = at(wreck, x, y); t.terrain = 'deck'; if ((y === 5 || x === 14) && x !== 8) t.building = 'wall'; }
  for (const [x, y] of [[5, 6], [7, 7], [12, 6], [12, 10], [8, 10]]) at(wreck, x, y).building = 'salvage';
  at(wreck, 4, 11).building = 'dock';
  const comet = s.sites.comet = createSite('comet', 18);
  for (const t of comet.tiles) if ((t.x - 8) ** 2 / 49 + (t.y - 9) ** 2 / 25 < 1) t.terrain = 'ice';
  at(comet, 5, 10).building = 'dock';
  for (const [x, y] of [[8, 7], [10, 8], [11, 10], [8, 11]]) at(comet, x, y).building = 'volatile';
  const solar = s.sites.solar = createSite('solar', 18);
  for (let y = 7; y < 12; y++) for (let x = 4; x < 13; x++) at(solar, x, y).terrain = 'deck';
  at(solar, 5, 10).building = 'dock'; at(solar, 10, 8).building = 'collector';
  log(s, 'Kepler’s Rest established. Seven crew. One small foothold.', 'good');
  log(s, 'Relay K-07 detected in near orbit. Its components could transform this colony.', 'discovery');
  updateRooms(ground); ground.rooms.forEach(r => fillRoom(r)); updateRooms(ground);
  for (const site of Object.values(s.sites)) { initializeAtmosphere(site); site.tiles.forEach(initializeStorage); initializePower(s, site, site.id === 'surface' ? 100 : 0); }
  initializeReliability(s); initializeShuttle(s); initializePreflight(s); initializeThermal(s); initializeFood(s); initializeSanitation(s); initializeHygiene(s); initializeDesignations(s); initializeHousing(s); initializeComfort(s); initializePossessions(s); initializeWater(s); initializeHusbandry(s); initializeBreeding(s); initializeFire(s); initializeReactors(s); initializeLiquids(s); initializeGasNetworks(s); initializePlumbing(s);
  add(at(ground, 8, 10).stock, s.resources); syncResources(s);
  return s;
}
export function log(s, message, type = 'info') { s.log.unshift({ tick: s.tick, message, type }); s.log = s.log.slice(0, 60); }

export function canAfford(s, cost) { syncResources(s); return Object.entries(cost).every(([r, n]) => s.resources[r] >= n); }
const connectedTo = (s, target) => t => pathTo(s.sites.surface, t, [target]) !== null;
export function order(s, siteId, x, y, kind, building = null) {
  const site = s.sites[siteId];
  if (!site || !inside(site, x, y)) return { ok: false, message: 'Outside the map.' };
  const t = at(site, x, y);
  if (siteId !== 'surface' && (s.mission?.site !== siteId || s.mission.phase !== 'working')) return { ok: false, message: 'Resume field work before assigning expedition orders.' };
  if (s.jobs.some(j => j.site === siteId && j.x === x && j.y === y && (kind==='extinguish'?j.kind==='extinguish':['feed', 'hygiene'].includes(kind) ? j.kind === kind && j.patient === building : !['feed', 'hygiene', 'operate', 'animalCare', 'animalHarvest', 'animalLead', 'extinguish'].includes(j.kind)))) return { ok: false, message: 'Work already designated here.' };
  if(t.fire&&kind!=='extinguish')return {ok:false,message:'Suppress the fire before working on this tile.'};
  let cost = {}, work = 5;
  if(kind==='extinguish'){if(!t.fire)return {ok:false,message:'Select an active fire.'};cost={water:FIRE.suppressionWater};work=FIRE.suppressionWork;
  } else if (kind === 'build') {
    if (siteId !== 'surface') return { ok: false, message: 'Construction currently requires the surface supply network.' };
    const def = BUILDINGS[building]; if (!def) return { ok: false, message: 'Unknown structure.' };
    if (building === 'waterPipe' ? ['void','rock'].includes(t.terrain)||t.waterPipe||waterEquipment(t) : building === 'gasPipe' ? ['void','rock'].includes(t.terrain)||t.pipe||gasEquipment(t) : building === 'cable' ? ['void', 'rock'].includes(t.terrain) || t.cable || t.building==='breaker' : !passable(site, x, y) || t.building || t.drop || quantity(reservedAt(s, siteId, x, y))) return { ok: false, message: 'Clear the tile first.' };
    if (['gasTank','gasPump','gasVent','gasExtractor','gasReservoir'].includes(building)&&t.pipe) return {ok:false,message:'Dismantle the underlying gas pipe before installing this device.'};
    if (waterEquipment({building})&&t.waterPipe) return {ok:false,message:'Dismantle the underlying water pipe before installing this device.'};
    if (building==='breaker'&&t.cable) return {ok:false,message:'Remove the cable before installing a two-terminal breaker.'};
    if (iceAvailable(t) && !['cable','gasPipe','waterPipe'].includes(building)) return { ok: false, message: 'Extract the remaining ice before building here.' };
    if (building === 'floor' && t.terrain === 'floor') return { ok: false, message: 'A floor is already here.' };
    if (['breaker','waterReservoir','waterPump','waterIntake','waterOutlet','gasTank','gasVent','gasExtractor','gasReservoir','waterTank','bilgePump','reactor', 'galley', 'iceProcessor', 'artisan', 'sculpture', 'holo', 'sanitary', 'medicalCot', 'medlab', 'commons', 'bunk', 'farm', 'recycler', 'scrubber', 'refinery', 'fabricator', 'atmosphere', 'battery'].includes(building) && t.terrain !== 'floor') return { ok: false, message: 'Place this on a habitat floor.' };
    cost = def.cost; work = def.work;

  } else if (['animalCare','animalHarvest'].includes(kind)) {
    const animal=s.creatures.find(a=>a.id===building);const proposed={kind,animal:building,x,y};
    if(siteId!=='surface'||!animal||!animalJobValid(s,proposed))return {ok:false,message:'Animal care or collection is unavailable at this post.'};
    cost=kind==='animalCare'?{food:1}:{};work=kind==='animalCare'?12:10;
  } else if (kind === 'operate') {
    const blocked = productionBlock(s, site, t);
    if (blocked || s.jobs.some(j => j.kind === 'operate' && j.site === siteId && j.x === x && j.y === y)) return { ok: false, message: blocked || 'Operator already assigned.' };
    building = t.building; work = RECIPES[building].duration;
  } else if (kind === 'hygiene') {
    if (s.jobs.some(j => j.kind === 'hygiene' && j.patient === building)) return { ok: false, message: 'Hygiene already designated for this patient.' };
    if (siteId !== 'surface' || !hygienePatient(s, { patient: building, x, y })) return { ok: false, message: 'No dependent patient awaiting hygiene here.' };
    work = HYGIENE_WORK;
  } else if (kind === 'feed') {
    if (!feedPatient(s, { patient: building, x, y }) || siteId !== 'surface') return { ok: false, message: 'No patient waiting for a bedside meal here.' };
    cost = { food: 1 }; work = 8;
  } else if (kind === 'treat') {
    const patient = s.crew.find(c => c.id === building);
    if (siteId !== 'surface' || !patient || patient.health <= 0 || patient.site !== 'surface' || patient.medical.bed?.[0] !== x || patient.medical.bed?.[1] !== y || t.building !== 'medicalCot' || t.hp <= 0 || !breathable(roomAt(site, x, y)) || patient.medical.injury - patient.medical.treated <= 1e-8) return { ok: false, message: 'No patient awaiting treatment at this cot.' };
    cost = { medicine: 1 }; work = 20;
  } else if (kind === 'loadShuttle' || kind === 'unloadShuttle') {
    if (siteId !== 'surface' || t.building !== 'shuttle' || s.mission || (kind === 'loadShuttle' ? !s.departure : s.departure || !quantity(s.shuttle.supplies))) return { ok: false, message: 'Shuttle supply operation unavailable.' };
    cost = kind === 'loadShuttle' ? loadingCost(s) : {}; work = 3;
    if (kind === 'loadShuttle' && !quantity(cost)) return { ok: false, message: 'Missing supplies in depots or loose piles.' };
  } else if (kind === 'refit') {
    const fit = SHUTTLE_FITS[building];
    if (siteId !== 'surface' || t.building !== 'shuttle' || !fit || s.mission || s.departure || s.shuttle.fit === building) return { ok: false, message: 'Select an available shuttle and a different fitting.' };
    if (building !== 'standard' && !s.flags.salvageReturned) return { ok: false, message: 'Return satellite components before designing shuttle fittings.' };
    cost = fit.cost; work = 12;
  } else if (kind === 'service') {
    if (!maintainable(t) || t.hp <= 0 || !t.maintenance?.usage) return { ok: false, message: 'Select used, functioning equipment; repair broken equipment first.' };
    cost = { alloy: 1 }; work = 5;
  } else if (kind === 'repairWaterPipe' || kind === 'removeWaterPipe') {
    if (!t.waterPipe || (kind === 'repairWaterPipe' && t.waterPipe.hp >= 100)) return {ok:false,message:'Select a water pipe that needs this work.'};
    building=null;
    if (kind === 'repairWaterPipe') cost={alloy:1}; work=3;
  } else if (kind === 'repairPipe' || kind === 'removePipe') {
    if (!t.pipe || (kind === 'repairPipe' && t.pipe.hp >= 100)) return {ok:false,message:'Select a gas pipe that needs this work.'};
    building=null;
    if (kind === 'repairPipe') cost={alloy:1}; work=3;
  } else if (kind === 'repairCable' || kind === 'removeCable') {
    if (!t.cable || (kind === 'repairCable' && t.cable.hp >= 100)) return { ok: false, message: 'Select a cable that needs this work.' };
    if (kind === 'repairCable') cost = { alloy: 1 };
    work = 3;
  } else if (kind === 'mine') {
    if (!iceAvailable(t) && !['rock', 'ore'].includes(t.terrain) && !['salvage', 'volatile'].includes(t.building)) return { ok: false, message: 'Select an ice seam, rock, ore, satellite salvage, or comet volatiles.' };
    work = t.building === 'salvage' ? 12 : 7;
  } else if (kind === 'remove') {
    if (!t.building || ['shuttle', 'dock', 'collector', 'salvage', 'volatile'].includes(t.building)) return { ok: false, message: 'That structure cannot be dismantled.' };
  } else if (kind === 'repair') {
    if (!t.building || t.hp >= 100) return { ok: false, message: 'Select a damaged structure.' };
    cost = { alloy: 1 };
  } else return { ok: false, message: 'Unknown order.' };
  if(t.building==='breaker'&&['repair','remove'].includes(kind))building=null;
  const workers = s.crew.filter(c => c.site === siteId && c.health > 0);
  if (!workers.some(c => pathTo(site, c, neighbors(x, y)) !== null)) return { ok: false, message: 'No crew can reach that tile. Send an expedition or clear a route.' };
  const sources = reserveConstruction(s, siteId, x, y, cost, pathTo);
  if (!sources) return { ok: false, message: 'Not enough reachable supplies in depots or loose piles.' };
  const job = { id: `job-${s.nextId++}`, site: siteId, x, y, kind, building, cost, sources, materials: {}, work, remaining: work, worker: null, priority: 3, blockedReason: null, missingFood: 0, foodSpoiled: 0 };
  if(kind==='extinguish'){job.building=null;job.fire=t.fire.id;job.priority=5;}
  if (animalJob(job)) {job.animal=building;job.building=null;}
  if (kind === 'operate') { job.remaining = work - t.machine.progress; job.priority = t.machine.order.priority; }
  if (['feed', 'hygiene'].includes(kind)) { job.patient = building; job.building = null; job.priority = 5; }
  if (kind === 'treat') { job.patient = building; job.building = null; job.dose = Math.min(25, s.crew.find(c => c.id === building).medical.injury - s.crew.find(c => c.id === building).medical.treated); job.priority = 5; }
  s.jobs.push(job); emitEvent(s,'job.created',{entity:job.id,target:tileEntityId(siteId,x,y),kind,building,cost}); return { ok: true, job };
}
export function cancelJob(s, id, automatic = false) {
  const j = s.jobs.find(j => j.id === id); if (!j) return;
  if(transportJob(j)){releaseTransport(s,j,'cancelled');emitEvent(s,'animal.transport.cancelled',{entity:j.animal,job:j.id,automatic});}
  emitEvent(s,'job.cancelled',{entity:j.id,kind:j.kind,automatic});
  if(j.kind==='extinguish'&&!automatic){const f=at(s.sites[j.site],j.x,j.y).fire;if(f)f.retryAt=s.tick+FIRE.retry;}
  if (j.automaticMaintenance) { const m = at(s.sites[j.site], j.x, j.y).maintenance; if (m) { m.auto = false; m.blocked = null; } }
  if (j.kind === 'operate' && !automatic) { const t = at(s.sites[j.site], j.x, j.y); if (t.machine) { t.machine.enabled = false; t.machine.status = 'Paused by player'; refreshPower(s, s.sites[j.site]); } }
  if(animalJob(j)&&!automatic){const a=animalForJob(s,j);if(a)a.husbandry.retryAt=s.tick+120;}
  if (j.kind === 'hygiene' && !automatic) { const p = s.crew.find(c => c.id === j.patient); if (p) p.sanitation.retryAt = s.tick + HYGIENE_RETRY; }
  if (j.kind === 'feed' && !automatic) { const p = s.crew.find(c => c.id === j.patient); if (p) p.medical.feedRetryAt = s.tick + 120; }
  if (j.kind === 'treat') { const c = s.crew.find(c => c.id === j.patient); if (c) { if (!automatic) c.medical.retryAt = s.tick + 120; c.medical.bed = null; if (c.intent?.type === 'medical') c.intent = null; } }
  if (j.kind === 'loadShuttle') endDeparture(s,automatic?'loading_invalidated':'loading_cancelled');
  cancelMaterials(s, j);
  for (const c of s.crew) if (c.job === id) { c.job = null; c.activity = 'Order cancelled'; }
  s.jobs = s.jobs.filter(j => j.id !== id);
}
export function transportAnimalToPost(s,id,x,y){return requestTransport(s,id,x,y,cancelJob);}
export function setAnimalPost(s,id,x,y){return assignAnimal(s,id,x,y,animalPath,cancelJob);}
export function setAnimalPolicy(s,id,policy,enabled){return animalPolicy(s,id,policy,enabled,cancelJob);}
export function setLabor(s, crewId, labor, enabled) {
  const c = s.crew.find(c => c.id === crewId);
  if (!c || !Object.hasOwn(LABORS, labor) || typeof enabled !== 'boolean') return { ok: false, message: 'Invalid labor assignment.' };
  c.labors[labor] = enabled;
  const j = s.jobs.find(j => j.id === c.job);
  if (!enabled && j && laborFor(j) === labor) release(s, c);
  if (!enabled && labor === 'hauling' && c.intent?.type === 'haul') c.intent = null;
  return { ok: true };
}
export function setJobPriority(s, id, priority) {
  const job = s.jobs.find(j => j.id === id);
  if (!job || ![1, 3, 5].includes(priority)) return { ok: false, message: 'Invalid work priority.' };
  job.priority = priority; if (job.kind === 'operate') at(s.sites[job.site], job.x, job.y).machine.order.priority = priority; return { ok: true };
}
function assignJobs(s) {
  const queued = s.jobs.filter(j => !j.worker).sort((a, b) => b.priority - a.priority || (({ feed: 2, hygiene: 1 })[b.kind] || 0) - (({ feed: 2, hygiene: 1 })[a.kind] || 0) || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
  for (const j of queued) {
    const labor = laborFor(j), site = s.sites[j.site];
    const enabled = s.crew.filter(c => c.site === j.site && c.health > 0 && c.labors[labor]);
    const free = enabled.filter(c => availableForWork(c) && c.id !== j.patient && !boardingDeparture(s, c));
    const candidates = free.map(c => ({ c, path: transportJob(j)?transportRoute(s,j,c):materialRoute(j, c, site, pathTo) })).filter(a => a.path !== null);
    candidates.sort((a, b) => (workRate(b.c, labor) * 12 + (b.c.favoriteLabor === labor ? 3 : 0) - b.path.length * .25) - (workRate(a.c, labor) * 12 + (a.c.favoriteLabor === labor ? 3 : 0) - a.path.length * .25) || a.c.id.localeCompare(b.c.id));
    if (candidates.length) { const c = candidates[0].c; j.worker = c.id; c.job = j.id; j.blockedReason = null; }
    else j.blockedReason = !enabled.length ? `No crew assigned to ${LABORS[labor].toLowerCase()}` : !free.length ? 'Assigned crew are occupied or recovering' : !materialsReady(j) ? materialObstruction(j) : 'No reachable work position';
  }
}
function finish(s, c, j) {
  const site = s.sites[j.site], tile = at(site, j.x, j.y);
  if (j.kind === 'build') {
    if (['wall','fence','pastureGate'].includes(j.building) && [...s.crew,...s.creatures].some(other => other.site === j.site && other.x === j.x && other.y === j.y && other.health > 0)) { j.remaining = 1; j.blockedReason='Waiting for occupied boundary tile'; return; }
    if (j.building === 'waterPipe') tile.waterPipe=newWaterPipe();
    else if (j.building === 'gasPipe') tile.pipe=newPipe();
    else if (j.building === 'cable') tile.cable = { hp: 100, enabled: true };
    else { if (j.building === 'floor') tile.terrain = 'floor'; else tile.building = j.building; tile.hp = 100; if(j.building==='pastureGate')tile.gateMode='latched'; initializeStorage(tile); initializeElectrical(tile); }
    s.stats.built++; log(s, `${c.name.split(' ')[0]} completed ${BUILDINGS[j.building].name.toLowerCase()}.`, 'good');
  } else if (j.kind === 'mine') {
    const fromSeam = iceAvailable(tile);
    const loot = fromSeam ? { ice: Math.min(ICE_EXTRACTION_AMOUNT, tile.deposit.remaining) } : tile.building === 'salvage' ? { components: 3, alloy: 2 } : tile.building === 'volatile' ? { ice: 12, fuel: 3 } : { ore: tile.terrain === 'ore' ? 5 : 2 };
    if (fromSeam) tile.deposit.remaining -= loot.ice;
    spill(tile, loot);
    if (tile.building) tile.building = null; else if (!fromSeam) tile.terrain = 'ground';
    emitEvent(s,'resource.extracted',{entity:tileEntityId(j.site,j.x,j.y),actor:c.id,job:j.id,output:loot,...(fromSeam?{remaining:tile.deposit.remaining}:{})});
    if (fromSeam && tile.deposit.remaining === 0) emitEvent(s,'deposit.depleted',{entity:tileEntityId(j.site,j.x,j.y),actor:c.id,resource:'ice'});
    s.stats.mined++; log(s, j.site === 'surface' ? 'Material extracted. Crew will haul it to a cargo depot.' : 'Salvage extracted. Crew must carry it to the shuttle dock.', 'good');
  } else if(j.kind==='extinguish'){extinguish(s,site,tile,'suppressed',c.id,j.id);
  } else if(transportJob(j)){completeTransport(s,c,j);
  } else if(animalJob(j)){completeAnimalJob(s,c,j);
  } else if (j.kind === 'hygiene') { completeHygiene(s, j, c);
  } else if (j.kind === 'feed') { completeFeeding(s, j);
  } else if (j.kind === 'treat') { completeTreatment(s, j); log(s, `${c.name.split(' ')[0]} completed medical treatment.`, 'good');
  } else if (j.kind === 'loadShuttle') {
    const previous={...s.shuttle.supplies};add(s.shuttle.supplies, j.materials);
    emitEvent(s,'shuttle.supplies.loaded',{entity:'colony',site:'site:surface',destination:s.departure?`site:${s.departure.site}`:null,crewIds:[...(s.departure?.crew||[])],actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y),from:{entity:j.id,slot:'materials'},to:{entity:'colony',slot:'shuttle.supplies'},cargo:j.materials,previous,next:s.shuttle.supplies,tick:s.tick,reason:'loading_work_completed'});
  } else if (j.kind === 'unloadShuttle') {
    const cargo=s.shuttle.supplies;spill(tile,cargo);s.shuttle.supplies={};
    emitEvent(s,'shuttle.supplies.unloaded',{entity:'colony',site:'site:surface',crewIds:[],actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y),from:{entity:'colony',slot:'shuttle.supplies'},to:{entity:tileEntityId(j.site,j.x,j.y),slot:'drop'},cargo,previous:cargo,next:{},tick:s.tick,reason:'unloading_work_completed'});
  } else if (j.kind === 'refit') {
    const previous=s.shuttle.fit;s.shuttle.fit=j.building;
    emitEvent(s,'shuttle.refit.completed',{entity:'colony',site:'site:surface',crewIds:[],actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y),previous,next:j.building,cost:j.cost,capabilities:{capacity:SHUTTLE_FITS[j.building].capacity,travel:SHUTTLE_FITS[j.building].travel,fuel:SHUTTLE_FITS[j.building].fuel,damage:SHUTTLE_FITS[j.building].damage},tick:s.tick,reason:'supplied_work_completed'});
    log(s, `${SHUTTLE_FITS[j.building].name} installed on the shuttle.`, 'good');
  } else if (j.kind === 'remove') { const refund = BUILDINGS[tile.building]?.cost || {}; spill(tile, Object.fromEntries(Object.entries(refund).map(([r, n]) => [r, Math.floor(n / 2)]))); spillStorage(tile); if(gasEquipment(tile))removeGas(s,site,tile); if(waterEquipment(tile))removePlumbing(s,site,tile,at(site,c.x,c.y)); releaseReactorHeat(s,site,tile); delete tile.radiator; delete tile.tank; if (tile.building === 'battery') { releaseBatteryEnergy(site, tile); delete tile.charge; } delete tile.protection; delete tile.powerPriority; delete tile.maintenance; delete tile.climate; delete tile.gateMode; tile.building = null; }
  else if (j.kind === 'repair' || j.kind === 'service') { if((tile.building==='fence'||tile.building==='pastureGate'&&tile.gateMode==='latched')&&[...s.crew,...s.creatures].some(a=>a.site===j.site&&a.health>0&&a.x===j.x&&a.y===j.y&&(a.species==='bristleback'||!a.species&&tile.building==='fence'))){j.remaining=1;j.blockedReason='Waiting for occupied boundary tile';return;} completeService(s, tile); }
  else if (j.kind === 'repairWaterPipe') { tile.waterPipe.hp=100; }
  else if (j.kind === 'removeWaterPipe') { const recovery=at(site,c.x,c.y); removePlumbing(s,site,tile,recovery,true); spill(recovery,{alloy:.5}); }
  else if (j.kind === 'repairPipe') { tile.pipe.hp=100; }
  else if (j.kind === 'removePipe') { removeGas(s,site,tile,true); spill(tile,{alloy:.5}); }
  else if (j.kind === 'repairCable') { tile.cable.hp = 100; }
  else if (j.kind === 'removeCable') { spill(tile, { alloy: .5 }); tile.cable = null; }
  emitEvent(s,'job.completed',{entity:j.id,actor:c.id,target:tileEntityId(j.site,j.x,j.y),kind:j.kind,building:j.building});
  remember(s, c, 'finished-work', c.favoriteLabor === laborFor(j) ? 'Satisfied by work I enjoy.' : 'Finished useful work for the colony.', c.favoriteLabor === laborFor(j) ? 5 : 2);
  s.jobs = s.jobs.filter(job => job.id !== j.id); c.job = null; c.activity = 'Work complete'; updateRooms(site);
}
function move(c, site, goals) {
  const path = pathTo(site, c, goals);
  if (path === null) return 'blocked';
  if (!path.length) return 'arrived';
  moveCrew(c, site, path[0]); return 'moving';
}
function release(s, c) { const job = s.jobs.find(j => j.id === c.job); if (job) {releaseTransport(s,job);job.worker = null;} c.job = null; }
function recover(s, c, site) {
  // Emergencies may interrupt recovery, but normal work cannot.
  const personalClaim=c.intent?.keepsake?.id;
  const criticalAir = c.oxygen < airThreshold(c);
  if (criticalAir && c.intent?.type !== 'air') { preserveOpenedMeal(c); release(s, c); c.intent = { type: 'air', target: null }; }
  else if (c.intent?.type === 'air' && c.oxygen >= 90) { c.intent = null; remember(s, c, 'safe-air', 'Reached breathable shelter.', 4); }
  if (!criticalAir && Math.abs(c.thermalStress) >= 45 && c.intent?.type !== 'temperature' && !(c.intent?.type === 'meal' && c.intent.servings > 0)) { release(s, c); c.intent = { type: 'temperature', target: null }; }
  if (!criticalAir && Math.abs(c.thermalStress) < 45 && c.hunger < 10 && !c.medical.servings && c.intent?.type !== 'meal') { release(s, c); c.intent = { type: 'meal', target: null, servings: 0 }; }
  if (!c.intent || ['haul', 'leisure', 'medical'].includes(c.intent.type)) {
    if (!c.medical.servings && c.hunger < (boardingDeparture(s, c) ? 40 : 35)) { release(s, c); c.intent = { type: 'meal', target: null, servings: 0 }; }
    else if (c.energy < (boardingDeparture(s, c) ? 40 : 25)) { release(s, c); c.intent = { type: 'rest', target: null }; }
  }
  if(personalClaim&&c.intent?.keepsake?.id!==personalClaim)emitEvent(s,'item.pickup.cancelled',{entity:personalClaim,actor:c.id,reason:'recovery'});
  const intent = c.intent;
  if (!intent || ['haul', 'leisure', 'medical'].includes(intent.type)) return false;
  if (intent.type === 'air') {
    remember(s, c, 'air-scare', 'Nearly ran out of suit air.', -12);
    const targets = site.rooms.filter(breathable).flatMap(r => r.cells.map(k => k.split(',').map(Number)));
    const result = move(c, site, targets); c.activity = result === 'blocked' ? 'No reachable breathable shelter' : result === 'arrived' ? 'Replenishing suit air' : 'Seeking breathable air';
    return true;
  }
  if (intent.type === 'temperature') {
    if (Math.abs(c.thermalStress) <= 10 && thermalSafe(roomAt(site, c.x, c.y))) { c.intent = null; remember(s, c, 'thermal-recovery', 'Recovered in a temperate compartment.', 4); return false; }
    const targets = site.rooms.filter(r => breathable(r) && thermalSafe(r)).flatMap(r => r.cells.map(k => k.split(',').map(Number)));
    const result = move(c, site, targets); c.activity = result === 'blocked' ? 'No reachable temperate shelter' : result === 'arrived' ? 'Recovering from temperature exposure' : 'Seeking temperate shelter';
    return true;
  }
  if (intent.type === 'meal') {
    if (intent.servings > 0) {
      c.activity = 'Eating a meal'; c.hunger = Math.min(100, c.hunger + 10); intent.servings--; digestPortion(c); eatPortion(s,c,intent);
      if (intent.servings === 0) { c.intent = null; remember(s, c, 'good-meal', 'Had a proper meal.', 5); }
      return true;
    }
    const foodStores = site.tiles.filter(t => (t.building === 'stockpile' && (t.stock?.food || 0) >= 1) || (t.drop?.food || 0) >= 1).map(t => [t.x, t.y]);
    const carriedMeal = (c.carry?.food || 0) >= 1;
    const result = carriedMeal ? 'arrived' : move(c, site, foodStores);
    const tile = at(site, c.x, c.y), food = carriedMeal ? c.carry : (tile.stock?.food || 0) >= 1 ? tile.stock : tile.drop;
    const ration = result === 'arrived' && food ? extract(food, { food: 1 }) : null;
    if (ration) {
      openMeal(s,c,intent,ration);
      if (tile.drop && !quantity(tile.drop)) tile.drop = null;
      if (c.carry && !quantity(c.carry)) { c.carry = null; c.delivery = null; } intent.servings = 8; c.activity = 'Taking a ration'; }
    else { c.activity = !foodStores.length ? 'Waiting for food' : result === 'blocked' ? 'Food store unreachable' : 'Getting a meal'; if (!foodStores.length || result === 'blocked') remember(s, c, 'missed-meal', 'Could not get a meal.', -8); }
    return true;
  }
  if (intent.type === 'rest') {
    if (c.energy >= 85) { c.intent = null; remember(s, c, 'rested', 'Woke up rested in a bunk.', 6); return false; }
    const claimed = new Set(s.crew.filter(other => other.id !== c.id && other.site === c.site && other.health > 0 && other.intent?.type === 'rest' && other.intent.target).map(other => key(...other.intent.target)));
    const valid = (x, y) => inside(site, x, y) && at(site, x, y).building === 'bunk' && bunkAccessible(s,c,site,x,y) && livingAllowed(site, x, y) && at(site, x, y).hp > 0 && breathable(roomAt(site, x, y)) && thermalSafe(roomAt(site, x, y)) && !claimed.has(key(x, y));
    if (intent.target && !valid(...intent.target)) intent.target = null;
    if (!intent.target) {
      if (c.housing.bunk && housingObstruction(s,c,pathTo)) remember(s,c,'housing-displaced','Could not use my assigned bunk; had to find another place to rest.',-6);
      const options = site.tiles.filter(t => valid(t.x, t.y)).map(t => ({ t, path: pathTo(site, c, [[t.x, t.y]]) })).filter(v => v.path !== null).sort((a, b) => Number(ownsBunk(c,site.id,b.t.x,b.t.y)) - Number(ownsBunk(c,site.id,a.t.x,a.t.y)) || Number(roomBenefit(s, site, b.t, 'quarters')) - Number(roomBenefit(s, site, a.t, 'quarters')) || a.path.length - b.path.length);
      if (options.length) intent.target = [options[0].t.x, options[0].t.y];
    }
    if (intent.target) {
      const result = move(c, site, [intent.target]);
      c.activity = result === 'arrived' ? 'Sleeping until rested' : 'Going to a reserved bunk';
      if (result === 'arrived') { c.energy = Math.min(100, c.energy + (roomBenefit(s, site, { x: c.x, y: c.y }, 'quarters') ? 1.05 : .85)); rememberHousingSleep(s,c,site); experienceComfort(s,c,site); }
      if (result === 'blocked') { intent.target = null; c.activity = 'Bunk route blocked'; }
    } else {
      remember(s, c, 'no-bunk', 'Could not find an available safe bunk.', -8);
      if (c.energy >= 50) { c.intent = null; remember(s, c, 'poor-sleep', 'Slept poorly on the floor.', -6); return false; }
      if (livingAllowed(site, c.x, c.y) && breathable(roomAt(site, c.x, c.y)) && thermalSafe(roomAt(site, c.x, c.y))) { c.energy = Math.min(100, c.energy + .18); c.activity = 'Resting on the floor; needs a bunk'; }
      else {
        const goals = site.rooms.filter(r => breathable(r) && thermalSafe(r)).flatMap(r => r.cells.map(k => k.split(',').map(Number))).filter(([x,y]) => livingAllowed(site,x,y));
        const result = move(c, site, goals); c.activity = result === 'blocked' ? 'Waiting for a safe, available bunk' : 'Seeking a living area for rest';
      }
    }
    return true;
  }
  return false;
}
function act(s, c) {
  if (c.health <= 0) { if (c.site !== 'transit' && c.activity !== 'Deceased') { dropPossession(s,c); dropOpenedMeals(s, c); dropSanitation(s, c); release(s, c); c.intent = null; dropCarriedMaterials(s, c); c.activity = 'Deceased'; log(s, `${c.name} has died.`, 'danger'); } return; }
  if (c.site === 'transit') return;
  const site = s.sites[c.site], room = roomAt(site, c.x, c.y);
  updateMorale(s, c);
  c.hunger = Math.max(0, c.hunger - .05); c.energy = Math.max(0, c.energy - (c.job ? .065 : .03));
  breathe(site, c);
  const thermalDamage = thermalExposure(c, site, !breathable(room));
  if (thermalDamage) injure(s, c, thermalDamage, c.thermalStress < 0 ? 'cold exposure' : 'heat exposure');
  if (c.medical.servings > 0) { c.hunger = Math.min(100, c.hunger + 10); c.medical.servings--; digestPortion(c); eatPortion(s,c,c.medical); }
  const flame=at(site,c.x,c.y).fire;if(flame){injure(s,c,.2+flame.intensity*.01,'fire exposure');emitEvent(s,'fire.exposure',{entity:flame.id,actor:c.id});}
  if (c.oxygen <= 0 || c.hunger <= 0) injure(s, c, .5, c.oxygen <= 0 ? 'oxygen deprivation' : 'starvation');
  else if (breathable(room) && thermalSafe(room) && room.air > 60 && c.hunger > 40) c.health = Math.min(100 - c.medical.injury, c.health + .03);
  if (c.health <= 0) { dropPossession(s,c); dropOpenedMeals(s, c); dropSanitation(s, c); release(s, c); c.intent = null; dropCarriedMaterials(s, c); c.activity = 'Deceased'; log(s, `${c.name} has died.`, 'danger'); return; }
  if(evadeFire(s,c,site,pathTo,release))return;
  if (rescue(s, c, site, pathTo)) return;
  if (dependentCare(s, c, site, pathTo, release)) return;
  if (c.site !== 'surface' && s.mission?.phase === 'boarding') { boardShuttle(s, c, site, pathTo); return; }
  if (c.site !== 'surface' && (c.carry || c.intent?.type === 'salvage') && haulSalvage(s, c, site, pathTo)) return;
  if (c.site === 'surface' && recover(s, c, site)) return;
  if (useSanitation(s, c, site, pathTo, release)) return;
  if (c.carry && haul(s, c, site, pathTo)) return;
  if (c.site === 'surface' && medicalRest(s, c, site, pathTo)) return;
  if (boardingDeparture(s, c)) { if (c.intent?.type === 'leisure') c.intent = null; walkToDeparture(s, c, pathTo); return; }
  if (c.site === 'surface' && leisure(s, c, site, pathTo)) return;
  const j = s.jobs.find(j => j.id === c.job);
  if (j) {
    const labor = laborFor(j);
    if(j.kind==='extinguish'&&!fireJobValid(s,j)){cancelJob(s,j.id,true);return;}
    if(j.kind!=='extinguish'&&at(site,j.x,j.y).fire){release(s,c);j.blockedReason='Waiting for fire suppression';return;}
    if(animalJob(j)&&!animalJobValid(s,j)){cancelJob(s,j.id,true);return;}
    if (j.kind === 'hygiene' && !hygienePatient(s, j)) { cancelJob(s, j.id, true); return; }
    if (j.kind === 'feed' && !feedPatient(s, j)) { cancelJob(s, j.id, true); return; }
    if (j.kind === 'treat' && !treatmentPatient(s, j)) { cancelJob(s, j.id); return; }
    if (!c.labors[labor]) { release(s, c); return; }
    if(transportJob(j)){if(actTransport(s,c,j,release))finish(s,c,j);return;}
    if (j.kind === 'operate') { operateMachine(s, c, j, site, pathTo); return; }
    if (!materialsReady(j)) { fetchMaterials(s, c, j, site, pathTo); return; }
    c.activity = j.kind==='extinguish'?'Suppressing a fire':animalJob(j) ? (j.kind==='animalCare'?'Feeding and handling a bristleback':'Collecting nutrient curd') : j.kind === 'hygiene' ? 'Providing bedside hygiene' : j.kind === 'feed' ? 'Serving a bedside meal' : j.kind === 'treat' ? 'Treating injuries' : j.kind === 'loadShuttle' ? 'Loading shuttle stores' : j.kind === 'unloadShuttle' ? 'Unloading shuttle stores' : j.kind === 'refit' ? `Installing ${SHUTTLE_FITS[j.building].name.toLowerCase()}` : j.kind === 'build' ? `Building ${BUILDINGS[j.building].name.toLowerCase()}` : j.kind === 'mine' ? 'Extracting material' : `${j.kind === 'service' ? 'Servicing' : ['repair', 'repairCable'].includes(j.kind) ? 'Repairing' : 'Dismantling'} ${j.kind.endsWith('Cable') ? 'cable' : 'structure'}`;
    const result = move(c, site, neighbors(j.x, j.y));
    if(result==='arrived'&&animalJob(j)){const a=animalForJob(s,j);if(a.x!==j.x||a.y!==j.y){c.activity=j.blockedReason='Waiting for animal at the post';return;}}
    if (result === 'arrived' && j.kind === 'hygiene' && !hygieneReady(s, j, c)) { c.activity = j.blockedReason = 'Waiting for patient and safe hygiene conditions'; return; }
    if (result === 'arrived' && j.kind === 'treat' && !treatmentReady(s, j, c)) { c.activity = j.blockedReason = 'Waiting for patient and safe treatment conditions'; return; }
    if (result === 'arrived') { j.blockedReason = null; const effort = Math.min(j.remaining, workRate(c, labor)); j.remaining -= effort; gainExperience(c, labor, effort); if (j.remaining <= 0) finish(s, c, j); }
    if (result === 'blocked') { release(s, c); c.activity = 'Route blocked'; }
    return;
  }
  c.job = null;
  if (c.site === 'surface' && haul(s, c, site, pathTo)) return;
  if (c.site !== 'surface' && haulSalvage(s, c, site, pathTo)) return;
  c.activity = c.site === 'surface' ? 'Available for assigned work' : 'Awaiting expedition orders';
}
export function launch(s, siteId, crewIds = undefined) {
  const blocked=expeditionLaunchBlock(s,siteId);if(blocked)return {ok:false,message:blocked.message,code:blocked.code};
  const selected=selectExpeditionCrew(s,crewIds);if(!selected.ok)return selected;
  planDeparture(s, siteId, selected.crew); updateDeparture(s, order, release);
  log(s, `Preparing expedition to ${SITES[siteId].name}. Load supplies, then board.`, 'info'); return { ok: true };
}
function endDeparture(s,reason) {
  const d=s.departure;if(!d)return;
  s.departure=null;
  emitEvent(s,'expedition.preparation.cancelled',{entity:'colony',site:`site:${d.site}`,crewIds:[...d.crew],previous:d.stage,next:null,from:{entity:'colony',slot:'departure'},to:null,target:tileEntityId('surface',16,11),supplies:s.shuttle.supplies,requested:d.target,reason,tick:s.tick});
}
export function cancelDeparture(s) {
  if (!s.departure) return { ok: false, message: 'No departure preparation to cancel.' };
  endDeparture(s,'player');
  for (const j of [...s.jobs].filter(j => j.kind === 'loadShuttle')) cancelJob(s, j.id);
  return { ok: true };
}
function missionEvent(s,event,m,previous,next,details={}) {
  emitEvent(s,event,{entity:'colony',site:`site:${m.site}`,crewIds:[...m.crew],previous,next,cargo:m.cargo,tick:s.tick,...details});
}
export function recall(s,reason='player') {
  const m = s.mission; if (!m || ['returning', 'boarding'].includes(m.phase)) return { ok: false, message: 'No expedition to recall.' };
  const previous=m.phase;
  // Verify and spend an outbound turn-back's reserved fuel before changing
  // crew jobs or plans; rejected recall must not partly cancel an expedition.
  if(previous==='outbound'&&!spendReturnFuel(s))return {ok:false,message:'Return fuel unavailable.'};
  for (const c of s.crew.filter(c => m.crew.includes(c.id))) { release(s, c); c.intent = null; c.activity = 'Returning to shuttle'; }
  for (const j of [...s.jobs].filter(j => j.site === m.site)) cancelJob(s, j.id);
  if (previous === 'outbound') { m.phase = 'returning'; m.remaining = routeTime(s, m.site); }
  else { m.phase = 'boarding'; m.remaining = 0; }
  missionEvent(s,'expedition.recalled',m,previous,m.phase,{reason,remaining:m.remaining,from:`site:${m.site}`,to:'site:surface'});
  log(s, 'Expedition recalled. Crew must reach the dock; uncollected salvage stays on site.'); return { ok: true };
}
function updateFieldHazards(s, m) {
  const dock = dockAt(s.sites[m.site]);
  const crew = s.crew.filter(c => m.crew.includes(c.id) && c.health > 0 && (!dock || c.x !== dock.x || c.y !== dock.y));
  if (m.site === 'solar') {
    const storm = s.tick % 120 >= 90;
    m.heat = Math.max(0, Math.min(100, m.heat + (storm ? 2 : -.7)));
    if (m.phase === 'working' && !storm && s.tick % 15 === 0) spill(at(s.sites.solar, 10, 8), { cells: 1 });
    if (storm && s.tick % 10 === 0) { crew.forEach(c => injure(s, c, 3 * SHUTTLE_FITS[m.fit].damage, 'solar exposure')); log(s, 'Solar squall. Collectors retracted; crew sheltering.', 'danger'); }
  }
  if (m.site === 'wreck' && s.tick % 65 === 0) { crew.forEach(c => injure(s, c, 4 * SHUTTLE_FITS[m.fit].damage, 'debris impact')); log(s, 'Debris impact at Relay K-07. Suit seals holding.', 'danger'); }
}
function updateMission(s) {
  const m = s.mission; if (!m) return;
  if (['working', 'boarding'].includes(m.phase)) {
    updateFieldHazards(s, m);
    for (const c of s.crew.filter(c => m.crew.includes(c.id) && c.health <= 0 && c.site !== 'transit')) { release(s, c); c.intent = null; if (c.carry) dropCarriedMaterials(s, c); }
  }
  if (m.phase === 'boarding') {
    const site = s.sites[m.site], dock = dockAt(site), crew = s.crew.filter(c => m.crew.includes(c.id) && c.health > 0);
    if (!dock || crew.some(c => c.x !== dock.x || c.y !== dock.y || c.carry || c.rescue)) return;
    if (!spendReturnFuel(s)) return;
    for (const c of crew) { c.site = 'transit'; c.activity = 'Returning to colony'; }
    m.phase = 'returning'; m.remaining = routeTime(s, m.site);
    missionEvent(s,'expedition.return.departed',m,'boarding','returning',{reason:'team_boarded',from:tileEntityId(site.id,dock.x,dock.y),to:'site:surface',aboard:crew.map(c=>c.id),remaining:m.remaining});
    log(s, 'Team aboard. Shuttle returning with loaded cargo.'); return;
  }
  if (m.phase !== 'working') {
    if (--m.remaining > 0) return;
    if (m.phase === 'outbound') {
      m.phase = 'working'; deployKit(s); s.sites[m.site].explored = true;
      m.crew.forEach((id, i) => { const c = s.crew.find(c => c.id === id); c.site = m.site; c.x = m.site === 'wreck' ? 4 + i : 5 + i; c.y = 10; c.activity = 'Expedition ready'; });
      missionEvent(s,'expedition.arrived',m,'outbound','working',{reason:'outbound_transit_completed',from:'site:surface',to:`site:${m.site}`,positions:m.crew.map(id=>{const c=s.crew.find(c=>c.id===id);return {entity:id,tile:tileEntityId(c.site,c.x,c.y)};}),collector:m.collector});
      log(s, `Arrived at ${SITES[m.site].name}. ${m.site === 'solar' ? 'Collectors deployed.' : 'Designate material for salvage.'}`, 'discovery');
    } else {
      const returned=[];
      for (const id of m.crew) { const c = s.crew.find(c => c.id === id); if (c.site !== 'transit') continue; c.site = 'surface'; c.x = 10; c.y = 11; c.activity = 'Returned from expedition'; returned.push(id); }
      spill(at(s.sites.surface, 16, 11), m.cargo);
      if (m.cargo.components&&!s.flags.salvageReturned) {
        s.flags.salvageReturned=true;
        missionEvent(s,'expedition.upgrade.unlocked',m,false,true,{reason:'components_returned',unlock:'salvageReturned',destination:'site:solar',target:tileEntityId('surface',16,11),components:m.cargo.components});
      }
      if (m.cargo.components && !s.flags.tibblesIntroduced) {
        s.flags.tibblesIntroduced = true;
        s.creatures.push({ id: `tibble-${s.nextId++}`, species: 'tibble', site: 'surface', x: 8, y: 10, health: 100, fed: 30, age: 0 });
        log(s, 'A pale seed-mite crawled out of the recovered cargo. Food stores are at risk. Build a biofilter trap near the depot.', 'danger');
      }
      s.stats.returned++; s.stats.solarCells += m.cargo.cells || 0;
      s.mission=null;
      missionEvent(s,'expedition.returned',m,'returning',null,{reason:'return_transit_completed',from:{entity:'colony',slot:'mission.cargo'},to:{entity:tileEntityId('surface',16,11),slot:'drop'},returned,remainingAtSite:m.crew.filter(id=>s.crew.find(c=>c.id===id).site===m.site)});
      log(s, `Expedition home. Awaiting unloading: ${resourceEntries(m.cargo).map(([r, n]) => `${n} ${r}`).join(', ') || 'no cargo'}.`, 'good');
    }
    return;
  }
  const crew = s.crew.filter(c => m.crew.includes(c.id));
  if (crew.some(c => c.oxygen < airThreshold(c) || c.health < 40 || c.energy < 25 || c.hunger < 25) || (m.site === 'comet' && s.tick + routeTime(s, 'comet') + returnWalk(s, pathTo) + 5 >= s.comet.leaves)) { log(s, 'Automatic recall: expedition safety margin reached.', 'danger'); recall(s,'safety_margin'); return; }

}
export function step(s, ticks = 1) {
  for (let n = 0; n < ticks; n++) {
    capture(s, 'external');
    const pastureBefore=pastureSnapshot(s);
    s.tick++; reconcileHousing(s); const site = s.sites.surface; updateDebris(s); flowPlumbing(s); flowLiquids(s);
    const operating = Object.values(s.sites).map(current => [current, updatePower(s, current)]);
    pumpLiquids(s); operatePlumbing(s); updateGasNetworks(s); updateAtmosphere(s); updateThermal(s); updateReactorCooling(s); updateFire(s); prepareFire(s,order,cancelJob); updateFood(s, pathTo); updateSanitation(s);
    for (const [current, equipment] of operating) recordOperation(s, current, equipment);
    scheduleMaintenance(s, order);
    updateIndustry(s, roomAt, order);
    updateDeparture(s, order, release);
    prepareMedicine(s, order, cancelJob, release, pathTo);
    prepareNursing(s, order, cancelJob, release, pathTo);
    prepareHygiene(s, order, cancelJob, release);
    reconcileTransport(s,cancelJob);
    prepareHusbandry(s,order,cancelJob);
    prepareDowntime(s, release);
    assignJobs(s);
    for (const c of s.crew) act(s, c);
    updateMission(s);
    reconcileNursing(s, cancelJob); reconcileHygiene(s, cancelJob);
    updateDeparture(s, order, release); tryDeparture(s, log);
    reconcileTransport(s,cancelJob);
    updateEcology(s);
    reconcileTransport(s,cancelJob);
    prepareHusbandry(s,order,cancelJob);
    prepareFire(s,order,cancelJob);
    updateCrewLife(s); reconcileHousing(s);
    for (const current of Object.values(s.sites)) { refreshAtmosphere(current); refreshPower(s, current); }
    const unsafe = site.rooms.some(r => !breathable(r) && r.cells.some(k => { const [x, y] = k.split(',').map(Number); return ['scrubber', 'farm', 'bunk'].includes(at(site, x, y).building); }));
    if (unsafe !== !!s.flags.airWarning) { s.flags.airWarning = unsafe; log(s, unsafe ? 'Habitat air is unsafe. Crew are using suits; check pressure, exhaled gas, seals, and life support.' : 'Habitat atmosphere is breathable again.', unsafe ? 'danger' : 'good'); }
    const thermalDanger = site.rooms.some(r => !thermalSafe(r) && r.cells.some(k => { const [x, y] = k.split(',').map(Number); return ['bunk', 'farm', 'medicalCot'].includes(at(site, x, y).building); }));
    if (thermalDanger !== !!s.flags.thermalWarning) { s.flags.thermalWarning = thermalDanger; log(s, thermalDanger ? 'Habitat temperature is unsafe. Check climate units, power and hull seals.' : 'Habitat temperature is safe again.', thermalDanger ? 'danger' : 'good'); }
    syncResources(s);
    if (s.tick === 95) { s.anomaly = { id: 'dead-channel', title: 'The voice on channel zero', description: 'An obsolete rescue beacon is repeating your landing clearance. The recording is dated eleven years from now. A narrow-band echo might reveal a supply cache—or something could be listening.', resolved: false }; log(s, 'Unregistered transmission on a dead rescue frequency. Review the signal in colony status.', 'discovery'); }
    if (s.tick === s.comet.arrives) { s.sites.comet.explored = true; log(s, 'The Wayfarer enters range. A brief window to harvest ice and volatiles.', 'discovery'); }
    if (s.tick === s.comet.leaves) { log(s, 'The Wayfarer is leaving this region. Next pass is being calculated.'); s.comet = { arrives: s.tick + 400, leaves: s.tick + 700 }; }
    if (s.tick % 300 === 220) log(s, 'Nightfall. Solar arrays offline; habitat draws on battery reserves.');
    if (s.tick % 300 === 0) log(s, 'Sunrise. Solar generation restored.', 'good');
    s.objectives = { build: s.stats.built > 0, extract: s.stats.mined > 0, salvage: !!s.flags.salvageReturned, advanced: site.tiles.some(t => t.building === 'advanced'), solar: s.stats.solarCells > 0 };
    recordPastureChanges(s,pastureBefore);
    capture(s, 'simulation.tick');
  }
}
function updateEcology(s) {
  const site = s.sites.surface,pastures=pastureRegions(site),positions=new Map(s.creatures.map(a=>[a.id,[a.x,a.y]]));
  for (const creature of [...s.creatures]) {
    if(creature.health<=0)continue;
    const region=pastures.byCell.get(creature.y*site.size+creature.x),post=creature.husbandry?.post;
    const roamPasture=!!region?.enclosed&&!!post&&pastures.byCell.get(post[1]*site.size+post[0])===region;
    creature.age++; creature.fed = Math.max(0, creature.fed - (creature.species==='bristleback'&&!adult(creature)?.008:.015));
    const flame=at(site,creature.x,creature.y).fire;
    if(flame){creature.health=Math.max(0,creature.health-.2-flame.intensity*.01);emitEvent(s,'fire.exposure',{entity:flame.id,actor:creature.id});if(creature.health<=0)emitEvent(s,'animal.died',{entity:creature.id,cause:'fire'});else {const route=animalPath(site,creature,neighbors(creature.x,creature.y));if(route?.length)moveAnimal(s,creature,route[0],'fire_escape');}continue;}
    if(creature.species==='bristleback'){animalCondition(s,creature);if(creature.health<=0)continue;if(heldForTransport(s,creature))continue;if(moveAssignedAnimal(s,creature,animalPath,roamPasture))continue;}
    if (s.tick % (creature.species === 'bristleback' ? 9 : 5) !== 0) continue;
    if (creature.species === 'bristleback') {
      const tile = at(site, creature.x, creature.y);
      if (tile.lichen > 0) { const eaten=Math.min(adult(creature)?5:2.5,tile.lichen);tile.lichen -= eaten; creature.fed = Math.min(100, creature.fed + 4);emitEvent(s,'animal.grazed',{entity:creature.id,target:tileEntityId('surface',tile.x,tile.y),lichen:eaten}); }
      else { const choices = neighbors(creature.x, creature.y).filter(([x, y]) => animalPassable(site, x, y) && at(site, x, y).terrain === 'ground' && (!at(site, x, y).building || ['fence','pastureGate','husbandryPost'].includes(at(site,x,y).building)) && (roamPasture || !creature.husbandry.post || Math.abs(x-creature.husbandry.post[0])+Math.abs(y-creature.husbandry.post[1])<=2)); if (choices.length) { choices.sort((a, b) => (at(site, ...b).lichen || 0) - (at(site, ...a).lichen || 0)); moveAnimal(s,creature,choices[Math.floor(random(s) * Math.min(2, choices.length))],'grazing'); } }
    } else {
      const foodTiles = site.tiles.filter(t => (t.stock?.food || 0) >= 1 || (t.machine?.output.food || 0) >= 1 || (t.drop?.food || 0) >= 1);
      const p = animalPath(site, creature, foodTiles.map(t => [t.x, t.y]));
      if (p?.length) moveAnimal(s,creature,p[0],'food');
      if (p?.length === 0 && s.tick % 30 === 0) {
        const here = at(site, creature.x, creature.y);
        const food = [here.stock, here.machine?.output, here.drop].find(v => (v?.food || 0) >= 1);
        if (!food || !take(food, { food: 1 })) continue;
        if (here.drop && !quantity(here.drop)) here.drop = null;
        creature.fed = Math.min(100, creature.fed + 25);
        const t = at(site, creature.x, creature.y); if (t.building === 'farm') t.hp = Math.max(0, t.hp - 5);
        emitEvent(s,'pest.fed',{entity:creature.id,target:tileEntityId('surface',creature.x,creature.y),food:1});
        log(s, 'Tibbles consumed a ration from the colony’s biomass supply.', 'danger');
      }
      if (creature.fed >= 70 && creature.age >= 60 && s.creatures.filter(c => c.species === 'tibble').length < 12) { creature.fed -= 40; creature.age = 0; const child={ ...creature, id: `tibble-${s.nextId++}`, fed: 20, age: 0 };s.creatures.push(child);emitEvent(s,'pest.born',{entity:child.id,parent:creature.id,target:tileEntityId('surface',child.x,child.y)}); log(s, 'A tibble clutch has hatched. Contain the infestation before it grows.', 'danger'); }
    }
  }
  updateBreeding(s,positions);
  if (s.tick % 10 === 0) for (const trap of site.tiles.filter(t => t.building === 'trap')) {
    const pest = s.creatures.find(c => c.species === 'tibble' && c.health>0 && Math.abs(c.x - trap.x) + Math.abs(c.y - trap.y) <= 6);
    if (pest && spend(s, { food: .25 }, t => Math.abs(t.x - trap.x) + Math.abs(t.y - trap.y) <= 6 && pathTo(site, t, [[trap.x, trap.y]]) !== null)) { s.creatures = s.creatures.filter(c => c.id !== pest.id); s.stats.trapped++;emitEvent(s,'pest.captured',{entity:pest.id,target:tileEntityId('surface',trap.x,trap.y)}); log(s, 'Biofilter trap secured a tibble. Cargo infestation reduced.', 'good'); }
  }
  if (s.tick % 60 === 0) for (const t of site.tiles) if (t.lichen !== undefined) t.lichen = Math.min(100, t.lichen + 2);
}
export function resolveSignal(s, investigate) {
  if (!s.anomaly || s.anomaly.resolved) return { ok: false, message: 'No unresolved signal.' };
  if (investigate && !spend(s, { components: 1 }, connectedTo(s, [16, 11]))) return { ok: false, message: 'Decoding requires 1 component.' };
  s.anomaly.resolved = true;
  if (investigate) { spill(at(s.sites.surface, 16, 11), { fuel: 3 }); for (const c of s.crew) c.energy = Math.max(0, c.energy - 8); log(s, 'The signal led to a buried fuel cache. Now it repeats the names of your crew. Nobody slept well. (3 fuel awaiting haul, crew energy −8)', 'discovery'); }
  else log(s, 'Channel zero isolated. For a moment, the receiver continued speaking without power.');
  return { ok: true };
}
export function dischargeCell(s, x = null, y = null) {
  if (!canAfford(s, { cells: 1 })) return { ok: false, message: 'No charged cells. Recover them from Helios Reach.' };
  const site = s.sites.surface;
  const banks = site.tiles.filter(t => t.building === 'battery' && t.hp > 0 && (x === null || (t.x === x && t.y === y)));
  const candidates = stores(s).filter(t => (t.stock.cells || 0) >= 1).map(depot => ({ depot, banks: banks.filter(b => pathTo(site, depot, [[b.x, b.y]]) !== null) }));
  const target = candidates.find(c => c.banks.reduce((n, b) => n + BATTERY_CAPACITY - b.charge, 0) >= 100 - 1e-9);
  if (!target) return { ok: false, message: 'Need 100 kJ of free capacity in healthy banks reachable from a stored power cell.' };
  if (!spend(s, { cells: 1 }, t => t === target.depot)) return { ok: false, message: 'Power cell is no longer available.' };
  let remaining = 100;
  for (const b of target.banks) { const n = Math.min(remaining, BATTERY_CAPACITY - b.charge); b.charge += n; remaining -= n; }
  site.energy.injected += 100; refreshPower(s, site); return { ok: true };
}
export function serialize(s) { return JSON.stringify(s); }
export function deserialize(text) {
  if (text.length > 5_000_000) throw new Error('Save is too large.');
  const s = JSON.parse(text);
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, VERSION].includes(s?.version) || !Number.isSafeInteger(s.tick) || s.tick < 0 || !Number.isInteger(s.rng) || !Number.isSafeInteger(s.nextId)) throw new Error('Unsupported or invalid save.');
  if (!s.sites || !Array.isArray(s.crew) || s.crew.length !== 7 || !Array.isArray(s.jobs) || !Array.isArray(s.log) || !s.stats || !s.comet || !s.flags || !s.objectives) throw new Error('Incomplete save.');
  if(s.version<35&&s.jobs.some(j=>['repairWaterPipe','removeWaterPipe'].includes(j?.kind)||j?.kind==='build'&&(j.building==='waterPipe'||waterEquipment({building:j.building}))))throw new Error('Plumbing work is not valid in this older save.');
  if(s.version<36&&s.jobs.some(j=>j?.building==='breaker'))throw new Error('Breaker work is not valid in this older save.');
  if(s.version<24&&s.resources&&s.resources.ice===undefined)s.resources.ice=0;
  if(s.version<23&&s.resources&&s.resources.keepsakes===undefined)s.resources.keepsakes=0;
  if (s.version < 17 && s.resources && s.resources.fertilizer === undefined) s.resources.fertilizer = 0;
  if (s.version < 16 && s.resources && s.resources.waste === undefined) s.resources.waste = 0;
  if (s.version < 11 && s.resources && s.resources.medicine === undefined) s.resources.medicine = 0;
  const retrofitAir = s.version < 5 && s.resources && s.resources.air === undefined;
  if (retrofitAir) s.resources.air = 160;
  for (const r of RESOURCES) if (!Number.isFinite(s.resources?.[r]) || s.resources[r] < 0) throw new Error('Invalid resources.');
  for (const id of Object.keys(SITES)) {
    const site = s.sites[id], size = id === 'surface' ? 26 : 18;
    if (site?.id !== id || site.size !== size || site.tiles?.length !== size ** 2 || !Array.isArray(site.rooms) || !site.power) throw new Error('Invalid site.');
    if(s.version<35&&site.tiles.some(t=>waterEquipment(t)||t.building==='waterPipe'))throw new Error('Plumbing equipment is not valid in this older save.');
    if(s.version<36&&site.tiles.some(t=>t.building==='breaker'||t.protection!==undefined))throw new Error('Breaker protection is not valid in this older save.');
    site.tiles.forEach((t, i) => { if (t.x !== i % size || t.y !== Math.floor(i / size) || !['ground', 'rock', 'ore', 'floor', 'deck', 'ice', 'void'].includes(t.terrain) || (t.building && !BUILDINGS[t.building] && !['shuttle', 'dock', 'salvage', 'volatile', 'collector'].includes(t.building)) || !Number.isFinite(t.hp)) throw new Error('Invalid tile.'); });
  }
  const ids = new Set();
  for (const c of s.crew) {
    if (ids.has(c.id) || typeof c.name !== 'string' || c.name.length > 80 || !['surface', 'wreck', 'comet', 'solar', 'transit'].includes(c.site) || ![c.health, c.oxygen, c.energy, c.hunger, c.skill].every(Number.isFinite) || !Number.isInteger(c.x) || !Number.isInteger(c.y) || (c.site !== 'transit' && !inside(s.sites[c.site], c.x, c.y))) throw new Error('Invalid crew.');
    ids.add(c.id);
  }
  if (s.version === 1) {
    s.crew.forEach(c => initializeCrew(c, Number(c.id.split('-')[1])));
    for (const j of s.jobs) { j.priority = 3; j.blockedReason = null; }
    s.version = 2;
  }
  if (s.mission && (!SITES[s.mission.site]?.fuel || !['outbound', 'working', 'boarding', 'returning'].includes(s.mission.phase) || s.mission.crew?.length !== 2 || new Set(s.mission.crew).size !== 2 || !s.mission.crew.every(id => ids.has(id)) || !Number.isFinite(s.mission.remaining) || !s.mission.cargo)) throw new Error('Invalid expedition.');
  if (s.creatures === undefined) s.creatures = []; // Migrate first development saves.
  if (s.anomaly === undefined) s.anomaly = null;
  if (s.stats.trapped === undefined) s.stats.trapped = 0;
  const amount = v => Number.isFinite(v) && v >= 0;
  const percent = v => amount(v) && v <= 100;
  const inventory = v => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([r, n]) => r === '_food' || r === '_items' || (RESOURCES.includes(r) && amount(n))) && validFoodLots(v) && validItemLots(v);
  if (s.version === 2) {
    // Earlier saves owned one global pool. Move that pool once, without duplicating cargo or reserved costs.
    const legacy = { ...s.resources };
    for (const site of Object.values(s.sites)) for (const tile of site.tiles) { delete tile.stock; delete tile.machine; initializeStorage(tile); }
    const depot = stores(s)[0], fallback = depot || at(s.sites.surface, 10, 11);
    if (depot) add(depot.stock, legacy); else spill(fallback, legacy);
    for (const j of s.jobs) j.sources = quantity(j.cost) ? [{ x: fallback.x, y: fallback.y, items: { ...j.cost } }] : [];
    for (const c of s.crew) {
      if (c.carry && (!inventory(c.carry) || c.site !== 'surface')) throw new Error('Invalid legacy cargo.');
      if (c.intent?.type === 'haul') c.intent = null;
      c.delivery = null;
      if (c.carry && quantity(c.carry) > CARRY_CAPACITY) { spill(at(s.sites[c.site], c.x, c.y), c.carry); c.carry = null; }
    }
    syncResources(s); s.version = 3;
  }
  if (s.version === 3) {
    for (const j of s.jobs) {
      if (!inventory(j.cost) || !Array.isArray(j.sources) || !j.sources.every(source => Number.isInteger(source.x) && Number.isInteger(source.y) && inside(s.sites.surface, source.x, source.y) && inventory(source.items))) throw new Error('Invalid legacy material reservation.');
      const reserved = {}; j.sources.forEach(source => add(reserved, source.items));
      if (RESOURCES.some(r => (reserved[r] || 0) !== (j.cost[r] || 0))) throw new Error('Invalid legacy reserved cost.');
      // Preserve work already performed in older saves by staging those materials at the site.
      j.materials = j.remaining < j.work ? { ...j.cost } : {};
      j.sources = j.remaining < j.work ? [] : j.sources.map(source => ({ ...source, kind: 'stock' }));
    }
    s.version = 4;
  }
  if (s.version === 4) {
    for (const site of Object.values(s.sites)) {
      delete site.atmosphere; initializeAtmosphere(site); site.atmosphere.tick = s.tick;
      const legacyCells = new Set();
      for (const r of site.rooms) {
        if (!percent(r.air) || !Array.isArray(r.cells) || !r.cells.length) throw new Error('Invalid legacy atmosphere.');
        for (const k of r.cells) {
          if (typeof k !== 'string' || !/^\d+,\d+$/.test(k) || legacyCells.has(k)) throw new Error('Invalid legacy room cells.');
          const [x, y] = k.split(',').map(Number), t = inside(site, x, y) && at(site, x, y);
          if (!t || t.terrain !== 'floor' || ['wall', 'door'].includes(t.building)) throw new Error('Invalid legacy room volume.');
          legacyCells.add(k);
        }
        r.volume = r.cells.length; fillRoom(r, r.air);
      }
      if (legacyCells.size !== site.tiles.filter(t => t.terrain === 'floor' && !['wall', 'door'].includes(t.building)).length) throw new Error('Missing legacy room volume.');
      updateRooms(site); site.tiles.forEach(initializeStorage);
    }
    if (retrofitAir && !stores(s).some(t => t.stock.air !== undefined) && !s.sites.surface.tiles.some(t => t.drop?.air !== undefined)) {
      const target = stores(s)[0]; if (target) target.stock.air = 160; else spill(at(s.sites.surface, 10, 11), { air: 160 });
    }
    syncResources(s); s.version = 5;
  }
  if (s.version === 5) {
    for (const site of Object.values(s.sites)) {
      if (!Number.isFinite(site.power.battery) || site.power.battery < 0) throw new Error('Invalid legacy stored energy.');
      initializePower(s, site, site.power.battery);
    }
    s.version = 6;
  }
  if (s.version === 6) { initializeReliability(s); s.version = 7; }
  if (s.version === 7) { initializeShuttle(s); s.version = 8; }
  if (s.version === 8) { initializePreflight(s); s.version = 9; }
  if (s.version === 9) { initializeCrewLife(s); s.version = 10; }
  if (s.version === 10) { initializeMedicine(s); s.version = 11; }
  if (s.version === 11) { initializeNursing(s); s.version = 12; }
  if (s.version === 12) { initializeProduction(s); s.version = 13; }
  if (s.version === 13) { for (const site of Object.values(s.sites)) site.tiles.forEach(t => { delete t.storage; initializeStorage(t); }); s.version = 14; }
  if (s.version === 14) { initializeThermal(s); s.version = 15; }
  if (s.version === 15) { initializeFood(s); s.version = 16; }
  if (s.version === 16) {
    // Existing crops finish with their paid ingredients; no nutrients are invented.
    for (const site of Object.values(s.sites)) for (const t of site.tiles) {
      if (t.building === 'farm' && t.machine?.batch?.water === 1 && !t.machine.batch.fertilizer) t.machine.legacyCrop = true;
      // Extend formerly unrestricted depots; keep deliberate filters as chosen.
      if (t.storage && RESOURCES.filter(r => !['fertilizer','keepsakes','ice'].includes(r)).every(r => t.storage.accepted.includes(r)) && !t.storage.accepted.includes('fertilizer')) t.storage.accepted.push('fertilizer');
    }
    s.version = 17;
  }
  if (s.version === 17) { initializeSanitation(s); s.version = 18; }
  if (s.version === 18) { initializeHygiene(s); s.version = 19; }
  if (s.version === 19) { initializeDesignations(s); s.version = 20; }
  if (s.version === 20) { initializeHousing(s); s.version = 21; }
  if (s.version === 21) { initializeComfort(s); s.version = 22; }
  if(s.version===22){initializePossessions(s);for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.storage&&RESOURCES.filter(r=>!['keepsakes','ice'].includes(r)).every(r=>t.storage.accepted.includes(r))&&!t.storage.accepted.includes('keepsakes'))t.storage.accepted.push('keepsakes');s.version=23;}
  if(s.version===23){initializeWater(s);for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.storage&&RESOURCES.filter(r=>r!=='ice').every(r=>t.storage.accepted.includes(r))&&!t.storage.accepted.includes('ice'))t.storage.accepted.push('ice');if(s.shuttle.accepted.includes('water')&&!s.shuttle.accepted.includes('ice'))s.shuttle.accepted.push('ice');s.version=24;}
  if(s.version===24)s.version=25;
  if(s.version===25){initializeHusbandry(s);s.version=26;}
  if(s.version===26){s.version=27;}
  if(s.version===27){initializeBreeding(s);s.version=28;}
  if(s.version===28){s.version=29;}
  if(s.version===29){initializeFire(s);s.version=30;}
  if(s.version===30){initializeReactors(s);s.version=31;}
  if(s.version===31){initializeLiquids(s);s.version=32;}
  if(s.version===32){initializeGasNetworks(s);s.version=33;}
  if(s.version===33){initializeGasExhaust(s);s.version=34;}
  if(s.version===34){initializePlumbing(s);s.version=35;}
  if(s.version===35)s.version=36; // No equipment, fields, resources or energy are granted.
  if (!Number.isSafeInteger(s.comet.arrives) || !Number.isSafeInteger(s.comet.leaves) || s.comet.leaves <= s.comet.arrives || !Object.values(s.stats).every(amount)) throw new Error('Invalid simulation counters.');
  for (const site of Object.values(s.sites)) {
    if (!['surface', 'wreck', 'comet', 'solar'].includes(site.id) || !Object.values(site.power).every(amount) || !percent(site.air)) throw new Error('Invalid environment.');
    const gasValid = gas => gas && typeof gas === 'object' && !Array.isArray(gas) && Object.keys(gas).length === GASES.length && GASES.every(k => amount(gas[k]));
    const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-8;
    const atmosphere = site.atmosphere;
    if (!atmosphere || atmosphere.tick !== s.tick || !gasValid(atmosphere.vented) || !gasValid(atmosphere.injected) || !amount(atmosphere.breathed) || !amount(atmosphere.refilled)) throw new Error('Invalid atmosphere history.');
    for (const room of site.rooms) if (!Array.isArray(room.cells) || !percent(room.air) || typeof room.sealed !== 'boolean' || !room.cells.every(k => typeof k === 'string' && /^\d+,\d+$/.test(k) && inside(site, ...k.split(',').map(Number)))) throw new Error('Invalid room.');
    const occupied = new Set();
    for (const r of site.rooms) {
      if (!r.cells.length || r.volume !== r.cells.length || !gasValid(r.gas) || !Number.isFinite(gasAmount(r.gas))) throw new Error('Invalid room gas or volume.');
      for (const k of r.cells) { if (occupied.has(k)) throw new Error('Overlapping room volumes.'); occupied.add(k); }
      const derived = { ...r }; refreshRoom(derived);
      if (!['pressure', 'oxygenFraction', 'co2Fraction', 'air'].every(k => close(r[k], derived[k]))) throw new Error('Room readings do not match stored gas.');
    }
    for (const t of site.tiles) if (t.building === 'door' && (!['auto', 'open', 'closed'].includes(t.doorMode) || !Number.isSafeInteger(t.doorUntil) || t.doorUntil < 0 || t.doorUntil > s.tick + 3)) throw new Error('Invalid pressure door.');
    const topology = { ...site, thermal: { ...site.thermal }, rooms: [], atmosphere: { ...atmosphere, vented: { ...atmosphere.vented } } }; updateRooms(topology);
    const signature = r => [...r.cells].sort().join(';');
    const expected = new Map(topology.rooms.map(r => [signature(r), r]));
    if (expected.size !== site.rooms.length || site.rooms.some(r => { const match = expected.get(signature(r)); return !match || match.sealed !== r.sealed || !close(match.leakArea, r.leakArea); })) throw new Error('Compartment topology does not match the habitat.');
    const volume = site.rooms.reduce((n, r) => n + r.volume, 0);
    if (site.air !== (volume ? Math.round(site.rooms.reduce((n, r) => n + r.air * r.volume, 0) / volume) : 0)) throw new Error('Habitat air display does not match the rooms.');
    for (const t of site.tiles) if (!percent(t.hp) || !Number.isInteger(t.variant) || t.variant < 0 || t.variant > 3 || (t.drop !== null && !inventory(t.drop))) throw new Error('Invalid tile state.');
    for (const t of site.tiles) {
      if (t.building === 'stockpile' ? !inventory(t.stock) : t.stock !== undefined) throw new Error('Invalid depot inventory.');
      const recipe = RECIPES[t.building], m = t.machine;
      if (!recipe) { if (m !== undefined) throw new Error('Inventory attached to a missing machine.'); continue; }
      if (!m || !inventory(m.input) || !inventory(m.output) || !inventory(m.batch) || typeof m.enabled !== 'boolean' || typeof m.status !== 'string' || m.status.length > 120 || !Number.isFinite(m.progress) || m.progress < 0 || m.progress >= recipe.duration) throw new Error('Invalid machine state.');
      if (resourceEntries(m.input).some(([r, n]) => !recipe.input[r] || n > recipe.input[r] * 2) || resourceEntries(m.output).some(([r]) => !recipe.output[r]) || quantity(m.output) > OUTPUT_CAPACITY) throw new Error('Invalid machine buffers.');
      if (m.legacyCrop !== undefined && (m.legacyCrop !== true || t.building !== 'farm' || m.batch.water !== 1 || resourceEntries(m.batch).some(([r, n]) => r !== 'water' && n))) throw new Error('Invalid legacy crop.');
      const batchInput = m.legacyCrop ? { water: 1 } : recipe.input;
      if (quantity(m.batch) ? RESOURCES.some(r => (m.batch[r] || 0) !== (batchInput[r] || 0)) : m.progress !== 0) throw new Error('Invalid production batch.');
      if ((recipe.lifeSupport || recipe.automatic) && quantity(m.batch)) throw new Error('Life support does not hold a production batch.');
    }
  }
  for (const c of s.crew) if (!/^crew-[0-6]$/.test(c.id) || ![c.health, c.oxygen, c.energy, c.hunger].every(percent) || c.skill <= 0 || c.skill > 10 || !/^#[0-9a-fA-F]{6}$/.test(c.color) || (c.carry && !inventory(c.carry))) throw new Error('Invalid crew state.');
  const claimedBeds = new Set();
  const targetValid = target => Array.isArray(target) && target.length === 2 && target.every(Number.isInteger) && inside(s.sites.surface, ...target);
  const orbitalDelivery = (d, c) => d?.kind === 'shuttle' && s.mission?.crew.includes(c.id) && c.site === s.mission.site && ['working', 'boarding'].includes(s.mission.phase) && Array.isArray(d.target) && d.target.length === 2 && d.target.every(Number.isInteger) && inside(s.sites[c.site], ...d.target) && at(s.sites[c.site], ...d.target).building === 'dock';
  const deliveryValid = d => d && ['stock', 'input', 'job'].includes(d.kind) && targetValid(d.target) && (d.kind !== 'job' || (typeof d.job === 'string' && s.jobs.some(j => j.id === d.job && j.site === 'surface' && j.x === d.target[0] && j.y === d.target[1])));
  for (const c of s.crew) {
    if ((c.carry && (quantity(c.carry) > CARRY_CAPACITY || (c.site === 'surface' ? c.delivery != null && !deliveryValid(c.delivery) : !orbitalDelivery(c.delivery, c)))) || (!c.carry && c.delivery != null)) throw new Error('Invalid carried shipment.');
    if (!c.skills || !c.labors || !Object.keys(LABORS).every(id => typeof c.labors[id] === 'boolean' && Number.isInteger(c.skills[id]?.level) && c.skills[id].level >= 0 && c.skills[id].level <= 10 && amount(c.skills[id].xp) && c.skills[id].xp <= 170) || !percent(c.morale) || !Object.hasOwn(LABORS, c.favoriteLabor) || !['steady', 'cautious', 'driven', 'social'].includes(c.temperament)) throw new Error('Invalid crew capabilities.');
    if (!Array.isArray(c.memories) || c.memories.length > 8 || !c.memories.every(m => amount(m.tick) && m.tick <= s.tick && typeof m.kind === 'string' && typeof m.text === 'string' && m.text.length < 300 && Number.isFinite(m.mood) && Math.abs(m.mood) <= 100)) throw new Error('Invalid crew memories.');
    if (c.intent !== null) {
      const intent = c.intent;
      if (intent.type === 'salvage') {
        if (c.carry || c.job || !s.mission?.crew.includes(c.id) || s.mission.phase !== 'working' || c.site !== s.mission.site || !Array.isArray(intent.target) || intent.target.length !== 2 || !intent.target.every(Number.isInteger) || !inside(s.sites[c.site], ...intent.target) || !inventory(intent.items) || quantity(intent.items) <= 0 || quantity(intent.items) > CARRY_CAPACITY) throw new Error('Invalid salvage pickup.');
        continue;
      }
      if (!intent || !['air', 'rest', 'meal', 'haul', 'leisure', 'medical', 'temperature', 'sanitation'].includes(intent.type) || c.site !== 'surface' || c.job || (intent.target !== null && (!Array.isArray(intent.target) || intent.target.length !== 2 || !intent.target.every(Number.isInteger) || !inside(s.sites[c.site], ...intent.target))) || (intent.type === 'haul' && !intent.target) || (intent.type === 'meal' && (!Number.isInteger(intent.servings) || intent.servings < 0 || intent.servings > 8))) throw new Error('Invalid crew intention.');
      if (intent.type === 'rest' && intent.target) { const k = key(...intent.target); if (claimedBeds.has(k)) throw new Error('Bunk reserved twice.'); claimedBeds.add(k); }
      if (intent.type === 'haul' && (c.carry || !['stock', 'drop', 'output'].includes(intent.source) || !inventory(intent.items) || quantity(intent.items) <= 0 || quantity(intent.items) > CARRY_CAPACITY || !deliveryValid(intent.destination) || intent.destination.kind === 'job')) throw new Error('Invalid pickup reservation.');
    }
  }
  const jobs = new Set(); const reserved = new Set();
  if (s.jobs.length > 2000) throw new Error('Too many orders.');
  for (const j of s.jobs) {
    if (![1, 3, 5].includes(j.priority) || (j.blockedReason !== null && typeof j.blockedReason !== 'string')) throw new Error('Invalid job priority.');
    if (typeof j.id !== 'string' || !/^job-\d+$/.test(j.id) || jobs.has(j.id) || !s.sites[j.site] || !Number.isInteger(j.x) || !Number.isInteger(j.y) || !inside(s.sites[j.site], j.x, j.y) || !['build', 'mine', 'remove', 'repair', 'service', 'refit', 'loadShuttle', 'unloadShuttle', 'repairWaterPipe', 'removeWaterPipe', 'repairPipe', 'removePipe', 'repairCable', 'removeCable', 'treat', 'feed', 'hygiene', 'operate', 'animalCare', 'animalHarvest', 'animalLead', 'extinguish'].includes(j.kind) || !inventory(j.cost) || !amount(j.remaining) || !amount(j.work) || j.work === 0 || j.remaining > j.work || (j.kind === 'build' && !BUILDINGS[j.building]) || (j.worker && !ids.has(j.worker))) throw new Error('Invalid work order.');
    const k = ['feed', 'hygiene'].includes(j.kind) ? `${j.kind}/${j.patient}` : `${j.kind === 'operate' ? 'operate/' : ''}${j.site}/${j.x}/${j.y}`; if (reserved.has(k)) throw new Error('Duplicate tile reservation.'); reserved.add(k); jobs.add(j.id);
    if (j.worker && s.crew.find(c => c.id === j.worker)?.job !== j.id) throw new Error('Invalid worker reservation.');
    if (!inventory(j.materials) || !Array.isArray(j.sources) || !j.sources.every(source => targetValid([source.x, source.y]) && ['stock', 'drop'].includes(source.kind) && inventory(source.items))) throw new Error('Invalid material reservation.');
    const reservedItems = { ...j.materials }; j.sources.forEach(source => addCounts(reservedItems, source.items));
    for (const c of s.crew) if (c.delivery?.kind === 'job' && c.delivery.job === j.id) addCounts(reservedItems, c.carry);
    if (j.remaining < j.work && !materialsReady(j) && !(j.foodSpoiled > 0 && RESOURCES.filter(r => r !== 'food').every(r => (j.materials[r] || 0) >= (j.cost[r] || 0)))) throw new Error('Work performed without delivered materials.');
    if (RESOURCES.some(r => Math.abs((reservedItems[r] || 0) + (r === 'food' ? j.missingFood : 0) - (j.cost[r] || 0)) > 1e-8)) throw new Error('Material reservation does not match order.');
  }
  for (const c of s.crew) if (c.job && (!jobs.has(c.job) || s.jobs.find(j => j.id === c.job)?.worker !== c.id)) throw new Error('Invalid job assignment.');
  if (s.mission) {
    if (!inventory(s.mission.cargo) || !amount(s.mission.remaining) || !percent(s.mission.heat)) throw new Error('Invalid expedition cargo.');
    const expected = ['working', 'boarding'].includes(s.mission.phase) ? s.mission.site : 'transit';
    if (!s.mission.crew.every(id => s.crew.find(c => c.id === id).site === expected || s.crew.find(c => c.id === id).health <= 0)) throw new Error('Expedition crew are in the wrong location.');
  }
  for (const c of s.crew) if (c.site !== 'surface' && c.health > 0 && !s.mission?.crew.includes(c.id)) throw new Error('Crew are stranded outside an expedition.');
  if (!Array.isArray(s.creatures) || s.creatures.length > 100 || !s.creatures.every(c => c && typeof c.id === 'string' && ['bristleback', 'tibble'].includes(c.species) && c.site === 'surface' && Number.isInteger(c.x) && Number.isInteger(c.y) && inside(s.sites.surface, c.x, c.y) && percent(c.health) && percent(c.fed) && amount(c.age))) throw new Error('Invalid wildlife.');
  if (s.anomaly !== null && (typeof s.anomaly.title !== 'string' || typeof s.anomaly.description !== 'string' || typeof s.anomaly.resolved !== 'boolean')) throw new Error('Invalid signal.');
  if (s.log.length > 60 || !s.log.every(e => amount(e.tick) && typeof e.message === 'string' && e.message.length < 4000)) throw new Error('Invalid event log.');
  validateBreakers(s); validatePlumbing(s); validateGasNetworks(s); validateLiquids(s); validateReactors(s); validateFire(s); validateTransport(s); validateHusbandry(s); validateBreeding(s); validatePastures(s); validateWater(s); validateHousing(s); validateComfort(s); validatePossessions(s); validateDesignations(s); validateHygiene(s); validateSanitation(s); validateFood(s); validateThermal(s); validateStorage(s); validateProduction(s); validateMedicine(s); validateNursing(s); validateCrewLife(s); validateShuttle(s); validatePreflight(s);
  validateReliability(s);
  for (const site of Object.values(s.sites)) validatePower(s, site);
  const recorded = s.resources; syncResources(s);
  if (RESOURCES.some(r => Math.abs(recorded[r] - s.resources[r]) > 1e-9)) throw new Error('Depot totals do not match stored materials.');
  return s;
}
