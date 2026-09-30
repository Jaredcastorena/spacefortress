# Staffed orbital outpost

**v0.1.2 development preview — save schema 38.** Physical freight, local construction, measured readiness and resident/return controls are implemented with bounded test and browser acceptance. A genuine colony save demonstrated stationing a resident, physically returning the other traveler and opening an actual off-site warning. The complete fresh-colony route through sustained habitation, delayed resupply, ordinary local care and final pickup remains **unfinished**. See [verification status](verification-status.md) for the exact scope.

The user chose progression upward and outward from the planet. The first staffed site, Relay K-07, is the project's bounded implementation of that direction. There is one shuttle, one active mission and one supported residence registry at the wreck. Generated settlements, fleets and local vertical decks remain later work.

## Supply, build, settle, return

The intended player path uses the existing map and hidden inspectors:

1. Inspect the **surface shuttle → Freight & local supplies**. Prepare a manifest, then choose **Load manifest aboard**. Adding entries to the form does not reserve or move goods. Workers must collect local supplies, carry them to the shuttle and finish the loading job.
2. Prepare the usual [two-person departure](departure-preparation.md). Freight and salvage share the hold; flight service fuel, food and breathing stores are separate. Finish or cancel terminal work before launching.
3. At **Regions → Relay K-07**, open **Freight & local supplies** and choose **Unload all freight here** or a partial manifest. Workers physically unload into the dock's imports. Goods still aboard cannot fund buildings or machine inputs.
4. Use **Build** on the wreck map. Construction takes this site's accessible imports, depot stock and loose piles. Enable the relevant construction and hauling duties. Build a depot, safe access, enclosed habitat floors, bunks and supplied life-support/power/climate devices.
5. Warm and fill the compartment through those devices. Open **Residents & habitat** for measured reasons that block settlement. New floors are cold and empty of gas; merely enclosing a room or opening this panel grants nothing.
6. Once the habitat is ready, choose **Station here** for the person who will stay. At least one living return traveler must remain. Stationing changes residence and the return list without moving anyone or changing the arrival history.
7. Check **Return team**, then recall. Selected travelers must reach the dock; a resident stays on site. Bring later supplies by the same physical freight route, or select a resident for a real pickup when the shuttle returns.

These controls are available in the development preview. A repeatable construction and endurance recipe still needs a verified trip budget, sustained room conditions and physical recovery path. This guide does not supply a completed fresh-colony walkthrough.

## Three different crew lists

| State | Meaning |
| --- | --- |
| Crew `site` | The person's current physical location, including transit. |
| `mission.crew` | Ordered outbound/arrival history; stationing does not rewrite it. |
| `mission.returnCrew` | One or two named return passengers, initially a separate copy of the arrival list. |
| `outposts.wreck.residents` | The authoritative persistent residence roster. There is no duplicate writable home-site field. |

New residents must be alive, physically visiting the wreck during a working expedition, free of pending shuttle deliveries, and supported by the measured habitat. Adding residents removes only the newly stationed people from the return list. The action rejects leaving no living return traveler.

A pickup selects an actual local resident for the return list; selection alone does not teleport them or end residence. Physical return departure removes the departing resident. A living remote resident cannot be removed explicitly even after a return seat is selected; only surface or deceased entries may be cleaned up directly. Living arrivals cannot be left behind unless explicitly stationed. Roster changes cannot orphan a held or reserved shuttle shipment. Voluntary empty returns remain unavailable; the existing all-assigned-travelers-dead fallback is separate from ordinary pickup.

After the wreck has been established, explicitly select **one** outbound crew member to leave a seat for a resident pickup. Initial exploration, comet and solar flights still require two; omitting an explicit selection still chooses two. The founding-history flag keeps one-person service visits available even after the last resident leaves. With two outbound visitors, a pickup still needs a replacement visitor to settle before the two-seat return can depart. No role-specific piloting skill is added. The complete fresh-colony final-resident pickup journey remains unfinished; bounded transport and rescue tests cover its individual controls.

`established` records founding history. A later shortage, empty roster or broken habitat does not erase that history or make the current conditions safe. A dock is a berth; shuttle presence follows its actual location and mission phase.

## Freight has one physical owner at a time

```text
surface depot or pile
  → loading job's reserved source → carrier → job materials
  → shuttle freight
  → unloading job's reserved source → carrier → job materials
  → wreck dock imports → local construction, depot or machine delivery
```

Loading and unloading are ordinary persistent jobs (`loadCargo` / `unloadCargo`), with three base work units. The job is the manifest; there is no second writable global shipment plan. One terminal job can run at a time. Load requests use positive known resource quantities; food age, meal metadata and item identities come from the physical supplies, never from form arguments.

At a remote dock, finished unloading enters its separate `imports` inventory. At the surface shuttle, it enters the terminal's loose pile. Imports are distinct from ordinary salvage piles so automatic return collection cannot immediately take a new shipment back aboard. Haulers can deliver from imports or depot stock into eligible machine inputs; construction can reserve reachable imports or loose material directly. A functioning local depot remains a commissioning requirement.

Freight, mission salvage, shuttle pickup claims and material reserved/carried/staged for freight work share the hold limit exactly once. Local construction or machine deliveries are not shuttle cargo claims. Flight service stores and protected return fuel retain their separate purposes.

Cancellation uses the existing job control. Uncollected unload sources still physically aboard return to freight while the craft remains present. Carried and staged goods remain at real local owners through normal cancellation. Recall cancels terminal work before leaving; completed freight remains aboard. A carrier blocked from their own air, temperature, meal or rest recovery can set down the parcel at their current tile: an exclusive same-site job source if still promised, otherwise a loose pile. Another worker must physically collect it; the person’s recovery remains active. A blocked route, dead carrier, smaller refit or canceled job must not erase or duplicate supplies. See [expedition logistics](expedition-logistics.md) for transport controls and capacities.

## Readiness measures the current habitat

`outpostReadiness(state, 'wreck', crewIds)` is a pure check for the **complete proposed resident roster**. It returns detached readings, stable blocker codes and readable reasons. Reading it does not initialize rooms, consume stock, reserve beds, change RNG or emit mutation events.

The agreed commissioning checks include:

- An intact local dock and a functioning depot reachable from the dock and proposed residents.
- A reachable, sealed, fire-free living compartment with actual breathable gas, **5–35 °C** temperature, working wired life support and enabled climate control with safe targets. Waste-designated space is unsuitable.
- A distinct reachable safe bunk for each resident. Beds are matched to actual paths, not just counted.
- Reachable, unpromised local reserves of **two food and five packaged breathing-mix units per resident**. A habitat depending on reactor generation additionally needs **one fuel unit**. Relevant real machine buffers may contribute; surface stores and supplies still aboard do not.
- For a resident needing care, an appropriate local cot, medicine and another mobile, medicine-enabled proposed resident when required. A healthy first resident does not imply that a lone resident can nurse themselves through every later injury.

These small reserve thresholds are commissioning guards, **not days of endurance or a guarantee of survival**. Water is reported as real stock but is not invented as a direct drinking requirement. Power readings use current physical generation, fuel, charge, topology and faults. Nameplate output alone does not establish readiness. Room-specific reasons appear with its gas and temperature readings; roster and provision failures have their own codes.

## Cold-room bootstrap and incomplete endurance

Bare wreck `deck` is exterior. New habitat `floor` begins with zero gas and thermal mass at the wreck's **−60 °C** ambient temperature. New devices and depots start empty, and batteries start uncharged. Neither settlement nor migration fills or warms them.

A cold but breathable room is dangerous: the current exposure model removes suit protection in breathable interiors. Warm-up, pressurization and admission must therefore be tested as a real sequence. Construction access, doorway gas loss, electrical generation/cooling, fuel delivery and automatic hauling all affect it.

An earlier ordinary-game attempt constructed a **three-floor, single-door compartment**, but repeated exterior hauling vented roughly 40 of 48 delivered breathing-mix units. It remained unbreathable, with heater wear and unsafe temperature preventing settlement. This is a failed design boundary, not a playable recipe. Three floor cells have **30 gas units** at nominal pressure; their **60 thermal-capacity units** are a different quantity. Neither number covers door losses, suit refills or heating time.

A later genuine colony save reached measured readiness and supported a resident while the other traveler returned; a subsequent battery/life-support warning exposed the remaining endurance limits. No complete, repeatable material manifest or construction walkthrough is accepted yet. Warm-up and night power must be measured, and farming needs at least 10 °C.

[Pressure-cycling airlocks](airlock-cycling-design.md) remain **proposed**. The preview has ordinary doors and finite gas equipment, but no automatic pump-out/refill controller, door interlock or cycling traversal. Those proposed operations are not part of this release’s accepted controls.

The scrubber recycles CO2 to oxygen without a consumable. An ideal sealed powered room therefore does **not** steadily drain packaged air merely through breathing. Initial filling, leaks, deficient oxygen and suit refills can consume delivered mix. Food and fuel remain finite; a farm also needs water, fertilizer, power, temperature and labor. It is not self-sufficient food production. Food retains its age and can spoil in transit and local storage.

## Local life, failure and pickup

The increment generalizes existing crew work and recovery to physical sites; it does not introduce a simplified remote simulator. Residents use the existing work, eating, rest and local-care systems while another map is viewed and no mission is present. Their individual boundaries are tested; a sustained fresh-colony care/resupply journey is still incomplete. Medicine, nursing, hygiene and sanitation must use local patients, supplies, paths and claims. Remote bunks are communal; existing personal home assignments remain surface reservations. See [crew life](crew-life.md).

Recall must release travelers' work without canceling residents' jobs. Distressed residents without a present shuttle seek local shelter/care; walking to an empty dock is not evacuation. Wreck debris checks every 65 ticks for all living crew physically there, including without a mission. A sealed floor compartment or the terminal of an actually usable docked craft protects them. Outside that shelter, a present craft’s fitting modifier applies only to its assigned return travelers; a departed craft provides no protection. The compact Relay K-07 warning opens the affected site's inspector; it does not fix the shortage.

Two bounded recovery mechanisms now have focused evidence: departure service-air targets refresh with a paid ten-mix margin, and blocked carriers physically set down parcels for later collection. Neither supplies missing air/water/fuel nor proves that a colony has enough capable workers. Acceptance must still show delayed supplies causing a real finite shortage, followed by physical resupply or pickup. An injured resident may need an additional local helper; a closed path or unavailable craft can prevent rescue. An explicitly selected one-person visit can collect a resident into the second return seat, with paid route fuel and actual boarding. There is no general autonomous evacuation planner, detailed piloting, transit breathing, body recovery, fleet or generated destination system.

## Shared actions, saves and evidence

The browser and local agents share `freight.load`, `freight.unload`, `expedition.return_crew`, `outpost.residents` and existing `job.cancel` through the [simulation interface](simulation-interface.md). Inputs are strictly validated before mutation; an accepted job request is not a completed shipment. Observations distinguish local stocks, onboard cargo, imports, physical shuttle presence, residence, return selection and measured habitat conditions. Named material-boundary and roster events complement tick deltas. Recordings remain local, optional and outside saves/RNG.

Schema **37** supplied the verified independent owners/rosters, accounting, site-local reservations and physical craft drawing. Schema **38** now implements the freight job/source vocabulary, preserving the same owners and adding no free cargo, gas, heat or residents. The 37→38 migration changes the version; older saves cannot already contain the new vocabulary or singleton outbound rosters. Schema 38 reuses existing crew arrays for explicit one-person established-wreck service visits. Current-schema validation must reject malformed jobs, source locations, capacity and duplicate ownership rather than silently repair them.

The preview’s accepted scope includes physical freight and local Build controls, conservation/persistence/recording boundaries, genuine resident stationing and traveler return, resident routines, and an actionable off-site warning. Care tests cover finite supplies and same-site helpers separately.

The remaining acceptance is the **whole fresh-colony journey**: obtain and ship the full budget, maintain a warm breathable habitat through night and normal work, sustain eating/rest/care offscreen, experience delayed supplies, recover through real resupply, and complete the final resident pickup. Brief readiness, synthetic care fixtures and individual transport tests do not establish that sustained loop. The preview remains incomplete even when its regression tests pass.

Sources: [freight](../src/freight.js), [outposts](../src/outposts.js), [readiness](../src/outpost-readiness.js), [construction](../src/construction.js), [expedition](../src/expedition.js), [atmosphere](../src/atmosphere.js), [thermal](../src/thermal.js), [definitions](../src/data.js). Exact accepted journey evidence and remaining gaps belong in [verification status](verification-status.md).
