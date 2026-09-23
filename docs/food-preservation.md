# Food preservation and spoilage

Implemented locally, September 16, 2026. Timing and temperature thresholds are provisional gameplay values.

## Food lots

Food remains a numeric resource quantity. Aged portions additionally carry `_food: [{amount, age}]` metadata on the inventory that owns them. Any quantity not listed in those lots is freshly produced food. Inventory helpers exclude metadata from resource quantities, costs and capacity. Transfers copy lots; they never reset age. Within a selected inventory, extraction and consumption take the oldest portions first. Destination priorities and travel distance still decide which inventory a hauler visits; this is not colony-wide oldest-first scheduling.

Fresh hydroponic output starts at age zero. Mixing new food into an old stack preserves each portion's age. Picking up, dropping, delivering, reserving, cancelling, dismantling, loading and unloading preserve it. The derived resource bar and total-resource audit remain plain numeric totals, rather than additional physical owners.

## Temperature and spoilage

Food expires at **3,600 equivalent warm seconds**. Each simulation tick adds:

| Local temperature | Aging per tick | Fresh-food lifetime if unchanged |
| --- | --- | --- |
| At or below 0 °C | 0.05 | 20 hours |
| Above 0 through 5 °C | 0.2 | 5 hours |
| Above 5 through 25 °C | 1 | 1 hour |
| Above 25 through 40 °C | 2 | 30 minutes |
| Above 40 °C | 4 | 15 minutes |

These are simulation-time estimates, not real food-safety guidance. Changes in temperature change the remaining time. Cold never restores freshness. Food uses its owner's local temperature immediately; item thermal inertia is not yet modeled. In-transit shuttle inventories use an abstract 20 °C environment; parked ship stores and cargo use the dock location.

Climate-unit targets now range from **−20 to 35 °C**, supporting refrigerated rooms and freezers. Keep cold stores separate from living spaces: crew, crops and medical cots retain their temperature requirements. Climate units still need electricity and maintenance. When cooling stops and a room warms, its food ages faster.

Expired quantities become equal quantities of **waste**. Depot, loose-pile, ordinary cargo and shuttle inventories retain the waste; expired machine ingredients and job-owned supplies leave a waste pile at their actual location. Waste occupies physical capacity and can be hauled or filtered. It is not edible and cannot satisfy a recipe or job's food cost. `s.foodSpoiled` records the cumulative quantity converted. This is a spoilage counter, not a full food-production/consumption ledger.

## Interrupted work

Uncollected job reservations, carried job ingredients and staged supplies all age where they actually are. A job that loses food tracks `missingFood` and cumulative `foodSpoiled`, requests a replacement reservation, and waits for physical pickup and delivery. Already delivered non-food supplies and prior job progress survive. Validation requires held/reserved quantities plus missing food to match the original cost. Incomplete work can retain progress only with a recorded food-spoilage history and its other materials still delivered.

Cancellation refunds only actual remaining supplies. Lost food is not recreated from the original cost. The replacement system also handles shuttle-loading orders and bedside meal jobs.

A spoiled active medical-synthesis batch cannot finish. It resets batch work, leaves waste, and returns remaining ingredients to a local recoverable pile. The production order's remaining batch count is unchanged. Output food and waiting inputs also age; collection and power outages do not pause decay.

## Opened meals

Consumed ordinary and bedside portions now retain waste at 1/16 unit per portion until a sanitary visit or overflow; see [nutrient recycling](nutrient-recycling.md). Spoiled portions retain the separate 1/8 rate below.

Opening a ration transfers its age to the eight meal portions. A mixed ration uses the oldest contributing portion's age, conservatively treating it as one opened meal. Nursing does the same when a delivered meal is served. Remaining portions age at the patient's or eater's location; spoilage produces waste at one-eighth food unit per uneaten portion and never grants hunger recovery.

Air emergencies transfer opened portions into the crew member's carried meal state instead of losing them when the recovery intention changes. Rescue preserves meal age. A deceased surface/field crew member leaves uneaten portions as aged recoverable food at their position. Other carried supplies retain their existing death handling.

## Inspection, saves and evidence

The hidden depot, machine, loose-pile and carrier inspectors show oldest-lot freshness and estimated time to spoil at the displayed temperature. Waste uses the existing inventory and filter views; it does not add another top-bar counter. Job details distinguish missing replacement food from supplies already in transit.

Food preservation was introduced in schema **16**; current schema **25** also preserves prepared food and opened-ration inventories; see [prepared meals](prepared-meals.md). Version-15 migration preserves food quantities, paid portions, jobs and other state, initializing previously unaged food as fresh and new spoilage fields to zero. Current saves retain food lots, opened-meal ages, waste and pending replacement supplies. Validation rejects invalid ages/lot quantities, inconsistent material ownership and invalid replacement records.

The original food-preservation pass includes 19 food cases. They cover oldest-first extraction, real hauling, mixing, temperature rates, waste conversion and capacity, replacement reservations/deliveries, cancellation, interrupted carriers, spoiled medical batches, new crop output, opened/nursed portions, ship stores, transit cargo, demolition, an actual cold-store warming after power loss, deterministic continuation, migration, malformed data, air emergencies and death. Two older medical tests now compare ingredient quantities separately from age, and explicitly check that food continues aging through an outage.

Isolated headless Firefox verified freshness and temperature estimates, a freezing target, waste-filter changes, saved age metadata and inventory labels. Screenshots were inspected and the scoped application log reported no runtime errors. The initial screenshot helper encountered a cancelled CSS animation; waiting for settled animations resolved the QA harness issue. No dependencies or game network calls were added.

## Remaining scope

Waste processing and fertilizer-fed crops are now implemented; see [nutrient recycling](nutrient-recycling.md). Initial cooking and meal quality are implemented in [prepared meals](prepared-meals.md). Sealed/preserved food, contamination/disease, nutrition preferences, medicine aging, item thermal inertia and colony-wide oldest-first routing remain unfinished. Lots currently track food only. Transit physiology and consumed expedition meals remain abstract. This does not complete the wider colony/DF conversion scope.
