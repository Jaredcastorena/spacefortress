import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame, at, serialize } from '../../src/simulation.js';
import { initializeStorage, syncResources } from '../../src/inventory.js';
import { initializeElectrical, initializePower, updatePower, refreshPower } from '../../src/power.js';
import { newPipe, gasNode, updateGasNetworks } from '../../src/gas-networks.js';
import { initializeAirlocks } from '../../src/airlock-persistence.js';
import { updateRooms, refreshAtmosphere, refreshRoom, mix, roomAt, updateAtmosphere, breathe } from '../../src/atmosphere.js';
import { initializeThermal, updateThermal } from '../../src/thermal.js';
import { prepareAirlocks, gateAirlocks, reconcileAirlocks } from '../../src/airlocks.js';
import { continueCrewTraversal } from '../../src/crew-traversal.js';
import { airlockStatus, airlockOpen } from '../../src/airlock-access.js';
import { executeAction } from '../../src/controls.js';

export const CONFIG = { site:'surface',x:5,y:5,chamber:[7,7],inner:[6,7],outer:[9,7],extractor:[7,7],pump:[7,5],reservoir:[7,3],vent:[8,7] };
const finiteMix = amount => ({oxygen:amount*.21,inert:amount*.785,co2:amount*.005});
export const TARGET = {site:'surface',x:5,y:5};
export const digest = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const close = (actual, expected, label='quantity') => assert.ok(Math.abs(actual-expected)<1e-7,`${label}: ${actual} != ${expected}`);
export const snapshot = s => digest(serialize(s));
export const refs = s => {
 const site=s.sites.surface, tile=(x,y)=>at(site,x,y);
 return {s,site,tile,controller:tile(5,5),crew:s.crew[0],chamber:roomAt(site,7,7),habitat:roomAt(site,5,7),inner:tile(6,7),outer:tile(9,7),reservoir:tile(7,3),pump:tile(7,5),extractor:tile(7,7),vent:tile(8,7)};
};

// SYNTHETIC boundary fixture: directly installed parts, wiring, charge and gas.
// This does not establish paid construction, commissioning, or ordinary hauling.
// Core handoff geometry plus its reviewed independent vent feed at (8,6),
// embedded in a valid size26 save.
export function fixture({configure=true,chamberGas=20,reserveGas=35,smoke=.02}={}) {
 const s=createGame(74219), site=s.sites.surface;
 const stock=structuredClone(at(site,8,10).stock),shuttle=structuredClone(at(site,16,11));
 const blank=structuredClone(site.tiles.find(t=>!t.building&&!t.lichen&&!t.machine));
 site.tiles=site.tiles.map((_,i)=>({...structuredClone(blank),x:i%site.size,y:Math.floor(i/site.size),terrain:'ground',building:null,hp:100,drop:null,cable:null,powered:false}));
 const tile=(x,y)=>at(site,x,y);
 site.tiles[11*site.size+16]=shuttle;
 function install(building,x,y) {const t=tile(x,y);t.terrain='floor';t.building=building;initializeStorage(t);initializeElectrical(t);return t;}
 for(const [x,y] of [[4,7],[5,6],[5,8],[6,6],[6,8],[7,6],[7,8],[8,6],[8,8],[9,6],[9,8]])install('wall',x,y);
 for(const [x,y] of [[5,7],[7,7],[8,7]])tile(x,y).terrain='floor';
 for(const [x,y] of [CONFIG.inner,CONFIG.outer])Object.assign(install('door',x,y),{doorMode:'closed',doorUntil:0});
 for(const [name,building] of [['extractor','gasExtractor'],['pump','gasPump'],['reservoir','gasReservoir'],['vent','gasVent']])install(building,...CONFIG[name]);
 install('airlockController',5,5);tile(7,5).gasDevice.direction='north';
 for(const [x,y] of [[7,6],[8,6],[7,4]])tile(x,y).pipe=newPipe();
 install('stockpile',18,11).stock=stock;
 for(const [x,y] of [[3,3],[4,3]])install('solar',x,y);
 for(let x=3;x<=7;x++)install('battery',x,2);
 // Physical cables connect every load and the finite battery bank.
 for(let x=3;x<=8;x++)for(let y=2;y<=7;y++)tile(x,y).cable={enabled:true,hp:100};
 site.rooms=[];site.atmosphere={tick:0,vented:mix(0),injected:mix(0),breathed:0,refilled:0};
 updateRooms(site);initializeThermal(s);
 const r=roomAt(site,7,7),h=roomAt(site,5,7);r.gas=finiteMix(chamberGas);r.smoke=smoke;h.gas=finiteMix(10);
 site.fireSafety.smokeProduced=smoke;site.fireSafety.smokeCleared=0;site.fireSafety.smokeVented=0;
 tile(7,3).gasStore.gas=finiteMix(reserveGas);site.gasNetwork.loaded=finiteMix(reserveGas);
 refreshAtmosphere(site);initializeAirlocks(s);initializePower(s,site,600);
 for(let i=0;i<s.crew.length;i++){const c=s.crew[i];c.x=i?18:5;c.y=i?13+i:7;c.job=null;c.intent=null;for(const k of Object.keys(c.labors))c.labors[k]=false;}
 s.creatures=[];syncResources(s);
 if(configure)assert.equal(executeAction(s,'airlock.configure',CONFIG,'test').ok,true,'synthetic geometry must bind');
 refreshPower(s,site);
 return refs(s);
}
export function command(f,id,args={}) {return executeAction(f.s,`airlock.${id}`,{...TARGET,...args},'test');}
export function request(f,direction='outward',crew=f.crew) {const r=command(f,'request',{crew:crew.id,direction});assert.equal(r.ok,true,`request ${direction}: ${r.reason||r.message||''}`);return r;}
export function assertInterlock(f) {
 const a=airlockStatus(f.s,f.site,f.controller);
 assert.ok(!(a.permissions.inner&&a.permissions.outer),'simultaneous permits');
 assert.ok(!(airlockOpen(f.site,f.inner)&&airlockOpen(f.site,f.outer)),'simultaneous physical doors');
}
// Actual subsystem order, one finite allocation and one physical movement step.
// Other colony jobs are omitted deliberately; full simulation tests use step().
export function physicalTick(f,{move=true,breathing=false}={}) {
 f.s.tick++;prepareAirlocks(f.s);
 for(const site of Object.values(f.s.sites))updatePower(f.s,site);
 gateAirlocks(f.s);updateGasNetworks(f.s);updateAtmosphere(f.s);updateThermal(f.s);reconcileAirlocks(f.s);assertInterlock(f);
 if(move)for(const c of f.s.crew)if(c.airlockTraversal)continueCrewTraversal(f.s,c,f.s.sites[c.site]);
 if(breathing)breathe(f.site,f.crew);
 reconcileAirlocks(f.s);for(const site of Object.values(f.s.sites)){refreshAtmosphere(site);refreshPower(f.s,site);}assertInterlock(f);
}
export function until(f,predicate,{max=400,tick=physicalTick,label='condition',onTick}={}) {
 for(let i=0;i<max;i++){if(predicate())return i;tick(f);onTick?.(f);}
 assert.ok(predicate(),`${label} exceeded ${max} ticks: ${JSON.stringify({tick:f.s.tick,phase:f.controller.airlock?.phase,reason:f.controller.airlock?.reason,crew:[f.crew.x,f.crew.y],pressure:roomAt(f.site,7,7)?.pressure})}`);
 return max;
}
export function cycle(f,direction,options={}) {request(f,direction);return until(f,()=>!f.crew.airlockTraversal,{...options,label:`${direction} cycle`});}
export function ledger(f) {
 const gas={oxygen:0,inert:0,co2:0};let smoke=0;
 for(const r of f.site.rooms){for(const k of Object.keys(gas))gas[k]+=r.gas[k];smoke+=r.smoke||0;}
 for(const t of f.site.tiles){const n=gasNode(t);if(n){for(const k of Object.keys(gas))gas[k]+=n.gas[k];smoke+=n.smoke;}}
 for(const k of Object.keys(gas))gas[k]+=f.site.atmosphere.vented[k];
 gas.oxygen+=f.site.atmosphere.breathed+f.s.crew.filter(c=>c.site===f.site.id).reduce((n,c)=>n+c.oxygen*.1,0);gas.co2-=f.site.atmosphere.breathed;
 smoke+=f.site.fireSafety.smokeVented+f.site.fireSafety.smokeCleared;
 const e=f.site.energy,stored=f.site.tiles.reduce((n,t)=>n+(t.building==='battery'?t.charge:0),0);
 return {...gas,smoke,energy:e.initial+e.generated+e.injected-e.consumed-e.curtailed-e.discarded-stored};
}
export function assertLedger(f,before) {const after=ledger(f);for(const k of Object.keys(before))close(after[k],before[k],k);}
export function setRoomGas(room,gas,smoke=room.smoke) {room.gas={...gas};room.smoke=smoke;refreshRoom(room);}
