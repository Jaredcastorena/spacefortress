# Electrical isolation and overload protection

**Status: first increment implemented and verified for schema 36. Later overloads/fuses remain unimplemented proposals.** Code review dated September 16, 2026. Schema35 water plumbing is the preceding release; schema36 acceptance is recorded in verification status. The [electrical isolation guide](electrical-isolation.md) records the first increment's source-checked rules; [verification status](verification-status.md) separates those rules from accepted evidence. Numerical overload/fuse ratings below are proposals, not settled user choices or current save fields.

The player should be able to put life support and industrial equipment on separate branches, isolate damaged wiring, and recover from an overload with physical repair work where appropriate. Protection belongs to actual installed equipment. A local battery can keep an isolated branch alive and continue feeding a fault.

## Baseline before this increment

| Current behavior | Authoritative source |
| --- | --- |
| Orthogonally adjacent cables and electrical equipment join an ideal circuit. There is no cable resistance, capacity or per-edge power flow. | `src/power-topology.js`: ordinary conduction and graph; `src/power.js`: allocation |
| A cable overlay takes precedence over the equipment terminal on its tile. Switching it off removes neighboring connections. The electrical equipment can still operate within its isolated tile, if it has a local source. | `src/power-topology.js`: conduction; `src/power.js`: allocation and cable controls |
| Wet, enabled cable with positive condition and at least 0.25 floor water requests 5 kW before ordinary loads. Only a supplied fault consumes 5 kJ, adds heat, and deals 0.25 condition damage during the one-second tick. | `src/liquids.js`: `wetCable`, `shortCable`; `src/power.js`: `calculate` |
| Loads receive their complete demand or remain off. Priority, life-support tie breaking and map position determine allocation. Paused devices release demand; ordinary enabled idle devices still draw it. | `src/power.js`: `calculate` |
| Each bank retains its own charge, capped at 120 kJ, with condition-scaled 20 kW charge/discharge limits. Splitting a circuit does not move stored energy. | `src/power.js`: `BATTERY_CAPACITY`, `BATTERY_RATE`, `calculate` |
| Reactors already have a temperature trip latch. It protects the reactor and is separate from a branch breaker. Fuel and heat are finite and accounted for. | `src/reactors.js`: `tripReactor`, `generateReactor`, `resetReactor` |
| Cable installation, repair and removal use delivered materials and crew work; removing a building leaves its cable. | `src/simulation.js`: `order`, work completion; `src/construction.js` |
| Manual cable and priority commands share the player/agent dispatcher. Wet shorts have transient `power.wet_short` events; before this increment simple cable toggles depended on action/state records; schema36 adds a semantic changed event. | `src/controls.js`, `src/telemetry.js`, `src/liquids.js` |

The baseline had no automatic branch breaker, disposable fuse, overload timer, automatic load controller or honest measurement of branch throughput. Physical breakers with supplied-wet-fault sensing are now implemented and verified; the other items remain future work. [Power networks](power-networks.md) distinguishes foundational evidence from newer extensions. Consult verification status for accepted current evidence.

## Approved first increment: branch isolation and wet-fault relay

Add one `breaker` building with two opposite electrical ports and no side connections. Default direction is east: its input port faces west and output faces east. Reverse power is permitted; direction describes its terminals and the monitored branch. It is not a diode. North/south orientation uses the same rule.

- Approved cost: **4 alloy, 1 component, 8 work** through ordinary construction reservations and deliveries.
- Place on an empty surface habitat floor, without a cable overlay. Reject later cable placement on the breaker tile. Gas and water pipe overlays remain independent, subject to their existing rules.
- It has no power demand, generation, battery charge, consumable fuel or automatic service wear. Manual isolation needs no auxiliary power.
- New construction begins **open**, in `manual` mode. The player chooses when to close it and whether to enable `wet_fault` protection.
- State: `protection: { kind: 'breaker', direction: 'east', enabled: false, mode: 'manual', tripped: false, cause: null }`. Keep `tripped` independent of the requested enabled state.
- Positive condition permits a requested, untripped contact to conduct; zero condition disconnects it. Existing structure repair restores condition without clearing a trip latch or changing requested enabled state. A damaged, requested-on untripped contact can consequently conduct again after repair. This first increment has no rating, current reading or overload timer.
- An open/tripped device disconnects its internal contact only. Adjacent ordinary cable remains intact. An external bypass route still powers the branch; opening one device must never disable remote cables magically.

The generic `electrical()` predicate currently recognizes output, demand and batteries. Add an explicit terminal/equipment classification for protection devices. Giving the breaker a fake demand/output solely to satisfy this predicate would create incorrect generation, maintenance and power-status behavior.

### Port representation

Represent two terminal vertices at the breaker tile and an internal switch edge. Each terminal connects only to the matching orthogonal neighbor. Do not model the tile as one four-way conductive vertex: that would connect input to output even while the switch is open. Ordinary tiles retain their existing adjacency rules.

For an open device, the two terminals may belong to different circuits. Keep tile entity ID `tile:<site>:<x>:<y>` stable and expose terminal circuit membership separately. Do not squeeze two memberships into the current single `tile.circuit` value. Ordinary equipment and existing circuit IDs should retain their established behavior where topology is unchanged; circuit IDs themselves are derived and can change when connectivity changes.

## First increment: detecting a supplied wet fault

A relay protects a **topological output branch**, not an inferred current path. For each enabled, closed relay in `wet_fault` mode, temporarily omit its own internal contact when finding the output-side connected component. Keep every other contact in its actual state. If its input terminal is still reachable, there is a bypass; automatic protection for that relay is unavailable and its inspector must say “Bypass route: branch cannot be isolated.” Manual opening still works and does not remove the bypass.

Use a no-energy allocation preview with the current closed contacts to determine which existing wet cables would receive the full 5 kW fault demand. A relay trips if one of those supplied faults belongs to its unambiguous output-side component. Emit the triggering cable IDs and reason `wet_fault`; do not label this an overload or measure invented current. Multiple faults are valid. Series relays can trip together: selective coordination is outside this first increment.

Apply all detected trips as a batch before the tick's energy commit, refresh topology and repeat until no more relay trips are due. Contacts only open, so passes are bounded by relay count. Finally execute the ordinary power update **once**. The eliminated tentative fault incurs no energy, heat or condition damage. Faults still energized by an output-side bank or alternate source do consume their normal 5 kJ and cause damage in the final plan. Opening the upstream relay does not promise that the branch is dead.

No available source means no supplied-fault detection and no automatic trip. A battery isolated behind the relay may energize a wet fault even when the input side has no generation; detecting that output-side fault can latch the relay but cannot stop that local battery. Report this plainly. This is a deliberately broad branch fault sensor, not a ground-fault-current measurement or a guarantee that opening the contact removes the fault's source.

The baseline `calculate(..., false)` preview wrote diagnostics and initialized tile fields. The new `previewPower(s,site)` is a separate pure plan over initialized state: it performs neither mutation nor initialization. `refreshPower` still refreshes derived diagnostics. Inspectors, loading and validation may expose `wouldTrip` but must not latch, emit trip events or commit energy. Never call the advancing update for a tentative pass. The first increment can use this without routed per-edge flow.

### First controls and recovery

Approved shared actions in `src/controls.js`:

| Action | Arguments | Behavior |
| --- | --- | --- |
| `power.breaker` | `site, x, y, enabled, direction, mode` | Validate atomically. Opening is immediate. Require an open contact before orientation/mode changes. Reject closing a tripped or broken device. |
| `power.breaker.reset` | `site, x, y` | Clear an intact, open device's trip latch/cause; set `enabled: false` so it remains open. Reject reset during a fire at the device. |
| Existing `job.order` | `kind: 'build'`, `building: 'breaker'` | Reserve/haul materials and complete construction. |
| Existing `job.order` | `kind: 'repair'` or `'remove'` | Use existing physical work and salvage; repair does not reset the latch. |

Reclosing into an unresolved supplied wet fault trips again on the next advancing tick. There is no automatic reset loop, free repair or automatic battery discharge.

## Later increment: honest overloads need routed power

Do not compare every breaker with the whole circuit's requested demand. That would trip an unrelated branch, trip on unmet demand, and miss reverse charging flow. The current flood-fill allocator cannot provide branch measurements on its own.

For this later overload increment, extract a **pure allocation plan** from `calculate` while preserving present fault/load priority and per-bank transfer rules. The plan contains each source's generation, each accepted load/fault demand, each bank's charge/discharge and curtailed generation. Planning must not consume reactor fuel, transfer charge, damage cable, heat rooms, emit events or change RNG. Apply these effects once, after protection decisions settle.

Then assign the planned source-to-sink transfers to physical graph routes:

1. Treat generators and discharging banks as finite sources; accepted wet faults, powered loads and charging banks are sinks. Exclude curtailed output from routed energy. Cancel same-node supply and demand first.
2. Pair remaining supply and demand deterministically, using the existing load order, source map order and bank order. Use shortest graph paths, with explicit map-position/terminal tie breaks. Sources may split their finite budget across sinks.
3. Sum signed transfers through each edge; reverse transfers cancel. The absolute net throughput through a protection contact is its measured kW for the one-second tick. Charging flow and battery backfeed count.
4. Ordinary cables remain ideal and unlimited in this increment. Only installed protective contacts have thresholds. Do not silently retrofit every legacy cable with an overload rating.

This is a deterministic transport model, **not a voltage, resistance or Kirchhoff solver**. Loops can reroute power after a trip. A tie-break change can affect which parallel branch carries the modeled load, so route ordering must be a documented stable rule with loop fixtures. The model is sufficient for finite branch allocation, isolation and useful failures without claiming real electrical current simulation.

### Proposed overload rules and tick order

Extend breaker modes with `overload` and `wet_fault_and_overload`, plus rating and timer state. Proposed allowed ratings are 4, 8, 16 or 32 kW, default 8; effective rating is `rating * hp / 100`. These ratings and counters do not belong to the first wet-fault increment.

In an overload mode, a breaker latches open after **three consecutive simulation ticks** whose planned net throughput exceeds its effective rating. A tick at or below the rating resets the counter to zero. Requested but unserved demand does not increment it. No source means zero flow and no trip; merely being wet is not a trip condition.

At `updatePower`, take one snapshot of counters and plan from the current topology. Determine due trips using that snapshot. Open those contacts and replan until no additional contact becomes due; each pass can only open contacts, so the loop is bounded by the installed device count. A contact's counter advances at most once per tick, even when topology is replanned. Resolve simultaneous due trips in a batch. The final plan supplies the counter values for contacts that remain closed; opened contacts reset their counter to zero and retain their latch.

Commit energy, reactor fuel/heat, wet-fault heat/damage and operation usage only from the final plan. The final tick that trips can therefore prevent the planned excessive transfer. The trip event must distinguish **attempted throughput** from final delivered energy. Earlier overload ticks really consume their supplied energy and may damage a wet cable.

`refreshPower`, controls, rendering and validation may calculate predictions but must never advance counters, trip equipment, consume fuel/charge or emit repeated events. A dry-run projection may expose `wouldTrip`, keeping actual latch state and current connectivity distinct. Preserve `refreshPower` as a read-only energy operation, including during load validation.

An 8 kW branch with 5 kW of normal loads plus one supplied 5 kW wet fault trips after the delay. A lone 5 kW fault on an 8 kW branch does **not** trip it. This example describes overload mode alone. Combined mode also applies the earlier supplied-wet-fault rule; electrical ground-fault sensing remains future work.

For the overload extension, add a validated rating field to the shared control while preserving prior modes. Require an open contact for mode, rating or orientation changes. Reset also clears the overload timer. A reset/reclose into unresolved demand can retrip. Reactor temperature trips remain independent.

## Follow-on using the same mechanism: disposable fuse

After the later overload and routing model pass acceptance, add `fuseBox` with the same two-terminal topology. Proposed build cost: **2 alloy, 1 component, 6 work**, including its first fuse. Start open. Ratings use the same 4/8/16/32 kW choices.

- State replaces breaker latch/counter with `blown: false`; orientation, requested enabled state and rating remain.
- A fuse blows on the first tick of planned throughput over its effective rating. It opens before energy commit using the same bounded replan phase. This is a coarse one-tick fuse model, not an I²t or arc simulation.
- A blown fuse cannot be reset by an instant action or generic repair. New `replaceFuse` work costs **1 alloy, 3 work**, reserves and hauls material normally, and requires a blown, open fuse box. Completion clears `blown` and leaves it open. Cancellation returns actual held/reserved material by current construction rules.
- Structure repair fixes condition only. Replacement must not fix structure damage. Revalidate target state when work completes so stale jobs cannot grant extra cartridges or salvage.
- Destruction and demolition follow normal structure rules. Salvage must not refund a cartridge already consumed by blowing; document its contribution separately if ordinary building salvage would otherwise include it.

Do not ship the fuse before the shared topology, plan/commit and event semantics are proven by the breaker. It adds a physical repair choice, not a second power allocator.

## Player interface and observations

Keep all controls in the selected-tile inspector and optional Power overlay. Show contact state, protection mode, input/output circuit labels and a plain reason such as “Open,” “Tripped: wet fault in branch,” “Bypass route: branch cannot be isolated,” or “Needs repair.” The implemented compact advisory exposes bypass and available output-side sources outside the details disclosure, including battery charge; exact terminal/fault identities remain in expandable details. Damaged-device hints explain latch/request-preserving repair. Add effective rating and measured/attempted throughput only when the later routed model exists. Use an orientation arrow and distinct open/tripped contact art. Preserve the existing held-click and focused-input refresh safeguards.

First derived observations expose `inputCircuit`, `outputCircuit`, `connected`, `bypassed`, `faultEntities`, `sourceEntities`, `wouldTrip`, `blocked` and readable `status` under `derived.electrical`. `sourceEntities` identifies available local generators/intact charged banks on the output side after omitting this contact; it does not measure throughput. Condition priority is `damaged`, `tripped`, `open`, `bypassed`, `manual`, `wet_fault`, `clear`. Breaker tile `circuit` remains null while both terminal memberships are exposed separately. Merge electrical derived data with existing reactor/gas/plumbing data rather than overwriting it. `protection` uses telemetry's `power` system.

The later overload extension would add `effectiveRating`, `plannedThroughput`, `lastDeliveredThroughput` and `overloadTicks`. These remain unimplemented. Keep predicted fields separate from last committed fields.

Implemented first-increment events are `power.breaker.changed`, `power.breaker.tripped`, `power.breaker.reset` and `power.cable.changed`, using stable tile IDs. Breaker events include `previous`/`next` protection state, `faultEntities`, `tick` and `cause` (`configuration`, `wet_fault` or `manual_reset`). No-op commands do not manufacture state-change events. Rejected controls still receive the standard shared action result.

`power.fuse.blown` and `power.fuse.replaced` remain future event proposals. The later overload extension would include attempted throughput and effective rating; no such measurements are invented for current wet-fault sensing.

A trip can happen within one tick and be followed by rerouting; an end-of-tick delta alone cannot preserve its order. The event is an observation, not proof that the breaker prevented a particular injury or a training reward. Recording remains optional, bounded and outside saves/RNG state.

## Migration, validation and accounting

The first increment uses schema36 after accepted plumbing/schema35. Migration adds no breaker, fuse, cable, material, charge, generation or fuel. Existing cables, switches, priorities, charge, wet water/plumbing, gas/smoke and energy ledgers remain unchanged. Derived terminal diagnostics can be recalculated, with old topology and ordinary allocation preserved. Later overload/fuse schemas remain unassigned.

Validate device placement, absence of a bypass overlay on the device tile, finite condition, allowed direction/mode/state combinations, and state ownership by the correct building. The later extension also validates finite rating/throughput and bounded integer timers. Validate new job target, fixed work/cost and carried/reserved materials. Reject malformed current saves instead of silently installing default protection state onto arbitrary tiles. Loading and validating must not trip or consume anything.

The existing energy invariant remains:

`stored + consumed + curtailed + discarded = initial + generated + injected`

Opening/tripping is not an energy sink. Do not count denied load as consumed or discarded; generation that cannot serve final loads/storage is curtailed by existing rules. A plan replay must never double-count reactor fuel/heat or wet-short damage. No new thermal loss, cable resistance, sparks, fire source or radiation is implied by this increment.

## Acceptance cases before claiming the first increment

1. The device is absent until finite supplies arrive and crew work completes. It starts open in manual mode. Placement rejects a cable overlay on its tile; only its two declared terminals connect.
2. Opening separates a simple branch, preserves each bank's charge and leaves another branch operating. An external bypass keeps the load supplied, marks protection unavailable and does not disable remote cables. A side-adjacent cable cannot bridge the device internally.
3. An output branch with a supplied 5 kW wet fault trips in `wet_fault` mode; manual mode does not trip. A wet tile without available fault power causes no trip, heat, damage or energy consumption. Detection names the actual cable entity.
4. Detection happens only on advancing ticks. Repeated inspection, refresh, validation, serialization and rejected actions neither trip nor emit events nor consume anything. Final topology without the supplied fault has no phantom wet-short damage or reactor/battery consumption from the discarded preview.
5. Output-side battery backfeed still supplies a fault after the input is isolated. Its real heat, damage and finite charge loss remain. The inspector explains the remaining source and does not claim the branch is safe.
6. Series and simultaneous relay trips terminate deterministically. A topology replan happens before one energy commit; reactor fuel/heat and water fault ledgers balance. Existing load priority and all-or-nothing rules remain.
7. Damage to zero disconnects; repair restores condition without clearing the latch. Reset leaves the relay open. Closing into a continuing supplied fault retrips on the next tick. Invalid mode/direction or reconfiguration while closed is rejected atomically.
8. Shared player/agent controls produce identical state. Named transient trip/reset events and terminal membership survive recording reconstruction. Recording on/off does not change save bytes, RNG or results.
9. Save before and after a trip; resumed simulation is identical to uninterrupted simulation. Migration preserves all existing gas, water, charge, energy, resources and cable controls; grants no equipment; runs once. Invalid state and altered energy ledgers are rejected.
10. With no protection devices, existing power/atmosphere/fire/water/reactor and full-suite behavior remains valid. Verify hidden inspector, overlay, held clicks and reload in the browser. A test count does not prove a complete electricity simulation.

### Additional gates for later overloads and fuses

- A supplied 10 kW route on an 8 kW branch trips on its third advancing tick. Repeated previews do not advance the timer; a low-flow tick resets it. High requested but unserved demand does not count. Charging and battery backfeed do count.
- Loop rerouting, simultaneous trips and series protection advance counters once and commit energy once. Route tie breaking is deterministic and documented. No temporary route plan consumes fuel, charge or fault energy.
- Save during an overload timer and resume identically. Validate finite rating/flow and bounded integer timers. Damaged condition reduces the threshold; repairing does not reset a latch.
- A fuse blows once on its first excessive tick. Generic repair/reset cannot replenish it. Paid replacement/cancellation preserves physical materials and leaves it open. Consumed cartridges do not reappear in demolition salvage.

## Implementation handoff and risks

**First increment accepted:** two-terminal connectivity, pure supplied-fault preview, physical construction, shared controls/telemetry and independent graph/conservation/migration/browser checks pass. The later overload/fuse stage still requires the routed-flow model and its separate acceptance cases above; do not infer it from wet-fault protection. Broader orbital progression remains tracked in [conversion inventory](conversion-inventory.md).

Primary first-increment risks are a preview consuming energy, a one-vertex contact leaking connectivity, branch backfeed being hidden, and output scope accidentally including the upstream circuit through a bypass. `validatePower` currently recomputes expected diagnostics from a shallow tile clone; nested protection state must not mutate during that read. Existing `powerStatus`, one-circuit-per-tile assumptions, build predicates, maintenance classification and schema validation all need explicit review.

The later overload model additionally risks loop route tie breaking changing trip behavior and repeated tentative plans advancing timers. Automatic load shedding, electrical ground-fault sensors, terminal controllers, cable thermal capacity, resistive heating and inter-site transmission remain future work. This design adds physical isolation first while preserving finite energy and the colony's failure/recovery systems.
