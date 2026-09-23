# Compartments, breathing, and life support

Implemented September 16, 2026. Values below are game balancing units, not an engineering or chemistry model.

## Stored quantities

Each compartment stores oxygen, inert gas, and exhaled gas (`co2`). Each floor tile contributes one volume unit; nominal pressure corresponds to ten gas units per tile. Pressure, composition and the summary air reading are derived from those quantities.

Changing a room's shape preserves its gas. Splitting distributes it between the resulting volumes; joining adds quantities; expanding into empty floor lowers pressure. Building walls into a room can compress its remaining gas. Removing its last volume records the gas as escaped. A topology rebuild never resets a room to full air.

Stored breathing mix (`air` in inventories) contributes 21% oxygen and 79% inert gas when supplied. Suits store pure oxygen at 0.1 gas unit per percentage point. Room gas, stored mix, suit reserves and escaped gas balance unless new mix is produced or a new colony/legacy migration establishes initial supplies.

## Breathing and recovery

Crew breathe ambient oxygen when the compartment meets all current game thresholds:

- Pressure from 55% through 150% of nominal.
- Oxygen partial pressure from 16% through 30% of nominal total pressure.
- Exhaled gas no more than 2% of the mixture.

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

A doorway occupied by living crew cannot be sealed shut. Broken doors remain open. Broken walls leak but remain movement obstacles until dismantled. A pair of doors and a chamber allows manual isolation, but automatic airlock interlocks and pressure cycling are not implemented.

## Supply chain

Life support still draws 3 kW with Critical priority on its connected electrical circuit. While powered, it recycles up to 0.15 exhaled-gas unit per tick into breathable gas, scaled by condition. It can recycle without make-up supplies. Replenishing lost gas requires actual delivered breathing mix in its input buffer.

Life support requests up to ten units, delivered by existing haulers. It supplies at most two gas units per tick. If oxygen is depleted while pressure is already high, it replaces part of the old mixture and accounts for the displaced gas as vented. Empty supplies, power loss, disabled machinery or missing compartments appear in the inspector.

An atmosphere processor consumes one water and produces ten breathing-mix units with 25 units of Production work from an adjacent operator while powered. It draws 4 kW and costs 8 alloy plus 2 components. This recipe abstracts processing water and local volatiles; ambient intake, chemistry, catalysts, waste processing and portable gas containers are not simulated yet. Output must be hauled to storage, then to life support or a gas supply tank. Initial colonies receive 160 stored mix units.

This connects water, power, hauling, seals and survival. An outage stops recycling and production; exhaled gas accumulates; crew switch to suits and crops stop; restoring power and delivery can recover the habitat. Critical supply priorities are still handled by the simple existing job scheduler.

## Inspection and persistence

Pressure, oxygen fraction, exhaled gas and compartment size appear in the existing hidden tile inspector. Door modes and life-support supply status are contextual controls. The colony drawer reports stored breathing mix. The permanent resource bar retains its prior contents. Occupied habitat facilities generate a log entry when air becomes unsafe and another when it becomes breathable again.

Schema 5 originally introduced gas quantities, derived readings, escaped/supplied-gas counters and door state. Schemas 1–4 migrate their old room air percentages into proportional quantities of nominal mixture. Legacy saves without breathing mix receive one 160-unit commissioning supply in a depot or a recoverable pile. Subsequent loads do not grant more. Volume, composition, topology, counters, door modes and cached readings are validated on import. Existing failed-load preservation remains in place. This is the original atmosphere migration, not the current save-version number; see [verification status](verification-status.md).

## Evidence and remaining scope

The original atmosphere release passed 252 tests, including 20 atmosphere cases. This historical evidence covers conserved room edits, pressure equalization, composition mixing, breathing and suit refill, contamination, finite supplies, recycling, an outage/recovery chain, breach area and room size, damage, door modes, whole-system gas accounting, preflight supplies, processor-to-life-support deliveries, deterministic saves, migration and malformed state. Source syntax and documentation links passed at that checkpoint. Current integrated results are in [verification status](verification-status.md).

The original atmosphere checkpoint did not include browser verification of its inspector, door controls and sprites; later scoped browser checks are listed in verification status. Initial [fire, smoke and supplied suppression](fire-and-smoke.md) are now implemented. Temperature-dependent pressure, additional contaminants, airlock controllers, decompression injuries, species-specific breathing and orbital habitat construction remain unfinished. Connected circuits and per-bank reserves now determine which equipment receives power; see [electrical networks](power-networks.md).

Room thermal energy and climate control are now implemented separately from gas quantities; see [temperature and climate](temperature-and-climate.md). Gas-temperature pressure coupling remains unfinished.

Initial [gas supply networks](gas-networks.md) add finite tanks, pipes/valves, directional powered pumps and regulated vents. Existing life support remains automatic and supplied. [Retained exhaust and filtration](exhaust-and-filtration.md) is implemented and verified in schema 34: selective CO2/smoke collection or proportional bulk exhaust into finite physical storage, with dirty networks able to contaminate supply. Gas-temperature pressure coupling remains future work.
