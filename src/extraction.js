// Finite terrain reserves are separate from extracted, haulable inventory.
// This module only changes the source; callers own work, piles and events.
export const ICE_SEAM_CAPACITY = 12;
export const ICE_EXTRACTION_AMOUNT = 6;
export const IMPACT_ORE_CAPACITY = 12;
export const IMPACT_ORE_AMOUNT = 3;
export const iceAvailable = tile => !!tile&&!tile.building&&tile.deposit?.resource==='ice'&&tile.deposit.remaining>0;
export const reserveBlocksBuilding=(tile,building)=>tile?.deposit?.remaining>0&&!['cable','gasPipe','waterPipe'].includes(building);
export function extractionStatus(tile) {
  if(!tile||tile.terrain==='void')return null;
  const reserve=tile.deposit;
  if(reserve?.remaining>0&&(reserve.resource==='ore'||iceAvailable(tile))){
    const amount=Math.min(reserve.resource==='ice'?ICE_EXTRACTION_AMOUNT:IMPACT_ORE_AMOUNT,reserve.remaining);
    return {source:'deposit',kind:reserve.resource,work:7,output:{[reserve.resource]:amount},remaining:reserve.remaining};
  }
  if(tile.building==='salvage')return {source:'building',kind:'salvage',work:12,output:{components:3,alloy:2}};
  if(tile.building==='volatile')return {source:'building',kind:'volatile',work:7,output:{ice:12,fuel:3}};
  if(!tile.building&&['rock','ore'].includes(tile.terrain))return {source:'terrain',kind:tile.terrain,work:7,output:{ore:tile.terrain==='ore'?5:2}};
  return null;
}
export function extractTile(tile) {
  const result=extractionStatus(tile);if(!result)return null;
  if(result.source==='deposit'){tile.deposit.remaining-=result.output[result.kind];result.remaining=tile.deposit.remaining;}
  else if(result.source==='building')tile.building=null;
  else tile.terrain='ground';
  return result;
}
// A strike retains three ore units. Keep ice and capped reserves intact; their
// overflow is already fragmented and becomes a loose pile. Void retains none.
export function depositImpactOre(tile) {
  if(!tile||tile.terrain==='void')return {retained:0,loose:0,lost:IMPACT_ORE_AMOUNT};
  tile.deposit??={resource:'ore',remaining:0};
  const retained=tile.deposit.resource==='ore'?Math.min(IMPACT_ORE_AMOUNT,IMPACT_ORE_CAPACITY-tile.deposit.remaining):0;
  if(retained>0)tile.deposit.remaining+=retained;
  return {retained,loose:IMPACT_ORE_AMOUNT-retained,lost:0};
}
export function validateDeposits(s) {
  for(const site of Object.values(s.sites))for(const tile of site.tiles){
    if(tile.deposit===undefined)continue;const d=tile.deposit;
    if(!d||Array.isArray(d)||Object.keys(d).length!==2||!['ice','ore'].includes(d.resource)||!Number.isInteger(d.remaining)||d.remaining<0||d.remaining>(d.resource==='ice'?ICE_SEAM_CAPACITY:IMPACT_ORE_CAPACITY))throw new Error('Invalid mineral reserve.');
    if(d.resource==='ice'&&(!['surface','comet'].includes(site.id)||!['ground','floor','ice'].includes(tile.terrain)||d.remaining>0&&tile.building))throw new Error('Invalid ice reserve.');
    if(d.resource==='ore'&&!['ground','floor','ice','rock','ore'].includes(tile.terrain))throw new Error('Invalid impact ore reserve.');
  }
}
