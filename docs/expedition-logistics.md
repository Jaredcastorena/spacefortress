# Expedition cargo and shuttle fittings

Implemented locally on September 16, 2026. These systems extend upward/outward progression through finite salvage hauling, supplied loading and physical boarding. Explicit crew selection and the [complete colony-return loop](orbital-colony-loop.md) are verified in tests and the browser; see [verification status](verification-status.md). Propulsion and world generation remain incomplete.

## Cargo has a location

Mining a satellite or comet deposit creates a loose pile on that tile. Solar collectors produce charged cells at their platform. Neither operation puts cargo directly in the shuttle.

Expedition crew with hauling enabled reserve a pickup, walk to the pile, carry up to six units and walk to the dock. Only delivery at the dock adds cargo to the hold. The hold has finite capacity; loaded material, carried shipments and pending pickups share that limit. Each pile can have one pickup claimant. Failed or blocked routes do not transfer cargo remotely.

The destination inspector exposes cargo types to collect, loaded contents, capacity and reserved space, plus loose material remaining on site. Disabling a cargo type releases uncollected reservations for reconsideration; already carried shipments still go to the shuttle. Pickup choice favors nearby reachable piles, with the configured type order determining which resources fit into each shipment. Fine-grained hauling priorities and individual stack selection remain future work.

Uncollected piles persist between visits, including comet visits in this fixed-site prototype. A deceased carrier drops cargo at their location and releases capacity. Dead crew remain at the remote site; surviving crew can return. Body recovery is not implemented.

## Returning to the shuttle

Recall cancels field work and uncollected pickups, then enters a **boarding** phase. Crew physically walk to the dock and deliver held cargo. Transit starts after every surviving team member is there. Suits still consume gas during the walk; transit breathing remains abstract. Cargo already aboard remains aboard.

Blocked return routes keep crew on site with a visible activity message. **Resume field work** cancels boarding so the player can designate route clearance, then recall again. Automatic safety recall still applies. Work orders cannot be assigned while boarding. Existing doors can also be controlled from their tile inspector.

Comet automatic recall includes the longest current return walk, fitted transit time and a five-second margin. This does not guarantee rescue if a route later becomes blocked. An outbound expedition can turn back immediately under the existing abstract transit model; it spends the reserved return-leg fuel without paying another full sortie cost.

After landing, the hold becomes a loose pile at the surface shuttle. Colony haulers can deliver it to a depot for ordinary industrial inputs. Construction can also reserve accessible loose supplies directly, but its worker must still collect and deliver them; landing does not finish an upgrade. Returning components unlocks fitting designs and Helios Reach, while physical parts are still delivered and consumed in upgrades.

## Fitting choices

Inspect the surface shuttle to queue an engineering refit. One fitting is installed at a time; replacement consumes the new fitting's materials. Refits use existing reserved-supply delivery and engineering labor. Capability changes only on completion. Flights are blocked while a refit is pending and if shuttle condition is below 50. Cancellation preserves the installed fitting and returns unconsumed supplies normally.

| Fitting | Cargo capacity | Fuel per sortie | Time each way | Exposure injury | Installation cost |
| --- | --- | --- | --- | --- | --- |
| Standard hold | 18 | Route baseline | Route baseline | Full | 1 alloy to restore stock configuration |
| Expanded cargo racks | 36 | Baseline + 1 | Baseline + 6 seconds | Full | 8 alloy, 3 components |
| Storm shelter | 12 | Baseline + 1 | Route baseline | 25% | 8 alloy, 4 components |
| Transfer drive | 18 | Baseline − 1, minimum 1 | Baseline − 6 seconds | Full | 6 alloy, 5 components |

One cargo unit currently means one unit of any resource; mass, volume and containers are not modeled. These are the implemented balance values.

The installed fit is recorded for each sortie. Debris and solar injuries apply to exposed crew during field work and boarding, with the shelter's multiplier. Crew standing at the dock are sheltered from those periodic injuries. Wreck debris passes and solar squalls remain stylized periodic hazards; ship damage, terrain cover and radiation dose are not yet detailed simulations.

## State and saves

`src/expedition.js` owns cargo reservations, remote hauling, boarding movement, route modifiers, cargo policy and fitting validation. `src/expedition-panels.js` exposes them inside the existing hidden inspector. The ordinary construction system supplies refit jobs, and `src/simulation.js` coordinates mission phases and hazards.

Schema 8 introduced finite cargo and fitting state; the historical checkpoint below used schema 16. Schema-7 colonies receive the standard fitting and default cargo policy. Existing in-flight cargo is preserved even if it exceeds the new 18-unit standard limit: that mission retains exactly enough grandfathered capacity for its existing load and cannot collect more. Subsequent sorties use the normal fitting capacity. Pickup intentions, held cargo, boarding routes, remote piles, refit deliveries and mission capabilities persist across reloads. Validation rejects overfilled holds, invalid pickups, duplicate claims, invalid fits and incompatible mission state. The current explicit-selection feature stays on schema 36 and reuses the two-person arrays already stored in departure/mission state.

## Evidence and unfinished work

The historical checkpoint passed **252 tests**, including 15 expedition cases covering extraction-to-dock hauling, concurrent capacity claims, cargo selection, boarding, blocked-route clearance, later recovery of abandoned piles, carrier death, physically supplied refits, cancellation, fuel/time/capacity tradeoffs, exposure protection, solar-cell hauling, deterministic saves and legacy cargo preservation. One case followed satellite extraction through surface hauling into a completed cargo-rack refit. Current normal-journey acceptance must be established separately against the current simulation.

JavaScript syntax and documentation-link checks passed at that original checkpoint, without browser verification of its fitting/cargo/boarding UI. Current full-journey, explicit-selection and browser evidence is verified in [verification status](verification-status.md); the historical count above is not the current release count.

Departure supplies now use crew loading and persistent ship stores, with physical boarding and readiness checks; see [departure preparation](departure-preparation.md). Explicit selection of the two crew is implemented and verified. Detailed propulsion, general rescue missions, dedicated orbital haulers, ship hull damage, containers, staffed outposts, new salvage-derived production recipes, generated destinations and local vertical construction remain unfinished. There is still one active mission/departure and no persistent remote colony staffing. Keep the complete conversion inventory in scope.

## Ice cargo

Comet seams and volatile deposits now produce raw ice, which follows the same hold, hauling and return rules. Water is produced on the surface by a staffed ice processor. See [water supply](water-supply.md) for finite reserves and migration details.
