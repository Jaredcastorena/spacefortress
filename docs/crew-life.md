# Crew lives, downtime and relationships

Implemented locally on September 16, 2026, following the user's explicit colony-simulation priority. This is an initial personal-life model, not complete Dwarf Fortress character depth.

## Needs and work routines

Each crew member owns leisure fulfillment, companionship fulfillment and stress, plus a preferred pastime. Founder temperaments select quiet reflection, pattern games or trading stories. Leisure decreases faster while working or carrying cargo; companionship decreases faster for social crew. Unsafe air, hunger, exhaustion, sustained work and neglected personal needs increase stress. Safe idle time reduces it.

The hidden crew inspector shows needs, preferences, relationships and three routines:

| Routine | Behavior |
| --- | --- |
| Balanced | Requests downtime below 25 leisure/companionship or at 80 stress. At most two balanced crew take voluntary breaks simultaneously. An ongoing urgent job defers the break until stress reaches 95. |
| Focus on work | Defers voluntary downtime. Personal need deficits and stress still affect morale and work speed. |
| Off duty | Stops accepting new orders or ordinary hauling and seeks downtime. Already carried shipments are delivered first. Meals, sleep and suit safety remain active. |

Routines can be changed for living crew at the surface. Off-duty crew are excluded from new expedition selection; taking a selected crew member off duty during preparation prevents departure until the player changes their routine or cancels.

Balanced breaks require reachable breathable shelter. Crew claim distinct places, physically walk there, and release/reselect the place if it becomes unsafe or blocked. They abandon an impossible balanced break so the colony can continue essential deliveries. Explicit off-duty crew wait for a safe place instead. Suit-air emergencies, meals and sleep interrupt downtime.

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

Needs and stress update outside transit. Transit physiology and social life remain abstract. Crew health still uses the previous simple damage/recovery model, a major remaining colony-depth task.

## Persistence and verification

`src/crew-life.js` owns personal needs, routines, leisure movement, pairing, bonds and losses. `src/crew.js` integrates personal strain into morale/work speed. `src/crew-life-panels.js` exposes it inside the existing crew drawer. Rendering remains separate.

Save schema **16** migrates versions 1–15. Version-9 colonies receive balanced routines, full initial social/leisure reserves and neutral relationships; existing skills, memories, jobs and resources are preserved. Current saves retain downtime positions/cooldowns, relationships and grief. Validation checks needs, peer IDs, timestamps, loss records and unique downtime claims.

**252 tests pass**, including 14 personal-life tests: safe interactions and room barriers, friendship/support/conflict, morale/work effects, staggered breaks, physically constructed common tables, cooldowns, emergency interruption, cargo preservation, work/off-duty controls, persistent grief, deterministic saves, migration and malformed-state rejection. The previous atmosphere-production test exposed an all-crew downtime stall; limiting automatic breaks and abandoning unreachable breaks resolved it, and that recovery test now passes unchanged.

Source syntax and documentation links pass. The new common-table rendering and crew-life inspector still need browser verification alongside prior UI changes. The preview remains stopped; the last UI-tool inventory exposed no browser surfaces.
