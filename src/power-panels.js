import { BUILDINGS } from './data.js';
import { electrical, BATTERY_CAPACITY } from './power.js';

export function powerDetails(site, t) {
  if (t.building==='breaker' || (!t.cable && !electrical(t))) return '';
  const circuit = site.circuits.find(c => c.id === t.circuit);
  return `<hr><div class="eyebrow">ELECTRICAL CIRCUIT</div>${t.powerStatus ? `<p>${t.powerStatus}</p>` : ''}
    ${circuit ? `<dl><dt>Generation / load</dt><dd>${circuit.output.toFixed(1)} / ${circuit.demand} kW</dd><dt>Delivered</dt><dd>${circuit.used} kW</dd><dt>Stored on circuit</dt><dd>${circuit.battery.toFixed(1)} / ${circuit.capacity} kJ</dd><dt>Unused generation</dt><dd>${circuit.curtailed.toFixed(1)} kW</dd></dl>` : ''}
    ${BUILDINGS[t.building]?.demand ? `<p>Power priority</p><div class="job-priority">${[[1, 'Low'], [3, 'Normal'], [5, 'Critical']].map(([priority, label]) => `<button data-action="power-priority" data-priority="${priority}" aria-pressed="${t.powerPriority === priority}" class="${t.powerPriority === priority ? 'active' : ''}">${label}</button>`).join('')}</div>` : ''}
    ${t.building === 'battery' ? `<p>This bank: ${t.charge.toFixed(1)} / ${BATTERY_CAPACITY} kJ</p><button data-action="bank-cell" ${t.hp <= 0 || BATTERY_CAPACITY - t.charge < 100 ? 'disabled' : ''}>Load power cell · 100 kJ</button>` : ''}
    ${t.cable ? `<p>Cable: ${t.cable.hp.toFixed(0)}% · ${t.cable.enabled ? 'connected' : 'switched off'}</p><button data-action="cable-toggle" ${t.cable.hp <= 0 ? 'disabled' : ''}>${t.cable.enabled ? 'Disconnect' : 'Connect'} cable</button>${t.cable.hp < 100 ? '<button data-action="repairCable">Repair cable · 1 alloy</button>' : ''}<button data-action="removeCable">Dismantle cable</button>` : ''}
    <p class="crew-hint">Adjacent terminals and cables share power. Isolated circuits keep their own reserves. New batteries start empty.</p>`;
}
