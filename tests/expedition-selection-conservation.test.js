import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, launch, cancelDeparture, recall, step, pathTo, serialize, deserialize } from '../src/simulation.js';
import { add, extract, quantity, totalResources, syncResources } from '../src/inventory.js';
import { foodLots, storeLots, validFoodLots } from '../src/food-lots.js';
import { fetchMaterials } from '../src/construction.js';
import { haul } from '../src/industry.js';
import { refillMix, tryDeparture, spendReturnFuel, validatePreflight } from '../src/preflight.js';
import { routeFuel, routeTime, cargoFree, reservedCargo, haulSalvage, setCargoAccepted, dockAt, validateShuttle } from '../src/expedition.js';
import { SUIT_PER_POINT, gasAmount } from '../src/atmosphere.js';
import { itemOwners } from '../src/item-lots.js';
import { refreshPower } from '../src/power.js';

const close=(actual,expected,label='amount')=>assert.ok(Math.abs(actual-expected)<1e-7,`${label}: ${actual} != ${expected}`);
function fixture() {
  const s=createGame(),site=s.sites.surface,depot=at(site,8,10);
  for(const t of site.tiles) if(t.machine) t.machine.enabled=false;
  for(const c of s.crew) {
    c.energy=100;c.hunger=100;c.oxygen=100;
    c.labors.hauling=false;c.labors.production=false;
  }
  refreshPower(s,site);
  const ids=[s.crew[5].id,s.crew[3].id];
  return {s,site,depot,ids,crew:ids.map(id=>s.crew.find(c=>c.id===id))};
}
function moveToShip(s,items) {
  const moved=extract(at(s.sites.surface,8,10).stock,items);assert.ok(moved);
  add(s.shuttle.supplies,moved);syncResources(s);
}
function putAboard(f,siteId='wreck') {
  assert.ok(launch(f.s,siteId,f.ids).ok);
  assert.deepEqual(f.s.departure.crew,f.ids);assert.equal(f.s.departure.stage,'boarding');
  for(const c of f.crew) {c.x=16;c.y=11;}
}
function lift(f) {tryDeparture(f.s,()=>{});assert.ok(f.s.mission);assert.deepEqual(f.s.mission.crew,f.ids);}
function materialLots(s) {
  const grouped=new Map();
  for(const {inventory} of itemOwners(s)) for(const lot of foodLots(inventory)) {
    const key=JSON.stringify([lot.age,lot.meal||null]);grouped.set(key,(grouped.get(key)||0)+lot.amount);
  }
  return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b));
}
function withPreparedFood(f) {
  const meal={id:`meal-job-${f.s.nextId++}`,maker:f.s.crew[0].id,quality:3,created:0};
  storeLots(f.depot.stock,[{amount:3,age:120,meal},{amount:4,age:80}]);
  assert.ok(validFoodLots(f.depot.stock));return meal;
}
function airborne() {
  const f=fixture();moveToShip(f.s,{fuel:2,food:2,air:10});putAboard(f);lift(f);
  return f;
}

test('loading deficits use only the explicit team suit needs and already loaded stores',()=>{
  const f=fixture(),{s,ids,crew}=f;
  crew[0].oxygen=61;crew[1].oxygen=86;
  s.crew[0].oxygen=51;s.crew[1].oxygen=52;
  moveToShip(s,{fuel:.5,food:.5,air:4});const before=totalResources(s);
  assert.ok(launch(s,'wreck',ids).ok);
  const needed=refillMix(crew),job=s.jobs.find(j=>j.kind==='loadShuttle');
  assert.deepEqual(s.departure.crew,ids);close(needed,53*SUIT_PER_POINT/.21);
  assert.deepEqual(s.departure.target,{fuel:2,food:2,air:Math.ceil(10+needed)});
  assert.deepEqual(job.cost,{fuel:1.5,food:1.5,air:Math.ceil(10+needed)-4});
  assert.deepEqual(totalResources(s),before,'reservations remain real owners rather than expenditure');
  validatePreflight(s);
});

test('explicit crew liftoff spends exactly two rations and their actual refill mixture while preserving remaining food lots',()=>{
  const f=fixture(),{s,site,crew}=f,meal=withPreparedFood(f);
  crew[0].oxygen=61;crew[1].oxygen=86;s.crew[0].oxygen=51;
  moveToShip(s,{fuel:5,food:5,air:50});putAboard(f);
  const before=totalResources(s),mixNeeded=refillMix(crew),suitBefore=s.crew.reduce((n,c)=>n+c.oxygen*SUIT_PER_POINT,0);
  const ventBefore=gasAmount(site.atmosphere.vented),unselected=s.crew[0].oxygen;
  lift(f);const after=totalResources(s);
  close(before.fuel-after.fuel,1);close(before.food-after.food,crew.length);close(before.air-after.air,mixNeeded);
  close(s.shuttle.supplies.fuel,4);close(s.shuttle.supplies.food,3);close(s.mission.returnFuel,1);
  assert.deepEqual(foodLots(s.shuttle.supplies),[{amount:1,age:120,meal},{amount:2,age:80}]);
  assert.ok(crew.every(c=>c.oxygen===100));assert.equal(s.crew[0].oxygen,unselected);
  const suitAfter=s.crew.reduce((n,c)=>n+c.oxygen*SUIT_PER_POINT,0);
  close(suitAfter-suitBefore,mixNeeded*.21);close(gasAmount(site.atmosphere.vented)-ventBefore,mixNeeded*.79);
  close(after.air+suitAfter+gasAmount(site.atmosphere.vented),before.air+suitBefore+ventBefore,'packaged mix becomes only suit oxygen and vented inert');
  validatePreflight(s);validateShuttle(s);
});

test('every fitting pays its finite fuel by flight leg and outbound recall cannot charge the return leg twice',()=>{
  for(const fit of ['standard','cargo','shield','drive']) {
    const f=fixture(),{s}=f;s.shuttle.fit=fit;
    const required=routeFuel(s,'wreck');moveToShip(s,{fuel:required+1,food:2,air:10});putAboard(f);
    const before=totalResources(s).fuel;lift(f);
    close(totalResources(s).fuel,before-required/2,`${fit} outbound`);
    close(s.shuttle.supplies.fuel,required/2+1);close(s.mission.returnFuel,required/2);
    assert.ok(recall(s).ok);close(totalResources(s).fuel,before-required,`${fit} return`);
    close(s.shuttle.supplies.fuel,1);close(s.mission.returnFuel,0);
    assert.equal(recall(s).ok,false);assert.ok(spendReturnFuel(s));
    close(totalResources(s).fuel,before-required,`${fit} no repeated return debit`);
    validatePreflight(s);validateShuttle(s);
  }
});

test('a rejected explicit selection cannot spend or reserve previously loaded stores or food metadata',()=>{
  const f=fixture(),{s}=f;withPreparedFood(f);moveToShip(s,{fuel:2,food:2,air:10});
  const before=structuredClone(s),lots=materialLots(s);
  assert.equal(launch(s,'wreck',[f.ids[0],f.ids[0]]).ok,false);
  assert.deepEqual(s,before);assert.deepEqual(materialLots(s),lots);
  assert.equal(s.jobs.length,0);assert.equal(s.departure,null);
});

test('cancelling partial loading preserves source, staged, carried and loaded owners with exact ration metadata',()=>{
  const f=fixture(),{s,site,depot,ids}=f;withPreparedFood(f);
  moveToShip(s,{fuel:.5,food:.5,air:2});const before=totalResources(s),lots=materialLots(s),aboard=structuredClone(s.shuttle.supplies);
  assert.ok(launch(s,'wreck',ids).ok);const job=s.jobs.find(j=>j.kind==='loadShuttle'),source=job.sources[0];
  // Stage a real portion while another real portion is still reserved. The
  // construction pickup then creates the fourth simultaneous physical owner.
  add(job.materials,extract(source.items,{air:2}));
  const loader=s.crew[0];loader.x=source.x;loader.y=source.y;loader.job=job.id;job.worker=loader.id;
  fetchMaterials(s,loader,job,site,pathTo);
  assert.ok(quantity(loader.carry)>0&&quantity(source.items)>0&&quantity(job.materials)>0);
  assert.deepEqual(totalResources(s),before);assert.deepEqual(materialLots(s),lots);
  const held=structuredClone(loader.carry),staged=structuredClone(job.materials),reserved=structuredClone(source.items),stockBefore=structuredClone(depot.stock);
  assert.ok(cancelDeparture(s).ok);
  assert.equal(s.departure,null);assert.equal(s.jobs.length,0);assert.equal(loader.delivery,null);
  assert.deepEqual(loader.carry,held);assert.deepEqual(s.shuttle.supplies,aboard);
  assert.deepEqual(at(site,16,11).drop,staged);
  for(const resource of ['fuel','food','air'])close(depot.stock[resource]||0,(stockBefore[resource]||0)+(reserved[resource]||0));
  assert.deepEqual(totalResources(s),before);assert.deepEqual(materialLots(s),lots);
  assert.ok(haul(s,loader,site,pathTo));assert.equal(loader.carry,null);
  syncResources(s);assert.deepEqual(totalResources(s),before);assert.deepEqual(materialLots(s),lots);
  assert.deepEqual(deserialize(serialize(s)),s);
});

test('selected-team cargo claims become one carried and delivered inventory without losing food identity or exceeding capacity',()=>{
  const f=airborne(),{s,crew,depot}=f,site=s.sites.wreck,dock=dockAt(site),meal=withPreparedFood(f);
  // A consistent working-phase fixture preserves actual inventory ownership;
  // the full normal travel/extraction/upgrade journey is tested separately.
  s.mission.phase='working';s.mission.remaining=0;site.explored=true;
  for(const c of crew) {c.site=site.id;c.x=dock.x;c.y=dock.y;c.labors.hauling=true;}
  add(s.mission.cargo,extract(depot.stock,{alloy:15}));
  at(site,4,9).drop=extract(depot.stock,{food:4});at(site,5,9).drop=extract(depot.stock,{components:3});syncResources(s);
  const before=totalResources(s),lots=materialLots(s);
  assert.ok(haulSalvage(s,crew[0],site,pathTo));assert.equal(crew[0].intent.type,'salvage');
  close(quantity(s.mission.cargo),15);close(reservedCargo(s),3);close(cargoFree(s),0);
  assert.ok(haulSalvage(s,crew[1],site,pathTo));assert.equal(crew[1].intent,null);
  assert.deepEqual(totalResources(s),before);assert.deepEqual(materialLots(s),lots);
  for(let i=0;i<10&&!crew[0].carry;i++)haulSalvage(s,crew[0],site,pathTo);
  assert.ok(crew[0].carry);close(crew[0].carry.food,3);
  assert.deepEqual(foodLots(crew[0].carry),[{amount:3,age:120,meal}]);
  close(at(site,4,9).drop.food,1);close(reservedCargo(s),3);close(cargoFree(s),0);
  assert.ok(setCargoAccepted(s,'food',false).ok,'policy changes do not discard a held shipment');
  for(let i=0;i<10&&crew[0].carry;i++)haulSalvage(s,crew[0],site,pathTo);
  assert.equal(crew[0].carry,null);close(quantity(s.mission.cargo),18);close(reservedCargo(s),0);close(cargoFree(s),0);
  assert.deepEqual(foodLots(s.mission.cargo),[{amount:3,age:120,meal}]);
  close(at(site,5,9).drop.components,3);assert.deepEqual(totalResources(s),before);assert.deepEqual(materialLots(s),lots);
  validateShuttle(s);validatePreflight(s);
});

test('return landing transfers the loaded hold once into the actual shuttle pile while preserving loaded service stores',()=>{
  const f=airborne(),{s,crew,depot}=f,site=s.sites.wreck,dock=dockAt(site);
  s.mission.phase='working';s.mission.remaining=0;site.explored=true;
  for(const c of crew) {c.site=site.id;c.x=dock.x;c.y=dock.y;}
  const cargo=extract(depot.stock,{alloy:7,components:2});add(s.mission.cargo,cargo);syncResources(s);
  const before=totalResources(s),service=structuredClone(s.shuttle.supplies),returnFuel=s.mission.returnFuel;
  assert.ok(recall(s).ok);assert.equal(s.mission.phase,'boarding');close(totalResources(s).fuel,before.fuel);
  step(s);assert.equal(s.mission.phase,'returning');close(totalResources(s).fuel,before.fuel-returnFuel);
  close(totalResources(s).alloy,before.alloy);close(totalResources(s).components,before.components);
  const duration=routeTime(s,'wreck');step(s,duration);
  assert.equal(s.mission,null);assert.deepEqual(at(s.sites.surface,16,11).drop,cargo);
  close(totalResources(s).fuel,before.fuel-returnFuel);close(totalResources(s).alloy,before.alloy);close(totalResources(s).components,before.components);
  const expectedService=structuredClone(service);extract(expectedService,{fuel:returnFuel});
  assert.deepEqual(s.shuttle.supplies,expectedService);
  const returned=s.stats.returned;step(s);assert.equal(s.stats.returned,returned);assert.deepEqual(at(s.sites.surface,16,11).drop,cargo);
});
