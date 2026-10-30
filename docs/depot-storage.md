# Depot capacity and hauling

Updated October 30, 2026; delivery limits are local after v0.1.12. These are initial storage constraints; capacities are provisional game units.

## Space and ownership

Each cargo depot holds **320 units**, with every resource using one unit per quantity (including breathing mix). Available stock and uncollected construction, nursing, maintenance or shuttle-loading reservations still physically at that depot occupy space. Reserved supplies only free their space when a worker collects them. Cancelling an uncollected job restores the stock in place even if the filter has changed.

Incoming carried cargo and pending pickups reserve the remaining capacity. Concurrent haulers cannot promise the same free space. A recovering carrier retains their cargo reservation; death or setting the goods down releases it. These capacity claims are derived from the existing inventory owners, not a second inventory ledger.

Full depots prevent new collection. Machine output then fills and stops production without spending a fresh batch. Building another accepting depot, using stock or changing policies creates space and lets hauling resume. Returned expedition piles use the same surface hauling rules.

## Per-resource delivery limits

Open **Delivery limits** in the depot inspector. Each resource can have a whole-unit cap from 0 to 320; leave it blank to clear the individual cap. Zero stops new deliveries of that resource. All resources still share the depot’s 320-unit capacity. Configured caps do not reserve otherwise empty space for a resource.

Stored quantities, uncollected job reservations and pending/carried deliveries all use the resource’s headroom. Concurrent haulers claim space before pickup; mixed shipments fit both their resource caps and remaining shared capacity. Fractional bulk quantities still fit the remaining fraction of a whole-unit cap. Individual crafted items remain indivisible.

Lowering a cap never destroys goods or cancels paid construction ownership. Already-held cargo rechecks its destination, reroutes to another accepting depot or is placed locally for later hauling. A pending pickup that no longer fits is released. Existing over-limit stock remains usable, and cancelling a reserved job returns its goods even if that exceeds the current cap. Normal priorities still govern restocking between depots.

The shared `depot.limit` action accepts the depot’s full site/x/y/z address, a resource and an integer cap or null. `depot.limit.changed` identifies actual policy changes. Derived observations expose total and per-resource stored, reserved, incoming and free space without adding another inventory owner.

## Filters and priorities

The hidden depot inspector shows available contents, occupied space, reserved supplies and incoming cargo. Resource buttons control acceptance; Low, Normal and Urgent buttons control hauling priority.

New depots accept every resource at Normal priority. Rejecting a resource does not discard existing stock or prevent it from being used. Haulers move it to another accepting depot when one has space. With no accepting destination, it stays put. Mixed loose piles are collected in shipments that fit the destination's filters and available space.

Haulers also replenish higher-priority depots from lower-priority ones. Accepted goods never move between equal-priority depots, preventing endless back-and-forth transfers. Filter evacuation can move goods to a lower-priority depot. Routing chooses destination priority first, then machine supply before storage at equal priority, then total pickup/delivery path length. Both legs require a walkable route. Current shipments finish without preemption solely because priorities change.

Life-support deliveries are Urgent. Other machine inputs follow the machine's production-order priority. Explicit construction, medical and other assigned jobs still take precedence over general hauling; crew safety and recovery take precedence over both. Production priority continues to control operator assignments independently.

## Interruptions

A changed filter or exhausted destination invalidates an uncollected pickup without taking goods. Held cargo goes to a reachable accepting depot with sufficient unclaimed space. If none exists, the carrier places it on their current tile and becomes available again. Loose cargo remains recoverable when space opens. Lost depots spill their contents; reserved supplies retain their job ownership.

## Persistence and evidence

Colony save schema **71** supports validated hex saves from schemas 40–70. Migration adds empty per-resource limit maps and preserves inventories, batches, reservation origins and carried goods. Pre71 saves containing a limit map are rejected. Current validation rejects missing/malformed maps, unknown resources and caps outside the integer 0–320 range, alongside invalid filters, priorities and policies attached to missing depots. Overfull inventories retain everything while new deliveries wait for space.

Current delivery-limit verification covers 12 new core/control cases, including paid depot construction and stair hauling, plus all 1,858 runnable suite cases through the full run and focused compatibility repairs (one historical skip). The browser editor kept its configured cap and existing supplies, with no console errors.

Historical capacity baseline: **252 tests passed**, including 14 storage cases covering shared capacity claims, reserved-space refunds, mixed filters, priority transfers, evacuation, policy edits during pickup/transit, local overflow recovery, rest interruptions, supply priorities, congestion stopping/restarting production, depot loss, legacy migration and invalid policies. Tests exercise real pathfinding; the recovery scenario also compares continued simulation after saving/loading.

Isolated headless Firefox verified hidden default drawers, capacity readings, filter and priority buttons using pointer input, unchanged stock and saved policies. The screenshot was visually inspected, and the scoped application log reported no runtime errors. Temporary browser/server processes were stopped after QA. No dependencies were added.

## Remaining scope

Local temperature is now shown in the inspector; see [temperature and climate](temperature-and-climate.md). Food spoilage and cold preservation are now implemented; see [food preservation](food-preservation.md). Remaining scope includes containers, stack-specific volume/mass, minimum-stock reservations, ownership and dedicated hauling roles. Machine deliveries still collect from depots; construction and meals can use loose supplies directly. Remote dock holds keep their separate expedition policy. These changes do not complete the wider conversion inventory.
