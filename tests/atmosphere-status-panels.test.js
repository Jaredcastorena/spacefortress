import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGame } from '../src/simulation.js';
import { GAS_PER_TILE, refreshRoom, breathingStatus, breathable } from '../src/atmosphere.js';
import { FIRE } from '../src/fire.js';
import { atmosphereDetails } from '../src/atmosphere-panels.js';
import { observe } from '../src/telemetry.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function gases(room,{pressure=100,oxygenPressure=.21,co2Fraction=0,smoke=0}={}) {
  const nominal=room.volume*GAS_PER_TILE,total=nominal*pressure/100,oxygen=nominal*oxygenPressure,co2=total*co2Fraction;
  room.gas={oxygen,inert:total-oxygen-co2,co2};room.smoke=smoke*room.volume;refreshRoom(room);return room;
}
const room=options=>gases({volume:35,sealed:true},options);
const observedRoom=(s,r)=>Object.values(observe(s).entities).find(entity=>entity.type==='room'&&entity.site==='surface'&&entity.cells.includes(r.cells[0]));
const failures=[
  ['smoke',{pressure:40,oxygenPressure:.1,smoke:FIRE.smokeLimit},/Suppress the fire/],
  ['low_pressure',{pressure:40,oxygenPressure:.1},/Deliver breathing mix to life support/],
  ['high_pressure',{pressure:160,oxygenPressure:.35},/Reduce gas input/],
  ['low_oxygen',{oxygenPressure:.15},/Stored breathing mix must reach life support/],
  ['high_oxygen',{oxygenPressure:.31,co2Fraction:.03},/Reduce oxygen input/],
  ['high_co2',{co2Fraction:.03},/Run powered life support to recycle it; repair damaged equipment/]
];

test('frozen144 diagnostic projection explains insufficient available oxygen despite normal concentration',()=>{
  // Rounded measured projection from the frozen144 diagnosis:35tiles,
  // O2=55.46668, pressure76.4248%, concentration20.736%; no trial replay.
  const r={volume:35,sealed:false,smoke:0,gas:{oxygen:55.46668,inert:212.02012,co2:0}};refreshRoom(r);
  const before=digest(r),status=breathingStatus(r),html=atmosphereDetails(r);
  assert.equal(status.block,'low_oxygen');assert.equal(status.breathable,false);
  assert.ok(Math.abs(status.oxygenPressure-.158476)<1e-6);
  assert.match(html,/Breathing<\/dt><dd>Suit required/);assert.match(html,/Pressure<\/dt><dd>76.4% of nominal/);
  assert.match(html,/Oxygen concentration<\/dt><dd>20.7%/);
  assert.match(html,/Oxygen at this pressure<\/dt><dd>15.85% of nominal · safe range 16–30%/);
  assert.match(html,/data-breathing-block="low_oxygen"/);
  assert.match(html,/Stored breathing mix must reach life support; isolate exterior door losses/);
  assert.equal(digest(r),before);
});

test('each first failed breathing limit has one shared classification and actionable inspector explanation',()=>{
  for(const [block,options,action] of failures) {
    const r=room(options),before=digest(r),status=breathingStatus(r),html=atmosphereDetails(r);
    assert.equal(status.block,block);assert.equal(breathable(r),false);
    assert.ok(html.includes(`data-breathing-block="${block}"`));assert.match(html,action);
    assert.equal((html.match(/data-breathing-block=/g)||[]).length,1);assert.equal(digest(r),before);
  }
});

test('safe atmosphere retains concentration and pressure and adds the pressure-adjusted oxygen range',()=>{
  const r=room(),html=atmosphereDetails(r);
  assert.match(html,/Breathing<\/dt><dd>Breathable/);assert.match(html,/100.0% of nominal/);
  assert.match(html,/Oxygen concentration<\/dt><dd>21.0%/);
  assert.match(html,/21.00% of nominal · safe range 16–30%/);
  assert.ok(!html.includes('data-breathing-block='));assert.ok(!html.includes('data-action='));
});

test('exterior explains suit use without inventing a room pressure or oxygen reading',()=>{
  const status=breathingStatus(null),html=atmosphereDetails(null);
  assert.equal(status.block,'exterior');assert.equal(status.oxygenPressure,null);
  assert.match(html,/Exterior · suit required/);assert.match(html,/data-breathing-block="exterior"/);
  assert.match(html,/Use a suit or enter a breathable room/);
  assert.ok(!html.includes('Oxygen at this pressure'));assert.ok(!html.includes('Pressure</dt>'));
});

test('room telemetry retains breathable and exposes the exact shared status for safe and failed limits',()=>{
  const s=createGame(),r=s.sites.surface.rooms.reduce((largest,candidate)=>candidate.volume>largest.volume?candidate:largest);
  for(const options of [{},...failures.map(([,options])=>options)]) {
    gases(r,options);const before=digest(s),expected=breathingStatus(r),entity=observedRoom(s,r);
    assert.deepEqual(entity.derived.breathing,expected);assert.equal(entity.derived.breathable,expected.breathable);
    assert.equal(entity.oxygenFraction,r.oxygenFraction);assert.equal(entity.pressure,r.pressure);assert.equal(digest(s),before);
  }
});

test('normal-concentration low oxygen telemetry matches inspector and repeated reads preserve all state',()=>{
  const s=createGame(),r=s.sites.surface.rooms[0],nominal=r.volume*GAS_PER_TILE;
  gases(r,{pressure:76.4248,oxygenPressure:55.46668/350});
  const before=digest(s),expected=breathingStatus(r);
  for(let i=0;i<3;i++) {
    const entity=observedRoom(s,r),html=atmosphereDetails(r);
    assert.equal(entity.derived.breathable,false);assert.equal(entity.derived.breathing.block,'low_oxygen');
    assert.deepEqual(entity.derived.breathing,expected);assert.match(html,/20.7%/);assert.match(html,/15.85%/);
  }
  assert.equal(r.gas.oxygen,nominal*(55.46668/350));assert.equal(digest(s),before);
});

test('derived breathing observations are detached and add no persistent room fields',()=>{
  const s=createGame(),r=s.sites.surface.rooms[0],before=digest(s),keys=Object.keys(r).sort(),entity=observedRoom(s,r);
  const expected=breathingStatus(r);entity.derived.breathing.block='changed';entity.derived.breathing.oxygenPressure=0;
  assert.deepEqual(observedRoom(s,r).derived.breathing,expected);assert.deepEqual(Object.keys(r).sort(),keys);assert.equal(digest(s),before);
});
