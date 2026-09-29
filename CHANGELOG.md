# Changelog

SPACEFORTRESS is an early playable colony simulator. Release entries describe completed changes within their stated scope.

## v0.1.1 — 2026-09-29

### Outpost foundations

- Save schema 37 separates wreck residence, expedition arrival history, selected return passengers, shuttle freight and imports stored at each dock.
- Physical inventory accounting preserves food age, prepared-meal metadata and item identities across the new owners. Construction and reservation primitives now identify the supplying site.
- Shuttle drawing follows its actual location: an empty berth remains empty while the craft is elsewhere or in transit.
- Pure observations expose residence, return rosters, inventories and shuttle presence through the shared simulation interface.

These are foundations for later outpost gameplay. This release does **not** add player settlement or freight controls, remote Build access, resident care or a playable resupply loop. Connected local levels and generated worlds also remain unfinished.

### Fixes

- Prevent food aging from crashing when a destination dock is missing.
- Reject shared ownership between freight/import storage and opened meals, including shared food metadata.
- Check old saves for invalid outpost data before earlier migrations can silently discard it.
- Prevent boarding return travelers from claiming work left for residents.
- Export the active colony after Import/New even when browser storage rejects the replacement save; keep unreadable original bytes protected while the original fallback is active.

### Saves and running the game

- Play the [game](https://jaredcastorena.github.io/spacefortress/) or [elements lab](https://jaredcastorena.github.io/spacefortress/elements.html) directly through GitHub Pages. Publication follows successful tests and serves only the explicit public game assets, license and version manifest.
- Original schema 36 saves migrate to schema 37. New residence and inventory owners start empty; the existing expedition crew is copied into an independent return roster. Existing resources, cargo, crew state and RNG are preserved.
- Current saves with missing fields, invalid resources, duplicate or unknown residents, or impossible return rosters are rejected rather than silently repaired.
- Export a JSON backup before upgrading. Hosted play and a local server use different browser origins and therefore separate saves; changing the local host or port also changes the origin. Use the game's JSON export/import to move a colony between them. There is no cloud-save synchronization.
- No runtime dependencies were added. The local preview uses Python's standard library; the game uses local JavaScript, Canvas and CSS. See the [README](README.md) for play and setup instructions.

## v0.1.0 — 2026-09-23

- First public MIT-licensed source release, with local browser play and a separate elements laboratory.
- Included colony construction, crew needs, production, environmental utilities, explicit two-person expeditions, physical salvage return and supplied shuttle upgrades.
- Added local JSON save import/export, optional local simulation recordings, contribution guidance and automated tests.

The initial release used save schema 36. Staffed outposts, connected local levels and generated worlds were not playable features.
