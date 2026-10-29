import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,serialize,deserialize} from '../src/simulation.js';
import {currentOutpost} from './helpers/current-outpost.js';
import {tileAt,positionOf,horizontalNeighbors} from '../src/spatial.js';
import {updateRooms,roomAt,fillRoom,refreshAtmosphere} from '../src/atmosphere.js';
import {refreshPower} from '../src/power.js';
import {ignite} from '../src/fire.js';
import {executeAction} from '../src/controls.js';
import {startRecording,exportRecording,observe,tileEntityId} from '../src/telemetry.js';
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
const check=s=>{const raw=serialize(s);assert.equal(serialize(deserialize(raw)),raw);};
// Synthetic sealed compartments, initial gas and positioned occupants isolate
// exposure boundaries. These tests are not paid construction or endurance runs.
function upper(s,site){
 const blank=s.sites.wreck.tiles.find(t=>t.terrain==='void'&&!t.building&&!t.drop);
 site.levels.push({z:1,name:'Upper exposure test deck'});
 for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z:1});
}
function idle(s){
 for(const c of s.crew){for(const labor of Object.keys(c.labors))c.labors[labor]=false;if(c.site==='surface')assert.equal(executeAction(s,'crew.routine',{crew:c.id,policy:'work'}).ok,true);}
 for(const site of Object.values(s.sites)){site.fireSafety.automatic=false;for(const t of site.tiles)if(t.machine)t.machine.enabled=false;refreshPower(s,site);}
}
function cabin(s,site,p){
 const center=tileAt(site,p);center.terrain='floor';center.building='commons';
 for(const q of horizontalNeighbors(p)){const t=tileAt(site,q);t.terrain='floor';t.building='wall';t.hp=100;}
 updateRooms(site);const room=roomAt(site,p.x,p.y,p.z);assert.equal(room.sealed,true);fillRoom(room,100);
 const heat=room.volume*20*(20+273.15);site.thermal.heating+=heat-room.heat;room.heat=heat;
 refreshAtmosphere(site);refreshPower(s,site);return center;
}
function fireFixture(fireZ){
 const s=createGame(),site=s.sites.surface;upper(s,site);idle(s);
 const upperTile=cabin(s,site,{x:11,y:9,z:1}),lower=tileAt(site,{x:11,y:9,z:0});lower.building='commons';refreshPower(s,site);
 Object.assign(s.crew[0],{x:11,y:9,z:0});Object.assign(s.crew[1],{x:11,y:9,z:1});
 const t=fireZ===1?upperTile:lower;assert.ok(ignite(s,site,t));return {s,site,t};
}
for(const z of [0,1])test(`crew fire exposure uses floor ${z}, leaving the stacked neighbor unharmed`,()=>{
 const {s,t}=fireFixture(z);check(s);const copy=deserialize(serialize(s)),before=serialize(s);observe(s);assert.equal(serialize(s),before);
 startRecording(s);step(s);step(copy);assert.equal(serialize(s),serialize(copy));
 assert.ok(s.crew[z].medical.injury>0);assert.equal(s.crew[1-z].medical.injury,0);
 const hits=events(s).filter(e=>e.id==='fire.exposure'&&[s.crew[0].id,s.crew[1].id].includes(e.actor));
 assert.equal(hits.length,1);assert.equal(hits[0].actor,s.crew[z].id);assert.equal(hits[0].entity,t.fire.id);assert.equal(hits[0].target,tileEntityId('surface',11,9,z));check(s);
});

test('animal fire exposure labels the same actual-floor tile as crew exposure',()=>{
 const {s}=fireFixture(1),animal=s.creatures[0];Object.assign(animal,{x:11,y:9,z:1});startRecording(s);step(s);
 const hits=events(s).filter(e=>e.id==='fire.exposure');assert.ok(hits.some(e=>e.actor===animal.id&&e.target==='tile:surface:11:9:1'));check(s);
});

function wreck(){
 const s=currentOutpost(),site=s.sites.wreck;upper(s,site);idle(s);s.tick=64;for(const local of Object.values(s.sites))local.atmosphere.tick=s.tick;
 return {s,site,lower:s.crew.find(c=>c.id==='crew-4'),higher:s.crew.find(c=>c.id==='crew-2')};
}
test('a docked shuttle shields only its terminal floor and labels upstairs debris exposure',()=>{
 const {s,site,lower,higher}=wreck(),p={x:4,y:11,z:1};tileAt(site,p).terrain='floor';
 Object.assign(lower,{x:4,y:11,z:0});Object.assign(higher,p);updateRooms(site);refreshAtmosphere(site);refreshPower(s,site);check(s);
 startRecording(s);step(s);assert.equal(lower.medical.injury,0);assert.equal(higher.medical.injury,4);
 const hits=events(s).filter(e=>e.id==='wreck.debris.exposure');assert.equal(hits.length,1);assert.equal(hits[0].entity,higher.id);assert.equal(hits[0].target,'tile:wreck:4:11:1');check(s);
});

test('a sealed upstairs habitat shelters crew even when the ground tile is empty space',()=>{
 const {s,site,lower,higher}=wreck(),p={x:3,y:3,z:1};assert.equal(tileAt(site,{...p,z:0}).terrain,'void');cabin(s,site,p);
 Object.assign(higher,p);Object.assign(lower,{...p,z:0});check(s);const copy=deserialize(serialize(s));startRecording(s);step(s);step(copy);assert.equal(serialize(s),serialize(copy));
 assert.equal(higher.medical.injury,0);assert.equal(lower.medical.injury,4);
 const hits=events(s).filter(e=>e.id==='wreck.debris.exposure');assert.equal(hits.length,1);assert.equal(hits[0].target,'tile:wreck:3:3');check(s);
});
