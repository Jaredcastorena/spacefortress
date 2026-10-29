import {MATERIALS} from './material-data.js';
import {materialStatus,structuralBuilding,constructionSpec} from './materials.js';

export function materialChoice() {
  return `<details id="material-chooser"><summary>Construction material</summary><label for="building-material">Floors, hull walls and pressure doors</label><select id="building-material">${Object.entries(MATERIALS).map(([id,m])=>`<option value="${id}">${m.name}</option>`).join('')}</select><p class="crew-hint">Composite uses one extra component and more work. It reduces solid heat conduction and wall/door damage. Open doors and stair openings still transfer heat.</p></details>`;
}
export function constructionDescription(building, material) {
  if (!structuralBuilding(building)) return '';
  const m=MATERIALS[material],spec=constructionSpec(building,material);
  return `<p>${m.name} · ${spec.work} work · ${Math.round(m.structure.conductivity*100)}% solid conductivity${building==='floor'?' between stacked rooms':` · ${Math.round(m.structure.damageMultiplier*100)}% structure damage`}.</p>`;
}
export function materialDetails(tile) {
  const layers=Object.entries(materialStatus(tile));
  if (!layers.length) return '';
  return `<details data-panel-key="materials"><summary>Construction materials</summary><dl>${layers.map(([layer,m])=>`<dt>${layer==='floor'?'Floor slab':'Wall / door'}</dt><dd>${m.name}</dd><dt>Solid conductivity</dt><dd>${Math.round(m.conductivity*100)}%${layer==='floor'?' between stacked compartments':''}</dd>${layer==='structure'?`<dt>Incoming structure damage</dt><dd>${Math.round(m.damageMultiplier*100)}%</dd><dt>Repair supplies</dt><dd>${Object.entries(m.repairCost).map(([r,n])=>`${n} ${r}`).join(' · ')}</dd>`:''}`).join('')}</dl><p class="crew-hint">Floor and structure materials are separate. Gaps, open doors and stair openings bypass solid insulation. Dismantling returns half the structure’s cost, rounded down for each resource.</p></details>`;
}
