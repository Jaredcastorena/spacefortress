import { BUILDINGS } from './data.js';
import { WATER_DIRECTIONS, waterNode, waterCapacity, plumbingStatus } from './plumbing.js';

const directions={east:'East ↘',south:'South ↙',west:'West ↖',north:'North ↗'};
const slots={'machine.input':'delivered supply','machine.output':'finished output',waterPipe:'water pipe',waterStore:'reservoir',liquid:'floor water'};
const amount=n=>Number.isFinite(n)?n.toFixed(3):'—';
function endpoint(site,id,slot){
  if(!id)return 'Outside region';
  const [x,y]=id.split(':').slice(-2).map(Number),t=site.tiles[y*site.size+x];
  return `${BUILDINGS[t?.building]?.name||'Tile'} ${x}/${y}${slot?` · ${slots[slot]||slot}`:''}`;
}
export function plumbingDetails(s,site,t){
  const node=waterNode(t),device=t.waterDevice;if(!node&&!device)return '';
  const info=plumbingStatus(s,site,t),condition=t.waterPipe?t.waterPipe.hp:t.hp;
  let html=`<hr><section data-plumbing-panel><div class="eyebrow">WATER NETWORK</div><p data-plumbing-status data-blocked-code="${info.blockedCode||''}">${info.status}</p>`;
  if(node){
    html+=`<dl><dt>Stored water</dt><dd data-plumbing-amount>${amount(node.water)} / ${waterCapacity(t)} units</dd><dt>Fill</dt><dd>${(node.water/waterCapacity(t)*100).toFixed(1)}%</dd><dt>${t.waterPipe?'Pipe':'Reservoir'} condition</dt><dd>${condition.toFixed(1)}%</dd><dt>Port valve</dt><dd>${node.open?'Open':'Closed — ports isolated'}</dd></dl><button data-action="plumbing-valve" aria-pressed="${node.open}">${node.open?'Close water valve':'Open water valve'}</button>`;
    if(t.waterPipe)html+=`${condition<100?'<button data-action="repairWaterPipe">Repair water pipe · 1 alloy</button>':''}<button data-action="removeWaterPipe">Dismantle water pipe</button><p class="crew-hint">Open neighboring pipes and reservoirs level their fill. Damage below 50% leaks onto open floor even with the valve closed. Crew recover remaining water when dismantling this pipe.</p>`;
    else html+='<p class="crew-hint">This passive reservoir starts empty and holds 32 water. Connect pipes or directional devices to fill it. Closing its valve traps the contents; damage can still leak.</p>';
  }
  if(device){
    const kind=t.building==='waterPump'?'pump':t.building==='waterIntake'?'intake':'outlet',adapter=kind!=='pump';
    html+=`<dl><dt>Condition</dt><dd>${condition.toFixed(1)}%</dd><dt>Source → destination</dt><dd>${directions[device.direction]}</dd>${adapter?`<dt>${kind==='intake'?'Collect from':'Deliver to'}</dt><dd>${device.mode==='floor'?'Adjacent floor':'Adjacent machine'}</dd>`:''}</dl><div class="job-priority" aria-label="Water ${kind} direction">${Object.keys(WATER_DIRECTIONS).map(direction=>`<button data-action="plumbing-direction" data-direction="${direction}" aria-pressed="${direction===device.direction}">${directions[direction]}</button>`).join('')}</div>${adapter?`<div class="job-priority" aria-label="Water ${kind} mode"><button data-action="plumbing-mode" data-water-mode="inventory" aria-pressed="${device.mode==='inventory'}">Machine</button><button data-action="plumbing-mode" data-water-mode="floor" aria-pressed="${device.mode==='floor'}">Floor</button></div>`:''}<button data-action="plumbing-toggle" aria-pressed="${device.enabled}">${device.enabled?'Disable':'Enable'} water ${kind}</button><details data-plumbing-endpoints><summary>Source and destination</summary><dl><dt>Source</dt><dd data-plumbing-source>${endpoint(site,info.input,info.inputSlot)}</dd><dt>Source water</dt><dd>${amount(info.sourceWater)} units</dd>${kind==='intake'?`<dt>Claimed by haulers</dt><dd data-plumbing-source-reserved>${amount(info.reservedOutput)} units</dd><dt>Available to intake</dt><dd>${amount(info.sourceAvailable)} units</dd>`:''}<dt>Destination</dt><dd data-plumbing-target>${endpoint(site,info.output,info.outputSlot)}</dd><dt>Destination water</dt><dd>${amount(info.targetWater)} / ${amount(info.targetCapacity)} units</dd>${kind==='outlet'?`<dt>Incoming shipments</dt><dd data-plumbing-target-reserved>${amount(info.reservedInput)} units</dd><dt>Free for outlet</dt><dd>${amount(info.targetFree)} units</dd>`:''}</dl></details><p class="crew-hint">The arrow points from the source behind to the destination ahead. Side neighbors do not connect. Powered transfer moves up to 0.5 water per tick, scaled by condition. ${kind==='pump'?'Pumps move between two pipe or reservoir nodes.':kind==='intake'?'Machine mode takes unclaimed water from a supply tank or finished producer output. Floor mode collects only the tile behind.':'Machine mode fills an enabled water consumer while leaving room for incoming shipments. Floor mode releases onto only the tile ahead; wet cables can fault on the next tick.'}</p>`;
  }
  return html+'<p class="crew-hint">Supply tank → intake → pipes → pump → reservoir → outlet → consumer. Water view traces this route; Power view shows device wiring.</p></section>';
}
