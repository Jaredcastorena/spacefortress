#!/usr/bin/env node
import { groundAirlockConfig, groundAirlockCells } from '../src/airlock-locations.js';
// Offline, paid construction example. A completed assembly is not commissioned
// and does not establish safe air, a successful passage, or sustained habitation.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createGame, serialize } from '../src/simulation.js';
import { executeAction } from '../src/controls.js';
import { BUILDINGS, RECIPES } from '../src/data.js';
import { neighbors, tileAt } from '../src/geometry.js';
import { crewPathTo, passable } from '../src/navigation.js';
import { constructionSupplyLocations } from '../src/construction.js';
import { availableInventory } from '../src/inventory-reservations.js';
import { airlockLayout, airlockRoomReading } from '../src/airlock-access.js';
import { roomAt } from '../src/atmosphere.js';
import { isDay } from '../src/power.js';
import { startRecording, stopRecording, exportRecording, recordingStatus } from '../src/telemetry.js';

export const LIMITS = Object.freeze({ ticks: 500, attempts: 580, commands: 80 });
const part = (building, x, y, after = null) => Object.freeze({ building, x, y, after });
export const PLACEMENTS = Object.freeze([
  part('fabricator',12,10),
  ...[[10,13],[11,13],[10,15],[10,16]].map(([x,y])=>part('floor',x,y)),
  ...[[9,11],[11,11],[9,13],[10,14],[12,13],[11,14],[13,13],[12,15]].map(([x,y])=>part('wall',x,y)),
  part('door',12,14), part('airlockController',10,10),
  part('cable',10,11), part('cable',10,12),
  part('gasExtractor',10,13,'floor'), part('gasVent',11,13,'floor'),
  part('gasPump',10,15,'floor'), part('gasReservoir',10,16,'floor'),
  part('gasPipe',10,14,'wall'),
]);
const MINES = [[4,10],[4,11],[3,12],[17,7]];
const CONFIG = { chamber:[10,13], inner:[10,12], outer:[12,14], extractor:[10,13], pump:[10,15], reservoir:[10,16], vent:[11,13] };
const key = p => `${p.building}:${p.x},${p.y}`;
const quantity = (inventory, resource) => inventory?.[resource] || 0;
const sum = (items, resource) => items.reduce((n,item)=>n+quantity(item,resource),0);
const near = (a,b) => Math.abs(a-b)<1e-7;
class Stop extends Error { constructor(code,message) { super(message); this.code=code; } }

// Count located material once. Reservations own material; promises do not add it.
export function materialTotals(state) {
  const inventories = state.sites.surface.tiles.flatMap(t=>[t.stock,t.drop,t.imports,t.machine?.input,t.machine?.output,t.machine?.batch]);
  inventories.push(...state.crew.filter(c=>c.site==='surface').map(c=>c.carry));
  for(const j of state.jobs.filter(j=>j.site==='surface')) inventories.push(j.materials,...j.sources.map(source=>source.items));
  return Object.fromEntries(['alloy','ore','components','air'].map(resource=>[resource,sum(inventories,resource)]));
}

function installed(site,p) {
  const t=tileAt(site,p.x,p.y);
  return p.building==='floor'?t.terrain==='floor'&&t.hp===100:p.building==='gasPipe'?t.pipe?.hp===100:p.building==='cable'?t.cable?.hp===100:t.building===p.building&&t.hp===100;
}

// This is the source's prospective topology check on a detached controller
// description. It binds no equipment, changes no door, and starts no cycle.
export function prospectiveLayout(state) {
  const site=state.sites.surface, controller=tileAt(site,10,10), room=roomAt(site,...CONFIG.chamber);
  if(!room) return {ok:false,reason:'layout_changed'};
  return airlockLayout(site,{...controller,airlock:{config:groundAirlockConfig(CONFIG),chamberCells:groundAirlockCells(room).sort()}},false);
}

function sourcePrices() {
  const total=PLACEMENTS.reduce((n,p)=>({alloy:n.alloy+(BUILDINGS[p.building]?.cost.alloy||0),components:n.components+(BUILDINGS[p.building]?.cost.components||0),work:n.work+(BUILDINGS[p.building]?.work||0)}),{alloy:0,components:0,work:0});
  const r=RECIPES.refinery,f=RECIPES.fabricator;
  if(total.alloy!==58||total.components!==7||total.work!==119||r.input.ore!==1||r.output.alloy!==2||r.duration!==20||f.input.alloy!==3||f.output.components!==1||f.duration!==45) throw new Stop('source_mismatch','Construction prices or manufacturing recipes changed; review this example.');
  return total;
}

function canOrder(state,p,kind='build') {
  const site=state.sites.surface,t=tileAt(site,p.x,p.y),goals=neighbors(p.x,p.y);
  if(t.fire||state.jobs.some(j=>j.site===site.id&&j.x===p.x&&j.y===p.y)) return false;
  if(!state.crew.some(c=>c.site===site.id&&c.health>0&&crewPathTo(state,site,c,goals)!==null)) return false;
  if(kind==='mine') return t.terrain==='ore'&&!t.building;
  if(p.after==='floor'&&t.terrain!=='floor'||p.after==='wall'&&t.building!=='wall') return false;
  if(p.building==='gasPipe'?t.pipe||['void','rock'].includes(t.terrain):p.building==='cable'?t.cable||['void','rock'].includes(t.terrain):!passable(site,p.x,p.y)||t.building||t.drop) return false;
  const sources=constructionSupplyLocations(state).filter(({t:source})=>crewPathTo(state,site,source,[[source.x,source.y]])!==null&&crewPathTo(state,site,source,goals)!==null);
  return Object.entries(BUILDINGS[p.building].cost).every(([resource,amount])=>sources.reduce((n,{t:source,kind:slot})=>n+availableInventory(state,site.id,[source.x,source.y],slot,resource),0)>=amount);
}

/** Run once from the untouched seed. Only executeAction changes the colony.
 * Returns {summary,state,recording?}; the CLI prints only summary. Recording is
 * optional, local, bounded, and excluded from the canonical game save.
 */
export function runPaidAirlockExample(options={}) {
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='record')||options.record!==undefined&&typeof options.record!=='boolean') throw new TypeError('Expected an optional boolean record field.');
  const state=createGame(74219),site=state.sites.surface;
  const ordered=new Map(),done=new Set(),configured=new Set();
  let attempts=0,commands=0,stage='manufacturing',failure=null,prices=null;
  const observations={airWarningTicks:0,nightBrownoutTicks:0,minSuitOxygen:100,minPackagedAir:160,minBankEnergy:100};
  if(options.record) startRecording(state,{maxRecords:12000,maxBytes:128_000_000});
  function act(id,args) {
    if(attempts>=LIMITS.attempts||id!=='simulation.step'&&commands>=LIMITS.commands) throw new Stop('attempt_limit','Shared command budget reached.');
    attempts++; if(id!=='simulation.step') commands++;
    const result=executeAction(state,id,args,'agent');
    if(!result.ok) throw new Stop('action_rejected',`${id}: ${result.message||result.code}`);
    return result;
  }
  function order(p,kind='build') {
    if(!canOrder(state,p,kind)) return false;
    const result=act('job.order',{site:'surface',x:p.x,y:p.y,kind,...(kind==='build'?{building:p.building}:{})});
    ordered.set(key(p),result.job); return true;
  }
  function inspect() {
    if(state.crew.length!==7||state.crew.some(c=>c.health!==100||(c.medical?.injury||0)!==0)) throw new Stop('crew_harmed','A crew member lost health or gained an injury.');
    for(const p of PLACEMENTS) if(ordered.has(key(p))&&installed(site,p)&&!state.jobs.some(j=>j.id===ordered.get(key(p)))) {
      done.add(key(p));
      if(configured.has(key(p))) continue;
      if(p.building==='fabricator') act('production.order',{site:'surface',x:p.x,y:p.y,mode:'batches',limit:4});
      if(p.building==='gasExtractor') act('gas.extractor',{site:'surface',x:p.x,y:p.y,enabled:false,mode:'filter',target:100});
      if(['gasPump','gasVent'].includes(p.building)) act('gas.device',{site:'surface',x:p.x,y:p.y,enabled:false,direction:'s',target:100});
      configured.add(key(p));
    }
    const refinery=tileAt(site,13,10).machine,fabricator=tileAt(site,12,10).machine;
    const refined=refinery.completed,fabricated=fabricator?.completed||0;
    const spent=PLACEMENTS.filter(p=>done.has(key(p))).reduce((n,p)=>({alloy:n.alloy+(BUILDINGS[p.building].cost.alloy||0),components:n.components+(BUILDINGS[p.building].cost.components||0)}),{alloy:0,components:0});
    const actual=materialTotals(state),expected={alloy:36+2*refined-3*fabricated-spent.alloy,components:3+fabricated-spent.components,ore:5*state.stats.mined-refined};
    if(refined>18||fabricated>4||state.stats.mined>4||Object.entries(expected).some(([r,n])=>!near(actual[r],n))) throw new Stop('conservation_mismatch','Located material no longer matches paid construction and completed recipes.');
    observations.minSuitOxygen=Math.min(observations.minSuitOxygen,...state.crew.map(c=>c.oxygen));
    observations.minPackagedAir=Math.min(observations.minPackagedAir,actual.air);
    observations.minBankEnergy=Math.min(observations.minBankEnergy,...site.tiles.filter(t=>t.building==='battery').map(t=>t.charge));
    if(state.tick&&state.flags.airWarning) observations.airWarningTicks++;
    if(state.tick&&!isDay(state)&&site.tiles.some(t=>BUILDINGS[t.building]?.demand&&['Insufficient circuit supply','No source on this circuit'].includes(t.powerStatus))) observations.nightBrownoutTicks++;
    if(options.record&&!recordingStatus(state).active) throw new Stop('recording_limit','The complete recording budget was exhausted.');
    return refined===18&&fabricated===4&&!Object.values(refinery.batch).some(n=>typeof n==='number'&&n>0)&&!Object.values(fabricator.batch).some(n=>typeof n==='number'&&n>0);
  }
  try {
    prices=sourcePrices();
    act('production.enable',{site:'surface',x:7,y:9,enabled:false});
    act('production.order',{site:'surface',x:13,y:10,mode:'batches',limit:18});
    if(!order(PLACEMENTS[0])) throw new Stop('starting_access','The fabricator lacks reachable paid materials.');
    for(const [x,y] of MINES) if(!order({x,y,building:'ore'},'mine')) throw new Stop('starting_access','A selected ore deposit is unavailable.');
    while(true) {
      const manufactured=inspect();
      if(manufactured) stage='assembly';
      if(stage==='assembly') for(const p of PLACEMENTS.slice(1)) if(!ordered.has(key(p))) order(p);
      if(done.size===PLACEMENTS.length) {
        const layout=prospectiveLayout(state);
        if(!layout.ok) throw new Stop('layout_mismatch',`Prospective topology: ${layout.reason}.`);
        if([[7,14],[8,14],[9,14]].some(([x,y])=>tileAt(site,x,y).building!=='solar')) throw new Stop('source_mismatch','An original solar array is missing.');
        break;
      }
      if(state.tick>=LIMITS.ticks) throw new Stop('tick_limit','Construction did not complete within the physical tick budget.');
      act('simulation.step',{ticks:1});
    }
  } catch(error) { failure={code:error.code||'example_error',message:String(error.message).slice(0,240)}; }
  if(options.record) stopRecording(state);
  const finalRoom=airlockRoomReading(roomAt(site,10,10));
  const summary={ok:failure===null,goal:'paid construction only',commissioned:false,safeHabitationEstablished:false,seed:74219,tick:state.tick,attempts,commands,limits:LIMITS,stage,placements:{completed:done.size,required:PLACEMENTS.length},manufacturing:{mines:state.stats.mined,refineryBatches:tileAt(site,13,10).machine.completed,fabricatorBatches:tileAt(site,12,10).machine?.completed||0},construction:prices,materials:materialTotals(state),crew:state.crew.map(c=>({id:c.id,health:c.health,injury:c.medical?.injury||0,suitOxygen:c.oxygen})),habitat:finalRoom?{pressure:finalRoom.pressure,breathable:finalRoom.breathable,thermalSafe:finalRoom.thermalSafe}:null,observations,...(failure?{failure}:{})};
  return {summary,state,...(options.record?{recording:exportRecording(state)}:{})};
}

export function parseArguments(args) {
  if(args.length===0) return {};
  if(args.length===2&&args[0]==='--save'&&args[1].trim()&&!args[1].startsWith('--')) return {save:args[1]};
  throw new TypeError('Usage: node tools/paid-airlock-example.mjs [--save PATH]');
}

export async function main(args=process.argv.slice(2)) {
  try {
    const {save}=parseArguments(args),{summary,state}=runPaidAirlockExample();
    if(save) await writeFile(save,serialize(state),'utf8');
    console.log(JSON.stringify({...summary,...(save?{saved:true}:{})}));
    return summary.ok?0:1;
  } catch(error) { console.log(JSON.stringify({ok:false,commissioned:false,failure:{code:'cli_error',message:String(error.message).slice(0,240)}})); return 2; }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) process.exitCode=await main();
