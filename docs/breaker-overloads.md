# Routed power and breaker overloads

Implemented locally after v0.1.12. Colony schema73; observation/recording9 unchanged. Disposable fuses remain future work.

## Configure and recover

Build a Branch breaker on habitat floor without a cable overlay. Its two opposite hex terminals join the networks on either side when closed. Construction still costs four alloy, one component and eight work. Open the contact before changing direction, mode or rating; opening and reconfiguring a closed contact in the same request is rejected.

Modes are Manual, Wet fault, Overload, and Wet fault + overload. Overload modes default to 8 kW unless a rating is already configured. Choose 4/8/16/32 kW in the collapsed flow details. Condition scales the threshold: an 8 kW breaker at 50% condition protects at 4 kW. Ordinary cables retain their existing ideal, unlimited capacity.

Three consecutive simulation ticks above the effective rating latch the contact open. A tick at or below the rating resets the count. Unserved demand does not count. Opening, reconfiguring or resetting clears the pending count. A trip preserves the requested switch setting and its cause. Reduce the load or change the open contact’s rating, reset the trip, then close it. Repair preserves a trip latch. A parallel route or downstream battery can still energize the branch.

Combined mode also uses the existing immediate supplied-wet-fault rule. Wet-fault detection requires an isolatable output branch; an external bypass prevents that branch rule. Overload measurement still applies to actual flow through a contact with a bypass.

## What the measurement means

Existing allocation first decides which faults and whole device loads receive power, how much banks charge or discharge, and how much generation is curtailed. Routing spends those finite source budgets on accepted sinks. Same-node supply and demand cancel first. Remaining sinks use the existing fault, consumer and charging-bank order; sources retain generator order followed by discharging banks.

Shortest physical paths use stable neighbor ties: floor, y, x, terminal input/output/ordinary, then vertex ID. Opposing transfers cancel on a contact; its overload measurement is absolute net flow. Charging and backfeed both count. Upper power risers participate through their actual endpoints. Curtailed generation has no route.

This is a deterministic transport model, not a voltage/resistance solver. A parallel branch can carry different flow after a contact trips. The route rule is part of simulation determinism and has loop fixtures.

Before committing a power tick, all contacts use one counter snapshot. Due trips open together and allocation/routing is recalculated until no further contacts are due. Each pass can only open contacts. Remaining counters advance once from the final plan. Battery transfers, reactor fuel/heat and wet-fault effects commit once from that plan. The trip event reports attempted flow; a tripped contact’s final delivered flow is zero.

The inspector separates planned flow from last delivered flow and its tick. Refreshing controls, observations or save validation cannot advance counters, trip a breaker or consume energy. Existing wet-fault status messages remain unchanged.

## Persistence and local agents

Untouched older breakers retain their original six-field protection record. Configuring a rating or overload mode adds `overload: {rating,ticks,lastThroughput,lastTick}`. Current validation requires an allowed rating, a bounded counter, finite flow and a past measurement tick; older schemas reject these fields and modes. A genuine schema72 save with a paid breaker and pending recruitment changes only version on migration.

`power.breaker` accepts optional `rating` and `z`; player and local-agent controls use identical validation. Existing reset and trip event IDs remain stable. `power.breaker.overload.changed` identifies counter transitions; overload trips add attempted throughput and effective rating. `derived.electrical` exposes the same diagnostics as the panel.

## Bounded evidence and remaining scope

[Routing checks](../tests/power-routing.test.js), [controls](../tests/breaker-overload-controls.test.js), and [integration checks](../tests/breaker-overloads.test.js) cover finite transfers, local cancellation, loop ties, reverse charging/backfeed, absent supply, damage, counter reset, simultaneous/cascaded trips, upper risers, final-only fuel/fault effects and save validation.

The native construction check pays for a breaker and two workstations from original supplies, observes the 5 kW branch trip after three ticks while original life support stays powered, reloads during the delay, and restarts at 3 kW after one load is disabled. It grants no resources, movement, repairs or healing. Broader colony endurance, disposable fuses, resistive cable heating, arcs, ground-fault sensors and automatic load shedding remain future work.
