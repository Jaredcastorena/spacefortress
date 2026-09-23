# Station simulation reference and next steps

Recorded September 16, 2026. The user explicitly requested SS13-style gas, water and electrical systems, modernized for SPACEFORTRESS. Implementation status and the remaining proposed sequence are listed separately.

## Reference projects

- [Space Station 14](https://spacestation14.com/about/about/) is an open-source SS13 remake with its own engine. Its [atmosphere design](https://docs.spacestation14.com/en/space-station-14/departments/atmos.html) emphasizes simple devices combined into larger systems, conserved matter and energy, pressure-driven gas flow, and understandable player feedback. These are useful design principles for this colony game.
- [Unitystation](https://www.unitystation.org/) is another open-source remake, using Unity. Its official site describes tile-held liquid reagents that mix and spread when they accumulate. That is a useful comparison for floor liquids; it does not imply all SS13 descendants share a single water simulation.
- [The /tg/station repository](https://github.com/tgstation/tgstation) still provides an SS13 codebase, development instructions and server links. Treat the remakes as related projects, rather than assuming the original disappeared.
- SS14's [Pow3r document](https://docs.spacestation14.com/en/space-station-14/departments/engineering/pow3r.html) discusses brownouts, power channels and supply response. It contains design discussion and proposed behavior; it is not evidence that every described feature is implemented in the current game.

Research used official web pages only. No external game code, assets, engine, package or installer was imported.

## What SPACEFORTRESS already has

| System | Implemented | Principal missing pieces |
| --- | --- | --- |
| Gas | Conserved room O2/inert/CO2, smoke, door exchange, breaches, supplied life support; physical supply and retained exhaust pipes/tanks/pumps/vents/extractors; cell gas in the separate lab | Waste processing, sensor/controller airlocks, temperature-dependent pressure |
| Water | Delivered tanks, finite plumbing/storage and reserved inventory adapters, leaks, floor flow, doors, powered recovery, fire quenching | Liquid mixtures, water heat, steam, treatment and vertical flow in the colony |
| Electricity | Connected wires, priorities, batteries, solar, reactors, heat, wet faults and two-terminal manual/wet-fault breakers | Rated overloads/fuses, routed current, separated distribution tiers, device-specific partial-power behavior |
| Agent interface | Shared player/agent commands, stable entity IDs, named events, local bounded recording | New devices must extend these existing interfaces |

See [atmosphere](atmosphere.md), [floor water](floor-water.md), [power](power-networks.md), [reactors](reactors.md) and the [elements lab](elements-lab.md) for exact rules and limitations. Colony pressure currently uses gas density relative to nominal, not a temperature-coupled gas law. Fire quenching currently records water as consumed without creating steam.

## Proposed implementation sequence

1. **Initial supply distribution implemented:** see [gas networks](gas-networks.md) and [verification](verification-status.md). Retained exhaust is also implemented; see step2. Original target: constructible pipes, a finite gas tank, isolation valve, powered pump and room vent. Keep breathable supply and collected exhaust on independently connected networks. Each device transfers actual quantities between explicit source and destination ports. Existing rooms remain the colony's ambient gas containers for the first increment.
2. **Retained filtering/exhaust implemented and verified:** a powered extractor transfers CO2 and smoke (filter mode) or proportional room contents (bulk exhaust) into finite pipe/reservoir storage. Full storage and power loss stop extraction. Pressure/composition readings are exposed. Sensors and a controller that cycles an airlock remain later work.
3. **Liquid plumbing implemented and verified:** [rules and controls](plumbing.md) connect finite storage, recovery and consumers while preserving hauling claims. Heat, contamination and treatment remain missing; recovered water retains the existing abstract resource model.
4. **Electrical branch isolation implemented and verified:** [rules](electrical-isolation.md) cover physical two-port breakers, manual isolation and supplied-wet-fault trips with real bypass/backfeed. The [staged design](electrical-isolation-design.md) keeps measured overloads and fuses separate as later work. A plumbing discharge can trip one branch while life support continues. Device-specific behavior under reduced supply also remains future work.

Shared connectivity can serve all three networks, but gas, liquid and power need separate transfer rules. Store contents on persistent physical segments/containers, or explicitly redistribute cached network totals before topology changes; never erase or duplicate contents when a valve closes, a pipe breaks or two networks join. A removed segment must transfer its contents somewhere or record an explicit loss.

Start with deterministic fixed ticks and bounded transfers. Measure performance before adding active-region queues or topology caches. Limit any equalization optimization to genuinely connected volumes; a closed valve remains a boundary. Keep view overlays optional and controls in the existing hidden inspector.

## Acceptance checks for the next increment

- Tank → pump → pipe → vent raises room gas by exactly the amount removed from storage, including in-flight pipe contents and explicitly vented losses.
- Closed valves, broken connections, empty sources, full destinations and power loss produce distinct blocked reasons.
- Splitting/joining networks and save/reload preserve gas mixture and deterministic continuation.
- A breach can drain a connected supply until the player or controller isolates it; the same commands work for a local agent.
- Named transfer/fault/control events contain stable source and destination IDs, amounts and reasons. They supplement typed state deltas without claiming that every observed change is a causal explanation.

This is a manageable sequence of small systems. The substantial work is their interaction, ownership accounting, failure recovery and player feedback; the age of the reference games does not make those parts automatic.
