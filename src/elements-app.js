import {demoElements,reactorDemoElements,TOOLS,DEVICES,cellAt,gas,pressure,temperature,daylight,observeElements,actElements,ELEMENT_ACTIONS,recordingStart,recordingStop,recordingStatus,recordingExport} from './elements.js';
const $=id=>document.getElementById(id),canvas=$('elements'),ctx=canvas.getContext('2d');
let state=demoElements(),tool='erase',running=false,selected=null,view='materials',painting=false,lastPaint=null;
const labels={wall:'Wall',door:'Door',erase:'Erase / breach',air:'Air',vacuum:'Empty air',water:'Water',fuel:'Fuel',ignite:'Ignite',vent:'Vacuum vent',seal:'Seal vent',wire:'Wire',solar:'Solar',generator:'Generator',reactor:'Reactor',radiator:'Radiator',battery:'Battery',pump:'Pump ↑',fan:'Fan →',heater:'Heater',toggle:'Switch'};
const hints={door:'Install a closed manual door, including in an existing wall. Switch opens it; closed doors retain contents and block air, water and heat.',wire:'Exposed wires connect orthogonally. Wet wiring draws fault current and heats up.',solar:'Solar produces 12 power in daylight; darkness begins at tick 160 of each 240-tick cycle.',generator:'A compact generator supplies 16 power per tick from a finite 20-unit fuel charge.',reactor:'A reactor supplies up to 40 power, burns finite fuel and makes waste heat. Inspect to set output. At 120°C it trips; cool to 60°C before resetting.',radiator:'A passive radiator rejects up to 32 heat from its cell and open neighbors per tick. It needs near-vacuum (pressure ≤ 0.05); air blocks cooling.',battery:'A battery stores 100 energy, charging or discharging up to 8 per tick.',pump:'A powered pump uses 3 power to lift water from the cell below into the cell above.',fan:'A powered fan uses 2 power to transfer air from its left cell to its right cell.',heater:'A powered heater uses 4 power to create heat. Hot fuel can ignite.',water:'Water falls, levels out, cools hot cells, and suppresses flame above 0.1 depth.',fuel:'Add combustible fuel. Ignition requires oxygen; fuel alone does not create a fire.',vacuum:'Remove the gas here once. A vent continually drains material to space.',vent:'An open connection to space drains arriving air, water, smoke and heat.',seal:'Close a vacuum outlet without building a solid wall.',ignite:'Ignite fuel where oxygen is available and water depth is below 0.1.',air:'Add one unit of breathing mix: 21% oxygen, 79% inert gas.',wall:'Build an impermeable wall. Existing contents and equipment are removed as a recorded edit.',erase:'Remove a wall or equipment to open a breach. Existing gas and water remain.',toggle:'Open or close a door, or switch an electrical device on/off.'};
$('tools').innerHTML=TOOLS.map(t=>`<button data-tool="${t}" data-simulation-action="cell.paint" aria-pressed="${t===tool}" class="${t===tool?'active':''}">${labels[t]}</button>`).join('');
$('tools').onclick=e=>{if(!e.target.dataset.tool)return;tool=e.target.dataset.tool;document.querySelectorAll('[data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));});$('hint').textContent=hints[tool];};
function act(id,args,source='player'){const r=actElements(state,id,args,source);if(!r.ok)$('hint').textContent=r.message;draw();return r;}
window.elementsLab=Object.freeze({actions:()=>structuredClone(ELEMENT_ACTIONS),definitions:()=>structuredClone({devices:DEVICES,tools:TOOLS}),observe:()=>observeElements(state),act:(id,args)=>{running=false;return act(id,args,'agent');},recording:{start:()=>recordingStart(state),stop:()=>recordingStop(state),status:()=>recordingStatus(state),export:()=>recordingExport(state)}});
const views=['materials','pressure','temperature','power'];
const legends={materials:'Materials · Gravity ↓ · Fan → · Pump ↑ · Map edges vent to space.',pressure:'Pressure · dark = vacuum · blue = 1 nominal · gold = 3+ compressed.',temperature:'Temperature · blue = 20°C · orange = 70°C ignition threshold · bright = 200°C+.',power:'Power · green = active · amber = blocked / tripped · red = short · gray = idle. Inspect a wire for its circuit.'};
$('view').onclick=()=>{view=views[(views.indexOf(view)+1)%views.length];draw();};
$('device-control').onclick=()=>{const c=state.cells.find(c=>c.id===selected);if(c?.device)act('cell.paint',{x:c.x,y:c.y,tool:'toggle'});};
$('reactor-output').onchange=()=>{const c=state.cells.find(c=>c.id===selected);if(c?.device?.kind==='reactor')act('reactor.output',{x:c.x,y:c.y,percent:Number($('reactor-output').value)});};
$('reactor-reset').onclick=()=>{const c=state.cells.find(c=>c.id===selected);if(c?.device?.kind==='reactor')act('reactor.reset',{x:c.x,y:c.y});};
$('door-control').onclick=()=>{const c=state.cells.find(c=>c.id===selected);if(c?.door)act('door.set',{x:c.x,y:c.y,open:!c.door.open});};
$('play').onclick=()=>{running=!running;draw();};$('step').onclick=()=>{running=false;act('simulation.step',{ticks:1});};
function resetDemo(){state=$('scenario').value==='reactor'?reactorDemoElements():demoElements();running=false;selected=null;$('hint').textContent=$('scenario').value==='reactor'?'Vacuum power bay: reactor R, radiator fins above it, battery B. Inspect the radiator and switch it off to test overheating. Resetting clears the local recording.':'Fresh chamber. Previous lab recording cleared; colony save untouched.';draw();}
$('reset').onclick=resetDemo;$('scenario').onchange=resetDemo;
$('details-toggle').onclick=()=>{$('details').hidden=!$('details').hidden;$('details-toggle').setAttribute('aria-expanded',String(!$('details').hidden));draw();};
$('record').onclick=()=>{recordingStatus(state).active?recordingStop(state):recordingStart(state);draw();};
$('export').onclick=()=>{const data=recordingExport(state);if(!data){$('hint').textContent='Start a local recording first.';return;}const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type:'application/x-ndjson'}));a.href=url;a.download='spacefortress-elements.ndjson';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function point(e){const r=canvas.getBoundingClientRect();return {x:Math.floor((e.clientX-r.left)/r.width*state.width),y:Math.floor((e.clientY-r.top)/r.height*state.height)};}
function paint(e){const p=point(e),c=cellAt(state,p.x,p.y);if(!c)return;selected=c.id;if(lastPaint===c.id)return;lastPaint=c.id;act('cell.paint',{...p,tool});}
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);painting=true;lastPaint=null;paint(e);};canvas.onpointermove=e=>{if(painting)paint(e);else{const p=point(e);selected=cellAt(state,p.x,p.y)?.id||null;draw();}};canvas.onpointerup=()=>{painting=false;lastPaint=null;};canvas.onpointercancel=()=>{painting=false;lastPaint=null;};
const icons={solar:'☀',generator:'G',reactor:'R',radiator:'≡',battery:'B',pump:'↑',fan:'→',heater:'H'};
function fieldColor(c){
 if(c.wall)return '#526b77';
 if(view==='pressure'){const p=Math.min(3,pressure(c));return `hsl(${p<=1?210:210-(p-1)*85} 50% ${7+p/3*48}%)`;}
 if(view==='temperature'){const t=Math.min(1,Math.max(0,(temperature(c)-20)/180));return `rgb(${35+Math.round(t*220)},${65+Math.round(t*45)},${90-Math.round(t*55)})`;}
 if(view==='power')return c.short?'#b74035':c.powered||c.powerStatus==='radiating'?'#286d54':['brownout','wet_unpowered','tripped','atmosphere_blocked'].includes(c.powerStatus)?'#79582f':c.wire||c.device?'#354351':'#0a1720';
 const p=Math.min(1.5,pressure(c));return `rgb(${9+Math.round(p*10)},${19+Math.round(p*20)},${28+Math.round(p*25)})`;
}
function draw(){
 const size=24;canvas.width=state.width*size;canvas.height=state.height*size;
 for(const c of state.cells){const x=c.x*size,y=c.y*size;ctx.fillStyle=fieldColor(c);ctx.fillRect(x,y,size,size);ctx.strokeStyle='#21303966';ctx.strokeRect(x,y,size,size);
  if(view==='materials'&&c.heat>1){ctx.fillStyle=`rgba(235,106,43,${Math.min(.65,c.heat/200)})`;ctx.fillRect(x,y,size,size);}
  if(view==='materials'&&c.smoke>.001){ctx.fillStyle=`rgba(163,151,140,${Math.min(.7,c.smoke*3)})`;ctx.fillRect(x+2,y+2,size-4,size-4);}
  if(c.water>0){ctx.fillStyle='#469fdbbb';const h=c.water*(view==='materials'?size:4);ctx.fillRect(x+1,y+size-h,size-2,h);}
  if(c.fuel>0){ctx.fillStyle='#b89368';ctx.fillRect(x+5,y+size-6,size-10,4);}
  if(c.wire){ctx.strokeStyle=c.short?'#ff8652':'#d0b775';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+2,y+size/2);ctx.lineTo(x+size-2,y+size/2);ctx.moveTo(x+size/2,y+2);ctx.lineTo(x+size/2,y+size-2);ctx.stroke();}
  if(c.device){ctx.fillStyle=c.powered?'#356c62':c.device.enabled?'#213e4c':'#262a32';ctx.fillRect(x+3,y+3,size-6,size-6);ctx.fillStyle=c.powered?'#bcf7d1':'#b5cdd1';ctx.font='bold 15px monospace';ctx.textAlign='center';ctx.fillText(icons[c.device.kind],x+size/2,y+17);if(c.device.kind==='reactor'){ctx.strokeStyle=c.device.tripped?'#ff8652':'#c8a4ed';ctx.lineWidth=2;ctx.strokeRect(x+4,y+4,size-8,size-8);}if(c.device.kind==='battery'){ctx.fillStyle='#91ddc3';ctx.fillRect(x+3,y+size-4,(size-6)*c.device.charge/100,2);}}
  if(c.door){ctx.fillStyle='#87b8bb';ctx.fillRect(x+2,y+2,3,size-4);ctx.fillRect(x+size-5,y+2,3,size-4);if(!c.door.open){ctx.fillStyle='#3c737e';ctx.fillRect(x+6,y+2,size-12,size-4);ctx.fillStyle='#d6b275';ctx.fillRect(x+11,y+9,2,6);}}
  if(c.fire){ctx.fillStyle='#f4963e';ctx.beginPath();ctx.moveTo(x+4,y+21);ctx.lineTo(x+10,y+3);ctx.lineTo(x+13,y+12);ctx.lineTo(x+20,y+5);ctx.lineTo(x+20,y+21);ctx.fill();}
  if(c.vent&&!c.wall){ctx.strokeStyle='#b080c966';ctx.beginPath();ctx.moveTo(x+7,y+7);ctx.lineTo(x+17,y+17);ctx.moveTo(x+17,y+7);ctx.lineTo(x+7,y+17);ctx.stroke();}
  if(c.id===selected){ctx.strokeStyle='#c2f5df';ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,size-2,size-2);}
 }
 $('view').textContent=`View: ${view[0].toUpperCase()+view.slice(1)}`;$('view').dataset.view=view;$('legend').textContent=legends[view];
 $('play').textContent=running?'Pause':'Run';$('status').textContent=`${running?'Running':'Paused'} · ${daylight(state)?'Daylight':'Night'} · tick ${state.tick}`;
 const c=state.cells.find(c=>c.id===selected);$('door-control').hidden=!c?.door;$('door-control').textContent=c?.door?.open?'Close door':'Open door';$('door-control').setAttribute('aria-pressed',String(!!c?.door?.open));$('inspector').dataset.entity=c?.id||'';$('inspector').textContent=c?`${c.id}\nPressure  ${pressure(c).toFixed(3)}\nOxygen    ${c.oxygen.toFixed(3)}\nCO₂       ${c.co2.toFixed(3)}\nWater     ${c.water.toFixed(3)}\nSmoke     ${c.smoke.toFixed(3)}\nHeat      ${temperature(c).toFixed(1)} °C\nFuel      ${c.fuel.toFixed(2)}\n${c.door?`Door: ${c.door.open?'open':'sealed'}\n`:''}${c.device?`${c.device.kind}: ${c.device.enabled?'enabled':'off'}\nPower: ${c.powerStatus.replaceAll('_',' ')}${c.device.kind==='battery'?`\nCharge: ${c.device.charge.toFixed(1)}`:''}${['generator','reactor'].includes(c.device.kind)?`\nFuel remaining: ${c.device.fuel.toFixed(3)}`:''}${c.device.kind==='reactor'?`\nSpent fuel: ${c.device.waste.toFixed(3)}\nOutput: ${c.device.output}%\nShutdown: ${c.device.tripped?'latched — cool to 60°C, then reset':'armed at 120°C'}`:''}`:''}`:'Point at a cell to inspect it.';
 $('device-control').hidden=!c?.device;$('device-control').setAttribute('aria-pressed',String(!!c?.device?.enabled));$('device-control').textContent=c?.device?.enabled?'Switch device off':'Switch device on';
 $('reactor-controls').hidden=c?.device?.kind!=='reactor';
 if(c?.device?.kind==='reactor'){
  if(document.activeElement!==$('reactor-output'))$('reactor-output').value=String(c.device.output);
  $('reactor-reset').disabled=!c.device.tripped||temperature(c)>DEVICES.reactor.resetTemperature;
 }
 const circuit=c?.circuit&&state.circuits.find(n=>n.id===c.circuit);
 $('circuit').textContent=circuit?`${circuit.id} · tick ${circuit.tick}
Generation ${circuit.generation.toFixed(1)}
Demand     ${circuit.demand.toFixed(1)}
Supplied   ${circuit.used.toFixed(1)}
Unmet      ${circuit.unmet.toFixed(1)}
Stored     ${circuit.stored.toFixed(1)}
Charge / discharge  +${circuit.charged.toFixed(1)} / −${circuit.discharged.toFixed(1)}
Curtailed  ${circuit.curtailed.toFixed(1)}${state.powerDirty?'\nEdited: step to recalculate.':''}`:state.powerDirty?'Step to calculate circuit conditions.':'Select a wire or device to inspect its circuit.';
 const r=recordingStatus(state);$('record').textContent=r.active?'Stop recording':'Start new recording';$('record-status').textContent=`${r.active?'Recording':r.reason} · ${r.records} records · local only`;
 $('events').textContent=state.events.slice(-9).reverse().map(e=>`${e.tick}: ${e.id}\n${e.entity||e.from||''}`).join('\n')+`\n\nHistory omitted: ${state.eventsDropped} older events. Recording captures events until its explicit limit.`;
}
window.addEventListener('error',e=>{running=false;document.body.dataset.runtimeError=e.message;});
setInterval(()=>{if(running)act('simulation.step',{ticks:1},'simulation');},125);draw();
