import { waterPhase, WATER_LATENT_HEAT, MELTING_KELVIN } from './water-thermal.js';
import { emitEvent, tileEntityId } from './telemetry.js';

export function recordWaterPhase(s,site,tile,slot,beforeIce,cause){
  const path=slot==='pipeCondensate'?'pipe.condensate':slot==='gasStoreCondensate'?'gasStore.condensate':slot;
  const owner=slot==='liquid'?tile:path.split('.').reduce((value,key)=>value?.[key],tile),phase=waterPhase(owner,{floor:slot==='liquid'}),change=phase.ice-beforeIce;
  if(Math.abs(change)<=1e-8)return;
  emitEvent(s,change>0?'water.froze':'water.thawed',{
    entity:tileEntityId(site.id,tile.x,tile.y,tile.z??0),slot,amount:Math.abs(change),
    latentHeat:Math.abs(change)*WATER_LATENT_HEAT,cause,temperature:phase.kelvin-MELTING_KELVIN,
    liquid:phase.liquid,ice:phase.ice,
  });
}
