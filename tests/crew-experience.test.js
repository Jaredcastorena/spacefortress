import test from 'node:test';
import assert from 'node:assert/strict';
import { gainExperience } from '../src/crew.js';

const learner = (level=0,xp=0) => ({skills:{husbandry:{level,xp}}});

test('completed fractional work promotes at its earned threshold without negative residual XP',()=>{
  const c=learner();let remaining=20,efforts=0;
  while(remaining>0){const effort=Math.min(remaining,.1);remaining-=effort;gainExperience(c,'husbandry',effort);efforts++;}
  assert.ok(efforts>100);assert.equal(remaining,0);
  assert.equal(c.skills.husbandry.level,1);assert.equal(c.skills.husbandry.xp,0);
});

test('threshold roundoff tolerance scales through later skill levels',()=>{
  for(const level of [0,3,9]){
    const threshold=20+level*15,c=learner(level,threshold-Number.EPSILON*threshold*4);
    gainExperience(c,'husbandry',0);
    assert.equal(c.skills.husbandry.level,level+1);assert.equal(c.skills.husbandry.xp,0);
  }
});

test('substantive below-threshold progress remains incomplete',()=>{
  for(const level of [0,3,9]){
    const threshold=20+level*15,c=learner(level,threshold-1e-8);
    gainExperience(c,'husbandry',1e-9);
    assert.equal(c.skills.husbandry.level,level);
    assert.ok(threshold-c.skills.husbandry.xp>8e-9);
  }
});

test('multiple earned promotions and the existing maximum XP cap retain their costs',()=>{
  const c=learner();gainExperience(c,'husbandry',55);
  assert.deepEqual(c.skills.husbandry,{level:2,xp:0});
  const expert=learner(9);gainExperience(expert,'husbandry',1000);
  assert.deepEqual(expert.skills.husbandry,{level:10,xp:170});
});
