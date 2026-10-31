import test from 'node:test';
import assert from 'node:assert/strict';
import { seedNaturalLiquids, validateEnvironment, localTemperatureOffset, retainedWaterDepth } from '../src/environment.js';
import { initializeLiquids, flowLiquids, pumpLiquids, validateLiquids } from '../src/liquids.js';
import { initializeThermal, updateThermal, validateThermal, temperature, temperatureAt, thermalExposure, remapThermal, HEAT_CAPACITY } from '../src/thermal.js';
import { updateFlora, floraStatus } from '../src/flora.js';
import { neighbors } from '../src/hex.js';
import { updateAnimalHealth } from '../src/animal-health.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} should equal ${b}`);
const water=site=>site.tiles.reduce((sum,tile)=>sum+tile.liquid,0);
const at=(site,x=2,y=2,z=0)=>site.tiles[z*site.size*site.size+y*site.size+x];
function fixture({room=false,walls=false,upper=false}={}) {
  const size=7,site={id:'surface',kind:'surface',size,levels:upper?[{z:0},{z:1}]:[{z:0}],rooms:[],atmosphere:{tick:0},tiles:[]};
  for(let z=0;z<(upper?2:1);z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)site.tiles.push({x,y,z,terrain:'ground',building:null,hp:100,powered:false});
  if(room){
    at(site).terrain='floor';
    site.rooms.push({z:0,cells:['2,2'],volume:1,gas:{oxygen:2.1,inert:7.9,co2:0},smoke:0});
    if(walls)for(const [x,y] of neighbors(2,2))at(site,x,y).building='wall';
  }
  const s={tick:0,sites:{surface:site},crew:[]};
  initializeLiquids(s);initializeThermal(s);return {s,site,t:at(site)};
}
function natural(tile,{offset=0,basin=0,initialWater}={}) {
  Object.assign(tile,{biome:'water_basin',temperatureOffset:offset,basin});
  if(initialWater!==undefined)tile.initialWater=initialWater;
  return tile;
}

test('legacy tiles and ledgers receive no natural water or temperature changes',()=>{
  const {s,site,t}=fixture({upper:true}),before=JSON.stringify(s);
  assert.equal(seedNaturalLiquids(site),0);assert.equal(JSON.stringify(s),before);
  assert.equal(Object.hasOwn(site.liquids,'initial'),false);
  assert.equal(localTemperatureOffset(t),0);assert.equal(retainedWaterDepth(t),0);
  assert.equal(temperatureAt(site,t.x,t.y),8);assert.equal(temperatureAt(site,t.x,t.y,1),8);
  validateEnvironment(s);validateLiquids(s);validateThermal(s);
});

test('natural water seeds once, remains finite in a basin, and drains through a real pump',()=>{
  const {s,site,t}=fixture();natural(t,{basin:2,initialWater:2});
  assert.throws(()=>validateEnvironment(s),/unseeded/);
  assert.equal(seedNaturalLiquids(site),2);assert.equal(t.liquid,2);assert.equal(site.liquids.initial,2);
  assert.equal(Object.hasOwn(t,'initialWater'),false);assert.equal(seedNaturalLiquids(site),0);
  for(let i=0;i<12;i++){s.tick=i;flowLiquids(s);}
  close(t.liquid,2);close(site.liquids.lost,0);
  const [x,y]=neighbors(t.x,t.y)[0],pump=at(site,x,y);
  Object.assign(pump,{terrain:'floor',building:'bilgePump',powered:true,machine:{enabled:true,output:{}}});
  for(let i=0;i<4;i++)pumpLiquids(s);
  close(pump.machine.output.water,2);close(t.liquid,0);close(site.liquids.recovered,2);
  flowLiquids(s);pumpLiquids(s);assert.match(pump.machine.status,/dry/);
  close(water(site)+site.liquids.recovered+site.liquids.lost,2);
  validateEnvironment(s);validateLiquids(s);
});

test('water above basin depth flows through ordinary finite edges and accounts for drainage',()=>{
  const {s,site,t}=fixture();natural(t,{basin:2,initialWater:4});seedNaturalLiquids(site);
  flowLiquids(s);assert.ok(t.liquid<4&&t.liquid>=2);assert.ok(site.tiles.some(other=>other!==t&&other.liquid>0));
  assert.ok(site.liquids.lost>0);
  for(let i=0;i<25;i++){s.tick=i;flowLiquids(s);}
  assert.ok(t.liquid>=2);close(water(site)+site.liquids.lost,4);validateLiquids(s);
});

test('natural retention ends when ground is covered; basin metadata cannot retain upper-floor water',()=>{
  const {s,site,t}=fixture();natural(t,{basin:2,initialWater:2});seedNaturalLiquids(site);
  t.terrain='floor';assert.equal(retainedWaterDepth(t),0);flowLiquids(s);assert.ok(t.liquid<2);
  assert.equal(retainedWaterDepth({...t,terrain:'ore'}),0);
  assert.equal(retainedWaterDepth({...t,terrain:'ground',z:1}),0);
  assert.equal(localTemperatureOffset({...t,temperatureOffset:25,z:1}),0);
  validateEnvironment(s);validateLiquids(s);
});

test('saved environmental fields and initial water ledger enforce exact bounded types',()=>{
  const invalid=[['biome',null],['biome','unknown'],['biome',{}],['temperatureOffset','3'],['temperatureOffset',3.5],['temperatureOffset',26],['temperatureOffset',-26],['temperatureOffset',null],['basin',NaN],['basin',Infinity],['basin',-1],['basin',2.01],['basin','1'],['initialWater',0]];
  for(const [field,value] of invalid){const {s,t}=fixture();t[field]=value;assert.throws(()=>validateEnvironment(s),Error,field);}
  const upper=fixture({upper:true});at(upper.site,2,2,1).biome='water_basin';assert.throws(()=>validateEnvironment(upper.s),/ground deck/);
  for(const value of [null,false,'1',-1,Infinity,197]){
    const {s,site}=fixture();site.liquids.initial=value;assert.throws(()=>validateEnvironment(s),/ledger/);assert.throws(()=>validateLiquids(s),/ledger/);
  }
  const valid=fixture();natural(valid.t,{offset:-25,basin:2});validateEnvironment(valid.s);
});

test('invalid natural water seeds fail before any tile or ledger changes',()=>{
  for(const value of [-1,4.1,NaN,Infinity,null,'2']){
    const {site,t}=fixture();natural(t,{basin:2,initialWater:1});const other=natural(at(site,3,3),{basin:2});other.initialWater=value;
    assert.throws(()=>seedNaturalLiquids(site));assert.equal(t.liquid,0);assert.equal(t.initialWater,1);assert.equal(site.liquids.initial,undefined);
  }
  const {site,t}=fixture();natural(t,{initialWater:1});t.terrain='floor';assert.throws(()=>seedNaturalLiquids(site),/unseeded/);
});

test('local exterior temperatures change crew exposure and actual native flora growth',()=>{
  const {s,site,t}=fixture({upper:true});at(site,2,2,1).terrain='void';natural(t,{offset:-25});
  t.flora={sunberry:{biomass:50,harvests:0,origin:'native',generation:'native'}};
  const c={x:t.x,y:t.y,z:0,thermalStress:0};thermalExposure(c,site,false);
  assert.equal(temperatureAt(site,t.x,t.y),-17);assert.ok(c.thermalStress<0);
  assert.equal(temperatureAt(site,t.x,t.y,1),8);
  assert.match(floraStatus(s,site,t)[0].growthReason,/Dormant at -17/);
  s.tick=30;updateFlora(s);assert.equal(t.flora.sunberry.biomass,50);
  t.temperatureOffset=12;assert.equal(temperatureAt(site,t.x,t.y),20);
  updateFlora(s);assert.equal(t.flora.sunberry.biomass,51);
});

for(const walls of [false,true])test(`biome boundary temperatures conduct real room heat through ${walls?'closed walls':'exposed edges'}`,()=>{
  const cold=fixture({room:true,walls}),warm=fixture({room:true,walls});
  for(const f of [cold,warm])for(const tile of f.site.tiles)natural(tile,{offset:f===cold?-25:25});
  for(const f of [cold,warm]){
    assert.equal(temperatureAt(f.site,2,2),20);updateThermal(f.s);validateThermal(f.s);
    close(f.site.rooms[0].heat,f.site.thermal.initial+f.site.thermal.environmentIn-f.site.thermal.environmentOut);
  }
  assert.ok(temperature(cold.site.rooms[0])<20);assert.ok(temperature(warm.site.rooms[0])>20);
  assert.ok(cold.site.thermal.environmentOut>0);assert.ok(warm.site.thermal.environmentIn>0);
});

test('new room thermal mass uses its local exterior temperature and preserves the finite heat ledger',()=>{
  const {s,site,t}=fixture();natural(t,{offset:15});t.terrain='floor';
  const room={z:0,cells:['2,2'],volume:1};remapThermal(site,[],[room]);site.rooms=[room];
  close(temperature(room),23);close(site.thermal.added,HEAT_CAPACITY*(273.15+23));validateThermal(s);
  const before=room.heat;remapThermal(site,[room],[{...room}]);close(site.thermal.added,before);
});


test('crew and animal thermal recovery produces canonical zero for exact save continuation',()=>{
  const {s,site}=fixture();
  for(const stress of [-.2,.2,-0]){
    const crew={x:2,y:2,z:0,thermalStress:stress};
    thermalExposure(crew,site,false);assert.equal(crew.thermalStress,0);
    assert.deepEqual(JSON.parse(JSON.stringify(crew)),crew);
    const animal={id:'animal-zero-test',species:'bristleback',site:'surface',x:2,y:2,z:0,health:100,fed:60,
      condition:{injury:0,treated:0,thermalStress:stress,cause:null,recovery:'none'}};
    updateAnimalHealth(s,animal);assert.equal(animal.condition.thermalStress,0);
    assert.deepEqual(JSON.parse(JSON.stringify(animal)),animal);
  }
});
