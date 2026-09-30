import { spill, add } from './inventory.js';
import { breathable, roomAt, moveCrew } from './atmosphere.js';
import { thermalSafe } from './thermal.js';
import { immobile } from './mobility.js';
import { remember } from './crew.js';
import { injure } from './medicine.js';

export const SANITARY_CAPACITY = 8;
export const SANITARY_VISIT = 6;
export const SANITARY_GRACE = 120;
const tileAt = (site, c) => site.tiles[c.y * site.size + c.x];
export function initializeSanitation(s) {
  for (const c of s.crew) c.sanitation ??= { waste: 0, wait: 0, exposure: 0 };
}
// The recoverable half of a ration stays with its eater until a sanitary visit.
export function digestPortion(c) { c.sanitation.waste += 1 / 16; }
export function dropSanitation(s, c) {
  if (c.site === 'transit') return;
  spill(tileAt(s.sites[c.site], c), { waste: c.sanitation.waste });
  c.sanitation.waste = 0; c.sanitation.wait = 0;
}
// Derived directly from physical owners, so room edits and hauling cannot leave stale pollution.
export function exposedWaste(s, site, room = null, tile = null) {
  const cells = room ? new Set(room.cells) : null;
  const includes = t => cells ? cells.has(`${t.x},${t.y}`) : tile && tile.x === t.x && tile.y === t.y;
  let total = 0;
  for (const t of site.tiles) if (includes(t)) {
    total += (t.drop?.waste || 0) + (t.stock?.waste || 0) + (t.imports?.waste || 0);
    if (t.building === 'sanitary' && t.hp <= 0) total += t.sanitary?.output.waste || 0;
  }
  // Ordinary shipments are sealed while carried; damaged tanks and bulk stores are not.
  for (const j of s.jobs) if (j.site === site.id) {
    if (includes(j)) total += j.materials.waste || 0;
    for (const source of j.sources) if (includes(source)) total += source.items.waste || 0;
  }
  return total;
}
export function updateSanitation(s) {
  for (const c of s.crew) {
    if (c.site === 'transit') continue;
    if (c.health <= 0) { dropSanitation(s, c); continue; }
    const n = c.sanitation, site = s.sites[c.site], room = roomAt(site, c.x, c.y);
    if (n.waste >= .5) {
      n.wait++;
      if (n.wait >= SANITARY_GRACE) {
        dropSanitation(s, c);
        if (c.intent?.type === 'sanitation') c.intent = null;
        remember(s, c, 'sanitation-accident', 'Could not reach an available sanitary unit in time.', -7);
      }
    } else n.wait = 0;
    const waste = exposedWaste(s, site, room, c);
    // Sealed suits isolate room exposure in an unbreathable environment.
    const dose = room && breathable(room) ? Math.min(1, waste / room.volume * 2) : 0;
    n.exposure = Math.max(0, Math.min(100, n.exposure + (dose || -.2)));
    if (n.exposure >= 40 && dose) {
      c.life.stress = Math.min(100, c.life.stress + dose * .1);
      remember(s, c, 'dirty-habitat', 'Living spaces are contaminated by uncollected waste.', -5);
    }
    if (n.exposure >= 80 && dose) injure(s, c, .01, 'unsanitary exposure');
  }
}
export function sanitaryBlock(s, site, t, c = null) {
  if (t?.building !== 'sanitary' || !t.sanitary) return 'Sanitary unit no longer exists';
  if (!t.hp) return 'Needs repair; tank seal broken';
  if (!breathable(roomAt(site, t.x, t.y)) || !thermalSafe(roomAt(site, t.x, t.y))) return 'Needs safe air and temperature';
  if (s.jobs.some(j => j.site === site.id && j.x === t.x && j.y === t.y)) return 'Reserved for construction or service';
  if (SANITARY_CAPACITY - (t.sanitary.output.waste || 0) < (c?.sanitation.waste || .5)) return 'Tank full; needs hauling';
  if (s.crew.some(other => other !== c && other.health > 0 && other.site === site.id && other.intent?.type === 'sanitation' && other.intent.target?.[0] === t.x && other.intent.target?.[1] === t.y)) return 'In use';
  return null;
}
export function useSanitation(s, c, site, pathTo, release) {
  if (c.site !== site.id || immobile(c) || c.medical.bed || c.rescue) return false;
  if (c.intent && !['sanitation', 'haul', 'leisure'].includes(c.intent.type)) return false;
  if (c.sanitation.waste < .5 && c.intent?.type !== 'sanitation') return false;
  let target = c.intent?.type === 'sanitation' && c.intent.target ? site.tiles[c.intent.target[1] * site.size + c.intent.target[0]] : null;
  if (target && (sanitaryBlock(s, site, target, c) || pathTo(site, c, [[target.x, target.y]]) === null)) { c.intent = null; target = null; }
  if (!target) {
    const options = site.tiles.filter(t => t.building === 'sanitary' && !sanitaryBlock(s, site, t, c)).map(t => ({ t, route: pathTo(site, c, [[t.x, t.y]]) })).filter(o => o.route !== null).sort((a, b) => a.route.length - b.route.length);
    target = options[0]?.t;
    if (!target) return false; // Keep doing useful work until a facility becomes available.
    release(s, c); c.intent = { type: 'sanitation', target: [target.x, target.y], remaining: SANITARY_VISIT };
  }
  const route = pathTo(site, c, [[target.x, target.y]]);
  if (route.length) { moveCrew(c, site, route[0]); c.activity = 'Going to sanitary unit'; return true; }
  c.activity = 'Using sanitary unit';
  if (--c.intent.remaining === 0) {
    add(target.sanitary.output, { waste: c.sanitation.waste }); c.sanitation.waste = 0; c.sanitation.wait = 0;
    c.intent = null; remember(s, c, 'sanitary-visit', 'Had access to a clean sanitary facility.', 3);
  }
  return true;
}
export function validateSanitation(s) {
  const claims = new Set();
  for (const c of s.crew) {
    const n = c.sanitation;
    if (!n || !Number.isFinite(n.waste) || n.waste < 0 || n.waste > 16 || !Number.isInteger(n.wait) || n.wait < 0 || n.wait >= SANITARY_GRACE || !Number.isFinite(n.exposure) || n.exposure < 0 || n.exposure > 100) throw new Error('Invalid crew sanitation.');
    if (c.intent?.type === 'sanitation') {
      const i = c.intent, claim = `${c.site}/${i.target?.join(',')}`;
      if (!i.target || !Number.isInteger(i.remaining) || i.remaining < 1 || i.remaining > SANITARY_VISIT || claims.has(claim)) throw new Error('Invalid sanitary reservation.');
      claims.add(claim);
    }
  }
  for (const site of Object.values(s.sites)) for (const t of site.tiles) {
    if (t.building !== 'sanitary') { if (t.sanitary !== undefined) throw new Error('Tank attached to missing sanitary unit.'); continue; }
    const output = t.sanitary?.output;
    if (!output || typeof output !== 'object' || Array.isArray(output) || Object.keys(output).some(r => r !== 'waste') || (output.waste !== undefined && (!Number.isFinite(output.waste) || output.waste < 0 || output.waste > SANITARY_CAPACITY))) throw new Error('Invalid sanitary tank.');
  }
}
