# Crew lives, downtime and relationships

**v0.1.2 development preview — save schema 38.** Crew needs, routines, relationships and site-local work/recovery/care are implemented. Genuine resident controls and routines have bounded browser acceptance; local-care mechanics have focused tests. The complete fresh-colony endurance/resupply/care/pickup journey remains unfinished. This is an initial personal-life model, not complete Dwarf Fortress character depth. See [verification status](verification-status.md).

## Needs and work routines

Each crew member owns leisure fulfillment, companionship fulfillment and stress, plus a preferred pastime. Founder temperaments select quiet reflection, pattern games or trading stories. Leisure decreases faster while working or carrying cargo; companionship decreases faster for social crew. Unsafe air, hunger, exhaustion, sustained work and neglected personal needs increase stress. Safe idle time reduces it.

The hidden crew inspector shows needs, preferences, relationships and three routines:

| Routine | Behavior |
| --- | --- |
| Balanced | Requests downtime below 25 leisure/companionship or at 80 stress. At most two balanced crew at the same site take voluntary breaks simultaneously. An ongoing urgent job defers the break until stress reaches 95. |
| Focus on work | Defers voluntary downtime. Personal need deficits and stress still affect morale and work speed. |
| Off duty | Stops accepting new orders or ordinary hauling and seeks downtime. Already carried shipments are delivered first. Meals, sleep and suit safety remain active. |

Routines can be changed for living surface crew and living wreck residents physically on site. Visitors and crew in transit are not remote residents. Off-duty crew are excluded from new expedition selection; taking a selected crew member off duty during preparation prevents departure until the player changes their routine or cancels.

Balanced breaks require reachable breathable shelter; the chosen downtime place must also have safe temperature. Site-local claims let equal coordinates on different maps remain independent. Crew claim distinct places, physically walk there, and release/reselect the place if it becomes unsafe or blocked. They abandon an impossible balanced break so the colony can continue essential deliveries. Explicit off-duty crew wait for a safe place instead. Suit-air emergencies, meals and sleep interrupt downtime.

A balanced break lasts at least 30 ticks and ends after leisure reaches 75 and stress falls to 30. A 120-tick cooldown prevents repeated attempts to cure loneliness through solitary breaks. Off-duty time continues until the player changes the routine. These are initial balance values.

## Common tables and room design

A **Common table** costs four alloy and seven base work units and must be built on habitat flooring through normal construction deliveries. Its tile and four adjacent tiles provide furnished downtime places when breathable and reachable. Each place has one leisure claimant. Larger common rooms can accommodate multiple tables; walls, paths and atmosphere affect their usefulness.

Furnished downtime restores 0.7 leisure per tick and reduces stress by 0.4, before ordinary need updates. Unfurnished quiet reflection restores 0.45 leisure; other solitary pastimes restore 0.2. Unfurnished downtime reduces stress by 0.2. Quiet-minded crew therefore cope better without a common table. Common-table art is drawn locally in the existing isometric renderer.

## Real interactions

Every 30 ticks, eligible nearby crew can pair for conversation. They must be within two orthogonal-distance tiles, in the same breathable room, alive, unburdened and not working. Idle crew, crew eating and crew who have arrived at their downtime place can participate; sleeping crew and people still walking cannot. Each person has at most one conversation in that tick. Pair selection favors people not met recently, then existing affinity, with deterministic ties.

Ordinary conversation increases directed affinity and companionship. A common table increases affinity gains. At affinity 20, the inspector labels the relationship a friendship; a friend can provide stronger stress relief when someone is troubled. Two highly stressed people with different temperaments may argue, losing affinity and gaining negative memories. Affinity, encounter counts and last encounter time persist separately from short-lived memories.

This is a deliberately simple starting model. Pastimes are not separate minigames, and friendships do not yet change job cooperation, possessions or living arrangements. Rivalries, reconciliation actions, families, culture and detailed personal histories remain incomplete.

## Loss, mood and consequences

Survivors learn of a crew death through the colony's abstract communications. Each loss is recorded once. Stronger positive affinity creates stronger grief, which fades over 2,400 ticks; the remembered loss remains recorded after its mood effect expires. Grief is separate from the bounded recent-memory list, so ordinary work memories cannot erase it immediately. Transit crews receive the news after arrival.

Morale includes recent memories, personal need deficits, stress and fading grief. Existing work-rate calculations use morale, linking crew life to production and repairs. This does not yet model psychiatric illness, violent breakdowns or anatomy. Initial [injury and medical care](medicine.md) now supplies treatment and cot recovery.

Needs and stress update outside transit, regardless of the viewed map. Transit physiology and social life remain abstract. Injuries, mobility limits, cot treatment, assisted feeding and hygiene use their existing bounded models; detailed anatomy and broader character simulation remain unfinished.

## Life at the wreck

The new local-life increment uses each person's physical site for ordinary meals, safe rest, hauling, recovery and care. The resident roster gives a crew member a continuing place at Relay K-07 after the shuttle leaves; it supplies no food, gas, warmth or healing. Local utility and need updates continue while another map is visible. The [outpost guide](staffed-orbital-outpost-design.md) separates accepted bounded resident controls from the unfinished sustained fresh-colony journey.

| Need | Physical requirement |
| --- | --- |
| Food | Walk to a real local ration in depot stock, unloaded dock imports or a loose pile; an already paid meal keeps its remaining portions. Food still aboard or at the surface is unavailable. |
| Sleep | A reachable intact bunk in safe air and temperature, with a distinct local sleep claim. Remote bunks are communal. |
| Air or temperature recovery | Reach an actual breathable or temperate compartment. A dock marker is not shelter. Suit refill withdraws real room gas. |
| Work and machine inputs | Relevant labor enabled, a reachable local job and its delivered materials. Haulers can move imports to depots or directly into eligible machine inputs. |
| Medical recovery | A safe local cot, finite medicine delivered by a suitable same-site worker, and the existing food/air conditions for recovery. |
| Dependent care | An available same-site helper physically brings food, performs supplied hygiene or carries an immobile patient to reachable shelter/care. |

A surface home reservation remains the person's surface home. Sleeping in a communal remote bunk does not reinterpret its coordinates or create a displaced-home penalty merely because the person is away. Personal remote home ownership is not added by this increment. A lone resident can recover from ordinary hunger and fatigue but cannot supply a second person's hands when an injury requires a caregiver.

### When a carrier cannot recover

A parcel must not remain trapped in the hands of a crew member whose own recovery is blocked. After an unsuccessful attempt to find or reach breathable air, safe temperature, food or rest, the carrier sets it down at their **current tile**. Reachable recovery retains the parcel normally; this is not an instruction to drop every delivery when a need becomes low.

Ordinary cargo becomes a local loose pile. Material still promised to an existing same-site job becomes another exclusive source for that job at the set-down coordinates. It is not also a free pile, does not become completed work or ship cargo, and cannot be eaten merely because a hungry worker was carrying reserved food. Food age, prepared-meal metadata and item identities remain with the parcel. The carrier's carry/delivery reference is cleared, while the recovery intention remains active. Job cancellation can later release its reservation through the usual rules.

Another available worker still has to walk over, collect and deliver the goods. Existing mission/boarding priorities remain in force. The handoff does not move the stranded person, refill a suit, restore energy, cancel the job or guarantee rescue; an exhausted colony may have no capable collector. Local recording names the actual owner transfer as `crew.recovery.cargo_set_down`, with individual `item.moved` records when applicable. Bounded [recovery tests](../tests/crew-recovery-cargo.test.js) and physical conservation checks are separate from the still-pending ordinary outpost journey.

### Pickup and local rescue

A resident's routine and the shuttle's return roster are separate. Recall releases assigned travelers' work while leaving residents' local jobs active. A resident selected for pickup retains residence until actual return departure. Living remote residence cannot be cleared merely because a return seat was selected.

Dependent rescue targets the shuttle dock only when that person is an assigned return passenger and a usable shuttle is physically present and boarding. Otherwise the helper seeks a real local cot or safe shelter. Carrying is physical; the patient does not teleport to the surface. A blocked route, absent helper, exhausted provisions or an absent shuttle can prevent recovery. Initial outbound travel still needs two people. Once the wreck is established, an explicitly selected one-person service flight leaves a seat to collect its last resident; a two-person visit needs a replacement to stay behind instead. General autonomous evacuation and body recovery remain unfinished.

Use the hidden crew inspector for needs, duties and routines. **Regions → Relay K-07 → Residents & habitat** shows measured habitat blockers; its return-seat control opens **Return team** for pickup. A compact warning while viewing the surface opens the affected site. Current readiness is not a promise that finite supplies will last until the next flight.

## Persistence and verification

[crew-life.js](../src/crew-life.js) owns personal needs, routines, leisure movement, pairing, bonds and losses; [crew.js](../src/crew.js) integrates personal strain into morale/work speed. Medical, nursing, hygiene and sanitation modules use the same local crew and job system. Rendering stays separate.

Schema 16 originally introduced personal-life state and migration from older colonies. Current saves retain routines, downtime positions/cooldowns, relationships, grief, medical state and site-qualified claims alongside the current schema's other fields. Wreck residence and the separate return roster were introduced in schema 37; the v0.1.2/schema 38 preview uses that ownership rather than a duplicate home-site field. New migrations do not replenish needs, food or habitat supplies.

The original personal-life checkpoint passed 14 focused cases within a historical 252-test suite, including interactions, work effects, breaks, common-table construction, interrupted recovery, cargo preservation, grief and deterministic saves. Those counts are not current integration evidence. Accepted resident-care boundary cases and genuine stationing/return controls are reported separately from the unfinished full fresh-colony journey in [verification status](verification-status.md). Synthetic warm rooms or granted supplies do not prove a player can build and sustain a habitat.
