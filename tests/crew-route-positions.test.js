import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, CONFIG, STAGING, command, snapshot } from './helpers/airlock-fixture.js';
import { planCrewRoute, planCrewRoutePositions } from '../src/navigation.js';
import { advanceCrewRoute } from '../src/crew-traversal.js';
import { tileAt } from '../src/spatial.js';
import { serialize, deserialize } from '../src/simulation.js';

const ground = ([x,y]) => ({x,y,z:0});
const pairs = path => path.map(p => [p.x,p.y]);

test('automatic crossing plans retain explicit positions, direction and finite planning cost',()=>{
  const f=fixture(),before=snapshot(f.s);
  for(const [from,to,direction] of [[STAGING.inner,STAGING.outer,'outward'],[STAGING.outer,STAGING.inner,'inward']]) {
    const crew={...f.crew,...ground(from)},route=planCrewRoutePositions(f.s,f.site,crew,[ground(to)]);
    assert.ok(route);assert.equal(route.segments.length,1);
    const crossing=route.segments[0];assert.equal(crossing.kind,'airlock');assert.equal(crossing.direction,direction);
    assert.equal(crossing.controller,'tile:surface:5:5');assert.equal(crossing.binding,f.controller.airlock.binding);
    assert.deepEqual(crossing.destination,ground(to));assert.deepEqual(route.path.at(-1),ground(to));
    assert.ok(route.path.every(p=>p.z===0&&tileAt(f.site,p)));
    assert.equal(route.path.length,5);assert.equal(route.cost,25);
    const legacy=planCrewRoute(f.s,f.site,crew,[to]);
    assert.deepEqual(legacy.path,pairs(route.path));assert.deepEqual(legacy.segments[0].destination,to);
    assert.equal(legacy.cost,route.cost);
  }
  assert.equal(snapshot(f.s),before);assert.equal(f.crew.airlockTraversal,null);
});

test('partial chamber and threshold starts retain the existing remaining route costs',()=>{
  const f=fixture();
  for(const [from,cost] of [[CONFIG.inner,24],[CONFIG.chamber,23],[CONFIG.outer,1],[STAGING.outer,0]]) {
    const route=planCrewRoutePositions(f.s,f.site,{...f.crew,...ground(from)},[ground(STAGING.outer)]);
    assert.ok(route);assert.equal(route.cost,cost);assert.ok(route.path.every(p=>p.z===0));
    if(cost)assert.deepEqual(route.path.at(-1),ground(STAGING.outer));else assert.deepEqual(route.segments,[]);
  }
});

test('manual release plans only ordinary steps through the selected side without requesting a cycle',()=>{
  const f=fixture();assert.equal(command(f,'release',{side:'inner',acceptAtmosphereLoss:true}).ok,true);
  const before=snapshot(f.s),route=planCrewRoutePositions(f.s,f.site,f.crew,[ground(CONFIG.chamber)]);
  assert.ok(route);assert.ok(route.segments.every(s=>s.kind==='walk'));assert.equal(route.cost,route.path.length);
  assert.equal(planCrewRoutePositions(f.s,f.site,f.crew,[ground(STAGING.outer)]),null);
  assert.equal(snapshot(f.s),before);assert.equal(f.crew.airlockTraversal,null);assert.deepEqual(f.controller.airlock.queue,[]);
});

test('ground airlocks cannot cast barriers or crossing edges onto another deck',()=>{
  const f=fixture(),upper=f.site.tiles.map(t=>({x:t.x,y:t.y,z:4,terrain:'ground',building:null,hp:100}));
  const site={...f.site,levels:[{z:4,name:'Upper'},{z:0,name:'Landing'}],tiles:[...upper,...f.site.tiles]};
  const crew={...f.crew,z:4},goal={...ground(CONFIG.inner),z:4};
  const before=snapshot(f.s),route=planCrewRoutePositions(f.s,site,crew,[goal]);
  assert.ok(route);assert.equal(route.cost,1);assert.deepEqual(route.path,[goal]);assert.equal(route.segments[0].kind,'walk');
  assert.equal(planCrewRoutePositions(f.s,site,crew,[ground(CONFIG.inner)]),null);
  assert.equal(planCrewRoute(f.s,site,crew,[CONFIG.inner]),null);
  assert.equal(snapshot(f.s),before);
  // Explicit upper controller schemas are not implemented; do not guess a
  // floor for legacy controller configuration pairs.
  Object.assign(tileAt(site,{x:5,y:5,z:4}),{building:'airlockController',airlock:{binding:'unsupported'}});
  assert.equal(planCrewRoutePositions(f.s,site,crew,[goal]),null);
});

test('plans reject foreign or malformed positions and cannot mutate saved configuration through returned steps',()=>{
  const f=fixture(),before=snapshot(f.s),to=ground(STAGING.outer);
  for(const bad of [null,{},STAGING.outer,{x:to.x,y:to.y},{...to,z:1},{...to,site:'wreck'}]) {
    assert.equal(planCrewRoutePositions(f.s,f.site,f.crew,[bad]),null);
  }
  assert.equal(planCrewRoutePositions(f.s,f.site,{...f.crew,site:'wreck'},[to]),null);
  const route=planCrewRoutePositions(f.s,f.site,f.crew,[to]);
  route.path[0].x=-100;route.segments[0].destination.y=-100;
  assert.equal(snapshot(f.s),before);assert.deepEqual(to,ground(STAGING.outer));
});

test('movement consumes position plans while persisted destinations retain full ground positions',()=>{
  const f=fixture();const result=advanceCrewRoute(f.s,f.crew,f.site,[STAGING.outer]);
  assert.notEqual(result.status,'blocked',result.reason);
  assert.deepEqual(f.crew.airlockTraversal.destination,ground(STAGING.outer));
  const a=f.controller.airlock,party=a.party?.crew===f.crew.id?a.party:a.queue.find(p=>p.crew===f.crew.id);
  assert.deepEqual(party.destination,ground(STAGING.outer));
  const saved=serialize(f.s);assert.equal(serialize(deserialize(saved)),saved);
  const before=snapshot(f.s);
  assert.equal(advanceCrewRoute(f.s,f.crew,f.site,[[...STAGING.outer,1]]).status,'blocked');
  assert.equal(snapshot(f.s),before,'invalid new destinations cannot cancel an existing claim');
});
