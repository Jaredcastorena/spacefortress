// Canonical, bounded identities shared by people and their crafted products.
export const MAX_CREW = 64;
export const validCrewId = id => typeof id === 'string' && /^crew-(0|[1-9]\d*)$/.test(id) && Number(id.slice(5)) < MAX_CREW;

// Manufactured goods cannot predate the creator's arrival in this colony.
export function crewStartTicks(s) {
  const arrivals = Array.isArray(s.population?.arrivals) ? s.population.arrivals : [];
  return new Map(s.crew.map(c => [c.id, Number(c.id.slice(5)) < 7 ? 0
    : arrivals.find(arrival => arrival.crew === c.id)?.tick ?? Infinity]));
}
