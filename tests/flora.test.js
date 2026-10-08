import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeFlora, initializeCultivation, floraBiomass, floraStatus, updateFlora, consumeLichen, gatheringEligibility, gatheringJobValid, completeGathering, validateFlora, floraId } from '../src/flora.js';
import { foodOfKind, foodLots } from '../src/food-lots.js';
import { pastureRegions } from '../src/pastures.js';
import { createGame, at, step } from '../src/simulation.js';
import { newLifecycle } from '../src/breeding.js';
import { animalTraits, inheritGenome } from '../src/animal-traits.js';
import { startRecording, exportRecording } from '../src/telemetry.js';

function terrain(){
  const site={id:'surface',size:10,rooms:[],thermal:{ambient:8},tiles:Array.from({length:100},(_,i)=>({x:i%10,y:Math.floor(i/10),terrain:'ground',building:null,drop:null,hp:100}))};
  const s={seed:1728,rng:917,tick:0,sites:{surface:site}};initializeCultivation(s);return {s,site};
}
const plant=(tile,species,biomass=100,harvests=0)=>{tile.flora??={};return tile.flora[species]={biomass,harvests,origin:'native',generation:'native'};};
const gather=(tile,species,harvests=0)=>({id:'job-1',kind:'gather',site:'surface',x:tile.x,y:tile.y,building:null,plantSpecies:species,plantHarvests:harvests,plantGeneration:tile.flora[species].generation,work:species==='sunberry'?12:10,cost:{},materials:{},sources:[]});

test('new flora seeding is deterministic, distinct, finite and independent of simulation RNG',()=>{
  const {s,site}=terrain();site.tiles[22].terrain='ore';site.tiles[23].terrain='ice';site.tiles[24].building='wall';site.tiles[55].terrain='floor';site.tiles[56].terrain='floor';site.tiles[1].lichen=60;
  const copy=structuredClone(s),rng=s.rng;initializeFlora(s,{seedEdibles:true});initializeFlora(copy,{seedEdibles:true});initializeCultivation(s);initializeCultivation(copy);assert.deepEqual(s,copy);assert.equal(s.rng,rng);
  for(const species of ['fungalcap','sunberry']){const tiles=site.tiles.filter(t=>t.flora?.[species]);assert.equal(tiles.length,3);assert.deepEqual(tiles.map(t=>t.flora[species].biomass).sort((a,b)=>a-b),[10,45,100]);assert.ok(tiles.every(t=>t.terrain==='ground'&&!t.building));}
  assert.equal(floraBiomass(site.tiles[1]),60);assert.ok(site.tiles.every(t=>!t.flora?.fungalcap||!t.flora?.sunberry));
  const seeded=structuredClone(s);initializeFlora(s,{seedEdibles:true});assert.deepEqual(s,seeded);validateFlora(s);
});

test('legacy lichen converts exactly, including bare and covered patches, without edible gifts',()=>{
  const {s,site}=terrain();site.tiles[0].lichen=0;site.tiles[1].lichen=17.25;site.tiles[2].lichen=100;site.tiles[2].terrain='floor';
  initializeFlora(s);initializeCultivation(s);assert.deepEqual(site.tiles.slice(0,3).map(t=>t.flora.lichen),[{biomass:0,harvests:0,origin:'native',generation:'native'},{biomass:17.25,harvests:0,origin:'native',generation:'native'},{biomass:100,harvests:0,origin:'native',generation:'native'}]);
  assert.equal(s.rng,917);assert.ok(site.tiles.every(t=>!Object.hasOwn(t,'lichen')&&!t.flora?.fungalcap&&!t.flora?.sunberry));validateFlora(s);validateFlora(JSON.parse(JSON.stringify(s)));
  updateFlora(s);assert.equal(site.tiles[2].flora,undefined);assert.ok(site.tiles[0].flora.lichen);
});

test('native species pause outside their own temperature and daylight ranges',()=>{
  const {s,site}=terrain(),fungus=plant(site.tiles[0],'fungalcap',45),berry=plant(site.tiles[1],'sunberry',45),lichen=plant(site.tiles[2],'lichen',45);
  s.tick=30;updateFlora(s);assert.equal(fungus.biomass,46);assert.equal(berry.biomass,46);assert.equal(lichen.biomass,45);
  s.tick=240;site.thermal.ambient=-35;updateFlora(s);assert.equal(fungus.biomass,47);assert.equal(berry.biomass,46);assert.equal(lichen.biomass,47);assert.match(floraStatus(s,site,site.tiles[1])[0].growthReason,/Dormant/);
  site.thermal.ambient=8;assert.match(floraStatus(s,site,site.tiles[1])[0].growthReason,/daylight/);s.tick=270;updateFlora(s);assert.equal(berry.biomass,46);
  site.thermal.ambient=40;s.tick=300;updateFlora(s);assert.equal(fungus.biomass,48);assert.equal(berry.biomass,46);assert.equal(lichen.biomass,47);
  site.thermal.ambient=8;updateFlora(s);assert.equal(berry.biomass,47);assert.equal(floraStatus(s,site,site.tiles[1])[0].growthAllowed,true);
});

test('construction, fire and terrain remove flora; allowed boundaries and overlays retain it',()=>{
  const {s,site}=terrain();for(let i=0;i<7;i++){plant(site.tiles[i],'lichen',40);plant(site.tiles[i],'fungalcap',40);}
  site.tiles[0].building='husbandryPost';site.tiles[1].building='fence';site.tiles[2].building='pastureGate';site.tiles[3].terrain='floor';site.tiles[4].fire={id:'fire-1'};site.tiles[5].building='wall';site.tiles[6].cable={hp:100};site.tiles[6].waterPipe={hp:100};
  s.tick=1;updateFlora(s);assert.ok(site.tiles[0].flora.lichen);assert.equal(site.tiles[0].flora.fungalcap,undefined);
  for(const i of [1,2,6])assert.equal(floraBiomass(site.tiles[i],'fungalcap'),40);
  for(const i of [3,4,5])assert.equal(site.tiles[i].flora,undefined);
  site.tiles[3].terrain='ground';delete site.tiles[4].fire;site.tiles[5].building=null;s.tick=300;updateFlora(s);
  for(const i of [3,4,5])assert.equal(site.tiles[i].flora,undefined);validateFlora(s);
});

test('lichen consumption is bounded by actual canonical biomass and pasture sums share that pool',()=>{
  const {s,site}=terrain(),tile=site.tiles[11];plant(tile,'lichen',.5);plant(site.tiles[12],'lichen',20);plant(site.tiles[13],'fungalcap',100);
  assert.equal(pastureRegions(site).regions[0].lichen,20.5);assert.equal(consumeLichen(s,site,tile,5,'grazer-0'),.5);assert.equal(floraBiomass(tile),0);assert.equal(pastureRegions(site).regions[0].lichen,20);
  assert.equal(consumeLichen(s,site,tile,5,'grazer-0'),0);assert.equal(consumeLichen(s,site,tile,Infinity,'grazer-0'),0);assert.equal(floraBiomass(site.tiles[13],'fungalcap'),100);validateFlora(s);
});

test('partial lichen bites grant proportionate adult and juvenile nutrition in actual ecology',()=>{
  for(const juvenile of [false,true]){
    const s=createGame(),a=s.creatures[2],site=s.sites.surface,tile=at(site,a.x,a.y);s.tick=8;tile.flora={lichen:{biomass:.5,harvests:0,origin:'native',generation:'native'}};a.fed=50;
    if(juvenile){a.id='bristleback-999';s.nextId=1000;a.lifecycle=newLifecycle(0,s.creatures.slice(0,2).map(p=>p.id));a.genetics=inheritGenome(s.seed,s.creatures[0],s.creatures[1],'brood-998');}
    step(s);assert.ok(Math.abs(a.fed-(50-animalTraits(a)[juvenile?'juvenileMetabolism':'metabolism']+(juvenile?.8:.4)))<1e-9);assert.equal(floraBiomass(tile),0);
  }
});

test('mature harvesting changes one cycle atomically and regrowth creates no inventory food',()=>{
  const {s,site}=terrain(),tile=site.tiles[11];plant(tile,'fungalcap');plant(tile,'lichen',50);const j=gather(tile,'fungalcap');
  assert.equal(gatheringJobValid(s,j),true);assert.deepEqual(completeGathering(s,{id:'crew-0'},j),{ok:true});assert.deepEqual(tile.flora.fungalcap,{biomass:20,harvests:1,origin:'native',generation:'native'});assert.equal(floraBiomass(tile),50);assert.equal(foodOfKind(tile.drop,'fungalcap'),2);assert.equal(foodLots(tile.drop)[0].age,0);
  const after=structuredClone(s);assert.equal(completeGathering(s,{id:'crew-0'},j).ok,false);assert.deepEqual(s,after);
  for(let i=1;i<=80;i++){s.tick=i*30;updateFlora(s);assert.equal(tile.drop.food,2);}
  assert.equal(floraBiomass(tile,'fungalcap'),100);assert.equal(gatheringJobValid(s,j),false);assert.equal(completeGathering(s,{id:'crew-0'},gather(tile,'fungalcap',1)).ok,true);assert.equal(foodOfKind(tile.drop,'fungalcap'),4);assert.equal(tile.flora.fungalcap.harvests,2);validateFlora(s);
});

test('gathering rechecks species, maturity, cycle and hazards without granting early output',()=>{
  const {s,site}=terrain(),tile=site.tiles[11];plant(tile,'sunberry');const j=gather(tile,'sunberry');
  s.tick=240;site.thermal.ambient=-35;assert.equal(floraStatus(s,site,tile)[0].growthAllowed,false);assert.equal(gatheringEligibility(s,site,tile,'sunberry').ok,true);
  for(const mutate of [()=>tile.flora.sunberry.biomass=99,()=>tile.flora.sunberry.harvests=1,()=>tile.fire={id:'fire-1'},()=>tile.building='husbandryPost',()=>tile.terrain='floor']){
    tile.flora.sunberry={biomass:100,harvests:0,origin:'native',generation:'native'};delete tile.fire;tile.building=null;tile.terrain='ground';mutate();const before=structuredClone(s);assert.equal(completeGathering(s,{id:'crew-0'},j).ok,false);assert.deepEqual(s,before);
  }
});

test('strict flora validation rejects malformed maps, unknown or overlapping species and legacy shadows',()=>{
  for(const flora of [null,[],{unknown:{biomass:1,harvests:0}},{fungalcap:{biomass:101,harvests:0}},{lichen:{biomass:20,harvests:1}},{sunberry:{biomass:50,harvests:.5}},{fungalcap:{biomass:50,harvests:0,stage:'growing'}},{fungalcap:{biomass:50,harvests:0},sunberry:{biomass:50,harvests:0}}]){
    const {s,site}=terrain();site.tiles[0].flora=flora;assert.throws(()=>validateFlora(s),/flora/i);
  }
  const {s,site}=terrain();site.tiles[0].lichen=1;assert.throws(()=>validateFlora(s),/Legacy/);site.tiles[0].lichen=NaN;assert.throws(()=>initializeFlora(s),/legacy/i);
  delete site.tiles[0].lichen;plant(site.tiles[0],'fungalcap',100,Number.MAX_SAFE_INTEGER);assert.equal(gatheringEligibility(s,site,site.tiles[0],'fungalcap').code,'cycle_limit');
});

test('stage, harvest and removal events use stable plant IDs without changing RNG or recorded state',()=>{
  const s=createGame(),site=s.sites.surface,tile=at(site,12,20);tile.terrain='ground';tile.building=null;tile.flora={fungalcap:{biomass:99,harvests:0,origin:'native',generation:'native'}};
  const copy=structuredClone(s),rng=s.rng;startRecording(s);
  for(const state of [s,copy]){const t=at(state.sites.surface,12,20);state.tick=30;updateFlora(state);completeGathering(state,{id:'crew-0'},gather(t,'fungalcap'));t.building='wall';state.tick=31;updateFlora(state);}
  assert.deepEqual(s,copy);assert.equal(s.rng,rng);
  const events=exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event?.entity===floraId('surface',12,20,'fungalcap')).map(r=>r.event);
  assert.deepEqual(events.map(e=>e.id),['flora.stage.changed','flora.stage.changed','flora.harvested','flora.removed']);assert.equal(events[0].reason,'natural_growth');assert.equal(events[1].reason,'harvest');assert.equal(events[2].output.food,2);assert.equal(events[2].harvestsAfter,1);assert.equal(events[3].reason,'building');
});
