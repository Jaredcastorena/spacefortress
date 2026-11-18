# Freezing and thawing

Condensed water now freezes and thaws through finite energy exchange. Ice stays in its floor tile, pipe or reservoir. It occupies storage space but cannot flow, leak, enter pumps, irrigate plants, quench fire or cause a wet-cable fault. Mixed ice and water can supply only the liquid portion. Heat from the actual room or local exterior can thaw that stock and restore those interactions. Valves isolate flow, not thermal contact.

In a rigid pipe, an ice unit occupies 1.09 units of volume. A two-unit pipe can hold about 1.83 units of fully frozen water. The plumbing inspector shows the stored mass and the percentage of physical volume filled. Pump deliveries, intakes and passive connections use the available volume at the receiving end.

On each plumbing update, open connections move liquid first. If the contents still exceed the pipe's volume, it ruptures and its condition drops to zero. Closing the valve isolates flow but does not relieve expansion. The damaged pipe leaks any available liquid to its own floor or a neighboring floor on the same deck. Solid ice stays in the pipe and can leak as it thaws. Reservoirs have expansion space above their rated capacity. Floor pools keep their existing depth model.

A rupture emits `plumbing.pipe_burst` once with the tile ID, ice quantity, occupied volume, capacity and previous condition. Existing incident history records water damage to the pipe. Restoring a burst pipe uses the usual repair job. A crew should first leave room for the contents to expand again.

The existing `liquid` tile field and `water` node field retain their historical names and now explicitly mean **total condensed water**, including ice. A single energy value determines the liquid and ice fractions. There is no duplicate saved ice counter to get out of balance. Inventories and physical water ledgers continue counting that total; capacity checks include both phases. Frozen water also occupies a natural basin's retained depth. Geological ice deposits remain a separate extraction resource.

Liquid water keeps the existing energy reference: one unit has energy equal to its kelvin temperature. At 0°C, melting one unit requires 80 game energy units. The mixture stays at 0°C throughout that interval. Ice uses a positive sensible capacity of `(273.15 − 80) / 273.15`; this makes the model continuous down to zero kelvin without changing old stored energy. These are game-scale balancing constants.

Thermal contacts solve the finite pair's equilibrium through the melting interval before applying the existing contact rate. Internal energy transfers cancel; neither water nor its room overshoots the equilibrium. Liquid leaving slush carries its own liquid enthalpy and leaves the ice behind. Mixing hot liquid with ice can melt it; adding liquid to sufficiently cold ice can freeze part of the incoming supply. These changes conserve total mass and energy.

Dismantling recovers all retained condensed water, including ice, into the existing abstract packaged-water resource. Its actual energy leaves the thermal ledger at that boundary; dismantling does not heat the room or melt the contents. Packaged supplies still enter the modeled domain at 20°C. Cargo temperatures and phase histories are future work, so packaging is not a thermally closed process.

The map shows icy water with a pale surface and cracks. Existing floor and plumbing inspectors show total contents, liquid, ice and temperature. Frozen intakes distinguish unavailable frozen stock from an empty source. Live satellite surveys distinguish surface liquid and frozen water; unvisited surveys label their water estimate as potential supply.

Save80 preserves schema79's quantities and stored energy exactly. Earlier cold-water temperatures can change when the new phase equilibrium is applied; room and gas temperatures remain unchanged during loading. Earlier saves continue through the existing validated migrations. Phase fractions are reconstructed from saved mass and energy, so repeated save/load does not duplicate water or latent heat.

Observation/recording14 exposes the phase, liquid and ice quantities. Named `water.froze` and `water.thawed` events record actual converted amounts, latent energy, owner and the operation involved, including transitions that occur and reverse during one tick. Existing controls remain shared between players and agents.

Local save81 extends these rules with [vapor, evaporation, condensation and vacuum cooling](water-vapor.md). Sealed water plumbing has no modeled vapor headspace. Ice expansion now affects rigid water pipes. Walking friction, loose ice hauling and thermally tracked packaged cargo are also outside this checkpoint. See [water heat](water-heat.md) for the full ledger boundary and [verification status](verification-status.md) for the bounded evidence.
