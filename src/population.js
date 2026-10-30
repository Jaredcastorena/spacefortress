import { ROLES } from './data.js';
import { MAX_CREW, validCrewId } from './crew-identity.js';
import { initializeCrew } from './crew.js';
import { initializeCrewLife } from './crew-life.js';
import { initializeMedicine } from './medicine.js';
import { initializeNursing } from './nursing.js';
import { initializeThermal, thermalSafe } from './thermal.js';
import { initializeFood } from './spoilage.js';
import { initializeSanitation } from './sanitation.js';
import { initializeHygiene } from './hygiene.js';
import { initializeHousing } from './housing.js';
import { initializeComfort } from './comfort.js';
import { initializePossessions } from './possessions.js';
import { roomAt, breathable } from './atmosphere.js';
import { livingAllowed } from './rooms.js';
import { roomTiles } from './room-locations.js';
import { passablePosition } from './navigation.js';
import { tileAt, positionOf, tileEntityId, validCellPosition } from './spatial.js';
import { stores } from './inventory.js';
import { emitEvent } from './telemetry.js';
import { log } from './simulation.js';

export const RECRUITMENT = Object.freeze({ offerWindow: 180, travelTicks: 30, holdingTicks: 120, cooldown: 300 });
const COLORS = ['#dfb06d', '#8dccc3', '#e89577', '#9cb778', '#a6a6de', '#df99ad', '#b4c0c8'];
const FIRST_NAMES = ['Etri', 'Sova', 'Kesh', 'Veli', 'Naro', 'Thessa', 'Ori', 'Zevra', 'Ilen', 'Moru', 'Tavi', 'Yessa'];
const LAST_NAMES = ['Tessik', 'Vaelor', 'Issara', 'Korrin', 'Nesh', 'Ulvai', 'Pelori', 'Dask', 'Venn', 'Ashal', 'Revik', 'Oru'];
const PAD_BLOCKS = ['pad_missing', 'pad_destroyed', 'pad_burning', 'pad_blocked'];
const MESSAGES = {
  pad_missing: 'A usable ground shuttle pad is required before contacting recruits.',
  pad_destroyed: 'Repair the ground shuttle pad before recruiting.',
  pad_burning: 'Extinguish the ground shuttle pad before recruiting.',
  pad_blocked: 'Clear the ground shuttle pad before recruiting.',
  roster_full: 'The crew registry has reached its limit, including deceased records.',
  offer_active: 'Resolve the current recruitment contact first.',
  cooldown: 'Wait for the next recruitment contact window.',
  stale_offer: 'That recruitment offer is no longer available.',
  invalid_response: 'Choose accept or decline for the current offer.',
};
const reject = code => ({ ok: false, code, message: MESSAGES[code] });
const offerNumber = id => typeof id === 'string' && /^recruit-[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id.slice(8))) ? Number(id.slice(8)) : null;
const target = p => p ? tileEntityId('surface', p.x, p.y, p.z) : null;

// A private hash derives identities without advancing the simulation's RNG.
function candidate(s, id) {
  let hash = 2166136261;
  for (const character of `${s.seed}:${id}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const profileIndex = hash % 7;
  return { name: `${FIRST_NAMES[(hash >>> 4) % FIRST_NAMES.length]} ${LAST_NAMES[(hash >>> 12) % LAST_NAMES.length]}`, role: ROLES[profileIndex], profileIndex, color: COLORS[profileIndex] };
}
function padBlock(site, landing) {
  const pad = landing && tileAt(site, landing);
  if (pad?.building !== 'shuttle' || landing.z !== 0) return 'pad_missing';
  if (!(pad.hp > 0)) return 'pad_destroyed';
  if (pad.fire) return 'pad_burning';
  return passablePosition(site, landing) ? null : 'pad_blocked';
}
function homePad(s) {
  const site = s.sites.surface;
  const pads = site.tiles.filter(t => t.z === 0 && t.building === 'shuttle').sort((a, b) => a.y - b.y || a.x - b.x);
  const pad = pads.find(t => padBlock(site, positionOf(t)) === null) || pads[0];
  const landing = pad ? positionOf(pad) : null;
  return { landing, blocked: padBlock(site, landing) };
}
function contactBlock(s, pad) {
  if (s.crew.length >= MAX_CREW) return 'roster_full';
  if (s.population?.offer) return 'offer_active';
  if (s.tick < (s.population?.cooldownUntil || 0)) return 'cooldown';
  return pad.blocked;
}
function resolve(s, outcome, crew = null) {
  const population = s.population, offer = population.offer;
  population.last = { offer: offer.id, outcome, tick: s.tick, crew };
  population.cooldownUntil = s.tick + RECRUITMENT.cooldown;
  population.offer = null;
}

export function contactRecruits(s) {
  const pad = homePad(s), blocked = contactBlock(s, pad);
  if (blocked) return reject(blocked);
  const population = s.population ?? { nextOffer: 1, cooldownUntil: 0, offer: null, arrivals: [], last: null };
  const id = `recruit-${population.nextOffer}`;
  population.offer = { id, phase: 'offered', created: s.tick, expires: s.tick + RECRUITMENT.offerWindow, accepted: null, arrives: null, deadline: null, landing: null, blocked: null };
  population.nextOffer++;
  s.population = population;
  const person = candidate(s, id);
  log(s, `${person.name}, a ${person.role.toLowerCase()}, is seeking a new colony. Review the recruitment contact.`, 'discovery');
  emitEvent(s, 'population.offer.opened', { offer: id, site: 'surface', target: target(pad.landing), landing: { ...pad.landing }, candidate: person, expires: population.offer.expires });
  return { ok: true, message: 'Recruitment contact opened.' };
}

export function respondToRecruit(s, offerId, accept) {
  if (typeof accept !== 'boolean') return reject('invalid_response');
  const offer = s.population?.offer;
  if (!offer || offer.id !== offerId || offer.phase !== 'offered' || s.tick >= offer.expires) return reject('stale_offer');
  if (!accept) {
    resolve(s, 'declined');
    log(s, 'Recruitment offer declined. Another contact will be available after the cooldown.');
    emitEvent(s, 'population.offer.declined', { offer: offer.id, site: 'surface', cooldownUntil: s.population.cooldownUntil });
    return { ok: true, message: 'Recruitment offer declined.' };
  }
  if (s.crew.length >= MAX_CREW) return reject('roster_full');
  const pad = homePad(s);
  if (pad.blocked) return reject(pad.blocked);
  offer.phase = 'inbound'; offer.accepted = s.tick;
  offer.arrives = s.tick + RECRUITMENT.travelTicks;
  offer.deadline = offer.arrives + RECRUITMENT.holdingTicks;
  offer.landing = pad.landing;
  log(s, `${candidate(s, offer.id).name} is inbound on an independent ferry. Keep the ground pad clear.`);
  emitEvent(s, 'population.arrival.accepted', { offer: offer.id, site: 'surface', target: target(offer.landing), landing: { ...offer.landing }, accepted: offer.accepted, arrives: offer.arrives, deadline: offer.deadline });
  return { ok: true, message: 'Recruit accepted; ferry inbound.' };
}

function arrivingPerson(s, offer) {
  const profile = candidate(s, offer.id), index = s.crew.length;
  const person = { id: `crew-${index}`, name: profile.name, role: profile.role, color: profile.color, site: 'surface', ...offer.landing, health: 100, hunger: 28, energy: 60, oxygen: 80, job: null, activity: 'Arrived at the colony', skill: 1 + (profile.profileIndex % 3) * .25 };
  initializeCrew(person, profile.profileIndex);
  // Initializers own/reset broad fields. Never pass the live colony to them.
  const shell = { crew: [person], sites: {}, jobs: [] };
  initializeCrewLife(shell); initializeMedicine(shell); initializeNursing(shell);
  initializeThermal(shell); initializeFood(shell); initializeSanitation(shell);
  initializeHygiene(shell); initializeHousing(shell); initializeComfort(shell); initializePossessions(shell);
  person.housing.preference = ['art', 'quiet', 'company'][profile.profileIndex % 3];
  person.airlockTraversal = null;
  return person;
}
export function updatePopulation(s) {
  const population = s.population, offer = population?.offer;
  if (!offer) return;
  if (offer.phase === 'offered') {
    if (s.tick < offer.expires) return;
    resolve(s, 'expired');
    log(s, 'The recruitment contact expired. The candidate continued their journey.');
    emitEvent(s, 'population.offer.expired', { offer: offer.id, site: 'surface', expires: offer.expires, cooldownUntil: population.cooldownUntil });
    return;
  }
  if (s.tick < offer.arrives) return;
  const blocked = padBlock(s.sites.surface, offer.landing);
  if (blocked !== offer.blocked) {
    offer.blocked = blocked;
    log(s, blocked ? 'Recruit ferry is holding: the planned landing pad is unavailable.' : 'The recruitment landing pad is available again.', blocked ? 'danger' : 'good');
    emitEvent(s, 'population.arrival.blocked', { offer: offer.id, site: 'surface', target: target(offer.landing), landing: { ...offer.landing }, reason: blocked, deadline: offer.deadline });
  }
  if (s.tick > offer.deadline || blocked && s.tick >= offer.deadline) {
    resolve(s, 'diverted');
    log(s, 'The recruit ferry diverted after its landing window closed. No crew or cargo arrived.', 'danger');
    emitEvent(s, 'population.arrival.diverted', { offer: offer.id, site: 'surface', target: target(offer.landing), landing: { ...offer.landing }, reason: blocked || 'holding_expired', deadline: offer.deadline, cooldownUntil: population.cooldownUntil });
    return;
  }
  if (blocked) return;
  const person = arrivingPerson(s, offer);
  for (const peer of s.crew) {
    peer.relationships[person.id] = { affinity: 0, interactions: 0, lastInteraction: null };
    person.relationships[peer.id] = { affinity: 0, interactions: 0, lastInteraction: null };
  }
  s.crew.push(person);
  population.arrivals.push({ offer: offer.id, crew: person.id, tick: s.tick, site: 'surface', ...offer.landing });
  resolve(s, 'arrived', person.id);
  log(s, `${person.name} arrived at the ground pad and joined the crew.`, 'good');
  emitEvent(s, 'crew.arrived', { offer: offer.id, actor: person.id, entity: person.id, site: 'surface', target: target(offer.landing), landing: { ...offer.landing }, profileIndex: candidate(s, offer.id).profileIndex, cooldownUntil: population.cooldownUntil });
}

function homeReadiness(s) {
  const site = s.sites.surface;
  const residents = new Set(Object.values(s.outposts || {}).flatMap(outpost => outpost.residents));
  const homeCrew = s.crew.filter(c => c.health > 0 && !residents.has(c.id)).length;
  const neededBunks = homeCrew + (s.crew.length < MAX_CREW ? 1 : 0);
  const stock = stores(s), food = stock.reduce((sum, t) => sum + (t.stock.food || 0), 0), air = stock.reduce((sum, t) => sum + (t.stock.air || 0), 0);
  const safe = t => t && !t.fire && passablePosition(site, positionOf(t)) && livingAllowed(site, t.x, t.y, t.z) && breathable(roomAt(site, t.x, t.y, t.z)) && thermalSafe(roomAt(site, t.x, t.y, t.z));
  const bunks = site.tiles.filter(t => t.building === 'bunk' && t.hp > 0 && safe(t)).length;
  const breathableShelter = site.rooms.some(room => breathable(room) && thermalSafe(room) && roomTiles(site, room).some(safe));
  const warnings = [];
  if (food < neededBunks) warnings.push('Stored food is below one ration per home crew member and the prospective arrival.');
  if (air < neededBunks * 5) warnings.push('Stored air is below five units per home crew member and the prospective arrival.');
  if (bunks < neededBunks) warnings.push(`Only ${bunks} safe bunks for ${neededBunks} home crew including a prospective arrival.`);
  if (!breathableShelter) warnings.push('No breathable shelter with safe temperature is available.');
  return { food, air, bunks, neededBunks, breathableShelter, warnings };
}
export function populationStatus(s) {
  const population = s.population, active = population?.offer, pad = homePad(s);
  const phase = active?.phase || (s.crew.length >= MAX_CREW ? 'full' : s.tick < (population?.cooldownUntil || 0) ? 'cooldown' : 'idle');
  const blocked = active?.phase === 'inbound' ? padBlock(s.sites.surface, active.landing) : active?.phase === 'offered' ? s.crew.length >= MAX_CREW ? 'roster_full' : pad.blocked : contactBlock(s, pad);
  const offer = active ? { ...active, ...candidate(s, active.id), landing: active.landing ? { ...active.landing } : null } : null;
  return { count: s.crew.length, living: s.crew.filter(c => c.health > 0).length, limit: MAX_CREW, phase,
    canContact: contactBlock(s, pad) === null, canAccept: !!(active?.phase === 'offered' && s.tick < active.expires && blocked === null),
    blocked, offer, last: population?.last ? { ...population.last } : null, cooldownUntil: population?.cooldownUntil || 0,
    readiness: homeReadiness(s), landing: active?.landing ? { ...active.landing } : pad.landing ? { ...pad.landing } : null };
}

const record = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fail = message => { throw new Error(`Invalid recruitment ${message}.`); };
export function validatePopulation(s) {
  if (!Array.isArray(s.crew) || s.crew.length < 7 || s.crew.length > MAX_CREW || s.crew.some((c, index) => !validCrewId(c.id) || c.id !== `crew-${index}`)) fail('roster');
  if (!Object.hasOwn(s, 'population')) {
    if (s.crew.length !== 7) fail('arrival history');
    return;
  }
  const p = s.population, past = value => integer(value) && value <= s.tick;
  if (!exact(p, ['nextOffer', 'cooldownUntil', 'offer', 'arrivals', 'last']) || !integer(p.nextOffer) || p.nextOffer < 2 || p.nextOffer - 2 > Math.floor(s.tick / RECRUITMENT.cooldown) || !integer(p.cooldownUntil)) fail('record');
  if (!Array.isArray(p.arrivals) || Object.keys(p.arrivals).length !== p.arrivals.length || p.arrivals.length !== s.crew.length - 7) fail('arrival history');
  let priorNumber = 0, priorTick = -RECRUITMENT.cooldown;
  for (const [index, arrival] of p.arrivals.entries()) {
    if (!exact(arrival, ['offer', 'crew', 'tick', 'site', 'x', 'y', 'z'])) fail('arrival record');
    const number = offerNumber(arrival.offer), landing = { x: arrival.x, y: arrival.y, z: arrival.z };
    if (!number || number <= priorNumber || number >= p.nextOffer || arrival.crew !== `crew-${index + 7}` || !past(arrival.tick) || arrival.tick < priorTick + (number - priorNumber) * RECRUITMENT.cooldown + RECRUITMENT.travelTicks || arrival.tick < (number - 1) * RECRUITMENT.cooldown + (index + 1) * RECRUITMENT.travelTicks || arrival.site !== 'surface' || arrival.z !== 0 || !validCellPosition(s.sites.surface, landing)) fail('arrival identity or chronology');
    priorNumber = number; priorTick = arrival.tick;
  }
  const last = p.last;
  if (last === null) {
    if (p.nextOffer !== 2 || p.cooldownUntil !== 0 || p.arrivals.length || p.offer === null) fail('initial contact');
  } else {
    if (!exact(last, ['offer', 'outcome', 'tick', 'crew']) || !offerNumber(last.offer) || !['declined', 'expired', 'arrived', 'diverted'].includes(last.outcome) || !past(last.tick) || p.cooldownUntil !== last.tick + RECRUITMENT.cooldown) fail('last outcome');
    const number = offerNumber(last.offer), arrival = p.arrivals.at(-1);
    const outcomeDelay = last.outcome === 'expired' ? RECRUITMENT.offerWindow : last.outcome === 'diverted' ? RECRUITMENT.travelTicks + RECRUITMENT.holdingTicks : 0;
    if (number !== p.nextOffer - (p.offer === null ? 1 : 2) || last.tick < (number - 1) * RECRUITMENT.cooldown + p.arrivals.length * RECRUITMENT.travelTicks + outcomeDelay) fail('outcome chronology');
    if (last.outcome === 'arrived') {
      if (!arrival || arrival.offer !== last.offer || arrival.crew !== last.crew || arrival.tick !== last.tick) fail('arrival outcome');
    } else if (last.crew !== null || arrival && (offerNumber(arrival.offer) >= number || arrival.tick + (number - offerNumber(arrival.offer)) * RECRUITMENT.cooldown + outcomeDelay > last.tick)) fail('nonarrival outcome');
  }
  const offer = p.offer;
  if (offer === null) return;
  if (!exact(offer, ['id', 'phase', 'created', 'expires', 'accepted', 'arrives', 'deadline', 'landing', 'blocked']) || offerNumber(offer.id) !== p.nextOffer - 1 || !['offered', 'inbound'].includes(offer.phase) || !past(offer.created) || !integer(offer.expires) || offer.expires !== offer.created + RECRUITMENT.offerWindow || offer.created < p.cooldownUntil || s.crew.length >= MAX_CREW || priorNumber >= offerNumber(offer.id)) fail('active offer');
  if (offer.phase === 'offered') {
    if (s.tick >= offer.expires || ['accepted', 'arrives', 'deadline', 'landing', 'blocked'].some(key => offer[key] !== null)) fail('unaccepted offer');
  } else if (!past(offer.accepted) || offer.accepted < offer.created || offer.accepted >= offer.expires || !integer(offer.arrives) || offer.arrives !== offer.accepted + RECRUITMENT.travelTicks || !integer(offer.deadline) || offer.deadline !== offer.arrives + RECRUITMENT.holdingTicks || s.tick >= offer.deadline || !validCellPosition(s.sites.surface, offer.landing) || offer.landing.z !== 0 || offer.blocked !== null && !PAD_BLOCKS.includes(offer.blocked) || s.tick < offer.arrives && offer.blocked !== null || s.tick >= offer.arrives && offer.blocked === null) fail('inbound flight');
}
