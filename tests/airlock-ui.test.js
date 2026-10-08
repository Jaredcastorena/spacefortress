import test from 'node:test';
import assert from 'node:assert/strict';
import { airlockDetails, airlockFormAction, airlockOwnershipDetails, AIRLOCK_REFERENCES } from '../src/airlock-panels.js';

// Deliberately incomplete geometry: panel reads must also work during damage or setup.
function fixture() {
  const site={id:'surface',size:9,tiles:Array.from({length:81},(_,i)=>({x:i%9,y:Math.floor(i/9),terrain:'floor',building:null,hp:100})),rooms:[],atmosphere:{tick:0}};
  const at=(x,y)=>site.tiles[y*site.size+x],t=at(1,1);t.building='airlockController';t.powered=false;
  const config={chamber:[3,3],inner:[2,3],outer:[4,3],extractor:[3,3],pump:[5,3],reservoir:[6,3],vent:[3,4]};
  t.airlock={binding:'test-binding',config,chamberCells:['3,3'],ownedNodes:[],enabled:false,phase:'paused',direction:null,party:null,queue:[],nextCycle:1,cycle:null,resumePhase:null,recoverySide:null,reason:'no_power'};
  for(const side of ['inner','outer'])Object.assign(at(...config[side]),{building:'door',doorMode:'closed',doorUntil:0,airlockOwner:{controller:'tile:surface:1:1',binding:'test-binding'}});
  Object.assign(at(6,3),{building:'gasReservoir',gasStore:{gas:{oxygen:5,inert:15,co2:0},smoke:2,open:false}});
  site.rooms.push({cells:['3,3'],volume:1,gas:{oxygen:2,inert:8,co2:0},smoke:0,heat:293.15*20});
  const s={crew:[{id:'crew-0',name:'A <pilot>',site:'surface',x:0,y:0,health:100}],sites:{surface:site}};
  return {s,site,t,at};
}

test('setup is collapsed, bounded and includes all seven coordinate pairs',()=>{
  const {s,site,t}=fixture();t.airlock=null;
  const html=airlockDetails(s,site,t);
  assert.match(html,/Not configured/);assert.match(html,/<summary>Set up airlock/);
  assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
  for(const [key] of AIRLOCK_REFERENCES)for(const axis of ['x','y'])assert.ok(html.includes(`name="${key}-${axis}"`));
  assert.equal((html.match(/max="8"/g)||[]).length,14);
  assert.doesNotMatch(html,/airlock-release|airlock-enable/);
});

test('configured observations show measured stores, queue and blocker without side effects',()=>{
  const {s,site,t}=fixture();t.airlock.queue.push({crew:'crew-0',patient:null,direction:'outward',emergency:true});
  const before=structuredClone(s),html=airlockDetails(s,site,t);
  assert.match(html,/100\.0% nominal · 20\.0°C/);assert.match(html,/58\.0 \/ 80 units/);
  assert.match(html,/Restore wired power/);assert.match(html,/1 waiting/);assert.match(html,/A &lt;pilot&gt;/);
  assert.match(html,/low suit reserve/);assert.match(html,/data-action="airlock-cancel"/);
  assert.match(html,/data-simulation-action="airlock\.release"/);assert.match(html,/type="checkbox" name="acceptAtmosphereLoss" required/);
  assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
  airlockDetails(s,site,t,{crew:'crew-0','chamber-x':'4',side:'outer'});
  assert.deepEqual(s,before);
});

test('manual release and unbind controls reflect physical seal and occupancy guards',()=>{
  const {s,site,t,at}=fixture();
  at(4,3).doorMode='open';
  let html=airlockDetails(s,site,t);
  assert.match(html,/<button type="submit" data-airlock-focus="release" disabled>/);
  assert.match(html,/Opposite door is open or damaged/);
  assert.match(html,/<button[^>]*data-action="airlock-unbind"[^>]*disabled>/);
  at(4,3).doorMode='closed';s.crew[0].x=3;s.crew[0].y=3;
  html=airlockDetails(s,site,t);
  assert.match(html,/<button[^>]*data-action="airlock-unbind"[^>]*disabled>/);
  s.crew[0].x=0;s.crew[0].y=0;
  assert.doesNotMatch(airlockDetails(s,site,t),/<button[^>]*data-action="airlock-unbind"[^>]*disabled>/);
});

test('form requests use exact strict action arguments and require explicit release acceptance',()=>{
  const target={site:'surface',x:1,y:1},values={};
  for(const [key] of AIRLOCK_REFERENCES){values[`${key}-x`]='3';values[`${key}-y`]='4';}
  const request=airlockFormAction('configure',values,target);
  assert.equal(request.id,'airlock.configure');assert.deepEqual(request.args.chamber,[3,4]);
  assert.equal(Object.keys(request.args).length,10);
  values['chamber-x']='';assert.equal(airlockFormAction('configure',values,target),null);
  assert.deepEqual(airlockFormAction('request',{crew:'crew-0'},target,'inward'),{id:'airlock.request',args:{...target,crew:'crew-0',direction:'inward'}});
  assert.equal(airlockFormAction('release',{side:'outer',acceptAtmosphereLoss:false},target),null);
  assert.deepEqual(airlockFormAction('release',{side:'outer',acceptAtmosphereLoss:true},target),{id:'airlock.release',args:{...target,side:'outer',acceptAtmosphereLoss:true}});
});

test('bound equipment links to its live controller and replaced ownership is ignored',()=>{
  const {site,at}=fixture(),door=at(2,3);
  assert.match(airlockOwnershipDetails(site,door),/Airlock control · 1 \/ 1/);
  assert.match(airlockOwnershipDetails(site,door),/data-site="surface" data-x="1" data-y="1"/);
  door.airlockOwner.binding='old-binding';assert.equal(airlockOwnershipDetails(site,door),'');
});
