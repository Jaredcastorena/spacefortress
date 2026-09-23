# Graphics and local tools

Design draft — September 16, 2026. Pixelorama is installed in the user's local applications directory; no tool binaries or external assets were added to the project.

## Confirmed visual direction and proposed production rules

The Dwarf Fortress Steam release describes its presentation as pixel graphics and static 2D sprites. Its world has depth, but that does not imply a rotating 3D renderer. If the intended reference is a separate 3D viewer or another game, identify it before choosing that production pipeline. [Official Steam page](https://store.steampowered.com/app/975370/Dwarf_Fortress/)

The user selected **isometric sprites: an angled view with more visible depth**. The latest progression concept moves from the planet up into orbit and farther space. Use detailed isometric maps for colonies, stations, wreck interiors, and resource sites, with a wider region view connecting them.

- Proposed starting footprint: a 64 × 32 pixel ground diamond; taller objects may extend above it. Use nearest-neighbor scaling. Final dimensions are a production choice still to validate.
- Begin with a fixed camera orientation. Anchor sprites consistently at the ground contact point; sort by position and elevation, accounting for tall and multi-tile objects.
- Provide wall cutaways, hidden-crew outlines, and level visibility so the angled view does not hide important activity.
- Use a compact shared palette with readable silhouettes at native size.
- Use shape and symbols as well as color for danger, selection, and equipment states.
- Separate terrain, structures, items, actors, effects, and UI overlays.
- Use terrain connection variants for walls, edges, and transitions.
- Layer crew bodies, clothing, suits, helmets, and tools where their shapes permit it.
- Give art stable names such as `terrain.basalt.wall` and `machine.scrubber.active`; keep sheet coordinates out of simulation rules.
- Export transparent PNG sheets plus a plain local manifest. Keep editable source files beside the art sources.

Isometric does not require modeled 3D assets. Validate tile edges, object anchors, occlusion, and elevation with a small sample before drawing hundreds of sprites. Camera rotation and extra directions are later scope unless requested.

## Tools worth considering

| Option | Role | Why it fits | Tradeoff |
| --- | --- | --- | --- |
| [Pixelorama](https://orama-interactive.itch.io/pixelorama) | Recommended first pixel editor | Free/name-your-own-price desktop download; the Linux 64-bit archive currently lists about 29 MB; sprite, tile, and animation tools | Requires one application download; choose a fixed official release |
| [LibreSprite](https://github.com/LibreSprite/LibreSprite) | Alternative pixel editor | Free open-source animation and sprite editor, descended from the earlier GPL Aseprite code | Compare the available package for the target system; this research did not verify a download size |
| An editor already owned | Manual pixel cleanup and animation | Avoid acquiring another tool if the existing one exports the needed formats | Confirm its tile/sprite workflow before committing |
| Small project-owned local scripts | Palette checks, atlas assembly, simple placeholder shapes, manifest generation | Can use Python already available here; basic SVG/PPM output needs no third-party packages | These do not replace an artist or a full interactive editor; PNG processing may need a deliberately chosen library/tool |

Pixelorama's project supports desktop platforms and lists its source under MIT. [Official repository](https://github.com/Orama-Interactive/Pixelorama)

No cloud graphics service is required for this workflow. AI image generation is optional; it is not a prerequisite for producing game-ready sprites.

The initial command-line check found Python 3, but none of the listed graphics editors or Godot on PATH. Pixelorama has since been installed as documented below. This check does not establish what else is installed on the user's desktop or in Steam.

## Local Pixelorama installation

- Version: **1.2.3-stable**, reported by the installed application.
- Architecture: x86_64, matching `uname -m` on this machine.
- Input: user-downloaded `~/Downloads/Pixelorama-Linux-64bit.tar.gz`.
- Archive SHA-256: `e7bb3b5f485e3a67f06b15a2c8414a8a7c18b7c6d2cf73f6b3b5904d86821e4b`. Recorded locally for identity/change tracking; not checked against an upstream signature or checksum.
- Installation: `~/.local/opt/pixelorama/Pixelorama-Linux-64bit/`.
- Command: `~/.local/bin/pixelorama`.
- Application-menu entry: `~/.local/share/applications/pixelorama.desktop`.
- Startup log: `~/.local/state/pixelorama/launch.log`.

Archive members were checked for unexpected paths and member types before extraction. No package manager, additional downloads, or administrator access were needed. Headless startup exited successfully; the X11 desktop window was found and the desktop entry passed validation. The graphics driver emitted a V-Sync configuration warning but the window opened. This build rejects the Godot `--path` override; the launcher changes to the installation directory instead.

## Free starter assets

[Kenney's Space Shooter Extension](https://kenney.nl/assets/space-shooter-extension) is a CC0 space asset pack worth inspecting for strategic-map ship art and effects. [Kenney's Space Kit](https://kenney.nl/assets/space-kit) is a CC0 3D collection and is more relevant if a 3D direction is selected. Neither is assumed to supply a complete, stylistically consistent colony tileset.

Kenney states that its asset-page downloads are CC0 and usable in commercial projects without required attribution. Preserve the included license and source anyway so the project retains a clear asset history. [Kenney's usage guidance](https://kenney.nl/support)

Download only a specific pack when it fills a known gap. Choose an art direction before buying starter bundles: mismatched perspective, tile size, lighting, or animation can cost more adaptation work than drawing simple originals.

## Starter sprite budget

This proposed first-colony-and-orbit budget is 112 drawn tiles/frames. It is not the final game's sprite count and is not a count of implemented assets. The families deliberately include visual states needed for the first playable loop.

| Family | Initial tile/frame budget | Contents |
| --- | ---: | --- |
| Terrain | 24 | 16 connected rock-wall variants; rough floor, finished floor, regolith, ice, rubble, ore overlay, hidden tile, open space |
| Structures | 16 | 4 hull pieces, 4 door/airlock states, 3 stair directions, hatch open/closed, window, build ghost, damaged panel |
| Crew | 16 | 4 directional base poses, 4 suited poses, 4 working poses, 4 helmet/tool/status overlay frames |
| Furniture and cargo | 12 | Bunk, table, chair, locker, crate, tank, food, water, ore, ingot, tool, waste |
| Machines | 12 | Generator, battery, scrubber, oxygen unit, grow bed, workbench; idle and active for each |
| Effects and commands | 8 | Selection, dig, build, haul, breach, low oxygen, power fault, injury |
| Strategic map | 8 | Star, rocky planet, ice planet, gas giant, asteroid, settlement, shuttle, trade ship |
| Orbital discoveries | 16 | Wreck intact/open, 2 salvage pieces, 2 comet views, 2 debris patches, collector idle/active/retracted/damaged, transit marker, dock, radiation warning, heat warning |
| **Total** | **112** | Starter budget only |

Use tint/overlay states for additional warnings where readable. Directional walking animation, full hull connectivity, multiple species, machine damage, liquid edges, growth cycles, and richer terrain transitions expand this budget later. The crew frames above assume layered static movement poses, not complete walk cycles.

## Full art inventory families

- Universe: stars, planet types, moons, belts, ships, stations, settlements, routes, faction markers, and selection states.
- Orbital opportunities: satellite parts, derelict modules, comet ice/rock, debris, collectors, radiators, warning fields, and timed encounter markers.
- Ground and underground: biomes, strata, deposits, cavern surfaces, slopes, transitions, liquids, vegetation, ruins, and unexplored areas.
- Construction: connections and corners; doors, hatches, stairs, bridges, windows, grates, pipes, cables, unfinished pieces, and damage states.
- Rooms and industry: furniture, every workshop, utility equipment, input/output goods, inactive/active/broken states, and storage.
- Life: species bodies, age/size differences, clothing, equipment layers, animation, injury, death, pets, livestock, wildlife, pests, and monsters.
- Conflict and disasters: projectiles, impacts, traps, fire, smoke, flooding, contamination, breaches, and emergency signs.
- Interface: commands, cursors, selection, alerts, overlays, portraits, faction marks, inventory symbols, and navigation.
- Supporting media: font, UI sounds, machinery, ambient loops, alerts, and music, each with recorded source and license.

An asset entry should record ID, category, dimensions, anchor, orientation, animation timing, state, palette, source path, license, and which system uses it. Track placeholder/draft/reviewed status separately from code implementation.

## Local workflow and dependency boundaries

The user's preference is local operation with few external calls and a small dependency surface.

1. Use a single chosen editor release obtained from its official distribution. Record version and origin; verify an upstream signature or checksum when one is actually provided. A locally recorded hash only detects later changes, not publisher identity.
2. Treat third-party art packs as input data. Inspect archive contents; import needed images/models/audio and license text. Do not execute bundled installers, scripts, engine plugins, or demo projects merely to obtain their art.
3. Save source files, exported assets, manifests, and license records in the project so ordinary editing and builds operate locally.
4. Keep game runtime assets local. Avoid runtime downloads, CDN fonts, remote texture URLs, and automatic asset fetches.
5. Prefer project-owned scripts using existing tools. If a library becomes necessary, select and pin it deliberately, including transitive dependencies and lockfiles where applicable.
6. Keep dependency/tool updates deliberate and reviewable. Local operation reduces network dependence; it does not by itself prove a tool is trustworthy.

Suggested directories when art production begins:

```text
assets/source/       editable original art
assets/sprites/      exported PNG sheets
assets/manifests/    stable IDs, regions, anchors, animations
assets/audio/        local sound and music
assets/licenses/     license text and origin records
tools/               small reviewed asset utilities
```

First production step: create a small isometric sample containing a ground diamond, hull wall, suited crew member, bulkhead, bunk, scrubber, satellite wreck piece, and solar collector at the intended game scale. Check readability and occlusion before expanding the tileset against the conversion inventory.
