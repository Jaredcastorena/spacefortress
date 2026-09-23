# Injuries and medical care

Implemented in `src/medicine.js`, with jobs and damage integration in `src/simulation.js`. These are fictional game rules, not a real medical model.

## Player loop

1. Build a **medical cot** on a habitat floor (4 alloy, 1 component). Keep its room breathable and routes open.
2. Injured surface crew reserve available cots, with the lowest-health patients choosing first. Mobile patients walk there after finishing held deliveries and essential recovery; critically injured patients need [rescue](rescue-and-nursing.md). A reserved patient is excluded from new work.
3. Treatment automatically creates an urgent job requiring **one medicine**. A crew member with Medicine enabled reserves, collects and delivers that dose through the existing material system. The patient cannot treat themself. The Medic founder begins with level 3 medicine; other crew can learn it.
4. The medic works beside the cot only when the patient is present, fed, alive and available, and both locations have breathable air. Twenty units of skill-dependent work treat up to 25 injury. Medicine is consumed on completion, not designation or pickup.
5. Treated injury recovers at 0.12 health per second while the patient rests at the cot with food and air. Bed rest also restores energy. Larger injuries need multiple doses. New damage remains untreated even if older injuries have already received care.

Four medicine are stocked in a new colony. A **medical synthesizer** costs 6 alloy and 1 component. While powered (3 kW) and in breathable air, it converts 1 food and 1 water into 2 medicine with 40 units of Production work from an adjacent operator. Inputs and outputs use ordinary hauling, buffers, capacity and batch interruptions. A cable outage pauses production with the batch intact. Medicine competes with meals, farms and atmosphere production for supplies.

## Injury and interruption rules

- Debris impacts and solar exposure on expeditions, oxygen deprivation and starvation now create persistent injury and reduce health. Good air alone cannot heal that injury. Shield fittings retain their existing exposure reduction.
- Existing health and morale effects reduce work rates; injuries also create an unpleasant memory. Treatment and completed recovery create positive memories.
- Healthy crew may work while waiting for cot availability; injured crew are excluded from new expedition manifests, and injury during preparation holds the selected team's departure.
- Mobile patients finish carried shipments before walking to care. Incapacitated carriers put cargo down for recovery by other crew. Cot patients receive delivered meals through nursing jobs; lack of food pauses treatment and convalescence. Unsafe cots release their claims and may require evacuation.
- Blocked patient routes, unsafe or destroyed cots, and patient death release claims and cancel invalid treatment jobs. Uncollected medicine returns to its source, staged medicine becomes a local pile, and held medicine stays with its carrier. A cancelled treatment waits 120 seconds before retrying, allowing demolition or other changes.
- Treatment pauses when a patient leaves for a meal. It does not heal through distance or consume a replacement dose merely because work was interrupted.
- General health deficits in legacy saves retain their prior slow recovery. Migration does not invent a cause or apply retrospective injuries.

## UI and persistence

The hidden crew inspector shows injury, cause, treated amount, cot reservation and care status. Medicine uses the existing labor/skill controls. The Colony drawer shows stored medicine and injured crew count. Cot and synthesizer have original Canvas drawings and construction entries; medicine does not add another always-visible resource counter.

Schema **16** supports migration from versions 1–15. Version-10 saves gain medical state and medicine duties without changing health, jobs or inventory and without free medicine. `c.medical` stores injury, treated injury, latest cause, reserved cot, retry time and care status. Treatment jobs keep a patient ID and dose in addition to normal reserved/delivered materials. Validation covers bounded injury, health consistency, unique cot claims, treatment dose/materials and patient intentions.

## Verification and remaining depth

**252 tests pass**, including 17 medical cases covering persistent injuries, constructed cots, located delivery/treatment, staff permissions, self-treatment exclusion, bed scarcity, unsafe air, cancellation, death, emergency recovery, existing cargo, production through recovery, repeat injury, power interruption, departure holds, interrupted meals, deterministic saves, migration and corrupt-state rejection.

An isolated headless Firefox run verified the default hidden drawers, medical drawings, injured-crew inspector, medicine-duty toggle and saved value, construction choices and Colony medical summary. It found and prompted a fix for construction mode overriding Colony and crew inspection. Screenshots were inspected after drawer animations finished. No game runtime errors were reported during the assertions. Firefox emitted a render-script timeout warning during teardown; sustained performance has not been verified by this short check. Temporary browser/server processes were then stopped; artifacts are under ignored `.runtime-qa/medical-*`. This does not verify every older drawer action.

Injury-related mobility limits, patient rescue and bedside feeding are now implemented; see [rescue and nursing](rescue-and-nursing.md). Anatomy, bleeding, disease, infection, different treatments and remote field medicine remain unimplemented. Care currently depends on a surface cot, and transit physiology remains abstract. These remain part of the wider conversion scope.
