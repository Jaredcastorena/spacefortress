# Electrical branch isolation

**Implemented and verified — schema 36.** The first part of the [electrical protection contract](electrical-isolation-design.md) is accepted: 731 full-suite tests and scoped browser checks passed. [Verification status](verification-status.md) records exact evidence and limits.

A physical breaker separates electrical branches. It can be operated manually or latch open when its output branch contains a wet cable that would receive fault power. Its two ports, connected generators and stored battery energy determine what remains live.

## Construction and operation

| Property | Rule |
| --- | --- |
| Building | `breaker` |
| Construction | 4 alloy, 1 component, 8 work; actual material delivery and crew work |
| Placement | Empty surface habitat floor; no cable overlay on the breaker tile |
| Initial state | Open, east-facing, manual mode, no trip latch |
| Electrical role | Two opposite terminals; no side connection, demand, generation or battery store |
| Condition | Any positive condition permits the contact to close; zero condition disconnects |

An east-facing breaker's input terminal faces west and its monitored output faces east. North/south orientations follow the same rule. Power can travel in either direction: the labels define the monitored side, not a one-way electrical valve. Gas and water pipes remain independent overlays under the existing placement rules. A cable cannot be added beneath the breaker later to bypass its contact.

The visible Power map button selects the optional wiring overlay. Breaker settings and terminal diagnostics live in the selected-tile inspector. A compact advisory shows any bypass and available output-side sources without opening the details disclosure; battery entries show retained charge. The disclosure contains terminal/fault identities and the predicted trip. Damaged-device text explains repair preserves the requested switch setting and latch. The first increment has manual and wet-fault modes; it has no current meter, rating or overload timer.

Open the contact before changing direction or mode; a single request to open and reconfigure a currently closed contact is rejected. Closing a tripped or broken breaker is rejected. Repairs cost one alloy and five Engineering work and restore structure condition without clearing a trip latch. Dismantling takes five Construction work and uses the ordinary salvage rule, returning two alloy. The breaker has no automatic service-wear cycle.

Reset requires an intact, physically open device with no fire, clears the trip cause and sets requested `enabled:false`, leaving it open. A trip preserves the prior requested enabled value while its latch forces the physical contact open. Repair also preserves requested enabled state: an untripped contact that was enabled before damage conducts again when repaired above zero condition; a tripped contact stays latched open. The player explicitly closes after reset. Reclosing into the same supplied fault can trip again on the next advancing tick.

## Two separate terminals

The input and output are separate graph vertices joined only by the breaker's internal contact. Opening or tripping removes that edge. A side-adjacent cable cannot create an internal connection through the device. Ordinary neighboring conductors keep their existing orthogonal connections.

An open breaker's terminals may belong to different circuits. Diagnostics expose those memberships separately; one tile-level circuit field cannot represent both. Stable tile IDs remain unchanged. Graph terminal IDs are `<x>,<y>:input` and `<x>,<y>:output` within a site. Circuit `cells` retain ordinary `<x>,<y>` entries and include those terminal IDs explicitly. Circuit IDs are derived from topology and can change after switching; they are not permanent equipment identities.

Opening isolates only the contact. It does not switch off other cable tiles, redistribute battery charge or erase equipment. Another cable path can still connect both sides. The inspector reports that bypass, and automatic protection cannot claim to isolate the output branch through that device.

## Supplied wet-fault decisions

Existing wet cable rules remain: an enabled cable with positive condition and at least **0.25 floor water** requests **5 kW** before ordinary loads. Only a fault receiving that full demand consumes **5 kJ** during a one-second tick, adds five heat units and damages cable condition by **0.25**.

For each closed, enabled breaker in `wet_fault` mode:

1. Determine the output-side component with this breaker's own contact temporarily omitted. Other contacts keep their current state.
2. If the input is still reachable, mark a bypass; this relay cannot identify a separately isolatable output branch.
3. Preview ordinary finite power allocation with the current contacts. Identify actual wet cables that would receive the complete 5 kW demand.
4. If a supplied fault lies in the unambiguous output branch, latch the breaker open with the fault's stable cable ID.

All due trips occur together. Topology and allocation are previewed again until no further contacts need to trip. Each pass only opens contacts, so the number of installed breakers bounds the process. Series relays can trip together; selective coordination is not modeled.

The preview does not spend charge, consume reactor fuel, add heat, damage cables, alter RNG or emit fault events. Only the final settled topology commits energy once. A fault eliminated by opening consumes no tentative energy and causes no tentative damage. No available fault power means no automatic trip merely because a tile is wet.

### Batteries, backfeed and bypasses

A battery or generator on the output side can continue feeding the fault after the contact opens. That surviving fault consumes its real finite supply and still causes heat and damage. A relay can detect such a fault and latch even when the input side has no generator; the latch does not isolate the local source from the fault.

Likewise, an external bypass can keep both sides connected when the contact is open. The inspector reports the alternate route and available output-side sources alongside actual terminal memberships. Opening this contact alone does not guarantee that the branch loses power.

## Time and energy accounting

Plumbing leaks and floor flow run before electrical allocation. Breaker detection therefore sees the wet floor available at that point. Power then commits once, followed by powered recovery/plumbing and later fire processing. Water discharged after that allocation can suppress fire during the current tick; electrical wet-fault detection sees it on the next tick.

The pure `previewPower(s,site)` reads initialized state without mutation. `refreshPower` updates derived diagnostics but does not commit energy or trip a breaker. Inspection, observation, serialization and validation may expose a predicted `wouldTrip`, but must not latch a device or commit energy. An advancing simulation tick applies existing reactor overheat latches once, settles branch trips, then commits power once. Reactor overheat protection remains separate from the branch relay.

The existing conservation rule remains:

`stored + consumed + curtailed + discarded = initial + generated + injected`

Opening a contact is not an energy sink. Denied loads are not consumption. Batteries keep their own charge, and unused generation follows existing storage/curtailment rules. No preview may double-count reactor fuel/heat or wet-short damage.

## Shared controls and observations

Players and local agents share the action dispatcher:

| Action | Arguments | Effect |
| --- | --- | --- |
| `power.breaker` | `site,x,y,enabled,direction,mode` | Configure the matching device with atomic validation |
| `power.breaker.reset` | `site,x,y` | Clear a valid trip and leave the contact open |
| `job.order` | Build `breaker`, or ordinary repair/remove | Physical construction, repair and salvage |
| `power.cable` | Existing cable controls | Independent manual cable isolation |

Saved protection state identifies `kind`, `direction`, requested `enabled`, `mode`, `tripped` and `cause`. Actual connectivity also depends on condition and the latch. Tile observations expose `derived.electrical`, composed with any existing reactor/gas/plumbing readings:

| Field | Meaning |
| --- | --- |
| `inputCircuit`, `outputCircuit` | Current actual terminal memberships; a breaker keeps its single `tile.circuit` null |
| `connected` | This breaker's internal contact conducts |
| `bypassed` | Input remains reachable from output when this contact is omitted |
| `faultEntities` | Stable IDs of output-component wet cables supplied in the current preview |
| `sourceEntities` | Available output-side generators or intact charged banks with this contact omitted; not measured current or proof of a transfer |
| `wouldTrip` | Current prediction for an enabled closed wet-fault relay with no bypass and a supplied branch fault |
| `blocked`, `status` | Stable condition code and readable explanation |

Condition-code priority is `damaged`, `tripped`, `open`, `bypassed`, `manual`, `wet_fault`, then `clear`. A separate bypass/source reading remains available even when the headline gives a higher-priority reason. `breakerConditions(s,site,t)` is the read-only diagnostic helper; the UI's `breakerStatus` wrapper uses the same rule.

Breaker events carry stable tile `entity`, copied `previous`/`next` protection state, `cause`, `faultEntities` and simulation `tick`:

| Event | Cause / evidence |
| --- | --- |
| `power.breaker.changed` | `configuration`; accepted contact/direction/mode change |
| `power.breaker.tripped` | `wet_fault`; deduplicated stable IDs of supplied preview faults that triggered the latch |
| `power.breaker.reset` | `manual_reset`; cleared latch with contact left open |

`power.cable.changed` records tile `entity`, the previous enabled boolean and new `enabled` value for an actual manual cable change. No-op controls do not invent transitions; rejected controls retain the normal shared action result. A trip event records supplied faults in the discarded preview, not energy consumption. Actual final fault consumption is recorded separately by `power.wet_short`.

Recording remains optional, local, bounded and outside saves/RNG. A trip record describes a transition, not proof that it prevented an injury or a training reward.

## Persistence, evidence and limits

Schema 35 to 36 changes the version without granting fields, equipment, cable, material, energy or fuel. Existing cables, switches, water/plumbing, gas/smoke, inventories, priorities, per-bank charge and energy ledgers remain. Older saves cannot claim new breaker structures, protection state or breaker construction orders. Current-schema validation checks exact protection keys, owner/placement, allowed state combinations, paid work orders and derived topology/accounting; breaker state cannot include a machine, battery charge, demand priority or automatic maintenance. Loading neither trips nor consumes anything.

Acceptance covers 59 new cases: physical controls 8, pure graph 8, integrated topology 10, conservation 11, migration 12, instrumentation 7 and cascades 3. The full 731-test suite passed with zero failures/skips; Firefox verified controls, visible remaining-source/bypass advisories, held clicks, artwork and save36 reload. Root inspected the map, tripped contact and both advisories. See [verification status](verification-status.md) for logs and scoped limitations.

This increment detects supplied wet faults on a topological branch. It does not measure voltage/current, model resistance, overload ordinary cables, route per-edge throughput or provide electrical ground-fault sensing. Rated delayed overload breakers, disposable fuses and paid fuse replacement remain **unimplemented proposals** in the design document. No overload/fuse values or timers belong to current saves. Automatic load controllers, cable thermal capacity, arc faults and inter-site transmission also remain future work.
