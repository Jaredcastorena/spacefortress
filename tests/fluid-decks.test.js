import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame} from '../src/simulation.js';
import {tileAt} from '../src/spatial.js';
import {DIRECTIONS,step,opposite,neighbors} from '../src/geometry.js';
import {updateRooms,roomAt,gasAmount} from '../src/atmosphere.js';
import {newPipe,gasNode,initializeGasTile,pumpPorts,updateGasNetworks,releaseGas} from '../src/gas-networks.js';
import {newWaterPipe,waterNode,initializePlumbingTile,waterPorts,flowPlumbing,operatePlumbing,removePlumbing} from '../src/plumbing.js';
import {flowLiquids} from '../src/liquids.js';
import {startRecording,exportRecording,roomEntityId,tileEntityId} from '../src/telemetry.js';
import {fixture as airlockFixture} from './helpers/airlock-fixture.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
function addDeck(site,z=7){
  const blank=structuredClone(site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.flora));
  site.levels.push({...site.levels[0],z});
  for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z,terrain:'floor',building:null,hp:100,cable:null,pipe:null,waterPipe:null,liquid:0,wetShort:false});
}
function stacked(){const s=createGame(74219),site=s.sites.surface;addDeck(site);return {s,site};}
const at=(site,x,y,z)=>tileAt(site,{x,y,z});
const dryFloor=(site,z)=>site.tiles.filter(t=>t.z===z).reduce((n,t)=>n+(t.liquid||0),0);
const gasTotal=site=>site.tiles.reduce((n,t)=>n+(gasNode(t)?gasAmount(gasNode(t).gas)+gasNode(t).smoke:0),0);
const waterTotal=site=>site.tiles.reduce((n,t)=>n+(waterNode(t)?.water||0)+(t.liquid||0),0);
function gasPipe(site,x,y,z,amount=0){const t=at(site,x,y,z);t.pipe=newPipe();t.pipe.gas.oxygen=amount;return t;}
function waterPipe(site,x,y,z,amount=0){const t=at(site,x,y,z);t.waterPipe=newWaterPipe();t.waterPipe.water=amount;return t;}
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);

test('passive gas and smoke transfers remain on their own deck and conserve payload',()=>{
  const {s,site}=stacked(),lowerA=gasPipe(site,3,3,0),lowerB=gasPipe(site,4,3,0),a=gasPipe(site,3,3,7,6),b=gasPipe(site,4,3,7);a.pipe.smoke=.4;
  const before=gasTotal(site);updateGasNetworks(s);
  assert.equal(gasAmount(lowerA.pipe.gas)+gasAmount(lowerB.pipe.gas),0);assert.ok(gasAmount(b.pipe.gas)>0);assert.ok(b.pipe.smoke>0);close(gasTotal(site),before);
});

test('gas and water pump ports retain their deck in all six directions',()=>{
  for(const direction of DIRECTIONS){
    const {s,site}=stacked(),[ix,iy]=step(11,9,opposite(direction)),[ox,oy]=step(11,9,direction);
    const input=gasPipe(site,ix,iy,7,4),output=gasPipe(site,ox,oy,7),lower=gasPipe(site,ix,iy,0,2),lowerOut=gasPipe(site,ox,oy,0);
    const pump=at(site,11,9,7);pump.building='gasPump';pump.powered=true;initializeGasTile(pump);pump.gasDevice.direction=direction;
    assert.deepEqual(pumpPorts(site,pump),{input,output});const before=gasTotal(site);updateGasNetworks(s);assert.ok(gasAmount(output.pipe.gas)>0);assert.equal(gasAmount(lower.pipe.gas),2);assert.equal(gasAmount(lowerOut.pipe.gas),0);close(gasTotal(site),before);
    const source=waterPipe(site,ix,iy,7,1.5),target=waterPipe(site,ox,oy,7),bottom=waterPipe(site,ix,iy,0,1),bottomOut=waterPipe(site,ox,oy,0);
    pump.building='waterPump';initializePlumbingTile(pump);pump.waterDevice.direction=direction;
    assert.deepEqual(waterPorts(site,pump),{input:source,output:target});const water=waterTotal(site);operatePlumbing(s);assert.ok(target.waterPipe.water>0);assert.equal(bottom.waterPipe.water,1);assert.equal(bottomOut.waterPipe.water,0);close(waterTotal(site),water);
  }
});

test('water pipe leveling and a ruptured boundary fitting cannot wet the floor below',()=>{
  const {s,site}=stacked(),source=waterPipe(site,3,3,7,1.5),target=waterPipe(site,4,3,7);waterPipe(site,3,3,0);waterPipe(site,4,3,0);
  for(const [x,y] of neighbors(3,3)){const t=at(site,x,y,0);t.terrain='floor';t.building=null;}
  flowPlumbing(s);assert.ok(target.waterPipe.water>0);assert.equal(at(site,4,3,0).waterPipe.water,0);close(waterTotal(site),1.5);
  source.building='wall';source.waterPipe.hp=0;flowPlumbing(s);assert.ok(dryFloor(site,7)>0);assert.equal(dryFloor(site,0),0);close(waterTotal(site),1.5);
});

test('floor water spreads horizontally without draining into matching cells on another deck',()=>{
  const {s,site}=stacked();for(const t of site.tiles)if(t.z===0){t.terrain='floor';t.building=null;t.liquid=0;}
  const source=at(site,8,8,7);source.liquid=2;flowLiquids(s);
  assert.ok(source.liquid<2);assert.equal(dryFloor(site,0),0);close(dryFloor(site,7)+site.liquids.lost,2);
});

test('plumbing dismantling retains water until recovery on the same deck is available',()=>{
  const {s,site}=stacked(),source=waterPipe(site,3,3,7,1.5),wrong=at(site,4,3,0),correct=at(site,4,3,7);
  const old=JSON.stringify({source,wrong});assert.throws(()=>removePlumbing(s,site,source,wrong,true),/accessible recovery tile/);assert.equal(JSON.stringify({source,wrong}),old);
  assert.equal(removePlumbing(s,site,source,correct,true),1.5);assert.equal(source.waterPipe,null);assert.equal(correct.drop.water,1.5);
});

test('a boundary gas release reaches only same-deck rooms with matching observation identities',()=>{
  const {s,site}=stacked(),source=gasPipe(site,3,3,7,5);source.pipe.smoke=.2;source.building='wall';updateRooms(site);
  const lower=site.rooms.filter(r=>r.z===0).map(r=>structuredClone(r.gas)),upper=roomAt(site,4,3,7),before=gasTotal(site)+gasAmount(upper.gas)+upper.smoke;
  startRecording(s);releaseGas(s,site,source,2,'test_boundary');
  assert.deepEqual(site.rooms.filter(r=>r.z===0).map(r=>r.gas),lower);assert.ok(gasAmount(upper.gas)>0);close(gasTotal(site)+gasAmount(upper.gas)+upper.smoke,before);
  const released=events(s).find(e=>e.id==='gas.released');assert.equal(released.to,roomEntityId(site.id,upper));assert.ok(released.to.endsWith(':7'));assert.equal(released.from,tileEntityId(site.id,3,3,7));
});

test('upper gas events cannot borrow a ground airlock owner when decoding a deck-qualified tile ID',()=>{
  const f=airlockFixture({smoke:0});addDeck(f.site,8);gasPipe(f.site,5,6,8,4);gasPipe(f.site,6,6,8);
  // Old last-two-field decoding would read y=6,z=8 as the owned inner door 6,8.
  assert.ok(at(f.site,6,8,0).airlockOwner);startRecording(f.s);updateGasNetworks(f.s);
  const transferred=events(f.s).filter(e=>e.id==='gas.transferred'&&e.from==='tile:surface:5:6:8');assert.ok(transferred.length);
  for(const event of transferred){assert.equal(event.controller,undefined);assert.equal(event.airlocks,undefined);assert.ok(event.to.endsWith(':8'));}
});
