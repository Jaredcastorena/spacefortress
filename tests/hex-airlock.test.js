import test from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTIONS, neighbors, step, opposite, directionBetween, offsetToAxial, axialToOffset } from '../src/geometry.js';
import { AIRLOCK_DIRECTIONS, airlockLayout, airlockRouteInfo, airlockDoorPermit, airlockTile } from '../src/airlock-access.js';

// Pure boundary fixture: no createGame, physics, power allocation or grants are
// exercised here. The separate airlock-core cases run the actual subsystems.
function layoutFixture(rotation,anchor,lowerBranch=false) {
 const origin=offsetToAxial(7,7),target=offsetToAxial(...anchor);
 const transform=p=>{let [q,r]=offsetToAxial(...p);q-=origin[0];r-=origin[1];for(let i=0;i<rotation;i++)[q,r]=[-r,q+r];return axialToOffset(q+target[0],r+target[1]);};
 const site={id:'pure-hex',size:32,tiles:[],rooms:[],atmosphere:{tick:0}};
 for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({x,y,terrain:'ground',building:null,hp:100,pipe:null,powered:true});
 const tile=p=>airlockTile(site,...transform(p)),put=(p,building)=>Object.assign(tile(p),{terrain:'floor',building});
 const config=Object.fromEntries(Object.entries({chamber:[7,7],inner:[6,8],outer:[9,6],extractor:[7,7],pump:lowerBranch?[7,9]:[7,5],reservoir:lowerBranch?[7,11]:[7,3],vent:[8,7]}).map(([k,p])=>[k,transform(p)]));
 for(const p of [[9,5],[7,6],[8,6],[5,7],[6,7],[9,7],[10,7],[4,8],[7,8],[8,8],[4,9],[5,9],[6,9]])put(p,'wall');
 for(const p of [[6,8],[9,6]])Object.assign(put(p,'door'),{doorMode:'closed',doorUntil:0});
 const store=()=>({gas:{oxygen:0,inert:0,co2:0},smoke:0,open:true});
 for(const [name,building] of [['extractor','gasExtractor'],['vent','gasVent'],['reservoir','gasReservoir']])Object.assign(airlockTile(site,...config[name]),{terrain:'floor',building,gasStore:store()});
 const pump=airlockTile(site,...config.pump),output=transform(lowerBranch?[7,10]:[7,4]);
 Object.assign(pump,{terrain:'floor',building:'gasPump',gasDevice:{enabled:true,direction:directionBetween(config.pump,output)}});
 for(const p of lowerBranch?[[7,8],[7,10]]:[[7,6],[8,6],[7,4]])tile(p).pipe={...store(),hp:100};
 tile([5,8]).terrain='floor';const chamber=[[7,7],[8,7]].map(transform),habitat=[transform([5,8])];
 site.rooms=[chamber,habitat].map(cells=>({cells:cells.map(String),volume:cells.length,gas:{oxygen:cells.length*2.1,inert:cells.length*7.9,co2:0},smoke:0,heat:cells.length*20*293.15,pressure:100}));
 const controller=put([5,5],'airlockController');
 controller.airlock={binding:'pure',config,chamberCells:chamber.map(String).sort(),ownedNodes:[],enabled:true,phase:'idle',direction:null,party:null,queue:[],nextCycle:1,cycle:null,resumePhase:null,recoverySide:null,reason:null};
 const layout=airlockLayout(site,controller,false);
 if(layout.ok){controller.airlock.ownedNodes=layout.ownedNodes;for(const ref of layout.ownedNodes){const t=airlockTile(site,ref.x,ref.y);(ref.layer==='pipe'?t.pipe:t).airlockOwner={controller:`tile:${site.id}:${controller.x}:${controller.y}`,binding:'pure'};}}
 return {site,controller,pump,tile,transform,layout};
}

test('airlock direction catalog contains only the six frozen membership keys',()=>{
 assert.deepEqual(Object.keys(AIRLOCK_DIRECTIONS),DIRECTIONS);assert.equal(Object.isFrozen(AIRLOCK_DIRECTIONS),true);
 assert.ok(Object.values(AIRLOCK_DIRECTIONS).every(value=>value===true));
 assert.equal(airlockTile({size:2,tiles:[1,2,3,4]},-1,1),null);
});

for(const parity of [0,1])for(let rotation=0;rotation<6;rotation++)test(`hex airlock orientation ${rotation}, anchor parity ${parity}: opposite stages, four seals and isolated phase graphs`,()=>{
 const f=layoutFixture(rotation,[12+parity,12]),{site,controller}=f,a=controller.airlock;
 assert.equal(f.layout.ok,true);assert.equal(airlockLayout(site,controller).ok,true);
 const route=airlockRouteInfo(site,controller);
 assert.deepEqual(route.inner.outside,f.transform([5,8]));assert.deepEqual(route.outer.outside,f.transform([10,6]));
 for(const side of ['inner','outer']) {
  const r=route[side],inward=directionBetween(r.door,r.inside);
  assert.deepEqual(r.outside,step(...r.door,opposite(inward)));
  const walls=neighbors(...r.door).filter(p=>String(p)!==String(r.inside)&&String(p)!==String(r.outside));assert.equal(walls.length,4);
  for(const p of walls){const t=airlockTile(site,...p);assert.equal(t.building,'wall');t.building=null;assert.equal(airlockLayout(site,controller).ok,false);t.building='wall';t.hp=0;assert.equal(airlockLayout(site,controller).reason,'seal_broken');t.hp=100;}
 }
 const originalDirection=f.pump.gasDevice.direction;
 assert.equal(f.layout.recoveryDirection,originalDirection);
 f.pump.gasDevice.direction=opposite(originalDirection);assert.equal(airlockLayout(site,controller).recoveryDirection,originalDirection);
 f.pump.gasDevice.direction='north';assert.equal(airlockLayout(site,controller).ok,false);f.pump.gasDevice.direction=originalDirection;
 const ex=airlockTile(site,...a.config.extractor),vent=airlockTile(site,...a.config.vent);
 assert.ok(f.layout.phaseNodes.recover.includes(ex)&&!f.layout.phaseNodes.recover.includes(vent));
 assert.ok(f.layout.phaseNodes.refill.includes(vent)&&!f.layout.phaseNodes.refill.includes(ex));
 a.phase='admit';a.direction='outward';a.party={crew:'traveler',patient:null};
 assert.equal(airlockDoorPermit(site,{id:'traveler'},route.inner.outside,route.inner.door),true);
 assert.equal(airlockDoorPermit(site,{id:'stranger'},route.inner.outside,route.inner.door),false);
 assert.equal(airlockDoorPermit(site,{id:'traveler'},route.outer.inside,route.outer.door),false);
 assert.equal(airlockDoorPermit(site,{id:'animal',species:'tibble'},route.inner.outside,route.inner.door),false);
 assert.equal(layoutFixture(rotation,[12+parity,12],true).layout.ok,false,'closed extractor must not be the only route to the vent');
});
