import test from 'node:test';
import assert from 'node:assert/strict';
import {DIRECTIONS,step,opposite} from '../src/geometry.js';
import {tileAt} from '../src/spatial.js';
import {initializePower,initializeElectrical,previewPower,updatePower,seedPowerNetwork,breakerConditions} from '../src/power.js';
import {buildPowerTopology,powerTileKey,breakerTerminals,branchForBreaker} from '../src/power-topology.js';
import {tileEntityId} from '../src/telemetry.js';
import {LIQUID} from '../src/liquids.js';

function stacked() {
  const site={id:'surface',size:7,levels:[{z:0},{z:7}],tiles:[]},s={tick:0,sites:{surface:site}};
  for(const {z} of site.levels)for(let y=0;y<7;y++)for(let x=0;x<7;x++)site.tiles.push({x,y,z,terrain:'floor',building:null,hp:100,cable:null});
  initializePower(s,site);return {s,site};
}
function device(site,x,y,z,building,charge=0) {
  const t=tileAt(site,{x,y,z});t.building=building;initializeElectrical(t);
  if(building==='battery'){t.charge=charge;site.energy.initial+=charge;}
  return t;
}
function balance(site) {
  const e=site.energy;assert.ok(Math.abs(site.power.battery+e.consumed+e.curtailed+e.discarded-e.initial-e.generated-e.injected)<1e-9);
}
function relayLine(site,z,direction='ne',closed=true) {
  const relay=device(site,3,3,z,'breaker');Object.assign(relay.protection,{direction,enabled:closed,mode:'wet_fault'});
  const [ix,iy]=step(3,3,opposite(direction)),[ox,oy]=step(3,3,direction);
  const input=device(site,ix,iy,z,'battery',60),output=tileAt(site,{x:ox,y:oy,z});output.cable={hp:100,enabled:true};
  return {relay,input,output};
}

test('stacked loads cannot drain a battery on another deck',()=>{
  const {s,site}=stacked(),bank=device(site,3,3,0,'battery',60),load=device(site,4,3,0,'scrubber'),upperBank=device(site,3,3,7,'battery'),upperLoad=device(site,4,3,7,'scrubber');
  const before=JSON.stringify(site),plan=previewPower(s,site);assert.equal(JSON.stringify(site),before,'preview remains pure');
  assert.equal(plan.networks.length,2);assert.ok(plan.powered.has(load));assert.ok(!plan.powered.has(upperLoad));
  updatePower(s,site);assert.equal(load.powered,true);assert.equal(upperLoad.powered,false);assert.equal(bank.charge,57);assert.equal(upperBank.charge,0);balance(site);
  assert.notEqual(bank.circuit,upperBank.circuit);assert.equal(new Set(site.circuits.map(c=>c.id)).size,2);
});

test('every hex breaker orientation connects only its own deck and has distinct terminal identities',()=>{
  for(const direction of DIRECTIONS){
    const {site}=stacked(),lower=relayLine(site,0,direction,true),upper=relayLine(site,7,direction,false),graph=buildPowerTopology(site);
    assert.equal(graph.membership.get(powerTileKey(lower.input)),graph.membership.get(powerTileKey(lower.output)));
    assert.notEqual(graph.membership.get(powerTileKey(upper.input)),graph.membership.get(powerTileKey(upper.output)));
    assert.notEqual(breakerTerminals(lower.relay).input,breakerTerminals(upper.relay).input);
    const branch=branchForBreaker(site,upper.relay,graph);assert.equal(branch.bypassed,false);assert.ok(branch.tiles.every(t=>t.z===7));
    assert.ok(!branch.sources.includes(lower.input));
  }
});

test('an upper wet fault trips only its own relay and identifies the correct fault tile',()=>{
  const {s,site}=stacked(),lower=relayLine(site,0),upper=relayLine(site,7);upper.output.liquid=LIQUID.wet;
  const plan=previewPower(s,site),a=breakerConditions(s,site,lower.relay,plan),b=breakerConditions(s,site,upper.relay,plan);
  assert.equal(a.wouldTrip,false);assert.equal(b.wouldTrip,true);
  assert.deepEqual(b.faultEntities,[tileEntityId(site.id,upper.output.x,upper.output.y,7)]);
  assert.deepEqual(b.sourceEntities,[],'upstream supply is outside the isolated output branch');
  assert.ok(!b.sourceEntities.includes(tileEntityId(site.id,lower.input.x,lower.input.y)));
  updatePower(s,site);assert.equal(lower.relay.protection.tripped,false);assert.equal(upper.relay.protection.tripped,true);balance(site);
});

test('initial cable commissioning builds one independent route per declared deck',()=>{
  const {site}=stacked();for(const z of [0,7]){device(site,1,1,z,'solar');device(site,4,4,z,'scrubber');}
  seedPowerNetwork(site);const graph=buildPowerTopology(site);assert.equal(graph.circuits.length,2);
  for(const circuit of graph.circuits){assert.equal(new Set(circuit.tiles.map(t=>t.z)).size,1);assert.ok(circuit.tiles.some(t=>t.building==='solar'));assert.ok(circuit.tiles.some(t=>t.building==='scrubber'));}
});

test('ground electrical identities retain their exact format while upper identities remain distinct',()=>{
  assert.equal(powerTileKey({x:2,y:3}),'2,3');assert.equal(powerTileKey({x:2,y:3,z:0}),'2,3');assert.equal(powerTileKey({x:2,y:3,z:7}),'2,3,7');
  assert.equal(tileEntityId('surface',2,3),'tile:surface:2:3');assert.equal(tileEntityId('surface',2,3,0),'tile:surface:2:3');assert.equal(tileEntityId('surface',2,3,7),'tile:surface:2:3:7');
});

test('downstream generation diagnostics exclude shaded sources and identify their actual deck',()=>{
  const {s,site}=stacked(),lower=relayLine(site,0),upper=relayLine(site,7);
  for(const line of [lower,upper])device(site,line.output.x,line.output.y,line.output.z,'solar');
  const plan=previewPower(s,site);
  const a=breakerConditions(s,site,lower.relay,plan),b=breakerConditions(s,site,upper.relay,plan);
  assert.deepEqual(a.sourceEntities,[],'the upper floor shades the lower source');
  assert.deepEqual(b.sourceEntities,[tileEntityId(site.id,upper.output.x,upper.output.y,7)]);
  assert.notDeepEqual(a.sourceEntities,b.sourceEntities);
  Object.assign(upper.output,{terrain:'void',building:null,cable:null});
  assert.deepEqual(breakerConditions(s,site,lower.relay).sourceEntities,[tileEntityId(site.id,lower.output.x,lower.output.y)]);
});
