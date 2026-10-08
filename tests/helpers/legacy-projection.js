// Project synthetic current games to the fields that actually existed before
// schema39. Never relax the loader's rejection of forged older-save fields.
export function projectPreAirlock(state, version = state.version) {
  const projected = structuredClone(state);
  projected.version = version;
  if(version>=39)return projected;
  for (const crew of projected.crew) delete crew.airlockTraversal;
  for (const site of Object.values(projected.sites)) for (const tile of site.tiles) {
    delete tile.airlock; delete tile.airlockOwner;
    if (tile.pipe) delete tile.pipe.airlockOwner;
  }
  return projected;
}
// Remove only the ownership fields introduced by schema 37. Genuine fixture
// bytes stay untouched; their pre-existing state must still compare exactly.
export function projectPreOutpost(state, version = 36) {
  const projected = projectPreAirlock(state, version);
  projected.version = version;
  delete projected.outposts;
  if (projected.shuttle) delete projected.shuttle.freight;
  if (projected.mission) delete projected.mission.returnCrew;
  for (const site of Object.values(projected.sites)) {
    for (const tile of site.tiles) delete tile.imports;
  }
  return projected;
}
