// Physical ingredients remain portions of the food resource. These IDs describe
// the portions and recipes without adding resources or importing simulation data.
export const DEFAULT_CROP = 'fungalcap';
export const DEFAULT_MEAL = 'basic_ration';
export const QUALITY_LEVELS = [0, 3, 6, 9];
export const mealQualityForLevel = level => Math.min(4, 1 + Math.floor(Math.max(0, level) / 3));
export const nextQualityLevel = level => QUALITY_LEVELS.find(n => n > level) ?? null;
export const FOOD_KINDS = {
  ration: { id: 'ration', name: 'Ration', origin: 'legacy' },
  fungalcap: { id: 'fungalcap', name: 'Fungalcap', origin: 'crop' },
  siltgrain: { id: 'siltgrain', name: 'Siltgrain', origin: 'crop' },
  sunberry: { id: 'sunberry', name: 'Sunberry', origin: 'crop' },
  curd: { id: 'curd', name: 'Bristleback curd', origin: 'animal' },
  glazeegg: { id: 'glazeegg', name: 'Glazefoot egg', origin: 'animal' },
};
const crop = (id, name, water, duration, temperature, minSkill = 0, outputKind = id) => ({
  id, name, tier: 1 + Math.floor(minSkill / 3), minSkill,
  input: { water, fertilizer: .25 }, output: { food: 2 }, duration,
  temperature, air: 40, foodKinds: undefined, outputKind,
});
export const CROPS = {
  fungalcap: crop('fungalcap', 'Fungalcap', 1, 30, [10, 35]),
  siltgrain: crop('siltgrain', 'Siltgrain', 1, 32, [10, 32]),
  sunberry: crop('sunberry', 'Sunberry', 1.5, 40, [15, 30], 3),
  legacy_crop: { ...crop('legacy_crop', 'Legacy crop', 1, 30, [10, 35], 0, 'ration'), selectable: false },
};
const meal = (id, name, foodKinds, water, duration, minSkill, comfort) => ({
  id, name, tier: 1 + Math.floor(minSkill / 3), minSkill,
  input: { food: 2, water }, output: { food: 2 }, duration,
  temperature: [5, 35], air: 40, foodKinds, comfort,
});
export const MEAL_RECIPES = {
  basic_ration: meal('basic_ration', 'Basic ration', undefined, .25, 24, 0, 0),
  grain_flatbread: meal('grain_flatbread', 'Grain flatbread', { siltgrain: 2 }, .25, 26, 0, .02),
  fungal_stew: meal('fungal_stew', 'Fungal stew', { fungalcap: 2 }, .5, 28, 0, .02),
  curd_bake: meal('curd_bake', 'Curd bake', { siltgrain: 1, curd: 1 }, .25, 32, 3, .05),
  berry_curd: meal('berry_curd', 'Berry curd', { sunberry: 1, curd: 1 }, .25, 28, 3, .06),
  glaze_omelet: meal('glaze_omelet', 'Glaze omelet', { glazeegg: 1, fungalcap: 1 }, .25, 32, 3, .05),
  colony_feast: meal('colony_feast', 'Colony feast', { siltgrain: .5, fungalcap: .5, curd: .5, glazeegg: .5 }, .5, 40, 6, .08),
  starlight_platter: meal('starlight_platter', 'Starlight platter', { siltgrain: .5, sunberry: .5, curd: .5, glazeegg: .5 }, .5, 48, 9, .10),
};
