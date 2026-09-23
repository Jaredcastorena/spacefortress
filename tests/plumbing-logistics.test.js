import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, at, step, order, pathTo, serialize, deserialize} from '../src/simulation.js';
import {add, extract, initializeStorage, syncResources, totalResources} from '../src/inventory.js';
import {haul, setMachineEnabled} from '../src/industry.js';
import {setProductionOrder, projectedStock} from '../src/production.js';
import {refreshPower} from '../src/power.js';
import {initializePlumbingTile, newWaterPipe, waterNode, operatePlumbing, plumbingStatus, setWaterIntake, setWaterOutlet} from '../src/plumbing.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-7,`${actual} != ${expected}`);
const stock=s=>at(s.sites.surface,8,10).stock;
const check=s=>{syncResources(s);refreshPower(s,s.sites.surface);return deserialize(serialize(s));};
function base(){
 const s=createGame(),site=s.sites.surface;
 for(const t of site.tiles)if(t.machine)t.machine.enabled=false;
 for(const c of s.crew){c.labors.hauling=false;c.labors.production=false;}
 for(let y=9;y<=11;y++)for(let x=8;x<=12;x++)at(site,x,y).cable={enabled:true,hp:100};
 refreshPower(s,site);return {s,site};
}
function install(f,kind,x,y){
 const t=at(f.site,x,y);assert.equal(t.building,null,`fixture occupied at ${x},${y}`);
 t.building=kind;t.hp=100;initializeStorage(t);initializePlumbingTile(t);refreshPower(f.s,f.site);return t;
}
function pipe(f,x,y){const t=at(f.site,x,y);t.waterPipe=newWaterPipe();return t;}
function into(f,t,slot,amount){add(t.machine[slot],extract(stock(f.s),{water:amount}));}
function fill(f,t,amount){
 assert.ok(extract(stock(f.s),{water:amount}));waterNode(t).water+=amount;f.site.plumbing.loaded+=amount;
}
function run(f,n=1){for(let i=0;i<n;i++){refreshPower(f.s,f.site);operatePlumbing(f.s);}}
function until(s,p,limit=160){for(let i=0;i<limit&&!p();i++)step(s);assert.ok(p(),`Condition not reached by tick ${s.tick}`);}
function deliver(s,c,limit=40){for(let i=0;i<limit&&(c.carry||c.intent?.type==='haul');i++)haul(s,c,s.sites.surface,pathTo);assert.equal(c.carry,null);assert.notEqual(c.intent?.type,'haul');}
function outputFixture(){
 const f=base(),source=install(f,'bilgePump',8,9),intake=install(f,'waterIntake',9,9),node=pipe(f,10,9);
 source.machine.enabled=false;refreshPower(f.s,f.site);return {...f,source,intake,node};
}
function inputFixture(){
 const f=base(),node=pipe(f,10,9),outlet=install(f,'waterOutlet',11,9),target=install(f,'farm',12,9);
 refreshPower(f.s,f.site);return {...f,node,outlet,target};
}

test('hauled tank water reaches a staffed farm through intake, pipes, pump, reservoir and outlet without replacing fertilizer or labor',()=>{
 const f=base(),{s,site}=f,tank=install(f,'waterTank',8,9),intake=install(f,'waterIntake',9,9),node=pipe(f,10,9),pump=install(f,'waterPump',11,9),reservoir=install(f,'waterReservoir',12,9),outlet=install(f,'waterOutlet',12,10),farm=install(f,'farm',12,11);
 // This scenario's finite six water units begin in the depot and reach the tank by hauling.
 stock(s).water=6;farm.machine.enabled=false;const hauler=s.crew[0];hauler.labors.hauling=true;hauler.x=8;hauler.y=10;
 for(let i=0;i<50&&(tank.machine.input.water||0)<6;i++)haul(s,hauler,site,pathTo);
 close(tank.machine.input.water,6);close(stock(s).water||0,0);assert.equal(hauler.carry,null);
 setMachineEnabled(s,'surface',tank.x,tank.y,false);hauler.labors.hauling=false;
 setMachineEnabled(s,'surface',farm.x,farm.y,true);setProductionOrder(s,'surface',farm.x,farm.y,'batches',1);
 assert.ok(setWaterOutlet(s,'surface',outlet.x,outlet.y,true,'south','inventory').ok);
 const before=totalResources(s).water;
 until(s,()=>(farm.machine.input.water||0)>=1-1e-8);
 assert.ok(site.plumbing.loaded>0);assert.ok(site.plumbing.delivered>0);assert.ok(waterNode(reservoir));
 assert.deepEqual(farm.machine.batch,{});assert.equal(farm.machine.progress,0);assert.equal(farm.machine.completed,0);
 close(totalResources(s).water,before);assert.match(farm.machine.status,/fertilizer/i);
 hauler.labors.hauling=true;for(let i=0;i<40&&(farm.machine.input.fertilizer||0)<.25;i++)haul(s,hauler,site,pathTo);
 close(farm.machine.input.fertilizer,.25);hauler.labors.hauling=false;step(s,3);
 assert.equal(farm.machine.progress,0);assert.equal(farm.machine.completed,0);
 const worker=s.crew[3];worker.labors.production=true;const xp=worker.skills.production.xp;
 until(s,()=>farm.machine.completed===1);step(s,4);
 assert.equal(farm.machine.order.remaining,0);assert.equal(farm.machine.output.food,2);assert.ok(worker.skills.production.xp>xp);
 close(farm.machine.input.water||0,0);close(site.plumbing.delivered,1);close(totalResources(s).water,before-1);
 assert.ok([intake,pump,outlet].every(t=>t.powered));check(s);
});

test('an intake uses only unclaimed producer output and the promised shipment still reaches its depot',()=>{
 const f=outputFixture(),{s,site,source,node}=f,c=s.crew[0];into(f,source,'output',3);const before=totalResources(s).water;
 c.labors.hauling=true;c.x=8;c.y=8;c.intent={type:'haul',target:[8,9],source:'output',items:{water:2},destination:{kind:'stock',target:[8,10]}};
 run(f,6);close(source.machine.output.water,2);close(waterNode(node).water,1);
 const status=plumbingStatus(s,site,f.intake);assert.equal(status.blockedCode,'source_reserved');close(status.reservedOutput,2);close(status.reservedInput,0);
 deliver(s,c);close(source.machine.output.water||0,0);close(waterNode(node).water,1);close(totalResources(s).water,before);check(s);
});

test('cancelled or deceased output claimants release water for an intake without consuming a second copy',()=>{
 for(const release of ['cancel','death']){
  const f=outputFixture(),{s,source,node}=f,c=s.crew[0];into(f,source,'output',1);const before=totalResources(s).water;
  c.intent={type:'haul',target:[8,9],source:'output',items:{water:1},destination:{kind:'stock',target:[8,10]}};
  run(f,2);close(waterNode(node).water,0);
  if(release==='cancel')c.intent=null;else c.health=0;
  run(f,2);close(source.machine.output.water||0,0);close(waterNode(node).water,1);close(totalResources(s).water,before);
  if(release==='death')step(s);check(s);
 }
});

test('an outlet leaves space for both an incoming pickup and carried water, including deliveries retained through pause',()=>{
 const f=inputFixture(),{s,site,target,node}=f,[carrying,picking]=s.crew;fill(f,node,2);into(f,target,'input',.5);
 carrying.x=9;carrying.y=10;carrying.carry=extract(stock(s),{water:.5});carrying.delivery={kind:'input',target:[12,9]};
 picking.labors.hauling=true;picking.x=8;picking.y=11;picking.intent={type:'haul',target:[8,10],source:'stock',items:{water:.5},destination:{kind:'input',target:[12,9]}};
 const before=totalResources(s).water;run(f,6);close(target.machine.input.water,1);close(waterNode(node).water,1.5);
 const status=plumbingStatus(s,site,f.outlet);assert.equal(status.blockedCode,'target_reserved');close(status.reservedInput,1);close(status.reservedOutput,0);
 setMachineEnabled(s,'surface',12,9,false);run(f,2);close(target.machine.input.water,1);
 deliver(s,carrying);deliver(s,picking);close(target.machine.input.water,2);close(waterNode(node).water,1.5);close(totalResources(s).water,before);check(s);
});

test('inventory outlets honor fixed and stock orders and retain delivered ingredients when the order changes',()=>{
 const f=inputFixture(),{s,site,target,node}=f;fill(f,node,2);const before=totalResources(s).water;
 setProductionOrder(s,'surface',12,9,'batches',1);run(f,8);close(target.machine.input.water,1);close(waterNode(node).water,1);
 setProductionOrder(s,'surface',12,9,'batches',0);run(f,4);close(target.machine.input.water,1);close(waterNode(node).water,1);
 assert.equal(plumbingStatus(s,site,f.outlet).blockedCode,'target_order_complete');
 const available=projectedStock(s,site,'food');assert.ok(Number.isInteger(available));
 setProductionOrder(s,'surface',12,9,'stock',available);run(f,4);close(target.machine.input.water,1);
 setProductionOrder(s,'surface',12,9,'stock',available+4);run(f,8);close(target.machine.input.water,2);close(waterNode(node).water,0);
 close(totalResources(s).water,before);check(s);
});

test('two outlets share the remaining input capacity instead of each using a stale free-space count',()=>{
 const f=inputFixture(),{s,target,node}=f,southNode=pipe(f,12,11),southOutlet=install(f,'waterOutlet',12,10);
 fill(f,node,2);fill(f,southNode,2);into(f,target,'input',1.75);
 assert.ok(setWaterOutlet(s,'surface',12,10,true,'north','inventory').ok);const before=totalResources(s).water;
 run(f,5);close(target.machine.input.water,2);close(waterNode(node).water+waterNode(southNode).water,3.75);close(f.site.plumbing.delivered,.25);close(totalResources(s).water,before);check(s);
});

test('reversing inventory adapters does not reverse their transfer roles or siphon consumer inputs',()=>{
 const output=outputFixture();into(output,output.source,'output',1);
 setWaterIntake(output.s,'surface',9,9,true,'west','inventory');run(output,3);
 close(output.source.machine.output.water,1);close(waterNode(output.node).water,0);
 setWaterIntake(output.s,'surface',9,9,true,'east','inventory');run(output,1);close(waterNode(output.node).water,.5);
 const input=inputFixture();fill(input,input.node,1);into(input,input.target,'input',.5);
 setWaterOutlet(input.s,'surface',11,9,true,'west','inventory');run(input,3);
 close(waterNode(input.node).water,1);close(input.target.machine.input.water,.5);
 check(output.s);check(input.s);
});

test('a deceased incoming carrier frees destination capacity while their actual water drops at the death location',()=>{
 const f=inputFixture(),{s,target,node}=f,c=s.crew[0];fill(f,node,2);into(f,target,'input',1);
 c.x=9;c.y=10;c.carry=extract(stock(s),{water:1});c.delivery={kind:'input',target:[12,9]};
 const before=totalResources(s).water;run(f,2);close(target.machine.input.water,1);close(waterNode(node).water,2);
 c.health=0;step(s);run(f,4);
 assert.equal(c.carry,null);assert.equal(c.delivery,null);close(at(f.site,9,10).drop.water,1);
 close(target.machine.input.water,2);close(waterNode(node).water,1);close(totalResources(s).water,before);check(s);
});

test('dismantling a consumer preserves its water and redirects an already carried shipment into storage',()=>{
 const f=inputFixture(),{s,site,target,node}=f,c=s.crew[0];fill(f,node,2);into(f,target,'input',.5);
 c.x=8;c.y=11;c.carry=extract(stock(s),{water:1});c.delivery={kind:'input',target:[12,9]};
 const before=totalResources(s).water;
 // Keep this living carrier in physical recovery so demolition can overtake its delivery.
 c.energy=1;c.intent={type:'rest',target:null};
 setMachineEnabled(s,'surface',target.x,target.y,false);assert.ok(order(s,'surface',target.x,target.y,'remove').ok);
 until(s,()=>target.building===null);assert.equal(target.machine,undefined);close(waterNode(node).water,2);
 assert.ok((target.drop?.water||0)>=.5);run(f,4);close(waterNode(node).water,2);
 c.intent=null;deliver(s,c);assert.equal(c.carry,null);close(totalResources(s).water,before);check(s);
});
