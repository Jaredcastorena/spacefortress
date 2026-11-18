import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { serialize, deserialize } from '../src/simulation.js';
import { BUILDINGS, RECIPES } from '../src/data.js';
import { tileAt } from '../src/geometry.js';
import { observe, startRecording, stopRecording, exportRecording } from '../src/telemetry.js';
import { LIMITS, PLACEMENTS, runPaidAirlockExample, prospectiveLayout, materialTotals, parseArguments } from '../tools/paid-airlock-example.mjs';

const amount=(inventory,resource)=>inventory?.[resource]||0;
const total=(inventories,resource)=>inventories.reduce((n,i)=>n+amount(i,resource),0);

// Full JSONL windows are retained on disk, including a failed window. The
// in-memory rows retain every sequence and the deltas used by the assertions.
function paidRecordingWindows() {
  const directory=mkdtempSync(join(tmpdir(),'spacefortress-paid-assembly-'));
  const windows=[],records=[],failures=[],limits={maxRecords:12000,maxBytes:128_000_000};
  const hash=text=>createHash('sha256').update(text).digest('hex');
  let current=null,firstHeader=null,reconstructed=null;
  function open(state) {
    const initialState=hash(serialize(state)),initialObservation=hash(JSON.stringify(observe(state)));
    current={fromTick:state.tick,initialState,initialObservation};
    startRecording(state,limits);
  }
  function close(state) {
    if(!current)return;
    stopRecording(state);
    const text=exportRecording(state),parsed=text.trim().split('\n').map(JSON.parse);
    const header=parsed[0],footer=parsed.at(-1),local=parsed.slice(1,-1);
    const window={...current,index:windows.length,throughTick:state.tick,finalState:hash(serialize(state)),
      finalObservation:hash(JSON.stringify(observe(state))),sha256:hash(text),bytes:Buffer.byteLength(text),footer,complete:false};
    window.path=join(directory,`${window.index}.ndjson`);
    writeFileSync(window.path,text); windows.push(window); current=null;
    try {
    if(window.index) {
      assert.equal(window.initialState,windows[window.index-1].finalState,'continuous physical state at recording seam');
      assert.equal(window.initialObservation,windows[window.index-1].finalObservation,'continuous observation at recording seam');
    }
    assert.equal(header.kind,'header'); assert.equal(header.initialState.tick,window.fromTick);
    assert.equal(header.observation.tick,window.fromTick);
    assert.equal(hash(JSON.stringify(header.initialState)),window.initialState);
    assert.equal(hash(JSON.stringify(header.observation)),window.initialObservation);
    assert.equal(footer.kind,'footer'); assert.equal(footer.reason,'stopped'); assert.equal(footer.active,false);
    assert.equal(footer.throughTick,state.tick); assert.equal(footer.records,local.length); assert.equal(footer.lastSequence,local.length);
    assert.equal(footer.maxRecords,limits.maxRecords); assert.equal(footer.maxBytes,limits.maxBytes);
    assert.ok(footer.records<=footer.maxRecords&&footer.bytes<footer.maxBytes);
    assert.ok(state.tick-window.fromTick<=10,'at most ten physical ticks per original-budget window');
    assert.equal(local.filter(r=>r.kind==='simulation.tick').length,state.tick-window.fromTick);
    firstHeader ||= header;
    if(reconstructed) assert.ok(isDeepStrictEqual(reconstructed,header.observation),'previous reconstruction continues into next header');
    else reconstructed=structuredClone(header.observation);
    const offset=records.length;
    for(const [index,row] of local.entries()) {
      assert.equal(row.sequence,index+1,'complete local sequence');
      for(const change of row.changes||[]) {
        if(!change.path.length) {
          if(change.op==='remove')delete reconstructed.entities[change.entity];
          else reconstructed.entities[change.entity]=structuredClone(change.value);
          continue;
        }
        let target=reconstructed.entities[change.entity];
        for(const key of change.path.slice(0,-1))target=target[key];
        const key=change.path.at(-1);
        if(change.op==='remove')delete target[key];else target[key]=structuredClone(change.value);
      }
      if(row.fromTick!==undefined)reconstructed.tick=row.tick;
      // Every original assertion below inspects events/actions, job ownership
      // and effort, or crew health/injury. Full deltas stay in the saved window.
      const changes=(row.changes||[]).filter(c=>c.system==='jobs'||c.entity.startsWith('crew-')&&['health','medical'].includes(c.path[0]));
      records.push({...row,sequence:offset+row.sequence,...(typeof row.command==='number'?{command:offset+row.command}:{}),changes});
    }
    assert.ok(isDeepStrictEqual(reconstructed,observe(state)),'all deltas continuously reconstruct the window endpoint');
    window.complete=true;
    } catch(error) { window.failure=String(error.message); failures.push(error); }
  }
  return {
    windows,records,failures,
    beforeAction(state) {
      if(!current)open(state);
      else {
        if(state.tick-current.fromTick>=10) { close(state); open(state); }
      }
    },
    finish:close,
    header:()=>firstHeader,
    manifest:()=>({kind:'paid-assembly-recording-windows',limits,maximumWindowTicks:10,
      maximumWindows:Math.ceil(LIMITS.ticks/10)+1,totalBytes:windows.reduce((n,w)=>n+w.bytes,0),windows}),
  };
}

// One physical integration run. Optional caller-selected output preserves its
// complete recording and save before assertions, including a failed endpoint.
test('ordinary shared commands pay for the complete uncommissioned assembly',async()=>{
  const recorder=paidRecordingWindows();
  const output=runPaidAirlockExample({beforeAction:recorder.beforeAction});
  const {summary,state}=output,save=serialize(state);
  let recordingFailure=null;
  try { recorder.finish(state); } catch(error) { recordingFailure=error; }
  const outputDirectory=process.env.PAID_AIRLOCK_OUTPUT_DIR;
  if(outputDirectory) {
    await mkdir(outputDirectory,{recursive:true});
    await writeFile(join(outputDirectory,'summary.json'),JSON.stringify(summary,null,2)+'\n');
    await writeFile(join(outputDirectory,'final-save.json'),save);
    for(const window of recorder.windows) await copyFile(window.path,join(outputDirectory,`recording-${window.index}.ndjson`));
    await writeFile(join(outputDirectory,'recording-windows.json'),JSON.stringify({...recorder.manifest(),windows:recorder.windows.map(window=>({...window,path:join(outputDirectory,`recording-${window.index}.ndjson`)}))},null,2)+'\n');
  }
  assert.equal(summary.ok,true,JSON.stringify(summary.failure||{}));
  if(recordingFailure)throw recordingFailure;
  if(recorder.failures.length)throw recorder.failures[0];
  assert.equal(summary.commissioned,false);
  assert.equal(summary.safeHabitationEstablished,false);
  assert.ok(Buffer.byteLength(JSON.stringify(summary))<8000,'bounded default result');
  assert.equal(summary.placements.completed,22);
  assert.ok(state.tick>0&&state.tick<=LIMITS.ticks);
  assert.ok(summary.attempts<=LIMITS.attempts&&summary.commands<=LIMITS.commands);
  assert.equal(state.crew.length,7);
  for(const c of state.crew) { assert.equal(c.health,100,c.id); assert.equal(c.medical.injury,0,c.id); }
  assert.deepEqual(summary.manufacturing,{mines:4,refineryBatches:18,fabricatorBatches:4});
  assert.deepEqual(summary.construction,{alloy:58,components:7,work:119});
  const materials=materialTotals(state);
  assert.equal(materials.alloy,2); assert.equal(materials.ore,2); assert.equal(materials.components,0);
  assert.ok(serialize(deserialize(save))===save,'canonical save imports without changing its bytes');
  const site=state.sites.surface;
  for(const p of PLACEMENTS) {
    const tile=tileAt(site,p.x,p.y);
    if(p.building==='floor') assert.equal(tile.terrain,'floor');
    else if(p.building==='gasPipe') assert.equal(tile.pipe.hp,100);
    else if(p.building==='cable') assert.equal(tile.cable.hp,100);
    else { assert.equal(tile.building,p.building); assert.equal(tile.hp,100); }
    assert.ok(!state.jobs.some(j=>j.kind==='build'&&j.x===p.x&&j.y===p.y),'no unfinished construction');
  }
  for(const [x,y] of [[7,14],[8,14],[9,14]]) assert.equal(tileAt(site,x,y).building,'solar');
  for(const [x,y] of [[10,13],[11,13],[10,15]]) assert.equal(tileAt(site,x,y).gasDevice.enabled,false);
  assert.equal(tileAt(site,10,10).airlock,null,'controller remains unbound');
  assert.equal(prospectiveLayout(state).ok,true);
  for(const [x,y,batches] of [[13,10,18],[12,10,4]]) {
    const machine=tileAt(site,x,y).machine;
    assert.equal(machine.completed,batches); assert.equal(machine.order.remaining,0);
    assert.ok(!state.jobs.some(j=>j.kind==='operate'&&j.x===x&&j.y===y));
    assert.equal(Object.values(machine.batch).reduce((n,v)=>n+(typeof v==='number'?v:0),0),0);
  }

  const {records,windows}=recorder,header=recorder.header(),footer=windows.at(-1).footer;
  assert.ok(windows.length>0&&windows.every(w=>w.complete));
  assert.ok(windows.length<=Math.ceil(LIMITS.ticks/10)+1,'window count bounded by unchanged physical tick cap');
  assert.equal(windows[0].fromTick,0); assert.equal(windows.at(-1).throughTick,state.tick);
  assert.equal(header.kind,'header'); assert.equal(header.seed,74219); assert.equal(header.initialState.tick,0);
  assert.equal(header.initialState.stats.built,0); assert.equal(header.initialState.stats.mined,0);
  assert.equal(header.initialState.resources.alloy,36); assert.equal(header.initialState.resources.ore,0); assert.equal(header.initialState.resources.components,3);
  assert.equal(footer.kind,'footer'); assert.equal(footer.reason,'stopped'); assert.equal(footer.throughTick,state.tick);
  assert.equal(windows.reduce((n,w)=>n+w.footer.records,0),records.length); assert.ok(footer.bytes<footer.maxBytes);
  assert.equal(records.filter(r=>r.kind==='external').length,0,'all mutations have shared command/tick ownership');
  const requested=records.filter(r=>r.kind==='action.requested');
  assert.equal(requested.length,summary.attempts);
  assert.equal(requested.filter(r=>r.action.id!=='simulation.step').length,summary.commands);
  assert.equal(requested.filter(r=>r.action.id==='simulation.step').reduce((n,r)=>n+r.action.args.ticks,0),state.tick);
  assert.ok(requested.every(r=>r.action.source==='agent'));
  assert.ok(records.filter(r=>r.kind==='action.result').every(r=>r.result.ok));
  assert.equal(records.filter(r=>r.kind==='simulation.tick').length,state.tick);
  records.forEach((r,i)=>assert.equal(r.sequence,i+1,'complete sequence'));
  const events=records.filter(r=>r.kind==='event').map(r=>r.event);
  const builds=events.filter(e=>e.id==='job.completed'&&e.kind==='build');
  const mines=events.filter(e=>e.id==='resource.extracted');
  const started=events.filter(e=>e.id==='production.batch.started');
  const completed=events.filter(e=>e.id==='production.batch.completed');
  assert.equal(builds.length,22); assert.equal(mines.length,4);
  assert.equal(total(mines.map(e=>e.output),'ore'),20);
  for(const [recipe,count] of [['refinery',18],['fabricator',4]]) {
    const starts=started.filter(e=>e.recipe===recipe),ends=completed.filter(e=>e.recipe===recipe);
    assert.equal(starts.length,count); assert.equal(ends.length,count);
    assert.ok(starts.every(e=>e.actor&&e.job)); assert.ok(ends.every(e=>e.actor&&e.job));
    for(const [resource,n] of Object.entries(RECIPES[recipe].input)) assert.equal(total(starts.map(e=>e.input),resource),n*count);
    for(const [resource,n] of Object.entries(RECIPES[recipe].output)) assert.equal(total(ends.map(e=>e.output),resource),n*count);
  }
  const paidJobs=new Map(),deliveredJobs=new Set(); let typedEffort=false;
  for(const r of records) for(const c of r.changes||[]) {
    if(c.system==='jobs'&&c.path.length===0&&c.op==='add'&&c.value.kind==='build') {
      const j=c.value; paidJobs.set(c.entity,j);
      assert.deepEqual(j.cost,BUILDINGS[j.building].cost);
      for(const [resource,n] of Object.entries(j.cost)) assert.equal(total(j.sources.map(source=>source.items),resource),n,'located reservations pay the order');
      assert.equal(total([j.materials],'alloy'),0,'reserved ingredients still need physical delivery');
    }
    if(c.system==='jobs'&&c.path.length===0&&c.op==='remove'&&c.previous.kind==='build') {
      const j=c.previous;
      for(const [resource,n] of Object.entries(j.cost)) assert.equal(amount(j.materials,resource),n,'work consumed physically delivered materials');
      deliveredJobs.add(c.entity);
    }
    if(c.system==='jobs'&&c.path[0]==='remaining'&&typeof c.previous==='number'&&c.value<c.previous) typedEffort=true;
    if(c.entity.startsWith('crew-')&&c.path[0]==='health'&&typeof c.value==='number') assert.equal(c.value,100,'health stayed intact throughout');
    if(c.entity.startsWith('crew-')&&c.path[0]==='medical'&&c.path[1]==='injury'&&typeof c.value==='number') assert.equal(c.value,0,'no intermediate injury');
  }
  assert.equal(paidJobs.size,22); assert.equal(deliveredJobs.size,22); assert.equal(typedEffort,true);
  assert.equal([...paidJobs.values()].reduce((n,j)=>n+j.work,0)+4*7+18*RECIPES.refinery.duration+4*RECIPES.fabricator.duration,687);
  assert.equal([...paidJobs.values()].reduce((n,j)=>n+amount(j.cost,'alloy'),0)+4*RECIPES.fabricator.input.alloy,70);
  for(const completion of records.filter(r=>r.kind==='event'&&r.event.id==='job.completed'&&['fabricator','gasExtractor','gasPump','gasVent'].includes(r.event.building))) {
    const target=completion.event.target;
    const nextStep=requested.find(r=>r.sequence>completion.sequence&&r.action.id==='simulation.step');
    const configuration=requested.find(r=>r.sequence>completion.sequence&&['production.order','gas.device','gas.extractor'].includes(r.action.id)&&`tile:${r.action.args.site}:${r.action.args.x}:${r.action.args.y}`===target);
    assert.ok(configuration&&(!nextStep||configuration.sequence<nextStep.sequence),'configure completed equipment before another tick');
    assert.equal(configuration.tick,completion.tick);
  }
});

test('CLI arguments cannot silently select an unintended save target',()=>{
  assert.deepEqual(parseArguments([]),{});
  assert.deepEqual(parseArguments(['--save','colony.json']),{save:'colony.json'});
  for(const args of [['--save'],['--save',''],['--save','--trace'],['--unknown'],['--save','one','two']]) assert.throws(()=>parseArguments(args),/Usage:/);
  assert.throws(()=>runPaidAirlockExample({record:'yes'}),/boolean record/);
  assert.throws(()=>runPaidAirlockExample({beforeAction:true}),/beforeAction function/);
});
