# Colony reactors and exterior cooling

Implemented September 16, 2026. This brings the lab's adjustable generation, finite fuel, heat and manual overheat recovery into the isometric colony. The colony retains its compartment atmosphere/heat simulation; the lab's cell flows are not installed underneath the colony.

## Build and operate

- **Compact reactor:** 10 alloy, 2 components, 16 construction work; habitat floor required. Construction uses existing reservations, crew collection/delivery and work. New reactors have an empty fuel buffer and no stored excess core heat.
- **Reactor radiator:** 6 alloy, 1 component, 10 construction work. No electricity required. Place outside adjacent to a reactor, or two tiles away in a straight line with an intact hull wall between them. The sealed thermal feedthrough is part of the radiator; no separate pipe item is built.
- Enable Hauling. Crew physically move existing **fuel** from depots into the reactor's four-unit input buffer. Refills begin when at least two units of capacity are available; reservations count incoming shipments. Pausing stops new hauling assignments; previously assigned shipments can finish and cargo stays physical. Fuel competes with shuttle supplies.
- Inspect a reactor to set whole-number output percentages from 0–100, pause/resume, or reset a cooled shutdown. Inspect a radiator to isolate/reconnect its cooling. Controls use the shared player/agent dispatcher.

A convenient starter layout is a reactor on floor **12/11** and its radiator outside at **12/13**, with the existing wall at **12/12** between them. Connect the reactor to the colony's wiring; neither construction nor fuel delivery creates a cable route for it.

## Generation and heat

The lab and colony share the balance constants in `src/reactor-rules.js`: full output is **40 power**, consuming **0.02 fuel** and producing **24 heat** each tick. The colony scales all three by the chosen output and equipment condition. A partial final fuel charge produces only proportional power/heat. Zero output, a paused/broken/burning/tripped reactor, or an empty buffer produces none. Darkness does not stop a fueled reactor.

Existing circuits distribute generation by load priority, charge banks at their rate limits and curtail unused electrical output. A running isolated reactor still burns fuel and creates heat. Refreshing UI/circuit diagnostics does not consume fuel or advance heat. Operation accrues maintenance wear; existing engineering service and repairs apply. Operating reactors add machinery noise and invalidate quiet living/care/farm room purposes as industrial equipment.

A reactor holds excess core heat, with capacity four above a 20 °C reference. Each tick after ordinary room thermal updates it releases up to `0.5 × (core temperature − room temperature)` into its own compartment, bounded by its actual excess heat. This warms the same room that affects crew, crops and fire. Existing climate units cool the room and therefore help the reactor release heat.

Each enabled, intact radiator rejects at most **32 heat per tick × condition** from its connected reactors. Multiple connected reactors share this limit in a fixed neighbor order. Its own tile must be exterior or at **≤5% nominal pressure**. Air-filled rooms, a disabled/broken radiator or a missing hull feedthrough stop cooling. It rejects actual stored core heat to a recorded exterior sink; it neither removes room gas nor grants power.

The control temperature is the hotter of core and local environment. At the next generation check, **≥120 °C** latches shutdown before consuming fuel. Cooling and repairs retain the latch; restarting requires an explicit reset at **≤60 °C**, with positive condition and no fire. Disabling and reenabling cannot bypass it. The map shows a reactor-shutdown warning. Room heat and existing fires still evolve while the reactor is off.

## Ownership, labels and saves

Fuel stays in normal machine input storage until consumed. Interrupted/missing destinations return held cargo to storage or drop it through the existing hauling rules. Dismantling spills unused fuel and releases remaining core heat to the compartment, or accounts for its loss to the exterior when there is no room. There is no free fuel grant on construction or load.

`site.reactorLedger` tracks consumed fuel, generated electricity, produced core heat, transfer into rooms, radiation and discarded heat. Core heat plus all recorded exits equals produced heat. Room transfers also enter the existing thermal equipment ledger; these ledgers describe successive stages and must not be summed as independent energy supplies. Fuel is the current game's abstract consumable: the colony does not yet track the lab's spent-fuel quantity as a hauled item.

Shared actions:

- `reactor.configure {site,x,y,percent,enabled}`
- `reactor.reset {site,x,y}`
- `radiator.configure {site,x,y,enabled}`

Stable tile IDs identify observed reactor settings/heat and radiator controls. Derived observations expose reactor control temperature and radiator targets/blocking conditions. Named events include `reactor.generated`, `reactor.tripped`, `reactor.controls.changed`, `reactor.reset`, `reactor.heat.transferred`, `reactor.heat.radiated`, `reactor.removed`, `radiator.controls.changed` and `radiator.status.changed`. Recorder command records supply player/agent attribution, with typed inventory, power and temperature changes. Recording remains optional and outside saved simulation state.

**Save schema 31** introduced reactor state; the current schema is 33. The version-30 migration adds empty site reactor ledgers when migrating schema 30, preserving existing supplies, equipment, jobs and RNG. Current saves retain fuel buffers, settings, core heat and shutdown latches. Validation rejects malformed controls, excessive input buffers, attached state on missing equipment and inconsistent fuel/power/heat accounting.

## Verification and limits

Seventeen reactor tests cover delivered construction and empty commissioning, physical/batched hauling, day/night generation, condition/output scaling, finite fuel, diagnostic noninterference, heat ledgers, shutdown/recovery, thermal connection geometry and pressure units, demolition/cargo recovery, shared controls/records, noise, migration and deterministic continuation. The water-release suite had **552 passing tests** (including 29 isolated elements-lab tests).

Isolated Firefox checks original reactor/radiator drawings, hidden default drawers, output and pause controls, edits retained through refresh, radiator links/switching, hot reset guard and visible shutdown warning, cooled player reset, action/event labels and schema-31 save/reload. QA artifacts are `.runtime-qa/colony-reactor-check.mjs` and `colony-reactor-*.png`. No dependencies or external assets were added.

This remains an abstract game model. There are no coolant pipes, reactor chemistry, radiation sickness, meltdown, spent-fuel hauling, long-range thermal networks or operator staffing during generation. Surface construction remains the only supported construction network; generated worlds, true local z-levels and the larger SPACEFORTRESS conversion are still unfinished.

For current integrated checks, see [verification status](verification-status.md).
