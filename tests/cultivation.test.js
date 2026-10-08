import test from 'node:test';
import assert from 'node:assert/strict';
import { CULTIVATION, FLORA } from '../src/flora-data.js';
import { initializeCultivation, plantingEligibility, wateringEligibility, cultivationJobValid, completePlanting, completeWatering, absorbCultivationWater, updateFlora, floraStatus, gatheringJobValid, completeGathering, validateCultivation, validateFlora } from '../src/flora.js';
import { initializeLiquids, flowLiquids, validateLiquids } from '../src/liquids.js';
import { typedFood, foodOfKind } from '../src/food-lots.js';
import { totalResources } from '../src/inventory.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function fixture(){
  const site={id:'surface',size:5,rooms:[],thermal:{ambient:8},atmosphere:{tick:0},tiles:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),terrain:'ground',building:null,drop:null,hp:100}))};
  const s={seed:1728,rng:917,tick:0,nextId:1,sites:{surface:site},crew:[],jobs:[]};initializeLiquids(s);initializeCultivation(s);
  return {s,site,tile:site.tiles[12]};
}
function plantJob(s,tile,species='fungalcap'){
  return {id:`job-${s.nextId++}`,kind:'plant',site:'surface',x:tile.x,y:tile.y,building:null,plantSpecies:species,cost:{food:1},foodKinds:{[species]:1},work:10,remaining:0,materials:typedFood(species,1),sources:[]};
}
function plant(f,species='fungalcap'){
  const j=plantJob(f.s,f.tile,species);f.s.jobs=[j];assert.equal(completePlanting(f.s,{id:'crew-0'},j).ok,true);f.s.jobs=[];
  return f.tile.flora[species];
}
function waterJob(s,tile,species='fungalcap'){
  return {id:`job-${s.nextId++}`,kind:'waterPlant',site:'surface',x:tile.x,y:tile.y,building:null,plantSpecies:species,plantGeneration:tile.flora[species].generation,cost:{water:.5},work:6,remaining:0,materials:{water:.5},sources:[]};
}
function water(f,species='fungalcap'){
  const j=waterJob(f.s,f.tile,species);f.s.jobs=[j];const result=completeWatering(f.s,{id:'crew-0'},j);assert.equal(result.ok,true);f.s.jobs=[];return result;
}
const gather=(tile,species)=>({id:'job-999',kind:'gather',site:'surface',x:tile.x,y:tile.y,building:null,plantSpecies:species,plantHarvests:tile.flora[species].harvests,plantGeneration:tile.flora[species].generation,work:FLORA[species].work,cost:{},materials:{},sources:[]});

test('planting requires a paid matching raw propagule and preserves native lichen',()=>{
  const f=fixture(),{s,site,tile}=f;tile.flora={lichen:{biomass:37,harvests:0,origin:'native',generation:'native'}};
  const j=plantJob(s,tile),before=structuredClone(s);
  const prepared={food:1,_food:[{amount:1,age:0,meal:{id:'meal-job-1',maker:'crew-0',quality:1,created:0}}]};
  for(const materials of [{},{food:1},typedFood('sunberry',1),typedFood('fungalcap',.5),prepared,{...typedFood('fungalcap',1),water:1}]){
    j.materials=materials;assert.equal(completePlanting(s,{id:'crew-0'},j).ok,false);assert.deepEqual(s,before);
  }
  j.materials=typedFood('fungalcap',1);const paid=structuredClone(j.materials);s.jobs=[j];const foodBefore=totalResources(s).food;
  assert.equal(completePlanting(s,{id:'crew-0'},j).ok,true);assert.deepEqual(j.materials,paid,'ordinary finish still owns materials');s.jobs=[];
  close(totalResources(s).food,foodBefore-1);assert.equal(tile.flora.lichen.biomass,37);assert.deepEqual(tile.flora.fungalcap,{biomass:20,harvests:0,origin:'cultivated',generation:j.id,moisture:0});
  assert.equal(plantingEligibility(s,site,tile,'sunberry').code,'occupied');assert.equal(wateringEligibility(s,site,tile,'lichen').ok,false);validateCultivation(s);
});

test('dormant planting is allowed; permanent hazards and malformed job requirements are rejected',()=>{
  const f=fixture(),{s,site,tile}=f;site.thermal.ambient=-100;s.tick=240;
  assert.equal(plantingEligibility(s,site,tile,'sunberry').ok,true);
  for(const mutate of [j=>j.cost={food:2},j=>j.foodKinds={sunberry:1},j=>j.work=9,j=>j.plantGeneration='native',j=>j.plantHarvests=0,j=>j.building='fungalcap']){
    const j=plantJob(s,tile);mutate(j);assert.equal(cultivationJobValid(s,j),false);
  }
  for(const mutate of [()=>tile.fire={id:'fire-1'},()=>tile.terrain='ore',()=>tile.building='wall']){
    tile.terrain='ground';tile.building=null;delete tile.fire;mutate();assert.equal(plantingEligibility(s,site,tile,'fungalcap').ok,false);
  }
  tile.terrain='ground';tile.building='fence';delete tile.fire;assert.equal(plantingEligibility(s,site,tile,'fungalcap').ok,true);
});

test('finite paid watering conserves moisture and returns in-flight saturation surplus',()=>{
  const f=fixture(),{s,site,tile}=f,patch=plant(f);water(f);water(f);
  const j=waterJob(s,tile);tile.liquid=.4;site.liquids.released=.4;close(absorbCultivationWater(s,site,tile,.4),.4);
  assert.equal(cultivationJobValid(s,j),true);s.jobs=[j];const before=totalResources(s).water,paid=structuredClone(j.materials);
  const result=completeWatering(s,{id:'crew-0'},j);assert.equal(result.ok,true);close(result.transferred,.1);close(result.returned,.4);assert.deepEqual(j.materials,paid);s.jobs=[];
  close(totalResources(s).water,before);close(patch.moisture,1.5);close(tile.drop.water,.4);close(site.cultivation.fungalcap.delivered,1.5);close(site.cultivation.fungalcap.returned,.4);
  assert.equal(wateringEligibility(s,site,tile,'fungalcap').code,'full');assert.equal(cultivationJobValid(s,j),true);
  const saturated=water(f);close(saturated.transferred,0);close(saturated.returned,.5);validateCultivation(s);validateLiquids(s);
  tile.building='wall';const total=totalResources(s).water;updateFlora(s);close(totalResources(s).water,total);close(tile.drop.water,2.4);close(site.cultivation.fungalcap.destroyed,20);close(site.cultivation.fungalcap.returned,2.4);validateCultivation(s);
});

test('each species grows a real watered 20→100 cycle, including the clamped final step',()=>{
  for(const species of ['fungalcap','sunberry']){
    const f=fixture(),{s,site,tile}=f,patch=plant(f,species),ledger=site.cultivation[species];
    s.tick=30;updateFlora(s);assert.equal(patch.biomass,20);assert.match(floraStatus(s,site,tile)[0].growthReason,/Dry/);
    for(let i=0;i<(species==='fungalcap'?2:3);i++)water(f,species);
    const initialWater=totalResources(s).water,copy=JSON.parse(JSON.stringify(s));validateCultivation(copy);
    for(let n=2;n<=100&&patch.biomass<100;n++)for(const state of [s,copy]){state.tick=n*30;updateFlora(state);}
    assert.deepEqual(s,copy);assert.equal(patch.biomass,100);close(ledger.grown,80);close(ledger.growthUsed,species==='fungalcap'?1:1.5);close(totalResources(s).water,initialWater-ledger.growthUsed);assert.equal(tile.drop,null);assert.equal(s.rng,917);
    const j=gather(tile,species);assert.equal(gatheringJobValid(s,j),true);assert.equal(completeGathering(s,{id:'crew-0'},j).ok,true);assert.equal(patch.biomass,20);assert.equal(foodOfKind(tile.drop,species),2);assert.equal(ledger.harvested,80);assert.equal(ledger.foodProduced,2);assert.equal(ledger.harvests,1);
    const after=structuredClone(s);assert.equal(completeGathering(s,{id:'crew-0'},j).ok,false);assert.deepEqual(s,after);validateCultivation(s);
  }
});

test('weather and darkness retain managed progress and water; native growth stays ambient',()=>{
  const f=fixture(),{s,site,tile}=f,patch=plant(f,'sunberry');water(f,'sunberry');
  site.tiles[11].flora={fungalcap:{biomass:20,harvests:0,origin:'native',generation:'native'},lichen:{biomass:20,harvests:0,origin:'native',generation:'native'}};
  site.thermal.ambient=-35;s.tick=60;updateFlora(s);assert.equal(patch.biomass,20);close(patch.moisture,.5);assert.equal(site.tiles[11].flora.fungalcap.biomass,21);assert.equal(site.tiles[11].flora.lichen.biomass,22);
  site.thermal.ambient=8;s.tick=240;updateFlora(s);assert.equal(patch.biomass,20);close(patch.moisture,.5);assert.match(floraStatus(s,site,tile)[0].growthReason,/daylight/);
  s.tick=300;updateFlora(s);assert.equal(patch.biomass,23);close(patch.moisture,.5-3*.01875);assert.match(floraStatus(s,site,tile)[0].name,/Cultivated/);validateCultivation(s);
});

test('replacement generations invalidate stale watering and gathering',()=>{
  const f=fixture(),{s,tile}=f;plant(f);const oldWater=waterJob(s,tile),oldGather=gather(tile,'fungalcap');
  tile.fire={id:'fire-1'};updateFlora(s);delete tile.fire;const replacement=plant(f);
  assert.notEqual(replacement.generation,oldWater.plantGeneration);assert.equal(cultivationJobValid(s,oldWater),false);assert.equal(gatheringJobValid(s,oldGather),false);
  const before=structuredClone(s);assert.equal(completeWatering(s,{id:'crew-0'},oldWater).ok,false);assert.deepEqual(s,before);validateCultivation(s);
});

test('floor absorption shares the original interior drainage budget and preserves edge losses',()=>{
  const f=fixture(),{s,site,tile}=f;plant(f);water(f);water(f);water(f);
  // Isolate the bed so floor leveling does not alter the drainage amount.
  for(const other of site.tiles)if(other!==tile)other.terrain='rock';tile.liquid=.5;site.liquids.released=.5;
  flowLiquids(s);close(site.liquids.absorbed,0);close(site.liquids.lost,.1);close(tile.liquid,.4);
  s.tick=30;updateFlora(s);const drained=1.5-tile.flora.fungalcap.moisture;flowLiquids(s);
  close(site.liquids.absorbed,drained);close(site.liquids.lost,.2-drained);close(tile.liquid,.3);validateLiquids(s);validateCultivation(s);
  const edge=site.tiles[0];edge.terrain='ground';edge.flora=tile.flora;delete tile.flora;edge.liquid=.5;site.liquids.released+=.5;
  const absorption=site.liquids.absorbed,lost=site.liquids.lost;flowLiquids(s);close(site.liquids.absorbed,absorption);close(site.liquids.lost-lost,.6);validateLiquids(s);validateCultivation(s);
});

test('legacy metadata migration preserves quantities and rejects malformed old shadows',()=>{
  const f=fixture(),{s,site,tile}=f;delete site.cultivation;delete site.liquids.absorbed;tile.flora={lichen:{biomass:17.25,harvests:0},fungalcap:{biomass:45,harvests:3}};tile.liquid=.75;site.liquids.released=.75;
  const rng=s.rng,water=totalResources(s).water;initializeCultivation(s,{legacy:true});close(totalResources(s).water,water);assert.equal(s.rng,rng);assert.equal(s.tick,0);assert.equal(tile.flora.lichen.biomass,17.25);assert.equal(tile.flora.fungalcap.harvests,3);assert.equal(tile.flora.fungalcap.origin,'native');assert.equal(site.liquids.released,.75);validateCultivation(s);validateLiquids(s);
  const canonical=structuredClone(s);initializeCultivation(s);assert.deepEqual(s,canonical);assert.throws(()=>initializeCultivation(s,{legacy:true}),/Legacy/);
  for(const patch of [{biomass:10,harvests:0,origin:'native'},{biomass:101,harvests:0},{biomass:1,harvests:0,stage:'sparse'},null]){
    const bad=fixture();delete bad.site.cultivation;delete bad.site.liquids.absorbed;bad.tile.flora={fungalcap:patch};const before=structuredClone(bad.s);assert.throws(()=>initializeCultivation(bad.s,{legacy:true}),/flora/);assert.deepEqual(bad.s,before);
  }
});

test('strict cultivation validation detects ledger, origin, generation and moisture corruption',()=>{
  for(const mutate of [f=>f.site.cultivation.fungalcap.grown=1,f=>f.site.cultivation.fungalcap.delivered=1,f=>f.site.cultivation.fungalcap.returned=-1,f=>f.site.cultivation.fungalcap.propagules=.5,f=>f.site.cultivation.fungalcap.extra=0,f=>f.tile.flora.fungalcap.moisture=2,f=>f.tile.flora.fungalcap.generation='native',f=>f.tile.flora.fungalcap.origin='native',f=>f.site.liquids.absorbed=.1]){
    const f=fixture();plant(f);mutate(f);assert.throws(()=>validateCultivation(f.s),/flora|Cultivation|cultivation/);
  }
  const f=fixture();f.tile.flora={lichen:{biomass:20,harvests:0,origin:'cultivated',generation:'job-1',moisture:0}};assert.throws(()=>validateFlora(f.s),/flora/);
});

test('finite planting and harvest counters cannot overflow safe integers',()=>{
  const f=fixture(),ledger=f.site.cultivation.fungalcap;ledger.propagules=Number.MAX_SAFE_INTEGER;ledger.planted=20*ledger.propagules;ledger.destroyed=ledger.planted;
  validateCultivation(f.s);assert.equal(plantingEligibility(f.s,f.site,f.tile,'fungalcap').code,'cycle_limit');
  const g=fixture();plant(g);const l=g.site.cultivation.fungalcap;l.harvests=Number.MAX_SAFE_INTEGER;l.harvested=80*l.harvests;l.foodProduced=2*l.harvests;l.grown=l.harvested;l.growthUsed=l.grown*.0125;l.delivered=l.growthUsed;
  assert.equal(completeGathering(g.s,{id:'crew-0'},gather(g.tile,'fungalcap')).ok,false);
  assert.equal(CULTIVATION.growthAmount,3);
});
