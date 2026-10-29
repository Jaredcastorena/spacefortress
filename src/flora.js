import { siteKind } from './region.js';
import { positionOf, tileAt } from './spatial.js';
import { solarExposure } from './solar.js';
import { FLORA, CULTIVATION } from './flora-data.js';
import { distance } from './geometry.js';
import { temperatureAt } from './thermal.js';
import { typedFood, foodOfKind, validFoodLots } from './food-lots.js';
import { spill } from './inventory.js';
import { emitEvent, tileEntityId } from './telemetry.js';

const registered = species => Object.hasOwn(FLORA,species);
const cultivatedSpecies = ['fungalcap','sunberry'];
const ledgerFields = ['propagules','planted','grown','harvested','destroyed','harvests','foodProduced','delivered','absorbed','growthUsed','returned'];
const epsilon = 1e-9;
const record = value => !!value&&typeof value==='object'&&!Array.isArray(value);
const exactKeys = (value,keys) => record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const close = (a,b) => Math.abs(a-b)<=1e-6+Math.max(Math.abs(a),Math.abs(b))*1e-9;
const blankLedger = () => Object.fromEntries(ledgerFields.map(field=>[field,0]));
export const floraId = (siteId,x,y,species,z=0) => `flora:${siteId}:${x}:${y}:${species}${z===0?'':`:${z}`}`;
export const floraBiomass = (tile,species='lichen') => tile?.flora?.[species]?.biomass ?? 0;
export const floraStage = biomass => biomass===0?'bare':biomass<25?'sparse':biomass<70?'growing':biomass<100?'budding':'mature';
const patchId = (site,tile,species) => floraId(site.id,tile.x,tile.y,species,positionOf(tile).z);
const patchEntries = tile => Object.entries(tile.flora || {});
function unsuitable(tile,species,cultivated=tile.flora?.[species]?.origin==='cultivated'){
  const planter=cultivated&&cultivatedSpecies.includes(species)&&tile.terrain==='floor'&&tile.building==='planter';
  if(planter&&tile.hp<=0)return {code:'planter_damaged',message:'The planter bed is destroyed.'};
  if(!planter&&tile.terrain!=='ground')return {code:'terrain',message:'Choose ground or a planter on a habitat floor.'};
  if(tile.fire)return {code:'fire',message:'Fire prevents growth and gathering.'};
  if(tile.building&&!planter&&!['fence','pastureGate',...(species==='lichen'?['husbandryPost']:[])].includes(tile.building))return {code:'building',message:'This structure covers the plant.'};
  return null;
}
function growthBlock(s,site,tile,species){
  const blocked=unsuitable(tile,species);if(blocked)return blocked;
  const def=FLORA[species],temp=temperatureAt(site,tile.x,tile.y,tile.z),[low,high]=def.temperature;
  if(temp<low||temp>high)return {code:'temperature',message:`Dormant at ${temp.toFixed(1)}°C; grows from ${low} to ${high}°C.`};
  if(def.daylight&&(siteKind(site)!=='surface'||s.tick%300>=220))return {code:'darkness',message:'Dormant until daylight.'};
  if(def.daylight&&!solarExposure(site,tile).exposed)return {code:'shade',message:'Dormant beneath an overhead floor or structure.'};
  if(tile.flora?.[species]?.origin==='cultivated'&&tile.flora[species].moisture<=epsilon&&tile.flora[species].biomass<100)return {code:'dry',message:'Dry bed; deliver water to resume growth.'};
  return null;
}
function stageChanged(s,site,tile,species,before,reason,actor=null,job=null){
  const after=floraBiomass(tile,species),previous=floraStage(before),stage=floraStage(after);
  if(previous!==stage)emitEvent(s,'flora.stage.changed',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),species,generation:tile.flora[species].generation,previous,stage,biomassBefore:before,biomassAfter:after,reason,...(actor?{actor}:{}),...(job?{job}:{})});
}
// Coordinate hashing is independent of the simulation RNG. Distance ranks spread
// three patches of each edible species near, midway and far from the habitat.
const coordinateHash = (seed,x,y) => Math.imul((seed|0)^Math.imul(x+1,73856093)^Math.imul(y+1,19349663),83492791)>>>0;
export function initializeFlora(s,{seedEdibles=false}={}){
  for(const site of Object.values(s.sites))for(const tile of site.tiles)if(Object.hasOwn(tile,'lichen')){
    if(!Number.isFinite(tile.lichen)||tile.lichen<0||tile.lichen>100||tile.flora?.lichen)throw new Error('Invalid legacy lichen.');
    tile.flora??={};tile.flora.lichen={biomass:tile.lichen,harvests:0};delete tile.lichen;
  }
  if(!seedEdibles)return;
  const site=s.sites.surface;if(!site)return;
  const habitat=site.tiles.filter(t=>t.terrain==='floor');
  const center=habitat.length?[Math.round(habitat.reduce((n,t)=>n+t.x,0)/habitat.length),Math.round(habitat.reduce((n,t)=>n+t.y,0)/habitat.length)]:[Math.floor(site.size/2),Math.floor(site.size/2)];
  for(const species of ['fungalcap','sunberry']){
    const existing=site.tiles.filter(t=>t.flora?.[species]).length;
    for(let i=existing;i<3;i++){
      const candidates=site.tiles.filter(t=>t.terrain==='ground'&&!t.building&&!t.fire&&!t.deposit&&!patchEntries(t).some(([id])=>FLORA[id]?.foodKind));
      candidates.sort((a,b)=>distance([a.x,a.y],center)-distance([b.x,b.y],center)||coordinateHash(s.seed,a.x,a.y)-coordinateHash(s.seed,b.x,b.y)||a.y-b.y||a.x-b.x);
      if(!candidates.length)break;
      const tile=candidates[Math.floor((candidates.length-1)*[.1,.5,.9][i])];
      tile.flora??={};tile.flora[species]={biomass:[100,45,10][i],harvests:0};
    }
  }
}
// initializeFlora deliberately retains its old two-key shape for 41→42 saves.
// Validate the complete old state before adding any cultivation metadata.
export function initializeCultivation(s,{legacy=false}={}){
  for(const site of Object.values(s.sites)){
    if(legacy&&site.cultivation!==undefined)throw new Error('Legacy cultivation shadow.');
    for(const tile of site.tiles){
      if(Object.hasOwn(tile,'lichen'))throw new Error('Legacy lichen is not canonical flora.');
      if(tile.flora===undefined)continue;
      if(!record(tile.flora))throw new Error('Invalid flora map.');
      let edible=0;
      for(const [species,patch] of patchEntries(tile)){
        const old=exactKeys(patch,['biomass','harvests']);
        if(legacy&&!old||!old&&!validPatch(species,patch)||old&&!validBiomass(species,patch))throw new Error('Invalid legacy flora patch.');
        if(FLORA[species]?.foodKind)edible++;
      }
      if(edible>1)throw new Error('Edible flora patches overlap.');
    }
    if(legacy&&site.liquids&&Object.hasOwn(site.liquids,'absorbed'))throw new Error('Legacy liquid absorption shadow.');
  }
  for(const site of Object.values(s.sites)){
    site.cultivation??=Object.fromEntries(cultivatedSpecies.map(species=>[species,blankLedger()]));
    if(site.liquids)site.liquids.absorbed??=0;
    for(const tile of site.tiles)for(const [,patch] of patchEntries(tile))if(exactKeys(patch,['biomass','harvests'])){patch.origin='native';patch.generation='native';}
  }
  validateCultivation(s);
}
export function updateFlora(s){
  for(const site of Object.values(s.sites))for(const tile of site.tiles)for(const [species,patch] of patchEntries(tile)){
    const blocked=unsuitable(tile,species);
    if(blocked){
      if(patch.origin==='cultivated'){const ledger=site.cultivation[species];ledger.destroyed+=patch.biomass;ledger.returned+=patch.moisture;spill(tile,{water:patch.moisture});}
      delete tile.flora[species];if(!Object.keys(tile.flora).length)delete tile.flora;
      emitEvent(s,'flora.removed',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),species,generation:patch.generation,origin:patch.origin,biomass:patch.biomass,harvests:patch.harvests,waterReturned:patch.moisture??0,...(patch.origin==='cultivated'?{from:{entity:patchId(site,tile,species),slot:'moisture'},to:{entity:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),slot:'drop'}}:{}),reason:blocked.code});continue;
    }
    const def=FLORA[species];if(s.tick%def.growthEvery!==0||patch.biomass===100||growthBlock(s,site,tile,species))continue;
    const before=patch.biomass;
    if(patch.origin==='cultivated'){
      const requested=Math.min(CULTIVATION.growthAmount,100-before),needed=requested*def.waterPerBiomass;
      const grown=Math.abs(patch.moisture-needed)<1e-12?requested:Math.min(requested,patch.moisture/def.waterPerBiomass),used=grown*def.waterPerBiomass;
      patch.biomass=Math.min(100,before+grown);patch.moisture=Math.max(0,patch.moisture-used);
      const ledger=site.cultivation[species];ledger.grown+=grown;ledger.growthUsed+=used;
      emitEvent(s,'flora.water.consumed',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),species,generation:patch.generation,amount:used,biomassGrown:grown,biomassBefore:before,biomassAfter:patch.biomass,from:{entity:patchId(site,tile,species),slot:'moisture'},to:'biological_growth'});
    }else patch.biomass=Math.min(100,before+def.growthAmount);
    stageChanged(s,site,tile,species,before,patch.origin==='cultivated'?'cultivated_growth':'natural_growth');
  }
}
export function consumeLichen(s,site,tile,requested,actor){
  if(!Number.isFinite(requested)||requested<=0||unsuitable(tile,'lichen'))return 0;
  const patch=tile.flora?.lichen;if(!patch)return 0;
  const before=patch.biomass,eaten=Math.min(before,requested);patch.biomass=before-eaten;
  if(eaten)stageChanged(s,site,tile,'lichen',before,'grazing',actor);return eaten;
}
export function gatheringEligibility(s,site,tile,species){
  const def=registered(species)?FLORA[species]:null,patch=tile?.flora?.[species];
  const base={work:def?.work??0,foodKind:def?.foodKind??null,yield:def?.yield??0,harvests:patch?.harvests??null,generation:patch?.generation??null};
  if(!def||!patch)return {ok:false,code:'missing_plant',message:'Choose a living wild food patch.',...base};
  if(!def.foodKind)return {ok:false,code:'not_edible',message:'Lichen is forage for bristlebacks and cannot be gathered.',...base};
  const blocked=unsuitable(tile,species);if(blocked)return {ok:false,code:blocked.code,message:blocked.message,...base};
  if(patch.harvests===Number.MAX_SAFE_INTEGER)return {ok:false,code:'cycle_limit',message:'This patch has reached its harvest cycle limit.',...base};
  if(patch.origin==='cultivated'&&site.cultivation?.[species]?.harvests===Number.MAX_SAFE_INTEGER)return {ok:false,code:'cycle_limit',message:'Cultivation has reached its harvest cycle limit.',...base};
  if(patch.biomass<100)return {ok:false,code:'immature',message:'Wait for the patch to mature.',...base};
  return {ok:true,code:'ready',message:'Ready to gather.',...base};
}
export function floraStatus(s,site,tile){
  return patchEntries(tile).map(([species,patch])=>{
    const def=FLORA[species],blocked=growthBlock(s,site,tile,species);
    return {id:patchId(site,tile,species),species,name:patch.origin==='cultivated'?`Cultivated ${species==='fungalcap'?'fungalcap':'sunberry'}`:def.name,description:def.description,...patch,stage:floraStage(patch.biomass),growthAllowed:!blocked,growthReason:blocked?.message??null,harvestable:gatheringEligibility(s,site,tile,species).ok,foodKind:def.foodKind,yield:def.yield,work:def.work};
  });
}
export function gatheringJobValid(s,j){
  if(j.kind!=='gather'||j.building!==null||!Number.isSafeInteger(j.plantHarvests)||j.plantHarvests<0)return false;
  const site=s.sites[j.site];if(!site||!Number.isInteger(j.x)||!Number.isInteger(j.y)||j.x<0||j.y<0||j.x>=site.size||j.y>=site.size)return false;
  const tile=tileAt(site,positionOf(j)),eligible=gatheringEligibility(s,site,tile,j.plantSpecies);
  return eligible.ok&&eligible.harvests===j.plantHarvests&&eligible.generation===j.plantGeneration&&eligible.work===j.work;
}
export function completeGathering(s,c,j){
  if(!gatheringJobValid(s,j))return {ok:false,message:'The designated plant is no longer ready to gather.'};
  const site=s.sites[j.site],tile=tileAt(site,positionOf(j)),species=j.plantSpecies,patch=tile.flora[species],def=FLORA[species];
  const before=patch.biomass,harvestsBefore=patch.harvests;
  spill(tile,typedFood(def.foodKind,def.yield));patch.biomass=def.harvestRemainder;patch.harvests++;
  if(patch.origin==='cultivated'){const ledger=site.cultivation[species];ledger.harvested+=before-patch.biomass;ledger.harvests++;ledger.foodProduced+=def.yield;}
  stageChanged(s,site,tile,species,before,'harvest',c.id,j.id);
  emitEvent(s,'flora.harvested',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),species,generation:patch.generation,origin:patch.origin,actor:c.id,job:j.id,foodKind:def.foodKind,output:{food:def.yield},biomassBefore:before,biomassAfter:patch.biomass,harvestsBefore,harvestsAfter:patch.harvests});
  return {ok:true};
}
export function plantingEligibility(s,site,tile,species){
  const base={cost:{food:CULTIVATION.plantFood},work:CULTIVATION.plantWork,foodKind:FLORA[species]?.foodKind??null,generation:null};
  if(!cultivatedSpecies.includes(species))return {ok:false,code:'species',message:'Choose fungalcap or sunberry propagation material.',...base};
  if(!tile)return {ok:false,code:'terrain',message:'Choose ground or a planter for the bed.',...base};
  const blocked=unsuitable(tile,species,true);if(blocked)return {ok:false,...blocked,...base};
  if(patchEntries(tile).some(([id])=>FLORA[id]?.foodKind))return {ok:false,code:'occupied',message:'An edible patch already occupies this bed.',...base};
  if(site.cultivation?.[species]?.propagules===Number.MAX_SAFE_INTEGER)return {ok:false,code:'cycle_limit',message:'Cultivation has reached its planting limit.',...base};
  return {ok:true,code:'ready',message:'Deliver one matching raw food portion and plant a bed.',...base};
}
function wateringTarget(s,site,tile,species){
  const patch=tile?.flora?.[species],base={cost:{water:CULTIVATION.waterDose},work:CULTIVATION.waterWork,foodKind:null,generation:patch?.generation??null};
  if(!cultivatedSpecies.includes(species)||patch?.origin!=='cultivated')return {ok:false,code:'missing_bed',message:'Choose a cultivated edible bed.',...base};
  const blocked=unsuitable(tile,species);if(blocked)return {ok:false,...blocked,...base};
  return {ok:true,code:'ready',message:'Deliver water to this bed.',...base};
}
export function wateringEligibility(s,site,tile,species){
  const result=wateringTarget(s,site,tile,species);
  if(result.ok&&CULTIVATION.moistureCapacity-tile.flora[species].moisture<=epsilon)return {...result,ok:false,code:'full',message:'This bed already holds its water capacity.'};
  return result;
}
function cultivationTarget(s,j){
  if(!j||j.building!==null||!['plant','waterPlant'].includes(j.kind))return null;
  const site=s.sites[j.site];if(!site||!Number.isInteger(j.x)||!Number.isInteger(j.y)||j.x<0||j.y<0||j.x>=site.size||j.y>=site.size)return null;
  return {site,tile:tileAt(site,positionOf(j))};
}
export function cultivationJobValid(s,j){
  const target=cultivationTarget(s,j);if(!target||Object.hasOwn(j,'plantHarvests'))return false;
  const {site,tile}=target;
  if(j.kind==='plant'){
    const result=plantingEligibility(s,site,tile,j.plantSpecies);
    return result.ok&&!Object.hasOwn(j,'plantGeneration')&&exactKeys(j.cost,['food'])&&j.cost.food===CULTIVATION.plantFood&&j.work===CULTIVATION.plantWork&&exactKeys(j.foodKinds,[j.plantSpecies])&&j.foodKinds[j.plantSpecies]===CULTIVATION.plantFood;
  }
  const result=wateringTarget(s,site,tile,j.plantSpecies);
  return result.ok&&result.generation===j.plantGeneration&&!Object.hasOwn(j,'foodKinds')&&exactKeys(j.cost,['water'])&&j.cost.water===CULTIVATION.waterDose&&j.work===CULTIVATION.waterWork;
}
export function completePlanting(s,c,j){
  if(!cultivationJobValid(s,j))return {ok:false,code:'invalid_target',message:'This bed is no longer available for planting.'};
  if(!record(j.materials)||Object.keys(j.materials).some(key=>!['food','_food'].includes(key))||!validFoodLots(j.materials)||j.materials.food!==CULTIVATION.plantFood||foodOfKind(j.materials,j.plantSpecies)<CULTIVATION.plantFood-epsilon)return {ok:false,code:'missing_materials',message:'Deliver one matching raw propagation portion.'};
  if(typeof j.id!=='string'||!/^job-\d+$/.test(j.id))return {ok:false,code:'invalid_generation',message:'The planting order has no valid identity.'};
  const {site,tile}=cultivationTarget(s,j),species=j.plantSpecies,ledger=site.cultivation[species];
  tile.flora??={};tile.flora[species]={biomass:CULTIVATION.initialBiomass,harvests:0,origin:'cultivated',generation:j.id,moisture:0};
  ledger.propagules++;ledger.planted+=CULTIVATION.initialBiomass;
  emitEvent(s,'flora.planted',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),species,generation:j.id,origin:'cultivated',actor:c.id,job:j.id,propaguleFood:CULTIVATION.plantFood,foodKind:species,biomass:CULTIVATION.initialBiomass,moisture:0,from:{entity:j.id,slot:'materials'},to:{entity:patchId(site,tile,species),slot:'biomass'}});
  return {ok:true};
}
export function completeWatering(s,c,j){
  if(!cultivationJobValid(s,j))return {ok:false,code:'invalid_target',message:'The designated bed no longer exists.'};
  if(!exactKeys(j.materials,['water'])||j.materials.water!==CULTIVATION.waterDose)return {ok:false,code:'missing_materials',message:'Deliver the water dose before watering.'};
  const {site,tile}=cultivationTarget(s,j),species=j.plantSpecies,patch=tile.flora[species],ledger=site.cultivation[species];
  const transferred=Math.max(0,Math.min(CULTIVATION.waterDose,CULTIVATION.moistureCapacity-patch.moisture)),returned=CULTIVATION.waterDose-transferred;
  patch.moisture+=transferred;ledger.delivered+=CULTIVATION.waterDose;ledger.returned+=returned;spill(tile,{water:returned});
  emitEvent(s,'flora.watered',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),species,generation:patch.generation,actor:c.id,job:j.id,paidWater:CULTIVATION.waterDose,amount:transferred,waterReturned:returned,moisture:patch.moisture,from:{entity:j.id,slot:'materials'},to:{entity:patchId(site,tile,species),slot:'moisture'},returnTo:{entity:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),slot:'drop'}});
  return {ok:true,transferred,returned};
}
export function absorbCultivationWater(s,site,tile,maximum){
  if(!Number.isFinite(maximum)||maximum<=0||!tile)return 0;
  const entry=patchEntries(tile).find(([species,patch])=>cultivatedSpecies.includes(species)&&patch.origin==='cultivated');
  if(!entry)return 0;
  const [species,patch]=entry;if(unsuitable(tile,species))return 0;
  const amount=Math.max(0,Math.min(maximum,tile.liquid||0,CULTIVATION.moistureCapacity-patch.moisture));if(amount<=epsilon)return 0;
  tile.liquid-=amount;patch.moisture+=amount;site.liquids.absorbed+=amount;site.cultivation[species].absorbed+=amount;
  emitEvent(s,'flora.water.absorbed',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),species,generation:patch.generation,amount,moisture:patch.moisture,from:{entity:tileEntityId(site.id,tile.x,tile.y,positionOf(tile).z),slot:'liquid'},to:{entity:patchId(site,tile,species),slot:'moisture'}});
  return amount;
}
function validBiomass(species,patch){
  return registered(species)&&record(patch)&&Number.isFinite(patch.biomass)&&patch.biomass>=0&&patch.biomass<=100&&Number.isSafeInteger(patch.harvests)&&patch.harvests>=0&&(species!=='lichen'||patch.harvests===0);
}
function validPatch(species,patch){
  if(!validBiomass(species,patch))return false;
  if(patch.origin==='native')return exactKeys(patch,['biomass','harvests','origin','generation'])&&patch.generation==='native';
  return cultivatedSpecies.includes(species)&&patch.origin==='cultivated'&&exactKeys(patch,['biomass','harvests','origin','generation','moisture'])&&typeof patch.generation==='string'&&/^job-\d+$/.test(patch.generation)&&Number.isFinite(patch.moisture)&&patch.moisture>=0&&patch.moisture<=CULTIVATION.moistureCapacity;
}
export function validateFlora(s){
  for(const site of Object.values(s.sites))for(const tile of site.tiles){
    if(tile.building==='planter'&&tile.terrain!=='floor')throw new Error('Invalid planter foundation.');
    if(Object.hasOwn(tile,'lichen'))throw new Error('Legacy lichen is not canonical flora.');
    if(tile.flora===undefined)continue;
    if(!tile.flora||typeof tile.flora!=='object'||Array.isArray(tile.flora))throw new Error('Invalid flora map.');
    let edible=0;
    for(const [species,patch] of patchEntries(tile)){
      if(!validPatch(species,patch))throw new Error('Invalid flora patch.');
      if(FLORA[species].foodKind)edible++;
    }
    if(edible>1)throw new Error('Edible flora patches overlap.');
    // Incompatible plants are valid transient state, including covered legacy
    // lichen during exact migration. The next ecology update removes them.
  }
}
export function validateCultivation(s){
  validateFlora(s);
  for(const site of Object.values(s.sites)){
    if(!exactKeys(site.cultivation,cultivatedSpecies))throw new Error('Invalid cultivation ledgers.');
    let absorbed=0;
    for(const species of cultivatedSpecies){
      const ledger=site.cultivation[species];
      if(!exactKeys(ledger,ledgerFields)||ledgerFields.some(field=>!Number.isFinite(ledger[field])||ledger[field]<0)||!Number.isSafeInteger(ledger.propagules)||!Number.isSafeInteger(ledger.harvests))throw new Error('Invalid cultivation ledger.');
      let biomass=0,moisture=0;
      for(const tile of site.tiles){const patch=tile.flora?.[species];if(patch?.origin==='cultivated'){biomass+=patch.biomass;moisture+=patch.moisture;}}
      if(!close(ledger.planted,CULTIVATION.initialBiomass*ledger.propagules)||!close(ledger.harvested,80*ledger.harvests)||!close(ledger.foodProduced,FLORA[species].yield*ledger.harvests)||!close(ledger.growthUsed,ledger.grown*FLORA[species].waterPerBiomass)||!close(ledger.planted+ledger.grown-ledger.harvested-ledger.destroyed,biomass))throw new Error('Cultivation biomass does not balance.');
      if(!close(ledger.delivered+ledger.absorbed-ledger.growthUsed-ledger.returned,moisture))throw new Error('Cultivation moisture does not balance.');
      absorbed+=ledger.absorbed;
    }
    if(site.liquids&&!close(absorbed,site.liquids.absorbed))throw new Error('Cultivation absorption does not balance.');
  }
}
