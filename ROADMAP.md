# SPACEFORTRESS roadmap

**Version: v0.1.1 · Save schema: 37.** SPACEFORTRESS is an early playable colony simulator growing from a planetary foothold into orbit and farther space. This roadmap orders the next playable increments; it promises no dates.

See the [README](README.md) to play, [verification status](docs/verification-status.md) for evidence and limits, and the [180-system conversion inventory](docs/conversion-inventory.md) for the wider backlog. Completing a milestone below does not complete an entire inventory family or establish full Dwarf Fortress parity.

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

**Staffed outposts are not yet playable.** This foundation exposes no player freight or settlement actions. Remote build authorization, resident care and an ordinary supplied resupply journey remain unfinished. The [outpost design](docs/staffed-orbital-outpost-design.md) distinguishes the implemented foundation from those proposed systems; the [verification record](docs/verification-status.md) scopes the accepted tests.

## Next playable milestones — planned, in order

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

### 5. Connected local vertical decks

Implement the [local-level design](docs/vertical-slice-design.md): two decks in one settlement, constructed connections, level selection and complete spatial references. Local height and orbital travel remain separate systems.

**Acceptance:** crew carry materials between decks, commission a second compartment and respond to a blocked connection or utility failure. Pathfinding, jobs, atmosphere, liquids, power, care and recordings respect their appropriate vertical connections. Migration preserves the existing floor without granting gas, heat or stock; both decks continue simulating when one is hidden.

### 6. Seeded planets and a wider universe

Expand the [upward/outward progression](docs/orbital-progression.md) into generated destinations, persistent planetary identities, multiple settlements per planet, resource bodies and varied debris/solar hazards.

**Acceptance:** the same seed reproduces the same region and its finite opportunities. Survey information supports a meaningful destination choice. Travel consumes real supplies; revisiting preserves depletion, construction and occupants. Creating another settlement does not regenerate existing stores or reset its history.

### 7. Materials, tools and deeper production

Introduce reusable material properties, distinct manufactured items and tools, then expand recipes, equipment condition and repair around them. Track the remaining industry families in the [conversion inventory](docs/conversion-inventory.md).

**Acceptance:** at least one complete extraction-to-tool production chain makes material choice and tool condition affect real work or failure. Items retain identity and properties through manufacture, transport, use, repair and saves. Required inputs and labor cannot be bypassed by an abstract global stock total.

### 8. Persistent history, factions and broader society

Build connected histories, populations, trade and faction relationships on persistent sites and physical logistics. Expand ecology, culture, institutions and threats in bounded slices from the conversion inventory; direct-character adventures remain later scope.

**Acceptance:** a small faction/trade encounter produces lasting consequences for supplies, relationships and recorded world history across travel and reload. Later systems must interact with that history and the colony economy. Background text alone does not satisfy these milestones.

## Standards across every milestone

- Keep the map prominent, controls compact and details hidden until needed. Extend original alien art and readable equipment states with the simulation.
- Preserve finite ownership and deterministic saves. Verify both failure and physical recovery through ordinary play, alongside focused tests.
- Use shared actions, stable entities and named state-change events. Recordings stay optional, bounded and local.
- Keep dependencies small and deliberate; retain offline local play and documented asset provenance.
- Update this roadmap and the evidence index when a playable acceptance passes. The conversion inventory remains the long-term coverage record.
