import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../src/data.js';
import { initializePower, updatePower } from '../src/power.js';
import { initializeGasWork } from '../src/gas-compression.js';
import { GASES, emptyGas, mix, addGas, gasAmount } from '../src/gas-species.js';
import { refreshRoom, breathingBlock, breatheBatch, updateAtmosphere } from '../src/atmosphere.js';
import { gasEnergy, gasLatentHeat, roomHeatCapacity, roomKelvin, nodeKelvin, parcelHeat, GAS_REFERENCE_KELVIN as K } from '../src/gas-thermal.js';
import { roomPressure } from '../src/room-pressure.js';
import { newPipe, initializeGasTile, gasNode, gasPayload, gasCapacity, gasNominalVolume, gasVolumeForWater, gasVolume, gasPressure, gasStatus, updateGasNetworks, releaseGas, removeGas, validateGasNetworks } from '../src/gas-networks.js';
import { airlockGasQuantities, airlockFillPlan, airlockRoomReading } from '../src/airlock-access.js';
import { airlockResourceStatus } from '../src/airlocks.js';

const close=(actual,expected,label='quantity')=>assert.ok(Math.abs(actual-expected)<1e-7,`${label}: ${actual} != ${expected}`);
const wet=(dry,vapor)=>({...mix(dry),vapor});
function room(gas=emptyGas(),kelvin=K,cells=['2,2'],z=0){
 const r={gas:{...gas},gasThermal:true,smoke:0,volume:cells.length,cells,z,sealed:true};
 r.heat=roomHeatCapacity(r)*kelvin+gasLatentHeat(r.gas);refreshRoom(r);return r;
}
function fixture(){
 const site={id:'test',size:5,tiles:[],rooms:[],verticalLinks:[],utilityLinks:[],atmosphere:{tick:0,injected:emptyGas(),vented:emptyGas(),breathed:0,refilled:0},gasNetwork:{loaded:emptyGas(),extracted:emptyGas(),delivered:emptyGas(),vented:emptyGas(),smoke:{captured:0,released:0,vented:0}},thermal:{gasVented:0,gasLoaded:0,waterRemoved:0},fireSafety:{smokeVented:0},vapor:{initial:0,floorEvaporated:0,floorCondensed:0,nodeEvaporated:0,nodeCondensed:0,vacuumEvaporated:0,condensateReleased:0,condensateLost:0},liquids:{released:0}};
 for(let y=0;y<5;y++)for(let x=0;x<5;x++)site.tiles.push({x,y,z:0,terrain:'floor',building:'wall',hp:100,pipe:null,liquid:0,liquidHeat:0});
 const s={tick:1,sites:{test:site},jobs:[],crew:[]};return {s,site,at:(x,y)=>site.tiles[y*5+x]};
}
function install(t,building='pipe'){
 if(building==='pipe')t.pipe=newPipe();else{t.building=building;t.powered=true;initializeGasTile(t);if(building==='gasTank')t.machine={enabled:false,input:{},status:''};}
 return t;
}
function seed(site,t,gas,kelvin=K,smoke=0){const n=gasNode(t);n.gas={...gas};n.heat=gasEnergy(gas,kelvin);n.smoke=smoke;addGas(site.gasNetwork.loaded,gas);site.gasNetwork.smoke.captured+=smoke;}
const sumGas=site=>{const total=emptyGas();for(const r of site.rooms)addGas(total,r.gas);for(const t of site.tiles)if(gasNode(t))addGas(total,gasNode(t).gas);addGas(total,site.atmosphere.vented);return total;};
// Finite synthetic electrical stock is installed before the measured pulse.
function funding(s,site,drive){
 const bank=site.tiles.find(t=>t.x===2&&t.y===3);bank.building='battery';bank.hp=100;
 site.thermal.equipment=0;initializeGasWork(site);initializePower(s,site,6);
 return ()=>{
  const charge=bank.charge,consumed=site.energy.consumed;updatePower(s,site);assert.equal(drive.powered,true);
  close(charge-bank.charge,BUILDINGS[drive.building].demand);close(site.energy.consumed-consumed,BUILDINGS[drive.building].demand);
 };
}
const sumHeat=site=>site.rooms.reduce((n,r)=>n+r.heat,0)+site.tiles.reduce((n,t)=>n+(gasNode(t)?.heat||0),0)+site.thermal.gasVented+(site.gasWork?.motorSpace||0)-(site.gasWork?.allocated||0);
const conservedGas=(site,before)=>{const after=sumGas(site);for(const k of GASES)close(after[k],before[k],k);};

test('passive vapor flow follows actual pressure despite reversed enthalpy density',()=>{
 const {s,site,at}=fixture(),a=install(at(1,1)),b=install(at(2,1));seed(site,a,wet(0,1));seed(site,b,mix(2));
 assert.ok(a.pipe.heat>b.pipe.heat);assert.ok(gasPressure(a)<gasPressure(b));const gas=sumGas(site),heat=sumHeat(site);
 updateGasNetworks(s);close(gasAmount(a.pipe.gas),1.5);close(gasAmount(b.pipe.gas),1.5);close(nodeKelvin(a.pipe),K);close(nodeKelvin(b.pipe),K);
 conservedGas(site,gas);close(sumHeat(site),heat);validateGasNetworks(s);
});

test('mixed hot vapor and cold dry gas conserve species and enthalpy during equalization',()=>{
 const {s,site,at}=fixture(),a=install(at(1,1)),b=install(at(2,1));seed(site,a,wet(2,3),500);seed(site,b,mix(1),150);
 const gas=sumGas(site),heat=sumHeat(site);updateGasNetworks(s);assert.ok(gasAmount(b.pipe.gas)>1);assert.ok(b.pipe.gas.vapor>0);
 conservedGas(site,gas);close(sumHeat(site),heat);validateGasNetworks(s);
});

test('condensate occupies gas capacity and physical volume without joining mobile payload',()=>{
 const {s,site,at}=fixture(),tank=install(at(1,1),'gasTank');tank.gasStore.condensate={water:79,heat:79*K};tank.machine={enabled:true,input:{air:4}};
 close(gasNominalVolume(tank),2);close(gasVolumeForWater(tank,40),1);close(gasVolume(tank),.025);close(gasPayload(tank),0);
 updateGasNetworks(s);close(gasPayload(tank),1);close(tank.machine.input.air,3);close(gasPressure(tank),400);close(tank.gasStore.condensate.water,79);
 updateGasNetworks(s);close(gasPayload(tank),1);close(tank.machine.input.air,3);assert.equal(gasStatus(site,tank).status,'Connected');
});

test('fully condensed equipment has no gas volume or pressure and cannot admit gas',()=>{
 const {s,site,at}=fixture(),tank=install(at(1,1),'gasTank');tank.gasStore.condensate={water:80,heat:0};tank.machine={enabled:true,input:{air:4}};
 updateGasNetworks(s);close(gasVolume(tank),0);close(gasPressure(tank),0);close(gasPayload(tank),0);close(tank.machine.input.air,4);
 tank.gasStore.gas.oxygen=.1;tank.gasStore.heat=gasEnergy(tank.gasStore.gas,K);assert.throws(()=>validateGasNetworks(s),/contents/);
});

test('CO2 filtering exports only dry species energy from a wet room',()=>{
 const {s,site,at}=fixture(),extractor=install(at(2,2),'gasExtractor'),r=room({...wet(7,3),co2:3});site.rooms=[r];
 const pay=funding(s,site,extractor),heat=sumHeat(site),before=r.heat;pay();updateGasNetworks(s);close(extractor.gasStore.gas.co2,2);close(extractor.gasStore.gas.vapor,0);close(r.gas.vapor,3);
 close(site.gasWork.work,0);close(site.gasWork.motorRoom,3);close(before-r.heat+site.gasWork.motorRoom,parcelHeat(2,K));
 close(nodeKelvin(extractor.gasStore),K);close(roomKelvin({...r,heat:r.heat-site.gasWork.motorRoom}),K);assert.ok(roomKelvin(r)>K);close(sumHeat(site),heat);validateGasNetworks(s);
});

test('a wet supply vent stops at actual pressure and carries vapor enthalpy',()=>{
 const {s,site,at}=fixture(),vent=install(at(2,2),'gasVent'),r=room(mix(9.8));site.rooms=[r];seed(site,vent,wet(2,2),400);
 const pay=funding(s,site,vent),gas=sumGas(site),heat=sumHeat(site);pay();updateGasNetworks(s);close(roomPressure(r),100);assert.ok(r.gas.vapor>0);assert.ok(gasPayload(vent)>3);
 conservedGas(site,gas);close(sumHeat(site),heat);validateGasNetworks(s);
});

test('node exterior release exports each species and its full latent plus sensible energy',()=>{
 const {s,site,at}=fixture(),p=install(at(1,1));p.building=null;seed(site,p,wet(1,2),350,.2);
 const gas=sumGas(site),heat=sumHeat(site);releaseGas(s,site,p,Infinity,'damaged');conservedGas(site,gas);close(sumHeat(site),heat);
 close(site.atmosphere.vented.vapor,2);close(site.gasNetwork.vented.vapor,2);close(p.pipe.heat,0);close(gasPayload(p),0);validateGasNetworks(s);
});

test('airlock forecast mixes finite wet supply and excludes retained condensate headroom',()=>{
 const {s,site,at}=fixture(),tank=install(at(2,2),'gasTank'),chamber=room(mix(.2)),habitat=room(mix(10),K,['4,4']);site.rooms=[chamber,habitat];
 seed(site,tank,wet(14,6),330,.2);tank.gasStore.condensate={water:5,heat:5*K};
 const layout={room:chamber,habitat,phaseNodes:{recover:[tank],refill:[tank]},recoveryNodes:[],storageNodes:[tank]},q=airlockGasQuantities(layout),plan=airlockFillPlan(chamber,q,100),predicted=airlockResourceStatus(layout,'refill',false).predicted;
 close(q.supply,20);close(q.supplyGas.vapor,6);close(q.supplyHeat,tank.gasStore.heat);close(q.headroom,gasCapacity(tank)-20-.2-5);
 const expected={...chamber,gas:{...chamber.gas},heat:chamber.heat+plan.heat};addGas(expected.gas,plan.gas);close(roomPressure(expected),100);
 const fraction=predicted.fillAmount/q.supply;releaseGas(s,site,tank,predicted.fillAmount*(20.2/20),'vent');const actual=airlockRoomReading(chamber);
 for(const k of GASES)close(actual.gas[k],predicted.gas[k],k);for(const k of ['pressure','temperature','heat','oxygenPressure'])close(actual[k],predicted[k],k);
 close(actual.gas.vapor,6*fraction);close(tank.gasStore.condensate.water,5);
});

test('water vapor cannot dilute an unsafe dry CO2 fraction',()=>{
 const r=room({oxygen:2.1,inert:7.65,co2:.25,vapor:4});close(roomPressure(r),140);assert.equal(breathingBlock(r),'high_co2');close(r.co2Fraction,.025);
});

test('suit charging removes oxygen enthalpy and leaves room vapor in place',()=>{
 const {site,at}=fixture(),r=room(wet(10,1)),c={id:'crew:1',site:'test',x:2,y:2,z:0,health:100,oxygen:90};at(2,2).building=null;site.rooms=[r];
 const before=r.heat,result=breatheBatch(site,[c]).get(c.id);close(result.refillOxygen,.2);close(r.gas.vapor,1);close(before-r.heat,parcelHeat(.2,K));close(roomKelvin(r),K);
});

test('room exposure exports vapor with its full energy while preserving the local balance',()=>{
 const {s,site,at}=fixture(),r=room(wet(5,5));site.rooms=[r];at(2,2).building=null;at(2,1).building=null;at(2,1).terrain='ground';
 const gas=sumGas(site),heat=sumHeat(site);updateAtmosphere(s);assert.ok(site.atmosphere.vented.vapor>0);conservedGas(site,gas);close(sumHeat(site),heat);close(roomKelvin(r),K);
});

test('current network admission requires vapor explicitly while legacy mode requires three species',()=>{
 const {s,site,at}=fixture(),p=install(at(1,1));seed(site,p,mix(2));validateGasNetworks(s);
 for(const gas of [p.pipe.gas,...['loaded','extracted','delivered','vented'].map(k=>site.gasNetwork[k])])delete gas.vapor;
 assert.throws(()=>validateGasNetworks(s),/ledger/);assert.doesNotThrow(()=>validateGasNetworks(s,{legacyVapor:true}));
 p.pipe.gas.vapor=0;assert.throws(()=>validateGasNetworks(s,{legacyVapor:true}),/contents/);
});

test('node vapor phase counters participate in the gas balance and latent heat admission',()=>{
 const {s,site,at}=fixture(),p=install(at(1,1));seed(site,p,wet(1,2));p.pipe.gas.vapor-=.5;p.pipe.heat=gasEnergy(p.pipe.gas,K);p.pipe.condensate={water:.5,heat:.5*K};site.vapor.nodeCondensed=.5;
 validateGasNetworks(s);site.vapor.nodeCondensed=0;assert.throws(()=>validateGasNetworks(s),/balance/);site.vapor.nodeCondensed=.5;
 p.pipe.heat=gasLatentHeat(p.pipe.gas)-.01;assert.throws(()=>validateGasNetworks(s),/heat/);
});


test('dismantling releases retained condensate on its actual deck and exports inaccessible excess',()=>{
 const {s,site,at}=fixture();site.levels=[{z:0},{z:1}];site.tiles.push(...site.tiles.map(t=>({...t,z:1})));
 const ground=at(2,2),upper=site.tiles[25+2*5+2];ground.building=null;upper.building=null;install(upper);upper.pipe.condensate={water:5,heat:5*K};site.vapor.nodeCondensed=5;
 removeGas(s,site,upper,true);assert.equal(upper.pipe,null);close(ground.liquid,0);close(upper.liquid,4);close(upper.liquidHeat,4*K);
 close(site.liquids.released,4);close(site.vapor.condensateReleased,4);close(site.vapor.condensateLost,1);close(site.thermal.waterRemoved,K);
 close(upper.liquidHeat+site.thermal.waterRemoved,5*K);
});

test('room-to-room mixing transports the snapshot composition and its complete enthalpy',()=>{
 const {s,site,at}=fixture(),left=room(wet(5,5),K,['1,2']),right=room(mix(10),K,['3,2']);site.rooms=[left,right];
 at(1,2).building=null;at(3,2).building=null;Object.assign(at(2,2),{building:'door',doorMode:'open',doorUntil:0});
 const gas=sumGas(site),heat=sumHeat(site);updateAtmosphere(s);assert.ok(right.gas.vapor>0);assert.ok(left.gas.vapor<5);
 conservedGas(site,gas);close(sumHeat(site),heat);close(roomKelvin(left),K);close(roomKelvin(right),K);
});
