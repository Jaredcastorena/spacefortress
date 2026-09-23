# Fire, smoke and crew response

Implemented September 16, 2026. Environmental emergencies connect damaged equipment, compartment air and heat, crew movement, production and physical supplies.

The [floor water](floor-water.md) extension blocks ignition and quenches fires with explicitly consumed puddle water. The verified [retained exhaust and filtration](exhaust-and-filtration.md) extension keeps smoke stored in pipes/reservoirs until released or removed by an explicit modeled sink.

## Player flow

A burning fitting shows an orange flame and adds a warning above the map. Select it to inspect intensity, smoke and suppression status. **Order suppression** reserves two water; an engineer must collect it, deliver it beside the fire, and perform eight Engineering work. Skill and crew condition affect work speed. Existing job priority and cancellation controls apply.

The Colony drawer has an automatic-response toggle, enabled by default. Disabling it prevents new automatic orders; existing orders remain. Orders start at urgent priority. No available engineer, reachable supplies or safe route means the fire continues and the obstruction is shown. Cancelling an order preserves its water and delays automatic retry for 120 ticks; an explicit manual order can retry immediately.

Isolating power or repairing equipment before ignition resets the electrical-fault countdown. After ignition, switching power off alone does not extinguish a burning fitting. Suppression does not repair its damage or remove accumulated smoke. Powered life support filters smoke. Opening a pressure door can carry smoke into other rooms or vent it outside, with the existing loss of breathing gas.

## Simulation rules

- A powered fitting with electrical demand and at most 30% condition ignites after 120 consecutive eligible ticks. A fitting in a compartment at least 90 °C can also ignite. Ignition requires oxygen partial pressure of at least 0.12 nominal units.
- Interior equipment and furniture use remaining structure condition as abstract fuel. Floors, walls, pressure doors, fences, pasture gates, cable-only tiles, solar panels and sculptures are excluded. Fires cannot start in vacuum.
- A fire starts at intensity 20, gains two per burning tick to a cap of 100, and consumes `0.002 × intensity` oxygen. That gas becomes the same amount of CO₂. It also produces `0.0015 × intensity` smoke and `2 × intensity` heat units.
- Structure condition falls by `0.005 × intensity` per tick; an underlying cable loses `0.003 × intensity`. A fitting reaching zero condition stops burning but remains in place with its inventories intact.
- Every 30 burning ticks, a fire of intensity at least 60 ignites the first eligible orthogonal neighbor in the same compartment. Newly spread fires begin burning next tick. Flames do not jump pressure-door boundaries.
- Insufficient oxygen lowers intensity by ten per tick until extinction. Re-ignition remains possible if an unresolved fault or excessive room temperature persists.
- Smoke is a particulate amount, separate from the oxygen/inert/CO₂ gas mixture. It follows the existing gas-flow fractions, redistributes through room splits/merges, and is accounted for when room volume disappears or vents.
- Smoke density at least 0.04 per floor tile makes room air unsafe. Crew then use suit oxygen and existing suit-depletion/recovery rules. A healthy powered life-support unit clears up to 0.08 smoke units per tick, scaled by condition.
- Burning workstations, life support and climate units stop their processing. Production batches retain ingredients and progress. Connected electrical equipment can remain energized until isolated or disabled by condition.
- Burning tiles block ordinary crew and animal routes. Occupants take fire exposure damage and attempt to escape. Existing injury mobility limits and supplied medical care still apply. An immobile crew member requires the existing rescue system.

These are game abstractions. Suppression water is consumed by the completed job; steam, extinguishers, tools, fuel chemistry, inventory combustion, smoke inhalation anatomy and fireproof suit ratings are not modeled. Native creatures retain simplified atmosphere and temperature behavior. Fire intensity and particulate units are balance values, not a physical combustion model.

## Stable interaction labels

Shared player/agent commands:

- `fire.response({site,enabled})`: automatic response policy.
- `job.order({site,x,y,kind:"extinguish"})`: supplied suppression.
- Existing `job.cancel`, `job.priority`, power, machinery and door commands.

Each fire has a persistent `fire-N` ID using the colony ID allocator. Observations include its tile, start tick, age, intensity, retry time and obstruction. Suppression jobs retain the fire ID, worker, reserved/delivered materials and work progress. A replacement fire does not inherit the old fire's suppression order. Tiles expose electrical-fault countdowns; rooms expose smoke; site ledgers expose smoke produced, cleared and vented, oxygen burned and combustion heat. Definitions expose the response constants.

Named semantic records:

| Event | Meaning and fields |
| --- | --- |
| `fire.ignited` | Fire entity, target tile, cause (`electrical_fault`, `overheating`, `spread`) and optional parent fire |
| `fire.burned` | Fire entity, tile, oxygen consumed, smoke produced and heat added |
| `structure.damaged` | Tile entity, structure/cable target, cause, actual damage and remaining condition; includes wear/debris damage too |
| `fire.exposure` | Fire entity and crew/creature actor; exact health/injury changes are in tick deltas |
| `fire.evacuated` | Crew actor and destination tile after a successful escape step |
| `fire.extinguished` | Fire entity, tile, reason (`suppressed`, `oxygen_starved`, `fuel_exhausted`), and worker/job for suppression |

Animal escape uses `animal.moved` with reason `fire_escape`; deaths use `animal.died`. Existing job events and typed fire, atmosphere, temperature, condition and inventory deltas connect response to other systems. Recording remains optional, bounded, local and outside save/RNG state. Events are observations, not rewards or a complete causal model.

## Persistence and verification

Save schema **30** introduced this fire system and accepted versions 1–29. Version 29 gained empty smoke/fire ledgers and combustion accounting, without granting supplies, heat or orders. This is historical migration information; the current version and evidence are in [verification status](verification-status.md). Validation checks smoke/heat balance, fire IDs, timelines, intensity, retry bounds, unique current-fire job claims and required suppression cost/work. Existing supply validation owns reserved and delivered water.

The schema-30 fire release passed **490 tests**, including nineteen fire cases covering ignition/isolation, conservation, starvation, spread/parentage, burnout, smoke safety/filtering/door flow/topology, physical suppression, missing duties/supplies, cancellation, obsolete orders, escape injuries, interruptions, retained batches, migration, invalid state, deterministic continuation and recorder non-interference. This historical count does not verify later changes.

Isolated local Firefox verified hidden default drawers, visible fire warning, flame/smoke art, inspector readings, player suppression and automatic-response controls, stable action labels, an in-progress schema-30 save/reload, completion events and no scoped application errors. Screenshots were inspected. No packages or external assets were downloaded.

The schema 34 extension adds stored node smoke to the global fire balance: room smoke plus pipe/device smoke equals smoke produced minus smoke cleared minus smoke vented. Capturing smoke must not count as clearing or venting it; releasing it into a habitat returns the retained hazard to that room. Only an exterior release is vented. The separate network counters and acceptance checks are described in [retained exhaust](exhaust-and-filtration.md).
