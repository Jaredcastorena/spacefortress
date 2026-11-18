import { GASES, gasAmount } from './gas-species.js';
import { gasHeatCapacity, gasLatentHeat, roomStructureCapacity, roomKelvin, VAPOR_LATENT_HEAT, GAS_REFERENCE_KELVIN } from './gas-thermal.js';
import { WATER_LATENT_HEAT, ICE_HEAT_CAPACITY, MELTING_KELVIN, waterPhase, takeCondensedWater, putWater } from './water-thermal.js';
import { GAS_PER_TILE, roomVaporPressure } from './room-pressure.js';
import { gasNode, gasCapacity, gasVolumeForWater } from './gas-networks.js';
import { LIQUID, liquidOpen } from './liquids.js';
import { roomAt, refreshAtmosphere } from './atmosphere.js';
import { neighbors } from './geometry.js';
import { tileAt, positionOf } from './spatial.js';
import { emitEvent, tileEntityId, roomEntityId } from './telemetry.js';
import { recordWaterPhase } from './water-phase-events.js';

export const WATER_VAPOR = Object.freeze({ contact: .02, transfer: .1 });
export const VAPOR_COUNTERS = Object.freeze(['initial', 'floorEvaporated', 'floorCondensed', 'nodeEvaporated', 'nodeCondensed', 'vacuumEvaporated', 'condensateReleased', 'condensateLost']);
const nonnegative = value => Number.isFinite(value) && value >= 0;
const ordered = tiles => [...tiles].sort((a,b)=>(a.z??0)-(b.z??0)||a.y-b.y||a.x-b.x);
const entity = (site,tile) => tileEntityId(site.id,tile.x,tile.y,tile.z??0);

// Nominal-atmosphere saturation curve in game units, not an engineering model.
export function saturationPressure(kelvin) {
  if (!nonnegative(kelvin)) throw new Error('Invalid saturation temperature.');
  return kelvin === 0 ? 0 : Math.exp(4890 * (1 / 373.15 - 1 / kelvin));
}

export function roomVaporStatus(room) {
  const partialPressure=roomVaporPressure(room),saturation=saturationPressure(roomKelvin(room));
  const humidity=saturation>0?partialPressure/saturation:null;
  return {amount:room.gas.vapor??0,partialPressure,saturationPressure:saturation,relativeHumidity:Number.isFinite(humidity)?humidity:null};
}

// Solve the shared temperature analytically, including the isothermal melting
// interval. The gas owner's heat also contains its optional structure capacity.
export function vaporEquilibrium(water, owner, { volume, volumeForWater, structureCapacity=0, capacity=Infinity }={}) {
  const initial=waterPhase(water),gas=owner?.gas;
  if (!gas || !GASES.every(key=>nonnegative(gas[key])) || !nonnegative(gasAmount(gas)) ||
      !nonnegative(owner.heat) || owner.heat<gasLatentHeat(gas) || !nonnegative(structureCapacity) ||
      !(capacity===Infinity||nonnegative(capacity)) || water.water>capacity ||
      !(typeof volumeForWater==='function'||nonnegative(volume))) throw new Error('Invalid vapor phase pair.');
  if (gasAmount(gas)===0 && structureCapacity===0 && owner.heat!==0) throw new Error('Empty gas retains heat.');
  const totalHeat=water.heat+owner.heat,baseCapacity=structureCapacity+gasHeatCapacity(gas)-gas.vapor;
  if(!Number.isFinite(totalHeat)||!nonnegative(baseCapacity))throw new Error('Invalid vapor pair energy.');
  const state = transfer => {
    const condensed=water.water-transfer,vapor=gas.vapor+transfer,gasCapacity=baseCapacity+vapor;
    const sensible=totalHeat-vapor*VAPOR_LATENT_HEAT;
    if(sensible < -Number.EPSILON*Math.max(1,totalHeat)*4)throw new Error('Vapor exceeds finite pair energy.');
    const available=Math.max(0,sensible),cold=gasCapacity*MELTING_KELVIN+condensed*(MELTING_KELVIN-WATER_LATENT_HEAT),hot=(gasCapacity+condensed)*MELTING_KELVIN;
    let kelvin,waterHeat;
    if(available<cold){kelvin=available/(gasCapacity+condensed*ICE_HEAT_CAPACITY);waterHeat=condensed*ICE_HEAT_CAPACITY*kelvin;}
    else if(available>hot){kelvin=available/(gasCapacity+condensed);waterHeat=condensed*kelvin;}
    else {kelvin=gasCapacity+condensed>0?MELTING_KELVIN:0;waterHeat=available-gasCapacity*kelvin;}
    if(condensed===0)waterHeat=0;
    if(gasCapacity===0)waterHeat=totalHeat;
    const gasHeat=totalHeat-waterHeat,space=volumeForWater?volumeForWater(condensed):volume;
    if(!nonnegative(space)||space===0&&gasAmount(gas)+transfer>0)throw new Error('Gas has no available volume.');
    const pressure=space>0?vapor/(GAS_PER_TILE*space)*kelvin/GAS_REFERENCE_KELVIN:0;
    // At absolute zero ideal partial pressures vanish for every finite mass.
    // Use the limiting saturation mass (zero) to distinguish retained vapor
    // from the empty gas phase and avoid a false zero-temperature root.
    return {transfer,water:condensed,waterHeat,vapor,gasHeat,kelvin,residual:kelvin===0?vapor:pressure-saturationPressure(kelvin)};
  };
  const start=state(0);
  if(start.residual===0||water.water+gas.vapor===0)return start;
  // Evaporation can consume current liquid, but cannot sublime current ice or
  // spend more energy than the entire finite pair owns.
  let low=-Math.min(gas.vapor,capacity-water.water),high=Math.min(initial.liquid,Math.max(0,totalHeat/VAPOR_LATENT_HEAT-gas.vapor));
  if(start.residual<0){
    low=0;if(high===0)return start;
    const endpoint=state(high);if(endpoint.residual<=0)return endpoint;
  }else{
    high=0;if(low===0)return start;
    const endpoint=state(low);if(endpoint.residual>=0)return endpoint;
  }
  for(let i=0;i<64;i++){
    const middle=(low+high)/2;
    if(middle===low||middle===high||water.water-middle===water.water&&gas.vapor+middle===gas.vapor)break;
    // At a completely filled vessel the first representable open volume is
    // the finite lower boundary. Do not manufacture gas into rounded zero space.
    if(volumeForWater&&volumeForWater(water.water-middle)===0&&gasAmount(gas)+middle>0){high=middle;continue;}
    if(state(middle).residual<=0)low=middle;else high=middle;
  }
  // Stay on the initial side of equilibrium rather than crossing its root.
  return state(start.residual<0?low:high);
}

export function advanceWaterVaporPair(water, owner, options={}) {
  const {rate=WATER_VAPOR.contact,maxTransfer=WATER_VAPOR.transfer}=options;
  if(!nonnegative(rate)||rate>1||!nonnegative(maxTransfer))throw new Error('Invalid vapor phase rate.');
  const target=vaporEquilibrium(water,owner,options),wanted=target.transfer;
  if(wanted===0||rate===0||maxTransfer===0)return {amount:0,energy:0,kelvin:target.kelvin};
  const fraction=Math.min(rate,maxTransfer/Math.abs(wanted)),amount=wanted*fraction;
  if(water.water-amount===water.water||owner.gas.vapor+amount===owner.gas.vapor)return {amount:0,energy:0,kelvin:target.kelvin};
  const waterHeat=water.heat+(target.waterHeat-water.heat)*fraction,energy=water.heat-waterHeat;
  // One interpolation for both masses and energies models finite phase contact.
  water.water-=amount;water.heat=waterHeat;
  owner.gas.vapor+=amount;owner.heat+=energy;
  if(water.water===0)water.heat=0;
  if(gasAmount(owner.gas)===0&&!(options.structureCapacity>0))owner.heat=0;
  return {amount,energy,kelvin:target.kelvin};
}

export function initializeWaterVapor(s) {
  for(const site of Object.values(s.sites)){
    for(const room of site.rooms)room.gas.vapor??=0;
    for(const tile of site.tiles)for(const node of [tile.pipe,tile.gasStore])if(node){node.gas.vapor??=0;node.condensate??={water:0,heat:0};}
    for(const key of ['injected','vented'])site.atmosphere[key].vapor??=0;
    for(const key of ['loaded','extracted','delivered','vented'])site.gasNetwork[key].vapor??=0;
    site.vapor??=Object.fromEntries(VAPOR_COUNTERS.map(key=>[key,key==='initial'?site.rooms.reduce((n,r)=>n+r.gas.vapor,0)+site.tiles.reduce((n,t)=>n+(gasNode(t)?.gas.vapor??0),0):0]));
  }
}

function recordVapor(s,site,tile,slot,room,change,cause){
  if(change.amount===0)return;
  const evaporating=change.amount>0,waterId=entity(site,tile),gasId=room?roomEntityId(site.id,room):waterId;
  const waterSlot=slot==='liquid'?'liquid':`${slot}.condensate`,gasSlot=room?'gas':`${slot}.gas`;
  emitEvent(s,evaporating?'water.evaporated':'water.condensed',{
    from:evaporating?waterId:gasId,to:evaporating?gasId:waterId,
    fromSlot:evaporating?waterSlot:gasSlot,toSlot:evaporating?gasSlot:waterSlot,
    amount:Math.abs(change.amount),energy:Math.abs(change.energy),gasHeatChange:change.energy,
    temperature:change.kelvin-MELTING_KELVIN,latentEnergy:Math.abs(change.amount)*VAPOR_LATENT_HEAT,cause,
  });
}

function evaporateExterior(s,site,tile){
  const phase=waterPhase(tile,{floor:true});if(phase.liquid===0)return;
  const perUnit=phase.kelvin+VAPOR_LATENT_HEAT;
  const amount=Math.min(phase.liquid*WATER_VAPOR.contact,WATER_VAPOR.transfer,tile.liquidHeat/perUnit);
  if(amount===0)return;
  const heat=amount*perUnit,beforeIce=phase.ice;
  tile.liquid-=amount;tile.liquidHeat-=heat;site.vapor.vacuumEvaporated+=amount;site.thermal.gasVented+=heat;
  recordWaterPhase(s,site,tile,'liquid',beforeIce,'vacuum_evaporation');
  emitEvent(s,'water.evaporated',{from:entity(site,tile),to:`space:${site.id}`,fromSlot:'liquid',toSlot:'vacuum',amount,energy:heat,temperature:phase.kelvin-MELTING_KELVIN,latentEnergy:amount*VAPOR_LATENT_HEAT,cause:'vacuum'});
}

export function updateWaterVapor(s) {
  for(const site of Object.values(s.sites)){
    for(const tile of ordered(site.tiles)){
      if(liquidOpen(site,tile,s.tick)){
        const room=roomAt(site,tile.x,tile.y,tile.z??0);
        if(room){
          const water={water:tile.liquid,heat:tile.liquidHeat},beforeIce=waterPhase(water).ice;
          const change=advanceWaterVaporPair(water,room,{volume:room.volume,structureCapacity:roomStructureCapacity(room),capacity:LIQUID.capacity});
          tile.liquid=water.water;tile.liquidHeat=water.heat;
          site.vapor[change.amount>0?'floorEvaporated':'floorCondensed']+=Math.abs(change.amount);
          recordWaterPhase(s,site,tile,'liquid',beforeIce,'vapor_contact');recordVapor(s,site,tile,'liquid',room,change,'floor_contact');
        }else evaporateExterior(s,site,tile);
      }
      for(const slot of ['pipe','gasStore']){
        const node=tile[slot];if(!node)continue;
        const beforeIce=waterPhase(node.condensate).ice;
        const change=advanceWaterVaporPair(node.condensate,node,{capacity:gasCapacity(tile),volumeForWater:mass=>gasVolumeForWater(tile,mass)});
        site.vapor[change.amount>0?'nodeEvaporated':'nodeCondensed']+=Math.abs(change.amount);
        recordWaterPhase(s,site,tile,`${slot}Condensate`,beforeIce,'vapor_contact');recordVapor(s,site,tile,slot,null,change,'node_contact');
      }
    }
    refreshAtmosphere(site);
  }
}

export function releaseNodeCondensate(s,site,tile,node,reason='dismantled') {
  const owner=node.condensate;if(!owner||owner.water===0)return 0;
  const slot=node===tile.pipe?'pipe':'gasStore',source=entity(site,tile),z=positionOf(tile).z;
  const destinations=[tile,...ordered(neighbors(tile.x,tile.y).map(([x,y])=>tileAt(site,{x,y,z})).filter(Boolean))];
  let released=0;
  for(const destination of destinations){
    if(destination.terrain!=='floor'||!liquidOpen(site,destination,s.tick))continue;
    const amount=Math.min(owner.water,Math.max(0,LIQUID.capacity-destination.liquid));if(amount===0)continue;
    const beforeIce=waterPhase(destination,{floor:true}).ice,heat=takeCondensedWater(owner,amount);
    putWater(destination,amount,heat,{floor:true});released+=amount;site.liquids.released+=amount;site.vapor.condensateReleased+=amount;
    recordWaterPhase(s,site,destination,'liquid',beforeIce,'condensate_release');
    emitEvent(s,'water.released',{from:source,to:entity(site,destination),fromSlot:`${slot}.condensate`,toSlot:'liquid',amount,heat,cause:reason});
    if(owner.water===0)break;
  }
  if(owner.water>0){
    const amount=owner.water,heat=takeCondensedWater(owner,amount);site.vapor.condensateLost+=amount;site.thermal.waterRemoved+=heat;
    emitEvent(s,'water.lost',{entity:source,fromSlot:`${slot}.condensate`,amount,heat,cause:`condensate_${reason}`});
  }
  return released;
}

export function validateWaterVapor(s) {
  for(const site of Object.values(s.sites)){
    const ledger=site.vapor;
    if(!ledger||Object.keys(ledger).length!==VAPOR_COUNTERS.length||!VAPOR_COUNTERS.every(key=>nonnegative(ledger[key])))throw new Error('Invalid water vapor ledger.');
    let retained=0,condensate=0;
    for(const room of site.rooms){if(!nonnegative(room.gas.vapor))throw new Error('Invalid room vapor.');retained+=room.gas.vapor;}
    for(const tile of site.tiles)for(const node of [tile.pipe,tile.gasStore])if(node){
      const water=node.condensate;
      if(!water||Object.keys(water).length!==2||!Object.hasOwn(water,'water')||!Object.hasOwn(water,'heat'))throw new Error('Invalid gas condensate owner.');
      waterPhase(water);
      if(!nonnegative(node.gas.vapor)||water.water>gasCapacity(tile)||water.water+gasAmount(node.gas)+(node.smoke??0)>gasCapacity(tile)+1e-8||gasVolumeForWater(tile,water.water)===0&&gasAmount(node.gas)>0)throw new Error('Invalid gas condensate capacity.');
      retained+=node.gas.vapor+water.water;condensate+=water.water;
    }
    const expectedCondensate=ledger.nodeCondensed-ledger.nodeEvaporated-ledger.condensateReleased-ledger.condensateLost;
    const expected=ledger.initial+ledger.floorEvaporated-ledger.floorCondensed+site.atmosphere.injected.vapor-site.gasNetwork.delivered.vapor+site.gasNetwork.loaded.vapor-site.atmosphere.vented.vapor-ledger.condensateReleased-ledger.condensateLost;
    if(!Number.isFinite(expectedCondensate)||Math.abs(condensate-expectedCondensate)>1e-7+ledger.nodeCondensed*1e-9)throw new Error('Gas condensate does not balance.');
    const supplied=ledger.initial+ledger.floorEvaporated+site.atmosphere.injected.vapor+site.gasNetwork.loaded.vapor;
    if(!Number.isFinite(expected)||!Number.isFinite(supplied)||Math.abs(retained-expected)>1e-7+supplied*1e-9)throw new Error('Water vapor does not balance.');
  }
}
