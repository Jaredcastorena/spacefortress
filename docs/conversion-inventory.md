# SPACEFORTRESS conversion inventory

Design draft and local implementation audit — September 16, 2026.

Current user direction: **isometric sprites and upward/outward progression** from a planet into orbit and farther space. See [orbital progression](orbital-progression.md). Geology and excavation remain in this inventory as possible local systems; underground depth is no longer the main progression requirement. Milestones and exact equivalents below are proposals.

## Scope and how to use this list

This is a system-level conversion backlog, including Fortress, Adventure, and Legends mode families. It is not yet an exhaustive catalog of every Dwarf Fortress creature, material, recipe, interaction, or version-specific rule. Those need a separate definition-level audit against a chosen reference release. An early playable draft now covers parts of several rows; see [implementation status](implementation-status.md) for evidence and limits. No broad row should be called complete solely because a simplified version exists. Space equivalents are original design proposals, not claims about Dwarf Fortress features.

The reference game continues to change. The [official features overview](https://bay12games.com/dwarves/features.html) describes its broad simulation scope; the [developer log](https://bay12games.com/dwarves/) records released changes; the [roadmap](https://bay12games.com/dwarves/dev.html) also includes unfinished plans and must not be treated as a list of shipped features.

Each row has a stable ID and a proposed milestone:

- **A — First colony and orbital access:** land, haul, build, eat, breathe, sleep, visit one wreck, save and reload.
- **B — Working settlement:** production chains, local excavation, richer crew behavior, trade, medicine, security, and orbital harvesting.
- **C — Living universe:** politics, history, ecosystems, complex threats, distant operations.
- **D — Extended modes:** direct character adventures and deeper cross-mode continuity.

These milestones specify order, not a promise that all the work is small. A row can require many tasks. When implementing one, record simulation rules, player controls, art, dependencies, failure cases, and a playable acceptance scenario.

## Current coverage checkpoint

The inventory contains **180 unique system IDs**. The table below maps those families to inspected local code and topic documents; it does not count partial systems as completed conversions. **Partial** means an implemented subset exists, **missing** means the listed capability still needs implementation, and **proposed** means a design choice has not become a requirement or working system. The schema 36 expedition journey and later v0.1.0 release remain historical accepted baselines. Schema 37 ownership foundations are now implemented and verified within the scope in [verification status](verification-status.md): wreck residence/return rosters, durable freight/dock imports, pure observations and site-local reservation primitives. This does not implement staffed-outpost gameplay or complete any inventory family. Older test counts and save versions inside topic documents describe their historical increments.

| Inventory family | Implemented subset | Missing scope and evidence boundary |
| --- | --- | --- |
| U01–U10 · universe/history | Partial: seeded surface terrain and persistent local sites | The destinations and their identities are fixed; no generated planets, shared planet IDs, civilizations, history, off-site populations or cross-campaign world persistence. See [world construction](../src/simulation.js), [site definitions](../src/data.js) and [orbital design](orbital-progression.md). |
| E01–E08 · embark | Partial: seven founder profiles, fixed starting cargo, shelter and shuttle | No player site survey/selection, crew/cargo budget, sponsor choice, presets or reclaim mode. A seeded starting map is not an embark generator. See [game creation](../src/simulation.js). |
| T01–T14 · environment | Partial: rock/ore, finite ice, lichen, compartment heat/fire/smoke, horizontal floor water and finite closed plumbing | No real local z levels, strata, structural collapse, fluid phase changes, aquatic ecosystems or generated regional climate. [Water](water-supply.md), [floor liquids](floor-water.md), [thermal rules](temperature-and-climate.md) and [fire](fire-and-smoke.md) define the working subsets. |
| B01–B12 · building | Partial: excavation/salvage, supplied construction, hulls, doors, furniture, room purposes, maintenance and removal | No stairs, vertical hatches, structural support, building-material choice/quality or general mechanisms. See [construction](construction-logistics.md), [rooms](room-designations.md) and [navigation](../src/navigation.js). |
| L01–L12 · logistics | Partial: duties, priorities, interrupted jobs, located reservations, physical hauling, finite depots, filters, production orders and spoilage | No carts/rails, general containers, shared construction teams, dedicated hauling routes, quotas or operating-area permissions. Resource-type filters do not cover material/condition/hazard filtering. See [logistics](production-and-logistics.md), [storage](depot-storage.md) and [orders](production-orders.md). |
| C01–C14 · crew life | Partial: skills, food/rest/suit recovery, preferences, needs, stress, conversation/bonds, grief, bunk ownership and crafted possessions | No crew birth/aging, immigration, family formation, broad culture, clothing industry, destructive crises, invention episodes, funerals or body recovery. The save validator still requires exactly seven crew. See [crew life](crew-life.md), [housing](housing.md), [possessions](possessions.md) and [save validation](../src/simulation.js). |
| F01–F12 · food/animals | Partial: supplied hydroponics, nutrient recycling, cooked meals, grazers, physical pastures, feeding/taming, curd, breeding and tibbles | No seed genetics/seasons, diverse crops, drink production, hunting/fishing, butchery, pollinators or wider food webs. See [meals](prepared-meals.md), [recycling](nutrient-recycling.md), [husbandry](husbandry.md), [pastures](pastures.md) and [breeding](breeding.md). |
| I01–I15 · industry/materials | Partial: ore/alloy/components, water/air/food/medicine chains and individually crafted keepsakes | Most material and craft families remain missing. Generic resources and a few quality-bearing products are not a shared material-properties model. See [recipes](../src/data.js), [production](production-orders.md) and [possessions](possessions.md). |
| H01–H07 · medicine | Partial: persistent aggregate injury, supplied skilled treatment, reduced mobility, patient carrying, cot recovery, nursing and assisted hygiene | No body plans, distinct wounds/bleeding, surgery, pathogens, prosthetics or remote field care. See [medicine](medicine.md), [rescue](rescue-and-nursing.md) and [hygiene](bedside-hygiene.md). |
| P01–P13 · institutions/economy | Partial social furnishing through common tables; production orders exist | Trade, prices, merchants, offices, government, justice, diplomacy, organized belief/culture and scholarship are missing. A common room is not yet an institution; a work-order setting is not a staffed administrative role. See [crew life](crew-life.md) and [status](implementation-status.md). |
| M01–M14 · combat/threats | Partial: one pest trap and environmental expedition injury | No squad/equipment/combat model, hostile strategic actors, security jobs, siege/boarding AI or conquest. Peaceful salvage expeditions do not satisfy military expeditions. See [definitions](../src/data.js), [expeditions](expedition-logistics.md) and [life/anomalies](frontier-life-and-folklore.md). |
| A01–A08 · adventure/history | Missing: direct-character mode, conversations/quests, tactical actions and a persistent history browser | The colony event log and optional training recorder are not Legends or cross-mode continuity. See [interface scope](simulation-interface.md). |
| Q01–Q13 · presentation/persistence | Partial: original isometric art, hidden drawers, inspection, pause/speed, versioned saves, stable actions/observations and optional local recording | Local level navigation, configurable generation, guided onboarding, full accessibility/rebinding, audio and sustained performance evidence remain incomplete. Historical controls still have scoped UI coverage gaps. See [status](implementation-status.md), [graphics](graphics-and-tools.md) and [interface](simulation-interface.md). |
| S01–S14 · space systems | Partial: conserved gas/smoke, finite supply and retained-exhaust networks, manually controlled doors, suit air, wired power/storage and physical branch protection, reactors, room heat and fixed-route travel | Controller airlocks, thermal gas coupling, fluid heat/contamination, detailed radiation/shielding, gravity, automation, research and ship dynamics remain missing. Retained exhaust and [closed plumbing](plumbing.md) are verified in their documented scopes. See [station sequence](station-systems-reference.md), [gas](gas-networks.md), [power](power-networks.md) and [reactors](reactors.md). |
| O01–O14 · outward progression | Partial: fixed wreck/comet/solar maps, explicit ordered crew selection, supplied departure, cargo hauling/limits, timed comet visits, fitting choices and transported solar cells; schema 37 persisted outpost owners/rosters and verified local reservation foundations | No staffed orbital settlement, generated routes/discoveries, survey uncertainty, cross-site rescue or detailed collector heat/radiation model. The collector currently produces cells during eligible mission ticks; this is not the complete proposed solar industry. See [departure](departure-preparation.md), [expeditions](expedition-logistics.md) and [mission logic](../src/simulation.js). |

### Next systemic slices — proposed priority

The initial station utilities and first complete orbital journey are verified within their documented scopes; later utility depth remains in [its own sequence](station-systems-reference.md). The following slices keep that foundation connected to the user's broader colony-depth and upward/outward goals; they are proposals, not permission to label existing placeholders complete.

| Order | Concrete slice | Dependency and playable acceptance |
| --- | --- | --- |
| 1 | **Choose an expedition crew and prove one complete colony-to-orbit loop** · E03, L02, S09, O03–O04, Q04–Q07 | Implemented and verified as a scoped increment: explicit ordered crew, unchanged save36, physical loading/boarding, skilled wreck salvage, carried return cargo and a paid shield upgrade requiring recovered components. The ordinary-controls test and browser journey both recover a blocked exit and paused scrubber, reload preparation/return, and keep all seven crew alive. See [journey rules](orbital-colony-loop.md) and [evidence](verification-status.md). The broad inventory rows remain partial. |
| 2 | **Establish one staffed orbital outpost** · B08, L03–L07, S01–S06, O04/O10/O13 | Phase 1 ownership/persistence/status/reservation primitives are implemented and verified; the staffed-outpost gameplay remains proposed. Next remove remaining surface-only scheduling/care assumptions and add physical freight/settlement controls, retaining explicit site ownership. Deliver materials to the existing wreck, build a sealed compartment and depot, assign residents, and resupply it by shuttle. Crew and stores continue to change while the player views the surface. A delayed shipment must consume real reserves and permit a physical return or rescue; changing views must never refill them. This makes existing colony systems useful beyond short salvage visits. |
| 3 | **Build and use a second local floor** · T01, B02/B05, L03, Q02 | Introduce site/x/y/z positions, save migration and vertical route links before adding height-dependent content. Build a ladder or stair and hatch; haul a reserved stack upstairs, close the hatch, interrupt work, then reload without duplicating or stranding it. Vertical room boundaries, gas/liquid transfer and utility connections need explicit rules and evidence before claiming full multi-floor simulation. Region changes remain separate from local height. |
| 4 | **Generate one planetary region with two distinct destinations** · U01–U03, E01, S10, O01/O02/O11 | Replace fixed-site lookups/validation with stable generated site and route IDs, supported by the site ownership work above. Two settlements can share a planet ID. A seed reproduces survey results, routes and finite deposits; a different seed changes them. Save discoveries, visits and depleted resources. This first generated region precedes civilization/history simulation; neither is completed by adding a random planet name. |
| 5 | **Make one tool and material choice affect physical work** · B09, L04, I03/I04/I14, C02 | Extend existing item identity and recipes with material properties and a manufactured tool. Haul it to a worker, use it for extraction or repair, retain wear/ownership through interruptions and loss, and require a supplied replacement. The acceptance must show a changed work outcome and a production bottleneck; adding recipe names alone does not deepen industry. |
| 6 | **Accept one newcomer and integrate them into colony life** · C07–C09/C11, E03, P11 | Remove the exactly-seven-crew assumption; preserve existing stable IDs, relationships and claims. Accept or decline one arriving worker, physically disembark, assign duties and a bunk, supply meals/care and form a relationship. A full or failing colony must expose unmet needs. This establishes a population lifecycle before births, generations, institutions and culture; those broader systems remain separate work. |

Longer-term anatomy/combat, trade/diplomacy, ecosystems, authored anomaly rules, civilization history and extended modes remain explicit inventory work below. These priorities do not replace the definition-level audit or shrink the 180-system scope.

## 1. Universe, history, and settlement scale

Reference families: [world generation](https://dwarffortresswiki.org/index.php/World_generation) and [Legends](https://dwarffortresswiki.org/index.php/Legends).

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| U01 | World seeds and generation settings | Seeded star regions with configurable density and history length | A |
| U02 | World and regional maps | Universe → system → planetary region → local surface/orbital site | A |
| U03 | Sites, towns, and fortresses | Settlements belonging to a planet; several sites can share one world | A |
| U04 | Civilizations and territories | Spacefaring cultures, alliances, corporations, and claimed systems | C |
| U05 | Historical figures and families | Persistent captains, founders, dynasties, and crew lineages | C |
| U06 | Historical wars and migrations | Colonization waves, frontier wars, evacuations, and lost expeditions | C |
| U07 | Ruins and abandoned sites | Derelict stations, failed colonies, and buried habitats | C |
| U08 | Names, languages, and cultural identity | Generated place names, naming customs, and faction vocabulary | B |
| U09 | Off-site populations and events | Coarse simulation of inhabited worlds while the colony runs | C |
| U10 | Persistent worlds across games | Retired and failed colonies remain available in later campaigns | C |

Art: star and planet markers, settlement tiers, faction insignia, route lines, ruin markers, map selection states.

**Proposed scale model:** settlement count measures habitation, not physical planet size. A small moon can contain several outposts; a huge planet can have only one. Nearby strategic markers may belong to the same planet through an explicit planet ID. The user confirmed the idea of grouping nearby settlements into a planet; the exact size rule and this explicit-ID model remain proposals.

## 2. Embark and arrival

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| E01 | Site selection and survey | Scan landing sites for minerals, climate, atmosphere, and hazards | A |
| E02 | Embark dimensions | Select local site extent and starting access to nearby orbital regions | A |
| E03 | Starting group and skills | Assign a landing crew with occupations and personal traits | A |
| E04 | Starting supplies and animals | Budget cargo, seeds, tools, oxygen, and optional livestock | A |
| E05 | Starting civilization | Choose a sponsoring faction and its obligations | B |
| E06 | Embark profiles | Save crew and cargo presets | B |
| E07 | Arrival wagon and supplies | Landed shuttle, cargo containers, and an initial habitable compartment | A |
| E08 | Reclaiming a site | Return to an abandoned colony with its damage and history intact | C |

Art: landing shuttle, cargo pods, survey icons, crew portraits, sponsor emblems.

## 3. Terrain, geology, and environment

Reference: the [official features overview](https://bay12games.com/dwarves/features.html) covers geology, vegetation, and weather; detailed rules still need individual specifications.

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| T01 | Tiles and vertical levels | Local solid/floor/open cells; separate upward/outward travel regions | A |
| T02 | Biomes and regional variation | Airless, icy, volcanic, temperate, toxic, and irradiated regions | B |
| T03 | Soil and rock strata | Regolith, sedimentary layers, bedrock, and deep mantle boundaries | A |
| T04 | Mineral veins, gems, and ore | Deposits with extraction yields and useful material properties | A |
| T05 | Aquifers and underground water | Brine pockets, ice lenses, and pressurized underground reservoirs | B |
| T06 | Caverns | Derelict interiors and newly discovered space regions; local caverns optional | B |
| T07 | Rivers, lakes, and oceans | Surface liquids where climate permits; underground seas elsewhere | B |
| T08 | Magma and volcanoes | Lava pockets, geothermal sites, and dangerous heat sources | B |
| T09 | Weather and seasons | Planet-specific weather, day lengths, and seasonal cycles | C |
| T10 | Temperature and phase changes | Freezing, melting, boiling, and heat transfer | B |
| T11 | Liquid movement and pressure | Flooding, drainage, reservoirs, and pumping | B |
| T12 | Cave-ins and falling terrain | Excavation stability and collapse hazards | B |
| T13 | Trees, plants, and growth | Alien vegetation, cultivated biomass, and underground fungi | B |
| T14 | Contaminants and environmental effects | Dust, toxins, spores, residue, and exposed equipment | B |

Art: exposed/hidden rock, floors, ore overlays, wall connections, slopes, ice, liquids, plants, dust, heat and contamination indicators.

Implementation note: initial compartment fire, smoke transport/filtering, condition damage and supplied crew suppression are implemented; see [fire and smoke](fire-and-smoke.md). Broader material combustion and environmental hazards remain in the backlog.

## 4. Excavation and construction

Reference family: [buildings](https://dwarffortresswiki.org/index.php/Building).

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| B01 | Dig designations and priorities | Mark local excavation, salvage cuts, and urgent rescue routes | B |
| B02 | Stairs and ramps | Stairs, ramps, and ladder shafts; powered lifts are an extension | A |
| B03 | Constructed walls and floors | Rock structures and manufactured pressure hull sections | A |
| B04 | Smoothing and engraving | Finished surfaces, murals, and commemorative hull panels | B |
| B05 | Doors and hatches | Bulkhead doors and vertical pressure hatches | A |
| B06 | Bridges, gates, bars, and grates | Retractable walkways, shutters, security barriers, and drainage grilles | B |
| B07 | Beds, tables, chairs, and storage | Bunks, mess furniture, lockers, cabinets, and containers | A |
| B08 | Zones and room assignments | Quarters, mess halls, work areas, hospitals, and restricted zones | A |
| B09 | Building materials and quality | Material-dependent durability, appearance, and crew satisfaction | B |
| B10 | Deconstruction and removal | Recover usable parts and expose formerly sealed spaces | A |
| B11 | Levers, plates, and mechanisms | Wired switches, sensors, interlocks, and control logic | B |
| B12 | Pumps and mechanical power | Fluid pumps, drives, and utility machinery | B |

Art: connection-aware walls, finished floors, door/hatch states, stairs, furniture, construction ghosts, incomplete and damaged structures.

## 5. Jobs, logistics, and inventory

Reference family: [stockpiles](https://dwarffortresswiki.org/index.php/Stockpile).

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| L01 | Labors and work details | Crew job permissions, professions, and work groups | A |
| L02 | Job selection and interruptions | Reserve tasks and materials; pause work for survival or emergencies | A |
| L03 | Movement and access | Routes across levels, doors, hazards, and suit requirements | A |
| L04 | Hauling and item ownership | Carry items with reservations so two jobs cannot consume one item | A |
| L05 | Stockpile filters | Cargo zones filtered by item, material, condition, and hazard | A |
| L06 | Bins, barrels, bags, and carts | Crates, tanks, sealed canisters, and handcarts | B |
| L07 | Stockpile links and workshop input | Controlled flow from raw storage through processing to output | B |
| L08 | Work orders and conditions | Production targets triggered by inventory and prerequisites | B |
| L09 | Tracks, minecarts, and hauling routes | Industrial rail and scheduled cargo transport | B |
| L10 | Forbid, dump, melt, and reclaim | Lock supplies, designate waste, recycle scrap, and salvage goods | A |
| L11 | Wear, rot, and disposal | Spoilage, worn equipment, waste handling, and reclamation | B |
| L12 | Burrows and traffic restrictions | Assigned operating areas and emergency safe zones | B |

Art: item silhouettes, stacks, containers, carts, tracks, route overlays, reserved/forbidden markers.

## 6. Crew lives and society

Reference family: [thoughts](https://dwarffortresswiki.org/index.php/Thought); the [Steam description](https://store.steampowered.com/app/975370/Dwarf_Fortress/) also describes personalities and cultural activity.

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| C01 | Physical and mental attributes | Individual abilities and species physiology | B |
| C02 | Skills and experience | Practice-based growth in mining, engineering, care, and combat | A |
| C03 | Hunger, thirst, and fatigue | Meals, hydration, sleep, and species-specific requirements | A |
| C04 | Preferences and needs | Favorite foods, materials, surroundings, hobbies, and company | B |
| C05 | Thoughts, emotions, and stress | Memories and reactions to colony life, loss, danger, and comfort | B |
| C06 | Personality, values, and beliefs | Different responses to authority, risk, work, and isolation | B |
| C07 | Friendships, grudges, and partners | Persistent relationships that affect behavior | B |
| C08 | Birth, childhood, and aging | Colony families, growth, education, and mortality | C |
| C09 | Migrants, visitors, and petitions | Incoming passenger ships, guests, refugees, and residency requests | B |
| C10 | Pets and animal ownership | Companion organisms and personal attachments | B |
| C11 | Clothing and possessions | Uniforms, civilian clothing, personal items, and ownership | B |
| C12 | Breakdowns and destructive behavior | Stress crises, withdrawal, fights, and damage to colony equipment | C |
| C13 | Strange moods and artifacts | Obsessive invention episodes producing unique named creations | C |
| C14 | Death, burial, and memorials | Body recovery, funerals, memorial walls, and grief | B |

Art: layered bodies, clothing, helmets, tools, carried objects, age/species variants, movement poses, distress and injury markers.

## 7. Food, agriculture, and animals

Reference families: [industry](https://dwarffortresswiki.org/index.php/Industry) and [creatures](https://dwarffortresswiki.org/index.php/Creature).

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| F01 | Farming and seeds | Grow beds, seed stock, nutrient media, and harvest cycles | A |
| F02 | Gathering and orchards | Gather local organisms and cultivate larger food plants | B |
| F03 | Brewing and drinks | Fermentation, morale drinks, and species-safe beverages | B |
| F04 | Cooking and prepared meals | Recipes consuming distinct ingredients with quality outcomes | A |
| F05 | Milling, pressing, and processing | Grain, algae, oil, and nutrient processing | B |
| F06 | Hunting and fishing | Surface hunting and aquatic harvesting where ecosystems support it | B |
| F07 | Butchery and rendering | Biomass processing with meat, fat, bone, hide, and waste outputs | B |
| F08 | Breeding, grazing, and pastures | Habitat pens, reproduction, feed, and carrying capacity | B |
| F09 | Milking, shearing, and eggs | Renewable animal products appropriate to each species | B |
| F10 | Beekeeping and wax | Pollinator colonies and resin/wax products | C |
| F11 | Training and domestication | Working animals, guards, mounts, and rescue companions | C |
| F12 | Vermin, pests, and predators | Cargo infestations, crop pests, and local food webs | B |

Art: crop growth stages, seed packets, meals, drink containers, pens, eggs, animal families, pests, organic byproducts.

## 8. Manufacturing and materials

Reference family: [industry](https://dwarffortresswiki.org/index.php/Industry). These rows group production families; every individual recipe still needs a definition.

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| I01 | Stonework | Cut blocks, structural ceramics, and durable furniture | A |
| I02 | Woodworking | Biomaterial structures and renewable composite components | B |
| I03 | Smelting, fuel, and alloys | Ore refining, furnace energy, and alloy recipes | B |
| I04 | Forging and metalcraft | Tools, machine parts, hull fittings, and metal furniture | B |
| I05 | Gems and decoration | Precision crystals, jewelry, and decorative inlays | B |
| I06 | Glassmaking | Viewports, vessels, optical components, and glass structures | B |
| I07 | Pottery, kilns, and glazing | Ceramic containers, insulation, and chemical vessels | B |
| I08 | Textiles and dyes | Fiber processing, cloth, insulation, uniforms, and color treatments | B |
| I09 | Leatherworking | Flexible seals, protective clothing, and organic composites | B |
| I10 | Bone, shell, and horn crafts | Hard biological materials used for tools and ornaments | B |
| I11 | Soap and cleaning materials | Hygiene products and decontamination supplies | B |
| I12 | Paper, books, and instruments | Physical records, data media, leisure objects, and instruments | C |
| I13 | Weapons, ammunition, and armor | Security gear, projectiles, armor, and powered equipment | B |
| I14 | Material properties and quality | Shared material definitions governing manufacturing and damage | B |
| I15 | Decorations, artifacts, and provenance | Named items with makers, owners, events, and cultural meaning | C |

Art: workshop silhouettes, operating states, ore and ingots, components, clothing, tools, weapons, decoration layers, finished goods.

## 9. Medicine and injury

Reference: [health care](https://dwarffortresswiki.org/index.php/Health_care).

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| H01 | Anatomy and tissues | Species body plans with organs, limbs, and material responses | B |
| H02 | Wounds, bleeding, pain, and disability | Persistent injuries and reduced capabilities | B |
| H03 | Hospitals and supplies | Medbays with beds, sterile supplies, water, and power | B |
| H04 | Diagnosis and treatment jobs | Triage, surgery, wound closure, immobilization, and rehabilitation | B |
| H05 | Rescue and patient care | Recover casualties, carry patients, and provide food and fluids | B |
| H06 | Poisons, syndromes, and infection | Alien toxins, contamination, pathogens, and exposure conditions | C |
| H07 | Recovery and lasting damage | Healing schedules and permanent effects; prosthetics are an extension | C |

Art: medbay equipment, stretchers, bandages, medical stock, health overlays, visible injury states.

## 10. Trade, leadership, and institutions

References: [trading](https://dwarffortresswiki.org/index.php/Trade) and [nobles](https://dwarffortresswiki.org/index.php/Nobles).

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| P01 | Caravans and trade depots | Merchant ships, landing pads, brokers, and cargo exchange | B |
| P02 | Prices, valuation, and negotiation | Material/quality value, local scarcity, and negotiated deals | B |
| P03 | Trade agreements and requests | Scheduled resupply and requested cargo manifests | B |
| P04 | Cultural trade restrictions | Factions refuse goods or practices conflicting with their values | C |
| P05 | Managers, brokers, and record keepers | Production officers, quartermasters, and inventory staff | B |
| P06 | Nobility, elections, and appointments | Governors, elected representatives, and sponsor-appointed officials | C |
| P07 | Demands, mandates, and room requirements | Contracts, quotas, export restrictions, and status privileges | C |
| P08 | Justice and investigations | Reports, witnesses, investigations, hearings, and sanctions | C |
| P09 | Prisons and enforcement | Brig rooms, custody jobs, and security personnel | C |
| P10 | Diplomacy, tribute, and relations | Treaties, sponsor relations, protection payments, and diplomatic visits | C |
| P11 | Taverns, temples, and guildhalls | Social hubs, belief spaces, professional groups, and visiting specialists | B |
| P12 | Libraries and scholarship | Archives, study, copied records, and scholars; research unlocks are an extension | C |
| P13 | Performances, music, and dance | Generated cultural practices and scheduled recreation | C |

Art: merchants, envoys, insignia, cargo manifests, offices, brig furniture, social and cultural room fittings.

## 11. Military and threats

References: the [official combat overview](https://bay12games.com/dwarves/features.html) and released siege changes in the [developer log](https://bay12games.com/dwarves/). Do not accidentally use old siege assumptions as the reference baseline.

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| M01 | Squads, equipment, and schedules | Security teams, loadouts, duty rosters, and assigned stations | B |
| M02 | Training and barracks | Drills, practice ranges, and squad quarters | B |
| M03 | Patrol, station, and attack orders | Perimeter patrols, guard positions, and designated targets | B |
| M04 | Melee, ranged, and wrestling combat | Tools, firearms, boarding weapons, grappling, and suppression proposal | B |
| M05 | Armor, shields, and material damage | Armor layers and suit integrity tied to anatomy | B |
| M06 | Traps and siege engines | Mines, capture devices, turrets, and defensive emplacements | B |
| M07 | Ambushes, thieves, and kidnappers | Raiders, cargo thieves, infiltrators, and abduction teams | C |
| M08 | Sieges and attacking forces | Planetary assaults and boarding operations | C |
| M09 | Siege engineering and breaching | Enemies cut through structures and build access routes | C |
| M10 | Wildlife attacks and large beasts | Predators, megafauna, and anomalous organisms | B |
| M11 | Generated monsters and underground threats | Procedural alien organisms with unusual abilities | C |
| M12 | Undead, curses, and hidden monsters | Reanimated biotech, parasites, infiltrating mimics, and contamination | C |
| M13 | Villains, plots, and stolen artifacts | Espionage, sabotage, recruitment, and stolen prototypes | C |
| M14 | Raids, expeditions, and conquest | Dispatch crews to distant sites; track travel and consequences | C |

Art: hostiles, weapon overlays, shots, impacts, traps, turrets, breach damage, alien parts, threat warnings.

## 12. Adventure and history modes

References: [Adventurer mode](https://dwarffortresswiki.org/index.php/Adventure_mode) and [Legends](https://dwarffortresswiki.org/index.php/Legends).

| ID | Dwarf Fortress family | Proposed SPACEFORTRESS conversion | Stage |
| --- | --- | --- | --- |
| A01 | Character creation and direct control | Play an individual explorer or former colony resident | D |
| A02 | Travel, exploration, and survival | Travel among worlds and explore surface and underground sites | D |
| A03 | Conversations, reputation, and companions | Talk to persistent characters and recruit expedition members | D |
| A04 | Tasks, rumors, and discovered sites | Follow distress calls, leads, lost crews, and artifact histories | D |
| A05 | Tactical actions and stealth | Direct movement, combat, sneaking, climbing, and interaction | D |
| A06 | Returning to player-built settlements | Visit a fortress created in colony mode | D |
| A07 | History browser and relationships | Search a universe chronicle of people, factions, places, and objects | C |
| A08 | Historical maps and event records | Inspect changes in control, settlement history, and major events | C |

Art: direct-control cursor, dialogue portraits, journal symbols, travel markers, chronicle and relationship views.

## 13. Controls, presentation, and persistence

These are product requirements for delivering the converted systems, not a claim of detailed Dwarf Fortress implementation parity.

| ID | Requirement | Proposed SPACEFORTRESS behavior | Stage |
| --- | --- | --- | --- |
| Q01 | Pause, speed, and time display | Inspect safely, step time for development, select simulation speed | A |
| Q02 | Camera and level navigation | Pan, zoom, change depth, jump to alerts, and find selected units | A |
| Q03 | Designation tools | Paint, erase, prioritize, preview cost, and explain invalid orders | A |
| Q04 | Inspectors and search | Explain tile, crew, item, room, machine, and job state | A |
| Q05 | Alerts and reports | Tell the player what happened, where, why, and what needs action | A |
| Q06 | Inventory and work overviews | Filter supplies, jobs, production, and crew assignments | A |
| Q07 | Saves and world persistence | Versioned saves with stable IDs, autosave, and recovery behavior | A |
| Q08 | Generation options and difficulty | Tunable hazards, population, map size, and starting conditions | B |
| Q09 | Tutorial and in-game reference | Guided first shelter, explanatory tooltips, and readable recipes | B |
| Q10 | Accessibility and input settings | Scalable UI, remappable controls, icons beyond color alone | A |
| Q11 | Audio and music | Local effects, environmental audio, and context-sensitive music | B |
| Q12 | Data definitions and customization | Local data files for materials, species, recipes, and visual mappings | B |
| Q13 | Simulation visibility and performance | Useful diagnostics, deterministic scenarios, and explicit tick budgets | A |

Art: cursor set, selections, designations, alerts, toolbar icons, panels, readable typography, minimap and overlays. Fonts and audio need provenance just like sprites.

## 14. Additional space systems

These are proposed SPACEFORTRESS additions. They are not presented as existing Dwarf Fortress systems.

| ID | New system | Proposed behavior | Stage |
| --- | --- | --- | --- |
| S01 | Room atmosphere | Track connected compartments, pressure, breathable gas, and dangerous buildup | A |
| S02 | Airlocks | Controlled entry with interlocks and pressure equalization | A |
| S03 | Power generation and distribution | Sources, consumers, storage, outages, and load priority; initial hauled-fuel reactors and external cooling implemented ([scope](reactors.md)) | A |
| S04 | Life support | Oxygen generation, scrubbing, consumables, and equipment failure | A |
| S05 | Suits and exterior work | Suit access, air capacity, integrity, and return-to-safety decisions | A |
| S06 | Thermal management | Habitat heating/cooling and machinery waste heat | B |
| S07 | Radiation and shielding | Exposure affected by location, materials, events, and protection | B |
| S08 | Gravity | Planet-specific gravity; detailed zero-gravity movement is later scope | C |
| S09 | Ship travel and docking | Travel time, fuel, capacity, manifests, and berth availability | A |
| S10 | Sensors and communication | Basic nearby discovery first; deeper scans and communication limits later | A |
| S11 | Electronics and automation | Circuit and component production; control equipment and service robots | B |
| S12 | Prosthetics and advanced treatment | Replace damaged limbs; maintain implants and synthetic bodies | C |
| S13 | Technology development | Study samples and prototypes to unlock specified production methods | C |
| S14 | Orbital and stellar events | Impacts, flares, debris, and time to shelter or prepare | C |

Art: pipes/cables or utility overlays, tanks, vents, generators, batteries, airlock states, pressure warnings, suits, sensors, docking hardware.

## 15. Upward/outward exploration and industry

These rows expand the user's new progression premise. They share supporting systems S03, S05, S07, S09, S10, and S14; do not implement duplicate travel or power simulations.

| ID | Gameplay role | Proposed SPACEFORTRESS behavior | Stage |
| --- | --- | --- | --- |
| O01 | Layers above the planet | Browse named surface, orbital, and farther regions | A |
| O02 | Local destinations | Open a detailed isometric colony, station, wreck, or resource site | A |
| O03 | First satellite salvage | Cut open a wreck, recover components, and return them home | A |
| O04 | Inter-site logistics | Reserve transport, supplies, crew, berths, and cargo capacity | A |
| O05 | Passing comets | Resource opportunities with arrival/departure and return windows | B |
| O06 | Debris fields | Visible impact risk, route choices, salvage, and protection needs | B |
| O07 | Solar collection zones | Sites with valuable output and explicit heat/exposure costs | B |
| O08 | Advanced collectors | Better tolerance and output with maintenance and cooling demands | B |
| O09 | Energy delivery | Consume power locally or deliver stored energy; transmission later | B |
| O10 | Orbital habitation | Establish staffed outposts with supplies and life support | B |
| O11 | Survey uncertainty | Reveal approximate identity before detailed condition and contents | B |
| O12 | Hazard forecasts | Show warnings and give time to recall crew or protect equipment | B |
| O13 | Rescue and stranded expeditions | Track distress, remaining supplies, and recovery missions | B |
| O14 | Distant discoveries | Remote ruins, unusual organisms, competing expeditions, and history | C |

Art: orbital region markers, satellite wrecks, salvage cuts, comet bodies/trails, debris density, collector states, transport routes, transfer progress, and exposure overlays.

## Dependencies that determine implementation order

1. Tile state, stable entity IDs, clock, and save format support everything else.
2. Connectivity and pathfinding support building, hauling, room detection, and safe movement.
3. Item reservations and jobs support construction, feeding, workshops, medicine, and trade.
4. Room boundaries, gas quantities, and power support the first playable space survival loop.
5. Materials and recipes support meaningful industry and equipment.
6. Anatomy, equipment, and injuries support combat and treatment.
7. Persistent events and relationships support history, diplomacy, and cross-mode play.
8. Site IDs, transport reservations, and travel state support the first surface-to-orbit loop; do not defer all travel until late game.

Keep simulation state independent of how it is drawn. The proposed target stores local positions as site ID plus x/y/z and keeps travel regions/routes separate. Current local positions and pathfinding use site ID plus x/y only; z migration and layer visibility are unfinished. Draw local maps with isometric sprites and layer visibility controls. A switch to an orbital view must not teleport crew, cargo, or power.

## First playable acceptance scenario

Start with seven crew, a landed shuttle, supplies, and a small power source. Build or fit out a habitable surface shelter with a bulkhead, life support, bunks, storage, and food. Discover one satellite wreck. Send a supplied team, salvage a useful component, handle a readable hazard, and return the cargo to improve the colony. Save/reload preserves both sites and any travel in progress. Local mining is a later extension of this first slice, not a prerequisite for reaching orbit.

This is the first coherent slice. Much of its simulation exists, including supplied departure, cargo hauling and the return unlock, but the full current player flow and integrated failure/recovery scenario still need scoped acceptance evidence. The full inventory remains the long-term scope.

## Definition-level audit still required for exhaustive conversion

Choose a specific installed Dwarf Fortress release as the reference, then enumerate its definitions and observed mechanics locally. This draft did not download or inspect game files. Do not claim exact parity until that audit is complete.

Each definition gets: source identifier/version, gameplay role, proposed replacement, properties, dependencies, visual IDs, implementation status, and a verification scenario.

- Materials: stones, ores, metals, alloys, gems, soils, glass, ceramics, fluids, biological materials, and temperature/damage properties.
- Life: species, castes, body plans, tissues, populations, diets, reproduction, movement, abilities, interactions, and syndromes.
- Plants: growths, harvest products, seeds, habitats, seasons, and processing uses.
- Items: tools, weapons, ammunition, armor, garments, containers, furniture, instruments, books, components, and artifacts.
- Production: every workshop, job, recipe, reagent, output, byproduct, fuel, skill, and material restriction.
- Society: roles, labor groups, offices, permissions, needs, beliefs, cultural practices, institutions, and legal consequences.
- World content: civilizations, sites, regions, underground layers, historical events, travel, and encounters.
- Interaction rules: mining, building, liquids, combat, treatment, social actions, item use, quality, ownership, wear, and failure states.
- Presentation: every visible state, orientation, animation, overlay, icon, notification, sound, and UI control needed by those definitions.

Implement original game code and art. Use the reference to identify gameplay roles rather than importing its artwork or copying its content files into SPACEFORTRESS.
