import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTIONS, neighbors, step, opposite, tileAt } from '../src/geometry.js';
import { GASES, gasAmount, mix, updateRooms, fillRoom, refreshAtmosphere, updateAtmosphere } from '../src/atmosphere.js';
import { GAS_DIRECTIONS, GAS_NETWORK, initializeGasNetworks, initializeGasTile, newPipe, pumpPorts, updateGasNetworks, validateGasNetworks } from '../src/gas-networks.js';
import { WATER_DIRECTIONS, PLUMBING, initializePlumbing, initializePlumbingTile, newWaterPipe, waterPorts, flowPlumbing, operatePlumbing, validatePlumbing } from '../src/plumbing.js';
import { LIQUID, initializeLiquids, flowLiquids, pumpLiquids, validateLiquids } from '../src/liquids.js';
import { initializeThermal, updateThermal, validateThermal } from '../src/thermal.js';
import { radiatorTargets, REACTOR, initializeReactors, updateReactorCooling } from '../src/reactors.js';
import { initializeFire, ignite, updateFire, validateFire } from '../src/fire.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
function fixture() {
  const size=13, site={id:'surface',size,rooms:[],incidents:[],tiles:Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),terrain:'floor',building:null,hp:100,powered:false}))};
  const s={tick:1,sites:{surface:site},crew:[],jobs:[],log:[],nextId:1};
  updateRooms(site);initializeThermal(s);initializeFire(s);initializeGasNetworks(s);initializePlumbing(s);initializeLiquids(s);initializeReactors(s);
  return {s,site};
}
const at=(site,p)=>tileAt(site,...p);
function seedGas(site,t,gas,smoke=0) {
  t.pipe.gas={...gas};t.pipe.smoke=smoke;
  for(const k of GASES)site.gasNetwork.loaded[k]+=gas[k];
  site.gasNetwork.smoke.captured+=smoke;
}
function seedWater(site,t,n) {t.waterPipe.water=n;site.plumbing.loaded+=n;}
function seedLiquid(site,t,n) {t.liquid=n;site.liquids.released+=n;}

test('physical direction catalogs and fresh device controls share the ordered six hex IDs',()=>{
  for(const catalog of [GAS_DIRECTIONS,WATER_DIRECTIONS]) {
    assert.ok(Object.isFrozen(catalog));assert.deepEqual(Object.keys(catalog),DIRECTIONS);assert.ok(Object.values(catalog).every(v=>v===true));
  }
  for(const building of ['gasPump','waterPump','waterIntake','waterOutlet']) {
    const t={building};initializeGasTile(t);initializePlumbingTile(t);assert.equal((t.gasDevice||t.waterDevice).direction,'ne');
  }
});

test('gas and water pumps use opposite six-direction ports at both column parities and move finite payloads',()=>{
  for(const x of [5,6])for(const direction of DIRECTIONS) {
    for(const kind of ['gas','water']) {
      const {s,site}=fixture(),pump=at(site,[x,6]),input=at(site,step(x,6,opposite(direction))),output=at(site,step(x,6,direction));
      pump.building=kind==='gas'?'gasPump':'waterPump';pump.powered=true;
      if(kind==='gas') {
        initializeGasTile(pump);pump.gasDevice.direction=direction;input.pipe=newPipe();output.pipe=newPipe();seedGas(site,input,{oxygen:3,inert:4,co2:1},1);
        assert.deepEqual(pumpPorts(site,pump),{input,output});updateGasNetworks(s);close(gasAmount(output.pipe.gas)+output.pipe.smoke,GAS_NETWORK.pump);validateGasNetworks(s);
      } else {
        initializePlumbingTile(pump);pump.waterDevice.direction=direction;input.waterPipe=newWaterPipe();output.waterPipe=newWaterPipe();seedWater(site,input,2);
        assert.deepEqual(waterPorts(site,pump),{input,output});operatePlumbing(s);close(output.waterPipe.water,PLUMBING.pump);validatePlumbing(s);
      }
    }
  }
  const {site}=fixture(),t=at(site,[0,0]);t.gasDevice={direction:'n'};t.waterDevice={direction:'n'};
  assert.equal(pumpPorts(site,t).output,null);assert.equal(waterPorts(site,t).output,null);
  t.gasDevice.direction='east';t.waterDevice.direction='east';
  assert.deepEqual(pumpPorts(site,t),{input:null,output:null});assert.deepEqual(waterPorts(site,t),{input:null,output:null});
});

test('gas, pipe water and floor water exchange each hex edge once with conserved finite ownership',()=>{
  for(const x of [5,6])for(const direction of DIRECTIONS) {
    const {s,site}=fixture(),a=at(site,[x,6]),b=at(site,step(x,6,direction));
    for(const t of site.tiles)t.building='wall';a.building=b.building=null;
    a.pipe=newPipe();b.pipe=newPipe();seedGas(site,a,mix(10));
    a.waterPipe=newWaterPipe();b.waterPipe=newWaterPipe();seedWater(site,a,2);seedLiquid(site,a,4);
    updateGasNetworks(s);flowPlumbing(s);flowLiquids(s);
    close(gasAmount(b.pipe.gas),GAS_NETWORK.flow);close(b.waterPipe.water,PLUMBING.flow);close(b.liquid,LIQUID.flow);
    validateGasNetworks(s);validatePlumbing(s);validateLiquids(s);
  }
});

test('room flood fill joins genuine diagonal neighbors and six hull sides seal gas and smoke',()=>{
  for(const x of [5,6])for(const direction of DIRECTIONS) {
    const {s,site}=fixture(),center=at(site,[x,6]);
    for(const t of site.tiles){t.terrain='ground';t.building=null;}
    center.terrain='floor';for(const point of neighbors(x,6))at(site,point).building='wall';
    updateRooms(site);const room=site.rooms[0];fillRoom(room);room.smoke=.2;site.fireSafety.smokeProduced=.2;refreshAtmosphere(site);
    assert.equal(room.sealed,true);updateAtmosphere(s);close(gasAmount(room.gas),10);close(room.smoke,.2);
    const hole=at(site,step(x,6,direction));hole.building=null;refreshAtmosphere(site);assert.equal(room.sealed,false);
    const before={...room.gas};updateAtmosphere(s);assert.ok(gasAmount(room.gas)<10);
    for(const k of GASES)close(room.gas[k]+site.atmosphere.vented[k],before[k]);
    close(room.smoke+site.fireSafety.smokeVented,.2);validateFire(s);
    hole.terrain='floor';updateRooms(site);assert.equal(site.rooms.length,1);assert.equal(site.rooms[0].volume,2);
  }
});

test('all six exposed floor edges conduct heat exactly once and the energy ledger balances',()=>{
  for(const x of [5,6]) {
    const {s,site}=fixture();for(const t of site.tiles)t.terrain='ground';at(site,[x,6]).terrain='floor';updateRooms(site);initializeThermal(s);
    const before=site.rooms[0].heat;updateThermal(s);close(before-site.rooms[0].heat,6*.6*(20-8));close(site.thermal.environmentOut,6*.6*(20-8));validateThermal(s);
  }
});

test('radiators use repeated same-direction hex steps through intact walls while retaining one device heat limit',()=>{
  for(const x of [5,6])for(const direction of DIRECTIONS) {
    const {s,site}=fixture(),radiator=at(site,[x,6]),near=at(site,step(x,6,direction)),far=at(site,step(near.x,near.y,direction));
    radiator.building='radiator';radiator.radiator={enabled:true,status:'Waiting'};near.building='wall';far.building='reactor';far.reactor={heat:40};
    site.rooms=[];assert.deepEqual(radiatorTargets(site,radiator),[far]);updateReactorCooling(s);close(far.reactor.heat,40-REACTOR.radiatorRate);close(site.reactorLedger.radiated,REACTOR.radiatorRate);
    near.hp=0;assert.deepEqual(radiatorTargets(site,radiator),[]);near.hp=100;near.building='reactor';assert.deepEqual(radiatorTargets(site,radiator),[near]);
  }
});

test('bilge recovery and fire spread reach every hex side without creating water, smoke or heat',()=>{
  for(const x of [5,6])for(const direction of DIRECTIONS) {
    const {s,site}=fixture(),center=at(site,[x,6]),target=at(site,step(x,6,direction));
    center.building='bilgePump';center.powered=true;center.machine={enabled:true,output:{}};seedLiquid(site,target,1);pumpLiquids(s);
    close(center.machine.output.water,LIQUID.pump);close(target.liquid,1-LIQUID.pump);validateLiquids(s);
    center.building='bunk';center.powered=false;target.building='bunk';target.liquid=0;site.liquids.quenched+=1-LIQUID.pump;
    fillRoom(site.rooms[0]);assert.ok(ignite(s,site,center));center.fire.age=29;center.fire.intensity=60;s.tick=30;updateFire(s);
    assert.ok(target.fire,`${direction} from column ${x}`);validateFire(s);validateThermal(s);
  }
});
