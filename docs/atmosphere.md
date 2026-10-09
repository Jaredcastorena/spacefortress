# Compartments, breathing, and life support

Original atmosphere implementation: September 16, 2026. Updated October 9 for the unreleased breathing diagnostics, paused-import fix and bounded recovery; v0.1.3 already includes hex compartments and experimental cycling airlocks. Values below are game balancing units, not an engineering or chemistry model.

## Stored quantities

Each compartment stores oxygen, inert gas, and exhaled gas (`co2`). Each floor tile contributes one volume unit; nominal pressure corresponds to ten gas units per tile. Pressure, composition and the summary air reading are derived from those quantities.

Changing a room's shape preserves its gas. Splitting distributes it between the resulting volumes; joining adds quantities; expanding into empty floor lowers pressure. Building walls into a room can compress its remaining gas. Removing its last volume records the gas as escaped. A topology rebuild never resets a room to full air.

Stored breathing mix (`air` in inventories) contributes 21% oxygen and 79% inert gas when supplied. Suits store pure oxygen at 0.1 gas unit per percentage point. Room gas, stored mix, suit reserves and escaped gas balance unless new mix is produced or a new colony/legacy migration establishes initial supplies.

## Breathing and recovery

Crew breathe ambient oxygen when they are inside a compartment that meets all current game thresholds:

- Smoke below the breathing limit.
- Pressure from 55% through 150% of nominal.
- Oxygen partial pressure from 16% through 30% of nominal total pressure.
- Exhaled gas no more than 2% of the mixture.

**Oxygen concentration alone does not show whether a room is breathable.** Pressure-adjusted oxygen is the oxygen fraction multiplied by room pressure, expressed against nominal total pressure. A room can contain roughly 21% oxygen in its mixture yet hold too little gas for that oxygen to reach the 16% minimum. In the measured tick-144 stop, concentration was 20.736% but total pressure was 76.4248% of nominal: pressure-adjusted oxygen was only 15.8476%. Its 55.46668 oxygen units were below the 56 required for that room.

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

## Leakage and doors

Exposed floor edges, damaged hull seals and open doors create gas connections. Flow depends on the difference in gas density, opening conductance and compartment volume. Transfers use a snapshot of source mixtures and bounded outgoing quantities, preventing negative inventories when several openings drain one room. Connected rooms also exchange mixture at equal pressure, so contamination can spread without a pressure imbalance.

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

This connects water, power, hauling, seals and survival. An outage stops recycling and production; exhaled gas accumulates; crew switch to suits and crops stop; restoring power and delivery can recover the habitat. Critical supply priorities are still handled by the simple existing job scheduler.

## Inspection and persistence

Pressure, oxygen fraction, exhaled gas and compartment size appear in the existing hidden tile inspector. The unreleased diagnostics label the separate readings **Oxygen concentration** and **Oxygen at this pressure**, with a 16–30% nominal range for the latter. The first failed breathing limit appears in a full-width, left-aligned explanation. Door modes and life-support supply status are contextual controls. The colony drawer reports stored breathing mix. The permanent resource bar retains its prior contents. Occupied habitat facilities generate a log entry when air becomes unsafe and another when it becomes breathable again. Local-agent room observations retain their existing breathable flag and add the same derived breathing status, including the reason and oxygen limits. These are read-only diagnostics; they add no saved gas, resources or new gameplay action.

The local import fix preserves the actual speed selected before opening the importer. Completion, failure and cancellation restore that speed, including pause; the remembered last nonzero speed for time controls is separate. Importing an unsafe checkpoint while paused therefore allows inspection without silently advancing its simulation. No saved state or schema change is involved.

Schema 5 originally introduced gas quantities, derived readings, escaped/supplied-gas counters and door state. Schemas 1–4 migrate their old room air percentages into proportional quantities of nominal mixture. Legacy saves without breathing mix receive one 160-unit commissioning supply in a depot or a recoverable pile. Subsequent loads do not grant more. Volume, composition, topology, counters, door modes and cached readings are validated on import. Existing failed-load preservation remains in place. This is the original atmosphere migration, not the current save-version number; see [verification status](verification-status.md).

## Evidence and remaining scope

The shared status core passed 25 focused checks, covering failure reasons, preserved threshold boundaries, unchanged gas state and the actual tick-144 low-oxygen condition. One full local Node run passed 1,282 checks, zero failures and one intentional skip with 242 inputs stable. A subsequent presentation-only change passed its seven affected panel checks; the full suite was not repeated for that layout change. Browser review confirmed that the original tick-144 import stayed paused, retained its 02:24 clock and showed 20.7% concentration versus 15.85% nominal oxygen, with the low-oxygen explanation across the inspector width. These results cover diagnostics and paused import, not sustainable air.

Read-only diagnosis of the frozen ordinary trial found life support powered but its input empty while 24 breathing-mix units remained stored or carried elsewhere. Venting accounted for 99.45% of measured room withdrawals. All crew and animals were still healthy when the safety stop fired. This explains the measured failure without changing gas arithmetic or granting supplies. The original tick-144 livestock-trial stop remains unchanged.

### Separate paid recovery: first stop at tick 384

A new bounded recovery continued the physical tick-144 state for 240 ticks and six commands. Crew paid eight alloy and two components for an atmosphere processor, completed it at tick 163, and produced ten air from one water and 25 Production work at tick 184. The attempt reached its tick-384 budget without a breathable tick. All seven crew and five animals retained full health and no injury; suits covered oxygen needs and four reloads were exact. The sealed room then held 50.715774 oxygen units against a minimum of 56, with no stored or carried air remaining. This measured stop was preserved.

### Reviewed continuation: bounded recovery at tick 460

Reusing that paid infrastructure, one continuation ran 384→460: **76 ticks and three commands**. Four batches completed at ticks 399, 414, 433 and 452, producing **40 air from four water**. Home was breathable for 12 consecutive ticks, 449–460, and the processor was paused at the first qualifying result. Its fifth batch retained one committed water and 6.333818 of 25 work; that paid progress was not refunded or discarded.

All seven crew and five animals stayed at 100 health with zero injury and no unmet oxygen. Three reloads were exact, recording was complete and 97 source files remained unchanged. Physical accounting matched within a largest floating difference of 2.28×10⁻¹³; 34.5 water and ten air remained across physical owners.

**The reserve is still thin.** At the stop the sealed room had exactly 56 oxygen units, its minimum, and 78.06% nominal pressure. Suits held 76.79–78.49%. This proves bounded recovery under the measured conditions, not a durable room or suit reserve, repeated exterior-work endurance or the complete ordinary food chain. Further acceptance must establish those margins before claiming sustainable operation. See [verification status](verification-status.md) for the frozen evidence and earlier stops.

The original atmosphere release passed 252 tests, including 20 atmosphere cases. This historical evidence covers conserved room edits, pressure equalization, composition mixing, breathing and suit refill, contamination, finite supplies, recycling, an outage/recovery chain, breach area and room size, damage, door modes, whole-system gas accounting, preflight supplies, processor-to-life-support deliveries, deterministic saves, migration and malformed state. Source syntax and documentation links passed at that checkpoint. Current integrated results are in [verification status](verification-status.md).

The original atmosphere checkpoint did not include browser verification of its inspector, door controls and sprites; later scoped browser checks are listed in verification status. Initial [fire, smoke and supplied suppression](fire-and-smoke.md) are now implemented. Temperature-dependent pressure, additional contaminants, decompression injuries and species-specific breathing remain unfinished. Cycling airlock controllers and supplied orbital construction exist within their documented scopes; ordinary paid airlock commissioning and full outpost endurance/resupply acceptance remain unfinished. Connected circuits and per-bank reserves now determine which equipment receives power; see [electrical networks](power-networks.md).

Room thermal energy and climate control are now implemented separately from gas quantities; see [temperature and climate](temperature-and-climate.md). Gas-temperature pressure coupling remains unfinished.

Initial [gas supply networks](gas-networks.md) add finite tanks, pipes/valves, directional powered pumps and regulated vents. Existing life support remains automatic and supplied. [Retained exhaust and filtration](exhaust-and-filtration.md) is implemented and verified in schema 34: selective CO2/smoke collection or proportional bulk exhaust into finite physical storage, with dirty networks able to contaminate supply. Gas-temperature pressure coupling remains future work.
