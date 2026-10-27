import { createGame, at } from '../../src/simulation.js';
import { extract, syncResources } from '../../src/inventory.js';

// Explicit synthetic current-hex mission boundary, never imported from old
// square saves. Every remote supply and salvage parcel moves from finite home
// stock. This is fixture setup, not proof of paid launch or remote mining.
export function currentOutpost(phase='working-pile') {
  const s=createGame(37042),stock=at(s.sites.surface,8,10).stock;
  const crew=['crew-4','crew-2'];
  const missionPhase=phase==='outbound'?'outbound':phase==='returning'?'returning':'working';
  s.shuttle.supplies=extract(stock,{fuel:1,air:9});
  s.mission={site:'wreck',phase:missionPhase,remaining:missionPhase==='working'?0:22,fit:'standard',capacity:18,legacyCapacity:false,crew,returnCrew:[...crew],cargo:{},collector:false,heat:0,returnFuel:missionPhase==='returning'?0:1,kitReserved:false};
  const carrier=s.crew.find(c=>c.id==='crew-4'),partner=s.crew.find(c=>c.id==='crew-2');
  Object.assign(carrier,{site:missionPhase==='working'?'wreck':'transit',x:4,y:10});
  Object.assign(partner,{site:missionPhase==='working'?'wreck':'transit',x:7,y:10});
  const pile=at(s.sites.wreck,8,10);pile.building=null;
  if(phase!=='outbound') {
    const components=extract(stock,{components:3}),alloy=extract(stock,{alloy:2});
    pile.drop=phase==='working-pile'?{...components,...alloy}:alloy;
    if(phase==='working-carried')Object.assign(carrier,{x:8,y:10,carry:components,delivery:{kind:'shuttle',target: { x: 4, y: 11, z: 0 }}});
    if(['working-cargo','returning'].includes(phase))s.mission.cargo=components;
  }
  syncResources(s);return s;
}
