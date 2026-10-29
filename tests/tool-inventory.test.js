import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo } from '../src/simulation.js';
import { add, extract, initializeStorage, quantity, totalResources } from '../src/inventory.js';
import { ITEM_RESOURCES, discreteResource, itemResource, validItemLots, takeItemLots, fitAmount, itemOwners } from '../src/item-lots.js';
import { DEFAULT_TOOL_RECIPE } from '../src/tool-data.js';
import { tileAt } from '../src/spatial.js';
import { typedFood, foodOfKind } from '../src/food-lots.js';
import { haul } from '../src/industry.js';
import { freightRequest, reserveFreight, completeFreight } from '../src/freight.js';

const tool = (n, condition = 100, material = 'alloy') => ({ id: `item-${n}`, maker: 'crew-0', kind: 'mining_tool', material, quality: 2, condition, created: 0 });
const keepsake = n => ({ id: `item-${n}`, maker: 'crew-1', style: 'art', quality: 3, created: 0 });
const cargo = (...items) => {
  const result = { _items: items };
  for (const item of items) { const resource = itemResource(item); result[resource] = (result[resource] || 0) + 1; }
  return result;
};
function fixture() {
  const s = createGame(), site = s.sites.surface;
  s.jobs = [];
  for (const tile of site.tiles) {
    if (tile.machine) { tile.machine.enabled = false; tile.machine.input = {}; tile.machine.output = {}; tile.machine.batch = {}; }
    if (tile.stock) tile.stock = {};
    if (tile.imports) tile.imports = {};
    tile.drop = null;
  }
  for (const c of s.crew) { c.intent = null; c.carry = null; c.delivery = null; c.x = 8; c.y = 8; c.labors.hauling = true; }
  const depot = at(site, 8, 10), bench = at(site, 12, 10);
  bench.building = 'toolbench'; bench.hp = 100; delete bench.machine; initializeStorage(bench);
  bench.machine.enabled = false;
  return { s, site, depot, bench, c: s.crew[0] };
}
function finish(s, site, c) {
  for (let i = 0; i < 40 && (c.intent || c.carry); i++) haul(s, c, site, pathTo);
  assert.equal(c.intent, null, 'pickup finishes within forty calls');
  assert.equal(c.carry, null, 'delivery and recovery finish within forty calls');
}
function repairFixture() {
  const f = fixture();
  Object.assign(f.bench.machine, { recipeId: 'repair_pick', enabled: true, input: { alloy: 2 }, order: { mode: 'batches', limit: 1, remaining: 1, priority: 4 } });
  return f;
}

test('discrete item validation distinguishes legacy keepsakes and complete tool records', () => {
  assert.deepEqual(ITEM_RESOURCES, ['keepsakes', 'tools']);
  assert.equal(discreteResource('tools'), true); assert.equal(discreteResource('ore'), false);
  assert.equal(itemResource(keepsake(1)), 'keepsakes'); assert.equal(itemResource(tool(2)), 'tools');
  assert.equal(itemResource({ kind: 'unknown' }), null);
  const mixed = cargo(keepsake(1), tool(2, 37.5, 'composite'));
  assert.equal(validItemLots(mixed, true), true);
  assert.equal(validItemLots({ tools: 1 }), true); assert.equal(validItemLots({ tools: 1 }, true), false);
  for (const change of [{ condition: -1 }, { condition: 101 }, { condition: NaN }, { material: 'stone' }, { kind: 'unknown' }, { quality: 0 }, { style: 'art' }]) {
    assert.equal(validItemLots(cargo({ ...tool(2), ...change }), true), false);
  }
  assert.equal(validItemLots({ keepsakes: 2, _items: mixed._items }, true), false);
  assert.equal(validItemLots(cargo(tool(2), tool(2)), true), false);
  assert.equal(validItemLots({ tools: .5, _items: [tool(2)] }, true), false);
});

test('mixed additions preserve metadata and reject incomplete or duplicate identities atomically', () => {
  const inventory = add({ water: 1 }, cargo(keepsake(1))), source = cargo(tool(2, 23.5, 'composite'));
  add(inventory, source); source._items[0].condition = 0;
  assert.equal(inventory._items.find(item => item.id === 'item-2').condition, 23.5);
  const before = structuredClone(inventory);
  for (const invalid of [{ tools: 1, food: 2 }, { keepsakes: 1, tools: .5, _items: [keepsake(3)] }, cargo(tool(2)), { tools: 0, _items: [tool(4)] }]) {
    assert.throws(() => add(inventory, invalid)); assert.deepEqual(inventory, before);
  }
});

test('mixed extraction selects explicit IDs across both families and preserves typed food', () => {
  const inventory = add(cargo(tool(1), keepsake(2), tool(3, 12, 'composite')), typedFood('curd', 2, 100));
  const moved = extract(inventory, { keepsakes: 1, tools: 1, food: .5, _items: [{ id: 'item-3' }, { id: 'item-2' }] }, { rawOnly: true, foodKinds: { curd: .5 } });
  assert.deepEqual(moved._items.map(item => item.id).sort(), ['item-2', 'item-3']);
  assert.deepEqual(moved._items.find(item => item.id === 'item-3'), tool(3, 12, 'composite'));
  assert.deepEqual(inventory._items, [tool(1)]); assert.equal(inventory.tools, 1); assert.equal(inventory.keepsakes, undefined);
  assert.equal(foodOfKind(moved, 'curd'), .5); assert.equal(foodOfKind(inventory, 'curd'), 1.5);
});

test('failed mixed selections never consume an earlier item family or food', () => {
  const inventory = add(cargo(keepsake(1), tool(2)), typedFood('curd', 1, 100)), before = structuredClone(inventory);
  for (const request of [
    { keepsakes: 1, tools: .5, food: .5 },
    { keepsakes: 1, tools: 1, food: .5, _items: [{ id: 'item-1' }, { id: 'item-99' }] },
    { tools: 1, food: .5, _items: [{ id: 'item-1' }] },
    { keepsakes: 1, tools: 1, _items: [{ id: 'item-2' }, { id: 'item-2' }] },
  ]) { assert.equal(extract(inventory, request), null); assert.deepEqual(inventory, before); }
  assert.equal(extract(inventory, { tools: 1, food: .5 }, { foodKinds: { sunberry: .5 } }), null);
  assert.deepEqual(inventory, before);
});

test('item-lot selection defaults to keepsakes and only removes the requested family', () => {
  const inventory = cargo(tool(1), keepsake(2), tool(3, 0));
  assert.deepEqual(takeItemLots(inventory, 1), [keepsake(2)]);
  const before = structuredClone(inventory);
  assert.equal(takeItemLots(inventory, 1, [{ id: 'item-1' }]), null); assert.deepEqual(inventory, before);
  assert.deepEqual(takeItemLots(inventory, 1, [{ id: 'item-3' }], 'tools'), [tool(3, 0)]);
  assert.deepEqual(inventory._items, [tool(1)]);
  assert.equal(fitAmount('tools', 2, 1.75), 1); assert.equal(fitAmount('keepsakes', 1, .75), 0); assert.equal(fitAmount('ore', 1, .75), .75);
});

test('new tool workshops initialize the default recipe and ordinary output hauling preserves mixed identities', () => {
  const { s, site, depot, bench, c } = fixture(), identities = [tool(1, 100, 'composite'), keepsake(2)];
  assert.equal(bench.machine.recipeId, DEFAULT_TOOL_RECIPE);
  add(bench.machine.output, cargo(...identities));
  haul(s, c, site, pathTo); finish(s, site, c);
  assert.equal(quantity(bench.machine.output), 0); assert.equal(depot.stock.tools, 1); assert.equal(depot.stock.keepsakes, 1);
  assert.deepEqual(depot.stock._items.sort((a, b) => a.id.localeCompare(b.id)), identities);
  assert.equal(totalResources(s).tools, 1);
  assert.equal(itemOwners(s).filter(owner => owner.inventory._items?.some(item => item.id === 'item-1')).length, 1);
});

test('repair hauling claims a worn tool ID and retains it through pickup and input delivery', () => {
  const { s, site, depot, bench, c } = repairFixture(), worn = tool(2, 31.5, 'composite');
  add(depot.stock, cargo(tool(1), worn));
  haul(s, c, site, pathTo);
  assert.deepEqual(c.intent?.items._items, [worn]);
  for (let i = 0; i < 20 && !c.carry; i++) haul(s, c, site, pathTo);
  assert.deepEqual(c.carry?._items, [worn]); assert.deepEqual(depot.stock._items, [tool(1)]);
  finish(s, site, c);
  assert.deepEqual(bench.machine.input._items, [worn]); assert.equal(bench.machine.input.tools, 1); assert.equal(depot.stock.tools, 1);
  assert.equal(totalResources(s).tools, 2);
});

test('intact tools never create a repair pickup claim', () => {
  const { s, site, depot, bench, c } = repairFixture(); add(depot.stock, cargo(tool(1)));
  assert.equal(haul(s, c, site, pathTo), false);
  assert.equal(c.intent, null); assert.equal(c.carry, null); assert.equal(bench.machine.input.tools, undefined);
});

test('a stale repair claim cannot silently substitute another worn tool or accept a restored tool', () => {
  for (const invalidate of [inventory => { inventory._items[1] = tool(3, 12); }, inventory => { inventory._items[1].condition = 100; }]) {
    const { s, site, depot, bench, c } = repairFixture(); add(depot.stock, cargo(tool(1), tool(2, 12)));
    haul(s, c, site, pathTo); assert.equal(c.intent.items._items[0].id, 'item-2');
    invalidate(depot.stock); const before = structuredClone(depot.stock);
    haul(s, c, site, pathTo);
    assert.equal(c.intent, null); assert.equal(c.carry, null); assert.deepEqual(depot.stock, before); assert.equal(bench.machine.input.tools, undefined);
  }
});

test('repair delivery returns an intact carried tool to ordinary storage', () => {
  const { s, site, depot, bench, c } = repairFixture();
  c.carry = cargo(tool(1)); c.delivery = { kind: 'input', target: { x: bench.x, y: bench.y, z: bench.z }, recipeId: 'repair_pick' };
  haul(s, c, site, pathTo); finish(s, site, c);
  assert.equal(bench.machine.input.tools, undefined); assert.deepEqual(depot.stock._items, [tool(1)]);
});

test('freight rejects fractional tools and preserves tool IDs through loading and unloading', () => {
  const s = createGame(), identity = tool(1, 66.5, 'composite');
  assert.equal(freightRequest(s, 'surface', 'loadCargo', { tools: .5 }).code, 'invalid_freight');
  const requested = freightRequest(s, 'surface', 'loadCargo', { tools: 1 }); assert.equal(requested.ok, true);
  const { x, y } = requested.terminal, job = { id: 'job-999', kind: 'loadCargo', site: 'surface', x, y, cost: { tools: 1 }, materials: cargo(identity), sources: [] };
  s.jobs = [job]; assert.equal(completeFreight(s, s.crew[0], job), true); assert.deepEqual(s.shuttle.freight._items, [identity]); assert.equal(quantity(job.materials), 0);
  s.jobs = []; const sources = reserveFreight(s, x, y, { tools: 1 }); assert.deepEqual(sources[0].items._items, [identity]); assert.equal(quantity(s.shuttle.freight), 0);
  const unloading = { ...job, id: 'job-1000', kind: 'unloadCargo', materials: sources[0].items };
  s.jobs = [unloading]; assert.equal(completeFreight(s, s.crew[0], unloading), true);
  assert.deepEqual(at(s.sites.surface, x, y).drop._items, [identity]); assert.equal(quantity(unloading.materials), 0); assert.equal(totalResources(s).tools, 1);
});


function claimedToolFixture(source) {
  const f = source === 'stock' ? repairFixture() : fixture();
  const tile = source === 'stock' ? f.depot : f.bench;
  const inventory = source === 'stock' ? tile.stock : source === 'output' ? tile.machine.output : (tile.drop = {});
  add(inventory, cargo(tool(1, 50)));
  const owner = f.s.crew[1];
  owner.intent = { type: 'equipTool', target: { x: tile.x, y: tile.y, z: tile.z }, source, item: 'item-1' };
  return { ...f, sourceTile: tile, inventory, owner };
}

test('equipment pickup claims protect same-floor stock, drops and output until the claim clears', () => {
  for (const source of ['stock', 'drop', 'output']) {
    const { s, site, depot, bench, c, sourceTile, inventory, owner } = claimedToolFixture(source);
    assert.equal(haul(s, c, site, pathTo), false, `${source} is reserved for equipment pickup`);
    assert.equal(c.intent, null); assert.equal(c.carry, null);
    assert.deepEqual(inventory._items, [tool(1, 50)]);
    owner.intent = null;
    assert.equal(haul(s, c, site, pathTo), true, `${source} becomes haulable when the pickup clears`);
    finish(s, site, c);
    assert.equal(quantity(inventory), 0);
    const delivered = source === 'stock' ? bench.machine.input : depot.stock;
    assert.deepEqual(delivered._items, [tool(1, 50)]);
    assert.equal(itemOwners(s).filter(o => o.inventory._items?.some(item => item.id === 'item-1')).length, 1);
    assert.equal(sourceTile.z, 0);
  }
});

test('equipment pickup claims on a stacked floor leave matching ground buffers independent', () => {
  for (const source of ['stock', 'drop', 'output']) {
    const { s, site, depot, bench, c, sourceTile, inventory, owner } = claimedToolFixture(source);
    // A synthetic isolated upper deck exercises source addressing, not stair travel.
    const upperTiles = site.tiles.map(tile => ({ ...structuredClone(tile), z: 1 }));
    site.levels = [{ z: 0, name: 'Surface' }, { z: 1, name: 'Upper fixture' }];
    site.tiles.push(...upperTiles);
    const upper = tileAt(site, { x: sourceTile.x, y: sourceTile.y, z: 1 });
    const upperInventory = source === 'stock' ? upper.stock : source === 'output' ? upper.machine.output : upper.drop;
    upperInventory._items = [tool(2, 50)];
    owner.z = 1; owner.x = upper.x; owner.y = upper.y;
    owner.intent.target.z = 1; owner.intent.item = 'item-2';
    assert.equal(haul(s, c, site, pathTo), true, `${source} on deck zero is independent of deck one`);
    finish(s, site, c);
    assert.equal(quantity(inventory), 0);
    assert.deepEqual((source === 'stock' ? bench.machine.input : depot.stock)._items, [tool(1, 50)]);
    assert.deepEqual(upperInventory._items, [tool(2, 50)]);
    assert.equal(owner.intent.item, 'item-2'); assert.equal(c.z, 0);
    assert.equal(totalResources(s).tools, 2);
  }
});
