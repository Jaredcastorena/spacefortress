import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTIONS, neighbors, step, opposite } from '../src/geometry.js';
import { BREAKER_DIRECTIONS } from '../src/breakers.js';
import { BUILDINGS } from '../src/data.js';
import { buildPowerTopology, breakerTerminals, branchForBreaker, powerTileKey } from '../src/power-topology.js';

function grid(size=7) {
  return {id:'surface',size,tiles:Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),building:null,hp:100,cable:null}))};
}
const at=(site,x,y)=>site.tiles[y*site.size+x];
function wire(site,x,y,enabled=true,hp=100) {const t=at(site,x,y);t.cable={enabled,hp};return t;}
function device(site,x,y,building) {const t=at(site,x,y);t.building=building;return t;}
function breaker(site,x,y,direction='ne',enabled=false) {
  const t=device(site,x,y,'breaker');t.protection={kind:'breaker',direction,enabled,mode:'manual',tripped:false,cause:null};return t;
}
const connected=(graph,a,b)=>graph.membership.get(a)===graph.membership.get(b);
function ordinaryHexCircuits(site) {
  const electrical=t=>!!(BUILDINGS[t.building]?.output||BUILDINGS[t.building]?.demand||t.building==='battery');
  const conducting=t=>t.cable?t.cable.enabled&&t.cable.hp>0:electrical(t)&&t.hp>0;
  const seen=new Set(),result=[];
  for(const start of site.tiles) {
    if((!start.cable&&!electrical(start))||seen.has(powerTileKey(start)))continue;
    const queue=[start];seen.add(powerTileKey(start));
    for(let i=0;i<queue.length;i++) {
      const t=queue[i];if(!conducting(t))continue;
      for(const [x,y] of neighbors(t.x,t.y)) {
        if(x<0||y<0||x>=site.size||y>=site.size)continue;
        const next=at(site,x,y);if(conducting(next)&&!seen.has(powerTileKey(next))){seen.add(powerTileKey(next));queue.push(next);}
      }
    }
    result.push({id:`circuit-${start.y*site.size+start.x}`,cells:queue.map(powerTileKey)});
  }
  return result;
}
function deepFreeze(value) {if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}

test('graphs without breakers preserve deterministic hex BFS membership, order and IDs across ordinary and isolated equipment',()=>{
  for(let scenario=0;scenario<40;scenario++) {
    const site=grid();
    for(const t of site.tiles) {
      const n=(t.x*17+t.y*29+scenario*7)%23;
      if(n<14)t.cable={enabled:n%4!==0,hp:n%5===0?0:100};
      if(n%7===0)t.building='solar';else if(n%11===0)t.building='battery';else if(n%13===0)t.building='scrubber';
      if(n%9===0)t.hp=0;
    }
    const graph=buildPowerTopology(site),expected=ordinaryHexCircuits(site);
    assert.deepEqual(graph.circuits.map(({id,cells})=>({id,cells})),expected);
    assert.equal(new Set(graph.circuits.flatMap(c=>c.tiles)).size,graph.circuits.reduce((n,c)=>n+c.tiles.length,0));
    assert.ok(graph.circuits.every(c=>c.terminals.length===0));
    for(const circuit of expected)for(const cell of circuit.cells)assert.equal(graph.membership.get(cell),circuit.id);
  }
});

const ports=t=>({input:step(t.x,t.y,opposite(t.protection.direction)),output:step(t.x,t.y,t.protection.direction)});
const link=(site,t,direction,count=1)=>{let xy=[t.x,t.y];while(count--)xy=step(...xy,direction);return at(site,...xy);};

test('six frozen directions use boolean membership and reject the old cardinal catalog',()=>{
  assert.ok(Object.isFrozen(BREAKER_DIRECTIONS));
  assert.deepEqual(Object.keys(BREAKER_DIRECTIONS),DIRECTIONS);
  assert.deepEqual(Object.values(BREAKER_DIRECTIONS),DIRECTIONS.map(()=>true));
});

test('all six orientations and both parities match opposite ports and conduct bidirectionally',()=>{
  for(const x of [2,3])for(const direction of DIRECTIONS) {
    const site=grid(),relay=breaker(site,x,3,direction),p=ports(relay);
    const input=device(site,...p.input,'solar'),output=device(site,...p.output,'battery');
    const terminals=breakerTerminals(relay),graph=buildPowerTopology(site);
    assert.equal(connected(graph,powerTileKey(input),terminals.input),true);
    assert.equal(connected(graph,powerTileKey(output),terminals.output),true);
    assert.equal(connected(graph,terminals.input,terminals.output),false);
    assert.equal(graph.circuits.flatMap(c=>c.tiles).includes(relay),false);
    assert.equal(graph.membership.has(powerTileKey(relay)),false);
    relay.protection.enabled=true;
    const closed=buildPowerTopology(site);
    assert.equal(connected(closed,powerTileKey(input),powerTileKey(output)),true);
    assert.deepEqual(closed.adjacency.get(terminals.input),[powerTileKey(input),terminals.output]);
    assert.deepEqual(closed.adjacency.get(terminals.output),[powerTileKey(output),terminals.input]);
  }
});

test('the four side faces never contact breaker terminals in either parity or orientation',()=>{
  for(const x of [2,3])for(const direction of DIRECTIONS) {
    const site=grid(),relay=breaker(site,x,3,direction,true),terminals=breakerTerminals(relay);
    for(const side of DIRECTIONS.filter(d=>d!==direction&&d!==opposite(direction)))wire(site,...step(x,3,side));
    const graph=buildPowerTopology(site);
    assert.deepEqual(graph.adjacency.get(terminals.input),[terminals.output]);
    assert.deepEqual(graph.adjacency.get(terminals.output),[terminals.input]);
    for(const tile of site.tiles.filter(t=>t.cable))assert.equal(connected(graph,powerTileKey(tile),terminals.input),false);
  }
});

test('adjacent breaker terminals connect only when both physical faces match',()=>{
  for(const x of [2,3])for(const direction of DIRECTIONS) {
    const site=grid(),a=breaker(site,x,3,direction,true),b=breaker(site,...ports(a).output,direction,true);
    const input=wire(site,...ports(a).input),output=wire(site,...ports(b).output);
    assert.equal(connected(buildPowerTopology(site),powerTileKey(input),powerTileKey(output)),true);
    b.protection.direction=DIRECTIONS[(DIRECTIONS.indexOf(direction)+1)%6];
    const graph=buildPowerTopology(site);
    assert.equal(connected(graph,breakerTerminals(a).output,breakerTerminals(b).input),false);
    assert.equal(connected(graph,breakerTerminals(a).output,breakerTerminals(b).output),false);
  }
});

test('broken and tripped contacts retain both terminal connections while opening internally',()=>{
  for(const property of ['hp','tripped']) {
    const site=grid(),relay=breaker(site,3,3,'ne',true),p=ports(relay);
    const input=wire(site,...p.input),output=wire(site,...p.output);
    if(property==='hp')relay.hp=0;else relay.protection.tripped=true;
    const graph=buildPowerTopology(site),terminals=breakerTerminals(relay);
    assert.equal(connected(graph,powerTileKey(input),powerTileKey(output)),false);
    assert.ok(graph.vertices.has(terminals.input)&&graph.vertices.has(terminals.output));
    assert.equal(connected(graph,powerTileKey(input),terminals.input),true);
    assert.equal(connected(graph,powerTileKey(output),terminals.output),true);
  }
});

test('branch inspection excludes only its own contact and retains actual series contacts',()=>{
  const site=grid(),a=breaker(site,2,4,'ne',true),next=link(site,a,'ne',2),b=breaker(site,next.x,next.y,'ne',true);
  const upstream=device(site,...ports(a).input,'solar'),middle=wire(site,...ports(a).output),bank=device(site,...ports(b).output,'battery');
  let branch=branchForBreaker(site,a);
  assert.equal(branch.bypassed,false);assert.deepEqual(new Set(branch.tiles),new Set([middle,bank]));
  assert.deepEqual(branch.sources,[bank]);assert.ok(!branch.tiles.includes(upstream));
  b.protection.enabled=false;branch=branchForBreaker(site,a);
  assert.deepEqual(branch.tiles,[middle]);assert.deepEqual(branch.sources,[]);
  assert.equal(branch.vertices.has(breakerTerminals(b).output),false);
  assert.deepEqual(branchForBreaker(site,b).tiles,[bank]);
});

test('a six-neighbor ring is a real external bypass after the requested contact is excluded',()=>{
  const site=grid(),relay=breaker(site,3,3,'ne',true);
  for(const xy of neighbors(relay.x,relay.y))wire(site,...xy);
  const graph=buildPowerTopology(site),branch=branchForBreaker(site,relay,graph),terminals=breakerTerminals(relay);
  assert.equal(branch.bypassed,true);assert.ok(branch.vertices.has(terminals.input));
  const opened=buildPowerTopology(site,{openContacts:new Set([powerTileKey(relay)])});
  assert.equal(connected(opened,terminals.input,terminals.output),true);
  assert.equal(opened.adjacency.get(terminals.input).includes(terminals.output),false);
  assert.equal(relay.protection.enabled,true);
});

test('graph and branch previews are pure on frozen state and allocate ordinary tiles once',()=>{
  const site=grid(),relay=breaker(site,3,3,'ne',true),p=ports(relay);
  device(site,...p.input,'battery').charge=37;device(site,...p.output,'solar');wire(site,3,2,false);
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
