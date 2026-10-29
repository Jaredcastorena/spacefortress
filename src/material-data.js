// One material vocabulary for manufactured tools and supplied habitat parts.
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
export const MATERIALS = freeze({
  alloy: {
    name: 'Alloy', tool: {speed:1.25, wear:1},
    structure: {extraCost:{}, workMultiplier:1, conductivity:1, damageMultiplier:1, repairCost:{alloy:1}, repairWork:5},
  },
  composite: {
    name: 'Composite', tool: {speed:1.5, wear:.5},
    structure: {extraCost:{components:1}, workMultiplier:1.5, conductivity:.25, damageMultiplier:.6, repairCost:{alloy:1,components:1}, repairWork:8},
  },
});
export const STRUCTURAL_BUILDINGS = Object.freeze(['floor','wall','door']);
export const DEFAULT_MATERIAL = 'alloy';
export const SOLID_FLOOR_CONDUCTANCE = .015;
