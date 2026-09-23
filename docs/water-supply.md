# Ice extraction and water supply

Implemented September 16, 2026. Water now has a physical replenishment chain beyond the initial stores:

**Finite ice seam → mining → loose ice → depot → processor input → staffed processing → water output → depot → consuming machinery.**

The [floor water and recovery](floor-water.md) extension connects delivered water to tanks, puddles, pumps, faults and fire. The verified schema35 [closed plumbing](plumbing.md) extension adds another supply path: powered adapters can connect finished water output, storage and recipe inputs through finite pipes. The resource-production rules below remain in use; current acceptance is tracked in [verification status](verification-status.md).

## Reserves and extraction

New colonies have six exposed surface seams southeast of the habitat, at x17–18/y14–16. Each contains 12 ice, for 72 units total. Bare comet ice tiles also have finite 12-unit reserves. Terrain reserves are not inventory and cannot fund recipes or appear as available depot stock.

Use the existing **Extract** designation. Each completed seam order produces up to 6 ice in a pile at that tile and subtracts that amount from the reserve. Cancelling unfinished work leaves the reserve intact. Exhausted seams stay exhausted through saves and revisits. Buildings require extracting the remaining seam first; power cables may cross it.

Comet volatile deposits now yield **12 raw ice and 3 fuel** once, replacing their previous direct-water yield. Bare ice seams offer additional recoverable water without more fuel. All remote output uses the existing finite hold, cargo filters, physical hauling, return boarding and surface unloading. Ice is accepted by new shuttles by default. The comet approach window and expedition hazards still apply.

## Processing and shared demand

| Property | Ice processor |
| --- | --- |
| Construction | 6 alloy + 1 component, 10 work, habitat floor |
| Power | 3 kW from connected wiring |
| Recipe | 2 ice → 2 water |
| Labor | 20 Production work, physical adjacent operator |
| Storage | Existing two-batch input buffer and 12-unit output buffer |
| Orders | Continuous, fixed batch count or shared water stock target |

The processor abstracts melting and filtration into one machine. No starting processor or extracted ice is granted. The recipe needs delivered ice, power, an operator and output space. It does not require a breathable room or impose its own room-temperature range; workers still follow normal suit, recovery and safety rules.

Existing consumption recipes remain unchanged: hydroponics and medical/atmosphere production use water, and nutrient recycling uses a fractional amount. Depot hauling provides their original input path. The plumbing extension adds a finite alternative: an intake collects unclaimed finished water, and an outlet fills the consumer's unreserved desired input capacity. It preserves haulers' pickup/delivery claims and still requires an operator and other ingredients. Stock targets keep counting available and promised output through the normal production system; sealed pipe reserves do not silently become available depot stock.

Power loss, pause, worker recovery and maintenance preserve committed ingredients and progress. Rejected or full depots can prevent ice pickup or leave processed water in output. Full output halts new processing. Dismantling returns unfinished ice and completed water as loose supplies. The machine adds industrial hum, room heat and maintenance demand through existing definitions, and is incompatible with designated living, care and crop rooms.

## Inspection and future agents

The hidden tile inspector shows seam quantity and next extraction yield. The hidden Colony inspector shows depot water, depot ice, remaining surface reserve and intact processor count. These counts describe current stores and structures; they are not an estimate of time until depletion or a guarantee of accessible supply. The main resource bar has no new ice entry.

- Tile `deposit={resource:'ice',remaining}` fields retain their stable tile IDs and use the `geology` change label.
- Each site's observation includes `waterSupply`, labeled `water` in deltas.
- `job.order` handles extraction and construction; existing production, depot, cable and cargo actions handle the rest.
- Definitions expose processor cost/recipe and seam capacity/extraction quantity.
- `resource.extracted` identifies the tile, worker, job, output and remaining seam quantity. `deposit.depleted` marks the last extraction.
- All staffed production now emits `production.batch.started` with committed inputs, alongside the existing completion marker. Small inventory/progress changes remain in structured tick records.

The interface and recordings remain local, optional and independent of saves/RNG. See [simulation interface](simulation-interface.md).

## Saves and verification

Save schema **24** originally introduced this supply system and accepted earlier supported versions. Version 23 migration adds reserves only on eligible unoccupied terrain, skipping structures, piles, cables and designated/reserved job locations. It preserves existing inventories, crew, work progress and depleted reserve records; adds no extracted ice or water; expands only unrestricted depot filters; and enables shuttle ice when the old shuttle accepted water. Selective depot policies and water-excluding shuttle policies stay unchanged. Pending comet volatile orders keep their progress and receive the updated raw-ice yield when completed. Current saves never reseed terrain on load. This describes the original migration, not the current schema number; see verification status.

The original sixteen focused tests cover physical construction, finite extraction/cancellation, depot delivery, processing/operator requirements, power interruption, all four water-consuming recipe families, storage rejection/congestion, stock targets, dismantling, real comet transport, migration with occupied terrain and unfinished extraction, deterministic continuation, malformed reserves/batches, and structured action/event records. This historical coverage does not establish that the later plumbing changes pass integration.

Isolated Firefox verified seam and processor drawings, extraction through a player control, processing, recipe/pause controls, water summary, stable labels, event records and schema-24 save/reload. Screenshots were inspected; no scoped application errors occurred.

## Remaining scope

This extends finite supply; it does not make the colony self-sufficient forever. Supplied water tanks, floor recovery and [closed plumbing/reservoirs](plumbing.md) are implemented and verified in their documented scopes. Renewable collection, wastewater treatment, contamination, drinks/thirst, passive ice melting/sublimation, phase-change heat accounting and generated water geology remain unfinished. Extracted ice is an abstract sealed commodity, with no ambient spoilage. Surface reserve placement and the current comet are authored; generated worlds and broader travel remain part of the full game backlog.
