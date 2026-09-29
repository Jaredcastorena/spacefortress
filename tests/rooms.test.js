import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, at, step, updateRooms, roomAt, setLabor, serialize, deserialize, pathTo } from '../src/simulation.js';
import { setRoomDesignation, roomDesignation, roomStatus, roomBenefit } from '../src/rooms.js';
import { initializeStorage, totalResources, syncResources } from '../src/inventory.js';
import { setMachineEnabled, spillStorage, haul } from '../src/industry.js';
import { refreshPower } from '../src/power.js';
import { medicalRest, injure } from '../src/medicine.js';
import { acceptsResource, setDepotAccepted } from '../src/storage.js';
const check = s => { syncResources(s); return deserialize(serialize(s)); };
function clear(t) { spillStorage(t); t.building=null;delete t.maintenance;delete t.powerPriority; }
function fixture(split = true) {
  const s=createGame(),site=s.sites.surface;
  for(const t of site.tiles)if(t.machine)setMachineEnabled(s,'surface',t.x,t.y,false);
  for(const c of s.crew){c.x=8;c.y=8;for(const labor of Object.keys(c.labors))setLabor(s,c.id,labor,false);}
  if(split){for(let y=7;y<=11;y++){const t=at(site,10,y);clear(t);t.building='wall';}const door=at(site,10,9);door.building='door';door.doorMode='auto';door.doorUntil=0;updateRooms(site);}
  refreshPower(s,site);return {s,site,left:roomAt(site,8,8),right:roomAt(site,12,8),depot:at(site,8,10),c:s.crew[0]};
}
const until=(s,condition,limit=150)=>{for(let i=0;i<limit&&!condition();i++){step(s);check(s);}assert.ok(condition(),`Condition missing at ${s.tick}`);};

test('designation changes neither material ownership nor room gases and heat',()=>{
  const {s,site,left}=fixture();const before=totalResources(s),rooms=structuredClone(site.rooms);
  assert.ok(setRoomDesignation(s,'surface',8,8,'quarters').ok);assert.deepEqual(totalResources(s),before);assert.deepEqual(site.rooms,rooms);assert.equal(roomDesignation(site,left).role,'quarters');check(s);
});

test('splits retain the marker only on its anchored side and merges expose conflicting purposes',()=>{
  const {s,site}=fixture(false);setRoomDesignation(s,'surface',8,8,'quarters');
  for(let y=7;y<=11;y++){const t=at(site,10,y);clear(t);t.building='wall';}updateRooms(site);
  assert.equal(roomDesignation(site,roomAt(site,8,8)).role,'quarters');assert.equal(roomDesignation(site,roomAt(site,12,8)).role,'general');
  setRoomDesignation(s,'surface',12,8,'infirmary');at(site,10,9).building=null;updateRooms(site);const merged=roomAt(site,8,8);
  assert.equal(roomDesignation(site,merged).role,'conflict');assert.equal(roomStatus(s,site,merged).ready,false);assert.equal(site.designations.length,2);
  setRoomDesignation(s,'surface',9,8,'infirmary');assert.equal(site.designations.length,1);assert.equal(roomDesignation(site,merged).role,'infirmary');check(s);
});

test('same-purpose merged markers remain compatible and dormant markers survive covered floors',()=>{
  const {s,site}=fixture();setRoomDesignation(s,'surface',8,8,'quarters');setRoomDesignation(s,'surface',12,8,'quarters');at(site,10,9).building=null;updateRooms(site);
  assert.equal(roomDesignation(site,roomAt(site,8,8)).role,'quarters');assert.equal(site.designations.length,2);
  at(site,8,8).building='wall';updateRooms(site);assert.equal(site.designations.length,2);assert.equal(roomAt(site,8,8),undefined);check(s);
  at(site,8,8).building=null;updateRooms(site);assert.equal(roomDesignation(site,roomAt(site,8,8)).markers.length,2);
  at(site,8,8).building='wall';updateRooms(site);assert.ok(setRoomDesignation(s,'surface',8,8,'general').ok);assert.equal(site.designations.length,1);
});

test('quarters readiness follows real bunks, space, machinery, occupants and exposed waste',()=>{
  const {s,site,left,depot}=fixture();setRoomDesignation(s,'surface',8,8,'quarters');assert.match(roomStatus(s,site,left).issues.join(),/industrial/);
  clear(at(site,7,9));refreshPower(s,site);assert.equal(roomStatus(s,site,left).ready,true);assert.equal(roomStatus(s,site,left).occupants,7);
  depot.stock.waste=.5;assert.equal(roomStatus(s,site,left).ready,false);delete depot.stock.waste;
  at(site,9,7).hp=0;assert.match(roomStatus(s,site,left).issues.join(),/bunk/);at(site,9,7).hp=100;
  for(const [x,y]of[[7,8],[8,9],[9,9]])at(site,x,y).building='bunk';assert.match(roomStatus(s,site,left).issues.join(),/four floor/);check(s);
});

test('sleepers prefer ready quarters and recover faster while their requirements hold',()=>{
  const {s,site,c}=fixture();clear(at(site,13,10));setRoomDesignation(s,'surface',12,8,'quarters');c.energy=10;step(s);assert.ok([11,12].includes(c.intent.target[0]));
  c.x=c.intent.target[0];c.y=c.intent.target[1];const before=c.energy;step(s);assert.ok(c.energy-before>1);
  at(site,12,8).drop={waste:.5};const dirty=c.energy;step(s);assert.ok(c.energy-dirty<.9);assert.ok(c.energy>dirty);check(s);
});

test('patients prefer ready infirmaries and treated injuries recover faster there',()=>{
  const {s,site,c}=fixture();clear(at(site,13,10));at(site,8,9).building='medicalCot';at(site,12,9).building='medicalCot';setRoomDesignation(s,'surface',12,8,'infirmary');injure(s,c,20,'test');step(s);assert.deepEqual(c.medical.bed,[12,9]);
  c.x=12;c.y=9;c.intent={type:'medical',target:[12,9]};c.medical.treated=5;const health=c.health;medicalRest(s,c,site,pathTo);assert.ok(Math.abs(c.health-health-.15)<1e-8);
  at(site,12,8).drop={waste:.5};const second=c.health;medicalRest(s,c,site,pathTo);assert.ok(Math.abs(c.health-second-.12)<1e-8);
});

test('greenhouse contamination pauses a paid crop and cleaning resumes its original batch',()=>{
  const {s,site,left}=fixture();const farm=at(site,7,9);setRoomDesignation(s,'surface',8,8,'farm');setMachineEnabled(s,'surface',7,9,true);farm.machine.input={water:1,fertilizer:.25};setLabor(s,s.crew[3].id,'production',true);
  assert.equal(roomStatus(s,site,left).ready,true);until(s,()=>farm.machine.progress>2);const progress=farm.machine.progress,batch=structuredClone(farm.machine.batch);at(site,8,9).drop={waste:.5};step(s,5);
  assert.equal(farm.machine.progress,progress);assert.deepEqual(farm.machine.batch,batch);assert.match(farm.machine.status,/Remove exposed waste/);
  at(site,8,9).drop=null;until(s,()=>farm.machine.completed===1);assert.equal(farm.machine.output.food,2);check(s);
});

test('room storage rules preserve filters and existing stock while rejected waste is physically relocated',()=>{
  const {s,site,depot}=fixture();const refuse=at(site,12,10);refuse.building='stockpile';initializeStorage(refuse);depot.stock.waste=2;const filters=[...depot.storage.accepted],before=totalResources(s);
  setRoomDesignation(s,'surface',8,8,'quarters');setRoomDesignation(s,'surface',12,8,'waste');assert.deepEqual(depot.storage.accepted,filters);assert.equal(depot.stock.waste,2);assert.equal(acceptsResource(depot,'waste',site),false);assert.equal(acceptsResource(refuse,'food',site),false);assert.equal(acceptsResource(refuse,'medicine',site),false);
  setLabor(s,s.crew[4].id,'hauling',true);until(s,()=>refuse.stock.waste===2);assert.equal(depot.stock.waste||0,0);assert.deepEqual(totalResources(s),before);
});

test('in-flight supplies reroute when the receiving room changes purpose',()=>{
  const {s,site,c,depot}=fixture();const other=at(site,12,10);other.building='stockpile';initializeStorage(other);c.carry={waste:1};c.delivery={kind:'stock',target:[8,10]};
  setRoomDesignation(s,'surface',8,8,'infirmary');haul(s,c,site,pathTo);assert.deepEqual(c.delivery.target,[12,10]);assert.equal(depot.stock.waste||0,0);until(s,()=>!c.carry);assert.equal(other.stock.waste,1);check(s);
});

test('waste storage excludes beds and crop work and sends floor sleepers to living space',()=>{
  const {s,site,c}=fixture();setRoomDesignation(s,'surface',8,8,'waste');c.energy=10;step(s);assert.ok(c.intent.target[0]>10);
  const farm=at(site,7,9);setMachineEnabled(s,'surface',7,9,true);farm.machine.input={water:1,fertilizer:.25};step(s);assert.match(farm.machine.status,/waste storage/);assert.equal(farm.machine.progress,0);
  for(const t of site.tiles)if(t.building==='bunk')t.hp=0;c.intent={type:'rest',target:null};c.x=8;c.y=8;until(s,()=>c.x>10);assert.notEqual(c.activity,'Resting on the floor; needs a bunk');check(s);
});

test('conflicting merges preserve conservative delivery and occupancy restrictions until resolved',()=>{
  const {s,site,depot}=fixture();setRoomDesignation(s,'surface',8,8,'quarters');setRoomDesignation(s,'surface',12,8,'waste');at(site,10,9).building=null;updateRooms(site);
  assert.equal(acceptsResource(depot,'waste',site),false);assert.equal(acceptsResource(depot,'food',site),false);assert.equal(roomBenefit(s,site,at(site,9,7),'quarters'),false);
  setRoomDesignation(s,'surface',8,8,'general');assert.equal(acceptsResource(depot,'food',site),true);assert.equal(acceptsResource(depot,'waste',site),true);assert.equal(site.designations.length,0);
});

test('designations survive reload and schema-nineteen migration preserves all existing state',()=>{
  const {s,site}=fixture();setRoomDesignation(s,'surface',8,8,'quarters');const copy=check(s);step(s,10);step(copy,10);assert.deepEqual(copy,s);
  s.version=19;for(const current of Object.values(s.sites))delete current.designations;const supplies=totalResources(s),before=structuredClone(site.rooms);const migrated=check(s);assert.equal(migrated.version, VERSION);assert.deepEqual(totalResources(migrated),supplies);assert.deepEqual(migrated.sites.surface.rooms,before);assert.ok(Object.values(migrated.sites).every(site=>site.designations.length===0));
});

test('invalid purposes, coordinates and duplicate markers are rejected',()=>{
  const {s}=fixture();assert.equal(setRoomDesignation(s,'surface',99,2,'quarters').ok,false);assert.equal(setRoomDesignation(s,'surface',2,2,'quarters').ok,false);assert.equal(setRoomDesignation(s,'surface',8,8,'palace').ok,false);
  for(const markers of [null,[{x:8,y:8,role:'general'}],[{x:8,y:8,role:'bad'}],[{x:-1,y:8,role:'quarters'}],[{x:8,y:8,role:'quarters'},{x:8,y:8,role:'farm'}]]){const f=fixture();f.site.designations=markers;assert.throws(()=>check(f.s));}
});


test('converting an occupied cot room to waste storage relocates care without a manual-cancel delay',()=>{
  const {s,site,c}=fixture();at(site,8,9).building='medicalCot';at(site,12,9).building='medicalCot';injure(s,c,20,'test');step(s);assert.deepEqual(c.medical.bed,[8,9]);
  const before=totalResources(s).medicine;setRoomDesignation(s,'surface',8,8,'waste');step(s);
  assert.deepEqual(c.medical.bed,[12,9]);assert.equal(c.medical.retryAt,0);assert.equal(totalResources(s).medicine,before);check(s);
});
