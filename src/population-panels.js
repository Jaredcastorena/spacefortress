import { populationStatus } from './population.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const amount = value => Number(value.toFixed(1));
const remaining = (tick, now) => Math.max(0, tick - now);
const blockReasons = { pad_missing: 'A ground-level home shuttle pad is needed.', pad_destroyed: 'The landing pad needs repair.', pad_burning: 'Fire blocks the landing pad.', pad_blocked: 'The landing pad is not passable.', roster_full: 'The roster has no room for another traveler.', offer_active: 'Resolve the current offer before contacting another traveler.', cooldown: 'Waiting for the next contact window.' };
const outcomes = { declined: 'Offer declined', expired: 'Offer expired', arrived: 'Traveler arrived', diverted: 'Arrival diverted' };

export function recruitmentDetails(s, siteId = 'surface') {
  if (siteId !== 'surface') return '';
  const status = populationStatus(s), { offer, readiness } = status;
  const label = ({ idle: 'Contact travelers', cooldown: 'Contact cooling down', offered: 'Candidate available', inbound: 'Traveler inbound', full: 'Roster full' })[status.phase];
  let action = '';
  if (status.phase === 'offered') {
    action = `<p>Respond within ${remaining(offer.expires, s.tick)}s.</p><button data-action="recruit-accept" data-offer="${esc(offer.id)}" data-simulation-action="population.respond" data-recruitment-focus="accept" ${status.canAccept ? '' : 'disabled'}>Accept arrival</button><button data-action="recruit-decline" data-offer="${esc(offer.id)}" data-simulation-action="population.respond" data-recruitment-focus="decline">Decline</button>`;
  } else if (status.phase === 'inbound') {
    action = `<p data-recruitment-arrival>${s.tick < offer.arrives ? `Arrival in ${remaining(offer.arrives, s.tick)}s.` : `Holding for a usable pad · diverts in ${remaining(offer.deadline, s.tick)}s.`}</p>`;
  } else if (status.phase === 'cooldown') {
    action = `<p>Next contact in ${remaining(status.cooldownUntil, s.tick)}s.</p>`;
  } else if (status.phase === 'idle') {
    action = `<button data-action="recruit-contact" data-simulation-action="population.contact" data-recruitment-focus="contact" ${status.canContact ? '' : 'disabled'}>Contact a traveler</button>`;
  }
  return `<details data-panel-key="recruitment" data-recruitment><summary data-recruitment-focus="summary">Recruitment · ${label}</summary>
    <p>${status.living} living · ${status.count} / ${status.limit} roster records</p>
    ${offer ? `<h3>${esc(offer.name)}</h3><p>${esc(offer.role)}</p>` : '<p>Invite one traveler to join the colony at the home shuttle pad.</p>'}
    ${status.landing ? `<p>Landing pad · ${status.landing.x} / ${status.landing.y} / ${status.landing.z}</p>` : ''}
    ${status.blocked ? `<p data-recruitment-blocked>${esc(blockReasons[status.blocked] || status.blocked)}</p>` : ''}
    ${action}
    <dl><dt>Food stored · surface</dt><dd>${amount(readiness.food)} units</dd><dt>Breathing mix stored · surface</dt><dd>${amount(readiness.air)} units</dd><dt>Safe bunks / needed with arrival</dt><dd>${readiness.bunks} / ${readiness.neededBunks}</dd><dt>Breathable shelter</dt><dd>${readiness.breathableShelter ? 'Available' : 'Unavailable'}</dd></dl>
    ${readiness.warnings.length ? `<ul data-recruitment-warnings>${readiness.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}
    <p class="crew-hint">These are current supplies and shelter conditions, not a forecast of lasting support. Habitat warnings do not prevent landing. A traveler brings no colony supplies and must eat, rest and work here.</p>
    ${status.last ? `<p class="crew-hint">${outcomes[status.last.outcome]} · tick ${status.last.tick}</p>` : ''}
  </details>`;
}

export function restoreRecruitmentFocus(inspector, key) {
  if (!key) return;
  const controls = [...inspector.querySelectorAll('[data-recruitment-focus]')];
  const target = controls.find(control => control.dataset.recruitmentFocus === key && !control.disabled)
    || controls.find(control => control.dataset.recruitmentFocus === 'summary');
  target?.focus({ preventScroll: true });
}
