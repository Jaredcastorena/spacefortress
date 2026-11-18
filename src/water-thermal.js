import { KELVIN_ZERO } from './thermal-units.js';

// Condensed water uses one enthalpy owner; phase is derived, never a second
// mass counter. Liquid retains the earlier H=m*T reference. The positive ice
// capacity makes the melting interval continuous while preserving old energy.
export const WATER_HEAT_CAPACITY = 1;
export const WATER_REFERENCE_KELVIN = 20 + KELVIN_ZERO;
export const MELTING_KELVIN = KELVIN_ZERO;
export const WATER_LATENT_HEAT = 80;
export const ICE_HEAT_CAPACITY = (MELTING_KELVIN - WATER_LATENT_HEAT) / MELTING_KELVIN;
export const waterCapacity = amount => amount * WATER_HEAT_CAPACITY;
export const parcelHeat = (amount, kelvin = WATER_REFERENCE_KELVIN) => waterCapacity(amount) * kelvin;
export const waterHeatAt = (amount, kelvin) => amount * kelvin * (kelvin < MELTING_KELVIN ? ICE_HEAT_CAPACITY : WATER_HEAT_CAPACITY);
const fields = options => options?.floor ? ['liquid', 'liquidHeat'] : ['water', 'heat'];
const nonnegative = value => Number.isFinite(value) && value >= 0;

export function waterKelvin(owner, options) {
  return waterPhase(owner, options).kelvin;
}

export function waterPhase(owner, options) {
  const [quantity, energy] = checkOwner(owner, options),total=owner[quantity],heat=owner[energy];
  if(total===0)return {total:0,liquid:0,ice:0,kelvin:null,phase:'empty'};
  const cold=total*(MELTING_KELVIN-WATER_LATENT_HEAT),hot=total*MELTING_KELVIN;
  if(heat<=cold)return {total,liquid:0,ice:total,kelvin:heat/(total*ICE_HEAT_CAPACITY),phase:'solid'};
  if(heat>=hot)return {total,liquid:total,ice:0,kelvin:heat/total,phase:'liquid'};
  const liquid=Math.min(total,Math.max(0,(heat-cold)/WATER_LATENT_HEAT));
  return {total,liquid,ice:total-liquid,kelvin:MELTING_KELVIN,phase:'mixed'};
}

export const liquidWater = (owner, options) => waterPhase(owner, options).liquid;

function checkOwner(owner, options) {
  const [quantity, heat] = fields(options);
  if (!owner || !nonnegative(owner[quantity]) || !nonnegative(owner[heat]) || owner[quantity] === 0 && owner[heat] !== 0) throw new Error('Invalid water thermal owner.');
  return [quantity, heat];
}

export function takeWater(owner, amount, options) {
  const [quantity, heat] = checkOwner(owner, options);
  const phase=waterPhase(owner,options);
  if (!nonnegative(amount) || amount > phase.liquid) throw new Error('Invalid liquid water withdrawal.');
  if (amount === 0) return 0;
  const carried = amount === owner[quantity] ? owner[heat] : parcelHeat(amount,phase.kelvin);
  owner[quantity] -= amount;
  owner[heat] -= carried;
  return carried;
}

// Dismantling packages all retained condensed matter at an explicit boundary.
// It does not melt ice or inject heat into the modeled environment.
export function takeCondensedWater(owner, amount, options) {
  const [quantity,heat]=checkOwner(owner,options);
  if(!nonnegative(amount)||amount>owner[quantity])throw new Error('Invalid condensed water withdrawal.');
  if(amount===0)return 0;
  const carried=amount===owner[quantity]?owner[heat]:owner[heat]*(amount/owner[quantity]);
  owner[quantity]-=amount;owner[heat]-=carried;return carried;
}

export function putWater(owner, amount, heat, options) {
  const [quantity, energy] = checkOwner(owner, options);
  if (!nonnegative(amount) || !nonnegative(heat) || amount === 0 && heat !== 0 || !Number.isFinite(owner[quantity] + amount) || !Number.isFinite(owner[energy] + heat)) throw new Error('Invalid water heat deposit.');
  owner[quantity] += amount;
  owner[energy] += heat;
}

export function loadWater(site, owner, amount, options) {
  const heat = parcelHeat(amount);
  putWater(owner, amount, heat, options);
  site.thermal.waterLoaded += heat;
  return heat;
}

export function unloadWater(site, owner, amount, options) {
  const heat = takeWater(owner, amount, options);
  site.thermal.waterRemoved += heat;
  return heat;
}

export function unloadCondensedWater(site, owner, amount, options) {
  const heat=takeCondensedWater(owner,amount,options);
  site.thermal.waterRemoved+=heat;return heat;
}

// Analytic finite-pair equilibrium includes the isothermal melting interval.
// A fraction of the available equilibrium energy moves each contact step;
// neither owner can overshoot, including when either begins at zero kelvin.
export function exchangeWaterHeat(owner, destinationKelvin, destinationCapacity, rate, options) {
  const [quantity,energy]=checkOwner(owner,options),mass=owner[quantity];
  if(!nonnegative(destinationKelvin)||!(destinationCapacity>0)||!Number.isFinite(rate)||rate<0||rate>1)throw new Error('Invalid water heat exchange.');
  if(mass===0)return 0;
  let target;
  if(destinationCapacity===Infinity){
    target=destinationKelvin===MELTING_KELVIN?Math.max(mass*(MELTING_KELVIN-WATER_LATENT_HEAT),Math.min(owner[energy],mass*MELTING_KELVIN)):waterHeatAt(mass,destinationKelvin);
  }else{
    const iceCapacity=mass*ICE_HEAT_CAPACITY+destinationCapacity,liquidCapacity=mass+destinationCapacity;
    const roomSurplus=destinationCapacity*(destinationKelvin-MELTING_KELVIN);
    const coldSurplus=owner[energy]-mass*(MELTING_KELVIN-WATER_LATENT_HEAT)+roomSurplus;
    const hotSurplus=owner[energy]-mass*MELTING_KELVIN+roomSurplus;
    if(coldSurplus<0)target=mass*ICE_HEAT_CAPACITY*((owner[energy]+destinationCapacity*destinationKelvin)/iceCapacity);
    else if(hotSurplus>0)target=mass*((owner[energy]+destinationCapacity*destinationKelvin)/liquidCapacity);
    else target=owner[energy]+roomSurplus;
  }
  if(!Number.isFinite(target)||target<0)throw new Error('Invalid water heat equilibrium.');
  const exchange=(owner[energy]-target)*rate;owner[energy]-=exchange;return exchange;
}

export function storedWaterHeat(site) {
  return site.tiles.reduce((sum, tile) => sum + tile.liquidHeat + (tile.waterPipe?.heat ?? 0) + (tile.waterStore?.heat ?? 0) + (tile.pipe?.condensate?.heat ?? 0) + (tile.gasStore?.condensate?.heat ?? 0), 0);
}

// Only called after validating an older save in its original thermal domain.
// Previously untracked water enters at the declared reference temperature;
// existing room/gas temperatures and every physical quantity stay unchanged.
export function initializeWaterThermal(s) {
  for (const site of Object.values(s.sites)) {
    for (const tile of site.tiles) {
      tile.liquidHeat = parcelHeat(tile.liquid);
      for (const node of [tile.waterPipe, tile.waterStore]) if (node) node.heat = parcelHeat(node.water);
    }
    site.thermal.waterInitial = storedWaterHeat(site);
    site.thermal.waterLoaded = 0;
    site.thermal.waterRemoved = 0;
  }
}

export function validateWaterThermal(site) {
  for (const tile of site.tiles) {
    checkOwner(tile, { floor: true });
    for (const node of [tile.waterPipe, tile.waterStore]) if (node) checkOwner(node);
    for (const node of [tile.pipe, tile.gasStore]) if (node?.condensate) checkOwner(node.condensate);
  }
}
