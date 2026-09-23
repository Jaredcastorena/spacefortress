# Room purposes and colony behavior

Implemented September 16, 2026. Designations use the actual atmosphere compartments; they do not create walls, supplies or room furnishings.

## Designating a compartment

Inspect a habitat floor or furnishing and choose **General use**, **Living quarters**, **Infirmary**, **Greenhouse**, or **Waste storage** in the hidden Room purpose section. The selected compartment is lightly shaded and outlined on the map. The inspector shows current occupants, floor area, working furnishings, designation marker coordinates, unmet requirements and effects.

Each non-general designation is stored as one `{x, y, role}` marker in `site.designations`. Applying a purpose replaces markers in that connected compartment and anchors the choice on the selected tile. General use clears its markers. New colonies and migrated saves start with no special designations, so their original mixed-use layout remains usable.

### Walls and identity

- Splitting a compartment leaves the designation on the side containing its marker. Other pieces become general use unless they already contain their own marker.
- Merging matching designations remains compatible; both markers persist and can separate again later.
- Merging different purposes reports a conflict. Room benefits stop until a purpose is selected for the merged space. Existing waste-related delivery and occupancy restrictions remain conservative.
- Covering an anchor with a wall, door or removed floor makes it dormant. Restoring flooring restores its effect. Inspect its location to clear it explicitly.
- Markers are independent of room indices. Rebuilding gas/heat topology never copies or deletes them, and changing a designation never changes inventory, atmosphere or thermal energy.

## Requirements and effects

| Purpose | Requirements for readiness | Behavior |
| --- | --- | --- |
| Living quarters | Working bunk, four floor tiles per working bunk, sealed breathable compartment, 5–35 °C, no industrial machinery or exposed waste | New sleepers prefer ready quarters. Bunk energy recovery rises from 0.85 to 1.05 per tick before ordinary energy drain. |
| Infirmary | Working medical cot, sealed breathable compartment, 5–35 °C, no industrial machinery or exposed waste | New patients prefer ready infirmaries. Treated injury recovery rises from 0.12 to 0.15 per tick. |
| Greenhouse | Working hydroponics, sealed breathable compartment, 10–35 °C, no other industrial machinery or exposed waste | Designated crop machines pause until requirements are met, preserving inputs and progress. |
| Waste storage | Sealed compartment, working cargo depot with waste enabled, no bunks/cots/farms/common tables | New food and medicine deliveries are excluded. Bunks, medical cots, voluntary downtime and crop production cannot operate as those activities here. |
| General use | No specialization requirements | Existing mixed-use furniture, production, recovery and storage rules apply. |

Industrial machinery for this purpose means refineries, fabricators, nutrient recyclers, atmosphere processors, medical synthesizers and hydroponics; greenhouse hydroponics are allowed. Climate units, life support, batteries, sanitary facilities and other support furniture do not count as industrial machinery. A paused industrial machine still occupies an incompatible room. Readiness is recomputed from actual conditions, not saved as a permanent bonus.

An imperfect designated quarters/infirmary keeps ordinary safe bunk/cot behavior but loses preference and improved recovery. Active occupants are not displaced merely because a better room becomes available. Designating waste storage does invalidate conflicting sleeping/cot use; floor sleepers seek a safe living area and medical care is reassigned without the manual-cancellation retry delay. Existing treatment supplies remain physical through reassignment. Emergency air/thermal shelter and rescue retain their existing life-safety behavior.

A greenhouse designation deliberately adds stricter growing requirements than general-use hydroponics. Opening a door or damaging a seal can temporarily remove readiness even while the atmosphere remains breathable. Resolving the fault or clearing contamination permits the same batch to continue. Farms cannot operate anywhere carrying a waste designation, including a conflicting merged compartment.

## Storage and physical hauling

Quarters, infirmaries and greenhouses exclude waste deliveries. Waste rooms exclude food and medicine. These restrictions supplement depot filters, including when a merged room contains conflicting markers. They do not overwrite player filters, delete existing supplies, or make existing stock unusable for meals/jobs.

Haulers physically relocate rejected supplies to an accepting depot with space, including at equal hauling priority. A room change can reroute an already carried shipment. If no destination accepts the shipment, existing handling places it locally. Removing a designation restores the original depot filter behavior. Depot acceptance controls explain that room purpose can further restrict deliveries.

## Persistence and limits

The schema-20 migration adds empty designation arrays to version-19 saves. Current schema is 22; see [housing](housing.md). All existing inventories, jobs, needs, crops, gas and heat are preserved. Saves validate supported roles, integer in-bounds anchors and uniqueness; dormant markers are intentionally valid.

Personal bunk ownership is now implemented; see [housing](housing.md). This does not implement ownership of entire rooms, capacity limits on occupants, reservations of entire rooms, arbitrary painted zones, custom room names, sound propagation through doors, room-specific staff permissions, vertical floors or contamination transport through doors. Room readiness retains its floor-area-per-bunk requirement. [Room comfort](room-comfort.md) separately accounts for furnishings, hum, current occupants, beds and preferences. The inspector separately shows living occupants currently present and assigned residents, including owners who are away.

## Verification

**308 tests pass**, including 14 room cases covering non-mutating designation, split/merge identity, conflicts, dormancy, actual readiness, sleep/cot preference and recovery, crop interruption, physical waste relocation, in-flight rerouting, excluded uses, persistence, migration, invalid markers and medical reassignment. The focused room/medical run passed 31 tests.

Isolated Firefox verified hidden default drawers, purpose controls, ready infirmary and explicit waste-room requirements, saved anchors/purposes, selected compartment rendering and clean reload. The infirmary screenshot was visually inspected; no scoped application runtime errors were reported. Temporary QA processes were stopped. No new packages or external assets were used.

## Next proposed work

Personal bunk assignments, access, displacement, fallback recovery and room-quality memories are now implemented; see [housing](housing.md). Initial personal preferences, privacy, decorations and machine hum now affect [room comfort](room-comfort.md). Portable possessions remain unfinished. Wider world generation, local vertical levels and the full conversion inventory remain outstanding.
