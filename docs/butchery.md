# Livestock bodies, butchery and meat meals

Status: implemented in v0.1.3/schema 46, with focused mechanics and migration checks accepted. The complete ordinary body-to-meal journey remains unverified after an air-reserve stop. See [verification status](verification-status.md) and [release readiness](release-readiness.md) for local and hosted scopes.

## From animal to physical body

A bristleback or glazefoot death leaves one body at its actual location. The animal's identity, genes and ancestry remain recorded after processing or disposal. Its body is separate: it can be on a tile, carried by one handler or staged at one husbandry post. It cannot belong to two places at once.

Death records retain the cause and the adult or juvenile stage at death. The stage fixes the available yield:

| Animal at death | Raw output from a fresh body |
| --- | ---: |
| Adult bristleback | 4 Bristleback meat |
| Adult glazefoot | 3 Glazefoot meat |
| Juvenile of either species | 1 of its species' meat |

Traits and skill do not multiply yield. These are abstract biological yields, not a closed biological mass model. Body age follows the existing food lifetime and local temperature decay while waiting, being carried and being processed. Butchery transfers that age into the meat; cooking retains the oldest ingredient age. Neither operation restores freshness.

## Slaughter for meat

Inspect a tame adult and choose **Slaughter for meat**. The animal must have an intact assigned surface husbandry post, with breeding disabled and no carried brood, transport or conflicting work. The post must be free of fire. Injured adults can qualify; juveniles cannot be deliberately slaughtered.

The order requires a handler and the animal to meet physically at the post, followed by **8 Husbandry work**. It consumes no stored ingredient. Cancel before completion to leave the animal alive. This is one explicit order and does not repeat automatically. Death stops incompatible live-animal work through the normal supply-refund rules. If an animal carrying a brood dies naturally, that brood is lost; another parent's retained identity and frozen conception record remain available.

## Collect, carry and process

Order a fresh body to be butchered at an intact, available surface husbandry post. The handler reaches the body, carries the whole body to the post and stages it there. Body carrying cannot overlap ordinary cargo, animal leading or patient rescue. Shared paths and airlock waits apply.

Processing takes **20 Husbandry work** at the post. Collection and carrying create no food and earn no processing experience. Completion creates the exact meat yield above plus **0.25 waste on the post tile**. The body is then exhausted and cannot be processed again.

Cancellation, blocked travel, worker interruption, death or post loss preserve one physical body at its actual source, carrier or post position as applicable. Existing age is retained; interrupted staged work keeps its progress. A waiting airlock does not duplicate or teleport the body. Reserved bodies and busy posts cannot accept overlapping work.

A spoiled body yields no edible meat. An unreserved spoiled body on a tile can be discarded using **4 Husbandry work**, producing **0.25 located waste**. It remains physical until disposal.

## Two plant-and-meat recipes

Both recipes require physically delivered ingredients, a powered galley, safe air and 5–35 °C. Each converts two raw-food units into two prepared-food units.

| Recipe | Raw ingredients | Water | Production work | Minimum Production skill | Comfort per eaten 0.125 unit |
| --- | --- | ---: | ---: | ---: | ---: |
| Bristlecap braise | 1 Bristleback meat + 1 fungal cap | 0.5 | 40 | 3 | 0.06 |
| Sunberry glaze roast | 1 Glazefoot meat + 1 sunberry | 0.25 | 44 | 6 | 0.08 |

Meal quality uses the shared four tiers at Production levels 0, 3, 6 and 9. Skill changes quality, not serving count. Recipe changes retain already-paid batches. Raw meat uses the existing raw-food eating rules; prepared meals cannot be cooked again as raw ingredients. See [food and ecology](food-and-ecology.md) for all ten recipes.

## Saves and shared interactions

Schema 46 adds death and body ownership through explicit migrations from hex schemas 40–45. Living animals retain their state; animals already dead in older saves become exhausted legacy records with no new body or food. Existing food, ages, paid batches, traits, ancestry and pending broods are preserved. Square schemas 1–39 remain incompatible with hex colonies, with original bytes protected for export.

Player and local-agent commands share the slaughter, butcher and discard actions. Named events record death, body handling and processing. Ingredient kind and source events identify the meat; merged same-kind food lots do not retain a separate per-animal identity. Body sprites represent their current physical location, independently of retained ancestry records.

## Verification and the ordinary-play limit

Focused food/body/interface/integration coverage is 8/49/9/77. Local combined regression evidence is 1,264 distinct passes and one intentional historical skip: 1,263 first-full-run passes plus the exact repaired stale recipe-option check, without a full rerun. Actual schema-45 migration preserves prior state; six current saves reopen exactly.

The first ordinary continuation ran from tick 66 to 144: 78 ticks and three commands. Two paid posts finished at tick 85, and two care deliveries raised the target's trust to 80. Home air then became unbreathable and the attempt stopped. All seven crew and five animals remained at 100 health with no injury; accounting and three reloads matched. No slaughter, body, meat or new meal occurred. This measures a finite-air limit, not a completed butchery chain.

Local browser review covers fresh save/reopen, importing that migrated starting save, ten recipe options, applying and retaining Bristlecap braise selection, and a readable 390-pixel layout. It does not cover corpse handling/rendering or a cooked meat meal.

This is a small livestock food chain. Fat, bone, hide, fibre, detailed anatomy, disease, old age, hunting and wider food webs remain future work. Current ordinary acceptance and long-term balance are not established by implementation alone.
