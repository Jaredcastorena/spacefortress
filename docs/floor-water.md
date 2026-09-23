# Floor water, leaks and recovery

Implemented September 16, 2026. This connects delivered water to the isometric colony environment: floor spreading, pressure-door containment, recovery pumps, wet wiring and fire suppression. It extends the existing compartment atmosphere and room heat model; the standalone side-view lab remains available separately.

The schema 35 [closed plumbing](plumbing.md) extension is implemented and verified. It adds separate finite pipes/reservoirs and powered floor/inventory adapters. Its acceptance is tracked in [verification status](verification-status.md); the original floor-water evidence below is historical.

## Build and try

- **Water tank:** 6 alloy, 1 component, 10 construction work; habitat floor required. New tanks start empty, allow refilling and have a closed drain valve. Haulers collect existing depot water into an eight-unit input buffer. Refill assignments begin when at least four units of unreserved capacity remain. An already assigned shipment can finish after refilling is disabled.
- **Recovery pump:** 6 alloy, 1 component, 10 construction work; habitat floor and 3 kW of connected power required. New pumps have empty output. They collect up to 0.5 water per tick, scaled by condition, from their tile and orthogonally adjacent open tiles. Haulers return the recovered water to an accepting depot. A twelve-unit output buffer stops intake when full.

On an unchanged starter map, floor tiles **11/9** and **12/9** can hold a tank and pump. Inspect the tank after a hauler fills it, open the drain, and step time. Close the drain and enable the wired pump to recover the spill. Route exposed cables away from standing water, or isolate them during cleanup; the pump itself has no separate exposed-wire fault without an installed cable overlay.

Tank fill and drain controls are in its hidden inspector. Disabling refilling prevents new delivery assignments; it does not close the valve or repair a leak. The pump uses the existing machine pause/resume and electrical-priority controls. Repair and dismantling use physically supplied crew work.

## Water ownership and movement

Each tile stores `liquid` from zero to four abstract water units. A tank's open drain releases at most 0.5 units per tick, limited by its actual input and remaining floor capacity. Below 50% condition, a tank leaks at `0.5 × (1 − condition/50)` even with its valve closed. A fully broken tank can leak 0.5 per tick. Opening a damaged tank uses the larger release rate; it does not add two copies of the water.

Water levels across orthogonal tile pairs, moving up to 0.5 units or one quarter of their quantity difference per pair. Processing order alternates each tick. Intact hull walls and rock block movement. Pressure doors pass water while held open, during their automatic opening interval, or while broken. Closed doors trap any water already on their tile rather than deleting it. Other fittings do not seal water.

Ground/ore tiles drain up to 0.1 units per tick. Void tiles lose arriving water to space. Map-edge tiles lose up to 0.5 per tick. Floors, ice and decks retain water unless connected to a loss boundary. The site ledger explicitly accounts for these losses.

Pumps move water from the floor into their physical output inventory. Disabled, broken, burning, unpowered or full pumps retain the water. Closed doors block their neighboring intakes. Packaged water and floor water are separate owners of the same resource: `totalResources()` counts both, while the ordinary resource bar still shows available depot supplies. Dismantling a tank/pump spills its packaged inventory for hauling and retains existing floor water. Water cannot be collected twice by multiple pumps.

## Electricity and fire

At **0.25 floor water** or more, an enabled cable with positive condition requests a **5 kW fault load**. Faults receive power before ordinary devices. If the circuit cannot supply the complete load, there is no energized fault damage or heat. Actual fault consumption participates in the existing generator/battery/curtailment ledger; faults can cause machine brownouts and drain batteries.

An energized fault reduces cable condition by **0.25 per tick** and adds five heat units to its compartment. Exterior fault heat is recorded as lost. Disconnecting the cable prevents further fault consumption/damage; repair restores condition but does not remove the water. The map shows a wet-cable warning and sparks, and the inspector identifies the damage cause. Enclosed equipment terminals are abstractly protected; this fault applies to cable overlays.

A puddle of at least **0.25 water** blocks ignition on its tile. An existing fire consumes 0.25 floor water to extinguish, with the water counted as used for quenching. Obsolete crew suppression jobs are cancelled through normal job cleanup, preserving their delivered/reserved supplies. Remaining room heat can still cause later ignition once the tile is no longer sufficiently wet.

The original tick order is tank release and flow, electrical allocation/faults, powered recovery, then atmosphere/thermal/fire updates. The plumbing extension inserts passive pipe leveling/leaks before floor flow, and powered plumbing after recovery pumps. An outlet's new puddle can quench fire that tick, but reaches wet-cable fault allocation on the next tick. Circuit displays refreshed after crew actions describe the next allocation; named fault and transfer events retain interactions that occurred earlier within the tick.

## Labels, accounting and saves

`site.liquids` records released, recovered, lost and quenched quantities. Its invariant is:

`floor water = released − recovered − lost − quenched`

The same ledger separately records fault energy and exterior fault heat. Compartment fault heat enters the existing thermal equipment ledger. These are successive accounting stages, not independent energy supplies to add together.

The pending plumbing extension preserves this floor ledger. Floor-to-pipe intake also increments `liquids.recovered`; pipe leaks/outlets into a tile also increment `liquids.released`. The separate `site.plumbing` ledger tracks that water while inside pipes/reservoirs. Moving between owners does not create another copy of the resource. See [plumbing accounting](plumbing.md#ownership-and-conservation).

The shared action `water.tank {site,x,y,fill,drain}` validates both booleans and the tank target. Pumps use `production.enable`; cable isolation uses `power.cable`. Stable tile IDs expose liquid, tank controls, machine buffers and energized fault state. Typed observation changes use liquids, inventory and power systems.

Named events include `water.tank.changed`, `water.released`, `water.flowed`, `water.pumped`, `water.lost`, `water.used_for_fire`, `power.wet_short` and the existing `fire.extinguished` with reason `floor_water`. Releases identify the source buffer and drain/damage cause; transfers identify endpoints and amounts. Existing command records distinguish player/agent requests. Local optional recording does not affect outcomes.

**Save schema 32** introduced this system and migrates schema 31 by adding dry tiles, false fault indicators and zero liquid ledgers, with no free water or machinery. Current saves preserve wet floors, buffers, valve state, cable damage and accounting. Validation rejects nonfinite/negative/excess water, broken ledger balances, invalid controls and attached tank state without a tank.

## Evidence and remaining scope

At the water release, **552 tests passed**, including sixteen liquid cases: supplied construction, hauling, valves/leaks, conservative leveling, door timing, drainage/space losses, powered bounded recovery/hauling, blocked pumps, fault energy/battery brownouts, quenching/job cleanup, demolition, stable records, save continuation, migration and malformed-state rejection. All 536 earlier tests also passed. After refining the combined drain/damage event label, all sixteen targeted cases passed again.

Isolated Firefox verified hidden drawers, original tank/pump/puddle/spark drawings, player fill/drain/pause/isolation controls, fault warning, physical recovery quantities, stable labels and wet schema-32 save/reload, with no scoped application errors. Artifacts: `.runtime-qa/liquids-check.mjs`, `liquids-leak.png`, `liquids-pump.png`.

This is horizontal floor flow on the current single-level colony map. No vertical falls, hydrostatic forces, gas-volume displacement, swimming/drowning, freezing, boiling/steam, fluid-temperature transport or contamination is modeled yet. Quenching consumes water into an explicit sink; recovered water uses the existing abstract water resource, with no purity or potability claim. Finite pipes and plumbed production are implemented and verified in schema35; see the linked plumbing guide for exact scope. No new packages, remote services or downloaded art were required.

Current integration evidence is in [verification status](verification-status.md); [closed plumbing](plumbing.md) describes the new water transport rules.
