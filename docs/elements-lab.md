# Elements and electricity lab

Implemented September 16, 2026 after the user requested a quick, simple environmental simulation of air, water, fire, vacuum and electricity. This is the active development direction. The colony remains an isometric game; this laboratory uses a small side-view grid to inspect gravity and flows directly.

## Try it

Run `python3 tools/serve.py` and open **http://127.0.0.1:8420/elements.html**. It runs locally without packages, downloads, remote assets or network services. It does not read or replace the colony save.

The demo starts paused. Choose a brush and click or drag. **Run**, **Step**, and **Reset demo** control time. The **Scenario** selector offers the original chamber and a reactor cooling rig; changing scenario resets lab state and discards its local recording. **Inspect** reveals cell quantities, door controls, circuit readings and local recording controls. **View** cycles materials, pressure, heat and power without changing the simulation.

Quick experiments:

1. Erase a chamber wall: gas expands into surrounding vacuum and ultimately leaves through map-edge sinks.
2. Add water: it falls and levels. Water also compresses the gas sharing its cell.
3. Ignite the brown fuel strip: burning needs oxygen, consumes fuel, produces CO₂, smoke and heat. Add water to extinguish it.
4. Connect devices with orthogonal wires. Solar produces power during the first 160 of each 240 ticks. Batteries charge during a surplus and supply loads at night.
5. A generator begins with 20 fuel units, consuming up to 0.1 per tick for up to 16 power. Fuel is finite; placement is an explicitly recorded sandbox edit.
6. A pump uses three power to move water from the cell below to the cell above. A fan uses two power to transfer air left to right. A heater uses four power to add heat; sufficiently hot fuel can ignite.
7. Wet exposed wire adds a five-power fault load. Energized faults create heat and can deprive other devices of power. **Switch** toggles a device or opens/closes a door.
8. Open the outer door of the right-hand airlock: its small chamber vents while the closed inner door isolates the main room. Opening both doors exposes the main room to vacuum. These are manual doors without an automatic interlock.

**Empty air** clears gas once. **Vacuum vent** creates a continuing outlet, and **Seal vent** closes it. Vacuum is the absence of gas, rather than another fluid. **Wall** removes contents and equipment as an editor action. **Erase** removes walls/equipment/fuel while retaining gas and water. No brush is a colony construction action or a promise of resource conservation across manual edits.

The pressure view shows vacuum dark, nominal pressure blue and compression toward gold. Heat runs from blue through orange to bright hot cells. Power uses green for active devices, amber for unmet demand, shutdowns or blocked cooling, red for energized wet-wire faults and gray for idle connected cells. The inspector reports generation, demand, supplied/unmet loads, stored energy, charging, discharging and curtailment. These are last-tick readings; edits show a notice to step before treating circuit readings as current.

**Door** replaces a wall or occupies a cell without a device. Closing it retains its gas, water, smoke and heat while blocking transport and conduction through that cell. Reopening releases those contents. A wire can pass through a closed door as a sealed electrical feedthrough. Pumps and fans cannot transfer through closed door endpoints.

## Reactor and radiator experiment

Choose **Scenario → Reactor cooling**. The vacuum power bay on the left has a reactor marked **R**, radiator fins directly above it and a battery marked **B**. A wire crosses a closed door into the air-filled heater bay on the right.

1. Run a few ticks, then inspect the reactor. It supplies 40 power at full output; its radiator removes the waste heat.
2. Point at the radiator, open Inspect and choose **Switch device off**. Keep running: heat accumulates and the reactor trips. Its battery can temporarily support the heater.
3. Switch the radiator back on. The reactor stays latched off while it cools. Point at the reactor and use **Reset cooled reactor** once it reaches 60 °C or below.
4. Change **Reactor output %** in the inspector to trade output for fuel use and heat. Zero output consumes no fuel; switching the device off also stops generation. Neither action clears a trip.

These are proposed game balance values implemented for testing, not a realistic reactor specification:

| Rule | Implemented behavior |
| --- | --- |
| Fuel | A placed reactor starts with 4 units. Full output consumes 0.02 per tick; partial final fuel produces proportional output. Consumed fuel remains as an equal quantity of spent fuel in the device. |
| Output | Whole percentages from 0–100 scale 40 power and 24 waste heat per tick. Generation does not require oxygen and continues during darkness. Unused electrical output is curtailed by the existing power ledger. |
| Temperature | Uses the cell's existing heat capacity, gas and water. At a tick's generation check, temperature ≥120 °C latches shutdown before any new fuel is consumed. Later transport can cool the cell during that tick. |
| Reset | Explicit command; requires a tripped reactor at ≤60 °C. Reset permits generation on subsequent ticks if enabled and fueled. |
| Radiator | Passive, switchable thermal collector; removes at most 32 heat per tick from its cell and orthogonally adjacent open cells. Its own cell must have pressure ≤0.05. Closed doors and walls block its collector; it does not move gas or water. |
| Accounting | `reactorFuelUsed`, device `waste`, existing generation/consumption/curtailment and `heatMade`, and `radiatedHeat` record the quantities. Radiation is an explicit heat sink to space. |

Reactor heat can ignite ordinary combustible fuel where oxygen is present. Water changes thermal capacity and transports heat using the existing rules. The radiator combines a collector and heat rejection into one tile; no separate coolant pipes, reactor-core physics, radiation hazard, meltdown, refueling or spent-fuel hauling is modeled. Wall/erase/replacement brushes remain explicitly recorded sandbox edits that can remove a device and its stored fuel/waste.

## Shared rules

`src/elements.js` contains a deterministic simulation with no browser, timers or rendering. `src/elements-app.js`, `elements.html` and `elements.css` provide the interactive lab.

Cell amounts: water, oxygen, inert gas, CO₂, smoke, fuel and heat above the 20 °C reference. Walls block transfer. Water capacity is one per cell; pressure is gas amount divided by free volume, with a 0.05 volume floor. Liquid falls first, then levels horizontally. Gas pressure equalizes between neighboring cells and species diffuse; heat follows transported material and conducts between open cells. Processing order is deterministic; horizontal water traversal alternates each tick to reduce directional bias.

Burning converts equal oxygen and fuel amounts into the same gas amount of CO₂, plus particulate smoke and heat. Smoke is separate from the pressure-bearing gas inventory. Water suppresses burning at depth 0.1; low oxygen or exhausted fuel also ends it. Fuel can ignite at 70 °C. Water changes heat capacity and transports heat, so fresh water cools a hot cell without deleting stored energy.

Orthogonal connected devices/wires form separate circuits. Loads consume available generation and battery discharge; unmet loads remain off. Batteries hold 100 energy and charge/discharge at up to eight per tick. A battery discharges only for a load that can actually run, and a bank that discharged cannot charge in the same tick. Surplus generation is curtailed. Ledgers record generation, consumption, curtailment, combustion and boundary losses.

This is an intentionally small game model: no realistic fluid dynamics, steam/phase changes, material chemistry, voltage/resistance, wire damage, powered door motors, reactor-waste hazards, sunlight occlusion, device rotation, orbital mechanics or multiple vertical floors. Pumps/fans are abstract directed transfer devices. Solar cells all share the day/night phase. Electrical generation and fuel units are balance values, not engineering specifications. The [colony reactor integration](reactors.md) shares generation constants and adds reactors/radiators to its existing room gas/heat/fire systems and wired electrical network. The lab cell-flow engine remains isolated.

## Stable labels and optional local records

`window.elementsLab` exposes:

- `actions()` and `definitions()` — tool/device IDs and parameters.
- `observe()` — detached complete state (lab version 3) with `cell:x:y` entities, derived pressure/temperature, named power statuses, circuit reports and a `powerDirty` flag after edits.
- `act('cell.paint',{x,y,tool})` and `act('simulation.step',{ticks})` — the same mutations used by the player. Agent actions pause realtime playback; steps accept 1–240 ticks.
- `act('door.set',{x,y,open:true})` — shared explicit door control, with boolean validation.
- `act('reactor.output',{x,y,percent})` and `act('reactor.reset',{x,y})` — validated output and cooled-reset controls used by the inspector.
- `recording.start()`, `.stop()`, `.status()`, `.export()` — local NDJSON export.

Events include `cell.edited` with before/after values, `water.transferred`, `air.transferred`, `vacuum.vented`, `fire.ignited`, `fire.burned`, `fire.extinguished`, `generator.fuel.used`, `electrical.short`, `electrical.status.changed`, `electrical.circuit` and `door.changed`. Circuits use a `circuit:x:y` ID anchored to the first cell in their connected group; topology changes may change that anchor. Reactor and cooling events include `reactor.generated` (fuel/power/heat), `reactor.tripped`, `reactor.output.changed`, `reactor.reset` and `heat.radiated` (source cell, radiator, destination and quantity). Control events retain player/agent source. Transfers label endpoints, quantities and mechanism. Every event has a sequence ID and simulation tick. Cell inspectors expose the exact quantities used by these rules.

The on-screen history retains 200 events and explicitly counts older omissions. Optional recording captures an initial observation, action requests/results labeled player/agent/simulation/test, semantic events and complete tick observations. It stops at 2,000 records or 16 MB, keeping its original prefix. Dense flow scenarios can reach that limit quickly. The footer's `throughTick` identifies the last complete tick; later events may be a partial tick. Recording uses a WeakMap outside simulation state and does not affect outcomes. Reset clears the lab and its recording; export first. No training rewards, model downloads or external training calls are provided.

## Evidence and paused work

At the water-integration checkpoint, **552 tests passed**, including twenty-nine laboratory tests and seventeen colony reactor plus sixteen floor-water cases for gas and water conservation, walls/breaches, vent accounting, combustion, wet suppression, oxygen starvation, connected power, solar/night batteries, finite generator fuel, disconnected circuits, pumps/fans, shorts, stable actions, recording independence/limits and a 250-tick mixed scenario. Reactor cases cover fuel/waste and energy/heat accounting, cooling loss and manual recovery, output/disable behavior, partial fuel exhaustion, radiator atmosphere and door barriers, heat-triggered combustion, validation and recording independence. Additional cases cover trapped door contents, airlock isolation, blocked pump/fan endpoints, sealed wire feedthroughs, underpowered battery dispatch, circuit observations, validated door commands and recording noninterference.

Isolated Firefox verified visible rendering, hidden inspector, real pointer painting aligned with cell coordinates, stepping/gravity, fire, electrical drawings, local recording and reset. Door controls, airlock venting, player markers, non-mutating diagnostic views, circuit reports and stale-edit notices also passed browser checks. Screenshots `.runtime-qa/elements-doors-pressure.png` and `.runtime-qa/elements-doors-power.png` were inspected; no scoped application errors were recorded. The reactor scenario, output controls, radiator switching, hot reset guard, cooled reset and player event labels also passed browser QA; `.runtime-qa/elements-reactor-tripped.png` and `.runtime-qa/elements-reactor-running.png` were inspected. The local server allowlist includes the two lab files.

The preceding evacuation experiment was paused when the user redirected work to this lab. It is preserved in `.runtime-qa/evacuation-wip/` for selective reuse, and is not part of the running colony. Its full test run had six failures, including essential-life-support work being blocked by evacuation. Do not restore it wholesale or report it as verified. The restored colony passed all 490 existing tests before the lab was added.

Next: let the user try the interactions, then improve the common rules and their visibility alongside the first colony reactor integration. The colony now also has [horizontal floor-water integration](floor-water.md); vertical flow and fluid thermal behavior remain ahead. Keep the larger SPACEFORTRESS scope active.

Current colony gas pipes/tanks/pumps/vents are described in [gas networks](gas-networks.md); the lab remains separate. See [verification status](verification-status.md) for current suite evidence.
