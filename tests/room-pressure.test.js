import {withThermalRoundoff} from './helpers/pressure-migration.js';
import {projectPreGasHeat} from './helpers/legacy-projection.js';
import {roomHeatCapacity,roomKelvin} from '../src/gas-thermal.js';
import {initializeStorage} from '../src/inventory.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,at,step,serialize,deserialize} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {executeAction} from '../src/controls.js';
import {roomPressure,roomOxygenPressure,roomPressureFactor,gasAtRoomPressure,REFERENCE_KELVIN} from '../src/room-pressure.js';
import {refreshRoom,refreshAtmosphere,updateAtmosphere,updateRooms,roomAt,fillRoom,breathable,breathingBlock,breatheBatch,gasAmount} from '../src/atmosphere.js';
import {updateThermal,temperature,validateThermal} from '../src/thermal.js';
import {ignite} from '../src/fire.js';
import {initializeReactorTile,generateReactor,releaseReactorHeat,radiatorBlock} from '../src/reactors.js';
import {observe} from '../src/telemetry.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const room=(kelvin=REFERENCE_KELVIN)=>({volume:1,gasThermal:true,heat:22*kelvin,gas:{oxygen:2.1,inert:7.9,co2:0},smoke:0,cells:['3,3'],z:0,sealed:true});
function setKelvin(site,r,k){const heat=roomHeatCapacity(r)*k,change=heat-r.heat;site.thermal[change>=0?'added':'removed']+=Math.abs(change);r.heat=heat;}
function twoRooms(){
 const s=createGame(74254),site=s.sites.surface;
 for(const t of site.tiles){t.terrain='ground';t.building=null;delete t.stock;delete t.machine;}
 site.rooms=[];delete site.atmosphere;
 for(let y=2;y<=6;y++)for(let x=2;x<=8;x++){const t=at(site,x,y);t.terrain='floor';if(x===2||x===8||y===2||y===6||x===5)t.building='wall';}
 const door=at(site,5,4);door.building='door';door.doorMode='open';updateRooms(site);return {s,site,left:roomAt(site,3,3),right:roomAt(site,6,3)};
}
// Synthetic thermal arrangements isolate pressure and finite transfer rules.
// The final case uses ordinary paid construction and player commands only.
test('reference, doubled and halved absolute temperature share one pure pressure law',()=>{
 for(const factor of [.5,1,2]){const r=room(REFERENCE_KELVIN*factor),before=JSON.stringify(r);close(roomPressure(r),100*factor);close(roomOxygenPressure(r),.21*factor);close(roomPressureFactor(r),factor);assert.equal(JSON.stringify(r),before);}
 const r=room();delete r.heat;close(roomPressure(r),100);
});
test('inverse targets and fill preserve requested pressure across temperatures',()=>{
 for(const k of [200,293.15,400]){const r=room(k);close(gasAtRoomPressure(r,100),10*293.15/k);fillRoom(r,80);close(roomPressure(r),80);close(r.pressure,80);close(r.oxygenFraction,.21);}
});
test('zero Kelvin has zero pressure and no unbounded positive target',()=>{
 const r=room(0);refreshRoom(r);assert.equal(r.pressure,0);assert.equal(gasAtRoomPressure(r,100),null);assert.equal(gasAtRoomPressure(r,0),0);assert.equal(breathingBlock(r),'low_pressure');assert.throws(()=>fillRoom(r,100),/cannot be reached/);assert.ok(!JSON.stringify(r).includes('null'));
});
test('breathing uses current temperature and composition even with stale display caches',()=>{
 const r=room();refreshRoom(r);assert.equal(breathable(r),true);r.heat*=2;assert.equal(r.pressure,100);assert.equal(breathingBlock(r),'high_pressure');r.heat/=2;r.gas.co2=.3;assert.equal(r.co2Fraction,0);assert.equal(breathingBlock(r),'high_co2');
});
test('optional suit refill retains the temperature-adjusted oxygen floor',()=>{
 const r=room(REFERENCE_KELVIN*.5);r.volume=1;r.cells=['3,3'];r.gas={oxygen:3.265,inert:16,co2:0};r.heat=roomHeatCapacity(r)*REFERENCE_KELVIN*.5;refreshRoom(r);
 const site={id:'surface',thermal:{gasVented:0},rooms:[r],atmosphere:{tick:0,vented:{oxygen:0,inert:0,co2:0},injected:{oxygen:0,inert:0,co2:0},breathed:0,refilled:0}},c={id:'crew-0',site:'surface',x:3,y:3,z:0,health:100,job:null,oxygen:50};
 const total=gasAmount(r.gas)+c.oxygen*.1;breatheBatch(site,[c]);assert.ok(roomOxygenPressure(r)>=.16-Number.EPSILON*.16);assert.ok(c.oxygen>50&&c.oxygen<52);close(gasAmount(r.gas)+c.oxygen*.1,total);close(r.gas.oxygen,3.2);
});
test('equal gas densities flow from hotter to colder room without changing heat or species totals',()=>{
 const f=twoRooms();for(const r of [f.left,f.right])r.gas={oxygen:2.1*r.volume,inert:7.9*r.volume,co2:0};setKelvin(f.site,f.left,400);setKelvin(f.site,f.right,200);refreshAtmosphere(f.site);
 const before=f.left.gas.oxygen,totals=['oxygen','inert','co2'].map(k=>f.left.gas[k]+f.right.gas[k]),heat=[f.left.heat,f.right.heat];f.s.tick++;updateAtmosphere(f.s);
 assert.ok(f.left.gas.oxygen<before);close(f.left.heat+f.right.heat,heat[0]+heat[1]);assert.ok(f.left.heat<heat[0]&&f.right.heat>heat[1]);['oxygen','inert','co2'].forEach((k,i)=>close(f.left.gas[k]+f.right.gas[k],totals[i]));assert.ok(f.left.pressure>f.right.pressure);
});
test('equal pressures with different temperatures do not cause a net quantity transfer',()=>{
 const f=twoRooms();setKelvin(f.site,f.left,400);setKelvin(f.site,f.right,200);fillRoom(f.left,100);fillRoom(f.right,100);const amounts=[gasAmount(f.left.gas),gasAmount(f.right.gas)];f.s.tick++;updateAtmosphere(f.s);close(gasAmount(f.left.gas),amounts[0]);close(gasAmount(f.right.gas),amounts[1]);
});
test('thermal updates refresh atmosphere before consumers and preserve gas',()=>{
 const s=createGame(74254),site=s.sites.surface,r=site.rooms[0],gas={...r.gas},pressure=r.pressure;updateThermal(s);assert.deepEqual(r.gas,gas);assert.notEqual(r.pressure,pressure);close(r.pressure,roomPressure(r));validateThermal(s);
});
test('reactor removal immediately updates room pressure and near-vacuum radiator decisions',()=>{
 const s=createGame(74254),site=s.sites.surface,r=site.rooms[0],t=at(site,12,10);t.building='reactor';initializeReactorTile(t);initializeStorage(t);at(site,8,10).stock.fuel-=1;t.machine.input.fuel=1;generateReactor(s,site,t,40);const pressure=r.pressure,gas={...r.gas};releaseReactorHeat(s,site,t);assert.ok(r.pressure>pressure);close(r.pressure,roomPressure(r));assert.deepEqual(r.gas,gas);
 t.building='radiator';t.radiator={enabled:true};r.pressure=0;assert.equal(radiatorBlock(site,t),'Needs exterior or near-vacuum');
});
test('fire oxygen threshold uses partial pressure at actual temperature',()=>{
 const s=createGame(74254),site=s.sites.surface,r=site.rooms[0],t=at(site,12,10);t.building='bunk';r.gas={oxygen:r.volume*1.2,inert:r.volume*8.8,co2:0};setKelvin(site,r,REFERENCE_KELVIN*.8);assert.equal(ignite(s,site,t),false);setKelvin(site,r,REFERENCE_KELVIN*1.2);assert.equal(ignite(s,site,t),true);
});
const oldRaw=gunzipSync(readFileSync(new URL('./fixtures/room-pressure-schema74.json.gz',import.meta.url))).toString();
function physical(s){const v=projectPreGasHeat(s);delete v.version;for(const site of Object.values(v.sites)){delete site.air;for(const r of site.rooms){delete r.pressure;delete r.air;}}return v;}
test('genuine schema74 validates old readings then preserves every physical field during migration',()=>{
 assert.equal(createHash('sha256').update(oldRaw).digest('hex'),'88839da9461332afcd8320326c5a2db920aa9ad3f57a5e5e951c26cb61a09a1a');const old=JSON.parse(oldRaw),s=deserialize(oldRaw);assert.equal(s.version,VERSION);assert.deepEqual(withThermalRoundoff(physical(s),physical(old)),physical(old));const r=s.sites.surface.rooms[0];assert.notEqual(r.pressure,old.sites.surface.rooms[0].pressure);close(r.pressure,gasAmount(r.gas)/(r.volume*10)*100*(roomKelvin(r)/293.15));assert.equal(serialize(deserialize(serialize(s))),serialize(s));
 const before=serialize(s);observe(s);assert.equal(serialize(s),before);old.sites.surface.rooms[0].pressure+=1;assert.throws(()=>deserialize(JSON.stringify(old)),/Room readings/);
});
test('current saves reject old-law display tampering and accept a bounded zero-K state',()=>{
 const s=deserialize(oldRaw),r=s.sites.surface.rooms[0],bad=JSON.parse(serialize(s));bad.sites.surface.rooms[0].pressure=100;assert.throws(()=>deserialize(JSON.stringify(bad)),/Room readings/);
 setKelvin(s.sites.surface,r,0);refreshAtmosphere(s.sites.surface);const text=serialize(s);assert.equal(serialize(deserialize(text)),text);assert.equal(r.pressure,0);
});
test('a normally paid climate unit changes pressure through shared player commands',()=>{
 const s=createGame(74254),act=(id,args)=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);};
 for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')act('production.enable',{site:site.id,x:t.x,y:t.y,z:t.z,enabled:false});
 act('job.order',{site:'surface',x:12,y:10,z:0,kind:'build',building:'climate'});for(let n=0;n<50&&s.jobs.some(j=>j.kind==='build');n++)step(s);assert.equal(at(s.sites.surface,12,10).building,'climate');
 act('climate.configure',{site:'surface',x:12,y:10,z:0,target:35,enabled:true});const r=roomAt(s.sites.surface,12,10),before=temperature(r);step(s,6);assert.ok(temperature(r)>before);close(r.pressure,roomPressure(r));assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});
