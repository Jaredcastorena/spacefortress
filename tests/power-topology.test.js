import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../src/data.js';
import { buildPowerTopology, breakerTerminals, branchForBreaker, powerTileKey } from '../src/power-topology.js';

function grid(size=7) {
  return {id:'surface',size,tiles:Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),building:null,hp:100,cable:null}))};
}
const at=(site,x,y)=>site.tiles[y*site.size+x];
function wire(site,x,y,enabled=true,hp=100) {const t=at(site,x,y);t.cable={enabled,hp};return t;}
function device(site,x,y,building) {const t=at(site,x,y);t.building=building;return t;}
function breaker(site,x,y,direction='east',enabled=false) {
  const t=device(site,x,y,'breaker');t.protection={kind:'breaker',direction,enabled,mode:'manual',tripped:false,cause:null};return t;
}
const connected=(graph,a,b)=>graph.membership.get(a)===graph.membership.get(b);
function oldCircuits(site) {
  const electrical=t=>!!(BUILDINGS[t.building]?.output||BUILDINGS[t.building]?.demand||t.building==='battery');
  const conducting=t=>t.cable?t.cable.enabled&&t.cable.hp>0:electrical(t)&&t.hp>0;
  const seen=new Set(),result=[];
  for(const start of site.tiles) {
    if((!start.cable&&!electrical(start))||seen.has(powerTileKey(start)))continue;
    const queue=[start];seen.add(powerTileKey(start));
    for(let i=0;i<queue.length;i++) {
      const t=queue[i];if(!conducting(t))continue;
      for(const [x,y] of [[t.x+1,t.y],[t.x-1,t.y],[t.x,t.y+1],[t.x,t.y-1]]) {
        if(x<0||y<0||x>=site.size||y>=site.size)continue;
        const next=at(site,x,y);if(conducting(next)&&!seen.has(powerTileKey(next))){seen.add(powerTileKey(next));queue.push(next);}
      }
    }
    result.push({id:`circuit-${start.y*site.size+start.x}`,cells:queue.map(powerTileKey)});
  }
  return result;
}
function deepFreeze(value) {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}

test('graphs without breakers preserve exact old BFS membership, order and IDs across ordinary and isolated equipment',()=>{
  for(let scenario=0;scenario<40;scenario++) {
    const site=grid();
    for(const t of site.tiles) {
      const n=(t.x*17+t.y*29+scenario*7)%23;
      if(n<14)t.cable={enabled:n%4!==0,hp:n%5===0?0:100};
      if(n%7===0)t.building='solar';else if(n%11===0)t.building='battery';else if(n%13===0)t.building='scrubber';
      if(n%9===0)t.hp=0;
    }
    const graph=buildPowerTopology(site),expected=oldCircuits(site);
    assert.deepEqual(graph.circuits.map(({id,cells})=>({id,cells})),expected);
    assert.equal(new Set(graph.circuits.flatMap(c=>c.tiles)).size,graph.circuits.reduce((n,c)=>n+c.tiles.length,0));
    assert.ok(graph.circuits.every(c=>c.terminals.length===0));
    for(const circuit of expected)for(const cell of circuit.cells)assert.equal(graph.membership.get(cell),circuit.id);
  }
});

test('two terminal vertices isolate the own contact while side cables remain unrelated',()=>{
  const site=grid(),relay=breaker(site,3,3),left=device(site,2,3,'solar'),right=device(site,4,3,'battery'),side=wire(site,3,2);
  const terminals=breakerTerminals(relay),graph=buildPowerTopology(site);
  assert.equal(connected(graph,powerTileKey(left),terminals.input),true);
  assert.equal(connected(graph,powerTileKey(right),terminals.output),true);
  assert.equal(connected(graph,terminals.input,terminals.output),false);
  assert.equal(connected(graph,powerTileKey(side),terminals.input),false);
  assert.equal(graph.circuits.flatMap(c=>c.tiles).includes(relay),false);
  assert.equal(graph.membership.has(powerTileKey(relay)),false);
  relay.protection.enabled=true;
  const closed=buildPowerTopology(site);
  assert.equal(connected(closed,powerTileKey(left),powerTileKey(right)),true);
  assert.equal(connected(closed,powerTileKey(side),terminals.input),false);
  assert.deepEqual(closed.adjacency.get(terminals.input),[powerTileKey(left),terminals.output]);
});

test('all four orientations match opposite ports and both directions conduct through a closed contact',()=>{
  for(const [direction,[dx,dy]] of Object.entries({east:[1,0],south:[0,1],west:[-1,0],north:[0,-1]})) {
    const site=grid(),relay=breaker(site,3,3,direction,true),input=wire(site,3-dx,3-dy),output=device(site,3+dx,3+dy,'battery');
    const graph=buildPowerTopology(site),terminals=breakerTerminals(relay);
    assert.ok(graph.adjacency.get(terminals.input).includes(powerTileKey(input)));
    assert.ok(graph.adjacency.get(terminals.output).includes(powerTileKey(output)));
    assert.ok(graph.adjacency.get(terminals.input).includes(terminals.output));
    assert.ok(graph.adjacency.get(terminals.output).includes(terminals.input));
    assert.equal(connected(graph,powerTileKey(input),powerTileKey(output)),true);
  }
});

test('adjacent breaker terminals connect only when both physical faces match',()=>{
  const site=grid(),a=breaker(site,2,3,'east',true),b=breaker(site,3,3,'east',true);
  wire(site,1,3);wire(site,4,3);
  assert.equal(connected(buildPowerTopology(site),'1,3','4,3'),true);
  b.protection.direction='north';
  const graph=buildPowerTopology(site);
  assert.equal(connected(graph,breakerTerminals(a).output,breakerTerminals(b).input),false);
  assert.equal(connected(graph,breakerTerminals(a).output,breakerTerminals(b).output),false);
});

test('broken and tripped contacts open internally without erasing either terminal or remote equipment',()=>{
  for(const property of ['hp','tripped']) {
    const site=grid(),relay=breaker(site,3,3,'east',true);wire(site,2,3);wire(site,4,3);
    if(property==='hp')relay.hp=0;else relay.protection.tripped=true;
    const graph=buildPowerTopology(site),terminals=breakerTerminals(relay);
    assert.equal(connected(graph,'2,3','4,3'),false);
    assert.ok(graph.vertices.has(terminals.input)&&graph.vertices.has(terminals.output));
    assert.equal(connected(graph,'2,3',terminals.input),true);
    assert.equal(connected(graph,'4,3',terminals.output),true);
  }
});

test('branch inspection omits only its own contact and keeps other series contacts in their actual state',()=>{
  const site=grid(),a=breaker(site,2,3,'east',true),b=breaker(site,4,3,'east',true);
  const upstream=device(site,1,3,'solar'),middle=wire(site,3,3),bank=device(site,5,3,'battery');
  let branch=branchForBreaker(site,a);
  assert.equal(branch.bypassed,false);assert.deepEqual(new Set(branch.tiles),new Set([middle,bank]));
  assert.deepEqual(branch.sources,[bank]);assert.ok(!branch.tiles.includes(upstream));
  b.protection.enabled=false;branch=branchForBreaker(site,a);
  assert.deepEqual(branch.tiles,[middle]);assert.deepEqual(branch.sources,[]);
  assert.equal(branch.vertices.has(breakerTerminals(b).output),false);
  const downstream=branchForBreaker(site,b);assert.deepEqual(downstream.tiles,[bank]);
});

test('an external bypass remains real and appears when the requested contact is excluded',()=>{
  const site=grid(),relay=breaker(site,3,3,'east',true);
  for(const [x,y] of [[2,3],[4,3],[2,2],[3,2],[4,2]])wire(site,x,y);
  const graph=buildPowerTopology(site),branch=branchForBreaker(site,relay,graph),terminals=breakerTerminals(relay);
  assert.equal(branch.bypassed,true);assert.ok(branch.vertices.has(terminals.input));
  const opened=buildPowerTopology(site,{openContacts:new Set([powerTileKey(relay)])});
  assert.equal(connected(opened,terminals.input,terminals.output),true);
  assert.equal(opened.adjacency.get(terminals.input).includes(terminals.output),false);
  assert.equal(relay.protection.enabled,true);
});

test('graph and branch previews are pure on deeply frozen state and allocate each ordinary tile once',()=>{
  const site=grid(),relay=breaker(site,3,3,'east',true);
  device(site,2,3,'battery').charge=37;device(site,4,3,'solar');wire(site,3,2,false);
  const before=JSON.stringify(site);deepFreeze(site);
  for(let i=0;i<4;i++) {
    const graph=buildPowerTopology(site),branch=branchForBreaker(site,relay,graph);
    assert.equal(branch.bypassed,false);
    const tiles=graph.circuits.flatMap(c=>c.tiles);
    assert.equal(new Set(tiles).size,tiles.length);
    assert.equal(graph.circuits.flatMap(c=>c.cells).length,graph.membership.size);
    assert.equal(JSON.stringify(site),before);
    for(const [vertex,edges] of graph.adjacency)for(const next of edges)assert.ok(graph.adjacency.get(next).includes(vertex),'Electrical edges are undirected');
  }
});
