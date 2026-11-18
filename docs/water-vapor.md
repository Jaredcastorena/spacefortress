# Water vapor and retained condensate

Local save81 adds water vapor to room and gas-network mixtures. Exposed liquid
can evaporate into its room; moist gas can condense onto available floor space.
Pipes and gas stores retain their own condensate, including ice, instead of
silently losing it. Observation/recording15 exposes these owners and conversions.
The separate elements laboratory is unchanged.

## Finite mass and energy

Vapor uses the same mass unit as condensed water and contributes to gas
pressure. Oxygen, inert gas and carbon dioxide retain heat capacity 0.2; vapor
uses capacity 1 plus 540 units of latent energy per mass unit. Temperature and
pressure use sensible energy after subtracting that latent offset. Pumps,
vents, leaks, topology changes and airlocks carry each parcel's actual mixture
and full energy. Water vapor never becomes packaged breathing-mix stock.

Each phase contact solves a common-temperature equilibrium for its finite gas
and condensed-water owners, including the ice/melting interval. The nominal
saturation curve is `exp(4890 * (1 / 373.15 - 1 / kelvin))`; it is zero at
absolute zero. A tick applies at most 2% of the equilibrium change and 0.1 water
units per contact. Both owners' masses and energies advance by the same
fraction. These are game-scale units and rates, not an engineering model.

Exterior liquid evaporates into vacuum using its actual available liquid and
energy, with the same rate and mass limits. Escaping vapor exports its full
sensible and latent energy; cooling can leave ice behind. Frozen-only water
does not sublime. Internal phase changes neither create water nor import heat.

## Equipment and boundaries

Retained condensate occupies gas equipment's payload capacity and reduces the
volume available to gas. It cannot flow through gas ports. It exchanges finite
heat with its actual surroundings and can freeze or re-evaporate. Dismantling
releases it onto available same-tile or adjacent floor space on the actual
deck. Inaccessible or excess water and its energy are explicitly exported.

The water-plumbing system remains sealed condensed-water storage with no
modeled vapor headspace. Fire quenching still exports consumed water and heat;
it does not also create vapor. Packaged cargo, suit contents and biological
moisture still have the boundaries described in [water heat](water-heat.md)
and [gas heat](gas-heat.md). Local save82 adds [finite paid compression](gas-compression.md),
including receiver heating and explicit motor heat; vapor still retains its
mass and latent-energy accounting. Rigid water pipes also model [ice expansion and rupture](water-phases.md). Packaged thermal histories remain unfinished.

## Safety, saves and observations

Breathing and airlock admission use oxygen partial pressure. Carbon-dioxide
safety uses the dry-gas fraction, so adding humidity cannot hide contamination.
On-demand inspectors show vapor, humidity and retained liquid/ice temperature.
Relative humidity is unavailable when its ratio is not finite; zero-temperature
readouts never manufacture an infinite or invalid observation.

Schema80 migration adds zero vapor, empty condensate owners and neutral phase
ledgers, preserving every old physical quantity, energy and RNG state. Current
saves require consistent species, nonnegative sensible energy, retained
capacity and balanced water/heat ledgers. Earlier schemas reject disguised new
vapor fields before migration. No phase step runs while loading a save.

Named `water.evaporated` and `water.condensed` events identify stable source and
destination IDs, owner slots, amount, temperature, latent energy and total
contact energy. For internal contacts, the event temperature is the solved
equilibrium target; the observed owners retain their actual intermediate
temperatures. Vacuum events report the source liquid temperature.
`gasHeatChange` retains the signed gas-side energy change.
Existing `water.froze`/`water.thawed` events include gas-node condensate owners.
Readings and events remain observations, not inferred causes or training rewards.
See [verification status](verification-status.md) for the tested scope.
