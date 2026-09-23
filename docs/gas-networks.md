# Gas distribution

Implemented September 16, 2026. The current schema 34 [retained exhaust and filtration](exhaust-and-filtration.md) extension is implemented and verified, including smoke capacity and accounting. The original schema 33 evidence below is historical. This follows the user's [SS13-style systems direction](station-systems-reference.md).

## Physical parts

| Part | Construction | Operation |
| --- | --- | --- |
| Gas pipe / valve | 1 alloy, 2 work; overlay under ordinary structures, floors and walls | Holds up to 10 gas units in 0.25 volume; a manual valve isolates the segment and traps its contents |
| Gas supply tank | 6 alloy, 1 component, 10 work; habitat floor | Haulers deliver breathing mix into a 20-unit input buffer; loads up to 2 units per tick into an 80-unit tank with volume 2 |
| Directional pump | 4 alloy, 1 component, 8 work | Requires 3 kW; pushes up to 2 gas units per tick, scaled by condition, from the neighbor behind it to the neighbor ahead |
| Regulated vent | 4 alloy, 1 component, 8 work; habitat floor | Requires 2 kW; delivers up to 2 gas units per tick, scaled by condition, into its room until its pressure target is reached |

All construction requires actual material delivery and work. New equipment and pipes start empty. Loading breathing mix converts inventory into stored gas at one gas unit per inventory unit, preserving the existing 21% oxygen/79% inert mixture. The larger tank capacity does not multiply the input. Tank refill can be paused independently from its outlet valve; previously assigned haulers may finish their delivery.

Pipes are a separate overlay from cables. Gas equipment has its own ports and cannot share a tile with a pipe overlay. Dismantle an existing pipe before installing gas equipment there. Orthogonally adjacent pipes, tanks and vents connect automatically through open valves. A pump connects only its two directed ports and permits no passive flow through itself. Routes alongside a pump can bypass it, so the player must construct separated inlet and outlet branches when pumping against pressure.

## Flow and conservation

Each pipe and tank owns its gas mixture. Network edits do not replace gas with a new network total. Passive flow follows pressure differences, with bounded equalization and mixing between connected neighbors. Closed valves preserve the gas in their segment. Powered pumps can move gas against the pressure gradient, bounded by actual source contents and destination capacity.

Pressure uses the colony's existing game units: gas amount divided by volume relative to ten gas units per volume at 100% nominal pressure. It is not displayed as kPa. Temperature-dependent pressure and pipe heat exchange remain future work.

The regulated vent supplies its room only while enabled, powered, intact, open, supplied and below its target. It does not extract gas or recycle carbon dioxide. Existing life support owns the baseline's recycling and smoke-clearing behavior. The separate extractor retains CO2 and smoke; see [retained exhaust](exhaust-and-filtration.md). Disabled devices release their electrical demand; enabled idle devices retain their rated load, matching other colony equipment.

The schema-33 gas ledger records loading, room delivery and outside loss separately for oxygen, inert gas and CO2. Stored pipe/tank gas equals loaded gas minus delivered and lost gas. The schema-34 extension adds room extraction and separate retained smoke accounting. Every release has a destination; dismantling cannot silently delete contents. Gas released into a room joins the existing atmosphere simulation and its accounting. Stored pipeline gas is included in total physical supplies, while the top resource bar continues to count available depot stock. Contaminated pipeline contents are not automatically available as usable packaged breathing mix.

## Failures and controls

Condition below 50% causes a leak. Closing a damaged segment's valve stops neighboring pipes from feeding it, but its own contents can still escape. A ruptured open pipe remains a leak path; repairing it restores its seal without replenishing gas. Tank loading, pump operation and controlled venting stop when their equipment is broken; broken tank and vent ports also isolate from neighboring pipes. A leak or dismantling inside a room goes into that room. On a wall or door, it splits equally among distinct adjacent rooms and one exterior share if exposed; when no modeled room is available, it is recorded as an outside loss. Fire and debris can damage equipment and pipes.

The hidden inspector exposes contents, pressure, valves, refill controls, pump direction, vent pressure targets and blocked reasons. An optional Gas overlay exposes routes and damage. Player actions use the same dispatcher as local agents: `gas.valve`, `gas.device`, `production.enable` and pipe work through `job.order`.

Named loading, transfer, mixing, release and control events carry stable tile IDs, quantities, mixture and destinations. Observations retain typed gas state and derived operating/blocked conditions. Recording stays optional, bounded and local, outside saved simulation state.

## Persistence and evidence

Schema 33 adds gas state. Migration from schema 32 adds empty pipe state and zero gas ledgers, granting no equipment or supplies. Current saves validate gas contents, capacities, controls and conservation.

The schema-33 full suite passed **573 tests**, including **21 new gas cases**, in `/tmp/spacefortress-gas-full-tests.log`. This is historical baseline evidence; it does not verify later schema-34 edits. Cases cover physical construction/hauling, actual tank-to-pump-to-vent delivery, species conservation/mixing, valves, pressure targets, power loss, ruptures, repairs/demolition, labels/recording, deterministic saves, migration and invalid state. Isolated Firefox passed hidden-drawer, original-art/route, valve/refill/direction/target/repair/removal, action/event label and schema-33 save/reload checks. Root inspected route/vent screenshots. An inspector refresh could replace a pressed control; this was reproduced and fixed by preserving its DOM until the click completes. Held-click-through-tick, outside release and synthetic pointer cancellation passed. No scoped application errors were reported. See [verification status](verification-status.md) for current evidence.

The overall game remains incomplete. Retained exhaust and selective filtration into fixed storage are implemented. Sensors/controllers, airlock cycling, thermal coupling, pipe layers/crossings and multilevel routes remain outstanding.
