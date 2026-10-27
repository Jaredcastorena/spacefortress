import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { crewDetails, suitReleaseDetails, suitReleaseFormAction, createSuitReleaseView } from '../src/crew-panels.js';

const available = (maxPoints = 37) => ({ available: true, maxPoints, blockedCode: null, message: null, oxygenPerPoint: .1, destination: { site: 'site:surface', tile: 'tile:surface:8:9', room: 'room:surface:7:7' } });
const member = { id: 'crew-0' };

// Small DOM boundary doubles exercise the same view-memory methods used by app.js.
function panelFor(crew = 'crew-0', points = '10', open = true) {
  const focused = [];
  const fields = Object.fromEntries(['summary', 'points', 'release'].map(key => [key, {
    dataset: { suitReleaseFocus: key }, tagName: key === 'summary' ? 'SUMMARY' : key === 'points' ? 'INPUT' : 'BUTTON',
    value: points, disabled: false, focus: options => focused.push({ key, options })
  }]));
  const panel = { dataset: { crew }, open, contains: el => Object.values(fields).includes(el),
    querySelector: selector => selector === '[name="points"]' ? fields.points : null,
    querySelectorAll: () => Object.values(fields) };
  const other = {};
  const inspector = { querySelector: () => panel, contains: el => el === other || panel.contains(el) };
  return { inspector, panel, fields, focused, other };
}

test('emergency release is collapsed and shows bounded controls, warnings and its exact action', () => {
  const status = available(), before = structuredClone(status);
  const html = suitReleaseDetails(member, status);
  assert.match(html, /<summary[^>]*>Emergency oxygen<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.match(html, /spends this crew member’s suit reserve/);
  assert.match(html, /oxygen-rich and unsafe to breathe/);
  assert.match(html, /data-simulation-action="crew\.suit\.release"/);
  assert.match(html, /data-suit-release-form data-crew="crew-0"/);
  assert.match(html, /name="points" required min="1" max="37" step="1" value="10"/);
  assert.doesNotMatch(html, /disabled|type="checkbox"/);
  assert.match(suitReleaseDetails(member, available(3)), /max="3" step="1" value="3"/);
  assert.match(suitReleaseDetails(member, available(100)), /max="100" step="1" value="10"/);
  assert.deepEqual(status, before);
});

test('unavailable status disables release and displays the shared escaped reason', () => {
  for (const blockedCode of ['unknown_crew', 'dead', 'immobile', 'in_transit', 'no_site', 'no_sealed_room', 'insufficient_suit_oxygen', 'room_full']) {
    const status = { ...available(0), available: false, blockedCode, message: 'Shared reason <seal> & reserve' };
    const html = suitReleaseDetails(member, status, { points: '7' });
    assert.match(html, /data-suit-release-blocker/);
    assert.ok(html.includes(`data-blocked-code="${blockedCode}"`));
    assert.match(html, /Shared reason &lt;seal&gt; &amp; reserve/);
    assert.match(html, /<input[^>]*max="0"[^>]*value="7"[^>]* disabled>/);
    assert.match(html, /<button type="submit"[^>]* disabled>/);
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  }
});

test('rendering preserves blank, fractional and now oversized drafts for correction', () => {
  for (const points of ['', '2.5', '80']) {
    const draft = { points, open: true, focus: 'points' }, before = structuredClone(draft);
    const html = suitReleaseDetails(member, available(2), draft);
    assert.match(html, /<details[^>]* open>/);
    assert.ok(html.includes(`max="2" step="1" value="${points}"`));
    assert.match(html, /data-suit-release-focus="points"/);
    assert.deepEqual(draft, before);
  }
  assert.match(suitReleaseDetails({ id: 'crew-"<0>' }, available(), { points: '\"><bad>' }), /value="&quot;&gt;&lt;bad&gt;"/);
});

test('form translation produces only strict shared action arguments', () => {
  for (const [value, points] of [[1, 1], ['100', 100], [' 7 ', 7], ['2e1', 20]]) {
    assert.deepEqual(suitReleaseFormAction('crew-4', value), { id: 'crew.suit.release', args: { crew: 'crew-4', points } });
  }
  for (const value of ['', ' ', undefined, null, false, true, [], {}, 0, -1, 101, 2.5, '2.5', '2points', NaN, Infinity, 'Infinity']) {
    assert.equal(suitReleaseFormAction('crew-4', value), null, `invalid amount ${String(value)}`);
  }
  assert.equal(suitReleaseFormAction('', '1'), null);
  assert.equal(suitReleaseFormAction(null, '1'), null);
});

test('drafts, expanded state and last focus stay with their crew across replacement and selection', () => {
  const view = createSuitReleaseView(), first = panelFor('crew-0', '19', true);
  assert.equal(view.remember(first.inspector, first.fields.points), true);
  const second = panelFor('crew-1', '', false);
  view.remember(second.inspector, second.fields.summary);
  assert.deepEqual(view.draft('crew-0'), { points: '19', open: true, focus: 'points' });
  assert.deepEqual(view.draft('crew-1'), { points: '', open: false, focus: 'summary' });
  const replacement = panelFor('crew-0', view.draft('crew-0').points, false);
  view.restore(replacement.inspector, true);
  assert.equal(replacement.panel.open, true);
  assert.deepEqual(replacement.focused, [{ key: 'points', options: { preventScroll: true } }]);
  const returned = panelFor('crew-1', '', true);
  view.restore(returned.inspector, true);
  assert.equal(returned.panel.open, false);
  assert.deepEqual(returned.focused.map(f => f.key), ['summary']);
  assert.deepEqual(view.draft('crew-2'), {});
});

test('refresh preserves edits and focus, while outside controls and unavailable fields keep focus', () => {
  const view = createSuitReleaseView(), first = panelFor('crew-0', '5', true);
  view.remember(first.inspector, first.fields.points);
  first.fields.points.value = '2.5';
  assert.equal(view.remember(first.inspector, first.fields.points), true);
  assert.equal(view.draft('crew-0').points, '2.5');
  assert.equal(view.remember(first.inspector, {}), false);
  assert.equal(view.draft('crew-0').focus, 'points', 'selection outside the inspector retains last crew focus');
  const next = panelFor('crew-0', '2.5', false);
  view.restore(next.inspector, false);
  assert.equal(next.panel.open, true);
  assert.equal(next.focused.length, 0, 'routine refresh must not steal outside focus');
  next.fields.points.disabled = true;
  view.restore(next.inspector, true);
  assert.equal(next.focused.length, 0, 'disabled controls cannot receive restored focus');
  view.remember(next.inspector, next.other);
  assert.equal(view.draft('crew-0').focus, null, 'another inspector control deliberately replaces form focus');
  assert.equal(view.remember({ querySelector: () => null }, {}), false);
});

test('the crew inspector embeds emergency oxygen without changing simulation state', () => {
  const s = createGame(), c = s.crew[0], before = structuredClone(s);
  const html = crewDetails(c, 'Surface', s.crew, 20, [], 0, '', true, suitReleaseDetails(c, available()));
  assert.equal((html.match(/>Emergency oxygen<\/summary>/g) || []).length, 1);
  assert.match(html, /SKILLS & LABOR/);
  assert.match(html, /Suit air/);
  assert.deepEqual(s, before);
});
