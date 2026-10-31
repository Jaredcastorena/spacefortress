import {roomKelvin,roomStructureCapacity} from '../../src/gas-thermal.js';
import {isDeepStrictEqual} from 'node:util';
import {createGame} from '../../src/simulation.js';
import {validateRegion} from '../../src/region.js';
import {validateMaterials} from '../../src/materials.js';

// Synthetic historical fixtures retain structural heat while omitting gas
// energy that those formats could not represent. Adjust only their baseline;
// all recorded transfers and physical gas quantities remain explicit.
export function projectPreGasHeat(state){
  const projected=structuredClone(state);
  for(const site of Object.values(projected.sites)){
    let omitted=0;
    for(const room of site.rooms){if(room.gasThermal===true){const structural=roomStructureCapacity(room)*roomKelvin(room);omitted+=room.heat-structural;room.heat=structural;delete room.gasThermal;}}
    for(const tile of site.tiles)for(const node of [tile.pipe,tile.gasStore])if(node&&Object.hasOwn(node,'heat')){omitted+=node.heat;delete node.heat;}
    if(Object.hasOwn(site.thermal,'gasInitial')){
      const correction=site.thermal.gasInitial+site.thermal.gasLoaded-site.thermal.gasVented-omitted;
      if(Math.abs(correction)>Number.EPSILON*Math.max(1,Math.abs(site.thermal.initial))*4)site.thermal.initial+=correction;
      delete site.thermal.gasInitial;delete site.thermal.gasLoaded;delete site.thermal.gasVented;
    }
  }
  return projected;
}

// Only the new empty policy is neutral. Configured caps cannot be represented
// by historical saves, so never hide them while comparing physical state.
export function projectPreDepotLimits(state) {
  const projected = projectPreGasHeat(state);
  for (const site of Object.values(projected.sites)) for (const t of site.tiles) {
    if (!t.storage || !Object.hasOwn(t.storage, 'limits')) continue;
    const limits = t.storage.limits;
    if (!limits || typeof limits !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(limits)) || Object.keys(limits).length) throw new Error('Cannot project configured depot limits into an older schema.');
    delete t.storage.limits;
  }
  return projected;
}

// Only implicit-default alloy records are neutral in historical projections.
// Composite choices and their different paid costs must never disappear.
export function projectPreStructuralMaterials(state) {
  const projected=projectPreDepotLimits(state);
  validateMaterials(projected);
  for(const site of Object.values(projected.sites))for(const t of site.tiles)if(t.materials){
    if(Object.values(t.materials).some(id=>id!=='alloy'))throw new Error('Cannot project composite construction into an older schema.');
    delete t.materials;
  }
  for(const job of projected.jobs)if(Object.hasOwn(job,'material')){
    if(job.material!=='alloy')throw new Error('Cannot project paid composite work into an older schema.');
    delete job.material;
  }
  return projected;
}

// Region metadata is neutral for migrated four-site saves. Synthetic old-save
// fixtures may explicitly exclude only untouched, unvisited generated sites;
// never discard depleted sites, resident ownership or in-flight activity.
export function projectPreRegion(state, {allowUnvisited = false} = {}) {
  const projected = projectPreStructuralMaterials(state);
  if (!Object.hasOwn(projected, 'region')) return projected;
  validateRegion(projected);
  if (!projected.region.legacy) {
    if (!allowUnvisited) throw new Error('Cannot project a generated region into an older schema.');
    const initial = projectPreDepotLimits(createGame(projected.seed,{regionSchema:projected.region.schema}));
    for (const def of Object.values(projected.region.sites).filter(d => d.template)) {
      const id = def.id;
      if (!isDeepStrictEqual(projected.sites[id], initial.sites[id]) ||
          !isDeepStrictEqual(projected.outposts[id], initial.outposts[id]) ||
          [...projected.crew, ...projected.jobs, ...projected.creatures].some(e => e.site === id) ||
          projected.mission?.site === id || projected.departure?.site === id) {
        throw new Error('Cannot project an occupied or changed generated site.');
      }
      delete projected.sites[id]; delete projected.outposts[id];
    }
  }
  delete projected.region;
  for (const site of Object.values(projected.sites)) delete site.kind;
  return projected;
}

// Historical square helpers remain for inspecting genuine old states. Never
// strip the topology marker or relabel a hex state as a legacy fixture.
export function projectPreAirlock(state, version = state.version) {
  if (state.grid === 'hex-odd-q-v1' && version < 40) throw new Error('Cannot project a hex colony into a legacy square save.');
  const projected = structuredClone(state);
  projected.version = version;
  if(version>=39)return projected;
  for (const crew of projected.crew) delete crew.airlockTraversal;
  for (const site of Object.values(projected.sites)) for (const tile of site.tiles) {
    delete tile.airlock; delete tile.airlockOwner;
    if (tile.pipe) delete tile.pipe.airlockOwner;
  }
  return projected;
}
// Remove only the ownership fields introduced by schema 37. Genuine fixture
// bytes stay untouched; their pre-existing state must still compare exactly.
export function projectPreOutpost(state, version = 36) {
  const projected = projectPreAirlock(state, version);
  projected.version = version;
  delete projected.outposts;
  if (projected.shuttle) delete projected.shuttle.freight;
  if (projected.mission) delete projected.mission.returnCrew;
  for (const site of Object.values(projected.sites)) {
    for (const tile of site.tiles) delete tile.imports;
  }
  return projected;
}

// Schema53 adds deck ownership to forecast and damage-history coordinates.
export function projectPreDesignationLocations(state) {
  const projected=projectPreRegion(state, {allowUnvisited:true});
  // A neutral schema64 summary field has no counterpart in historical bytes.
  if((projected.resources.tools||0)!==0)throw new Error('Cannot project physical tools into an older schema.');
  delete projected.resources.tools;
  // Schema57 adds only an empty utility registry to older colonies.
  for(const site of Object.values(projected.sites)){
    if(site.utilityLinks?.length||site.tiles.some(t=>t.risers))throw new Error('Cannot project installed utility risers into an older schema.');
    delete site.utilityLinks;
  }
  for(const site of Object.values(projected.sites))for(const d of site.designations)delete d.z;
  return projected;
}

export function projectPreHazardLocations(state) {
  const projected=projectPreDesignationLocations(state);
  if(projected.debris?.target)delete projected.debris.target.z;
  for(const site of Object.values(projected.sites))for(const incident of site.incidents)delete incident.z;
  return projected;
}

// Room-local cells retain their old bytes; schema52 only adds room deck ownership.
export function projectPreRoomDecks(state) {
  const projected=projectPreHazardLocations(state);
  for(const site of Object.values(projected.sites))for(const room of site.rooms)delete room.z;
  return projected;
}

// Project named schema51 airlock locations only, retaining every other byte's value.
export function projectPreAirlockLocations(state) {
  const projected=projectPreRoomDecks(state);
  const pair=p=>p&&!Array.isArray(p)?[p.x,p.y]:p;
  for(const site of Object.values(projected.sites))for(const t of site.tiles) {
    const a=t.airlock;if(!a)continue;
    for(const key of Object.keys(a.config))a.config[key]=pair(a.config[key]);
    a.chamberCells=a.chamberCells.map(k=>k.split(',').slice(0,2).join(','));
    for(const ref of a.ownedNodes)delete ref.z;
    for(const entry of [...a.queue,...(a.party?[a.party]:[])])if(entry.destination!=null)entry.destination=pair(entry.destination);
  }
  for(const c of projected.crew)if(c.airlockTraversal?.destination!=null)c.airlockTraversal.destination=pair(c.airlockTraversal.destination);
  return projected;
}

// Project only schema50's animal post and tile-carcass locations. ID-only
// crew/job owners and unrelated animal fields retain their original shapes.
export function projectPreAnimalLocations(state) {
  const projected = projectPreAirlockLocations(state);
  for (const animal of projected.creatures) {
    const post = animal.husbandry?.post;
    if (post && typeof post === 'object' && !Array.isArray(post)) animal.husbandry.post = [post.x, post.y];
    if (animal.death?.owner?.kind === 'tile') delete animal.death.owner.z;
  }
  return projected;
}

// Project schema49's named crew locations after later animal fields.
// Room/airlock references and inventory owners retain their original shapes.
export function projectPreCrewLocations(state) {
  const projected = projectPreAnimalLocations(state);
  const pair = target => target && typeof target === 'object' && !Array.isArray(target) ? [target.x, target.y] : target;
  const intentTypes = new Set(['air', 'rest', 'meal', 'leisure', 'medical', 'temperature', 'sanitation']);
  for (const crew of projected.crew) {
    if (crew.medical?.bed != null) crew.medical.bed = pair(crew.medical.bed);
    if (crew.housing?.bunk != null) crew.housing.bunk = pair(crew.housing.bunk);
    if (intentTypes.has(crew.intent?.type) && crew.intent.target != null) crew.intent.target = pair(crew.intent.target);
    if (crew.intent?.keepsake?.target != null) crew.intent.keepsake.target = pair(crew.intent.keepsake.target);
  }
  return projected;
}

// Project schema48's named shipment locations after later crew and animal fields.
export function projectPreShipments(state) {
  const projected = projectPreCrewLocations(state);
  const pair = target => target && !Array.isArray(target) ? [target.x, target.y] : target;
  for (const job of projected.jobs) for (const source of job.sources) delete source.z;
  for (const crew of projected.crew) {
    if (crew.delivery) crew.delivery.target = pair(crew.delivery.target);
    if (crew.intent?.type === 'haul' || crew.intent?.type === 'salvage') {
      crew.intent.target = pair(crew.intent.target);
      if (crew.intent.type === 'haul' && crew.intent.destination) {
        crew.intent.destination.target = pair(crew.intent.destination.target);
      }
    }
  }
  return projected;
}

// Explicit projection for synthetic pre47 hex fixtures. Genuine archived saves
// stay unchanged; later animal, crew and shipment fields are projected before primary decks.
export function projectPreDecks(state) {
  const projected = projectPreShipments(state);
  for (const site of Object.values(projected.sites)) {
    delete site.levels; delete site.verticalLinks;
    for (const tile of site.tiles) delete tile.z;
  }
  for (const entity of [...projected.crew, ...projected.jobs, ...projected.creatures]) delete entity.z;
  return projected;
}
