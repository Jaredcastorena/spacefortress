import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, at, pathTo, order, cancelJob } from '../src/simulation.js';
import { prepareHusbandry } from '../src/husbandry.js';
import { controlBindings } from '../src/controls.js';
import { animalHealthStatus, animalTreatmentEligibility } from '../src/animal-health.js';
import { animalTraits } from '../src/animal-traits.js';
import { VETERINARY } from '../src/livestock-data.js';
import { animalDetails, animalHealthDetails, animalTraitDetails, breedingDetails } from '../src/husbandry-panels.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(species='bristleback') {
  const s=createGame(),site=s.sites.surface,a=s.creatures.find(a=>a.species===species),t=at(site,12,10);
  t.building='husbandryPost';t.hp=100;a.x=t.x;a.y=t.y;a.site='surface';a.health=90;a.fed=80;
  a.husbandry.trust=100;a.husbandry.post={x:t.x,y:t.y,z:0};a.husbandry.care=true;a.lifecycle.enabled=true;
  a.condition={injury:10,treated:4,thermalStress:0,cause:'fire',recovery:'none'};
  return {s,site,a,t,bindings:controlBindings(()=>s)};
}

test('animal health panel shows exact injury coverage, species tolerance and manual medicine/work limits',()=>{
  for(const species of ['bristleback','glazefoot']) {
    const {s,a}=fixture(species),before=JSON.stringify(a),status=animalHealthStatus(s,a),html=animalHealthDetails(s,a);
    assert.match(html,/Injury<\/dt><dd>10 · 4 covered by treatment/);
    assert.ok(html.includes(`tolerates ${status.temperatureRange.join('–')} °C`));
    assert.ok(html.includes(esc(status.recoveryReason)));
    assert.ok(html.includes(`Treat · ${VETERINARY.medicine} medicine`));
    assert.ok(html.includes(`${VETERINARY.work} Medicine work · covers up to ${VETERINARY.maxDose} injury`));
    assert.match(html,/data-action="animal-treat"[^>]*data-simulation-action="husbandry.treat"/);
    assert.ok(!html.match(/data-action="animal-treat"[^>]*disabled/));assert.equal(JSON.stringify(a),before);
  }
});

test('treatment buttons expose shared disabled reasons without giving tibbles livestock controls',()=>{
  for(const change of [a=>a.husbandry.trust=0,a=>a.husbandry.post=null,a=>a.condition.treated=a.condition.injury,a=>{a.health=100;a.condition.injury=0;a.condition.treated=0;}]) {
    const {s,a}=fixture();change(a);const eligibility=animalTreatmentEligibility(s,a),html=animalHealthDetails(s,a);
    assert.equal(eligibility.ok,false);assert.match(html,/data-action="animal-treat"[^>]*disabled/);
    assert.ok(html.includes(`data-treatment-reason="${eligibility.code}"`));assert.ok(html.includes(esc(eligibility.message)));
  }
  const {s}=fixture();assert.equal(animalHealthDetails(s,s.creatures.find(a=>a.species==='tibble')),'');
});

test('health and folded traits show the same inherited temperature limits without altering treatment rules',()=>{
  for(const [species,thermal,range] of [['bristleback',[-1,-1],[-45,30]],['glazefoot',[1,1],[-35,35]],['glazefoot',[-1,0],[-42.5,27.5]]]) {
    const {s,a}=fixture(species);a.genetics={origin:'founder',thermal,pace:[-1,1]};
    const before=JSON.stringify(a),profile=animalTraits(a),health=animalHealthStatus(s,a);
    assert.deepEqual(profile.temperatureRange,range);assert.deepEqual(health.temperatureRange,profile.temperatureRange);
    assert.ok(animalHealthDetails(s,a).includes(`tolerates ${range.join('–')} °C`));
    assert.ok(animalTraitDetails(a).includes(`${range.join('–')} °C`));
    assert.ok(!animalHealthDetails(s,a).match(/data-action="animal-treat"[^>]*disabled/));
    a.condition.treated=a.condition.injury;
    assert.match(animalHealthDetails(s,a),/data-action="animal-treat"[^>]*disabled/);
    a.condition.treated=4;assert.equal(JSON.stringify(a),before);
  }
});

test('stress and injury show the shared paused recovery/activity condition and breeding explanation',()=>{
  const {s,a}=fixture();a.condition.thermalStress=-80;
  const status=animalHealthStatus(s,a),html=animalHealthDetails(s,a);
  assert.ok(html.includes(`-80 / 100 · ${status.thermalState}`));assert.ok(html.includes(esc(status.recoveryReason)));
  assert.match(html,/pauses products, collection, growth and breeding/);
  assert.match(breedingDetails(s,a),/Paused: injury needs recovery/);
  a.condition.injury=0;a.condition.treated=0;
  assert.match(breedingDetails(s,a),/Paused: temperature strain needs to ease/);
});

test('simultaneous feeding and treatment remain visible with distinct cancel controls and escaped job reasons',()=>{
  const {s,site,a,t,bindings}=fixture();a.fed=50;
  prepareHusbandry(s,order,cancelJob);
  const feedJob=s.jobs.find(j=>j.kind==='animalCare'&&j.animal===a.id);assert.ok(feedJob);
  const treatment=bindings.setAnimalTreatment(s,a.id);assert.equal(treatment.ok,true);
  const treatJob=s.jobs.find(j=>j.id===treatment.job);
  feedJob.remaining=feedJob.work/2;treatJob.remaining=treatJob.work*.75;treatJob.blockedReason='<waiting> & hungry';
  const html=animalDetails(s,a,pathTo);
  assert.match(html,/Feeding and trust · 50%/);assert.match(html,/Veterinary treatment · 25% · &lt;waiting&gt; &amp; hungry/);
  assert.ok(html.includes(`data-job="${feedJob.id}" data-simulation-action="job.cancel">Cancel feeding`));
  assert.ok(html.includes(`data-job="${treatJob.id}" data-simulation-action="job.cancel">Cancel treatment`));
  assert.match(html,/Feeding finishes before veterinary treatment/);assert.match(html,/Growth and breeding/);assert.match(html,/Handler transport/);
  assert.ok(!html.includes('<waiting>'));assert.match(html,/data-action="animal-treat"[^>]*disabled/);
});

test('actual Treat click invokes one shared husbandry.treat action and cannot grant immediate healing',()=>{
  const {s,a,bindings}=fixture(),inspector={contains:()=>true},results=[],before=structuredClone(a.condition),health=a.health;let calls=0;
  const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
  const source=app.slice(app.indexOf("$('inspector').onclick ="),app.indexOf('let pointer = null;'));
  vm.runInNewContext(source,{$:()=>inspector,deckView:{matches:()=>true},inspectorView:{},state:s,setAnimalTreatment:(...args)=>{calls++;return bindings.setAnimalTreatment(...args);},result:r=>results.push(r)});
  inspector.onclick({target:{closest:()=>({dataset:{action:'animal-treat',animal:a.id}})}});
  assert.equal(calls,1);assert.equal(results[0].ok,true);
  const job=s.jobs.find(j=>j.id===results[0].job);assert.equal(job.kind,'animalTreat');
  assert.deepEqual(job.cost,{medicine:VETERINARY.medicine});assert.equal(job.work,VETERINARY.work);
  assert.equal(a.health,health);assert.deepEqual(a.condition,before);
  assert.match(app,/'animal-treat':'husbandry.treat'/);
});
