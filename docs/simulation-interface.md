# Structured simulation interface and recordings

Implemented September 16, 2026, following the user's request to clearly mark small simulation interactions for eventual AI training. This is a local environment interface and recorder. No model, training service, network endpoint or external dependency is involved.

## One set of gameplay controls

`src/controls.js` registers the named action catalog. The browser's gameplay controls and `window.spacefortress.act(id, args)` use the same dispatcher, argument validation and underlying simulation rules. An agent cannot gain free resources or teleport workers through this interface. Autonomous simulation jobs still use internal functions; their outcomes appear in tick records and semantic events.

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

Observation schema version **1** uses `{schemaVersion, tick, entities}`. IDs are stable within a colony/recording and scoped to that episode:

| Entity | ID | Contents |
| --- | --- | --- |
| Colony | `colony` | Tick, seed/RNG state, available resources, expedition/departure/shuttle state, objectives, hazards and narrative log |
| Site | `site:surface` | Site metadata, circuits, energy/atmosphere/heat ledgers, designations, incidents |
| Tile | `tile:surface:12,7` | Terrain, structure/condition, inventories, machines/orders, cable/power, storage and maintenance |
| Compartment | `room:surface:7,7` | Floor cells, gases, heat and derived room purpose/readiness, comfort, temperature and breathability |
| Crew | Existing ID, such as `crew-0` | Position, needs, work/recovery intention, skills, labors, memories, relationships, medical/sanitation state, housing/preference, and derived current/home comfort |
| Job | Existing ID, such as `job-1` | Kind, target, worker, priority, progress, blocked reason, reserved and delivered materials |
| Meal batch | `meal-job-1` | Cook, quality, creation tick, remaining food and all inventory/portion locations; may be split between owners |
| Item | `item-1` | Maker, style, quality, creation tick and physical owner/slot; see [possessions](possessions.md) |
| Creature | Existing creature ID | Species, position, health, feeding, husbandry and derived pasture/post reachability and breeding/transport status |
| Fire | `fire-1` | Target tile, intensity, age, response retry and obstruction; suppression jobs reference this ID |
| Brood | `brood-1` | Carrier, mate, start tick and development progress; disappears on birth/loss |
| Pasture | `pasture:surface:4:15` | Enclosed bristleback-accessible cells and lichen; derived physical region |

Room IDs use the lowest floor cell in row-major order, not a volatile room-array index. A split or merge may add/remove IDs or change cells under a retained anchor; room identity is not a claim that topology stayed unchanged. Pasture IDs likewise use the lowest accessible cell and can change during splits/merges. Tile IDs survive structure replacement. New persistent fields automatically enter observations and deltas; new derived information needs an explicit observation addition.

Coordinates are local tile integers. A simulation tick is the game's abstract one-second step; wall-clock playback speed is separate. Needs/condition generally use 0–100; skill XP, resource units, recipe work, energy in kJ, power in kW, and room temperature in °C retain their simulation definitions. Gas and thermal mass are game abstractions. Human text (`activity`, `status`, `blockedReason`, memory text) supplements structured IDs, values and paths.

The current interface exposes the full prototype state, including remote sites and RNG. It is not a fog-of-war observation boundary. Before training a player-equivalent agent in a future game with hidden information, introduce a versioned visibility filter. Derived room comfort alone is not a reward function.

Visible crew buttons and the selected inspector have `data-entity` labels. Gameplay inspector buttons/forms have `data-simulation-action` labels matching catalog IDs. Agents do not need screen coordinates to use the structured interface.

### Outpost and transport readings

The colony's derived shuttle location and expedition return IDs complement each crew member's `derived.residence` and `derived.expedition.selectedForReturn`. A site's `derived.shuttle` distinguishes an intact terminal from a craft that is physically there. `site.derived.expedition.crewLimits` exposes `{min, max, defaultCount}` for outbound selection; `colony.derived.expedition.crewLimits` is null when there is no active destination.

- `site.derived.freight`: `site`, `location`, `present`, `usable`, `capacity`, detached `onboard`/`salvage` inventories, `claimed`, `reserved`, `free`, active `job` ID and `blocked`. Reserved freight represents actual job source/material/carry owners; a job's requested cost is not another inventory.
- `site.derived.outpost`: founding history and registered residents for the supported wreck, otherwise null.
- `site.derived.habitat`: the pure readiness result for the registered roster, otherwise null. Fields include `site`, `crewIds`, `ready`, stable `blockers`, dock condition, measured `rooms`, bunk assignments, local available/required provisions with owner sources, current power circuits and individual crew/care conditions. An empty roster reports that a proposed selection is required.

The UI can call the same pure readiness helper for a complete proposed roster before stationing it. It checks actual paths, room gas/temperature, current utility allocation and unpromised local supplies. Neither observation nor a readiness call reserves stock, claims a bunk, emits an event or advances time. Onboard freight and surface stock cannot count as local resident provisions. Returned item/meal locations retain their physical `shuttle.freight`, dock `imports`, job, carry and storage slots.

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
