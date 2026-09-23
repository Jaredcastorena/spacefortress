# Personal bunks and housing

Implemented September 16, 2026. Housing connects sleeping, room conditions, travel and personal memories.

## Assignment and use

Select a surface bunk, then open **Change assignment** in the hidden inspector. Choose a living crew member or **Communal**. Each person owns at most one bunk; each bunk has at most one owner. Moving someone to another bunk frees their former one. New colonies and migrated colonies start with communal bunks.

Personal bunks stay reserved while owners work, receive medical care or travel. Other crew use communal bunks. Ownership and the temporary sleep claim are shown separately. Reassignment clears incompatible sleep claims immediately without teleporting crew or changing carried supplies. Crew profiles show their home location and any obstruction; compartment inspectors distinguish current occupants from assigned residents, including absent owners.

When exhausted, crew prefer their own safe, reachable bunk, then communal bunks in ready quarters, then other communal bunks. An unavailable home does not prevent recovery: they use another communal bunk, or existing safe floor rest until 50 energy. Bunk rest continues until 85. Critical breathing, temperature, hunger and medical recovery retain their existing precedence.

A bunk with zero condition, unsafe air or temperature, an unreachable route, or a waste-storage designation cannot be used. Damage and temporary unsafe conditions retain ownership, allowing repairs to restore the home. Removing the bunk or the owner's death releases the assignment. Assignments belong to the bunk tile, so splitting/merging rooms preserves them and derives room quality from the current compartment.

## Personal consequences

Assignment alone grants no positive memory. Actually sleeping in one's own bunk produces a +4 memory, or +8 in ready living quarters. Those quarters retain their existing faster rest. Losing a bunk produces −6, explicit reassignment/removal of ownership produces −5, and attempting rest with an obstructed home produces −6. Existing memory cooldowns and expiry apply. Floor sleep retains its ordinary unhappy memories. Crew already sleeping in a communal fallback finish that rest before reconsidering a repaired home.

## Persistence

The schema-21 migration adds `crew.housing={bunk:null}` to version-20 saves. Current schema 22 also adds comfort preferences; see [room comfort](room-comfort.md). An owned bunk uses `[x,y]` on the surface. Versions 1–20 migrate through the existing sequence. Inventories, current sleep claims, jobs and needs are preserved. Validation rejects duplicate ownership, invalid coordinates, missing bunk structures, dead owners and sleep claims conflicting with ownership. Broken or temporarily unsafe bunks remain valid homes.

## Verification and remaining scope

**323 tests pass**, including 15 housing cases: exclusive assignments, actual sleep/memories, room quality, communal access, floor recovery and resumed work, damage/repair, blocked routes, unsafe air, reassignment with cargo, physical dismantling/salvage, death, expedition ownership/residents, deterministic continuation, migration and invalid states.

Isolated Firefox QA verified hidden default drawers, ownership controls, reassignment, communal use, retained open controls through refresh, saved/reloaded ownership and crew housing status. Assignment and crew screenshots were visually inspected; no scoped application errors occurred. The temporary browser/server were stopped afterward.

This implements surface bunk ownership. Initial privacy, machine hum, decorative condition and personal preferences now affect room comfort; see [room comfort](room-comfort.md). Initial portable ownership and crafted quality are implemented in [possessions](possessions.md). Entire-room ownership, shared family bedrooms, sound propagation, ownership of other furniture, automatic housing allocation and staffed remote residences remain unfinished. See [room purposes](room-designations.md) and [crew behavior](crew-simulation.md).
