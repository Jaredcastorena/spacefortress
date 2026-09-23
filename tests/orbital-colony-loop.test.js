import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, at, serialize, deserialize} from '../src/simulation.js';
import {executeAction} from '../src/controls.js';
import {totalResources} from '../src/inventory.js';
import {routeTime, routeFuel} from '../src/expedition.js';

const TEAM=['crew-2','crew-4'];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function act(s,id,args={}){const r=executeAction(s,id,args,'test');assert.ok(r.ok,`${id} at tick ${s.tick}: ${JSON.stringify(r)}`);return r;}
const advance=(s,ticks=1)=>act(s,'simulation.step',{ticks});
const crew=(s,id)=>s.crew.find(c=>c.id===id);
const job=(s,id)=>s.jobs.find(j=>j.id===id);
function until(s,p,label,limit=200){
 for(let i=0;i<limit&&!p(s);i++)advance(s);
 assert.ok(p(s),`${label} at tick ${s.tick}: ${JSON.stringify({departure:s.departure,mission:s.mission,jobs:s.jobs.map(j=>({id:j.id,kind:j.kind,worker:j.worker,remaining:j.remaining,blocked:j.blockedReason})),crew:s.crew.map(c=>({id:c.id,site:c.site,x:c.x,y:c.y,activity:c.activity,health:c.health,oxygen:c.oxygen,energy:c.energy,intent:c.intent,carry:c.carry}))})}`);
}
function checkpoint(s,t,label,ticks){
 const copy=deserialize(serialize(s));assert.deepEqual(copy,s);
 advance(s,ticks);advance(copy,ticks);assert.deepEqual(copy,s,`${label} continuation`);
 t.diagnostic(`${label}: save/reload and ${ticks} further ticks match at tick ${copy.tick}`);return copy;
}
const labor=(s,id,name,enabled)=>act(s,'crew.labor',{crew:id,labor:name,enabled});

test('a fresh colony sends an explicit skilled team, recovers real wreck cargo, and spends recovered components on a completed shield refit',t=>{
 let s=createGame();const start=totalResources(s);
 assert.deepEqual(s.crew.slice(0,2).map(c=>c.id),['crew-0','crew-1']);assert.equal(start.components,3);assert.equal(s.shuttle.fit,'standard');
 act(s,'door.mode',{site:'surface',x:10,y:12,mode:'closed'});
 act(s,'production.enable',{site:'surface',x:7,y:7,enabled:false});
 act(s,'expedition.launch',{site:'wreck',crewIds:TEAM});
 assert.deepEqual(s.departure.crew,TEAM);assert.equal(s.mission,null);assert.ok(s.crew.every(c=>c.site==='surface'));
 advance(s,4);assert.equal(s.mission,null);assert.ok(s.departure);
 const blockedLoad=s.jobs.find(j=>j.kind==='loadShuttle');if(blockedLoad)assert.equal(blockedLoad.remaining,blockedLoad.work);
 assert.deepEqual(s.shuttle.supplies,{});assert.match(blockedLoad?.blockedReason||s.departure.status,/route|reach|blocked/i);
 assert.equal(at(s.sites.surface,7,7).powered,false);close(totalResources(s).fuel,start.fuel);
 s=checkpoint(s,t,'Blocked preparation',3);
 act(s,'door.mode',{site:'surface',x:10,y:12,mode:'auto'});
 act(s,'production.enable',{site:'surface',x:7,y:7,enabled:true});
 until(s,current=>current.jobs.some(j=>j.kind==='loadShuttle'),'Loading becomes reachable');
 const loadingId=s.jobs.find(j=>j.kind==='loadShuttle').id;
 until(s,current=>current.crew.some(c=>c.carry&&c.delivery?.job===loadingId),'Physical supply carrier');
 assert.equal(s.mission,null);assert.equal(job(s,loadingId).remaining,job(s,loadingId).work);
 until(s,current=>!!current.mission,'Supplied crew departure');
 assert.deepEqual(s.mission.crew,TEAM);assert.equal(s.mission.phase,'outbound');
 for(const id of TEAM){assert.equal(crew(s,id).site,'transit');assert.equal(crew(s,id).x,16);assert.equal(crew(s,id).y,11);}
 close(totalResources(s).fuel,start.fuel-1);assert.equal(s.mission.returnFuel,1);
 t.diagnostic(`Liftoff tick ${s.tick}: crew-2/crew-4 physically boarded, one fuel spent and one retained for return`);
 const surfaceHunger=crew(s,'crew-0').hunger,departureTick=s.tick;
 until(s,current=>current.mission?.phase==='working','Wreck arrival',30);
 assert.equal(s.tick-departureTick,22);assert.ok(crew(s,'crew-0').hunger<surfaceHunger,'Surface needs continue during transit');
 assert.equal(crew(s,'crew-0').site,'surface');assert.deepEqual(s.mission.crew,TEAM);
 for(const id of TEAM){labor(s,id,'mining',false);labor(s,id,'hauling',false);}
 const mineId=act(s,'job.order',{site:'wreck',x:8,y:10,kind:'mine'}).job;
 advance(s,3);assert.equal(job(s,mineId).worker,null);assert.equal(job(s,mineId).remaining,12);
 assert.match(job(s,mineId).blockedReason,/mining|extraction/i);assert.deepEqual(s.mission.cargo,{});
 const miner=crew(s,'crew-2'),pilot=crew(s,'crew-4'),miningXp=miner.skills.mining.xp;
 assert.ok(miner.skills.mining.level>pilot.skills.mining.level);
 for(const id of TEAM)labor(s,id,'mining',true);
 advance(s);assert.equal(job(s,mineId).worker,'crew-2','Higher extraction skill selects the miner despite the pilot starting closer');
 until(s,current=>!job(current,mineId),'Real salvage work');
 const pile=at(s.sites.wreck,8,10).drop;assert.equal(pile.components,3);assert.equal(pile.alloy,2);
 assert.ok(crew(s,'crew-2').skills.mining.xp>miningXp);assert.deepEqual(s.mission.cargo,{});
 close(totalResources(s).components,start.components+3);t.diagnostic(`Salvage tick ${s.tick}: skilled extraction created a located 3-component/2-alloy pile; no cargo teleported`);
 labor(s,'crew-4','hauling',true);
 until(s,current=>(crew(current,'crew-4').carry?.components||0)>0,'Pilot physically picks up salvage');
 assert.equal(s.mission.cargo.components||0,0);assert.equal(crew(s,'crew-4').delivery.kind,'shuttle');
 until(s,current=>(current.mission?.cargo.components||0)===3,'Cargo reaches wreck dock');
 assert.equal(s.mission.cargo.alloy,2);assert.equal(at(s.sites.wreck,8,10).drop,null);
 const positions=TEAM.map(id=>({id,x:crew(s,id).x,y:crew(s,id).y}));
 assert.ok(positions.some(c=>c.x!==4||c.y!==11));
 act(s,'expedition.recall');assert.equal(s.mission.phase,'boarding');assert.ok(TEAM.every(id=>crew(s,id).site==='wreck'));
 until(s,current=>current.mission?.phase==='returning','Physical return boarding',20);
 for(const id of TEAM){assert.equal(crew(s,id).site,'transit');assert.equal(crew(s,id).x,4);assert.equal(crew(s,id).y,11);}
 close(totalResources(s).fuel,start.fuel-2);
 s=checkpoint(s,t,'Return flight',5);
 until(s,current=>!current.mission,'Return arrival',25);
 assert.ok(TEAM.every(id=>crew(s,id).site==='surface'));assert.equal(s.flags.salvageReturned,true);
 const homePile=at(s.sites.surface,16,11).drop;assert.equal(homePile.components,3);assert.equal(homePile.alloy,2);
 assert.equal(at(s.sites.surface,8,10).stock.components,3,'Returning cargo remains loose before a hauler or construction order takes it');
 close(totalResources(s).components,start.components+3);t.diagnostic(`Return tick ${s.tick}: all recovered components are in the shuttle-side pile; five surface crew kept simulating`);
 // Shield needs four components, so the three starting components cannot fund it alone.
 const before=totalResources(s),refitId=act(s,'job.order',{site:'surface',x:16,y:11,kind:'refit',building:'shield'}).job;
 const refit=job(s,refitId);assert.deepEqual(refit.cost,{alloy:8,components:4});assert.deepEqual(refit.materials,{});
 assert.ok(refit.sources.some(source=>source.x===16&&source.y===11&&(source.items.components||0)>=1),'Reservation must include physically recovered components');
 close(totalResources(s).components,before.components);close(totalResources(s).alloy,before.alloy);assert.equal(s.shuttle.fit,'standard');
 until(s,current=>current.crew.some(c=>c.carry&&c.delivery?.job===refitId),'Actual refit material shipment');
 assert.equal(s.shuttle.fit,'standard');assert.equal(job(s,refitId).remaining,job(s,refitId).work);
 until(s,current=>current.shuttle.fit==='shield','Paid shield refit completion',200);
 assert.equal(job(s,refitId),undefined);close(totalResources(s).components,before.components-4);close(totalResources(s).alloy,before.alloy-8);
 assert.equal(routeTime(s,'wreck'),22);assert.equal(routeFuel(s,'wreck'),3);
 assert.equal(s.crew.filter(c=>c.health>0).length,7);assert.deepEqual(deserialize(serialize(s)),s);
 t.diagnostic(`Upgrade tick ${s.tick}: delivered 4 components and 8 alloy were consumed once; shield fitting installed with all seven crew alive`);
});
