# Depot capacity and hauling

Implemented locally, September 16, 2026. These are initial storage constraints; capacities are provisional game units.

## Space and ownership

Each cargo depot holds **320 units**, with every resource using one unit per quantity (including breathing mix). Available stock and uncollected construction, nursing, maintenance or shuttle-loading reservations still physically at that depot occupy space. Reserved supplies only free their space when a worker collects them. Cancelling an uncollected job restores the stock in place even if the filter has changed.

Incoming carried cargo and pending pickups reserve the remaining capacity. Concurrent haulers cannot promise the same free space. A recovering carrier retains their cargo reservation; death or setting the goods down releases it. These capacity claims are derived from the existing inventory owners, not a second inventory ledger.

Full depots prevent new collection. Machine output then fills and stops production without spending a fresh batch. Building another accepting depot, using stock or changing policies creates space and lets hauling resume. Returned expedition piles use the same surface hauling rules.

## Filters and priorities

The hidden depot inspector shows available contents, occupied space, reserved supplies and incoming cargo. Resource buttons control acceptance; Low, Normal and Urgent buttons control hauling priority.

New depots accept every resource at Normal priority. Rejecting a resource does not discard existing stock or prevent it from being used. Haulers move it to another accepting depot when one has space. With no accepting destination, it stays put. Mixed loose piles are collected in shipments that fit the destination's filters and available space.

Haulers also replenish higher-priority depots from lower-priority ones. Accepted goods never move between equal-priority depots, preventing endless back-and-forth transfers. Filter evacuation can move goods to a lower-priority depot. Routing chooses destination priority first, then machine supply before storage at equal priority, then total pickup/delivery path length. Both legs require a walkable route. Current shipments finish without preemption solely because priorities change.

Life-support deliveries are Urgent. Other machine inputs follow the machine's production-order priority. Explicit construction, medical and other assigned jobs still take precedence over general hauling; crew safety and recovery take precedence over both. Production priority continues to control operator assignments independently.

## Interruptions

A changed filter or exhausted destination invalidates an uncollected pickup without taking goods. Held cargo goes to a reachable accepting depot with sufficient unclaimed space. If none exists, the carrier places it on their current tile and becomes available again. Loose cargo remains recoverable when space opens. Lost depots spill their contents; reserved supplies retain their job ownership.

## Persistence and evidence

Save schema **16** supports versions 1–15. Version-13 migration gives depots all-resource acceptance and Normal priority. Existing inventories, batches, job reservations and carried goods are preserved. Legacy depots that already exceed 320 units retain everything, but accept no additional shipments until space becomes available. Old incoming shipments are rechecked before delivery. Current policy validation rejects invalid resources, duplicate filter entries, invalid priorities and policies attached to missing depots. Capacity remains a delivery rule; importing an already-overfull inventory does not delete it.

**252 tests pass**, including 14 storage cases covering shared capacity claims, reserved-space refunds, mixed filters, priority transfers, evacuation, policy edits during pickup/transit, local overflow recovery, rest interruptions, supply priorities, congestion stopping/restarting production, depot loss, legacy migration and invalid policies. Tests exercise real pathfinding; the recovery scenario also compares continued simulation after saving/loading.

Isolated headless Firefox verified hidden default drawers, capacity readings, filter and priority buttons using pointer input, unchanged stock and saved policies. The screenshot was visually inspected, and the scoped application log reported no runtime errors. Temporary browser/server processes were stopped after QA. No dependencies were added.

## Remaining scope

Local temperature is now shown in the inspector; see [temperature and climate](temperature-and-climate.md). Food spoilage and cold preservation are now implemented; see [food preservation](food-preservation.md). Remaining scope includes containers, stack-specific volume/mass, per-resource quotas, ownership and dedicated hauling roles. Machine deliveries still collect from depots; construction and meals can use loose supplies directly. Remote dock holds keep their separate expedition policy. These changes do not complete the wider conversion inventory.
