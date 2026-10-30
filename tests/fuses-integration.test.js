import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,at,serialize,deserialize,step} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {initializeStorage,syncResources} from '../src/inventory.js';
import {initializeElectrical,refreshPower,updatePower,previewPower,fuseConditions,breakerConditions,validatePower} from '../src/power.js';
import {setFuse,validateFuses} from '../src/fuses.js';
import {setBreaker,validateBreakers} from '../src/breakers.js';
import {startRecording,exportRecording,observe} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/fuses-schema73.json.gz',import.meta.url))).toString();
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function install(s,kind,x,y,z=0){const t=at(s.sites.surface,x,y,z);assert.equal(t.building,null);t.building=kind;t.hp=100;initializeStorage(t);initializeElectrical(t);return t;}
function base(){const s=createGame(74253),site=s.sites.surface;for(const t of site.tiles){t.cable=null;if(t.machine)t.machine.enabled=false;}return {s,site};}
function fuse(f,t,rating=4,direction='ne'){assert.equal(setFuse(f.s,'surface',t.x,t.y,true,direction,t.z??0,rating).ok,true);}
function fixture({source='advanced',extra=true,rating=4}={}){const f=base();f.source=install(f.s,source,9,9);f.fuse=install(f.s,'fuseBox',10,9);f.load=install(f.s,'scrubber',11,8);if(extra)f.extra=install(f.s,'climate',11,9);fuse(f,f.fuse,rating);return f;}
function tick(f){f.s.tick++;updatePower(f.s,f.site);refreshPower(f.s,f.site,false);validatePower(f.s,f.site);validateFuses(f.s);validateBreakers(f.s);}
// Controlled finite circuit arrangements isolate power behavior. Native paid
// construction, carriage and replacement are covered separately in fuse-work.
test('genuine schema73 preserves pending breaker history and rejects future fuse records',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'4d719dd30dd3048143d10581da72bbb77f1b5d88afc7ad5f46f95b8f7113ba9b');
 const expected=JSON.parse(raw);expected.version=VERSION;const s=deserialize(raw);assert.equal(serialize(s),JSON.stringify(expected));
 assert.equal(at(s.sites.surface,12,10).protection.overload.ticks,2);step(s);assert.equal(at(s.sites.surface,12,10).protection.cause,'overload');
 for(const mutate of [t=>t.building='fuseBox',t=>t.protection.kind='fuse']){const old=JSON.parse(raw);mutate(at(old.sites.surface,12,10));assert.throws(()=>deserialize(JSON.stringify(old)),/fuse/i);}
});
test('pure previews preserve fuse state and a first overloaded tick opens before power commits',()=>{
 const f=fixture();startRecording(f.s);const before=serialize(f.s);for(let n=0;n<3;n++){previewPower(f.s,f.site);fuseConditions(f.s,f.site,f.fuse);observe(f.s);refreshPower(f.s,f.site,false);}assert.equal(serialize(f.s),before);
 const info=fuseConditions(f.s,f.site,f.fuse);assert.equal(info.wouldBlow,true);close(info.plannedThroughput,5);const consumed=f.site.energy.consumed;tick(f);
 assert.equal(f.fuse.protection.blown,true);assert.equal(f.fuse.protection.enabled,true);assert.equal(f.load.powered,false);close(f.site.energy.consumed,consumed);close(f.fuse.protection.lastThroughput,0);
 const blown=events(f.s).filter(e=>e.id==='power.fuse.blown');assert.equal(blown.length,1);close(blown[0].attemptedThroughput,5);close(blown[0].effectiveRating,4);tick(f);assert.equal(events(f.s).filter(e=>e.id==='power.fuse.blown').length,1);
});
test('condition lowers rating and equality remains safe',()=>{
 const f=fixture({extra:false});f.fuse.hp=75;refreshPower(f.s,f.site);close(fuseConditions(f.s,f.site,f.fuse).effectiveRating,3);tick(f);assert.equal(f.fuse.protection.blown,false);close(f.fuse.protection.lastThroughput,3);
 f.fuse.hp=74;tick(f);assert.equal(f.fuse.protection.blown,true);
});
test('a series fuse opens immediately while a delayed breaker loses its pending count',()=>{
 const f=base();install(f.s,'advanced',9,9);const b=install(f.s,'breaker',10,9),a=install(f.s,'fuseBox',11,8);install(f.s,'scrubber',12,8);install(f.s,'climate',12,9);
 assert.equal(setBreaker(f.s,'surface',b.x,b.y,true,'ne','overload',0,4).ok,true);b.protection.overload.ticks=1;fuse(f,a);
 const bank=at(f.site,13,7),charge=bank.charge;tick(f);assert.equal(a.protection.blown,true);assert.equal(b.protection.tripped,false);assert.equal(b.protection.overload.ticks,0);close(bank.charge,charge-5);
});
function parallel(second='fuseBox'){
 const f=base();install(f.s,'advanced',9,9);f.a=install(f.s,'fuseBox',10,9);f.b=install(f.s,second,10,10);at(f.site,9,10).cable={hp:100,enabled:true};at(f.site,11,8).cable={hp:100,enabled:true};install(f.s,'scrubber',11,9);install(f.s,'climate',12,9);fuse(f,f.a);
 if(second==='fuseBox')fuse(f,f.b);else assert.equal(setBreaker(f.s,'surface',f.b.x,f.b.y,true,'ne','overload',0,4).ok,true);return f;
}
test('parallel fuse cascade settles all contacts before consuming any branch energy',()=>{
 const f=parallel();close(fuseConditions(f.s,f.site,f.a).plannedThroughput,5);close(fuseConditions(f.s,f.site,f.b).plannedThroughput,0);const used=f.site.energy.consumed;tick(f);
 assert.equal(f.a.protection.blown,true);assert.equal(f.b.protection.blown,true);close(f.site.energy.consumed,used);
});
test('rerouted flow advances a surviving breaker exactly once',()=>{
 const f=parallel('breaker');f.b.protection.overload.ticks=1;const used=f.site.energy.consumed;tick(f);assert.equal(f.a.protection.blown,true);assert.equal(f.b.protection.tripped,false);assert.equal(f.b.protection.overload.ticks,2);close(f.site.energy.consumed-used,5);
});
test('reverse battery discharge also blows the fuse without spending charge',()=>{
 const f=base();const a=install(f.s,'fuseBox',10,9),load=install(f.s,'scrubber',9,9);install(f.s,'climate',9,10);const bank=install(f.s,'battery',11,8),existing=at(f.site,13,7);bank.charge=20;existing.charge-=20;fuse(f,a);
 assert.ok(fuseConditions(f.s,f.site,a).signedThroughput<0);const charge=bank.charge;tick(f);assert.equal(a.protection.blown,true);assert.equal(load.powered,false);close(bank.charge,charge);
});
test('replanning commits reactor fuel and generated energy only once',()=>{
 const f=fixture({source:'reactor'});at(f.site,8,10).stock.fuel-=1;f.source.machine.input.fuel=1;syncResources(f.s);refreshPower(f.s,f.site);const before=structuredClone(f.site.reactorLedger);tick(f);assert.equal(f.fuse.protection.blown,true);close(f.site.reactorLedger.generated-before.generated,40);close(f.site.reactorLedger.fuelUsed-before.fuelUsed,.02);
});
test('fault overload opens the fuse before wet cable damage and water effects',()=>{
 const f=fixture({rating:8});f.load.cable={enabled:true,hp:100};f.load.liquid=.5;f.site.liquids.released+=.5;at(f.site,8,10).stock.water-=.5;syncResources(f.s);refreshPower(f.s,f.site);const hp=f.load.cable.hp,ledger=structuredClone(f.site.liquids);tick(f);assert.equal(f.fuse.protection.blown,true);close(f.load.cable.hp,hp);assert.deepEqual(f.site.liquids,ledger);
});
test('upper fuse uses the actual riser and preserves the ground namesake',()=>{
 const f=base();install(f.s,'advanced',9,9);const ground=install(f.s,'fuseBox',10,9);f.site.levels.push({z:1,name:'Fuse test deck'});f.site.tiles.push(...f.site.tiles.map(t=>({x:t.x,y:t.y,z:1,terrain:'floor',building:null,hp:100,cable:null,drop:null,powered:false})));
 const upper=install(f.s,'fuseBox',10,9,1);install(f.s,'scrubber',11,8,1);install(f.s,'climate',11,9,1);
 const link={id:'utility-1',kind:'power',lower:{x:9,y:9,z:0},upper:{x:9,y:9,z:1},hp:100,enabled:true};f.site.utilityLinks.push(link);for(const p of [link.lower,link.upper]){const t=at(f.site,p.x,p.y,p.z);t.cable={hp:100,enabled:true};t.risers={power:link.id};}
 fuse(f,ground);fuse(f,upper);startRecording(f.s);tick(f);assert.equal(upper.protection.blown,true);assert.equal(ground.protection.blown,false);assert.equal(events(f.s).find(e=>e.id==='power.fuse.blown').entity,'tile:surface:10:9:1');
 const obs=observe(f.s);assert.equal(obs.entities['tile:surface:10:9:1'].derived.electrical.blown,true);
});
