# Changelog

SPACEFORTRESS is an early playable colony simulator. Release entries describe completed changes within their stated scope.

## Unreleased

- Spread mature fires through open or damaged stair hatches to nearby combustible fittings. Preserve oxygen/wetness checks, horizontal priority, one ignition per interval and next-tick burning. Intact closed hatches and solid ceilings contain flames.
- Label cross-floor ignitions with `cause: stair_spread`, the parent fire and connection ID. Explain hatch containment in the existing stair and fire inspectors; save schema63 and observation9 remain unchanged.

## v0.1.8 — 2026-10-29

- Add recoverable impact ore: three units per strike, a twelve-unit reserve cap, explicit loose overflow and loss in empty space. Preserve ice reserves and the structure beneath recovered debris.
- Unify finite reserve, terrain and salvage extraction; enable floor-targeted Mining and cancel stale orders before they can create material. Pause construction when incoming ore obstructs its target, preserving staged inputs.
- Add extraction observations, impact/depletion events, floor labels and reserve rendering. Empty planter observations now expose cultivation readiness. Schema63 preserves genuine in-flight62 state and rejects legacy claims for impact ore or upper mining.

- Add paid planter beds on habitat floors and enable upper planting, watering and gathering through shared physical work. Preserve food age, actual-floor reservations, cancellation custody and typed event identities.
- Let beds absorb finite floor water and return retained moisture when destroyed or dismantled. Sunberries respect overhead terrain/structures through the shared solar exposure model.
- Make plant controls and crop rendering follow the selected floor. Save schema62 preserves genuine schema61 gathering; older schemas reject newly supported planters and upper plant jobs.

## v0.1.7 — 2026-10-28

- Enable paid upper-floor airlock controllers and floor-aware configuration, requests, pause/resume, cancellation, release and unbinding. Preserve ground defaults and stable ground IDs.
- Carry crew, rescue parties, cargo, ownership and saved pressure cycles through upper-floor airlocks and declared stair approaches. Player inspection and structured events use the actual floor.
- Check exposed-walkway pressure before opening the outer door and reject stair or gas-riser bypasses around the controlled chamber.
- Enable manual and automatic upper-floor fire suppression with two delivered water, and automatic repair/service with one delivered alloy. Preserve stair routing, engineering duties, cancellation custody and exact-floor events.
- Identify the actual floor in fire inspection and damage/service messages.
- Save schema61 migrates validated hex schemas40–60. Genuine schema59 airlock and schema60 fire fixtures preserve physical state; older schemas cannot claim the new job types.

## v0.1.6 — 2026-10-28

- Block solar generation beneath upper terrain or intact structures. Identify the nearest blocking floor in player inspection and structured observations.
- Record solar availability changes without generating energy during inspection, validation or power refresh. Preserve damage and night restrictions, and retain isolated generation/curtailment accounting when a cable is disabled or broken.
- Migrate validated hex saves40–58 to schema59, checking historical power totals before applying the new sunlight rules. Preserve stored energy, resources and cumulative accounting.

- Allow animals and handler escorts to use stairs and upper-floor pastures. Preserve floor ownership through supplied care, collection, medicine, slaughter, carcass processing and disposal.
- Admit births on clear constructed floors and prevent stair dismantling from stranding upstairs animals.
- Add floor arguments and labels to animal assignment, escort and butchery controls. Save schema58 migrates genuine schema57 without changing existing physical state.

## v0.1.5 — 2026-10-27

- Connect adjacent floors with paid power, gas and water risers. Endpoint cables/pipes own the finite contents; independent isolation, shared damage, supplied repair and dismantling preserve them.
- Save schema57 migrates validated hex schemas40–56 and records utility endpoint ownership and maintenance jobs.

- Stair repairs now use one delivered alloy and eight work to restore the shared connection condition. Dismantling uses one alloy and twelve work to seal the opening, returns three alloy, and retains both floors. It reserves both landings and rechecks occupancy and a usable alternate route for upstairs crew before completion. Blocked work retains its materials; cancellation preserves custody. Damage at either landing affects the same connection, and exposed upper landings participate in debris forecasts. Both inspectors show the shared job; broken routes have a map warning. Schema56 validates connection-owned work and full-position source reservations; genuine55 saves migrate without changing physical state.

- A compact floor menu and Page Up / Page Down now select installed floors. Map picking, tile inspection, build orders and equipment controls retain the selected floor. Crew selection follows the crew member’s floor; stair landings have artwork and shared hatch controls. Floor changes invalidate held map clicks and stale inspector actions. Warnings and maintenance links navigate to the correct floor; resource and power totals are labeled as all-floor summaries. Viewing a floor does not change simulation state. Save schema55, observation9 and package0.1.4 remain unchanged; this is a local update.

- Paid stair jobs reserve and carry six alloy plus one component, then create an empty upper grid and its landing. Upper floor extension requires paid material, a reachable builder and support immediately below. Schema55 admits up to eight contiguous declared floors, validates link/landing ownership and named references, and migrates genuine schema54 without changing physical state. Remaining vertical systems are pending. Cancellation preserves existing material custody and creates no deck. The renderer filters tiles, actors, work, overlays and impacts to the selected floor. Package remains0.1.4; no hosted release is implied.

- job.order now accepts explicit deck targets for basic construction, repair, service and dismantling. Crew can walk horizontally on declared floors; reservations, assignment, delivery, completion, cancellation and boundary occupancy use full positions. Ground calls remain compatible. Other upper work types and upper airlock-controller construction reject explicitly; paid stairs and schema55 now enable connected floors and saves; floor selection is now available locally.

- Eleven colony controls now accept optional z, bringing the converted shared controls to27. Recipe selection, production pause/order/priority, depot policy, room purpose, housing and gates target their actual floor. Work cancellation, haul claims, occupants and home-comfort readings preserve that ownership; committed recipe materials stay physical. Save54/observation9 remain unchanged; upper staffed work remains gated.

- Sixteen gas, water, power, reactor and climate controls now accept optional z through the shared player/agent dispatcher. Underlying setters and events retain the selected deck; invalid floors reject before mutation. Existing ground calls and safety protections remain compatible. Save54 and observation9 are unchanged.

- Pasture topology, mating, birth occupancy, grazing, tibble feeding and trap capture/payment retain their actual deck. Observation/recording9 gives pasture regions z and full-position cells; upper plant and pasture IDs are distinct while ground IDs remain unchanged. Save54 is unchanged; upper movement remains gated.

- Save54 adds explicit room-purpose anchor decks; observation/recording8 includes these anchors and outpost dock z. Room summaries, waste exposure, comfort, shelter choices and outpost identities no longer alias overlapping floors. All217 affected checks pass, including five new migration/isolation cases. Shared commands and movement remain restricted to the landing deck.

- Save53 and observation/recording7 retain deck coordinates in debris forecasts and damage history. Fire spread, reactor cooling and debris impacts now resolve the actual deck. Damage history and debris forecasts retain z; unsupported upper-deck fire and service requests report a block instead of issuing work downstairs. Hex schemas40–52 migrate without resetting physical state; additional playable decks remain pending.

- Gas and water ports, passive flow, leaks and floor spills retain deck positions. Plumbing dismantling requires recovery on the same deck. Gas room IDs match observations, and parsing a nonzero tile ID cannot attach an unrelated ground airlock owner to a transfer. Ground saves and transfer rules remain unchanged; vertical fluid connections are still pending.

- Electrical networks and breaker ports retain their deck. Stacked loads cannot draw from another floor, wet faults isolate the correct branch, and initial cable commissioning routes each floor independently. Ground save IDs remain unchanged; nonzero tile/circuit diagnostic IDs are distinct. Paid stairs and cable risers now provide explicit connections between playable floors.

- Save52 adds explicit room decks. Gas, smoke and thermal remapping preserve the correct room when floors overlap; horizontal flow, breathing and equipment heating use actual deck coordinates. Observation/recording6 exposes room ownership. This does not yet enable additional playable floors or vertical fluid/utility connections.

- Save51 preserves full airlock positions for equipment, chamber cells, owned nodes and traveler destinations. Old saves retain in-progress cycles, gas, power, doors and queues. Observation/recording5 exposes the changed shapes. Player setup controls remain unchanged; connected decks still require environment and command work.

- Made inventory availability, pickup/delivery claims and depot capacity distinguish deck positions. Food projection reads the destination galley on the correct deck; construction, machine and plumbing queries retain tile coordinates. Legacy pairs and material-source records without z mean ground, never the viewed or carrier deck. Five new accounting cases and94 existing cases pass after repairing one fixture syntax error. Saved shipment shapes, movement and telemetry IDs are unchanged.

- Converted automatic and manual airlock route plans and crew traversal queries to explicit positions. Walking/crossing segments retain deck coordinates; existing saved controller destinations remain ground pairs at a named boundary. Five pre-change route examples keep identical paths/costs, and all 96 affected checks pass once. Controller persistence and inventory destination conversion remain pending.

- Added explicit horizontal pathfinding for declared decks, with position-based crew and species-specific animal access. Existing pair-based paths and airlock plans remain tied to deck zero; they refuse unsupported actor levels. Shared movement guards reject invalid, foreign or unsupported deck destinations before changing state. All 163 affected checks pass; an eight-tick fresh-colony comparison is byte-identical. Cross-deck traversal and the remaining location callers are still pending.

- Added explicit deck-zero state and save schema47 migration from hex schemas40–46. Tiles, crew, jobs and creatures retain their locations, including livestock births and animal-leading jobs. Migration preserves the full prior physical state and rejects unsupported deck coordinates or links. Shared spatial addressing supports future levels; nested references, movement, physics, observations and stairs still need conversion before a second deck can be played. Migration checks include a genuine synthetic schema46 fixture captured before the change.

- Added a reusable offline habitat-waste containment helper through normal freight controls. Seven synthetic checks cover finite pickup, first-stop limits, conflicting work, bounded sanitation injury and save/recording parity. Containment leaves pending freight and medical recovery explicit; the browser runtime and save format are unchanged.

- Ordinary hauling now records `inventory.transferred` with the carrier, exact source/destination slots and quantities actually moved. Partial deliveries and setdowns preserve item identities; sanitary output is labeled correctly. Five new transfer cases and 48 existing industry, recording and possession cases pass across the focused gate and affected fixture repairs. Simulation rules, saves and dependencies are unchanged.

- Added an offline paid night/day recovery helper with six focused checks. It finishes native delivery, preserves finite night standby and supports exact daytime continuation while crew recover naturally. The paid colony delivered ten air, retained its first off-duty fatigue stop, then recovered from tick 1565 to 1620 in 55 ticks and nine commands. Seven crew are healthy/home, battery charge is 120, the empty chamber is thermally safe and farm/scrubber/balanced routines are restored. Independent physical balances and recording reconstruction pass. Ongoing night conditioning and ordinary cargo endurance remain pending.

- Added an offline one-batch air-production callable/CLI using shared production, hauling and crew controls. Six focused mechanics cases cover finite water payment, physical delivery, owned vacuum chambers, exhausted orders, first stops and recording exports. An actual 30-tick continuation produced ten air but reached its cap before delivery: six carried, four at the processor, seven healthy/home and battery 14. Paid work and temporary routines remain preserved for power-aware continuation; night endurance is pending. Browser runtime, saves and dependencies are unchanged.

- Added a fixed-resource repeated supply-tank cargo check. Native hauling carries four air units through the airlock to its exterior tank, followed by two complete alloy roundtrips through shared commands. The seven crew return healthy with original settings restored at tick 220; recorded gas species, material custody and energy reconcile. Full-night operation and ordinary paid installation remain unverified.

- Bound airlocks now accept a gas supply tank in the reservoir role. Normal hauling delivers finite breathing mix; loading preserves enough free space to recover chamber gas, including smoke. Idle queues and requests paused for empty supply can replenish, while active cycles, disabled controllers and invalid ownership cannot. Shared safety gates control admission. Focused loading/admission checks and distinct integration checks pass; sustained operation remains unverified.

- Airlocks now reseal and rematch pressure when normal suit refilling changes chamber pressure during release. Correction requires the entire party inside and both doorways clear; existing finite gas, power and passage checks remain. Added full-tick drift and obstruction regressions plus two synthetic cargo roundtrips through shared commands. The seven crew return healthy with the same alloy parcel and restored settings; ordinary colony passage and sustained operation remain unverified.

- Fixed airlock refill prediction rejecting finite usable gas by checking only the lower edge of the pressure tolerance. Prediction now uses the same rounded habitat target as the vent, capped by actual available gas. Minimum-supply, recovery-space and live safety checks remain. Forty-nine relevant airlock checks pass; the stopped colony save reloads exactly without advancing time.

- Ordinary airlock verification now includes sixteen paid replacement-air batches and a healthy crew return. A later debris strike damaged the chamber wall before gas recovery began; the preserved failure retains safe habitat air and uninjured crew. A later paid wall repair completed, but its return trial exhausted packaged air with one engineer still in the chamber. Commissioning and parcel travel remain pending.

- Added an offline Node construction example with a callable interface, compact CLI output and optional canonical save export. It pays for 22 placements through shared mining, hauling, production and construction commands. One recorded integration run reached construction at tick 407 with all seven crew uninjured; the construction and CLI argument cases passed 2/2. Commissioning and travel remain unfinished.

- Added finite manual suit oxygen release into the actor's current sealed room. The collapsed crew control and `crew.suit.release` agent action share strict integer/reserve/capacity validation. Gas moves from suit to room, updates the existing ingress ledger and emits typed `crew.suit.released` ownership records. Detached `derived.suitRelease` reports current limits. Twenty-two core and seven UI checks pass; combined integration and the zero-tick browser check are detailed in verification status. Saves and dependencies remain unchanged.

- Workstation diagnostics now separate qualified crew from personally available crew using the existing shared work-readiness rules. Structured observations include `crewReadiness` and `availableCrewIds`; `operators_unavailable` explains fatigue, low suit air and other personal limits when no operator can start. An already assigned operator remains correctly reported while able to continue. Assignment rules, costs and saves are unchanged. Forty-one focused and 24 existing food/recording checks passed.

- Crew with no reachable breathable room can walk to local stored breathing mix and refill their suits at up to two points per tick, capped at 90%. Transfers consume finite depot or operational-dock supply, conserve oxygen/inert accounting and emit typed `crew.suit.refilled` records. Reachable safe rooms keep priority. Boarding uses the same conversion with unchanged full-suit costs. Sixteen supply checks pass; integration and the corrected blocked-shelter fixture are detailed in the verification status. No save or dependency change.

- Crew work assignment and structured observations now share pure personal-readiness diagnostics. `derived.work` reports availability, all matching stable blocker codes and the temperament-dependent suit-air limit. Existing thresholds, saves and gameplay remain unchanged. Focused readiness/telemetry checks and one full 117-file Node gate passed; the actual tick-2167 save reopened exactly without stepping.
- Ordinary livestock collection and hauling now have a reviewed finite colony trace: ten handler work and twenty animal nutrition produced two curd portions, which reached storage after 45 ticks. The original collection policy was restored; everyone stayed healthy. Ongoing food supply, meal eating and full air/suit recovery remain unfinished.
- Ordinary colony verification now includes paid trap construction, physical wild-food deliveries and eight pest captures. The finite attempt exhausted its food and stopped at its tick limit; ongoing food supply and full air/suit recovery remain unfinished.
- Destroyed biofilter traps no longer consume bait or capture pests. Repaired traps resume their existing ten-second cycle; successful `pest.captured` events report the actual 0.25 food spent.

- Opened meals derive their age from the food still present. Eating an old portion no longer causes fresh remaining portions to spoil early. Interrupted meals and saves with an older cached age retain the physical food and prepared-meal identity.
- Production stock targets include goods physically unloaded at a dock, including crop kinds and matching prepared recipes. Machines stop requesting input when delivered stock meets the target and resume after it is used.
- Save schema 46 and dependencies are unchanged. The earlier trap-correction JavaScript gate passed all 116 test files; six focused trap checks passed. The actual tick-1942 colony save reopens exactly. See [verification status](docs/verification-status.md) for scope, historical tooling checks and unfinished ordinary journeys.

## v0.1.4 — 2026-10-09

Air diagnostics and paused-import patch release; save schema 46 and gas behavior are unchanged. See [release readiness](docs/release-readiness.md) for local evidence and the [v0.1.4 release record](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.4) for the final source commit, CI/Pages and hosted verification.

- Breathing diagnostics share the same first-failure reason as the actual safety check: exterior, smoke, low/high pressure, low/high pressure-adjusted oxygen, or excess exhaled gas. Existing gas arithmetic, safety thresholds, saves and breathing behavior are unchanged.
- The hidden atmosphere inspector and local-agent observations gain pressure-adjusted oxygen with its 16–30% nominal range and an actionable failed-limit explanation. Normal oxygen concentration alone cannot establish safe breathing: the recorded tick-144 room had 20.736% oxygen concentration but only 15.8476% of nominal oxygen pressure.
- Documentation distinguishes stored/carried breathing mix from delivered life-support input and room gas, and corrects the airlock scope: experimental cycling is already in v0.1.3; ordinary paid construction, commissioning and a parcel roundtrip remain unverified.
- Save import now restores the actual speed selected before opening the importer, including pause, on completion, failure or cancellation; no save-schema change is required.
- The shared diagnostic core passed 25 focused checks. One full local Node run passed 1,282 checks with zero failures and one intentional skip. A later presentation-only change made the breathing warning span the inspector width; all seven affected panel checks passed. Browser review confirmed the paused tick-144 import and readable low-oxygen explanation.
- A separate finite recovery stopped at its tick-384 budget after a paid processor produced ten air; no breathable tick had occurred. The reviewed continuation ran 384→460 in 76 ticks/three commands, producing 40 air from four water and reaching 12 consecutive breathable ticks. Everyone stayed healthy, three reloads were exact and the processor paused with its next committed batch intact.
- The endpoint has exactly the required 56 oxygen units and suit reserves of 76.79–78.49%. Earlier tick-144 and tick-384 stops remain preserved. Durable air reserves, sustained exterior work, paid airlock commissioning and the full ordinary livestock/kitchen journey remain unverified.

## v0.1.3 — 2026-10-08

Collects seventeen accumulated development commits and the new butchery increment. See [release readiness](docs/release-readiness.md) for local acceptance and the [v0.1.3 release record](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.3) for exact hosted verification. Older test counts below retain the scope of their historical increments.

- Local gate: 1,264 distinct passes and one intentional historical skip. The first full run had 1,263 passes and one stale recipe-option fixture failure; its exact corrected check passed, with no full rerun. Focused food/body/interface/integration coverage is 8/49/9/77. Actual schema-45 migration preserved prior state, with six exact current reloads.
- One ordinary continuation stopped at tick 144 after 78 ticks and three commands because home air became unbreathable. Two paid posts finished at tick 85; two care deliveries raised target trust to 80. All seven crew and five animals stayed healthy. No slaughter, body, meat or new meal occurred; the complete ordinary chain remains unverified.
- Scoped local browser review passed fresh save/reopen, importing the actual migrated save, ten recipe options, applying and preserving Bristlecap braise selection, and a readable 390-pixel layout with no observed warnings or errors. It did not establish corpse handling or cooked-meat browser coverage.

- Livestock deaths retain identity and ancestry while creating one physical body. Handlers collect, carry and process it at a husbandry post; cancellation and interruption preserve its actual location and age. Rotten bodies require disposal and provide no edible meat.
- Manual slaughter requires a tame adult at its intact assigned post, breeding disabled and no carried brood or conflicting work. It takes eight Husbandry work and can be cancelled before completion. Butchery takes 20 Husbandry work; adult bristlebacks yield four meat, adult glazefoots three, and naturally dead juveniles one. Each processed or discarded body adds 0.25 located waste; skill and traits do not multiply yield.
- Two meals expand the galley to ten recipes: Bristlecap braise uses one bristleback meat and one fungal cap; Sunberry glaze roast uses one glazefoot meat and one sunberry. Both preserve two raw units as two prepared units, with existing skill, quality, age and physical hauling rules.
- Schema 46 adds strict death/body ownership and explicit migration from hex schemas 40–45. Previously dead animals become exhausted legacy records with no new body or food; living animals retain their state. Square schemas 1–39 remain incompatible, with original bytes protected for export. See [butchery](docs/butchery.md).

- Bristlebacks and glazefoots inherit temperature tolerance and production/feed pace. Both temperature limits shift together; faster product progress increases nutrition drain. Conception freezes parent snapshots and the child genome, and birth preserves them. Folded inspectors show parents, rates and pending brood traits.
- Schema 45 migrates hex saves 40–44 with neutral present effects for existing livestock, preserving physical quantities and lifecycle progress. Founder variation and inheritance use stable hashes without consuming global randomness. Named birth/inheritance events support local recordings.
- Trait verification: first full run 1,210 passes, zero failures and one intentional skip. One supplied-parent/pasture trial produced a healthy hatchling at tick 301/three commands, with six exact reloads and unchanged physical inventory. Independent review and desktop/narrow folded-inspector checks passed. Ordinary herd construction and long-term balance remain unverified.
- Ground-bed cultivation uses a matching raw portion and delivered water to grow finite harvests. The preceding fresh-colony fungal-cap cycle completed at tick 853/six commands with no grants, everyone healthy, 42 Production experience and 24 exact reloads.

- Livestock now have species temperature tolerances and persistent injuries from fire or severe heat/cold strain. Injuries pause production, collection, growth and brood development; ordinary hunger remains a separate food-responsive weakness.
- Manual veterinary treatment uses one physically delivered medicine and 20 Medicine work, covering up to 20 injury. Recovery restores health gradually at an intact post with suitable temperature and nutrition. Feeding can proceed while paid treatment waits; interruption, reassignment, transport and death retain normal supply refunds.
- Schema 43 adds neutral animal condition records to schema-40/41/42 hex saves, preserving prior health and physical state without granting medicine or inventing wounds. Health transitions, treatment and recovery emit named events.
- Veterinary verification: 1,150 Node passes, zero failures, one intentional skip. A supplied injured-adult/post trial passed at tick 116 with real delivery/work, one medicine consumed, ten injury recovered and five exact reloads. Browser controls, save/reopen, narrow layout and a final display-only job-label correction passed review.

- Prior flora verification: 1,120 Node checks passed, zero failed and one intentional skip. A fresh-colony gathering→hauling→stew trial passed after actual galley construction; all seven crew and five animals remained healthy, with four exact reloads. Plant controls and narrow layout passed browser review.

- Native fungal caps and sunberries grow through visible stages, with species temperature and daylight limits. Crew gather mature plants through finite Production jobs; typed food drops on the ground and uses existing physical hauling and cooking.
- Lichen shares the plant biomass system; grazing nutrition scales with the actual bite. Fire and ground-covering construction remove affected plants. Plant stages, removals and harvests emit structured events.
- Save schema 42 migrates schema-40/41 hex colonies without adding edible plants or changing existing lichen quantities. Native growth currently uses abstract environmental resources; soil moisture, spreading and orchards remain future work.

- The initial food expansion added three selectable hydroponic crops and eight galley recipes using physically delivered ingredients and Production skill requirements, with four meal-quality tiers and recipe-specific comfort.
- Original glazefoot livestock eat delivered fungal caps and yield glaze eggs. Bristleback harvests retain their nutrient-curd identity; both species use existing care, pasture, breeding and transport systems.
- Ingredient kinds, oldest input age, recipe and maker survive reservations, hauling, cooking, storage and save/reload. Changing recipes preserves paid batches. Pausing a machine retains pending physical deliveries.
- The earlier schema-41 food migration preserves schema-40 hex colonies while preserving legacy food, animals and committed batches. New colonies receive two wild glazefoots; old colonies receive no free animals.
- Production hauling ignores negligible floating-point input shortages, preventing microscopic air refills from displacing useful cargo. Stored supplies and real shortage priorities are preserved.
- Experimental pressure-cycling airlocks recover and refill actual gas through controlled equipment, with two-door interlocks, power and atmosphere guards, queued travelers and safe manual release.
- Crew preserve work, parcels, meals and carried patients while waiting. Manual release permits chamber maintenance through the selected side.
- Crew share finite room oxygen for breathing before optional suit charging. Actual suit reserves cover shortages; injury follows unmet demand. Home warnings identify dependence on suit air, and structured `crew.air.allocated` events record the transfers for players and local agents.
- True hex terrain and construction retain the isometric view. Movement, work range, room seals, livestock boundaries, gas, water, heat and electricity use six neighbors; device orientations, overlays and pointer picking share the same geometry.
- Save schema 40 identifies the hex grid. Square schemas 1–39 are rejected before topology changes, with original save bytes protected for export. Existing action IDs, named events and entity IDs are retained. The separate elements laboratory remains square.
- Historical hex regression coverage: 1,057 Node checks passed, zero failed, one intentional skip. The prior 26 Python passes remain applicable to unchanged tooling. Local Chrome verification covers rendering, picking, a build preview, gas overlays and narrow-screen inspector focus. A held-pointer form submission across a real refresh dispatched exactly once. Paid airlock construction/parcel acceptance remains incomplete.
- Ordinary hex-colony acceptance now includes paid air production, supplied exterior construction, waste containment and complete medical and finite-supply recovery. All seven founders recovered, and construction materials were replenished through real mining and manufacturing. A paid scrubber repair and battery-charging schedule completed stalled air production without resetting its existing materials or progress. One supplied exterior trip restored two damaged solar arrays while preserving the enclosure materials. Enclosure, commissioning and parcel acceptance remain unfinished; detailed evidence and night-power limits are in the verification record.

## v0.1.2 — 2026-09-30

### Freight and wreck settlement preview

Save schema38 adds the experimental outpost controls below. The user requested publication of this tested development build; full fresh-colony outpost endurance, delayed resupply, ordinary remote care and final pickup remain unfinished.

- Physical freight manifests share the shuttle hold with salvage. Workers reserve, carry, stage and unload existing goods; flight service supplies stay separate.
- Wreck construction uses local delivered materials. Habitat checks measure actual room air, heat, powered utilities, routes, bunks and finite reserves.
- Shared residence and return-passenger controls keep location, settlement and flight membership distinct. Work, meals, rest, care and hazards use each crew member's actual site.
- An explicit one-pilot trip to an established wreck leaves a seat for collecting its last resident. First visits and default selection still use two crew.
- Paid departure loading refreshes its air target in useful batches. A blocked recovering courier puts the actual parcel down at its location, preserving reservations and item metadata.
- New actions and short-lived transfers have named records for local player/agent use. Schema 37 migration adds no resources or changes to crew or RNG state.

Current source verification:959 Node checks,958 pass, zero failures and one intentional historical skip; Python15/15 and JavaScript163/163. Real freight and bounded named-resident controls pass default/narrow browser checks. A complete current-source ordinary outpost journey is not yet accepted. Night power and gas reserves are real limits; automatic pressure-cycling airlocks remain proposed.

## v0.1.1 — 2026-09-29

### Outpost foundations

- Save schema 37 separates wreck residence, expedition arrival history, selected return passengers, shuttle freight and imports stored at each dock.
- Physical inventory accounting preserves food age, prepared-meal metadata and item identities across the new owners. Construction and reservation primitives now identify the supplying site.
- Shuttle drawing follows its actual location: an empty berth remains empty while the craft is elsewhere or in transit.
- Pure observations expose residence, return rosters, inventories and shuttle presence through the shared simulation interface.

These are foundations for later outpost gameplay. This release does **not** add player settlement or freight controls, remote Build access, resident care or a playable resupply loop. Connected local levels and generated worlds also remain unfinished.

### Fixes

- Prevent food aging from crashing when a destination dock is missing.
- Reject shared ownership between freight/import storage and opened meals, including shared food metadata.
- Check old saves for invalid outpost data before earlier migrations can silently discard it.
- Prevent boarding return travelers from claiming work left for residents.
- Export the active colony after Import/New even when browser storage rejects the replacement save; keep unreadable original bytes protected while the original fallback is active.

### Saves and running the game

- Play the [game](https://jaredcastorena.github.io/spacefortress/) or [elements lab](https://jaredcastorena.github.io/spacefortress/elements.html) directly through GitHub Pages. Publication follows successful tests and serves only the explicit public game assets, license and version manifest.
- Original schema 36 saves migrate to schema 37. New residence and inventory owners start empty; the existing expedition crew is copied into an independent return roster. Existing resources, cargo, crew state and RNG are preserved.
- Current saves with missing fields, invalid resources, duplicate or unknown residents, or impossible return rosters are rejected rather than silently repaired.
- Export a JSON backup before upgrading. Hosted play and a local server use different browser origins and therefore separate saves; changing the local host or port also changes the origin. Use the game's JSON export/import to move a colony between them. There is no cloud-save synchronization.
- No runtime dependencies were added. The local preview uses Python's standard library; the game uses local JavaScript, Canvas and CSS. See the [README](README.md) for play and setup instructions.

## v0.1.0 — 2026-09-23

- First public MIT-licensed source release, with local browser play and a separate elements laboratory.
- Included colony construction, crew needs, production, environmental utilities, explicit two-person expeditions, physical salvage return and supplied shuttle upgrades.
- Added local JSON save import/export, optional local simulation recordings, contribution guidance and automated tests.

The initial release used save schema 36. Staffed outposts, connected local levels and generated worlds were not playable features.
