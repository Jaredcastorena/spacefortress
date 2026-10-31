# Heat carried by gas

Local save78 models the sensible heat of room gas and pipe/tank contents. Hot gas can warm a room; recovered cold gas remains cold until it mixes or exchanges heat. Inspect a gas pipe or store to see its temperature. Empty stores show Empty.

## Quantities and transfers

The existing structural heat capacity remains 20 units per room tile. Gas adds 0.2 units per gas unit, shared by oxygen, inert gas and CO2. Room temperature in kelvin is total room energy divided by structural plus gas capacity. Pipe and tank temperature uses their gas capacity alone. Smoke remains a massless tracer for heat and pressure, while still consuming storage space.

Every gas parcel carries its proportional energy. Pumps, passive flow, risers, diffusion, filters, exhaust, leaks and dismantling retain species, smoke and energy ownership. Removing gas at its own temperature leaves the source room temperature unchanged. Incoming gas mixes with both the receiving gas and its structural mass. Room exchange solves the final mixed pressure rather than assuming the receiver stays at its original temperature.

Node pressure responds to temperature. Vents calculate the finite quantity needed at the actual inlet temperature and stop at their target or available supply. Gas stores also exchange a bounded amount of heat with their surroundings each tick. Pipes in walls and doors use their actual neighboring compartments and exposed sides; an enclosed partition is not an exterior heat sink.

Airlock admission predicts final pressure, oxygen availability, smoke and temperature using the available gas and its energy. Existing safety bounds and physical door checks remain authoritative. The prediction retains the existing mixed-reserve approximation; it does not promise that unequal pipe paths deliver an identical composition on every intermediate tick.

## Energy accounting and compatibility

The site thermal ledger covers rooms and gas nodes together. Internal transfers cancel. Packaged breathing mix and manually released suit oxygen enter this thermal domain at the reference 20°C, with imported energy recorded as `gasLoaded`. Gas leaving for space or suit storage is recorded as `gasVented`. This explicitly bounds the modeled thermal domain; temperatures of still-packaged cargo and suits are not stored.

Topology changes preserve structural heat with surviving floor cells. Gas energy follows the actual gas redistribution over surviving room overlap. A completely removed compartment vents its gas energy; demolishing only part of a room does not erase the retained gas's heat.

Older saves first validate their original caches and ledgers. Migration preserves room temperatures, structural heat, gas quantities, supplies, people, jobs and RNG. Previously untracked room gas energy and 20°C node energy enter an explicit `gasInitial` baseline. Current saves require consistent thermal fields and a balanced combined ledger. No gas, equipment or supplies are created by migration.

Observation/recording12 adds node temperature/heat and room heat capacity. Gas-transfer events identify carried heat; diffusion records forward and backward heat. Player and agent commands retain the same controls and costs.

This remains a game-scale model. Compression work, species-specific heat capacities, water/steam phases and thermal histories of packaged cargo remain future work. [Verification status](verification-status.md) distinguishes focused checks from ordinary colony endurance.
