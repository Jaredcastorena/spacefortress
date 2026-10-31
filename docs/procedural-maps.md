# Procedural maps and satellite survey

This is local development after v0.1.12. The package remains 0.1.12; colony save77, region3 and observation/recording11 describe separate formats. The independent elements laboratory is unchanged.

## Larger physical maps

New colonies retain three planets and eight sites. The home map is 48 × 48 hex tiles; every remote site is 32 × 32. Existing habitat, landing structures, crew and finite starting stores are preserved inside the enlarged maps. New terrain connects usable areas without overwriting owned structures or supplies. Regions1/2 retain their earlier generator paths and loaded physical maps.

A private deterministic generator derives a 24 × 12 sector catalog for each planet. Surface terrain and sector surveys share that generator. Reading a survey does not advance simulation RNG or create crew, jobs, sites or inventory.

Five biome types provide actual local conditions:

| Biome | Generated features |
| --- | --- |
| Lichen plain | Native lichen patches and grazing habitat |
| Fungal grove | Lichen and edible fungalcap patches |
| Sunberry scrub | Lichen and sunberry patches |
| Ice barrens | Finite ice seams, exposed ore and colder exterior conditions |
| Water basin | Finite surface pools with natural retaining depth |

Generated bristlebacks and glazefeet populate bounded new ground locations and use the existing animal systems. Existing tibble pests retain their earlier spawning and biomass-feeding rules. Plants retain native biomass/harvest state and respond to existing growth, grazing and collection mechanics. Ore and ice require the existing physical extraction jobs; mining depletes their terrain/reserves.

Remote destinations retain their existing vacuum, suit and settlement rules. A biome or pool does not make a remote exterior breathable.

## Finite water and local temperature

New-map construction initializes each generated pool once and records its water in the site's liquid ledger. Basin ground retains up to its defined depth; excess water uses ordinary finite flow and loss rules. Pumps can remove that water, and an emptied basin does not refill from its biome. Covering ground with a floor removes natural retention without manufacturing or deleting water.

Ground temperature offsets range from −25 to +25°C relative to the site's exterior cycle. They affect exposed crew, plants and actual exterior room-boundary heat transfer. Indoor readings still come from room heat. Legacy and upper-floor tiles without natural metadata retain their previous behavior.

Water temperature, freezing/melting, heat carried by gas and pipe temperature remain unfinished. The generated temperature envelope is a survey description, not a guarantee of safe habitation.

## Launch a survey satellite

Inspect the home shuttle and expand **Survey satellite**, then select **Assemble & launch satellite**. A settled dock can launch for its own planet when a living resident is physically present. The shared order needs:

| Input | Amount |
| --- | ---: |
| Alloy | 6 |
| Components | 2 |
| Recovered power cell | 1 |
| Fuel | 2 |
| Engineering work | 16 |

Supplies must be reachable in actual local storage or loose piles. The order reserves them, crew carry them to the launch structure, and engineers finish the work. Colony stock summaries cannot pay for missing physical materials. A fresh colony receives no free satellite or extra starting cell.

The structure must be on the ground deck, have at least 50% condition, be free of fire and have no competing work. The home shuttle must be available; a dock cannot launch while its local shuttle is departing or in flight. One pending or completed satellite is allowed per planet.

Only completed supplied work records the launch and unlocks the survey. Cancellation returns reserved/delivered material through normal custody; parcels already carried remain with their carrier for ordinary hauling. Changed launch conditions are checked again before consumption. Existing expedition rules prevent the home shuttle leaving during satellite work.

## Use the planetary atlas

Open **Regions**, choose **Planet map** under the desired planet, then open **Colony** and expand **Surface survey**. The launch inspector also provides **View planet surface survey**. Before launch, this section shows the satellite requirement. After launch, select a hex sector or use the arrow keys while the sector map has focus. The pale dot marks the known landing.

The known landing displays live ground-map ore/ice reserves, liquid water, plant patches, living animals and current temperatures. Its readings follow extraction, water movement and population changes; stored inventories are excluded. The **Open … map** button returns to that existing physical site.

Other sectors show initial 48 × 48 surface surveys generated from the same terrain rules. Their biomes, resources, plants and predicted life come from the generator. Inspecting them alone creates no physical map or inventory. Expand the selected sector’s Expedition section to prepare a supplied first landing; [sector travel](sector-travel.md) describes its kit, saved map and local settlement rules. The system/orbital destination view remains available separately.

Drag or use arrow keys to pan a local map, use the mouse wheel to zoom, and press **Home** to return to the colony. Zooming out reveals the enlarged footprint; the renderer skips offscreen tile work.

## Saves and shared commands

Save76 preserves validated older hex colonies without regenerating their maps, adding natural water or creating satellite records. Region1/2 colonies can launch a paid satellite too: the known landing remains their live old map, while other sectors use a detached derived survey. Viewing that survey does not rewrite the old region catalog. Browser import and save admission share a 16,000,000-byte limit.

The optional `satellites` registry stores each planet's `launchedAt`, actual `site` and `{x,y,z}` launch position. Absence means locked. Saves retain pending jobs through existing material/source/worker fields; atlas selection and preview caches remain outside the save.

Players and agents use `satellite.launch {site,x,y,z?}` or `job.order` with `kind: "launchSatellite"`. Observation10 includes stable planet entities and detached survey metadata. `satellite.launched` identifies the actor, paid job, physical target, material owner and unlock transition. See the [structured interface](simulation-interface.md).

## Verification scope

[Generation](../tests/world-generation.test.js), [environment](../tests/procedural-environment.test.js), [map/save](../tests/procedural-maps.test.js), [satellite](../tests/satellites.test.js), [staffed launch](../tests/satellite-integration.test.js) and [atlas](../tests/planetary-atlas.test.js) checks cover the corresponding mechanics. The staffed launch fixture supplies one explicitly synthetic recovered cell, then uses shared orders and actual carrying/work; it covers finite spending, cancellation, saved continuation and recordings. It does not establish the complete fresh-colony cell-acquisition chain or ordinary endurance.

Supplied new-sector travel and local construction are implemented. Remote-to-remote travel, broader history/discovery and sustained habitation remain future work. The [verification status](verification-status.md) retains broader acceptance results and their limits.
