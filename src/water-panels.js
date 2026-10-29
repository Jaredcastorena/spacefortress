import { waterSupply, ICE_EXTRACTION_AMOUNT } from './water.js';
import { IMPACT_ORE_AMOUNT } from './extraction.js';
export function depositDetails(t) {
  if (!t.deposit) return '';
  if(t.deposit.resource==='ore')return `<hr><div class="eyebrow">IMPACT ORE · FLOOR ${t.z??0}</div><dl><dt>Unmined ore</dt><dd>${t.deposit.remaining} units</dd><dt>Next extraction</dt><dd>${Math.min(IMPACT_ORE_AMOUNT,t.deposit.remaining)} units</dd></dl><p class="crew-hint">${t.deposit.remaining?'A miner recovers the finite reserve into a pile on this floor. Extraction preserves the structure and terrain underneath. Haul the ore to a refinery.':'This impact reserve is exhausted.'}</p>`;
  return `<hr><div class="eyebrow">ICE RESERVE</div><dl><dt>Unmined ice</dt><dd>${t.deposit.remaining} units</dd><dt>Next extraction</dt><dd>${Math.min(ICE_EXTRACTION_AMOUNT,t.deposit.remaining)} units</dd></dl><p class="crew-hint">${t.deposit.remaining ? 'Mining leaves a physical pile. Haul it to a depot, then supply an ice processor to make water. This seam is finite.' : 'This seam is exhausted. Search other seams or bring ice back from the comet.'}</p>`;
}
export function waterSupplyDetails(s) {
  const water = waterSupply(s);
  return `<hr><div class="eyebrow">WATER SUPPLY</div><dl><dt>Water in depots</dt><dd>${Number(water.storedWater.toFixed(2))}</dd><dt>Ice in depots</dt><dd>${Number(water.storedIce.toFixed(2))}</dd><dt>Surface ice remaining</dt><dd>${water.unminedIce}</dd><dt>Intact ice processors</dt><dd>${water.processors}</dd></dl><p class="crew-hint">Mine the blue seams southeast of the habitat, haul the ice, and process it into water. Crops, medicine, nutrient recycling and atmosphere production share this supply. Processing needs workers, wired power and output space. Surface seams are finite; comet expeditions can bring more.</p>`;
}
