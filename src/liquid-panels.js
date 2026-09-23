export function liquidDetails(t){
 const wet=t.liquid>1e-8;
 if(!wet&&!['waterTank','bilgePump'].includes(t.building))return '';
 let html=`<hr><div class="eyebrow">WATER</div><dl><dt>Floor water</dt><dd>${t.liquid.toFixed(3)} / 4 units</dd>${t.wetShort?'<dt>Electrical fault</dt><dd>Wet cable drawing fault power</dd>':''}</dl>`;
 if(t.building==='waterTank')html+=`<dl><dt>Tank supply</dt><dd>${(t.machine.input.water||0).toFixed(2)} / 8 water</dd><dt>Condition</dt><dd>${t.hp<50?'Leaking — repair the tank':'Sealed'}</dd></dl><button data-action="tank-fill" aria-pressed="${t.machine.enabled}">${t.machine.enabled?'Stop refilling':'Allow refilling'}</button><button data-action="tank-drain" aria-pressed="${t.tank.drain}">${t.tank.drain?'Close drain valve':'Open drain valve'}</button><p class="crew-hint">Haulers fill from existing depot water. The drain releases 0.5 water per tick. Damage below 50% leaks with the valve closed. Turning off refilling does not stop a leak.</p>`;
 if(t.building==='bilgePump')html+=`<p>${t.machine.status}</p><dl><dt>Recovered water</dt><dd>${(t.machine.output.water||0).toFixed(2)} / 12</dd></dl><button data-action="machine" aria-pressed="${t.machine.enabled}">${t.machine.enabled?'Pause recovery pump':'Enable recovery pump'}</button><p class="crew-hint">Powered intake collects up to 0.5 water per tick from this tile and open neighbors. Haulers must empty the output. Closed doors block intake. Recovered water uses the current abstract water resource.</p>`;
 if(wet)html+='<p class="crew-hint">Water levels across this floor. Close pressure doors to contain it. Isolate wet cables before repairing them. Ground drainage and open space can permanently lose spilled water.</p>';
 return html;
}
