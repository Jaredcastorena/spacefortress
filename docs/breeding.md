# Herd reproduction and offspring

Implemented September 16, 2026. Bristleback breeding connects [physical pastures](pastures.md), [husbandry](husbandry.md), nutrition, growth and local simulation records. These are original, abstract alien biology rules.

## Player controls

Open an animal or assigned post inspector, expand **Growth and breeding**, and enable breeding for each intended parent. It is off by default, including in migrated colonies. Disabling it prevents new pairings; an existing carried brood continues when conditions permit.

The drawer shows adult/hatchling stage, growth, parent IDs, recovery time, brood progress and the current obstruction. No new permanent HUD panel was added. Hatchlings render smaller, growing toward adult size; carried broods have amber markings under the parent's plates.

## Pairing and development

Either adult can carry a brood. Two different animals must both be:

- Tame, adult, breeding enabled, not carrying a brood or recovering from a pairing.
- At least 70 nutrition and 70 health, with no current handler job.
- In the same enclosed animal-access region, with six accessible tiles per living animal and pending young.
- Unrelated as direct parent/child or siblings sharing a parent. Wider ancestry and genetics are not simulated yet.

Eligible pairs approach physically through existing animal routes, up to one tile every three ticks, without receiving a second move after ecology moved them that tick. Pairing requires the same or adjacent tiles. Stable herd order selects pairs; no additional RNG is used.

Pairing consumes 10 nutrition from each parent, gives both a 600-tick recovery timer, and starts one carried brood at zero progress. A brood needs **300 development ticks**. Each requires an enclosed region, at least 50 health and nutrition, and sufficient herd/pasture capacity; development consumes another 0.02 nutrition per tick. Failed conditions preserve progress. Handler feeding, grazing, curd harvesting and broken boundaries can therefore change whether development proceeds.

At full progress, birth waits for an adjacent ground tile in the same region with no structure, living animal, crew member or pending job. Birth consumes 20 more carrier nutrition, creates one hatchling at that tile and resets the carrier's recovery timer to 600. The other parent's existing timer continues. Death of the carrier loses its brood; death of the other parent preserves it and its parentage record.

Population limits count pending young as well as living bristlebacks: at most 24 in the herd. The additional limit of 88 total creature records plus pending young leaves room within the existing save limit for the bounded tibble population. Dead animals remain records and count toward that latter bound. Crowding pauses existing broods and prevents new ones; it never deletes animals.

## Young animals

A hatchling starts with 100 health, 40 nutrition, 40 trust, zero curd progress, no assigned post and breeding disabled. It retains both parent IDs and its birth tick. Assign it to another post for actual delivered handling; it does not inherit a parent's post or taming automatically.

Young graze every nine ticks, consume up to 2.5 lichen per visit, gain the existing four nutrition, and lose 0.008 nutrition per tick. They gain one growth point per tick with at least 40 health and nutrition. Poor condition pauses growth. At **600 growth points** they mature, switch to adult nutrition loss/grazing, and can begin normal curd production. Juveniles cannot accumulate or be harvested for curd. Their size scales from 55% to adult size with growth.

This uses the game's nutrition model; it is not a conserved biological mass or energy calculation. Colony inventory changes still come from actual feeding/production jobs.

## State and training labels

`src/breeding.js` owns constants and lifecycle rules. Each bristleback saves:

```
lifecycle = {
  born: null | tick,
  parents: [] | [carrierId, mateId],
  growth: 0..600,
  enabled: boolean,
  cooldown: 0..600,
  brood: null | {id, mate, started, progress: 0..300}
}
```

Founders use `born:null`, empty parents and adult growth without changing their existing ecology age. New animals use `bristleback-N`; broods use `brood-N`, both from the simulation's ID counter. Broods also appear as observation entities with their carrier, mate, start tick and progress. Creature observations expose structured `derived.breeding={phase,reason,mate}`; reason codes include disabled, juvenile, low condition, open range, crowding, handler work and blocked birth tile. Definitions expose the numeric breeding rules.

`husbandry.breed({creature,enabled})` uses the shared player/agent dispatcher. Existing care, post, gate and construction controls still apply. New semantic events:

- `animal.breeding.policy`: animal and enabled state.
- `animal.brood.started`: carrier, mate, brood ID, region and nutrition cost per parent.
- `animal.born`: offspring ID, brood ID, both parent IDs, carrier and birth tile.
- `animal.brood.lost`: carrier, mate, brood ID and reason.
- `animal.matured`: animal and parent IDs.
- `animal.moved` now also labels courtship movement.
- `pest.born`: tibble offspring, parent and tile; existing tibble ecology otherwise remains unchanged.

Tick deltas retain growth, condition, cooldown, progress and derived obstruction changes. Recording is optional, local and outside saves/RNG. See [simulation interface](simulation-interface.md).

## Persistence and verification

Save schema **28** accepts versions 1–27. Version 27 gains adult founder lifecycle records with breeding off, preserving positions, ages, health, nutrition, trust, supplies, jobs and RNG. Current saves validate growth, offspring IDs/counters, parent existence/order, brood identity/age/progress, cooldowns and juvenile product restrictions. Parent records remain available after death.

**453 tests pass**, including nineteen focused tests that cover disabled defaults, physical pairing, nutrition costs, development duration, birth position, condition/enclosure gates, interruptions and policies, pending capacity, blocked birth, parent death, young grazing/growth/feeding, direct-family restrictions, limits, migration, malformed saves, deterministic continuation and event labels. Isolated Firefox browser checks verify player policies, disclosure state across refresh, brood artwork/readings, saved partial broods, birth after reload, hatchling size, parentage, labels and events. Brood and hatchling screenshots were visually inspected; no scoped runtime errors occurred. Temporary QA processes were stopped.

Genetics, eggs/nest inventories, specialized diets, veterinary injury/disease, old age, corpse processing, automatic escape recovery remain unfinished. Tame adults and handled juveniles can now use [handler transport](animal-transport.md). The wider SPACEFORTRESS goal remains active.
