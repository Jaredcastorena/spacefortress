# Finite paid gas compression

Version 0.1.14 adds paid compression work to gas
pumps, regulated vents and extractors. Gas pushed against pressure takes
energy from the device's actual electrical allocation. The receiving gas
retains that work as heat, so moving less gas can be necessary as it warms.
This release uses colony save schema 82, region 3 and observation/recording 16.

## Finite work and heat

Each powered drive can spend at most 65% of its paid allocation on useful
compression. The remaining allocation heats the drive's actual room, or is
explicitly exported to space when the drive has no room. The entire paid
allocation is settled once, with no second electrical charge or refund. A
funded but blocked drive produces motor heat even when it moves no gas.
These three devices replace their former generic equipment-heating rule;
other equipment and climate controls retain their existing rules.

A paid operating update allocates three energy units to a pump, two to a vent,
and three to an extractor. Disabled devices receive no fresh allowance.

The planner integrates the positive logarithmic pressure head as the finite
source empties. Its normalized coefficient is one energy unit per gas unit
at 293.15 K and unit logarithmic head. It uses the larger of the initial and
final heated outlet pressures, and solves the parcel amount within the paid
work budget, existing rate/storage limits and any pressure target. Source
temperature, actual gas composition and receiver heat capacity participate in
the calculation. This is a declared game approximation, not an SI compressor
model or an exact isothermal discharge trajectory.
The logarithmic form is informed by the
[MIT isothermal-work derivation](https://web.mit.edu/16.unified/www/FALL/thermodynamics/notes/node12.html);
the game's finite heated transfer uses its own declared approximation.

Useful work stays in the receiving gas; motor heat stays at the drive. A vent
discharges into its own room, so its target calculation includes the entire
paid heat allocation once. Existing room heat can still change pressure after
the transfer; a target is not a promise of constant temperature or pressure.
If motor heat alone reaches the target, the vent adds no gas but still retains
that paid heat. Switch off a drive to stop further paid heating.
Mixed exhaust also includes source motor heat when calculating the withdrawal
needed to reach its room-pressure target. Finite power, flow or storage may
leave the room above target. A paid extractor that starts blocked at its target
still warms the room without moving gas during that update.
Passive equalization, risers, leaks and packaged-gas loading do not acquire
compression work. Smoke remains a capacity-consuming tracer, without gas
pressure or sensible heat. Vapor keeps its mass and latent-energy accounting.

## Payment and persistence

Only a committed electrical update issues a work allowance. It belongs to
that paid update and is claimed once; a power preview or refreshed diagnostic
cannot create or replenish it. Cloning, saving and reloading do not carry
unspent allowances. Ordinary subsequent paid updates can issue new ones.

Each site's cumulative `gasWork` record contains `allocated`, `work`,
`motorRoom` and `motorSpace`. The last three must sum to the allocation;
useful work cannot exceed 65%, and total allocation cannot exceed consumed
electrical energy. `thermal.compression` equals useful work. Room motor heat
is included in `thermal.equipment`; exported motor heat remains explicit in
`motorSpace`. Internal gas transfers retain their existing energy accounting.

Validated older hex saves gain zero compression records without changing
their physical quantities, prior heat, phase histories or RNG. Old schemas
reject disguised compression fields before migration. Schema82 requires the
complete, balanced records and rejects inconsistent state instead of repairing
it. No compression operation or paid allowance is created while loading.

## Observations and verification

Observation/recording16 exposes the site ledger and labels its changes
`gas_compression`. Each settled drive emits `gas.compression.applied` with
the actual device, source/destination, moved gas and smoke, allocation, work,
motor heat and heat recipient, plus work/target limits and any blocking reason.
An exterior recipient is `space:<siteId>`; room and device IDs retain their
floor. The inspector's maximum compression work is a nominal per-update
ceiling, not an unspent allowance or a prediction of delivered flow.

Twenty-three primitive, nineteen integration/migration and five safety cases pass.
Focused safety covers humid exhaust, smoke-only filtering and airlock pressure,
oxygen and temperature admission. Existing material and rate limits remain
in force. Focused follow-ups resolved all 50 failures recorded in the initial full run. These focused results do
not establish ordinary colony endurance or browser performance.
Rigid water pipes also model [ice expansion and rupture](water-phases.md). Packaged-cargo thermal histories remain unfinished.
See [gas heat](gas-heat.md), [water vapor](water-vapor.md) and
[verification status](verification-status.md) for the surrounding boundaries.
