import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, serialize, deserialize, at } from '../src/simulation.js';
import { observe, startRecording, stopRecording, recordingStatus, exportRecording, changesBetween, tileEntityId } from '../src/telemetry.js';
import { executeAction, actionCatalog, controlBindings, createAgentInterface } from '../src/controls.js';
const records=s=>exportRecording(s).trim().split('\n').map(line=>JSON.parse(line));
function apply(observation,record) {
  for(const change of record.changes||[]) {
    if(!change.path.length){if(change.op==='remove')delete observation.entities[change.entity];else observation.entities[change.entity]=structuredClone(change.value);continue;}
    let target=observation.entities[change.entity];for(const key of change.path.slice(0,-1))target=target[key];
    const key=change.path.at(-1);if(change.op==='remove')delete target[key];else target[key]=structuredClone(change.value);
  }
  if(record.fromTick!==undefined)observation.tick=record.tick;
}

test('observations give every entity a unique stable identity and detached state',()=>{
  const s=createGame(),o=observe(s);assert.equal(o.entities[tileEntityId('surface',12,7)].building,'bunk');
  assert.equal(o.entities['crew-0'].housing.preference,'art');assert.ok(o.entities['crew-0'].derived.currentComfort);
  assert.equal(Object.values(o.entities).filter(e=>e.type==='tile').length,Object.values(s.sites).reduce((n,site)=>n+site.tiles.length,0));
  o.entities['crew-0'].health=0;assert.equal(s.crew[0].health,100);step(s);assert.ok(observe(s).entities['crew-0']);
});

test('recording captures small needs, memories, room conditions and physical inventories',()=>{
  const s=createGame();s.crew[0].energy=10;s.crew[0].housing.bunk=[12,7];startRecording(s);step(s,12);
  const changes=records(s).flatMap(r=>r.changes||[]);for(const system of ['needs','memory','movement','atmosphere','temperature','production','inventory','intent'])assert.ok(changes.some(c=>c.system===system),system);
  assert.ok(changes.some(c=>c.path.includes('memories')&&c.entity==='crew-0'));
  assert.ok(records(s).some(r=>r.event?.id==='crew.memory.created'&&r.event.actor==='crew-0'));
});

test('player and agent housing actions use identical rules and label sources and outcomes',()=>{
  const a=createGame(),b=createGame();startRecording(a);startRecording(b);
  const result=controlBindings(()=>a).setBunkOwner(a,'surface',12,7,'crew-0');assert.equal(result.ok,true);
  assert.equal(executeAction(b,'housing.assign',{site:'surface',x:12,y:7,crew:'crew-0'}).ok,true);assert.deepEqual(a,b);
  const log=records(a);assert.equal(log[1].action.source,'player');assert.equal(log[1].action.id,'housing.assign');assert.equal(log[2].command,log[1].sequence);
  assert.ok(log[2].changes.some(c=>c.entity==='crew-0'&&c.system==='housing'));assert.equal(log[2].result.ok,true);
});

test('invalid actions are recorded as failures and leave simulation state unchanged',()=>{
  const s=createGame();startRecording(s);const before=serialize(s);
  for(const [id,args] of [['missing',{}],['job.order',{site:'surface',x:12,y:9,kind:'build',building:'__proto__'}],['housing.assign',{site:'surface',x:99,y:7,crew:'crew-0'}],['crew.labor',{crew:'missing',labor:'mining',enabled:true}],['simulation.step',{ticks:0}],['simulation.step',{ticks:1,extra:true}],['power.discharge_cell',{x:13}],['production.order',{site:'surface',x:7,y:9,mode:'stock',limit:1.5}]])assert.equal(executeAction(s,id,args).ok,false);
  assert.equal(serialize(s),before);const failed=records(s).filter(r=>r.kind==='action.result');assert.equal(failed.length,8);assert.ok(failed.every(r=>!r.result.ok&&!r.changes.length));
});

test('catalog covers the gameplay control families with structured argument schemas',()=>{
  const catalog=actionCatalog();assert.equal(new Set(catalog.map(a=>a.id)).size,catalog.length);
  for(const id of ['job.order','job.cancel','room.designate','housing.assign','crew.routine','crew.labor','production.order','climate.configure','depot.accept','expedition.launch','signal.resolve','door.mode','maintenance.auto','simulation.step'])assert.ok(catalog.some(a=>a.id===id));
  const action=catalog.find(a=>a.id==='housing.assign');assert.deepEqual(action.parameters.required,['site','x','y','crew']);assert.equal(action.parameters.additionalProperties,false);
  action.parameters.properties.site.enum.push('bad');assert.ok(!actionCatalog().find(a=>a.id==='housing.assign').parameters.properties.site.enum.includes('bad'));assert.equal(executeAction(createGame(),'housing.assign',{site:'bad',x:12,y:7,crew:null}).ok,false);
});

test('JSONL deltas reconstruct all observed state including created and removed jobs',()=>{
  const s=createGame();startRecording(s);executeAction(s,'job.order',{site:'surface',x:11,y:14,kind:'build',building:'solar'});executeAction(s,'simulation.step',{ticks:60});
  const rows=records(s),reconstructed=structuredClone(rows[0].observation);for(const row of rows.slice(1,-1))apply(reconstructed,row);
  assert.deepEqual(reconstructed,observe(s));assert.ok(rows.some(r=>r.changes?.some(c=>c.entity.startsWith('job-')&&!c.path.length&&c.op==='add')));assert.ok(rows.some(r=>r.changes?.some(c=>c.entity.startsWith('job-')&&!c.path.length&&c.op==='remove')));
});

test('command records plus initial save replay deterministically through ordinary controls',()=>{
  const s=createGame();startRecording(s);executeAction(s,'crew.labor',{crew:'crew-0',labor:'production',enabled:false});executeAction(s,'room.designate',{site:'surface',x:8,y:8,role:'quarters'});executeAction(s,'simulation.step',{ticks:8});
  const rows=records(s),copy=deserialize(JSON.stringify(rows[0].initialState));for(const r of rows)if(r.kind==='action.requested')executeAction(copy,r.action.id,r.action.args,'test');assert.deepEqual(copy,s);
});

test('recording does not change RNG, saves, or deterministic gameplay',()=>{
  const a=createGame(),b=deserialize(serialize(a));startRecording(a);step(a,30);step(b,30);assert.deepEqual(a,b);assert.equal(serialize(a),serialize(b));
  assert.equal(recordingStatus(deserialize(serialize(a))).reason,'not_started');assert.ok(recordingStatus(a).records>0);
});

test('bounded recording stops explicitly without evicting its initial state or earlier events',()=>{
  const s=createGame();startRecording(s,{maxRecords:2});step(s,4);const rows=records(s);
  assert.equal(recordingStatus(s).reason,'record_limit');assert.equal(recordingStatus(s).active,false);assert.ok(rows.at(-1).throughTick<=2);assert.equal(rows[0].initialState.tick,0);assert.equal(s.tick,4);
  const reconstructed=structuredClone(rows[0].observation);for(const row of rows.slice(1,-1))apply(reconstructed,row);assert.equal(reconstructed.tick,rows.at(-1).throughTick);
});

test('stopping retains export; a new recording starts from its current authoritative state',()=>{
  const s=createGame();assert.throws(()=>exportRecording(s));startRecording(s);step(s);stopRecording(s);step(s,3);assert.equal(records(s).at(-1).throughTick,1);
  startRecording(s);assert.equal(records(s)[0].initialState.tick,4);assert.equal(recordingStatus(s).records,0);assert.throws(()=>startRecording(s,{maxRecords:0}));
});

test('unwrapped local changes are distinguished from player decisions',()=>{
  const s=createGame();startRecording(s);at(s.sites.surface,12,7).hp=0;step(s);
  const row=records(s)[1];assert.equal(row.kind,'external');assert.equal(row.command,null);assert.ok(row.changes.some(c=>c.entity==='tile:surface:12:7'&&c.path[0]==='hp'));
});

test('browser interface follows state replacement, pauses via hook and returns copied definitions',()=>{
  let s=createGame(),paused=0,refreshed=0;const api=createAgentInterface(()=>s,()=>paused++,()=>refreshed++);
  assert.equal(api.act('simulation.step',{ticks:2}).ok,true);assert.equal(s.tick,2);assert.equal(paused,1);assert.equal(refreshed,1);
  const defs=api.definitions();defs.buildings.bunk.cost.alloy=0;assert.equal(api.definitions().buildings.bunk.cost.alloy,3);
  s=createGame(100);assert.equal(api.observe().entities.colony.seed,100);assert.equal(api.observe().tick,0);
});

test('patch paths are arrays and preserve arbitrary keys without interpreting them as pointers',()=>{
  const before={entities:{'crew-0':{type:'crew',relationships:{'crew/odd':{affinity:0}}}}},after=structuredClone(before);after.entities['crew-0'].relationships['crew/odd'].affinity=3;
  const changes=changesBetween(before,after);assert.deepEqual(changes[0].path,['relationships','crew/odd','affinity']);assert.equal(changes[0].previous,0);assert.equal(changes[0].value,3);
});

test('production completion has an explicit actor, recipe, output and workstation marker',()=>{
  const s=createGame();startRecording(s);step(s,100);
  const event=records(s).find(r=>r.event?.id==='production.batch.completed');assert.ok(event);
  assert.equal(event.event.recipe,'farm');assert.deepEqual(event.event.output,{food:2});assert.ok(event.event.actor.startsWith('crew-'));assert.equal(event.event.entity,'tile:surface:7:9');
});

test('byte limit preserves an exportable prefix and reports the last complete observation',()=>{
  const s=createGame();startRecording(s,{maxBytes:1_000_000});s.log.push({tick:0,type:'info',message:'x'.repeat(500_000)});
  const rows=records(s);assert.equal(rows.at(-1).reason,'byte_limit');assert.equal(rows.at(-1).throughTick,0);assert.equal(rows.length,2);assert.deepEqual(rows[0].observation.entities.colony.log,createGame().log);
});
