# Injuries and medical care

**v0.1.2 development preview — save schema 38.** Physical-site medical care is implemented in [medicine.js](../src/medicine.js), with jobs and damage integration in [simulation.js](../src/simulation.js). Focused care boundaries are verified; the full fresh-colony outpost endurance/resupply/care/pickup journey remains unfinished. See [verification status](verification-status.md).

## Player loop

1. Build a **medical cot** on a habitat floor (4 alloy, 1 component). Keep its room breathable, thermally safe and reachable.
2. Injured crew reserve available cots at their physical site, with the lowest-health patients choosing first. Mobile patients walk there after finishing held deliveries and essential recovery; critically injured patients need [rescue](rescue-and-nursing.md). A reserved patient is excluded from new work.
3. Treatment automatically creates an urgent job requiring **one medicine**. A same-site crew member with Medicine enabled reserves, collects and delivers that local dose through the existing material system. The patient cannot treat themself. The Medic founder begins with level 3 medicine; other crew can learn it.
4. The medic works beside the cot only when the patient is present, fed, alive and available, and both locations have breathable air. Twenty units of skill-dependent work treat up to 25 injury. Medicine is consumed on completion, not designation or pickup.
5. Treated injury recovers at 0.12 health per second while the patient rests at the cot with food and air. Bed rest also restores energy. Larger injuries need multiple doses. New damage remains untreated even if older injuries have already received care.

Four medicine are stocked in a new colony. A **medical synthesizer** costs 6 alloy and 1 component. While powered (3 kW) and in breathable air, it converts 1 food and 1 water into 2 medicine with 40 units of Production work from an adjacent operator. Inputs and outputs use ordinary hauling, buffers, capacity and batch interruptions. A cable outage pauses production with the batch intact. Medicine competes with meals, farms and atmosphere production for supplies.

## Injury and interruption rules

- Debris impacts and solar exposure on expeditions, oxygen deprivation and starvation now create persistent injury and reduce health. Good air alone cannot heal that injury. Shield fittings retain their existing exposure reduction.
- Existing health and morale effects reduce work rates; injuries also create an unpleasant memory. Treatment and completed recovery create positive memories.
- Healthy crew may work while waiting for cot availability; injured crew are excluded from new expedition manifests, and injury during preparation holds the selected team's departure.
- Mobile patients normally finish carried shipments before walking to care. If their air, temperature, meal or rest recovery cannot proceed, the [blocked-recovery handoff](crew-life.md#when-a-carrier-cannot-recover) can leave the parcel at the actual tile while preserving its local job claim and metadata; it does not deliver treatment or heal the patient. Incapacitated carriers put cargo down for recovery by other crew. Cot patients receive delivered meals through nursing jobs; lack of food pauses treatment and convalescence. Unsafe cots release their claims and may require evacuation.
- Blocked patient routes, unsafe or destroyed cots, and patient death release claims and cancel invalid treatment jobs. Uncollected medicine returns to its source, staged medicine becomes a local pile, and held medicine stays with its carrier. A cancelled treatment waits 120 seconds before retrying, allowing demolition or other changes.
- Treatment pauses when a patient leaves for a meal. It does not heal through distance or consume a replacement dose merely because work was interrupted.
- General health deficits in legacy saves retain their prior slow recovery. Migration does not invent a cause or apply retrospective injuries.

## UI and persistence

The hidden crew inspector shows injury, cause, treated amount, cot reservation and care status. Medicine uses the existing labor/skill controls. The Colony drawer shows stored medicine and injured crew count. Cot and synthesizer have original Canvas drawings and construction entries; medicine does not add another always-visible resource counter.

The historical schema **16** checkpoint supported migration from versions 1–15. Version-10 saves gain medical state and medicine duties without changing health, jobs or inventory and without free medicine. `c.medical` stores injury, treated injury, latest cause, reserved cot, retry time and care status. Treatment jobs keep a patient ID and dose in addition to normal reserved/delivered materials. Current validation covers bounded injury, health consistency, site-qualified cot claims, treatment dose/materials and patient intentions. A cot coordinate is interpreted at the patient’s physical site, not implicitly at the surface.

## Verification and remaining depth

The historical medical checkpoint passed **252 tests**, including 17 medical cases covering persistent injuries, constructed cots, located delivery/treatment, staff permissions, self-treatment exclusion, bed scarcity, unsafe air, cancellation, death, emergency recovery, existing cargo, production through recovery, repeat injury, power interruption, departure holds, interrupted meals, deterministic saves, migration and corrupt-state rejection.

An isolated headless Firefox run verified the default hidden drawers, medical drawings, injured-crew inspector, medicine-duty toggle and saved value, construction choices and Colony medical summary. It found and prompted a fix for construction mode overriding Colony and crew inspection. Screenshots were inspected after drawer animations finished. No game runtime errors were reported during the assertions. Firefox emitted a render-script timeout warning during teardown; sustained performance has not been verified by this short check. Temporary browser/server processes were then stopped. This does not verify every older drawer action.

Injury-related mobility limits, patient rescue and bedside feeding are now implemented; see [rescue and nursing](rescue-and-nursing.md). Care now uses a local cot, medicine, food, paths and a same-site helper; it does not borrow surface supplies for a remote patient. A returning visitor does not cancel an unrelated resident’s treatment. Rescue targets a present boarding shuttle only for selected return passengers; otherwise it seeks local shelter/care. Focused boundary tests and the ordinary habitat journey are separate evidence; see [crew life](crew-life.md) and [verification status](verification-status.md). Anatomy, bleeding, disease, infection, multiple treatment types and transit physiology remain unfinished.
