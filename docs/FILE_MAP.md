# SPACEFORTRESS file map

[Start with CASTOR](../CASTOR.md) · [Version ledger](AGENT_VERSIONS.md)

Navigation review of the tracked checkout at e330c6f. Text was fully decoded for structural extraction, with selected direct excerpts; compressed fixtures were decoded as JSON and PNG headers inspected. Roles are navigation aids, not proof of correctness. No test suite or browser was run. Private administration is not part of this public map. Read only the section and files needed for your task.

## Application and delivery

23 files.

| File | Role |
| --- | --- |
| [.github/ISSUE_TEMPLATE/bug_report.md](../.github/ISSUE_TEMPLATE/bug_report.md) | Repository contribution and issue-report configuration. |
| [.github/ISSUE_TEMPLATE/feature_request.md](../.github/ISSUE_TEMPLATE/feature_request.md) | Repository contribution and issue-report configuration. |
| [.github/pull_request_template.md](../.github/pull_request_template.md) | Repository contribution and issue-report configuration. |
| [.github/workflows/tests.yml](../.github/workflows/tests.yml) | Repository continuous integration and static publishing workflow. |
| [ASSET_SOURCES.md](../ASSET_SOURCES.md) | Art origins, licensing and original procedural rendering notes. |
| [CHANGELOG.md](../CHANGELOG.md) | Public release history and unpublished changes. |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Contributor guidance and project participation policy. |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contributor guidance and project participation policy. |
| [LICENSE](../LICENSE) | MIT license terms and attribution. |
| [README.md](../README.md) | Public project introduction, local startup and documentation navigation. |
| [ROADMAP.md](../ROADMAP.md) | Ordered development goals and unfinished simulation systems. |
| [SECURITY.md](../SECURITY.md) | Contributor guidance and project participation policy. |
| [elements.css](../elements.css) | Visual layout and styling for elements laboratory. |
| [elements.html](../elements.html) | Browser entry page for isolated elements laboratory. |
| [index.html](../index.html) | Browser entry page for main colony game. |
| [package.json](../package.json) | Project version, zero-dependency runtime metadata and start/test commands. |
| [style.css](../style.css) | Visual layout and styling for colony interface. |
| [tools/build_pages.py](../tools/build_pages.py) | Explicit static-site export builder and asset validation. |
| [tools/pages-assets.json](../tools/pages-assets.json) | Explicit public asset allowlist for the static export. |
| [tools/paid-airlock-commissioning.mjs](../tools/paid-airlock-commissioning.mjs) | Bounded shared-command gas recovery, controller setup and detached commissioning status for the paid layout. |
| [tools/paid-air-recovery.mjs](../tools/paid-air-recovery.mjs) | Offline bounded recovery of a canonical colony save through shared production and delivery commands. |
| [tools/paid-airlock-example.mjs](../tools/paid-airlock-example.mjs) | Offline shared-command paid construction example, bounded result and optional save export. |
| [tools/serve.py](../tools/serve.py) | Standard-library local HTTP server with application and save handling. |

## Runtime modules

[Extraction source rules](../src/extraction.js) own finite ice/impact reserves, terrain/salvage yields and reserve validation.

95 files.

| File | Role |
| --- | --- |
| [src/airlock-access.js](../src/airlock-access.js) | Domain helpers for airlock access |
| [src/airlock-locations.js](../src/airlock-locations.js) | Save51 location migration, exact position checks and explicit ground room/command boundaries |
| [src/airlock-panels.js](../src/airlock-panels.js) | HTML panel renderers and UI formatting for airlock |
| [src/airlock-persistence.js](../src/airlock-persistence.js) | Initialization, legacy migration assertions and state validation for airlock |
| [src/airlocks.js](../src/airlocks.js) | Domain helpers for airlocks |
| [src/animal-carcasses.js](../src/animal-carcasses.js) | Domain helpers for animal carcasses |
| [src/animal-health.js](../src/animal-health.js) | Domain helpers for animal health |
| [src/animal-traits.js](../src/animal-traits.js) | Domain helpers for animal traits |
| [src/animal-transport.js](../src/animal-transport.js) | Domain helpers for animal transport |
| [src/app.js](../src/app.js) | Browser application orchestration, UI bindings, update and render loop |
| [src/atmosphere-panels.js](../src/atmosphere-panels.js) | HTML panel renderers and UI formatting for atmosphere |
| [src/atmosphere.js](../src/atmosphere.js) | Compartment discovery and gas redistribution, door movement/control, pressure/breathability, life support and shared room/suit oxygen allocation. |
| [src/breaker-panels.js](../src/breaker-panels.js) | HTML panel renderers and UI formatting for breaker |
| [src/breakers.js](../src/breakers.js) | Domain helpers for breakers |
| [src/breeding.js](../src/breeding.js) | Domain helpers for breeding |
| [src/comfort-panels.js](../src/comfort-panels.js) | HTML panel renderers and UI formatting for comfort |
| [src/comfort.js](../src/comfort.js) | Domain helpers for comfort |
| [src/construction.js](../src/construction.js) | Site work authority, local construction supply reservation, worker material pickup/delivery, cancellation and reservation accounting. |
| [src/controls.js](../src/controls.js) | Shared player/agent action registry, argument validation, dispatcher and browser agent API factory |
| [src/crew-life-panels.js](../src/crew-life-panels.js) | HTML panel renderers and UI formatting for crew-life |
| [src/crew-identity.js](../src/crew-identity.js) | Bounded canonical crew IDs and maker arrival timestamps. |
| [src/population.js](../src/population.js) | Lazy recruitment, deterministic candidates, bounded landing, detached newcomer initialization and strict history validation. |
| [src/population-panels.js](../src/population-panels.js) | Collapsed recruitment details and focus restoration. |
| [src/crew-life.js](../src/crew-life.js) | Domain helpers for crew life |
| [src/crew-panels.js](../src/crew-panels.js) | HTML panel renderers and UI formatting for crew |
| [src/crew-traversal.js](../src/crew-traversal.js) | Domain helpers for crew traversal |
| [src/crew.js](../src/crew.js) | Persistent crew labor/skill profiles, shared personal work readiness/rate, experience, memories and morale. |
| [src/data.js](../src/data.js) | Colony save schema VERSION=73 and static resource, building, recipe (including finite fuel synthesis), species, site, crew and shuttle-fit registries. |
| [src/elements-app.js](../src/elements-app.js) | Elements reference browser application |
| [src/elements.js](../src/elements.js) | Separate deterministic cell environment laboratory with materials, gas/water/heat, devices, electrical circuits, action schema and bounded JSONL recording. |
| [src/expedition-panels.js](../src/expedition-panels.js) | HTML panel renderers and UI formatting for expedition |
| [src/expedition-readiness.js](../src/expedition-readiness.js) | Domain helpers for expedition readiness |
| [src/expedition.js](../src/expedition.js) | Domain helpers for expedition |
| [src/fire-panels.js](../src/fire-panels.js) | HTML panel renderers and UI formatting for fire |
| [src/fire.js](../src/fire.js) | Equipment ignition, combustion/smoke/heat/damage, spread, automatic suppression jobs, evacuation and fire/smoke validation. |
| [src/flora-data.js](../src/flora-data.js) | Static flora definitions |
| [src/flora-panels.js](../src/flora-panels.js) | HTML panel renderers and UI formatting for flora |
| [src/flora.js](../src/flora.js) | Domain helpers for flora |
| [src/food-data.js](../src/food-data.js) | Static food definitions |
| [src/food-lots.js](../src/food-lots.js) | Domain helpers for food lots |
| [src/food-panels.js](../src/food-panels.js) | HTML panel renderers and UI formatting for food |
| [src/freight-persistence.js](../src/freight-persistence.js) | Initialization, legacy migration assertions and state validation for freight |
| [src/freight.js](../src/freight.js) | Domain helpers for freight |
| [src/gas-networks.js](../src/gas-networks.js) | Domain helpers for gas networks |
| [src/gas-panels.js](../src/gas-panels.js) | HTML panel renderers and UI formatting for gas |
| [src/deck-view.js](../src/deck-view.js) | Local floor selection, stale-gesture scopes, stair and hazard panels |
| [src/geometry.js](../src/geometry.js) | Shared flat-top odd-q hex coordinates, neighbors, distance and ground mapping |
| [src/housing-panels.js](../src/housing-panels.js) | HTML panel renderers and UI formatting for housing |
| [src/housing.js](../src/housing.js) | Domain helpers for housing |
| [src/husbandry-panels.js](../src/husbandry-panels.js) | HTML panel renderers and UI formatting for husbandry |
| [src/husbandry.js](../src/husbandry.js) | Domain helpers for husbandry |
| [src/hygiene.js](../src/hygiene.js) | Domain helpers for hygiene |
| [src/industry-panels.js](../src/industry-panels.js) | HTML panel renderers and UI formatting for industry |
| [src/industry.js](../src/industry.js) | Domain helpers for industry |
| [src/inventory-reservations.js](../src/inventory-reservations.js) | Domain helpers for inventory reservations |
| [src/inventory.js](../src/inventory.js) | Domain helpers for inventory |
| [src/item-lots.js](../src/item-lots.js) | Domain helpers for item lots |
| [src/liquid-panels.js](../src/liquid-panels.js) | HTML panel renderers and UI formatting for liquid |
| [src/liquids.js](../src/liquids.js) | Domain helpers for liquids |
| [src/livestock-data.js](../src/livestock-data.js) | Static livestock definitions |
| [src/maintenance-panels.js](../src/maintenance-panels.js) | HTML panel renderers and UI formatting for maintenance |
| [src/maintenance.js](../src/maintenance.js) | Domain helpers for maintenance |
| [src/meals.js](../src/meals.js) | Domain helpers for meals |
| [src/medicine.js](../src/medicine.js) | Domain helpers for medicine |
| [src/mobility.js](../src/mobility.js) | Domain helpers for mobility |
| [src/navigation.js](../src/navigation.js) | Domain helpers for navigation |
| [src/vertical.js](../src/vertical.js) | Shared declared stairwell/hatch validation, traversal permissions and environmental opening rules; paid construction and save admission pending |
| [src/nursing.js](../src/nursing.js) | Domain helpers for nursing |
| [src/outpost-panels.js](../src/outpost-panels.js) | HTML panel renderers and UI formatting for outpost |
| [src/outpost-persistence.js](../src/outpost-persistence.js) | Initialization, legacy migration assertions and state validation for outpost |
| [src/outpost-readiness.js](../src/outpost-readiness.js) | Domain helpers for outpost readiness |
| [src/outposts.js](../src/outposts.js) | Domain helpers for outposts |
| [src/pastures.js](../src/pastures.js) | Domain helpers for pastures |
| [src/persistence.js](../src/persistence.js) | Browser save load/store/export with preservation of unreadable original bytes |
| [src/plumbing-panels.js](../src/plumbing-panels.js) | HTML panel renderers and UI formatting for plumbing |
| [src/plumbing.js](../src/plumbing.js) | Domain helpers for plumbing |
| [src/possession-panels.js](../src/possession-panels.js) | HTML panel renderers and UI formatting for possession |
| [src/possessions.js](../src/possessions.js) | Domain helpers for possessions |
| [src/power-panels.js](../src/power-panels.js) | HTML panel renderers and UI formatting for power |
| [src/power-topology.js](../src/power-topology.js) | Domain helpers for power topology |
| [src/power-routing.js](../src/power-routing.js) | Pure finite source/sink transport through physical graph paths, stable ties and signed contact throughput. |
| [src/power.js](../src/power.js) | Electrical allocation previews and committed updates, generation/batteries, branch breaker conditions, cable controls and energy validation. |
| [src/preflight-panels.js](../src/preflight-panels.js) | HTML panel renderers and UI formatting for preflight |
| [src/preflight.js](../src/preflight.js) | Domain helpers for preflight |
| [src/material-data.js](../src/material-data.js) | Shared immutable alloy/composite tool and structure properties. |
| [src/materials.js](../src/materials.js) | Paid construction/repair specifications, independent floor/structure ownership, refunds, inspection and save validation. |
| [src/material-panels.js](../src/material-panels.js) | Collapsed material selection and layer inspection. |
| [src/tool-data.js](../src/tool-data.js) | Mining/engineering tool capabilities and manufacturing/repair recipes using shared material properties. |
| [src/tools.js](../src/tools.js) | Physical equipment pickup, release, work-based wear and tool identity. |
| [src/tool-panels.js](../src/tool-panels.js) | Collapsed tool selection and condition inspection. |
| [src/production.js](../src/production.js) | Staffed machine recipe selection, stock/batch orders, input demand, operator eligibility, production scheduling and operation validation. |
| [src/reactor-panels.js](../src/reactor-panels.js) | HTML panel renderers and UI formatting for reactor |
| [src/reactor-rules.js](../src/reactor-rules.js) | Domain helpers for reactor rules |
| [src/reactors.js](../src/reactors.js) | Domain helpers for reactors |
| [src/render.js](../src/render.js) | Canvas world rendering and visual overlays |
| [src/room-panels.js](../src/room-panels.js) | HTML panel renderers and UI formatting for room |
| [src/hazard-locations.js](../src/hazard-locations.js) | Named debris/incident position validation and schema52 migration |
| [src/room-locations.js](../src/room-locations.js) | Room and purpose-anchor ownership, scoped membership/tiles, position lookup and save migration |
| [src/rooms.js](../src/rooms.js) | Compartment purpose markers, conflicts, readiness/benefits, waste storage acceptance and greenhouse blocks. |
| [src/sanitation-panels.js](../src/sanitation-panels.js) | HTML panel renderers and UI formatting for sanitation |
| [src/sanitation.js](../src/sanitation.js) | Domain helpers for sanitation |
| [src/simulation.js](../src/simulation.js) | Main colony state creation, player orders, job assignment/actions, expedition lifecycle, tick orchestration, save serialization and schema validation/migration. |
| [src/spoilage.js](../src/spoilage.js) | Domain helpers for spoilage |
| [src/sprites.js](../src/sprites.js) | Original cached canvas crew sprite generation |
| [src/storage.js](../src/storage.js) | Shared depot capacity, per-resource delivery limits, incoming/reserved claims and policy validation |
| [src/suit-release-status.js](../src/suit-release-status.js) | Pure current-compartment release limits, actor gates, exact capacity and stable destinations |
| [src/suit-supply.js](../src/suit-supply.js) | Finite personal suit/mix conversion, local resupply, manual room release and typed gas transfers |
| [src/telemetry.js](../src/telemetry.js) | Entity observations, structured diffs, event capture and bounded opt-in recording |
| [src/thermal-panels.js](../src/thermal-panels.js) | HTML panel renderers and UI formatting for thermal |
| [src/thermal.js](../src/thermal.js) | Domain helpers for thermal |
| [src/water-panels.js](../src/water-panels.js) | HTML panel renderers and UI formatting for water |
| [src/water.js](../src/water.js) | Finite terrain ice deposits, initialization, stored water/ice supply summary and reserve validation. |

## Tests and fixtures

149 files.

| File | Role |
| --- | --- |
| [tests/paid-airlock-commissioning.test.js](../tests/paid-airlock-commissioning.test.js) | Commissioning helper mechanics, physical gas transfer, restored settings and first stops. |
| [tests/paid-air-recovery.test.js](../tests/paid-air-recovery.test.js) | Paid-air helper and CLI mechanics; prepared fixtures have separate scope from ordinary colony acceptance. |
| [tests/paid-airlock-example.test.js](../tests/paid-airlock-example.test.js) | Recorded ordinary paid construction, typed work, finite materials and CLI argument checks. |
| [tests/airlock-core.test.js](../tests/airlock-core.test.js) | Static regression test source for airlock core |
| [tests/airlock-integration.test.js](../tests/airlock-integration.test.js) | Static regression test source for airlock integration |
| [tests/airlock-ui.test.js](../tests/airlock-ui.test.js) | Static regression test source for airlock ui |
| [tests/animal-carcasses.test.js](../tests/animal-carcasses.test.js) | Static regression test source for animal carcasses |
| [tests/animal-health-integration.test.js](../tests/animal-health-integration.test.js) | Static regression test source for animal health integration |
| [tests/animal-health-panels.test.js](../tests/animal-health-panels.test.js) | Static regression test source for animal health panels |
| [tests/animal-health.test.js](../tests/animal-health.test.js) | Static regression test source for animal health |
| [tests/animal-traits-integration.test.js](../tests/animal-traits-integration.test.js) | Static regression test source for animal traits integration |
| [tests/animal-traits-panels.test.js](../tests/animal-traits-panels.test.js) | Static regression test source for animal traits panels |
| [tests/animal-traits.test.js](../tests/animal-traits.test.js) | Static regression test source for animal traits |
| [tests/animal-transport.test.js](../tests/animal-transport.test.js) | Static regression test source for animal transport |
| [tests/atmosphere-precision.test.js](../tests/atmosphere-precision.test.js) | Static regression test source for atmosphere precision |
| [tests/atmosphere-reserve.test.js](../tests/atmosphere-reserve.test.js) | Static regression test source for atmosphere reserve |
| [tests/atmosphere-status-panels.test.js](../tests/atmosphere-status-panels.test.js) | Static regression test source for atmosphere status panels |
| [tests/atmosphere-status.test.js](../tests/atmosphere-status.test.js) | Static regression test source for atmosphere status |
| [tests/atmosphere.test.js](../tests/atmosphere.test.js) | Static regression test source for atmosphere |
| [tests/breakers-cascades.test.js](../tests/breakers-cascades.test.js) | Static regression test source for breakers cascades |
| [tests/breakers-conservation.test.js](../tests/breakers-conservation.test.js) | Static regression test source for breakers conservation |
| [tests/breakers-migration.test.js](../tests/breakers-migration.test.js) | Static regression test source for breakers migration |
| [tests/breakers-telemetry.test.js](../tests/breakers-telemetry.test.js) | Static regression test source for breakers telemetry |
| [tests/breakers-topology.test.js](../tests/breakers-topology.test.js) | Static regression test source for breakers topology |
| [tests/breakers.test.js](../tests/breakers.test.js) | Static regression test source for breakers |
| [tests/breathing-integration.test.js](../tests/breathing-integration.test.js) | Static regression test source for breathing integration |
| [tests/breeding.test.js](../tests/breeding.test.js) | Static regression test source for breeding |
| [tests/butchery-integration.test.js](../tests/butchery-integration.test.js) | Static regression test source for butchery integration |
| [tests/butchery-panels.test.js](../tests/butchery-panels.test.js) | Static regression test source for butchery panels |
| [tests/comfort.test.js](../tests/comfort.test.js) | Static regression test source for comfort |
| [tests/construction.test.js](../tests/construction.test.js) | Static regression test source for construction |
| [tests/crew-experience.test.js](../tests/crew-experience.test.js) | Static regression test source for crew experience |
| [tests/crew-life.test.js](../tests/crew-life.test.js) | Static regression test source for crew life |
| [tests/crew-recovery-cargo.test.js](../tests/crew-recovery-cargo.test.js) | Static regression test source for crew recovery cargo |
| [tests/crew.test.js](../tests/crew.test.js) | Static regression test source for crew |
| [tests/cultivation-integration.test.js](../tests/cultivation-integration.test.js) | Static regression test source for cultivation integration |
| [tests/cultivation.test.js](../tests/cultivation.test.js) | Static regression test source for cultivation |
| [tests/elements.test.js](../tests/elements.test.js) | Static regression test source for elements |
| [tests/expedition-selection-conservation.test.js](../tests/expedition-selection-conservation.test.js) | Static regression test source for expedition selection conservation |
| [tests/expedition-selection-persistence.test.js](../tests/expedition-selection-persistence.test.js) | Static regression test source for expedition selection persistence |
| [tests/expedition-selection-safety.test.js](../tests/expedition-selection-safety.test.js) | Static regression test source for expedition selection safety |
| [tests/expedition-selection-telemetry.test.js](../tests/expedition-selection-telemetry.test.js) | Static regression test source for expedition selection telemetry |
| [tests/expedition-selection.test.js](../tests/expedition-selection.test.js) | Static regression test source for expedition selection |
| [tests/expedition-terminal.test.js](../tests/expedition-terminal.test.js) | Static regression test source for expedition terminal |
| [tests/expedition.test.js](../tests/expedition.test.js) | Static regression test source for expedition |
| [tests/crew-hazard-floors.test.js](../tests/crew-hazard-floors.test.js) | Crew fire exposure, wreck shelter and dock protection on stacked floors. |
| [tests/fire.test.js](../tests/fire.test.js) | Static regression test source for fire |
| [tests/fixtures/breakers-schema35-owned-provenance.json](../tests/fixtures/breakers-schema35-owned-provenance.json) | Fixture provenance metadata |
| [tests/fixtures/breakers-schema35-owned.json.gz](../tests/fixtures/breakers-schema35-owned.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/expedition-schema36-boarding.json.gz](../tests/fixtures/expedition-schema36-boarding.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/expedition-schema36-loading.json.gz](../tests/fixtures/expedition-schema36-loading.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/expedition-schema36-outbound.json.gz](../tests/fixtures/expedition-schema36-outbound.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/expedition-schema36-provenance.json](../tests/fixtures/expedition-schema36-provenance.json) | Fixture provenance metadata |
| [tests/fixtures/expedition-schema36-returning.json.gz](../tests/fixtures/expedition-schema36-returning.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/gas-schema33-retained-provenance.json](../tests/fixtures/gas-schema33-retained-provenance.json) | Fixture provenance metadata |
| [tests/fixtures/gas-schema33-retained.json.gz](../tests/fixtures/gas-schema33-retained.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/outpost-pre36-outbound.json.gz](../tests/fixtures/outpost-pre36-outbound.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/outpost-pre36-provenance.json](../tests/fixtures/outpost-pre36-provenance.json) | Fixture provenance metadata |
| [tests/fixtures/outpost-pre36-returning.json.gz](../tests/fixtures/outpost-pre36-returning.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/outpost-pre36-working-cargo.json.gz](../tests/fixtures/outpost-pre36-working-cargo.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/outpost-pre36-working-carried.json.gz](../tests/fixtures/outpost-pre36-working-carried.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/outpost-pre36-working-pile.json.gz](../tests/fixtures/outpost-pre36-working-pile.json.gz) | Compressed saved-state migration fixture |
| [tests/fixtures/plumbing-schema34-owned-provenance.json](../tests/fixtures/plumbing-schema34-owned-provenance.json) | Fixture provenance metadata |
| [tests/fixtures/plumbing-schema34-owned.json.gz](../tests/fixtures/plumbing-schema34-owned.json.gz) | Compressed saved-state migration fixture |
| [tests/flora-integration.test.js](../tests/flora-integration.test.js) | Static regression test source for flora integration |
| [tests/flora-panels.test.js](../tests/flora-panels.test.js) | Static regression test source for flora panels |
| [tests/flora.test.js](../tests/flora.test.js) | Static regression test source for flora |
| [tests/food-variety-hauling.test.js](../tests/food-variety-hauling.test.js) | Static regression test source for food variety hauling |
| [tests/food-variety-migration.test.js](../tests/food-variety-migration.test.js) | Static regression test source for food variety migration |
| [tests/food-variety-panels.test.js](../tests/food-variety-panels.test.js) | Static regression test source for food variety panels |
| [tests/food-variety.test.js](../tests/food-variety.test.js) | Static regression test source for food variety |
| [tests/food.test.js](../tests/food.test.js) | Static regression test source for food |
| [tests/freight-conservation.test.js](../tests/freight-conservation.test.js) | Static regression test source for freight conservation |
| [tests/freight-persistence.test.js](../tests/freight-persistence.test.js) | Static regression test source for freight persistence |
| [tests/gas-exhaust-conservation.test.js](../tests/gas-exhaust-conservation.test.js) | Static regression test source for gas exhaust conservation |
| [tests/gas-exhaust-migration.test.js](../tests/gas-exhaust-migration.test.js) | Static regression test source for gas exhaust migration |
| [tests/gas-exhaust-telemetry.test.js](../tests/gas-exhaust-telemetry.test.js) | Static regression test source for gas exhaust telemetry |
| [tests/gas-exhaust.test.js](../tests/gas-exhaust.test.js) | Static regression test source for gas exhaust |
| [tests/gas-networks.test.js](../tests/gas-networks.test.js) | Static regression test source for gas networks |
| [tests/haul-precision.test.js](../tests/haul-precision.test.js) | Static regression test source for haul precision |
| [tests/helpers/airlock-fixture.js](../tests/helpers/airlock-fixture.js) | Shared test fixture/helper |
| [tests/helpers/current-outpost.js](../tests/helpers/current-outpost.js) | Shared test fixture/helper |
| [tests/helpers/depart.js](../tests/helpers/depart.js) | Shared test fixture/helper |
| [tests/helpers/legacy-projection.js](../tests/helpers/legacy-projection.js) | Shared test fixture/helper |
| [tests/helpers/legacy-square.js](../tests/helpers/legacy-square.js) | Shared test fixture/helper |
| [tests/helpers/outpost-gameplay.js](../tests/helpers/outpost-gameplay.js) | Shared test fixture/helper |
| [tests/hex-airlock.test.js](../tests/hex-airlock.test.js) | Static regression test source for hex airlock |
| [tests/hex-geometry.test.js](../tests/hex-geometry.test.js) | Static regression test source for hex geometry |
| [tests/hex-integration.test.js](../tests/hex-integration.test.js) | Static regression test source for hex integration |
| [tests/hex-movement.test.js](../tests/hex-movement.test.js) | Static regression test source for hex movement |
| [tests/hex-physics.test.js](../tests/hex-physics.test.js) | Static regression test source for hex physics |
| [tests/hex-view.test.js](../tests/hex-view.test.js) | Static regression test source for hex view |
| [tests/housing.test.js](../tests/housing.test.js) | Static regression test source for housing |
| [tests/husbandry.test.js](../tests/husbandry.test.js) | Static regression test source for husbandry |
| [tests/hygiene.test.js](../tests/hygiene.test.js) | Static regression test source for hygiene |
| [tests/industry.test.js](../tests/industry.test.js) | Static regression test source for industry |
| [tests/inventory-reservations.test.js](../tests/inventory-reservations.test.js) | Static regression test source for inventory reservations |
| [tests/liquids.test.js](../tests/liquids.test.js) | Static regression test source for liquids |
| [tests/livestock-variety.test.js](../tests/livestock-variety.test.js) | Static regression test source for livestock variety |
| [tests/maintenance.test.js](../tests/maintenance.test.js) | Static regression test source for maintenance |
| [tests/meals.test.js](../tests/meals.test.js) | Static regression test source for meals |
| [tests/meat-food.test.js](../tests/meat-food.test.js) | Static regression test source for meat food |
| [tests/medicine.test.js](../tests/medicine.test.js) | Static regression test source for medicine |
| [tests/nursing.test.js](../tests/nursing.test.js) | Static regression test source for nursing |
| [tests/orbital-colony-loop.test.js](../tests/orbital-colony-loop.test.js) | Static regression test source for orbital colony loop |
| [tests/outpost-actions.test.js](../tests/outpost-actions.test.js) | Static regression test source for outpost actions |
| [tests/outpost-conservation.test.js](../tests/outpost-conservation.test.js) | Static regression test source for outpost conservation |
| [tests/outpost-construction.test.js](../tests/outpost-construction.test.js) | Static regression test source for outpost construction |
| [tests/outpost-gameplay-diagnostics.test.js](../tests/outpost-gameplay-diagnostics.test.js) | Static regression test source for outpost gameplay diagnostics |
| [tests/outpost-integration.test.js](../tests/outpost-integration.test.js) | Static regression test source for outpost integration |
| [tests/outpost-migration.test.js](../tests/outpost-migration.test.js) | Static regression test source for outpost migration |
| [tests/outpost-pre36-fixtures.test.js](../tests/outpost-pre36-fixtures.test.js) | Static regression test source for outpost pre36 fixtures |
| [tests/outpost-readiness.test.js](../tests/outpost-readiness.test.js) | Static regression test source for outpost readiness |
| [tests/outpost-reservations.test.js](../tests/outpost-reservations.test.js) | Static regression test source for outpost reservations |
| [tests/outpost-resident-care.test.js](../tests/outpost-resident-care.test.js) | Static regression test source for outpost resident care |
| [tests/outpost-return-roster.test.js](../tests/outpost-return-roster.test.js) | Static regression test source for outpost return roster |
| [tests/outpost-telemetry.test.js](../tests/outpost-telemetry.test.js) | Static regression test source for outpost telemetry |
| [tests/outposts.test.js](../tests/outposts.test.js) | Static regression test source for outposts |
| [tests/pastures.test.js](../tests/pastures.test.js) | Static regression test source for pastures |
| [tests/persistence.test.js](../tests/persistence.test.js) | Static regression test source for persistence |
| [tests/pests.test.js](../tests/pests.test.js) | Trap health, physical bait, recorded capture cost and shared paid repair regressions |
| [tests/plumbing-conservation.test.js](../tests/plumbing-conservation.test.js) | Static regression test source for plumbing conservation |
| [tests/plumbing-logistics.test.js](../tests/plumbing-logistics.test.js) | Static regression test source for plumbing logistics |
| [tests/plumbing-maintenance.test.js](../tests/plumbing-maintenance.test.js) | Static regression test source for plumbing maintenance |
| [tests/plumbing-migration.test.js](../tests/plumbing-migration.test.js) | Static regression test source for plumbing migration |
| [tests/plumbing-telemetry.test.js](../tests/plumbing-telemetry.test.js) | Static regression test source for plumbing telemetry |
| [tests/plumbing.test.js](../tests/plumbing.test.js) | Static regression test source for plumbing |
| [tests/possessions.test.js](../tests/possessions.test.js) | Static regression test source for possessions |
| [tests/power-topology.test.js](../tests/power-topology.test.js) | Static regression test source for power topology |
| [tests/power.test.js](../tests/power.test.js) | Static regression test source for power |
| [tests/preflight-loading-liveness.test.js](../tests/preflight-loading-liveness.test.js) | Static regression test source for preflight loading liveness |
| [tests/preflight.test.js](../tests/preflight.test.js) | Static regression test source for preflight |
| [tests/production.test.js](../tests/production.test.js) | Static regression test source for production |
| [tests/reactors.test.js](../tests/reactors.test.js) | Static regression test source for reactors |
| [tests/recycling.test.js](../tests/recycling.test.js) | Static regression test source for recycling |
| [tests/rooms.test.js](../tests/rooms.test.js) | Static regression test source for rooms |
| [tests/sanitation.test.js](../tests/sanitation.test.js) | Static regression test source for sanitation |
| [tests/shuttle-render.test.js](../tests/shuttle-render.test.js) | Static regression test source for shuttle render |
| [tests/simulation.test.js](../tests/simulation.test.js) | Static regression test source for simulation |
| [tests/storage.test.js](../tests/storage.test.js) | Static regression test source for storage |
| [tests/suit-release.test.js](../tests/suit-release.test.js) | Manual release gates, exact capacity, gas ownership, event reconstruction and player/agent/save parity |
| [tests/suit-release-ui.test.js](../tests/suit-release-ui.test.js) | Collapsed crew form, warnings, amount validation and per-crew draft/details/focus preservation |
| [tests/suit-supply.test.js](../tests/suit-supply.test.js) | Routed finite refill, source ownership, gas accounting, completion, preflight and recording parity |
| [tests/telemetry.test.js](../tests/telemetry.test.js) | Static regression test source for telemetry |
| [tests/test_pages.py](../tests/test_pages.py) | Static-site build and public asset boundary regression tests |
| [tests/test_serve.py](../tests/test_serve.py) | Loopback preview HTTP asset access regression tests |
| [tests/thermal.test.js](../tests/thermal.test.js) | Static regression test source for thermal |
| [tests/water.test.js](../tests/water.test.js) | Static regression test source for water |
| [tests/production-readiness.test.js](../tests/production-readiness.test.js) | Qualified versus personally available operators, existing reason precedence, active-operation binding and detached recording/save parity |
| [tests/work-readiness.test.js](../tests/work-readiness.test.js) | Shared work gates, simultaneous blocker codes, detached observations and recording/gameplay parity |

## Documentation and visual assets

58 files.

| File | Role |
| --- | --- |
| [docs/airlock-cycling-design.md](../docs/airlock-cycling-design.md) | Pressure-cycling airlocks |
| [docs/animal-traits.md](../docs/animal-traits.md) | Inherited livestock traits |
| [docs/animal-transport.md](../docs/animal-transport.md) | Handler transport and animal recovery |
| [docs/atmosphere.md](../docs/atmosphere.md) | Compartments, breathing, and life support |
| [docs/bedside-hygiene.md](../docs/bedside-hygiene.md) | Assisted bedside hygiene |
| [docs/breeding.md](../docs/breeding.md) | Herd reproduction and offspring |
| [docs/butchery.md](../docs/butchery.md) | Livestock bodies, butchery and meat meals |
| [docs/construction-logistics.md](../docs/construction-logistics.md) | Construction supplies and colony recovery |
| [docs/conversion-inventory.md](../docs/conversion-inventory.md) | SPACEFORTRESS conversion inventory |
| [docs/crew-life.md](../docs/crew-life.md) | Crew lives, downtime and relationships |
| [docs/crew-simulation.md](../docs/crew-simulation.md) | Crew behavior and work assignment |
| [docs/cultivation.md](../docs/cultivation.md) | Ground beds and finite watering |
| [docs/departure-preparation.md](../docs/departure-preparation.md) | Departure preparation and persistent ship stores |
| [docs/depot-storage.md](../docs/depot-storage.md) | Depot capacity and hauling |
| [docs/electrical-isolation-design.md](../docs/electrical-isolation-design.md) | Electrical isolation and overload protection |
| [docs/electrical-isolation.md](../docs/electrical-isolation.md) | Electrical branch isolation |
| [docs/elements-lab.md](../docs/elements-lab.md) | Elements and electricity lab |
| [docs/exhaust-and-filtration.md](../docs/exhaust-and-filtration.md) | Retained exhaust and filtration |
| [docs/expedition-logistics.md](../docs/expedition-logistics.md) | Expedition freight, salvage and return travel |
| [docs/fire-and-smoke.md](../docs/fire-and-smoke.md) | Fire, smoke and crew response |
| [docs/floor-water.md](../docs/floor-water.md) | Floor water, leaks and recovery |
| [docs/food-and-ecology.md](../docs/food-and-ecology.md) | Flora, livestock and cooking |
| [docs/food-preservation.md](../docs/food-preservation.md) | Food preservation and spoilage |
| [docs/frontier-life-and-folklore.md](../docs/frontier-life-and-folklore.md) | Frontier life and folklore |
| [docs/gas-networks.md](../docs/gas-networks.md) | Gas distribution |
| [docs/graphics-and-tools.md](../docs/graphics-and-tools.md) | Graphics and local tools |
| [docs/housing.md](../docs/housing.md) | Personal bunks and housing |
| [docs/husbandry.md](../docs/husbandry.md) | Livestock husbandry |
| [docs/images/spacefortress-colony.png](../docs/images/spacefortress-colony.png) | PNG documentation screenshot asset |
| [docs/images/spacefortress-hex.png](../docs/images/spacefortress-hex.png) | PNG documentation screenshot asset |
| [docs/implementation-status.md](../docs/implementation-status.md) | Implementation status and next depth pass |
| [docs/maintenance-and-hazards.md](../docs/maintenance-and-hazards.md) | Equipment maintenance and surface debris |
| [docs/medicine.md](../docs/medicine.md) | Injuries and medical care |
| [docs/nutrient-recycling.md](../docs/nutrient-recycling.md) | Nutrient recycling and supplied crops |
| [docs/orbital-colony-loop.md](../docs/orbital-colony-loop.md) | From colony to orbit and back |
| [docs/orbital-progression.md](../docs/orbital-progression.md) | Upward and outward progression |
| [docs/pastures.md](../docs/pastures.md) | Physical pastures |
| [docs/plumbing-design.md](../docs/plumbing-design.md) | Closed water plumbing — implementation contract |
| [docs/plumbing.md](../docs/plumbing.md) | Closed water plumbing |
| [docs/possessions.md](../docs/possessions.md) | Crafted personal possessions |
| [docs/power-networks.md](../docs/power-networks.md) | Electrical networks and stored energy |
| [docs/prepared-meals.md](../docs/prepared-meals.md) | Galley and prepared meals |
| [docs/production-and-logistics.md](../docs/production-and-logistics.md) | Production and physical supplies |
| [docs/production-orders.md](../docs/production-orders.md) | Staffed production and work orders |
| [docs/reactors.md](../docs/reactors.md) | Colony reactors and exterior cooling |
| [docs/release-readiness.md](../docs/release-readiness.md) | Public releases — readiness |
| [docs/rescue-and-nursing.md](../docs/rescue-and-nursing.md) | Patient rescue and bedside nursing |
| [docs/room-comfort.md](../docs/room-comfort.md) | Room comfort and personal preferences |
| [docs/room-designations.md](../docs/room-designations.md) | Room purposes and colony behavior |
| [docs/sanitation.md](../docs/sanitation.md) | Sanitation, waste collection and exposure |
| [docs/simulation-interface.md](../docs/simulation-interface.md) | Structured simulation interface and recordings |
| [docs/staffed-orbital-outpost-design.md](../docs/staffed-orbital-outpost-design.md) | Staffed orbital outpost |
| [docs/station-systems-reference.md](../docs/station-systems-reference.md) | Station simulation reference and next steps |
| [docs/temperature-and-climate.md](../docs/temperature-and-climate.md) | Temperature and climate control |
| [docs/verification-status.md](../docs/verification-status.md) | Verification status |
| [docs/vertical-slice-design.md](../docs/vertical-slice-design.md) | First playable local levels |
| [docs/veterinary-care.md](../docs/veterinary-care.md) | Livestock health and veterinary care |
| [docs/water-supply.md](../docs/water-supply.md) | Ice extraction and water supply |

## Utility connections

| File | Purpose |
| --- | --- |
| [src/utility-links.js](../src/utility-links.js) | Paid adjacent-floor power/gas/water connections, endpoint claims, isolation, shared maintenance and save validation. |
| [tests/utility-risers.test.js](../tests/utility-risers.test.js) | Paid work, finite transfers, player/agent parity and schema56 migration. |

## Animal floors

| File | Purpose |
| --- | --- |
| [tests/animal-floors.test.js](../tests/animal-floors.test.js) | Paid upstairs post, actual movement/escort/care/carcass jobs, shared controls and genuine schema57 migration. |

## Solar exposure additions

- [src/solar.js](../src/solar.js): pure daylight, overhead-column exposure and panel availability shared by power and observations.
- [tests/solar-occlusion.test.js](../tests/solar-occlusion.test.js): paid rooftop construction, finite energy, legacy migration and player/agent diagnostic parity.

## Upper-floor airlock verification

- [tests/extraction-floors.test.js](../tests/extraction-floors.test.js): native impact recovery and stair hauling, source custody, construction interruption, floor isolation, observations and genuine schema62 migration.
- [tests/cultivation-floors.test.js](../tests/cultivation-floors.test.js): paid upper planters, seed/water delivery, crop work and custody, floor-aware UI, finite irrigation/sunlight, destruction and genuine schema61 migration.
- [tests/hazard-response-floors.test.js](../tests/hazard-response-floors.test.js): upper suppression/maintenance delivery, exact-floor labels, blocked routes/supplies, cancellation custody and genuine schema60 migration.
- [tests/airlock-floors.test.js](../tests/airlock-floors.test.js): upper pressure cycles, stair approaches, rescue/cargo custody, interruption, player/agent parity, save migration and paid controller work.
- [tests/helpers/airlock-floor-fixture.js](../tests/helpers/airlock-floor-fixture.js): explicitly synthetic stacked finite assemblies; distinct from ordinary colony acceptance.

- [tests/stair-fire.test.js](../tests/stair-fire.test.js): cross-floor ignition, intact/damaged/automatic hatch containment, destination limits, event identity, save continuation and existing suppression.

- [tests/item-location-floors.test.js](../tests/item-location-floors.test.js): actual-floor item and split-meal identities, native stair pickup, shared release, death/hauling custody, blocked routes and save continuation.

## Seeded orbital regions

- [region.js](../src/region.js): canonical seeded metadata, finite layouts, site kinds, routes, strict validation and legacy migration.
- [region-panels.js](../src/region-panels.js): compact system overview and initial surveys.
- [region tests](../tests/region.test.js), [integration journeys](../tests/region-integration.test.js), [resident work](../tests/region-residents.test.js): reproducibility, genuine schema64 migration, native round trips/revisits and independent residence.

- [Structural material tests](../tests/structural-materials.test.js) and [material physics tests](../tests/material-physics.test.js): native paid chains, upstairs delivery, genuine schema65 migration, strict ownership, finite heat and independent damage paths.

- [Engineering equipment checks](../tests/engineering-tools.test.js): native paid manufacture/use/repair, work capabilities, type/material stock targets, upper-floor custody and genuine schema66 migration.

- [Planetary view model](../src/region-view.js): detached planet/site map nodes and visible mission endpoints; hierarchy selection stays outside the saved simulation.
- [Planetary region checks](../tests/planetary-regions.test.js): genuine schema67 migration, canonical membership, classic-state/RNG preservation, matching historical projections and filtered-map transit. Native journeys/residence cover every generated site in the existing region test files.
