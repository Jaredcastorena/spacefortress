import test from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/data.js';
import { createGame, step, at, order, setLabor, serialize, deserialize, updateRooms, pathTo } from '../src/simulation.js';
import { setBunkOwner, bunkOwner, housingObstruction, reconcileHousing } from '../src/housing.js';
import { setRoomDesignation, roomStatus } from '../src/rooms.js';
import { roomAt, fillRoom } from '../src/atmosphere.js';
import { totalResources, syncResources } from '../src/inventory.js';
import { spillStorage, setMachineEnabled } from '../src/industry.js';
import { depart } from './helpers/depart.js';

function fixture() {
  const s=createGame(),site=s.sites.surface,c=s.crew[0];
  for(const t of site.tiles)if(t.machine && t.building!=='scrubber')setMachineEnabled(s,'surface',t.x,t.y,false);
  for(const person of s.crew){person.x=8;person.y=8;for(const labor of Object.keys(person.labors))setLabor(s,person.id,labor,false);}
  return {s,site,c};
}
const check=s=>{syncResources(s);return deserialize(serialize(s));};
const assign=(s,c,x=12,y=7)=>assert.ok(setBunkOwner(s,'surface',x,y,c.id).ok);

test('bunks begin communal; assigning, moving, replacing and clearing owners is exclusive',()=>{
  const {s,c}=fixture(),other=s.crew[1],before=totalResources(s);
  assert.ok(s.crew.every(c=>c.housing.bunk===null));assign(s,c);assert.equal(c.memories.length,0);
  assign(s,c,11);assert.equal(bunkOwner(s,'surface',12,7),undefined);
  assign(s,other,11);assert.equal(c.housing.bunk,null);assert.equal(bunkOwner(s,'surface',11,7),other);
  assert.ok(c.memories.some(m=>m.kind==='housing-reassigned'));setBunkOwner(s,'surface',11,7,null);
  assert.equal(other.housing.bunk,null);assert.deepEqual(totalResources(s),before);check(s);
});

test('crew walk to their personal bunk ahead of closer communal bunks and remember actual sleep',()=>{
  const {s,c}=fixture();assign(s,c);c.energy=10;step(s);assert.deepEqual(c.intent.target,[12,7]);assert.ok(!c.memories.some(m=>m.kind==='personal-bunk'));
  step(s,12);assert.equal(c.x,12);assert.equal(c.y,7);assert.ok(c.memories.some(m=>m.kind==='personal-bunk'&&m.mood===4));check(s);
});

test('ready living quarters improve the memory of sleeping at home',()=>{
  const {s,site,c}=fixture();for(const t of site.tiles)if(['farm','refinery'].includes(t.building)){spillStorage(t);t.building=null;delete t.maintenance;delete t.powerPriority;}
  setRoomDesignation(s,'surface',8,8,'quarters');assert.equal(roomStatus(s,site,roomAt(site,8,8)).ready,true);
  assign(s,c);c.x=12;c.y=7;c.energy=10;step(s);assert.ok(c.memories.some(m=>m.kind==='personal-bunk'&&m.mood===8));check(s);
});

test('personal bunks exclude other sleepers while communal bunks remain usable',()=>{
  const {s,c}=fixture();assign(s,s.crew[1],9);c.energy=10;step(s);assert.notDeepEqual(c.intent.target,[9,7]);assert.ok(c.intent.target);check(s);
});

test('when all bunks are private, floor rest ends and useful work resumes',()=>{
  const {s,c}=fixture();for(let i=0;i<4;i++)assign(s,s.crew[i+1],9+i);
  c.energy=24;setLabor(s,c.id,'mining',true);order(s,'surface',4,10,'mine');
  for(let i=0;i<230&&!s.stats.mined;i++)step(s);
  assert.equal(s.stats.mined,1);assert.ok(c.memories.some(m=>m.kind==='poor-sleep'));assert.equal(c.housing.bunk,null);check(s);
});

test('a broken home keeps ownership, causes displacement and becomes usable after repair',()=>{
  const {s,site,c}=fixture();assign(s,c);at(site,12,7).hp=0;c.energy=10;step(s);
  assert.deepEqual(c.housing.bunk,[12,7]);assert.notDeepEqual(c.intent.target,[12,7]);assert.ok(c.memories.some(m=>m.kind==='housing-displaced'));
  assert.match(housingObstruction(s,c,pathTo),/repair/);at(site,12,7).hp=100;c.intent=null;c.energy=10;step(s);assert.deepEqual(c.intent.target,[12,7]);check(s);
});

test('unreachable homes and waste-room homes use communal fallback without losing ownership',()=>{
  const {s,site,c}=fixture();assign(s,c);for(let y=7;y<=11;y++){const t=at(site,10,y);spillStorage(t);t.building='wall';}updateRooms(site);
  assert.match(housingObstruction(s,c,pathTo),/unreachable/);c.energy=10;step(s);assert.deepEqual(c.intent.target,[9,7]);
  setRoomDesignation(s,'surface',12,8,'waste');assert.match(housingObstruction(s,c,pathTo),/waste storage/);assert.deepEqual(c.housing.bunk,[12,7]);check(s);
});

test('unsafe air at home does not trap sleepers or erase their assignment',()=>{
  const {s,site,c}=fixture();assign(s,c);for(let y=7;y<=11;y++){const t=at(site,10,y);spillStorage(t);t.building='wall';}updateRooms(site);
  const r=roomAt(site,12,8);fillRoom(r,0);
  assert.match(housingObstruction(s,c,pathTo),/safe air/);c.energy=10;step(s);assert.deepEqual(c.intent.target,[9,7]);assert.deepEqual(c.housing.bunk,[12,7]);
});

test('reassignment releases sleep claims immediately without teleporting crew or losing cargo',()=>{
  const {s,c}=fixture();c.energy=10;step(s);const [x,y]=c.intent.target,pos=[c.x,c.y];c.carry={ore:2};const before=totalResources(s);
  assign(s,s.crew[1],x,y);assert.equal(c.intent.target,null);assert.deepEqual([c.x,c.y],pos);assert.deepEqual(totalResources(s),before);
  step(s);assert.notDeepEqual(c.intent.target,[x,y]);assert.equal(c.carry.ore,2);check(s);
});

test('dismantling a personal bunk releases ownership and preserves its physical salvage',()=>{
  const {s,site,c}=fixture();assign(s,c);setLabor(s,s.crew[1].id,'construction',true);assert.ok(order(s,'surface',12,7,'remove').ok);
  for(let i=0;i<70&&at(site,12,7).building;i++)step(s);
  assert.equal(at(site,12,7).building,null);assert.equal(c.housing.bunk,null);assert.ok(c.memories.some(m=>m.kind==='housing-lost'));assert.equal(at(site,12,7).drop.alloy,1);check(s);
});

test('death releases personal ownership',()=>{
  const {s,c}=fixture();assign(s,c);c.health=0;reconcileHousing(s);assert.equal(c.housing.bunk,null);assert.equal(bunkOwner(s,'surface',12,7),undefined);
});

test('expedition crew retain homes and count as residents while away',()=>{
  const s=createGame();for(let i=0;i<4;i++)assign(s,s.crew[i],9+i);assert.ok(depart(s,'wreck').ok);
  const away=s.crew.find(c=>c.site!=='surface'&&c.housing.bunk);assert.ok(away);assert.match(housingObstruction(s,away,pathTo),/reserved while away/);
  assert.equal(roomStatus(s,s.sites.surface,roomAt(s.sites.surface,9,7)).residents,4);check(s);
});

test('ownership, recovery and memories continue deterministically through saves',()=>{
  const {s,c}=fixture();assign(s,c);c.energy=10;step(s,5);const copy=check(s);step(s,50);step(copy,50);assert.deepEqual(copy,s);
});

test('schema twenty migration adds communal housing without changing sleep claims or inventories',()=>{
  const {s,c}=fixture();c.energy=10;step(s);s.version=20;for(const person of s.crew)delete person.housing;
  const before=totalResources(s),intent=structuredClone(c.intent),copy=check(s);assert.equal(copy.version, VERSION);assert.deepEqual(copy.crew[0].intent,intent);assert.deepEqual(totalResources(copy),before);assert.ok(copy.crew.every(c=>c.housing.bunk===null));
});

test('invalid assignments and saves are rejected',()=>{
  const {s,c}=fixture();for(const args of [['wreck',12,7,c.id],['surface',8,8,c.id],['surface',12,7,'missing']])assert.equal(setBunkOwner(s,...args).ok,false);
  const invalid=[s=>delete s.crew[0].housing,s=>s.crew[0].housing.bunk=[-1,7],s=>s.crew[0].housing.bunk=[8,8],s=>{s.crew[0].housing.bunk=[12,7];s.crew[1].housing.bunk=[12,7];},s=>{s.crew[0].housing.bunk=[12,7];s.crew[0].health=0;},s=>{assign(s,s.crew[0]);s.crew[1].intent={type:'rest',target:[12,7]};}];
  for(const mutate of invalid){const {s}=fixture();mutate(s);assert.throws(()=>check(s));}
});
