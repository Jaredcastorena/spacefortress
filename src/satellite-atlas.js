import { planetDefinitions, siteDefinition, planetSiteIds } from './region.js';
import { planetSurveyStatus, satelliteStatus } from './satellites.js';
import { WORLD_BIOMES, sectorEnvironment, surfaceSurvey } from './world-generation.js';
import { sectorWorld, sectorLanding } from './sector-sites.js';
import { surveyedSectorStatus } from './sector-travel.js';
import { preflightDetails } from './preflight-panels.js';
import { FLORA } from './flora-data.js';
import { temperatureAt } from './thermal.js';

const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>Math.round(v*10)/10;
const previewCache=new WeakMap();
function generatedSurvey(world,sector){
  if(!previewCache.has(world))previewCache.set(world,new Map());
  const cache=previewCache.get(world),key=`${sector.x},${sector.y}`;
  if(!cache.has(key))cache.set(key,surfaceSurvey(world,sector));
  return structuredClone(cache.get(key));
}
export function liveSurfaceSurvey(s,site){
  const tiles=site.tiles.filter(t=>(t.z??0)===0&&t.terrain!=='void'),biomes={},flora={},resources={ore:0,ice:0,water:0},wildlife={};
  let minimum=Infinity,maximum=-Infinity;
  for(const tile of tiles){
    if(tile.biome)biomes[tile.biome]=(biomes[tile.biome]||0)+1;
    for(const [species,patch] of Object.entries(tile.flora||{}))if(patch.biomass>0)flora[species]=(flora[species]||0)+1;
    if(!tile.building&&['ore','rock'].includes(tile.terrain))resources.ore+=tile.terrain==='ore'?5:2;
    if(tile.deposit&&tile.deposit.remaining>0)resources[tile.deposit.resource]=(resources[tile.deposit.resource]||0)+tile.deposit.remaining;
    resources.water+=tile.liquid||0;
    const temperature=temperatureAt(site,tile.x,tile.y,0);minimum=Math.min(minimum,temperature);maximum=Math.max(maximum,temperature);
  }
  for(const animal of s.creatures||[])if(animal.site===site.id&&(animal.z??0)===0&&animal.health>0)wildlife[animal.species]=(wildlife[animal.species]||0)+1;
  return {size:site.size,tiles:tiles.length,biomes,flora,resources,temperature:{min:minimum,max:maximum},wildlife};
}
// This is the sole atlas accessor. Locked planets never return generated sectors
// or previews, and the cache never owns or changes physical colony state.
export function planetAtlasData(s,planetId,selection=null){
  const status=planetSurveyStatus(s,planetId),planet=planetDefinitions(s)[planetId];
  if(!status.unlocked)return {...status,available:false};
  if(!planet)return {...status,available:false};
  const world=sectorWorld(s,planetId),requested=selection||world.landing;
  const selected=Number.isInteger(requested.x)&&Number.isInteger(requested.y)&&requested.x>=0&&requested.x<world.width&&requested.y>=0&&requested.y<world.height?{x:requested.x,y:requested.y}:{...world.landing};
  const sectors=[];
  for(let y=0;y<world.height;y++)for(let x=0;x<world.width;x++)sectors.push(sectorEnvironment(world,x,y));
  const siteId=sectorLanding(s,planetId,selected.x,selected.y),site=siteId?s.sites[siteId]:null;
  const prepared=!!site&&siteDefinition(s,siteId)?.template==='sector'&&!site.explored,live=!!site&&!prepared;
  return {...status,available:true,legacy:!planet.world,landing:{...world.landing},width:world.width,height:world.height,sectors,selected,environment:sectorEnvironment(world,selected.x,selected.y),site:siteId,live,prepared,survey:live?liveSurfaceSurvey(s,site):generatedSurvey(world,selected)};
}
export function satelliteLaunchDetails(s,site,tile){
  if(!site||!tile||!['shuttle','dock'].includes(tile.building))return '';
  const status=satelliteStatus(s,site,tile);
  return `<details data-panel-key="satellite-launch-${esc(site.id)}"><summary>Survey satellite${status.unlocked?' · in orbit':status.pendingJob?' · assembly pending':''}</summary><p>${esc(status.message)}</p>${status.unlocked?'':`<p>Requires ${Object.entries(status.cost).map(([r,n])=>`${n} ${esc(r)}`).join(' · ')}. Crew must deliver these supplies and complete ${status.work} engineering work before the surface survey opens.</p><button data-action="satellite-launch" data-simulation-action="satellite.launch" data-site="${esc(site.id)}" data-x="${tile.x}" data-y="${tile.y}" data-z="${tile.z??0}" ${status.ready?'':'disabled'}>Assemble &amp; launch satellite</button>`}<button data-action="inspect-planet" data-ui-action="region.planet" data-planet="${esc(status.planetId)}">View planet surface survey</button></details>`;
}
function launchForPlanet(s,planetId){
  for(const id of planetSiteIds(s,planetId)){
    const site=s.sites[id],tile=site?.tiles.find(t=>(t.z??0)===0&&(id==='surface'?t.building==='shuttle':siteDefinition(s,id)?.template==='outcrop'&&t.building==='dock'));
    if(tile)return satelliteLaunchDetails(s,site,tile);
  }
  return '<p>A settled planetary launch site is required.</p>';
}
const animalName=id=>({bristleback:'Bristlebacks',glazefoot:'Glazefeet',tibble:'Tibbles'}[id]||id);
const counts=(values,name)=>Object.entries(values).filter(([,n])=>n>0).map(([id,n])=>`${esc(name(id))}: ${number(n)}`).join(' · ')||'None detected';
export function surveyedSectorDetails(s,planetId,x,y){
  const status=surveyedSectorStatus(s,planetId,x,y);
  if(status.siteId==='surface')return '';
  const route=status.route,kit=Object.entries(status.kit||{}).filter(([,amount])=>amount>0);
  return `<details data-panel-key="sector-expedition-${esc(planetId)}-${x}-${y}"><summary>Expedition from home</summary><p>${esc(status.message)}</p>${route?`<dl><dt>Round-trip fuel</dt><dd>${number(route.fuel)} units</dd><dt>Travel per leg</dt><dd>${number(route.travel)} ticks</dd><dt>First-landing kit</dt><dd>${kit.length?kit.map(([resource,amount])=>`${number(amount)} ${esc(resource)}`).join(' · '):'No additional kit'}</dd></dl>${kit.length?'<p>The kit must be loaded aboard. First arrival consumes it to deploy an empty dock.</p>':''}<p>The standard eligible expedition crew is selected automatically. Crew must load finite service supplies and reach the home shuttle before liftoff.</p><button data-action="sector-launch" data-simulation-action="expedition.surveyed" data-planet="${esc(planetId)}" data-x="${x}" data-y="${y}" ${status.ok?'':'disabled'}>Prepare expedition</button>`:''}${status.siteId?preflightDetails(s,status.siteId):''}</details>`;
}
export function planetaryAtlas(s,planetId,selection=null){
  const atlas=planetAtlasData(s,planetId,selection),launch=launchForPlanet(s,planetId);
  if(!atlas.unlocked)return `<details data-panel-key="planet-atlas-${esc(planetId)}"><summary>Surface survey · satellite required</summary><p>Launch a supplied survey satellite from this planet to reveal its surface biomes, life and finite resources.</p>${launch}</details>`;
  if(!atlas.available)return '';
  const {selected,survey}=atlas,cell=12,rise=Math.sqrt(3)*cell,viewWidth=(atlas.width-1)*cell*1.5+cell*2,viewHeight=(atlas.height+.5)*rise;
  const cells=atlas.sectors.map(sector=>{
    const cx=cell+sector.x*cell*1.5,cy=rise/2+(sector.y+(sector.x%2)/2)*rise,active=sector.x===selected.x&&sector.y===selected.y;
    const known=sectorLanding(s,planetId,sector.x,sector.y),visited=known&&(known==='surface'||s.sites[known]?.explored);
    const points=Array.from({length:6},(_,i)=>`${cx+Math.cos(i*Math.PI/3)*cell},${cy+Math.sin(i*Math.PI/3)*cell}`).join(' ');
    return `<g role="button" tabindex="${active?0:-1}" aria-label="Sector ${sector.x}, ${sector.y}: ${esc(sector.name)}" aria-pressed="${active}" data-action="atlas-sector" data-ui-action="planet.sector" data-entity="sector:${esc(planetId)}:${sector.x}:${sector.y}" data-planet="${esc(planetId)}" data-x="${sector.x}" data-y="${sector.y}" style="cursor:pointer"><title>${esc(sector.name)} · ${sector.x}, ${sector.y}</title><polygon points="${points}" fill="${sector.color}" stroke="${active?'#fff0c2':'#172936'}" stroke-width="${active?2.5:.8}"/>${known?`<circle cx="${cx}" cy="${cy}" r="3" fill="${visited?'#fff0c2':'none'}" stroke="#fff0c2" stroke-width="1.2" pointer-events="none"/>`:''}</g>`;
  }).join('');
  return `<details data-panel-key="planet-atlas-${esc(planetId)}"><summary>Surface survey · satellite in orbit</summary><p>Select a hex sector, or use arrow keys on the map. Dots mark visited landings; rings mark prepared or known landings.</p><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" role="group" aria-label="Planetary surface sectors" style="display:block;width:100%;margin:12px 0">${cells}</svg>${atlas.legacy?'<p>The known landing preserves your existing colony map. Other sectors show a newly derived orbital survey.</p>':''}<div data-entity="sector:${esc(planetId)}:${selected.x}:${selected.y}" data-atlas-selection data-atlas-status="${atlas.prepared?'prepared':atlas.live?'live':'survey'}"><h3>${esc(atlas.environment.name)} · ${selected.x}, ${selected.y}</h3><p>${atlas.prepared?'Prepared destination · not yet visited':atlas.live?'Known landing · current ground map':'Unvisited sector · initial survey only'} · ${survey.size} × ${survey.size} tiles</p><dl><dt>Biomes</dt><dd>${counts(survey.biomes,id=>WORLD_BIOMES[id]?.name||id)}</dd><dt>Ore remaining</dt><dd>${number(survey.resources.ore)} units</dd><dt>Ice remaining</dt><dd>${number(survey.resources.ice)} units</dd><dt>Surface liquid water</dt><dd>${number(survey.resources.water)} units</dd><dt>Living plant patches</dt><dd>${counts(survey.flora,id=>FLORA[id]?.name||id)}</dd><dt>Life detected</dt><dd>${counts(survey.wildlife,animalName)}</dd><dt>${atlas.live?'Current ground temperature':'Night / day envelope'}</dt><dd>${number(survey.temperature.min)} to ${number(survey.temperature.max)}°C</dd></dl>${atlas.live?`<p>These readings follow the existing map, including extraction, water movement and living populations. Stored supplies are excluded.</p><button data-action="inspect-site" data-ui-action="site.inspect" data-site="${esc(atlas.site)}">Open ${esc(siteDefinition(s,atlas.site).name)} map</button>`:atlas.prepared?'<p>This destination is prepared for an expedition. The readings remain initial orbital estimates until the first arrival; a dock still requires the supplied landing kit.</p>':'<p>Initial amounts come from this sector’s terrain generation. Prepare a supplied expedition to establish a landing here.</p>'}${surveyedSectorDetails(s,planetId,selected.x,selected.y)}</div></details>`;
}
export function naturalTileDetails(tile){
  return tile?.biome?`<dt>Biome</dt><dd>${esc(WORLD_BIOMES[tile.biome]?.name||tile.biome)}</dd><dt>Local exterior offset</dt><dd>${tile.temperatureOffset>0?'+':''}${tile.temperatureOffset??0}°C</dd>`:'';
}
