# Departure preparation and persistent ship stores

Physical loading/boarding was implemented locally on September 16, 2026. Explicit two-person selection and the full [colony–orbit–return loop](orbital-colony-loop.md) are now implemented and verified in tests and the browser; see [verification status](verification-status.md). Save schema 36 stays unchanged for this feature.

## Physical loading

**Prepare expedition** creates a departure plan. It does not move the crew or consume launch fuel. The plan records the destination, two selected crew IDs, supply targets and loading/boarding status. The player chooses the pair in the destination inspector. The shared action accepts an optional two-ID list, preserving the legacy first-two-eligible behavior when omitted. Exact readiness and interaction labels are below.

Hauling jobs reserve available supplies from depots or loose piles, collect shipments of at most six units, and deliver them to the shuttle. Multiple trips may be required. Finishing the loading work transfers staged material into the shuttle's persistent service stores. Missing resources can arrive later: available portions load first, then another job loads the remaining deficit. Blocked routes and disabled hauling labor stop work with visible diagnostics.

Targets cover fuel for both flight legs, two food units, suit-refill mix plus a reserve, and six alloy/two components for a solar collector kit when needed. Existing stores aboard reduce the amount that needs loading. Service supplies occupy separate storage from the salvage hold; tank size, mass and containers remain abstract.

## Choosing a fixed manifest

`expedition.launch({site,crewIds?})` accepts an optional array of exactly two distinct existing crew IDs. Explicit order is preserved. Invalid, duplicate, unknown or unavailable selections are rejected without choosing replacements or changing state. The simulation binding is `launch(s,siteId,crewIds=undefined)`. Omission picks the first two eligible crew in colony order for compatibility with earlier callers.

`src/expedition-readiness.js` owns the pure readiness rules. Initial selection requires:

- Alive and on the surface, with routine other than `rest`.
- No rescue or injury; absolute thermal stress below 45.
- Health above 50 and suit oxygen above 50.
- Energy and food reserve each at least 40.
- No current personal/pickup intent and no carried cargo. A current work job alone is allowed.

Primary reason order is `deceased`, `away`, `off_duty`, `rescue`, `injured`, `thermal_stress`, `low_health`, `low_oxygen`, `low_energy`, `hungry`, `occupied`, `carrying`; unknown IDs use `unknown_crew`. `eligible:true` has `blocked:null`. Duties are shown separately: a ready crew member still needs Extraction/Hauling enabled to perform those field jobs. There is no pilot-role requirement.

The initial destination/shuttle gate is separate: valid destination, no current mission/departure, no shuttle work, shuttle condition at least 50, valid comet window and Helios unlock. Supply deficits and walking routes are handled by actual preparation, not silently reserved by the readiness helper.

The roster lives in a collapsed section inside the destination inspector. Its draft preserves selected IDs if readiness changes. Preparing freezes the manifest into simulation state. Cancel to choose a different pair; a departed mission cannot change crew. Draft selection is UI state, while existing departure/mission arrays preserve the actual assignment through saves.

## Boarding and readiness

Once supplies are aboard, the selected crew stop taking new surface jobs and walk to the shuttle. Already held deliveries must finish first, and recovery takes precedence. Tired or hungry assigned crew recover before boarding. They are not silently replaced if unavailable or dead; the player can cancel and prepare a new team.

Liftoff requires both crew at the shuttle, no held cargo or recovery intentions, adequate health/food/rest, enough loaded supplies, shuttle condition of at least 50, and completed work at the shuttle. A comet's approach window is checked again at actual departure. Slow loading may miss it; no launch costs are consumed while waiting. Closed routes never teleport crew aboard.

Boarding reuses the initial readiness rules except for the oxygen-above-50 test: actual loaded mix pays for the refill at liftoff. Missing or dead selected members block departure without substitution or supply debit. `departureReadiness(s)` reports each assigned ID's eligibility, `atShuttle`, `routeSteps`, `routeBlocked` and `ready`, plus missing supplies and shuttle work. Its primary block order is `crew_unavailable`, `missing_supplies`, `shuttle_work`, `shuttle_damaged`, `window_closed`, `crew_not_ready`, `route_blocked`, `crew_not_aboard`, then `loading`; absent preparation uses `no_departure`. The `missing_supplies` reason preserves actual hauling, absent-stock or blocked-route detail from the loading job/preparation instead of reducing every delay to a generic deficit.

The destination inspector and Colony drawer show the preparation, loaded/required quantities, staged supplies, assigned crew and delays. Selecting the shuttle exposes the loading job and its priority/cancellation controls.

## Consumption and cancellation

- Departure consumes half the route's fuel, two rations and the actual mix needed to refill suits. The unused inert fraction of that mix is recorded as vented gas.
- The other half of the fuel stays aboard, reserved for the return leg. Return liftoff or an outbound turn-back consumes it.
- A solar kit remains aboard until arrival and deployment. Aborting outbound preserves the unused kit.
- Unused breathing mix and other service stores persist across missions.
- Cancelling preparation releases uncollected reservations and staged shipments through existing cancellation rules. Carriers retain their loads until they can return them. Already loaded stores remain aboard.
- Cancelling a loading job also cancels the departure, preventing automatic requeueing.
- **Unload service stores** creates a hauling job at an idle shuttle. Completion places its stores in a local pile; ordinary haulers still need to return them to a depot.

Food consumption, suit refill and collector deployment remain discrete actions. Transit breathing, detailed propulsion, pilot duties, individual provisions and active use of the spare mix during a remote expedition remain future work.

## State and persistence

`src/preflight.js` owns departure targets, loading deficits, readiness, boarding movement, supply consumption and validation. `src/preflight-panels.js` presents that state inside hidden drawers. Construction delivery logic is reused for loading/unloading jobs; these use hauling labor. The shuttle owns its `supplies`; global available resources remain a derived depot total. Resource accounting includes ship stores alongside loose piles, carried shipments, reserved jobs, machine buffers and mission cargo.

Named preparation/loading/boarding/fuel events and typed observations are listed in [the orbital loop guide](orbital-colony-loop.md#shared-controls-records-and-saves). Labels distinguish UI drafting from the shared simulation action and preserve the actual ordered manifest. Local recording remains optional, bounded and independent of saves/RNG.

The historical checkpoint used save schema 16; persistent service stores were introduced after schema 8. Schema-8 missions retain their already-paid status: migration initializes empty service stores and zero remaining fuel charge, without creating supplies or charging old trips twice. New plans, partial deliveries, boarding crew, service stores and reserved return fuel persist across saves. Failed-load protection remains unchanged. The current selection feature keeps schema 36 and reuses existing departure/mission crew arrays; no migration or grant is added.

## Verification and limitations

The historical departure checkpoint passed **252 tests**, including 14 departure cases: staged loading, hauling permissions, blocked pickup/delivery/boarding routes, partial supplies, cancellation at different stages, persistent stores, physical unloading, recovery before flight, damaged-shuttle and closing-window checks, fuel by leg, kit deployment/abort, deterministic saves, migration and invalid state rejection. Those cases wait for real loading and boarding before testing flight behavior. This historical evidence does not establish acceptance of explicit selection or the new full journey checks.

Source syntax and documentation links passed at that original checkpoint, whose departure UI was not browser-verified. Current selection, boarding and browser evidence is verified in [verification status](verification-status.md); the historical count above is not the current release count.

This is an incremental logistics system, not a complete ship or colony simulation. Crew needs, downtime and relationships now have an initial implementation; see [crew life](crew-life.md). Continue the user's chosen colony focus with deeper health/care, production and environmental consequences. The full conversion inventory, local vertical construction, generated universe and broader travel scope remain unfinished.
