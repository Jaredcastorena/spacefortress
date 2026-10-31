# Structured simulation interface and recordings

Local schema75 derives room pressure and oxygen partial pressure from actual gas, volume and room heat. Existing observations expose the updated values; actions, IDs and observation/recording schema9 stay unchanged. Old saves retain every physical quantity while derived readings update. [Room pressure](room-pressure.md) documents finite targets and thermal limits.

Local schema74 adds `power.fuse` (`site,x,y,z?,enabled,direction,rating`) and supplied `job.order` kind `replaceFuse`. Protection observations retain actual-floor IDs and expose immediate blow predictions and last committed flow. Events `power.fuse.changed`, `power.fuse.blown`, `power.fuse.replaced` identify configuration, overload and paid work. Observation/recording schema9 remains unchanged. [Fuse rules](fuses.md).

Local schema73 extends `power.breaker` with optional `rating` (4/8/16/32), plus `overload` and `wet_fault_and_overload` modes. Optional `z` continues to select the actual floor. Definitions expose breaker ratings and the three-tick delay. `derived.electrical` reports planned/signed contact flow, last delivered flow/tick, effective rating and counter state. `power.breaker.overload.changed` records counter transitions; overload `power.breaker.tripped` events identify attempted throughput and effective rating. Only final settled transfers spend energy/fuel or damage wet wiring. Observation/recording9 is unchanged. [Rules and scope](breaker-overloads.md).

Local schema72 adds `population.contact {}` and `population.respond {offer, accept}`. Player and agent commands share validation; stale offers and malformed arguments reject without changing the colony. `colony.derived.population` exposes detached roster, candidate, timing, landing and current food/air/bunk warnings. Definitions include `recruitment` timing constants. Events are `population.offer.opened`, `population.offer.declined`, `population.offer.expired`, `population.arrival.accepted`, `population.arrival.blocked`, `population.arrival.diverted` and `crew.arrived`. Landing events identify the real pad and stable offer/person IDs. Ordinary work, meals and care retain their existing events. Observation/recording9 is unchanged. [Recruitment](recruitment.md).

Local schema71 adds `depot.limit` with `site`, `x`, `y`, optional `z`, `resource`, and `limit` (integer 0–320 or null to clear). Successful changes emit `depot.limit.changed` with the canonical tile entity, site, resource, previous cap and new cap. Depot tile observations expose `derived.depot` totals and `derived.depot.resources` with each resource’s stored, reserved, incoming, used, limit and free quantities. Observation/recording9 remains unchanged. Intake caps do not remove existing supplies or block reservation refunds.


A surface herd warning emits `herd.quiet` when two or more living bristlebacks stop clicking during the 90 seconds before a debris forecast, and `herd.calling` when that marker appears or the herd falls below two. The forecast tile, impact and supplies are unchanged. Observation/recording 9 is unchanged.

Local schema70 orders power-cell installation through `power.discharge_cell`. Optional `x`, `y` and `z` select one surface battery; omitted coordinates choose a reachable bank with 100 kJ free. The action reserves one cell and creates a `chargeCell` hauling job. `power.cell.installed` identifies the actor, job, bank and 100 kJ only after that work finishes. Cancellation returns the cell. Observation/recording9 is unchanged.

Local schema69 adds `fuelSynthesizer` to building definitions and the existing `job.order` construction path. Its generic `production.enable`, `production.order` and `production.priority` controls retain optional `z`. Read the building/recipe definitions and production readiness for required cells, water, skill and environment. Existing `production.batch.started` and `production.batch.completed` events identify `recipe: "fuelSynthesizer"`, actor, job, full tile owner and input/output amounts. Fuel remains in the machine output until physically hauled. Observation/recording9 is unchanged.

Implemented September 16, 2026, following the user's request to clearly mark small simulation interactions for eventual AI training. This is a local environment interface and recorder. No model, training service, network endpoint or external dependency is involved.

## Planet hierarchy and catalog versions

Save schema68 and later admit the original region schema1 catalogs and the new region schema2 catalog. Existing saves retain their four or six physical sites and exact metadata; only newly generated schema2 worlds have three planets/eight sites. `definitions().region.planets` maps stable IDs to name, home site and, for schema2, system-map position, color and label. Every site retains its `planetId`; routes keep canonical `from: "surface"`, destination, round-trip fuel and per-leg time. Discover actual IDs through definitions/actions.

Planet/site map selection is transient UI state. It does not alter saves, RNG, discovery, inventory or simulation commands. Grouped navigation and surveys use the same catalog; map transit is drawn only when both endpoints are visible. All generated landing/derelict grids retain the existing vacuum-settlement `kind: "wreck"` rules. No remote-to-remote travel is implied.

The local constructor supports `createGame(seed, {regionSchema: 1})` for explicit reproducibility of the prior six-site new-world catalog; the player new-colony path defaults to schema2. Validation dispatches from stored region schema and rejects schema2 on pre68 saves, mixed catalogs and changed metadata. Observation/recording9 stays unchanged with additive catalog data.

## Engineering equipment

`definitions().toolKinds` describes each tool family and its supported job kinds. `alloy_kit` and `composite_kit` produce physical `engineering_tool` items through the tool workshop. Existing `crew.tools.equip`, `crew.tools.cancel` and `crew.tools.release` actions share one work-tool slot across mining tools and engineering kits. The existing `repair_pick` recipe ID is retained and now repairs either family.

Engineering kits affect build, remove, repair, service and cable/gas-pipe/water-pipe repair or removal jobs. They do not speed mining, production, medical work or suppression. Crew `derived.tool` includes `kind` and detached `appliesTo` job kinds; its multiplier describes supported work. The optional internal work-specific status also reports applicability and an effective multiplier. `tool.crafted` and `tool.repaired` include kind; `tool.used` includes kind and workKind. Stock forecasts match type/material and committed repairs retain the original item properties.

Schema67 admits engineering items and recipe commitments; prior hex saves preserve quantities and identities. Old schemas cannot carry these new item/recipe fields. Observation/recording9 remains unchanged with additive fields.

## Structural materials

`job.order` accepts optional `material: "alloy" | "composite"` only for `kind: "build"` and `building: "floor" | "wall" | "door"`. Omission means alloy. Positional player bindings retain `site, x, y, kind, building, z, material`; adding material does not change the floor argument. Repair uses the installed structure's material automatically.

`definitions().materials` exposes shared tool and structure properties; `definitions().structuralMaterials.buildings` lists eligible building IDs. Tile `derived.materials` reports independent `floor` and `structure` layers, including implicit alloy, conductivity and applicable repair/damage properties. Installation/removal events are `construction.material.installed` and `construction.material.removed`, with actual-floor entity, actor, job, layer, material and paid cost or refund. Structural job creation/completion includes material selection; structure damage includes material and raw incoming amount.

Schema66 stores sparse tile `materials` and structural-job `material`, validates paid work/cost and preserves older saves without stock changes. Floors conduct heat only between adjacent stacked compartments in this model. Gaps and openings retain independent paths; utility overlay damage is not reduced by the wall's material. Observation/recording9 remains unchanged with additive fields.

## Seeded region and dynamic destinations

Save schema65 stores canonical `region` metadata and each physical site's `kind`. `definitions()` exposes the current sites, region and settlement IDs. Query `actions()` for state-dependent site enums; do not hardcode the original four IDs. New games add `outcrop-<seed token>` and `derelict-<seed token>` sites. Older saves retain the original catalog without adding physical state.

The colony observation exposes `region`; site observations include definition, initial survey and outpost state. Initial surveys describe extractable starting deposits, not current inventory. Expedition preparation, departure, arrival and return context includes a stable `route` ID. Route fuel covers both legs; route travel is per leg. Physical resources, depletion, buildings and inhabitants stay in mutable site state across saves and visits. Observation/recording9 remains unchanged with additive fields.

## Crew hazard positions

`fire.exposure` adds `target`, the actual-floor tile ID, for both crew and animals. `wreck.debris.exposure.target` now also includes a nonzero floor. Crew fire injury, sealed-room protection and docked-shuttle immunity use the occupant’s full position. Ground tile IDs and damage formulas retain their existing form; save64 and observation/recording9 are unchanged.

## Mining tools

`crew.tools.equip` accepts `crew`, `source` (`stock`, `drop`, or `output`) and physical `item` ID. It reserves the item and creates a native walking request; no inventory moves until arrival. `crew.tools.cancel` releases a pending claim; `crew.tools.release` puts the equipped tool on its owner’s actual floor. A crew member can hold one tool and one keepsake.

`production.recipe` adds `alloy_pick`, `composite_pick` and `repair_pick` at a tool workshop. Repair accepts a worn tool plus one alloy, preserves its ID/maker/material/quality/creation tick and restores condition after paid operator work. Repair uses continuous or batch orders; stock targets are rejected. Committed batches retain their original recipe when selection changes.

Crew `derived.tool` exposes condition, multiplier, broken state and pending pickup. Item records have `kind: "mining_tool"`, material, quality, condition and stable identity. Events include `tool.crafted`, `tool.pickup.planned`, `tool.pickup.cancelled`, `tool.equipped`, `tool.released`, `tool.used`, `tool.broken` and `tool.repaired`. Save schema64 stores these items and claims; observation/recording9 remains unchanged with additive fields.

## Physical item and meal locations

`item.pickup.planned` and `item.owned` identify the actual-floor source; `item.released` identifies the actual-floor destination for manual release and death. `meal.prepared.entity` identifies the workstation’s floor. Item `location` and prepared-meal `locations` use the same canonical tile ID: ground remains `tile:site:x:y`, other floors append `:z`. No saved fields or observation-version changes accompany this address correction. Shared release preserves the pocket when the owner has no local tile; the action envelope reports `code: "simulation_rejected"` with `reason: "missing_owner_tile"`.

## Stair flame propagation

`fire.ignited` adds `cause: "stair_spread"` and `connection: "vertical-N"` when a mature source ignites a fitting through a stair opening. `parent` identifies the source fire and `target` remains the actual-floor tile entity. No action bypasses fuel, oxygen or wetness checks. The existing `vertical.hatch` action controls intact hatch containment, while `job.order` with `kind: "extinguish"` uses normal delivered water and work. New flames burn from the following tick. This adds no saved fields or recording version.

## Extraction on declared floors

`job.order` with `kind: "mine"` accepts optional `z`. Omission targets ground. The tile's optional `derived.extraction` reports `source`, `kind`, `work`, `output` and (for reserves) `remaining`, without changing state. Shared player controls use the same source rules. `no_extractable_material` rejects an empty or covered source; route and labor requirements remain physical.

`deposit.arrived` identifies the tile, orbital-debris source, impact number, resource, incoming amount, retained reserve, loose overflow and lost material. `resource.extracted` identifies the worker, job, output and source kind; `deposit.depleted` names the resource. Ore is a finite unmined reserve until extraction produces haulable inventory. Observation/recording9 remains unchanged; fields are additive. Schema63 admits impact ore and upper mining. Schema62 migration preserves existing physical state.

## Plant work on declared floors

`job.order` now accepts `plant`, `waterPlant` and `gather` with optional `z`; omitted `z` stays ground. Build `planter` through the same command on an existing habitat floor for two alloy and one fertilizer. Planting consumes one matching raw food portion and requires Production work; watering transfers half a water unit into finite bed moisture. Prepared meals cannot propagate crops. Supply reservations, saved generations, job events, harvest output and player diagnostics retain the actual floor. Upper plant IDs use the existing floor suffix, including `job.created.plant`.

Sunberry growth uses the shared overhead sunlight model. Planter absorption transfers available liquid into the existing cultivation ledger; destruction returns retained moisture at the bed's tile. Schema62 admits these new jobs and buildings, with unchanged observation/recording9. Genuine61 state migrates without physical changes.

## Hazard response on declared floors

`job.order` accepts `kind: "extinguish"` with optional `z`; omitted `z` remains ground. Automatic `fire.response` is a site-wide policy that schedules each fire on its actual floor. `maintenance.auto` accepts the equipment's floor and schedules repair/service there. Suppression costs two delivered water; repair/service costs one delivered alloy. Engineering duty and reachable routes/supplies are required. Existing job, fire and damage events use the actual tile ID. Schema61 persists these upper response jobs; observation/recording9 is unchanged.

## Airlocks on declared floors

Airlock controllers can now be built through normal paid jobs on declared upper floors. The six airlock commands accept optional z; their X/Y equipment references use the controller’s floor. Ownership, queue/cycle state, rescue parties, cargo, movement, event IDs and inspection retain that floor. Approaches can use declared stairs. Each assembly remains on one floor, with two controlled doors and a finite isolated gas circuit.

Omitted z preserves the landing-floor commands and entity IDs. Upper controller and ownership IDs use the existing tile-ID floor suffix. Configuration positions, chamber cells, owned nodes and traveler destinations remain explicit x/y/z; one assembly’s hardware and owned pipes must share its controller floor. Undeclared and mixed-floor references reject before state changes. Schema60 accepts upper assemblies; earlier schemas reject future upper-controller state and jobs before migration.

An exposed upper walkway must have low measured pressure before outer release. A stair opening in the chamber or a gas riser attached to its owned circuit invalidates the enclosure, including a disabled riser that could later open. Power risers remain independent. Upper-floor airlocks do not establish ordinary upstairs endurance.

## Solar observations and availability

Solar tile `derived.solar` reports `daylight`, `exposed`, `blockedBy` (a full position or null), `reason`, `output` and `status`. Reasons are `damaged`, `cable_damaged`, `cable_off`, `night`, `blocked` and `generating`, in that precedence. `output` describes generation within the panel’s own circuit. A disabled or broken cable isolates that circuit; its generation is curtailed, without supplying neighboring equipment. Cable status does not erase generated/curtailed energy. Player inspection uses the same exposure rules. Observation/recording schema9 remains unchanged; this is an additive field.

`power.solar.availability.changed` records a status transition with the panel entity, previous/current status, reason, blocking tile entity or null, and `availableOutput`. It describes available generation, not energy produced. Preview, refresh, save migration and validation cannot add generated energy. Save schema59 validates the old power model before recalculating derived availability for older saves.

## One set of gameplay controls

The job.order action now accepts optional z for basic building, repair, service, dismantling and patient treatment/feeding/hygiene. Material reservation, worker selection, physical delivery, completion, cancellation and occupied boundaries use full positions. Crew walking follows usable declared stairs; it cannot invent a connection. Other unsupported upper work families reject explicitly. This makes 28 actions with optional deck targeting. A paid job.order build with building stairwell now creates the next empty deck and landing only when construction completes; other targeted actions require an existing declared cell. Schema55 persists declared floors and links.

Eleven colony controls also accept optional z: depot filters/priorities, production recipe/order/priority/enable, maintenance policy, room purpose, bunk ownership, pasture gates and pressure doors. Job release, priority changes, haul claims and occupancy checks use the full position. Staffed production now schedules and routes workers on the selected floor, consuming delivered inputs. Meal pickup, bunk recovery, downtime and finite suit refills also use actual-floor positions. Medical cot selection, treatment, bedside feeding/hygiene and rescue also execute within a declared floor. Hauling and rescue records retain actual deck IDs. Vertical hauling uses declared stairs; upper airlock execution is now supported as described above. Together with the sixteen equipment commands, 27 actions expose deck targeting. Other upper work families and airlock/crew actions retain explicit boundaries.

Sixteen equipment controls accept optional z: gas valves/pumps/vents/extractors, water valves/pumps/intakes/outlets/tanks, reactor controls/reset, radiators, climate, cable switching, power priority and breaker controls/reset. Omission targets deck zero; undeclared decks reject without mutation. Existing positional player bindings retain their argument order. These controls do not create floors; paid stairs extend canonical saves beyond the landing deck. Other action families continue rejecting z until their domain callers are converted.

`src/controls.js` registers the named action catalog. The browser's gameplay controls and `window.spacefortress.act(id, args)` use the same dispatcher, argument validation and underlying simulation rules. An agent cannot gain free resources or teleport workers through this interface. Autonomous simulation jobs still use internal functions; their outcomes appear in tick records and semantic events.

The vertical.hatch action sets auto/open/closed on an existing declared stairwell by site and connection ID. Closing requires both landings to be clear. Damaged stairs block walking while their broken hatch remains an environmental opening. Typed vertical.hatch.changed and vertical.traversed records retain connection IDs and actual endpoints, including a carried patient. Paid stair construction is available through job.order with building stairwell. It costs6 alloy and1 component with12 work, includes the upper landing, and supports up to8 decks. Cancellation before completion creates no deck; schema55 saves retain completed links. Floor extension above deck zero requires support immediately below. Schema56 adds connection-owned repair/remove jobs through job.order at either landing. Repair costs1 alloy/8 work; removal costs1 alloy/12 work, runs from below, seals the opening and returns3 alloy while retaining the floors. Both endpoints are reserved. Completion rechecks clear landings and routes for upstairs crew. Events vertical.damaged, vertical.blocked, vertical.repaired and vertical.removed identify the shared connection; jobs expose their connection ID. The browser floor chip and Page Up / Page Down select installed floors. UI-only view state is absent from saves and observations; tile commands carry explicit z through the shared dispatcher. Changing floors clears selection and invalidates held clicks. Selecting a stair landing exposes vertical.hatch controls.

Action families include physical job orders/cancellation/priorities, labor and routines, bunk ownership, animal post assignment/care policies, keepsake collection/release, room purposes, climate, production, depot filters/priorities, power/cables/cells, doors, maintenance, expedition preparation/recall/cargo, and signal choices. `simulation.step` advances 1–300 deterministic ticks. All browser agent actions pause realtime advancement first; further agent steps explicitly advance time. UI camera/menu navigation, playback speed and save-file operations are not gameplay decisions in this catalog.

```js
const game = window.spacefortress;
game.actions();      // Stable action IDs, descriptions, argument schemas
game.definitions();  // Building costs, recipes, resources and shuttle fits
game.observe();      // Detached structured observation; no mutable state reference

game.recording.start();
game.act('housing.assign', {
  site: 'surface', x: 12, y: 7, crew: 'crew-0'
});
game.act('simulation.step', { ticks: 20 });
game.recording.stop();
const ndjson = game.recording.export();
```

Action parameter objects reject unknown fields, invalid types, missing arguments, unsupported values, unknown crew/jobs and out-of-bounds coordinates. Conditional job targets distinguish buildings, shuttle fits and patient IDs. Success uses `code: "applied"`; rejections use `unknown_action`, `invalid_arguments` or `simulation_rejected`, with a human-readable message. When an underlying simulation rule supplies a stable rejection code, the dispatcher additionally returns it as `reason` while retaining `code: "simulation_rejected"`. Successful job orders return a job ID. Success means the designation/control change was accepted, not that construction, recovery or travel has finished.

For Node-based local experiments, import `createGame` from `src/simulation.js`, `executeAction` from `src/controls.js` and recording helpers from `src/telemetry.js`. Use this dispatcher for external decisions; direct state edits are marked `external` and do not contain a player/agent intent.

## Animals on connected floors

`husbandry.assign`, `husbandry.transport` and `husbandry.butcher` accept optional `z` (0–7, default0). The destination must exist on the surface colony; assignment preserves ordinary animal access, while escort uses a handler's path and keeps both actors together. No command moves an animal instantly.

`husbandry.treat`, `husbandry.dispatch` and `husbandry.discard` derive the actual post or carcass floor. Care and collection jobs reserve and deliver their original finite supplies there. Animal movement, post, transport, treatment, product and carcass events identify the actual floor. Save schema58 validates these positions; older schemas still reject future upper-animal state before migration.

## Utility connections between floors

Use `job.order` with `kind: "build"`, `building: "powerRiser" | "gasRiser" | "waterRiser"` and the lower endpoint's `site`, `x`, `y`, `z`. Both adjacent habitat floors and matching cable/pipe endpoints must already exist. Construction costs two alloy/eight work and claims both endpoints; blocked completion retains its material.

`utility.configure` accepts `{site, connection, enabled}`. Connection IDs are `utility-N`; the same command serves player and agent controls. Either endpoint can order `repair` (one alloy/six work) or `remove` (five work/refund one alloy) with the matching riser building. Maintenance jobs expose `utilityConnection`.

Typed records include `utility.constructed`, `utility.repaired`, `utility.removed`, `utility.damaged` and `utility.isolation.changed`; gas/water transfer records include the connection ID. Save schema57 stores `site.utilityLinks` and `tile.risers`. Risers contain no stored gas, water or energy. Existing endpoint valves, cable controls and damage rules still apply; stair hatches are independent.

## Freight, residence and return actions

**v0.1.2 development preview — save schema 38.** These shared bindings, detached readings and recorded transitions have bounded acceptance, including genuine freight and resident controls. The complete fresh-colony endurance/resupply/care/pickup journey remains unfinished. Check the current catalog for precise fields; accepting an action does not mean its shipment or journey has finished.

| Action | Arguments | Effect |
| --- | --- | --- |
| `expedition.launch` | `{site, crewIds?}` | Explicit one or two IDs; one is allowed only for an already established wreck under schema 38. Omission still selects two. |
| `freight.load` | `{items}` | Creates physical surface loading work while the shuttle is present and idle. |
| `freight.unload` | `{site, items?}` | Creates physical unloading work at the usable present berth. Omitting `items` requests all current freight. |
| `job.cancel` | `{job}` | Cancels a freight job through normal physical restitution/carry rules. |
| `expedition.return_crew` | `{crewIds}` | Selects one or two distinct known living people physically at the destination, subject to visitor/residence and shipment constraints. |
| `outpost.residents` | `{site: 'wreck', crewIds}` | Supplies the complete ordered resident roster, with zero to seven distinct known IDs. Additions require a measured operational habitat and at least one living return passenger. |

A freight `items` object must be nonempty and contain only known resource names with finite positive amounts; keepsake counts are integers. Unknown fields, metadata, nonfinite values and malformed rosters reject before mutation. Resource identity/age comes from the reserved physical inventory. UI manifest drafts and return checkboxes do not act until submitted.

Living remote residents cannot be removed by editing the resident list, even after a return seat is selected. Pickup clears their residence at actual departure. Explicit cleanup of surface or deceased entries remains possible. The arrival list, return list, persistent residence and physical site remain distinct. Initial exploration, comet and solar flights still require two. A one-person outbound request is valid only for an already established wreck; it preserves normal paid fuel, service loading and physical boarding. No voluntary empty return, automatic replacement or free supply action is introduced.

`definitions().outposts` publishes supported `sites` and `commissioningReserves`. The reserve numbers are current admission guards, not endurance estimates. See the [outpost guide](staffed-orbital-outpost-design.md) and [expedition logistics](expedition-logistics.md) for physical prerequisites, accepted bounded controls and the unfinished sustained fresh-colony journey.

## Entity identities and observations

Observation/recording schema version **9** uses `{schemaVersion, grid, tick, entities}`. Crew shipment and need targets, personal pickup claims, medical beds and home bunks are `{x,y,z}` objects (nullable fields retain null); job sources include `z`. Home bunks always belong to surface, independently of the owner’s current site. Animal posts also use explicit positions. Carcass tile owners include z; crew/job owner variants remain ID-only, and their derived carcass position includes z. Airlock configuration, route endpoints, door positions and nullable party/queue/traveler destinations use `{x,y,z}`; owned nodes include `z`, and chamber cell keys are `"x,y,z"`. The configure action still accepts ground coordinate pairs. Rooms now include `z`; each local `"x,y"` cell belongs to that room deck. Ground room IDs stay unchanged; a nonzero room deck adds a suffix. Full multi-deck command and entity identity support remains pending. This shape change requires consumers to honor the header version. Existing schema1–8 exports remain unchanged; do not mix records across versions. Pasture entities include `z` and `{x,y,z}` cells. Ground pasture/plant IDs retain their format; nonzero decks append `:<z>`. Animal birth/grazing and pest feeding/capture events retain the physical deck. Room-purpose markers include `z`, and outpost readiness dock coordinates include `z`. Room purposes, occupants, comfort and readiness use each room’s actual deck. Debris forecast targets are nullable `{x,y,z}` positions; site damage incidents include `z`. Ground tile/event IDs remain unchanged. Tile observations, electrical branch diagnostics, gas/water transfers and fire/reactor/damage/breaker/wet-short events can distinguish a nonzero deck with `tile:<site>:<x>:<y>:<z>`. Other event producers and command targeting still require conversion before additional decks are playable. IDs are stable within a colony/recording and scoped to that episode:

| Entity | ID | Contents |
| --- | --- | --- |
| Colony | `colony` | Tick, seed/RNG state, available resources, expedition/departure/shuttle state, objectives, hazards and narrative log |
| Site | `site:surface` | Site metadata, circuits, energy/atmosphere/heat ledgers, designations, incidents |
| Tile | `tile:surface:12:7` | Terrain, structure/condition, inventories, machines/orders, cable/power, storage and maintenance |
| Compartment | `room:surface:7,7` | Floor cells, gases, heat and derived room purpose/readiness, comfort, temperature and breathability |
| Crew | Existing ID, such as `crew-0` | Position, needs, work/recovery intention, skills, labors, memories, relationships, medical/sanitation state, housing/preference, and derived current/home comfort and personal work readiness |
| Job | Existing ID, such as `job-1` | Kind, target, worker, priority, progress, blocked reason, reserved and delivered materials |
| Meal batch | `meal-job-1` | Cook, quality, creation tick, remaining food and all inventory/portion locations; may be split between owners |
| Item | `item-1` | Maker, style, quality, creation tick and physical owner/slot; see [possessions](possessions.md) |
| Creature | Existing creature ID | Species, position, health, feeding, husbandry and derived pasture/post reachability and breeding/transport status |
| Fire | `fire-1` | Target tile, intensity, age, response retry and obstruction; suppression jobs reference this ID |
| Brood | `brood-1` | Carrier, mate, start tick and development progress; disappears on birth/loss |
| Pasture | `pasture:surface:4:15` | Enclosed bristleback-accessible cells and lichen; derived physical region |

Room IDs use the lowest floor cell in row-major order, not a volatile room-array index. A split or merge may add/remove IDs or change cells under a retained anchor; room identity is not a claim that topology stayed unchanged. Pasture IDs likewise use the lowest accessible cell and can change during splits/merges. Tile IDs survive structure replacement. New persistent fields automatically enter observations and deltas; new derived information needs an explicit observation addition.

Coordinates are local tile integers. A simulation tick is the game's abstract one-second step; wall-clock playback speed is separate. Needs/condition generally use 0–100; skill XP, resource units, recipe work, energy in kJ, power in kW, and room temperature in °C retain their simulation definitions. Gas and thermal mass are game abstractions. Human text (`activity`, `status`, `blockedReason`, memory text) supplements structured IDs, values and paths.

The colony grid is `hex-odd-q-v1`: flat-top hexes with integer column X and row Y. The six directions are `n`, `ne`, `se`, `s`, `sw`, `nw`; use the shared [geometry helpers](../src/geometry.js) for neighbors, steps and tile distance.

The current interface exposes the full prototype state, including remote sites and RNG. It is not a fog-of-war observation boundary. Before training a player-equivalent agent in a future game with hidden information, introduce a versioned visibility filter. Derived room comfort alone is not a reward function.

Visible crew buttons and the selected inspector have `data-entity` labels. Gameplay inspector buttons/forms have `data-simulation-action` labels matching catalog IDs. Agents do not need screen coordinates to use the structured interface.

### Crew breathing and suit transfers

Crew breathing is allocated once per site before crew actions or movement. Occupants share safe room oxygen for their bodily demand before optional suit charging; real suit stores cover shortages. Oxygen, pressure, smoke and exhaled-gas limits remain enforced. An empty suit alone does not cause injury when the current breath was fully supplied.

When suit oxygen is used, a suit receives oxygen, or demand goes unmet, recording emits `crew.air.allocated` with stable `entity`/`actor` crew IDs, a site ID, and these game-scale oxygen amounts:

| Field | Meaning |
| --- | --- |
| `roomOxygen` | Oxygen consumed from the compartment for breathing |
| `suitOxygen` | Oxygen consumed from the crew member's suit for breathing |
| `refillOxygen` | Oxygen transferred from the compartment into the suit |
| `unmetOxygen` | Remaining bodily demand after available room and suit supply |

These are measured allocations, not rewards. Normal room-only breathing remains visible through existing room and atmosphere counters. Allocation records are transient and do not add saved resources or alter simulation results when recording is enabled.

### Depot suit refill event

Each positive transfer emits `crew.suit.refilled`. `entity` and `actor` identify the crew member; `site` identifies the site; `target` is the supplying tile ID; `slot` is `stock` or `imports`. `air` is the physical breathing mix consumed, `oxygen` is the gas amount added to the suit, and `ventedInert` is the unused inert gas. `from` and `to` are suit percentages. Zero transfers emit no refill event.

These transfers appear separately from `crew.air.allocated.refillOxygen`, which measures room-to-suit charging. Existing `simulation.step` performs the same automatic recovery for players and local controllers. Observations and recording expose the physical result without adding a saved supply or a new control.

### Outpost and transport readings

The colony's derived shuttle location and expedition return IDs complement each crew member's `derived.residence` and `derived.expedition.selectedForReturn`. A site's `derived.shuttle` distinguishes an intact terminal from a craft that is physically there. `site.derived.expedition.crewLimits` exposes `{min, max, defaultCount}` for outbound selection; `colony.derived.expedition.crewLimits` is null when there is no active destination.

- `site.derived.freight`: `site`, `location`, `present`, `usable`, `capacity`, detached `onboard`/`salvage` inventories, `claimed`, `reserved`, `free`, active `job` ID and `blocked`. Reserved freight represents actual job source/material/carry owners; a job's requested cost is not another inventory.
- `site.derived.outpost`: founding history and registered residents for the supported wreck, otherwise null.
- `site.derived.habitat`: the pure readiness result for the registered roster, otherwise null. Fields include `site`, `crewIds`, `ready`, stable `blockers`, dock condition, measured `rooms`, bunk assignments, local available/required provisions with owner sources, current power circuits and individual crew/care conditions. An empty roster reports that a proposed selection is required.

The UI can call the same pure readiness helper for a complete proposed roster before stationing it. It checks actual paths, room gas/temperature, current utility allocation and unpromised local supplies. Neither observation nor a readiness call reserves stock, claims a bunk, emits an event or advances time. Onboard freight and surface stock cannot count as local resident provisions. Returned item/meal locations retain their physical `shuttle.freight`, dock `imports`, job, carry and storage slots.

### Crew work readiness

Each crew entity exposes `derived.work = {available, blockers, minimumSuitOxygen}`. This comes from the same pure `workReadiness` function used by runtime assignment. `blockers` contains every matching stable code in the order below; an empty list means personal work eligibility passes. `minimumSuitOxygen` is the existing temperament-dependent limit (35 for cautious crew, 25 otherwise).

| Code | Current personal constraint |
| --- | --- |
| `dead` | Health is not positive. |
| `thermal_stress` | Absolute thermal stress has reached the work limit of 45. |
| `immobile` | Mobility prevents independent movement. |
| `rescuing` | The crew member is committed to a rescue. |
| `assigned_medical_cot` | A medical cot is assigned. |
| `off_duty` | The off-duty routine is selected. |
| `in_transit` | The crew member is aboard a travelling shuttle. |
| `busy_intent` | An existing intention occupies the crew member. |
| `carrying` | A carried inventory is already assigned. |
| `assigned_job` | A work assignment already exists. |
| `low_suit_oxygen` | Suit oxygen is below the personal work limit. |
| `hungry` | Hunger is below 35. |
| `fatigued` | Energy is below 25. |

Readiness describes the current tick. A particular job also needs the enabled labor, site/path, supplies and skill requirements. An ongoing intention is available in the crew's existing `intent` field, so a controller can distinguish seeking air, rest and hauling. These readings do not change assignment rules, resources, RNG, saves or recording behavior.

### Workstation crew readiness

Tile `derived.production` retains `eligibleCrewIds` for local living crew with enabled Production and the required recipe skill. It now also exposes:

| Field | Meaning |
| --- | --- |
| `crewReadiness` | Detached `{id, available, blockers, minimumSuitOxygen}` readings from the same personal work rules listed above, for each qualified crew member. |
| `availableCrewIds` | Qualified crew whose current personal work reading is available. It does not predict routes, boarding, airlock traversal or endurance. |

Existing machine, recipe, material and busy reasons retain precedence. If those pass but nobody is personally ready, `blockedCode` is `operators_unavailable`. A mutually assigned operator at this exact workstation can continue when `assigned_job` is the only personal blocker; they still do not appear available for a new assignment. No other personal constraint is ignored. These diagnostics change no assignment rules, costs, save fields or observation schema.

## Local recording and export

Open **… → Start recording**. Stop and export from the same menu. Export produces newline-delimited JSON (`.ndjson`) with:

1. A `header`: recording schema version, game save version, seed, complete initial game state, and normalized initial observation.
2. Ordered records with monotonic sequence numbers and simulation ticks.
3. A `footer`: recording status, limit/stop reason, last sequence and last complete observation tick.

Record kinds:

- `action.requested`: stable action ID, JSON arguments and source (`player`, `agent` or `test`).
- `action.result`: success/rejection code and state changes caused during dispatch.
- `simulation.tick`: exact net field changes across an autonomous simulation tick, including small numeric changes.
- `event`: explicitly named brief occurrences, currently `crew.memory.created`, `job.created`, `job.cancelled`, `job.completed`, `production.batch.started`, `production.batch.completed`, `resource.extracted`, `deposit.depleted`, the `item.*` transitions documented in [possessions](possessions.md), and `meal.prepared`, `meal.opened`, `meal.portion.eaten`, `meal.finished` documented in [prepared meals](prepared-meals.md), and the animal/pest transitions documented in [husbandry](husbandry.md) and boundary/route/movement events in [pastures](pastures.md) plus policy, brood, birth and maturity events in [herd reproduction](breeding.md) and collection/escort/interruption/delivery events in [animal transport](animal-transport.md), plus fire, exposure, suppression and structure damage in [fire and smoke](fire-and-smoke.md). Payloads identify actor, job, target tile, memory kind/mood or produced resources as applicable.
- `external`: state changes outside the dispatcher/tick boundary. These are explicitly not attributed to an agent decision.

The new transport/care event families describe committed transitions:

| Event | Recorded transition |
| --- | --- |
| `inventory.transferred` | Ordinary hauling pickup, full/partial delivery or setdown. `actor`/`entity` identify the carrier; `from` and `to` identify exact `{entity, slot}` owners; `resources` contains positive quantities actually moved. Slots include `stock`, `drop`, `imports`, `machine.input`, `machine.output` and `sanitary.output`. Failed or planned transfers emit nothing. |
| `expedition.preparation.supplies_changed` | Paid service-air target refresh: assigned crew/destination, resource `air`, numeric `previous`/`next`, reason `suit_refill_margin`. This changes the requested target, not inventory. |
| `crew.recovery.cargo_set_down` | Blocked recovery physically moves a parcel from carry to its actual tile or an exclusive job source; includes crew entity, site, tile, recovery `kind`, cargo, exact `from`/`to`, and reason `recovery_blocked`. |
| `freight.ordered` | Terminal job, resource request and `transfers: [{cargo, from, to}]` with exact `sources.INDEX` ownership slots. |
| `freight.picked_up` | Reserved source → carrier, with reason `source_collected`. |
| `freight.delivered` | Carrier → job materials, with reason `materials_staged`. |
| `freight.loaded` / `freight.unloaded` | Finished job-material transfer, actor, cargo and exact `{entity, slot}` source/destination, with destination before/after. |
| `freight.cancelled` | Canceled job, automatic/manual reason and its still-reserved, staged and carried contents. Normal cancellation performs the physical restitution. |
| `expedition.return_manifest.changed` | Previous/next return IDs and reason, including explicit stationing. |
| `outpost.residents.changed` | Previous/next resident roster and founding-history state. |
| `outpost.residence.removed` | A resident actually begins the return trip. |
| `wreck.debris.exposure` | Actual wreck debris injury to a physically present crew member. |
| `outpost.habitat.changed` | A committed tick changes measured readiness, distinct blocker codes or registered roster; previous/next summaries use reason `measured_conditions_changed`. |
| `care.rescue.assigned` / `picked_up` / `delivered` / `interrupted` | Physical patient/helper/site/tile, with destination on assignment and completion/interruption reason. These names all use the `care.rescue.` prefix. |

`inventory.transferred` currently covers ordinary hauling. Construction, freight and recovery retain their specialized events. Individual items also emit `item.moved` for the same transfer: use it for identity, and do not count the quantity twice. Observation and recording schema versions remain unchanged.

Recovery handoff kinds are `air`, `temperature`, `meal` and `rest`. Job-bound parcels use `sources.INDEX` as their destination slot; ordinary parcels use the actual tile’s `drop`. Individual items also receive `item.moved`. The marker does not imply that the original carrier recovered or that another hauler is available.

Every record carries its simulation tick and normal command correlation. General construction/hauling, item movement, meals and expedition departure/arrival events continue to describe their own boundaries. `outpost.habitat.changed` is emitted by explicit simulation hooks, never by a pure `observe()` call; gradual readings remain visible in deltas without claiming a survival prediction. Source contract checks, synthetic action tests and genuine resident controls do not establish the complete sustained fresh-colony journey.

Each state change carries `entity`, `system`, `path`, `op` and applicable `previous`/`value`. Paths are arrays of property names, never executable expressions or slash-delimited pointers. Operations are `add`, `remove` and `replace`; an empty path creates/deletes/replaces an entity. Arrays such as memories and food lots are replaced as complete values. Typed systems include memory, housing, possessions, needs, medicine, sanitation, movement, inventory, logistics, production, power, temperature, atmosphere, room topology/purpose, relationships, hazards and others. Unclassified new fields remain visible under `state` or their entity-family fallback.

`command` links events, tick records and results to the active action-request sequence, or is null for autonomous work. Longer-term consequences can be joined using job, actor and target IDs. This records observed transitions, not an asserted causal explanation. Tick deltas capture net state; semantic markers preserve selected intermediate events. Newly added transient mechanics must emit explicit events if net deltas would hide them.

Recordings are off by default. They reside in memory, separately from saves and simulation RNG. Reloading/importing/starting a new colony does not preserve the current recorder; export first. **New recording** replaces the prior session recording. Default limits are 2,000 records or 16 MB of serialized record/header content. The recorder stops with an explicit `record_limit` or `byte_limit`; it does not evict the initial state or silently discard an older prefix. A limit may interrupt an action or tick: the footer's `throughTick` identifies the last complete captured observation, while later semantic/request records may describe an incomplete boundary. Object overhead/export strings can temporarily use more memory than the serialized byte limit.

## Replay and verification

A complete delta prefix reconstructs the normalized observation exactly. Apply add/remove/replace paths in sequence; only records with `fromTick` advance the reconstructed observation tick. Semantic events and action requests do not themselves apply mutations. Use the footer boundary when a recording hits its limit.

The initial save plus accepted requested commands can replay deterministic command-driven sessions with the same engine revision. Explicit `simulation.step` already advances its correlated tick records; do not advance those a second time. For realtime sessions, autonomous tick records without a command represent separate steps. External direct edits cannot be reproduced from commands alone. Save/schema versions do not uniquely identify source revisions, so archive the engine source alongside datasets intended for long-term replay.

Verification includes detached observations/catalogs, shared player/agent behavior, rejected commands, stable IDs/paths, tiny need and memory changes, explicit production events, exact observation reconstruction, deterministic replay, no RNG/save differences, bounded prefixes, state replacement and exports. The original interface increment passed 15 interface/recording cases within its historical 490-test suite. See [verification status](verification-status.md) for current integrated evidence.

Isolated Firefox verified entity/action labels, recording controls above an open inspector, player and agent actions, explicit stepping/pausing, rejection, local NDJSON export, save/reload and no scoped application errors. The recording menu screenshot was visually inspected. Its stacking order was corrected after QA found the open inspector intercepting menu clicks. Temporary QA processes were stopped.

Dataset rewards, episode success criteria, observation/action batching for training, model training, partial observability, other transient event families and large-scale recording performance remain future work. Crafted possessions use individual item entities, shared ownership controls and named lifecycle events. [Water supply](water-supply.md) adds finite reserve fields, site supply summaries, extraction/depletion events and production start markers.


### Manual suit oxygen release

`crew.suit.release {crew, points}` uses the same dispatcher for players and agents. `points` is an integer from 1 to 100 percentage points of full suit reserve, with 0.1 oxygen units per point. It transfers that crew member's oxygen into their current sealed compartment, requiring a living mobile local actor, sufficient reserve and nominal gas capacity. No movement, job cancellation or target-room argument is provided.

Each crew entity exposes detached `derived.suitRelease = {available, maxPoints, blockedCode, message, oxygenPerPoint, destination}`. Destination is null before a valid sealed room, otherwise `{site, tile, room}` using existing stable entity IDs. `maxPoints` uses the same prospective actual-gas-addition comparison as execution. It is a capacity/reserve limit, not a safe-composition or endurance forecast.

Status codes are `unknown_crew`, `dead`, `immobile`, `in_transit`, `no_site`, `no_sealed_room`, `insufficient_suit_oxygen` and `room_full`; an available status has null reason/message. The direct operation also rejects `invalid_points`; public schema failures retain the dispatcher's existing argument codes. Requested suit shortage precedes room capacity when both fail.

Success emits `crew.suit.released` with actor/entity crew ID, site ID, current tile `target`, canonical room ID, `points`, oxygen units, `suitBefore`/`suitAfter`, `from:{entity:crewID,slot:'oxygen'}` and `to:{entity:roomID,slot:'gas.oxygen'}`. Source suit values are percentage points; destination oxygen is gas units. Rejections emit no successful-release event, while control attempts retain normal recording. Room ingress updates `atmosphere.injected.oxygen`; no new save fields or observation version are introduced.
