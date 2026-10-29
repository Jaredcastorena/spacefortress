import {BUILDINGS} from './data.js';
import {MATERIALS, STRUCTURAL_BUILDINGS, DEFAULT_MATERIAL} from './material-data.js';
import {tileAt, positionOf} from './spatial.js';

const owns = (object, key) => object != null && Object.hasOwn(object, key);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const sameCost = (actual, expected) => record(actual) && Object.keys(actual).length === Object.keys(expected).length && Object.entries(expected).every(([r,n]) => actual[r] === n);
export const structuralBuilding = building => STRUCTURAL_BUILDINGS.includes(building);
const ownsLayer = (tile, layer) => layer === 'floor' ? tile?.terrain === 'floor' : layer === 'structure' && ['wall','door'].includes(tile?.building);
export function materialId(tile, layer) {
  return ownsLayer(tile, layer) ? tile.materials?.[layer] ?? DEFAULT_MATERIAL : null;
}
export function materialProfile(tile, layer) {
  const id = materialId(tile, layer);
  return id === null ? null : MATERIALS[id];
}
export function constructionSpec(building, material = DEFAULT_MATERIAL) {
  const definition = BUILDINGS[building];
  if (!definition || !owns(MATERIALS, material)) throw new Error('Unknown building or material.');
  if (!structuralBuilding(building) && material !== DEFAULT_MATERIAL) throw new Error('This structure has no material choice.');
  const profile = MATERIALS[material].structure, cost = {...definition.cost};
  if (structuralBuilding(building)) for (const [resource, amount] of Object.entries(profile.extraCost)) cost[resource] = (cost[resource] || 0) + amount;
  return {cost, work:Math.ceil(definition.work * (structuralBuilding(building) ? profile.workMultiplier : 1)), material};
}
export function repairSpec(tile) {
  const material = materialId(tile, 'structure');
  if (material === null) return {cost:{alloy:1},work:5};
  const profile = MATERIALS[material].structure;
  return {cost:{...profile.repairCost},work:profile.repairWork,material};
}
export function installMaterial(tile, layer, material) {
  if (!ownsLayer(tile, layer) || !owns(MATERIALS, material)) throw new Error('Invalid installed material owner.');
  tile.materials = {...tile.materials, [layer]:material};
}
export function clearMaterial(tile, layer) {
  if (!tile.materials) return;
  delete tile.materials[layer];
  if (!Object.keys(tile.materials).length) delete tile.materials;
}
export function dismantleRefund(tile) {
  const cost = BUILDINGS[tile.building] ? constructionSpec(tile.building, materialId(tile,'structure') ?? DEFAULT_MATERIAL).cost : {};
  return Object.fromEntries(Object.entries(cost).map(([r,n]) => [r,Math.floor(n/2)]));
}
export function materialStatus(tile) {
  const result = {};
  for (const layer of ['floor','structure']) {
    const id = materialId(tile,layer); if (id === null) continue;
    const material = MATERIALS[id];
    result[layer] = {id, name:material.name, conductivity:material.structure.conductivity,
      ...(layer === 'structure' ? {damageMultiplier:material.structure.damageMultiplier, repairCost:{...material.structure.repairCost}} : {})};
  }
  return result;
}
// Check only the new tile/job owners. Old manufactured tools already have
// their own legitimate material fields and must retain those physical items.
export function rejectLegacyMaterials(s) {
  if (Object.values(s.sites).some(site => site.tiles.some(t => owns(t,'materials'))) || s.jobs.some(j => owns(j,'material'))) throw new Error('Legacy structural material fields.');
}
export function validateMaterials(s) {
  for (const site of Object.values(s.sites)) for (const tile of site.tiles) {
    if (!owns(tile,'materials')) continue;
    if (!record(tile.materials) || !Object.keys(tile.materials).length || Object.keys(tile.materials).some(layer => !ownsLayer(tile,layer) || !owns(MATERIALS,tile.materials[layer]))) throw new Error('Invalid structural material owner.');
  }
  for (const job of s.jobs) {
    const tile = tileAt(s.sites[job.site],positionOf(job));
    const build = job.kind === 'build' && structuralBuilding(job.building);
    const repair = job.kind === 'repair' && materialId(tile,'structure') !== null;
    if (owns(job,'material') && (!owns(MATERIALS,job.material) || !build && !repair)) throw new Error('Invalid work material owner.');
    if (!build && !repair) continue;
    const spec = build ? constructionSpec(job.building,job.material ?? DEFAULT_MATERIAL) : repairSpec(tile);
    if (repair && owns(job,'material') && job.material !== spec.material) throw new Error('Repair material does not match the structure.');
    if (!sameCost(job.cost,spec.cost) || job.work !== spec.work) throw new Error('Invalid paid structural material work.');
  }
}
