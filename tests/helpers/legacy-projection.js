// Remove only the ownership fields introduced by schema 37. Genuine fixture
// bytes stay untouched; their pre-existing state must still compare exactly.
export function projectPreOutpost(state, version = 36) {
  const projected = structuredClone(state);
  projected.version = version;
  delete projected.outposts;
  if (projected.shuttle) delete projected.shuttle.freight;
  if (projected.mission) delete projected.mission.returnCrew;
  for (const site of Object.values(projected.sites)) {
    for (const tile of site.tiles) delete tile.imports;
  }
  return projected;
}
