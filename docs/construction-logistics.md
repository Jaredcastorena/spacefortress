# Construction supplies and colony recovery

Implemented September 16, 2026. This extends the [production and logistics](production-and-logistics.md) system.

## From reservation to completed structure

Construction and repair orders reserve supplies from reachable surface depots, then loose piles. Reservations remain at their source coordinates until a builder or repairer collects them. The resource bar still counts available depot stock; construction inspection also counts loose supplies.

The assigned worker walks to a source, picks up at most six units, and carries them to a position beside the work site. Large orders take multiple trips. Actual building or repair work begins only after the complete bill of materials is delivered. Collection is part of construction/repair duty, so disabling general hauling does not prevent builders supplying their own work.

A blocked route pauses pickup or delivery and is reported in the job/crew inspector. Delivered goods, remaining source reservations, and carried goods are separate inventories. Their sum must equal the order's cost. Total-resource checks count each inventory once.

## Interruptions and cancellation

- Recovery releases the work assignment while preserving the carrier's shipment. Another worker can collect remaining supplies. Work waits for every shipment before starting.
- Turning off construction/repair releases the assignment; goods already carried still reach the site.
- Death leaves a reserved stack at the worker's position for a replacement to retrieve.
- Cancellation restores uncollected supplies to their original depot if it still exists, or a loose pile at the source. Delivered supplies become a pile at the site; wall-repair supplies are placed on open neighboring ground. Carried supplies stay with the worker for ordinary return hauling.
- When no depot exists, an ordinary carrier puts cargo down. Crew remain free to rebuild storage using those supplies.
- Construction cannot be designated over an existing reserved stack. Small purple crates mark reserved supplies on the map; the inspector lists quantities awaiting pickup, in transit, and delivered.

## Losing the last depot

Depot dismantling leaves its contents on the ground. A replacement depot can be built using those supplies directly. Hungry crew can eat accessible loose rations or a ration they are carrying, so loss of storage alone does not prevent recovery. Once storage is rebuilt, haulers collect remaining piles normally.

This is recovery from loss of storage, not a complete colony disaster model. If the colony has no reachable building materials, food, or surviving workers, broader salvage/rescue systems are still needed.

## Persistence

Schema 16 retains delivered job materials, remaining source inventories, and the job reference on carried shipments. Older schemas 1–15 remain supported. A queued legacy job keeps its supplies at the recorded source; a legacy job with work already performed receives its reserved materials at the work site so migration preserves its progress and total resources.

The browser save key remains unchanged. Failed loads preserve the original bytes and block autosave replacement. The original can be exported through the existing file menu. Starting a new colony or importing a valid save explicitly permits replacement; protection is cleared only after storage succeeds. Storage-access errors also pause startup and leave the fallback colony unsaved.

## Verification and limits

The full suite has 252 tests; 16 construction/recovery cases and 3 save-storage cases were added to the prior 43. They check multiple trips before work, cancellation at different stages, exhaustion and duty changes, blocked routes, death, repairs, recovery without depots, local/carried meals, legacy migration, reservation validation, and failed-load preservation. JavaScript syntax checks passed. Inspector controls, crate markers, and the save-recovery UI still need browser interaction/visual verification; the preview remained stopped.

Construction is still one worker per order, with temporary handoffs during recovery. Dedicated construction haulers, team jobs, tools, scaffolding, structural support, build phases, condition-dependent material loss, local vertical construction, and richer scheduling remain unfinished. Atmosphere now stores conserved gas quantities; see [atmosphere](atmosphere.md). Power remains site-wide; connected networks are the next major simulation work.
