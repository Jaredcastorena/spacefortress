# Closed water plumbing — implementation contract

**Status: implemented and verified — schema 35.** This contract was prepared from the preceding schema 34 source and accepted after 65 new tests, the 672-test full suite and scoped browser checks. The [player/mechanics guide](plumbing.md) and [verification status](verification-status.md) describe current behavior and exact evidence. The ownership outline below records the implementation approach; consult current memory/chat before assigning new work.

## Outcome and boundary

Connect hauled water, ice processing, floor recovery, sealed storage and water-consuming workstations through physical routes. A player should be able to build this chain:

`hauled water tank → intake → pipes → pump → reservoir → outlet → hydroponics`

An intake can instead collect an ice processor's finished water, a recovery pump's output, or water on one adjacent floor tile. An outlet can fill a neighboring workstation or deliberately flood one adjacent tile. Every transfer moves finite existing water. Full storage, reservations, closed valves, damage and loss of power have visible consequences.

This increment keeps the current abstract `water` resource. Existing recovery already returns floor water as that resource; adding pipes does not establish cleanliness or potability. Fluid composition, temperature, steam, vertical falls, real hydraulic pressure and reactor coolant remain separate future work. Do not label this a completed wastewater treatment system.

## Devices and owned state

The values below are the approved implementation constants. Keep them together in `src/plumbing.js`; cross-check this contract against settled source before acceptance.

| Building ID | Materials / work | Capacity | Demand | Function |
| --- | --- | --- | --- | --- |
| `waterPipe` | 1 alloy / 2 | 2 water | none | Overlay with manual isolation valve; connects orthogonal water nodes. |
| `waterReservoir` | 6 alloy, 1 component / 10 | 32 water | none | Empty passive storage; adjacent water nodes connect through its valve. |
| `waterPump` | 4 alloy, 1 component / 8 | no internal store | 3 kW | Moves water from the node behind to the node ahead. |
| `waterIntake` | 4 alloy, 1 component / 8 | no internal store | 2 kW | Moves water from an inventory or floor behind into the node ahead. |
| `waterOutlet` | 4 alloy, 1 component / 8 | no internal store | 2 kW | Moves water from the node behind into an inventory or floor ahead. |

Devices require habitat floor and start empty, enabled and facing east. Intake/outlet start in `inventory` mode. Pipes follow gas-overlay placement rules: no void/rock; allowed under ordinary buildings, walls and doors; no water pipe underneath a water device or reservoir. Gas pipes and cables remain independent overlays and may coexist. Construction still requires surface supply routes and physically delivered materials.

Persist only these new fields:

```js
tile.waterPipe = null; // or { water: 0, open: true, hp: 100 }
// Only waterReservoir:
tile.waterStore = { water: 0, open: true };
// Only waterPump:
tile.waterDevice = { enabled: true, direction: 'east' };
// Only waterIntake / waterOutlet:
tile.waterDevice = { enabled: true, direction: 'east', mode: 'inventory' };
site.plumbing = { loaded: 0, recovered: 0, delivered: 0, released: 0 };
```

The existing `waterTank.machine.input.water`, `bilgePump.machine.output.water`, all other machine inventories, `tile.liquid` and `site.liquids` keep their ownership. A supply tank does **not** acquire a second water store or automatic network connection. The reservoir has no recipe or machine inventory and receives no automatic hauler deliveries. Pump/intake/outlet have no invisible transit buffer; debit and credit happen atomically.

Implemented exports: `PLUMBING`, `WATER_DIRECTIONS`, `waterEquipment`, `waterNode`, `waterCapacity`, `waterPorts`, `plumbingStatus(s,site,t)`, `newWaterPipe`, `initializePlumbingTile`, `initializePlumbing`, `flowPlumbing`, `operatePlumbing`, `removePlumbing`, `setWaterValve`, `setWaterPump`, `setWaterIntake`, `setWaterOutlet` and `validatePlumbing`.

## Connections and flow rules

1. A node is a pipe or reservoir. Open pipes connect even when ruptured; a broken reservoir closes its external connections. Damage leaks retained water independently of valve position. Closing a valve traps its contents without reallocating a network-wide pool.
2. Each open orthogonal node pair levels its **fill fraction**, capped at 0.5 water per tick per pair. For the fuller endpoint `a`, transfer `min(0.5, (a.water/a.capacity − b.water/b.capacity) / (1/a.capacity + 1/b.capacity))`, bounded by actual contents and free capacity. Alternate pair-processing order with tick parity. This is a simple horizontal storage/flow model; label the reading “fill,” not physical pressure.
3. Pumps move at most `0.5 × condition/100` per tick from behind to ahead, even against this fill gradient. Pump tiles are not nodes: there is no passive flow through a stopped pump or through its sides. Intakes and outlets use the same directional geometry and transfer rate.
4. Every powered device stops when disabled, broken, burning or unpowered. Port valves and intact source/target equipment are also required. Enabled idle devices retain their rated demand, matching current gas equipment. Disabling releases that demand immediately through `refreshPower`.
5. An inventory intake reads a neighboring `waterTank`'s **input**, or the **output** of a recipe that actually produces water, including the bilge pump and ice processor. It never pulls depot stock, a recipe batch, crew cargo or construction reservations. Pausing a producer does not forbid using its existing output; disabling tank refilling does not close a separately controlled intake. Broken or burning source equipment blocks the adapter.
6. An inventory outlet supplies only an adjacent, functioning, enabled recipe with a water input. Respect `inputBatchesWanted` and both the recipe's two-batch capacity and incoming shipment reservations. It changes `machine.input.water`; the existing operator still starts and completes the recipe. It does not run a workstation remotely or replace other ingredients.
7. Floor intake/outlet acts only on the single tile behind/ahead. Require `liquidOpen` for that tile, cap intake by actual floor water and outlet by the existing four-unit floor capacity. Several devices process deterministically and cannot collect the same amount twice. This complements the existing five-tile bilge recovery pump without altering its range or output.

### Hauling reservation contract

This is required before inventory adapters can ship. `industry.js` currently reserves output through `crew.intent.type === 'haul'` and input capacity through either pickup intents or carried shipments. Those are claims, not extra material owners.

- An output intake subtracts the water in matching living crew pickup intents for the same site, source tile and `source: 'output'`. The remaining unclaimed output is available. Already carried water was removed from output and is not subtracted again.
- An inventory outlet subtracts water in matching living crew incoming `delivery`/haul-intent destinations with `kind: 'input'`. It fills only the residual desired capacity. Later adapters in the same tick see earlier transfers.
- Reuse one set of reservation helpers in both hauling and plumbing. Prefer a small pure `src/inventory-reservations.js` module over a second subtly different copy of `industry.js`'s private `incoming` calculation. Keep current hauling semantics while exposing the same counts.
- New hauling decisions already see current machine input. Existing deliveries remain honored; changing a machine order or pausing it does not destroy cargo. A removed/changed target uses the existing return-to-storage behavior.
- Water movement uses `extract`/`add` for inventories. Restrict extraction to `{water:n}`; never rebuild whole inventories from counts and lose food or item metadata.

## Leaks, removal and tick order

Below 50% condition, a node attempts to leak `0.5 × (1 − condition/50)` per tick. The rate is independent of its valve. Deposit into the owning floor tile if open; for a pipe under a wall or sealed door, distribute deterministically among orthogonal open tiles with remaining floor capacity. A full or completely enclosed destination retains the remainder in the node. Never erase overflow. Floor water subsequently follows existing ground, edge and space-loss rules.

Water-pipe repair requires 1 alloy and 3 supplied engineering work. Removal requires 3 construction work and refunds 0.5 alloy. At completed dismantling, recover all contained water into a physical `{water:n}` drop at the crew's accessible work position, recording network-to-inventory delivery. This is a supplied crew recovery operation, not an instantaneous valve dump. Removing a reservoir does the same; unrelated gas/cable/water overlays survive demolition of the building above them. Damaged unattended nodes only leak; they do not create packaged drops.

Use the existing damage path with a distinct `waterPipe` target. Extend fire/debris damage, incident validation, engineering labor mapping and maintenance visibility. Do not repurpose the existing `pipe` target, which means gas pipe.

Approved simulation order:

1. Debris, then `flowPlumbing`: passive node leveling and damage leakage.
2. Existing `flowLiquids`: tank drains, floor spread and losses.
3. Existing power allocation, including wet-cable faults.
4. Existing `pumpLiquids`, then `operatePlumbing`: directional transfers, intakes and outlets.
5. Existing gas/atmosphere/thermal/fire and remaining colony work.

Each enabled plumbing device gets one bounded transfer attempt in deterministic alternating tile order. Thus a bilge pump can feed an intake this tick, while output from crew-operated ice processing later in the tick becomes available next tick. Water deliberately discharged after electrical allocation can suppress fire in that tick; it affects wire fault allocation next tick. This order must appear in player/debug descriptions and tests, not rely on a stale `powered` result from a previous tick.

## Conservation and save contract

For each site:

```text
water stored in pipes and reservoirs
  = plumbing.loaded + plumbing.recovered
    − plumbing.delivered − plumbing.released

floor water
  = liquids.released − liquids.recovered
    − liquids.lost − liquids.quenched
```

- Inventory → network increments `plumbing.loaded`.
- Floor → network increments both `plumbing.recovered` and `liquids.recovered`.
- Network → inventory, including dismantling recovery, increments `plumbing.delivered`.
- Network → floor increments both `plumbing.released` and `liquids.released`.
- Node → node changes no boundary ledger. Floor loss and fire quenching continue to use existing sinks; there is no separate plumbing loss counted a second time.

Add node water once to `totalResources().water`; the depot resource bar remains available depot stock. The two boundary ledgers describe successive transfers, not additional supplies. Test global conservation in controlled fixtures without unrelated recipe/crew consumption, and test recipe accounting separately.

Migration from the accepted preceding schema initializes `waterPipe:null` on every tile and a zero plumbing ledger. It does not call `initializeLiquids`, empty wet floors, alter existing tank/pump buffers, reset gas/exhaust state or seed new equipment. Preserve RNG, tick, orders, shipments and existing liquid/energy ledgers. New storage fields appear only on matching new devices; older saves cannot already contain valid instances of those new IDs.

Validation rejects nonfinite/negative/over-capacity water, invalid valves/directions/modes, extraneous device state, invalid placement and unbalanced ledgers. Extend job kind/cost/work/target checks, maintenance incident targets and labor mapping for water-pipe jobs. Current-schema malformed state must be rejected, not repaired by default initialization. Prove migration with a deliberately wet, damaged, partially shipped preceding-schema save.

## Actions, observations and events

Register all setters in `src/controls.js`; use the same dispatcher for buttons and local agents. Approved actions:

| Action | Arguments after `{site,x,y}` | Target |
| --- | --- | --- |
| `plumbing.valve` | `open:boolean` | Pipe/reservoir node |
| `plumbing.pump` | `enabled:boolean, direction:enum` | `waterPump` |
| `plumbing.intake` | `enabled:boolean, direction:enum, mode:'inventory'|'floor'` | `waterIntake` |
| `plumbing.outlet` | `enabled:boolean, direction:enum, mode:'inventory'|'floor'` | `waterOutlet` |

Directions are east/south/west/north. Construction uses `job.order` with the new building IDs; extend its kind catalog with `repairWaterPipe` and `removeWaterPipe`. Existing `water.tank`, `production.enable` and `power.priority` remain the controls for existing equipment. Dedicated action validators must reject the wrong device type without silently replacing its control state.

Expose raw node/device state plus `derived.plumbing` containing `water`, `capacity`, percentage `fill`, `input`, `output`, `inputSlot`, `outputSlot`, `reservedInput`, `reservedOutput`, `blockedCode` and readable `blocked`/`status`. Quantity readings also include `sourceWater`, `sourceAvailable`, `targetWater`, `targetCapacity`, `desiredCapacity` and `targetFree`. `reservedOutput` protects source machine-output pickup claims; `reservedInput` protects target machine-input deliveries. Status endpoint IDs use `tile:site:x:y`; transfer events qualify owners as `{entity,slot}` with `machine.output`, `machine.input`, `waterPipe`, `waterStore`, `liquid` or `drop`. A tile can simultaneously expose reactor/radiator/gas/plumbing derived conditions without overwriting another system. Raw water-network fields and the site ledger use typed `plumbing` changes.

Blocked codes distinguish `disabled`, `damaged`, `fire`, `no_power`, `missing_source`, `missing_target`, `wrong_source`, `wrong_target`, `source_damaged`, `target_damaged`, `valve_closed`, `source_empty`, `source_reserved`, `target_full`, `target_reserved`, `target_paused`, `target_order_complete` and `floor_blocked`. Implemented priority is device fire/disabled/damage; missing/wrong endpoints; endpoint damage/fire; valves; blocked floor; paused/completed-order target; power; empty/reserved source; full/reserved target. The guide records this priority alongside the exact API. Readable strings can be translated independently later.

Emit named events for transitions that may finish within one tick:

- `plumbing.transferred`: node → node, reason `level` or `pump`.
- `plumbing.loaded`: inventory → node, including source slot; reason `intake`.
- `plumbing.recovered`: floor → node; reason `intake`.
- `plumbing.delivered`: node → inventory, reason `supply` or `dismantled`.
- `plumbing.released`: node → floor, reason `outlet` or `damage`.
- `plumbing.valve.changed` and `plumbing.device.changed`: validated control changes.

Each transfer includes `from`, `to`, positive `amount`, `reason` and the responsible device where applicable. Record quantities at the actual boundary transfer, not only the final tick delta. Rejected actions keep existing player/agent/source labels. Recording remains optional and bounded; it must not change saves or RNG.

## Minimal interface

The implemented Water button is in the visible map controls beside Power, Gas and Cutaway, with mutually exclusive Water/Gas/Power overlays initially off. Device details remain in the hidden inspector. Keep ordinary puddles and leak warnings visible in normal play. Water pipes use a distinct route color/pattern, reservoir silhouette and pump/intake/outlet arrows so color alone is not the identifier.

The selected-tile inspector shows contents/capacity, valve, condition and one reason for blockage. Device controls reveal enable, direction and applicable inventory/floor mode. Show the actual target machine and its reserved/free capacity so a player understands why a visibly non-full machine rejects water. Repair/removal controls appear in the same inspector. Preserve the existing held-pointer and focused-input guards; do not rebuild a pressed control away during a tick. All buttons retain `data-simulation-action` and stable selected-entity labels.

## Acceptance and staged ownership

Acceptance requirements covered by the evidence index:

1. Physically paid construction; empty new devices; overlay coexistence and invalid placement; repairs and cancellation preserve material reservations.
2. Tank intake → pipe → pump → reservoir → consumer decreases the correct source by exactly the increase elsewhere; actual hydroponics/atmosphere batches still require their worker and other ingredients.
3. Output pickup reservations and incoming machine shipments remain valid during competing transfers. Cover a partially carried shipment, two adapters, paused orders and a dismantled target.
4. Finite flow under closed valves, no power, empty/full nodes, damaged equipment, reverse pump direction and no pump side bypass. Joining/splitting networks preserves every stored unit.
5. Floor intake/outlet and node leaks maintain both ledgers; closed doors, saturated tiles, wall-mounted leaks, wet-cable brownout and fire quenching use the specified tick order.
6. Full reservoir dismantling on an already wet floor recovers all water once into the accessible drop. Removing the building above an unrelated overlay preserves that overlay.
7. Save continuation is deterministic; migration preserves a nontrivial prior save without grants; malformed controls, capacities, ledgers and job targets reject.
8. Shared action validation, stable observations/events and recording replay/noninterference. Browser checks cover the optional route view and hidden inspector, targets/blockage, held-click controls and save reload with retained contents.

Historical work split; all workers completed this increment. Current ownership is recorded in the shared chat:

- **Network worker:** `src/plumbing.js` and core node/flow tests; no shared integration-file edits while another worker owns them.
- **Logistics worker:** `src/inventory-reservations.js`, coordinated `src/industry.js` refactor and reservation-focused tests; preserve existing hauler behavior.
- **Integration owner:** `src/data.js`, `src/inventory.js`, `src/simulation.js`, `src/liquids.js`, `src/power.js`, `src/maintenance.js`, `src/fire.js`, `src/crew.js`, `src/controls.js`, `src/telemetry.js`. One writer owns these shared hotspots after retained-exhaust source settles.
- **UI worker:** new `src/plumbing-panels.js`, coordinated app/render/index and maintenance-panel changes; isolated browser QA.
- **Independent verification workers:** conservation/edge cases and migration/action/replay cases in separate test files; one owner runs the integrated full suite once changes settle.
- **Root:** approve interfaces, inspect ownership-sensitive code and rendered UI, accept evidence, update concise memory/status and system docs. A design document alone does not satisfy implementation acceptance.

**Acceptance complete:** callable node logic, shared reservation helpers, source integration, independent checks and browser review passed. Remaining fluid heat/contamination/vertical flow and electrical protection are separate increments; none is implied by these plumbing results.

## Baseline source findings that drive this design

- [liquids.js](../src/liquids.js): only tank input currently releases floor water; recovery writes `machine.output`; `validateLiquids` balances floor quantities and must see new boundary transfers.
- [industry.js](../src/industry.js): `incoming` is private; source pickup claims and destination delivery checks already exist. Ignoring them would steal promised output or overfill a machine while a hauler is en route.
- [inventory.js](../src/inventory.js): `totalResources` already counts machine input/output/batch and floor water. New nodes add one new owner; they must not alias one of those buffers.
- [production.js](../src/production.js): `inputBatchesWanted` handles continuous/fixed/stock orders. `projectedStock` counts accessible products, not all retained resources. Initial plumbing should not silently redefine stock-target meaning to include inaccessible sealed reserves.
- [simulation.js](../src/simulation.js): current water/power tick order, explicit overlay jobs, save migration and recipe-buffer validation are integration points; every new job kind needs all associated validators and labor mappings.
- [power.js](../src/power.js): consumer demand already checks machine/climate/gas enabled state; add water-device enabled state to both allocation and displayed status.
- [maintenance.js](../src/maintenance.js), [fire.js](../src/fire.js), [crew.js](../src/crew.js): existing `pipe` refers specifically to gas. New damage and work targets must stay distinct.
- [telemetry.js](../src/telemetry.js): derived state currently has special reactor/radiator/gas branching. Adding another overlay requires deliberate composition, especially on a reactor tile with both pipe types.

These findings describe schema 34 before plumbing edits; source may now contain the planned integration. Background: [floor water](floor-water.md), [water supply](water-supply.md), [station-system sequence](station-systems-reference.md), [gas networks](gas-networks.md). This increment adds no external dependency or runtime service.
