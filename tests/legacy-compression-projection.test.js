import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {isDeepStrictEqual} from 'node:util';
import {deserialize} from '../src/simulation.js';
import {projectPreCompression,projectPreWaterVapor} from './helpers/legacy-projection.js';

const zero=()=>({allocated:0,work:0,motorRoom:0,motorSpace:0});
const fixture=()=>({version:82,sites:{surface:{gasWork:zero(),thermal:{compression:0,equipment:2},untouched:{value:7}}}});

test('compression projection removes only paired empty additions without changing input',()=>{
  const state=fixture(),before=structuredClone(state),expected=structuredClone(state);
  delete expected.sites.surface.gasWork;delete expected.sites.surface.thermal.compression;
  assert.deepEqual(projectPreCompression(state),expected);assert.deepEqual(state,before);
  assert.deepEqual(projectPreCompression(expected),expected);
});

test('compression projection exactly restores genuine schema81 including existing vapor history',()=>{
  const raw=gunzipSync(readFileSync(new URL('./fixtures/compression-schema81.json.gz',import.meta.url))).toString();
  const historical=JSON.parse(raw),current=deserialize(raw),projected=projectPreCompression(current);
  projected.version=81;
  assert.ok(historical.sites.surface.vapor.vacuumEvaporated>0);
  assert.ok(isDeepStrictEqual(projected,historical),'all historical quantities, heat, phase work and RNG survive');
});

test('compression projection rejects every nonzero and malformed counter without mutating input',()=>{
  for(const key of Object.keys(zero()))for(const value of [.001,-1,NaN,Infinity,null,undefined,'0']){
    const state=fixture();state.sites.surface.gasWork[key]=value;const before=structuredClone(state);
    assert.throws(()=>projectPreCompression(state),/compression history/);assert.deepEqual(state,before);
  }
  for(const value of [.001,-1,NaN,Infinity,null,undefined,'0']){
    const state=fixture();state.sites.surface.thermal.compression=value;
    assert.throws(()=>projectPreCompression(state),/compression history/);
  }
});

test('compression projection rejects incomplete pairs and malformed ledger shapes',()=>{
  for(const value of [null,[],{},0,'empty',{...zero(),extra:0}]){
    const state=fixture();state.sites.surface.gasWork=value;
    assert.throws(()=>projectPreCompression(state),/compression history/);
  }
  for(const key of Object.keys(zero())){
    const state=fixture();delete state.sites.surface.gasWork[key];
    assert.throws(()=>projectPreCompression(state),/compression history/);
  }
  for(const remove of [s=>delete s.sites.surface.gasWork,s=>delete s.sites.surface.thermal.compression]){
    const state=fixture();remove(state);assert.throws(()=>projectPreCompression(state),/compression history/);
  }
});

test('older vapor projection cannot silently discard compression history',()=>{
  const state=fixture();state.sites.surface.gasWork={allocated:3,work:1,motorRoom:2,motorSpace:0};state.sites.surface.thermal.compression=1;
  assert.throws(()=>projectPreWaterVapor(state),/compression history/);
});
