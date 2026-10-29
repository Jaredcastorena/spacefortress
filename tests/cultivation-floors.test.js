import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,deserialize,serialize,step} from '../src/simulation.js';
import {VERSION,BUILDINGS} from '../src/data.js';
import {executeAction} from '../src/controls.js';
import {tileAt} from '../src/spatial.js';
import {totalResources,syncResources} from '../src/inventory.js';
import {foodOfKind} from '../src/food-lots.js';
import {floraDetails} from '../src/flora-panels.js';
import {updateFlora,validateCultivation,validateFlora,floraStatus,completeGathering,absorbCultivationWater} from '../src/flora.js';
import {flowLiquids} from '../src/liquids.js';
import {damage} from '../src/maintenance.js';
import {startRecording,exportRecording} from '../src/telemetry.js';

const raw=gunzipSync(readFileSync(new URL('./fixtures/cultivation-floors-schema61.json.gz',import.meta.url))).toString();
const target={site:'surface',x:8,y:9,z:1};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const valid=s=>assert.equal(serialize(deserialize(serialize(s))),serialize(s));
const until=(s,p,limit=100)=>{for(let n=0;n<limit&&!p();n++)step(s);assert.ok(p(),`Condition missing at tick ${s.tick}`);};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function job(s,kind,building='fungalcap',position=target){const r=executeAction(s,'job.order',{...position,kind,building});assert.equal(r.ok,true,r.message);return s.jobs.find(j=>j.id===r.job);}
function fresh(){const s=deserialize(raw);until(s,()=>!s.jobs.some(j=>j.id==='job-8'));return {s,site:s.sites.surface,t:tileAt(s.sites.surface,target),c:s.crew[0]};}
function built(){const f=fresh(),j=job(f.s,'build','planter');until(f.s,()=>!f.s.jobs.includes(j));assert.equal(f.t.building,'planter');return f;}
function planted(){const f=built(),j=job(f.s,'plant');until(f.s,()=>!f.s.jobs.includes(j));assert.equal(f.t.flora.fungalcap.generation,j.id);return f;}

// Genuine61: paid upper stairs/device, native suppression and gathering in flight.
// The inherited enclosure/air setup is synthetic; no ordinary endurance claim.
test('genuine schema61 migration preserves in-flight gathering and every physical field',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'992c66b058bea180e62a05d251ddab6427990dc8464eeff2d9d75bae59b0179f');
 const before=JSON.parse(raw),s=deserialize(raw);assert.equal(before.version,61);before.version=VERSION;before.resources.tools=0;assert.deepEqual(s,before);valid(s);
});

test('paid upstairs planter, propagation and water use actual stair delivery and floor events',()=>{
 const f=fresh(),{s,site,t}=f,resources=totalResources(s),lower=tileAt(site,{...target,z:0}),before=JSON.stringify(lower);startRecording(s);
 let j=job(s,'build','planter');assert.deepEqual(j.cost,BUILDINGS.planter.cost);until(s,()=>!s.jobs.includes(j));assert.equal(t.building,'planter');assert.equal(totalResources(s).alloy,resources.alloy-2);assert.equal(totalResources(s).fertilizer,resources.fertilizer-1);
 j=job(s,'plant');assert.ok(j.sources.every(p=>p.z===0));until(s,()=>!s.jobs.includes(j));assert.equal(t.flora.fungalcap.generation,j.id);assert.equal(foodOfKind(tileAt(site,{x:4,y:12,z:0}).drop,'fungalcap'),1);
 assert.ok(events(s).some(e=>e.id==='job.created'&&e.entity===j.id&&e.plant==='flora:surface:8:9:fungalcap:1'));
 const used=site.cultivation.fungalcap.growthUsed,water=totalResources(s).water;j=job(s,'waterPlant');until(s,()=>!s.jobs.includes(j));close(t.flora.fungalcap.moisture+site.cultivation.fungalcap.growthUsed-used,.5);close(water-totalResources(s).water,site.cultivation.fungalcap.growthUsed-used);
 assert.ok(events(s).some(e=>e.id==='flora.watered'&&e.target==='tile:surface:8:9:1'));assert.equal(JSON.stringify(lower),before);valid(s);
});

test('upstairs propagation reloads during carrying and cancellation keeps the actual raw food',()=>{
 for(const cancel of [false,true]){const {s,t,c}=built(),j=job(s,'plant');until(s,()=>c.delivery?.job===j.id&&c.carry?.food===1);const copy=deserialize(serialize(s));assert.equal(serialize(copy),serialize(s));
  if(cancel){const before=totalResources(s).food;assert.equal(executeAction(s,'job.cancel',{job:j.id}).ok,true);assert.equal(foodOfKind(c.carry,'fungalcap'),1);assert.equal(totalResources(s).food,before);assert.equal(t.flora?.fungalcap,undefined);valid(s);}
  else{for(let n=0;n<100&&s.jobs.includes(j);n++){step(s);step(copy);}assert.ok(t.flora?.fungalcap);assert.equal(serialize(copy),serialize(s));valid(s);}
 }
});

test('bare floors, missing planter inputs and closed stairs reject before spending resources',()=>{
 const f=fresh();let before=serialize(f.s);assert.equal(executeAction(f.s,'job.order',{...target,kind:'plant',building:'fungalcap'}).ok,false);assert.equal(serialize(f.s),before);
 for(const t of f.site.tiles)if(t.stock)delete t.stock.fertilizer;syncResources(f.s);before=serialize(f.s);assert.equal(executeAction(f.s,'job.order',{...target,kind:'build',building:'planter'}).ok,false);assert.equal(serialize(f.s),before);
 const b=built(),link=b.site.verticalLinks[0];assert.equal(executeAction(b.s,'vertical.hatch',{site:'surface',connection:link.id,mode:'closed'}).ok,true);before=serialize(b.s);
 assert.equal(executeAction(b.s,'job.order',{...target,kind:'plant',building:'fungalcap'}).ok,false);assert.equal(serialize(b.s),before);assert.match(floraDetails(b.s,b.site,b.t),/data-plant-reason="supplies"/);
 assert.equal(executeAction(b.s,'vertical.hatch',{site:'surface',connection:link.id,mode:'auto'}).ok,true);assert.match(floraDetails(b.s,b.site,b.t),/data-plant-reason="ready"/);
});

test('overlapping ground designations do not hide upper planting or mix panel and entity identities',()=>{
 const {s,site,t}=built();job(s,'build','bunk',{...target,z:0});const panel=floraDetails(s,site,t);
 assert.match(panel,/Cultivate · planter bed/);assert.match(panel,/cultivate:surface:8:9:1/);assert.match(panel,/data-plant-reason="ready"/);assert.doesNotMatch(panel,/data-plant-reason="claimed"/);
 const upper=job(s,'plant');assert.equal(s.jobs.length,2);assert.match(floraDetails(s,site,t),/data-plant-reason="pending"/);assert.equal(upper.z,1);valid(s);
});

test('native gathering from a mature upstairs bed leaves typed food at that bed',()=>{
 const {s,site,t}=planted();for(let n=0;n<3;n++){const j=job(s,'waterPlant');until(s,()=>!s.jobs.includes(j));}
 // Explicit mature-crop boundary: account for growth using already delivered
 // moisture. Growth timing/conservation is checked independently below.
 const patch=t.flora.fungalcap,ledger=site.cultivation.fungalcap,grown=100-patch.biomass,used=grown*.0125;
 assert.ok(patch.moisture>=used);patch.moisture-=used;patch.biomass=100;ledger.grown+=grown;ledger.growthUsed+=used;valid(s);startRecording(s);
 const j=job(s,'gather');until(s,()=>!s.jobs.includes(j));assert.equal(foodOfKind(t.drop,'fungalcap'),2);assert.equal(patch.harvests,1);assert.equal(tileAt(site,{...target,z:0}).drop,null);
 assert.ok(events(s).some(e=>e.id==='flora.harvested'&&e.actor&&e.job===j.id&&e.entity==='flora:surface:8:9:fungalcap:1'));valid(s);
});

test('new planter and upper plant work cannot be relabeled as legacy schema61',()=>{
 const f=built();let old=JSON.parse(serialize(f.s));old.version=61;assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy planter/);
 const unsupported=structuredClone(f.s);tileAt(unsupported.sites.surface,target).terrain='void';assert.throws(()=>validateFlora(unsupported),/Invalid planter foundation/);assert.throws(()=>deserialize(serialize(unsupported)));
 const j=job(f.s,'plant');valid(f.s);old=JSON.parse(serialize(f.s));old.version=61;tileAt(old.sites.surface,target).building=null;assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy planter/);
 const wrong=JSON.parse(serialize(f.s));wrong.jobs.find(k=>k.id===j.id).z=0;assert.throws(()=>deserialize(JSON.stringify(wrong)),/Invalid cultivation/);
});

test('destroyed upstairs beds cancel watering and return retained moisture on the same floor',()=>{
 const {s,site,t,c}=planted();let j=job(s,'waterPlant');until(s,()=>!s.jobs.includes(j));j=job(s,'waterPlant');until(s,()=>c.delivery?.job===j.id&&c.carry?.water);
 const moisture=t.flora.fungalcap.moisture,water=totalResources(s).water;damage(s,site,t,'structure',100,'debris');step(s);
 assert.equal(t.flora?.fungalcap,undefined);assert.equal(s.jobs.some(k=>k.id===j.id),false);close(totalResources(s).water,water);close(t.drop.water,moisture);assert.notEqual(c.delivery?.job,j.id);valid(s);
});

test('native dismantling returns bed moisture and preserves the constructed upper floor',()=>{
 const {s,site,t}=planted();let j=job(s,'waterPlant');until(s,()=>!s.jobs.includes(j));
 const water=totalResources(s).water,used=site.cultivation.fungalcap.growthUsed,returned=site.cultivation.fungalcap.returned;
 j=job(s,'remove',null);until(s,()=>!s.jobs.includes(j));step(s);
 assert.equal(t.building,null);assert.equal(t.terrain,'floor');assert.equal(t.flora?.fungalcap,undefined);assert.ok(site.cultivation.fungalcap.returned>returned);
 close(water-totalResources(s).water,site.cultivation.fungalcap.growthUsed-used);valid(s);
});

// Pure ecology boundary: finite declared initial biomass/water, no colony ticks.
function biology(species='fungalcap'){
 const s=createGame(),site=s.sites.surface;site.size=3;site.levels=[0,1,2].map(z=>({z,name:`Floor ${z}`}));site.rooms=[];site.verticalLinks=[];site.thermal.ambient=8;
 site.tiles=Array.from({length:27},(_,i)=>({x:i%3,y:Math.floor(i/3)%3,z:Math.floor(i/9),terrain:i<18?'floor':'void',building:null,hp:100,liquid:0}));
 const t=tileAt(site,{x:1,y:1,z:1});t.building='planter';t.flora={[species]:{biomass:20,harvests:0,origin:'cultivated',generation:'job-1',moisture:1.5}};
 Object.assign(site.cultivation[species],{propagules:1,planted:20,delivered:1.5});return {s,site,t,patch:t.flora[species],species};
}

test('upper bed growth and harvest conserve finite moisture and leave the same-coordinate ground patch untouched',()=>{
 const {s,site,t,patch}=biology(),lower=tileAt(site,{x:1,y:1,z:0});lower.terrain='ground';lower.flora={fungalcap:{biomass:100,harvests:0,origin:'native',generation:'native'}};
 for(let n=1;n<=30&&patch.biomass<100;n++){s.tick=n*30;updateFlora(s);validateCultivation(s);}assert.equal(patch.biomass,100);close(patch.moisture,.5);close(site.cultivation.fungalcap.growthUsed,1);
 const j={id:'job-2',site:'surface',x:1,y:1,z:1,kind:'gather',building:null,plantSpecies:'fungalcap',plantHarvests:0,plantGeneration:'job-1',work:10};assert.equal(completeGathering(s,s.crew[0],j).ok,true);
 assert.equal(t.drop.food,2);assert.equal(patch.biomass,20);assert.equal(lower.flora.fungalcap.biomass,100);assert.equal(lower.drop,undefined);validateCultivation(s);
});

test('floor irrigation only transfers available liquid and overhead terrain blocks sunberry growth',()=>{
 const {s,site,t,patch}=biology('sunberry');patch.moisture=1.4;site.cultivation.sunberry.delivered=1.4;
 // The liquid ledger represents the explicitly supplied initial spill.
 for(const tile of site.tiles.filter(t=>t.z===1)){tile.liquid=.1;site.liquids.released+=.1;}
 const before=totalResources(s).water;flowLiquids(s);close(totalResources(s).water+site.liquids.lost,before);assert.ok(patch.moisture>1.4);assert.ok(site.liquids.absorbed>0);validateCultivation(s);
 const roof=tileAt(site,{x:1,y:1,z:2});roof.terrain='floor';s.tick=30;const biomass=patch.biomass;updateFlora(s);assert.equal(patch.biomass,biomass);assert.match(floraStatus(s,site,t)[0].growthReason,/overhead/);
 roof.terrain='void';s.tick=60;updateFlora(s);assert.ok(patch.biomass>biomass);const liquid=t.liquid;assert.ok(absorbCultivationWater(s,site,t,100)<=liquid);validateCultivation(s);
});
