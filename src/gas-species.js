// Canonical gas composition. Quantities use game-scale pressure units; vapor
// also represents the same water mass units as condensed water owners.
export const GASES = Object.freeze(['oxygen', 'inert', 'co2', 'vapor']);
export const emptyGas = () => ({ oxygen: 0, inert: 0, co2: 0, vapor: 0 });
export const dryGasAmount = gas => gas.oxygen + gas.inert + gas.co2;
export const gasAmount = gas => dryGasAmount(gas) + (gas.vapor ?? 0);
export const mix = amount => ({ oxygen: amount * .21, inert: amount * .79, co2: 0, vapor: 0 });
export function gasPortion(gas, amount) {
  const total = gasAmount(gas), fraction = total > 0 ? Math.max(-1, Math.min(1, amount / total)) : 0;
  return Object.fromEntries(GASES.map(k => [k, (gas[k] ?? 0) * fraction]));
}
export function addGas(to, gas, factor = 1) {
  for (const k of GASES) to[k] = (to[k] ?? 0) + (gas[k] ?? 0) * factor;
}
