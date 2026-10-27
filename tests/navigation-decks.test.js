import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToPosition, animalPathToPosition, pathTo, animalPath, planCrewRoute } from '../src/navigation.js';
import { tileAt, horizontalNeighbors } from '../src/spatial.js';
import { createGame, serialize } from '../src/simulation.js';
import { moveCrew } from '../src/atmosphere.js';
import { moveAnimal } from '../src/pastures.js';

// Synthetic routing layout only; saved colonies still allow a single floor.
function map(terrain='ground') {
  const size=7, levels=[4,0,-2].map(z=>({z,name:`Deck ${z}`}));
  return {id:'surface',size,levels,tiles:levels.flatMap(({z})=>Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),z,terrain,building:null,hp:100}))),atmosphere:{tick:0}};
}

test('horizontal routes retain every hex edge and declared deck identity without implicit stairs',()=>{
  const site=map(),before=JSON.stringify(site);
  for(const z of [4,0,-2])for(const x of [2,3]) {
    const from={site:'surface',x,y:3,z};
    for(const next of horizontalNeighbors({x,y:3,z}))assert.deepEqual(pathToPosition(site,from,[next]),[next]);
    assert.deepEqual(pathToPosition(site,from,[from]),[]);
    assert.equal(pathToPosition(site,from,[{x,y:3,z:z===0?4:0}]),null);
  }
  assert.equal(JSON.stringify(site),before,'routing does not open doors, mutate cells or create links');
});

test('obstacles on one deck cannot block or permit a route on another',()=>{
  const site=map(),from={x:3,y:3,z:4},goal={x:4,y:4,z:4};
  tileAt(site,goal).building='wall';
  assert.equal(pathToPosition(site,from,[goal]),null);
  assert.deepEqual(pathToPosition(site,{...from,z:0},[{...goal,z:0}]),[{...goal,z:0}]);
  tileAt(site,goal).building=null;tileAt(site,{...goal,z:0}).building='wall';
  const route=pathToPosition(site,from,[goal]);assert.deepEqual(route,[goal]);
  route[0].x=99;assert.equal(tileAt(site,goal).x,4,'returned steps do not alias physical tiles or goals');
  assert.equal(goal.x,4);
});

test('explicit routing rejects malformed or foreign locations even with permissive access callbacks',()=>{
  const site=map(),start={x:3,y:3,z:0},goal={x:4,y:4,z:0};
  for(const bad of [null,{},[3,3],{x:3,y:3},{...start,z:1},{...start,x:8},{...start,x:.5},{...start,site:'wreck'}]) {
    assert.equal(pathToPosition(site,bad,[goal],()=>true),null);
    assert.equal(pathToPosition(site,start,[bad],()=>true),null);
  }
  assert.equal(pathToPosition(site,start,null),null);
  tileAt(site,start).fire={intensity:1};
  assert.deepEqual(pathToPosition(site,start,[goal]),[goal],'a blocked origin can be evacuated');
});

test('pair-based route and airlock-planning callers always mean deck zero',()=>{
  const site=map(),from={x:3,y:3},goal=[4,4];site.viewZ=4;
  assert.deepEqual(pathTo(site,from,[goal]),[goal]);
  assert.deepEqual(animalPath(site,{...from,species:'tibble'},[goal]),[goal]);
  for(const origin of [{...from,z:4},{...from,z:-2},{...from,z:null},{...from,site:'wreck'}]) {
    assert.equal(pathTo(site,origin,[goal]),null);
    assert.equal(planCrewRoute({},site,origin,[goal]),null);
  }
  assert.equal(pathTo(site,from,[[4,4,4]]),null);
  assert.equal(planCrewRoute({},site,from,[[4,4,4]]),null);
  tileAt(site,{x:4,y:4,z:0}).building='wall';
  assert.equal(pathTo(site,from,[goal]),null,'the viewed/first deck cannot substitute its open cell');
});

test('species-specific door and gate rules use the addressed deck',()=>{
  const site=map('void'),from={x:3,y:3,z:-2},goal={x:4,y:4,z:-2};
  tileAt(site,from).terrain='ground';const door=tileAt(site,goal);Object.assign(door,{terrain:'floor',building:'door',doorMode:'auto'});
  assert.equal(animalPathToPosition(site,{...from,species:'bristleback'},[goal]),null);
  assert.deepEqual(animalPathToPosition(site,{...from,species:'tibble'},[goal]),[goal]);
  door.doorMode='closed';assert.equal(animalPathToPosition(site,{...from,species:'tibble'},[goal]),null);
  door.building='pastureGate';door.gateMode='latched';
  assert.equal(animalPathToPosition(site,{...from,species:'bristleback'},[goal]),null);
  door.gateMode='open';assert.deepEqual(animalPathToPosition(site,{...from,species:'bristleback'},[goal]),[goal]);
});

test('physical movement refuses unsupported decks and invalid coordinates without touching state',()=>{
  const state=createGame(74219),site=state.sites.surface,c=state.crew[0],a=state.creatures[0];
  for(const next of [{x:9,y:9,z:1},{x:9,y:9,z:-1},{x:9,y:9},{site:'wreck',x:9,y:9,z:0},[9,9,1],[-1,9],{x:9.5,y:9,z:0}]) {
    const before=serialize(state);
    assert.equal(moveCrew(c,site,next),false);assert.equal(moveAnimal(state,a,next,'test'),false);
    assert.equal(serialize(state),before);
  }
  const before=serialize(state);c.z=1;a.z=1;const misplaced=serialize(state);
  assert.equal(moveCrew(c,site,[9,9]),false);assert.equal(moveAnimal(state,a,[9,9],'test'),false);
  assert.equal(serialize(state),misplaced);c.z=0;a.z=0;assert.equal(serialize(state),before);
  assert.equal(moveCrew(c,site,{x:9,y:9,z:0}),true);
  assert.equal(moveAnimal(state,a,{x:7,y:16,z:0},'test'),true);
  assert.deepEqual([c.x,c.y,c.z],[9,9,0]);assert.deepEqual([a.x,a.y,a.z],[7,16,0]);
});
