# Pressure-cycling airlocks

**Proposed, September 30, 2026. No controller, automatic cycle, new save fields, or balance changes are implemented by this document.** The user requested a chamber with doors on two sides: close the doors, recover its air before opening outside, and refill it before opening toward the habitat. Current manual doors, gas equipment and ordinary outpost work remain separate implemented systems.

## Existing parts and constraints

| Existing system | Reusable behavior | Integration still needed |
| --- | --- | --- |
| [Atmosphere](../src/atmosphere.js) | Rooms own oxygen, inert gas and CO2; ten gas units per floor tile is nominal pressure. Doors connect rooms without merging them. `moveCrew` opens automatic doors for three ticks. | Controlled doors must check the controller on **every** physical step; a path alone cannot authorize opening. |
| [Gas networks](../src/gas-networks.js) | Bulk extractor retains the chamber mixture and smoke; pumps transfer against pressure; reservoir stores it; vent returns it. Nodes, capacities and species/smoke ledgers already exist. | Select and isolate the recovery/return branches. A vent cannot extract; a tank cannot purify its contents. |
| [Navigation](../src/navigation.js) | Orthogonal physical movement and a shared route search. Closed doors currently return no route. | Represent a route through an operable cycling chamber and distinguish waiting from an unreachable route. Preserve animal barriers. |
| [Power](../src/power.js) and [topology](../src/power-topology.js) | Circuit allocation, finite batteries, condition, priority, outages and actual energy accounting. | Controller load and phase-dependent device commands before allocation; no assumed power from a nameplate. |
| [Thermal simulation](../src/thermal.js) | Actual room heat, door conduction and supplied climate units. | Filling gas does not warm a chamber. Measure temperature independently. |
| [Simulation](../src/simulation.js) | Crew needs, cargo, work, meals, rescue, tick ordering and strict save validation. | Cycle traversal and interrupted-cycle persistence. A normal wait must not trigger blocked-recovery cargo set-down. |
| [Controls](../src/controls.js), [telemetry](../src/telemetry.js) | One dispatcher for player/agent actions, rejection records, stable entity IDs and named events. | Bounded setup/cycle/release controls, detached observations and cycle events. |

Gas pressure is a game percentage, not kPa. Gas heat/compression work, decompression injuries and external non-vacuum atmospheres are not modeled. This proposal must not imply they are.

## First implementation boundary

Use one dedicated chamber, two pressure doors, one controller, one extractor, one reversible pump, one reservoir and one regulated vent. The controller is proposed as a separate, wired floor building; existing gas devices keep their existing physical gas stores. Start with one traveler at a time, allowing an existing rescuer and carried patient as one inseparable party. No automatic animal transport or arbitrary multi-door/general-purpose logic in the first slice.

Binding must validate the physical layout:

- A chosen chamber floor anchor resolves to exactly one compartment. Its only door openings are the named inner and outer doors; no open floor edge or additional breach is accepted. Both doors and all sealing hull tiles must be intact before starting a normal cycle.
- The inner door separates that chamber from one different habitat compartment. The outer door connects it to walkable exterior, rather than to a second habitat. Door side walls prevent perpendicular gas connections. Entry/exit staging tiles are actual reachable tiles on the two sides.
- The extractor and vent belong to the chamber. Controller, pump and reservoir may be in an adjacent utility area. Devices still require their existing terrain, ports, clear construction tiles and physical power connections.
- A registered recovery branch connects extractor → pump → reservoir. Reversing that pump returns reservoir gas through the chamber-side branch → vent. The extractor valve is closed during refill; the vent valve is closed during recovery. A valve closes a node's ports, so disabling a device alone is insufficient isolation.
- The pump is the only connection between its two branches: no adjacent pipe bypass and no unregistered open connection to habitat supply, another airlock or dirty exhaust storage. Check the actual gas graph, not just the selected coordinates. All branch nodes are exclusively controlled while bound.
- Chamber geometry, branch ownership and clear door approaches are rechecked after work, damage and room changes. Room IDs based on the first cell are observations, not durable identities. A changed chamber pauses the cycle; it does not transfer the binding to a new room silently.

A two-floor chamber can contain the extractor and vent under current walkability rules. Its nominal atmosphere is 20 gas units. This is a geometry target, **not an accepted construction blueprint**: utility floors, pipes, cable, hull, warm-up and reachable work positions must be demonstrated through ordinary construction.

### Suggested construction budget

Existing values come from [building definitions](../src/data.js). The new controller cost is a proposal for review, not an accepted balance value.

| Part | Alloy | Components | Work | Electrical load |
| --- | ---: | ---: | ---: | ---: |
| Two existing pressure doors | 6 | 0 | 10 | No existing load |
| Existing extractor | 6 | 1 | 10 | 3 kW while enabled |
| Existing directional pump | 4 | 1 | 8 | 3 kW while enabled |
| Existing reservoir | 6 | 1 | 10 | Passive |
| Existing vent | 4 | 1 | 8 | 2 kW while enabled |
| **Proposed controller** | **4** | **1** | **8** | **1 kW while enabled** |
| Subtotal before enclosure/routes/supply | **30** | **5** | **54** | **7 kW recovery / 6 kW refill**, including controller |

Add one alloy per floor, two per hull wall, one per gas pipe and one per cable actually built; reuse suitable installed pieces. A fresh-air supply tank, if needed for commissioning or makeup, adds six alloy/one component and starts empty. Power generation, battery charge, temperature control and delivered breathing mix are additional physical costs. A controller is not a cheap replacement for those parts.

## Gas ownership and commissioning

The physical chain is chamber room → extractor buffer → pipes → reservoir, then reservoir → pipes → vent → chamber. Gas in buffers remains there between cycles. Retain all three species and smoke at their measured ratios, using the existing extraction/transfer/release accounting. There is no `airlock.air` inventory, cloned tank reserve, repackaging into inventory `air`, automatic oxygen restoration or gas destruction on cancellation.

The reservoir holds at most 80 total payload units, including smoke. Admission requires enough **reachable usable branch headroom** to recover the actual chamber contents down to the exterior target, accounting for existing gas in every participating node. A full reservoir is not made acceptable by nominal tank size or a pressure-only reading. No recovery phase silently vents excess outside.

Commission an empty installation with real supplies. The existing supply-tank machinery can convert delivered `air` into network gas before the assembly is isolated and bound. Alternatively, before binding, a player may charge the chamber through its inner manual door while the outer door is shut; the habitat then loses exactly the gas that actually flows. Neither method grants air. Recovering and returning that charge is finite, and breathing, suit refill, residual exterior losses or contamination can require makeup later.

For the first slice, reserve replenishment is deliberate maintenance while idle: isolate the chamber, refill through existing gas equipment, then revalidate. Do not continuously top up a recovery tank to full and consume the space needed to pump the occupied chamber down. Never permit an unguarded fresh-supply branch to bypass the interlock.

Recovered smoke/CO2 remains contaminated. Before a normal inner opening, require the real chamber and destination habitat to pass the existing breathability and thermal checks. Pressure alone cannot satisfy this guard. Show dirty reserve composition and refuse automatic habitat contamination; use existing isolation/filtering/clean supply to recover. Filtering retains waste in finite storage and does not regenerate oxygen. Chamber occupants continue ordinary breathing, suit use, temperature exposure and hunger while cycling.

## Proposed state machine

Each cycle has a direction (`outward` or `inward`), one admitted party, one current phase and actual controller/device references. Both doors are closed at rest; only one can receive an opening permit at a time.

| Phase | Physical behavior and advancement guard |
| --- | --- |
| `idle` / `queued` | Preserve the traveler's original task. Confirm an operable route, party location, tank headroom, available supply, suit reserve and current power. Select the oldest request; an occupied chamber has priority over new admission. |
| `prepare_entry` | Keep both doors shut. For habitat entry into the chamber, refill to habitat pressure; for exterior entry, recover chamber gas to the exterior target first. A party waits on its own side. |
| `admit` | Open only the entry door after matching that side. The named party walks through ordinary adjacent tiles; unrelated crew cannot tailgate. Do not close on an occupied doorway. |
| `seal_entry` | Wait until the full party is inside and both door tiles are clear; close the entry door and revoke its movement permit. Confirm the opposite door is also physically sealed. |
| `recover` | Outward trip: vent valve shut, bulk extractor enabled with target zero, pump toward reservoir. Stop at measured low pressure. Retain mixture and smoke. |
| `refill` | Inward trip: extractor valve shut, pump reversed, vent enabled toward habitat pressure. Use actual reserve, not habitat gas obtained by opening the inner door. |
| `release` | Verify both seal and side conditions again; open only the exit door. The whole party walks beyond it before the door closes. Emit completion only after actual crossing. |
| `paused` | Stop transfer commands, isolate branches and deny new admission. Close clear operable doors, preserving a blocked doorway's real state. Keep the party and all supplies physically where they are. |

**Proposed first thresholds:** exterior opening at chamber pressure ≤1% nominal; inner opening within two percentage points of the current habitat pressure, with both rooms breathable and 5–35°C. Use bulk-exhaust target zero; the low-pressure opening allowance is a bounded residual loss, not a claim of perfect vacuum. A two-floor chamber at 1% has at most 0.2 gas unit before actual door leakage. These thresholds require gameplay review and boundary tests before implementation.

A clean 20-unit chamber and two-unit-per-tick devices imply at least ten transfer ticks each way at full condition, **not** a ten-tick completion timer. Pipe backpressure, phase ordering, partial power, occupants, smoke, damage and near-empty branches change the duration. The controller advances on measured state, never on a timer that fills or deletes gas.

## Crew movement and waiting

Do not make both doors generally passable to fool the current BFS. Add a crew-aware route planner that can include a controlled chamber as a traversal segment, with a finite estimated wait. Keep ordinary `pathTo` behavior available for current physical reachability and animals. All job assignment, hauling, meals, shelter, rest, medical rescue and return-to-shuttle callers need an explicit choice of current reachability versus planned crew traversal.

The movement result must distinguish `arrived`, `moving`, `waiting_airlock`, and `blocked`. A request is created only during simulation/action execution, never by a pure route query or observation. A door permission is checked again by the authoritative movement function, so stale paths cannot open the opposite door. Crew use their existing walking speed; an immobile patient moves only with the existing physical rescuer.

- Normal cycle waits preserve the job worker, carried resources and metadata, delivery claim, opened meal, recovery intent and rescue relationship. The airlock never becomes an inventory owner.
- `waiting_airlock` must not call the current `setDownBlockedRecoveryCargo`, report “No reachable breathable shelter,” cancel a freight reservation or repeatedly create new requests.
- A genuine failure returns a named blocker. Existing emergency recovery may then set cargo down once at its actual tile/reserved source; emit that actual transfer separately. Never label a functioning cycle as blocked merely because the door is closed this tick.
- Admission estimates suit oxygen needed for measured remaining transfer/walking time with a stated margin; it cannot guarantee future power or supply. Low-oxygen arrivals get an urgent request and an actionable warning. Urgency cannot open both doors or invent breathable air.
- Reversing destination, mission recall, a canceled job or patient death cancels an outside queue entry. Once inside, complete a safe physical exit toward the chosen recovery side before releasing the traversal claim. No teleport, automatic site change or departure while still inside.
- Bound the queue to living local crew, one request per crew/party across controllers. Order by explicit emergency priority, then request tick and stable crew ID; finish the admitted party before changing direction. Recheck resource/route feasibility when granting admission.
- A living crew member, carried patient or creature in a doorway prevents normal closure. Unexpected occupants pause admission and are shown to the player. Animal transport remains unsupported; existing loose-animal movement must not obtain a crew opening permit.

## Failures, overrides and tick order

| Condition | Required behavior |
| --- | --- |
| Missing power, disconnected cable or exhausted battery | Transfer stops without moving gas. Mechanical interlock remains; clear doors latch shut, occupied door stays physically open with opposite door locked. Resume only after rechecking actual conditions. |
| Full reservoir, blocked pipe or empty refill reserve | Pause with exact retained quantities and named missing capacity/supply. Do not dump recovered gas, drain habitat through the inner door or restart the cycle from invented initial state. |
| Damage, fire, a broken door, removed part or bypass pipe | Invalidate permits and stop controlled transfers. A broken door still behaves as an actual open leak. Keep the opposite intact door shut; do not claim the chamber is sealed. Existing damage/release ledgers remain authoritative. |
| Dirty mixture or unsafe temperature | Keep inner opening locked. Display measured composition/temperature and necessary repair/supply work. No automatic purification or heat grant. |
| Occupied door or lost traveler | Wait on the actual obstruction and raise a reason; do not force closure, move the traveler or silently delete a live inside claim. |
| Manual override | Explicitly release **one** selected side after stopping pumps and confirming the opposite side is physically shut and intact. The player sees the measured pressure/contamination risk; resulting loss/exposure uses ordinary physics. If the opposite seal is broken, reject this controlled override; physical repair/removal remains available. |

A normal `door.mode`, `gas.device`, `gas.extractor`, `gas.valve` or supply enable command that would contradict a bound active controller must reject atomically with `airlock_controlled`. Repair/removal work is still possible, but invalidates the binding safely on the actual change. Replacing a removed part at the same coordinates does not restore its old binding; explicit reconfiguration is required. Removing the controller stops its devices, leaves the doors in their actual safe latch states and emits cancellation/unbinding records before its state disappears; occupants and cargo stay in place under manual door control. Unbinding requires no occupants, queue or active cycle, both doors shut, and gas retained in its existing nodes; it restores manual authority without opening doors.

Tick integration proposal: validate topology and select phase commands before `updatePower`; allocate finite power once; run existing gas/atmosphere/thermal/fire updates; then evaluate measured phase completion and opening permits before crew movement. Recheck a permit immediately on every movement to catch intervening changes. A power fault or damage must disable controlled gas operation before it can run that tick, even if an old device setting remains enabled. End-of-tick observations must describe the actual doors and quantities. No second energy allocation/consumption and no controller-induced RNG calls.

## Shared actions, UI and events

These names are proposals, not current action catalog entries. All actions use the existing shared dispatcher and strict argument validation.

| Proposed action | Arguments and effect |
| --- | --- |
| `airlock.configure` | `{site,x,y,chamber:[x,y],inner:[x,y],outer:[x,y],extractor:[x,y],pump:[x,y],reservoir:[x,y],vent:[x,y]}` at the controller. Bind only an idle valid assembly; derive and claim the connected branch nodes. No gas/device construction grant. |
| `airlock.enable` | `{site,x,y,enabled}`. Disabling enters a safe pause; enabling revalidates and resumes physical state. |
| `airlock.request` | `{site,x,y,crew,direction}`. Queue one physically local reachable traveler/attached rescue party. Automatic travel uses the same domain helper. A request does not move anyone. |
| `airlock.cancel` | `{site,x,y,crew}`. Remove a waiting entry or request safe return for an admitted party. It does not delete cargo or release a trapped patient. |
| `airlock.release` | `{site,x,y,side,acceptAtmosphereLoss:true}`. Explicit one-sided manual override with opposite-seal guard. Record the override even if no gas subsequently escapes. |
| `airlock.unbind` | `{site,x,y}`. Release control only under the idle/empty/closed guard above. |

Use compact contextual inspector controls: **Set up airlock**, **Cycle inward/outward**, **Pause/resume**, and a clearly marked manual release. Show the phase, waiting crew, measured pressure, tank free space, composition, power and one actionable blocker; detailed gas quantities stay expandable. The map shows the chamber, which door is locked/open and waiting crew. Existing manual-door controls explain why a bound controller owns the door. Pure panel/observation reads must not queue a request or advance a cycle.

Proposed events all include `entity` (controller tile), `site`, `cycle` when applicable, `tick` and a stable `reason`:

- `airlock.configured`, `airlock.enabled`, `airlock.unbound`: actual control changes and referenced tiles.
- `airlock.requested`, `airlock.request_cancelled`: actor/party, direction, queue identity and original destination/task reference.
- `airlock.phase_changed`: previous/next phase, party, measured chamber pressure, reservoir payload/free space and relevant door IDs.
- `airlock.door_changed`: actual door tile, previous/next open state and permitted party; firing only when the physical state changes.
- `airlock.blocked`, `airlock.resumed`: transitions of stable reason codes such as `no_power`, `reservoir_full`, `supply_empty`, `contaminated_mix`, `unsafe_temperature`, `door_obstructed`, `seal_broken`, `layout_changed` or `route_unavailable`.
- `airlock.traversed`: named actor/party, real from/to staging tiles, direction and completion tick after physical exit.
- `airlock.manual_release`: requested side, actor/source and measured conditions.

Existing `gas.extracted`, `gas.transferred`, `gas.released`, `gas.loaded`, `gas.mixed` and `item.moved` remain the transfer evidence. Link controlled gas transfers to controller/cycle context without emitting a second inventory movement for the same transfer. Observations expose controller configuration, phase, permissions, queue/party and derived blockers plus existing physical stores. Events describe observed transitions, not guaranteed safety or training rewards.

## Persistence and validation

Current save version is 38; this proposal does not change it. An implementation requires the next available version and an explicit legacy migration, coordinated with other work.

Proposed persistent controller state lives only on its real controller tile: configuration anchors/references, enabled flag, phase, direction, admitted party, bounded requests with original request ticks, next cycle sequence and pause/recovery intent. Preserve a small per-crew traversal reference separate from `c.intent`, because work/recovery/meal intents must survive. Gas stays in existing room/node fields; cargo stays in existing owners. Do not save a duplicate pressure, gas reserve, room object or cached route as authority.

Validate bounds, unique references and control ownership, one queue/traversal claim per crew/party, local crew identities, phase/door compatibility, branch and chamber references, integer sequence/ticks and existing gas/energy ledgers. Reject structurally impossible or duplicated claims. A **reachable damaged or interrupted state is valid**: missing equipment, broken seals, an occupied door, dead admitted traveler or depleted power must load in a representable blocked state without deleting references, replacing parts, granting resources or advancing time. Runtime reconciliation and its named events occur on the next tick; validate stored facts without silently repairing them on import.

Legacy saves gain empty controller/traversal defaults only; old manual door modes, timers, gas, supplies and crew remain byte-equivalent apart from required new fields/version. Reject forged airlock fields in older versions before migration. Save/reload during every phase, queue wait, partial transfer, outage and manual override must reproduce exact continuation. Preserve the existing failed-load original-byte protection and current-colony export behavior in [persistence](../src/persistence.js).

## Acceptance before calling it implemented

1. From an untouched colony, build and wire a valid chamber with delivered finite materials, charge it with accounted gas, and physically haul a named parcel out and back. No prepared safe-room fixture may replace this playable acceptance.
2. Observe close → recover → outer opening for departure and close → refill → inner opening for arrival. Assert the two doors never receive simultaneous opening permits, including multiple same-tick crew moves and stale routes.
3. Record species, smoke and energy across room, suits, nodes, inventory makeup and actual exterior loss. Repeated cycles cannot multiply gas. Deliberately dirty/full/empty reservoirs must give the corresponding measured behavior.
4. Save/reload at each partial phase and interrupted wait; compare deterministic continuation and named events. Pure repeated observations, paused views and optional recording must not change state or RNG.
5. Test intact power loss, low battery/night, pump/door/pipe damage, bypass construction, room edits, blocked staging, tailgating, queue fairness, canceled jobs/recall and a physically carried patient. Use labeled synthetic boundaries for rare failures, separate from ordinary acceptance.
6. Prove a normal wait preserves freight/service/job claims, item IDs, food age/opened portions and rescue state, with no false blocked-recovery set-down. Prove a real failed route uses the established physical cancellation/recovery rules exactly once.
7. Through actual player controls, verify compact default/narrow layouts, working phase/blocker labels, stable held-click/focus and exact save import/export. Recheck the previous manual-door and ordinary outpost journeys.

## Decisions for implementation review

The recommended first shape is the paid separate controller, one reversible isolated branch, deliberate reserve makeup and one party per cycle. Root should settle the controller price/load, pressure tolerances and suit-margin policy before code. The cross-cutting architecture decision is the crew route/traversal interface: audit every `pathTo` consumer and agree on an explicit waiting result before implementing doors. Thermal readiness, safe failure and finite gas conservation are requirements; they are not optional balance shortcuts for the current outpost acceptance.
