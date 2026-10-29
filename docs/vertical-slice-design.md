# First playable local levels

Status: **spatial primitives, horizontal position routing, primary deck-zero state, named shipment, crew care, animal ownership, airlock locations and horizontal room gas/heat, electrical, fluid, hazard, room-purpose and ecology isolation implemented; paid stairs, floor presentation and utility connections implemented; full upstairs living acceptance remains incomplete**. Updated October 27, 2026 for hex save schema60. [spatial.js](../src/spatial.js) provides deck lookup and six horizontal neighbors. Saves declare one landing deck, empty `verticalLinks` and explicit z=0 on tiles, crew, jobs, creatures and material sources. Shipment, need, medical, home-bunk, personal-pickup and animal-post targets are explicit positions. Airlock equipment and reservations also carry full positions; chamber cell keys include z. Carcass tile owners and all derived carcass positions retain z; carried/staged owner records stay ID-only. Schema52 gives every room an explicit deck; its local x/y cell list is scoped by that deck. Schema53 adds debris and damage-history positions. Schema54 adds room-purpose anchor decks and converts room membership, waste/comfort, shelter goals and outpost readings. Schemas40–53 migrate only named fields. [Other references and consumers](spatial-location-inventory.md) still need conversion before a second deck. Observation/recording schema9 also gives pasture regions explicit decks and full-position cells. Pasture boundaries, births, grazing, pest food searches and trap payments are deck-scoped. Ground IDs stay unchanged; converted room, utility and hazard records distinguish decks. Twenty-eight actions accept optional z, including basic supplied construction. Explicit crew walking stays within the current declared floor; Upper airlocks now operate on declared floors; other unsupported work families remain gated.

The user confirmed isometric sprites and upward/outward progression from a planet into orbit and farther space. Paid stairs, declared floors and utility connections below are implemented; remaining acceptance and unsupported systems are explicitly identified. The named orbital bands in [orbital progression](orbital-progression.md) remain proposals too.

## Playable result

A builder carries material from the existing surface depot, constructs a stair connection, climbs it, and builds an upper habitat with a working machine. Supplies reach that machine through physical hauling. Crew can eat, sleep, recover and receive treatment on either deck. Opening the stair hatch exchanges room gas and smoke; an upstairs spill can reach a live downstairs cable. Closing the hatch contains the opening, and isolating a utility riser separates its network. Changing the viewed level never changes these outcomes.

Both decks belong to the same settlement. They keep simulating together. Reaching a wreck, comet or solar site still requires the existing expedition route, crew and supplies. No local stair or level-selector action reaches orbit. Later orbital sites can reuse this same deck model.

## Evidence that determines the implementation

| Existing interface | Current assumption and required change |
| --- | --- |
| [simulation.js](../src/simulation.js), `createSite`, `at`, `inside`, `order`, `deserialize` | One dense `size × size` tile array per site. Validation fixes surface size to 26 and other sites to 18. Orders and occupancy identify a tile with site/x/y. |
| [navigation.js](../src/navigation.js), `pathTo`, `animalPath` | The horizontal BFS and crew planner use x/y/z keys and explicit positions through `pathToPosition`, `animalPathToPosition` and `planCrewRoutePositions`. Walking/crossing segments, destinations and traversal queries retain z. Legacy pair command callers and controller execution stay restricted to deck zero; vertical edges and remaining caller conversion are pending. |
| [atmosphere.js](../src/atmosphere.js), `updateRooms`, `roomAt`, `moveCrew` | Rooms have an explicit z and local `x,y` cell keys. Horizontal remapping and gas/heat links distinguish decks; doors connect reservoirs on their own deck. Vertical opening links remain pending. Movement and door opening already share one function, which is a useful integration point. |
| [construction.js](../src/construction.js), [industry.js](../src/industry.js), [inventory.js](../src/inventory.js) | Schema48 sources, pickups and deliveries retain x/y/z; physical shipment lookups, cancellation and spoilage use those positions. Availability, incoming/outgoing claims and depot capacity distinguish decks. Material source planning, assignment, physical collection/delivery and completion now preserve the job floor; cancellation refunds the actual owners. Crew walking is horizontal only. Vertical connections and other upper work types remain pending. |
| [power.js](../src/power.js), [gas-networks.js](../src/gas-networks.js), [liquids.js](../src/liquids.js) | Electrical topology and breaker branches now distinguish decks and preserve ground IDs. Gas-pipe, plumbing and horizontal floor-liquid topology also retain deck ownership. Vertical connections, remaining location consumers and command/presentation conversion still gate additional playable floors. |
| [medicine.js](../src/medicine.js), [nursing.js](../src/nursing.js), [housing.js](../src/housing.js) | Saved care/need/bunk/personal pickup targets retain x/y/z. Claims, physical lookups and routes distinguish positions; rescues carry patient z. Home claims remain surface-owned during travel. Room/air/temperature safety still explicitly restricts care to ground until environmental conversion. |
| [render.js](../src/render.js), [app.js](../src/app.js) | Renderer projects x/y and draws every tile in the site; crew, jobs, selection and hit testing have no level filter. |
| [controls.js](../src/controls.js), [telemetry.js](../src/telemetry.js) | Twenty-eight equipment/colony/basic-construction actions accept optional z with declared-cell validation; other upper work, airlock and crew actions remain gated. Ground tile IDs remain `tile:site:x:y`, with a z suffix for converted upper identities. Recording schema9 covers shipment, crew, animal, airlock, room, purpose, hazard and pasture locations; other work families, airlock/crew actions and remaining event identities still require conversion. |

## Representation and shared spatial contract

The canonical state retains **one `site.tiles` array**, addressed in the order declared by `site.levels`. Schema47 allows only `levels: [{z: 0, name: 'Landing deck'}]` and an empty `verticalLinks` array. Schema55 implements the first expansion: completing a paid upper stair adds metadata for z=1 and empty tiles, up to8 contiguous levels. Each tile stores its integer x/y/z. Keeping a single collection lets physical inventory totals and whole-site updates visit every tile exactly once.

The implemented `src/spatial.js` imports only pure hex mathematics from `src/hex.js`, with no simulation-system dependency:

- `tileAt(site, position)`, `inside(site, position)`, `cellKey(position)`, `sameCell(a, b)` and `tilesOnLevel(site, z)`.
- A position is `{x, y, z}` within a known site. Cross-site references also contain `site`.
- `horizontalNeighbors(position)` returns six odd-q hex cells on the same z. It never adds vertical neighbors implicitly.
- `cellKey` encodes all three coordinates. Dense indexing uses the declared level's array offset, not `z * size²`; this leaves room for negative or nonconsecutive level identifiers later.
- New internal calls require explicit z. Compatibility wrappers may translate old public calls that omit z to **z=0**, never to the currently viewed level. Temporary wrappers must not remain on new internal paths.

Use position objects for newly converted path goals, returned steps, job sources, delivery targets, bunks, medical beds, animal posts and room-designation anchors. Migration translates the old coordinate arrays deliberately. Do not recursively append zero to arbitrary arrays: gas values, inventories, skills and other tuples are unrelated data.

Horizontal routing already validates declared cells, preserves six-edge order, distinguishes identical x/y on different decks and permits evacuation from a blocked origin. Declared stairwell records now add explicit crew edges; paid construction and canonical save admission are implemented in schema55. Compatibility `pathTo`/`animalPath` adapters preserve pair results only at z=0; explicit nonzero actors and three-element tuples are rejected. Crew execution now accepts explicit positions within the actor’s declared floor; legacy pairs still mean ground. Animals now use explicit stair edges and floor-aware posts; upper airlock controllers remain restricted. The stairwell core rechecks link condition, hatch mode and both landings before a physical crew step. Crew execution now consumes position-valued plans and queries. Schema51 persists full airlock configuration and queued/party/traveler destinations. Configure commands and existing room topology retain explicit ground-only boundaries; observation5 exposes the new shapes while existing ground controller IDs remain unchanged. Ground controllers do not create barriers or crossing edges on another deck; unsupported upper controller schemas refuse planning. Existing pressure/door permits still govern every actual step. These guards do not certify every direct position assignment or turn a planned route into permission to move.

All equality, reservation and distance tests must use the same spatial helpers. `cellKey`/`sameCell` are local to a known site; `locationKey`/`sameLocation` include site identity. Hex distance on one deck is only a ranking hint for a future cross-deck route, which must prove that a usable connection exists. Site-wide aggregates stay site-wide. A deck filter belongs only in a view or a rule that explicitly applies to one deck.

### IDs and recordings

Use `tile:<site>:<x>:<y>:<z>` and a location-independent allocated ID such as `vertical-<nextId>` for a constructed connection. Crew, jobs, fires, item identities and existing allocated IDs remain unchanged. Room observation keys use a full x/y/z anchor; they still describe the current compartment topology and may change on a split or merge. They are not permanent historical room identities.

Increment the telemetry schema when changing tile IDs and coordinate shapes. Keep previous exported recordings in their original schema. Reconstruction must dispatch by schema, and tools must not silently compare old four-part tile IDs with new five-part IDs. Shared actions accept explicit z; the documented legacy omission means ground deck only. Observations expose level, connection endpoints, connection condition, hatch mode and derived movement/gas/water/utility availability separately.

Named events include `vertical.constructed`, `vertical.hatch.changed`, `vertical.traversed`, `vertical.blocked` on a new blockage transition, `vertical.repaired` and `vertical.removed`. A traversal records actor, connection, full source/destination tile IDs, and any carried patient or escorted animal. Existing gas/water transfer events carry full endpoint IDs. Rendering alone emits no gameplay event and consumes no RNG.

## A physical stairwell and hatch

Implemented locally October27: paid repair (1 alloy/8 work), paid sealing/removal (1 alloy/12 work, refund3 alloy), endpoint claims and connection-owned schema56 jobs. Occupied closure and removal that strands upstairs crew block without consuming supplies. Both floor tiles remain. Shared damage feeds route warnings and exposed upper landings enter debris forecasts. Alternate stair routes permit safe removal. Animal traversal and finite utility risers are now implemented in separate shared systems.

The connection core is implemented in [vertical.js](../src/vertical.js). A record has `{id, kind: "stairwell", lower: {x,y,z}, upper: {x,y,z}, hp, mode, openUntil}`; both landing tiles carry its `verticalLink` ID. Endpoints share x/y and differ by exactly one z. Walking requires condition at least50 and a hatch not set closed; auto passage opens for3 atmosphere ticks. A condition below50 leaves an environmental opening but disables walking. The core neither creates landings nor grants resources. Schema55 validates these records and both landing references. Paid construction now spends6 alloy and1 component through12 work; extending upper floor requires support below. Repair/removal, animal traversal and floor presentation are implemented. The full ordinary upstairs build-and-live acceptance remains unfinished.

Crew routing/movement, carried patients/cargo, hatch controls and finite gas/smoke/heat/downward-water links are connected to this record. One synthetic declared-link scenario completes a cross-floor input/production/output journey. A separate paid-stair check now verifies bootstrap, material custody, supported extension and deterministic reload. The complete build-and-live acceptance below still needs the browser selector and remaining vertical systems.

Use a manually operated enclosed stairwell for the first connection. It supports ordinary crew, their carried supplies and rescue stretchers without requiring electrical power. This avoids introducing an elevator simulation before there is a usable second floor. The exact material/work values should be balanced during implementation, but they must be declared in the construction catalog and fully paid through the existing reservation/delivery system.

One canonical `site.verticalLinks` record owns the connection and hatch. Two landing tiles reference its ID; they do not each own independent copies of its condition or mode. Endpoints share x/y and have adjacent z values. The first construction command targets a lower habitat floor and the cell directly above it. Its paid work includes the upper landing and hatch. A builder works from the reachable lower deck; the job cannot require reaching the as-yet-unbuilt upper landing. Construction claims both endpoints to prevent conflicting orders.

The upper deck starts empty and unpressurized. Creating its empty grid grants no material, machines, stored gas, water or energy. Extending an upper floor requires delivered floor material, a reachable adjacent work cell on that upper deck and a supporting habitat floor/wall immediately below. This is an explicit initial support rule; load capacity, collapse and arbitrary cantilevers remain later work. Stair construction is the only bootstrap exception to the reachable-upper-work-cell rule.

Existing habitat floor behavior includes a sealed ceiling. Creating a level above it does not puncture every old room. Only an explicit vertical opening connects the decks. Upper floor construction creates room volume with no free gas. Ordinary walls and doors can then enclose that floor under the current habitat abstraction.

The hatch has `auto`, `open` and `closed` modes consistent with pressure doors. One vertical move consumes a normal movement opportunity and atomically changes z at the two adjacent landings; injury and rescue carrying still slow movement. Recheck both endpoints and the link immediately before moving. Auto mode opens for a finite tick window. Closed or unusable stairs remove the walking edge. A broken hatch remains an environmental opening even when the damaged stair is unsafe to traverse.

Carried patients and escorted animals move with their owner in the same operation. Ordinary animal roaming uses the same connection graph with species/passability rules; a closed hatch contains tibbles too. Pasture connectivity includes usable vertical edges, so an open stair cannot falsely leave an enclosure marked secure. No creature, care task or job can interact through a closed ceiling just because x/y matches.

Repair and removal are paid physical jobs with endpoint claims. Removal must close and make good the penetration as part of its declared work before deleting the connection; it leaves the paid upper landing floor in place. If safe closure is impossible because an endpoint is occupied, show that blockage and retain all state. No deletion may silently discard a carried inventory or move an actor to another deck. Damaged stairs can strand crew; the UI identifies the inaccessible crew and repair route rather than teleporting them to safety.

## Different systems need different vertical edges

Keep room reservoirs on individual decks, joined by explicit links. A multi-deck opening should not merge gas ownership, room purpose or thermal storage merely because crew can climb through it.

| System | Proposed first-slice rule |
| --- | --- |
| Crew and animals | Horizontal passable cells plus commissioned, traversable stair connections. BFS can retain equal-cost edges initially; all route callers receive complete positions. |
| Room gas and smoke | An open/damaged hatch adds one finite-conductance link between endpoint rooms, or to exterior if an endpoint has no room. Reuse snapshot-based atmosphere flow, including composition diffusion and smoke transport. Closed healthy hatch stops this link. Transfer within the site is not exterior loss. |
| Heat | The same open connection supplies a room-to-room thermal link under the existing thermal model. Preserve thermal ledgers. Do not claim buoyancy or temperature-coupled gas pressure. |
| Floor water | An open hatch permits finite flow from upper landing to lower landing, before horizontal leveling. Bound by source quantity, a declared per-tick rate and lower-cell capacity. A full lower landing retains water upstairs. No upward gravity flow. Closed healthy hatch stops it. |
| Electrical circuits | Horizontal isolation is implemented: matching x/y cables on different decks remain separate. A paid cable riser adds one vertical conducting edge. Enabled, intact endpoints are required. Hatch mode does not toggle this sealed utility penetration. |
| Stored gas networks | A paid gas riser links the two actual gas nodes. Both ports/valves and damage rules apply; pressure/mixing transfers preserve each gas species and retained smoke. A stair alone is not a gas pipe. |
| Plumbing | Horizontal plumbing isolation is implemented. Paid water risers now equalize finite pipe contents across their explicit endpoints, capped at0.5 units per edge per tick. Floor water has no hidden pipe or teleporting pump connection. |
| Fire | Existing same-room fire/smoke behavior continues. Smoke crosses an open hatch through atmosphere flow. Flame spread between decks, falling objects and collapse are separate future rules; do not imply they are already simulated. |

Vertical risers use shared construction, repair, removal and instrumentation rules. They do not need separate broad UI menus: build options live in the existing hidden construction drawer, with endpoints highlighted during placement. Utility connections must reject mismatched sites, nonadjacent levels, absent nodes and duplicate edges.

The surface site's gravity and exterior temperature remain site properties at both local levels; deck 1 is not orbital vacuum merely because its z is positive. The current atmosphere system treats an exposed habitat opening as a gas sink; retain that documented approximation until exterior atmospheres are modeled. Solar exposure now uses deterministic column occlusion: higher terrain or intact structures block a panel, while void and bare utility overlays remain transparent. Player and agent diagnostics identify the nearest blocking floor. Schema59 validates historical power before recalculation and preserves stored energy. Radiator exterior rules remain a separate concern; no orbital-lighting or radiation model is implied.

## Minimal interface

Implemented locally October27: compact installed-floor menu, Page Up/Down, explicit map picking and inspector/control targets, crew following, stair symbols/hatch controls, floor-qualified hazards and held-click invalidation. Focused checks establish these paths; full vertical acceptance below remains incomplete.

Show a compact current-level chip beside the site name. Clicking opens the short level list, with an existing keyboard shortcut pattern for up/down. Only installed/explored local levels are selectable. A ghost upper landing appears when placing stairs; it is not a pretense that an unbuilt deck is occupied.

`app.js` keeps `viewZ` separately from simulation state and site travel state. `Renderer.draw` receives the viewed level and draws its tiles, crew, creatures, jobs, reservations and utility overlays. Hit testing returns that level explicitly. Optional faint lower-deck outlines are visual context only and cannot intercept clicks. Inspection shows `x / y / z`, and selecting a crew member switches to that crew member's actual deck. Clearing selection or changing level cannot leave an old inspector action aimed at the same x/y on a different deck. Preserve the current held-click and focused-input guards.

Offscreen decks continue updating. Warnings identify the deck; clicking a warning navigates the view. Whole-site power/storage summaries remain whole-site summaries and are labeled accordingly. Merely looking upstairs cannot spawn terrain, reroute gas or move crew.

## Implementation pipeline and file ownership

Do this after the current exhaust work and any other chosen prerequisite have a settled, accepted baseline. Allocate the next save version then; this proposal does not reserve schema 35 or modify the active schema.

1. **Spatial foundation (started):** spatial primitives and the legacy lookup facade are implemented. Add canonical levels/positions and explicit location migration next. Convert single-deck callers while every site still has only z=0. Demonstrate equivalent deterministic behavior before allowing a second deck. This is an enabling stage, not the delivered vertical feature.
2. **Connected simulation:** implement constructed stairs, true routing, cross-deck hauling/care, environmental links and utility risers. Add playable upper construction, not just a fixture or selector.
3. **Presentation and acceptance:** enable the level selector, deck artwork, placement preview and new-game guidance once the two-deck simulation is usable. Run the full acceptance loop below with actual controls and saved state.

Parallel workers can own the following bounded groups after the spatial API is agreed:

| Owner area | Principal files and integration boundary |
| --- | --- |
| Spatial/schema | New `spatial.js`, new `vertical.js`; `data.js` and `simulation.js` coordination, including all location validation and migration. One owner alone edits the central simulation file. |
| Movement and physical work | `navigation.js`, `construction.js`, `industry.js`, `inventory.js`, `storage.js`, `production.js`; report central `act`/assignment changes to its owner. |
| Crew life and care | `medicine.js`, `nursing.js`, `hygiene.js`, `housing.js`, `crew-life.js`, `possessions.js`, `sanitation.js`; inspect all target/adjacency claims. |
| Environment | `atmosphere.js`, `thermal.js`, `fire.js`, `liquids.js`, `gas-networks.js`, `reactors.js`; partition by system only after agreeing connection enumeration and tick order. |
| Power | `power.js`, maintenance/debris location handling; share the riser contract with environment and core owners. |
| Animals and expeditions | `pastures.js`, `husbandry.js`, `breeding.js`, `animal-transport.js`, `expedition.js`, `preflight.js`; preserve dock level, escorted identities and transit semantics. |
| Interface and instrumentation | `render.js`, `app.js`, affected `*-panels.js`, `controls.js`, `telemetry.js`; split UI from controls only with explicit ownership. |
| Independent verification | New focused spatial/vertical tests, migration fixtures, conservation checks and browser scenario. Test ownership is separate from source fixes. |

Every module using direct `tiles[y * size + x]`, a two-coordinate string/array, x/y-only equality or a site-fixed location needs an audited replacement. This includes room roles, food temperature, items, fire suppression, rescue, shuttle boarding and event targets. A successful BFS test does not prove this audit is complete.

## Migration and acceptance gates

Migration adds z=0 to the existing world and every *located* reference: tiles, actors, jobs, sources, deliveries, intentions, beds, bunks, posts, designations, debris targets and dock references. It preserves inventories and lots, RNG, room gas/heat/smoke, water, power charge, network contents, pending work and mission state. It adds an empty connection list and only the existing ground level. It must not call fresh-colony gas filling, cable seeding or resource initialization. Existing rooms get equivalent 3D cell keys without topology redistribution. Reject inconsistent level lengths, duplicate coordinates, invalid endpoints and incomplete locations in current-version saves.

| Acceptance case | Required evidence |
| --- | --- |
| Same x/y on two levels | Separate tile IDs, jobs, bunk/bed/post claims, inventories, room roles, power and gas nodes. No read or action touches the other level accidentally. |
| Physical build-and-live loop | Through shared controls: pay for stairs, deliver materials from below, build upstairs floor/walls, haul input to an upstairs machine, make output, eat/sleep upstairs and return below. A disconnected upper job remains blocked without consuming phantom supplies. |
| Interrupted movement | Close or damage the only link during a pending trip; no teleport, clipped route, duplicate material or stale successful action. Repair restores a route. Test slowed walking, a carried patient and animal escort. |
| Care and emergencies | Fetch food/medicine across decks; rescue an upstairs patient to a downstairs cot; block that route and retain honest ownership/status. Upstairs fire selects the correct suppression target. |
| Atmosphere and thermal | Independently verify closed separation, finite open exchange, equal-pressure composition mixing, dirty smoke return, explicit exterior loss and conservation of all represented gas/smoke/heat stores. |
| Water/electric cascade | Release finite water upstairs, open hatch, observe downward transfer and a downstairs wet cable fault; close hatch or isolate the circuit through player/agent controls. No negative or excess liquid. |
| Utility separation | Overlapping cable/pipe coordinates alone transfer nothing. Paid risers connect only intended endpoints; valves, isolation, damage, capacity and power remain effective. |
| Save and replay | Migrate a busy accepted-baseline save; compare preserved quantities, ownership and RNG. Save/reload mid-delivery and after hatch closure; continuation matches. New recordings reconstruct full positions; recording/view changes do not change simulation or RNG. |
| Browser play | Two visibly distinct levels; hidden selector; no wrong-deck click/held-click; crew inspection follows z; offscreen simulation progresses; reload preserves actual construction and controls. |
| Regression and scope | Full existing suite, meaningful new system tests, source-location audit and a bounded two-deck timing comparison. State measured slowdown and remaining limits; do not equate passing tests with completed universe generation or the full game. |

The first implementation gate is the agreed spatial contract and exhaustive location inventory. The delivery gate is the actual build-and-live loop with environmental consequences. A view-only selector, two isolated maps, or manual test-state teleportation does not satisfy this slice.

## Animal floor checkpoint

Livestock can now walk or be escorted through usable stairs to upper-floor posts. Ordinary animal movement respects closed or damaged stairs, fences and pressure doors; handlers retain their existing escort access. Pasture regions follow actual stair connections, and automatic hatches open during crossing.

Feeding, medicine delivery, product collection, slaughter, carcass handling and their events retain the actual floor. Births can use clear constructed floors; corpses age at their actual position. Stair dismantling protects upstairs animals as well as crew. Assignment, escort and butchery buttons identify the destination floor and use the same commands as local agents.

Save schema58 admits validated animal positions and migrates genuine schema57 without changing physical state. Nine new scenarios and203 existing cases are covered, with five final affected checks passing after two obsolete ground-only expectations were updated. The final79-case movement/husbandry gate passed, including free roaming on constructed floors. These are bounded fixtures with paid stairs, upper floors and a husbandry post; they do not establish ordinary colony endurance.


## Upper-floor airlock checkpoint

Airlock controllers can now be built through normal paid jobs on declared upper floors. The six airlock commands accept optional z; their X/Y equipment references use the controller’s floor. Ownership, queue/cycle state, rescue parties, cargo, movement, event IDs and inspection retain that floor. Approaches can use declared stairs. Each assembly remains on one floor, with two controlled doors and a finite isolated gas circuit.

An exposed upper walkway must have low measured pressure before outer release. A stair opening in the chamber or a gas riser attached to its owned circuit invalidates the enclosure, including a disabled riser that could later open. Power risers remain independent. Upper-floor airlocks do not establish ordinary upstairs endurance.

Twelve new scenarios and 144 distinct compatibility cases are covered. The first 101-case gate had one obsolete missing-room expectation; the second 62-case gate found a coordinate-default bug in the bypass check. After correcting those, the final 32-case affected gate passed. Genuine schema59 in-flight migration preserves physical state, and schema60 persists upper assemblies. Pressure-cycle fixtures are synthetic with finite initial supplies; a separate scenario builds an upper controller through real delivered work. No full-suite or ordinary endurance rerun was performed.
