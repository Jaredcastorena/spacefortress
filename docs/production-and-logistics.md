# Production and physical supplies

Implemented September 16, 2026. This is an initial production system, with important remaining abstractions listed below.

## Resource ownership

Depots own their stored supplies. Each production machine owns an input buffer, the raw inputs committed to its active batch, and an output buffer. Loose piles, crew cargo, reserved construction costs, and expedition cargo have separate owners.

The resource bar shows **available depot stock**, not all materials in existence. Unloaded salvage, ingredients inside a machine, and finished output awaiting collection cannot be spent from the bar. `totalResources()` accounts for all owners for conservation checks; it is not the spending interface.

## Recipes

| Machine | Delivered inputs | Output | Operator work required |
| --- | --- | --- | --- |
| Refinery | 1 ore | 2 alloy | 20 work |
| Hydroponics | 1 water + 0.25 fertilizer | 2 food | 30 work; breathable compartment |
| Nutrient recycler | 1 waste + 0.25 water | 0.25 fertilizer | 25 work |
| Parts fabricator | 3 alloy | 1 component | 45 work |
| Atmosphere processor | 1 water | 10 breathing mix | 25 work |
| Medical synthesizer | 1 food + 1 water | 2 medicine | 40 work; breathable compartment |

Life support is a continuous service: it recycles exhaled gas while powered and draws make-up mix from a delivered input buffer. See [atmosphere](atmosphere.md).

One tick is one simulation second at normal speed. Staffed machines require an adjacent Production worker; skill and recovery affect elapsed time. See [production orders](production-orders.md) for fixed batches, stock targets, priorities and operator handoffs. Machines request up to two batches of inputs, bounded by their order. Output capacity is 12 units. Power loss, insufficient atmosphere, damage to zero condition, a player pause, or a full output buffer stops processing. An active batch retains its ingredients and progress. A paused machine releases its power demand; other idle machines still draw their rated power.

The fabricator costs 8 alloy and 2 components and draws 4 kW. This introduces a choice between spending starting/recovered parts directly and investing them in further production. Definitions and timing are prototype balancing choices.

See [nutrient recycling](nutrient-recycling.md) for meal waste, supplied crops, starter balance and legacy crop migration.

## Crew logistics

Crew with hauling enabled reserve a pickup, walk to it, carry at most six units, and walk to the destination. Pickup and destination reservations prevent duplicate collection and excessive input deliveries. Recovery can interrupt a shipment without deleting it. Disabling hauling cancels uncollected assignments; already carried goods are delivered after recovery.

Idle haulers select destinations by hauling priority, with machine supplies first at equal priority. Depots have finite capacity, resource filters and restocking priorities; see [depot storage](depot-storage.md). Both legs require a route. A later blocked route causes held cargo to seek another depot, or be placed locally if none can accept it. Demolishing a destination redirects held cargo to reachable storage. A replacement machine with a different recipe cannot accept incompatible inputs. A dying carrier leaves a pile at their position.

Demolition spills stored supplies, machine inputs, unfinished raw batches, and output onto the tile, along with recoverable structural material. Returning expeditions unload a pile beside the surface shuttle; crew must bring it to a depot. The radio encounter's fuel cache also needs hauling.

Meals consume food at a reachable depot or loose pile, or a ration the crew member is carrying. Tibbles must reach a pile, depot, or machine output containing food. A trap draws bait from a nearby depot connected by a walkable route.

## Inspection and saves

Select a depot or machine to see its contents in the existing hidden inspector. Machines show their recipe, batch progress, current obstruction, and a pause/resume button. Crew inspection shows carried goods. Crates mark finished output and carried shipments on the map.

Save schema 20 stores inventories, batches, pickup intentions, destinations, and construction reservation origins. Versions 1 and 2 migrate their old global pool into an existing depot exactly once, or a loose pile if no depot exists. Reserved job costs and expedition cargo remain separate. Older oversized carried stacks become local piles. Schema 3 construction orders also migrate without losing their reserved costs or prior work. See [construction and recovery](construction-logistics.md) for shipment ownership and failed-load preservation. The browser storage key is unchanged.

## Verification and remaining work

The 308-test suite includes 16 production/logistics tests: staged input/output transport, disconnected routes, interrupted batches, full output, atmosphere loss, pause/resume, recovery during transport, demolition, replacement destinations, local pest feeding, ore-to-components-to-construction, save migration, validation, bounded input reservations, and carrier death. Source syntax checks passed. The staffed production inspector, order editor, priorities, pause/resume, saved values and Production duty toggle were checked in an isolated headless Firefox session. Broader historical UI checks remain incomplete; the temporary preview was stopped.

Remaining abstractions:

- Construction now reserves located supplies and physically delivers them before work. Dedicated construction haulers, collaborative jobs, tools, and structural support are still missing; see [construction logistics](construction-logistics.md).
- Shuttle supplies now need loading jobs into persistent service stores and crew boarding before departure; see [departure preparation](departure-preparation.md). Signal decoding, traps and battery-cell use still deduct from eligible depots immediately. Bait placement and cell installation need crew jobs.
- Orbital extraction now creates local piles; limited shipments must reach the dock before entering the finite hold. See [expedition logistics](expedition-logistics.md).
- Depot capacity, filters and destination priorities are implemented. Food lots, refrigeration, spoilage and replacement deliveries are implemented; see [food preservation](food-preservation.md). Ownership, richer storage conditions and per-resource quotas remain unfinished. Loose materials can fund a replacement depot, and crew can eat loose rations.
- Hauling follows destination priorities and route distance. Long construction queues still take precedence; dedicated hauling assignments remain unfinished.
- Staffed machines and work orders are implemented. Tools, byproducts, quality, recipe queues and additional recipes remain unimplemented. Operating wear and supplied maintenance are already implemented; see [maintenance](maintenance-and-hazards.md).
- Atmosphere now uses conserved gas quantities and supplied life support. Power uses connected circuits and per-bank storage; see [power networks](power-networks.md).
