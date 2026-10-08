import { FLORA } from './flora-data.js';
import { distance } from './geometry.js';
import { temperatureAt } from './thermal.js';
import { typedFood } from './food-lots.js';
import { spill } from './inventory.js';
import { emitEvent, tileEntityId } from './telemetry.js';

const registered = species => Object.hasOwn(FLORA,species);
export const floraId = (siteId,x,y,species) => `flora:${siteId}:${x}:${y}:${species}`;
export const floraBiomass = (tile,species='lichen') => tile?.flora?.[species]?.biomass ?? 0;
export const floraStage = biomass => biomass===0?'bare':biomass<25?'sparse':biomass<70?'growing':biomass<100?'budding':'mature';
const patchId = (site,tile,species) => floraId(site.id,tile.x,tile.y,species);
const patchEntries = tile => Object.entries(tile.flora || {});
function unsuitable(tile,species){
  if(tile.terrain!=='ground')return {code:'terrain',message:'Native plants need ground.'};
  if(tile.fire)return {code:'fire',message:'Fire prevents growth and gathering.'};
  if(tile.building&&!['fence','pastureGate',...(species==='lichen'?['husbandryPost']:[])].includes(tile.building))return {code:'building',message:'This structure covers the plant.'};
  return null;
}
function growthBlock(s,site,tile,species){
  const blocked=unsuitable(tile,species);if(blocked)return blocked;
  const def=FLORA[species],temp=temperatureAt(site,tile.x,tile.y),[low,high]=def.temperature;
  if(temp<low||temp>high)return {code:'temperature',message:`Dormant at ${temp.toFixed(1)}°C; grows from ${low} to ${high}°C.`};
  if(def.daylight&&(site.id!=='surface'||s.tick%300>=220))return {code:'darkness',message:'Dormant until daylight.'};
  return null;
}
function stageChanged(s,site,tile,species,before,reason,actor=null,job=null){
  const after=floraBiomass(tile,species),previous=floraStage(before),stage=floraStage(after);
  if(previous!==stage)emitEvent(s,'flora.stage.changed',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y),species,previous,stage,biomassBefore:before,biomassAfter:after,reason,...(actor?{actor}:{}),...(job?{job}:{})});
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
export function updateFlora(s){
  for(const site of Object.values(s.sites))for(const tile of site.tiles)for(const [species,patch] of patchEntries(tile)){
    const blocked=unsuitable(tile,species);
    if(blocked){delete tile.flora[species];if(!Object.keys(tile.flora).length)delete tile.flora;emitEvent(s,'flora.removed',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y),species,biomass:patch.biomass,harvests:patch.harvests,reason:blocked.code});continue;}
    const def=FLORA[species];if(s.tick%def.growthEvery!==0||patch.biomass===100||growthBlock(s,site,tile,species))continue;
    const before=patch.biomass;patch.biomass=Math.min(100,before+def.growthAmount);stageChanged(s,site,tile,species,before,'natural_growth');
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
  const base={work:def?.work??0,foodKind:def?.foodKind??null,yield:def?.yield??0,harvests:patch?.harvests??null};
  if(!def||!patch)return {ok:false,code:'missing_plant',message:'Choose a living wild food patch.',...base};
  if(!def.foodKind)return {ok:false,code:'not_edible',message:'Lichen is forage for bristlebacks and cannot be gathered.',...base};
  const blocked=unsuitable(tile,species);if(blocked)return {ok:false,code:blocked.code,message:blocked.message,...base};
  if(patch.harvests===Number.MAX_SAFE_INTEGER)return {ok:false,code:'cycle_limit',message:'This patch has reached its harvest cycle limit.',...base};
  if(patch.biomass<100)return {ok:false,code:'immature',message:'Wait for the patch to mature.',...base};
  return {ok:true,code:'ready',message:'Ready to gather.',...base};
}
export function floraStatus(s,site,tile){
  return patchEntries(tile).map(([species,patch])=>{
    const def=FLORA[species],blocked=growthBlock(s,site,tile,species);
    return {id:patchId(site,tile,species),species,name:def.name,description:def.description,...patch,stage:floraStage(patch.biomass),growthAllowed:!blocked,growthReason:blocked?.message??null,harvestable:gatheringEligibility(s,site,tile,species).ok,foodKind:def.foodKind,yield:def.yield,work:def.work};
  });
}
export function gatheringJobValid(s,j){
  if(j.kind!=='gather'||j.building!==null||!Number.isSafeInteger(j.plantHarvests)||j.plantHarvests<0)return false;
  const site=s.sites[j.site];if(!site||!Number.isInteger(j.x)||!Number.isInteger(j.y)||j.x<0||j.y<0||j.x>=site.size||j.y>=site.size)return false;
  const tile=site.tiles[j.y*site.size+j.x],eligible=gatheringEligibility(s,site,tile,j.plantSpecies);
  return eligible.ok&&eligible.harvests===j.plantHarvests&&eligible.work===j.work;
}
export function completeGathering(s,c,j){
  if(!gatheringJobValid(s,j))return {ok:false,message:'The designated plant is no longer ready to gather.'};
  const site=s.sites[j.site],tile=site.tiles[j.y*site.size+j.x],species=j.plantSpecies,patch=tile.flora[species],def=FLORA[species];
  const before=patch.biomass,harvestsBefore=patch.harvests;
  spill(tile,typedFood(def.foodKind,def.yield));patch.biomass=def.harvestRemainder;patch.harvests++;
  stageChanged(s,site,tile,species,before,'harvest',c.id,j.id);
  emitEvent(s,'flora.harvested',{entity:patchId(site,tile,species),target:tileEntityId(site.id,tile.x,tile.y),species,actor:c.id,job:j.id,foodKind:def.foodKind,output:{food:def.yield},biomassBefore:before,biomassAfter:patch.biomass,harvestsBefore,harvestsAfter:patch.harvests});
  return {ok:true};
}
export function validateFlora(s){
  for(const site of Object.values(s.sites))for(const tile of site.tiles){
    if(Object.hasOwn(tile,'lichen'))throw new Error('Legacy lichen is not canonical flora.');
    if(tile.flora===undefined)continue;
    if(!tile.flora||typeof tile.flora!=='object'||Array.isArray(tile.flora))throw new Error('Invalid flora map.');
    let edible=0;
    for(const [species,patch] of patchEntries(tile)){
      if(!registered(species)||!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).length!==2||!Number.isFinite(patch.biomass)||patch.biomass<0||patch.biomass>100||!Number.isSafeInteger(patch.harvests)||patch.harvests<0||species==='lichen'&&patch.harvests!==0)throw new Error('Invalid flora patch.');
      if(FLORA[species].foodKind)edible++;
    }
    if(edible>1)throw new Error('Edible flora patches overlap.');
    // Incompatible plants are valid transient state, including covered legacy
    // lichen during exact migration. The next ecology update removes them.
  }
}
