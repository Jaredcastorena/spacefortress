# Nutrient recycling and supplied crops

Implemented September 16, 2026. Balance values are prototype choices.

## The chain

Meals and spoiled food → physical waste → depot → nutrient recycler → fertilizer → depot → hydroponics → food.

Every shipment uses the existing six-unit crew hauling system. A recycler cannot spend waste on the ground or deliver fertilizer directly into distant crops. Its inputs must reach its buffer; completed fertilizer must be collected and supplied to the farm. Depot filters, space, routes, operator duties and work priorities all matter.

| Machine | Delivered inputs | Output | Operator work | Power |
| --- | --- | --- | --- | --- |
| Nutrient recycler | 1 waste + 0.25 water | 0.25 fertilizer | 25 | 2 kW |
| Hydroponics | 1 water + 0.25 fertilizer | 2 food | 30 | 2 kW |

The recycler costs **6 alloy and 1 component**, needs 10 construction work and must be placed on a habitat floor. It uses existing wiring, maintenance, machine orders and adjacent Production workers. Hydroponics still requires breathable air and 10–35 °C. Both machines retain committed supplies and progress during interruptions. Missing ingredients are named in the inspector.

## Waste and starter balance

Each actually consumed meal portion now retains **1/16 waste** on its eater until a sanitary visit or overflow; see [sanitation](sanitation.md). A ration has eight portions, so eating one food recovers **0.5 waste**. Ordinary meals and bedside portions follow the same rule. Crew finish available bedside portions before opening another ration. Uneaten spoiled food still becomes waste at 1:1; it provides no hunger recovery and is counted separately in `foodSpoiled`.

Two eaten food supply enough waste to recover the fertilizer for one two-food crop. That loop still consumes 1.25 water, electricity, labor and equipment service. These are abstract recipe units, not a biological mass or energy model. Sanitary facilities and compartment exposure are now implemented; detailed digestion, pipes, residual sludge, pathogens and hygiene consumables remain unfinished. [Assisted bedside hygiene](bedside-hygiene.md) now recovers dependent patients' waste through physical helpers. Expedition meals consumed during travel remain abstract and do not generate recoverable waste.

New colonies receive **8 fertilizer** in their depot: enough nutrients for 32 batches, subject to water and other requirements. The initial depot contains 289 of its 320 capacity units. No recycler is granted. This gives time to construct and supply recycling before the starter nutrients run out; it does not establish long-term water self-sufficiency. Finite ice extraction and staffed replenishment are implemented in [water supply](water-supply.md).

## Failures and recovery

- Disconnected recycler power stops nutrient production; farms exhaust delivered fertilizer and wait. Reconnecting resumes the retained batch, then physical deliveries restore farming.
- Depots rejecting fertilizer leave it in machine output. Accepting it again allows collection and crop delivery.
- Full output, unavailable operators, damaged equipment or missing water/waste prevent new output through the existing production checks.
- Dismantling returns buffered ingredients, unfinished raw batches and finished fertilizer to local piles. It does not refund already consumed batches.
- Stock targets count fractional fertilizer and promised outputs. Existing order controls use whole-unit targets; fixed batches allow production in 0.25-unit increments.

## Interface and saves

The recycler has an original locally drawn isometric machine and appears in the hidden build menu. Recipes, buffers, work orders and pauses use the existing machine inspector. Fertilizer uses depot inventories and filters; it adds no top-bar counter.

Recycling was introduced in schema **17**; current schema **20** includes sanitation, assisted hygiene and room designations while preserving the crop migration below. Existing inventory quantities are preserved; migration grants no fertilizer. A growing water-only legacy crop keeps its exact inputs and progress under a validated `legacyCrop` marker. It produces its original two food and clears the marker; subsequent crops require fertilizer. Buffered water remains usable. Formerly unrestricted depots accept the new resource; deliberately restricted filters remain unchanged. Old colonies must build recycling and collect meal/spoilage waste to replenish nutrients.

## Verification

**308 tests pass**, including 12 recycling cases covering construction supply, nutrient starvation, operator presence, recipe quantities, finite orders, fractional stock targets, the complete haul chain, cable interruption/recovery, storage rejection/recovery, normal and bedside meal waste, spoiled feedstock, dismantling, legacy crops, deterministic reload and invalid buffers/batches.

Isolated Firefox verified hidden default drawers, the construction choice, recycler drawing and recipe, stock-order persistence, fertilizer filter persistence and the farm recipe. Screenshots were inspected; no scoped application runtime errors were reported. No packages or external art were downloaded. Temporary QA processes were stopped.
