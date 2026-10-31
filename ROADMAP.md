# SPACEFORTRESS roadmap

## Current systems work

- [x] Local after v0.1.12: couple room pressure to temperature across breathing, gas flow, life support, vents, exhaust, suit transfers, airlocks, fire and reactor cooling. Schema75 preserves old physical state and updates derived readings. Automatic supplies batch tiny deficits while retaining finite partial deliveries.
- [ ] Extend thermal transport to carried gas and pipe/tank contents; add finite water heat and phase changes.

Release v0.1.12 adds engineering kits and a three-planet, eight-site system with hierarchical navigation. It builds on the paid material choices, repairs and finite slab heat conduction from v0.1.11, while retaining existing colony worlds. Local follow-up adds fuel synthesis from recovered solar cells and delivered water, and haulers now install those cells into surface batteries. Next checkpoints include wider industry, bounded upstairs habitation and sustained outpost supply.

- [x] Local after v0.1.12: add disposable two-terminal fuses with immediate overload opening, paid physical replacement, separate box repairs, finite salvage and actual-floor controls. Schema74 preserves existing breakers.
- [x] Local after v0.1.12: route finite power through physical contacts and trip overloaded breakers after three supplied ticks. Preserve battery backfeed, simultaneous/cascaded trips, upper risers and final-only fuel/energy effects; shared controls and schema73 retain old breaker state. Disposable fuses now use the same mechanism.
- [x] Local after v0.1.12: accept or decline recruits, land at the actual pad, and integrate appended crew with food, paid work, housing, relationships and care. Schema72 preserves existing people and custody.
- [x] Local after v0.1.12: set per-resource depot delivery limits. Count shared space, reserved stock and incoming claims; preserve refunds and reroute cargo after policy changes. Shared actions, per-floor observations and schema71 migration keep physical custody intact.
- [x] Local after v0.1.12: surface bristleback herds fall silent before a debris forecast. Reconcile herd loss in the same tick; preserve old saves and expose named transitions to local agents.
- [x] Local after v0.1.12: haulers install one stored power cell as 100 kJ in a surface battery, including an upper floor. Injection waits for the finished job; cancellation returns the cell. Schema70 preserves schema69.
- [x] Local after v0.1.12: add staffed, paid fuel synthesis using finite solar cells and water, shared power/hauling/orders and schema69 persistence.
- [x] v0.1.12: generate multiple planets with distinct finite landing/derelict sites and a hierarchical map. Preserve existing world catalogs through schema68; verify native return/revisit on every generated destination.
- [x] v0.1.12: manufacture and equip engineering kits for native construction/maintenance; preserve finite wear, actual-floor transport, supplied same-identity repairs and family/material stock targets through schema67.
- [x] Use shared alloy/composite material definitions for tools and paid habitat parts. Preserve floor/structure ownership, physical costs, supplied repairs, cancellation, rounded refunds, thermal paths and schema66 saves.
- [x] Generate two playable orbital sites per new colony, with finite resources, paid visits, saved construction/depletion, separate residents and initial surveys. Preserve old four-site colonies through schema65.
- [x] Resolve crew fire exposure, wreck shelter and docked-shuttle protection on the actual floor; identify exposure tiles consistently for crew and animals.
- [x] Manufacture alloy/composite mining tools from delivered materials; preserve item identity through native pickup, actual mining wear, repair and schema64 saves. Keep player controls and structured actions aligned.
- [x] Make solar generation respect overhead terrain and structures; expose the blocking floor to players and agents, preserve finite battery accounting, and migrate older saves through schema59.
- [x] Extend paid airlock-controller construction, admission, cycling, recovery, rescue passage, controls and persistence to upper floors. Keep per-floor assemblies isolated, validate exposed-walkway pressure and reject unowned stair/gas-riser bypasses. Bounded checks pass; ordinary upstairs endurance remains incomplete.
- [x] Enable upper-floor fire suppression and automatic repair/service using the existing finite water/alloy delivery, crew duties, stair routes, cancellation and save rules.
- [x] Add paid planter beds and upper-floor planting, watering and gathering through actual stair routes, finite propagules/moisture, floor-aware controls and schema62 saves. Preserve water on bed destruction; use overhead sunlight checks for sunberries.
- [x] Recover finite impact ore and declared natural resources/salvage on actual floors, with native Mining work, stair hauling, capped reserves, source revalidation, construction interruption and schema63 persistence.
- [x] Connect fire spread across open/damaged stair hatches, preserving destination fuel/oxygen/water checks, hatch containment, named ignition events and existing suppression/save behavior. Bounded checks pass; ordinary upstairs endurance remains unfinished.
- [ ] Extend terminal-specific work when broader orbital logistics introduces destinations beyond the current fixed ground terminals.
- [ ] Complete the ordinary upstairs build-and-live journey, including supplied care and operation through a full night.

- [x] Enable animal movement and handler escorts through stairs, upper-floor post assignment and supplied care/collection, floor-aware carcasses and births, safe stair removal, and schema58 persistence. Bounded checks pass; ordinary upstairs living remains unverified.

- [x] Implement shared stair damage, paid repair and safe dismantling. Claim both endpoints, retain materials when closure is blocked, preserve cancellation and multi-floor save custody, and show the same job at both landings.
- [x] Connect floors with paid power, gas and water risers, retaining independent utility isolation and finite contents.

- [x] Connect the floor selector, upstairs map/inspection/build controls, crew navigation, stair artwork and hatch controls. Invalidate held clicks on view changes and identify floor-specific hazards. Verified with focused UI/control/render tests; the broader build-and-live acceptance remains incomplete.

- [x] Build stairs through paid physical jobs, bootstrap only an empty upper grid and landing, enforce support beneath upper floor extension, and persist declared floors/links through schema55. Preserve legacy saves and cancellation custody. Upper airlocks and solar occlusion are implemented in later checkpoints above.

- [x] Implement the shared stairwell connection core: routed crew/cargo/patient movement, hatch controls, finite gas/smoke/heat exchange and bounded downward water flow. A declared-link scenario carries inputs upstairs and finished output back down. Paid construction, multi-floor saves and the selector are covered by the later milestones above; animal traversal is covered by the later checkpoint above.

- [x] Carry input and output through a staffed production cycle on a declared floor; record actual inventory owners. Extend paid medical treatment, bedside meals, hygiene and rescue to the same floor, preserving physical delivery and waste custody. Six bounded scenarios cover these interactions; later stair/save milestones above connect these floors.

- [x] Run staffed production and basic crew needs within a declared floor: physical machine operation, meals, safe bunks, downtime and finite suit refills. Eight bounded synthetic scenarios cover the new behavior; later stair/save milestones above connect these floors.

- [x] Run paid basic construction within a declared floor: reserve reachable local supplies, assign a worker, carry materials, complete the correct tile and preserve cancellation custody. Crew walking and automatic doors retain the floor. Vertical connections and multi-floor saves remain pending.

- [x] Extend explicit deck targets to eleven production, storage, room, housing, maintenance and gate controls. Scope job cancellation/priority, haul claims and occupancy checks to the actual floor; retain committed materials. Staffed production and basic needs now also execute within a declared floor.

- [x] Route sixteen equipment controls through explicit optional deck targets, preserving player bindings, device protections and ground defaults. Reject undeclared floors before mutation. Construction and living-space commands are now converted; airlock commands remain pending.

- [x] Separate pastures, mating, birth occupancy, grazing, pest food searches and trap capture/payment by deck. Observation9 records full pasture cells and distinct upper plant/pasture IDs; extra floors still await shared controls, movement and presentation.

- [x] Give room-purpose anchors deck ownership; keep occupants, residents, furniture, waste, comfort, shelter destinations and outpost diagnostics on their actual floor. Save54 migrates old assignments without changing physical state.

- [x] Keep fire spread, reactor cooling and debris damage on their actual deck. Save53 preserves forecast/history positions; upper fire and maintenance jobs remain explicitly blocked until movement and shared commands support them.

- [x] Keep gas pipes, water pipes, pumps, leaks, dismantling recovery and horizontal floor spills on their own deck, with scoped transfer records. Vertical fluid connections and gravity through openings remain pending.

- [x] Separate cable networks, batteries, loads, breaker branches and wet-fault diagnostics by deck; preserve ground save identities. Paid vertical utility connections are implemented with explicit endpoint isolation.

- [x] Separate stacked room reservoirs, horizontal gas/heat flow and rebuilding by deck; migrate old room ownership without changing stored gas or heat. Vertical openings and utilities remain pending.

- [x] Persist full airlock positions and migrate active cycles, ownership and reservations without resetting gas, power or progress. Additional playable decks still depend on environment and command conversion.

- [x] Return recovered extractor gas through a real passive refill path, preserving finite supplies and existing safety gates.
- [x] Cover finite pocket transfers, closed idle/paused ports, all hex orientations and save continuation in 60 affected checks.
- [x] Correct release pressure drift through existing finite transfer phases, refusing to seal an occupied doorway or split party.
- [x] Complete two synthetic cargo roundtrips with native load/unload, finite oxygen makeup, physical supply delivery and healthy crew return.
- [x] Replenish bound supply tanks through finite native deliveries, preserving recovery headroom and queued admission gates.
- [x] Complete two finite cargo rounds after native exterior-tank replenishment, retaining singleton custody and the existing resource budget.
- [x] Add a bounded one-batch production/delivery helper with finite payment, typed records and preserved partial work.
- [x] Finish the actual ten-air delivery, survive finite night standby and restore daytime controls and balanced crew routines from the preserved stop.
- [ ] Establish durable airlock makeup across repeated supplied cycles; the finite two-round check passes, while ongoing production/resupply remains pending.
- [ ] Prepare a paid tank retrofit with ore refining, component fabrication and preservation of stored gas and production capacity.
- [ ] Complete the ordinary finite cargo return with sufficient chamber oxygen and native cargo custody throughout. Paid loading/unloading passed; return stopped on habitat sanitation injury. Waste containment now removes exposure, while both parcels remain carried and medical recovery is pending.
- [ ] Establish overnight thermal conditioning before claiming sustained airlock operation.


**Release build: v0.1.6 / schema59 · Local build: schema60.** SPACEFORTRESS is an early playable colony simulator growing from a planetary foothold into orbit and farther space. This roadmap orders the next playable increments; it promises no dates.

See the [README](README.md) to play, [verification status](docs/verification-status.md) for evidence and limits, and the [180-system conversion inventory](docs/conversion-inventory.md) for the wider backlog. Completing a milestone below does not complete an entire inventory family or establish full Dwarf Fortress parity.

## Current direction: strengthen shared simulation systems

Ordinary hauling now has named quantity records for pickup, partial/full delivery and setdown, alongside existing item identity records. Five focused cases verify quantities, sanitary output, rejected pickup and save/recording parity. Broader inventory flows retain their specialized events; sustained supply and cargo acceptance below remain unfinished.

Build future gameplay on reusable resource, job and simulation rules. Finite emergency suit resupply connects local physical storage to crew recovery when no safe room is reachable; it preserves gas accounting and shared movement rules. A manual suit-to-room valve now transfers finite personal oxygen into the occupied sealed compartment, with shared controls, capacity checks and typed ownership records. This gives emergency agency; it does not establish recovery of the stopped colony. Crew work assignment and structured observations now share one readiness function with stable blocker codes; current work eligibility includes all simultaneous constraints. Workstations also distinguish qualification from personal availability and preserve valid current operations. The simulation rules and thresholds are unchanged. Destroyed traps now respect building condition, and capture events expose their physical bait cost. Focused checks cover healthy and broken traps, insufficient bait, multiple traps and paid repair before capture resumes. The current local fixes preserve fresh food after an older portion is eaten and count delivered dock imports toward machine stock targets. Focused checks cover interrupted meals, save continuation, actual freight unloading and food recipe filtering. See [verification status](docs/verification-status.md) for the combined checks.

The reviewed colony is at tick 2167 with the infestation cleared and two curd portions delivered through ordinary livestock work and hauling. The direct air-production route exceeds the sole available operator’s fatigue budget. Next: review a distinct recovery dependency before another attempt; home air and full suits remain unfinished. Paid ice/water processing has a real colony trace; sustained supply and the ordinary livestock/kitchen journey remain unfinished.

A separate fresh-colony airlock trial now proves paid assembly: mining and manufacturing finished at tick 322, and all 22 placements were installed by tick 418. At assembly, commissioning was unfinished. The run stopped at tick 518 during crew return, with unsafe home air and insufficient packaged-air reserve. A finite suit-to-room release briefly restored breathable air, but the continuation stopped at tick 548 with one crew member on the inner door. All seven remain uninjured. The paid continuation subsequently completed sixteen replacement-air batches and returned all seven crew to safe home air at tick 1076. Before gas recovery began, debris damaged a chamber wall at tick 1200; all seven remained uninjured and the habitat stayed safe. One remaining ore was subsequently refined, and one alloy paid for the wall repair at tick 1245. The return trial stopped at tick 1292 with exhausted packaged air, unsafe habitat and chamber air, and one engineer still in the chamber; all seven remain uninjured. The reusable recovery helper then advanced that preserved state to tick 1372: two water paid for 20 air, all seven crew returned home uninjured, both rooms had safe air, ten air remained reachable and the battery held 120. The recorded run used 80 full ticks and 16 other commands; independent gas-family, water and energy accounting closed within 1e-8. The [bounded commissioning helper](tools/paid-airlock-commissioning.mjs) then recovered chamber gas and established the owned idle controller at tick 1400. All seven crew were healthy and home, the doors were closed and intact, the empty chamber was at vacuum, the predicted refill mixture was source-safe, ten air remained reachable and the battery held 120. Original crew labors, balanced routines, farm and scrubber were restored, with no jobs. This single run took 28 full ticks and 25 other commands; all 53 actions succeeded, 430 records were contiguous and independent gas-family/energy errors were zero. Next: verify the named parcel outward/return journey and its finite air/power needs. These results leave the separate tick-2167 colony's recovery unresolved. See [verification status](docs/verification-status.md) for exact limits.

The [local construction example](tools/paid-airlock-example.mjs) now reproduces the paid build through shared commands and can export its colony. Its distinct command schedule reached assembly at tick 407 with breathable home air and all seven crew uninjured. The focused recorded check covers physical deliveries, typed work, finite reserves and save import. The separate preserved continuation completed replacement-air production, repaired debris damage and exhausted its air during crew return. The [offline recovery helper](tools/paid-air-recovery.mjs) subsequently restored its finite air supply and crew return; its 14 focused mechanics checks pass. The commissioning helper passes ten focused mechanics checks and established one ordinary commissioning checkpoint. Passage and endurance remain unfinished.

## Latest local acceptance: paid component recovery

The tick-951 colony completed one paid satellite salvage trip, returning three components to usable surface storage at tick 1127. The 176-tick, ten-command run preserved all original crew and animal health. Resource/gas accounting, recorded transitions and six exact reloads passed independent review. These parts make the existing ice processor affordable without removing the atmosphere processor.

The stop has 16 alloy, three components, 6.5 water and 5.38 air mix aboard the shuttle. Home oxygen is below the breathable limit; suits remain 86.475–96.7% full. Next, verify paid construction, finite ice extraction, water production and air recovery. This accepts a material prerequisite, not an ongoing supply chain.

## Latest supply-chain result: production passed, recovery incomplete

The paid continuation from tick 1127 to 1927 completed construction, four ice extractions and twelve water-processing batches: 24 ice became 24 water, and twenty atmosphere batches consumed 20 water to make 200 air. Both machines ended paused with no unfinished batch; 10.5 water remains. The 800-tick, thirteen-command run stopped at its limit without meeting full recovery. No retry or rewind was performed.

Home air was breathable for 101 measured ticks, then fell below the limit again. A debris strike at tick 1200 damaged wall 14,8, which remained at 65% condition and leaked. Tibbles consumed all thirteen stored food portions and produced six offspring. A subsequent paid repair restored wall 14,8 to full condition at tick 1942: one alloy, 15 ticks, everyone healthy, with exact reloads and reconstructed recording verified. A subsequent paid trap and two wild harvests cleared eight tibbles by tick 2080, but all four food portions were consumed (two for bait, two for pest feeding). The run stopped at its tick-2122 ceiling with no positive food reserve. A subsequent 45-tick livestock collection delivered two curd portions into storage at tick 2167, with everyone healthy. Next: check available crew and review a further paid water/air continuation. Full suit recovery, ongoing food supply and colony endurance remain unverified.

## Earlier local acceptance: finite room and suit reserves

The unchanged v0.1.4 runtime completed one reviewed 460→951 continuation: 491 ticks/four commands, 24 paid batches including the prior committed batch, 240 air from 24 water. Every end-of-tick check was breathable across both nights; all seven suits reached 100% and all seven crew/five animals remained fully healthy. Three exact reloads and conserved quantities passed independent review.

At the stop, room pressure was 100% and pressure-adjusted oxygen 18.003%. Only 10.5 water and no packaged air remained; the processor was paused and empty. This accepts the measured finite room/suit reserve, not a universal 24-water recipe, sustained exterior readiness or indefinite endurance. The original tick-144 and tick-384 stops and tick-460 minimum-air checkpoint remain preserved below. The runtime and save version are unchanged.

## v0.1.4: explain air limits and recover finite supplies

- Shared breathing reasons distinguish oxygen concentration from pressure-adjusted oxygen. The hidden inspector explains the failed limit; local-agent observations use the same classification. Gas arithmetic, thresholds and save schema remain unchanged.
- Save import preserves the actual prior speed, including pause, across completion, failure and cancellation. Local browser review confirmed the paused tick-144 import and readable full-width warning.
- The full local gate passed 1,282 checks, zero failures and one intentional skip. After the warning layout changed, only the seven affected presentation checks were rerun and passed.
- Preserve both earlier stops: ordinary livestock play stopped at 144 on home air; a separate paid recovery reached its 384 budget with one ten-air batch and no breathable tick. The reviewed 384→460 continuation produced 40 air from four water in 76 ticks/three commands and reached 12 consecutive breathable ticks. All seven crew/five animals stayed healthy, with three exact reloads.
- The endpoint has exactly 56 room oxygen units, the breathing minimum, and suits at 76.79–78.49%. It establishes bounded recovery only. Exact hosted verification belongs to the [v0.1.4 release record](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.4); the local results above retain their stated scope.

See [atmosphere](docs/atmosphere.md) and [verification status](docs/verification-status.md) for quantities, source scope and remaining work.

## Published v0.1.3: physical bodies and meat meals

Version 0.1.3 collects seventeen development commits since v0.1.2 and the new butchery increment. Hex construction, finite air recovery, crops and meals, native plants, cultivation, veterinary care and inherited traits are included. Local verification covers 1,264 distinct passes and one intentional skip, including the exact repair of one stale recipe-option fixture after the first full run. Focused food/body/interface/integration coverage is 8/49/9/77. See [release readiness](docs/release-readiness.md) and the linked release record for local and hosted scopes.

- Death leaves one physical body while retaining the animal's identity and ancestry. Handlers must collect and carry fresh bodies to a post before processing them; spoiled bodies can be discarded. Age continues through every phase.
- Tame adults can be ordered for slaughter with breeding disabled and no carried brood. Fixed yields are four bristleback meat or three glazefoot meat per adult; naturally dead juveniles yield one. Processing creates 0.25 waste. No skill or trait yield bonus applies.
- Bristlecap braise and Sunberry glaze roast bring the galley to ten recipes. Both combine one meat and one plant ingredient into two prepared units, retaining ingredient age and existing quality rules.
- Schema 46 migrates hex schemas 40–45 without creating food from historical deaths. Square schemas 1–39 remain incompatible and protected for export.
- Focused mechanics and migration checks pass. The ordinary trial stopped on unbreathable home air at tick 144 after two paid posts and two care deliveries, before slaughter or meat; all seven crew and five animals stayed healthy. Complete ordinary chain acceptance remains pending. Fat, bone, hide, fibre, disease, old age and broader food webs remain future work.

See [butchery](docs/butchery.md) for controls, costs and scope.

### Next: habitat air and the ordinary livestock/kitchen journey

Paid water production, wall repair and paid trap construction have ordinary traces through tick 2122. The current infestation is cleared; a subsequent ordinary livestock harvest delivered two curd portions into storage at tick 2167. Full home/suit air recovery remains. Complete that recovery, then verify finite exterior-work demand and air isolation without losing safe habitat conditions. Sustained supply, paid airlock commissioning and a parcel roundtrip remain unverified. Continue only from reviewed physical state to prove ordinary taming, slaughter, body carrying, butchery, ingredient delivery, cooking and eating while keeping the colony safe. This precedes wider ecosystem expansion. The earlier supplied food/breeding trials and the two-night indoor reserve do not replace that acceptance.

## Recent increment: inherited livestock traits

- Individual bristlebacks and glazefoots have inherited thermal preference and metabolic pace. Temperature specialization shifts both limits by up to 5 °C; production speed and nutrition drain move together by up to 20%.
- Actual production, juvenile/adult nutrition, thermal injury and veterinary recovery use the same profile. Yields, work, growth time, brood duration and existing injury/pasture gates remain fixed.
- Conception freezes ordered parent genomes and selected child traits; birth copies that result. Founders vary deterministically without consuming global randomness. Existing hex colonies migrate to balanced current performance, with segregation possible in later offspring.
- Focused domain 49, integration 85 and panel 12 distinct checks pass. First full regression: **1,210 passed, zero failed, one intentional skip**, with 229 dependencies unchanged. An actual old save and supplied family/injury cases migrate without physical changes and reload exactly. One supplied-parent/pasture trial stopped at the first healthy inherited hatchling at tick 301/three commands, with six exact reloads and no physical inventory changes. Folded founder/brood/offspring details, breeding policy and a 390-pixel layout passed browser review. Ordinary herd construction and long-term balance remain unverified.
- Mutation, disease, old age, fibre, wider ancestry rules, fuller ecosystems and ordinary herd-construction/endurance acceptance remain future work.

See [animal traits](docs/animal-traits.md) and [breeding](docs/breeding.md). These systems are included in v0.1.3.

## Recent increment: cultivated ground beds

- Crew plant fungal caps or sunberries using one matching raw-food portion, real delivery and Production work. Watering delivers a finite 0.5 dose; dry or dormant beds keep their progress.
- Managed beds retain moisture and regrow into the existing physical harvest, hauling and cooking chain. Floor absorption, unused doses and removal preserve water through explicit transfers and ledgers.
- Schema 44 preserves earlier hex colonies and labels each bed generation so stale orders cannot target replacement plants. Folded inspector choices keep the map prominent.
- Domain 36/36, panel 12/12 and 113 distinct job/migration checks are covered. Combined regression: 1,177 distinct passes and one intentional skip; two stale schema assertions were corrected after the full run and passed their affected checks. Actual planting/watering cancellation, growing/mature beds, harvest availability and a 390-pixel browser layout passed.
- One fresh-colony propagation-to-harvest cycle passed at tick 853 with six commands and no grants: one raw fungal-cap portion plus one water yielded two portions. Everyone stayed healthy; 24 checkpoints reloaded exactly. Longer-term balance and a complete ordinary livestock/cooking construction chain remain unverified.
- Spreading, wild-soil moisture, orchards, soil chemistry and broad ecosystem balance remain future work.

See [cultivation](docs/cultivation.md) for the physical costs and conditions. These systems are included in v0.1.3.

## Recent increment: livestock health and recovery

- Implemented locally: species temperature tolerances, persistent fire/thermal injuries, manual medicine treatment and gradual recovery at husbandry posts. Injury and substantial thermal strain pause products, collection, growth and brood development without discarding progress.
- Medics physically reserve, carry and apply one medicine through 20 Medicine work. Treatment covers up to 20 injury; a fed animal recovers at its intact post. Feeding and treatment can share the post, with feeding first; cancellation, death, post loss and transport preserve located supplies.
- Schema 43 adds neutral condition records to earlier hex saves without changing health or granting treatment. Shared actions, observations and named injury/recovery events remain available to local agents.
- Verification: 1,150 Node checks passed, zero failed and one intentional skip. The supplied injured-adult/post trial completed at tick 116: one medicine, ten injury healed gradually, 20 Medicine experience, everyone healthy and five exact reloads. Actual browser treatment/cancel, recovery display, save/reopen and narrow layout passed. A final display-only label correction was verified in the refreshed browser.
- Diseases, detailed wounds/surgery and fibre production remain future work. Physical bodies and meat are covered in the current increment above. The ordinary farming/livestock construction chain and longer-term husbandry balance still need acceptance. Inherited traits are covered above.

See [veterinary care](docs/veterinary-care.md) for the care loop and its scope. These systems are included in v0.1.3.

## Recent increment: flora, livestock and food variety

- Implemented locally: fungal caps, siltgrain and sunberries; fungus-fed glazefoots producing eggs; distinct bristleback curd; eight initial galley recipes; Production skill gates and four meal-quality tiers.
- Ingredients remain physical goods, with exact food kinds, spoilage ages, animal feed reservations and prepared-meal provenance. Recipe changes preserve committed batches and return incompatible waiting supplies.
- Native lichen, fungal caps and sunberries have persistent biomass, visible growth stages and environmental dormancy. Real Production work gathers mature plants into typed ground goods for hauling and cooking; grazing nutrition reflects actual biomass eaten.
- Schema 42 migrates schema-40/41 hex saves; legacy food, animals and lichen are preserved, with no edible-plant grants. No dependencies or remote assets were added.
- Historical flora regression gate: 1,120 passed, zero failed and one intentional skip. Focused checks cover growth, dormancy, grazing, harvesting, interrupted jobs, migration and structured observations. A fresh colony built a galley and completed gathering→hauling→fungal stew at tick 66 using five commands, with four exact reloads and everyone healthy. Browser checks cover the plant inspector, gathering/cancellation, maturity explanations, save/reload and a narrow screen.
- The previous supplied crop→care→eggs→omelet→eating trial passed at tick 605. Building that entire farming/livestock chain from a fresh colony remains unverified.
- Next ecology depth: wild-soil moisture, plant spreading, orchards and full biomes; diseases, fibre products and more preservation. Physical bodies and meat are covered above. Inherited traits are covered above; connected physical decks remain separate work.

See [food and ecology](docs/food-and-ecology.md) for current recipes and boundaries. This expansion is included in v0.1.3.

## Current direction: hexagonal construction grid

Actual hexagonal terrain and building tiles are implemented locally, retaining the isometric view. Shared six-neighbor geometry now drives movement, walls, sealed rooms, utilities, livestock boundaries and airlocks, with matching rendering and picking. Schema 40 identifies hex saves; square schemas 1–39 are rejected with their original bytes protected for export. The independent gravity-based elements lab remains square.

**Historical hex baseline:** focused physical and geometry checks, a full regression run of 1,057 Node passes / one intentional skip and retained 26 Python passes, and scoped Chrome checks for real hex rendering, pointer selection, a build ghost, utility overlays and a narrow inspector. Per-edge flow rates are retained, so six neighbors can increase total exchange compared with four.

**Next acceptance:** build and commission a cycling airlock using ordinary finite supplies from a fresh hex colony; move a named parcel through it and return it. The actual held-pointer form submission now passes; the wider outpost endurance/resupply/care journey remains incomplete. The hex grid and experimental airlocks are included in v0.1.3.

Ordinary finite play has reached a preserved **tick-3173 checkpoint**. Mining, manufacturing, replacement-air production, exterior construction, waste containment and a complete care-and-supply cycle have now passed within their recorded limits. All seven founders are healthy, with construction materials restored through real mining and production. The trial also exposed and fixed microscopic refill requests displacing useful hauling. A bounded air-replenishment trial then completed ice processing but reached its time limit with three air batches still pending because of limited power. A one-alloy scrubber repair and a measured battery-charging schedule subsequently finished the three pending batches while keeping everyone safe. A single supplied exterior trip then repaired two damaged solar arrays and restored daytime generation with a full battery, preserving the enclosure materials. Next, acquire enough replacement air, finish the paid enclosure, commission its gas reserve and complete the named-parcel journey. The [verification record](docs/verification-status.md) preserves the intermediate stops and limits.

## Completed within the current scope

### Playable colony and expedition baseline — complete

- Seven original alien founders; duties and skills, food, rest, social needs, housing, injuries and supplied medical care.
- Mining, physical hauling and construction, finite depots, staffed production, food preservation, farming, recycling and livestock.
- Compartment atmosphere and heat, gas distribution and retained exhaust, water plumbing and spills, fire/smoke, electrical circuits, batteries, reactors and wet-fault breakers.
- Supplied two-person expeditions to fixed wreck, comet and solar destinations; physical boarding, finite cargo, salvage return and paid upgrades.
- Isometric presentation with hidden detail drawers, local saves, shared player/agent actions, stable IDs and optional local recordings.

These systems have documented simplifications. The [ordinary colony-to-orbit journey](docs/orbital-colony-loop.md) demonstrates the current playable loop; broader compatibility, performance and feature coverage remain ongoing work.

### Outpost phase one: ownership and persistence — complete and verified

Save schema 37 adds separate arrival/return rosters, wreck residence records, durable shuttle freight and dock imports. Site-qualified reservations, cargo ownership, metadata/spoilage, migration, observations and physical shuttle presence are integrated. Tests cover resident-job preservation, local cargo isolation, physical pickup/return boundaries and rejected invalid state.

The schema37 foundation provided ownership primitives. The v0.1.2 preview now exposes freight, local construction, readiness, residence/return controls and site-local care. Complete ordinary outpost endurance and resupply remain unfinished. The [outpost design](docs/staffed-orbital-outpost-design.md) distinguishes the implemented foundation from those proposed systems; the [verification record](docs/verification-status.md) scopes the accepted tests.

## v0.1.2 preview — implemented systems, remaining acceptance

The v0.1.2 release published the tested schema38 preview at the user’s request. It implements physical freight, wreck construction, measured habitat checks, residence and return selection, site-local crew care and a one-pilot visit to an established wreck for final pickup. The evidence below keeps unfinished gameplay acceptance visible.

| Milestone | Current evidence |
| --- | --- |
| 1. Physical freight | Scoped simulation, ownership, save and player-control checks pass. |
| 2. Supplied wreck habitat | Real freight/construction and bounded commissioning have passed. A complete current-source construction/endurance recipe is pending; gas, heat and night power need further integration. |
| 3. Settlement and resident care | Focused local behavior and real named-resident player controls pass. Ordinary remote care and one complete fresh-colony resident journey remain pending. |
| 4. Delayed resupply and recovery | Physical pickup boundaries and finite parcel recovery pass scoped checks; the complete delayed-supply journey is pending. |

Paid departure loading now refreshes its air target in useful batches. A courier whose personal recovery is blocked can put down the actual parcel for another worker, retaining local job reservations and item metadata. These fixes preserve finite supplies; they do not supply a habitat. See the [evidence index](docs/verification-status.md).

## Playable milestones — acceptance requirements

### 1. Physical freight through shared actions

Expose a cargo manifest, supplied loading and unloading, cancellation and return-passenger selection through the same validated actions used by players and local agents.

**Acceptance:** workers physically move existing goods through reservation, carry, shuttle hold and dock imports. Capacity includes competing commitments; flight service reserves remain protected. Partial loading/unloading, cancellation, dead carriers and save/reload preserve quantities, food ages and item IDs. Rejected orders change nothing.

### 2. A supplied wreck habitat

Authorize local construction at the wreck, with reachable imports, local hauling, a depot, a sealed compartment, power and supplied life support. Reuse existing colony construction and utilities.

**Acceptance:** a fresh colony pays for and transports every required material. Crew build and commission the habitat through normal controls. New rooms begin empty and cold; actual gas, power and heating establish measured safe conditions. Local construction cannot spend distant stock, and a blocked route produces a recoverable delay.

### 3. Settlement and resident care away from the surface

Add explicit settlement controls and extend the existing work, eating, rest, shelter and care rules to residents at their physical site. Keep residence, location and flight membership distinct.

**Acceptance:** a named resident remains after the shuttle departs and continues useful work, eating, sleeping and receiving supplied care while the surface is viewed. Local shortages and hazards affect real needs. Settlement requires actual readiness; assigning residence or changing views never moves a body or refills supplies.

### 4. Delayed resupply and physical recovery

Join freight, construction and care into the first complete staffed-outpost journey. Make remote problems visible through compact site alerts and details on demand.

**Acceptance:** from an untouched colony, establish the habitat, leave a resident, return and deliver another shipment. Delay a later shipment using ordinary controls; show finite food, fuel or other consumed reserves decline and cause observable consequences. Recover by delivering supplies or physically collecting the resident, including a supplied response to an injured passenger. Save through each ownership boundary; remaining residents, jobs and stores stay at the wreck.

### 5. Pressure-cycling airlocks

Experimental automatic cycling is implemented locally and has scoped physical and control coverage: admit a crew member, close the entry door, recover air into finite storage before exterior release, and refill before opening toward the habitat. It uses gas extractors, pumps, reservoirs, vents and actual electrical power. The [cycling-airlock design](docs/airlock-cycling-design.md) defines the broader acceptance checks; ordinary paid assembly is verified; parcel traversal remains pending. The previous v0.1.2 build had manual doors and vestibules.

**Acceptance:** an ordinary supplied colony builds the assembly and physically carries goods out and back. Doors interlock; gas species, smoke and energy retain actual owners across repeated cycles. A normal cycle wait preserves the crew’s task and parcel. Full storage, empty reserves, power loss, damage and a carried patient produce measured safe pauses or explicit manual recovery. Save during partial transfer and traversal, replay named transitions, and verify compact player controls.

### 6. Connected local vertical decks

**Implemented foundation:** paid stairs, declared floors, floor selection, utility risers, airlocks, production, hauling, care, cultivation and livestock work now retain actual-floor positions. Floor-specific crew fire exposure, wreck shelter and terminal protection are corrected in local development. The ordinary supplied upstairs build-and-live journey through a full night remains incomplete.

Implement the [local-level design](docs/vertical-slice-design.md): two decks in one settlement, constructed connections, level selection and complete spatial references. Local height and orbital travel remain separate systems.

**Acceptance:** crew carry materials between decks, commission a second compartment and respond to a blocked connection or utility failure. Pathfinding, jobs, atmosphere, liquids, power, care and recordings respect their appropriate vertical connections. Migration preserves the existing floor without granting gas, heat or stock; both decks continue simulating when one is hidden.

### 7. Seeded planets and a wider universe

**First region implemented in v0.1.10:** one stable home planet groups the original sites plus a seeded outcrop and derelict. Finite deposits, route times/costs and debris differ. Both sites complete bounded supplied extraction, construction, return and revisit checks; focused synthetic cases cover independent residence and local work without the shuttle. Survey and action catalogs discover actual sites. Existing saves retain four sites without regenerated stores.

**Planet grouping in v0.1.12:** new worlds contain three planets and eight sites, including a resource landing and derelict at each frontier planet. Every generated destination passes bounded native supplied extraction, paid construction, return and persistent-revisit checks. Planet/site navigation is view-only, and prior four-/six-site worlds remain exact under schema68.

**Still pending:** a larger discovery/history system, travel between remote destinations and sustained ordinary habitation. The bounded route check pauses production to retain starter air for travel; it does not prove a self-sustaining colony.

Expand the [upward/outward progression](docs/orbital-progression.md) into generated destinations, persistent planetary identities, multiple settlements per planet, resource bodies and varied debris/solar hazards.

**Acceptance:** the same seed reproduces the same region and its finite opportunities. Survey information supports a meaningful destination choice. Travel consumes real supplies; revisiting preserves depletion, construction and occupants. Creating another settlement does not regenerate existing stores or reset its history.

### 8. Materials, tools and deeper production

**First chain implemented in v0.1.9:** finite extraction, refining, fabrication and workshop manufacture produce alloy/composite tools. Routed pickup, material/quality speed, actual-work wear, same-identity repair and schema64 saves are verified in a bounded staffed scenario. Shared structural properties now extend to floors, walls and doors in v0.1.11. Additional equipment families and deeper industry remain future work.

**Structural materials implemented in v0.1.11:** alloy and composite now share definitions across tools and supplied habitat parts. Floors and structures retain separate owners; composite changes physical construction/repair costs, solid conductivity and wall/door damage. Finite slab heat exchange, native upstairs delivery, cancellation and genuine schema65 migration pass focused checks. Floor collapse and exterior slab radiation remain future work.

**Engineering equipment in v0.1.12:** paid alloy/composite kits improve matching construction and maintenance work, wear only on that work, and use existing physical pickup, stairs, storage and same-identity repair. Stock targets distinguish family/material and committed repairs. Native paid manufacture→pickup→construction→wall repair→kit repair is covered; wider equipment families remain unfinished.

**Power-cell installation implemented locally after v0.1.12:** one stored cell becomes 100 kJ in one surface battery, including an upper floor, only after a hauler finishes the job. Cancellation and a bank that cannot accept the cell return it. Schema70 preserves schema69.

**Fuel synthesis implemented locally after v0.1.12:** recover solar cells, supply a paid workstation with cells and water, and manufacture fuel under the same skill, power, air, temperature and output-capacity rules as other staffed industry. Finite output can feed existing shuttle preparation and reactor buffers. This is an abstract shared fuel resource, not separate propellant/reactor chemistry.

Expand material properties, distinct manufactured items, recipes, equipment condition and repair from this shared foundation. Track the remaining industry families in the [conversion inventory](docs/conversion-inventory.md).

**Acceptance:** at least one complete extraction-to-tool production chain makes material choice and tool condition affect real work or failure. Items retain identity and properties through manufacture, transport, use, repair and saves. Required inputs and labor cannot be bypassed by an abstract global stock total.

### 9. Persistent history, factions and broader society

**First recruitment implemented locally after v0.1.12:** player-initiated contact, accept/decline, a timed independent ferry and a real ground-pad arrival. A blocked landing waits then diverts. Up to64 stable crew records retain existing people, relationships, claims and goods. Newcomers use ordinary meals, duties, paid industry, housing, social bonds and medical care; they bring no colony supplies. Strict schema72 migration preserves seven-founder saves without starting recruitment. This establishes arrival and integration; births, aging, generations, departures, factions and institutions remain unfinished. [Mechanics and bounded checks](docs/recruitment.md).

Build connected histories, populations, trade and faction relationships on persistent sites and physical logistics. Expand ecology, culture, institutions and threats in bounded slices from the conversion inventory; direct-character adventures remain later scope.

**Acceptance:** a small faction/trade encounter produces lasting consequences for supplies, relationships and recorded world history across travel and reload. Later systems must interact with that history and the colony economy. Background text alone does not satisfy these milestones.

## Standards across every milestone

- Keep the map prominent, controls compact and details hidden until needed. Extend original alien art and readable equipment states with the simulation.
- Preserve finite ownership and deterministic saves. Verify both failure and physical recovery through ordinary play, alongside focused tests.
- Use shared actions, stable entities and named state-change events. Recordings stay optional, bounded and local.
- Keep dependencies small and deliberate; retain offline local play and documented asset provenance.
- Update this roadmap and the evidence index when a playable acceptance passes. The conversion inventory remains the long-term coverage record.
