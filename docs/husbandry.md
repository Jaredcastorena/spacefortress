# Bristleback husbandry

Implemented September 16, 2026. Original bristlebacks now connect native grazing to physical crew care, trust, nutrient-curd collection and colony food/waste logistics.

## Posts, assignment and handling

A **Husbandry post** costs 4 alloy and 8 construction work, with no power requirement. Builders deliver its materials through ordinary construction. One living bristleback can be assigned per post. Assignment checks animal reachability and does not teleport or instantly tame it. Assignments and policies are available in the hidden post inspector; the animal inspector also shows its care state.

Assigned animals walk toward the post one tile every three ticks when handler work awaits them. On open range, they also return when outside its two-tile radius. Inside an enclosure containing their post, they can graze throughout the pasture. A handler waits for the animal to arrive at the post before making work progress. Closed paths, damaged posts and unavailable resources can block work.

The **Husbandry** duty and skill use the existing crew scheduling, priorities, recovery and skill-growth rules. New crew have the duty enabled; the Botanist starts at level 2, others at 0.

Automatic care is requested while trust is below 100 or nutrition is below 40. Each completed visit requires **1 physically delivered food and 12 Husbandry work**, restores 30 nutrition (capped at 100), and adds 40 trust. Three visits tame a wild bristleback. Each visit leaves 0.125 waste at the post. Feeding supplies can age, spoil and require replacement through existing job logistics. Handling does not cure an injury directly.

## Nutrition and products

Bristlebacks retain their native nutrition loss of 0.015 per tick and lichen grazing every nine ticks. Fed animals at 60 nutrition or more recover 0.01 health per tick. At zero nutrition they lose 0.2 health per tick, eventually dying. Dead animals stop moving, grazing and producing; pending care is cancelled and located supplies are preserved.

A tame animal with at least 60 nutrition and 60 health gains **0.25 curd readiness per tick**, capped at 100. Thus uninterrupted healthy production takes 400 ticks. Readiness can accumulate while the tame animal is unassigned, but collection requires a working assigned post. Collection is automatic when enabled and readiness is full, with at least 40 nutrition and health remaining.

Collection needs **10 Husbandry work**. It resets readiness to zero, costs 20 nutrition, and leaves **2 food plus 0.25 waste** at the post. Nutrient curd is currently represented as ordinary unprepared food. It must be hauled, can spoil, can supply a galley or medicine, and can feed crew or other animals through existing rules. Manure uses the waste resource and can feed recycling; in an indoor compartment it contributes to existing exposed-waste effects until hauled away.

This is an abstract biological production model, not a food-mass or energy simulation. Grazing helps support production; repeated care can also consume colony food.

## Interruption and control

- Care and collection have independent on/off policies. Pausing one cancels its current job and preserves supplies.
- Manual cancellation delays automatic retry for 120 ticks. Enabling the policy again clears that retry delay.
- Reassignment or release cancels current animal work without removing trust or accumulated product.
- Broken posts retain assignments but cannot support work; repair resumes scheduling.
- Dismantled posts release assignments. Animals remain in the world.
- Missing food is reported as a blocked care reason; missing Husbandry workers use existing job diagnostics.

There is no free starting post, trust, curd or additional food grant.

## Stable labels and saves

Shared player/agent actions:

- `husbandry.assign({creature, x, y})`; use both coordinates as null to release.
- `husbandry.policy({creature, policy: 'care' | 'harvest', enabled})`.

The catalog now has **32 actions**. Automatic `animalCare` and `animalHarvest` jobs have stable job IDs and an `animal` ID target; existing cancellation/priority controls apply. Creature observations include `husbandry={post,trust,product,care,harvest,retryAt,blocked}` and derived status. UI animal sections and controls have matching entity/action labels.

Semantic events include `animal.post.assigned`, `animal.post.lost`, `animal.care.completed`, `animal.tamed`, `animal.grazed`, `animal.product.ready`, `animal.harvested`, and `animal.died`. They identify animals, workers, jobs, tiles and quantities as relevant. Existing wildlife now also marks `pest.fed` and `pest.captured`. Ordinary state deltas retain intermediate nutrition, health, movement and job changes.

Husbandry was introduced in save schema **26**, which migrates version 25 animals to wild, unassigned state with empty product progress and adds the new crew duty/skill. Positions, existing nutrition, health and supplies are preserved. Validation covers animal state, distinct creature IDs, exclusive post claims and work/material invariants. All recording remains optional and local.

Physical fences, gates and enclosure readings are now implemented in [pastures](pastures.md). Enclosed animals can graze beyond the original soft post radius; assignment and travel use animal-specific routes.

Optional pairing, broods and growing offspring now build on this care system; see [herd reproduction](breeding.md). Juveniles receive feeding and handling but cannot produce curd before maturity.

Tame animals can now use [handler transport](animal-transport.md) to move physically between posts, including controlled passage through latched gates. Transport reserves its destination and changes assignment only on delivery.

## Verification and remaining work

The husbandry pass verified **417 tests**, including 16 husbandry cases covering real construction, walking and deliveries, taming, absent labor/food, cancellation/retry, blocked paths, post damage/removal, natural maturation, physical collection and hauling, health/nutrition gates, policies, death, migration, deterministic continuation, malformed state and labeled events.

Isolated Firefox verified the original post drawing and tame marking, actual assignment/walking/feeding/taming, health/nutrition/trust/product readings, policy/release controls, Husbandry duty, animal/action labels, recorded care events and schema-26 save/reload. Screenshot inspected; no scoped application errors occurred. Temporary QA processes were stopped.

Genetics, veterinary medicine, slaughter/corpses, wool/chitin products, water needs, animal thermal/atmosphere physiology and multiple livestock species remain unfinished. The current native species retains its simplified surface adaptation. This is an initial husbandry chain within the wider game scope.
