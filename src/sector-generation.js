import { surfaceLayout, wildlifeFor } from './world-generation.js';
import { sectorWorld, sectorDefinition } from './sector-sites.js';
import { initializeAtmosphere } from './atmosphere.js';
import { initializeStorage } from './inventory.js';
import { initializePower } from './power.js';
import { initializeMaintenance } from './maintenance.js';
import { initializeThermal } from './thermal.js';
import { initializeDesignations } from './rooms.js';
import { initializeWater } from './water.js';
import { initializeFlora, initializeCultivation } from './flora.js';
import { initializeFire } from './fire.js';
import { initializeReactors } from './reactors.js';
import { initializeLiquids } from './liquids.js';
import { seedNaturalLiquids } from './environment.js';
import { initializeGasNetworks } from './gas-networks.js';
import { initializePlumbing } from './plumbing.js';
import { initializeHusbandry } from './husbandry.js';
import { initializeBreeding } from './breeding.js';
import { initializeAnimalHealth } from './animal-health.js';
import { initializeAnimalTraits } from './animal-traits.js';
import { initializeAnimalDeaths } from './animal-carcasses.js';

/** Construct a detached natural destination. Registry admission and the paid
 * arrival dock remain the caller's responsibility; existing sites are never
 * regenerated here. No initializer receives the live colony or its objects. */
export function createSectorSite(s, definition) {
  if (!s || !Number.isSafeInteger(s.seed) || !Number.isSafeInteger(s.tick) || s.tick < 0 || !s.sites || !Array.isArray(s.creatures) || !definition) throw new Error('Invalid sector construction state.');
  const canonical=sectorDefinition(s,{planetId:definition.planetId,x:definition.sector?.x,y:definition.sector?.y});
  if (!canonical || definition.id!==canonical.id || definition.kind!=='surface' || definition.template!=='sector' || definition.size!==48 || ['x','y','z'].some(key=>definition.landing?.[key]!==canonical.landing[key])) throw new Error('Invalid sector site definition.');
  if (Object.hasOwn(s.sites,canonical.id)) throw new Error('An existing sector must not be regenerated.');
  const world=sectorWorld(s,canonical.planetId),tiles=surfaceLayout(world,canonical.sector,canonical.size);
  const site={id:canonical.id,kind:'surface',size:canonical.size,levels:[{z:0,name:'Landing deck'}],verticalLinks:[],utilityLinks:[],air:0,
    power:{output:0,demand:0,battery:0,capacity:0},rooms:[],explored:false,incidents:[],tiles};
  const creatures=wildlifeFor(world,canonical.sector,tiles).map(animal=>({...animal,id:`${site.id}-${animal.id}`,site:site.id}));
  const existingIds=new Set(s.creatures.map(animal=>animal.id));
  if(creatures.some(animal=>existingIds.has(animal.id)))throw new Error('Native sector wildlife identity is already in use.');
  const detached={version:s.version,seed:s.seed,tick:s.tick,sites:{[site.id]:site},creatures,crew:[],jobs:[],log:[]};

  // There are no built floors or fittings, so rooms, inventories, gas and
  // charge start empty. Atmosphere time must match the live tick immediately.
  initializeAtmosphere(site);site.atmosphere.tick=s.tick;
  for(const tile of tiles){initializeStorage(tile);initializeMaintenance(tile);}
  initializePower(detached,site,0);initializeFlora(detached);initializeThermal(detached);initializeDesignations(detached);
  initializeWater(detached);initializeFire(detached);initializeReactors(detached);
  initializeLiquids(detached);initializeCultivation(detached);initializeGasNetworks(detached);initializePlumbing(detached);
  seedNaturalLiquids(site);
  initializeHusbandry(detached);initializeBreeding(detached);initializeAnimalHealth(detached);
  initializeAnimalTraits(detached);initializeAnimalDeaths(detached);
  return {site,creatures};
}
