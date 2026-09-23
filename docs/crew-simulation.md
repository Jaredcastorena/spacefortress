# Crew behavior and work assignment

Implemented September 16, 2026. This is one part of the colony simulation, not full character simulation.

## Persistent recovery

Crew keep an intention while getting a meal, replenishing suit air, reserving a bunk, or collecting material. Work cannot repeatedly interrupt those activities. Critical oxygen takes precedence over other recovery. Severe hunger can interrupt sleep.

- Exhaustion starts below 25 energy. A reserved, reachable, pressurized bunk allows sustained sleep until 85 energy.
- [Personal bunk ownership](housing.md) reserves a bunk for its owner, including while away. Crew prefer home and use communal bunks or floor rest when it is unavailable.
- Each bunk has at most one resting claimant. If none is available, safe floor rest is slower, causes unhappy memories, and ends around 50 energy. The colony can still build missing bunks instead of becoming permanently stuck.
- Hungry crew must reach a depot or loose ration pile, or have a ration in their carried cargo. One whole ration is removed when the meal starts; eating takes eight ticks. Fractional trap bait cannot be taken as a whole meal.
- Suit recovery continues to 90% air, drawing actual oxygen from a reachable breathable compartment. Unsafe pressure or composition prevents refill; see [atmosphere](atmosphere.md). Cautious crew seek shelter at 35%; others at 25%. Unreachable shelter is stated in their activity.
- Death, mission departure/recall, disabled duties, and work interruptions release the corresponding reservations. Carried material stays with its carrier until delivery; death leaves it as a local pile.

## Skills and scheduling

Crew have separate extraction, construction, engineering, hauling, medicine and production levels. Founder profiles start with different strengths and a preferred labor. Actual work accumulates experience and can raise the relevant skill. Health, fatigue, and morale affect work speed.

Queued jobs are assigned by priority first, then relevant ability, work preference, and travel distance. Ties are deterministic. Existing work keeps its worker; changing a queue priority does not discard progress or force constant reassignment.

Each crew inspector has six duty toggles. Disabling a duty releases matching unfinished work for someone else. Crew already holding cargo still deliver it even if hauling is disabled. Pickup reservations prevent several idle haulers from chasing the same stack.

Tile inspectors provide low, normal, and urgent job priority. Jobs explain whether they lack assigned crew, available workers, or a reachable work position.

## Memories and morale

Completed work, food, sleep, lack of beds, lack of meals, suit-air scares, create brief memories. Nearby conversations now create memories tied to particular people. Repeated events have a cooldown. Memories fade over 600 ticks and affect morale; social crew gain more from companionship. The four most recent memories appear in the existing crew drawer.

Personal needs, stress, physically located downtime, friendships, support, arguments and persistent grief now extend this model; see [crew life](crew-life.md). Initial supplied medicine, rescue and nursing are implemented. Culture, personal history, anatomy and richer personality development remain unfinished.

## Persistence and verification

Save schema is version 22. Version-21 migration adds room comfort preferences. Version-20 migration adds communal housing without changing existing rest claims. Version-one saves receive founder skill profiles, enabled duties, normal job priority, and empty intentions/memories. Version-two crew data is preserved while inventories migrate to located storage; see [production and logistics](production-and-logistics.md). Existing browser storage uses the same key so users can load their earlier colonies.

The 337-test suite includes sustained sleep, competing bunk claims, fallback floor rest, oxygen recovery, meal reservation across reload, fractional-food handling, specialist selection/training, labor permissions, queue priority, interrupted work, hauling conservation, deterministic save continuation, legacy migration, malformed crew state, and expedition eligibility. The previously established simulation tests also pass.

The additional inspector controls have passed JavaScript syntax checks, but have not been visually or interactively checked in a browser in this pass. The preview remains stopped.
