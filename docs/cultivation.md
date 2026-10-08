# Ground beds and finite watering

Status: implemented and verified within the scopes below in the local hex build. This increment has not been published.

## Planting

Inspect suitable ground and open **Cultivate · ground beds**. Choose fungal caps or sunberries. A Production worker must fetch one matching raw food portion, reach the bed and complete 10 work. Ordinary rations and cooked meals cannot propagate these plants. An existing edible patch occupies the ground; lichen can coexist with the new bed.

Planting creates 20 biomass and no moisture. Dormant weather permits planting, but pauses later growth. Orders reserve real supplies. Cancelling returns the supplies at their actual locations and creates no plant.

## Watering and growth

Choose **Water · 0.5 water** in the bed inspector. A worker delivers that amount and completes six Production work. The bed can hold 1.5 water. Any paid water that no longer fits after delivery appears as loose water for hauling.

| Bed | Conditions | Water for 20 → 100 biomass | Mature harvest |
| --- | --- | ---: | --- |
| Fungal caps | Ground, −40 to 20 °C | 1 | Two raw fungal-cap portions; 10 work |
| Sunberries | Ground, daylight, 0 to 30 °C | 1.5 | Two raw sunberry portions; 12 work |

During suitable conditions, cultivated beds gain up to three biomass at each 30-tick growth update. They consume water in proportion to actual growth. Dryness, cold and darkness pause growth without discarding progress. This increment has no evaporation or automatic watering.

Ground beds away from map edges can also absorb some real floor water during drainage; they do not require an indoor enclosure. The water moves into the bed and cannot simultaneously be lost or pumped elsewhere. Pumps recover water remaining on the floor.

## Harvesting and removal

At 100 biomass, choose **Gather**. A worker harvests two food portions, leaving 20 living biomass. The food waits on that tile for hauling, cooking or livestock care. Regrowth requires more water. Growing food remains an abstraction of environmental nutrients and carbon; this is not a complete biological mass model.

Fire or construction covering the ground removes the plant. Its remaining moisture becomes loose water; removal produces no food. Fences and pasture gates preserve beds.

## Connected food choices

Fungal caps can feed glazefoots, whose eggs become cooking ingredients. Sunberries combine with bristleback curd. See [food and ecology](food-and-ecology.md) for the crop, livestock and recipe progression.

Wild plants retain their slower ambient regrowth and consume no stored colony water. Hydroponics remains a separate powered production chain using delivered water and fertilizer.

## Saves and labeled interactions

Schema 44 adds native plant metadata and empty cultivation ledgers to earlier hex saves. Existing quantities, health, biomass, floor water and random state are preserved; older worlds receive no new edible patches or resources.

Players and local agents use the same planting, watering and gathering actions. Observations identify each plant and its generation, moisture and growth conditions. Named events record actual planting, water delivery, absorption, growth consumption, harvest and removal. An order targeting a replaced bed cannot complete against the replacement.

## Verified scope

A fresh colony completed one ordinary planting-to-harvest cycle at tick 853 using six commands and no supplied resources or state changes. One gathered raw fungal-cap portion and one water produced two cultivated portions, leaving the living bed for regrowth. All seven crew and five animals stayed healthy; workers earned 42 Production experience. Twenty-four checkpoints reopened byte-exactly. Browser checks covered planting/cancellation, watering/cancellation, growing and mature beds, harvest availability and a 390-pixel layout.

Combined regression evidence covers 1,177 distinct passes and one intentional skip: the full run passed 1,175 checks, then two stale schema assertions were corrected and their two affected checks passed. See [verification status](verification-status.md) for evidence and limits.

This establishes one fungal-cap cycle with starter supplies. Sunberry cultivation has focused coverage; a complete fresh-colony livestock/cooking chain and long-term food/water balance remain unverified. Spreading, orchards, soil chemistry, diseases and broad ecosystem balance remain future work.
