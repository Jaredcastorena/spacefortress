# Compartments, breathing, and life support

Original atmosphere implementation: September 16, 2026. Updated October 9 for v0.1.4 breathing diagnostics, paused-import fix and subsequent local finite-reserve evidence; v0.1.3 already includes hex compartments and experimental cycling airlocks. Values below are game balancing units, not an engineering or chemistry model.

## Stored quantities

Each compartment stores oxygen, inert gas, and exhaled gas (`co2`). Each floor tile contributes one volume unit; at 20 °C, nominal pressure corresponds to ten gas units per tile. Local schema75 multiplies gas density by absolute room temperature relative to 293.15 K. Pressure and oxygen partial pressure therefore change with heat; composition stays a fraction of actual gas. See [room pressure](room-pressure.md) for the law, migration and remaining thermal limits.

Changing a room's shape preserves its gas. Splitting distributes it between the resulting volumes; joining adds quantities; expanding into empty floor lowers pressure. Building walls into a room can compress its remaining gas. Removing its last volume records the gas as escaped. A topology rebuild never resets a room to full air.

Stored breathing mix (`air` in inventories) contributes 21% oxygen and 79% inert gas when supplied. Suits store pure oxygen at 0.1 gas unit per percentage point. Room gas, stored mix, suit reserves and escaped gas balance unless new mix is produced or a new colony/legacy migration establishes initial supplies.

## Breathing and recovery

Crew breathe ambient oxygen when they are inside a compartment that meets all current game thresholds:

- Smoke below the breathing limit.
- Pressure from 55% through 150% of nominal.
- Oxygen partial pressure from 16% through 30% of nominal total pressure.
- Exhaled gas no more than 2% of the mixture.

**Oxygen concentration alone does not show whether a room is breathable.** Pressure-adjusted oxygen is the oxygen fraction multiplied by room pressure, expressed against nominal total pressure. A room can contain roughly 21% oxygen in its mixture yet hold too little gas for that oxygen to reach the 16% minimum. In the historical density-only tick-144 stop, concentration was 20.736% but total pressure was 76.4248% of nominal: pressure-adjusted oxygen was only 15.8476%. Its 55.46668 oxygen units were below the 56 required for that room.

The shared breathing check reports the first failed limit in the order below. The inspector and local-agent observations use the same classification as crew breathing; a clear result means every listed limit passes.

| Failure reason | Meaning |
| --- | --- |
| Exterior (`exterior`) | No habitat compartment is present. |
| Smoke (`smoke`) | Smoke has reached the breathing limit. |
| Low pressure (`low_pressure`) | Total pressure is below 55% of nominal. |
| High pressure (`high_pressure`) | Total pressure exceeds 150% of nominal. |
| Low oxygen (`low_oxygen`) | Pressure-adjusted oxygen is below 16% of nominal. |
| High oxygen (`high_oxygen`) | Pressure-adjusted oxygen exceeds 30% of nominal. |
| Exhaled gas (`high_co2`) | Exhaled gas exceeds 2% of the mixture. |

For low oxygen, get stored breathing mix physically delivered into life support and isolate exterior door losses. A stockpile count or a powered machine does not prove that mix has reached the room. Fixing one limit may expose another; the shared thresholds and gas simulation are unchanged by these diagnostic labels.

Normal breathing converts 0.0075 oxygen unit per tick into the same quantity of exhaled gas. Assigned work uses 0.01; the solar site uses 0.018. Suit breathing consumes its stored oxygen and accounts for the exhaust outside. These conversions preserve gas-unit counts, not a detailed chemical mass balance.

Safe rooms can refill suits by up to two percentage points per tick, taking that oxygen from the room. Refill stops before drawing oxygen below the breathing threshold. Unsafe rooms cause crew to use suits and cannot support normal bunk recovery or crop production. Existing recovery intentions seek reachable safe compartments when suit reserves run low.

Preflight suit top-ups consume reachable stored breathing mix; unused inert gas is accounted as vented. Returning crew retain their remaining suit reserves and refill through ordinary habitat behavior. Shuttle cabin life support and respiration during transit remain abstracted.

### Stored mix for suit recovery

Crew seeking air first try a reachable breathable compartment. When none is reachable, they can walk to a local stockpile containing packaged breathing mix, or an operational dock with mix in its imports. Supply is used only after arrival, with normal routes and airlock interlocks. Each tick transfers at most two suit percentage points, up to the existing 90% recovery target; reaching that target completes the recovery intention immediately.

One mix unit provides 0.21 oxygen unit, equivalent to 2.1 suit percentage points. Its remaining 0.79 inert unit is vented locally. Refills consume finite physical inventory and can be partial when a source runs out. The transfer fills the suit; supplying room gas still requires life-support delivery. Boarding continues to use the same mix conversion for its paid full-suit refill.

Empty, unreachable or remote reserves provide no refill. Existing job, carrier and shuttle supplies are separate owners. Breathing, fatigue, other emergencies and hazards continue during this recovery. A colony with no packaged mix needs another supply or engineering route; this mechanism does not create air.

### Manual suit oxygen release

The crew inspector has a collapsed **Emergency oxygen** form. It releases an integer from 1 to 100 points from that crew member's suit into their current sealed compartment. One point transfers 0.1 oxygen units. The actor must be alive, mobile and at a physical site; the requested reserve and nominal room gas capacity must both be available. The operation is all-or-nothing and does not move the actor or interrupt work, cargo or recovery.

This spends the actor's breathing reserve and can exhaust it. Pure oxygen can make the room oxygen-rich and unsafe under the existing breathing rules; nominal capacity is not a safe-composition guarantee. The form displays both warnings and the current maximum.

Only suit oxygen and room oxygen change ownership. The existing atmosphere `injected.oxygen` ledger records room ingress; `refilled`, escaped gas and gas-network delivery counters remain unchanged. Total physical gas remains conserved across suits, rooms, inventories, pipes and escaped gas. No new save fields or simulation tick are needed. The shared `crew.suit.release` action and `crew.suit.released` event are described in the [simulation interface](simulation-interface.md).

## Leakage and doors

Exposed floor edges, damaged hull seals and open doors create gas connections. Flow depends on the difference in temperature-adjusted pressure, opening conductance and compartment volume. Transfers use a snapshot of source mixtures and bounded outgoing quantities, preventing negative inventories when several openings drain one room. Connected rooms also exchange mixture at equal pressure, so contamination can spread without a pressure imbalance.

Pressure doors have three inspector controls:

| Mode | Crew movement | Gas behavior |
| --- | --- | --- |
| Automatic | Opens on entry and departure | Open for three ticks after passage |
| Hold open | Passable | Rooms exchange gas continuously |
| Seal shut | Blocks routes | Intact seals isolate atmosphere |

A doorway occupied by living crew cannot be sealed shut. Broken doors remain open. Broken walls leak but remain movement obstacles until dismantled. A pair of doors and a chamber allows manual isolation. Experimental automatic airlock interlocks and pressure cycling are implemented in v0.1.3: a controller coordinates two doors and real extraction, storage, pumping and refill equipment. Crew keep their work and cargo while waiting; power, gas capacity, contamination and habitat conditions can pause passage. See [pressure-cycling airlocks](airlock-cycling-design.md) for the physical requirements.

This does not establish an ordinary paid installation. Building the enclosure, commissioning it with finite gas and completing a named parcel roundtrip remain unfinished acceptance work. An ordinary automatic door that opens directly outside still loses habitat gas; a controller or reserve cannot be assumed merely because two doors exist.

## Supply chain

Life support still draws 3 kW with Critical priority on its connected electrical circuit. While powered, it recycles up to 0.15 exhaled-gas unit per tick into breathable gas, scaled by condition. It can recycle without make-up supplies. Replenishing lost gas requires actual delivered breathing mix in its input buffer.

Life support requests up to ten units, delivered by existing haulers. At full condition it supplies at most two gas units per tick, limited by its actual delivered input. If oxygen is depleted while pressure is already high, it replaces part of the old mixture and accounts for the displaced gas as vented. Empty supplies, power loss, disabled machinery or missing compartments appear in the inspector.

An atmosphere processor consumes one water and produces ten breathing-mix units with 25 units of Production work from an adjacent operator while powered. It draws 4 kW and costs 8 alloy plus 2 components. This recipe abstracts processing water and local volatiles; ambient intake, chemistry, catalysts, waste processing and portable gas containers are not simulated yet. Output must be hauled to storage, then to life support or a gas supply tank. Initial colonies receive 160 stored mix units.

Stored mix, carried mix, the life-support input and room gas are distinct physical owners. Air elsewhere in the colony cannot be injected until a hauler completes delivery. Recycling exhaled gas does not replace gas already lost outside, and a limited supply rate can be overtaken by an open exterior doorway. Sustained operation requires enough production, delivered reserves and isolation for the actual loss rate.

This connects water, power, hauling, seals and survival. An outage stops powered recycling and production, and exhaled gas accumulates. Crew rely on suits if the remaining room gas becomes unsafe; sufficient room reserves can keep breathing safe through an outage. Restoring power and delivery can recover the habitat. Critical supply priorities are still handled by the simple existing job scheduler.

## Player guidance: recovering finite air

1. Reduce unnecessary exterior trips and keep direct exterior doors closed when they are not needed. An open route outside can lose gas faster than life support replaces it.
2. Keep life support and necessary temperature control powered. Pause idle, nonessential machinery when it competes with the atmosphere processor for power.
3. Use the existing processor with physically delivered water and a Production worker. Its air output must reach life support; stored or carried mix alone does not refill the room.
4. Watch **Oxygen at this pressure**, the actual life-support input and crew suit reserves. A room just at the 16% breathing minimum may have little room for further loss or suit charging, even when concentration looks normal.
5. Preserve a rested operator and hauler while recovering air. Unsafe rooms prevent normal rest, and low suit air can interrupt work. Check each crew member’s `derived.work` reading and existing intention alongside their energy and suit reserve; the processor needs 25 work per batch.
6. Order finite batches and preserve water for the next supply stage. The measured reserve below used 24 water in that particular sealed colony; required quantities depend on room size, existing gas, losses, suit use and equipment. It is not a universal recovery recipe.

## Inspection and persistence

Pressure, oxygen fraction, exhaled gas and compartment size appear in the existing hidden tile inspector. The v0.1.4 diagnostics label the separate readings **Oxygen concentration** and **Oxygen at this pressure**, with a 16–30% nominal range for the latter. The first failed breathing limit appears in a full-width, left-aligned explanation. Door modes and life-support supply status are contextual controls. The colony drawer reports stored breathing mix. The permanent resource bar retains its prior contents. Occupied habitat facilities generate a log entry when air becomes unsafe and another when it becomes breathable again. Local-agent room observations retain their existing breathable flag and add the same derived breathing status, including the reason and oxygen limits. These are read-only diagnostics; they add no saved gas, resources or new gameplay action.

The v0.1.4 import fix preserves the actual speed selected before opening the importer. Completion, failure and cancellation restore that speed, including pause; the remembered last nonzero speed for time controls is separate. Importing an unsafe checkpoint while paused therefore allows inspection without silently advancing its simulation. No saved state or schema change is involved.

Schema 5 originally introduced gas quantities, derived readings, escaped/supplied-gas counters and door state. Schemas 1–4 migrate their old room air percentages into proportional quantities of nominal mixture. Legacy saves without breathing mix receive one 160-unit commissioning supply in a depot or a recoverable pile. Subsequent loads do not grant more. Volume, composition, topology, counters, door modes and cached readings are validated on import. Existing failed-load preservation remains in place. This is the original atmosphere migration, not the current save-version number; see [verification status](verification-status.md).

## Evidence and remaining scope

The shared status core passed 25 focused checks, covering failure reasons, preserved threshold boundaries, unchanged gas state and the actual tick-144 low-oxygen condition. One full local Node run passed 1,282 checks, zero failures and one intentional skip with 242 inputs stable. A subsequent presentation-only change passed its seven affected panel checks; the full suite was not repeated for that layout change. Browser review confirmed that the original tick-144 import stayed paused, retained its 02:24 clock and showed 20.7% concentration versus 15.85% nominal oxygen, with the low-oxygen explanation across the inspector width. These results cover diagnostics and paused import, not sustainable air. Save schema 46 and gas behavior are unchanged. Exact source, required CI/Pages and hosted results are tracked in the [v0.1.4 release record](https://github.com/Jaredcastorena/spacefortress/releases/tag/v0.1.4); no deployment outcome follows from these local checks.

Read-only diagnosis of the frozen ordinary trial found life support powered but its input empty while 24 breathing-mix units remained stored or carried elsewhere. Venting accounted for 99.45% of measured room withdrawals. All crew and animals were still healthy when the safety stop fired. This explains the measured failure without changing gas arithmetic or granting supplies. The original tick-144 livestock-trial stop remains unchanged.

### Separate paid recovery: first stop at tick 384

A new bounded recovery continued the physical tick-144 state for 240 ticks and six commands. Crew paid eight alloy and two components for an atmosphere processor, completed it at tick 163, and produced ten air from one water and 25 Production work at tick 184. The attempt reached its tick-384 budget without a breathable tick. All seven crew and five animals retained full health and no injury; suits covered oxygen needs and four reloads were exact. The sealed room then held 50.715774 oxygen units against a minimum of 56, with no stored or carried air remaining. This measured stop was preserved.

### Reviewed continuation: bounded recovery at tick 460

Reusing that paid infrastructure, one continuation ran 384→460: **76 ticks and three commands**. Four batches completed at ticks 399, 414, 433 and 452, producing **40 air from four water**. Home was breathable for 12 consecutive ticks, 449–460, and the processor was paused at the first qualifying result. Its fifth batch retained one committed water and 6.333818 of 25 work; that paid progress was not refunded or discarded.

All seven crew and five animals stayed at 100 health with zero injury and no unmet oxygen. Three reloads were exact, recording was complete and 97 source files remained unchanged. Physical accounting matched within a largest floating difference of 2.28×10⁻¹³; 34.5 water and ten air remained across physical owners.

**The tick-460 reserve was still thin.** At that stop the sealed room had exactly 56 oxygen units, its minimum, and 78.06% nominal pressure. Suits held 76.79–78.49%. This stage proved bounded recovery under its measured conditions; it did not establish room/suit reserves or exterior endurance. Its checkpoint and the earlier stops remain preserved.

### Finite reserve through two nights: ticks 460–951

One reviewed continuation reused the paid infrastructure and unchanged published v0.1.4 runtime. It ran **491 ticks and four public commands**, completing 24 batches including the previously committed batch: **240 air from 24 water**. The habitat passed all 491 end-of-tick breathing checks, including both nights. At the stop, pressure was 100% of nominal and room oxygen was 63.010370 units out of a nominal 350, or **18.00296%**. All seven suits reached 100%; all seven crew and five animals retained 100 health with zero injury.

Three checkpoints reloaded exactly. The complete trace contained 2,174 records; all 97 source files were unchanged. Resource accounting matched exactly, with a maximum gas-accounting difference of 1.2×10⁻¹². The processor was paused and empty; automatic product collection for the target bristleback was disabled while its care remained unchanged.

**The remaining supplies are finite:** 10.5 water, 23 food, 14 alloy, no components and **no packaged air**. This accepts the measured indoor room/suit reserve through two nights. It does not establish sustained exterior work, paid airlock commissioning, indefinite endurance or the complete ordinary livestock-to-meal chain. The next stage needs a reviewed water/air supply plan from this actual endpoint. See [verification status](verification-status.md) for the preserved stages and evidence.

The original atmosphere release passed 252 tests, including 20 atmosphere cases. This historical evidence covers conserved room edits, pressure equalization, composition mixing, breathing and suit refill, contamination, finite supplies, recycling, an outage/recovery chain, breach area and room size, damage, door modes, whole-system gas accounting, preflight supplies, processor-to-life-support deliveries, deterministic saves, migration and malformed state. Source syntax and documentation links passed at that checkpoint. Current integrated results are in [verification status](verification-status.md).

The original atmosphere checkpoint did not include browser verification of its inspector, door controls and sprites; later scoped browser checks are listed in verification status. Initial [fire, smoke and supplied suppression](fire-and-smoke.md) are now implemented. Room temperature now affects pressure. Gas-carried heat, additional contaminants, decompression injuries and species-specific breathing remain unfinished. Cycling airlock controllers and supplied orbital construction exist within their documented scopes; ordinary paid airlock commissioning and full outpost endurance/resupply acceptance remain unfinished. Connected circuits and per-bank reserves now determine which equipment receives power; see [electrical networks](power-networks.md).

Room thermal energy and climate control are now implemented separately from gas quantities; see [temperature and climate](temperature-and-climate.md). Shared room-temperature pressure is now implemented; gas-carried heat and pipe temperature remain unfinished.

Initial [gas supply networks](gas-networks.md) add finite tanks, pipes/valves, directional powered pumps and regulated vents. Existing life support remains automatic and supplied. [Retained exhaust and filtration](exhaust-and-filtration.md) is implemented and verified in schema 34: selective CO2/smoke collection or proportional bulk exhaust into finite physical storage, with dirty networks able to contaminate supply. These devices now use room-temperature pressure targets; pipe gas still uses a fixed 20 °C reference.
