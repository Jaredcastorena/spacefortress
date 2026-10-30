import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGame, at} from '../src/simulation.js';
import {initializeElectrical, refreshPower, fuseConditions} from '../src/power.js';
import {initializeFuseTile, setFuse, blowFuse, validateFuses, FUSE_DIRECTIONS, FUSE_RATINGS} from '../src/fuses.js';
import {protectionClosed, FUSE_BUILD_COST, FUSE_BUILD_WORK} from '../src/power-protection.js';
import {initializeBreakerTile, validateBreakers} from '../src/breakers.js';
import {executeAction, controlBindings, actionCatalog, createAgentInterface} from '../src/controls.js';
import {startRecording, exportRecording} from '../src/telemetry.js';
import {fuseDetails, restoreFuseFocus} from '../src/fuse-panels.js';

const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const records=s=>exportRecording(s).trim().split('\n').map(JSON.parse);
const settings=extra=>({site:'surface',x:10,y:9,enabled:false,direction:'ne',rating:8,...extra});
function fixture(){
 const s=createGame(74219),site=s.sites.surface,t=at(site,10,9);
 assert.equal(t.building,null);t.terrain='floor';t.building='fuseBox';t.hp=100;t.cable=null;
 initializeElectrical(t);refreshPower(s,site);return {s,site,t};
}
function upperDeck(site){
 const blank=structuredClone(site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&!t.waterPipe&&!t.flora));
 site.levels.push({...site.levels[0],z:1});
 for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({...structuredClone(blank),x,y,z:1,terrain:'floor',building:null,hp:100,cable:null,pipe:null,waterPipe:null,liquid:0,wetShort:false});
}
function measured(f){f.s.tick=5;Object.assign(f.t.protection,{lastThroughput:7,lastTick:4});}

test('fuse initialization starts open, is idempotent and coexists with untouched breaker validation',()=>{
 const f=fixture(),initial={kind:'fuse',direction:'ne',enabled:false,blown:false,rating:8,lastThroughput:0,lastTick:null};
 assert.deepEqual(f.t.protection,initial);assert.equal(protectionClosed(f.t),false);
 initializeFuseTile(f.t);assert.deepEqual(f.t.protection,initial);
 const breaker=at(f.site,11,9);breaker.building='breaker';breaker.hp=100;breaker.cable=null;initializeBreakerTile(breaker);
 const before=hash(f.s);validateFuses(f.s);validateBreakers(f.s);assert.equal(hash(f.s),before);
 assert.deepEqual(breaker.protection,{kind:'breaker',direction:'ne',enabled:false,mode:'manual',tripped:false,cause:null});
});

test('player and agent fuse actions share strict ratings, positional floors and detached discovery',()=>{
 const f=fixture(),a=f.s,b=structuredClone(a),player=controlBindings(()=>a),agent=createAgentInterface(()=>b);
 startRecording(a);startRecording(b);
 assert.ok(player.setFuse(a,'surface',10,9,false,'ne',0,16).ok);assert.ok(agent.act('power.fuse',settings({rating:16})).ok);assert.equal(hash(a),hash(b));
 assert.ok(player.setFuse(a,'surface',10,9,true,'ne',0,16).ok);assert.ok(agent.act('power.fuse',settings({enabled:true,rating:16})).ok);assert.equal(hash(a),hash(b));
 const catalog=actionCatalog().find(x=>x.id==='power.fuse');
 assert.deepEqual(catalog.parameters.required,['site','x','y','enabled','direction','rating']);assert.deepEqual(catalog.parameters.properties.rating.enum,[4,8,16,32]);
 assert.ok(actionCatalog().find(x=>x.id==='job.order').parameters.properties.kind.enum.includes('replaceFuse'));
 const definitions=agent.definitions();definitions.fuseDirections.ne=false;definitions.fuseRatings[0]=1;definitions.fuseReplacement.cost.alloy=99;
 assert.deepEqual(agent.definitions().fuseDirections,FUSE_DIRECTIONS);assert.deepEqual(agent.definitions().fuseRatings,FUSE_RATINGS);assert.deepEqual(agent.definitions().fuseReplacement,{cost:{alloy:1},work:3});
 for(const [s,source] of [[a,'player'],[b,'agent']]){const rows=records(s);assert.equal(rows.filter(row=>row.event?.id==='power.fuse.changed').length,2);assert.ok(rows.filter(row=>row.kind==='action.requested').every(row=>row.action.source===source));}
});

test('invalid settings and unchanged settings are atomic and do not emit configuration events',()=>{
 const f=fixture();startRecording(f.s);const before=hash(f.s);
 for(const [enabled,direction,z,rating] of [[1,'ne',0,8],[true,'east',0,8],[true,'__proto__',0,8],[false,'ne',1,8],[false,'ne',0,6],[false,'ne',0,'8'],[false,'ne',0,NaN],[false,'ne',0,Infinity]]){
  assert.equal(setFuse(f.s,'surface',10,9,enabled,direction,z,rating).ok,false);assert.equal(hash(f.s),before);
 }
 assert.equal(setFuse(f.s,'missing',10,9,false,'ne').ok,false);
 for(const args of [settings({rating:undefined}),settings({rating:6}),settings({rating:'8'}),settings({reset:true}),settings({z:1})]){assert.equal(executeAction(f.s,'power.fuse',args).ok,false);assert.equal(hash(f.s),before);}
 assert.ok(setFuse(f.s,'surface',10,9,false,'ne').ok);assert.equal(hash(f.s),before);assert.equal(records(f.s).some(row=>row.kind==='event'),false);
});

test('old contact must be open before reconfiguration; damaged or blown cartridges cannot close',()=>{
 const f=fixture();assert.ok(setFuse(f.s,'surface',10,9,true,'ne').ok);measured(f);const closed=hash(f.s);
 for(const [enabled,direction,rating] of [[true,'n',8],[false,'n',8],[false,'ne',16]]){assert.equal(setFuse(f.s,'surface',10,9,enabled,direction,0,rating).ok,false);assert.equal(hash(f.s),closed);}
 assert.ok(setFuse(f.s,'surface',10,9,true,'ne').ok);assert.equal(hash(f.s),closed);
 assert.ok(setFuse(f.s,'surface',10,9,false,'ne').ok);assert.equal(f.t.protection.lastThroughput,7);
 assert.ok(setFuse(f.s,'surface',10,9,false,'n',0,16).ok);assert.equal(f.t.protection.lastThroughput,0);assert.equal(f.t.protection.lastTick,null);
 f.t.hp=0;const damaged=hash(f.s);assert.equal(setFuse(f.s,'surface',10,9,true,'n',0,16).ok,false);assert.equal(hash(f.s),damaged);
 f.t.hp=100;f.t.protection.blown=true;const blown=hash(f.s);assert.equal(setFuse(f.s,'surface',10,9,true,'n',0,16).ok,false);assert.equal(hash(f.s),blown);
 assert.ok(setFuse(f.s,'surface',10,9,false,'sw',0,32).ok);assert.equal(f.t.protection.blown,true);
});

test('blowing is immediate and records detached attempted flow while preserving requested enabled state',()=>{
 const f=fixture();assert.ok(setFuse(f.s,'surface',10,9,true,'ne').ok);measured(f);f.t.hp=50;startRecording(f.s);
 const before=hash(f.s);
 for(const details of [undefined,{}, {attemptedThroughput:4,effectiveRating:4},{attemptedThroughput:7,effectiveRating:-1},{attemptedThroughput:Infinity,effectiveRating:4}]){assert.equal(blowFuse(f.s,f.site,f.t,details),false);assert.equal(hash(f.s),before);}
 assert.equal(blowFuse(f.s,f.site,f.t,{attemptedThroughput:7,effectiveRating:4}),true);assert.equal(protectionClosed(f.t),false);assert.equal(f.t.protection.enabled,true);assert.equal(f.t.protection.blown,true);
 assert.equal(blowFuse(f.s,f.site,f.t,{attemptedThroughput:7,effectiveRating:4}),false);
 const event=records(f.s).find(row=>row.event?.id==='power.fuse.blown').event;
 assert.equal(event.entity,'tile:surface:10:9');assert.equal(event.cause,'overload');assert.equal(event.attemptedThroughput,7);assert.equal(event.effectiveRating,4);assert.equal(event.previous.blown,false);assert.equal(event.next.blown,true);
 assert.ok(setFuse(f.s,'surface',10,9,false,'ne').ok);f.t.protection.lastThroughput=0;assert.equal(event.next.enabled,true);assert.equal(event.next.lastThroughput,7);assert.equal(f.t.protection.blown,true);
});

test('fuse state validation is strict and pure while retaining legitimate later damage and fire',()=>{
 const f=fixture();measured(f);f.t.protection.enabled=true;f.t.protection.blown=true;f.t.hp=0;f.t.fire={};
 const before=hash(f.s);assert.doesNotThrow(()=>validateFuses(f.s));assert.equal(hash(f.s),before);
 const valid=structuredClone(f.t.protection);
 const invalid=[p=>delete p.rating,p=>p.extra=true,p=>p.kind='breaker',p=>p.direction='east',p=>p.enabled=1,p=>p.blown=1,p=>p.rating=6,p=>p.lastThroughput=-1,p=>p.lastThroughput=Infinity,p=>p.lastTick=null,p=>p.lastTick=6,p=>p.lastTick=-1,p=>p.lastTick=.5,p=>p.lastTick='4'];
 for(const mutate of invalid){f.t.protection=structuredClone(valid);mutate(f.t.protection);const malformed=hash(f.s);assert.throws(()=>validateFuses(f.s),/Invalid fuse/);assert.equal(hash(f.s),malformed);}
 f.t.protection=valid;const original=structuredClone(f.t);
 for(const mutate of [t=>t.cable={enabled:true,hp:100},t=>t.terrain='rock',t=>t.hp=101,t=>t.hp=-1,t=>t.hp=NaN,t=>t.powerPriority=1,t=>t.machine={},t=>t.charge=0,t=>t.maintenance={}]){
  mutate(f.t);assert.throws(()=>validateFuses(f.s),/fuse|Fuse/);for(const k of Object.keys(f.t))delete f.t[k];Object.assign(f.t,structuredClone(original));
 }
 f.t.building=null;assert.throws(()=>validateFuses(f.s),/missing fuse/);
});

test('fuse construction state and controls use actual declared floors with exact paid work',()=>{
 const f=fixture();upperDeck(f.site);
 const job={kind:'build',building:'fuseBox',site:'surface',x:10,y:9,z:1,work:FUSE_BUILD_WORK,cost:{...FUSE_BUILD_COST}};f.s.jobs.push(job);
 assert.doesNotThrow(()=>validateFuses(f.s));
 for(const change of [{work:5},{cost:{alloy:1,components:1}},{cost:{alloy:2,components:1,water:0}},{z:0},{z:2}]){Object.assign(job,change);assert.throws(()=>validateFuses(f.s),/Invalid fuse construction/);Object.assign(job,{work:FUSE_BUILD_WORK,cost:{...FUSE_BUILD_COST},z:1});}
 f.s.jobs=[];const upper=at(f.site,10,9,1);upper.building='fuseBox';initializeElectrical(upper);
 startRecording(f.s);assert.ok(executeAction(f.s,'power.fuse',settings({z:1,rating:32})).ok);assert.ok(controlBindings(()=>f.s).setFuse(f.s,'surface',10,9,true,'ne',1,32).ok);
 assert.equal(upper.protection.enabled,true);assert.equal(upper.protection.rating,32);assert.equal(f.t.protection.enabled,false);assert.equal(f.t.protection.rating,8);
 const events=records(f.s).filter(row=>row.event?.id==='power.fuse.changed');assert.equal(events.length,2);assert.ok(events.every(row=>row.event.entity==='tile:surface:10:9:1'));assert.doesNotThrow(()=>validateFuses(f.s));
});

test('fuse inspector keeps configuration collapsed and previews never mutate fuse state',()=>{
 const f=fixture();measured(f);f.t.hp=50;const before=hash(f.s);const html=fuseDetails(f.s,f.site,f.t);fuseConditions(f.s,f.site,f.t);assert.equal(hash(f.s),before);
 const details=html.slice(html.indexOf('<details data-fuse-diagnostics'));
 assert.ok(details.startsWith('<details data-fuse-diagnostics>'));assert.equal((details.match(/data-fuse-rating=/g)||[]).length,4);assert.equal((details.match(/data-action="fuse-direction"/g)||[]).length,6);
 for(const attribute of ['data-fuse-planned-flow','data-fuse-delivered-flow','data-fuse-effective-rating','data-fuse-sources','data-fuse-faults'])assert.ok(details.includes(attribute),attribute);
 assert.ok(html.includes('7.00 kW · tick 4'));assert.ok(html.includes('4.00 kW · 8 kW at full condition'));assert.equal(html.includes('data-kind="replaceFuse"'),false);
 assert.ok(setFuse(f.s,'surface',10,9,true,'ne').ok);const closed=fuseDetails(f.s,f.site,f.t);assert.ok([...closed.matchAll(/<button data-action="fuse-(?:rating|direction)"[^>]*>/g)].every(match=>match[0].includes('disabled')));
});

test('replacement inspector requires an open safe box, tracks only the actual floor and restores focus',()=>{
 const f=fixture();f.t.protection.blown=true;f.t.protection.enabled=true;
 const replace=()=>fuseDetails(f.s,f.site,f.t).match(/<button data-action="order"[^>]*>/)[0];
 assert.ok(replace().includes('disabled'));f.t.protection.enabled=false;assert.equal(replace().includes('disabled'),false);
 f.t.hp=0;assert.ok(replace().includes('disabled'));f.t.hp=100;f.t.fire={};assert.ok(replace().includes('disabled'));f.t.fire=null;
 f.s.jobs.push({site:'surface',x:10,y:9,z:1,kind:'replaceFuse'});assert.equal(replace().includes('disabled'),false);f.s.jobs[0].z=0;assert.ok(replace().includes('disabled'));
 assert.ok(fuseDetails(f.s,f.site,f.t).includes('Replacement ordered'));
 const focused=[],controls=[{dataset:{fuseFocus:'replace'},disabled:true,focus:()=>focused.push('replace')},{dataset:{fuseFocus:'summary'},focus:options=>focused.push(options.preventScroll?'summary':'scroll')}];
 restoreFuseFocus({querySelectorAll:()=>controls},'replace');assert.deepEqual(focused,['summary']);controls[0].disabled=false;restoreFuseFocus({querySelectorAll:()=>controls},'replace');assert.deepEqual(focused,['summary','replace']);
});
