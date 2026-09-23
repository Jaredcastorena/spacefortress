# Retained exhaust and filtration

**Implemented and verified — schema 34.** Root accepted 34 focused exhaust cases, the 607-test full suite and scoped Firefox controls/art/save checks on September 16, 2026. See [verification status](verification-status.md) for exact evidence and limits.

This extends [gas distribution](gas-networks.md) so room contaminants have a physical destination. An extractor moves material into a pipe network; a reservoir retains it. Full storage, isolated valves, damaged equipment and power loss can stop collection or return contaminated contents to the habitat.

## Devices and player flow

| Part | Construction | Operation |
| --- | --- | --- |
| Gas extractor | Habitat floor; 6 alloy, 1 component, 10 work | 3 kW; holds up to 10 total payload units in volume 0.25; powered filter or bulk exhaust |
| Gas reservoir | Habitat floor; 6 alloy, 1 component, 10 work | Passive; holds up to 80 total payload units in volume 2; starts empty and requests no breathing mix |

Construction uses delivered materials and actual crew work. Connect the extractor to pipes and a reservoir. A directional pump can move retained contents against gas pressure or empty a smoke-only branch; an open route alongside it can still bypass the pump. Reservoirs, extractors and existing gas devices cannot share their tile with a pipe overlay.

Select the extractor to expose its enable switch, mode and target in the hidden inspector. The Gas overlay shows the existing network. Keep dirty exhaust and breathing-mix supply on separate branches when clean supply matters: connected open ports share their contents. A supply tank can receive exhaust with refill paused; it does not purify incoming gas.

## Extraction modes

**Filter** removes CO2 and smoke in their current room ratio, preserving room oxygen and inert gas. Its combined rate is at most 2 payload units per tick at full condition, bounded by available contaminants and free destination capacity. It retains both pollutants; it does not turn CO2 into oxygen or erase smoke. Filtering can continue at the pressure target because the target regulates bulk exhaust only.

**Exhaust** removes the room's mixture proportionally, including its smoke. The combined rate is at most 2 payload units per tick at full condition. Gas removal also stops at the selected target, from 0% through 150% nominal room pressure; it does not intentionally draw below that target. Once the room is at target, bulk extraction stops even if smoke remains. Filter mode is available for collecting that residual smoke.

Both modes need enabled, powered, intact equipment with an open port and a room. There must be capacity in the extractor itself; downstream equipment must carry its contents away to sustain operation. Disabled equipment releases its power demand. Enabled equipment retains its rated demand when idle, as other colony machinery does.

## Quantities, transport and hazards

Gas remains three separate amounts: oxygen, inert gas and CO2. Each physical pipe or storage node also retains a nonnegative `smoke` amount. Capacity and transfer limits use **total payload = oxygen + inert + CO2 + smoke**. Pressure uses only the three gas species divided by volume, relative to ten gas units per volume at 100% nominal pressure. A storage node can therefore be full of smoke while its gas-pressure reading is zero.

Pumps, bulk exhaust, vents and leaks carry smoke with the transferred mixture. Pressure-driven pipe transfers carry the corresponding smoke, bounded by total payload rate and destination capacity. Conservative smoke diffusion moves 2% of the amount needed to equalize smoke density between open adjacent nodes each tick, capped by available smoke and free destination capacity. This separate process permits smoke-only filter output to reach storage without requiring carrier gas. Gas-species mixing and particulate transport preserve their separate quantities.

Captured pollutants remain a hazard. A supply vent on a dirty branch can inject CO2 and smoke back into a room. A damaged or dismantled node releases its contents using the same destination rules as other pipe gas: its own room, distinct adjacent compartments/exterior at a wall or door, or the outside when no modeled room receives it. Closing a valve isolates neighboring supply but does not seal the node's own damage.

Existing life support still recycles CO2 and clears smoke using its prior abstract rules. The new extractor provides retained filtration; it does not change life support into a waste-storage machine.

## Accounting and machine interaction

The gas ledger gains an `extracted` three-species counter. For each species:

`stored in pipes and devices = loaded from inventory + extracted from rooms − delivered to rooms − vented outside`

The network also records smoke in `gasNetwork.smoke.{captured,released,vented}`: capture from rooms, release to rooms, and exterior loss. Stored node smoke equals captured minus released minus vented. Extraction transfers material out of room storage; it is not an exterior loss. The global fire ledger includes both room smoke and retained node smoke:

`room smoke + stored node smoke = smoke produced − smoke cleared − smoke vented`

Releasing retained smoke inside returns it to room storage. Only an actual exterior release increases smoke vented. These counters are observations of transfers, not training rewards or complete causal explanations.

Player and agent commands share `src/controls.js`. The new action is `gas.extractor({site,x,y,enabled,mode,target})`, with mode `filter` or `exhaust` and integer target 0–150. Existing `gas.valve`, directional-pump/vent `gas.device`, supply-tank `production.enable`, and construction/repair/removal `job.order` remain applicable. The generic `gas.device` action rejects an extractor; it cannot overwrite the extractor's mode. Tile IDs stay `tile:<site>:<x>:<y>`; room IDs use `room:<site>:<x>,<y>` for the first room cell in row order.

Structured tile observations retain `gasStore.gas`, `gasStore.smoke` and `gasDevice` settings. Derived readings include `pressure`, total `payload`, `capacity`, `smoke`, extractor `mode`, `target`, room ID and blocked condition. Reasons distinguish no power, closed port, disabled or damaged equipment, fire, absent habitat, full extraction storage, no remaining filter pollutants and a room already at the bulk pressure target.

| Event | Fields and meaning |
| --- | --- |
| `gas.extracted` | Room `from`, tile `to` and `device`, total `amount`, three-species `gas`, `smoke`, `mode`, `target` |
| `gas.extractor.changed` | Extractor tile `entity`, `enabled`, `mode`, `target` |
| `gas.transferred` | Physical node `from`/`to`, total `amount`, `gas`, `smoke`, transfer `reason`; powered transfer adds `device` |
| `gas.released` | Node `from`, room or space `to`, total `amount`, `gas`, `smoke`, release `reason` |

Smoke-only diffusion uses `gas.transferred` with `reason:"smoke_diffusion"` and zero gas. Existing `gas.loaded`, `gas.mixed`, `gas.valve.changed` and `gas.device.changed` retain their purposes. `gas.mixed` describes equal amounts of gas-species exchange; its amount does not include the separate smoke diffusion. Recordings remain optional, local, bounded and outside saved simulation state.

## Persistence and verification scope

The implemented schema-33-to-34 migration adds zero smoke and empty extraction/smoke counters while preserving existing gas, valves, device settings and simulation state. It grants no devices or supplies. Validation checks smoke amounts, gas-plus-smoke capacity, extractor controls and both ledgers. Integration verification must establish malformed-state rejection, deterministic save/reload and that local recording does not alter saves or RNG.

Verified scope includes physical construction, finite powered capture, selective filtering, bounded exhaust, closed valves/full storage, species and smoke conservation, contaminated supply, release on damage/removal, schema migration, controls/events, deterministic continuation and browser interactions. The migration suite includes a genuine previous schema 33 browser save preserved as a small compressed fixture. Evidence and remaining game gaps are in [verification status](verification-status.md).

## Remaining model limits

Gas temperature does not affect pipe or room pressure, and pumps do not model compression work or gas heat exchange. Smoke counts against storage and transfer capacity as a game abstraction; it is not an additional pressure-producing gas species. There are no filter cartridges, pollutant processing recipes, portable waste canisters, outside exhaust fixture, pressure sensors/controllers, automatic airlocks, layered pipe crossings or multilevel routes in this increment. This remains a colony simulation model, not an engineering model.
