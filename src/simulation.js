import {MATERIALS} from './material-data.js';
import {structuralBuilding,constructionSpec,repairSpec,materialId,installMaterial,clearMaterial,dismantleRefund,rejectLegacyMaterials,validateMaterials} from './materials.js';
import {makeRegion,generatedLayout,siteDefinition,siteDefinitions,routeDefinition,siteKind,settlementSite,validateRegion,migrateRegion} from './region.js';
import {TOOL_RECIPES} from './tool-data.js';
import {workEffort,advanceToolPickup,clearToolPickup,validateToolPickups,rejectLegacyEquipment} from './tools.js';
import {riserKind,utilityAt,riserPlacement,utilityJobClaims,commissionUtility,utilityWorkReady,completeUtilityWork,configureUtility,validateUtilityState,validateUtilityJobs,UTILITY_WORK} from './utility-links.js';
import { walkingNeighbors, stairPlacement, stairJobClaims, commissionStairwell, supportedFloor, stairAt, stairWorkBlock, completeStairWork, validateStairJobs, STAIR_WORK } from './vertical.js';
import { validateHazardLocations, migrateHazardLocations } from './hazard-locations.js';
import { validateRoomLocations, migrateRoomLocations, roomCellKey, roomCellPosition, validateDesignationLocations, migrateDesignationLocations } from './room-locations.js';
import { validateAirlockLocations, migrateAirlockLocations, airlockCells } from './airlock-locations.js';
import { validateAnimalLocations, migrateAnimalLocations } from './animal-locations.js';
import { validateCrewLocations, migrateCrewLocations, validCrewPosition } from './crew-locations.js';
import { positionOf, cellKey, horizontalNeighbors } from './spatial.js';
import { crewPathToPosition, animalPathToPosition, animalPassablePosition, passablePosition, pathToPosition } from './navigation.js';
import { advanceCrewRoutePositions } from './crew-traversal.js';
import { FLORA, CULTIVATION } from './flora-data.js';
import { initializeFlora, initializeCultivation, updateFlora, floraId, floraBiomass, consumeLichen, gatheringEligibility, gatheringJobValid, completeGathering, plantingEligibility, wateringEligibility, cultivationJobValid, completePlanting, completeWatering, validateFlora, validateCultivation } from './flora.js';
import { initializeAnimalHealth, injureAnimal, updateAnimalHealth, animalTreatmentEligibility, animalTreatmentReady, completeAnimalTreatment, validateAnimalHealth } from './animal-health.js';
import { animalTraits, initializeAnimalTraits, validateAnimalTraits } from './animal-traits.js';
import { BUTCHERY, initializeAnimalDeaths, registerAnimalDeath, carcassPosition, dispatchEligibility, dispatchJobValid, butcheryEligibility, discardEligibility, dispatchJob, carcassJob, requestDispatch, requestButchery, requestDiscard, releaseCarcass, reconcileCarcasses, updateCarcasses, actCarcass, completeDispatch, completeCarcass, validateCarcasses } from './animal-carcasses.js';
import { immobile } from './mobility.js';
import { isLivestock, livestockDef, VETERINARY } from './livestock-data.js';
import { CROPS, MEAL_RECIPES, FOOD_KINDS } from './food-data.js';
import { GRID, neighbors, distance, tileAt } from './geometry.js';
import { validateDeckState, migrateDeckZero } from './deck-state.js';
import { validateShipmentLocations, migrateShipmentLocations, validShipmentPosition } from './shipment-locations.js';
import { tileAt as shipmentTile, sameCell } from './spatial.js';
import { prepareAirlocks, gateAirlocks, reconcileAirlocks, cancelAirlock, invalidateAirlockPart } from './airlocks.js';
import { initializeAirlocks, validateAirlocks } from './airlock-persistence.js';
import { advanceCrewRoute, continueCrewTraversal } from './crew-traversal.js';
import { suitSupplyGoals, refillSuitFromSupply } from './suit-supply.js';
import { airlockControlOwner } from './airlock-access.js';
import { validateFreightState } from './freight-persistence.js';
import { isFreightJob, freightRequest, reserveFreight, freightOrdered, completeFreight, freightCancellation, freightWorkValid } from './freight.js';
import { expeditionLaunchBlock, selectExpeditionCrew, expeditionCrewCountAllowed } from './expedition-readiness.js';
import { validateBreakers } from './breakers.js';
import { initializePlumbing, newWaterPipe, waterEquipment, flowPlumbing, operatePlumbing, removePlumbing, validatePlumbing } from './plumbing.js';
import { initializeGasNetworks, initializeGasExhaust, newPipe, gasEquipment, updateGasNetworks, removeGas, validateGasNetworks } from './gas-networks.js';
import { initializeLiquids, flowLiquids, pumpLiquids, validateLiquids } from './liquids.js';
import { initializeReactors, updateReactorCooling, releaseReactorHeat, validateReactors } from './reactors.js';
import { FIRE, initializeFire, updateFire, prepareFire, fireJobValid, extinguish, evadeFire, validateFire } from './fire.js';
import { transportJob, requestTransport, transportRoute, releaseTransport, reconcileTransport, heldForTransport, actTransport, completeTransport, validateTransport } from './animal-transport.js';
import { initializeBreeding, updateBreeding, validateBreeding, adult } from './breeding.js';
import { passable, pathTo, crewPathTo, animalPassable, animalPath } from './navigation.js';
export { passable, pathTo } from './navigation.js';
import { pastureSnapshot, recordPastureChanges, moveAnimal, validatePastures, pastureRegions } from './pastures.js';
import { initializeHusbandry, animalJob, animalJobValid, animalForJob, assignAnimal, animalPolicy, prepareHusbandry, completeAnimalJob, moveAssignedAnimal, animalCondition, validateHusbandry } from './husbandry.js';
import { openMeal, eatPortion } from './meals.js';
import { initializeWater, validateWater } from './water.js';
import { extractionStatus, extractTile, reserveBlocksBuilding } from './extraction.js';
import { initializePossessions, validatePossessions, dropPossession } from './possessions.js';
import { validItemLots, itemOwners } from './item-lots.js';
import { capture, emitEvent, emitItemMovement, tileEntityId, habitatSnapshot, recordHabitatChanges } from './telemetry.js';
import { initializeComfort, validateComfort, experienceComfort } from './comfort.js';
import { initializeHousing, reconcileHousing, validateHousing, bunkAccessible, ownsBunk, housingObstruction, rememberHousingSleep } from './housing.js';
import { initializeDesignations, validateDesignations, livingAllowed, roomBenefit } from './rooms.js';
import { initializeHygiene, hygienePatient, hygieneReady, completeHygiene, prepareHygiene, reconcileHygiene, validateHygiene, HYGIENE_WORK, HYGIENE_RETRY } from './hygiene.js';
import { initializeSanitation, digestPortion, dropSanitation, updateSanitation, useSanitation, validateSanitation } from './sanitation.js';
import { initializeFood, updateFood, validateFood, preserveOpenedMeal, dropOpenedMeals } from './spoilage.js';
import { validFoodLots, foodAge, foodOfKind, rawFood } from './food-lots.js';
import { initializeThermal, updateThermal, validateThermal, thermalSafe, thermalExposure } from './thermal.js';
import { validateStorage } from './storage.js';
import { initializeProduction, productionBlock, operateMachine, validateProduction, recipeFor } from './production.js';
import { releaseRescue, initializeNursing, prepareNursing, reconcileNursing, rescue, dependentCare, feedPatient, completeFeeding, validateNursing } from './nursing.js';
import { initializeMedicine, injure, prepareMedicine, treatmentPatient, treatmentReady, completeTreatment, medicalRest, validateMedicine } from './medicine.js';
import { VERSION, RESOURCES, BUILDINGS, SITES, CREW_NAMES, ROLES, RECIPES, SHUTTLE_FITS } from './data.js';
import { LABORS, initializeCrew, laborFor, airThreshold, availableForWork, workRate, gainExperience, remember, updateMorale } from './crew.js';

import { add, addCounts, extract, resourceEntries, take, spill, initializeStorage, stores, syncResources, spend, quantity } from './inventory.js';
import { updateIndustry, haul, spillStorage, CARRY_CAPACITY, OUTPUT_CAPACITY } from './industry.js';

import { siteWorkAllowed, reserveConstruction, materialsReady, materialRoute, materialObstruction, fetchMaterials, cancelMaterials, dropCarriedMaterials, reservedAt } from './construction.js';

import { updateRooms, roomAt, initializeAtmosphere, fillRoom, refreshAtmosphere, updateAtmosphere, breathable, breatheBatch, GASES, gasAmount, refreshRoom, SUIT_PER_POINT } from './atmosphere.js';
export { updateRooms, roomAt } from './atmosphere.js';

import { isDay, updatePower, refreshPower, initializePower, initializeElectrical, releaseBatteryEnergy, BATTERY_CAPACITY, CELL_CHARGE, CELL_INSTALL_WORK, validatePower } from './power.js';
import { initializeReliability, maintainable, completeService, recordOperation, updateDebris, updateHerdWarning, scheduleMaintenance, validateReliability } from './maintenance.js';
import { initializeShuttle, routeTime, routeFuel, haulSalvage, boardShuttle, returnWalk, dockAt, validateShuttle, returnCrewIds, returnCrewMembers, allReturnTravelersDead } from './expedition.js';
import { initializeOutpostState, validateOutpostState } from './outpost-persistence.js';
import { isResident, residentSite, shuttlePresence } from './outposts.js';
import { initializePreflight, planDeparture, loadingCost, updateDeparture, walkToDeparture, boardingDeparture, tryDeparture, spendReturnFuel, deployKit, validatePreflight } from './preflight.js';
import { initializeCrewLife, prepareDowntime, leisure, updateCrewLife, validateCrewLife } from './crew-life.js';
export { isDay, updatePower } from './power.js';

export const key = (x, y) => `${x},${y}`;
export const at = tileAt;
export const inside = (site, x, y) => !!tileAt(site, x, y);
export { neighbors } from './geometry.js';

export function random(s) {
  let x = s.rng | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  s.rng = x >>> 0; return s.rng / 4294967296;
}
function createSite(id, size, kind=id) {
  return { id, kind, size, levels: [{ z: 0, name: 'Landing deck' }], verticalLinks: [], utilityLinks: [], air: 0, power: { output: 0, demand: 0, battery: 0, capacity: 0 }, rooms: [], explored: id === 'surface' || id === 'wreck', tiles: Array.from({ length: size * size }, (_, i) => ({ x: i % size, y: Math.floor(i / size), z: 0, terrain: id === 'surface' ? 'ground' : 'void', building: null, hp: 100, drop: null, variant: i % 4, powered: false, cable: null })) };
}
export function createGame(seed = 74219, {regionSchema=2} = {}) {
  const s = { version: VERSION, grid: GRID, seed, rng: seed || 1, tick: 0, nextId: 1, resources: { alloy: 36, ore: 0, components: 3, food: 24, water: 40, fuel: 14, cells: 0, air: 160, medicine: 4, waste: 0, fertilizer: 8, keepsakes: 0, ice: 0, tools: 0 }, sites: {}, crew: [], creatures: [], anomaly: null, jobs: [], log: [], mission: null, stats: { built: 0, mined: 0, returned: 0, solarCells: 0, trapped: 0 }, comet: { arrives: 180, leaves: 480 }, flags: {}, objectives: {} };
  const ground = s.sites.surface = createSite('surface', 26);
  for (const t of ground.tiles) {
    const edge = t.x < 4 || t.y < 3 || t.x > 20 || t.y > 20;
    t.variant = Math.floor(random(s) * 4);
    if (random(s) < (edge ? .36 : .08)) t.terrain = random(s) < .35 ? 'ore' : 'rock';
  }
  for (let y = 5; y <= 16; y++) for (let x = 5; x <= 18; x++) { const t = at(ground, x, y); t.terrain = 'ground'; }
  // Derive the hull from every edge of the usable floor cells. This also
  // encloses the staggered edges at odd and even columns without corner gaps.
  const habitat = ground.tiles.filter(t => t.x >= 7 && t.x <= 13 && t.y >= 7 && t.y <= 11);
  const interior = new Set(habitat.map(t => key(t.x, t.y)));
  for (const t of habitat) t.terrain = 'floor';
  for (const t of habitat) for (const [x, y] of neighbors(t.x, t.y)) {
    if (interior.has(key(x, y))) continue;
    const hull = at(ground, x, y); hull.terrain = 'floor'; hull.building = 'wall';
  }
  at(ground, 10, 12).building = 'door';
  const initial = [[7, 7, 'scrubber'], [9, 7, 'bunk'], [10, 7, 'bunk'], [11, 7, 'bunk'], [12, 7, 'bunk'], [13, 7, 'battery'], [7, 9, 'farm'], [8, 10, 'stockpile'], [13, 10, 'refinery'], [7, 14, 'solar'], [8, 14, 'solar'], [9, 14, 'solar'], [16, 11, 'shuttle']];
  for (const [x, y, b] of initial) at(ground, x, y).building = b;
  for (const [x, y] of [[4, 10], [4, 11], [3, 12], [17, 7], [18, 8], [19, 8]]) at(ground, x, y).terrain = 'ore';
  for (const t of ground.tiles) if (t.terrain === 'ground' && !t.building && t.variant === 2) t.lichen = 60;
  for (const [i, x, y] of [[0, 6, 16], [1, 8, 17], [2, 10, 18]]) { at(ground, x, y).terrain = 'ground'; at(ground, x, y).lichen = 90; s.creatures.push({ id: `grazer-${i}`, species: 'bristleback', site: 'surface', x, y, z: 0, health: 100, fed: 65, age: 0 }); }
  for (const [i, x, y] of [[0, 12, 18], [1, 14, 18]]) { const tile=at(ground,x,y);tile.terrain='ground';tile.building=null;s.creatures.push({id:`glazefoot-${i}`,species:'glazefoot',site:'surface',x,y,z:0,health:100,fed:65,age:0}); }
  s.crew = CREW_NAMES.map((name, i) => ({ id: `crew-${i}`, name, role: ROLES[i], color: ['#dfb06d', '#8dccc3', '#e89577', '#9cb778', '#a6a6de', '#df99ad', '#b4c0c8'][i], site: 'surface', x: 8 + i % 5, y: 9 + Math.floor(i / 5), z: 0, health: 100, hunger: 90, energy: 90, oxygen: 100, job: null, activity: 'Settling in', skill: 1 + (i % 3) * .25 }));
  s.crew.forEach(initializeCrew); initializeCrewLife(s); initializeMedicine(s); initializeNursing(s);
  const wreck = s.sites.wreck = createSite('wreck', 18);
  // The exposed wreck and collector platform use joined hex disks; their
  // decks remain decompressed, with continuous routes from the fixed docks.
  for (const t of wreck.tiles) if (Math.min(distance([t.x,t.y],[6,8]), distance([t.x,t.y],[11,8])) <= 4) {
    t.terrain = 'deck';
    if ((t.y === 4 || t.x === 15) && t.x !== 8) t.building = 'wall';
  }
  for (const [x, y] of [[5, 6], [7, 7], [12, 6], [12, 10], [8, 10]]) at(wreck, x, y).building = 'salvage';
  at(wreck, 4, 11).building = 'dock';
  const comet = s.sites.comet = createSite('comet', 18);
  for (const t of comet.tiles) if (distance([t.x,t.y], [8,9]) <= 5) t.terrain = 'ice';
  at(comet, 5, 10).building = 'dock';
  for (const [x, y] of [[8, 7], [10, 8], [11, 10], [8, 11]]) at(comet, x, y).building = 'volatile';
  const solar = s.sites.solar = createSite('solar', 18);
  for (const t of solar.tiles) if (Math.min(distance([t.x,t.y],[6,9]), distance([t.x,t.y],[10,9])) <= 2) t.terrain = 'deck';
  at(solar, 5, 10).building = 'dock'; at(solar, 10, 8).building = 'collector';
  s.region=makeRegion(seed,false,regionSchema);
  for(const def of Object.values(s.region.sites))if(!Object.hasOwn(s.sites,def.id)){
    const site=s.sites[def.id]=createSite(def.id,def.size,def.kind),layout=generatedLayout(def);
    for(let i=0;i<site.tiles.length;i++)Object.assign(site.tiles[i],layout[i]);
  }
  log(s, 'Kepler’s Rest established. Seven crew. One small foothold.', 'good');
  log(s, 'Relay K-07 detected in near orbit. Its components could transform this colony.', 'discovery');
  updateRooms(ground); ground.rooms.forEach(r => fillRoom(r)); updateRooms(ground);
  for (const site of Object.values(s.sites)) { initializeAtmosphere(site); site.tiles.forEach(initializeStorage); initializePower(s, site, site.id === 'surface' ? 100 : 0); }
  initializeFlora(s,{seedEdibles:true});
  initializeReliability(s); initializeShuttle(s); initializePreflight(s); initializeThermal(s); initializeFood(s); initializeSanitation(s); initializeHygiene(s); initializeDesignations(s); initializeHousing(s); initializeComfort(s); initializePossessions(s); initializeWater(s); initializeHusbandry(s); initializeBreeding(s); initializeAnimalHealth(s); initializeFire(s); initializeReactors(s); initializeLiquids(s); initializeCultivation(s); initializeGasNetworks(s); initializePlumbing(s);
  initializeAnimalTraits(s); initializeAnimalDeaths(s); initializeProduction(s); initializeOutpostState(s); initializeAirlocks(s);
  add(at(ground, 8, 10).stock, s.resources); syncResources(s);
  return s;
}
export function log(s, message, type = 'info') { s.log.unshift({ tick: s.tick, message, type }); s.log = s.log.slice(0, 60); }

export function canAfford(s, cost) { syncResources(s); return Object.entries(cost).every(([r, n]) => s.resources[r] >= n); }
const connectedTo = (s, target) => t => pathTo(s.sites.surface, t, [target]) !== null;
function canLeaveAfterStairRemoval(s,site,link){
 const without={...site,verticalLinks:site.verticalLinks.filter(other=>other.id!==link.id)};
 const ground=site.tiles.filter(t=>t.z===0&&passablePosition(without,positionOf(t))).map(positionOf);
 return s.crew.filter(c=>c.site===site.id&&c.health>0&&c.z>0).every(c=>crewPathToPosition(s,without,c,ground)!==null)&&s.creatures.filter(a=>a.site===site.id&&a.health>0&&a.z>0).every(a=>animalPathToPosition(without,a,ground)!==null||isLivestock(a)&&pathToPosition(without,a,ground)!==null);
}
export function order(s, siteId, x, y, kind, building = null, z = 0, material) {
  const site = s.sites[siteId];
  const target={x,y,z},t=shipmentTile(site,target);
  if(material!==undefined&&(kind!=='build'||!structuralBuilding(building)||!Object.hasOwn(MATERIALS,material)))return {ok:false,code:'invalid_material',message:'Choose an alloy or composite habitat floor, hull wall or pressure door.'};
  if (!t) return { ok: false, message: 'Outside the map.' };
  const utility=riserKind(building)&&kind!=='build'?utilityAt(site,target,riserKind(building)):null;
  if(riserKind(building)&&kind!=='build'&&!utility)return {ok:false,message:'Select an existing utility riser.'};
  const stair=!riserKind(building)&&['repair','remove'].includes(kind)?stairAt(site,target):null;
  if(!stair&&building==='stairwell'&&kind!=='build')return {ok:false,message:'Select an existing stairwell.'};
  if(stair&&kind==='remove'&&!sameCell(target,stair.lower))return order(s,siteId,stair.lower.x,stair.lower.y,kind,null,stair.lower.z);
  if(z!==0&&(!['mine','plant','waterPlant','gather','extinguish','animalCare','animalHarvest','animalTreat','animalDispatch','animalButcher','animalDiscard','treat','feed','hygiene','operate','build','remove','repair','repairCable','removeCable','service','repairPipe','removePipe','repairWaterPipe','removeWaterPipe','chargeCell'].includes(kind)))return {ok:false,code:'unsupported_deck_work',message:'This work type is not available on this deck yet.'};
  if (!siteWorkAllowed(s, siteId) && (s.mission?.site !== siteId || s.mission.phase !== 'working')) return { ok: false, message: 'Resume field work before assigning expedition orders.' };
  if (s.jobs.some(j => j.site === siteId && sameCell(positionOf(j),target) && (kind==='extinguish'?j.kind==='extinguish':['feed', 'hygiene'].includes(kind) ? j.kind === kind && j.patient === building : !['feed', 'hygiene', 'operate', 'animalCare', 'animalHarvest', 'animalTreat', 'animalLead', 'extinguish'].includes(j.kind)))) return { ok: false, message: 'Work already designated here.' };
  if(s.jobs.some(j=>j.site===siteId&&stairJobClaims(j,target,site)))return {ok:false,code:'stair_endpoint_reserved',message:'Finish or cancel the stairwell claiming this landing.'};
  if(s.jobs.some(j=>j.site===siteId&&utilityJobClaims(j,target,site)))return {ok:false,code:'riser_reserved',message:'Finish or cancel the riser work claiming this endpoint.'};
  if(t.verticalLink&&kind==='build'&&!riserKind(building)&&!['cable','gasPipe','waterPipe'].includes(building))return {ok:false,code:'stair_landing',message:'Keep the stair landing clear.'};
  if(t.fire&&kind!=='extinguish')return {ok:false,message:'Suppress the fire before working on this tile.'};
  let cost = {}, work = 5, foodKinds, gathering, cultivation, treatment;
  if(utility){
    const ready=utilityWorkReady(s,site,utility,kind);if(!ready.ok)return ready;
    if(kind==='repair'&&utility.hp>=100)return {ok:false,message:'This riser does not need repair.'};
    cost={...UTILITY_WORK[kind].cost};work=UTILITY_WORK[kind].work;
  } else if(stair){
    if(kind==='repair'&&stair.hp>=100)return {ok:false,message:'This stairwell does not need repair.'};
    const ready=stairWorkBlock(s,site,stair,kind,null,link=>canLeaveAfterStairRemoval(s,site,link));if(!ready.ok)return ready;
    building='stairwell';cost={...STAIR_WORK[kind].cost};work=STAIR_WORK[kind].work;
  } else if(kind==='extinguish'){if(!t.fire)return {ok:false,message:'Select an active fire.'};cost={water:FIRE.suppressionWater};work=FIRE.suppressionWork;
  } else if (kind === 'build') {
    if (!settlementSite(site)) return { ok: false, message: 'Construction requires a settlement-capable site.' };
    const def = BUILDINGS[building]; if (!def) return { ok: false, message: 'Unknown structure.' };
    if(riserKind(building)){const ready=riserPlacement(s,site,target,building);if(!ready.ok)return ready;}
    if(building==='stairwell'){const placement=stairPlacement(s,site,target);if(!placement.ok)return placement;}
    if(building==='floor'&&z>0&&!supportedFloor(site,target))return {ok:false,code:'unsupported_floor',message:'An upper floor needs a habitat floor or intact wall immediately below.'};
    if (!riserKind(building) && (building === 'waterPipe' ? ['void','rock'].includes(t.terrain)||t.waterPipe||waterEquipment(t) : building === 'gasPipe' ? ['void','rock'].includes(t.terrain)||t.pipe||gasEquipment(t) : building === 'cable' ? ['void', 'rock'].includes(t.terrain) || t.cable || t.building==='breaker' : (!passablePosition(site,target)&&!(building==='floor'&&z>0&&t.terrain==='void')) || t.building || t.drop || quantity(reservedAt(s, siteId, x, y, z)))) return { ok: false, message: 'Clear the tile first.' };
    if (['gasTank','gasPump','gasVent','gasExtractor','gasReservoir'].includes(building)&&t.pipe) return {ok:false,message:'Dismantle the underlying gas pipe before installing this device.'};
    if (waterEquipment({building})&&t.waterPipe) return {ok:false,message:'Dismantle the underlying water pipe before installing this device.'};
    if (building==='breaker'&&t.cable) return {ok:false,message:'Remove the cable before installing a two-terminal breaker.'};
    if (reserveBlocksBuilding(t,building)) return { ok: false, message: `Extract the remaining ${t.deposit.resource} before building here.` };
    if (building === 'floor' && t.terrain === 'floor') return { ok: false, message: 'A floor is already here.' };
    if (['toolbench','planter','airlockController','breaker','waterReservoir','waterPump','waterIntake','waterOutlet','gasTank','gasVent','gasExtractor','gasReservoir','waterTank','bilgePump','reactor', 'galley', 'iceProcessor', 'artisan', 'sculpture', 'holo', 'sanitary', 'medicalCot', 'medlab', 'commons', 'bunk', 'farm', 'recycler', 'scrubber', 'refinery', 'fabricator', 'atmosphere', 'battery'].includes(building) && t.terrain !== 'floor') return { ok: false, message: 'Place this on a habitat floor.' };
    const spec=constructionSpec(building,material);cost=spec.cost;work=spec.work;

  } else if (dispatchJob({kind})||carcassJob({kind})) {
    const animal=s.creatures.find(a=>a.id===building),eligibility=kind==='animalDispatch'?dispatchEligibility(s,animal):kind==='animalButcher'?butcheryEligibility(s,animal,x,y,z):discardEligibility(s,animal);
    if(!eligibility.ok)return eligibility;
    if(siteId!=='surface')return {ok:false,code:'surface_only',message:'Animal handling requires the surface colony.'};
    if(kind==='animalDispatch'&&(!sameCell(animal.husbandry.post,{x,y,z})))return {ok:false,code:'wrong_post',message:'Select the animal’s assigned post.'};
    if(kind==='animalDiscard'){const position=carcassPosition(s,animal);if(position?.site!==siteId||!sameCell(position,{x,y,z}))return {ok:false,code:'wrong_body_tile',message:'Select the actual body tile.'};}
    work=kind==='animalDispatch'?BUTCHERY.dispatchWork:kind==='animalButcher'?BUTCHERY.processWork:BUTCHERY.discardWork;
  } else if (kind === 'animalTreat') {
    const animal=s.creatures.find(a=>a.id===building);treatment=animalTreatmentEligibility(s,animal);
    if(!treatment.ok)return treatment;
    if(siteId!=='surface'||!sameCell(animal.husbandry.post,{x,y,z}))return {ok:false,message:'Select the animal’s assigned post.'};
    cost={medicine:VETERINARY.medicine};work=VETERINARY.work;
  } else if (['animalCare','animalHarvest'].includes(kind)) {
    const animal=s.creatures.find(a=>a.id===building);const proposed={kind,animal:building,site:siteId,x,y,z};
    if(s.jobs.some(j=>(j.animal===building||j.site===siteId&&sameCell(positionOf(j),target))&&!(kind==='animalCare'&&j.kind==='animalTreat'&&j.animal===building)))return {ok:false,message:'Finish or cancel conflicting animal work first.'};
    if(siteId!=='surface'||!animal||!animalJobValid(s,proposed))return {ok:false,message:'Animal care or collection is unavailable at this post.'};
    const def=livestockDef(animal);cost=kind==='animalCare'?{food:def.careFood}:{};work=kind==='animalCare'?def.careWork:def.harvestWork;
    if(kind==='animalCare'&&def.feedKinds)foodKinds={...def.feedKinds};
  } else if (kind === 'operate') {
    const blocked = productionBlock(s, site, t);
    if (blocked || s.jobs.some(j => j.kind === 'operate' && j.site === siteId && sameCell(positionOf(j),target))) return { ok: false, message: blocked || 'Operator already assigned.' };
    building = t.building; work = recipeFor(t).duration;
  } else if (kind === 'hygiene') {
    if (s.jobs.some(j => j.kind === 'hygiene' && j.patient === building)) return { ok: false, message: 'Hygiene already designated for this patient.' };
    if (!hygienePatient(s, { site: siteId, patient: building, x, y, z })) return { ok: false, message: 'No dependent patient awaiting hygiene here.' };
    work = HYGIENE_WORK;
  } else if (kind === 'feed') {
    if (!feedPatient(s, { site: siteId, patient: building, x, y, z })) return { ok: false, message: 'No patient waiting for a bedside meal here.' };
    cost = { food: 1 }; work = 8;
  } else if (kind === 'treat') {
    const patient = s.crew.find(c => c.id === building);
    if (!patient || patient.health <= 0 || patient.site !== siteId || !sameCell(patient.medical.bed,target) || t.building !== 'medicalCot' || t.hp <= 0 || !breathable(roomAt(site, x, y, z)) || patient.medical.injury - patient.medical.treated <= 1e-8) return { ok: false, message: 'No patient awaiting treatment at this cot.' };
    cost = { medicine: 1 }; work = 20;
  } else if (isFreightJob({kind})) {
    const request = freightRequest(s, siteId, kind, building === null ? undefined : building);
    if (!request.ok) return request;
    if (request.terminal.x !== x || request.terminal.y !== y) return {ok:false,code:'freight_terminal',message:'Select the actual shuttle terminal.'};
    cost = request.cost; work = request.work; building = null;
  } else if (kind === 'loadShuttle' || kind === 'unloadShuttle') {
    if (siteId !== 'surface' || t.building !== 'shuttle' || s.mission || (kind === 'loadShuttle' ? !s.departure : s.departure || !quantity(s.shuttle.supplies))) return { ok: false, message: 'Shuttle supply operation unavailable.' };
    cost = kind === 'loadShuttle' ? loadingCost(s) : {}; work = 3;
    if (kind === 'loadShuttle' && !quantity(cost)) return { ok: false, message: 'Missing supplies in depots or loose piles.' };
  } else if (kind === 'refit') {
    const fit = SHUTTLE_FITS[building];
    if (siteId !== 'surface' || t.building !== 'shuttle' || !fit || s.mission || s.departure || s.shuttle.fit === building) return { ok: false, message: 'Select an available shuttle and a different fitting.' };
    if (quantity(s.shuttle.freight)>fit.capacity+1e-8) return {ok:false,code:'freight_capacity',message:'Onboard freight exceeds the selected fitting’s hold capacity.'};
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
  } else if (kind === 'plant' || kind === 'waterPlant') {
    cultivation=(kind==='plant'?plantingEligibility:wateringEligibility)(s,site,t,building);
    if(!cultivation.ok)return {ok:false,code:cultivation.code,message:cultivation.message};
    cost={...cultivation.cost};work=cultivation.work;
    if(kind==='plant')foodKinds={[cultivation.foodKind]:cost.food};
  } else if (kind === 'gather') {
    gathering=gatheringEligibility(s,site,t,building);
    if(!gathering.ok)return {ok:false,code:gathering.code,message:gathering.message};
    work=gathering.work;
  } else if (kind === 'mine') {
    const extraction=extractionStatus(t);if(!extraction)return {ok:false,code:'no_extractable_material',message:'Select an exposed reserve, rock, ore, satellite salvage, or comet volatiles.'};
    work=extraction.work;
  } else if (kind === 'chargeCell') {
    if (siteId !== 'surface') return { ok: false, message: 'Power cells load into surface battery banks.' };
    if (t.building !== 'battery' || !(t.hp > 0)) return { ok: false, message: 'Select a healthy battery bank.' };
    if (BATTERY_CAPACITY - t.charge < CELL_CHARGE - 1e-9) return { ok: false, message: 'This bank needs 100 kJ of free capacity.' };
    cost = { cells: 1 }; work = CELL_INSTALL_WORK;
  } else if (kind === 'remove') {
    if (!t.building || ['shuttle', 'dock', 'collector', 'salvage', 'volatile'].includes(t.building)) return { ok: false, message: 'That structure cannot be dismantled.' };
  } else if (kind === 'repair') {
    if (!t.building || t.hp >= 100) return { ok: false, message: 'Select a damaged structure.' };
    const spec=repairSpec(t);cost=spec.cost;work=spec.work;
  } else return { ok: false, message: 'Unknown order.' };
  if(t.building==='breaker'&&['repair','remove'].includes(kind))building=null;
  const workers = s.crew.filter(c => c.site === siteId && c.health > 0);
  if (!workers.some(c => crewPathToPosition(s, site, c, horizontalNeighbors(target)) !== null)) return { ok: false, message: 'No crew can reach that tile. Send an expedition or clear a route.' };
  const sources = kind === 'unloadCargo' ? reserveFreight(s, x, y, cost) : reserveConstruction(s, siteId, x, y, cost, (current,from,goals)=>crewPathTo(s,current,from,goals), foodKinds?{rawOnly:true,foodKinds}:false,z);
  if (!sources) return { ok: false, message: 'Not enough reachable supplies in depots or loose piles.' };
  const job = { id: `job-${s.nextId++}`, site: siteId, x, y, z, kind, building, cost, sources, materials: {}, work, remaining: work, worker: null, priority: 3, blockedReason: null, missingFood: 0, foodSpoiled: 0 };
  if(kind==='build'&&structuralBuilding(building))job.material=material??'alloy';
  if(kind==='repair'&&materialId(t,'structure')!==null)job.material=materialId(t,'structure');
  if(utility)job.utilityConnection=utility.id;
  if(stair)job.connection=stair.id;
  if(foodKinds)job.foodKinds=foodKinds;
  if(kind==='animalTreat')job.dose=treatment.dose;
  if(kind==='gather'){job.plantSpecies=building;job.plantHarvests=gathering.harvests;job.plantGeneration=gathering.generation;job.building=null;}
  if(kind==='plant'||kind==='waterPlant'){job.plantSpecies=building;job.building=null;if(kind==='waterPlant')job.plantGeneration=cultivation.generation;}
  if(utility){
    const ready=utilityWorkReady(s,site,utility,kind);if(!ready.ok)return ready;
    if(kind==='repair'&&utility.hp>=100)return {ok:false,message:'This riser does not need repair.'};
    cost={...UTILITY_WORK[kind].cost};work=UTILITY_WORK[kind].work;
  } else if(stair){
    if(kind==='repair'&&stair.hp>=100)return {ok:false,message:'This stairwell does not need repair.'};
    const ready=stairWorkBlock(s,site,stair,kind,null,link=>canLeaveAfterStairRemoval(s,site,link));if(!ready.ok)return ready;
    building='stairwell';cost={...STAIR_WORK[kind].cost};work=STAIR_WORK[kind].work;
  } else if(kind==='extinguish'){job.building=null;job.fire=t.fire.id;job.priority=5;}
  if (animalJob(job)||dispatchJob(job)||carcassJob(job)) {job.animal=building;job.building=null;}
  if(carcassJob(job)){const animal=s.creatures.find(a=>a.id===job.animal);animal.death.reservedBy=job.id;if(kind==='animalButcher')job.phase='collect';}
  if (kind === 'operate') { job.remaining = work - t.machine.progress; job.priority = t.machine.order.priority; }
  if (['feed', 'hygiene'].includes(kind)) { job.patient = building; job.building = null; job.priority = 5; }
  if (kind === 'treat') { job.patient = building; job.building = null; job.dose = Math.min(25, s.crew.find(c => c.id === building).medical.injury - s.crew.find(c => c.id === building).medical.treated); job.priority = 5; }
  if (kind === 'chargeCell') { job.building = null; job.priority = 5; }
  s.jobs.push(job); if (isFreightJob(job)) freightOrdered(s, job); emitEvent(s,'job.created',{entity:job.id,target:tileEntityId(siteId,x,y,z),kind,building,cost,...(job.material?{material:job.material}:{}),...(utility?{connection:utility.id}:{}),...(stair?{connection:stair.id}:{}),...(floraJob(job)?{plant:floraId(siteId,x,y,job.plantSpecies,z),plantSpecies:job.plantSpecies,...(job.plantHarvests!==undefined?{plantHarvests:job.plantHarvests}:{}),...(job.plantGeneration!==undefined?{plantGeneration:job.plantGeneration}:{})}:{})}); return { ok: true, job };
}
export function loadFreight(s, items) {
  const request = freightRequest(s, 'surface', 'loadCargo', items);
  return request.ok ? order(s, 'surface', request.terminal.x, request.terminal.y, 'loadCargo', request.cost) : request;
}
export function unloadFreight(s, siteId, items = undefined) {
  const request = freightRequest(s, siteId, 'unloadCargo', items);
  return request.ok ? order(s, siteId, request.terminal.x, request.terminal.y, 'unloadCargo', request.cost) : request;
}
export function cancelJob(s, id, automatic = false) {
  const j = s.jobs.find(j => j.id === id); if (!j) return;
  if(isFreightJob(j)) freightCancellation(s, j, automatic);
  if(transportJob(j)){releaseTransport(s,j,'cancelled');emitEvent(s,'animal.transport.cancelled',{entity:j.animal,job:j.id,automatic});}
  if(carcassJob(j))releaseCarcass(s,j,s.crew.find(c=>c.id===j.worker),'cancelled');
  emitEvent(s,'job.cancelled',{entity:j.id,kind:j.kind,automatic});
  if(j.kind==='extinguish'&&!automatic){const f=shipmentTile(s.sites[j.site],positionOf(j)).fire;if(f)f.retryAt=s.tick+FIRE.retry;}
  if (j.automaticMaintenance) { const m = shipmentTile(s.sites[j.site],positionOf(j)).maintenance; if (m) { m.auto = false; m.blocked = null; } }
  if (j.kind === 'operate' && !automatic) { const t = shipmentTile(s.sites[j.site],positionOf(j)); if (t.machine) { t.machine.enabled = false; t.machine.status = 'Paused by player'; refreshPower(s, s.sites[j.site]); } }
  if(animalJob(j)&&j.kind!=='animalTreat'&&!automatic){const a=animalForJob(s,j);if(a)a.husbandry.retryAt=s.tick+120;}
  if (j.kind === 'hygiene' && !automatic) { const p = s.crew.find(c => c.id === j.patient); if (p) p.sanitation.retryAt = s.tick + HYGIENE_RETRY; }
  if (j.kind === 'feed' && !automatic) { const p = s.crew.find(c => c.id === j.patient); if (p) p.medical.feedRetryAt = s.tick + 120; }
  if (j.kind === 'treat') { const c = s.crew.find(c => c.id === j.patient); if (c) { if (!automatic) c.medical.retryAt = s.tick + 120; c.medical.bed = null; if (c.intent?.type === 'medical') c.intent = null; } }
  if (j.kind === 'loadShuttle') endDeparture(s,automatic?'loading_invalidated':'loading_cancelled');
  cancelMaterials(s, j);
  for (const c of s.crew) if (c.job === id) { cancelCrewTraversal(s,c); c.job = null; c.activity = 'Order cancelled'; }
  s.jobs = s.jobs.filter(j => j.id !== id);
}
export function transportAnimalToPost(s,id,x,y,z=0){return requestTransport(s,id,x,y,cancelJob,z);}
export function setAnimalPost(s,id,x,y,z=0){return assignAnimal(s,id,x,y,animalPath,cancelJob,z);}
export function setAnimalTreatment(s,id){
  const animal=s.creatures.find(a=>a.id===id),eligibility=animalTreatmentEligibility(s,animal);
  if(!eligibility.ok)return eligibility;
  return order(s,'surface',animal.husbandry.post.x,animal.husbandry.post.y,'animalTreat',id,animal.husbandry.post.z);
}
export function setAnimalPolicy(s,id,policy,enabled){return animalPolicy(s,id,policy,enabled,cancelJob);}
export function dispatchAnimal(s,id){return requestDispatch(s,id,order);}
export function butcherAnimal(s,id,x,y,z=0){return requestButchery(s,id,x,y,order,z);}
export function discardAnimal(s,id){return requestDiscard(s,id,order);}
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
  job.priority = priority; if (job.kind === 'operate') shipmentTile(s.sites[job.site],positionOf(job)).machine.order.priority = priority; return { ok: true };
}
const floraJob = j => ['gather','plant','waterPlant'].includes(j.kind);
const floraWorkValid = (s,j) => j.kind==='gather'?gatheringJobValid(s,j):cultivationJobValid(s,j);
function reconcileExtractionJobs(s) {
  for(const j of [...s.jobs])if(j.kind==='mine'&&!extractionStatus(shipmentTile(s.sites[j.site],positionOf(j))))cancelJob(s,j.id,true);
}
function reconcileFloraJobs(s) {
  for(const j of [...s.jobs])if(floraJob(j)&&!floraWorkValid(s,j))cancelJob(s,j.id,true);
}
function assignJobs(s) {
  const returning = new Set(s.mission?.phase === 'boarding' ? returnCrewIds(s) : []);
  const queued = s.jobs.filter(j => !j.worker).sort((a, b) => b.priority - a.priority || (({ feed: 2, animalCare: 2, hygiene: 1 })[b.kind] || 0) - (({ feed: 2, animalCare: 2, hygiene: 1 })[a.kind] || 0) || Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
  for (const j of queued) {
    if(j.kind==='animalTreat'&&s.jobs.some(other=>other.kind==='animalCare'&&other.animal===j.animal)){j.blockedReason='Waiting for animal feeding';continue;}
    const labor = laborFor(j), site = s.sites[j.site];
    const minSkill=j.kind==='operate'?(recipeFor(shipmentTile(site,positionOf(j)))?.minSkill||0):0;
    const enabled = s.crew.filter(c => c.site === j.site && c.health > 0 && c.labors[labor] && (c.skills[labor]?.level||0)>=minSkill);
    const free = enabled.filter(c => availableForWork(c) && !c.airlockTraversal && c.id !== j.patient && !boardingDeparture(s, c) && !returning.has(c.id));
    const body=carcassJob(j)&&j.phase==='collect'?carcassPosition(s,s.creatures.find(a=>a.id===j.animal)):null;
    const candidates = free.map(c => ({ c, path: body?crewPathToPosition(s,site,c,[positionOf(body)]):transportJob(j)?transportRoute(s,j,c):materialRoute(j, c, site, (current,from,goals)=>crewPathToPosition(s,current,from,goals)) })).filter(a => a.path !== null);
    candidates.sort((a, b) => (workRate(b.c, labor) * 12 + (b.c.favoriteLabor === labor ? 3 : 0) - b.path.length * .25) - (workRate(a.c, labor) * 12 + (a.c.favoriteLabor === labor ? 3 : 0) - a.path.length * .25) || a.c.id.localeCompare(b.c.id));
    if (candidates.length) { const c = candidates[0].c; j.worker = c.id; c.job = j.id; j.blockedReason = null; }
    else j.blockedReason = !enabled.length ? (minSkill?`No local Production ${minSkill} operator`:`No crew assigned to ${LABORS[labor].toLowerCase()}`) : !free.length ? 'Assigned crew are occupied or recovering' : !materialsReady(j) ? materialObstruction(j) : 'No reachable work position';
  }
}
function finish(s, c, j) {
  const site = s.sites[j.site], tile = shipmentTile(site,positionOf(j));
  if(j.utilityConnection){const result=completeUtilityWork(s,site,j);if(!result.ok){j.remaining=1;j.blockedReason=result.message;return;}if(result.refund)spill(tile,result.refund);}
  else if (j.connection) {
    const result=completeStairWork(s,site,j,link=>canLeaveAfterStairRemoval(s,site,link));
    if(!result.ok){j.remaining=1;j.blockedReason=result.message;return;}
    if(result.refund)spill(tile,result.refund);
  } else if (j.kind === 'build') {
    if (['wall','fence','pastureGate'].includes(j.building) && [...s.crew,...s.creatures].some(other => other.site === j.site && sameCell(positionOf(other),positionOf(j)) && other.health > 0)) { j.remaining = 1; j.blockedReason='Waiting for occupied boundary tile'; return; }
    if(!riserKind(j.building)&&!['cable','waterPipe'].includes(j.building))invalidateAirlockPart(s,site,tile,j.building==='gasPipe'?'pipe':'building','part_replaced');
    if(j.building==='floor'&&j.z>0&&!supportedFloor(site,positionOf(j))){j.remaining=1;j.blockedReason='Waiting for support below';return;}
    if(riserKind(j.building)){const result=commissionUtility(s,site,j);if(!result.ok){j.remaining=1;j.blockedReason=result.message;return;}}
    else if(j.building==='stairwell'){const result=commissionStairwell(s,site,j);if(!result.ok){j.remaining=1;j.blockedReason=result.message;return;}}
    else if (j.building === 'waterPipe') tile.waterPipe=newWaterPipe();
    else if (j.building === 'gasPipe') tile.pipe=newPipe();
    else if (j.building === 'cable') tile.cable = { hp: 100, enabled: true };
    else { if (j.building === 'floor') tile.terrain = 'floor'; else tile.building = j.building; tile.hp = 100; if(j.building==='pastureGate')tile.gateMode='latched'; initializeStorage(tile); initializeElectrical(tile); if(j.building==='airlockController')initializeAirlocks(s); }
    if(structuralBuilding(j.building)){
      const layer=j.building==='floor'?'floor':'structure',material=j.material??'alloy';
      installMaterial(tile,layer,material);
      emitEvent(s,'construction.material.installed',{entity:tileEntityId(j.site,j.x,j.y,j.z),actor:c.id,job:j.id,layer,material,cost:{...j.cost}});
    }
    s.stats.built++; log(s, `${c.name.split(' ')[0]} completed ${BUILDINGS[j.building].name.toLowerCase()}.`, 'good');
  } else if(j.kind==='plant'||j.kind==='waterPlant'){
    if(!(j.kind==='plant'?completePlanting:completeWatering)(s,c,j).ok){cancelJob(s,j.id,true);return;}
  } else if(j.kind==='gather'){
    if(!completeGathering(s,c,j).ok){cancelJob(s,j.id,true);return;}
  } else if (j.kind === 'mine') {
    const result=extractTile(tile);if(!result){cancelJob(s,j.id,true);return;}
    spill(tile,result.output);
    emitEvent(s,'resource.extracted',{entity:tileEntityId(j.site,j.x,j.y,j.z),actor:c.id,job:j.id,output:result.output,source:result.source,kind:result.kind,...(result.remaining!==undefined?{remaining:result.remaining}:{})});
    if(result.remaining===0)emitEvent(s,'deposit.depleted',{entity:tileEntityId(j.site,j.x,j.y,j.z),actor:c.id,resource:result.kind});
    s.stats.mined++; log(s, j.site === 'surface' ? 'Material extracted. Crew will haul it to a cargo depot.' : 'Salvage extracted. Crew must carry it to the shuttle dock.', 'good');
  } else if(j.kind==='extinguish'){extinguish(s,site,tile,'suppressed',c.id,j.id);
  } else if(transportJob(j)){completeTransport(s,c,j);
  } else if(dispatchJob(j)){if(!completeDispatch(s,c,j)){j.remaining=Math.min(1,j.work);j.blockedReason='Waiting for safe slaughter conditions';return;}
  } else if(carcassJob(j)){if(!completeCarcass(s,c,j)){cancelJob(s,j.id,true);return;}
  } else if(j.kind==='animalTreat'){if(!completeAnimalTreatment(s,c,j)){j.remaining=Math.min(1,j.work);j.blockedReason='Waiting for safe animal treatment conditions';return;}
  } else if(animalJob(j)){if(!completeAnimalJob(s,c,j)){j.remaining=Math.min(1,j.work);j.blockedReason='Waiting for compatible animal feed';return;}
  } else if (j.kind === 'hygiene') { completeHygiene(s, j, c);
  } else if (j.kind === 'feed') { completeFeeding(s, j);
  } else if (j.kind === 'treat') { completeTreatment(s, j); log(s, `${c.name.split(' ')[0]} completed medical treatment.`, 'good');
  } else if (isFreightJob(j)) {
    if (!completeFreight(s, c, j)) { j.remaining = 1; j.blockedReason = 'Freight terminal unavailable or hold full'; return; }
  } else if (j.kind === 'loadShuttle') {
    const previous={...s.shuttle.supplies};add(s.shuttle.supplies, j.materials);
    emitEvent(s,'shuttle.supplies.loaded',{entity:'colony',site:'site:surface',destination:s.departure?`site:${s.departure.site}`:null,crewIds:[...(s.departure?.crew||[])],actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y,j.z),from:{entity:j.id,slot:'materials'},to:{entity:'colony',slot:'shuttle.supplies'},cargo:j.materials,previous,next:s.shuttle.supplies,tick:s.tick,reason:'loading_work_completed'});
  } else if (j.kind === 'unloadShuttle') {
    const cargo=s.shuttle.supplies;spill(tile,cargo);s.shuttle.supplies={};
    emitEvent(s,'shuttle.supplies.unloaded',{entity:'colony',site:'site:surface',crewIds:[],actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y,j.z),from:{entity:'colony',slot:'shuttle.supplies'},to:{entity:tileEntityId(j.site,j.x,j.y,j.z),slot:'drop'},cargo,previous:cargo,next:{},tick:s.tick,reason:'unloading_work_completed'});
  } else if (j.kind === 'refit') {
    const previous=s.shuttle.fit;s.shuttle.fit=j.building;
    emitEvent(s,'shuttle.refit.completed',{entity:'colony',site:'site:surface',crewIds:[],actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y,j.z),previous,next:j.building,cost:j.cost,capabilities:{capacity:SHUTTLE_FITS[j.building].capacity,travel:SHUTTLE_FITS[j.building].travel,fuel:SHUTTLE_FITS[j.building].fuel,damage:SHUTTLE_FITS[j.building].damage},tick:s.tick,reason:'supplied_work_completed'});
    log(s, `${SHUTTLE_FITS[j.building].name} installed on the shuttle.`, 'good');
  } else if (j.kind === 'remove') { const airlockContext=airlockControlOwner(site,tile,'building'); invalidateAirlockPart(s,site,tile,'building'); const refund=dismantleRefund(tile),material=materialId(tile,'structure');spill(tile,refund);if(material!==null)emitEvent(s,'construction.material.removed',{entity:tileEntityId(j.site,j.x,j.y,j.z),actor:c.id,job:j.id,layer:'structure',material,refund:{...refund}});clearMaterial(tile,'structure'); spillStorage(tile); if(gasEquipment(tile))removeGas(s,site,tile,false,airlockContext); if(waterEquipment(tile))removePlumbing(s,site,tile,shipmentTile(site,positionOf(c))); releaseReactorHeat(s,site,tile); delete tile.radiator; delete tile.tank; if (tile.building === 'battery') { releaseBatteryEnergy(site, tile); delete tile.charge; } delete tile.protection; delete tile.powerPriority; delete tile.maintenance; delete tile.climate; delete tile.gateMode; tile.building = null; }
  else if (j.kind === 'repair' || j.kind === 'service') { if((tile.building==='fence'||tile.building==='pastureGate'&&tile.gateMode==='latched')&&[...s.crew,...s.creatures].some(a=>a.site===j.site&&a.health>0&&sameCell(positionOf(a),positionOf(j))&&(isLivestock(a)||!a.species&&tile.building==='fence'))){j.remaining=1;j.blockedReason='Waiting for occupied boundary tile';return;} completeService(s, tile); }
  else if (j.kind === 'repairWaterPipe') { tile.waterPipe.hp=100; }
  else if (j.kind === 'removeWaterPipe') { const recovery=shipmentTile(site,positionOf(c)); removePlumbing(s,site,tile,recovery,true); spill(recovery,{alloy:.5}); }
  else if (j.kind === 'repairPipe') { tile.pipe.hp=100; }
  else if (j.kind === 'removePipe') { const airlockContext=airlockControlOwner(site,tile,'pipe'); invalidateAirlockPart(s,site,tile,'pipe'); removeGas(s,site,tile,true,airlockContext); spill(tile,{alloy:.5}); }
  else if (j.kind === 'repairCable') { tile.cable.hp = 100; }
  else if (j.kind === 'removeCable') { spill(tile, { alloy: .5 }); tile.cable = null; }
  else if (j.kind === 'chargeCell') {
    if (tile.building !== 'battery' || !(tile.hp > 0) || BATTERY_CAPACITY - tile.charge < CELL_CHARGE - 1e-9) { cancelJob(s, j.id, true); return; }
    tile.charge += CELL_CHARGE; site.energy.injected += CELL_CHARGE; refreshPower(s, site);
    emitEvent(s,'power.cell.installed',{entity:tileEntityId(j.site,j.x,j.y,j.z),actor:c.id,job:j.id,cells:1,energy:CELL_CHARGE});
  }
  emitEvent(s,'job.completed',{entity:j.id,actor:c.id,target:tileEntityId(j.site,j.x,j.y,j.z),kind:j.kind,building:j.building,...(j.material?{material:j.material}:{})});
  remember(s, c, 'finished-work', c.favoriteLabor === laborFor(j) ? 'Satisfied by work I enjoy.' : 'Finished useful work for the colony.', c.favoriteLabor === laborFor(j) ? 5 : 2);
  s.jobs = s.jobs.filter(job => job.id !== j.id); c.job = null; c.activity = 'Work complete'; updateRooms(site);
}
function move(s, c, site, goals) { return advanceCrewRoute(s,c,site,goals).status; }
function cancelCrewTraversal(s,c) {
  const traversal=c.airlockTraversal;if(!traversal)return;
  const [,site,x,y,z='0']=traversal.controller.split(':');
  cancelAirlock(s,{site,x:Number(x),y:Number(y),z:Number(z),crew:c.id});
}
function release(s, c, reason='interrupted') { clearToolPickup(s,c,c.health<=0?'death':reason);cancelCrewTraversal(s,c); const job = s.jobs.find(j => j.id === c.job); if (job) {if(c.health<=0)reason='worker_died';else if(immobile(c))reason='immobile';releaseCarcass(s,job,c,reason);releaseTransport(s,job);job.worker = null;} c.job = null; }
function setDownBlockedRecoveryCargo(s, c, site, kind) {
  if (!c.carry || !quantity(c.carry)) return;
  const job = c.delivery?.kind === 'job' && s.jobs.find(j => j.id === c.delivery.job && j.site === c.site);
  const cargo = structuredClone(c.carry), from = { entity: c.id, slot: 'carry' };
  const to = job ? { entity: job.id, slot: `sources.${job.sources.length}` } : { entity: tileEntityId(site.id,c.x,c.y,c.z), slot: 'drop' };
  // An interrupted reservation stays reserved at this physical location. Other
  // parcels become a local pile another available hauler can collect.
  dropCarriedMaterials(s,c);
  emitItemMovement(s,cargo,c.id,from,to);
  emitEvent(s,'crew.recovery.cargo_set_down',{entity:c.id,site:`site:${site.id}`,tile:tileEntityId(site.id,c.x,c.y,c.z),kind,reason:'recovery_blocked',cargo,from,to});
}
function recover(s, c, site) {
  // Emergencies may interrupt recovery, but normal work cannot.
  const personalClaim=c.intent?.keepsake?.id;
  const criticalAir = c.oxygen < airThreshold(c);
  if (criticalAir && c.intent?.type !== 'air') { preserveOpenedMeal(c); release(s, c); c.intent = { type: 'air', target: null }; }
  else if (c.intent?.type === 'air' && c.oxygen >= 90) { c.intent = null; remember(s, c, 'safe-air', 'Reached breathable shelter.', 4); }
  if (!criticalAir && Math.abs(c.thermalStress) >= 45 && c.intent?.type !== 'temperature' && !(c.intent?.type === 'meal' && c.intent.servings > 0)) { release(s, c); c.intent = { type: 'temperature', target: null }; }
  if (!criticalAir && Math.abs(c.thermalStress) < 45 && c.hunger < 10 && !c.medical.servings && c.intent?.type !== 'meal') { release(s, c); c.intent = { type: 'meal', target: null, servings: 0 }; }
  if (!c.intent || ['haul', 'leisure', 'medical', 'equipTool'].includes(c.intent.type)) {
    if (!c.medical.servings && c.hunger < (boardingDeparture(s, c) ? 40 : 35)) { release(s, c); c.intent = { type: 'meal', target: null, servings: 0 }; }
    else if (c.energy < (boardingDeparture(s, c) ? 40 : 25)) { release(s, c); c.intent = { type: 'rest', target: null }; }
  }
  if(personalClaim&&c.intent?.keepsake?.id!==personalClaim)emitEvent(s,'item.pickup.cancelled',{entity:personalClaim,actor:c.id,reason:'recovery'});
  const intent = c.intent;
  if (!intent || ['haul', 'leisure', 'medical', 'equipTool'].includes(intent.type)) return false;
  if (intent.type === 'air') {
    remember(s, c, 'air-scare', 'Nearly ran out of suit air.', -12);
    const targets = site.rooms.filter(breathable).flatMap(r => r.cells.map(k => roomCellPosition(r,k)));
    let result = advanceCrewRoutePositions(s,c,site,targets).status, supplied = false;
    if (result === 'blocked') {
      result = advanceCrewRoutePositions(s, c, site, suitSupplyGoals(site)).status;
      supplied = result !== 'blocked';
      if (result === 'arrived' && refillSuitFromSupply(s, site, c, shipmentTile(site,positionOf(c))) && c.oxygen >= 90) {
        c.intent = null; remember(s, c, 'safe-air', 'Replenished suit air from stored breathing mix.', 4);
      }
    }
    if (result === 'blocked') setDownBlockedRecoveryCargo(s, c, site, intent.type);
    c.activity = result === 'blocked' ? 'No reachable breathable shelter' : result === 'arrived' ? 'Replenishing suit air' : supplied ? 'Seeking suit air supplies' : 'Seeking breathable air';
    return true;
  }
  if (intent.type === 'temperature') {
    if (Math.abs(c.thermalStress) <= 10 && thermalSafe(roomAt(site,c.x,c.y,c.z))) { c.intent = null; remember(s, c, 'thermal-recovery', 'Recovered in a temperate compartment.', 4); return false; }
    const targets = site.rooms.filter(r => breathable(r) && thermalSafe(r)).flatMap(r => r.cells.map(k => roomCellPosition(r,k)));
    const result = advanceCrewRoutePositions(s,c,site,targets).status; if(result==='blocked')setDownBlockedRecoveryCargo(s,c,site,intent.type); c.activity = result === 'blocked' ? 'No reachable temperate shelter' : result === 'arrived' ? 'Recovering from temperature exposure' : 'Seeking temperate shelter';
    return true;
  }
  if (intent.type === 'meal') {
    if (intent.servings > 0) {
      c.activity = 'Eating a meal'; c.hunger = Math.min(100, c.hunger + 10); intent.servings--; digestPortion(c); eatPortion(s,c,intent);
      if (intent.servings === 0) { c.intent = null; remember(s, c, 'good-meal', 'Had a proper meal.', 5); }
      return true;
    }
    const foodStores = site.tiles.filter(t => (t.building === 'stockpile' && (t.stock?.food || 0) >= 1) || (t.building === 'dock' && t.hp > 0 && (t.imports?.food || 0) >= 1) || (t.drop?.food || 0) >= 1).map(positionOf);
    const carriedMeal = !['job','shuttle'].includes(c.delivery?.kind) && (c.carry?.food || 0) >= 1;
    const result = carriedMeal ? 'arrived' : advanceCrewRoutePositions(s, c, site, foodStores).status;
    const tile = shipmentTile(site,positionOf(c)), food = carriedMeal ? c.carry : (tile.stock?.food || 0) >= 1 ? tile.stock : tile.building === 'dock' && tile.hp > 0 && (tile.imports?.food || 0) >= 1 ? tile.imports : tile.drop;
    const ration = result === 'arrived' && food ? extract(food, { food: 1 }) : null;
    if (ration) {
      openMeal(s,c,intent,ration);
      if (tile.drop && !quantity(tile.drop)) tile.drop = null;
      if (c.carry && !quantity(c.carry)) { c.carry = null; c.delivery = null; } intent.servings = 8; c.activity = 'Taking a ration'; }
    else { if(!foodStores.length || result==='blocked')setDownBlockedRecoveryCargo(s,c,site,intent.type); c.activity = !foodStores.length ? 'Waiting for food' : result === 'blocked' ? 'Food store unreachable' : 'Getting a meal'; if (!foodStores.length || result === 'blocked') remember(s, c, 'missed-meal', 'Could not get a meal.', -8); }
    return true;
  }
  if (intent.type === 'rest') {
    if (c.energy >= 85) { c.intent = null; remember(s, c, 'rested', 'Woke up rested in a bunk.', 6); return false; }
    const claimed = new Set(s.crew.filter(other => other.id !== c.id && other.site === c.site && other.health > 0 && other.intent?.type === 'rest' && other.intent.target).map(other => cellKey(other.intent.target)));
    const valid = p => { const t = shipmentTile(site,p), room = t && roomAt(site,p.x,p.y,p.z); return t?.building === 'bunk' && t.hp > 0 && bunkAccessible(s,c,site,p.x,p.y,p.z) && livingAllowed(site,p.x,p.y,p.z) && breathable(room) && thermalSafe(room) && !claimed.has(cellKey(p)); };
    if (intent.target && !valid(intent.target)) intent.target = null;
    if (!intent.target) {
      if (c.site === 'surface' && c.housing.bunk && housingObstruction(s,c,(current,from,goals)=>crewPathTo(s,current,from,goals))) remember(s,c,'housing-displaced','Could not use my assigned bunk; had to find another place to rest.',-6);
      const options = site.tiles.filter(t => valid(positionOf(t))).map(t => ({ t, path: crewPathToPosition(s,site,c,[positionOf(t)]) })).filter(v => v.path !== null).sort((a, b) => Number(ownsBunk(c,site.id,b.t.x,b.t.y,b.t.z)) - Number(ownsBunk(c,site.id,a.t.x,a.t.y,a.t.z)) || Number(roomBenefit(s, site, b.t, 'quarters')) - Number(roomBenefit(s, site, a.t, 'quarters')) || a.path.length - b.path.length);
      if (options.length) intent.target = positionOf(options[0].t);
    }
    if (intent.target) {
      const result = advanceCrewRoutePositions(s, c, site, [intent.target]).status;
      c.activity = result === 'arrived' ? 'Sleeping until rested' : 'Going to a reserved bunk';
      if (result === 'arrived') { c.energy = Math.min(100, c.energy + (roomBenefit(s, site, positionOf(c), 'quarters') ? 1.05 : .85)); rememberHousingSleep(s,c,site); experienceComfort(s,c,site); }
      if (result === 'blocked') { setDownBlockedRecoveryCargo(s,c,site,intent.type); intent.target = null; c.activity = 'Bunk route blocked'; }
    } else {
      remember(s, c, 'no-bunk', 'Could not find an available safe bunk.', -8);
      if (c.energy >= 50) { c.intent = null; remember(s, c, 'poor-sleep', 'Slept poorly on the floor.', -6); return false; }
      if (livingAllowed(site, c.x, c.y, c.z) && breathable(roomAt(site,c.x,c.y,c.z)) && thermalSafe(roomAt(site,c.x,c.y,c.z))) { c.energy = Math.min(100, c.energy + .18); c.activity = 'Resting on the floor; needs a bunk'; }
      else {
        const goals = site.rooms.filter(r => breathable(r) && thermalSafe(r)).flatMap(r => r.cells.map(k => roomCellPosition(r,k))).filter(({x,y,z}) => livingAllowed(site,x,y,z));
        const result = advanceCrewRoutePositions(s,c,site,goals).status; if(result==='blocked')setDownBlockedRecoveryCargo(s,c,site,intent.type); c.activity = result === 'blocked' ? 'Waiting for a safe, available bunk' : 'Seeking a living area for rest';
      }
    }
    return true;
  }
  return false;
}
function act(s, c, air) {
  if (c.health <= 0) { if (c.site !== 'transit' && c.activity !== 'Deceased') { dropPossession(s,c); dropOpenedMeals(s, c); dropSanitation(s, c); release(s, c); c.intent = null; dropCarriedMaterials(s, c); c.activity = 'Deceased'; log(s, `${c.name} has died.`, 'danger'); } return; }
  if (c.site === 'transit') return;
  const plannedPath=(current,from,goals)=>crewPathTo(s,current,from,goals);
  const site = s.sites[c.site], room = roomAt(site,c.x,c.y,c.z);
  updateMorale(s, c);
  c.hunger = Math.max(0, c.hunger - .05); c.energy = Math.max(0, c.energy - (c.job ? .065 : .03));
  const thermalDamage = thermalExposure(c, site, !breathable(room));
  if (thermalDamage) injure(s, c, thermalDamage, c.thermalStress < 0 ? 'cold exposure' : 'heat exposure');
  if (c.medical.servings > 0) { c.hunger = Math.min(100, c.hunger + 10); c.medical.servings--; digestPortion(c); eatPortion(s,c,c.medical); }
  const flame=shipmentTile(site,positionOf(c)).fire;if(flame){injure(s,c,.2+flame.intensity*.01,'fire exposure');emitEvent(s,'fire.exposure',{entity:flame.id,actor:c.id,target:tileEntityId(c.site,c.x,c.y,c.z)});}
  if (air.unmetOxygen > 0 || c.hunger <= 0) injure(s, c, .5, air.unmetOxygen > 0 ? 'oxygen deprivation' : 'starvation');
  else if (breathable(room) && thermalSafe(room) && room.air > 60 && c.hunger > 40) c.health = Math.min(100 - c.medical.injury, c.health + .03);
  if (c.health <= 0) { dropPossession(s,c); dropOpenedMeals(s, c); dropSanitation(s, c); release(s, c); c.intent = null; dropCarriedMaterials(s, c); c.activity = 'Deceased'; log(s, `${c.name} has died.`, 'danger'); return; }
  const traversal=continueCrewTraversal(s,c,site);
  if(traversal&&traversal.status!=='blocked'){
    c.activity=traversal.status==='waiting_airlock'?'Waiting for airlock cycle':'Crossing airlock';
    return;
  }
  if(evadeFire(s,c,site,plannedPath,release))return;
  if (rescue(s, c, site, plannedPath)) return;
  if (dependentCare(s, c, site, plannedPath, release)) return;
  // Returning workers finish or set down local parcels before seeking shelter;
  // otherwise a cancelled load in vacuum could prevent physical boarding forever.
  if (s.mission?.phase === 'boarding' && c.site === s.mission.site && returnCrewIds(s).includes(c.id) && c.carry && c.delivery?.kind !== 'shuttle' && haul(s,c,site,plannedPath)) return;
  if (c.site !== 'surface' && s.mission?.phase === 'boarding' && boardShuttle(s, c, site, plannedPath)) return;
  if (c.site !== 'surface' && (c.carry || c.intent?.type === 'salvage') && haulSalvage(s, c, site, plannedPath)) return;
  if (settlementSite(site) && recover(s, c, site)) return;
  if (useSanitation(s, c, site, plannedPath, release)) return;
  if (c.carry && haul(s, c, site, plannedPath)) return;
  if (medicalRest(s, c, site, plannedPath)) return;
  if (boardingDeparture(s, c)) { if (c.intent?.type === 'leisure') c.intent = null; walkToDeparture(s, c, plannedPath); return; }
  if(advanceToolPickup(s,c))return;
  if (leisure(s, c, site, plannedPath)) return;
  const j = s.jobs.find(j => j.id === c.job);
  if (j) {
    const labor = laborFor(j);
    if(floraJob(j)&&!floraWorkValid(s,j)){cancelJob(s,j.id,true);return;}
    if(j.kind==='extinguish'&&!fireJobValid(s,j)){cancelJob(s,j.id,true);return;}
    if(j.kind!=='extinguish'&&shipmentTile(site,positionOf(j)).fire){release(s,c);j.blockedReason='Waiting for fire suppression';return;}
    if(animalJob(j)&&!animalJobValid(s,j)){cancelJob(s,j.id,true);return;}
    if(dispatchJob(j)&&!dispatchJobValid(s,j)){cancelJob(s,j.id,true);return;}
    if (j.kind === 'hygiene' && !hygienePatient(s, j)) { cancelJob(s, j.id, true); return; }
    if (j.kind === 'feed' && !feedPatient(s, j)) { cancelJob(s, j.id, true); return; }
    if (j.kind === 'treat' && !treatmentPatient(s, j)) { cancelJob(s, j.id); return; }
    if (!c.labors[labor]) { release(s, c); return; }
    if(carcassJob(j)){if(actCarcass(s,c,j,(state,crew,site,goals)=>advanceCrewRoutePositions(state,crew,site,goals).status,release))finish(s,c,j);return;}
    if(transportJob(j)){if(actTransport(s,c,j,release))finish(s,c,j);return;}
    if (j.kind === 'operate') { operateMachine(s, c, j, site, plannedPath); return; }
    if(j.kind==='animalTreat'&&s.jobs.some(other=>other.kind==='animalCare'&&other.animal===j.animal)){release(s,c);c.activity=j.blockedReason='Waiting for animal feeding';return;}
    if(j.kind==='build'&&reserveBlocksBuilding(shipmentTile(site,positionOf(j)),j.building)){c.activity=j.blockedReason='Clear the mineral reserve before construction';return;}
    if (!materialsReady(j)) { fetchMaterials(s, c, j, site, plannedPath); return; }
    c.activity = j.kind==='chargeCell'?'Installing a power cell':dispatchJob(j)?'Slaughtering livestock for meat':j.kind==='plant'?`Planting ${FLORA[j.plantSpecies].name.toLowerCase()}`:j.kind==='waterPlant'?`Watering ${FLORA[j.plantSpecies].name.toLowerCase()}`:j.kind==='gather'?`Gathering ${FLORA[j.plantSpecies].name.toLowerCase()}`:j.kind==='extinguish'?'Suppressing a fire':animalJob(j) ? (j.kind==='animalTreat'?'Treating animal injuries':j.kind==='animalCare'?`Feeding and handling ${livestockDef(animalForJob(s,j)).name.toLowerCase()}`:`Collecting ${livestockDef(animalForJob(s,j)).productName.toLowerCase()}`) : j.kind === 'hygiene' ? 'Providing bedside hygiene' : j.kind === 'feed' ? 'Serving a bedside meal' : j.kind === 'treat' ? 'Treating injuries' : j.kind === 'loadCargo' ? 'Loading freight' : j.kind === 'unloadCargo' ? 'Unloading freight' : j.kind === 'loadShuttle' ? 'Loading shuttle stores' : j.kind === 'unloadShuttle' ? 'Unloading shuttle stores' : j.kind === 'refit' ? `Installing ${SHUTTLE_FITS[j.building].name.toLowerCase()}` : j.kind === 'build' ? `Building ${BUILDINGS[j.building].name.toLowerCase()}` : j.kind === 'mine' ? 'Extracting material' : `${j.kind === 'service' ? 'Servicing' : ['repair', 'repairCable'].includes(j.kind) ? 'Repairing' : 'Dismantling'} ${j.kind.endsWith('Cable') ? 'cable' : 'structure'}`;
    const result = advanceCrewRoutePositions(s,c,site,horizontalNeighbors(positionOf(j))).status;
    if(result==='arrived'&&animalJob(j)){const a=animalForJob(s,j);if(!sameCell(positionOf(a),positionOf(j))){c.activity=j.blockedReason='Waiting for animal at the post';return;}}
    if(result==='arrived'&&dispatchJob(j)){const a=s.creatures.find(a=>a.id===j.animal);if(!sameCell(positionOf(a),positionOf(j))){c.activity=j.blockedReason='Waiting for animal at the post';return;}}
    if(result==='arrived'&&j.kind==='animalTreat'&&!animalTreatmentReady(s,j)){c.activity=j.blockedReason='Waiting for safe animal treatment conditions';return;}
    if (result === 'arrived' && j.kind === 'hygiene' && !hygieneReady(s, j, c)) { c.activity = j.blockedReason = 'Waiting for patient and safe hygiene conditions'; return; }
    if (result === 'arrived' && j.kind === 'treat' && !treatmentReady(s, j, c)) { c.activity = j.blockedReason = 'Waiting for patient and safe treatment conditions'; return; }
    if (result === 'arrived') { j.blockedReason = null; const effort = workEffort(s,c,j,workRate(c,labor)); j.remaining -= effort; gainExperience(c, labor, effort); if (j.remaining <= 0) finish(s, c, j); }
    if (result === 'waiting_airlock') { c.activity='Waiting for airlock cycle'; j.blockedReason='Waiting for airlock cycle'; }
    if (result === 'blocked') { release(s, c); c.activity = 'Route blocked'; }
    return;
  }
  c.job = null;
  if (settlementSite(site) && haul(s, c, site, plannedPath)) return;
  if (c.site !== 'surface' && haulSalvage(s, c, site, plannedPath)) return;
  c.activity = c.site === 'surface' ? 'Available for assigned work' : 'Awaiting expedition orders';
}
export function launch(s, siteId, crewIds = undefined) {
  const blocked=expeditionLaunchBlock(s,siteId);if(blocked)return {ok:false,message:blocked.message,code:blocked.code};
  const selected=selectExpeditionCrew(s,crewIds,siteId);if(!selected.ok)return selected;
  planDeparture(s, siteId, selected.crew); updateDeparture(s, order, release);
  log(s, `Preparing expedition to ${siteDefinition(s,siteId).name}. Load supplies, then board.`, 'info'); return { ok: true };
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
  emitEvent(s,event,{entity:'colony',site:`site:${m.site}`,route:routeDefinition(s,m.site)?.id,crewIds:[...m.crew],returnCrewIds:[...m.returnCrew],previous,next,cargo:m.cargo,tick:s.tick,...details});
}
export function recall(s,reason='player') {
  const m = s.mission; if (!m || ['returning', 'boarding'].includes(m.phase)) return { ok: false, message: 'No expedition to recall.' };
  const previous=m.phase;
  const travelers=returnCrewMembers(s),ids=returnCrewIds(s);
  if(!ids.length||travelers.length!==ids.length)return {ok:false,message:'Return passengers are unavailable.'};
  // Verify and spend an outbound turn-back's reserved fuel before changing
  // crew jobs or plans; rejected recall must not partly cancel an expedition.
  if(previous==='outbound'&&!spendReturnFuel(s))return {ok:false,message:'Return fuel unavailable.'};
  const travelerJobs=new Set(travelers.map(c=>c.job).filter(Boolean));
  const residentsRemain=s.crew.some(c=>c.health>0&&c.site===m.site&&!ids.includes(c.id)&&isResident(s,c.id,m.site));
  for (const c of travelers) { preserveOpenedMeal(c); release(s, c); c.intent = null; c.activity = 'Returning to shuttle'; }
  for (const j of [...s.jobs].filter(j => j.site === m.site && (!residentsRemain || travelerJobs.has(j.id) || isFreightJob(j)))) cancelJob(s, j.id);
  if (previous === 'outbound') { m.phase = 'returning'; m.remaining = routeTime(s, m.site); }
  else { m.phase = 'boarding'; m.remaining = 0; }
  missionEvent(s,'expedition.recalled',m,previous,m.phase,{reason,remaining:m.remaining,from:`site:${m.site}`,to:'site:surface'});
  log(s, 'Expedition recalled. Crew must reach the dock; uncollected salvage stays on site.'); return { ok: true };
}
function updateFieldHazards(s, m) {
  const dock = dockAt(s.sites[m.site]);
  const crew = s.crew.filter(c => returnCrewIds(s).includes(c.id) && c.site===m.site && c.health > 0 && (!dock || c.x !== dock.x || c.y !== dock.y));
  if (m.site === 'solar') {
    const storm = s.tick % 120 >= 90;
    m.heat = Math.max(0, Math.min(100, m.heat + (storm ? 2 : -.7)));
    if (m.phase === 'working' && !storm && s.tick % 15 === 0) spill(at(s.sites.solar, 10, 8), { cells: 1 });
    if (storm && s.tick % 10 === 0) { crew.forEach(c => injure(s, c, 3 * SHUTTLE_FITS[m.fit].damage, 'solar exposure')); log(s, 'Solar squall. Collectors retracted; crew sheltering.', 'danger'); }
  }

}
function updateWreckHazards(s) {
  for(const site of Object.values(s.sites)) {
    if(siteKind(site)!=='wreck')continue;
    const definition=siteDefinition(s,site.id),hazard=definition?.debris||{period:65,damage:4};
    if(s.tick%hazard.period!==0)continue;
    const presence=shuttlePresence(s,site.id);let exposed=0;
    for(const c of s.crew.filter(c=>c.site===site.id&&c.health>0)) {
      const room=roomAt(site,c.x,c.y,c.z),tile=shipmentTile(site,positionOf(c));
      const sheltered=tile.terrain==='floor'&&room?.sealed&&room.leakArea<=1e-8;
      const docked=presence.usable&&sameCell(positionOf(c),positionOf(presence.terminal));
      if(sheltered||docked)continue;
      const shield=presence.present&&returnCrewIds(s).includes(c.id)?SHUTTLE_FITS[s.mission.fit].damage:1,damage=hazard.damage*shield;
      injure(s,c,damage,'debris impact');exposed++;
      emitEvent(s,'wreck.debris.exposure',{entity:c.id,site:`site:${site.id}`,target:tileEntityId(site.id,c.x,c.y,c.z),damage,reason:'outside_shelter'});
    }
    if(exposed)log(s,`Debris impact at ${definition.name}. Exposed crew need shelter.`,'danger');
  }
}
function localRecoveryAvailable(s, c) {
  if(c.site==='surface'||!settlementSite(s.sites[c.site]))return false;
  const site=s.sites[c.site];
  const safeRooms = site.rooms.filter(r => breathable(r) && thermalSafe(r));
  const goals = safeRooms.flatMap(r => r.cells.map(k => roomCellPosition(r,k)));
  if (!goals.length || crewPathToPosition(s,site,c,goals) === null) return false;
  if (c.hunger < 25) {
    const food = site.tiles.filter(t => (t.stock?.food || 0) >= 1 || (t.drop?.food || 0) >= 1 || t.building === 'dock' && t.hp > 0 && (t.imports?.food || 0) >= 1).map(positionOf);
    if (!food.length || crewPathToPosition(s,site,c,food) === null) return false;
  }
  return true;
}
function updateMission(s) {
  const m = s.mission; if (!m) return;
  if (['working', 'boarding'].includes(m.phase)) {
    updateFieldHazards(s, m);
    for (const c of returnCrewMembers(s).filter(c => c.health <= 0 && c.site !== 'transit')) { dropOpenedMeals(s,c); release(s, c); c.intent = null; if (c.carry) dropCarriedMaterials(s, c); }
  }
  if (m.phase === 'boarding') {
    const site = s.sites[m.site], dock = dockAt(site), ids=returnCrewIds(s), passengers=returnCrewMembers(s), crew=passengers.filter(c=>c.health>0);
    if (!ids.length || passengers.length!==ids.length || (!crew.length&&!allReturnTravelersDead(s)) || !dock || s.jobs.some(isFreightJob) || crew.some(c => c.site!==m.site || !sameCell(positionOf(c),positionOf(dock)) || c.carry || c.rescue || c.airlockTraversal)) return;
    if (!spendReturnFuel(s)) return;
    for (const helper of s.crew) if (crew.some(c => c.id === helper.rescue?.patient)) releaseRescue(s,helper,'patient_boarded');
    for (const c of crew) {
      preserveOpenedMeal(c); release(s, c); c.intent = null; c.medical.bed = null;
      if(isResident(s,c.id,m.site)){
        const outpost=s.outposts[m.site],previous=[...outpost.residents];
        outpost.residents=outpost.residents.filter(id=>id!==c.id);
        emitEvent(s,'outpost.residence.removed',{entity:c.id,site:`site:${m.site}`,previous,next:[...outpost.residents],reason:'return_boarded',tick:s.tick});
      }
      c.site = 'transit'; c.activity = 'Returning to colony';
    }
    m.phase = 'returning'; m.remaining = routeTime(s, m.site);
    missionEvent(s,'expedition.return.departed',m,'boarding','returning',{reason:'team_boarded',from:tileEntityId(site.id,dock.x,dock.y),to:'site:surface',aboard:crew.map(c=>c.id),remaining:m.remaining});
    log(s, 'Team aboard. Shuttle returning with loaded cargo.'); return;
  }
  if (m.phase !== 'working') {
    if (--m.remaining > 0) return;
    if (m.phase === 'outbound') {
      m.phase = 'working'; deployKit(s); s.sites[m.site].explored = true;
      m.crew.forEach((id, i) => { const c = s.crew.find(c => c.id === id); c.site = m.site; c.x = siteKind(s.sites[m.site]) === 'wreck' ? 4 + i : 5 + i; c.y = 10; c.z=0; c.activity = 'Expedition ready'; });
      missionEvent(s,'expedition.arrived',m,'outbound','working',{reason:'outbound_transit_completed',from:'site:surface',to:`site:${m.site}`,positions:m.crew.map(id=>{const c=s.crew.find(c=>c.id===id);return {entity:id,tile:tileEntityId(c.site,c.x,c.y)};}),collector:m.collector});
      log(s, `Arrived at ${siteDefinition(s,m.site).name}. ${m.site === 'solar' ? 'Collectors deployed.' : 'Designate material for salvage.'}`, 'discovery');
    } else {
      const returned=[];
      for (const c of returnCrewMembers(s)) { if (c.site !== 'transit') continue; c.site = 'surface'; c.x = 10; c.y = 11; c.z=0; c.activity = 'Returned from expedition'; returned.push(c.id); }
      spill(at(s.sites.surface, 16, 11), m.cargo);
      if (m.cargo.components&&!s.flags.salvageReturned) {
        s.flags.salvageReturned=true;
        missionEvent(s,'expedition.upgrade.unlocked',m,false,true,{reason:'components_returned',unlock:'salvageReturned',destination:'site:solar',target:tileEntityId('surface',16,11),components:m.cargo.components});
      }
      if (m.cargo.components && !s.flags.tibblesIntroduced) {
        s.flags.tibblesIntroduced = true;
        s.creatures.push({ id: `tibble-${s.nextId++}`, species: 'tibble', site: 'surface', x: 8, y: 10, z: 0, health: 100, fed: 30, age: 0 });
        log(s, 'A pale seed-mite crawled out of the recovered cargo. Food stores are at risk. Build a biofilter trap near the depot.', 'danger');
      }
      s.stats.returned++; s.stats.solarCells += m.cargo.cells || 0;
      s.mission=null;
      missionEvent(s,'expedition.returned',m,'returning',null,{reason:'return_transit_completed',from:{entity:'colony',slot:'mission.cargo'},to:{entity:tileEntityId('surface',16,11),slot:'drop'},returned,remainingAtSite:m.crew.filter(id=>s.crew.find(c=>c.id===id).site===m.site)});
      log(s, `Expedition home. Awaiting unloading: ${resourceEntries(m.cargo).map(([r, n]) => `${n} ${r}`).join(', ') || 'no cargo'}.`, 'good');
    }
    return;
  }
  const crew = returnCrewMembers(s);
  if (crew.some(c => c.health < 40 || (c.oxygen < airThreshold(c) || c.energy < 25 || c.hunger < 25) && !localRecoveryAvailable(s,c)) || (m.site === 'comet' && s.tick + routeTime(s, 'comet') + returnWalk(s, (current,from,goals)=>crewPathTo(s,current,from,goals)) + 5 >= s.comet.leaves)) { log(s, 'Automatic recall: expedition safety margin reached.', 'danger'); recall(s,'safety_margin'); return; }

}
function homeHabitatRoom(site, room) {
  if (!room || !room.cells.some(cell => {
    const [x, y] = cell.split(',').map(Number);
    return ['scrubber', 'farm', 'bunk'].includes(at(site, x, y).building);
  })) return false;
  // Bound cycling chambers deliberately use suits. Require the complete room
  // match so a damaged chamber that merges into a habitat cannot hide a warning.
  return !site.tiles.some(t => t.building === 'airlockController' && t.airlock?.binding
    && t.airlock.chamberCells.length === room.cells.length && airlockCells(room).every(cell => t.airlock.chamberCells.includes(cell)));
}
export function step(s, ticks = 1) {
  for (let n = 0; n < ticks; n++) {
    reconcileCarcasses(s,cancelJob);capture(s, 'external');
    const pastureBefore=pastureSnapshot(s), habitatBefore=habitatSnapshot(s);
    s.tick++; reconcileHousing(s); const site = s.sites.surface; updateDebris(s); flowPlumbing(s); flowLiquids(s);
    prepareAirlocks(s);
    const operating = Object.values(s.sites).map(current => [current, updatePower(s, current)]);
    gateAirlocks(s);
    pumpLiquids(s); operatePlumbing(s); updateGasNetworks(s); updateAtmosphere(s); updateThermal(s); updateReactorCooling(s); updateFire(s); reconcileAirlocks(s); prepareFire(s,order,cancelJob); updateCarcasses(s);updateFood(s, (current,from,goals)=>crewPathTo(s,current,from,goals)); updateSanitation(s);
    for (const job of [...s.jobs].filter(isFreightJob)) if (!freightWorkValid(s,job)) cancelJob(s,job.id,true);
    for (const [current, equipment] of operating) recordOperation(s, current, equipment);
    scheduleMaintenance(s, order);
    updateIndustry(s, roomAt, order);
    updateDeparture(s, order, release);
    prepareMedicine(s, order, cancelJob, release, (current,from,goals)=>crewPathTo(s,current,from,goals));
    prepareNursing(s, order, cancelJob, release, (current,from,goals)=>crewPathTo(s,current,from,goals));
    prepareHygiene(s, order, cancelJob, release);
    reconcileTransport(s,cancelJob);reconcileCarcasses(s,cancelJob);
    prepareHusbandry(s,order,cancelJob);
    prepareDowntime(s, release);
    reconcileFloraJobs(s);reconcileExtractionJobs(s);
    assignJobs(s);
    const breathing = new Map();
    let habitatSuitAssistance = false;
    for (const current of Object.values(s.sites)) for (const [id, allocation] of breatheBatch(current, s.crew)) {
      breathing.set(id, allocation);
      if (current === site && (allocation.suitOxygen > 0 || allocation.unmetOxygen > 0)) {
        const c = s.crew.find(member => member.id === id);
        if (homeHabitatRoom(site, roomAt(site,c.x,c.y,c.z))) habitatSuitAssistance = true;
      }
      if (allocation.suitOxygen > 0 || allocation.refillOxygen > 0 || allocation.unmetOxygen > 0)
        emitEvent(s, 'crew.air.allocated', { entity: id, actor: id, site: `site:${current.id}`, ...allocation });
    }
    for (const c of s.crew) act(s, c, breathing.get(c.id));
    reconcileAirlocks(s);
    updateWreckHazards(s); updateMission(s);
    reconcileNursing(s, cancelJob); reconcileHygiene(s, cancelJob);
    updateDeparture(s, order, release); tryDeparture(s, log);
    reconcileTransport(s,cancelJob);
    updateEcology(s);reconcileCarcasses(s,cancelJob);
    reconcileFloraJobs(s);reconcileExtractionJobs(s);
    reconcileTransport(s,cancelJob);
    prepareHusbandry(s,order,cancelJob);
    prepareFire(s,order,cancelJob);
    updateCrewLife(s); reconcileHousing(s); reconcileAirlocks(s);
    updateHerdWarning(s);
    for (const current of Object.values(s.sites)) { refreshAtmosphere(current); refreshPower(s, current); }
    const unsafe = site.rooms.some(r => homeHabitatRoom(site, r) && !breathable(r));
    const airWarning = unsafe || habitatSuitAssistance;
    if (airWarning !== !!s.flags.airWarning) {
      s.flags.airWarning = airWarning;
      log(s, unsafe ? 'Habitat air is unsafe. Crew are using suits; check pressure, exhaled gas, seals, and life support.'
        : habitatSuitAssistance ? 'Habitat air reserves are low. Crew need suit oxygen to breathe; check breathing mix and life support.'
        : 'Habitat air supply supports breathing again.', airWarning ? 'danger' : 'good');
    }
    const thermalDanger = site.rooms.some(r => !thermalSafe(r) && r.cells.some(k => { const [x, y] = k.split(',').map(Number); return ['bunk', 'farm', 'medicalCot'].includes(at(site, x, y).building); }));
    if (thermalDanger !== !!s.flags.thermalWarning) { s.flags.thermalWarning = thermalDanger; log(s, thermalDanger ? 'Habitat temperature is unsafe. Check climate units, power and hull seals.' : 'Habitat temperature is safe again.', thermalDanger ? 'danger' : 'good'); }
    syncResources(s);
    if (s.tick === 95) { s.anomaly = { id: 'dead-channel', title: 'The voice on channel zero', description: 'An obsolete rescue beacon is repeating your landing clearance. The recording is dated eleven years from now. A narrow-band echo might reveal a supply cache—or something could be listening.', resolved: false }; log(s, 'Unregistered transmission on a dead rescue frequency. Review the signal in colony status.', 'discovery'); }
    if (s.tick === s.comet.arrives) { s.sites.comet.explored = true; log(s, 'The Wayfarer enters range. A brief window to harvest ice and volatiles.', 'discovery'); }
    if (s.tick === s.comet.leaves) { log(s, 'The Wayfarer is leaving this region. Next pass is being calculated.'); s.comet = { arrives: s.tick + 400, leaves: s.tick + 700 }; }
    if (s.tick % 300 === 220) log(s, 'Nightfall. Solar arrays offline; habitat draws on battery reserves.');
    if (s.tick % 300 === 0) log(s, 'Sunrise. Solar generation restored.', 'good');
    s.objectives = { build: s.stats.built > 0, extract: s.stats.mined > 0, salvage: !!s.flags.salvageReturned, advanced: site.tiles.some(t => t.building === 'advanced'), solar: s.stats.solarCells > 0 };
    recordPastureChanges(s,pastureBefore); recordHabitatChanges(s,habitatBefore);
    capture(s, 'simulation.tick');
  }
}
function updateEcology(s) {
  const site = s.sites.surface,pastures=pastureRegions(site),positions=new Map(s.creatures.map(a=>[a.id,positionOf(a)]));
  for (const creature of [...s.creatures]) {
    if(creature.health<=0){if(isLivestock(creature))registerAnimalDeath(s,creature,'unknown');continue;}
    const region=pastures.byCell.get(cellKey(positionOf(creature))),post=creature.husbandry?.post;
    const roamPasture=!!region?.enclosed&&!!post&&pastures.byCell.get(cellKey(post))===region;
    const def=livestockDef(creature);
    const traits=animalTraits(creature);
    creature.age++; creature.fed = Math.max(0, creature.fed - (traits?(adult(creature)?traits.metabolism:traits.juvenileMetabolism):.015));
    if(def){updateAnimalHealth(s,creature);if(creature.health<=0)continue;}
    const flame=shipmentTile(site,positionOf(creature)).fire;
    if(flame){const damage=.2+flame.intensity*.01;if(def)injureAnimal(s,creature,damage,'fire');else creature.health=Math.max(0,creature.health-damage);emitEvent(s,'fire.exposure',{entity:flame.id,actor:creature.id,target:tileEntityId(creature.site,creature.x,creature.y,creature.z)});if(creature.health<=0){if(!def)emitEvent(s,'animal.died',{entity:creature.id,cause:'fire'});}else {const route=animalPathToPosition(site,creature,horizontalNeighbors(positionOf(creature)));if(route?.length)moveAnimal(s,creature,route[0],'fire_escape');}continue;}
    if(def){animalCondition(s,creature);if(creature.health<=0)continue;if(heldForTransport(s,creature))continue;if(moveAssignedAnimal(s,creature,animalPath,roamPasture))continue;}
    if (s.tick % (def?.movementTicks || 5) !== 0) continue;
    if (def) {
      const tile = shipmentTile(site,positionOf(creature));
      if (def.grazesLichen && floraBiomass(tile) > 0) { const bite=adult(creature)?5:2.5,eaten=consumeLichen(s,site,tile,bite,creature.id);creature.fed=Math.min(100,creature.fed+4*eaten/bite);if(eaten>0)emitEvent(s,'animal.grazed',{entity:creature.id,target:tileEntityId('surface',tile.x,tile.y,tile.z),plant:floraId('surface',tile.x,tile.y,'lichen',tile.z),lichen:eaten}); }
      else { const choices = walkingNeighbors(site,positionOf(creature)).filter(p => animalPassablePosition(site,p) && ['ground','floor'].includes(shipmentTile(site,p).terrain) && (!shipmentTile(site,p).building || ['fence','pastureGate','husbandryPost'].includes(shipmentTile(site,p).building)) && (roamPasture || !creature.husbandry.post || (creature.husbandry.post.z===p.z&&distance([p.x,p.y],[creature.husbandry.post.x,creature.husbandry.post.y])<=2))); if (choices.length) { if(def.grazesLichen)choices.sort((a, b) => floraBiomass(shipmentTile(site,b)) - floraBiomass(shipmentTile(site,a))); moveAnimal(s,creature,choices[Math.floor(random(s) * Math.min(2, choices.length))],def.grazesLichen?'grazing':'wandering'); } }
    } else if (creature.species === 'tibble') {
      const foodTiles = site.tiles.filter(t => (t.stock?.food || 0) >= 1 || (t.machine?.output.food || 0) >= 1 || (t.drop?.food || 0) >= 1);
      const p = animalPathToPosition(site, creature, foodTiles.map(positionOf));
      if (p?.length) moveAnimal(s,creature,p[0],'food');
      if (p?.length === 0 && s.tick % 30 === 0) {
        const here = shipmentTile(site,positionOf(creature));
        const food = [here.stock, here.machine?.output, here.drop].find(v => (v?.food || 0) >= 1);
        if (!food || !take(food, { food: 1 })) continue;
        if (here.drop && !quantity(here.drop)) here.drop = null;
        creature.fed = Math.min(100, creature.fed + 25);
        const t = shipmentTile(site,positionOf(creature)); if (t.building === 'farm') t.hp = Math.max(0, t.hp - 5);
        emitEvent(s,'pest.fed',{entity:creature.id,target:tileEntityId('surface',creature.x,creature.y,creature.z),food:1});
        log(s, 'Tibbles consumed a ration from the colony’s biomass supply.', 'danger');
      }
      if (creature.fed >= 70 && creature.age >= 60 && s.creatures.filter(c => c.species === 'tibble').length < 12) { creature.fed -= 40; creature.age = 0; const child={ ...creature, id: `tibble-${s.nextId++}`, fed: 20, age: 0 };s.creatures.push(child);emitEvent(s,'pest.born',{entity:child.id,parent:creature.id,target:tileEntityId('surface',child.x,child.y,child.z)}); log(s, 'A tibble clutch has hatched. Contain the infestation before it grows.', 'danger'); }
    }
  }
  updateBreeding(s,positions);
  if (s.tick % 10 === 0) for (const trap of site.tiles.filter(t => t.building === 'trap' && t.hp > 0)) {
    const pest = s.creatures.find(c => c.species === 'tibble' && c.site === 'surface' && c.z === trap.z && c.health>0 && distance([c.x,c.y],[trap.x,trap.y]) <= 6);
    if (pest && spend(s, { food: .25 }, t => t.z === trap.z && distance([t.x,t.y],[trap.x,trap.y]) <= 6 && pathToPosition(site, t, [positionOf(trap)]) !== null)) { s.creatures = s.creatures.filter(c => c.id !== pest.id); s.stats.trapped++;emitEvent(s,'pest.captured',{entity:pest.id,target:tileEntityId('surface',trap.x,trap.y,trap.z),food:.25}); log(s, 'Biofilter trap secured a tibble. Cargo infestation reduced.', 'good'); }
  }
  updateFlora(s);
}
export function resolveSignal(s, investigate) {
  if (!s.anomaly || s.anomaly.resolved) return { ok: false, message: 'No unresolved signal.' };
  if (investigate && !spend(s, { components: 1 }, connectedTo(s, [16, 11]))) return { ok: false, message: 'Decoding requires 1 component.' };
  s.anomaly.resolved = true;
  if (investigate) { spill(at(s.sites.surface, 16, 11), { fuel: 3 }); for (const c of s.crew) c.energy = Math.max(0, c.energy - 8); log(s, 'The signal led to a buried fuel cache. Now it repeats the names of your crew. Nobody slept well. (3 fuel awaiting haul, crew energy −8)', 'discovery'); }
  else log(s, 'Channel zero isolated. For a moment, the receiver continued speaking without power.');
  return { ok: true };
}
export function dischargeCell(s, x = null, y = null, z = 0) {
  if (z == null) z = 0;
  if ((x == null) !== (y == null)) return { ok: false, message: 'Provide both bank coordinates, or neither.' };
  const site = s.sites.surface;
  const banks = site.tiles.filter(t => t.building === 'battery' && t.hp > 0 && (x == null || (t.x === x && t.y === y && t.z === z)));
  const open = banks.filter(t => BATTERY_CAPACITY - t.charge >= CELL_CHARGE - 1e-9 && !s.jobs.some(j => j.kind === 'chargeCell' && j.site === site.id && sameCell(positionOf(j), positionOf(t))));
  open.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  if (!open.length) return { ok: false, message: x == null ? 'Need 100 kJ of free capacity in a healthy battery bank.' : 'Select a healthy battery bank with 100 kJ free.' };
  let failure = { ok: false, message: 'Need a stored power cell and a crew route to the bank.' };
  for (const bank of open) {
    const result = order(s, site.id, bank.x, bank.y, 'chargeCell', null, bank.z);
    if (result.ok) return result;
    failure = result;
    if (x != null) break;
  }
  return failure;
}
export function serialize(s) { return JSON.stringify(s); }
function legacyMeatShadow(value){
  if(!value||typeof value!=='object')return false;
  if(['bristlemeat','glazemeat'].includes(value.kind)||['bristlecap_braise','sunberry_glaze_roast'].includes(value.recipeId)||['bristlecap_braise','sunberry_glaze_roast'].includes(value.batchRecipeId))return true;
  return Object.values(value).some(legacyMeatShadow);
}
export function deserialize(text) {
  if (text.length > 5_000_000) throw new Error('Save is too large.');
  const s = JSON.parse(text),legacySolarModel=s?.version<59;
  if (Number.isInteger(s?.version) && s.version >= 1 && s.version <= 39) throw new Error('Legacy square-grid saves (schemas 1–39) cannot be loaded into the hex colony. Export the original save and use the preserved square version to continue it.');
  if (![40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, VERSION].includes(s?.version) || s.grid !== GRID) throw new Error('Unsupported save topology: schemas 40–71 require grid hex-odd-q-v1.');
  if ( !Number.isSafeInteger(s.tick) || s.tick < 0 || !Number.isInteger(s.rng) || !Number.isSafeInteger(s.nextId)) throw new Error('Unsupported or invalid save.');
  if (!s.sites || !Array.isArray(s.crew) || s.crew.length !== 7 || !Array.isArray(s.jobs) || !Array.isArray(s.log) || !s.stats || !s.comet || !s.flags || !s.objectives) throw new Error('Incomplete save.');
  if(s.version<64&&s.resources){if((s.resources.tools||0)!==0)throw new Error('Legacy tools.');s.resources.tools=0;}
  for (const r of RESOURCES) if (!Number.isFinite(s.resources?.[r]) || s.resources[r] < 0) throw new Error('Invalid resources.');
  if(s.version<65&&Object.values(s.sites).some(site=>!['surface','comet'].includes(site.id)&&site.tiles?.some(t=>t.deposit?.resource==='ice')))throw new Error('Legacy ice reserve site.');
  if(s.version<68&&Object.hasOwn(s,'region')&&s.region?.schema!==1)throw new Error('Legacy planetary region schema.');
  if(s.version>=65)validateRegion(s);
  for (const id of Object.keys(siteDefinitions(s))) {
    const site = s.sites[id], size = id === 'surface' ? 26 : 18;
    if (site?.id !== id || site.size !== size || site.tiles?.length !== size ** 2 * (s.version>=55?site.levels?.length:1) || !Array.isArray(site.rooms) || !site.power) throw new Error('Invalid site.');
    site.tiles.forEach((t, i) => { if (t.x !== i % size || t.y !== Math.floor((i % (size*size)) / size) || !['ground', 'rock', 'ore', 'floor', 'deck', 'ice', 'void'].includes(t.terrain) || (t.building && !BUILDINGS[t.building] && !['shuttle', 'dock', 'salvage', 'volatile', 'collector'].includes(t.building)) || !Number.isFinite(t.hp)) throw new Error('Invalid tile.'); });
  }
  if(s.version<69&&(Object.values(s.sites).some(site=>site.tiles.some(t=>t.building==='fuelSynthesizer'))||s.jobs.some(j=>j.building==='fuelSynthesizer')))throw new Error('Legacy fuel synthesizer or job.');
  if(s.version<70&&s.jobs.some(j=>j.kind==='chargeCell'))throw new Error('Legacy power-cell installation job.');
  if(s.version<71)for(const site of Object.values(s.sites))for(const t of site.tiles){
    if(t.storage&&Object.hasOwn(t.storage,'limits'))throw new Error('Legacy depot delivery limits.');
    if(t.building==='stockpile'&&t.storage&&typeof t.storage==='object'&&!Array.isArray(t.storage))t.storage.limits={};
  }
  if(s.version<67)rejectLegacyEquipment(s);
  if(s.version<66)rejectLegacyMaterials(s);
  if(s.version<65)migrateRegion(s);
  validateUtilityState(s);
  validateDeckState(s, { legacy: s.version <= 46 });
  validateShipmentLocations(s, { legacy: s.version <= 47 });
  validateCrewLocations(s, { legacy: s.version <= 48 });
  validateAnimalLocations(s, { legacy: s.version <= 49 });
  validateAirlockLocations(s, { legacy: s.version <= 50 });
  validateRoomLocations(s, { legacy: s.version <= 51 });
  validateHazardLocations(s, { legacy: s.version <= 52 });
  validateDesignationLocations(s, { legacy: s.version <= 53 });
  if(s.version<64&&(Object.values(s.sites).some(site=>site.tiles.some(t=>t.building==='toolbench'))||s.jobs.some(j=>j.building==='toolbench')||s.crew.some(c=>c.intent?.type==='equipTool')||itemOwners(s).some(({inventory})=>(inventory.tools||0)>0||inventory._items?.some(i=>i.kind!==undefined))))throw new Error('Legacy tools or workshop.');
  if(s.version<63&&(Object.values(s.sites).some(site=>site.tiles.some(t=>t.deposit?.resource==='ore'))||s.jobs.some(j=>j.kind==='mine'&&(j.z??0)!==0)))throw new Error('Legacy impact ore or upper extraction job.');
  if(s.version<62&&(Object.values(s.sites).some(site=>site.tiles.some(t=>t.building==='planter'))||s.jobs.some(j=>j.building==='planter'||(j.z??0)!==0&&['plant','waterPlant','gather'].includes(j.kind))))throw new Error('Legacy planter or upper cultivation job.');
  if(s.version<61&&s.jobs.some(j=>(j.z??0)!==0&&(j.kind==='extinguish'||j.automaticMaintenance)))throw new Error('Legacy upper hazard response job.');
  if(s.version<=45&&(s.creatures?.some(a=>['death','body','carcass'].some(k=>Object.hasOwn(a,k)))||s.jobs.some(j=>dispatchJob(j)||carcassJob(j))))throw new Error('Legacy livestock death or body shadow.');
  if(s.version<=45&&legacyMeatShadow(s))throw new Error('Legacy meat or butchery recipe shadow.');
  if(s.version<=44&&Array.isArray(s.creatures)&&s.creatures.some(a=>Object.hasOwn(a,'genetics')||a.lifecycle?.brood&&Object.hasOwn(a.lifecycle.brood,'inheritance')))throw new Error('Legacy livestock genetics shadow.');
  if(s.version===40){initializeProduction(s);s.version=41;}
  if(s.version===41){initializeFlora(s);s.version=42;}
  if(s.version===42){initializeAnimalHealth(s);s.version=43;}
  if(s.version===43){
    if(s.jobs.some(j=>j.kind==='plant'||j.kind==='waterPlant'))throw new Error('Legacy cultivation order.');
    if(s.jobs.some(j=>Object.hasOwn(j,'plantGeneration')))throw new Error('Legacy plant generation shadow.');
    initializeCultivation(s,{legacy:true});
    for(const j of s.jobs)if(j.kind==='gather')j.plantGeneration='native';
    s.version=44;
  }
  if(s.version===44){initializeAnimalTraits(s,{legacy:true});s.version=45;}
  if(s.version===45){initializeAnimalDeaths(s,{legacy:true});s.version=46;}
  if(s.version===46){migrateDeckZero(s);s.version=47;}
  if(s.version===47){migrateShipmentLocations(s);s.version=48;}
  if(s.version===48){migrateCrewLocations(s);s.version=49;}
  if(s.version===49){migrateAnimalLocations(s);s.version=50;}
  if(s.version===50){migrateAirlockLocations(s);s.version=51;}
  if(s.version===51){migrateRoomLocations(s);s.version=52;}
  if(s.version===52){migrateHazardLocations(s);s.version=53;}
  if(s.version===53){migrateDesignationLocations(s);s.version=54;}
  if(s.version===54)s.version=55;
  if(s.version===55)s.version=56;
  if(s.version===56){for(const site of Object.values(s.sites))site.utilityLinks=[];s.version=VERSION;}
  if(s.version===57)s.version=VERSION;
  if(s.version===58)s.version=VERSION;
  if(s.version===59)s.version=VERSION;
  if(s.version===60)s.version=VERSION;
  if(s.version===61)s.version=VERSION;
  if(s.version===62)s.version=VERSION;
  if(s.version===63)s.version=VERSION;
  if(s.version===64)s.version=VERSION;
  if(s.version===65)s.version=VERSION;
  if(s.version===66)s.version=VERSION;
  if(s.version===67)s.version=VERSION;
  if(s.version===68)s.version=69;
  if(s.version===69)s.version=VERSION;
  if(s.version===70)s.version=VERSION;
  const ids = new Set();
  for (const c of s.crew) {
    if (ids.has(c.id) || typeof c.name !== 'string' || c.name.length > 80 || !(c.site==='transit'||Object.hasOwn(s.sites,c.site)) || ![c.health, c.oxygen, c.energy, c.hunger, c.skill].every(Number.isFinite) || !Number.isInteger(c.x) || !Number.isInteger(c.y) || (c.site !== 'transit' && !inside(s.sites[c.site], c.x, c.y))) throw new Error('Invalid crew.');
    ids.add(c.id);
  }
  if (s.mission && (!siteDefinition(s,s.mission.site)?.fuel || !['outbound', 'working', 'boarding', 'returning'].includes(s.mission.phase) || !Array.isArray(s.mission.crew) || !expeditionCrewCountAllowed(s,s.mission.site,s.mission.crew.length) || new Set(s.mission.crew).size !== s.mission.crew.length || !s.mission.crew.every(id => ids.has(id)) || !Number.isFinite(s.mission.remaining) || !s.mission.cargo)) throw new Error('Invalid expedition.');
  const amount = v => Number.isFinite(v) && v >= 0;
  const percent = v => amount(v) && v <= 100;
  const inventory = v => v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([r, n]) => r === '_food' || r === '_items' || (RESOURCES.includes(r) && amount(n))) && validFoodLots(v) && validItemLots(v);
  validateOutpostState(s);
  if (!Number.isSafeInteger(s.comet.arrives) || !Number.isSafeInteger(s.comet.leaves) || s.comet.leaves <= s.comet.arrives || !Object.values(s.stats).every(amount)) throw new Error('Invalid simulation counters.');
  for (const site of Object.values(s.sites)) {
    if (!Object.hasOwn(siteDefinitions(s),site.id) || !Object.values(site.power).every(amount) || !percent(site.air)) throw new Error('Invalid environment.');
    const gasValid = gas => gas && typeof gas === 'object' && !Array.isArray(gas) && Object.keys(gas).length === GASES.length && GASES.every(k => amount(gas[k]));
    const close = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-8;
    const atmosphere = site.atmosphere;
    if (!atmosphere || atmosphere.tick !== s.tick || !gasValid(atmosphere.vented) || !gasValid(atmosphere.injected) || !amount(atmosphere.breathed) || !amount(atmosphere.refilled)) throw new Error('Invalid atmosphere history.');
    for (const room of site.rooms) if (!Array.isArray(room.cells) || !percent(room.air) || typeof room.sealed !== 'boolean' || !room.cells.every(k => typeof k === 'string' && /^\d+,\d+$/.test(k) && inside(site, ...k.split(',').map(Number)))) throw new Error('Invalid room.');
    const occupied = new Set();
    for (const r of site.rooms) {
      if (!r.cells.length || r.volume !== r.cells.length || !gasValid(r.gas) || !Number.isFinite(gasAmount(r.gas))) throw new Error('Invalid room gas or volume.');
      for (const k of r.cells) { if (occupied.has(roomCellKey(r,k))) throw new Error('Overlapping room volumes.'); occupied.add(roomCellKey(r,k)); }
      const derived = { ...r }; refreshRoom(derived);
      if (!['pressure', 'oxygenFraction', 'co2Fraction', 'air'].every(k => close(r[k], derived[k]))) throw new Error('Room readings do not match stored gas.');
    }
    for (const t of site.tiles) if (t.building === 'door' && (!['auto', 'open', 'closed'].includes(t.doorMode) || !Number.isSafeInteger(t.doorUntil) || t.doorUntil < 0 || t.doorUntil > s.tick + 3)) throw new Error('Invalid pressure door.');
    const topology = { ...site, thermal: { ...site.thermal }, rooms: [], atmosphere: { ...atmosphere, vented: { ...atmosphere.vented } } }; updateRooms(topology);
    const signature = r => `${r.z}:`+[...r.cells].sort().join(';');
    const expected = new Map(topology.rooms.map(r => [signature(r), r]));
    if (expected.size !== site.rooms.length || site.rooms.some(r => { const match = expected.get(signature(r)); return !match || match.sealed !== r.sealed || !close(match.leakArea, r.leakArea); })) throw new Error('Compartment topology does not match the habitat.');
    const volume = site.rooms.reduce((n, r) => n + r.volume, 0);
    if (site.air !== (volume ? Math.round(site.rooms.reduce((n, r) => n + r.air * r.volume, 0) / volume) : 0)) throw new Error('Habitat air display does not match the rooms.');
    for (const t of site.tiles) if (!percent(t.hp) || !Number.isInteger(t.variant) || t.variant < 0 || t.variant > 3 || (t.drop !== null && !inventory(t.drop))) throw new Error('Invalid tile state.');
    for (const t of site.tiles) {
      if (t.building === 'stockpile' ? !inventory(t.stock) : t.stock !== undefined) throw new Error('Invalid depot inventory.');
      const recipe = recipeFor(t), selected=recipeFor(t,'selected'), m = t.machine;
      if (!RECIPES[t.building]) { if (m !== undefined) throw new Error('Inventory attached to a missing machine.'); continue; }
      if(!recipe||!selected)throw new Error('Invalid production recipe.');
      if (!m || !inventory(m.input) || !inventory(m.output) || !inventory(m.batch) || typeof m.enabled !== 'boolean' || typeof m.status !== 'string' || m.status.length > 120 || !Number.isFinite(m.progress) || m.progress < 0 || m.progress >= recipe.duration) throw new Error('Invalid machine state.');
      if (resourceEntries(m.input).some(([r, n]) => !selected.input[r] || n > selected.input[r] * 2) || resourceEntries(m.output).some(([r]) => !recipe.output[r]) || quantity(m.output) > OUTPUT_CAPACITY) throw new Error('Invalid machine buffers.');
      if (m.legacyCrop !== undefined && (m.legacyCrop !== true || t.building !== 'farm' || m.batch.water !== 1 || resourceEntries(m.batch).some(([r, n]) => r !== 'water' && n))) throw new Error('Invalid legacy crop.');
      const batchInput = m.legacyCrop ? { water: 1 } : recipe.input;
      if (quantity(m.batch) ? RESOURCES.some(r => (m.batch[r] || 0) !== (batchInput[r] || 0)) : m.progress !== 0) throw new Error('Invalid production batch.');
      if (quantity(m.batch)&&recipe.foodKinds&&Object.entries(recipe.foodKinds).some(([kind,n])=>Math.abs(foodOfKind(m.batch,kind)-n)>1e-8))throw new Error('Invalid production ingredients.');
      if(quantity(m.batch)&&t.building==='galley'&&Math.abs(rawFood(m.batch)-(m.batch.food||0))>1e-8)throw new Error('Prepared food cannot be a raw ingredient.');
      if ((recipe.lifeSupport || recipe.automatic) && quantity(m.batch)) throw new Error('Life support does not hold a production batch.');
    }
  }
  for (const c of s.crew) if (!/^crew-[0-6]$/.test(c.id) || ![c.health, c.oxygen, c.energy, c.hunger].every(percent) || c.skill <= 0 || c.skill > 10 || !/^#[0-9a-fA-F]{6}$/.test(c.color) || (c.carry && !inventory(c.carry))) throw new Error('Invalid crew state.');
  const claimedBeds = new Set();
  const orbitalDelivery = (d, c) => d?.kind === 'shuttle' && returnCrewIds(s).includes(c.id) && c.site === s.mission?.site && ['working', 'boarding'].includes(s.mission.phase) && validShipmentPosition(s.sites[c.site],d.target) && shipmentTile(s.sites[c.site],d.target).building === 'dock';
  const deliveryValid = (d,siteId) => d && ['stock', 'input', 'job'].includes(d.kind) && validShipmentPosition(s.sites[siteId],d.target) && (d.kind !== 'job' || (typeof d.job === 'string' && s.jobs.some(j => j.id === d.job && j.site === siteId && sameCell(j,d.target))));
  const validKinds=(kinds,total)=>kinds&&typeof kinds==='object'&&!Array.isArray(kinds)&&Object.keys(kinds).length>0&&Object.entries(kinds).every(([kind,n])=>Object.hasOwn(FOOD_KINDS,kind)&&Number.isFinite(n)&&n>0)&&Math.abs(Object.values(kinds).reduce((n,v)=>n+v,0)-total)<1e-8;
  const validDeliveryRecipe=(delivery,siteId)=>{
    if(delivery?.recipeId===undefined)return true;
    if(delivery.kind!=='input'||!validShipmentPosition(s.sites[siteId],delivery.target))return false;
    // A destination may have been dismantled since pickup; hauling recovers the physical cargo.
    return delivery.recipeId!=='legacy_crop'&&(Object.hasOwn(CROPS,delivery.recipeId)||Object.hasOwn(MEAL_RECIPES,delivery.recipeId)||Object.hasOwn(TOOL_RECIPES,delivery.recipeId));
  };
  for (const c of s.crew) {
    if(c.delivery&&!validDeliveryRecipe(c.delivery,c.site))throw new Error('Invalid shipment recipe.');
    if ((c.carry && (c.site==='transit' || quantity(c.carry) > CARRY_CAPACITY || (c.delivery != null && !deliveryValid(c.delivery,c.site) && !orbitalDelivery(c.delivery,c)))) || (!c.carry && c.delivery != null)) throw new Error('Invalid carried shipment.');
    if (!c.skills || !c.labors || !Object.keys(LABORS).every(id => typeof c.labors[id] === 'boolean' && Number.isInteger(c.skills[id]?.level) && c.skills[id].level >= 0 && c.skills[id].level <= 10 && amount(c.skills[id].xp) && c.skills[id].xp <= 170) || !percent(c.morale) || !Object.hasOwn(LABORS, c.favoriteLabor) || !['steady', 'cautious', 'driven', 'social'].includes(c.temperament)) throw new Error('Invalid crew capabilities.');
    if (!Array.isArray(c.memories) || c.memories.length > 8 || !c.memories.every(m => amount(m.tick) && m.tick <= s.tick && typeof m.kind === 'string' && typeof m.text === 'string' && m.text.length < 300 && Number.isFinite(m.mood) && Math.abs(m.mood) <= 100)) throw new Error('Invalid crew memories.');
    if (c.intent !== null) {
      const intent = c.intent;
      if (intent.type === 'salvage') {
        if (c.carry || c.job || !returnCrewIds(s).includes(c.id) || s.mission?.phase !== 'working' || c.site !== s.mission.site || !validShipmentPosition(s.sites[c.site],intent.target) || !inventory(intent.items) || quantity(intent.items) <= 0 || quantity(intent.items) > CARRY_CAPACITY) throw new Error('Invalid salvage pickup.');
        continue;
      }
      if (!intent || !['air', 'rest', 'meal', 'haul', 'leisure', 'medical', 'temperature', 'sanitation', 'equipTool'].includes(intent.type) || c.site === 'transit' || c.job || (intent.target !== null && !(intent.type === 'haul' ? validShipmentPosition(s.sites[c.site],intent.target) : validCrewPosition(s.sites[c.site],intent.target))) || (intent.type === 'haul' && !intent.target) || (intent.type === 'meal' && (!Number.isInteger(intent.servings) || intent.servings < 0 || intent.servings > 8))) throw new Error('Invalid crew intention.');
      if(intent.type==='haul'&&(!validDeliveryRecipe(intent.destination,c.site)||(intent.recipeId!==undefined&&intent.recipeId!==intent.destination?.recipeId)||(intent.foodKinds!==undefined&&!validKinds(intent.foodKinds,intent.items?.food||0))))throw new Error('Invalid food pickup claim.');
      if(intent.type==='haul'&&intent.foodKinds!==undefined){
        const recipe=Object.hasOwn(MEAL_RECIPES,intent.recipeId)?MEAL_RECIPES[intent.recipeId]:null;
        if(!recipe||intent.destination.kind!=='input'||intent.items.food>recipe.input.food*2+1e-8||recipe.foodKinds&&Object.entries(intent.foodKinds).some(([kind,n])=>!recipe.foodKinds[kind]||n>recipe.foodKinds[kind]*2+1e-8))throw new Error('Pickup ingredients do not match the claimed recipe.');
      }
      if (intent.type === 'rest' && intent.target) { const k = `${c.site}/${cellKey(intent.target)}`; if (claimedBeds.has(k)) throw new Error('Bunk reserved twice.'); claimedBeds.add(k); }
      if (intent.type === 'haul' && (c.carry || !['stock', 'drop', 'output', 'imports'].includes(intent.source) || !inventory(intent.items) || quantity(intent.items) <= 0 || quantity(intent.items) > CARRY_CAPACITY || !deliveryValid(intent.destination,c.site) || intent.destination.kind === 'job')) throw new Error('Invalid pickup reservation.');
    }
  }
  validateUtilityJobs(s);
  validateStairJobs(s);
  const jobs = new Set(); const reserved = new Map();
  if (s.jobs.length > 2000) throw new Error('Too many orders.');
  for (const j of s.jobs) {
    if (![1, 3, 5].includes(j.priority) || (j.blockedReason !== null && typeof j.blockedReason !== 'string')) throw new Error('Invalid job priority.');
    if (typeof j.id !== 'string' || !/^job-\d+$/.test(j.id) || jobs.has(j.id) || !s.sites[j.site] || !Number.isInteger(j.x) || !Number.isInteger(j.y) || !inside(s.sites[j.site], j.x, j.y) || !['build', 'mine', 'gather', 'plant', 'waterPlant', 'remove', 'repair', 'service', 'refit', 'loadShuttle', 'unloadShuttle', 'loadCargo', 'unloadCargo', 'repairWaterPipe', 'removeWaterPipe', 'repairPipe', 'removePipe', 'repairCable', 'removeCable', 'treat', 'feed', 'hygiene', 'operate', 'animalDispatch','animalButcher','animalDiscard','animalCare', 'animalHarvest', 'animalTreat', 'animalLead', 'extinguish', 'chargeCell'].includes(j.kind) || !inventory(j.cost) || !amount(j.remaining) || !amount(j.work) || j.work === 0 || j.remaining > j.work || (j.kind === 'build' && !BUILDINGS[j.building]) || (j.worker && !ids.has(j.worker))) throw new Error('Invalid work order.');
    const k = ['feed', 'hygiene'].includes(j.kind) ? `${j.kind}/${j.patient}` : `${['operate','extinguish'].includes(j.kind) ? j.kind+'/' : ''}${j.site}/${cellKey(positionOf(j))}`;
    const claims=reserved.get(k)||[],prior=claims[0];
    if(claims.length&&!(claims.length===1&&prior.animal===j.animal&&['animalCare','animalTreat'].includes(j.kind)&&['animalCare','animalTreat'].includes(prior.kind)&&prior.kind!==j.kind))throw new Error('Duplicate tile reservation.');
    reserved.set(k,[...claims,j]);jobs.add(j.id);
    if (j.worker && !s.crew.some(c=>c.id===j.worker&&c.job===j.id&&c.site===j.site)) throw new Error('Invalid worker reservation.');
    if (!inventory(j.materials) || !Array.isArray(j.sources) || !j.sources.every(source => validShipmentPosition(s.sites[j.site],{x:source.x,y:source.y,z:source.z}) && ['stock', 'drop', 'imports', 'freight'].includes(source.kind) && inventory(source.items))) throw new Error('Invalid material reservation.');
    const ingredients=j.kind==='animalCare'?livestockDef(s.creatures.find(c=>c.id===j.animal))?.feedKinds:j.kind==='plant'&&Object.hasOwn(FLORA,j.plantSpecies)&&FLORA[j.plantSpecies].foodKind?{[FLORA[j.plantSpecies].foodKind]:CULTIVATION.plantFood}:null;
    if(ingredients?(!validKinds(j.foodKinds,j.cost.food||0)||Object.keys(j.foodKinds).length!==Object.keys(ingredients).length||Object.entries(ingredients).some(([kind,n])=>j.foodKinds[kind]!==n)):j.foodKinds!==undefined)throw new Error('Invalid typed ingredient reservation.');
    if(ingredients){
      const parcels=[j.materials,...j.sources.map(source=>source.items),...s.crew.filter(c=>c.delivery?.kind==='job'&&c.delivery.job===j.id).map(c=>c.carry)];
      if(parcels.some(inv=>Math.abs(Object.keys(ingredients).reduce((n,kind)=>n+foodOfKind(inv,kind),0)-(inv?.food||0))>1e-8)||Object.entries(ingredients).some(([kind,n])=>parcels.reduce((total,inv)=>total+foodOfKind(inv,kind),0)>n+1e-8))throw new Error('Reserved food contains incompatible ingredients.');
    }
    if(j.kind==='chargeCell'&&(j.site!=='surface'||j.building!==null||Object.keys(j.cost).length!==1||j.cost.cells!==1||j.work!==CELL_INSTALL_WORK||j.missingFood!==0||j.foodSpoiled!==0))throw new Error('Invalid paid power-cell installation.');
    if(j.kind==='build'&&j.building==='stairwell'){const def=BUILDINGS.stairwell;if(j.work!==def.work||Object.keys(j.cost).length!==Object.keys(def.cost).length||Object.entries(def.cost).some(([r,n])=>j.cost[r]!==n))throw new Error('Invalid paid stairwell order.');}
    if(j.kind==='operate'&&j.worker){const c=s.crew.find(c=>c.id===j.worker),recipe=recipeFor(shipmentTile(s.sites[j.site],positionOf(j)));if((c.skills.production?.level||0)<(recipe?.minSkill||0))throw new Error('Production operator lacks recipe skill.');}
    if(j.kind==='gather'){
      if(!Object.hasOwn(FLORA,j.plantSpecies)||!FLORA[j.plantSpecies].foodKind||!Number.isSafeInteger(j.plantHarvests)||j.plantHarvests<0||j.building!==null||j.work!==FLORA[j.plantSpecies].work||Object.keys(j.cost).length||Object.keys(j.materials).length||j.sources.length||j.missingFood!==0||j.foodSpoiled!==0||!gatheringJobValid(s,j))throw new Error('Invalid gathering order.');
    }else if(j.kind==='plant'||j.kind==='waterPlant'){
      const resource=j.kind==='plant'?'food':'water',cost=j.kind==='plant'?CULTIVATION.plantFood:CULTIVATION.waterDose,work=j.kind==='plant'?CULTIVATION.plantWork:CULTIVATION.waterWork;
      if(j.building!==null||j.plantHarvests!==undefined||Object.keys(j.cost).length!==1||j.cost[resource]!==cost||j.work!==work||!cultivationJobValid(s,j)||(j.kind==='plant'?j.plantGeneration!==undefined:j.foodKinds!==undefined||j.missingFood!==0||j.foodSpoiled!==0))throw new Error('Invalid cultivation order.');
    }else if(j.plantSpecies!==undefined||j.plantHarvests!==undefined||j.plantGeneration!==undefined)throw new Error('Plant reservation on unrelated work.');
    const reservedItems = { ...j.materials }; j.sources.forEach(source => addCounts(reservedItems, source.items));
    for (const c of s.crew) if (c.delivery?.kind === 'job' && c.delivery.job === j.id) addCounts(reservedItems, c.carry);
    if (j.remaining < j.work && !materialsReady(j) && !(j.foodSpoiled > 0 && RESOURCES.filter(r => r !== 'food').every(r => (j.materials[r] || 0) >= (j.cost[r] || 0)))) throw new Error('Work performed without delivered materials.');
    if (RESOURCES.some(r => Math.abs((reservedItems[r] || 0) + (r === 'food' ? j.missingFood : 0) - (j.cost[r] || 0)) > 1e-8)) throw new Error('Material reservation does not match order.');
  }
  validateMaterials(s);
  for (const c of s.crew) if (c.job && (!jobs.has(c.job) || s.jobs.find(j => j.id === c.job)?.worker !== c.id)) throw new Error('Invalid job assignment.');
  if (s.mission) {
    if (!inventory(s.mission.cargo) || !amount(s.mission.remaining) || !percent(s.mission.heat)) throw new Error('Invalid expedition cargo.');
    const expected = ['working', 'boarding'].includes(s.mission.phase) ? s.mission.site : 'transit';
    if (!s.mission.crew.every(id => {const c=s.crew.find(c=>c.id===id);return c.health<=0 || c.site===expected || s.mission.phase==='returning'&&!returnCrewIds(s).includes(id)&&c.site===s.mission.site&&isResident(s,id,s.mission.site);})) throw new Error('Expedition crew are in the wrong location.');
  }
  for (const c of s.crew) {
    const resident=residentSite(s,c.id);
    if(resident&&c.health>0&&c.site!==resident)throw new Error('Outpost resident is in the wrong location.');
    if(c.site!=='surface'&&c.health>0&&!resident){
      const active=s.mission&&(s.mission.phase==='returning'?returnCrewIds(s):s.mission.crew).includes(c.id);
      if(!active)throw new Error('Crew are stranded outside an expedition.');
    }
  }
  if (!Array.isArray(s.creatures) || s.creatures.length > 100 || !s.creatures.every(c => c && typeof c.id === 'string' && (isLivestock(c)||c.species==='tibble') && c.site === 'surface' && Number.isInteger(c.x) && Number.isInteger(c.y) && inside(s.sites.surface, c.x, c.y) && percent(c.health) && percent(c.fed) && amount(c.age))) throw new Error('Invalid wildlife.');
  if (s.anomaly !== null && (typeof s.anomaly.title !== 'string' || typeof s.anomaly.description !== 'string' || typeof s.anomaly.resolved !== 'boolean')) throw new Error('Invalid signal.');
  if (s.log.length > 60 || !s.log.every(e => amount(e.tick) && typeof e.message === 'string' && e.message.length < 4000)) throw new Error('Invalid event log.');
  validateAnimalHealth(s); validateFlora(s); validateCultivation(s); validateAirlocks(s); validateFreightState(s); validateBreakers(s); validatePlumbing(s); validateGasNetworks(s); validateLiquids(s); validateReactors(s); validateFire(s); validateTransport(s); validateHusbandry(s); validateBreeding(s); validateAnimalTraits(s); validateCarcasses(s); validatePastures(s); validateWater(s); validateHousing(s); validateComfort(s); validatePossessions(s);validateToolPickups(s); validateDesignations(s); validateHygiene(s); validateSanitation(s); validateFood(s); validateThermal(s); validateStorage(s); validateProduction(s); validateMedicine(s); validateNursing(s); validateCrewLife(s); validateShuttle(s); validatePreflight(s);
  validateReliability(s);
  for (const site of Object.values(s.sites)){if(legacySolarModel){validatePower({...s,version:58},site);refreshPower(s,site,false);}validatePower(s,site);}
  const recorded = s.resources; syncResources(s);
  if (RESOURCES.some(r => Math.abs(recorded[r] - s.resources[r]) > 1e-9)) throw new Error('Depot totals do not match stored materials.');
  return s;
}

export function setUtilityRiser(s,siteId,connection,enabled){
 const result=configureUtility(s,siteId,connection,enabled);if(result.ok)refreshPower(s,s.sites[siteId]);return result;
}
