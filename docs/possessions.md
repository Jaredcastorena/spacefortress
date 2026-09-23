# Crafted personal possessions

Implemented September 16, 2026. This first possession system connects staffed production, physical hauling, personal preferences, downtime and travel. It uses the [structured simulation interface](simulation-interface.md) throughout.

## Production and physical identity

A **Craft workstation** costs 6 alloy and 1 component, requires 10 construction work and habitat flooring, and draws 2 kW. One batch consumes 2 alloy and 1 component for one keepsake after 30 operator work. It requires breathable air and 5–40 °C. Existing deliveries, production orders, maintenance, power and output capacity apply. There is no free starting workstation or keepsake.

Each item has a permanent `item-N` ID, maker crew ID, creation tick, style and quality. The finishing operator's preference sets the style: art → Prismatic knot, quiet → Meditation ring, company → Story tokens. Quality is `min(4, 1 + floor(Production level / 3))`. These are original abstract item types; separate portable item sprites remain unfinished.

Inventory counts use `keepsakes`, with physical records in `_items`. Transfers must use `extract` and `add` to preserve identity. Counts are integers: fractional free depot, carry or shuttle space cannot split an item. Stock targets count available colony items, excluding owned pocket items. Save validation rejects duplicate IDs, missing metadata and invalid qualities/counts.

## Crew ownership and use

Each crew member has one personal pocket and a collection policy, initially enabled. At the start of a safe break, an empty-handed crew member can claim an available item from depot stock, a loose pile or machine output. Matching style ranks first, then quality and walking distance. The crew member physically walks to it; claims prevent competing owners and haulers from taking the same buffer. A missing source, blocked route or emergency cancels pickup without deleting the item.

Only actual downtime grants enjoyment: leisure increases by `.03 × quality`, plus `.08` for a matching style; stress decreases by `.01 × quality`, plus `.02` for a match. A use memory has mood `quality + 3` for a match, otherwise `quality`, with the existing 120-tick cooldown. Ownership alone grants no positive memory.

The crew inspector shows item identity, maker, quality and preference match. Collection can be disabled. **Put keepsake down here** creates a physical pile at the owner's location and disables collection until enabled again. Local death drops the same item once. Pocket items accompany crew during travel, separate from work shipments and shuttle cargo. Released remote items can become shuttle salvage when the cargo filter permits them.

## Labels, recording and persistence

The shared action catalog adds:

- `crew.possessions.collect({crew, enabled})`
- `crew.possessions.release({crew})`

Observations expose individual item entities with metadata and `{entity, slot}` locations, as well as crew inventories and pickup intentions. UI item rows carry `data-entity`; controls carry matching `data-simulation-action` IDs.

Named events include `item.crafted`, `item.pickup.planned`, `item.pickup.cancelled`, `item.moved`, `item.owned`, `item.enjoyed` and `item.released`. Hauling movement records source/destination slots. Other inventory relocations remain visible in structured state deltas. These are observed transitions, not training rewards or proof of causality.

Save schema **23** preserves personal inventories, item identity sequence and pending pickups. Version 22 migration grants no items and expands only previously unrestricted depot filters. Recordings remain optional, local and separate from saves.

## Verification and limits

Seventeen focused tests cover actual construction and crafting, interrupted production, physical pickup, preference choice, competing claims, blocked sources, emergency recovery, whole-item depot/shuttle capacity, release, enjoyment, death, travel, deterministic saves, migration, malformed identities and labeled events.

Isolated Firefox verified the original workstation drawing, hidden default drawers, personal inspector, item/action labels, collection and release controls, recorded player actions, item locations and schema-23 save/reload. Screenshots were inspected; no scoped application errors occurred.

One pocket item, three styles and four quality grades are the initial scope. Wear, theft, trade, gifting, inheritance, tools/equipment, broader material preferences and personal collections remain unfinished. Pocket mass and capacity are abstracted. Entire-room ownership and remote residential allocation remain separate future work.
