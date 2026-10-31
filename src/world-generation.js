import { neighbors } from './hex.js';

// Pure, versioned natural-world generation. Never read or advance colony RNG.
export const WORLD_BIOMES = Object.freeze({
  lichen_plain: Object.freeze({name:'Lichen plain',color:'#8b9863',temperatureOffset:0}),
  fungal_grove: Object.freeze({name:'Fungal grove',color:'#8b7892',temperatureOffset:-5}),
  sunberry_scrub: Object.freeze({name:'Sunberry scrub',color:'#b39754',temperatureOffset:8}),
  ice_barrens: Object.freeze({name:'Ice barrens',color:'#91b7c9',temperatureOffset:-20}),
  water_basin: Object.freeze({name:'Water basin',color:'#558d9a',temperatureOffset:-2}),
});
const biomeIds=Object.keys(WORLD_BIOMES);
const hash=(...parts)=>{
  let value=2166136261;
  for(const character of parts.join(':'))value=Math.imul(value^character.charCodeAt(0),16777619);
  return (value>>>0)||1;
};
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
const validSector=(world,p)=>!!p&&Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=0&&p.x<world.width&&p.y>=0&&p.y<world.height;
function checkWorld(world){
  if(!world||world.schema!==1||!Number.isInteger(world.seed)||world.seed<1||world.seed>0xffffffff||world.width!==24||world.height!==12||!validSector(world,world.landing))throw new Error('Invalid planetary environment.');
}
function checkSize(size){if(!Number.isInteger(size)||size<18||size>64)throw new Error('Invalid generated map size.');}
const nativePatch=biomass=>({biomass,harvests:0,origin:'native',generation:'native'});
const baseTile=(x,y,terrain,variant)=>({x,y,z:0,terrain,building:null,hp:100,drop:null,variant,powered:false,cable:null});
const clone=value=>structuredClone(value);

export function planetEnvironment(seed,planetId){
  if(!Number.isSafeInteger(seed)||typeof planetId!=='string'||!planetId.length)throw new Error('Invalid planet seed or identity.');
  const worldSeed=hash('planet.environment.1',seed,planetId);
  return {schema:1,seed:worldSeed,width:24,height:12,landing:{x:4+hash(worldSeed,'landing.x')%16,y:5+hash(worldSeed,'landing.y')%2}};
}

export function sectorEnvironment(world,x,y){
  checkWorld(world);if(!validSector(world,{x,y}))throw new Error('Invalid planetary sector.');
  const latitude=Math.abs(y-5.5)/5.5,patch=hash(world.seed,'sector',Math.floor(x/3),Math.floor(y/2));
  const biome=latitude>.78?'ice_barrens':biomeIds[patch%5];
  const temperatureOffset=clamp(WORLD_BIOMES[biome].temperatureOffset+Math.round(3-6*latitude),-25,25);
  return {x,y,biome,name:WORLD_BIOMES[biome].name,color:WORLD_BIOMES[biome].color,temperatureOffset};
}

function biomeCenters(world,sector,size){
  const seed=hash(world.seed,'surface',sector.x,sector.y),order=[...biomeIds];
  for(let i=order.length-1;i>0;i--){const j=hash(seed,'order',i)%(i+1);[order[i],order[j]]=[order[j],order[i]];}
  // Five exterior patches remain available beyond the preserved landing core.
  const positions=[[.81,.17],[.84,.44],[.76,.76],[.44,.84],[.17,.81]];
  const centers=positions.map(([x,y],i)=>({x:(x+(hash(seed,i,'x')%7-3)/100)*size,y:(y+(hash(seed,i,'y')%7-3)/100)*size,biome:order[i]}));
  centers.push({x:size*.24,y:size*.25,biome:sector.biome});
  return centers;
}

/** Detached partial tiles; the colony adds ordinary mutable equipment state. */
export function surfaceLayout(world,sector,size=48){
  checkWorld(world);checkSize(size);if(!validSector(world,sector))throw new Error('Invalid planetary sector.');
  const environment=sectorEnvironment(world,sector.x,sector.y),centers=biomeCenters(world,environment,size);
  const latitudeShift=Math.round(3-6*Math.abs(sector.y-5.5)/5.5),tiles=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    let nearest=centers[0],squared=Infinity;
    for(const center of centers){const d=(x-center.x)**2+(y-center.y)**2;if(d<squared){squared=d;nearest=center;}}
    const n=hash(world.seed,'tile',sector.x,sector.y,x,y),biome=nearest.biome;
    const t={...baseTile(x,y,'ground',n%4),biome,temperatureOffset:clamp(WORLD_BIOMES[biome].temperatureOffset+latitudeShift,-25,25)};
    const basin=biome==='water_basin'&&squared<(size*.115)**2;
    if(basin){t.basin=2;t.initialWater=2;}
    else if(biome==='ice_barrens'&&n%7<2){t.deposit={resource:'ice',remaining:6+n%7};}
    else if(n%100<(biome==='ice_barrens'?35:7)){t.terrain='ore';}
    else {
      if((biome==='lichen_plain'&&n%5<4)||(biome!=='ice_barrens'&&n%5===0))t.flora={lichen:nativePatch(50+n%46)};
      const edible=biome==='fungal_grove'&&n%3!==0?'fungalcap':biome==='sunberry_scrub'&&n%3===0?'sunberry':null;
      if(edible){const maturity=hash(world.seed,'maturity',sector.x,sector.y,x,y);t.flora??={};t.flora[edible]=nativePatch(maturity%6===0?100:20+maturity%80);}
    }
    tiles.push(t);
  }
  return tiles;
}

function wildlifeFor(world,sector,tiles,originalSize=0){
  const wildlife=[],occupied=new Set();
  for(const species of ['bristleback','glazefoot']){
    const food=species==='bristleback'?'lichen':'fungalcap';
    const candidates=tiles.filter(t=>t.terrain==='ground'&&!t.building&&!t.deposit&&!t.basin&&t.flora?.[food]&&(t.x>=originalSize||t.y>=originalSize));
    candidates.sort((a,b)=>hash(world.seed,sector.x,sector.y,species,a.x,a.y)-hash(world.seed,sector.x,sector.y,species,b.x,b.y)||a.y-b.y||a.x-b.x);
    const count=2+hash(world.seed,sector.x,sector.y,species,'count')%2;
    for(const tile of candidates){
      const key=`${tile.x},${tile.y}`;if(occupied.has(key))continue;
      occupied.add(key);wildlife.push({id:`wild-${species}-${tile.x}-${tile.y}`,species,site:'surface',x:tile.x,y:tile.y,z:0,health:100,fed:70,age:0});
      if(wildlife.filter(a=>a.species===species).length===count)break;
    }
  }
  return wildlife;
}

/** Counts are computed from playable layout quantities, not separate atlas noise. */
export function surfaceSurvey(world,sector,size=48){
  const tiles=surfaceLayout(world,sector,size),biomes={},flora={lichen:0,fungalcap:0,sunberry:0},resources={ore:0,ice:0,water:0};
  let minimum=Infinity,maximum=-Infinity;
  for(const tile of tiles){
    biomes[tile.biome]=(biomes[tile.biome]||0)+1;
    for(const species of Object.keys(tile.flora??{}))flora[species]++;
    if(tile.terrain==='ore')resources.ore+=5;else if(tile.terrain==='rock')resources.ore+=2;
    if(tile.deposit)resources[tile.deposit.resource]+=tile.deposit.remaining;
    resources.water+=tile.initialWater??0;
    minimum=Math.min(minimum,-35+tile.temperatureOffset);maximum=Math.max(maximum,8+tile.temperatureOffset);
  }
  const wildlife={bristleback:0,glazefoot:0};for(const animal of wildlifeFor(world,sector,tiles))wildlife[animal.species]++;
  return {size,tiles:tiles.length,biomes,flora,resources,temperature:{min:minimum,max:maximum},wildlife};
}

const passable=t=>!!t&&!['void','rock'].includes(t.terrain)&&t.building!=='wall';
const unusedVoid=t=>t?.terrain==='void'&&!['building','stock','drop','deposit','flora','cable','pipe','waterPipe','machine','verticalLink','utilityLink'].some(k=>t[k])&&!(t.liquid>0);
function connectExpansion(tiles,size,originalSize,terrain){
  const tileAt=(x,y)=>x>=0&&y>=0&&x<size&&y<size?tiles[y*size+x]:null;
  const start=tiles.find(t=>(t.building==='dock'||t.building==='shuttle')&&passable(t))??tiles.find(t=>t.x<originalSize&&t.y<originalSize&&passable(t));
  if(!start)return;
  const visited=new Set([start.y*size+start.x]),queue=[start];
  for(const t of queue)for(const [x,y] of neighbors(t.x,t.y)){
    const other=tileAt(x,y),key=y*size+x;if(!passable(other)||visited.has(key))continue;
    visited.add(key);queue.push(other);
  }
  if(queue.some(t=>t.x>=originalSize||t.y>=originalSize))return;
  // Multi-source BFS finds the shortest unused-void bridge from the old land.
  const parents=new Map([...visited].map(key=>[key,null])),search=[...queue];let goal=null;
  for(const t of search){
    if((t.x>=originalSize||t.y>=originalSize)&&passable(t)){goal=t;break;}
    for(const [x,y] of neighbors(t.x,t.y)){
      const other=tileAt(x,y),key=y*size+x;if(!other||parents.has(key)||!passable(other)&&!unusedVoid(other))continue;
      parents.set(key,t.y*size+t.x);search.push(other);
    }
  }
  if(!goal)throw new Error('Generated expansion cannot connect to its landing.');
  for(let key=goal.y*size+goal.x;parents.get(key)!==null;key=parents.get(key))if(unusedVoid(tiles[key]))tiles[key].terrain=terrain;
}

/** Preserve owned landing cells; only empty void may become a connecting bridge. */
export function expandedSiteLayout(def,world,originalTiles,originalSize){
  checkWorld(world);checkSize(def?.size);
  if(!Number.isInteger(originalSize)||originalSize<1||originalSize>=def.size||!Array.isArray(originalTiles)||originalTiles.length!==originalSize**2||originalTiles.some((t,i)=>t.x!==i%originalSize||t.y!==Math.floor(i/originalSize)||(t.z??0)!==0))throw new Error('Invalid original landing layout.');
  const sector=def.sector??world.landing;if(!validSector(world,sector))throw new Error('Invalid planetary sector.');
  const natural=def.id==='surface'||def.template==='outcrop',terrain=def.kind==='comet'?'ice':natural?'ground':'deck';
  let tiles;
  if(natural)tiles=surfaceLayout(world,sector,def.size);
  else tiles=Array.from({length:def.size**2},(_,i)=>{
    const x=i%def.size,y=Math.floor(i/def.size),n=hash(world.seed,def.id,x,y),outside=x>=originalSize||y>=originalSize;
    const land=outside&&x>1&&y>1&&x<def.size-2&&y<def.size-2,t=baseTile(x,y,land?terrain:'void',n%4);
    if(land&&def.kind==='wreck'&&n%37===0)t.building='salvage';
    if(land&&def.kind==='comet')t.deposit={resource:'ice',remaining:6+n%7};
    if(land&&def.kind==='solar'&&n%181===0)t.building='collector';
    return t;
  });
  for(const original of originalTiles)tiles[original.y*def.size+original.x]=clone(original);
  connectExpansion(tiles,def.size,originalSize,terrain);
  return {tiles,wildlife:def.id==='surface'?wildlifeFor(world,sector,tiles,originalSize):[]};
}
