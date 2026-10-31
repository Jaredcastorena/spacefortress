import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,step,serialize,deserialize} from '../src/simulation.js';
import {tileAt,positionOf} from '../src/spatial.js';
import {neighbors} from '../src/hex.js';
import {pathToPosition,pathTo,planCrewRoute} from '../src/navigation.js';
import {advanceCrewRoutePositions} from '../src/crew-traversal.js';
import {updateRooms,fillRoom,roomAt,updateAtmosphere,moveCrew,gasAmount} from '../src/atmosphere.js';
import {initializeThermal,updateThermal,HEAT_CAPACITY} from '../src/thermal.js';
import {initializeLiquids,flowLiquids} from '../src/liquids.js';
import {stairLinks,validateVerticalLinks,stairOpen} from '../src/vertical.js';
import {executeAction,controlBindings} from '../src/controls.js';
import {startRecording,exportRecording,recordingStatus} from '../src/telemetry.js';
const events=s=>exportRecording(s).trim().split('\n').map(JSON.parse).filter(r=>r.event).map(r=>r.event);
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
// Synthetic landings; paid construction and canonical saves are covered by stairs.test.js.
function connect(site,x=8,y=8,id='vertical-1',mode='auto'){
 const link={id,kind:'stairwell',lower:{x,y,z:0},upper:{x,y,z:1},hp:100,mode,openUntil:0};
 site.verticalLinks.push(link);for(const p of [link.lower,link.upper])Object.assign(tileAt(site,p),{terrain:'floor',building:null,verticalLink:id});return link;
}
function fixture(){
 const s=createGame(74219),site=s.sites.surface;site.levels.push({z:1,name:'Upper test deck'});site.tiles.push(...site.tiles.map(t=>({...structuredClone(t),z:1})));
 for(const t of site.tiles){if(t.machine)t.machine.enabled=false;if(t.z===1){if(t.stock)t.stock={};t.drop=null;t.liquid=0;t.wetShort=false;for(const field of ['biome','temperatureOffset','basin','initialWater'])delete t[field];}}
 for(const c of s.crew){for(const k of Object.keys(c.labors))c.labors[k]=false;c.life.policy='work';c.hunger=c.energy=c.oxygen=100;Object.assign(c,{x:12,y:11,intent:null,job:null,carry:null,delivery:null});}
 const link=connect(site);updateRooms(site);for(const r of site.rooms){fillRoom(r);r.heat=(20+273.15)*r.volume*HEAT_CAPACITY;}
 const c=s.crew[0];Object.assign(c,link.lower);return {s,site,c,link};
}
function chamber(){
 const size=7,site={id:'surface',size,levels:[{z:0},{z:1}],verticalLinks:[],tiles:[],rooms:[],fireSafety:{smokeVented:0,smokeCleared:0}};
 for(const {z} of site.levels)for(let y=0;y<size;y++)for(let x=0;x<size;x++)site.tiles.push({x,y,z,terrain:'ground',building:null,hp:100,powered:false});
 for(const z of [0,1]){at(site,3,3,z).terrain='floor';for(const [x,y] of neighbors(3,3))at(site,x,y,z).building='wall';}
 const link=connect(site,3,3,'vertical-1','closed');updateRooms(site);const s={tick:0,sites:{surface:site},crew:[],creatures:[]};initializeThermal(s);initializeLiquids(s);
 const lower=roomAt(site,3,3,0),upper=roomAt(site,3,3,1);fillRoom(lower,100);fillRoom(upper,35);return {s,site,link,lower,upper};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('a registered stair adds exactly its adjacent floor edge and invalid references never create a route',()=>{
 const f=fixture();assert.doesNotThrow(()=>validateVerticalLinks(f.site));assert.deepEqual(pathToPosition(f.site,f.c,[f.link.upper]),[f.link.upper]);
 for(const change of [l=>l.upper.z=2,l=>l.hp=49,l=>l.mode='closed',l=>at(f.site,8,8,1).verticalLink='vertical-999']){const original=structuredClone(f.link);change(f.link);assert.equal(pathToPosition(f.site,f.c,[{x:8,y:8,z:1}]),null);Object.assign(f.link,original);at(f.site,8,8,1).verticalLink=f.link.id;}
 f.site.verticalLinks.push(structuredClone(f.link));assert.equal(stairLinks(f.site).length,0);assert.throws(()=>validateVerticalLinks(f.site));
 assert.equal(moveCrew(f.c,f.site,{x:8,y:8,z:2}),false);
});

test('vertical movement respects carrying speed and atomically moves patient and cargo',()=>{
 const f=fixture(),p=f.s.crew[1];Object.assign(p,f.link.lower);f.c.rescue={patient:p.id,carrying:true};f.c.carry={ore:2};startRecording(f.s);
 f.site.atmosphere.tick=1;assert.equal(advanceCrewRoutePositions(f.s,f.c,f.site,[f.link.upper]).reason,'mobility_wait');assert.equal(f.link.openUntil,0);assert.equal(f.c.z,0);
 f.site.atmosphere.tick=2;assert.equal(advanceCrewRoutePositions(f.s,f.c,f.site,[f.link.upper]).status,'moving');assert.deepEqual(positionOf(f.c),f.link.upper);assert.deepEqual(positionOf(p),f.link.upper);assert.deepEqual(f.c.carry,{ore:2});assert.equal(f.link.openUntil,5);
 const e=events(f.s).find(e=>e.id==='vertical.traversed');assert.equal(e.connection,f.link.id);assert.equal(e.from,'tile:surface:8:8');assert.equal(e.to,'tile:surface:8:8:1');assert.equal(e.patient,p.id);
 f.site.atmosphere.tick=5;assert.equal(stairOpen(f.site,f.link),false);
});

test('hatch actions preserve player parity and recheck closure, damage and landing obstruction',()=>{
 const f=fixture();f.c.x=9;const copy=structuredClone(f.s),args={site:'surface',connection:f.link.id,mode:'closed'};startRecording(f.s);
 assert.equal(executeAction(f.s,'vertical.hatch',args).ok,true);assert.equal(controlBindings(()=>copy).setStairHatch(copy,'surface',f.link.id,'closed').ok,true);assert.equal(serialize(f.s),serialize(copy));assert.equal(advanceCrewRoutePositions(f.s,f.c,f.site,[f.link.upper]).status,'blocked');
 assert.ok(events(f.s).some(e=>e.id==='vertical.hatch.changed'));assert.equal(executeAction(f.s,'vertical.hatch',{...args,mode:'auto'}).ok,true);
 Object.assign(f.c,f.link.lower);let before=serialize(f.s);assert.equal(executeAction(f.s,'vertical.hatch',args).reason,'occupied_stairwell');assert.equal(serialize(f.s),before);
 f.link.hp=0;assert.equal(moveCrew(f.c,f.site,f.link.upper),false);assert.equal(stairOpen(f.site,f.link),true);
 f.link.hp=100;at(f.site,8,8,1).building='wall';assert.equal(moveCrew(f.c,f.site,f.link.upper),false);
});

test('legacy pair routes never flatten a valid cross-floor detour',()=>{
 const f=chamber();for(const t of f.site.tiles){t.building=null;t.terrain='rock';delete t.verticalLink;}f.site.verticalLinks=[];
 const a=connect(f.site,2,3),b=connect(f.site,4,3,'vertical-2');at(f.site,3,3,1).terrain='floor';
 const route=pathToPosition(f.site,a.lower,[b.lower]);assert.ok(route.some(p=>p.z===1));assert.equal(pathTo(f.site,a.lower,[[4,3]]),null);assert.equal(planCrewRoute(f.s,f.site,a.lower,[[4,3]]),null);
});

test('an open stair exchanges finite gas and smoke while closed and damaged hatches differ',()=>{
 for(const mode of ['closed','open','damaged']){const f=chamber();f.link.mode=mode==='damaged'?'closed':mode;if(mode==='damaged')f.link.hp=0;f.lower.smoke=.4;
  const total=gasAmount(f.lower.gas)+gasAmount(f.upper.gas),upper=gasAmount(f.upper.gas);f.s.tick=1;updateAtmosphere(f.s);
  close(gasAmount(f.lower.gas)+gasAmount(f.upper.gas),total);close(f.lower.smoke+f.upper.smoke,.4);assert.equal(gasAmount(f.site.atmosphere.vented),0);
  if(mode==='closed'){close(gasAmount(f.upper.gas),upper);assert.equal(f.upper.smoke,0);}else{assert.ok(gasAmount(f.upper.gas)>upper);assert.ok(f.upper.smoke>0);assert.ok(gasAmount(f.upper.gas)<=total/2+1e-9);}
 }
});

test('open stair heat exchange conserves heat after accounting for ordinary wall conduction',()=>{
 const f=chamber();f.lower.heat=330*HEAT_CAPACITY;f.upper.heat=280*HEAT_CAPACITY;const control=structuredClone(f.s);f.link.mode='open';
 updateThermal(f.s);updateThermal(control);assert.ok(f.upper.heat>control.sites.surface.rooms[1].heat);assert.ok(f.lower.heat<control.sites.surface.rooms[0].heat);
 close(f.lower.heat+f.upper.heat,control.sites.surface.rooms.reduce((sum,r)=>sum+r.heat,0));
});

test('open stair drainage is downward, bounded and retains water above a full lower landing',()=>{
 const f=chamber(),upper=tileAt(f.site,f.link.upper),lower=tileAt(f.site,f.link.lower);f.link.mode='open';upper.liquid=2;lower.liquid=0;
 flowLiquids(f.s);assert.equal(upper.liquid,1.5);assert.equal(lower.liquid,.5);assert.equal(f.site.liquids.lost,0);
 upper.liquid=0;lower.liquid=2;flowLiquids(f.s);assert.equal(upper.liquid,0);assert.equal(lower.liquid,2);
 upper.liquid=2;lower.liquid=4;flowLiquids(f.s);assert.equal(upper.liquid,2);f.link.mode='closed';lower.liquid=0;flowLiquids(f.s);assert.equal(upper.liquid,2);assert.equal(lower.liquid,0);
});

test('crew haul inputs upstairs, operate the supplied machine and return output through a stair',()=>{
 const f=fixture(),helper=f.s.crew[5],store=at(f.site,8,10),machine=at(f.site,13,10,1);f.c.labors.hauling=true;helper.labors.production=true;store.stock={ore:1};
 assert.equal(executeAction(f.s,'depot.priority',{site:'surface',x:8,y:10,priority:5}).ok,true);
 assert.equal(executeAction(f.s,'production.order',{site:'surface',x:13,y:10,z:1,mode:'batches',limit:1}).ok,true);assert.equal(executeAction(f.s,'production.enable',{site:'surface',x:13,y:10,z:1,enabled:true}).ok,true);startRecording(f.s);assert.equal(recordingStatus(f.s).active,true);
 for(let i=0;i<100&&store.stock.alloy!==2;i++)step(f.s);
 assert.equal(machine.machine.completed,1);assert.equal(store.stock.alloy,2);assert.equal(machine.machine.output.alloy||0,0);assert.equal(recordingStatus(f.s).active,true);assert.ok(events(f.s).some(e=>e.id==='vertical.traversed'&&e.actor===helper.id));

});
