import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, serialize } from '../src/simulation.js';
import { executeAction, controlBindings, actionCatalog, createAgentInterface } from '../src/controls.js';
import { populationStatus, RECRUITMENT } from '../src/population.js';
import { MAX_CREW } from '../src/crew-identity.js';
import { recruitmentDetails, restoreRecruitmentFocus } from '../src/population-panels.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const contact = s => executeAction(s, 'population.contact');
const respond = (s, accept) => executeAction(s, 'population.respond', { offer: s.population.offer.id, accept });
const pad = s => s.sites.surface.tiles.find(t => t.building === 'shuttle' && (t.z ?? 0) === 0);
const records = s => exportRecording(s).trim().split('\n').map(JSON.parse);

test('recruitment catalog and player bindings share strict commands and timing definitions', () => {
  const catalog = actionCatalog();
  assert.equal(catalog.find(action => action.id === 'outpost.residents').parameters.properties.crewIds.maxItems, MAX_CREW);
  assert.equal(catalog.find(action => action.id === 'expedition.launch').parameters.properties.crewIds.maxItems, 2);
  assert.deepEqual(catalog.find(action => action.id === 'population.contact').parameters, {
    type: 'object', properties: {}, required: [], additionalProperties: false,
  });
  const response = catalog.find(action => action.id === 'population.respond').parameters;
  assert.deepEqual(response.required, ['offer', 'accept']);
  assert.equal(response.properties.offer.type, 'string');
  assert.deepEqual(response.properties.accept, { type: 'boolean' });
  assert.equal(response.additionalProperties, false);
  for (const accept of [true, false]) {
    const agent = createGame(251), player = structuredClone(agent), resources = structuredClone(agent.resources);
    const bindings = controlBindings(() => player);
    assert.equal(contact(agent).ok, true);
    assert.equal(bindings.contactRecruits(player).ok, true);
    assert.equal(serialize(player), serialize(agent));
    assert.equal(respond(agent, accept).ok, true);
    assert.equal(bindings.respondToRecruit(player, player.population.offer.id, accept).ok, true);
    assert.equal(serialize(player), serialize(agent));
    assert.deepEqual(agent.resources, resources);
    assert.equal(agent.crew.length, 7);
    assert.deepEqual(createAgentInterface(() => agent).definitions().recruitment, RECRUITMENT);
  }
});

test('malformed and stale recruitment commands leave the colony unchanged', () => {
  const s = createGame(251);
  let before = serialize(s);
  assert.equal(executeAction(s, 'population.contact', { extra: true }).ok, false);
  assert.equal(serialize(s), before);
  assert.equal(Object.hasOwn(s, 'population'), false);
  assert.equal(contact(s).ok, true);
  before = serialize(s);
  const offer = s.population.offer.id;
  for (const args of [{}, { offer }, { offer, accept: 'false' }, { offer, accept: 1 }, { offer: 1, accept: true }, { offer: 'recruit-999', accept: true }, { offer, accept: true, extra: true }]) {
    assert.equal(executeAction(s, 'population.respond', args).ok, false);
    assert.equal(serialize(s), before);
  }
  assert.equal(contact(s).ok, false);
  assert.equal(serialize(s), before);
  assert.equal(respond(s, true).ok, true);
  before = serialize(s);
  assert.equal(executeAction(s, 'population.respond', { offer, accept: true }).ok, false);
  assert.equal(serialize(s), before);
});

test('recruitment player controls retain typed action IDs and player recording source', () => {
  const s = createGame(251), bindings = controlBindings(() => s);
  startRecording(s);
  assert.equal(bindings.contactRecruits(s).ok, true);
  assert.equal(bindings.respondToRecruit(s, s.population.offer.id, false).ok, true);
  const requests = records(s).filter(row => row.kind === 'action.requested');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(row => row.action.id), ['population.contact', 'population.respond']);
  assert.ok(requests.every(row => row.action.source === 'player'));
});

test('initial recruitment details stay collapsed, local and read-only', () => {
  const s = createGame(251), before = serialize(s), status = populationStatus(s);
  const html = recruitmentDetails(s);
  assert.match(html, /<details data-panel-key="recruitment" data-recruitment><summary/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /7 living · 7 \/ 64 roster records/);
  assert.match(html, /data-action="recruit-contact" data-simulation-action="population.contact"/);
  assert.match(html, /Food stored · surface/);
  assert.ok(html.includes(`${Number(status.readiness.food.toFixed(1))} units`));
  assert.ok(html.includes(`${status.readiness.bunks} / ${status.readiness.neededBunks}`));
  assert.match(html, /Habitat warnings do not prevent landing/);
  assert.equal(recruitmentDetails(s, 'wreck'), '');
  assert.equal(recruitmentDetails(s, 'universe'), '');
  assert.equal(serialize(s), before);
  assert.equal(Object.hasOwn(s, 'population'), false);
  assert.match(app, /\$\{recruitmentDetails\(state\)\}/);
});

test('recruitment details show the candidate, landing gate, inbound timing and holding reason', () => {
  const s = createGame(251);
  assert.equal(contact(s).ok, true);
  let status = populationStatus(s), html = recruitmentDetails(s);
  assert.ok(html.includes(status.offer.name));
  assert.ok(html.includes(status.offer.role));
  assert.match(html, /Respond within 180s/);
  assert.ok(html.includes(`data-offer="${status.offer.id}"`));
  assert.match(html, /data-action="recruit-decline"[^>]*data-simulation-action="population.respond"/);
  const homePad = pad(s), hp = homePad.hp;
  homePad.hp = 0;
  html = recruitmentDetails(s);
  assert.match(html, /data-action="recruit-accept"[^>]*disabled/);
  assert.match(html, /The landing pad needs repair/);
  assert.doesNotMatch(html, /data-action="recruit-decline"[^>]*disabled/);
  homePad.hp = hp;
  assert.equal(respond(s, true).ok, true);
  html = recruitmentDetails(s);
  assert.match(html, /Traveler inbound/);
  assert.match(html, /Arrival in 30s/);
  assert.ok(html.includes(`Landing pad · ${homePad.x} / ${homePad.y} / 0`));
  assert.doesNotMatch(html, /data-action="recruit-(contact|accept|decline)"/);
  // Synthetic holding state isolates display from the arrival simulation tests.
  s.tick = s.population.offer.arrives;
  s.population.offer.blocked = 'pad_destroyed';
  homePad.hp = 0;
  const before = serialize(s);
  html = recruitmentDetails(s);
  assert.match(html, /Holding for a usable pad · diverts in 120s/);
  assert.match(html, /The landing pad needs repair/);
  assert.equal(serialize(s), before);
});

test('recruitment details explain cooldown and full roster without offering another contact', () => {
  const s = createGame(251);
  assert.equal(contact(s).ok, true);
  assert.equal(respond(s, false).ok, true);
  let html = recruitmentDetails(s);
  assert.match(html, /Next contact in 300s/);
  assert.match(html, /Offer declined/);
  assert.doesNotMatch(html, /data-action="recruit-contact"/);
  // Synthetic roster size tests the full-panel branch without simulating arrivals.
  const full = createGame(252);
  while (full.crew.length < 64) full.crew.push({ ...structuredClone(full.crew[0]), id: `crew-${full.crew.length}` });
  html = recruitmentDetails(full);
  assert.match(html, /Recruitment · Roster full/);
  assert.match(html, /64 living · 64 \/ 64 roster records/);
  assert.doesNotMatch(html, /data-action="recruit-contact"/);
});

test('actual recruitment clicks invoke one shared binding and preserve selection', () => {
  const source = app.slice(app.indexOf("$('inspector').onclick ="), app.indexOf('let pointer = null;'));
  for (const accept of [true, false]) {
    const s = createGame(251), inspector = { contains: () => true }, bindings = controlBindings(() => s), results = [], selected = null;
    let contacts = 0, responses = 0;
    const context = { $: () => inspector, deckView: { matches: () => true }, inspectorView: {}, state: s, selected,
      contactRecruits: (...args) => { contacts++; return bindings.contactRecruits(...args); },
      respondToRecruit: (...args) => { responses++; return bindings.respondToRecruit(...args); }, result: r => results.push(r) };
    vm.runInNewContext(source, context);
    inspector.onclick({ target: { closest: () => ({ dataset: { action: 'recruit-contact' } }) } });
    assert.equal(contacts, 1);
    assert.equal(results[0].ok, true);
    const offer = s.population.offer.id, resources = structuredClone(s.resources);
    inspector.onclick({ target: { closest: () => ({ dataset: { action: accept ? 'recruit-accept' : 'recruit-decline', offer } }) } });
    assert.equal(responses, 1);
    assert.equal(results[1].ok, true);
    assert.equal(context.selected, selected);
    assert.equal(s.crew.length, 7);
    assert.deepEqual(s.resources, resources);
  }
});

test('refresh preserves recruitment expansion and returns focus to a live control or summary', () => {
  const focused = [], control = (key, disabled = false) => ({ dataset: { recruitmentFocus: key }, disabled, focus: options => focused.push({ key, options }) });
  const summary = control('summary'), accept = control('accept'), decline = control('decline');
  let controls = [summary, accept, decline];
  const inspector = { querySelectorAll: () => controls };
  restoreRecruitmentFocus(inspector, 'accept');
  assert.deepEqual(focused.pop(), { key: 'accept', options: { preventScroll: true } });
  accept.disabled = true;
  restoreRecruitmentFocus(inspector, 'accept');
  assert.equal(focused.pop().key, 'summary');
  controls = [summary];
  restoreRecruitmentFocus(inspector, 'decline');
  assert.equal(focused.pop().key, 'summary');
  restoreRecruitmentFocus(inspector, null);
  assert.equal(focused.length, 0);
  assert.match(app, /openPanels\.get\(details\.dataset\.panelKey\)/);
  assert.match(app, /nextInspectorKey===inspectorKey\?document\.activeElement\.dataset\?\.recruitmentFocus:null/);
  assert.match(app, /restoreRecruitmentFocus\(\$\('inspector'\), recruitmentFocus\)/);
});
