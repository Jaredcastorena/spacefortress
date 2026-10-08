// Native plants use ambient conditions, not the colony's stored air or water.
export const FLORA = Object.freeze({
  lichen: Object.freeze({ id: 'lichen', name: 'Ground lichen', description: 'A mineral-colored native mat that feeds bristlebacks. It regrows from surviving biomass and cannot be gathered as crew food.', foodKind: null, yield: 0, work: 0, temperature: Object.freeze([-40,35]), daylight: false, growthEvery: 60, growthAmount: 2, harvestRemainder: 20 }),
  fungalcap: Object.freeze({ id: 'fungalcap', name: 'Wild fungalcap', description: 'Low, broad native caps that tolerate the freezing night. Mature patches yield edible fungal caps for cooking or glazefoot care.', foodKind: 'fungalcap', yield: 2, work: 10, temperature: Object.freeze([-40,20]), daylight: false, growthEvery: 30, growthAmount: 1, harvestRemainder: 20 }),
  sunberry: Object.freeze({ id: 'sunberry', name: 'Wild sunberry', description: 'A low native shrub with bright fruit. It grows during temperate daylight and lies dormant through the cold night.', foodKind: 'sunberry', yield: 2, work: 12, temperature: Object.freeze([0,30]), daylight: true, growthEvery: 30, growthAmount: 1, harvestRemainder: 20 }),
});
