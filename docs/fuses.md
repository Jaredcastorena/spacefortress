# Disposable electrical fuses

Local development after v0.1.12, colony save schema74. [Power routing and breaker overloads](breaker-overloads.md) describe the shared allocation model.

Build a fuse box on a clear habitat floor without a cable overlay. It costs **2 alloy, 1 component and 6 work**, including its first cartridge, and starts open. Only its input and output terminals conduct. Side neighbors do not connect; bypass cables and batteries beyond the fuse can still supply the branch.

Select the box to choose its output direction and **4/8/16/32 kW** rating, then close the switch. Open the switch before changing direction or rating. The effective rating is the selected rating multiplied by the box's condition. Flow equal to the effective rating is safe; excessive planned net flow blows the cartridge on the first advancing tick.

The same finite routes measure load delivery, battery charging and reverse discharge. All due fuses and breakers open in batches and the allocator replans before committing any energy, fuel or wet-fault effects. Breakers retain their three-tick delay and one counter snapshot. A preview cannot blow a fuse or advance its measurements. The model has no sub-tick arcs, resistive losses or I²t heating.

## Replacing a cartridge

After an overload, lower the load or select an appropriate rating. Open the fuse switch, then order **Replace fuse** in its inspector. A crew member reserves and carries **1 alloy** and performs **3 engineering work**. An engineering kit can assist through the existing tool rules. The box must be intact, blown, switched open and free of fire to order replacement.

Completion checks those conditions again. If the target is no longer eligible, ordinary cancellation returns held supplies. Cancelling a pending order also returns its material through existing construction custody. Work can occur on declared upper floors through normal crew routes and deliveries.

A completed replacement clears the blown state and stays open. It preserves box condition. Ordinary repair restores condition and preserves the spent cartridge; repairing a blown box cannot restart it. Neither replacement nor repair teleports supplies.

The original build consists of a **1-alloy, 1-component frame** plus a **1-alloy cartridge**. Normal rounded half-cost demolition returns 1 alloy for an intact or replaced fuse, and zero for a blown fuse. A spent cartridge never contributes salvage. There is no separate reusable cartridge stock item.

## Shared commands and observations

- `power.fuse`: `site`, `x`, `y`, optional `z` (default0), `enabled`, `direction`, `rating`.
- `job.order` with `kind: "replaceFuse"`: uses the same designation, labor, material and cancellation path as other supplied work.
- `power.fuse.changed`, `power.fuse.blown` and `power.fuse.replaced`: typed events with canonical tile IDs. Blow events include attempted throughput and effective rating; replacement identifies the worker, job and consumed material.
- `derived.electrical`: contact state, circuits, bypass/local-source advisories, rating, planned and last delivered flow, measurement tick and predicted blow. Extra details remain collapsed in the inspector.

Schema74 adds strict fuse state and paid replacement jobs. Validated schemas40–73 migrate without adding fuses or changing breaker settings. Older versions cannot contain fuse boxes, fuse state or replacement orders. Observation/recording schema9 is unchanged. Local checks cover bounded circuits and supplied work; they do not establish sustained colony or outpost endurance.
