import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/simulation.js';
import { createSectorSite } from '../src/sector-generation.js';
import { sectorDefinition, sectorWorld } from '../src/sector-sites.js';
import { surfaceLayout, surfaceSurvey, wildlifeFor } from '../src/world-generation.js';
import { validateEnvironment } from '../src/environment.js';
import { validateThermal, outsideTemperature } from '../src/thermal.js';
import { validateLiquids } from '../src/liquids.js';
import { validateFlora, validateCultivation } from '../src/flora.js';
import { validateGasNetworks } from '../src/gas-networks.js';
import { validatePlumbing } from '../src/plumbing.js';
import { validateReactors } from '../src/reactors.js';
import { validatePower } from '../src/power.js';
import { validateFire } from '../src/fire.js';
import { validateWater } from '../src/water.js';
import { validateHusbandry } from '../src/husbandry.js';
import { validateBreeding } from '../src/breeding.js';
import { validateAnimalHealth } from '../src/animal-health.js';
import { validateAnimalTraits } from '../src/animal-traits.js';
import { validateCarcasses } from '../src/animal-carcasses.js';

function definition(s,dx=1){
  const planetId=s.region.sites.surface.planetId,world=sectorWorld(s,planetId);
  return sectorDefinition(s,{planetId,x:(world.landing.x+dx)%world.width,y:world.landing.y});
}
function detached(s,result){return {version:s.version,seed:s.seed,tick:s.tick,nextId:s.nextId,sites:{[result.site.id]:result.site},creatures:result.creatures,crew:[],jobs:[],log:[]};}
function objectSet(value,seen=new Set()){
  if(!value||typeof value!=='object'||seen.has(value))return seen;
  seen.add(value);for(const child of Object.values(value))objectSet(child,seen);return seen;
}
function freeze(value){for(const object of objectSet(value))Object.freeze(object);return value;}
const water=site=>site.tiles.reduce((sum,tile)=>sum+tile.liquid,0);

test('sector construction is detached, preserves the live colony and repeats deterministically',()=>{
  const s=createGame(74219),def=definition(s);s.tick=250;
  const before=JSON.stringify(s),owned=objectSet(s);freeze(s);
  const a=createSectorSite(s,def),b=createSectorSite(s,structuredClone(def));
  assert.equal(JSON.stringify(s),before);assert.deepEqual(a,b);
  const aObjects=objectSet(a);
  for(const object of aObjects)assert.equal(owned.has(object),false,'No live mutable owner may be reused.');
  for(const object of objectSet(b))assert.equal(aObjects.has(object),false,'Separate preparations must own separate objects.');
  assert.equal(a.site.atmosphere.tick,250);assert.equal(a.site.thermal.ambient,outsideTemperature(a.site,250));
  a.site.tiles[0].hp=42;a.creatures[0].condition.injury=5;
  assert.equal(b.site.tiles[0].hp,100);assert.equal(b.creatures[0].condition.injury,0);assert.equal(JSON.stringify(s),before);
});

test('prepared sector terrain, finite resources, flora and fauna match the same surveyed generator',()=>{
  const s=createGame(817),def=definition(s),world=sectorWorld(s,def.planetId),raw=surfaceLayout(world,def.sector,48),survey=surfaceSurvey(world,def.sector,48);
  const {site,creatures}=createSectorSite(s,def),biomes={},flora={lichen:0,fungalcap:0,sunberry:0};
  assert.equal(site.tiles.length,2304);
  let ore=0,ice=0;
  for(const [i,tile] of site.tiles.entries()){
    assert.equal(tile.terrain,raw[i].terrain);assert.equal(tile.temperatureOffset,raw[i].temperatureOffset);assert.deepEqual(tile.flora,raw[i].flora);
    assert.equal(Object.hasOwn(tile,'initialWater'),false);assert.equal(tile.liquid,raw[i].initialWater??0);
    biomes[tile.biome]=(biomes[tile.biome]||0)+1;
    for(const species of Object.keys(tile.flora??{}))flora[species]++;
    ore+=tile.terrain==='ore'?5:tile.terrain==='rock'?2:0;ice+=tile.deposit?.remaining??0;
  }
  assert.deepEqual(biomes,survey.biomes);assert.deepEqual(flora,survey.flora);
  assert.deepEqual({ore,ice,water:water(site)},survey.resources);assert.equal(site.liquids.initial,water(site));
  const expected=wildlifeFor(world,def.sector,raw);
  assert.deepEqual(creatures.map(({species,x,y,z})=>({species,x,y,z})),expected.map(({species,x,y,z})=>({species,x,y,z})));
  for(const [species,count] of Object.entries(survey.wildlife))assert.equal(creatures.filter(a=>a.species===species).length,count);
});

test('prepared destinations contain no free dock, supplies, equipment, power, gas or residence',()=>{
  const s=createGame(918),def=definition(s),{site,creatures}=createSectorSite(s,def);
  assert.equal(site.explored,false);assert.equal(site.kind,'surface');assert.deepEqual(site.rooms,[]);assert.equal(site.air,0);
  assert.deepEqual(site.verticalLinks,[]);assert.deepEqual(site.utilityLinks,[]);
  assert.ok(Object.values(site.energy).every(value=>value===0));assert.equal(site.thermal.initial,0);
  assert.ok(site.tiles.every(t=>t.building===null&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.stock&&!t.imports&&!t.drop&&!t.charge&&!t.machine));
  assert.equal(Object.hasOwn(site,'outpost'),false);assert.equal(Object.hasOwn(s.sites,def.id),false);
  const landing=site.tiles[def.landing.y*site.size+def.landing.x];
  assert.equal(landing.terrain,'ground');assert.equal(landing.liquid,0);assert.equal(landing.flora,undefined);assert.equal(landing.deposit,undefined);
  for(const a of creatures){assert.equal(a.husbandry.trust,0);assert.equal(a.husbandry.post,null);assert.equal(a.death,null);assert.equal(a.lifecycle.born,null);assert.deepEqual(a.lifecycle.parents,[]);assert.equal(a.lifecycle.enabled,false);assert.equal(a.condition.thermalStress,0);assert.equal(a.genetics.origin,'founder');}
});

test('all fresh site ledgers and native animal states pass their subsystem validation',()=>{
  const s=createGame(61),result=createSectorSite(s,definition(s)),state=detached(s,result);
  for(const validate of [validateEnvironment,validateThermal,validateLiquids,validateFlora,validateCultivation,validateWater,validateGasNetworks,validatePlumbing,validateReactors,validateFire,validateHusbandry,validateBreeding,validateAnimalHealth,validateAnimalTraits,validateCarcasses])assert.doesNotThrow(()=>validate(state),validate.name);
  assert.doesNotThrow(()=>validatePower(state,result.site));
});

test('sector wildlife identities remain globally disjoint and existing destinations are never regenerated',()=>{
  const s=createGame(74219),first=definition(s),second=definition(s,2),a=createSectorSite(s,first),b=createSectorSite(s,second);
  const ids=new Set(s.creatures.map(animal=>animal.id));
  for(const result of [a,b])for(const animal of result.creatures){assert.ok(animal.id.startsWith(result.site.id+'-'));assert.equal(animal.site,result.site.id);assert.equal(ids.has(animal.id),false);ids.add(animal.id);}
  s.sites[first.id]=a.site;s.creatures.push(...a.creatures);const before=JSON.stringify(s);
  assert.throws(()=>createSectorSite(s,first),/must not be regenerated/);assert.equal(JSON.stringify(s),before);
  s.creatures.push({...b.creatures[0]});assert.throws(()=>createSectorSite(s,second),/identity/);
});

test('invalid sector definitions fail without changing live state',()=>{
  const s=createGame(74219),def=definition(s),before=JSON.stringify(s);
  for(const change of [{id:'surface'},{kind:'wreck'},{template:'derelict'},{size:32},{sector:{x:-1,y:0}},{landing:{...def.landing,z:1}}]){
    assert.throws(()=>createSectorSite(s,{...def,...change}));assert.equal(JSON.stringify(s),before);
  }
});
