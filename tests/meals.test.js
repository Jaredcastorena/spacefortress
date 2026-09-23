import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, step, order, serialize, deserialize, setLabor, pathTo } from '../src/simulation.js';
import { initializeStorage, add, extract, totalResources, syncResources } from '../src/inventory.js';
import { foodLots, preparedFood, rawFood, foodAge, FOOD_LIFETIME } from '../src/food-lots.js';
import { cookMeal } from '../src/meals.js';
import { setMachineEnabled } from '../src/industry.js';
import { setProductionOrder } from '../src/production.js';
import { setCableEnabled, refreshPower } from '../src/power.js';
import { injure } from '../src/medicine.js';
import { updateFood } from '../src/spoilage.js';
import { startRecording, exportRecording, observe } from '../src/telemetry.js';

const check=s=>{syncResources(s);return deserialize(serialize(s));};
const until=(s,p,limit=210)=>{for(let i=0;i<limit&&!p();i++){step(s);check(s);}assert.ok(p(),`Condition missing at ${s.tick}`);};
function colony({galley=true,hauling=true}={}){
 const s=createGame(),site=s.sites.surface,t=at(site,12,10),depot=at(site,8,10),c=s.crew[0];
 for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
 for(const c of s.crew)setLabor(s,c.id,'hauling',hauling);
 if(galley){t.building='galley';initializeStorage(t);t.cable={hp:100,enabled:true};refreshPower(s,site);}
 return {s,site,t,m:t.machine,depot,c};
}
function prepared(s,inventory,quality=2,age=100){
 const chef=s.crew[6];chef.skills.production.level=(quality-1)*3;
 const job={id:`job-${s.nextId++}`,site:'surface',x:12,y:10},food=cookMeal(s,chef,job,{food:2,_food:[{amount:2,age}]});
 add(inventory,food);return food._food[0].meal.id;
}

test('delivered construction, raw food, water and an operator produce traceable meals for storage',()=>{
 const {s,site,t,depot}=colony({galley:false}),before=totalResources(s);assert.equal(order(s,'surface',11,14,'build','galley').ok,false);
 const j=order(s,'surface',12,10,'build','galley').job;until(s,()=>!s.jobs.includes(j));assert.equal(totalResources(s).alloy,before.alloy-6);assert.equal(totalResources(s).components,before.components-1);
 setProductionOrder(s,'surface',12,10,'batches',1);until(s,()=>t.machine.completed===1);assert.equal(totalResources(s).food,before.food);assert.equal(totalResources(s).water,before.water-.25);
 until(s,()=>preparedFood(depot.stock)===2);const meal=foodLots(depot.stock).find(l=>l.meal).meal;assert.match(meal.id,/^meal-job-/);assert.ok(s.crew.some(c=>c.id===meal.maker));assert.equal(t.machine.order.remaining,0);check(s);
});

test('cook skill sets quality while processing never refreshes old ingredients',()=>{
 const {s,m}=colony({hauling:false});for(const c of s.crew)setLabor(s,c.id,'production',false);const chef=s.crew[6];chef.skills.production.level=9;setLabor(s,chef.id,'production',true);
 m.input={food:2,water:.25,_food:[{amount:2,age:2000}]};until(s,()=>m.completed===1);const lot=foodLots(m.output)[0];assert.equal(lot.meal.quality,4);assert.equal(lot.meal.maker,chef.id);assert.ok(lot.age>=2000);assert.equal(m.output.food,2);check(s);
});

test('fractional transfers preserve batch identity and mix without spreading quality to plain food',()=>{
 const {s}=colony();const source={food:3},dest={};const id=prepared(s,source,3,0);
 add(dest,extract(source,{food:1.25}));assert.equal(preparedFood(dest),1.25);assert.equal(rawFood(dest),0);assert.equal(foodLots(dest)[0].meal.id,id);assert.equal(preparedFood(source),.75);assert.equal(rawFood(source),3);
 add(source,dest);assert.equal(preparedFood(source),2);assert.equal(rawFood(source),3);dest._food[0].meal.quality=1;assert.equal(foodLots(source)[0].meal.quality,3);
});

test('galley input hauling selects plain food and cannot repeatedly cook prepared output',()=>{
 const {s,depot,m}=colony();depot.stock={water:10};prepared(s,depot.stock);add(depot.stock,{food:2});syncResources(s);
 until(s,()=>m.completed===1);step(s,25);assert.equal(m.completed,1);assert.equal(totalResources(s).food,4);assert.equal(rawFood(depot.stock),0);assert.match(m.status,/unprepared/);check(s);
});

test('prepared-only stock targets ignore raw food and account for promised meals',()=>{
 const {s,depot,m}=colony();setProductionOrder(s,'surface',12,10,'stock',2);assert.equal(depot.stock.food,24);until(s,()=>m.completed===1);step(s,20);assert.equal(m.completed,1);assert.match(m.status,/Stock target/);assert.equal(preparedFood(depot.stock),2);check(s);
});

test('power interruption preserves cooking progress, age and paid ingredients',()=>{
 const {s,m}=colony();setProductionOrder(s,'surface',12,10,'batches',1);until(s,()=>m.progress>2);const progress=m.progress,age=foodAge(m.batch);
 setCableEnabled(s,'surface',12,10,false);step(s,10);assert.equal(m.progress,progress);assert.equal(m.batch.food,2);assert.equal(m.batch.water,.25);assert.ok(foodAge(m.batch)>age);setCableEnabled(s,'surface',12,10,true);until(s,()=>m.completed===1);check(s);
});

test('spoiled cooking ingredients reset work and spill water without producing a meal',()=>{
 const {s,m,t}=colony({hauling:false});m.input={food:2,water:.25,_food:[{amount:2,age:100}]};until(s,()=>m.progress>2);m.batch._food[0].age=FOOD_LIFETIME-1;step(s);
 assert.equal(m.completed,0);assert.equal(m.progress,0);assert.deepEqual(m.batch,{});assert.equal(t.drop.waste,2);assert.equal(t.drop.water,.25);assert.equal(preparedFood(m.output),0);check(s);
});

test('eating prepared food grants quality benefits only after physical pickup and consumption',()=>{
 const {s,depot,c}=colony({galley:false,hauling:false});depot.stock={};const id=prepared(s,depot.stock,4);c.hunger=20;c.x=8;c.y=10;c.life.stress=50;
 assert.ok(!c.memories.some(m=>m.kind==='prepared-meal'));step(s);assert.equal(c.intent.servings,8);assert.equal(foodLots(c.intent.openedFood)[0].meal.id,id);assert.ok(!c.memories.some(m=>m.kind==='prepared-meal'));
 until(s,()=>c.memories.some(m=>m.kind==='prepared-meal'));assert.equal(c.memories.find(m=>m.kind==='prepared-meal').mood,6);assert.ok(c.life.stress<48);assert.equal(totalResources(s).food,1);check(s);
});

test('air interruption preserves opened quality and a death drops the same remaining prepared portions',()=>{
 const {s,site,depot,c}=colony({galley:false,hauling:false});depot.stock={};const id=prepared(s,depot.stock);c.hunger=20;c.x=8;c.y=10;step(s);step(s);assert.equal(c.intent.servings,7);
 c.x=16;c.y=11;c.oxygen=1;step(s);assert.equal(c.intent.type,'air');assert.equal(c.medical.servings,7);assert.equal(foodLots(c.medical.openedFood)[0].meal.id,id);check(s);
 c.health=0;step(s);const drop=at(site,c.x,c.y).drop;assert.equal(preparedFood(drop),7/8);assert.equal(foodLots(drop)[0].meal.id,id);assert.equal(c.medical.openedFood,undefined);check(s);
});

test('medics deliver prepared food through the existing bedside supply job',()=>{
 const {s,site,depot,c}=colony({galley:false,hauling:false});depot.stock={};const id=prepared(s,depot.stock,3);c.x=10;c.y=9;at(site,10,9).building='medicalCot';injure(s,c,65,'test');c.hunger=20;
 until(s,()=>c.medical.servings>0);assert.equal(foodLots(c.medical.openedFood)[0].meal.id,id);assert.ok(!c.memories.some(m=>m.kind==='prepared-meal'));until(s,()=>c.memories.some(m=>m.kind==='prepared-meal'));check(s);
});

test('prepared portions spoil into their remaining food mass without awarding enjoyment',()=>{
 const {s,depot,c}=colony({galley:false,hauling:false});depot.stock={};prepared(s,depot.stock,2,FOOD_LIFETIME-3);c.x=8;c.y=10;c.hunger=20;step(s);step(s);assert.equal(c.intent.servings,7);step(s);
 assert.equal(c.intent.servings,0);assert.equal(c.intent.openedFood,undefined);assert.ok(!c.memories.some(m=>m.kind==='prepared-meal'));assert.equal(s.foodSpoiled,1+7/8);check(s);
});

test('save continuation keeps batches and partly eaten food deterministic',()=>{
 const {s,depot,c}=colony({galley:false,hauling:false});depot.stock={};prepared(s,depot.stock);c.hunger=20;c.x=8;c.y=10;step(s,3);assert.ok(c.intent.openedFood);const copy=check(s);step(s,15);step(copy,15);assert.deepEqual(copy,s);
});

test('schema twenty-four migration preserves ordinary food and opened rations without granting cooked food',()=>{
 const {s,c}=colony({galley:false});s.version=24;c.intent={type:'meal',target:null,servings:5,foodAge:100};const before=totalResources(s),copy=check(s);assert.equal(copy.version,36);assert.deepEqual(totalResources(copy),before);assert.equal(copy.crew[0].intent.servings,5);assert.equal(copy.crew[0].intent.openedFood,undefined);step(copy,5);check(copy);
});

test('malformed prepared metadata, conflicting batch identities and impossible opened portions are rejected',()=>{
 for(const corrupt of [(s,d)=>d.stock._food[0].meal.quality=9,(s,d)=>d.stock._food[0].meal.created=1,(s,d)=>d.stock._food[0].meal.id='meal-job-999999',(s,d)=>{const food=extract(d.stock,{food:1});food._food[0].meal.quality=4;s.crew[0].medical.servings=8;s.crew[0].medical.openedFood=food;},(s,d)=>{s.crew[0].medical.servings=2;s.crew[0].medical.openedFood=extract(d.stock,{food:1});}]){const {s,depot}=colony();prepared(s,depot.stock);corrupt(s,depot);assert.throws(()=>check(s));}
});

test('galley saves reject prepared ingredients and output missing its cooked metadata',()=>{
 for(const slot of ['input','batch']){const {s,m}=colony();prepared(s,m[slot]);if(slot==='batch'){m.batch.water=.25;m.progress=1;}assert.throws(()=>check(s));}
 const {s,m}=colony();m.output.food=2;assert.throws(()=>check(s));
});

test('recordings expose distributed batch identity and explicit preparation, opening, portions and finish',()=>{
 const {s,depot,c}=colony({galley:false,hauling:false});depot.stock={};startRecording(s);const id=prepared(s,depot.stock);c.hunger=20;c.x=8;c.y=10;step(s);
 const entity=observe(s).entities[id];assert.equal(entity.type,'meal_batch');assert.equal(entity.food,2);assert.equal(entity.locations.length,2);step(s,8);
 const rows=exportRecording(s).trim().split('\n').map(JSON.parse);for(const id of ['meal.prepared','meal.opened','meal.portion.eaten','meal.finished'])assert.ok(rows.some(r=>r.event?.id===id));assert.equal(observe(s).entities[id].food,1);
});
