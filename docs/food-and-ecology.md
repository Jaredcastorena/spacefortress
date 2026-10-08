# Flora, livestock and cooking

Status: included in v0.1.3/schema 46. Earlier food systems passed focused checks, a fresh-colony gathering/cooking trial and a supplied farming/livestock trial. Physical bodies and two meat meals have accepted focused and migration coverage; the complete ordinary chain remains unverified after a finite-air stop.

## A connected food chain

Hydroponics grows distinct crops. Handlers can feed fungal caps to glazefoots and collect eggs; bristlebacks provide nutrient curd. Fresh livestock bodies can also be carried to a post and butchered into distinct meat. Cooks combine the actual harvested ingredients into meals. Haulers move those ingredients through the same finite inventories as other supplies.

```mermaid
flowchart LR
  W[Water] --> F[Hydroponics]
  H --> P[Plant ground beds]
  W --> P
  P --> H
  N[Fertilizer] --> F
  F --> G[Fungal caps, grain and berries]
  V[Wild caps and berries] --> H[Gathering and hauling]
  H --> A[Glazefoot care]
  H --> K[Galley]
  G --> A
  A --> E[Glaze eggs]
  B[Bristleback care and grazing] --> C[Nutrient curd]
  G --> K[Galley]
  E --> K
  C --> K
  D[Livestock death] --> R[Physical body]
  R --> T[Carry to post and butcher]
  T --> I[Bristleback or glazefoot meat]
  I --> K
  K --> M[Prepared meals]
  M --> S[Sanitation and recycling]
  S --> N
```

This is a gameplay nutrient loop, not a closed biological mass model: animal output and grazing retain the existing abstract husbandry rules. Production, hauling, cooking, waste and stored quantities remain explicit.

## Crops

Each crop produces two food units. Water and fertilizer must be physically delivered; crops need power, breathable air and suitable temperature.

| Crop | Water | Fertilizer | Temperature | Minimum Production skill |
| --- | ---: | ---: | --- | ---: |
| Fungal caps | 1 | 0.25 | 10–35 °C | 0 |
| Siltgrain | 1 | 0.25 | 10–32 °C | 0 |
| Sunberries | 1.5 | 0.25 | 15–30 °C | 3 |

Choose a crop in the hydroponics inspector. Its identity remains attached to harvested portions while they are carried, stored, reserved or processed. Historical generic food remains ordinary rations; it is never silently converted into a named crop.

## Native plants and gathering — local development

Wild plants now have persistent biomass and visible bare, sparse, growing, budding and mature stages. New colonies contain three wild fungal-cap patches and three sunberry patches, beginning at different stages. Plant placement is deterministic and does not alter the simulation's random sequence. Lichen remains the natural grazing food for bristlebacks.

| Native plant | Growth conditions | Natural regrowth | Mature harvest |
| --- | --- | --- | --- |
| Ground lichen | Ground, −40 to 35 °C | 2 biomass per 60 eligible ticks | Grazed by bristlebacks; not crew food |
| Wild fungalcap | Ground, −40 to 20 °C | 1 biomass per 30 eligible ticks | 2 fungal caps after 10 Production work |
| Wild sunberry | Ground, daylight, 0 to 30 °C | 1 biomass per 30 eligible ticks | 2 sunberries after 12 Production work |

Inspect a mature edible patch and choose **Gather**. A Production worker must physically reach it and finish the work. The plant then falls from 100 to 20 biomass, and two typed food units appear on that tile for haulers. Fungal caps can feed glazefoots or enter recipes; berries combine with bristleback curd. Cancelling or interrupting a gathering order grants no food. A completed harvest cannot be repeated until the patch matures again.

Cold or darkness pauses growth where the species requires it. Fire and construction that covers the ground remove affected plants. Fences and gates preserve patches; husbandry posts preserve lichen. Grazing nutrition is proportional to the biomass actually eaten. Native biological growth is currently an abstract environmental source: it does not draw stored colony water or air. [Cultivated ground beds](cultivation.md) use matching raw food for propagation and finite delivered or absorbed water for faster growth. Wild-soil moisture, spreading, orchards and full biomes remain future work.

Schema 42 migrates existing schema-40/41 hex colonies by preserving their exact lichen quantities in plant records. It creates no edible patches or food in those older colonies. Covered legacy lichen survives a no-step reload, then is removed during the first normal ecology update. Focused checks, a fresh-colony gathering/cooking trial and browser review passed; see the verification index for scope and evidence.

## Animals

| Species | Food source | Product | Distinct behavior |
| --- | --- | --- | --- |
| Bristleback | Existing colony food and natural lichen grazing | Nutrient curd; meat from a fresh body | Six-legged native grazer with mineral plates |
| Glazefoot | Delivered raw fungal caps | Glaze eggs; meat from a fresh body | Four-footed grazer with a translucent dorsal fan; depends on gathered or cultivated fungal feed |
| Tibble | Existing food stocks and crop biomass | None | A pest that can raid supplies and damage hydroponics |

Livestock require care and sufficient nutrition before producing. [Veterinary care](veterinary-care.md) adds species temperature limits, persistent fire/thermal injuries, delivered medicine and gradual recovery. Injury or substantial thermal strain pauses product and brood progress without discarding it. Young animals do not yield curd or eggs. Naturally dead juveniles yield one meat when their fresh body is processed; deliberate slaughter requires a tame adult. See [butchery](butchery.md) for physical handling and spoilage. Breeding pairs must be unrelated adults of the same species; both livestock species share pasture space and enclosure limits. Fences, gates and physical handler transport remain part of the chain.

New colonies gain two wild adult glazefoots. Loading an older colony does not create animals or grant food. Broods and edible harvested eggs are separate gameplay states.

## Recipes and progression

Every recipe consumes two raw-food units and produces two prepared-food units. Water, work and actual ingredient identities differ.

| Recipe | Ingredients | Minimum Production skill |
| --- | --- | ---: |
| Basic ration | Any two unprepared food units | 0 |
| Grain flatbread | Two siltgrain | 0 |
| Fungal stew | Two fungal caps | 0 |
| Curd bake | One siltgrain and one curd | 3 |
| Berry curd | One sunberry and one curd | 3 |
| Glaze omelet | One glaze egg and one fungal cap | 3 |
| Colony feast | Half a unit each of grain, caps, curd and eggs | 6 |
| Starlight platter | Half a unit each of grain, berries, curd and eggs | 9 |
| Bristlecap braise | One bristleback meat and one fungal cap | 3 |
| Sunberry glaze roast | One glazefoot meat and one sunberry | 6 |

Farming and cooking currently use the existing **Production** skill. An operator must qualify for the selected recipe. Cooking quality has four levels, reached at skill 0, 3, 6 and 9. More elaborate dishes add a small comfort benefit when actually eaten; ingredients are never multiplied into extra servings.

The galley inspector shows the selected recipe, delivered and missing ingredients, skill requirements and any committed current batch. Changing the next recipe preserves paid work already underway. Prepared food cannot be cooked repeatedly as raw ingredients. Meals retain the oldest ingredient age; cooking does not restore freshness.

## Saves, controls and scope

The current expansion uses schema 46 with explicit migration from schema-40/41/42/43/44/45 hex saves. Historical deaths gain no new body or food. Existing food amounts, ages, prepared meals and committed batches are preserved by migration checks. [Inherited animal traits](animal-traits.md) affect product progress, feed drain and temperature tolerance; they do not change collection yields or recipe ingredients. Square saves retain their protected export behavior. Planting, watering, gathering, breeding, slaughter, body handling and crop/recipe selection use shared player/agent actions. Plants, genomes, ingredients, animal products and meals retain machine-readable labels. The interface stays in existing hidden inspectors.

Further ecology work includes wild-soil moisture, plant spreading, seed genetics, orchards, full biomes and seasonal or orbital growing conditions, more species, diseases, fibre production, and additional preservation methods. Physical habitat decks remain a separate roadmap item.

## Current ordinary livestock trial and interface scope

One continuation from the ordinary tick-66 galley checkpoint stopped at tick 144 after 78 ticks and three commands because home air became unbreathable. Both paid posts finished at tick 85, and two care deliveries raised the target's trust to 80. All seven crew and five animals remained healthy. No slaughter, body, meat or new meal occurred. Habitat/exterior-work air reserves and the remaining ordinary chain are the next acceptance work.

The current local browser check covers fresh save/reopen, actual migrated-save import, ten recipe choices, applying and retaining Bristlecap braise selection and a readable 390-pixel layout. Corpse handling and a cooked meat meal were not covered. See [verification status](verification-status.md) for the 1,264 distinct local passes, migration scope and historical checks below.

## Verified fresh-colony gathering trial

Starting from an ordinary new colony, crew spent six alloy and one component to build a galley. They gathered two wild fungal caps, physically carried them inside and used 0.5 water to cook two quality-two fungal-stew portions. This finished at tick 66 using five shared commands. The original 24 rations were untouched; all seven crew and five animals remained healthy. Initial, partial-work, harvested and cooked checkpoints reopened byte-for-byte exactly.

This proves ordinary gathering and galley construction. It does not yet prove building and sustaining the entire farming/livestock chain from scratch.

## Verified supplied farming and livestock trial

One explicitly supplied habitat completed the sequence at tick 605 using 12 shared commands: two fungal-cap crops yielded four units, three care deliveries tamed a native glazefoot, natural product accumulation yielded two eggs, and the galley combined one cap with one egg and 0.25 water into two quality-two omelet units. A crew member ate 0.125; 1.875 prepared units and one spare egg remained. No ingredients, animal trust, product readiness or experience were granted. The setup provided buildings, wiring, finite charged batteries and ordinary finite supplies; it did not prove construction from a fresh colony.

All seven crew remained healthy, physical ledgers reconciled and ten checkpoints reloaded exactly. Earlier browser checks covered crop selection during live updates, current/next batch preservation, the original eight recipe choices, skill and ingredient explanations, save/reload and a narrow inspector. See [verification status](verification-status.md) for test scope and retained limitations.
