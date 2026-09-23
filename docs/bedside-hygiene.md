# Assisted bedside hygiene

Implemented September 16, 2026. Extends [sanitation](sanitation.md) and [rescue and nursing](rescue-and-nursing.md).

## Care and physical waste

Living surface patients who are immobile or resting at a valid reserved medical cot automatically request hygiene when retained waste reaches **0.5 units**. A Medicine worker walks to an adjacent tile and performs **8 Medicine work**, scaled by skill, condition and morale. The patient and helper need breathable air and safe temperatures for work to proceed.

Waste stays entirely with the patient until care completes. Completion transfers at most **6 units** into the helper's sealed cargo. It never deposits waste directly into storage or a distant machine. If the patient's remaining retained waste is below 0.5, the overflow timer resets; larger unfinished needs keep their elapsed timer.

The helper delivers collected cargo using existing depot capacity, filters and routes, even if their general Hauling duty is disabled. If no reachable depot accepts it, they place it at their actual position. It then becomes exposed loose waste and can be collected later. Helpers' recovery and death use the same cargo ownership rules as other shipments. `totalResources()` counts the patient, helper and eventual depot/pile exactly once.

This models dry personal care with reusable crew equipment. Disposable liners, soap, water, tool inventories, bathing and sterilization are not yet simulated. Care prevents retained-waste overflow; it does not erase room contamination, accumulated exposure or existing injuries.

## Scheduling and interruptions

Hygiene has its own patient job slot and can coexist with feeding and treatment at the same cot. One patient cannot receive duplicate hygiene jobs, including at two positions during a move. Helpers cannot be their own patients.

At equal work priority, bedside meals are scheduled first, hygiene second, and other work follows existing ordering. When hygiene has waited 60 ticks and the patient is not hungry, a medic assigned to that patient's treatment can switch to hygiene. Treatment keeps its delivered medicine and progress. Hungry-patient feeding retains precedence. Rescue and crew emergencies retain their existing priority.

- Exhausted helpers release unfinished jobs; another Medicine worker can continue their progress. The patient's waste remains with them until completion.
- Unsafe air or temperature pauses actual hygiene work.
- Rescue movement, restored independence, death or overflow invalidates the old care request. Automatic cancellation adds no retry delay or fabricated waste cargo.
- Manual cancellation preserves patient waste and starts a **120-tick retry delay**. It does not reset the overflow timer. A new explicit order through the simulation API can bypass that retry delay.
- While collected waste is being delivered, it is already independent of the old patient job. Cancelling other care cannot refund or duplicate it.

## Interface and persistence

The hidden patient inspector now lists their current **Care orders**, including treatment, feeding and hygiene, with existing priority and cancellation controls. Tile inspection also shows the jobs. The sanitation section explains assisted care and shows a pending manual retry delay. Helpers' ordinary cargo display shows collected waste.

Hygiene was introduced in schema **19**; current schema **20** also preserves room designations. Version 18 adds `sanitation.retryAt = 0` without changing retained waste, exposure, tanks, resources, jobs or injuries. Current saves retain hygiene assignments/progress, manual delays and carried waste. Hygiene jobs own no ingredients; validation checks patient identity, work amount, empty inventories, uniqueness and bounded retry time.

## Verification

**308 tests pass**, including 15 hygiene cases covering Medicine permissions, walking/work, bounded collection, actual disposal, simultaneous care, sole-medic sequencing, treatment interruption, helper handoff, unsafe rooms, patient rescue/death/overflow, manual cancellation, helper recovery/death with cargo, rejected storage, deterministic saves, migration and invalid state. The final duplicate-order guard was also checked in the focused 15-test suite after the full run.

An isolated Firefox session verified hidden default drawers, patient care orders, saved hygiene priority, cancellation, unchanged patient waste and other care jobs, and the persisted retry delay. The care screenshot was visually inspected. No scoped application errors were reported. The initial automation click missed a crew row while its drawer was animating; waiting for the animation before measuring pointer coordinates fixed the harness. Temporary browser/server processes were stopped. No dependencies or external art were added.

## Remaining scope

Field/ship hygiene, consumable care equipment, washing, infection and hygiene quality remain unimplemented. The broad colony simulator and conversion inventory remain incomplete.

[Room designations](room-designations.md) are now implemented, including persistent anchors, actual requirements and medical routing. Crew housing assignments and personal bunks are the next proposed room-related pass.
