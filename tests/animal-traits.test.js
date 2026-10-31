import test from 'node:test';
import assert from 'node:assert/strict';
import { ANIMAL_TRAITS, neutralGenome, founderGenome, inheritGenome, animalTraits, initializeAnimalTraits, validateAnimalTraits } from '../src/animal-traits.js';
import { LIVESTOCK } from '../src/livestock-data.js';
import { newLifecycle, updateBreeding, breedingStatus } from '../src/breeding.js';
import { initializeAnimalCondition, injureAnimal, updateAnimalHealth, animalHealthStatus } from '../src/animal-health.js';
import { animalCondition, completeAnimalJob } from '../src/husbandry.js';
import { startRecording, exportRecording } from '../src/telemetry.js';
import { createGame, at } from '../src/simulation.js';

// Supplied domain fixtures isolate the existing husbandry rules. They establish
// mechanics, not ordinary pasture/post construction or a gameplay acceptance run.
function fixture(species='bristleback'){
  const size=8,site={id:'surface',size,rooms:[],thermal:{ambient:8},tiles:Array.from({length:size*size},(_,i)=>{
    const x=i%size,y=Math.floor(i/size);return {x,y,terrain:'ground',building:x===0||y===0||x===size-1||y===size-1?'fence':null,hp:100,drop:null};
  })};
  const animals=[3,4].map((x,i)=>{const a={id:`parent-${i}`,species,site:'surface',x,y:3,health:100,fed:100,age:0,genetics:neutralGenome(),husbandry:{post:null,trust:100,product:0,care:true,harvest:true,retryAt:0,blocked:null},lifecycle:newLifecycle(null,[],species)};a.lifecycle.enabled=true;initializeAnimalCondition(a);return a;});
  return {s:{seed:1728,rng:923,tick:0,nextId:10,sites:{surface:site},creatures:animals,crew:[],jobs:[],log:[]},a:animals[0],b:animals[1],site};
}
const genome=(thermal,pace,origin='founder')=>({origin,thermal:[thermal,thermal],pace:[pace,pace]});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const removeTraits=s=>{const copy=structuredClone(s);for(const a of copy.creatures){delete a.genetics;if(a.lifecycle?.brood)delete a.lifecycle.brood.inheritance;}return copy;};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(row=>row.event).map(row=>row.event);

test('balanced legacy genomes have neutral effects and independent arrays',()=>{
  const first=neutralGenome(),second=neutralGenome();assert.deepEqual(first,{origin:'legacy',thermal:[-1,1],pace:[-1,1]});
  first.thermal[0]=0;assert.deepEqual(second,neutralGenome());assert.deepEqual(first.pace,[-1,1]);
  for(const species of Object.keys(LIVESTOCK)){const p=animalTraits({species,genetics:second}),d=LIVESTOCK[species];assert.equal(p.thermalExpression,0);assert.equal(p.paceExpression,0);assert.equal(p.paceMultiplier,1);assert.deepEqual(p.temperatureRange,d.temperature);assert.equal(p.productRate,d.productRate);assert.equal(p.metabolism,d.metabolism);assert.equal(p.juvenileMetabolism,d.juvenileMetabolism);}
  assert.ok(Object.isFrozen(ANIMAL_TRAITS)&&Object.isFrozen(ANIMAL_TRAITS.alleles));
});

test('founder genomes are repeatable and distinguish seeds, species and stable IDs',()=>{
  const reference=founderGenome(1728,'bristleback','grazer-0');assert.deepEqual(founderGenome(1728,'bristleback','grazer-0'),reference);
  const outputs=new Set();for(let i=0;i<16;i++)for(const species of ['bristleback','glazefoot'])outputs.add(JSON.stringify(founderGenome(i,species,`founder-${i}`)));
  assert.ok(outputs.size>8);assert.equal(reference.origin,'founder');for(const locus of ['thermal','pace'])assert.ok(reference[locus].every(allele=>[-1,0,1].includes(allele)));
  const second=founderGenome(1728,'bristleback','grazer-0');second.pace[0]=9;assert.deepEqual(founderGenome(1728,'bristleback','grazer-0'),reference);
});

test('inheritance selects one allele from each ordered parent without changing parents or RNG',()=>{
  const {s,a,b}=fixture();a.genetics={origin:'founder',thermal:[-1,0],pace:[0,1]};b.genetics={origin:'founder',thermal:[0,1],pace:[-1,0]};const before=structuredClone(s);
  for(let i=0;i<32;i++){const child=inheritGenome(s.seed,a,b,`brood-${i}`);assert.equal(child.origin,'inherited');for(const locus of ['thermal','pace'])for(const [slot,parent]of [a,b].entries())assert.ok(parent.genetics[locus].includes(child[locus][slot]));assert.deepEqual(child,inheritGenome(s.seed,a,b,`brood-${i}`));}
  assert.deepEqual(s,before);const child=inheritGenome(s.seed,a,b,'brood-1');child.thermal[0]=9;assert.deepEqual(s,before);
});

test('balanced neutral parents produce segregating offspring without mutation',()=>{
  const {s,a,b}=fixture(),expressions=new Set();for(let i=0;i<32;i++){const genetics=inheritGenome(s.seed,a,b,`brood-${i}`);expressions.add(animalTraits({...a,genetics}).thermalExpression);for(const locus of ['thermal','pace'])assert.ok(genetics[locus].every(allele=>allele===-1||allele===1));}
  assert.deepEqual([...expressions].sort(),[-1,0,1]);
});

test('fresh initialization adds deterministic founder genomes once without physical or RNG changes',()=>{
  const {s}=fixture();for(const a of s.creatures)delete a.genetics;s.creatures.push({id:'pest',species:'tibble'});const before=structuredClone(s);initializeAnimalTraits(s);
  assert.deepEqual(removeTraits(s),before);for(const a of s.creatures.slice(0,2))assert.deepEqual(a.genetics,founderGenome(s.seed,a.species,a.id));assert.equal(s.creatures[2].genetics,undefined);validateAnimalTraits(s);
  const after=structuredClone(s);initializeAnimalTraits(s);assert.deepEqual(s,after);
});

test('legacy animals, offspring and pending broods gain neutral copied genomes without physical changes',()=>{
  const {s,a,b}=fixture();s.tick=1;updateBreeding(s);const child={...structuredClone(b),id:'bristleback-11',lifecycle:newLifecycle(0,[a.id,b.id]),genetics:neutralGenome()};s.creatures.push(child);s.nextId=12;
  const before=removeTraits(s);for(const animal of s.creatures){delete animal.genetics;if(animal.lifecycle.brood)delete animal.lifecycle.brood.inheritance;}
  initializeAnimalTraits(s,{legacy:true});assert.deepEqual(removeTraits(s),before);assert.ok(s.creatures.every(animal=>animalTraits(animal).paceMultiplier===1));assert.deepEqual(a.lifecycle.brood.inheritance.child,neutralGenome());validateAnimalTraits(s);
  const inheritance=a.lifecycle.brood.inheritance;assert.notEqual(inheritance.parents[0].genetics,a.genetics);assert.notEqual(inheritance.parents[0].genetics.thermal,a.genetics.thermal);assert.notEqual(inheritance.child.thermal,a.genetics.thermal);assert.notEqual(a.genetics.pace,b.genetics.pace);
});

test('legacy initialization rejects genetics and inheritance shadows before assigning defaults',()=>{
  for(const mutate of [f=>f.a.genetics=neutralGenome(),f=>f.a.lifecycle.brood={inheritance:{}},f=>f.s.creatures.push({id:'pest',species:'tibble',genetics:{}})]){const f=fixture();for(const a of f.s.creatures)delete a.genetics;mutate(f);const before=structuredClone(f.s);assert.throws(()=>initializeAnimalTraits(f.s,{legacy:true}),/shadow/);assert.deepEqual(f.s,before);}
});

test('thermal preference shifts an equal-width range while pace trades production for both nutrition drains',()=>{
  for(const species of Object.keys(LIVESTOCK))for(const expression of [-1,-.5,0,.5,1]){
    const allelePair=expression===-.5?[-1,0]:expression===.5?[0,1]:[expression,expression],a={species,genetics:{origin:'founder',thermal:[...allelePair],pace:[...allelePair]}},p=animalTraits(a),d=LIVESTOCK[species];
    assert.equal(p.thermalExpression,expression);assert.equal(p.paceExpression,expression);assert.deepEqual(p.temperatureRange,d.temperature.map(n=>n+5*expression));assert.equal(p.temperatureRange[1]-p.temperatureRange[0],d.temperature[1]-d.temperature[0]);close(p.productRate,d.productRate*(1+.2*expression));close(p.metabolism,d.metabolism*(1+.2*expression));close(p.juvenileMetabolism,d.juvenileMetabolism*(1+.2*expression));
  }
});

test('tiny missing-genome fixtures use neutral profiles but current validation rejects missing genetics',()=>{
  const {s,a}=fixture();delete a.genetics;assert.equal(animalTraits(a).paceMultiplier,1);assert.deepEqual(animalTraits(a).temperatureRange,LIVESTOCK.bristleback.temperature);assert.equal(animalTraits({species:'tibble'}),null);assert.throws(()=>validateAnimalTraits(s),/genetics/);
});

test('strict current genomes reject unknown fields, origins and malformed allele pairs',()=>{
  for(const mutate of [a=>a.genetics=null,a=>a.genetics.extra=1,a=>a.genetics.origin='edited',a=>delete a.genetics.pace,a=>a.genetics.thermal=[0],a=>a.genetics.thermal=[0,0,0],a=>a.genetics.thermal=[2,0],a=>a.genetics.thermal=[.5,0],a=>a.genetics.thermal=['0',0],a=>a.genetics.thermal=[NaN,0],a=>a.genetics.thermal=Array(2),a=>a.genetics.thermal.extra=1]){const {s,a}=fixture();mutate(a);assert.throws(()=>validateAnimalTraits(s),/genetics/);}
  const {s}=fixture();s.creatures.push({id:'pest',species:'tibble',genetics:neutralGenome()});assert.throws(()=>validateAnimalTraits(s),/Pests/);
});

test('founder and inherited origins obey lifecycle ancestry and ordered allele membership',()=>{
  const {s,a,b}=fixture();a.genetics=genome(-1,-1);b.genetics=genome(1,1);const child={...structuredClone(a),id:'child',lifecycle:newLifecycle(1,[a.id,b.id]),genetics:inheritGenome(s.seed,a,b,'brood-1')};s.creatures.push(child);validateAnimalTraits(s);
  child.genetics.origin='founder';assert.throws(()=>validateAnimalTraits(s),/genetics/);child.genetics.origin='inherited';child.genetics.thermal.reverse();assert.throws(()=>validateAnimalTraits(s),/inherited/);child.genetics=inheritGenome(s.seed,a,b,'brood-1');b.species='glazefoot';assert.throws(()=>validateAnimalTraits(s),/inherited/);
});

test('conception freezes detached ordered parent genomes and an inherited child without drawing RNG',()=>{
  const {s,a,b}=fixture();a.genetics=genome(-1,-1);b.genetics=genome(1,1);const rng=s.rng;s.tick=1;updateBreeding(s);const brood=a.lifecycle.brood;assert.ok(brood);assert.equal(s.rng,rng);assert.equal(s.nextId,11);
  assert.deepEqual(brood.inheritance,{parents:[a,b].map(parent=>({id:parent.id,genetics:structuredClone(parent.genetics)})),child:{origin:'inherited',thermal:[-1,1],pace:[-1,1]}});validateAnimalTraits(s);
  assert.notEqual(brood.inheritance.parents[0].genetics.thermal,a.genetics.thermal);assert.notEqual(brood.inheritance.child.pace,a.genetics.pace);
});

test('brood snapshots reject missing or extra fields, order changes, parent mutation and impossible child alleles',()=>{
  const mutations=[f=>delete f.a.lifecycle.brood.inheritance,f=>f.a.lifecycle.brood.extra=true,f=>f.a.lifecycle.brood.inheritance.extra=true,f=>f.a.lifecycle.brood.inheritance.parents.reverse(),f=>f.a.lifecycle.brood.inheritance.parents.pop(),f=>f.a.lifecycle.brood.inheritance.parents[0].extra=true,f=>f.a.lifecycle.brood.inheritance.parents[0].genetics.pace[0]=0,f=>f.a.genetics.thermal[0]=0,f=>f.a.lifecycle.brood.inheritance.child.thermal[0]=1,f=>f.a.lifecycle.brood.inheritance.child.origin='founder'];
  for(const mutate of mutations){const f=fixture();f.a.genetics=genome(-1,-1);f.b.genetics=genome(1,1);f.s.tick=1;updateBreeding(f.s);mutate(f);assert.throws(()=>validateAnimalTraits(f.s),/brood/i);}
});

test('birth transfers the frozen child after policy interruption and mate death without rereading parents',()=>{
  const {s,a,b}=fixture();a.genetics=genome(-1,-1);b.genetics=genome(1,1);s.tick=1;updateBreeding(s);const frozen=structuredClone(a.lifecycle.brood.inheritance),rng=s.rng;a.lifecycle.enabled=b.lifecycle.enabled=false;
  // Out-of-band edits are deliberately invalid save state. Birth nevertheless
  // consumes the conception snapshot rather than rerolling from those edits.
  b.genetics=genome(-1,-1);b.health=0;a.condition.thermalStress=45;s.tick=2;updateBreeding(s);assert.equal(a.lifecycle.brood.progress,0);a.condition.thermalStress=0;a.lifecycle.brood.progress=300;s.tick=302;updateBreeding(s);
  const child=s.creatures[2];assert.deepEqual(child.genetics,frozen.child);assert.notEqual(child.genetics.thermal,frozen.child.thermal);assert.equal(s.rng,rng);assert.equal(a.lifecycle.brood,null);assert.deepEqual(child.lifecycle.parents,[a.id,b.id]);assert.equal(child.husbandry.product,0);assert.equal(child.lifecycle.growth,0);
});

test('metabolic pace changes readiness but keeps harvest quantities and nutrition cost fixed',()=>{
  for(const pace of [-1,0,1]){const {s,a,site}=fixture();a.genetics=genome(0,pace);a.husbandry.post={x:3,y:3,z:0};site.tiles[3*8+3].building='husbandryPost';for(let i=0;i<100;i++)animalCondition(s,a);close(a.husbandry.product,25*(1+.2*pace));
    a.husbandry.product=100;const job={id:'job-1',kind:'animalHarvest',animal:a.id,site:'surface',x:3,y:3,building:null};assert.equal(completeAnimalJob(s,{id:'worker',site:'surface',x:3,y:3,z:0},job),true);assert.equal(a.fed,80);assert.equal(a.husbandry.product,0);assert.equal(site.tiles[3*8+3].drop.food,2);assert.equal(site.tiles[3*8+3].drop.waste,.25);
  }
});

test('thermal preferences govern actual heat/cold strain and veterinary recovery with displayed bounds',()=>{
  for(const species of Object.keys(LIVESTOCK)){
    const warm=fixture(species),cold=fixture(species);warm.a.genetics=genome(1,0);cold.a.genetics=genome(-1,0);const high=LIVESTOCK[species].temperature[1];warm.site.thermal.ambient=cold.site.thermal.ambient=high+4;updateAnimalHealth(warm.s,warm.a);updateAnimalHealth(cold.s,cold.a);assert.equal(warm.a.condition.thermalStress,0);assert.ok(cold.a.condition.thermalStress>0);
    const low=LIVESTOCK[species].temperature[0];warm.site.thermal.ambient=cold.site.thermal.ambient=low-4;warm.a.condition.thermalStress=cold.a.condition.thermalStress=0;updateAnimalHealth(warm.s,warm.a);updateAnimalHealth(cold.s,cold.a);assert.ok(warm.a.condition.thermalStress<0);assert.equal(cold.a.condition.thermalStress,0);
    for(const f of [warm,cold]){f.a.husbandry.post={x:3,y:3,z:0};f.site.tiles[3*8+3].building='husbandryPost';f.site.thermal.ambient=high+4;injureAnimal(f.s,f.a,1,'fire');f.a.condition.treated=1;updateAnimalHealth(f.s,f.a);assert.deepEqual(animalHealthStatus(f.s,f.a).temperatureRange,animalTraits(f.a).temperatureRange);}
    close(warm.a.condition.injury,.9);assert.equal(cold.a.condition.injury,1);assert.equal(animalHealthStatus(cold.s,cold.a).recovery,'unsafe_temperature');
  }
});

test('production, juvenile growth and broods retain injury and strain gates for every trait extreme',()=>{
  for(const expression of [-1,1]){const {s,a,b}=fixture();a.genetics=b.genetics=genome(expression,expression);injureAnimal(s,a,1,'fire');animalCondition(s,a);assert.equal(a.husbandry.product,0);assert.equal(breedingStatus(s,a).reason,'injured');s.tick=1;updateBreeding(s);assert.equal(a.lifecycle.brood,null);
    a.condition.injury=0;a.condition.cause=null;a.health=100;a.condition.thermalStress=45;assert.equal(breedingStatus(s,a).reason,'thermal_stress');a.condition.thermalStress=0;updateBreeding(s);assert.ok(a.lifecycle.brood);a.condition.thermalStress=45;s.tick++;updateBreeding(s);assert.equal(a.lifecycle.brood.progress,0);
    const child={...structuredClone(b),id:'child',lifecycle:newLifecycle(s.tick,[a.id,b.id]),genetics:inheritGenome(s.seed,a,b,'brood-child')};child.condition.thermalStress=45;s.creatures.push(child);s.tick++;updateBreeding(s);assert.equal(child.lifecycle.growth,0);child.condition.thermalStress=0;child.fed=40;s.tick++;updateBreeding(s);assert.equal(child.lifecycle.growth,1);animalCondition(s,child);assert.equal(child.husbandry.product,0);
  }
});

test('brood and birth semantic records contain detached inheritance, genome and profile fields',()=>{
  // Supply a pasture inside a complete colony because recording observes every
  // simulation system. Integration separately owns recorder parity and replay.
  const {a,b}=fixture(),s=createGame(1728);s.creatures=[a,b];s.nextId=10;
  for(let y=0;y<8;y++)for(let x=0;x<8;x++){const tile=at(s.sites.surface,x,y);tile.terrain='ground';tile.building=x===0||y===0||x===7||y===7?'fence':null;tile.hp=100;}
  assert.equal(startRecording(s,{maxRecords:200,maxBytes:16_000_000}).active,true);s.tick=1;updateBreeding(s);const inheritance=structuredClone(a.lifecycle.brood.inheritance),started=events(s).find(event=>event.id==='animal.brood.started');assert.deepEqual(started.inheritance,inheritance);assert.deepEqual(started.genetics,inheritance.child);assert.deepEqual(started.profile,animalTraits({...a,genetics:inheritance.child}));a.lifecycle.enabled=b.lifecycle.enabled=false;a.lifecycle.brood.progress=300;s.tick=301;updateBreeding(s);
  const born=events(s).find(event=>event.id==='animal.born'),inherited=events(s).find(event=>event.id==='animal.traits.inherited'),child=s.creatures[2];assert.deepEqual(born.inheritance,inheritance);assert.deepEqual(inherited.parents,[a.id,b.id]);assert.deepEqual(inherited.genetics,child.genetics);assert.deepEqual(inherited.profile,animalTraits(child));child.genetics.pace[0]=0;assert.deepEqual(events(s).find(event=>event.id==='animal.traits.inherited'),inherited);
});
