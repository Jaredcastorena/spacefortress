# SPACEFORTRESS roadmap

**Release build: v0.1.4 · Save schema: 46.** SPACEFORTRESS is an early playable colony simulator growing from a planetary foothold into orbit and farther space. This roadmap orders the next playable increments; it promises no dates.

See the [README](README.md) to play, [verification status](docs/verification-status.md) for evidence and limits, and the [180-system conversion inventory](docs/conversion-inventory.md) for the wider backlog. Completing a milestone below does not complete an entire inventory family or establish full Dwarf Fortress parity.

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

Build a measured reserve beyond the minimum reached at tick 460, then verify suit recovery and finite exterior-work demand without losing safe habitat air. Sustained supply, paid airlock commissioning and a parcel roundtrip remain unverified. Continue only from reviewed physical state to prove ordinary taming, slaughter, body carrying, butchery, ingredient delivery, cooking and eating while keeping the colony safe. This precedes wider ecosystem expansion. The earlier supplied food and breeding trials and the new bounded air recovery do not replace that acceptance.

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

Experimental automatic cycling is implemented locally and has scoped physical and control coverage: admit a crew member, close the entry door, recover air into finite storage before exterior release, and refill before opening toward the habitat. It uses gas extractors, pumps, reservoirs, vents and actual electrical power. The [cycling-airlock design](docs/airlock-cycling-design.md) defines the broader acceptance checks; ordinary paid assembly and parcel traversal remain pending. The previous v0.1.2 build had manual doors and vestibules.

**Acceptance:** an ordinary supplied colony builds the assembly and physically carries goods out and back. Doors interlock; gas species, smoke and energy retain actual owners across repeated cycles. A normal cycle wait preserves the crew’s task and parcel. Full storage, empty reserves, power loss, damage and a carried patient produce measured safe pauses or explicit manual recovery. Save during partial transfer and traversal, replay named transitions, and verify compact player controls.

### 6. Connected local vertical decks

Implement the [local-level design](docs/vertical-slice-design.md): two decks in one settlement, constructed connections, level selection and complete spatial references. Local height and orbital travel remain separate systems.

**Acceptance:** crew carry materials between decks, commission a second compartment and respond to a blocked connection or utility failure. Pathfinding, jobs, atmosphere, liquids, power, care and recordings respect their appropriate vertical connections. Migration preserves the existing floor without granting gas, heat or stock; both decks continue simulating when one is hidden.

### 7. Seeded planets and a wider universe

Expand the [upward/outward progression](docs/orbital-progression.md) into generated destinations, persistent planetary identities, multiple settlements per planet, resource bodies and varied debris/solar hazards.

**Acceptance:** the same seed reproduces the same region and its finite opportunities. Survey information supports a meaningful destination choice. Travel consumes real supplies; revisiting preserves depletion, construction and occupants. Creating another settlement does not regenerate existing stores or reset its history.

### 8. Materials, tools and deeper production

Introduce reusable material properties, distinct manufactured items and tools, then expand recipes, equipment condition and repair around them. Track the remaining industry families in the [conversion inventory](docs/conversion-inventory.md).

**Acceptance:** at least one complete extraction-to-tool production chain makes material choice and tool condition affect real work or failure. Items retain identity and properties through manufacture, transport, use, repair and saves. Required inputs and labor cannot be bypassed by an abstract global stock total.

### 9. Persistent history, factions and broader society

Build connected histories, populations, trade and faction relationships on persistent sites and physical logistics. Expand ecology, culture, institutions and threats in bounded slices from the conversion inventory; direct-character adventures remain later scope.

**Acceptance:** a small faction/trade encounter produces lasting consequences for supplies, relationships and recorded world history across travel and reload. Later systems must interact with that history and the colony economy. Background text alone does not satisfy these milestones.

## Standards across every milestone

- Keep the map prominent, controls compact and details hidden until needed. Extend original alien art and readable equipment states with the simulation.
- Preserve finite ownership and deterministic saves. Verify both failure and physical recovery through ordinary play, alongside focused tests.
- Use shared actions, stable entities and named state-change events. Recordings stay optional, bounded and local.
- Keep dependencies small and deliberate; retain offline local play and documented asset provenance.
- Update this roadmap and the evidence index when a playable acceptance passes. The conversion inventory remains the long-term coverage record.
