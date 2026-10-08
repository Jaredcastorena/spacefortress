# Changelog

SPACEFORTRESS is an early playable colony simulator. Release entries describe completed changes within their stated scope.

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
