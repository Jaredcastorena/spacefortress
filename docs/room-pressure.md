# Room pressure and temperature

Local save schema75 couples room pressure to the existing room heat model. Package 0.1.12 is unchanged; this work is not yet published.

## Shared quantities

At 20 °C (293.15 K), ten gas units per floor tile produce 100% nominal pressure. For a room with volume V, gas amount N and absolute temperature T:

- Total pressure: `100 × N / (10 × V) × T / 293.15`.
- Oxygen partial pressure: `oxygen / (10 × V) × T / 293.15`, as a fraction of nominal pressure.
- Gas required for target P: `10 × V × P / 100 × 293.15 / T`.

Temperature retains the existing game thermal mass: `T = heat / (20 × V)`. Heating a sealed room raises pressure without creating gas. Cooling lowers pressure and available oxygen partial pressure even when oxygen concentration is unchanged. Breathing still requires 55–150% total pressure, 16–30% oxygen partial pressure, at most 2% CO2 and smoke below its existing limit. At zero kelvin, pressure is zero and positive fill targets are unavailable; devices do not consume supply trying to satisfy an infinite request.

## Interacting systems

Room exchange uses current pressure differences and bounded source quantities. Composition mixing, species accounting and thermal accounting remain finite. Life support, suit charging/release, vents, exhaust and airlock estimates use the same temperature-dependent inverse targets. Fire uses oxygen partial pressure; reactor radiators read current room pressure. Climate, reactor heat and wet electrical faults refresh derived room readings.

Continuous automatic and life-support consumers now request refills after a recipe-sized deficit, including incoming cargo. Tiny cooling-driven air top-ups no longer monopolize haulers. Priority, capacity and finite source quantities are unchanged; an empty machine can still receive a partial available supply.

An airlock normally targets rounded habitat pressure. If that finite predicted mixture is unsafe, it tries the nearest legal integer target within two pressure points, using only available gas. The controller and commissioning helper share these pure resource diagnostics. A lean reserve that can reach a safe target still completes passage; a genuine shortage leaves the chamber contained. Safe air is not proof of adequate temperature, power, storage or long-term reserves.

## Saves and limits

Schemas40–74 validate their original density-only readings before migration recalculates room pressure, room air and the site air summary. Existing gas, heat, supplies, jobs, timing and RNG are preserved. Current schema75 rejects caches inconsistent with actual gas and heat. An older colony may therefore load with different breathing conditions; no supply is created to compensate.

Gas and heat remain separate conserved ledgers. Flowing gas does not yet carry heat. Pipes and tanks use a fixed 20 °C reference, including their capacity and passive equalization. Water heat, steam and broader thermodynamics remain future work. These are game-scale quantities, not an engineering model.

Focused coverage is in [core pressure](../tests/room-pressure.test.js), [gas devices and suits](../tests/room-pressure-devices.test.js) and [airlocks](../tests/room-pressure-airlocks.test.js). The [verification index](verification-status.md) states executed evidence and remaining acceptance work.
