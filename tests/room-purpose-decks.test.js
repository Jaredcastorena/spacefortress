import {withTemperaturePressureReadings} from './helpers/pressure-migration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createGame,serialize,deserialize} from '../src/simulation.js';
import {VERSION} from '../src/data.js';
import {observe,TELEMETRY_VERSION,roomEntityId} from '../src/telemetry.js';
import {projectPreDesignationLocations} from './helpers/legacy-projection.js';
import {tileAt} from '../src/spatial.js';
import {roomTiles} from '../src/room-locations.js';
import {updateRooms,roomAt,fillRoom} from '../src/atmosphere.js';
import {HEAT_CAPACITY} from '../src/thermal.js';
import {roomDesignation,setRoomDesignation,roomStatus,livingAllowed,roomAcceptsResource} from '../src/rooms.js';
import {roomComfort} from '../src/comfort.js';
import {exposedWaste} from '../src/sanitation.js';
import {roomDetails} from '../src/room-panels.js';
import {thermalDetails} from '../src/thermal-panels.js';
import {outpostReadiness} from '../src/outpost-readiness.js';

// Genuine schema53 bytes captured at d2e72cb with a native quarters assignment.
const raw=gunzipSync(readFileSync(new URL('./fixtures/room-purposes-schema53.json.gz',import.meta.url))).toString();
const at=(site,x,y,z=0)=>tileAt(site,{x,y,z});
function stacked(){
  const s=createGame(74219),site=s.sites.surface;
  site.levels.push({z:7,name:'Upper test deck'});site.tiles.push(...site.tiles.map(t=>({...structuredClone(t),z:7})));
  updateRooms(site);const lower=roomAt(site,8,8,0),upper=roomAt(site,8,8,7);
  for(const r of [lower,upper]){fillRoom(r);r.heat=(20+273.15)*r.volume*HEAT_CAPACITY;for(const t of roomTiles(site,r)){t.building=null;t.hp=100;t.drop=null;delete t.stock;delete t.imports;}}
  s.crew.forEach(c=>{c.site='transit';c.housing.bunk=null;});
  return {s,site,lower,upper};
}

test('schema53 purpose migration preserves all previous state and exact current reload',()=>{
  assert.equal(createHash('sha256').update(raw).digest('hex'),'10b7c6cfc385428af34b6891330cd9a1d09b03ce1c34b0810409239629fb1ecf');
  const old=JSON.parse(raw),s=deserialize(raw);assert.equal(old.version,53);assert.equal(s.version,VERSION);
  assert.deepEqual(s.sites.surface.designations,old.sites.surface.designations.map(d=>({...d,z:0})));
  const projected=projectPreDesignationLocations(s);projected.version=53;assert.deepEqual(projected,withTemperaturePressureReadings(old));
  assert.equal(serialize(deserialize(serialize(s))),serialize(s));assert.equal(observe(s).schemaVersion,TELEMETRY_VERSION);
});

test('purpose migration rejects missing current decks, legacy shadows and duplicate anchors',()=>{
  for(const z of [undefined,null,7,-1,'0']){const s=deserialize(raw),d=s.sites.surface.designations[0];if(z===undefined)delete d.z;else d.z=z;assert.throws(()=>deserialize(serialize(s)),/designation location/);}
  const old=JSON.parse(raw);old.sites.surface.designations[0].z=0;assert.throws(()=>deserialize(serialize(old)),/legacy room designation location/);
  const s=deserialize(raw);s.sites.surface.designations.push({...s.sites.surface.designations[0]});assert.throws(()=>deserialize(serialize(s)),/designation marker/);
});

test('room purpose, resource restrictions and clearing stay on their own deck',()=>{
  const {s,site,lower,upper}=stacked();site.designations=[{x:8,y:8,z:0,role:'quarters'},{x:8,y:8,z:7,role:'waste'}];
  assert.equal(roomDesignation(site,lower).role,'quarters');assert.equal(roomDesignation(site,upper).role,'waste');
  assert.equal(livingAllowed(site,8,8,0),true);assert.equal(livingAllowed(site,8,8,7),false);
  assert.equal(roomAcceptsResource(site,at(site,8,8),'food'),true);assert.equal(roomAcceptsResource(site,at(site,8,8,7),'food'),false);
  assert.equal(setRoomDesignation(s,'surface',8,8,'general').ok,true);assert.deepEqual(site.designations,[{x:8,y:8,z:7,role:'waste'}]);
  site.rooms=[];assert.equal(roomDetails(s,site,at(site,8,8)),'');assert.match(roomDetails(s,site,at(site,8,8,7)),/DORMANT/);
  setRoomDesignation(s,'surface',8,8,'general');assert.equal(site.designations.length,1);
});

test('room readiness, residents, furnishings, comfort and waste use the physical deck',()=>{
  const {s,site,lower,upper}=stacked();site.designations=[{x:8,y:8,z:0,role:'quarters'},{x:8,y:8,z:7,role:'infirmary'}];
  at(site,9,7).building='bunk';at(site,9,7,7).building='medicalCot';
  Object.assign(s.crew[0],{site:'surface',x:8,y:8,z:0});Object.assign(s.crew[1],{site:'surface',x:8,y:8,z:7});
  s.crew[2].housing.bunk={x:9,y:7,z:0};s.crew[3].housing.bunk={x:9,y:7,z:7};
  for(const r of [lower,upper]){const status=roomStatus(s,site,r);assert.equal(status.occupants,1);assert.equal(status.residents,1);assert.equal(status.furnishings,1);assert.equal(status.ready,true);assert.equal(roomComfort(s,site,r).private,true);}
  at(site,8,8,7).drop={waste:2};s.jobs=[{site:'surface',x:8,y:8,z:7,materials:{waste:3},sources:[{x:8,y:8,z:0,items:{waste:4}}]}];
  assert.equal(exposedWaste(s,site,lower),4);assert.equal(exposedWaste(s,site,upper),5);
  s.jobs=[];assert.equal(roomComfort(s,site,lower).dirty,false);assert.equal(roomComfort(s,site,upper).dirty,true);
  assert.equal(roomStatus(s,site,lower).ready,true);assert.match(roomStatus(s,site,upper).issues.join(),/exposed waste/);
  upper.heat=(80+273.15)*upper.volume*HEAT_CAPACITY;assert.doesNotMatch(thermalDetails(site,at(site,8,8)),/unsafe/);assert.match(thermalDetails(site,at(site,8,8,7)),/unsafe/);
});

test('outpost diagnostics keep overlapping room identities, purposes and furniture separate',()=>{
  const {s,site,lower,upper}=stacked();site.designations=[{x:8,y:8,z:0,role:'quarters'},{x:8,y:8,z:7,role:'waste'}];
  const wreck=structuredClone(site);wreck.id='wreck';s.sites.wreck=wreck;
  const before=serialize(s),result=outpostReadiness(s,'wreck',[]);
  const ground=result.rooms.find(r=>r.entity===roomEntityId('wreck',lower)),top=result.rooms.find(r=>r.entity===roomEntityId('wreck',upper));
  assert.ok(ground);assert.ok(top);assert.notEqual(ground.entity,top.entity);
  assert.equal(ground.blockers.some(b=>b.code==='living_area_required'),false);assert.equal(top.blockers.some(b=>b.code==='living_area_required'),true);
  assert.equal(serialize(s),before);
});
