# Handler transport and animal recovery

Implemented September 16, 2026. Tame bristlebacks can be physically escorted between [husbandry posts](husbandry.md), including back into a [pasture](pastures.md) after leaving it.

## Player flow

Select an available post and choose **Send handler for…**, or select a tame animal, expand **Handler transport**, and choose a destination post. Existing transport orders have ordinary priority and cancellation controls. The destination inspector identifies its incoming reservation, and the animal inspector shows collection/escort state and any obstruction.

Only living, fully tame bristlebacks are eligible. This includes handled juveniles; there is no instant taming, cage capture or wild-animal relocation. Both the animal and destination must be reachable by a surface handler. A post assigned to another living animal, reserved for another transport, damaged, or occupied by conflicting work cannot receive a new order.

## Physical work

1. The order reserves the destination without changing the animal's position or existing post assignment. Any old feeding/collection order is cancelled through normal supply-preserving cancellation.
2. An available crew member with Husbandry duty walks to the animal's actual tile. Pending animals can continue moving, so the pickup route is recalculated.
3. Attaching a reusable lead takes **six Husbandry work**, affected by the handler's existing skill and condition. The animal stays with the handler during this work.
4. The handler escorts it up to **one tile every three ticks**. Existing movement impairments can slow this further. The simulation represents an attached pair on the same tile; rendering offsets the animal beside the handler with a visible lead. The animal moves only after the handler successfully moves.
5. At the destination, the order completes, the post assignment changes, and normal care can resume. Delivery does not grant food, trust, health or product.

The lead is abstract standard equipment, with no new consumable or inventory item. Crew spend actual travel and work time. Animals continue aging, losing nutrition and updating health, growth and brood state while attached; they do not graze or wander during escort. Transport blocks new breeding pairings through the existing animal-job check.

Latched pasture gates allow controlled passage for attached animals while continuing to block loose bristlebacks. Fences and sealed pressure doors still block the route. Automatic pressure doors use the handler's normal opening behavior, including gas flow. No gate policy is silently changed.

## Interruptions and ownership

Meals, rest, suit safety, temperature recovery, medical dependency, departure and other existing crew needs still take precedence. Disabling Husbandry or switching the handler off duty releases the lead immediately. Handler death, separation and other unavailability also detach the animal. It remains at its actual position; the order and post reservation remain for another worker. Reattachment requires the six work again.

A blocked route releases the handler and leaves the order pending. A damaged destination pauses it until repaired. Animal death, loss of tameness or dismantling/claim loss of the destination cancels the order. Cancellation and accepted manual post reassignment/release detach without teleporting or deleting animals. Existing post ownership remains until delivery or an explicit separate assignment change. There is no automatic transport retry after player cancellation.

One animal can have one transport order, and each destination accepts one incoming animal. Feeding/collection is suppressed for the animal while transport is pending. Generic tile work cannot replace the reserved post. Cancellation releases the reservation and preserves any supplies returned from earlier care work.

## Stable actions, observations and events

`husbandry.transport({creature,x,y})` is the shared player/agent command. The destination is currently surface-only. Invalid targets, wild animals and conflicting claims return labeled rejections before old work is cancelled. `job.priority` and `job.cancel` apply normally. Definitions expose the work amount, movement interval and tame-only requirement.

The `animalLead` job saves its animal ID, destination coordinates, worker ID, phase (`collect` or `escort`), remaining attachment work and blocked reason. It uses existing job IDs and owns no supplies. Creature observations add `derived.transport={job,phase,worker,destination,blocked}` or null.

Semantic records:

- `animal.transport.ordered`: animal, job and destination tile.
- `animal.transport.attached`: animal, worker, job and collection tile.
- `animal.moved` with reason `handler_escort`: actual from/to tile IDs.
- `animal.transport.interrupted`: animal, worker, job and interruption reason.
- `animal.transport.delivered`: animal, worker, job and destination.
- `animal.transport.cancelled`: animal, job and automatic/manual flag.

Existing job events, post assignment markers, containment transitions and tick deltas still apply. Observations record state and selected transitions; they do not assert a training reward or a complete causal explanation.

## Persistence and verification

Save schema **29** accepts versions 1–28. Migrating version 28 adds no state, resources or orders. New saves validate ownership, exclusive claims, phases, zero material costs, preparation work and attached handler/animal positions. Interrupted and attached transports continue deterministically after reload.

**471 tests pass**, including eighteen transport tests that cover physical collection, movement and gate passage, disabled duty, crew recovery/death, immediate routine changes, animal death, cancellations, assignment/reservation conflicts, blocked paths, damaged/dismantled posts, retained care supplies, validation, migration, reload, recording non-interference and labeled actions/events. They also run alongside the crew-life regression cases. Isolated Firefox checks cover player commands, incoming reservations, disclosure state, off-duty interruption and immediate save, escort art, attached save/reload, gated delivery, cancellation and event labels. The escort screenshot was visually inspected; no scoped runtime errors occurred. Temporary QA processes were stopped.

Automatic escape detection/dispatch, cages, wild capture, animal cargo aboard shuttles, group herding, veterinary rescue and creature-specific movement limits remain unfinished. Current native bristlebacks retain their simplified environmental adaptation.
