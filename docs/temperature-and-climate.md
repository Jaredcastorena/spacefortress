# Temperature and climate control

Implemented locally, September 16, 2026. This is a game-scale habitat model; the constants are provisional balancing values.

Latest extension: [colony reactors and exterior radiators](reactors.md) add fueled generation, core-to-room heat and manual overheat recovery in schema 31. Historical evidence below describes the earlier foundational release.

## Stored heat and room changes

Each compartment owns `heat`, with thermal capacity of 20 units per floor cell. Displayed Celsius temperature is `heat / capacity − 273.15`. This represents habitat structure and contents separately from the existing gas inventory. Removing air does not instantly remove the room's stored heat.

Splitting a room assigns each retained floor cell its previous share of heat. Merging rooms mixes those shares. New room cells enter at the site's exterior temperature; cells removed from room volumes remove their share. The site ledger records this added/removed thermal mass. Room edits do not silently reset existing cells to a comfortable temperature.

The thermal ledger also records heat entering/leaving through boundaries, powered equipment heat, heating and cooling. Validation compares those flows with actual stored heat. Thermal and electrical ledgers describe different stages of the same system; do not add their totals together as if they were separate supplies.

## Heat sources and exchange

Intact bulkheads conduct slowly. Damaged hulls conduct faster, and open/broken doors exchange heat quickly. Open room edges exchange directly with the exterior. Internal exchanges subtract from one room and add to another. Transfer amounts are bounded to avoid overdrawing a room's heat.

Surface exterior temperature is 8 °C during daylight and −35 °C at night. The authored orbital sites have fixed thermal reference temperatures: wreck −60, comet −100 and solar region 90 °C. These are environmental gameplay values, not realistic vacuum air temperatures or an orbital physics model.

Powered equipment other than climate units adds 0.35 thermal units per rated kW each tick to its compartment. Enabled idle machines retain their existing rated power demand and therefore still emit this heat. Unpowered or paused machinery does not. There is no free heat from disconnected equipment.

## Climate units

A climate unit costs **6 alloy and 1 component**, takes 10 construction work, and requires wired power. It draws **2 kW** while enabled, including at its target. It heats or cools its own compartment toward an integer target from −20 to 35 °C, at up to 12 thermal units per tick scaled by condition. The outdoor heat source/sink is abstracted; pipes and external radiators are future work.

The hidden inspector exposes the target, pause/resume, equipment status, temperature, exterior temperature, electrical priorities and existing maintenance controls. Pausing releases power demand immediately. Damage reduces output; loss of power stops control while room heat continues to exchange. Construction and repairs use the existing physically delivered supplies. New colonies do not receive a free climate unit.

## Crew and production consequences

Crew accumulate signed thermal strain in breathable rooms outside 5–35 °C. The rate is 0.012 times degrees outside that range per tick; strain recovers by 0.8 per tick within range. Pressure suits use a wider −120 to 100 °C range when the atmosphere is unbreathable. Suit thermal regulation is currently abstract and does not consume a separate battery.

Strain reduces work rate. At magnitude 45, crew interrupt work and seek reachable breathable, temperate shelter; held cargo stays with them. Recovery finishes at magnitude 10 or less. A paid meal is finished before a temperature interruption so its portions are not discarded. Suit-air emergencies retain precedence. If no safe compartment is reachable, crew report that obstruction. Incapacitated patients still require rescue.

Above magnitude 70, exposure causes persistent heat/cold injuries through the existing medicine system. Ordinary health recovery cannot erase those injuries. Safe bunks, floor rest, medical cots, surface rescue destinations and downtime locations require suitable temperature. Strongly affected crew cannot launch an expedition or take a rescue assignment.

Hydroponics requires **10–35 °C** and medical synthesizers require **5–40 °C**. Out-of-range machines retain batch ingredients and progress and release their operator; work resumes when conditions recover. Other current recipes have no temperature gate. Habitat warnings report unsafe temperatures around bunks, farms or cots.

## Saves and verification

Schema **16** migrates versions 1–15. Version-14 saves receive rooms at 20 °C, zero crew thermal strain and a matching initial heat ledger. Inventories, injuries, jobs, machinery progress and electrical charge are preserved. Current saves retain room heat, ledgers, climate settings, strain and temperature recovery intentions. Corrupt heat totals, controls and strain are rejected.

**252 tests pass**, including 17 thermal cases covering initialization, room splits/merges/removal, internal exchange, doors, hull damage, equipment heat, climate targets/pause, damaged/disconnected units, actual construction/demolition, crop interruption/recovery, cargo-preserving shelter movement, paid meals, persistent injuries, suit protection, unsafe cots, deterministic continuation, migration and malformed saves.

Isolated headless Firefox checked temperature readings, climate target edits surviving periodic refresh, pause/resume and power demand, saved settings, crew thermal strain and the construction option. Screenshots were inspected. This exposed inherited inspector scrolling when switching from machinery to a crew member; selection changes now reset the drawer to its heading. The scoped application log reported no runtime errors. No packages or game network calls were added.

## Remaining scope

Medicine spoilage, item thermal inertia, insulation upgrades, thermal pipes, external radiators, fires, gas-temperature pressure coupling, anatomy-specific thermoregulation, suit thermal batteries and generated climates remain unfinished. Food age and temperature-dependent preservation/spoilage are now implemented; see [food preservation](food-preservation.md). Transit temperature remains abstract. The full conversion inventory remains active.
