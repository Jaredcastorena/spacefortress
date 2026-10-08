# Livestock health and veterinary care

Status: implemented locally, verified by focused checks, a supplied patient recovery trial and browser review. This feature is not in the published v0.1.2 game.

## Injuries and species needs

Bristlebacks and glazefoots have persistent injuries from fire and severe temperature exposure. Ordinary hunger still causes weakness that responds to feeding; it does not create a wound. A wounded animal cannot recover its injured health through food alone.

| Species | Comfortable temperature |
| --- | --- |
| Bristleback | −40 to 35 °C |
| Glazefoot | −40 to 30 °C |

Both species tolerate the starting planet's normal day and night. Temperature strain builds outside their range and subsides in suitable conditions. Severe sustained strain causes cold or heat injuries. This is a gameplay physiology model; it does not add animal oxygen consumption or diseases.

Injury or substantial temperature strain pauses product accumulation, collection, juvenile growth and brood development. Stored products and existing brood progress remain intact. Feeding and physical handler transport continue to use their existing rules.

## Request treatment

Assign a tame animal to a working husbandry post and choose **Treat** in its inspector. Each visit needs one physically delivered medicine and 20 Medicine work. The worker and patient must actually reach the post; missing supplies, blocked paths and unsuitable conditions prevent completion.

Treatment covers up to 20 points of untreated injury. It does not instantly restore health. Ordering treatment spends no invisible reserves, and an already-covered injury cannot be treated twice. Medicine is requested manually, so animals do not automatically consume the colony's medical stock.

A hungry patient can have feeding and treatment queued together. Feeding finishes first. These are separate jobs with separate physical supplies and cancellation controls; pausing or cancelling one does not silently erase the other.

## Recovery

Covered injuries heal gradually at the animal's intact assigned post. Recovery requires at least 60 nutrition, a suitable temperature, no fire and no ongoing handler transport. Each recovery step restores health and reduces the same amount of injury and treatment coverage. Bad conditions pause recovery without discarding existing coverage.

While injured or recovering, automatic food care responds below 60 nutrition instead of the ordinary 40 threshold. It still respects the player's feeding policy and the animal's diet. Glazefoots need real fungal caps; bristlebacks use their existing feed rules. Keeping animals healthy therefore competes for actual food, medicine and crew time.

Death, post loss, reassignment and transport cancel pending treatment through the normal rules for located supplies. Already-applied treatment stays with the animal during transport. Dead animals cannot be treated or resurrected.

## Saves and observation labels

Schema 43 adds neutral condition records to older hex colonies. It preserves existing health, nutrition, products, broods, inventories, jobs and random state; it neither diagnoses historical wounds nor grants medicine or healing. Square saves remain protected for export.

Players and local agents use the same `husbandry.treat` action. Injury, temperature-state changes, treatment completion, recovery-state changes and full recovery have named events and stable animal IDs. Continuous health changes remain visible in observations. No model downloads or remote training calls are involved.

Diseases, inherited traits, body-part wounds, veterinary surgery, meat/fibre products and broader ecology remain future work. See [food and ecology](food-and-ecology.md), [husbandry](husbandry.md) and the [verification record](verification-status.md).

## Verified care trial

A declared fixture supplied an intact post and a tame bristleback with 90 health, ten injury, no treatment coverage and 75 nutrition. The normal colony's four medicine stayed in its depot. A medic reserved and carried one medicine, performed 20 Medicine work, and the animal recovered gradually from tick 17 through tick 116. Three medicine and the original 24 food remained; no food, water, alloy or components were spent. All seven crew and five animals ended healthy.

Initial, partial-work, treatment, mid-recovery and recovered states reopened exactly. The worker gained 20 Medicine experience. This proves physical treatment and recovery; it does not prove an ordinary fire rescue, taming or post construction journey. See the [verification record](verification-status.md) for the complete scope.
