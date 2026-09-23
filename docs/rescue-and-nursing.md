# Patient rescue and bedside nursing

Implemented in `src/mobility.js` and `src/nursing.js`, using the existing medical, movement, work and material systems. These are fictional simulation rules.

## Mobility and rescue

- Below 25 persistent injury, crew walk normally. From 25 to below 60, they move every other simulation second. At 60 or more they cannot walk. The shared movement function applies these limits to all walking activities.
- Critically injured workers release their jobs. Held supplies are set down at their actual position; construction reservations retain ownership and other workers can collect them.
- An available crewmate assigned to Medicine approaches the patient, lifts them from an adjacent tile and carries them one tile every other second. Patient and helper remain together; both continue using air and food. One helper can carry one patient, with unique reservations preventing duplicate rescue.
- Rescue can interrupt ordinary work or voluntary downtime. Helpers need adequate health, air, food and energy; they must not be off duty, carrying cargo or needing their own cot. Held deliveries finish before a helper can be selected.
- On the surface, rescuers use the patient's reserved safe cot. Without a usable cot, they evacuate an exposed patient to reachable breathable shelter. A patient already in breathable shelter waits for a cot rather than being moved around arbitrarily.
- A blocked pickup route cancels the helper's claim. A blocked destination holds the patient at the helper's actual location. A broken/unsafe cot can redirect transport to shelter. Helper exhaustion, injury, off-duty policy, disabled Medicine duty or death ends transport at the current position; another eligible helper can take over.
- Expedition teammates can carry an incapacitated survivor to the dock. The shuttle waits for living crew and held cargo, and for transport to finish. Comet return estimates include slower walking and an estimate of rescue time. There is no cross-site rescue expedition yet.

## Nursing and treatment together

Surface patients at a usable cot, and incapacitated patients waiting for rescue, request food below 45 hunger. A **Bedside meal** job reserves one food, collects and delivers it, then requires eight units of Medicine work beside the patient. Completing the job consumes the food and gives eight meal portions; each portion restores ten hunger over one second. This uses the same total nutrition as ordinary meals. Paid portions survive transport and save/load.

Patients at cots stay there for food. Treatment and meal jobs can coexist at one cot, and the tile inspector shows both. Within the same priority, nursing meals are assigned first. If a lone medic is treating someone too hungry for treatment to continue, they can switch to the meal job without losing staged medicine or treatment progress.

Uncollected, carried and delivered food remain separate inventories until service completes. Cancellation returns uncollected supplies, leaves held supplies with the carrier, and drops staged food locally. Explicit cancellation delays automatic meal retry for 120 seconds. Moving or rescuing a patient cancels a meal at the old position without that delay; death refunds unfinished food. There is no food teleportation or automatic nutrition grant for designating a job.

No Medicine staff or available food means the patient waits and may deteriorate. A patient cannot nurse themself. Hungry and exhausted helpers still need their own recovery. An already opened ordinary ration retains its remaining portions when the eater collapses or is lifted.

## State and UI

Schema **16** migrates versions 1–15. Version-11 migration adds `crew.rescue = null`, `medical.servings = 0` and `medical.feedRetryAt = 0`, preserving injuries, supplies and existing work. Rescue stores patient ID and pickup/carry stage; the patient's normal map position remains authoritative. Feeding uses ordinary job `sources`, `materials`, `cost`, worker and progress plus patient ID. The resource audit still includes every reserved or carried ration.

Validation checks meal portions and retry bounds, helper/patient identities, distinct claims, same-site transport, co-located carried patients, exclusive worker activities and valid feeding cost/work. Bedside jobs use a per-patient reservation slot, allowing simultaneous cot treatment while other construction retains its existing tile slot.

Crew inspectors show mobility, meal portions and rescue activity. Critically injured crew are drawn lying down; carried patients have a small stretcher graphic beside the helper. The cot inspector exposes both treatment and meal progress, supplies, priorities and cancellation. All details stay inside existing hidden drawers.

## Evidence and remaining work

**252 tests pass**, including 17 rescue/nursing tests. They cover movement, physical pickup/carrying through doors, permissions and unique claims, collapsed cargo, destroyed cots, exhausted/dead rescuers, located rations, a lone medic's task handoff, cancellation/death conservation, blocked routes, expedition evacuation, paid meal preservation, deterministic saves, migration and malformed state. Each wait step in those scenarios also validates a saved snapshot.

An isolated headless Firefox check verified carried-patient rendering, mobility and helper details, simultaneous bedside orders, cancellation and the saved retry delay. Screenshots were visually inspected. The first harness used synthetic pointer events, which Firefox rejected for pointer capture; the successful check used real BiDi pointer actions and scoped logs to its own tab. The final check reported no runtime errors. Browser/server processes were stopped and all preview/QA ports checked clear. Artifacts are in ignored `.runtime-qa/nursing-*`.

Anatomy, bleeding, disease, resuscitation, suit-air sharing, field treatment, cross-site rescue teams and a dead-body recovery system remain unimplemented. Movement thresholds and one-person carrying are abstractions; there are no stretchers to manufacture or multi-person lifting requirements. Transit physiology remains abstract. This increment does not complete the full conversion inventory.

## Assisted hygiene

Medicine workers now also provide [bedside hygiene](bedside-hygiene.md), collecting retained waste after physical care and carrying it to an accepting depot. Hygiene, feeding and treatment have independent patient jobs; interrupted work preserves progress and supplies. Field hygiene and consumable care equipment remain unfinished.
