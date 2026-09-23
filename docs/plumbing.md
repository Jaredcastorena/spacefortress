# Closed water plumbing

**Implemented and verified — schema 35.** Root accepted 65 new cases, the 672-test full suite and scoped Firefox controls/art/save checks on September 16, 2026. The [implementation contract](plumbing-design.md) describes the mechanics; [verification status](verification-status.md) records the evidence and its limits.

Plumbing connects existing water supplies, floor recovery and consuming machines through physical routes. It retains the existing abstract `water` resource; it does not add water purity, temperature, steam or hydraulic pressure.

## Build a route

One useful chain is:

`hauled water tank → intake → pipe → pump → reservoir → outlet → hydroponics`

An intake can instead collect a water-producing machine's finished output or water on one adjacent floor tile. An outlet can supply a consuming machine or discharge onto one adjacent tile. Pipes and reservoirs hold water; pumps and adapters transfer it without an internal buffer. All new parts start empty and require delivered materials and crew construction work.

| Part | Materials and work | Capacity | Power |
| --- | --- | --- | --- |
| Water pipe / valve | 1 alloy, 2 work | 2 water | None |
| Water reservoir | 6 alloy, 1 component, 10 work | 32 water | None |
| Directional water pump | 4 alloy, 1 component, 8 work | No internal store | 3 kW |
| Water intake | 4 alloy, 1 component, 8 work | No internal store | 2 kW |
| Water outlet | 4 alloy, 1 component, 8 work | No internal store | 2 kW |

Devices require habitat floors. Water pipes can pass under ordinary buildings, walls and doors, but not through rock/void or underneath a water device/reservoir. Cable and gas-pipe overlays remain independent. The existing supply tank keeps its eight-unit machine input; it does not gain a second store or a direct pipe connection. The new reservoir receives water through plumbing and requests no hauler deliveries.

The Water button sits in the visible map controls beside Power, Gas and Cutaway. Water, Gas and Power overlays are mutually exclusive and off by default. Device details remain in the hidden inspector: selecting a part reveals its contents, valve, condition, endpoints and reason for blockage. Controls expose enable/direction and inventory/floor mode where applicable. Pump arrows identify orientation; an east-facing device takes from its west neighbor and delivers to its east neighbor.

## Flow, ports and operation

Open orthogonal pipe/reservoir nodes level their fill fractions, moving at most 0.5 water per pair per tick. Reading “fill” is stored water divided by capacity, displayed as a percentage. It is not physical pressure. Closed valves trap their node's contents. A ruptured open pipe still connects; a broken reservoir isolates its external port while its retained contents can leak.

Powered pumps move up to `0.5 × condition/100` water per tick from behind to ahead, including against the fill gradient. Intakes and outlets have the same maximum rate. A device has no passive connection through its tile or side ports; an alternate pipe route can still bypass it. Each enabled device makes one bounded transfer attempt in deterministic alternating tile order.

Disabled, broken, burning or unpowered devices stop. Transfers also require valid, accessible ports and available contents/capacity. Disabling immediately releases electrical demand. Enabled idle devices keep their rated demand, matching other colony machinery.

### Inventory adapters and hauling claims

An intake in **inventory mode** can draw from a neighboring water tank's input or the output of a machine that produces water, including the ice processor and recovery pump. It never takes a recipe's committed batch, depot stock, crew cargo or construction materials. An existing output remains usable while its producer is paused; broken or burning source equipment blocks collection.

A hauler's pickup claim protects the matching amount still in machine output. An intake uses only the unclaimed remainder. Water already carried by a hauler has left that output and is not subtracted a second time.

An outlet in **inventory mode** fills a functioning, enabled adjacent recipe that uses water. Desired input depends on the existing continuous/fixed/stock production order and the two-batch input limit. Shipments already assigned or carried to that input reserve capacity. The outlet fills only the remaining desired space; later transfers see earlier changes. The ordinary worker still needs to operate the workstation, and other recipe ingredients remain necessary.

Both hauling and adapters use the pure `incomingInventory` and `outgoingInventory` helpers in `src/inventory-reservations.js`; hauling also keeps its one-pickup-per-source rule through `hasOutgoingInventory`. Claims are not extra stores of water. Dead crew or crew at another site do not reserve this site's endpoints. A carried shipment uses its actual delivery target, without also counting an old pickup intent. Changing an order, pausing or dismantling a target must preserve cargo through the existing delivery/return rules. Inventory movement uses `extract`/`add` for the water amount, preserving unrelated item and food metadata.

### Floor adapters

In **floor mode**, an intake reads only the tile behind it and an outlet fills only the tile ahead. That tile must be open to floor water; an intact wall or closed pressure door blocks access. Intake cannot exceed the existing puddle; discharge cannot exceed the tile's four-unit capacity. Several devices cannot collect the same water twice.

The existing recovery pump remains distinct: it collects its own tile and four orthogonal neighbors into its output buffer for hauling or plumbing pickup.

## Damage, work and recovery

A node below 50% condition attempts to leak `0.5 × (1 − condition/50)` water per tick even with its valve closed. Water enters its own open floor tile. Under a wall or closed door, it is distributed among adjacent open tiles with room. When all destinations are blocked or full, the remainder stays stored. Subsequent floor flow uses the existing ground, map-edge and space losses.

Repairing a water pipe costs one alloy and three Engineering work. Removal takes three Construction work and refunds 0.5 alloy. Completed crew dismantling recovers stored node water into a physical drop at the accessible work position and accounts for it as delivery back to inventory. The pipe's alloy refund uses that position too; a reservoir's ordinary construction refund stays at the reservoir tile. Recovery does not erase water when the floor is full. Damage leakage creates floor water, not packaged drops. Demolishing an ordinary building preserves unrelated overlays beneath it.

Water-pipe damage has its own `waterPipe` target; the existing `pipe` target still identifies gas pipe. Fire, debris and maintenance must distinguish them.

## Tick order and cascading effects

The approved order is:

1. Debris, then passive plumbing leveling and damage leaks.
2. Tank drains, floor spreading and floor losses.
3. Electrical allocation, including energized wet-cable faults.
4. Existing recovery pumps, then powered plumbing adapters/pumps.
5. Gas, atmosphere, thermal systems/reactor cooling, fire and remaining colony work.

This lets an intake collect a recovery pump's fresh output in the same tick. Ice processing performed by a worker later becomes available on the next tick. Outlet water arrives after power allocation: it can quench a fire that tick, but wet-cable power allocation sees it on the next tick. Final circuit displays describe the next allocation; named events preserve what occurred earlier.

## Ownership and conservation

Each `waterPipe` or reservoir `waterStore` owns its amount. Machine inputs/outputs/batches, crew cargo and `tile.liquid` retain their existing ownership. `totalResources().water` counts every physical owner once; the resource bar still shows available depot stock.

For each site:

```text
pipe + reservoir water = plumbing.loaded + plumbing.recovered
                       − plumbing.delivered − plumbing.released

floor water = liquids.released − liquids.recovered
            − liquids.lost − liquids.quenched
```

| Transfer | Ledger change |
| --- | --- |
| Inventory → node | `plumbing.loaded` |
| Floor → node | `plumbing.recovered` and `liquids.recovered` |
| Node → inventory, including dismantling | `plumbing.delivered` |
| Node → floor | `plumbing.released` and `liquids.released` |
| Node → node | No boundary counter |

The two ledgers describe successive boundaries; their counters are not additional supplies to sum. Floor losses and quenching use the existing sinks exactly once. Production still consumes water under its recipe rules.

## Shared controls and records

Players and local agents use the same action dispatcher:

| Action | Arguments after `{site,x,y}` |
| --- | --- |
| `plumbing.valve` | `open` |
| `plumbing.pump` | `enabled`, `direction` |
| `plumbing.intake` | `enabled`, `direction`, `mode` |
| `plumbing.outlet` | `enabled`, `direction`, `mode` |

Directions are east/south/west/north; adapter modes are inventory/floor. Each action accepts only its matching part. Construction, `repairWaterPipe` and `removeWaterPipe` use `job.order`. Existing water-tank, production and electrical-priority controls retain their purposes.

Observations expose raw node/device state and a composed `derived.plumbing` status alongside other systems on that tile. Status endpoints use `input`/`output` tile IDs with `inputSlot`/`outputSlot`. `reservedOutput` protects source machine-output pickup claims; `reservedInput` protects incoming destination machine-input shipments. These names identify machine buffer ownership, not the adapter's flow direction. The inspector also distinguishes actual source water from available water and target contents from unreserved capacity.

Transfer events use `from` and `to` objects shaped as `{entity:"tile:<site>:<x>:<y>",slot}`. Slots distinguish `waterPipe`, `waterStore`, `machine.input`, `machine.output`, `liquid` and `drop`. Events include positive `amount`, `reason`, and a responsible `device` when applicable.

| Event | Boundary |
| --- | --- |
| `plumbing.transferred` | Node → node; reason `level` or `pump` |
| `plumbing.loaded` | Inventory → node; reason `intake` |
| `plumbing.recovered` | Floor → node; reason `intake` |
| `plumbing.delivered` | Node → inventory; reason `supply` or `dismantled` |
| `plumbing.released` | Node → floor; reason `damage` or `outlet` |

`plumbing.valve.changed` carries the tile `entity` and `open`. `plumbing.device.changed` carries `entity`, building ID, `enabled`, `direction` and an adapter's `mode`.

Device `blockedCode` uses the first applicable condition in this order:

1. Fire at the device, disabled device, broken device: `fire`, `disabled`, `damaged`.
2. Missing coordinate or wrong endpoint type: `missing_source`, `missing_target`, `wrong_source`, `wrong_target`.
3. Broken endpoint equipment, burning inventory endpoint, closed node valve or blocked floor: `source_damaged`, `target_damaged`, `fire`, `valve_closed`, `floor_blocked`.
4. Paused consumer or completed demand: `target_paused`, `target_order_complete`.
5. Power and quantities: `no_power`, `source_empty`, `source_reserved`, `target_full`, `target_reserved`.

Topology and endpoint controls precede power so an unpowered route can still explain an incorrect connection. The readable `blocked`/`status` accompanies the stable code. Passive nodes report broken reservoir or closed-valve conditions; their status prioritizes a leak warning, then empty/full/connected state. Quantities and derived status do not themselves reserve or move water.

Local recordings stay optional, bounded and independent of saves/RNG. Events are observations, not training rewards or proof of a complete causal explanation.

## Saves, evidence and limits

The schema-34-to-35 migration adds empty water-pipe fields and zero plumbing ledgers without resetting wet floors, existing buffers, gas/exhaust state, shipments, jobs, RNG or water/energy counters. No machinery or supplies are granted. New device IDs are rejected in older-version saves. Current-schema validation checks exact node/device fields, finite nonnegative capacities, placement, jobs and both water ledgers; it must reject malformed state rather than silently repair it.

Verified checks cover construction, competing reservations, actual machine supply, conservative leaks/removal, floor/power/fire interactions, controls/events, migration, deterministic continuation, full regressions and browser interactions. See [verification status](verification-status.md) for actual evidence.

Water purity, pathogens, wastewater treatment, thirst, fluid temperature, phase changes/steam, vertical flow, hydraulic forces and reactor coolant circuits remain outside this increment. Recovered floor water uses the existing abstract water resource; plumbing adds transport and storage, not a claim that recovered water is potable. No external dependency or runtime service is required.
