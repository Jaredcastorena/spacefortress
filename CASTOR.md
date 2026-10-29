# CASTOR — SPACEFORTRESS agent briefing

**Start here; read only what your task needs.** CASTOR maps source and limits; the game is incomplete. [File map](docs/FILE_MAP.md) · [Version ledger](docs/AGENT_VERSIONS.md) · [Roadmap](ROADMAP.md)

## Where you are

- Package **0.1.12**, colony save schema **68** (v0.1.11 uses66), grid **hex-odd-q-v1**. The separate elements laboratory has its own schema **3** and square cell model.
- Structural review baseline **e330c6f**, October 15, 2026. Later local changes include meal freshness, imported production stock, trap health/capture-cost fixes, shared crew and workstation work-readiness diagnostics, finite local suit resupply, manual suit-to-room oxygen transfer and finite airlock refill prediction at the actual vent target, passive reuse of recovered extractor gas during refill, sealed correction of release pressure drift, and finite delivered supply-tank replenishment. The version ledger identifies the current runtime fingerprint and focused checks; package version alone does not identify every change.
- This is an original isometric space colony simulator: planetary construction, crew needs, physical resources and supplied orbital expeditions. Paid stairs and multi-floor saves now connect declared floors in local code. The browser now selects installed floors and routes inspection/build controls to them; new games group eight sites under three seeded planets, with finite frontier landings/derelicts and independent residents. Existing four-/six-site colonies keep their worlds. Larger discovery/history and direct remote travel remain future work.

Read the [version ledger](docs/AGENT_VERSIONS.md), then the relevant system and focused tests below. Consult only the matching [file-map section](docs/FILE_MAP.md). Resolve conflicts with older prose from current source.

## System entry points

| Task | Start here | Preserve |
| --- | --- | --- |
| Local deck foundation | [spatial addressing](src/spatial.js), [hex math](src/hex.js), [stairwell core](src/vertical.js), [level design](docs/vertical-slice-design.md) | Explicit z; six horizontal neighbors; declared deck order. [Horizontal and airlock plans](src/navigation.js) use full positions; legacy pair callers retain the ground default. Explicit crew walking, basic supplied construction, staffed production, hauling, medical care/rescue and basic meal/rest/suit recovery now work within an existing declared floor; declared stair links now support crew/cargo/patient travel and finite hatch gas/heat/water flow. Paid stair construction and schema55 admission now work; floor selection and upstairs controls now work; shared stair damage, repair/removal and reservation persistence now work; animal traversal and upstairs pasture work now operate through the same stairs, jobs and saves; upper-floor airlock construction, cycles, travel and persistence now work; paid planter beds and upstairs planting/watering/gathering use schema62 and actual-floor custody; schema63 adds finite impact ore and full-position mining through [extraction](src/extraction.js); [solar exposure](src/solar.js) now blocks panels beneath overhead terrain and intact structures. Paid power/gas/water risers now connect actual endpoint networks through [utility links](src/utility-links.js), with independent isolation and finite fluid flow. Schema47 stores explicit deck zero on primary entities; schema48 extends named shipment sources and targets; schema49 extends crew needs, medical beds, bunks and personal pickup claims; schema50 extends animal posts and tile carcass owners; schema51 extends airlock equipment, chamber cells and traveler destinations; schema52 gives rooms deck ownership and separates horizontal gas/heat topology. Electrical graphs, breaker ports and cable commissioning also distinguish decks while retaining ground IDs. Gas/water ports, leaks, dismantling recovery and horizontal floor spills preserve their deck. Schema53 adds hazard positions; fire, cooling and impacts retain their deck; schema61 enables upper suppression and automatic maintenance with physical water/alloy delivery. Open/damaged stair hatches now carry flame spread between nearby fittings; intact closed hatches contain it. Schema54 gives room-purpose anchors explicit decks. Room membership, waste exposure, comfort, shelter goals and outpost readings use actual room positions. Pastures, births, grazing, pest feeding and trap payments distinguish decks; livestock can now use connected stairs. [Migration](src/deck-state.js) preserves nested references; [remaining consumers](docs/spatial-location-inventory.md) still require conversion for the remaining upper work families. |
| Player/agent commands | [controls](src/controls.js), [interface](docs/simulation-interface.md) | Shared validation; discover arguments from the action catalog. Sixteen gas/water/power/reactor/climate controls accept optional z, defaulting to zero. Eleven production/storage/living-space/maintenance/gate controls now accept z too, with scoped job and ownership side effects. job.order also accepts z for basic supplied construction/repair/service/dismantling and treatment/bedside feeding/hygiene/fire suppression/planting/watering/gathering/mining. Machine orders schedule actual-floor operators too; six airlock controls now accept z too; other work families and remaining crew actions still need conversion. |
| Seeded planetary regions | [region](src/region.js), [survey panels](src/region-panels.js), [journey checks](tests/region-integration.test.js) | Canonical metadata, private generator RNG, finite mutable sites, round-trip fuel versus per-leg travel. Save68 retains region schema1 worlds; new schema2 worlds have three planets/eight sites. [View hierarchy](src/region-view.js) stays outside saves. |
| State, ticks, saves | [simulation](src/simulation.js), [persistence](src/persistence.js), [data](src/data.js) | Ownership, RNG, topology and migration. |
| Paid construction example | [Node example](tools/paid-airlock-example.mjs), [recorded check](tests/paid-airlock-example.test.js) | Shared commands, physical payments and typed work; construction only, no commissioning or endurance claim. |
| Paid air recovery | [Node helper](tools/paid-air-recovery.mjs), [focused checks](tests/paid-air-recovery.test.js) | Existing canonical layout, finite batches and native delivery/return; first stops preserved. Recovery alone does not establish commissioning or endurance. |
| Paid night/day recovery | [Node helper](tools/paid-night-recovery.mjs), [focused checks](tests/paid-night-recovery.test.js) | Existing paid layout, finite delivery, native rest and exact daytime continuation; preserve first stops. Finite recovery is verified; ongoing night conditioning remains pending. |
| Airlock commissioning | [Node helper](tools/paid-airlock-commissioning.mjs), [focused checks](tests/paid-airlock-commissioning.test.js) | Existing paid layout, finite gas/power and source readiness; preserve first stops. One ordinary commissioning checkpoint is verified; passage and endurance remain pending. |
| Browser and visuals | [app](src/app.js), [renderer](src/render.js), [geometry](src/geometry.js), [floor view](src/deck-view.js) | Hex topology, projection and picking are separate. |
| Crew hazard exposure | [simulation](src/simulation.js), [stacked-floor checks](tests/crew-hazard-floors.test.js) | Fire injury, wreck shelter and docked protection use actual-floor positions. Exposure events identify the occupied tile. |
| Physical environment | [atmosphere](src/atmosphere.js), [power](src/power.js), [airlocks](src/airlocks.js), [cargo scenarios](tests/airlock-freight-integration.test.js) | Finite supplies, tick ordering and door interlocks. Cargo scenarios are synthetic, not ordinary colony acceptance. |
| Structural materials | [definitions](src/material-data.js), [construction and ownership](src/materials.js), [panels](src/material-panels.js), [physics checks](tests/material-physics.test.js) | Paid floor/wall/door choices, separate floor/structure owners, implicit alloy, finite stacked-room heat, supplied repair and schema66. Openings retain independent paths; no floor collapse. |
| Work tools | [materials and recipes](src/tool-data.js), [equipment and wear](src/tools.js), [inspection](src/tool-panels.js) | Physical mining tools and engineering kits; routed pickup; capability-matched work and wear; supplied same-identity repair; one tool plus one keepsake per crew member. Schema67 preserves prior items and adds kits; stock targets distinguish family/material. |
| Building and industry | [construction](src/construction.js), [production](src/production.js), [inventory](src/inventory.js), [reservation queries](src/inventory-reservations.js) | Delivered inputs differ from reservations. Availability/capacity queries distinguish decks; saved shipment references now retain explicit deck-zero positions. |
| Crew, food, ecology | [crew life](src/crew-life.js), [food lots](src/food-lots.js), [husbandry](src/husbandry.js) | Health, freshness, ancestry and bodies. [Personal items](src/possessions.js) retain actual-floor custody; [inventory owners](src/item-lots.js) use the canonical tile IDs in spatial.js for discrete items and meal observations. |
| Orbital supply/residence | [freight](src/freight.js), [outposts](src/outposts.js), [expedition](src/expedition.js) | Presence, passengers and supplies have separate owners. |
| Observations/recording | [telemetry](src/telemetry.js) | Instrumentation cannot alter simulation/save state. |
| Independent elements lab | [elements](src/elements.js), [lab app](src/elements-app.js) | Separate gravity, topology and constants. |

## Run and check

No application dependencies need installing. From the repository root:

```sh
python3 tools/serve.py
node --test tests/hex-integration.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
```

Serve locally on port8420; `elements.html` opens the lab. Select focused tests for the changed subsystem; [CI](.github/workflows/tests.yml) uses `node --test tests` for the full JavaScript gate. This review did **not** run tests.

## Important limits

- Current saves accept validated hex schemas40–68. Square schemas1–39 are rejected and their original bytes remain protected for export; do not relabel them as hex.
- Current readiness is not an endurance forecast. A supplied, briefly ready room does not establish sustained outpost habitation, care or a complete return journey.
- Existing public evidence includes finite recovery successes and later resource/air recovery failures. [Verification status](docs/verification-status.md) preserves their scope; [roadmap](ROADMAP.md) records unfinished ordinary journeys.
- Do not directly grant supplies, healing or movement to make acceptance pass. Preserve physical jobs, conservation and player/agent parity.

## Keep this briefing useful

Update affected links and the version ledger when behavior or compatibility changes. Keep historical facts and limitations. Review coverage:316 tracked files inventoried, structural extraction and selected excerpts inspected. This was not a line-by-line semantic audit or browser check.
