# Sanitation, waste collection and exposure

Implemented September 16, 2026. These are fictional gameplay rules, not a medical or biological model.

## Crew needs and facilities

Consumed ordinary and bedside meal portions retain **1/16 recoverable waste** on their eater. Waste is a physical resource owner in `crew.sanitation.waste`, counted by `totalResources()` but unavailable to depots, recipes or construction. This replaces the previous immediate meal-location pile. A full ration still yields 0.5 waste, preserving the [nutrient recycling](nutrient-recycling.md) balance.

At **0.5 retained waste**, mobile surface crew seek a sanitary unit. They walk to a reachable facility, reserve it exclusively, and spend six ticks using it. Completion transfers all retained waste into its tank and releases the reservation. The facility needs breathable air, safe temperature, positive condition and enough tank space; construction/repair work blocks use. No water or electricity is consumed: this is a dry collection unit.

A unit costs **4 alloy + 1 component**, requires eight construction work, and sits on a habitat floor. It starts empty and stores **8 waste**. New colonies receive no free facility. Both the drawing and UI are local; no assets or dependencies were downloaded.

Recovery behavior:

- Crew finish opened meals and handle air/thermal emergencies before a sanitary visit.
- Actual carried shipments stay with the crew through a sanitary detour; uncollected hauling reservations can be released.
- An occupied, unreachable, full or unsafe facility does not make crew wait indefinitely: they continue other work and retry.
- After **120 ticks** with at least 0.5 retained waste, it overflows into a local pile and leaves a negative memory. A successful visit resets the timer.
- Immobile patients and reserved cot patients cannot visit facilities themselves. Medicine workers now provide [bedside hygiene](bedside-hygiene.md), collecting waste into carried shipments before overflow. Without assistance, the normal overflow rule remains.
- Death on a local map releases retained waste once. Transit pauses sanitation physiology. Field crews have no facility-use behavior yet; retained waste can overflow at their field location.

## Physical collection and recycling

The tank is an output source in existing hauling. Crew collect at most six units and deliver them to an accepting depot with space. Pickup reservations prevent duplicate collection. The existing recycler then receives waste from depots and turns it into fertilizer. No tank-to-recycler teleportation or automatic global spending exists.

An intact tank and waste being carried in a shipment are sealed. Waste stored in a bulk depot or lying on the floor is exposed; a sanitary tank at zero condition also exposes its contents. A dedicated waste depot in a separate compartment isolates it from living spaces. Filters, capacity, routing, worker availability and recycling orders determine whether waste accumulates.

Dismantling spills tank contents locally. Repairing a broken unit restores containment. Neither action creates or deletes waste. Facility tanks remain separate from machine input/batch/output inventories; `industry.buffer(..., 'output')` and `spillStorage()` handle both owners.

## Exposure, room layout and care

Exposure is derived from actual open waste in the crew member's compartment on each tick. There is no separate contamination inventory that can be duplicated by splitting rooms.

- In a breathable room, dose per tick is `min(1, 2 × exposed waste / room volume)`.
- With no dose, accumulated exposure declines by **0.2 per tick**; exposure is bounded to 0–100.
- Work rate is multiplied by `1 − exposure × 0.002`, up to a 20% penalty.
- At 40 exposure, continued dose adds stress and a negative memory.
- At 80 exposure, continued dose causes **0.01 injury per tick**, recorded as “unsanitary exposure” and treated through existing medical care. Removing waste stops additional injury and lets exposure decline; existing injuries still need treatment.
- Suits isolate this exposure in unbreathable environments. Room separation isolates the dose; opening a connecting passage/removing walls changes the room topology and the set of exposed inhabitants.

This is a first environmental exposure model. It does not simulate pathogens, incubation, contagious illness, food contamination, hygiene consumables, digestion timing, hand washing, plumbing, sludge, airborne contamination crossing doors, or individual species susceptibility. Tank damage currently uses the general condition model; dry units do not accrue powered-machine service wear.

## Inspection and persistence

The hidden build menu contains Sanitary unit. Tile inspection shows exposed waste in the compartment. Facility inspection shows the tank, availability or obstruction, current reservation, and hauling requirements. Crew inspection shows retained waste, time before overflow, exposure and its work penalty. No new permanent HUD panel was added.

Sanitation was introduced in schema **18**; current schema **20** includes assisted hygiene and room designations. The new crew state is `{waste:0, wait:0, exposure:0}`. Existing food, loose/depot waste, recipes, jobs, crops, medical state and inventories remain unchanged. Current saves preserve visits, exclusive reservations, tank contents, timers and exposure. Validation rejects invalid ranges, duplicate visits, overfilled tanks, foreign resources and tanks attached to missing facilities.

## Verification

**308 tests pass**, including 15 sanitation cases covering delivered construction, actual walking and visit time, seven competing crew, unavailable facilities, timed overflow, air interruption, retained cargo, full-tank collection through recycling, tank damage/dismantling, room isolation, exposure/work/medical consequences, cleanup recovery, sealed cargo, suit protection, immobile patients, death, deterministic saves, migration and invalid state. The recycling meal test now checks retained waste rather than an immediate pile.

An isolated Firefox session verified default hidden drawers, construction choice, the rendered sanitary unit, saved tank contents, room exposure, and crew need/exposure/work-penalty displays. Facility and crew screenshots were visually inspected; no scoped application errors were reported. Temporary QA processes were stopped. Older full UI/performance coverage remains incomplete.

## Next proposed work

Assisted bedside hygiene is implemented and verified; see [bedside hygiene](bedside-hygiene.md). [Room designations](room-designations.md) now connect infirmaries, housing, farms and waste storage to actual furnishings and environmental conditions. Broader disease, sanitation networks, food processing and the full game conversion remain outstanding.
