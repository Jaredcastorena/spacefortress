import test from 'node:test';
import assert from 'node:assert/strict';
import {createElements,demoElements,cellAt,actElements,stepElements,totals,pressure,recordingStart,recordingExport,observeElements} from '../src/elements.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function box(){const s=createElements(9,9);for(const c of s.cells)if(c.x===0||c.y===0||c.x===8||c.y===8){c.wall=true;c.vent=false;}return s;}
const paint=(s,x,y,tool)=>assert.ok(actElements(s,'cell.paint',{x,y,tool}).ok);
const totalGas=s=>{const t=totals(s);return t.oxygen+t.inert+t.co2;};
const valid=s=>{for(const c of s.cells)for(const k of ['oxygen','inert','co2','smoke','water','heat','fuel'])assert.ok(Number.isFinite(c[k])&&c[k]>=-1e-10,`${c.id} ${k} ${c[k]}`);assert.ok(s.cells.every(c=>c.water<=1+1e-9));};

test('air expands into vacuum while conserving gas in a sealed chamber',()=>{
 const s=box();paint(s,4,4,'air');const before=totalGas(s);stepElements(s,30);close(totalGas(s),before);assert.ok(cellAt(s,3,4).oxygen>0);assert.ok(pressure(cellAt(s,4,4))<1);valid(s);
});

test('walls isolate gas and a painted breach connects the rooms',()=>{
 const s=box();for(let y=1;y<8;y++)paint(s,4,y,'wall');paint(s,3,4,'air');stepElements(s,10);assert.equal(cellAt(s,5,4).oxygen,0);paint(s,4,4,'erase');stepElements(s,5);assert.ok(cellAt(s,5,4).oxygen>0);valid(s);
});

test('water falls and levels without being created or lost in a closed chamber',()=>{
 const s=box();paint(s,4,2,'water');paint(s,4,2,'water');const before=totals(s).water;stepElements(s,40);close(totals(s).water,before);assert.ok(cellAt(s,4,7).water>0);assert.ok(cellAt(s,3,7).water>0);valid(s);
});

test('vacuum outlets account for drained air, water, smoke and heat',()=>{
 const s=box();const c=cellAt(s,4,4);c.smoke=.2;c.heat=10;paint(s,4,4,'air');paint(s,4,4,'water');paint(s,4,4,'vent');const before=totals(s);stepElements(s,10);close(totalGas(s)+s.ledger.ventedGas,before.oxygen+before.inert+before.co2);close(totals(s).water+s.ledger.ventedWater,before.water);close(totals(s).smoke+s.ledger.ventedSmoke,before.smoke);close(totals(s).heat+s.ledger.ventedHeat,before.heat);assert.ok(s.ledger.ventedGas>0);valid(s);
});

test('fire consumes fuel and oxygen, accounts for smoke and heat, and dies in water',()=>{
 const s=box();for(const c of s.cells)if(!c.wall){c.oxygen=.21;c.inert=.79;}paint(s,4,7,'fuel');paint(s,4,7,'ignite');const before=totals(s);stepElements(s,3);close(totalGas(s),before.oxygen+before.inert+before.co2);close(totals(s).fuel+s.ledger.fuelBurned,before.fuel);close(totals(s).oxygen+s.ledger.oxygenBurned,before.oxygen);close(totals(s).smoke,s.ledger.smokeMade);close(totals(s).heat,s.ledger.heatMade);paint(s,4,7,'water');stepElements(s);assert.equal(cellAt(s,4,7).fire,false);assert.ok(s.events.some(e=>e.id==='fire.extinguished'&&e.reason==='water'));valid(s);
});

test('fuel cannot burn without oxygen and existing fire starves',()=>{
 const s=box();paint(s,4,4,'fuel');actElements(s,'cell.paint',{x:4,y:4,tool:'ignite'});assert.equal(cellAt(s,4,4).fire,false);paint(s,4,4,'air');paint(s,4,4,'ignite');paint(s,4,4,'vacuum');stepElements(s);assert.equal(cellAt(s,4,4).fire,false);valid(s);
});

test('wired solar charges batteries; night uses stored energy to power devices',()=>{
 const s=box();paint(s,2,2,'solar');paint(s,3,2,'wire');paint(s,4,2,'battery');paint(s,5,2,'heater');stepElements(s,10);const battery=cellAt(s,4,2);assert.ok(battery.device.charge>0);close(s.ledger.generated,totals(s).charge+s.ledger.used+s.ledger.curtailed);s.tick=159;const charge=battery.device.charge;stepElements(s);assert.ok(cellAt(s,5,2).powered);assert.equal(battery.device.charge,charge-4);valid(s);
});

test('disconnecting wire causes a brownout and generator fuel is finite',()=>{
 const s=box();paint(s,2,2,'generator');paint(s,3,2,'wire');paint(s,4,2,'heater');cellAt(s,2,2).device.fuel=.2;stepElements(s);assert.equal(cellAt(s,4,2).powered,true);paint(s,3,2,'erase');stepElements(s);assert.equal(cellAt(s,4,2).powered,false);assert.equal(cellAt(s,2,2).device.fuel,0);paint(s,3,2,'wire');stepElements(s);assert.equal(cellAt(s,4,2).powered,false);close(s.ledger.generated,s.ledger.used+s.ledger.curtailed);valid(s);
});

test('a powered pump transfers real lower water upward and a fan moves air',()=>{
 const s=box();paint(s,2,3,'generator');paint(s,3,3,'pump');paint(s,4,3,'fan');paint(s,3,4,'water');paint(s,3,3,'air');const water=totals(s).water,air=totalGas(s);stepElements(s);assert.ok(s.events.some(e=>e.id==='water.transferred'&&e.cause==='pump'));assert.ok(s.events.some(e=>e.id==='air.transferred'&&e.cause==='fan'));close(totals(s).water,water);close(totalGas(s),air);valid(s);
});

test('water on exposed powered wire produces fault heat without inventing electricity',()=>{
 const s=box();paint(s,2,2,'generator');paint(s,3,2,'wire');paint(s,3,2,'water');stepElements(s);assert.equal(cellAt(s,3,2).short,true);assert.equal(s.ledger.used,5);close(totals(s).heat,s.ledger.heatMade);close(s.ledger.generated,s.ledger.used+s.ledger.curtailed);assert.ok(s.events.some(e=>e.id==='electrical.short'));valid(s);
});

test('stable cell actions reject bad inputs and observations are detached',()=>{
 const s=box();assert.equal(actElements(s,'cell.paint',{x:-1,y:2,tool:'water'}).ok,false);assert.equal(actElements(s,'simulation.step',{ticks:999}).ok,false);const o=observeElements(s);o.entities['cell:1:1'].water=99;assert.equal(cellAt(s,1,1).water,0);paint(s,1,1,'water');assert.equal(s.events.at(-1).entity,'cell:1:1');
});

test('recording does not change the deterministic sandbox and identifies edits and ticks',()=>{
 const a=box(),b=structuredClone(a);recordingStart(a);for(const s of [a,b]){paint(s,4,4,'air');paint(s,4,3,'water');stepElements(s,10);}assert.deepEqual(a,b);const rows=recordingExport(a).trim().split('\n').map(JSON.parse);assert.ok(rows.some(r=>r.kind==='action.requested'));assert.ok(rows.some(r=>r.event?.id==='cell.edited'));assert.ok(rows.some(r=>r.kind==='tick'));assert.equal(rows.at(-1).kind,'footer');
});

test('the mixed starter chamber remains finite and conservative through day and night',()=>{
 const s=demoElements(),before=totals(s);stepElements(s,250);valid(s);close(totals(s).water+s.ledger.ventedWater,before.water);close(totalGas(s)+s.ledger.ventedGas,before.oxygen+before.inert+before.co2);close(s.ledger.generated,totals(s).charge+s.ledger.used+s.ledger.curtailed);close(totals(s).heat+s.ledger.ventedHeat,s.ledger.heatMade);
});

test('bounded recording retains its prefix and declares the last complete tick',()=>{
 const s=demoElements();recordingStart(s);stepElements(s,20);const rows=recordingExport(s).trim().split('\n').map(JSON.parse),footer=rows.at(-1);assert.equal(rows[0].kind,'header');assert.equal(footer.reason,'limit');assert.ok(footer.records<=2000);assert.equal(footer.throughTick,rows.filter(r=>r.kind==='tick').at(-1)?.state.tick||0);assert.ok(footer.throughTick<s.tick);
});

test('closed doors isolate gas, water, smoke and heat; opening conserves them during flow',()=>{
 const s=box();for(let y=1;y<8;y++)paint(s,4,y,'wall');paint(s,4,7,'door');paint(s,3,7,'air');paint(s,3,7,'water');cellAt(s,3,7).smoke=.4;cellAt(s,3,7).heat=80;const before=totals(s);
 stepElements(s,12);for(const c of s.cells.filter(c=>c.x>4))for(const k of ['oxygen','water','smoke','heat'])assert.equal(c[k],0);
 assert.ok(actElements(s,'door.set',{x:4,y:7,open:true},'player').ok);stepElements(s,12);for(const k of ['oxygen','water','smoke','heat'])assert.ok(s.cells.filter(c=>c.x>4).reduce((n,c)=>n+c[k],0)>0,k);
 for(const k of ['oxygen','inert','co2','water','smoke','heat'])close(totals(s)[k],before[k]);valid(s);
});

test('closing a filled door traps its contents without deleting material, then releases them',()=>{
 const s=box();paint(s,4,4,'air');paint(s,4,4,'water');cellAt(s,4,4).heat=40;const before=totals(s);paint(s,4,4,'door');stepElements(s,5);close(cellAt(s,4,4).water,.5);close(cellAt(s,4,4).heat,40);for(const k of ['oxygen','inert','water','heat'])close(totals(s)[k],before[k]);paint(s,4,4,'toggle');stepElements(s);assert.ok(cellAt(s,4,4).water<.5);valid(s);
});

test('a two-door airlock vents only its vestibule until the inner door opens',()=>{
 const s=createElements(11,7);for(const c of s.cells)c.wall=true;
 for(let y=1;y<=5;y++)for(let x=1;x<=7;x++){const c=cellAt(s,x,y);c.wall=x===4;if(x<4){c.oxygen=.21;c.inert=.79;}}
 paint(s,4,3,'door');paint(s,8,3,'door');const sink=cellAt(s,9,3);sink.wall=false;sink.vent=true;
 actElements(s,'door.set',{x:8,y:3,open:true});stepElements(s,15);close(s.ledger.ventedGas,0);
 actElements(s,'door.set',{x:4,y:3,open:true});stepElements(s,40);assert.ok(s.ledger.ventedGas>0);valid(s);
});

test('pumps and fans cannot transfer through a closed endpoint door',()=>{
 const s=box();paint(s,2,3,'generator');paint(s,3,3,'pump');paint(s,4,3,'fan');paint(s,3,4,'water');paint(s,3,3,'air');paint(s,3,2,'door');paint(s,5,3,'door');stepElements(s);assert.ok(cellAt(s,3,3).powered&&cellAt(s,4,3).powered);assert.ok(!s.events.some(e=>['pump','fan'].includes(e.cause)));valid(s);
});

test('wire feedthroughs conduct electricity across a closed fluid door',()=>{
 const s=box();paint(s,2,3,'generator');paint(s,3,3,'door');paint(s,3,3,'wire');paint(s,4,3,'heater');stepElements(s);assert.equal(cellAt(s,4,3).powered,true);assert.equal(cellAt(s,3,3).door.open,false);assert.equal(cellAt(s,2,3).circuit,cellAt(s,4,3).circuit);valid(s);
});

test('insufficient battery energy stays stored instead of moving between banks for an unserved load',()=>{
 const s=box();paint(s,2,3,'battery');paint(s,3,3,'heater');paint(s,4,3,'battery');cellAt(s,2,3).device.charge=3;stepElements(s);
 assert.equal(cellAt(s,3,3).powered,false);assert.equal(cellAt(s,2,3).device.charge,3);assert.equal(cellAt(s,4,3).device.charge,0);assert.equal(s.circuits[0].unmet,4);assert.equal(s.circuits[0].discharged,0);assert.equal(s.ledger.curtailed,0);
});

test('circuit observations explain night, battery discharge, outages and stale edits',()=>{
 const s=box();paint(s,2,2,'solar');paint(s,3,2,'battery');paint(s,4,2,'heater');stepElements(s,3);const o=observeElements(s),id=cellAt(s,2,2).circuit;assert.equal(o.powerDirty,false);assert.equal(o.circuits[0].id,id);assert.equal(o.circuits[0].generation,12);assert.equal(o.circuits[0].used,4);assert.equal(o.circuits[0].charged,8);
 s.tick=159;stepElements(s);assert.equal(cellAt(s,2,2).powerStatus,'night');assert.equal(cellAt(s,3,2).powerStatus,'discharging');assert.equal(s.circuits[0].discharged,4);
 paint(s,3,2,'erase');assert.equal(observeElements(s).powerDirty,true);stepElements(s);assert.equal(s.circuits.length,2);assert.equal(cellAt(s,4,2).powerStatus,'brownout');assert.equal(s.circuits.find(c=>c.id===cellAt(s,4,2).circuit).unmet,4);valid(s);
});

test('door commands, rejection, stable IDs and event source survive recording and replay',()=>{
 const a=box(),b=box();recordingStart(a);
 for(const s of [a,b]){paint(s,4,4,'door');assert.equal(actElements(s,'door.set',{x:4,y:4,open:'yes'},'agent').ok,false);assert.ok(actElements(s,'door.set',{x:4,y:4,open:true},'agent').ok);stepElements(s,2);}
 assert.deepEqual(a,b);const rows=recordingExport(a).trim().split('\n').map(JSON.parse);assert.ok(rows.some(r=>r.event?.id==='door.changed'&&r.event.entity==='cell:4:4'&&r.event.source==='agent'));assert.ok(rows.some(r=>r.kind==='action.result'&&r.ok===false));assert.equal(observeElements(a).entities['cell:4:4'].door.open,true);
});

// Reactor/cooling integration: physical fuel and heat, latching failures, and shared controls.
function reactorBox(){
 const s=createElements(7,7);for(const c of s.cells){c.wall=true;c.vent=false;}
 for(const [x,y] of [[3,3],[3,2],[4,3],[5,3]])cellAt(s,x,y).wall=false;
 paint(s,3,3,'reactor');paint(s,3,2,'radiator');paint(s,4,3,'battery');paint(s,5,3,'heater');return s;
}

test('reactor fuel becomes tracked spent fuel, power and heat; a vacuum radiator removes only recorded heat',()=>{
 const s=reactorBox(),r=cellAt(s,3,3);stepElements(s,50);
 close(r.device.fuel,3);close(r.device.waste,1);close(s.ledger.reactorFuelUsed,1);
 close(s.ledger.generated,2000);close(s.ledger.generated,s.ledger.used+s.ledger.curtailed+totals(s).charge);
 close(totals(s).heat+s.ledger.radiatedHeat+s.ledger.ventedHeat,s.ledger.heatMade);
 assert.ok(s.ledger.radiatedHeat>1000);assert.equal(r.device.tripped,false);assert.equal(r.powerStatus,'generating');valid(s);
});

test('cooling loss trips the reactor, preserves remaining fuel and requires a cool manual reset',()=>{
 const s=reactorBox(),r=cellAt(s,3,3);paint(s,3,2,'toggle');stepElements(s,20);
 assert.equal(r.device.tripped,true);assert.equal(r.powered,false);assert.equal(r.powerStatus,'tripped');
 const fuel=r.device.fuel;stepElements(s,3);close(r.device.fuel,fuel);
 assert.equal(actElements(s,'reactor.reset',{x:3,y:3}).ok,false);
 paint(s,3,3,'toggle');paint(s,3,3,'toggle');stepElements(s);assert.equal(r.device.tripped,true);
 paint(s,3,2,'toggle');stepElements(s,30);assert.equal(r.device.tripped,true);
 assert.ok(actElements(s,'reactor.reset',{x:3,y:3},'player').ok);stepElements(s);
 assert.ok(r.device.fuel<fuel);assert.equal(r.device.tripped,false);
 close(totals(s).heat+s.ledger.radiatedHeat,s.ledger.heatMade);valid(s);
});

test('reactor output settings scale production; zero output and an off switch consume no fuel',()=>{
 const s=reactorBox(),r=cellAt(s,3,3);
 assert.ok(actElements(s,'reactor.output',{x:3,y:3,percent:25}).ok);stepElements(s);
 close(s.ledger.generated,10);close(r.device.fuel,3.995);close(s.ledger.heatMade,10); // six reactor + four heater
 assert.ok(actElements(s,'reactor.output',{x:3,y:3,percent:0}).ok);const fuel=r.device.fuel;stepElements(s,3);close(r.device.fuel,fuel);assert.equal(r.powerStatus,'idle');
 actElements(s,'reactor.output',{x:3,y:3,percent:100});paint(s,3,3,'toggle');stepElements(s,3);close(r.device.fuel,fuel);assert.equal(r.powerStatus,'off');
});

test('a partial final reactor fuel charge gives proportional output and does not regenerate fuel',()=>{
 const s=reactorBox(),r=cellAt(s,3,3);r.device.fuel=.005;stepElements(s);
 close(s.ledger.generated,10);close(r.device.waste,.005);close(r.device.fuel,0);
 stepElements(s,5);close(s.ledger.generated,10);assert.equal(r.powerStatus,'fuel_empty');
 close(totals(s).heat+s.ledger.radiatedHeat,s.ledger.heatMade);valid(s);
});

test('air blocks radiator cooling and sealed doors prevent its thermal collector reaching trapped heat',()=>{
 const s=reactorBox(),r=cellAt(s,3,3),rad=cellAt(s,3,2);paint(s,3,3,'toggle');paint(s,5,3,'toggle');
 rad.oxygen=.21;rad.inert=.79;r.heat=80;stepElements(s);close(s.ledger.radiatedHeat,0);assert.equal(rad.powerStatus,'atmosphere_blocked');
 for(const c of s.cells){c.oxygen=0;c.inert=0;c.heat=0;}paint(s,3,3,'erase');r.heat=80;paint(s,3,3,'door');stepElements(s,5);close(r.heat,80);close(s.ledger.radiatedHeat,0);
 actElements(s,'door.set',{x:3,y:3,open:true});stepElements(s);close(s.ledger.radiatedHeat,32);close(totals(s).heat,48);valid(s);
});

test('reactor heat can ignite oxygenated fuel while near-vacuum generation needs no oxygen',()=>{
 const s=reactorBox(),r=cellAt(s,3,3);paint(s,3,2,'toggle');
 for(const c of s.cells)if(!c.wall){c.oxygen=.21;c.inert=.79;}
 paint(s,3,3,'fuel');stepElements(s,8);assert.ok(s.ledger.fuelBurned>0);assert.ok(s.events.some(e=>e.id==='fire.ignited'&&e.cause==='heat'));
 close(totals(s).heat+s.ledger.radiatedHeat,s.ledger.heatMade);valid(s);
});

test('reactor control validation, labeled player/agent events and recordings preserve deterministic outcomes',()=>{
 const a=reactorBox(),b=structuredClone(a);recordingStart(a);
 for(const s of [a,b]){
  for(const percent of [-1,101,1.5,'50',null])assert.equal(actElements(s,'reactor.output',{x:3,y:3,percent}).ok,false);
  assert.equal(actElements(s,'reactor.output',{x:4,y:3,percent:50}).ok,false);
  assert.equal(actElements(s,'reactor.reset',{x:3,y:3}).ok,false);
  actElements(s,'reactor.output',{x:3,y:3,percent:50},'player');paint(s,3,2,'toggle');stepElements(s,40);paint(s,3,2,'toggle');stepElements(s,30);
  assert.equal(actElements(s,'reactor.reset',{x:3,y:3},'agent').ok,true);stepElements(s);
 }
 assert.deepEqual(a,b);const rows=recordingExport(a).trim().split('\n').map(JSON.parse);
 for(const id of ['reactor.output.changed','reactor.generated','reactor.tripped','heat.radiated','reactor.reset'])assert.ok(rows.some(r=>r.event?.id===id),id);
 assert.ok(rows.some(r=>r.event?.id==='reactor.output.changed'&&r.event.source==='player'));
 assert.ok(rows.some(r=>r.event?.id==='reactor.reset'&&r.event.source==='agent'));
 const obs=observeElements(a);assert.equal(obs.entities['cell:3:3'].device.output,50);obs.entities['cell:3:3'].device.waste=99;assert.notEqual(cellAt(a,3,3).device.waste,99);
});
