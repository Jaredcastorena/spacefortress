# Electrical networks and stored energy

Implemented locally; September 16, 2026. This is an initial electrical model, not a complete utility simulation.

Implemented extensions include [wet-cable faults](floor-water.md), which consume actual power and damage exposed wiring, and powered [water plumbing](plumbing.md). The verified schema-36 [electrical isolation](electrical-isolation.md) increment adds physical two-terminal manual breakers and supplied-wet-fault protection. Its 731-test full-suite and browser acceptance are indexed in [verification status](verification-status.md).

Previous extension: [colony reactors and exterior radiators](reactors.md) add fueled generation, core-to-room heat and manual overheat recovery in schema 31. Historical evidence below describes the earlier foundational release.

## Player behavior

- Adjacent ordinary equipment terminals and cables form a circuit. Connections are orthogonal; diagonal contact does not connect anything. The breaker extension uses two separate opposite terminals, with no side connection and an internal switchable contact; its [guide](electrical-isolation.md) explains bypasses and battery backfeed.
- Build **Power cable** across intervening tiles. Cables cost one alloy, use the usual crew supply trips, and can run beneath structures and walls. They cannot occupy open space or unmined rock.
- The **Power** map toggle shows wiring; cable placement also reveals it. Circuit colors distinguish connected groups; red cable markers indicate damage or a switched-off segment. Inspect a tile for delivered power, reserves and machine status.
- Cable switches disconnect their tile from neighboring conductors immediately. Repair and dismantling are crew jobs, separate from structure work. Removing a structure leaves its cable behind.
- Each machine has Low, Normal or Critical power priority in the inspector. Life support starts Critical; other loads start Normal. Life support wins an equal-priority tie, then map position breaks ties. Loads receive their entire rated demand or stay off. A lower-priority load may use power too small for a higher-priority load.
- Paused machines release their demand. Other idle machines still draw rated power, even while waiting for ingredients or output hauling.

## Batteries and conservation

Every battery bank owns its charge. Capacity is 120 kJ; new banks start empty. Charging and discharge are limited to 20 kW per bank, scaled by its condition. Solar generation is also scaled by condition and stops at night; fueled reactors follow their separate fuel, heat and throttle rules. Each tick is one second.

Generation serves enabled loads before charging connected banks. A deficit draws only from banks on that circuit. Excess generation beyond charge capacity/rate is curtailed. Splitting or joining circuits never redistributes existing charge. Broken banks retain stored energy but cannot supply it; repairs restore access. Demolition records remaining charge as discarded energy.

Portable power cells provide 100 kJ. A selected bank needs that much free capacity, or the colony action can divide it among multiple reachable banks. A depot holding the cell must have a walking route to the bank(s). Electrical connection is unnecessary for portable charging. Insufficient capacity consumes no cell. This action is still immediate; a crew installation job remains future work.

`src/power.js` owns allocation, charge transfers and validation; the breaker increment separates terminal connectivity into its graph helper. `site.power` and `site.circuits` are derived diagnostics. Never write their aggregate battery value to alter reserves. Physical battery tiles own `charge`. The cumulative energy ledger records initial, generated, consumed, curtailed, discarded and injected energy. Stored plus consumed, curtailed and discarded energy equals initial plus generated and injected energy.

`refreshPower` recalculates diagnostics and next-tick allocation without transferring energy. `updatePower` transfers one tick of energy. The breaker extension previews supplied faults and settles all due contact trips before committing that one energy transfer. Inspection and refresh must not trip contacts or consume tentative fault power. The simulation refreshes after crew work, so equipment status reflects newly completed or dismantled structures immediately.

## Saves and commissioning

Schema 6 introduced physical bank storage; the historical foundational checkpoint described below used schema16. Initial colonies receive a connected starter network and 100 kJ in their original bank. Version-5 saves receive routes between existing equipment and distribute their former pool equally among existing banks, capped by physical capacity. Excess charge, or charge without any bank, is recorded as discarded. That migration grants no additional energy and does not run again after saving schema 6 or newer. This is historical migration context, not the current save-version number; see [verification status](verification-status.md).

New construction is never automatically wired across gaps. Validation checks cable condition and terrain, priorities, per-bank charge, derived circuit membership/allocation, and energy accounting. The browser storage key and failed-load preservation remain unchanged.

## Evidence and remaining work

The foundational checkpoint passed **252 tests**, including 14 electrical tests: initial commissioning, gaps and diagonals, switches, split/join conservation, bank damage, charge/discharge limits, priorities and pauses, cable work beneath walls, empty construction, demolition losses, reachable cell loading, deterministic interrupted repairs, legacy migration and malformed state rejection. Atmosphere and production tests covered outages, suit use, stopped crops and recovery. This historical count does not verify later breaker changes; current results are in verification status.

Source syntax passed at that foundational checkpoint, which did not include browser checks of its electrical controls/overlay. Later utility increments have scoped browser evidence in verification status. Breaker browser interaction and art passed in schema36; current scoped evidence is indexed there.

Electrical equipment has operating wear and engineer service jobs; surface debris can damage cables and structures. See [maintenance and hazards](maintenance-and-hazards.md). [Fire and smoke](fire-and-smoke.md), room thermal systems, reactor heat and wet-cable heating are implemented as separate interacting systems. Physical branch breakers with wet-fault sensing are the active extension. Cable capacity, resistive losses, routed overload ratings, disposable fuses and automatic load controls remain unimplemented. Ordinary cables conduct at any positive condition. Wiring is confined to each local map; orbital construction and inter-site transmission remain outside this increment.
