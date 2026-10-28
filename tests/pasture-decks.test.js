import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,serialize} from '../src/simulation.js';
import {tileAt,positionOf,horizontalNeighbors,cellKey} from '../src/spatial.js';
import {pastureRegions,animalPasture,setPastureGate,moveAnimal} from '../src/pastures.js';
import {breedingStatus,updateBreeding,BREEDING} from '../src/breeding.js';
import {startRecording,exportRecording,observe,TELEMETRY_VERSION} from '../src/telemetry.js';
import {initializeStorage} from '../src/inventory.js';
import {pastureDetails} from '../src/husbandry-panels.js';
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function stacked(){
 const s=createGame(74219),site=s.sites.surface,blank=site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.flora);
 site.levels.push({z:7,name:'Upper test deck'});
 for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z:7,terrain:'ground',building:null});
 for(const z of [0,7]){
  for(let y=15;y<=23;y++)for(let x=3;x<=9;x++)Object.assign(at(site,x,y,z),{terrain:'ground',building:x===3||x===9||y===15||y===23?'fence':null,hp:100,flora:{lichen:{biomass:z===0?80:20,harvests:0,origin:'native',generation:'native'}}});
  Object.assign(at(site,6,15,z),{building:'pastureGate',gateMode:'latched'});
 }
 const [a,b]=s.creatures;for(const [i,animal] of [a,b].entries()){Object.assign(animal,{x:6+i,y:18,z:0,fed:100,health:100});animal.husbandry.trust=100;animal.lifecycle.enabled=true;}
 return {s,site,a,b};
}

test('pasture topology, post routes and recorded cells distinguish overlapping decks',()=>{
 const {s,site,a,b}=stacked();b.z=7;const before=serialize(s),regions=pastureRegions(site),lower=regions.byCell.get(cellKey(a)),upper=regions.byCell.get(cellKey(b));
 assert.notEqual(lower,upper);assert.notEqual(lower.id,upper.id);assert.equal(lower.z,0);assert.equal(upper.z,7);assert.equal(lower.cells.length,35);assert.equal(upper.cells.length,35);assert.equal(lower.lichen,2800);assert.equal(upper.lichen,700);assert.ok(upper.cells.every(p=>p.z===7));assert.equal(serialize(s),before);
 b.husbandry.post={x:6,y:18,z:0};assert.equal(animalPasture(s,b).postReachable,false);b.husbandry.post.z=7;assert.equal(animalPasture(s,b).postReachable,true);
 at(site,6,15,7).gateMode='open';assert.equal(animalPasture(s,a).enclosed,true);assert.equal(animalPasture(s,b).enclosed,false);
 const observation=observe(s);assert.equal(observation.schemaVersion,TELEMETRY_VERSION);assert.deepEqual(observation.entities[lower.id].cells,lower.cells);
 at(site,6,18,7).building='husbandryPost';assert.match(pastureDetails(s,at(site,6,18,7)),/Open range/);
});

test('same horizontal coordinates do not create mates or let upper animals obstruct ground gates',()=>{
 const {s,site,a,b}=stacked();b.z=7;assert.equal(breedingStatus(s,a).reason,'no_compatible_mate');assert.equal(breedingStatus(s,b).reason,'no_compatible_mate');updateBreeding(s);assert.equal(a.lifecycle.brood,null);assert.equal(b.lifecycle.brood,null);
 Object.assign(b,{x:6,y:15,z:7});at(site,6,15).gateMode='open';assert.equal(setPastureGate(s,'surface',6,15,'latched').ok,true);
 assert.equal(moveAnimal(s,b,{x:6,y:16,z:7},'test'),true);assert.deepEqual(positionOf(b),{x:6,y:16,z:7});assert.equal(a.z,0);
});

test('births honor full occupancy, pause without spending nutrition and emerge on the parent deck',()=>{
 const {s,site,a,b}=stacked();a.z=b.z=7;startRecording(s);updateBreeding(s);assert.ok(a.lifecycle.brood);a.lifecycle.brood.progress=BREEDING.gestation;
 const cells=horizontalNeighbors(positionOf(a));s.jobs=cells.map((p,i)=>({id:`block-${i}`,site:'surface',materials:{},sources:[],...p}));const nutrition=a.fed;
 updateBreeding(s);assert.ok(a.lifecycle.brood);assert.equal(a.fed,nutrition);assert.equal(breedingStatus(s,a).reason,'birth_tile_blocked');
 const free=cells.find(p=>p.x!==b.x||p.y!==b.y);tileAt(site,free).terrain='floor';delete tileAt(site,free).flora;s.jobs=s.jobs.filter(j=>cellKey(j)!==cellKey(free));
 // These owners overlap horizontally but are on another floor/site.
 s.jobs.push({id:'downstairs',site:'surface',materials:{},sources:[],...free,z:0},{id:'offsite',site:'wreck',materials:{},sources:[],...free});Object.assign(s.crew[0],{site:'surface',...free,z:0});
 updateBreeding(s);const child=s.creatures.find(c=>c.lifecycle?.born!==null&&c.lifecycle);assert.ok(child);assert.deepEqual(positionOf(child),free);assert.equal(a.fed,nutrition-20);assert.equal(a.lifecycle.brood,null);assert.deepEqual(child.lifecycle.parents,[a.id,b.id]);
 assert.equal(events(s).find(e=>e.id==='animal.born').target,`tile:surface:${free.x}:${free.y}:7`);
});

test('grazing consumes only local plants and emits deck-scoped animal and flora identities',()=>{
 const {s,site,a,b}=stacked();a.z=7;b.lifecycle.enabled=false;a.lifecycle.enabled=false;s.creatures=[a];a.fed=50;
 const lower=at(site,a.x,a.y),upper=at(site,a.x,a.y,7);lower.flora.lichen.biomass=80;upper.flora.lichen.biomass=26;const old=lower.flora.lichen.biomass;
 startRecording(s);s.tick=17;step(s);assert.equal(lower.flora.lichen.biomass,old);assert.equal(upper.flora.lichen.biomass,21);
 const grazed=events(s).find(e=>e.id==='animal.grazed');assert.equal(grazed.target,`tile:surface:${a.x}:${a.y}:7`);assert.equal(grazed.plant,`flora:surface:${a.x}:${a.y}:lichen:7`);
 const changed=events(s).find(e=>e.id==='flora.stage.changed'&&e.entity===grazed.plant);assert.ok(changed);assert.equal(changed.target,grazed.target);
});

test('traps capture and pay only on their own floor while upper pests consume local food',()=>{
 const {s,site}=stacked();const pest={id:'tibble-test',species:'tibble',site:'surface',x:14,y:14,z:7,health:100,fed:20,age:0};s.creatures=[pest];
 const lower=at(site,14,14),upper=at(site,14,14,7);lower.drop={food:2};upper.drop={food:2};
 s.tick=29;step(s);assert.equal(lower.drop.food,2);assert.equal(upper.drop.food,1);
 lower.building='trap';const store=at(site,13,14);store.building='stockpile';initializeStorage(store);store.stock={food:10};
 s.tick=39;step(s);assert.ok(s.creatures.includes(pest));assert.equal(store.stock.food,10);
 lower.building=null;upper.building='trap';const top=at(site,13,14,7);top.building='stockpile';initializeStorage(top);top.stock={food:1};startRecording(s);
 s.tick=49;step(s);assert.ok(!s.creatures.includes(pest));assert.equal(store.stock.food,10);assert.equal(top.stock.food,.75);
 const captured=events(s).find(e=>e.id==='pest.captured');assert.equal(captured.target,'tile:surface:14:14:7');assert.equal(captured.food,.25);
});
