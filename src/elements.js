import { REACTOR_RULES } from './reactor-rules.js';
// Small deterministic environment laboratory. No renderer, timers or network access.
export const ELEMENTS_VERSION=3;
export const TOOLS=['wall','door','erase','air','vacuum','water','fuel','ignite','vent','seal','wire','solar','generator','reactor','radiator','battery','pump','fan','heater','toggle'];
export const DEVICES={solar:{supply:12},generator:{supply:16},reactor:REACTOR_RULES,radiator:{cooling:32,vacuumLimit:.05},battery:{capacity:100,rate:8},pump:{demand:3},fan:{demand:2},heater:{demand:4}};
const GAS=['oxygen','inert','co2'];
const recordings=new WeakMap();
const clone=v=>JSON.parse(JSON.stringify(v));
export const cellAt=(s,x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<s.width&&y<s.height?s.cells[y*s.width+x]:null;
export const openCell=c=>!!c&&!c.wall&&(!c.door||c.door.open);
export const gas=c=>GAS.reduce((n,k)=>n+c[k],0);
export const capacity=c=>1+gas(c)+c.water*4;
export const temperature=c=>20+c.heat/capacity(c);
export const pressure=c=>gas(c)/Math.max(.05,1-c.water);
export const daylight=s=>s.tick%240<160;
export function totals(s){return s.cells.reduce((n,c)=>{for(const k of ['water','oxygen','inert','co2','smoke','fuel','heat'])n[k]+=c[k];n.charge+=c.device?.charge||0;return n;},{water:0,oxygen:0,inert:0,co2:0,smoke:0,fuel:0,heat:0,charge:0});}
export function observeElements(s){return clone({version:s.version,tick:s.tick,width:s.width,height:s.height,daylight:daylight(s),ledger:s.ledger,circuits:s.circuits,powerDirty:s.powerDirty,entities:Object.fromEntries(s.cells.map(c=>[c.id,{...c,temperature:temperature(c),pressure:pressure(c)}])),lastEvent:s.nextEvent-1});}
function record(s,row){const r=recordings.get(s);if(!r?.active)return;const bytes=new TextEncoder().encode(JSON.stringify(row)).length;if(r.rows.length>=2000||r.bytes+bytes>16_000_000){r.active=false;r.reason='limit';return;}r.rows.push(row);r.bytes+=bytes;if(row.kind==='tick'||row.kind==='header')r.throughTick=row.state.tick;}
function event(s,id,details){const e={sequence:s.nextEvent++,tick:s.tick,id,...details};s.events.push(e);if(s.events.length>200){s.events.shift();s.eventsDropped++;}record(s,{kind:'event',event:e});}
export function recordingStart(s){recordings.set(s,{active:true,reason:null,bytes:0,rows:[],throughTick:s.tick});record(s,{kind:'header',state:observeElements(s)});return recordingStatus(s);}
export function recordingStatus(s){const r=recordings.get(s);return r?{active:r.active,records:r.rows.length,reason:r.reason}:{active:false,records:0,reason:'not_started'};}
export function recordingExport(s){const r=recordings.get(s);return r?r.rows.map(row=>JSON.stringify(row)).concat(JSON.stringify({kind:'footer',...recordingStatus(s),tick:s.tick,throughTick:r.throughTick})).join('\n')+'\n':'';}
export function recordingStop(s){const r=recordings.get(s);if(r){r.active=false;r.reason||='stopped';}return recordingStatus(s);}
export function createElements(width=36,height=22){
 const s={version:ELEMENTS_VERSION,width,height,tick:0,nextEvent:1,events:[],eventsDropped:0,cells:[],circuits:[],powerDirty:true,ledger:{ventedWater:0,ventedGas:0,ventedSmoke:0,ventedHeat:0,oxygenBurned:0,fuelBurned:0,smokeMade:0,heatMade:0,generated:0,used:0,curtailed:0,reactorFuelUsed:0,radiatedHeat:0}};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)s.cells.push({id:`cell:${x}:${y}`,x,y,wall:false,door:null,circuit:null,powerStatus:'unconnected',vent:x===0||y===0||x===width-1||y===height-1,water:0,oxygen:0,inert:0,co2:0,smoke:0,fuel:0,heat:0,fire:false,wire:false,device:null,powered:false,short:false});
 return s;
}
export function demoElements(){
 const s=createElements();
 for(const c of s.cells){c.wall=c.x===2||c.x===33||c.y===2||c.y===19;if(c.x>2&&c.x<33&&c.y>2&&c.y<19){c.oxygen=.21;c.inert=.79;}}
 for(let y=13;y<19;y++)for(let x=5;x<12;x++)cellAt(s,x,y).water=.8;
 for(let x=20;x<27;x++)cellAt(s,x,18).fuel=2;
 for(let x=8;x<=29;x++)cellAt(s,x,10).wire=true;
 for(const [x,kind] of [[8,'pump'],[15,'solar'],[19,'battery'],[24,'fan'],[29,'heater']]){const c=cellAt(s,x,10);c.device={kind,enabled:true,charge:0,fuel:kind==='generator'?20:0};}
 // The pump lifts adjacent lower liquid one tile upward; draw a wire down to it.
 for(let y=11;y<18;y++)cellAt(s,8,y).wire=true;
 cellAt(s,8,10).device=null;cellAt(s,8,17).device={kind:'pump',enabled:true,charge:0,fuel:0};
 // Two manual doors make a small airlock on the chamber's right side.
 for(const c of s.cells.filter(c=>(c.x===31&&c.y>=14&&c.y<19)||(c.x===32&&c.y===14))){c.wall=true;c.oxygen=0;c.inert=0;}
 for(const x of [31,33]){const c=cellAt(s,x,17);c.wall=false;c.door={open:false};}
 return s;
}
export function reactorDemoElements(){
 const s=createElements();
 // A vacuum power bay is separated from the air-filled load bay by a sealed feedthrough.
 for(const c of s.cells){
  c.wall=c.x===3||c.x===32||c.y===3||c.y===18||(c.x===20&&c.y>3&&c.y<18);
  if(c.x>20&&c.x<32&&c.y>3&&c.y<18){c.oxygen=.21;c.inert=.79;}
 }
 for(let x=10;x<=27;x++)cellAt(s,x,12).wire=true;
 const door=cellAt(s,20,12);door.wall=false;door.door={open:false};
 for(const [x,y,kind] of [[10,12,'reactor'],[10,11,'radiator'],[12,12,'battery'],[27,12,'heater']])cellAt(s,x,y).device=createDevice(kind);
 return s;
}
function createDevice(kind){
 return {kind,enabled:true,charge:0,fuel:kind==='generator'?20:kind==='reactor'?4:0,
  ...(kind==='reactor'?{output:100,tripped:false,waste:0}:{})};
}
function reactorPower(s,c){
 const d=c.device,def=DEVICES.reactor;
 if(!d.tripped&&temperature(c)>=def.tripTemperature){
  d.tripped=true;event(s,'reactor.tripped',{entity:c.id,temperature:temperature(c),limit:def.tripTemperature});
 }
 if(d.tripped){c.powerStatus='tripped';return 0;}
 if(!d.output){c.powerStatus='idle';return 0;}
 const fuel=Math.min(d.fuel,def.fuelRate*d.output/100),fraction=fuel/def.fuelRate;
 if(!fuel){c.powerStatus='fuel_empty';return 0;}
 const output=def.supply*fraction,heat=def.heat*fraction;
 d.fuel-=fuel;d.waste+=fuel;c.heat+=heat;s.ledger.reactorFuelUsed+=fuel;s.ledger.heatMade+=heat;
 c.powered=true;c.powerStatus='generating';
 event(s,'reactor.generated',{entity:c.id,fuel,power:output,heat,setting:d.output});return output;
}
function radiate(s,c){
 const def=DEVICES.radiator;
 if(pressure(c)>def.vacuumLimit){c.powerStatus='atmosphere_blocked';return;}
 // An abstract radiator includes a thermal collector for its own/adjacent open cells.
 // Removed heat goes to an explicit space sink, independently of the electrical circuit.
 let remaining=def.cooling;
 for(const from of [c,cellAt(s,c.x,c.y+1),cellAt(s,c.x+1,c.y),cellAt(s,c.x-1,c.y),cellAt(s,c.x,c.y-1)]){
  if(!openCell(from))continue;
  const heat=Math.min(remaining,from.heat);if(heat<=1e-9)continue;
  from.heat-=heat;remaining-=heat;s.ledger.radiatedHeat+=heat;
  event(s,'heat.radiated',{from:from.id,entity:c.id,to:'space',heat});
 }
 c.powerStatus=remaining<def.cooling?'radiating':'idle';
}
function moveWater(s,a,b,n,cause='gravity'){
 if(!openCell(a)||!openCell(b))return;
 n=Math.max(0,Math.min(n,a.water,1-b.water));if(n<1e-9)return;
 const heat=a.heat/capacity(a)*n*4;a.water-=n;b.water+=n;a.heat-=heat;b.heat+=heat;
 event(s,'water.transferred',{from:a.id,to:b.id,amount:n,cause});
}
function moveGas(s,a,b,n,cause){
 if(!openCell(a)||!openCell(b))return;
 const total=gas(a);if(!total||n<=1e-9)return;const fraction=Math.min(1,n/total),heat=a.heat/capacity(a)*total*fraction,smoke=a.smoke*fraction;
 for(const k of GAS){const moved=a[k]*fraction;a[k]-=moved;b[k]+=moved;}
 a.smoke-=smoke;b.smoke+=smoke;a.heat-=heat;b.heat+=heat;event(s,'air.transferred',{from:a.id,to:b.id,amount:total*fraction,cause});
}
function ignite(s,c,cause){if(!openCell(c)||c.fire||c.fuel<=0||c.water>=.1||c.oxygen/Math.max(.05,1-c.water)<.12)return false;c.fire=true;event(s,'fire.ignited',{entity:c.id,cause});return true;}
function power(s){
 const previous=new Map(s.cells.map(c=>[c.id,c.powerStatus]));
 s.circuits=[];s.powerDirty=false;
 for(const c of s.cells){c.powered=false;c.short=false;c.circuit=null;c.powerStatus='unconnected';}
 const seen=new Set();
 for(const start of s.cells){
  if(start.wall||seen.has(start.id)||(!start.wire&&!start.device))continue;
  const group=[start];seen.add(start.id);
  for(let i=0;i<group.length;i++){const c=group[i];for(const [x,y]of [[c.x+1,c.y],[c.x-1,c.y],[c.x,c.y+1],[c.x,c.y-1]]){const n=cellAt(s,x,y);if(n&&!n.wall&&(n.wire||n.device)&&!seen.has(n.id)){seen.add(n.id);group.push(n);}}}
  const id=`circuit:${start.x}:${start.y}`;
  for(const c of group){c.circuit=id;c.powerStatus='connected';}
  let supply=0;
  for(const c of group){const d=c.device;if(!d)continue;
   if(!d.enabled){c.powerStatus='off';continue;}
   if(d.kind==='solar'){const output=daylight(s)?DEVICES.solar.supply:0;supply+=output;c.powered=output>0;c.powerStatus=output?'generating':'night';}
   else if(d.kind==='reactor')supply+=reactorPower(s,c);
   else if(d.kind==='generator'){const used=Math.min(.1,d.fuel);d.fuel-=used;supply+=used*160;c.powered=used>0;c.powerStatus=used?'generating':'fuel_empty';if(used)event(s,'generator.fuel.used',{entity:c.id,amount:used});}
   else c.powerStatus=d.kind==='battery'?'standby':'brownout';
  }
  const generated=supply,batteries=group.filter(c=>c.device?.enabled&&c.device.kind==='battery');
  const drawn=new Map(batteries.map(c=>[c.id,0]));
  const loads=group.flatMap(c=>[
   ...(c.wire&&c.water>.1?[{c,demand:5,short:true}]:[]),
   ...(c.device?.enabled&&DEVICES[c.device.kind].demand?[{c,demand:DEVICES[c.device.kind].demand}]:[])
  ]);
  const demand=loads.reduce((n,l)=>n+l.demand,0);let used=0,charged=0,discharged=0;
  for(const l of loads){
   const available=supply+batteries.reduce((n,c)=>n+Math.min(DEVICES.battery.rate-drawn.get(c.id),c.device.charge),0);
   if(available+1e-9<l.demand){if(l.short)l.c.powerStatus='wet_unpowered';continue;}
   // Draw only energy that an accepted load will actually consume. Never drain
   // and recharge the same battery merely because a larger load cannot start.
   let needed=Math.max(0,l.demand-supply);
   for(const c of batteries){const n=Math.min(DEVICES.battery.rate-drawn.get(c.id),c.device.charge,needed);c.device.charge-=n;drawn.set(c.id,drawn.get(c.id)+n);supply+=n;needed-=n;discharged+=n;}
   supply=Math.max(0,supply-l.demand);used+=l.demand;
   if(l.short){l.c.short=true;l.c.powerStatus='short';l.c.heat+=l.demand;s.ledger.heatMade+=l.demand;event(s,'electrical.short',{entity:l.c.id,energy:l.demand});}
   else {l.c.powered=true;if(!l.c.short)l.c.powerStatus='powered';}
  }
  for(const c of batteries){
   const n=drawn.get(c.id)?0:Math.min(DEVICES.battery.rate,DEVICES.battery.capacity-c.device.charge,supply);c.device.charge+=n;supply-=n;charged+=n;
   if(!c.short)c.powerStatus=drawn.get(c.id)?'discharging':n?'charging':c.device.charge>=DEVICES.battery.capacity?'full':'standby';c.powered=n>0||drawn.get(c.id)>0;
  }
  const report={id,tick:s.tick,cells:group.map(c=>c.id),generation:generated,demand,used,unmet:demand-used,charged,discharged,stored:group.filter(c=>c.device?.kind==='battery').reduce((n,c)=>n+c.device.charge,0),curtailed:supply};
  s.circuits.push(report);s.ledger.generated+=generated;s.ledger.used+=used;s.ledger.curtailed+=supply;
  event(s,'electrical.circuit',{entity:id,...report});
 }
 for(const c of s.cells){
  if(c.device?.kind==='radiator'&&c.device.enabled)radiate(s,c);
  if(previous.get(c.id)!==c.powerStatus)event(s,'electrical.status.changed',{entity:c.id,previous:previous.get(c.id),status:c.powerStatus,circuit:c.circuit});
  if(!c.powered)continue;const kind=c.device?.kind;
  if(kind==='heater'){c.heat+=4;s.ledger.heatMade+=4;}
  if(kind==='pump')moveWater(s,cellAt(s,c.x,c.y+1),cellAt(s,c.x,c.y-1),.5,'pump');
  if(kind==='fan'){const from=cellAt(s,c.x-1,c.y),to=cellAt(s,c.x+1,c.y);if(openCell(from)&&openCell(to))moveGas(s,from,to,.25,'fan');}
 }
}
export function stepElements(s,ticks=1){
 for(let i=0;i<ticks;i++){
  s.tick++;power(s);
  // Downward gravity, followed by equalization across each horizontal pair.
  for(let y=s.height-2;y>=0;y--)for(let ix=0;ix<s.width;ix++){const x=s.tick%2?ix:s.width-1-ix,a=cellAt(s,x,y);moveWater(s,a,cellAt(s,x,y+1),.35);if(x+1<s.width){const b=cellAt(s,x+1,y),diff=(a.water-b.water)*.25;if(diff>0)moveWater(s,a,b,diff,'level');else moveWater(s,b,a,-diff,'level');}}
  for(const a of s.cells)if(openCell(a))for(const b of [cellAt(s,a.x+1,a.y),cellAt(s,a.x,a.y+1)])if(openCell(b)){
   const va=Math.max(.05,1-a.water),vb=Math.max(.05,1-b.water),pa=pressure(a),pb=pressure(b);
   if(pa>pb)moveGas(s,a,b,(pa-pb)/(1/va+1/vb)*.25,'pressure');else moveGas(s,b,a,(pb-pa)/(1/va+1/vb)*.25,'pressure');
   // Species mix even when total pressures match. Equal/opposite swaps conserve gas.
   for(const k of [...GAS,'smoke']){const flow=(a[k]/va-b[k]/vb)/(1/va+1/vb)*.04;a[k]-=flow;b[k]+=flow;}
   const flow=((a.heat/capacity(a))-(b.heat/capacity(b)))/(1/capacity(a)+1/capacity(b))*.08;a.heat-=flow;b.heat+=flow;
  }
  for(const c of s.cells){
   if(c.wall)continue;
   if(temperature(c)>=70)ignite(s,c,c.short?'short':'heat');
   if(c.fire){
    const reason=c.water>=.1?'water':c.fuel<=1e-8?'fuel_exhausted':c.oxygen/Math.max(.05,1-c.water)<.12?'oxygen_starved':null;
    if(reason){c.fire=false;event(s,'fire.extinguished',{entity:c.id,reason});}
    else {const n=Math.min(.02,c.oxygen,c.fuel);c.fuel-=n;c.oxygen-=n;c.co2+=n;c.smoke+=n*.75;c.heat+=n*300;s.ledger.oxygenBurned+=n;s.ledger.fuelBurned+=n;s.ledger.smokeMade+=n*.75;s.ledger.heatMade+=n*300;event(s,'fire.burned',{entity:c.id,oxygen:n,fuel:n,smoke:n*.75,heat:n*300});}
   }
   if(c.vent&&openCell(c)){const amount=gas(c);s.ledger.ventedGas+=amount;s.ledger.ventedWater+=c.water;s.ledger.ventedSmoke+=c.smoke;s.ledger.ventedHeat+=c.heat;if(amount+c.water+c.smoke+c.heat>1e-9)event(s,'vacuum.vented',{entity:c.id,gas:amount,water:c.water,smoke:c.smoke,heat:c.heat});for(const k of [...GAS,'smoke','water','heat'])c[k]=0;}
  }
  record(s,{kind:'tick',state:observeElements(s)});
 }
 return s;
}
function setDoor(s,c,open,source){if(c.door.open!==open){c.door.open=open;s.powerDirty=true;event(s,'door.changed',{entity:c.id,open,source});}}
export function actElements(s,id,args={},source='agent'){
 if(!['player','agent','test','simulation'].includes(source))return {ok:false,message:'Invalid action source.'};
 if(!args||typeof args!=='object'||Array.isArray(args))return {ok:false,message:'Arguments must be an object.'};
 let raw;try{raw=JSON.stringify(args);}catch{return {ok:false,message:'Arguments must be JSON.'};}
 if(raw.length>8192)return {ok:false,message:'Action too large.'};
 args=JSON.parse(raw);
 record(s,{kind:'action.requested',source,id,args:clone(args),tick:s.tick});let result;
 if(id==='simulation.step'&&Number.isInteger(args.ticks)&&args.ticks>=1&&args.ticks<=240){stepElements(s,args.ticks);result={ok:true};}
 else if(id==='reactor.output'||id==='reactor.reset'){
  const c=cellAt(s,args.x,args.y),d=c?.device;
  if(d?.kind!=='reactor')result={ok:false,message:'Choose a reactor.'};
  else if(id==='reactor.output'){
   if(!Number.isInteger(args.percent)||args.percent<0||args.percent>100)result={ok:false,message:'Output must be a whole percent from 0 to 100.'};
   else {const previous=d.output;d.output=args.percent;s.powerDirty=true;if(previous!==d.output)event(s,'reactor.output.changed',{entity:c.id,previous,percent:d.output,source});result={ok:true};}
  }else if(!d.tripped)result={ok:false,message:'This reactor has not tripped.'};
  else if(temperature(c)>DEVICES.reactor.resetTemperature)result={ok:false,message:'Cool the reactor to 60°C or below before resetting.'};
  else {d.tripped=false;s.powerDirty=true;event(s,'reactor.reset',{entity:c.id,temperature:temperature(c),source});result={ok:true};}
 }
 else if(id==='door.set'){
  const c=cellAt(s,args.x,args.y);
  if(!c?.door||typeof args.open!=='boolean')result={ok:false,message:'Choose a door and its open state.'};
  else {setDoor(s,c,args.open,source);result={ok:true};}
 }
 else if(id==='cell.paint'){
  const c=cellAt(s,args.x,args.y),tool=args.tool;
  if(!c||!TOOLS.includes(tool))result={ok:false,message:'Choose a valid cell and tool.'};
  else if(tool==='toggle'&&!c.device&&!c.door)result={ok:false,message:'Select a door or electrical device to switch.'};
  else if(tool==='ignite'&&(c.fire||c.fuel<=0||c.water>=.1||c.oxygen/Math.max(.05,1-c.water)<.12))result={ok:false,message:'Ignition needs dry fuel and oxygen.'};
  else if(tool==='door'&&c.device)result={ok:false,message:'Remove the device before installing a door.'};
  else if(c.door&&!['erase','wall','door','toggle','wire'].includes(tool))result={ok:false,message:'Use a separate cell for materials and machinery.'};
  else if(c.wall&&!['erase','wall','door'].includes(tool))result={ok:false,message:'Erase the wall first.'};
  else {const before=clone(c);
   if(tool==='wall'){Object.assign(c,{wall:true,door:null,vent:false,water:0,oxygen:0,inert:0,co2:0,smoke:0,fuel:0,heat:0,fire:false,wire:false,device:null,powered:false,short:false});}
   if(tool==='erase')Object.assign(c,{wall:false,door:null,vent:false,wire:false,device:null,fire:false,fuel:0,powered:false,short:false});
   if(tool==='door'){c.wall=false;c.door={open:false};}
   if(tool==='air'){c.oxygen+=.21;c.inert+=.79;}
   if(tool==='vacuum'){for(const k of [...GAS,'smoke'])c[k]=0;}
   if(tool==='water')c.water=Math.min(1,c.water+.5);
   if(tool==='fuel')c.fuel+=1;
   if(tool==='ignite')ignite(s,c,source);
   if(tool==='vent')c.vent=true;if(tool==='seal')c.vent=false;
   if(tool==='wire')c.wire=true;
   if(DEVICES[tool])c.device=createDevice(tool);
   if(tool==='toggle'){if(c.door)setDoor(s,c,!c.door.open,source);else if(c.device)c.device.enabled=!c.device.enabled;}
   s.powerDirty=true;
   event(s,'cell.edited',{entity:c.id,tool,before,after:clone(c)});result={ok:true};
  }
 }else result={ok:false,message:'Unknown action or invalid arguments.'};
 record(s,{kind:'action.result',source,id,tick:s.tick,...result});return result;
}
export const ELEMENT_ACTIONS=[{id:'reactor.output',parameters:{x:'integer',y:'integer',percent:{type:'integer',minimum:0,maximum:100}}},{id:'reactor.reset',parameters:{x:'integer',y:'integer'}},{id:'door.set',parameters:{x:'integer',y:'integer',open:'boolean'}},{id:'cell.paint',parameters:{x:'integer',y:'integer',tool:TOOLS}},{id:'simulation.step',parameters:{ticks:{minimum:1,maximum:240}}}];
