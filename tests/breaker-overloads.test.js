import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,at,step,serialize,deserialize} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {executeAction} from '../src/controls.js';
import {initializeStorage,totalResources,syncResources} from '../src/inventory.js';
import {initializeElectrical,refreshPower,updatePower,previewPower,breakerConditions,validatePower} from '../src/power.js';
import {setBreaker,resetBreaker,validateBreakers} from '../src/breakers.js';
import {startRecording,exportRecording,observe} from '../src/telemetry.js';
const raw=gunzipSync(readFileSync(new URL('./fixtures/overload-schema72.json.gz',import.meta.url))).toString();
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const act=(s,id,args={})=>{const r=executeAction(s,id,args);assert.equal(r.ok,true,`${id}: ${r.message}`);return r;};
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
function install(s,kind,x,y){const t=at(s.sites.surface,x,y);assert.equal(t.building,null);t.building=kind;t.hp=100;initializeStorage(t);initializeElectrical(t);return t;}
function base(){const s=createGame(74252),site=s.sites.surface;for(const t of site.tiles){t.cable=null;if(t.machine)t.machine.enabled=false;}return {s,site};}
// Synthetic isolated circuits keep finite energy ledgers and physical topology;
// the final paid-construction case below uses only normal player actions.
function fixture({source='advanced',load='scrubber',extra=true,rating=4,mode='overload'}={}){
 const f=base();f.source=install(f.s,source,9,9);f.breaker=install(f.s,'breaker',10,9);f.load=install(f.s,load,11,8);
 if(extra)f.extra=install(f.s,'climate',11,9);
 assert.equal(setBreaker(f.s,'surface',10,9,true,'ne',mode,0,rating).ok,true);refreshPower(f.s,f.site);return f;
}
function tick(f){f.s.tick++;updatePower(f.s,f.site);refreshPower(f.s,f.site,false);validatePower(f.s,f.site);validateBreakers(f.s);}
function exact(s){syncResources(s);const text=serialize(s);assert.ok(serialize(deserialize(text))===text,'exact whole-colony roundtrip');}

test('genuine schema72 retains paid breaker and pending recruitment without retrofitting ratings',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),'00b79fede06a5e4678f6a2bc6b58856845495b4a97bc9ffbfa89ca1e571aa928');
 const expected=JSON.parse(raw);expected.version=VERSION;const s=deserialize(raw);assert.equal(serialize(s),JSON.stringify(expected));exact(s);
 assert.equal(Object.hasOwn(at(s.sites.surface,12,10).protection,'overload'),false);
 for(const modify of [p=>p.mode='overload',p=>p.overload={rating:8,ticks:0,lastThroughput:0,lastTick:null},p=>{p.tripped=true;p.cause='overload';}]){
  const old=JSON.parse(raw);modify(at(old.sites.surface,12,10).protection);assert.throws(()=>deserialize(JSON.stringify(old)),/Legacy breaker overload/);
 }
});

test('overload trips after three supplied ticks and previews never advance the timer or spend energy',()=>{
 const f=fixture(),p=f.breaker.protection;startRecording(f.s);
 close(breakerConditions(f.s,f.site,f.breaker).plannedThroughput,5);
 const before=serialize(f.s);for(let n=0;n<4;n++){previewPower(f.s,f.site);observe(f.s);refreshPower(f.s,f.site);validatePower(f.s,f.site);}assert.equal(serialize(f.s),before);
 tick(f);assert.equal(p.overload.ticks,1);close(p.overload.lastThroughput,5);
 tick(f);assert.equal(p.overload.ticks,2);assert.equal(breakerConditions(f.s,f.site,f.breaker).wouldTrip,true);
 const consumed=f.site.energy.consumed;tick(f);assert.equal(f.breaker.protection.cause,'overload');assert.equal(f.breaker.protection.overload.ticks,0);close(f.breaker.protection.overload.lastThroughput,0);close(f.site.energy.consumed,consumed);
 assert.equal(f.load.powered,false);assert.equal(f.extra.powered,false);
 const trips=events(f.s).filter(e=>e.id==='power.breaker.tripped');assert.equal(trips.length,1);close(trips[0].attemptedThroughput,5);close(trips[0].effectiveRating,4);
 assert.deepEqual(events(f.s).filter(e=>e.id==='power.breaker.overload.changed').map(e=>e.ticks),[1,2]);
});

test('cool ticks reset consecutive overloads and damage reduces the actual rating',()=>{
 const f=fixture();tick(f);tick(f);f.extra.climate.enabled=false;refreshPower(f.s,f.site);tick(f);
 assert.equal(f.breaker.protection.overload.ticks,0);assert.equal(f.breaker.protection.tripped,false);
 f.breaker.hp=50;refreshPower(f.s,f.site);close(breakerConditions(f.s,f.site,f.breaker).effectiveRating,2);
 tick(f);assert.equal(f.breaker.protection.overload.ticks,1);tick(f);tick(f);assert.equal(f.breaker.protection.cause,'overload');
});

test('unserved requested demand and curtailed generation do not overload a contact',()=>{
 const f=fixture({source:'solar'});f.source.hp=50;refreshPower(f.s,f.site);
 assert.ok(f.site.power.demand>f.site.power.used);close(breakerConditions(f.s,f.site,f.breaker).plannedThroughput,2);
 for(let n=0;n<4;n++)tick(f);assert.equal(f.breaker.protection.overload.ticks,0);assert.equal(f.breaker.protection.tripped,false);
 const idle=fixture({extra:false});idle.load.machine.enabled=false;refreshPower(idle.s,idle.site);
 assert.ok(idle.site.power.curtailed>0);close(breakerConditions(idle.s,idle.site,idle.breaker).plannedThroughput,0);tick(idle);assert.equal(idle.breaker.protection.overload.ticks,0);
});

test('reverse battery charging and battery backfeed count finite net flow',()=>{
 const charge=fixture({load:'battery',extra:false,rating:8});
 assert.equal(setBreaker(charge.s,'surface',10,9,false,'ne','overload',0,8).ok,true);
 assert.equal(setBreaker(charge.s,'surface',10,9,true,'sw','overload',0,8).ok,true);
 close(breakerConditions(charge.s,charge.site,charge.breaker).signedThroughput,-12);
 tick(charge);tick(charge);close(charge.load.charge,24);tick(charge);close(charge.load.charge,24);assert.equal(charge.breaker.protection.cause,'overload');
 const back=fixture({source:'atmosphere',load:'battery',extra:false});back.load.charge=12;back.site.energy.injected+=12;back.breaker.hp=50;refreshPower(back.s,back.site);
 close(breakerConditions(back.s,back.site,back.breaker).signedThroughput,-4);
 tick(back);tick(back);close(back.load.charge,4);tick(back);close(back.load.charge,4);assert.equal(back.breaker.protection.cause,'overload');
});

test('combined wet protection trips immediately while overload-only commits fault work just twice',()=>{
 for(const mode of ['overload','wet_fault_and_overload']){
  const f=fixture({mode,rating:8});f.load.cable={enabled:true,hp:100};f.load.liquid=.5;f.site.liquids.released+=.5;at(f.site,8,10).stock.water-=.5;syncResources(f.s);refreshPower(f.s,f.site);
  if(mode==='overload'){tick(f);tick(f);assert.ok(f.load.cable.hp<100);}
  const hp=f.load.cable.hp,consumed=f.site.energy.consumed,ledger=structuredClone(f.site.liquids);tick(f);
  assert.equal(f.breaker.protection.cause,mode==='overload'?'overload':'wet_fault');close(f.load.cable.hp,hp);close(f.site.energy.consumed,consumed);assert.deepEqual(f.site.liquids,ledger);
 }
});

function parallel(){
 const f=base();f.source=install(f.s,'advanced',9,9);f.a=install(f.s,'breaker',10,9);f.b=install(f.s,'breaker',10,10);
 at(f.site,9,10).cable={hp:100,enabled:true};at(f.site,11,8).cable={hp:100,enabled:true};f.load=install(f.s,'scrubber',11,9);f.extra=install(f.s,'climate',12,9);
 for(const b of [f.a,f.b])assert.equal(setBreaker(f.s,'surface',b.x,b.y,true,'ne','overload',0,4).ok,true);
 return f;
}
test('parallel rerouting reuses one counter snapshot and settles cascaded trips before energy commit',()=>{
 for(const pending of [0,2]){
  const f=parallel();close(breakerConditions(f.s,f.site,f.a).plannedThroughput,5);close(breakerConditions(f.s,f.site,f.b).plannedThroughput,0);
  // Controlled pending histories isolate a replan; no ordinary colony claim.
  f.a.protection.overload.ticks=2;f.b.protection.overload.ticks=pending;refreshPower(f.s,f.site);const consumed=f.site.energy.consumed;tick(f);
  assert.equal(f.a.protection.tripped,true);
  if(pending===0){assert.equal(f.b.protection.tripped,false);assert.equal(f.b.protection.overload.ticks,1);close(f.site.energy.consumed-consumed,5);}
  else{assert.equal(f.b.protection.tripped,true);assert.equal(f.b.protection.overload.ticks,0);close(f.site.energy.consumed,consumed);}
 }
});

test('replanned overloads commit reactor fuel and generated energy once',()=>{
 const f=fixture({source:'reactor'});const stock=at(f.site,8,10).stock;stock.fuel-=1;f.source.machine.input.fuel=1;syncResources(f.s);refreshPower(f.s,f.site);
 f.breaker.protection.overload.ticks=2;const before=structuredClone(f.site.reactorLedger),fuel=f.source.machine.input.fuel;
 tick(f);assert.equal(f.breaker.protection.tripped,true);close(f.site.reactorLedger.generated-before.generated,40);close(f.site.reactorLedger.fuelUsed-before.fuelUsed,.02);close(fuel-f.source.machine.input.fuel,.02);
});

test('a paid branch survives reload, trips only its industry, and restarts after reducing load',()=>{
 let s=createGame(74252);const before=totalResources(s),original=s.sites.surface.tiles.find(t=>t.building==='scrubber');
 for(const site of Object.values(s.sites))for(const t of site.tiles)if(t.machine&&t.building!=='scrubber')act(s,'production.enable',{site:site.id,x:t.x,y:t.y,z:t.z,enabled:false});
 for(const [x,y,building] of [[12,10,'breaker'],[11,10,'scrubber'],[11,11,'galley']])act(s,'job.order',{site:'surface',x,y,z:0,kind:'build',building});
 for(let n=0;n<75&&s.jobs.some(j=>j.kind==='build');n++)step(s);
 assert.equal(s.jobs.some(j=>j.kind==='build'),false);assert.equal(totalResources(s).alloy,before.alloy-15);assert.equal(totalResources(s).components,before.components-3);
 startRecording(s);const args={site:'surface',x:12,y:10,z:0,enabled:true,direction:'sw',mode:'overload',rating:4};act(s,'power.breaker',args);
 close(breakerConditions(s,s.sites.surface,at(s.sites.surface,12,10)).plannedThroughput,5);step(s,2);
 assert.equal(at(s.sites.surface,12,10).protection.overload.ticks,2);exact(s);const continued=deserialize(serialize(s));step(s);step(continued);assert.equal(serialize(continued),serialize(s));
 s=continued;assert.equal(at(s.sites.surface,12,10).protection.cause,'overload');assert.equal(at(s.sites.surface,11,10).powered,false);assert.equal(at(s.sites.surface,original.x,original.y).powered,true);
 act(s,'power.breaker.reset',{site:'surface',x:12,y:10,z:0});act(s,'production.enable',{site:'surface',x:11,y:11,z:0,enabled:false});act(s,'power.breaker',args);step(s,3);
 assert.equal(at(s.sites.surface,12,10).protection.tripped,false);assert.equal(at(s.sites.surface,11,10).powered,true);assert.ok(s.crew.every(c=>c.health===100));exact(s);
});

test('simultaneous series trips leave a downstream battery as an independent finite source',()=>{
 const f=base();install(f.s,'advanced',9,9);const a=install(f.s,'breaker',10,9),b=install(f.s,'breaker',11,8),load=install(f.s,'scrubber',12,8);install(f.s,'climate',12,9);
 for(const t of [a,b])assert.equal(setBreaker(f.s,'surface',t.x,t.y,true,'ne','overload',0,4).ok,true);
 const bank=at(f.site,13,7);assert.equal(bank.building,'battery');startRecording(f.s);
 tick(f);tick(f);assert.equal(a.protection.overload.ticks,2);assert.equal(b.protection.overload.ticks,2);const charge=bank.charge,attempted=breakerConditions(f.s,f.site,a).plannedThroughput;tick(f);
 assert.equal(a.protection.cause,'overload');assert.equal(b.protection.cause,'overload');assert.equal(load.powered,true);close(bank.charge,charge-5);
 const trips=events(f.s).filter(e=>e.id==='power.breaker.tripped');assert.equal(trips.length,2);assert.ok(trips.every(e=>e.tick===f.s.tick&&e.attemptedThroughput===attempted));
});

test('an actual power riser routes flow to an upper breaker without using its ground namesake',()=>{
 const f=base();install(f.s,'advanced',9,9);const ground=install(f.s,'breaker',10,9);
 // Synthetic installed upper floor and riser isolate power; paid riser construction
 // and whole multi-floor persistence have their existing utility-risers gate.
 f.site.levels.push({z:1,name:'Overload test deck'});
 f.site.tiles.push(...f.site.tiles.map(t=>({x:t.x,y:t.y,z:1,terrain:'floor',building:null,hp:100,cable:null,drop:null,powered:false})));
 const upper=(x,y)=>at(f.site,x,y,1),b=upper(10,9);b.building='breaker';initializeElectrical(b);
 for(const [x,y,kind] of [[11,8,'scrubber'],[11,9,'climate']]){const t=upper(x,y);t.building=kind;initializeStorage(t);initializeElectrical(t);}
 const link={id:'utility-1',kind:'power',lower:{x:9,y:9,z:0},upper:{x:9,y:9,z:1},hp:100,enabled:true};f.site.utilityLinks.push(link);
 for(const p of [link.lower,link.upper]){const t=at(f.site,p.x,p.y,p.z);t.cable={hp:100,enabled:true};t.risers={power:link.id};}
 for(const [t,z] of [[ground,0],[b,1]])assert.equal(setBreaker(f.s,'surface',t.x,t.y,true,'ne','overload',z,4).ok,true);
 close(breakerConditions(f.s,f.site,ground).plannedThroughput,0);close(breakerConditions(f.s,f.site,b).plannedThroughput,5);
 tick(f);tick(f);tick(f);assert.equal(b.protection.cause,'overload');assert.equal(ground.protection.tripped,false);assert.equal(ground.protection.overload.ticks,0);
 assert.equal(upper(11,8).powered,false);
});
