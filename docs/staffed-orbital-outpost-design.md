# Staffed orbital outpost — foundation and proposed gameplay

**Status: schema 37 foundation implemented and verified within this scope. Full staffed-outpost gameplay remains PROPOSED.** Updated September 29, 2026. The foundation adds persisted owners/rosters, validation, inventory accounting, pure observations, site-local reservation primitives and physical shuttle drawing. It does not add player settlement or freight actions, remote colony care, an established outpost or playable resupply. The [verification index](verification-status.md) separates this work from the historical [two-person orbital journey](orbital-colony-loop.md).

## Implemented phase-one boundary

| Foundation | Implemented and verified scope |
| --- | --- |
| Saved state | `outposts.wreck` is the sole residence registry. `shuttle.freight` and each actual dock's `imports` are independent inventory owners. `mission.returnCrew` is separate from ordered arrival history in `mission.crew`. |
| Migration and validation | The 36→37 migration creates empty owners and copies the existing mission roster without granting cargo or residents. Current-schema saves require their fields and valid ownership; readers do not repair missing state. Invalid resources, metadata, aliases, rosters and locations are rejected. |
| Return behavior | One or two named return travelers, no voluntary empty roster, traveler-only boarding/salvage, and resident-job protection during recall. The internal roster setter is not a shared player action. Synthetic resident fixtures exercise protection; ordinary gameplay cannot establish a resident yet. |
| Material accounting | Freight/imports participate in resource totals, item/meal ownership and food aging. Freight, salvage and shuttle-bound claims share hold capacity; local construction/input/depot shipments retain their own owners. |
| Site-local primitives | `constructionSupplyLocations(s,siteId='surface')`, `constructionResources(s,siteId='surface')` and `reserveConstruction` use that site's stock, imports and drops, protect pickup claims, and restore canceled reservations locally. Remote Build remains unavailable. |
| Pure observations and drawing | Physical shuttle location/presence, wreck residence and return selection are exposed without allocating IDs or moving inventory. Craft drawing follows the actual berth or transit state; a dock alone does not create a shuttle. No outpost control panel is added. |

Foundation tests can construct owner/resident state directly. Those cases do not prove that a player can ship freight, settle a crew member, sustain an outpost or resupply it. Those steps require the later ordinary-game acceptance below.

## Direction and bounded target

The user confirmed upward/outward progression from a planet into orbit and farther space, interacting colony systems, a minimal interface and clearly labeled simulation actions. Choosing Relay K-07 as the first persistent settlement, its roster rules and the transport design below are **agent proposals**, not additional user decisions.

The proposed acceptance story is concrete: surface workers load finite construction freight; two visitors transport and physically unload it at the wreck; builders establish a sealed, powered, supplied habitat; one named crew member settles while the other returns; a later flight delivers actual provisions while the resident continues living and working. A delayed delivery must have observable consequences while the player views the surface. Resupply or physical pickup must provide a recovery path.

Keep the first playable settlement to the existing wreck and one shuttle. Generated sites, a fleet, local vertical decks, remote livestock and a general autonomous evacuation system remain later work. Existing comet/solar expeditions and the accepted surface-to-wreck salvage loop must continue to work.

## What the source already supports

| Capability | Current boundary |
| --- | --- |
| Finite atmosphere, thermal, power, gas, plumbing and fire | The main tick processes every site's utilities independently of the viewed map. This does not make remote crew scheduling or logistics complete. |
| Remote physical presence and extraction | A selected two-person mission can visit the wreck, mine piles, carry salvage to the dock and return with it. Persisted residence/return-roster foundations now exist, but no player settlement action exists. |
| Inventory ownership | Depot/pile stock, job reservations/materials, carried loads, machine buffers, mission cargo, service stores, freight and dock imports are distinct owners. `extract`/`add` preserve food ages and item identity; gameplay freight transfers remain unfinished. |
| Local hauling primitives | Much of industry/storage already accepts a site, but remote scheduling and shipment dispatch prevent ordinary colony use. |
| Habitat construction primitives | Floors, walls, doors, bunks, depots and devices exist. Remote construction is explicitly rejected. Bare wreck `deck` is exterior, not a pressurized floor. |
| Persistent saves and observations | Schema 37 persists and validates wreck residence separately from physical location and flight rosters. Stable IDs and detached observations expose the foundation; it does not supply remote care or settlement controls. |

Primary sources: [simulation](../src/simulation.js), [expedition](../src/expedition.js), [preflight](../src/preflight.js), [construction](../src/construction.js), [inventory](../src/inventory.js), [industry](../src/industry.js), [storage](../src/storage.js), [atmosphere](../src/atmosphere.js), [thermal](../src/thermal.js).

### Confirmed blockers to remove deliberately

- `order` still gates remote work by the active mission and rejects remote building. Local reservation primitives now exist, but enabling construction requires a supplied gameplay path and remote worker scheduling. The breaker job validator also needs review before remote building is enabled.
- Cargo dispatch/claims and return boarding now distinguish travelers and local owners; recall protects resident jobs. These foundation guards passed the integrated regression checks; they do not implement freight loading/unloading or resident scheduling.
- Recovery, eating/rest scheduling, leisure, ordinary idle hauling and parts of medicine, rescue, nursing, hygiene and sanitation assume the surface. Remote hunger/energy decay and breathing already happen; enabling residence alone would strand needy crew.
- Schema 37 now validates site-qualified material targets and admitted wreck residents, but resident care/housing still needs its own site-aware rules. Homes currently use surface coordinates; those coordinates cannot silently become remote homes.
- Field hazards are tied to the active mission and its fitting. A departed shuttle must neither disable resident hazards nor lend its storm-shelter modifier to everyone left behind.
- Build selection, material/environment summaries, maintenance navigation and parts of housing/battery UI assume the surface. A remote inspector alone does not establish working controls.

## Implemented state and proposed transport gameplay

The implemented default has one authoritative residence owner:

```text
s.outposts.wreck = { established: false, residents: [] }
```

There is no second independently writable `crew.homeSite` field. An unestablished registry must have an empty roster; established test state may contain ordered known crew IDs. A crew member's existing `site` remains their **physical location**; residence and flight selection have separate meanings. Resident IDs must be known and unique, and death/return handling must preserve the crew entity and any owned material.

Ordered `mission.crew` remains outbound/arrival history; implemented `mission.returnCrew` starts as an independent copy. Its internal selection helper requires one or two distinct, known, living, physically local candidates and rejects abandoning living arrivals without residence or orphaning their shuttle shipments. Later death retains the named roster; only all assigned travelers dying permits the existing no-survivor return fallback. No shared player/agent return-selection action is exposed. Future settlement can use this separation for a visitor/resident swap. `established` is a persisted founding-history flag, not evidence of current habitability; settlement readiness remains unfinished.

Full gameplay requirements below remain proposed unless covered by the phase-one table:

1. The existing initial departure still chooses exactly two eligible people. No silent replacement, teleport or crew creation is allowed.
2. Settlement requires the chosen crew member to be physically present at the wreck and a real operational habitat. An accepted settlement explicitly removes them from the planned return roster; unresolved visitors cannot simply be abandoned by editing a list.
3. Return selection respects the two-seat limit and names actual local people. A resident selected for pickup remains resident while waiting; departure performs the final membership transition only after physical boarding succeeds.
4. The first demonstrated return carries the other visitor. Root rejected voluntary zero-passenger returns; preserve only the existing all-assigned-travelers-dead fallback. This adds no piloting mechanic. Internal one-person return and passenger selection now have foundation rules; their shared player controls and ordinary-game settlement/pickup journey remain unfinished.
5. Recall releases only travelers' work and applicable pickup claims. It preserves resident jobs and moves every held shipment through normal completion/drop/cancellation rules.
6. A dock is a location, not evidence that a shuttle is there. Derived shuttle presence must follow the actual mission phase/location. No resident may board an absent vehicle, receive invisible surface fuel, or be counted as evacuated merely by reaching the dock.
7. Automatic return and injuries need roster-aware rules. Distressed residents seek real local shelter/care or request a pickup; they cannot automatically commandeer a distant shuttle. Existing rescue must carry dependent passengers when supported, with an honest blocked state otherwise.

Save schema 37 is implemented in the working tree. It is a persistence version, not a claim of a new published release or completed outpost. Migration, strict roundtrips and integration results are tracked separately in [verification status](verification-status.md). Settlement/freight action names, establishment prerequisites and current habitat readiness remain future gameplay decisions.

## Finite freight and local ownership

Outbound construction/provisions must be separate from the existing flight service stores and return-material filter. Route fuel, food used for flight and reserved return fuel/collector kit retain their current service purposes. They are not an outpost building budget.

The proposed material path is:

```text
surface depot/pile
  → reserved loading job source → carrier → loading job materials
  → shuttle.freight → actor unload at the actual wreck dock
  → dock.imports → local carrier → depot / build job / machine input
```

Each planned arrow must be an actual transfer using `extract`/`add`, clearing the previous owner. The durable `shuttle.freight` owner and separate `tile.imports` inventories at every actual dock are implemented; residence remains wreck-only. Owner walkers include those inventories for counts, metadata, food aging and observations. The surface→freight→imports gameplay jobs are not implemented. Planning, departure, arrival or opening a menu must not credit destination stock; future actual unloading will make freight available locally. Load/unload work and the departure freight request still need APIs and ordinary-game acceptance.

Required invariants:

- Onboard freight and salvage share a clearly enforced physical hold capacity, including relevant carried/pickup claims. Existing standard/cargo/shield capacities are 18/36/12 units. Service stores remain a separate existing model; do not count them twice or consume protected return fuel as freight.
- Remote construction enumerates reachable stock/piles/imports on **the job's site**. Existing source coordinates may inherit `job.site`; all bounds, cancellation and restitution must use that same site. A surface stock summary is never spendable remotely.
- Local job/input shipments cannot be hijacked by salvage delivery. Only shuttle-bound shipments consume shuttle claim capacity. Local and return pickup claims must agree on who owns a pile's available material.
- A depot is not required to reserve a reachable loose construction pile, allowing a depot to be built from imported/local alloy. A depot is needed by the current machine-input hauling path, which selects depot sources.
- Full storage, disabled hauling, a blocked route, cancellation, death, a destroyed dock and an interrupted return retain material at a real owner. Preexisting freight, food spoiling into waste, replacement loading and smaller-hold refits need explicit capacity gates. They cannot erase it, duplicate it or silently credit surface stock.
- Food age, prepared portions and discrete item IDs survive every transfer and save. A new cargo owner must participate in total resources, food aging/preservation and item ownership exactly once.
- Gas species, floor/network water and electrical charge retain their existing ledgers. Moving packaged air/water is inventory transport; injecting it into a room/device is a separate physical conversion. Resource totals alone are not a complete gas/energy conservation proof.

References: [construction logistics](construction-logistics.md), [departure preparation](departure-preparation.md), [expedition logistics](expedition-logistics.md), [item owner enumeration](../src/item-lots.js).

## Bootstrap and finite living conditions

New wreck floors must begin with **zero gas**. `updateRooms` already does this and remaps only retained gas; `thermal.remapThermal` gives new floor thermal mass the wreck's ambient temperature, currently **−60°C**. Settlement, navigation and reload must never call starter `fillRoom` or reinitialize thermal state to grant a warm breathable habitat. New devices/depots start empty and batteries start uncharged.

Use the existing builders and devices, supplied through real imports and local salvage. The construction sequence must leave reachable work positions and a dock path. Pressurization, heating and a resident's arrival are separate events. A cold breathable room is dangerous because the current exposure model treats breathable interiors as unsuited; warming before admission/pressurization needs explicit gameplay handling.

The audit identified an **unverified candidate** using existing wreck hull: a six-floor interior with two bunks, depot, scrubber, climate unit and farm; five added walls/one door; an exterior reactor floor/reactor/radiator and two cable tiles. Its existing definition costs total **62 alloy and 6 components**, excluding all provisions, repairs, extra care equipment and losses. The candidate footprint is interior `(11..13,6..7)`, new walls `(10,6),(10,7),(10,8),(11,8),(12,8)`, door `(13,8)`, reactor floor/reactor `(13,10)`, radiator `(13,11)`, cables `(13,9),(13,8)`; extract the satellite at `(12,6)` first. This is a feasibility probe, not an approved blueprint or proven safe layout.

Consequences that must shape the ordinary-play test:

- The 68 construction units exceed one current hold. Staged unmanned provisioning/building visits are likely necessary; a first resident must not be stranded while a later trip completes missing life support.
- Six room cells have a nominal 60 gas units at 100% pressure, before leaks, breathing and suit refills. Those units must be delivered and injected; stored reserve mix aboard the shuttle currently has no field-use action.
- Six cells have thermal capacity 120 game units per degree. A single healthy climate unit supplies at most 12 heat/tick, giving a **650-tick climate-only heating estimate** from −60°C to the crew thermal-safe threshold of 5°C, before losses. Other powered equipment also contributes heat, so this is not a strict warm-up lower bound. Farming needs at least 10°C. These are source arithmetic, not measured stabilization times.
- A reactor at 25% nominal setting could provide 10 kW before condition/fuel/thermal constraints; scrubber/climate/farm demand 7 kW. This is a preliminary nameplate comparison, not proof of heat balance, uptime or staffing feasibility. Reactor fuel, radiator behavior, charging and maintenance need execution evidence.

The current scrubber consumes delivered mix for initial filling, losses and deficient oxygen, but **recycles CO2 into oxygen without a consumable**. An ideal sealed, powered habitat therefore does not steadily drain packaged air merely because crew breathe. Do not invent that failure. Food, fuel, farm water/fertilizer, leaks, suit refill and power loss already provide finite pressures. A non-recycling vent/filter arrangement is a separate design option using existing gas devices, not a required new atmosphere model.

The existing farm consumes one water and 0.25 fertilizer per two-food crop, requires labor, power, breathable air and 10–35°C. It cannot be called self-sufficient. Resupply should initially carry food as well as any growing inputs. Food can spoil in transit and at the outpost under the existing rules.

Sources: [building/recipe definitions](../src/data.js), [atmosphere](../src/atmosphere.js), [thermal](../src/thermal.js), [reactors](reactors.md), [gas networks](gas-networks.md), [food preservation](food-preservation.md).

## Resident work, care and failure recovery

Generalize existing recovery and labor to the crew's physical site after settling ownership; do not create a second simplified remote crew simulator. Residents must eat local food, rest in reachable safe bunks, haul local provisions and perform supplied work while another map is visible. Medical/nursing/hygiene jobs must match the patient's physical site, and sleep/bed/pickup claims must distinguish equal coordinates on different sites.

For the first increment, communal remote bunks can preserve a crew member's existing surface home reservation. Suppress false displaced-home penalties merely for sleeping away. Personal remote home ownership is later work unless its site-qualified state is explicitly included and migrated. This choice avoids treating an existing `[x,y]` surface home as a wreck home.

Settlement readiness should be a pure observation of actual local shelter, breathable gas, temperature, reachable food/bunk/depot and functioning supplied utilities. It is a current gate, not a promise of indefinite safety. Exact thresholds/reserve policy remain unresolved; do not manufacture a days-of-air number. Offscreen warnings must identify a real problem and affected site.

| Failure to exercise | Required physical response |
| --- | --- |
| Shipment delayed or canceled | Existing local stocks continue to age/consume; the resident keeps working/recovering where possible. No view/reload refill. |
| Lost power or reactor fuel | Devices follow current network/fuel/thermal rules; symptoms and local repair/supply needs remain visible from the surface. |
| Breach, cold room, fire or exhausted food | Crew use current breathing/exposure/need rules and reachable local shelter/care. Alerts do not create safety. |
| Injured resident with no shuttle present | Local helper/cot/medicine/food are real requirements; a pickup request waits for transport. An empty dock is not a rescue destination by itself. |
| Pickup with cargo or dependent passenger | Resolve carried owners and actual path/carrying/boarding before departure; reject impossible capacity/roster changes atomically. |
| Resident death | Preserve body/entity state, release claims and drop held goods through existing ownership rules. Do not replace the resident or erase the loss. |

The paused evacuation prototype is not part of this design and should not be restored wholesale. Existing mission safety/recall is a starting point, not proof of resident rescue.

## Shared controls, records and minimal interface

Reuse site-qualified construction, utility, depot and labor actions. New residence/freight/return-selection actions must enter `src/controls.js` so player and local-agent requests share exactly the same validation. Candidate action names such as `crew.residence`, `outpost.resupply` and a return-manifest action remain proposals until the state contract settles.

Strictly validate known resource keys, finite positive quantities, discrete item counts, site/crew IDs, capacity and eligible roster membership before mutation. The current generic argument validator does not recursively validate resource objects; adding an object-shaped freight argument alone is insufficient. Rejections must be atomic and expose stable blocker codes alongside readable reasons.

Implemented observations preserve existing expedition data and add `colony.derived.expedition.returnCrewIds`, `colony.derived.shuttle.location`, site `derived.shuttle`/`derived.outpost`, and crew `derived.residence`/`derived.expedition.selectedForReturn`. Freight/imports retain their inventory owner slots; item/meal locations reference those slots. Wreck outpost status exposes the registry, not a habitat-ready verdict. Reachable resupply blockers, reserve estimates and a settlement-readiness view remain proposed. Pure observations must not allocate IDs, reserve stock, emit events or change RNG/save state.

Emit committed semantic transitions for residence assignment/removal, freight planning/cancellation, pickup/loading, departure/arrival, unloading/delivery and hazard activation/clearance. Each material boundary names exact `{entity,slot}` owners and quantities; roster changes include previous/next IDs, site and tick. Existing construction/device/mission events remain authoritative. Transient rescue transitions also need explicit labels if expanded. Recordings stay local, optional and bounded, with recording-on/off equivalence and reconstructable ordered records. Observations are not training rewards or proven causes.

Keep the map prominent. Reuse Regions, Crew, Build and the site inspector with Residents, Resupply and Dock detail disclosures. Staffed-site navigation should leave drawers closed. A compact urgent site badge must remain actionable while viewing elsewhere. Resource and air/power summaries must name their actual site; exterior vacuum and indoor room conditions are distinct. Show no freight crates or shuttle presence without corresponding physical state. Detailed status must come from shared pure helpers, not UI safety guesses.

## Implementation sequence and acceptance gates

The phase-one foundation above has accepted scoped evidence. The remaining gameplay sequence below is proposed; it is not evidence of a playable outpost.

1. **Preserve the verified foundation.** Schema 37 owners/rosters, pure presence/status, metadata accounting and local reservation primitives passed the scoped migration, conservation, return-protection, recording and browser checks. The full suite passed 864 tests, with one intentional historical capture-only skip; Python server checks passed 7/7 and JavaScript syntax checks 149/149. This acceptance is narrower than staffed-outpost gameplay; see [verification status](verification-status.md).
2. **Enable supplied local construction.** Build on the implemented local reservation/claim/dispatch foundation. Add a real imported-material/work scheduling path before enabling remote Build; helper-level tests alone do not establish playable construction.
3. **Add freight and residence transitions.** Load/unload with actual actors, preserve service reserves, and require a supplied operational habitat before explicit settlement. Resolve interrupted plans/cancellation before exposing controls.
4. **Generalize resident care and hazards.** Ensure work, eating/rest, same-site medical claims, offscreen utilities/hazards and warnings continue without an active mission. Avoid unsafe cold-room bootstrap and resident-wide mission recall.
5. **Expose shared UI/telemetry.** Verify ordinary player actions, strict dispatch, named transfers and hidden detail panels.
6. **Run the ordinary-game journey.** From an untouched colony, acquire every required component, fitting and provision; perform staged flights/building through shared actions; settle a named resident; return the other visitor; demonstrate local work and recovery with no mission present; resupply; delay a later delivery while viewing the surface; observe an actual finite shortage and restore supplies or physically pick up the resident.

Required evidence for acceptance:

- The journey cannot grant materials/gas/heat/charge, teleport crew, force jobs, rewrite saved state or disable hazards. Record crew IDs, ticks, costs, owners, room conditions, consumption and actual recovery.
- Reload during reserved loading, carried freight, loaded flight, partial unloading, local building, unattended residence and pickup/return. Rejected corrupt/wrong-site/duplicate-roster states leave the input save untouched. Older36 mission cargo, service fuel, held loads and RNG remain intact after deliberate migration.
- Conservation cases cover every owner once, reservation cancellation, food age/item identity, full stores, destroyed dock, dead carrier and competing local/shuttle pickups. Gas/water/heat/electrical ledgers remain their own checks.
- Repeat normal accepted two-person salvage/refit journey and current utility/care regressions. The complete test suite must pass after integration; previous 775-test acceptance does not count as outpost acceptance.
- Browser proof shows remote Build stays remote, real workers move supplies, named resident remains after departure, local status is accurate, offscreen shortage is discoverable, resupply/pickup works, and map-first navigation/forms/held clicks remain usable with no scoped app errors.

**Handoff:** phase-one schema/ownership foundation is implemented and verified within the documented scope. The complete staffed-outpost proposal remains unimplemented. Open design choices are exact return/pickup validation, establishment/readiness prerequisites, action contracts and the measured bootstrap/resupply budget. Root selected durable shuttle freight, dock imports, separate resident/return rosters and no voluntary empty return as the proposed direction. Root owns integration, verification status, memory and implementation assignments.
