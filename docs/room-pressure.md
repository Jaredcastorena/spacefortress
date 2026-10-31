# Room pressure and temperature

Schema75 introduced temperature-dependent room pressure. Local schema78 extends it to finite gas-carried heat and pipe/tank temperatures. Package0.1.12 is unchanged; these local changes are not yet published.

## Shared quantities

At 20 °C (293.15 K), ten gas units per floor tile produce 100% nominal pressure. For a room with volume V, gas amount N and absolute temperature T:

- Total pressure: `100 × N / (10 × V) × T / 293.15`.
- Oxygen partial pressure: `oxygen / (10 × V) × T / 293.15`, as a fraction of nominal pressure.
- Gas required for target P: `10 × V × P / 100 × 293.15 / T`.

Current room capacity includes structural mass and gas: `T = heat / (20 × V + 0.2 × N)`. Heating a sealed room raises pressure without creating gas. Cooling lowers pressure and available oxygen partial pressure even when oxygen concentration is unchanged. Breathing still requires 55–150% total pressure, 16–30% oxygen partial pressure, at most 2% CO2 and smoke below its existing limit. At zero kelvin, pressure is zero. A fixed-temperature positive target is unavailable, but incoming warm gas can supply finite energy; actual vents solve the final mixed pressure against available gas.

## Interacting systems

Room exchange uses current pressure differences and bounded source quantities. Composition mixing, species accounting and thermal accounting remain finite. Life support, suit charging/release, vents, exhaust and airlock estimates use the same temperature-dependent inverse targets. Fire uses oxygen partial pressure; reactor radiators read current room pressure. Climate, reactor heat and wet electrical faults refresh derived room readings.

Continuous automatic and life-support consumers now request refills after a recipe-sized deficit, including incoming cargo. Tiny cooling-driven air top-ups no longer monopolize haulers. Priority, capacity and finite source quantities are unchanged; an empty machine can still receive a partial available supply.

An airlock normally targets rounded habitat pressure. If that finite predicted mixture is unsafe, it tries the nearest legal integer target within two pressure points, using only available gas. The controller and commissioning helper share these pure resource diagnostics. A lean reserve that can reach a safe target still completes passage; a genuine shortage leaves the chamber contained. Safe air is not proof of adequate temperature, power, storage or long-term reserves.

## Saves and limits

Schemas40–74 validate their original density-only readings before migration recalculates room pressure, room air and the site air summary. That migration preserves existing gas, heat, supplies, jobs, timing and RNG. Schema78 then preserves structural heat and temperature while introducing an explicit baseline for previously untracked gas energy. Schema75 and later reject caches inconsistent with actual gas and heat. An older colony may therefore load with different breathing conditions; no supply is created to compensate.

Flowing gas now carries energy, and node pressure uses actual temperature. The combined thermal ledger covers rooms and network contents. [Gas heat rules](gas-heat.md) explain migration, topology and the explicit20°C packaged-gas boundary. Water heat, steam, compression work and broader thermodynamics remain future work. These are game-scale quantities, not an engineering model.

Focused coverage is in [core pressure](../tests/room-pressure.test.js), [gas devices and suits](../tests/room-pressure-devices.test.js) and [airlocks](../tests/room-pressure-airlocks.test.js). The [verification index](verification-status.md) states executed evidence and remaining acceptance work.
