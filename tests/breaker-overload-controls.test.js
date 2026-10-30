import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGame, at} from '../src/simulation.js';
import {BUILDINGS} from '../src/data.js';
import {initializeElectrical, refreshPower} from '../src/power.js';
import {BREAKER_MODES, BREAKER_RATINGS, BREAKER_OVERLOAD_TICKS, initializeBreakerTile, setBreaker, resetBreaker, tripBreaker, validateBreakers, breakerClosed} from '../src/breakers.js';
import {executeAction, controlBindings, actionCatalog, createAgentInterface} from '../src/controls.js';
import {startRecording, exportRecording, observe} from '../src/telemetry.js';
import {breakerDetails} from '../src/breaker-panels.js';

const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const records=s=>exportRecording(s).trim().split('\n').map(JSON.parse);
const settings=extra=>({site:'surface',x:10,y:9,enabled:false,direction:'ne',mode:'overload',...extra});
function fixture(){
 const s=createGame(74219),site=s.sites.surface,t=at(site,10,9);
 assert.equal(t.building,null);t.terrain='floor';t.building='breaker';t.hp=100;t.cable=null;
 initializeElectrical(t);refreshPower(s,site);return {s,site,t};
}
function configure(f,mode='overload',rating){assert.ok(setBreaker(f.s,'surface',10,9,false,'ne',mode,0,rating).ok);}
function measured(f,ticks=2){f.s.tick=5;Object.assign(f.t.protection.overload,{ticks,lastThroughput:11,lastTick:4});}
function upperDeck(site){
 const blank=structuredClone(site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.flora));
 site.levels.push({...site.levels[0],z:1});
 for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z:1,terrain:'floor',building:null,hp:100,cable:null,pipe:null,waterPipe:null,liquid:0,wetShort:false});
}

test('untouched breakers and legacy settings preserve the exact six-field protection state',()=>{
 const f=fixture(),initial=structuredClone(f.t.protection);
 assert.deepEqual(initial,{kind:'breaker',direction:'ne',enabled:false,mode:'manual',tripped:false,cause:null});
 initializeBreakerTile(f.t);assert.deepEqual(f.t.protection,initial);
 assert.ok(setBreaker(f.s,'surface',10,9,true,'ne','wet_fault').ok);
 assert.ok(setBreaker(f.s,'surface',10,9,false,'ne','wet_fault').ok);
 assert.ok(resetBreaker(f.s,'surface',10,9).ok);
 assert.equal(Object.hasOwn(f.t.protection,'overload'),false);
 const before=hash(f.s);validateBreakers(f.s);observe(f.s);assert.equal(hash(f.s),before);
});

test('player and agent share optional ratings, positional floor order and detached discovery',()=>{
 const f=fixture(),a=f.s,b=structuredClone(a),player=controlBindings(()=>a),agent=createAgentInterface(()=>b);
 startRecording(a);startRecording(b);
 assert.ok(player.setBreaker(a,'surface',10,9,false,'ne','overload',0,16).ok);
 assert.ok(agent.act('power.breaker',settings({rating:16})).ok);
 assert.equal(hash(a),hash(b));assert.equal(f.t.protection.overload.rating,16);
 assert.ok(player.setBreaker(a,'surface',10,9,true,'ne','overload').ok);
 assert.ok(agent.act('power.breaker',settings({enabled:true})).ok);assert.equal(hash(a),hash(b));
 const catalog=actionCatalog().find(x=>x.id==='power.breaker');
 assert.deepEqual(catalog.parameters.required,['site','x','y','enabled','direction','mode']);
 assert.deepEqual(catalog.parameters.properties.rating.enum,[4,8,16,32]);
 assert.deepEqual(catalog.parameters.properties.mode.enum,['manual','wet_fault','overload','wet_fault_and_overload']);
 const definitions=agent.definitions();assert.equal(definitions.breakerOverloadTicks,3);
 definitions.breakerModes.length=0;definitions.breakerRatings[0]=1;
 assert.deepEqual(agent.definitions().breakerModes,BREAKER_MODES);assert.deepEqual(agent.definitions().breakerRatings,BREAKER_RATINGS);
 assert.equal(records(a).filter(row=>row.kind==='event').length,2);
 assert.equal(records(b).filter(row=>row.kind==='event').length,2);
 const requestedA=records(a).filter(row=>row.kind==='action.requested'),requestedB=records(b).filter(row=>row.kind==='action.requested');
 assert.equal(requestedA.length,2);assert.equal(requestedB.length,2);
 assert.ok(requestedA.every(row=>row.action.source==='player'));assert.ok(requestedB.every(row=>row.action.source==='agent'));
});

test('ratings require the old contact open; opening clears delay while reconfiguration clears measurement',()=>{
 const f=fixture();configure(f);assert.equal(f.t.protection.overload.rating,8);
 assert.ok(setBreaker(f.s,'surface',10,9,true,'ne','overload').ok);measured(f);
 const before=hash(f.s);
 for(const [enabled,direction,mode,rating] of [[true,'ne','overload',16],[false,'ne','overload',16],[false,'n','overload',8],[false,'ne','manual',8]]){
  assert.equal(setBreaker(f.s,'surface',10,9,enabled,direction,mode,0,rating).ok,false);assert.equal(hash(f.s),before);
 }
 assert.ok(setBreaker(f.s,'surface',10,9,true,'ne','overload',0,8).ok);assert.equal(hash(f.s),before);
 assert.ok(setBreaker(f.s,'surface',10,9,false,'ne','overload').ok);
 assert.deepEqual(f.t.protection.overload,{rating:8,ticks:0,lastThroughput:11,lastTick:4});
 assert.ok(setBreaker(f.s,'surface',10,9,false,'ne','overload',0,16).ok);
 assert.deepEqual(f.t.protection.overload,{rating:16,ticks:0,lastThroughput:0,lastTick:null});
 measured(f);assert.ok(setBreaker(f.s,'surface',10,9,false,'ne','manual').ok);
 assert.deepEqual(f.t.protection.overload,{rating:16,ticks:0,lastThroughput:0,lastTick:null});
 assert.ok(setBreaker(f.s,'surface',10,9,false,'ne','overload').ok);assert.equal(f.t.protection.overload.rating,16);
 const legacy=fixture();assert.ok(setBreaker(legacy.s,'surface',10,9,true,'ne','manual').ok);
 assert.equal(setBreaker(legacy.s,'surface',10,9,false,'ne','manual',0,8).ok,false);
 assert.ok(setBreaker(legacy.s,'surface',10,9,false,'ne','manual').ok);
 assert.ok(setBreaker(legacy.s,'surface',10,9,false,'ne','manual',0,32).ok);assert.equal(legacy.t.protection.overload.rating,32);
});

test('invalid rating controls reject atomically through direct, player and agent paths',()=>{
 const f=fixture(),player=controlBindings(()=>f.s),agent=createAgentInterface(()=>f.s);startRecording(f.s);const before=hash(f.s);
 for(const rating of [0,6,8.5,'8',null,Infinity,NaN]){
  assert.equal(setBreaker(f.s,'surface',10,9,false,'ne','overload',0,rating).ok,false);
  assert.equal(player.setBreaker(f.s,'surface',10,9,false,'ne','overload',0,rating).ok,false);
  assert.equal(agent.act('power.breaker',settings({rating})).ok,false);assert.equal(hash(f.s),before);
 }
 assert.equal(executeAction(f.s,'power.breaker',settings({overload:{rating:8}})).ok,false);
 assert.equal(records(f.s).some(row=>row.kind==='event'),false);assert.equal(hash(f.s),before);
});

test('overload validation is strict and pure while later-in-tick damage may retain committed counters',()=>{
 const f=fixture();configure(f);measured(f);f.t.protection.enabled=true;f.t.hp=0;
 const before=hash(f.s);assert.doesNotThrow(()=>validateBreakers(f.s));assert.equal(hash(f.s),before);
 const valid=structuredClone(f.t.protection);
 const invalid=[p=>delete p.overload,p=>p.extra=true,p=>p.overload.extra=true,p=>p.overload.rating=6,p=>p.overload.ticks=-1,p=>p.overload.ticks=BREAKER_OVERLOAD_TICKS,p=>p.overload.ticks=1.5,p=>p.overload.lastThroughput=-1,p=>p.overload.lastThroughput=Infinity,p=>p.overload.lastTick=6,p=>p.overload.lastTick=-1,p=>p.overload.lastTick=.5,p=>p.overload.lastTick=null,p=>p.mode='manual',p=>{p.tripped=true;p.cause='overload';},p=>p.cause='overload'];
 for(const mutate of invalid){f.t.protection=structuredClone(valid);mutate(f.t.protection);const malformed=hash(f.s);assert.throws(()=>validateBreakers(f.s),/Invalid breaker/);assert.equal(hash(f.s),malformed);}
 f.t.protection={...valid,mode:'manual',tripped:true,cause:'overload',overload:{rating:8,ticks:0,lastThroughput:11,lastTick:4}};assert.doesNotThrow(()=>validateBreakers(f.s));
 delete f.t.protection.overload;assert.throws(()=>validateBreakers(f.s),/Invalid breaker overload/);
});

test('overload and combined trips preserve requested enable and record attempted flow with detached metadata',()=>{
 for(const mode of ['overload','wet_fault_and_overload']){
  const f=fixture();configure(f,mode,16);assert.ok(setBreaker(f.s,'surface',10,9,true,'ne',mode).ok);measured(f);f.t.hp=50;startRecording(f.s);
  assert.equal(tripBreaker(f.s,f.site,f.t,[],{cause:'overload',attemptedThroughput:8,effectiveRating:8}),false);
  assert.equal(tripBreaker(f.s,f.site,f.t,[],{cause:'overload',attemptedThroughput:11,effectiveRating:8}),true);
  assert.equal(breakerClosed(f.t),false);assert.equal(f.t.protection.enabled,true);assert.equal(f.t.protection.cause,'overload');assert.equal(f.t.protection.overload.ticks,0);
  const trip=records(f.s).find(row=>row.event?.id==='power.breaker.tripped').event;
  assert.equal(trip.attemptedThroughput,11);assert.equal(trip.effectiveRating,8);assert.deepEqual(trip.faultEntities,[]);
  assert.equal(trip.previous.overload.ticks,2);assert.equal(trip.next.overload.ticks,0);
  assert.equal(trip.previous.tripped,false);assert.equal(trip.next.tripped,true);
  assert.equal(tripBreaker(f.s,f.site,f.t,[],{cause:'overload',attemptedThroughput:11,effectiveRating:8}),false);
  assert.ok(resetBreaker(f.s,'surface',10,9).ok);assert.equal(f.t.protection.enabled,false);assert.equal(f.t.protection.tripped,false);
  assert.deepEqual(f.t.protection.overload,{rating:16,ticks:0,lastThroughput:11,lastTick:4});
  f.t.protection.overload.ticks=1;assert.equal(trip.next.overload.ticks,0);assert.equal(trip.previous.overload.ticks,2);
 }
 const f=fixture();configure(f,'wet_fault_and_overload');setBreaker(f.s,'surface',10,9,true,'ne','wet_fault_and_overload');measured(f);
 assert.equal(tripBreaker(f.s,f.site,f.t,['tile:surface:11:8']),true);assert.equal(f.t.protection.cause,'wet_fault');assert.equal(f.t.protection.overload.ticks,0);
});

test('upper-floor breaker configuration and construction validation use the actual job floor',()=>{
 const f=fixture();upperDeck(f.site);
 f.s.jobs.push({kind:'build',building:'breaker',site:'surface',x:10,y:9,z:1,work:BUILDINGS.breaker.work,cost:{...BUILDINGS.breaker.cost}});
 assert.doesNotThrow(()=>validateBreakers(f.s));f.s.jobs=[];
 const upper=at(f.site,10,9,1);upper.building='breaker';initializeElectrical(upper);
 assert.ok(executeAction(f.s,'power.breaker',settings({z:1,rating:32})).ok);
 assert.equal(upper.protection.overload.rating,32);assert.equal(f.t.protection.overload,undefined);
 assert.ok(controlBindings(()=>f.s).setBreaker(f.s,'surface',10,9,true,'ne','overload',1,32).ok);assert.equal(upper.protection.enabled,true);assert.equal(f.t.protection.enabled,false);
 upper.hp=50;f.s.jobs.push({kind:'repair',building:null,site:'surface',x:10,y:9,z:1,work:5,cost:{alloy:1}});
 assert.doesNotThrow(()=>validateBreakers(f.s));f.s.jobs[0].cost.alloy=2;assert.throws(()=>validateBreakers(f.s),/Invalid breaker work order/);
});

test('breaker flow and rating controls remain in collapsed details and rendering never advances the delay',()=>{
 const f=fixture();let html=breakerDetails(f.s,f.site,f.t);
 assert.equal((html.match(/data-breaker-mode=/g)||[]).length,4);assert.equal(html.includes('data-breaker-rating='),false);
 configure(f);measured(f);const before=hash(f.s);html=breakerDetails(f.s,f.site,f.t);assert.equal(hash(f.s),before);
 const details=html.slice(html.indexOf('<details data-breaker-diagnostics'));
 assert.ok(details.startsWith('<details data-breaker-diagnostics>'));
 for(const attribute of ['data-breaker-planned-flow','data-breaker-delivered-flow','data-breaker-effective-rating','data-breaker-overload-ticks','data-breaker-rating'])assert.ok(details.includes(attribute),attribute);
 assert.equal((details.match(/data-breaker-rating=/g)||[]).length,4);
 assert.ok(details.includes('11.00 kW · tick 4'));assert.ok(details.includes('2 / 3'));
 assert.ok(setBreaker(f.s,'surface',10,9,true,'ne','overload').ok);html=breakerDetails(f.s,f.site,f.t);
 const ratings=[...html.matchAll(/<button data-action="breaker-rating"[^>]*>/g)].map(x=>x[0]);assert.ok(ratings.every(x=>x.includes('disabled')));
 assert.equal(f.t.protection.overload.ticks,2);
 const stacked=fixture();upperDeck(stacked.site);const upper=at(stacked.site,10,9,1),bank=at(stacked.site,11,8,1);
 upper.building='breaker';bank.building='battery';initializeElectrical(upper);initializeElectrical(bank);bank.charge=10;
 assert.ok(breakerDetails(stacked.s,stacked.site,upper).includes(`${BUILDINGS.battery.name} 11/8/1 · 10.0 kJ`));
});
