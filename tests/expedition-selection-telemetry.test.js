import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { actionCatalog, executeAction, controlBindings, createAgentInterface } from '../src/controls.js';
import { observe, startRecording, exportRecording, recordingStatus } from '../src/telemetry.js';

const rows = s => exportRecording(s).trim().split('\n').map(JSON.parse);
function reconstruct(recording) {
  const observation = structuredClone(recording[0].observation);
  for (const row of recording.slice(1, -1)) {
    for (const change of row.changes || []) {
      if (!change.path.length) {
        if (change.op === 'remove') delete observation.entities[change.entity];
        else observation.entities[change.entity] = structuredClone(change.value);
        continue;
      }
      let target = observation.entities[change.entity];
      for (const key of change.path.slice(0, -1)) target = target[key];
      if (change.op === 'remove') delete target[change.path.at(-1)];
      else target[change.path.at(-1)] = structuredClone(change.value);
    }
    if (row.fromTick !== undefined) observation.tick = row.tick;
  }
  return observation;
}

test('launch catalog exposes an optional bounded unique array of known crew IDs with copied schemas', () => {
  const launch = actionCatalog().find(action => action.id === 'expedition.launch');
  assert.deepEqual(launch.parameters.required, ['site']);
  assert.equal(launch.parameters.additionalProperties, false);
  const schema = launch.parameters.properties.crewIds;
  assert.equal(schema.type, 'array');
  assert.equal(schema.minItems, 1); assert.equal(schema.maxItems, 2);
  assert.equal(schema.uniqueItems, true);
  assert.deepEqual(schema.items, {type:'string', entityType:'crew'});
  schema.items.entityType = 'invented'; schema.maxItems = 99;
  assert.equal(actionCatalog().find(action => action.id === 'expedition.launch').parameters.properties.crewIds.items.entityType, 'crew');
  assert.equal(actionCatalog().find(action => action.id === 'expedition.launch').parameters.properties.crewIds.maxItems, 2);
});

test('player and agent explicit launch preserve manifest order and detached request data with source labels', () => {
  const a = createGame(), b = deserialize(serialize(a)), chosen = ['crew-6','crew-2'];
  startRecording(a); startRecording(b);
  assert.ok(controlBindings(() => a).launch(a, 'wreck', chosen).ok);
  assert.ok(createAgentInterface(() => b).act('expedition.launch', {site:'wreck', crewIds:chosen}).ok);
  assert.deepEqual(a,b);
  assert.deepEqual(a.departure.crew, ['crew-6','crew-2']);
  chosen[0] = 'crew-0';
  assert.deepEqual(a.departure.crew, ['crew-6','crew-2']);
  for (const [s,source] of [[a,'player'],[b,'agent']]) {
    const recording = rows(s), request = recording.find(row => row.action?.id === 'expedition.launch');
    assert.equal(request.action.source,source);
    assert.deepEqual(request.action.args.crewIds,['crew-6','crew-2']);
    const planned = recording.find(row => row.event?.id === 'expedition.preparation.started');
    assert.ok(planned); assert.equal(planned.command,request.sequence);
    assert.deepEqual(planned.event.crewIds,['crew-6','crew-2']);
    assert.equal(planned.event.entity,'colony');
    assert.equal(planned.event.site,'site:wreck');
    assert.equal(recording.find(row => row.kind === 'action.result').result.code,'applied');
  }
});

test('malformed explicit manifests never pass as objects or substitute an automatic team', () => {
  const s = createGame(); startRecording(s); const before = serialize(s);
  const invalid = [null,'crew-0',{}, {0:'crew-0',1:'crew-1',length:2}, [], ['crew-0','crew-1','crew-2'], ['crew-0','crew-0'], ['crew-0','missing'], ['crew-0',1], ['crew-0',null], [['crew-0'],'crew-1'], [{id:'crew-0'},'crew-1'], Array(2)];
  for (const crewIds of invalid) {
    const result = executeAction(s,'expedition.launch',{site:'wreck',crewIds});
    assert.equal(result.ok,false);
    assert.equal(result.code,'invalid_arguments');
    assert.equal(serialize(s),before);
  }
  const singleton = executeAction(s,'expedition.launch',{site:'wreck',crewIds:['crew-0']});
  assert.equal(singleton.ok,false);
  assert.equal(singleton.code,'simulation_rejected');
  assert.equal(singleton.reason,'crew_count');
  assert.equal(serialize(s),before);
  const recording = rows(s), results = recording.filter(row => row.kind === 'action.result');
  assert.equal(results.length,invalid.length+1);
  assert.ok(results.every(row => row.changes.length === 0));
  assert.equal(recording.some(row => row.event?.id === 'expedition.preparation.started'),false);
});

test('known but ineligible explicit crew reject atomically while omitted manifests retain automatic selection', () => {
  const a = createGame(); a.crew[6].energy = 10;
  startRecording(a); const before = serialize(a);
  const rejected = executeAction(a,'expedition.launch',{site:'wreck',crewIds:['crew-6','crew-2']});
  assert.equal(rejected.ok,false); assert.equal(rejected.code,'simulation_rejected');
  assert.equal(serialize(a),before); assert.equal(a.departure,null);
  assert.ok(executeAction(a,'expedition.launch',{site:'wreck'}).ok);
  assert.deepEqual(a.departure.crew,['crew-0','crew-1']);
  const recording = rows(a), request = recording.filter(row => row.action?.id === 'expedition.launch').at(-1);
  assert.equal(Object.hasOwn(request.action.args,'crewIds'),false);
  assert.equal(recording.filter(row => row.event?.id === 'expedition.preparation.started').length,1);
});

test('detached readiness observations expose selected crew, destination gates and actual preparation delays', () => {
  const s = createGame(); s.crew[5].energy = 10;
  const idle = observe(s);
  assert.equal(idle.entities.colony.derived.expedition.phase,'idle');
  assert.equal(idle.entities['crew-5'].derived.expedition.eligible,false);
  assert.equal(typeof idle.entities['crew-5'].derived.expedition.blocked,'string');
  assert.ok(idle.entities['crew-0'].derived.currentComfort);
  assert.equal(idle.entities['site:wreck'].derived.expedition.launchBlocked,null);
  assert.ok(idle.entities['site:solar'].derived.expedition.launchBlocked.code);
  assert.ok(executeAction(s,'expedition.launch',{site:'wreck',crewIds:['crew-2','crew-6']}).ok);
  const before = serialize(s), observed = observe(s), readiness = observed.entities.colony.derived.expedition;
  assert.deepEqual(readiness.selectedCrewIds,['crew-2','crew-6']);
  assert.equal(readiness.destination,'site:wreck');
  assert.equal(readiness.phase,'loading');
  assert.equal(readiness.preparing,true);
  assert.equal(readiness.departure.ready,false);
  assert.ok(Object.keys(readiness.departure.missingSupplies).length > 0);
  assert.equal(readiness.departure.crew.length,2);
  assert.ok(readiness.departure.crew.every(member => member.id === 'crew-2' || member.id === 'crew-6'));
  assert.equal(observed.entities['crew-2'].derived.expedition.selected,true);
  assert.equal(observed.entities['crew-0'].derived.expedition.selected,false);
  assert.equal(observed.entities['site:wreck'].derived.expedition.selected,true);
  readiness.selectedCrewIds.length = 0; readiness.departure.missingSupplies.fuel = 999;
  observed.entities['crew-2'].derived.expedition.eligible = false;
  assert.equal(serialize(s),before);
  assert.deepEqual(observe(s).entities.colony.derived.expedition.selectedCrewIds,['crew-2','crew-6']);
});

test('preparation start and cancellation remain named transitions even when the same-tick plan ends absent', () => {
  const s = createGame(); startRecording(s);
  assert.ok(executeAction(s,'expedition.launch',{site:'wreck',crewIds:['crew-4','crew-2']},'player').ok);
  assert.ok(executeAction(s,'expedition.cancel_departure',{},'player').ok);
  assert.equal(s.departure,null);
  const recording = rows(s), started = recording.find(row => row.event?.id === 'expedition.preparation.started'), cancelled = recording.find(row => row.event?.id === 'expedition.preparation.cancelled');
  assert.ok(started&&cancelled);
  assert.equal(started.tick,cancelled.tick);
  assert.ok(started.sequence<cancelled.sequence);
  assert.deepEqual(cancelled.event.crewIds,['crew-4','crew-2']);
  assert.equal(cancelled.event.next,null);
  assert.ok(cancelled.event.reason);
  assert.equal(recording.find(row => row.sequence === cancelled.command).action.id,'expedition.cancel_departure');
  assert.deepEqual(reconstruct(recording),observe(s));
});

test('a real selected expedition records loading, salvage, return and refit with deterministic replay and unchanged RNG', () => {
  const a = createGame(), b = deserialize(serialize(a));
  startRecording(a,{maxRecords:30000,maxBytes:64000000});
  const run = (id,args={}) => {
    const first = executeAction(a,id,args), second = executeAction(b,id,args);
    assert.ok(first.ok,`${id}: ${first.message}`); assert.deepEqual(first,second); return first;
  };
  const until = (condition,limit=300) => { for(let i=0;i<limit&&!condition();i++)run('simulation.step',{ticks:1}); assert.ok(condition(),'Expedition condition did not complete'); };
  run('expedition.launch',{site:'wreck',crewIds:['crew-1','crew-0']});
  until(()=>a.mission?.phase==='working');
  run('job.order',{site:'wreck',x:5,y:6,kind:'mine'});
  until(()=>(a.mission?.cargo.components||0)>=3);
  run('expedition.recall');
  until(()=>!a.mission);
  until(()=>a.resources.components>=6);
  const refit = run('job.order',{site:'surface',x:16,y:11,kind:'refit',building:'cargo'});
  until(()=>!a.jobs.some(job=>job.id===refit.job));
  assert.equal(a.shuttle.fit,'cargo');
  assert.deepEqual(a,b); assert.equal(serialize(a),serialize(b));
  const recording = rows(a), expected = ['expedition.preparation.started','shuttle.supplies.loaded','expedition.preparation.stage_changed','expedition.departed','expedition.arrived','expedition.salvage.picked_up','expedition.salvage.delivered','expedition.recalled','expedition.return.departed','expedition.returned','shuttle.refit.completed'];
  let sequence=0;
  for(const id of expected){const event=recording.find(row=>row.event?.id===id&&row.sequence>sequence);assert.ok(event,id);sequence=event.sequence;}
  for(const id of ['expedition.departed','expedition.arrived','expedition.recalled','expedition.returned']) {
    const event=recording.find(row=>row.event?.id===id);
    assert.deepEqual(event.event.crewIds,['crew-1','crew-0']);
    assert.equal(event.event.site,'site:wreck');
    assert.ok(Object.hasOwn(event.event,'previous')&&Object.hasOwn(event.event,'next'));
    assert.ok(event.event.reason);
  }
  assert.ok(recording.some(row=>row.event?.id==='expedition.upgrade.unlocked'));
  assert.deepEqual(reconstruct(recording),observe(a));
  const replay=deserialize(JSON.stringify(recording[0].initialState));
  for(const row of recording)if(row.kind==='action.requested')assert.ok(executeAction(replay,row.action.id,row.action.args,'test').ok);
  assert.deepEqual(replay,a);
  assert.equal(recordingStatus(replay).reason,'not_started');
});

test('bounded expedition recording preserves an explicit prefix while the selected crew continue unchanged', () => {
  const a=createGame(),b=deserialize(serialize(a));startRecording(a,{maxRecords:3});
  for(const s of [a,b]) {
    assert.ok(executeAction(s,'expedition.launch',{site:'wreck',crewIds:['crew-3','crew-2']}).ok);
    assert.ok(executeAction(s,'simulation.step',{ticks:20}).ok);
  }
  assert.deepEqual(a,b);
  const recording=rows(a),footer=recording.at(-1);
  assert.equal(footer.active,false);assert.equal(footer.reason,'record_limit');assert.equal(footer.records,3);
  assert.ok(footer.throughTick<a.tick);
  assert.equal(reconstruct(recording).tick,footer.throughTick);
});
