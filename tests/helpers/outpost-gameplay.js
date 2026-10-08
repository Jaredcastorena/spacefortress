import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { writeFileSync } from 'node:fs';
import { createGame, at, serialize, deserialize } from '../../src/simulation.js';
import { executeAction } from '../../src/controls.js';
import { totalResources } from '../../src/inventory.js';
import { temperature } from '../../src/thermal.js';
import { expeditionCrewStatus } from '../../src/expedition-readiness.js';
import { constructionResources } from '../../src/construction.js';
import { BUILDINGS } from '../../src/data.js';
import { outpostReadiness } from '../../src/outpost-readiness.js';

// Partial ordinary-play scaffolding; a complete journey is not yet accepted.
// Every mutation uses the public dispatcher;
// these helpers never grant inventory, alter crew, or install fixture buildings.
export { createGame, at, serialize, deserialize };
export const TEAM = ['crew-2', 'crew-4'];
export const person = (s, id) => s.crew.find(c => c.id === id);
export const job = (s, id) => s.jobs.find(j => j.id === id);
const traces = new WeakMap();
const clip = (value, limit = 160) => {
  const text = String(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};
// Preview only a few fields: large labels, arguments and diagnostic descriptions
// must never turn a failed assertion into a dump of the colony.
function preview(value, depth = 0) {
  if (typeof value === 'string') return clip(value);
  if (value === null || typeof value !== 'object') return clip(value);
  if (depth >= 2) return Array.isArray(value) ? `[${value.length} items]` : '[object]';
  const keys = Object.keys(value).slice(0, 4);
  return Object.fromEntries(keys.map(key => [clip(key, 80), preview(value[key], depth + 1)]).concat(
    Object.keys(value).length > keys.length ? [['…', 'more fields']] : []));
}
const describe = value => clip(JSON.stringify(preview(value)), 400);
export function diagnosticSummary(s) {
  const sites = Object.values(s.sites ?? {});
  return {
    tick: preview(s.tick), crew: s.crew?.length ?? 0, jobs: s.jobs?.length ?? 0,
    sites: sites.length, rooms: sites.reduce((n, site) => n + (site.rooms?.length ?? 0), 0),
    outposts: Object.keys(s.outposts ?? {}).length,
    mission: preview(s.mission?.phase ?? null), resources: preview(s.resources ?? {}),
    blocked: (s.jobs ?? []).filter(j => j.blockedReason || j.blocked).slice(0, 2)
      .map(j => ({ id: preview(j.id), reason: preview(j.blockedReason ?? j.blocked) })),
  };
}
function fail(s, message, options, extra = {}) {
  let artifact = '';
  if (options?.artifactPath !== undefined) {
    const path = options.artifactPath;
    try {
      if (typeof path !== 'string' || !path || /^[a-z]+:\/\//i.test(path)) throw new Error('Expected a local file path');
      writeFileSync(path, JSON.stringify({ diagnostic: diagnostic(s), actions: traces.get(s) ?? [], ...extra }, null, 2));
      artifact = `; artifact=${clip(path, 160)}`;
    } catch (error) {
      artifact = `; artifact failed: ${clip(error.message, 160)}`;
    }
  }
  assert.fail(`${clip(message, 1200)}${artifact}`);
}
function firstDifference(expected, actual, path = '$') {
  if (isDeepStrictEqual(expected, actual)) return null;
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      const childPath = clip(`${path}.${clip(key, 80)}`, 240);
      if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) {
        return `${childPath}: expected ${Object.hasOwn(expected, key) ? describe(expected[key]) : '<missing>'}, actual ${Object.hasOwn(actual, key) ? describe(actual[key]) : '<missing>'}`;
      }
      const difference = firstDifference(expected[key], actual[key], childPath);
      if (difference) return difference;
    }
  }
  return `${clip(path, 240)}: expected ${describe(expected)}, actual ${describe(actual)}`;
}
export function traceActions(s) {
  const trace = [];
  traces.set(s, trace);
  return trace;
}
export function act(s, id, args = {}, options) {
  const result = executeAction(s, id, args, 'test');
  if (!result.ok) fail(s, `${clip(id)} args=${describe(args)} at tick ${clip(s.tick)}: ${describe(result)}`, options, { action: { id, args, result } });
  traces.get(s)?.push({ id, args: structuredClone(args) });
  return result;
}
export const advance = (s, ticks = 1) => act(s, 'simulation.step', { ticks });
export function diagnostic(s) {
  return {
    tick: s.tick, resources: totalResources(s), departure: s.departure, mission: s.mission,
    freight: s.shuttle.freight, outposts: s.outposts,
    rooms: Object.fromEntries(Object.values(s.sites).map(site => [site.id, site.rooms.map(r => ({ cells:r.cells, sealed:r.sealed, temperature:temperature(r), air:r.air, gas:r.gas }))])),
    jobs: s.jobs.map(j => ({ id:j.id, kind:j.kind, building:j.building, site:j.site, x:j.x, y:j.y, worker:j.worker, remaining:j.remaining, blocked:j.blockedReason, materials:j.materials })),
    crew:s.crew.map(c => ({ id:c.id, site:c.site, x:c.x, y:c.y, health:c.health, injury:c.medical.injury, oxygen:c.oxygen, energy:c.energy, hunger:c.hunger, activity:c.activity, intent:c.intent, carry:c.carry })),
  };
}
export function until(s, predicate, label, limit = 300, options) {
  for (let i = 0; i < limit && !predicate(s); i++) advance(s);
  if (!predicate(s)) fail(s, `${clip(label)}: predicate unsatisfied after limit=${clip(limit)}; ${clip(JSON.stringify(diagnosticSummary(s)), 800)}`, options);
  return s;
}
export function checkpoint(s, label, ticks = 3, options) {
  const restored = deserialize(serialize(s));
  if (!isDeepStrictEqual(restored, s)) fail(s, `${clip(label)}: exact reload at tick ${clip(s.tick)}; ${firstDifference(s, restored)}`, options, { expected: s, actual: restored });
  advance(s, ticks); advance(restored, ticks);
  if (!isDeepStrictEqual(restored, s)) fail(s, `${clip(label)}: deterministic ${clip(ticks)}-tick continuation at tick ${clip(s.tick)}; ${firstDifference(s, restored)}`, options, { expected: s, actual: restored });
  return restored;
}
export const order = (s, site, x, y, kind, building) => act(s, 'job.order', {site, x, y, kind, ...(building === undefined ? {} : {building})}).job;
export function build(s, site, x, y, building, limit = 240) {
  until(s,current => Object.entries(BUILDINGS[building].cost).every(([r,n]) => constructionResources(current,site)[r] >= n), `Finite ${site} ${building} materials available`, limit);
  const id = order(s, site, x, y, 'build', building);
  until(s, current => !job(current, id), `${site} ${building} ${x},${y}`, limit);
  assert.ok(building === 'floor' ? at(s.sites[site],x,y).terrain === 'floor' : building === 'cable' ? at(s.sites[site],x,y).cable : at(s.sites[site],x,y).building === building);
  return id;
}
export const labor = (s, id, name, enabled) => act(s, 'crew.labor', {crew:id, labor:name, enabled});
export function launch(s, team = TEAM) {
  until(s, current => team.every(id => expeditionCrewStatus(person(current,id)).eligible), 'Chosen crew physically ready', 400);
  act(s, 'expedition.launch', {site:'wreck', crewIds:team});
  until(s, current => current.mission?.phase === 'working', 'Physically supplied wreck arrival', 400);
  assert.deepEqual(s.mission.crew, team);
}
export function freight(s, items) {
  until(s,current => Object.entries(items).every(([r,n]) => constructionResources(current)[r] >= n), 'Finite freight stock produced and locally available', 400);
  const id = act(s,'freight.load',{items}).job;
  until(s, current => !job(current,id), 'Freight physically loaded', 300);
  assert.ok(Object.entries(items).every(([r,n]) => s.shuttle.freight[r] >= n - 1e-8));
}
export function unload(s, items) {
  const id = act(s,'freight.unload',{site:'wreck', ...(items ? {items} : {})}).job;
  until(s, current => !job(current,id), 'Freight physically unloaded', 160);
}
export function home(s) {
  act(s, 'expedition.recall');
  until(s, current => !current.mission, 'Physical surface return', 120);
}
export function prepareSurface(s = createGame()) {
  // Paid early water extraction avoids consuming the last starting water while
  // the first pair is away. The medical cot waits for recovered components.
  act(s,'production.priority',{site:'surface',x:13,y:10,priority:5});
  act(s,'power.priority',{site:'surface',x:13,y:10,priority:5});
  act(s,'production.order',{site:'surface',x:7,y:9,mode:'stock',limit:24});
  // Finish the pressure boundary before repeated outside deliveries. Building
  // utilities first loses the starting room gas and consumes the water reserve
  // replacing it, despite otherwise identical equipment and material costs.
  const floors = [[10,13],[11,13]].map(([x,y]) => order(s,'surface',x,y,'build','floor'));
  until(s,current => floors.every(id => !job(current,id)), 'Surface airlock floors', 200);
  const shell = [[9,13,'wall'],[10,14,'wall'],[11,14,'wall'],[12,13,'door']]
    .map(([x,y,b]) => order(s,'surface',x,y,'build',b));
  until(s,current => shell.every(id => !job(current,id)), 'Complete airlock before exterior hauling', 100);
  const early = [[8,9,'atmosphere'],[13,9,'iceProcessor'],[9,10,'trap'],[6,14,'solar']]
    .map(([x,y,b]) => order(s,'surface',x,y,'build',b));
  early.push(...[[4,10],[4,11],[17,7],[17,14],[18,14],[17,15]]
    .map(([x,y]) => order(s,'surface',x,y,'mine')));
  until(s,current => early.every(id => !job(current,id)), 'Paid home utilities', 300);
  return s;
}

export function buildWarmingOutpost(s) {
  freight(s,{alloy:18}); launch(s); unload(s);
  for (const id of TEAM) labor(s,id,'hauling',false);
  const mines = [[5,6],[7,7],[12,6],[12,10],[8,10]].map(([x,y]) => order(s,'wreck',x,y,'mine'));
  until(s,current => mines.every(id => !job(current,id)), 'Five finite wreck salvage deposits', 200);
  for (const r of [...s.shuttle.accepted]) act(s,'expedition.cargo',{resource:r,enabled:r==='components'});
  build(s,'wreck',13,8,'floor'); build(s,'wreck',13,8,'climate');
  act(s,'climate.configure',{site:'wreck',x:13,y:8,target:35,enabled:true});
  build(s,'wreck',11,9,'stockpile');
  act(s,'depot.accept',{site:'wreck',x:11,y:9,resource:'components',enabled:false});
  for (const id of TEAM) labor(s,id,'hauling',true);
  until(s,current => !at(current.sites.wreck,12,6).drop, 'Clear west hull footprint by hauling', 160);
  for (const [x,y] of [[13,6],[13,7]]) build(s,'wreck',x,y,'floor');
  for (const [x,y] of [[12,6],[12,7],[12,8]]) build(s,'wreck',x,y,'wall');
  build(s,'wreck',13,9,'door'); build(s,'wreck',13,10,'solar'); build(s,'wreck',13,9,'cable');
  assert.equal(s.mission.cargo.components,14);
  home(s);
  return s;
}

export function completeHabitatStructures(s, team) {
  freight(s,{alloy:16,components:2}); launch(s,team); unload(s);
  act(s,'depot.accept',{site:'wreck',x:11,y:9,resource:'components',enabled:true});
  act(s,'expedition.cargo',{resource:'components',enabled:false});
  for (const [x,y,building] of [[13,6,'bunk'],[13,7,'scrubber'],[13,11,'solar'],[12,10,'floor'],[12,10,'battery']]) {
    build(s,'wreck',x,y,building);
    if (building === 'scrubber') act(s,'production.enable',{site:'wreck',x,y,enabled:false});
  }
  home(s);
  return s;
}

// Measured continuation from the first return. The larger hold combines paid
// equipment with a first provision shipment; these sixteen gas units alone do
// not pressurize the three-floor habitat or qualify it for residence.
export function supplyHabitatStructures(s) {
  for (const c of s.crew) act(s,'crew.routine',{crew:c.id,policy:'work'});
  freight(s,{air:16,food:2});
  act(s,'production.enable',{site:'surface',x:7,y:9,enabled:false});
  for (const [x,y] of [[3,12],[18,8],[19,8],[17,14],[18,14],[17,15],[18,15],[17,16],[18,16]])
    order(s,'surface',x,y,'mine');
  build(s,'surface',12,10,'medicalCot');
  build(s,'surface',14,13,'stockpile');
  for (const resource of Object.keys(constructionResources(s)))
    act(s,'depot.accept',{site:'surface',x:14,y:13,resource,enabled:resource==='waste'});
  act(s,'depot.priority',{site:'surface',x:14,y:13,priority:5});
  act(s,'depot.accept',{site:'surface',x:8,y:10,resource:'waste',enabled:false});
  build(s,'surface',8,7,'reactor');
  act(s,'reactor.configure',{site:'surface',x:8,y:7,percent:10,enabled:true});
  until(s,current => constructionResources(current).alloy>=8,'Paid cargo fit materials',300);
  const refit = order(s,'surface',16,11,'refit','cargo');
  until(s,current => !job(current,refit),'Physically fitted larger cargo hold',200);
  freight(s,{alloy:16,components:2});
  for (const [x,y] of [[13,10],[7,9]])
    act(s,'production.enable',{site:'surface',x,y,enabled:false});
  until(s,current => current.crew.every(c => c.site==='surface'&&c.x>=7&&c.x<=13&&c.y>=7&&c.y<=11),
    'Everyone indoors before sealing for recovery',200);
  act(s,'door.mode',{site:'surface',x:12,y:13,mode:'closed'});
  until(s,current => current.crew.every(c=>c.oxygen>=90)&&current.crew.filter(c=>expeditionCrewStatus(c).eligible&&c.energy>=55).length>=2,
    'All suits recover and two eligible crew finish resting',800);
  act(s,'door.mode',{site:'surface',x:12,y:13,mode:'auto'});
  const team = s.crew.filter(c=>expeditionCrewStatus(c).eligible&&c.energy>=55)
    .sort((a,b)=>b.energy-a.energy).slice(0,2).map(c=>c.id);
  launch(s,team); unload(s);
  act(s,'depot.accept',{site:'wreck',x:11,y:9,resource:'components',enabled:true});
  act(s,'expedition.cargo',{resource:'components',enabled:false});
  for (const [x,y,building] of [[13,6,'bunk'],[13,7,'scrubber'],[13,11,'solar'],[12,10,'floor'],[12,10,'battery']]) {
    build(s,'wreck',x,y,building);
    if (building==='scrubber') act(s,'production.enable',{site:'wreck',x,y,enabled:false});
  }
  home(s);
  return s;
}

// This stage is kept separate so the actual startup and ongoing supply costs
// remain visible. Seven shipped water makes at most seventy breathing mix.
// Experimental continuation; not a verified commissioning recipe.
export function produceRemoteAir(s, team) {
  freight(s,{alloy:9,components:2,water:7}); launch(s,team); unload(s);
  build(s,'wreck',12,11,'floor'); build(s,'wreck',12,11,'atmosphere');
  until(s,current => at(current.sites.wreck,12,11).machine.completed >= 7,
    'Seven paid local breathing-mix batches', 500);
  act(s,'production.enable',{site:'wreck',x:12,y:11,enabled:false});
  until(s,current => current.sites.wreck.rooms.some(r => r.cells.includes('13,6') && temperature(r) >= 5),
    'Habitat reaches a measured safe temperature before pressurization', 600);
  act(s,'production.enable',{site:'wreck',x:13,y:7,enabled:true});
  return s;
}
