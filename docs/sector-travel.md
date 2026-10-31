# Travel to surveyed sectors

After launching a satellite, open Regions → Planet map → Colony → Surface survey. Select a sector and expand Expedition. The panel shows round-trip fuel, travel time per leg and any first-landing kit. Preparing an expedition selects two eligible crew through the same rules as other shuttle journeys; agents may supply explicit crew IDs.

Each new destination is a 48 × 48 surface map with the surveyed generator’s terrain, flora, wildlife, finite ore/ice/water and exterior temperature offsets. Preparation creates that map once, with no equipment, stored supplies, charge, breathable room or residents. Inspection alone creates nothing. Cancelling preparation retains the generated map; it does not provide a free landing or regenerate its resources.

Crew must haul normal fuel, food and suit air plus **6 alloy and 2 components** for the first landing. The kit stays physically aboard during transit and an outbound recall. Arrival consumes it and deploys an empty dock on a deterministic clear landing tile. The two travelers arrive at that dock and a walkable adjacent cell. Existing destinations keep their arrival behavior. Later visits use the same saved map and do not require another initial kit.

Load building supplies with Freight before departure, unload them into the new dock, and designate normal construction or extraction. Local work uses visitors or admitted residents and actual nearby resources. Existing habitat commissioning and residence requirements still apply. A bare dock is not a safe long-term home. All journeys currently depart from and return to the original home colony.

Animals retain their site and floor through grazing, feeding, harvesting, medicine, breeding, local escorts, death and processing. Equal coordinates on different maps cannot share posts, mates, supplies or body reservations. Traps consume reachable bait from their own settlement. Transporting animals between settlements is not implemented.

## Persistence and limits

Save77 adds an optional `sectorSites` registry keyed by stable `sector-<planetId>-<x>-<y>` IDs. Entries store only `planetId`, `x` and `y`; canonical metadata and routes derive from the immutable base region. Older saves do not receive new maps, supplies or an empty registry. Their original maps remain intact. Generated terrain and wildlife are never regenerated on revisit or reload.

There is no fixed four-sector limit. Admission checks the projected UTF8 save size, including every existing floor, against the 16,000,000-byte limit with 1,000,000 bytes reserved for growth. It also respects the existing 100-record wildlife bound. A rejected admission leaves the colony unchanged. These are current capacity guards, not a promise of unlimited subsequent growth; portable exports remain useful backups.

Players and agents share `expedition.surveyed`. Observation/recording11 includes canonical site definitions and local animal/pasture/body targets; named preparation, travel, kit and physical-work events distinguish actions from outcomes. [Focused travel](../tests/sector-travel.test.js), [storage guards](../tests/sector-storage.test.js) and [verification status](verification-status.md) define the verified scope. Broader history/discovery, direct remote travel and sustained habitation remain separate work.
