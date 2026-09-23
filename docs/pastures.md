# Physical pastures

Implemented September 16, 2026. Extends [bristleback husbandry](husbandry.md) with physical boundaries, animal routes and local recording labels.

## Building and using a pasture

| Structure | Delivered cost / construction work | Passage |
| --- | --- | --- |
| Pasture fence | 1 alloy / 3 work | Intact fences block crew and bristlebacks; tiny tibbles pass |
| Pasture gate | 2 alloy / 4 work | Starts latched: crew use a wicket; bristlebacks need the gate held open |

Build a ring around lichen and a husbandry post, with a gate for handlers. Open the gate, assign an outside animal to the post, wait for it to walk inside, then latch the gate. Assignment never teleports or tames it. Handlers still need Husbandry duty, food, reachable supplies and a route to the post. Feeding and collection remain physical jobs.

The hidden inspector shows enclosed/open range, accessible tile count, available lichen and whether the animal can reach its post. Inside a bounded area containing its post, an assigned animal can graze throughout that area. On open range it retains the earlier soft radius of two tiles. Work brings it back to the post. An enclosure can still run short of lichen; it does not create food or guarantee handler access.

An intact boundary has condition above zero. At zero, fences and gates allow passage until repaired. Ordinary delivered repair and dismantling apply. New fence/wall/gate construction waits for living occupants to clear its target; repairing a fence waits for crew or bristlebacks, and repairing a latched gate waits for bristlebacks. Blocked work exposes its reason. Latching around a living bristleback is rejected. Repairs preserve a gate's selected mode.

Fences and gates do not hold atmosphere or divide gas compartments. Rocks, hull walls and sealed/automatic pressure doors also block bristlebacks. Bristlebacks only pass held-open or broken pressure doors. Tibbles retain their existing access through automatic pressure doors; a sealed pressure door stops them. There is no transient livestock opening when crew use the pasture wicket.

## Derived regions

`src/navigation.js` shares an orthogonal breadth-first search with separate crew/animal passability. `src/pastures.js` flood-fills bristleback-accessible surface cells. A region is **enclosed** when it has no cell on the map edge. Natural rock and hull boundaries count; this is physical reachability, not a player designation or an airtight room claim.

Region IDs use `pasture:surface:x:y`, anchored at the lowest row-major cell. Like room IDs, they may change during splits/merges. Enclosed regions appear as observation entities with cells, enclosure state and lichen. Creature observations add `derived.pasture={region,enclosed,tiles,lichen,postReachable}`; a missing post has `postReachable:null`. Topology is derived, never saved as a second authority.

## Actions and event labels

- Existing `job.order`, `job.cancel` and `job.priority` cover building, repair and removal.
- `pasture.gate({site,x,y,mode})`, where mode is `latched` or `open`, uses the same dispatcher for player and agent controls. Rejections retain the gate state and explain why.
- `pasture.gate.mode_changed`: gate tile ID, previous/new mode and whether condition makes it effective.
- `animal.containment.gained` / `animal.containment.lost`: animal ID and previous/current region IDs. These mark a changed enclosure condition. Opening a boundary does **not** claim an animal has physically escaped.
- `animal.pasture.changed`: changed region identity while enclosure status remains the same.
- `animal.post.route_changed`: previous/current post reachability.
- `animal.moved`: creature ID, from/to tile IDs and `post`, `grazing` or `food` reason. Applies to bristlebacks and moving tibbles.

Tick records capture derived changes and resource/condition changes. Gate commands compare before/after immediately; ticks compare before/after simulation. External direct edits remain labeled external state changes. Optional recording does not modify saves, RNG or outcomes. See [simulation interface](simulation-interface.md).

## Saves, verification and limits

Save schema **27** accepts versions 1–26. Version 26 requires no new animal/resource data; existing colonies receive no free structures, animals or supplies. New gate tiles save their mode, and malformed/stale gate fields are rejected.

**434 tests pass**, including seventeen focused cases that verify physical construction, actor-specific paths, feeding inside a latched enclosure, non-teleporting admission, sustained containment, grazing beyond the soft radius, damage/repair/removal, occupied targets, atmosphere behavior, route/boundary/movement labels, recording non-interference, migration and deterministic continuation. Isolated Firefox verified connected fence artwork, open/latched gate controls, animal care, readings, action labels, events, construction choices and save/reload; screenshots were inspected without scoped application errors.

Genetics, group herding, automatic escape recovery, veterinary medicine, climbing/flying/digging animals, advanced gates and animal atmosphere/temperature physiology remain unfinished. Optional [herd reproduction](breeding.md) now uses these enclosures and counts pending young against space. [Handler transport](animal-transport.md) now supports player-ordered recovery and controlled gate passage for attached tame animals. No model training or downloads were added.
