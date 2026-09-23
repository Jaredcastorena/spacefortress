# Upward and outward progression

## Confirmed premise

The user chose isometric sprites and proposed moving upward from the planet into orbit, then farther out to discover passing comets, satellite wreckage, debris hazards, and dangerous solar activity that advanced panels can exploit. This replaces underground-first progression as the main design direction.

The universe remains the strategic map. Each planet can contain multiple settlements. The broader design below contains proposals, not additional confirmed requirements. A partial implementation now exists; see [expedition logistics](expedition-logistics.md) and [implementation status](implementation-status.md) for tested behavior and remaining abstractions.

## Layers with things worth reaching

| Region | Discoveries and resources | Danger or constraint | Why establish a presence? |
| --- | --- | --- | --- |
| Planet surface | Local minerals, usable terrain, starting supplies | Climate, atmosphere, limited launch capacity | Establish the colony and its industry |
| Upper atmosphere, where present | Survey opportunities and possible gas collection | Weather, exposure, specialized vehicles | Improve sensing and support later operations |
| Near orbit | Old satellites, wrecks, abandoned platforms | Vacuum, short supply range, debris strikes | Salvage electronics and establish a first orbital outpost |
| Farther planetary space | Derelicts, moon approaches, contested routes | Longer transit, radiation, isolation | Reach richer salvage and build transport infrastructure |
| Passing bodies | Comets and drifting resource bodies | Limited access windows and uncertain routes | Obtain ice, volatiles, and unusual materials |
| Solar collection sites | Favorable collection geometry or a fictional energy anomaly | Heat, radiation, equipment degradation, storm exposure | Operate advanced collectors for industrial-scale power |
| Remote frontier | Lost expeditions and unfamiliar structures | Logistics, unknown organisms, hostile factions | Extend the colony's history and discover late-game systems |

Regions need not all appear in a fixed linear order. A comet may cross several regions; a solar collection site can be a branch reached through a transfer route. Surface conditions and discoveries should vary between planets.

## Keep local height separate from travel distance

Use two scales:

- **Local levels:** x/y/z cells inside a settlement, station, wreck, or resource body. Buildings have height; rooms can sit above or below one another.
- **Travel regions:** named locations connected by routes, with transit time, vehicle requirements, cargo limits, and environmental conditions.

The player can move “up” through region views, preserving the layered discovery experience. Switching the view does not teleport workers or resources. Travel happens through explicit jobs using shuttles initially; tethers, elevators, and other infrastructure can be evaluated later.

This avoids storing vast empty distances as tile grids. It also keeps ordinary stairs distinct from inter-site transport. A space region uses a map of destinations and hazards; an occupied destination opens into its own detailed isometric map.

Optional local digging still fits mining and shelter construction. It should not become a requirement to reach orbital content. Final underground scope remains open.

## Convert gameplay roles as well as names

| DF gameplay role | Space proposal |
| --- | --- |
| Cavern breakthrough reveals a new ecosystem | A scan or expedition opens an unknown orbital region or derelict |
| A valuable ore deposit requires excavation | A wreck or resource body needs access, extraction, and return logistics |
| Dangerous terrain changes fortress access | A debris field changes safe transit windows and infrastructure placement |
| Magma is hazardous but useful for industry | A solar collection site offers high power with heat and exposure costs |
| Trade caravans connect the fortress to the world | Cargo ships and transfer routes connect surface and orbital settlements |
| Deep threats punish careless expansion | Salvage expeditions encounter hazards that can follow the crew home |

## Solar harvesting as a playable system

The user's solar idea is a design premise. More distance from a planet does not by itself imply stronger sunlight. Describe valuable sites through exposure, geometry, proximity to the star where appropriate, or an explicitly fictional anomaly.

Proposed loop: survey a promising site → transport collectors and protection → deploy → manage output, waste heat, and wear → store or transmit usable power → respond to warning events.

The tradeoff must stay readable: current output, storage, heat, expected exposure, damage, and time to a forecast hazard. Ordinary panels can shut down or retract; advanced ones may tolerate greater exposure. A storm should not simply grant free power because it is dangerous.

Power generated in orbit needs an explicit delivery method. Start with local consumption and transportable charged storage. Transmission beams or a tether are later options with their own capacity, losses, and infrastructure. Do not let power silently appear on every map.

## Comets and debris

Comets have scheduled arrival and departure, a route, surveyed resources, and time to return. The first version can use scripted paths and arrival windows without numerical orbital simulation.

Debris regions have a visible risk level and safe-route information. Damage can strike hulls, suits, sensors, or cargo. Salvage operations should expose the crew to meaningful risk rather than turning the entire field into a homogeneous damage counter. Later versions can include moving fragments and shifting corridors.

Discovery reveals information progressively. A weak scan may identify a wreck but not its interior, occupants, or condition. Better surveys reduce uncertainty without removing all surprises.

## First surface-to-orbit slice

1. Start a habitable surface colony with a shuttle and a small crew.
2. Reveal one nearby satellite wreck and its transit requirements.
3. Equip and assign a salvage team, reserving fuel, suit supplies, and cargo space.
4. Show departure, transit, arrival, and a detailed isometric wreck site.
5. Recover a useful component while responding to one readable debris or suit hazard.
6. Return the crew and cargo; use the component in a surface machine.
7. Save/reload preserves both sites, cargo ownership, discoveries, and any in-flight travel.

After that works, introduce a passing comet and a solar collection site. This sequence tests the upward/outward premise early while keeping the first implementation bounded.
