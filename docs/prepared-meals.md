# Galley and prepared meals

Implemented September 16, 2026. Prepared meals connect a staffed production chain to crew morale while keeping the existing food, hauling, spoilage, nursing and sanitation systems.

## Cooking

| Property | Galley |
| --- | --- |
| Construction | 6 alloy + 1 component, 10 work, habitat floor |
| Power | 2 kW from connected wiring |
| Input | 2 unprepared food + 0.25 water |
| Output | 2 prepared food |
| Work | 24 Production work by an adjacent operator |
| Environment | Breathable air and 5–35 °C |
| Controls | Existing continuous/fixed/stock production orders, priority and pause |

No free galley or meals are granted. Haulers select unprepared food for galley input. Prepared food cannot be cooked again. Galley stock targets count prepared food and promised galley output; ordinary food targets still count all food. The galley uses existing power, maintenance, output-capacity and delivery rules. It is excluded from designated sleeping, medical and crop rooms as industrial machinery.

Finishing cook skill determines quality: `min(4, 1 + floor(Production level / 3))`. A new meal batch stores its cook, creation tick, quality and stable `meal-job-N` ID. Cooking preserves the oldest ingredient age; it never refreshes expiring food. Power loss and pauses retain ingredients and progress, with continued aging. Spoiled ingredients reset cooking and leave waste plus remaining water physically at the workstation.

## Food ownership and eating

Prepared meals remain the `food` resource. `_food` lots may carry a `meal` record, so existing shipping, reservations, storage and medicine ingredients keep working. Plain food remains edible. Transfers preserve lot age, quality and batch identity; mixing with plain food does not improve the plain portion. Selection remains oldest-first within the chosen inventory, without a new preference or diet policy.

One food still opens into eight servings, with the existing hunger recovery and waste per serving. Opened rations keep a physical `openedFood` inventory and cumulative `qualityTotal` alongside servings and the conservative oldest-food age. Ordinary meals and bedside deliveries share this representation. Air interruptions and rescue transfer the remaining ration; death drops the same remaining portions. Spoilage converts only the remaining food amount into waste, with no completion memory.

Each consumed prepared serving reduces stress by `0.1 × quality`; plain food has quality zero. Finishing the ration produces a `prepared-meal` memory with mood `2 + ceil(sum of consumed serving qualities / 8)`, subject to the existing memory cooldown. Merely preparing, carrying, delivering or opening food grants no prepared-meal enjoyment. A mixed ration receives benefits only for its prepared share. Existing ordinary meal and nursing memories remain separate.

## Inspectors and structured records

Food details in depots, machine buffers, loose piles, carried shipments and crew rations show a collapsed prepared-food list with quantity, quality, cook ID and batch ID. No new permanent HUD counter or action family is needed. The galley recipe and target semantics are explained in its production inspector.

Observations expose each prepared batch as a `meal_batch` entity with its stable ID, metadata, total remaining food and an array of locations `{entity, slot, amount, age}`. A batch may be split across several owners, unlike an indivisible keepsake. Consuming, spoiling or using all of it removes that batch from the current observation; the recording retains its history.

Semantic events:

- `meal.prepared`: workstation, cook, job, batch ID, quality, food quantity and ingredient age.
- `meal.opened`: eater and the actual food lots opened.
- `meal.portion.eaten`: eater, food amount, weighted quality and consumed lots.
- `meal.finished`: eater and the ration's prepared-quality contribution.

Generic production start/completion, action and state-change records still apply. Batch changes use system `food`. These observations are not training rewards. Recording remains optional and local.

## Persistence and evidence

Save schema **25** adds prepared-lot/opened-ration support. Version 24 migration retains ordinary food, paid portions, ages and all other state; it grants no cooked food. Older opened rations without an explicit inventory remain supported as plain food. Validation checks meal metadata, consistent metadata across split batches, opened quantities/ages and galley input/output invariants.

Sixteen focused meal tests cover actual construction and deliveries, cook quality, preserved age, fresh prepared metadata, fractional transfers, raw-input selection, prevention of recooking, prepared stock targets, power interruption, spoiled batches, actual enjoyment, air emergencies, death, physical bedside delivery, portion spoilage, deterministic saves, migration, malformed data and structured batch/event records. The full suite has 401 passing tests. One older bedside-spoilage fixture was updated to remove three physical portions when it manually changes the serving count from eight to five.

Isolated Firefox verified a galley built and supplied through simulation, recipe/pause controls, hidden default drawers, an opened ration's batch label, saved portions, reload, eating, enjoyment memory and recorded portions. Screenshots were inspected; no scoped application errors occurred.

## Remaining scope

This is one generic preparation recipe using Production skill. Culinary specialties, ingredients/species/diet restrictions, flavor preferences, menu selection, dining locations, dishes, tools, preserved food, contamination and nutrition diversity remain unfinished. The recipe abstracts cleaning/cooking water use and does not model cooking heat or food mass thermodynamically. Expeditions still use their existing abstract service-food rules.
