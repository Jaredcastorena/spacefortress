# Expedition freight, salvage and return travel

**v0.1.2 development preview — save schema 38.** The supplied two-person salvage journey, physical freight and bounded resident/return controls are verified within their recorded scope; see [the orbital colony loop](orbital-colony-loop.md) and [verification status](verification-status.md). The complete fresh-colony endurance, delayed-resupply, care and final-pickup journey remains unfinished. Detailed propulsion and world generation are also incomplete.

## Supply the shuttle before launch

Open the surface **Colony** inspector or inspect the shuttle, then expand **Freight & local supplies → Prepare a freight manifest**. Add known resources and positive quantities, then choose **Load manifest aboard**. The draft form has no simulation effect until submitted. A loading job reserves physical local supplies; a worker collects them, carries them to the shuttle and finishes three base work units before they become onboard freight.

The craft must actually be at the surface and idle. Finish or cancel existing terminal work before loading or launching. Freight jobs use ordinary job cancellation and persist during saving; waiting, carried and staged quantities are separate from goods already aboard. Only one terminal job can run at a time.

Freight is distinct from [departure service stores](departure-preparation.md). Loading alloy or food as freight does not replace route fuel, protected return fuel, boarding food or paid suit refill. Initial exploration, comet and solar departures select exactly two eligible crew, with no silent substitutes. An already established wreck accepts an explicitly selected one-person service visit; omitting the selection still chooses two. A failed readiness check can delay the departure even after freight loading finishes. Service-mix targets refresh to the current suit refill plus a ten-unit margin when the old target is nearly exhausted; this requests more finite loading work, not free air. See [departure preparation](departure-preparation.md#physical-loading) for the exact rule.

## Unload where the shuttle actually is

At the destination, open its inspector's **Freight & local supplies**. Choose **Unload all freight here**, or enter a partial unload manifest. A dock without the shuttle cannot unload it. Unloading is available during field work, not transit or boarding.

The unload job reserves contents from `shuttle.freight`, then a worker performs the collection, delivery and work. Completion adds them to the dock's separate `imports` inventory. At the surface shuttle, completion instead leaves a loose terminal pile. Arrival and opening a menu do not credit local stock.

| Owner | What can use it |
| --- | --- |
| `shuttle.supplies` | Existing flight service rules; not a remote building budget. |
| `shuttle.freight` | Persists aboard across flights until physically unloaded. |
| Freight job source / carry / materials | Promised goods moving through the terminal job; not additional copies. |
| Dock `imports` | Local builders and haulers after unloading; separate from salvage collection. |
| Local depot / loose pile / machine buffer | Existing local construction, hauling and production rules. |
| `mission.cargo` | Salvage already delivered to the shuttle; spills at the surface on return. |

Local construction can reserve reachable imports or loose supplies directly. Haulers can also deliver imports directly into eligible machine inputs or take them to a depot. Returning does not automatically empty persistent freight: unload it explicitly if the surface colony needs it.

Canceling an unload restores uncollected sources still physically aboard to freight while the shuttle is present. Carried or staged goods remain physically local through normal cancellation. Recall cancels pending terminal work before leaving. Cancellation never promises to put every item back in its original depot.

If a carrier cannot reach their own air, temperature, meal or rest recovery, the parcel can be set down at that actual tile. An existing local job keeps an exclusive source claim there; ordinary cargo becomes a loose pile for another hauler. This is a physical handoff, not loading completion or automatic rescue. Food ages, prepared-meal metadata and discrete item IDs travel with the goods. A manifest accepts resource quantities only, not caller-authored metadata. Blocked routes, carrier death, canceled work, interrupted saves and smaller-hold refits must preserve the remaining owners and capacity.

## Salvage also needs hauling

Mining a satellite or comet deposit creates a loose pile on that tile. Solar collectors produce charged cells at their platform. Neither puts cargo directly into the shuttle.

Selected return travelers with hauling enabled reserve a pickup, walk to it, carry up to six units and return to the dock. Delivery adds the shipment to `mission.cargo`. Freight, salvage, relevant pickup/carry claims and freight-job materials share the hold limit; ordinary local construction and machine shipments do not count as shuttle claims. A failed route does not transfer material remotely.

The destination inspector's collection filter applies to **salvage**, not outbound freight. Disabling a type releases its uncollected reservations; already carried shipments still go to the shuttle. Pickup favors nearby reachable piles, with the configured resource order deciding what fits. Fine-grained stack selection remains future work.

Uncollected piles persist between visits, including comet visits in this fixed-site prototype. A dead carrier drops held cargo locally and releases its claim. The body remains at the remote site; body recovery is not implemented.

## Select the people who return

The initial arrival list is historical. **Return team → Assign selected return team** chooses one or two living people physically at the destination. A newly stationed resident leaves the return list through the explicit residence action; other living arrivals cannot be omitted and abandoned. A held shuttle shipment must be resolved before removing its carrier.

For a final-resident pickup, send one explicitly selected person to the already established wreck. **Choose one or two crew** appears for that destination; uncheck the second outbound crew member before preparing. The paid trip leaves one of the two return seats for the resident. Select both actual return passengers after arrival. A two-person visit instead needs a replacement visitor to settle before bringing a resident home; three people cannot fit and an unregistered visitor cannot be abandoned.

A resident selected for pickup remains resident while waiting. Residence ends on actual return departure. Selection does not move them or grant a seat on an absent craft. No voluntary empty return or new piloting skill is introduced. See the [outpost guide](staffed-orbital-outpost-design.md) for accepted bounded stationing/return evidence and the unfinished sustained outpost/pickup journey.

**Recall assigned return team** starts boarding. It releases travelers' field work and uncollected pickups while protecting residents' local jobs. Surviving assigned travelers walk to the dock and deliver held shuttle cargo. Transit begins only after physical boarding conditions are met. Suits still consume gas during that walk; transit breathing remains abstract.

Travelers can recover locally from need shortages when reachable warm breathable shelter and, when hungry, food are available. Health below 40 still triggers safety recall. Blocked routes keep people on site with a visible reason. **Resume field work** cancels boarding so a path can be cleared before another recall; automatic safety recall can still apply. Existing doors remain controllable from their tile inspector.

Comet automatic recall includes the longest current return walk, fitted transit time and a five-second margin. It cannot guarantee rescue if a route later becomes blocked. An outbound expedition can turn back under the existing abstract transit model, consuming reserved return-leg fuel without buying another complete sortie.

On surface arrival, **salvage** becomes a loose pile at the shuttle. Haulers must take it to a depot, or builders reserve and physically collect it. Returning components unlock fitting designs and Helios Reach; the actual parts still have to be delivered and consumed in an upgrade. Persistent freight retains its separate onboard owner.

## Fitting choices

Inspect the surface shuttle to queue a supplied engineering refit. One fitting is installed at a time; replacement consumes the new fitting's cost. Capability changes on completion. A pending refit or shuttle condition below 50 blocks flight; cancellation preserves the installed fitting. A smaller fitting must accommodate freight already aboard.

| Fitting | Hold | Fuel per sortie | Time each way | Exposure injury | Installation cost |
| --- | --- | --- | --- | --- | --- |
| Standard hold | 18 | Route baseline | Route baseline | Full | 1 alloy to restore stock configuration |
| Expanded cargo racks | 36 | Baseline + 1 | Baseline + 6 seconds | Full | 8 alloy, 3 components |
| Storm shelter | 12 | Baseline + 1 | Route baseline | 25% | 8 alloy, 4 components |
| Transfer drive | 18 | Baseline − 1, minimum 1 | Baseline − 6 seconds | Full | 6 alloy, 5 components |

A unit of any resource occupies one hold unit; separate mass, volume and containers are not modeled. The installed fit is captured for a sortie. At the wreck, a sealed floor compartment or an actually usable docked craft’s terminal protects crew from periodic debris. Outside shelter, the present craft’s fitting modifier applies only to assigned return travelers; a departed craft provides none. Debris and solar hazards remain stylized; there is no detailed radiation-dose or ship-hull model.

## Actions, persistence and limits

Shared actions are `freight.load({items})`, `freight.unload({site,items?})`, `expedition.return_crew({crewIds})` and the existing `job.cancel({job})`. Omitted unload quantities request all current freight. See the [simulation interface](simulation-interface.md) for strict argument validation, status fields and event recording.

Schema 8 introduced salvage/fitting state; schema 36 used explicit two-person departure selection. Schema 37 added independent freight/import owners and the return roster. Schema 38 now implements the freight job/source vocabulary; the 37→38 migration changes only the version. Migration preserves existing inventories and crew; it does not refill the ship or establish a settlement. Current validation must reject malformed locations, duplicate claims/owners, incompatible mission jobs and hold overflow.

The earlier 252-test checkpoint included 15 salvage/fitting cases. Those are historical evidence, not the current suite count or proof of the new outpost loop. Current accepted tests and browser checks belong in [verification status](verification-status.md).

There is still one active mission/departure, a two-seat craft, fixed destinations and one shuttle. Explicit one-person outbound trips are restricted to an already established wreck; all automatic selections and first visits still use two. Detailed propulsion, general rescue missions, body recovery, dedicated haulers, containers, generated destinations and local vertical construction remain unfinished. Genuine resident stationing and traveler return are accepted; the whole fresh-colony endurance/resupply/care/final-pickup journey remains unfinished. Raw ice uses the same cargo rules; a supplied processor converts it to water through the existing [water supply](water-supply.md) system.
