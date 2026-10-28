import {BUILDINGS} from './data.js';
import {positionOf,tileAt} from './spatial.js';

export const isDay=s=>s.tick%300<220;
// The local sunlight model is a vertical column. Open void and utility overlays
// are transparent; terrain and intact structures block the nearest floor below.
export function solarExposure(site,tile) {
  const p=positionOf(tile);
  const levels=(site.levels||[{z:0}]).filter(level=>level.z>p.z).sort((a,b)=>a.z-b.z);
  for(const {z} of levels){
    const above=tileAt(site,{...p,z});
    if(above&&(above.terrain!=='void'||above.building&&above.hp>0))return {exposed:false,blockedBy:positionOf(above)};
  }
  return {exposed:true,blockedBy:null};
}
export function solarStatus(s,site,tile) {
  if(tile.building!=='solar')return null;
  const exposure=solarExposure(site,tile),daylight=isDay(s);
  const reason=tile.hp<=0?'damaged':tile.cable&&tile.cable.hp<=0?'cable_damaged':tile.cable&&!tile.cable.enabled?'cable_off':!daylight?'night':!exposure.exposed?'blocked':'generating';
  const status=reason==='damaged'?'Needs repair':reason==='cable_damaged'?'Needs cable repair':reason==='cable_off'?'Cable switched off':reason==='night'?'No sunlight':reason==='blocked'?`Blocked above · floor ${exposure.blockedBy.z}`:'Generating';
  return {daylight,...exposure,reason,output:reason==='generating'?BUILDINGS.solar.output*tile.hp/100:0,status};
}
