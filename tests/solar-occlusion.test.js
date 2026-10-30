import {migrateRegion} from '../src/region.js';
import {projectPreRegion} from './helpers/legacy-projection.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';
import {deserialize,serialize,step} from '../src/simulation.js';
import {BUILDINGS,VERSION} from '../src/data.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {step as hexStep} from '../src/geometry.js';
import {solarExposure,solarStatus} from '../src/solar.js';
import {initializePower,initializeElectrical,previewPower,refreshPower,updatePower,validatePower} from '../src/power.js';
import {powerDetails} from '../src/power-panels.js';
import {observe,startRecording,exportRecording,tileEntityId} from '../src/telemetry.js';
import {executeAction} from '../src/controls.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/solar-schema58.json.gz',import.meta.url))).toString();
const lower={x:8,y:8,z:0},roof={x:8,y:8,z:1};
const fresh=()=>{const s=deserialize(raw);return {s,site:s.sites.surface};};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function physical(s){const copy=structuredClone(s);delete copy.version;for(const site of Object.values(copy.sites)){delete site.power;delete site.circuits;for(const t of site.tiles)for(const k of ['powered','circuit','powerStatus','wetShort'])delete t[k];}return copy;}
function column(){const site={id:'surface',size:7,levels:[{z:0},{z:1},{z:2}],tiles:[]},s={version:VERSION,tick:0,sites:{surface:site}};
 for(const {z} of site.levels)for(let y=0;y<7;y++)for(let x=0;x<7;x++)site.tiles.push({x,y,z,terrain:z===0?'floor':'void',building:null,hp:100,cable:null});initializePower(s,site);return {s,site,panel:device(site,{x:3,y:3,z:0},'solar')};}
function device(site,p,building){const t=tileAt(site,p);t.terrain='floor';t.building=building;initializeElectrical(t);return t;}

test('nearest opaque overhead tile blocks sunlight while empty gaps and utility overlays remain transparent',()=>{
 const f=column(),near=tileAt(f.site,{x:3,y:3,z:1}),far=tileAt(f.site,{x:3,y:3,z:2});near.cable={hp:100,enabled:true};near.pipe={hp:100,open:true};assert.equal(solarExposure(f.site,f.panel).exposed,true);
 tileAt(f.site,{x:4,y:3,z:1}).terrain='floor';assert.equal(solarExposure(f.site,f.panel).exposed,true);
 far.terrain='rock';assert.deepEqual(solarExposure(f.site,f.panel).blockedBy,positionOf(far));near.terrain='floor';assert.deepEqual(solarExposure(f.site,f.panel).blockedBy,positionOf(near));
 near.terrain='void';near.building='wall';assert.deepEqual(solarExposure(f.site,f.panel).blockedBy,positionOf(near));near.hp=0;assert.deepEqual(solarExposure(f.site,f.panel).blockedBy,positionOf(far));far.terrain='void';assert.equal(solarStatus(f.s,f.site,f.panel).output,4);
});
test('genuine schema58 covered-panel save migrates only derived power without losing stored energy or supplies',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'e06a3e4a48abe2a92112733104d8a2b0b465f1754bbc285c411a3e1da86ebebd');
 const old=JSON.parse(raw),{s,site}=fresh();old.resources.tools=0;assert.equal(old.version,58);assert.equal(s.version,VERSION);assert.deepEqual(physical(projectPreRegion(s)),physical(old));
 assert.equal(site.power.output,old.sites.surface.power.output-4);assert.equal(solarStatus(s,site,tileAt(site,lower)).output,0);assert.match(tileAt(site,lower).powerStatus,/Blocked above.*floor 1/);
 assert.equal(serialize(deserialize(serialize(s))),serialize(s));
});
test('migration validates old totals and energy before recalculation, and current stale power rejects',()=>{
 for(const mutate of [s=>s.sites.surface.energy.generated++,s=>s.sites.surface.power.output++,s=>tileAt(s.sites.surface,lower).powerStatus='invented']){const s=JSON.parse(raw);mutate(s);assert.throws(()=>deserialize(serialize(s)));}
 const bad=JSON.parse(raw);migrateRegion(bad);bad.version=VERSION;for(const site of Object.values(bad.sites))for(const t of site.tiles)if(t.building==='stockpile')t.storage.limits={};bad.resources.tools=0;assert.throws(()=>deserialize(serialize(bad)),/Power totals/);
});
test('paid construction on the roof generates upstairs while the covered lower panel stays blocked',()=>{
 const {s,site}=fresh(),before=site.power.output,result=executeAction(s,'job.order',{site:'surface',...roof,kind:'build',building:'solar'});assert.equal(result.ok,true,result.message);const j=s.jobs.find(j=>j.id===result.job);assert.deepEqual(j.cost,{alloy:5});assert.equal(j.work,8);assert.equal(tileAt(site,roof).building,null);
 for(let i=0;i<140&&s.jobs.includes(j);i++)step(s);assert.ok(!s.jobs.includes(j));assert.equal(tileAt(site,roof).building,'solar');assert.equal(solarStatus(s,site,tileAt(site,roof)).output,4);assert.equal(solarStatus(s,site,tileAt(site,lower)).output,0);assert.equal(site.power.output,before+4);deserialize(serialize(s));
});
test('a shaded circuit uses only its finite battery reserve and keeps energy accounting balanced',()=>{
 const f=column(),[bx,by]=hexStep(3,3,'ne'),[lx,ly]=hexStep(bx,by,'ne'),bank=device(f.site,{x:bx,y:by,z:0},'battery'),load=device(f.site,{x:lx,y:ly,z:0},'holo');bank.charge=20;f.site.energy.initial+=20;tileAt(f.site,{x:3,y:3,z:1}).terrain='floor';
 const before=JSON.stringify(f.s);assert.equal(previewPower(f.s,f.site).networks.find(n=>n.sources.has(f.panel)).sources.get(f.panel),0);assert.equal(JSON.stringify(f.s),before);
 updatePower(f.s,f.site);assert.equal(load.powered,true);assert.equal(f.site.energy.generated,0);assert.equal(bank.charge,20-BUILDINGS.holo.demand);assert.equal(f.site.energy.consumed,BUILDINGS.holo.demand);validatePower(f.s,f.site);
});
test('daylight and panel condition still gate clear or covered arrays',()=>{
 const f=column();f.panel.hp=50;assert.equal(solarStatus(f.s,f.site,f.panel).output,2);f.s.tick=220;assert.equal(solarStatus(f.s,f.site,f.panel).reason,'night');assert.equal(solarStatus(f.s,f.site,f.panel).output,0);
 tileAt(f.site,{x:3,y:3,z:1}).terrain='floor';assert.equal(solarStatus(f.s,f.site,f.panel).exposed,false);f.s.tick=300;assert.equal(solarStatus(f.s,f.site,f.panel).reason,'blocked');f.panel.hp=0;assert.equal(solarStatus(f.s,f.site,f.panel).reason,'damaged');
});
test('observations and the inspector identify the same blocker without mutating state',()=>{
 const {s,site}=fresh(),panel=tileAt(site,lower),before=serialize(s),id=tileEntityId('surface',lower.x,lower.y,lower.z),status=observe(s).entities[id].derived.solar;
 assert.deepEqual(status.blockedBy,roof);assert.equal(status.reason,'blocked');assert.equal(status.output,0);assert.equal(status.status,panel.powerStatus);assert.match(powerDetails(site,panel),/Blocked at floor 1/);assert.equal(serialize(s),before);
});
test('availability changes are recorded once and power preview, refresh and validation cannot create energy',()=>{
 const {s,site}=fresh(),panel=tileAt(site,lower),cover=tileAt(site,roof),energy=structuredClone(site.energy);startRecording(s);
 // Boundary roof clearing isolates sunlight from unrelated construction work.
 cover.terrain='void';const before=serialize(s);previewPower(s,site);assert.equal(serialize(s),before);refreshPower(s,site);refreshPower(s,site);validatePower(s,site);assert.deepEqual(site.energy,energy);
 const changed=events(s).filter(e=>e.id==='power.solar.availability.changed');assert.equal(changed.length,1);assert.equal(changed[0].entity,tileEntityId('surface',lower.x,lower.y,0));assert.equal(changed[0].reason,'generating');assert.equal(changed[0].blockedBy,null);assert.equal(changed[0].availableOutput,4);assert.equal(panel.powerStatus,'Generating');
});

test('isolated solar generation is curtailed without supplying neighbors, with matching cable diagnostics',()=>{
 const f=column(),[x,y]=hexStep(3,3,'ne'),load=device(f.site,{x,y,z:0},'holo');f.panel.cable={hp:100,enabled:false};
 refreshPower(f.s,f.site);assert.equal(solarStatus(f.s,f.site,f.panel).reason,'cable_off');assert.equal(f.panel.powerStatus,'Cable switched off');assert.equal(f.site.power.output,4);assert.equal(load.powered,false);
 updatePower(f.s,f.site);assert.equal(f.site.energy.generated,4);assert.equal(f.site.energy.curtailed,4);assert.equal(f.site.energy.consumed,0);validatePower(f.s,f.site);
 f.panel.cable.enabled=true;f.panel.cable.hp=0;refreshPower(f.s,f.site);assert.equal(solarStatus(f.s,f.site,f.panel).reason,'cable_damaged');assert.equal(f.panel.powerStatus,'Needs cable repair');assert.equal(f.site.power.output,4);assert.equal(load.powered,false);
 f.panel.cable.hp=100;refreshPower(f.s,f.site);assert.equal(f.panel.powerStatus,'Generating');assert.equal(f.site.power.output,solarStatus(f.s,f.site,f.panel).output);assert.equal(f.site.power.output,4);assert.equal(load.powered,true);
 tileAt(f.site,{x:3,y:3,z:1}).terrain='floor';refreshPower(f.s,f.site);assert.equal(f.site.power.output,0);assert.equal(load.powered,false);validatePower(f.s,f.site);
});
