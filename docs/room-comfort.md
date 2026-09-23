# Room comfort and personal preferences

Implemented September 16, 2026. Comfort connects physically built furnishings, electrical supply, room layout and personal recovery. It is derived from current conditions, not stored as a permanent room bonus.

## Furnishings and resources

| Furnishing | Delivered construction cost | Work | Behavior |
| --- | --- | --- | --- |
| Alloy sculpture | 4 alloy | 10 | A locally drawn orbital knot on a plinth. No power. |
| Holo display | 3 alloy, 1 component | 10 | Projects star patterns using 1 kW of wired power. |

Both require habitat flooring. Builders collect and deliver actual materials through the existing construction system. Unfinished or cancelled orders grant no art. Dismantling removes the benefit and leaves ordinary half-cost salvage. Components can come from existing staffed fabrication or salvage. These are fixed furnishings, not portable crafted possessions.

Holo displays use normal circuit priorities, consumption, equipment heat, maintenance and repairs. An isolated circuit or outage removes their art contribution. Condition scales the contribution of both furnishings. Multiple copies of one type contribute only the condition of the best surviving copy, so filling every floor tile with sculptures is not a stacking strategy. One sculpture plus one powered display can provide two art points.

## Preferences and conditions

Each crew member has a persistent `housing.preference`: **art**, **quiet**, or **company**. Founder preferences cycle deterministically through these three values without consuming simulation randomness. They are visible in the crew inspector. This is an initial preference model, not a species or personality simulation.

- Art contributes one point per distinct furnishing type, scaled by condition. Art-preferring crew receive twice this contribution.
- Quiet-preferring crew receive one point for a compartment with exactly one working bunk/cot and at most one living occupant.
- Company-preferring crew receive one point when a working common table exists in the compartment. This does not itself replenish companionship; actual social interactions still do that.
- Powered, enabled refineries, fabricators, nutrient recyclers and atmosphere processors each produce one source of machine hum, even while waiting for an operator or ingredients. Pausing them, losing power or breaking them stops the hum. Up to three sources reduce comfort, twice as strongly for quiet-preferring crew.
- Crowding uses the larger of working beds or current living occupants, with four floor tiles per person/bed as the reference. Penalty is `min(3, max(0, ceil(4 × count / floorArea) − 1))`.
- Exposed waste subtracts two points. Intact sealed sanitary tanks and carried shipments remain sealed according to sanitation rules.
- Final score is clamped to −6 through +6. Unsafe air/temperature and waste-designated rooms cannot grant comfort effects.

Walls and doors separate this abstract compartment-wide hum and art visibility. Splitting or merging compartments immediately changes their contents, floor area and effects. There is no distance falloff, door-open sound propagation, simulated acoustics or line-of-sight art visibility yet.

## Crew behavior

When choosing a new reachable safe downtime place, crew compare personal room comfort plus a two-point benefit for being on/adjacent to a common table in the same compartment; path distance breaks ties. Tables across compartment boundaries no longer provide downtime or social bonuses. Settled breaks keep their location until it becomes invalid; crew do not continuously shuffle as room scores change.

While actually sleeping in a bunk or spending downtime at their destination:

- Positive comfort reduces stress by `score × 0.04` per tick.
- Negative comfort adds stress by `abs(score) × 0.02` per tick, reducing ordinary recovery without preventing balanced breaks from ending.
- Scores of at least +2 create a restorative-room memory; scores at most −2 create a memory about machinery, waste or crowding. Existing 120-tick repetition cooldown and 600-tick expiry apply.

Assignment, travelling toward a destination and standing idle grant no comfort memory. Comfort does not change bunk energy rates, ownership fallback, injury healing or emergency priorities. Personal-bunk and room-purpose effects remain separate. Morale and work rates receive the consequences through existing stress and memory systems.

## Interface and saves

Build options and isometric drawings are local code assets. The hidden tile inspector shows general comfort, art condition, hum, crowding, privacy, common tables and waste. Crew housing details show their preference and their assigned home's personal score. An absent crew member can inspect home conditions without receiving a remote benefit.

Schema **22** migrates version-21 saves by adding deterministic preferences. Ownership, sleep claims, inventories, jobs and needs are unchanged. Current saves reject unsupported preferences. No new dependencies, remote assets or runtime calls were added.

## Verification and remaining scope

**337 tests pass**, including 14 comfort cases covering delivered construction, cancellation, repeated art, preferences, condition, actual power consumption/outage, hum, topology, crowding/privacy, sanitation, unsafe rooms, actual sleep, downtime choice, recovery, dismantling, saves and migration.

Isolated Firefox checked hidden initial drawers, new build choices/drawings, cable isolation and restored art, personal/general comfort, preference persistence and reload. Map and personal-inspector screenshots were visually inspected; no scoped application errors occurred. Temporary QA processes were stopped.

Initial portable possessions and production quality are implemented in [possessions](possessions.md). Individual art subjects/material preferences, ownership of entire rooms, noise through doors, dynamic preference development and staffed remote residences remain unfinished. See [housing](housing.md), [room purposes](room-designations.md), and [crew life](crew-life.md).
