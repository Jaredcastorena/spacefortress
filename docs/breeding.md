# Herd reproduction and offspring

Implemented locally for bristlebacks and glazefoots. Breeding connects [physical pastures](pastures.md), [husbandry](husbandry.md), nutrition, growth and local simulation records. The new [inherited traits](animal-traits.md) increment is undergoing verification. These are original, abstract alien biology rules.

Persistent injury or substantial temperature strain pauses juvenile growth, conception and brood development without discarding stored progress. Feeding and [veterinary recovery](veterinary-care.md) restore the animal’s ability to continue.

## Player controls

Open an animal or assigned post inspector, expand **Growth and breeding**, and enable breeding for each intended parent. It is off by default, including in migrated colonies. Disabling it prevents new pairings; an existing carried brood continues when conditions permit.

The drawer shows adult/hatchling stage, growth, parent IDs, recovery time, brood progress and the current obstruction. No new permanent HUD panel was added. Hatchlings render smaller, growing toward adult size; carried broods have amber markings under the parent's plates.

## Pairing and development

Either adult can carry a brood. Two different animals must both be:

- Tame, adult, breeding enabled, not carrying a brood or recovering from a pairing.
- At least 70 nutrition and 70 health, with no current handler job.
- In the same enclosed animal-access region, with six accessible tiles per living animal and pending young.
- Of the same species, unrelated as direct parent/child or siblings sharing a parent. Wider ancestry restrictions are not simulated yet.

Eligible pairs approach physically through existing animal routes, up to one tile every three ticks, without receiving a second move after ecology moved them that tick. Pairing requires the same or adjacent tiles. Stable herd order selects pairs; no additional RNG is used.

Pairing consumes 10 nutrition from each parent, gives both a 600-tick recovery timer, and starts one carried brood at zero progress. A brood needs **300 development ticks**. Each requires an enclosed region, at least 50 health and nutrition, and sufficient herd/pasture capacity; development consumes another 0.02 nutrition per tick. Failed conditions preserve progress. Handler feeding, grazing, curd harvesting and broken boundaries can therefore change whether development proceeds.

At full progress, birth waits for an adjacent ground tile in the same region with no structure, living animal, crew member or pending job. Birth consumes 20 more carrier nutrition, creates one hatchling at that tile and resets the carrier's recovery timer to 600. The other parent's existing timer continues. Death of the carrier loses its brood; death of the other parent preserves it and its parentage record.

Population limits count pending young as well as living livestock of both species: at most 24 in the shared herd. The additional limit of 88 total creature records plus pending young leaves room within the existing save limit for the bounded tibble population. Dead animals remain records and count toward that latter bound. Crowding pauses existing broods and prevents new ones; it never deletes animals.

## Young animals

A hatchling starts with 100 health, 40 nutrition, 40 trust, zero product progress, no assigned post and breeding disabled. It retains both parent IDs, its birth tick and the genome frozen at conception. Assign it to another post for actual delivered handling; it does not inherit a parent's post or taming automatically.

Young bristlebacks can graze every nine ticks, consuming up to 2.5 lichen per visit for proportional nutrition. Glazefoots need delivered fungal caps. Juvenile nutrition drain has a balanced baseline of 0.008 per tick, modified by inherited pace. Young gain one growth point per tick with at least 40 health and nutrition and no injury or substantial thermal strain. Poor condition pauses growth. At **600 growth points** they mature and can begin the species' normal curd or egg production after taming and sufficient nutrition. Juveniles cannot accumulate or be harvested for products. Their size scales from 55% to adult size with growth.

This uses the game's nutrition model; it is not a conserved biological mass or energy calculation. Colony inventory changes still come from actual feeding/production jobs.

## State and training labels

`src/breeding.js` owns constants and lifecycle rules. Each livestock animal saves:

```
lifecycle = {
  born: null | tick,
  parents: [] | [carrierId, mateId],
  growth: 0..600,
  enabled: boolean,
  cooldown: 0..600,
  brood: null | {id, mate, started, progress: 0..300, inheritance}
}
```

Founders use `born:null`, empty parents and adult growth without changing their existing ecology age. New animals use `bristleback-N` or `glazefoot-N`; broods use `brood-N`, all from the simulation's ID counter. Broods appear as observation entities with their carrier, mate, start tick, progress and frozen inheritance. Creature observations expose structured `derived.breeding={phase,reason,mate}`; reason codes include disabled, juvenile, low condition, open range, crowding, handler work and blocked birth tile. Definitions expose the numeric breeding and trait rules.

`husbandry.breed({creature,enabled})` uses the shared player/agent dispatcher. Existing care, post, gate and construction controls still apply. New semantic events:

- `animal.breeding.policy`: animal and enabled state.
- `animal.brood.started`: carrier, mate, brood ID, region, nutrition cost per parent and frozen inheritance.
- `animal.born`: offspring ID, brood ID, both parent IDs, carrier, birth tile and inherited traits.
- `animal.traits.inherited`: actual birth with parent IDs, selected genome and profile.
- `animal.brood.lost`: carrier, mate, brood ID and reason.
- `animal.matured`: animal and parent IDs.
- `animal.moved` now also labels courtship movement.
- `pest.born`: tibble offspring, parent and tile; existing tibble ecology otherwise remains unchanged.

Tick deltas retain growth, condition, cooldown, progress and derived obstruction changes. Recording is optional, local and outside saves/RNG. See [simulation interface](simulation-interface.md).

## Persistence and verification

The local branch uses schema **45**, with explicit migration from earlier hex schemas 40–44. Existing lifecycle progress and physical state remain preserved; migration adds balanced genomes and frozen balanced snapshots to pending broods. Current saves validate growth, offspring IDs/counters, parent existence/order, brood identity/age/progress, cooldowns, juvenile product restrictions and complete inheritance. Parent records remain available after death. Square schemas 1–39 remain protected for export and cannot load into the hex colony.

Earlier breeding checks cover disabled defaults, physical pairing, nutrition costs, development duration, birth position, condition/enclosure gates, interruptions and policies, pending capacity, blocked birth, parent death, young grazing/growth/feeding, direct-family restrictions, limits, migration, malformed saves, deterministic continuation and event labels. The original square-build browser work is historical. Current trait-aware tests passed; one supplied-parent/pasture trial produced a healthy inherited hatchling at tick 301/three commands with six exact reloads. Independent evidence review and folded founder/brood/offspring browser checks, including a 390-pixel layout, passed; see [verification status](verification-status.md) for scopes and remaining work.

Genetics, species diets, eggs, curd and basic veterinary injury/recovery are implemented locally. Disease, old age, corpse processing, physical nests and automatic escape recovery remain unfinished. Tame adults and handled juveniles can use [handler transport](animal-transport.md). The complete ordinary livestock-construction chain and broader SPACEFORTRESS goal remain unfinished.
