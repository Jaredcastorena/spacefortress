// Pure shared livestock definitions. Simulation owns every animal's mutable state.
const shared = {
  careFood: 1, careWork: 12, careTrust: 40, careNutrition: 30, careWaste: .125,
  productFood: 2, productRate: .25, productWaste: .25, harvestWork: 10, harvestNutrition: 20,
  maturity: 600, gestation: 300, cooldown: 600, tilesPerAnimal: 6,
  movementTicks: 9, metabolism: .015, juvenileMetabolism: .008,
};
export const LIVESTOCK = Object.freeze({
  bristleback: Object.freeze({
    ...shared, name: 'Bristleback', color: '#a79564', productKind: 'curd', productName: 'Nutrient curd',
    feedKinds: null, feedName: 'food', grazesLichen: true,
    description: 'A six-legged frontier grazer. Mineral plates protect a warm, soft abdomen; broad feelers comb lichen from the ground. Its low clicking calls travel through the rock. Paired adults can carry a single brood beneath their plates; hatchlings graze and grow before producing curd.',
  }),
  glazefoot: Object.freeze({
    ...shared, name: 'Glazefoot', color: '#87c8bd', productKind: 'glazeegg', productName: 'Glaze eggs',
    feedKinds: Object.freeze({ fungalcap: 1 }), feedName: 'raw fungal caps', grazesLichen: false,
    description: 'A squat four-footed fungus eater with a translucent dorsal fan. Handlers deliver cultivated fungal caps; it cannot graze lichen. Tame adults produce edible glaze eggs. Paired adults carry a separate brood beneath their fan until a young glazefoot emerges.',
  }),
});
const speciesKey = creatureOrSpecies => typeof creatureOrSpecies === 'string' ? creatureOrSpecies : creatureOrSpecies?.species;
export const isLivestock = creatureOrSpecies => Object.hasOwn(LIVESTOCK, speciesKey(creatureOrSpecies));
export const livestockDef = creatureOrSpecies => isLivestock(creatureOrSpecies) ? LIVESTOCK[speciesKey(creatureOrSpecies)] : undefined;
