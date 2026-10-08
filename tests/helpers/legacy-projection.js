// Historical square helpers remain for inspecting genuine old states. Never
// strip the topology marker or relabel a hex state as a legacy fixture.
export function projectPreAirlock(state, version = state.version) {
  if (state.grid === 'hex-odd-q-v1' && version < 40) throw new Error('Cannot project a hex colony into a legacy square save.');
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
