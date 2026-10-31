import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, serialize, pathTo } from '../src/simulation.js';
import { planetDefinitions, siteDefinition } from '../src/region.js';
import { sectorDefinition, sectorWorld } from '../src/sector-sites.js';
import { createSectorSite } from '../src/sector-generation.js';
import { tileAt, positionOf } from '../src/spatial.js';
import { isLivestock } from '../src/livestock-data.js';
import { registerAnimalDeath } from '../src/animal-carcasses.js';
import { pastureRegions, setPastureGate } from '../src/pastures.js';
import { observe, startRecording, exportRecording, capture, TELEMETRY_VERSION, tileEntityId } from '../src/telemetry.js';
import { postDetails, pastureDetails, animalDetails, animalButcheryDetails, transportDetails } from '../src/husbandry-panels.js';

const digest = s => createHash('sha256').update(serialize(s)).digest('hex');
// Synthetic observation boundary: actual native sector initialization plus two
// installed pens and an upper platform. This tests labels/ownership/purity, not
// paid construction, exploration admission or ordinary colony endurance.
function fixture() {
  const s=createGame(257),planet=Object.values(planetDefinitions(s)).find(p=>p.home==='surface');
  const world=sectorWorld(s,planet.id),entry={planetId:planet.id,x:(world.landing.x+1)%world.width,y:world.landing.y};
  const definition=sectorDefinition(s,entry),prepared=createSectorSite(s,definition),site=prepared.site;
  s.sectorSites={[site.id]:entry};s.sites[site.id]=site;s.outposts[site.id]={established:false,residents:[]};
  s.creatures.push(...prepared.creatures);
  const home=s.creatures.find(a=>a.site==='surface'&&isLivestock(a));
  const remote=s.creatures.find(a=>a.site===site.id&&isLivestock(a));assert.ok(remote,'native sector has livestock');
  const blank=site.tiles.find(t=>t.terrain==='ground'&&!t.building&&!t.deposit&&!t.liquid);
  site.levels.push({z:1,name:'Observation platform'});
  site.tiles.push(...site.tiles.map(t=>({...structuredClone(blank),x:t.x,y:t.y,z:1,terrain:'void',building:null,flora:{},drop:null})));
  const pen=(target,z,lichen)=>{
    for(let y=20;y<=26;y++)for(let x=20;x<=26;x++){
      const t=tileAt(target,{x,y,z});Object.assign(t,{terrain:'ground',building:x===20||x===26||y===20||y===26?'fence':null,hp:100,flora:{lichen:{biomass:lichen,harvests:0,origin:'native',generation:'native'}}});
      delete t.gateMode;delete t.liquid;delete t.deposit;
    }
    for(let y=0;y<20;y++){const t=tileAt(target,{x:23,y,z});Object.assign(t,{terrain:'ground',building:null,hp:100,flora:{}});delete t.liquid;delete t.deposit;}
    const gate=tileAt(target,{x:23,y:20,z});gate.building='pastureGate';gate.gateMode='latched';
    const post=tileAt(target,{x:23,y:23,z});post.building='husbandryPost';return {gate,post};
  };
  const homePen=pen(s.sites.surface,0,20),remotePen=pen(site,0,40),upperPen=pen(site,1,60);
  for(const [animal,post] of [[home,homePen.post],[remote,remotePen.post]]){
    Object.assign(animal,{x:22,y:23,z:0});animal.husbandry.post=positionOf(post);animal.husbandry.trust=100;animal.lifecycle.enabled=false;
  }
  return {s,site,definition,home,remote,homePen,remotePen,upperPen};
}

test('observations expose canonical sector metadata and separate same-coordinate pastures without mutation',()=>{
  const f=fixture(),before=digest(f.s),o=observe(f.s);
  assert.equal(TELEMETRY_VERSION,11);assert.equal(o.schemaVersion,11);
  assert.deepEqual(o.entities[`site:${f.site.id}`].definition,siteDefinition(f.s,f.site.id));
  assert.deepEqual(o.entities[`site:${f.site.id}`].definition.sector,f.definition.sector);
  assert.deepEqual(o.entities[`site:${f.site.id}`].definition.landing,f.definition.landing);
  assert.equal(o.entities[`site:${f.site.id}`].definition.template,'sector');
  const home=o.entities[f.home.id].derived.pasture,remote=o.entities[f.remote.id].derived.pasture;
  assert.equal(home.enclosed,true);assert.equal(remote.enclosed,true);assert.equal(home.postReachable,true);assert.equal(remote.postReachable,true);
  assert.notEqual(home.region,remote.region);assert.equal(o.entities[home.region].site,'surface');assert.equal(o.entities[remote.region].site,f.site.id);
  assert.equal(home.region,pastureRegions(f.s.sites.surface).byCell.get('22,23,0').id);
  assert.ok(home.region.startsWith('pasture:surface:'));assert.ok(remote.region.startsWith(`pasture:${f.site.id}:`));
  assert.ok(remote.lichen>home.lichen);assert.equal(digest(f.s),before);
  o.entities[`site:${f.site.id}`].definition.sector.x=-1;
  assert.equal(siteDefinition(f.s,f.site.id).sector.x,f.definition.sector.x);
});

test('animal and post panels scope assignments, reservations and transport to the selected site and floor',()=>{
  const f=fixture(),before=digest(f.s);
  const home=postDetails(f.s,f.homePen.post,pathTo),remote=postDetails(f.s,f.remotePen.post,pathTo,f.site.id);
  assert.match(home,new RegExp(`data-entity="${f.home.id}"`));assert.doesNotMatch(home,new RegExp(`data-entity="${f.remote.id}"`));
  assert.match(remote,new RegExp(`data-entity="${f.remote.id}"`));assert.doesNotMatch(remote,new RegExp(`data-entity="${f.home.id}"`));
  assert.match(transportDetails(f.s,f.remote),new RegExp(`data-site="${f.site.id}" data-x="23" data-y="23" data-z="0"`));
  assert.match(transportDetails(f.s,f.remote),/data-z="1"/);
  assert.match(pastureDetails(f.s,f.remotePen.post,f.site.id),/Enclosed pasture/);
  assert.match(animalDetails(f.s,f.remote,pathTo),/23 \/ 23 · floor 0/);
  assert.equal(digest(f.s),before);
  f.remote.husbandry.post=null;
  const available=postDetails(f.s,f.remotePen.post,pathTo,f.site.id);
  assert.match(available,new RegExp(`data-action="animal-assign" data-animal="${f.remote.id}"`));
  assert.doesNotMatch(available,new RegExp(`data-animal="${f.home.id}"`));
  f.s.jobs.push({id:'other-site-reservation',kind:'animalButcher',animal:f.home.id,site:'surface',...positionOf(f.remotePen.post)});
  assert.doesNotMatch(postDetails(f.s,f.remotePen.post,pathTo,f.site.id),/Reserved for butchery/);
  f.s.jobs.push({id:'remote-reservation',kind:'animalButcher',animal:f.remote.id,site:f.site.id,...positionOf(f.remotePen.post)});
  assert.match(postDetails(f.s,f.remotePen.post,pathTo,f.site.id),new RegExp(`Reserved for butchery of ${f.remote.id}`));
  assert.doesNotMatch(postDetails(f.s,f.upperPen.post,pathTo,f.site.id),/Reserved for butchery/);
});

test('corpse observations and butchery buttons retain actual site and full-floor targets',()=>{
  const f=fixture();Object.assign(f.remote,positionOf(f.upperPen.post));registerAnimalDeath(f.s,f.remote,'unknown');
  const before=digest(f.s),o=observe(f.s),body=o.entities[`carcass:${f.remote.id}`],choices=o.entities[f.remote.id].derived.butchery;
  assert.equal(body.site,f.site.id);assert.equal(body.z,1);
  assert.ok(choices.some(choice=>choice.target===tileEntityId(f.site.id,23,23,0)&&choice.ok));
  assert.ok(choices.some(choice=>choice.target===tileEntityId(f.site.id,23,23,1)&&choice.ok));
  assert.ok(choices.every(choice=>choice.target.startsWith(`tile:${f.site.id}:`)));
  const html=animalButcheryDetails(f.s,f.remote);
  assert.match(html,new RegExp(`On tile ${f.site.id} 23 / 23 · floor 1`));
  assert.match(html,new RegExp(`data-site="${f.site.id}" data-x="23" data-y="23" data-z="1"`));
  const reasonIds=[...html.matchAll(/id="([^"]+:butcher:[^"]+)"/g)].map(match=>match[1]);
  assert.equal(reasonIds.length,2);assert.equal(new Set(reasonIds).size,2);assert.equal(digest(f.s),before);
});

test('version 11 recordings name the remote gate and pasture change without altering home containment',()=>{
  const f=fixture();startRecording(f.s,{maxBytes:64_000_000});
  const before=observe(f.s),homeRegion=before.entities[f.home.id].derived.pasture;
  const result=setPastureGate(f.s,f.site.id,23,20,'open',0);assert.equal(result.ok,true,result.message);capture(f.s);
  const rows=exportRecording(f.s).trim().split('\n').map(JSON.parse),after=observe(f.s);
  assert.equal(rows[0].schemaVersion,11);assert.equal(rows.at(-1).schemaVersion,11);
  assert.deepEqual(after.entities[f.home.id].derived.pasture,homeRegion);
  assert.equal(after.entities[f.remote.id].derived.pasture.enclosed,false);
  assert.ok(rows.some(row=>row.event?.id==='pasture.gate.mode_changed'&&row.event.entity===tileEntityId(f.site.id,23,20,0)));
  assert.ok(rows.some(row=>row.event?.id==='animal.containment.lost'&&row.event.entity===f.remote.id));
  assert.ok(rows.some(row=>row.changes?.some(change=>change.entity===tileEntityId(f.site.id,23,20,0)&&change.path[0]==='gateMode')));
});
