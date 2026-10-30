import { BUILDINGS } from './data.js';
import { LIQUID } from './liquids.js';
import { powerTileKey } from './power-topology.js';
import { positionOf } from './spatial.js';

const terminalOrder = { input: 0, output: 1 };
const positive = amount => Number.isFinite(amount) && amount > 0;
const consumerOrder = (a, b) => b.powerPriority - a.powerPriority ||
  (b.building === 'scrubber' ? 1 : 0) - (a.building === 'scrubber' ? 1 : 0) || a.y - b.y || a.x - b.x;

// Route only the finite transfers already accepted by the power allocator.
// This is deterministic transport, not a voltage/resistance solver. Local
// cancellation follows sink order; remaining sources and sinks keep the plan's
// allocation order. Unused source capacity is curtailed and has no route.
export function routePower(plan) {
  const { vertices, adjacency } = plan.topology, contacts = new Map(), routes = [];
  const compareVertices = (a, b) => {
    const av = vertices.get(a), bv = vertices.get(b), ap = positionOf(av.tile), bp = positionOf(bv.tile);
    // Stable shortest-path ties: z, y, x, input, output, ordinary, then ID.
    return ap.z - bp.z || ap.y - bp.y || ap.x - bp.x ||
      (terminalOrder[av.terminal] ?? 2) - (terminalOrder[bv.terminal] ?? 2) || (a < b ? -1 : a > b ? 1 : 0);
  };
  const orderedEdges = new Map();
  for (const [id, vertex] of vertices) {
    orderedEdges.set(id, [...(adjacency.get(id) || [])].sort(compareVertices));
    if (vertex.terminal) contacts.set(powerTileKey(vertex.tile), { signed: 0, throughput: 0 });
  }
  const trees = new Map();
  function pathBetween(source, sink) {
    if (source === sink) return [source];
    if (!trees.has(source)) {
      const previous = new Map([[source, null]]), queue = [source];
      for (let i = 0; i < queue.length; i++) for (const next of orderedEdges.get(queue[i]) || []) {
        if (!previous.has(next)) { previous.set(next, queue[i]); queue.push(next); }
      }
      trees.set(source, previous);
    }
    const previous = trees.get(source);
    if (!previous.has(sink)) return null;
    const path = [];
    for (let cursor = sink; cursor !== null; cursor = previous.get(cursor)) path.push(cursor);
    return path.reverse();
  }
  function transfer(source, sink, path) {
    const amount = Math.min(source.remaining, sink.remaining);
    if (!positive(amount)) return;
    source.remaining -= amount; sink.remaining -= amount;
    routes.push({ source: source.id, sink: sink.id, amount, path });
    for (let i = 1; i < path.length; i++) {
      const from = vertices.get(path[i - 1]), to = vertices.get(path[i]);
      if (!from.terminal || !to.terminal || from.terminal === to.terminal) continue;
      const key = powerTileKey(from.tile);
      if (key === powerTileKey(to.tile)) contacts.get(key).signed += from.terminal === 'input' ? amount : -amount;
    }
  }
  for (const network of plan.networks) {
    const sources = [], sinks = [], localSources = new Map();
    const source = (tile, amount) => {
      if (!positive(amount)) return;
      const entry = { id: powerTileKey(tile), remaining: amount };
      sources.push(entry);
      if (!localSources.has(entry.id)) localSources.set(entry.id, []);
      localSources.get(entry.id).push(entry);
    };
    const sink = (tile, amount) => { if (positive(amount)) sinks.push({ id: powerTileKey(tile), remaining: amount }); };
    for (const [tile, amount] of network.sources) source(tile, amount);
    for (const { tile, amount } of network.transfers) if (amount < 0) source(tile, -amount);
    for (const tile of network.activeFaults) sink(tile, LIQUID.faultPower);
    const consumers = network.tiles.filter(tile => plan.powered.has(tile) && BUILDINGS[tile.building]?.demand).sort(consumerOrder);
    for (const tile of consumers) sink(tile, BUILDINGS[tile.building].demand);
    for (const { tile, amount } of network.transfers) if (amount > 0) sink(tile, amount);
    // Preserve local deliveries in the route ledger as one-vertex paths. They
    // consume source capacity without crossing any contact, even if an earlier
    // remote source could otherwise serve this sink.
    for (const load of sinks) for (const supply of localSources.get(load.id) || []) {
      if (supply.remaining > 0 && load.remaining > 0) transfer(supply, load, [load.id]);
    }
    for (const load of sinks) {
      for (const supply of sources) {
        if (load.remaining <= 0) break;
        if (supply.remaining <= 0) continue;
        const path = pathBetween(supply.id, load.id);
        if (path) transfer(supply, load, path);
      }
    }
  }
  // Signed accumulation cancels opposing transfers on the same contact edge.
  // Open, disconnected and unused contacts retain their explicit zero entry.
  for (const contact of contacts.values()) contact.throughput = Math.abs(contact.signed);
  return { contacts, routes };
}
