# Inherited livestock traits

Status: implemented and verified within the scopes below in the local development branch. This increment is not published. These are original, abstract alien biology rules.

## Choosing a herd

Bristlebacks and glazefoots now differ as individuals. Expand an animal's trait details to see its temperature tolerance, production pace, feed drain and ancestry. Enable [breeding](breeding.md) for the intended pair; compatible enabled adults still pair through the existing physical pasture rules.

Traits have two tradeoffs:

| Trait | Benefit | Cost |
| --- | --- | --- |
| Cold preference | Both temperature limits move down by up to 5 °C | Gives up the same amount of heat tolerance |
| Heat preference | Both temperature limits move up by up to 5 °C | Gives up the same amount of cold tolerance |
| Faster pace | Product progress increases by up to 20% | Adult and juvenile nutrition drain increases by the same percentage |
| Slower pace | Adult and juvenile nutrition drain decreases by up to 20% | Product progress decreases by the same percentage |

Balanced traits use the species defaults. Bristlebacks normally tolerate −40 to 35 °C; glazefoots −40 to 30 °C. These limits affect actual thermal strain, pauses and the safe conditions needed for veterinary recovery.

Traits change the wait for products and the ongoing nutrition demand. They do not change the two food portions from a collection, its work or nutrition cost, delivered feed amounts, taming, movement, growth time or brood duration. Injury, insufficient nutrition, cold and broken enclosures still interrupt the existing systems. This is not a complete biological mass or energy model.

For example, a bristleback with a 10% faster pace gains 0.275 product progress and loses 0.0165 nutrition per eligible adult tick, compared with the balanced 0.25 and 0.015. Its curd can still enter the existing [recipes](food-and-ecology.md), with actual ingredient, spoilage and cook-skill requirements.

## Inheritance

Each trait has two alleles. At conception the offspring receives one from each parent. The carried brood saves its parent snapshots and selected offspring traits immediately. Birth copies that saved result; reloading or waiting cannot reroll it. A deceased mate's record remains available; death of the carrier still loses the brood.

Alleles are −1, 0 or +1. Their average sets the effect, allowing full, partial or balanced expression. Breeding can bring an existing allele into stronger expression; it does not mutate or invent new ones. Direct parent/child and shared-parent sibling pairings remain blocked. Wider ancestry restrictions are future work.

New founders vary deterministically with the colony seed and their identities. Trait generation and inheritance consume no global simulation randomness. There is no player gene editor.

## Existing colonies and saves

Schema 45 adds balanced traits to earlier hex saves through explicit migrations from schemas 40–44. Existing animals receive −1/+1 pairs: their current rates and temperature ranges stay neutral, while later descendants can express either inherited side. Existing carried broods receive a balanced offspring snapshot. Migration adds no food, medicine, healing, animals or other physical supplies, and retains existing progress and random state.

Current saves must contain complete valid genomes and brood snapshots. Missing, extra, out-of-range or incompatible inheritance fields are rejected. An older save with future trait fields is rejected rather than silently repaired. Square saves retain their protected export behavior.

## Labeled interactions

Players and local agents use the existing shared breeding policies. Creature observations expose the saved genome and actual derived rates/ranges; brood observations expose the frozen inheritance. Definitions expose the numeric trait rules. Brood-started and birth events retain the selected traits; `animal.traits.inherited` labels the actual birth transition. Recordings remain optional, local and outside save ownership and global randomness.

## Verification and limits

Focused domain, integration and inspector checks passed (49, 85 and 12 distinct checks); the first full regression run passed 1,210 with zero failures and one intentional skip. One supplied-parent/pasture trial stopped at a healthy inherited hatchling at tick 301/three commands. Parent snapshots, stored offspring traits, actual production progress, six exact reloads and unchanged physical inventory passed independent review. Browser founder/brood/offspring details, the breeding policy and a 390-pixel layout passed. The adults/enclosure were supplied; ordinary herd construction and long-term balance remain unverified. See [verification status](verification-status.md) for accepted evidence.

Disease, old age, mutation, detailed anatomy, more livestock products, fuller food webs and broader biomes remain future work.
