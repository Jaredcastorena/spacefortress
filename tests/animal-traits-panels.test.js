import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at, pathTo } from '../src/simulation.js';
import { animalTraits, neutralGenome } from '../src/animal-traits.js';
import { animalDetails, animalTraitDetails, breedingDetails } from '../src/husbandry-panels.js';

function fixture(species='bristleback') {
  const s=createGame(),a=s.creatures.find(a=>a.species===species),t=at(s.sites.surface,12,10);
  t.building='husbandryPost';t.hp=100;a.x=t.x;a.y=t.y;a.husbandry.post=[t.x,t.y];a.husbandry.trust=100;
  a.genetics={origin:'founder',thermal:[-1,-1],pace:[1,1]};
  return {s,a,t};
}

test('inherited trait details stay folded, show actual tradeoffs and never change state',()=>{
  const {s,a}=fixture(),before=JSON.stringify(a),rng=s.rng,html=animalTraitDetails(a);
  assert.ok(html.includes(`data-panel-key="animal-traits:${a.id}"`));
  assert.match(html,/<details class="animal-traits"[^>]*><summary>Inherited traits · Cold adapted · Fast pace/);
  assert.ok(!html.match(/<details[^>]* open/));assert.ok(!html.includes('data-action='));
  assert.match(html,/Temperature range<\/dt><dd>-45–30 °C · -5 °C shift/);
  assert.match(html,/Product and feed pace<\/dt><dd>\+20% from species base/);
  assert.match(html,/Product progress<\/dt><dd>0.3 \/ tick/);
  assert.match(html,/Adult feed drain<\/dt><dd>0.018 nutrition \/ tick/);
  assert.match(html,/Hatchling feed drain<\/dt><dd>0.0096 nutrition \/ tick/);
  assert.match(html,/Colder temperatures tolerated; the heat limit also moves lower/);
  assert.match(html,/Faster product progress costs faster feed drain/);
  assert.equal(JSON.stringify(a),before);assert.equal(s.rng,rng);
});

test('heat tolerance and slower pace show species-specific limits and real reduced rates',()=>{
  const {a}=fixture('glazefoot');a.genetics={origin:'founder',thermal:[1,1],pace:[-1,-1]};
  const html=animalTraitDetails(a);
  assert.match(html,/Heat adapted · Slow pace/);assert.match(html,/-35–35 °C · \+5 °C shift/);
  assert.match(html,/-20% from species base/);assert.match(html,/Product progress<\/dt><dd>0.2 \/ tick/);
  assert.match(html,/Adult feed drain<\/dt><dd>0.012 nutrition \/ tick/);
  assert.match(html,/Hatchling feed drain<\/dt><dd>0.0064 nutrition \/ tick/);
  assert.match(html,/Hotter temperatures tolerated; the cold limit also moves higher/);
  assert.match(html,/Slower product progress reduces feed drain/);
});

test('partial expression and balanced legacy alleles retain precise rates and clear inheritance language',()=>{
  const {a}=fixture();a.genetics={origin:'founder',thermal:[-1,0],pace:[0,1]};
  const partial=animalTraitDetails(a);
  assert.match(partial,/-42.5–32.5 °C · -2.5 °C shift/);assert.match(partial,/\+10% from species base/);
  assert.match(partial,/Product progress<\/dt><dd>0.275 \/ tick/);
  assert.match(partial,/Adult feed drain<\/dt><dd>0.0165 nutrition \/ tick/);
  assert.match(partial,/Hatchling feed drain<\/dt><dd>0.0088 nutrition \/ tick/);
  a.genetics=neutralGenome();const neutral=animalTraitDetails(a);
  assert.match(neutral,/Balanced established traits/);assert.match(neutral,/Balanced thermal tolerance · Balanced pace/);
  assert.match(neutral,/-40–35 °C · 0 °C shift/);assert.match(neutral,/0% from species base/);
  assert.match(neutral,/Balanced parents can have young with different traits/);
});

test('pending brood shows frozen child effects and ordered parent IDs with escaped text',()=>{
  const {a}=fixture();a.genetics=neutralGenome();a.lifecycle.parents=['ancestor <one>','ancestor "two"'];
  const child={origin:'inherited',thermal:[-1,-1],pace:[1,1]};
  a.lifecycle.brood={id:'brood<1>',mate:'mate&2',started:0,progress:15,inheritance:{parents:[{id:a.id,genetics:structuredClone(a.genetics)},{id:'mate&2',genetics:neutralGenome()}],child}};
  const before=JSON.stringify(a),html=animalTraitDetails(a),pending=html.slice(html.indexOf('<h3>Pending brood traits'));
  assert.match(html,/ancestor &lt;one&gt; · ancestor &quot;two&quot;/);
  assert.match(pending,/Brood<\/dt><dd>brood&lt;1&gt;/);
  assert.ok(pending.includes(`${a.id} · mate&amp;2`));
  assert.match(pending,/Cold adapted · Fast pace/);assert.match(pending,/-45–30 °C/);
  assert.match(pending,/0.3 \/ tick/);assert.match(pending,/0.018 nutrition \/ tick/);
  assert.match(pending,/inherited traits were fixed at conception\. Birth preserves these traits/);
  assert.ok(html.includes('Balanced thermal tolerance · Balanced pace'));
  assert.ok(!html.includes('ancestor <one>'));assert.ok(!html.includes('brood<1>'));
  assert.equal(JSON.stringify(a),before);assert.deepEqual(animalTraits({...a,genetics:child}).temperatureRange,[-45,30]);
});

test('animal inspector preserves existing care and breeding controls beside folded traits',()=>{
  const {s,a}=fixture();a.lifecycle.enabled=false;
  const before=JSON.stringify(a),html=animalDetails(s,a,pathTo);
  assert.match(html,/HEALTH & RECOVERY/);assert.match(html,/Inherited traits/);assert.match(html,/Growth and breeding/);
  assert.match(html,/data-action="animal-policy"/);assert.match(html,/data-action="animal-breed"[^>]*aria-pressed="false">Enable breeding/);
  assert.equal((html.match(/class="animal-traits"/g)||[]).length,1);assert.equal(JSON.stringify(a),before);
  a.health=0;assert.ok(!breedingDetails(s,a).includes('data-action="animal-breed"'));
  assert.ok(!animalTraitDetails(a).includes('data-action='));
});

test('pests receive no livestock traits or inheritance controls',()=>{
  const {s}=fixture(),pest=s.creatures.find(a=>a.species==='tibble');
  assert.equal(animalTraits(pest),null);assert.equal(animalTraitDetails(pest),'');assert.equal(animalDetails(s,pest,pathTo),'');
});
