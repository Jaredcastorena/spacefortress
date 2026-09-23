# From colony to orbit and back

**Implemented and verified within this scope.** This feature keeps save schema **36** and reuses existing departure/mission crew arrays. It adds player choice and labels to the existing loading, salvage, return and construction loop. Source/API fields below have been checked; [verification status](verification-status.md) records accepted execution evidence.

The current loop sends two surface colonists to a fixed orbital destination, physically recovers material, brings it home and uses it in the colony. Generated regions, staffed outposts and real local levels remain unfinished.

## Choose the people who will go

The destination's hidden inspector lets the player select exactly two distinct crew. Preparation records those stable IDs in the selected order. Current readiness and duties help the player leave useful workers at home and bring suitable workers. A displayed role such as Pilot does not imply a piloting requirement or flight-skill model.

Initial eligibility requires a living crew member on the surface, an active routine, no rescue or injury, absolute thermal stress below 45, health above 50, suit oxygen above 50, energy at least 40, food reserve at least 40, no personal/pickup intent and no carried cargo. A current work job alone does not disqualify someone. Death has its own readiness reason, not a low-health recovery prompt. Readiness is a current observation, not a promise that it persists through loading.

The assigned pair remains fixed during loading and boarding. If someone later becomes unavailable, preparation waits without substituting another colonist. Cancel, choose another pair and prepare again. Loaded service stores stay aboard; unfinished deliveries follow normal cancellation/return rules. [Departure preparation](departure-preparation.md) documents those owners.

## Load supplies and board

**Prepare expedition** creates a plan. Haulers reserve real depot/loose supplies, collect shipments of at most six units, deliver them at the shuttle, and complete loading work. Missing portions can arrive later. Preparation itself spends no flight fuel and teleports nobody.

Targets include both flight legs' fuel, two food, suit-refill breathing mix plus a reserve, and a collector kit for Helios Reach. Existing service stores reduce the deficit. These stores are separate from the salvage hold. Once supplied, selected crew finish deliveries/recovery and walk to the shuttle. Liftoff waits for both, a usable shuttle, finished shuttle work and a valid approach window.

Departure spends two food, the actual mix used to fill suits, and half the route fuel. Return fuel stays aboard until return liftoff or an outbound turn-back. Spare mix remains stored; active field use and transit breathing are not simulated. At final boarding, the oxygen-selection threshold is replaced by the paid refill; other readiness checks still apply.

## Work at the destination

| Destination | Current opportunity | Standard-fit route |
| --- | --- | --- |
| Relay K-07 | Satellite components/alloy and periodic debris exposure | 2 fuel for both legs; 22 seconds each way |
| The Wayfarer | Finite ice/volatiles within a comet approach window | 3 fuel; 30 seconds each way |
| Helios Reach | Charged cells after returning components | 4 fuel; 38 seconds each way; 6 alloy/2-component kit |

These destinations are authored. Fittings change time/fuel/capacity. Comet readiness is checked when preparing and at actual departure, so loading can miss the window.

At Relay K-07, designate satellite salvage for extraction. The output stays in a pile. A crew member with hauling enabled reserves it, walks over, carries it to the dock and delivers it. The standard hold has 18 resource units; loaded cargo, carried loads and pending pickups share that limit. Cargo filters affect new pickups; already carried material retains its destination.

Field work and return walking consume suit reserves and expose crew away from the dock to stylized hazards. Automatic recall considers crew condition and, for the comet, return walking/transit time. It cannot guarantee rescue through a route that later becomes blocked.

## Bring home what was loaded

Recall ends field work and uncollected pickups. Surviving crew walk back and deliver held cargo; return flight waits until the surviving team reaches the dock without held loads. A blocked route leaves crew on site. Resume field work to clear a route, then recall again. Automatic recall remains active.

Uncollected piles remain for later visits. A deceased carrier drops cargo; body recovery remains unimplemented. Transit is an abstract countdown without detailed propulsion or cabin life support.

Landing places cargo in a physical pile at the surface shuttle. Surface haulers can deliver it to accepting storage. Construction can instead reserve accessible loose material directly, after which a worker collects and delivers it to the worksite. Landing does not finish an upgrade. The resource bar shows depot stock and may not include a new landed pile.

## Make the trip useful at home

Returned components unlock shuttle fitting designs and Helios Reach, without granting free parts. Refits consume physical materials and Engineering work; capability changes only on completion. The acceptance journey targets a storm-shelter refit: **8 alloy and 4 components**, **12 Engineering work**, a 12-unit hold and 75% less expedition debris/solar injury. Four components exceeds the three starting components, so this route needs recovered or produced parts. The shelter adds one fuel per sortie without changing travel time.

Expanded cargo racks instead cost 8 alloy/3 components, take 12 Engineering work, and increase the hold from 18 to 36 while adding one fuel and six seconds each way. See [fitting tradeoffs](expedition-logistics.md#fitting-choices). The accepted journey established the shield fitting through actual supply delivery and work.

Recovered components can also fund an advanced array: **8 alloy and 4 components**, **12 construction work**, up to **12 kW in daylight** scaled by condition. It needs an electrical route to serve the intended circuit. Construction requires those materials but has no separate returned-salvage flag gate for the array.

The first component-bearing return also introduces the existing tibble cargo event. This is a small colony consequence of salvage, not a detailed quarantine system.

## Shared controls, records and saves

`expedition.launch({site,crewIds?})` prepares a departure. Explicit `crewIds` must contain exactly two distinct known eligible IDs; order is preserved and no replacement is chosen. Omitting the optional list keeps the legacy first-two-eligible selection. Rejected requests change no simulation state. Cancellation, cargo policy, recall, resume and refit/construction share the player/agent dispatcher too.

The action catalog declares optional `crewIds` as an array with `minItems:2`, `maxItems:2`, `uniqueItems:true` and crew-entity strings. The shared dispatcher rejects malformed arguments before simulation changes. Direct selection failure codes distinguish invalid selection type/count, duplicate/unknown crew, unavailable selected crew and insufficient crew for automatic selection. Shared action results retain the dispatcher's `invalid_arguments` or `simulation_rejected` category. Pure readiness reads neither reserve resources nor emit events.

Observations expose:

- `colony.derived.expedition`: ordered `selectedCrewIds`, destination site ID, phase, preparing flag, remaining transit time, candidates and `departureReadiness` detail.
- Each crew's `derived.expedition`: current `eligible`, `blocked`, `reason` and whether selected.
- Each site's `derived.expedition`: whether selected and the separate `launchBlocked` destination/shuttle gate.

Journey events carry ordered `crewIds`, site ID and tick, with actor/job/phase/resource detail appropriate to the boundary. Travel endpoints can be site/tile IDs; inventory movements use `{entity,slot}` owners. Named events include:

| Events | Meaning / principal detail |
| --- | --- |
| `expedition.preparation.started`, `expedition.preparation.stage_changed` | Manifest and supply target; transition between loading and boarding |
| `expedition.preparation.cancelled` | Previous stage, requested/loaded stores; reason `player`, `loading_cancelled` or `loading_invalidated` |
| `shuttle.supplies.loaded`, `shuttle.supplies.unloaded` | Actual job material ↔ service-store/pile transfer, actor/job and quantities |
| `expedition.crew.boarded` | Actor reaches the departure/return dock, including after held cargo delivery |
| `expedition.departed` | Boarding → outbound, exact consumed fuel/food/mix, return fuel and fit |
| `expedition.arrived` | Outbound → working, actual crew positions and collector state |
| `expedition.salvage.picked_up`, `expedition.salvage.delivered`, `expedition.salvage.spilled` | Pile → carried cargo → hold, or surplus returned to a dock pile |
| `expedition.recalled`, `expedition.resumed` | Phase change and player/safety reason; recall retains real cargo |
| `expedition.fuel.consumed`, `expedition.kit.deployed` | Actual return-fuel or collector-kit withdrawal from service stores |
| `expedition.return.departed`, `expedition.returned` | Boarded survivors depart, then cargo moves from hold to surface pile |
| `expedition.upgrade.unlocked` | First component return changes `salvageReturned`; not free upgrade materials |
| `shuttle.refit.completed` | Paid work changes installed fit and capabilities, with actor/job/cost |

`resource.extracted`, ordinary job events and inventory deltas cover extraction and physical refit supplies. Transient labels preserve transitions that final tick deltas alone cannot show. Events remain observations, not proof of causal outcomes or training rewards.

Schema 36 already stores the two-ID departure/mission manifest. UI selection before preparation is only a draft, not a new saved material owner. Existing plans, partial deliveries, service stores, return fuel, remote piles, cargo and fittings persist. This feature requires no save migration or grant.

Both `tests/orbital-colony-loop.test.js` and `.runtime-qa/manifest-check.mjs` completed the ordinary-actions journey from an untouched colony: crew-2/crew-4, sealed-exit and paused-scrubber recovery, liftoff at tick97, wreck arrival119, physical salvage delivery, return169 and paid shield fitting223. The refit needed 4 components while initial stores had3, and actually reserved returned parts. Preparation and return reloads matched; all7 crew survived. The full suite passed775/775, with44 new cases covering selection, safety, conservation, persistence, recording and this journey. Root reviewed map, roster, blocked loading, return and installed-fitting screenshots. Final route-message wording also passed the scoped browser rerun. See [verification status](verification-status.md) for logs and boundaries. Recording stays optional, bounded, local and independent of RNG/save outcomes.

## Remaining scope

Only one two-person mission/departure can exist at a time. Sites/routes are fixed, construction uses the surface supply network, and visiting a destination does not establish a remote colony. Staffed outposts, fleet scheduling, generated destinations, real local decks, piloting duties, detailed propulsion, transit breathing and active field use of spare mix remain unfinished.
