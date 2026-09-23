# Verification status

Updated September 16, 2026. This is the compact evidence index for implemented and proposed systems. **Verified** means the named scope passed its stated check. **Pending** means evidence is not yet complete. **Failed** means a known check contradicts the requirement. None of these rows declares the whole game finished.

## Staffed orbital outpost audit — proposed, no implementation

| Check | Status | Evidence and scope |
| --- | --- | --- |
| Genuine preceding36 capture | Verified | Five normal-action outbound, remote mined/held/docked cargo and return snapshots in `tests/fixtures/outpost-pre36-*` with unchanged source hashes and exact save bytes. `tests/outpost-pre36-fixtures.test.js`: 3/3 focused checks pass on current schema36; `/tmp/spacefortress-outpost-pre36-fixtures.log`. This is capture evidence, not future migration acceptance. |
| Existing site behavior audit | Verified | Source inspection and a focused crew probe found all-site utility ticking, plus blockers in mission-only return, surface-only construction/recovery, remote cargo ownership and save validation. The [proposed design](staffed-orbital-outpost-design.md) records the resulting contracts. These are findings, not working outpost behavior. |
| Persistent residents, finite freight and normal outpost journey | Pending | No outpost source changes have begun. Need physical freight loading/unloading, local construction and living conditions, resident versus passenger identity, delayed resupply, offscreen deterioration, recovery, schema migration and player/agent/browser acceptance. |

## Current accepted expedition selection and complete journey — schema 36 unchanged

| Check | Status | Evidence and scope |
| --- | --- | --- |
| Explicit ordered manifest and initial gates | Verified | 9 new cases: exactly two distinct eligible IDs, caller order, no replacement, omission compatibility, no aliasing, destination/shuttle/window gates and cancel/repick ownership. `tests/expedition-selection.test.js`; `/tmp/spacefortress-expedition-selection-behavior-tests.log` |
| Late readiness and physical crew recovery | Verified | 11 cases: rest/meals, supplied medical care, thermal/health recovery, real shipment/rescue completion, paid shuttle repair, reopened routes and windows. Death never substitutes or respawns a crew member; held salvage retains a physical owner. `/tmp/spacefortress-expedition-selection-safety.log` |
| Finite supplies and cargo ownership | Verified | 7 cases: actual suit refill and gas balance, oldest food/metadata, cancellation across source/carrier/staged/aboard owners, one fuel spend per leg, hold claims/capacity and one return transfer. `/tmp/spacefortress-expedition-selection-conservation-tests.log` |
| Genuine preceding36 saves and continuation | Verified | 8 cases; four normal-API fixtures under `tests/fixtures/expedition-schema36-*`: loading/held supplies, boarding, outbound and returning. Exact old36 roundtrips, unchanged source hashes across capture and retained provenance. Explicit selected order, all phases, cancellation, invalid/dead/missing crew ownership checked. `/tmp/spacefortress-expedition-selection-persistence-tests.log` |
| Shared controls and recording | Verified | 8 new cases plus38 previous regressions: optional array schema, player/agent parity, typed candidate/readiness/selected fields, named transitions, exact reconstruction/replay and bounded recording noninterference. `/tmp/spacefortress-expedition-selection-telemetry.log`, `/tmp/spacefortress-expedition-controls-regression.log` |
| Complete normal-colony orbital loop | Verified | `tests/orbital-colony-loop.test.js` starts untouched and uses shared actions only: crew-2/crew-4, sealed-route/paused-scrubber recovery, departure97, wreck119, skilled mining and physical cargo delivery, return169, shield fitting223. Returned components actually supply its4-component cost (starting stock3); all7 crew live; preparation/return checkpoints match. `/tmp/spacefortress-orbital-colony-loop-tests.log` |
| Complete regression suite | Verified | **775/775 passed**, zero failures/cancellations/skips,47.20 seconds; `/tmp/spacefortress-expedition-selection-tests.log`, session25804 exited0. Root inspected summary. 44 new cases: behavior9, safety11, conservation7, persistence8, instrumentation8, journey1. The later route-wording-only correction passed its focused shared-action and browser checks. |
| Browser UI and full supplied journey | Verified | `.runtime-qa/manifest-check.mjs`, `/tmp/spacefortress-manifest-browser.log`: actual player selections, unavailable draft retention, navigation, held-click/outside/cancel guards, read-only fixed roster, actionable blockage, no horizontal cargo overflow and the full normal journey above. Two reloads byte-identical; explicit player launch and12 lifecycle names recorded; no scoped app errors. Root viewed map, chosen crew, blocked loading, returned cargo and installed-shield screenshots. Final wording rerun session93980 exited0. |
| Source and documentation checks | Verified | All75 source modules passed syntax; final changed preflight module rechecked afterward. Root checked633 local links across62 Markdown files after acceptance/archive edits: zero broken links. |
| Runtime cleanup | Verified | All eleven workers completed. UI-owned QA3907057/3907059 stopped; root confirmed8421/9223 closed and user preview8420 PID3703011 still serving `/` and `/elements.html` with HTTP200. |
| Full requested game | Pending | One two-person mission among fixed destinations; no staffed outpost, generated regions or connected local decks. Broader180-system conversion remains incomplete. |

## Historical electrical isolation release — schema 36

| Check | Status | Evidence and scope |
| --- | --- | --- |
| Physical construction and controls | Verified | 8 new cases: delivered materials, open/manual defaults, placement, atomic/no-op controls, isolation, destruction, supplied repair retaining latch and safe reset conditions; `/tmp/spacefortress-breakers-behavior-tests.log` |
| Terminal graph and integrated topology | Verified | 8 pure graph cases include 40 ordinary layouts matching legacy BFS/circuit IDs; 10 independent integration cases cover orientations, facing contacts, reverse supply, bypass, separate memberships, fire/damage/repair and old allocation order. `tests/power-topology.test.js`, `/tmp/spacefortress-breaker-topology-integration.log` |
| Finite power and preview purity | Verified | 11 cases: repeated read-only observations/refresh/validation, backfeed, denied faults, series/multiple trip passes, per-bank rates, all-or-nothing loads and one final reactor/fault commit; `/tmp/spacefortress-breakers-conservation-tests.log` |
| Physical cascading systems | Verified | 3 cases: actual hauling into tank→intake→floor outlet→wet wire→trip while life support filters, followed by supplied refinery recovery; bypass and downstream bank hazards remain real. `/tmp/spacefortress-breakers-cascades-tests.log` |
| Genuine preceding35 migration and saves | Verified | 12 cases; migration changes only version, preserving exact owned state and diagnostics. Deterministic trip/reset continuation; malformed state/jobs rejected; later construction-site pile and reservations retained. Durable fixture/provenance `tests/fixtures/breakers-schema35-owned*`; `/tmp/spacefortress-breakers-migration-tests.log` |
| Shared controls and recording | Verified | 7 new cases: player/agent parity, exact action schemas, typed state/derived conditions, transient prior/next/fault events, no-op suppression, reconstruction and bounded recording noninterference. `/tmp/spacefortress-breakers-telemetry.log` (38 including prior instrumentation) |
| Complete regression suite | Verified | `node --test tests/*.test.js`: **731/731 passed**, zero failures/skips/cancellations, 43.35 seconds; `/tmp/spacefortress-breakers-tests.log`, session83167 exited0; root inspected terminal summary. 59 new cases. |
| Browser controls, artwork and saves | Verified | `.runtime-qa/breaker-check.mjs`, `/tmp/spacefortress-breaker-browser.log`: actual construction designation and shared controls, manual isolation, prediction/trip/reset/retrip, tripped reconfiguration, visible bypass/backfeed advisories, held-click/outside/cancel guards, labels/events and save36 reload/navigation. Root viewed map, trip and both collapsed-advisory screenshots; no scoped application errors. |
| Source and documentation checks | Verified | All 74 source modules parsed; 554 local links across 59 Markdown files resolved after acceptance/archive edits. |
| Runtime cleanup | Verified | All eleven workers completed. UI-owned QA3870081/3870082 stopped and8421/9223 closed; user preview8420 PID3703011 retained; root rechecked both preview pages HTTP200 and closed QA ports. |
| Full requested game | Pending | Rated overloads/fuses, local decks, generated regions, staffed outposts and the broader180-system conversion remain incomplete. |

## Historical closed-plumbing release — schema 35

| Check | Status | Evidence and scope |
| --- | --- | --- |
| Construction and device behavior | Verified | 9 cases; delivered materials, empty storage, pumps/power/valves, overlays and physical dismantling recovery; `/tmp/spacefortress-plumbing-behavior-tests.log` |
| Production adapters and shipment claims | Verified | 9 logistics cases plus 7 reservation-helper cases; actual hauling and tank-to-farm production still require fertilizer/operator. Source pickups and incoming shipments remain protected; `/tmp/spacefortress-plumbing-logistics-tests.log`, `/tmp/spacefortress-plumbing-reservations-tests.log` (88 including existing regressions) |
| Water conservation | Verified | 10 cases: unequal fill, saturation, closed/boundary leaks, competing floor transfers, recovery cycles, explicit losses and deterministic continuation; `/tmp/spacefortress-plumbing-conservation-tests.log` |
| Hazards and physical maintenance | Verified | 10 new cases and 46 existing regressions; distinct overlay damage, paid repair, all cancellation phases and removal; `/tmp/spacefortress-plumbing-maintenance-tests.log`, `/tmp/spacefortress-plumbing-hazards-regressions.log` |
| Migration and validation | Verified | 11 cases; genuine schema 34 fixture captured before source edits with unchanged hashes, exact old ownership retained, deterministic continuation and invalid controls/jobs/ledgers rejected; `/tmp/spacefortress-plumbing-migration-tests.log`; fixture/provenance in `tests/fixtures/plumbing-schema34-owned.*` |
| Controls and instrumentation | Verified | 9 new plus 22 existing cases: shared actions, composed observations, nonzero source/destination claims, transient owner-slot events, replay and bounded noninterference; `/tmp/spacefortress-plumbing-telemetry.log` |
| Complete regression suite | Verified | `node --test tests/*.test.js`: **672/672 passed**, zero failures/skips, 42.60 seconds; `/tmp/spacefortress-plumbing-tests.log`, session70681 exited0; root inspected summary |
| Browser controls, art and saves | Verified | `.runtime-qa/plumbing-check.mjs`, `/tmp/spacefortress-plumbing-browser.log`: tank-to-consumer delivery, floor intake/outlet, wet-wire fault, nonzero claim readings, actual shared controls/jobs, held-click/cancel guards, overlay exclusion and save35 reload. Root viewed default map and target-claim screenshots; no scoped application errors. |
| Source and documentation checks | Verified | 71 source modules passed syntax; 481 local links across 56 Markdown files passed after acceptance/archive edits; no broken links |
| Runtime cleanup | Verified | All eleven workers completed. Owned QA processes stopped; user preview8420 PID3703011 remains live. |
| Full requested game | Pending | Plumbing is a scoped increment. The broader 180-system conversion, generated universe, staffed outposts and real local levels remain incomplete. |

## Historical retained-exhaust release — schema 34

| Check | Status | Evidence and scope |
| --- | --- | --- |
| Physical devices and behavior | Verified | 10 new tests: delivered construction, passive empty storage, selective powered filtering, finite capacity, proportional exhaust/target, power/valves, damage, demolition and save continuation; `/tmp/spacefortress-exhaust-behavior-tests.log` |
| Species and smoke conservation | Verified | 9 independent cases including smoke-only flow, full nodes, pressure bounds, contaminated supply, boundary release and a 360-step control/damage schedule; `/tmp/spacefortress-exhaust-conservation-tests.log` |
| Migration and validation | Verified | 8 cases including genuine prior schema 33 browser save, deterministic continuation and malformed state/overflow rejection; `/tmp/spacefortress-exhaust-migration-tests.log`. Durable fixture and provenance in `tests/fixtures/gas-schema33-retained.*` |
| Shared controls and recording | Verified | 7 independent cases: strict actions, player/agent parity, semantic transient transfers, detached observations, replay/reconstruction, bounded recording and save/RNG noninterference; `/tmp/spacefortress-exhaust-telemetry.log` |
| Complete regression suite | Verified | `node --test tests/*.test.js`: 607/607 passed, zero failures/skips, 39.58 seconds; `/tmp/spacefortress-exhaust-tests.log`, session16441 exited0; root inspected terminal summary |
| Browser controls/art/save | Verified | `.runtime-qa/exhaust-check.mjs`, `/tmp/spacefortress-exhaust-browser.log`; actual mode/target/enable/valve/power controls, retained contaminants, smoke-only pump, storage blockage, labels/events and save 34 reload. Held-click, focus, outside-release/cancel safeguards passed. Root viewed default map and filter inspector screenshots. No scoped application errors. |
| Source syntax and documentation links | Verified | Root checked 68 source modules and 414 local links across 53 Markdown files after acceptance/archive edits; no syntax errors or broken links |
| Full requested game | Pending | One local floor/site, fixed destinations/crew/mission limits and wider180-system conversion gaps remain; passing607 tests is not completion of SPACEFORTRESS |

## Historical gas-distribution release — schema 33

| Check | Status | Evidence and scope |
| --- | --- | --- |
| Existing atmosphere, power, fire, liquid, reactor and telemetry regressions | Verified | 101 tests passed; `/tmp/spacefortress-gas-core-regressions.log`; terminal summary inspected by root |
| New colony create, step and save/load | Verified | Root executed a fresh schema-33 colony through three ticks and deserialized it successfully |
| Gas-specific tests | Verified | 21 passed, `/tmp/spacefortress-gas-focused-tests.log`; root reviewed cases for physical supply, conservation, failures, controls and persistence |
| Complete regression suite | Verified | `node --test tests/*.test.js`: 573 passed, zero failures/skips, 41.7 seconds; `/tmp/spacefortress-gas-full-tests.log`, terminal summary inspected by root |
| Gas UI and browser controls | Verified | `.runtime-qa/gas-network-check.mjs`, `/tmp/spacefortress-gas-network-browser.log`; root inspected route/vent screenshots and script. Hidden drawers, shared controls, direction/target/refill/repair/removal, labels/events and schema-33 reload passed. A held-click loss was reproduced and fixed; held click across a tick, outside release and synthetic cancellation passed. |
| Source syntax and local documentation links | Verified | Root checked all 68 source modules and 252 local links across 47 Markdown files, including the slim memory and historical archive |
| Full requested game | Pending | Generated universe/history, real local z-levels, wider DF conversion and many colony systems remain incomplete; see [implementation status](implementation-status.md) and [conversion inventory](conversion-inventory.md) |

## Historical water release — schema 32

| Check | Status | Evidence and limit |
| --- | --- | --- |
| Full simulation suite | Verified | 552 tests passed; `/tmp/spacefortress-liquids-tests.log`; 523 colony and 29 isolated lab cases |
| Water increment | Verified | 16 focused tests, plus Firefox player controls, artwork, events and wet save/reload; `.runtime-qa/liquids-check.mjs`, `/tmp/spacefortress-liquids-browser.log` |
| Reactor increment | Verified | 17 colony tests plus earlier Firefox controls and save/reload; `.runtime-qa/colony-reactor-check.mjs`; current constants shared with the lab |
| Source syntax and local links | Verified | Root checked 66 source modules and 180 local links after the water release |
| Performance and every historical UI interaction | Pending | These checks were scoped; they do not establish sustained performance or complete end-to-end coverage of every older feature |

Detailed mechanics and case coverage live in [gas distribution](gas-networks.md), [floor water](floor-water.md), [reactors](reactors.md), [elements lab](elements-lab.md), and each topic linked from [implementation status](implementation-status.md).

## How to update this index

1. State the exact feature/scope and check performed, then its result and artifact location. Keep full logs/screenshots out of root memory.
2. Preserve relevant limitations and unresolved failures. Never turn “planned” into “verified” through compression.
3. When implementation changes, mark affected prior evidence historical or pending until a proportional check covers the change.
4. Keep detailed local logs and browser profiles outside the repository. Record reproducible commands and the relevant result here.
