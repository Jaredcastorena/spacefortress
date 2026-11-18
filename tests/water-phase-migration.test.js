import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION} from '../src/data.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {deserialize,serialize} from '../src/simulation.js';
import {refreshPower} from '../src/power.js';
import {syncResources} from '../src/inventory.js';
import {waterPhase} from '../src/water-thermal.js';
import {projectPreCompression,projectPreWaterHeat,projectPreWaterVapor} from './helpers/legacy-projection.js';

function historicalWetFault(){
 const s=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/water-phase-schema79.json.gz',import.meta.url))).toString()),site=s.sites.surface;
 const tile=site.tiles.find(t=>t.cable?.enabled&&t.cable.hp>0&&!t.building&&t.terrain==='floor'&&t.liquid===0),stock=site.tiles.find(t=>t.stock?.water>=.5);
 assert.ok(tile&&stock);stock.stock.water-=.5;tile.liquid=.5;tile.liquidHeat=95;site.liquids.released+=.5;site.thermal.waterLoaded+=95;
 // Explicit schema79 uses the historical all-liquid electrical preview.
 refreshPower(s,site,false);syncResources(s);assert.equal(tile.wetShort,true);
 return {s,tile,index:site.tiles.indexOf(tile)};
}

test('schema79 cold wet faults validate old power before phase-aware readings without spending charge',()=>{
 const {s,index}=historicalWetFault(),before=structuredClone(s.sites.surface),loaded=deserialize(serialize(s)),site=loaded.sites.surface,tile=site.tiles[index];
 assert.equal(loaded.version,VERSION);assert.equal(waterPhase(tile,{floor:true}).ice,.5);assert.equal(tile.wetShort,false);
 assert.ok(site.power.demand<before.power.demand);assert.deepEqual(site.energy,before.energy);
 assert.deepEqual(site.tiles.map(t=>t.charge),before.tiles.map(t=>t.charge));assert.deepEqual(projectPreWaterVapor(loaded).sites.surface.rooms,before.rooms);
 assert.deepEqual(site.liquids,before.liquids);assert.deepEqual(projectPreCompression(loaded).sites.surface.thermal,before.thermal);assert.equal(loaded.rng,s.rng);
 assert.equal(tile.liquid,before.tiles[index].liquid);assert.equal(tile.liquidHeat,before.tiles[index].liquidHeat);
 assert.equal(serialize(deserialize(serialize(loaded))),serialize(loaded));
});

test('schema79 cannot hide a forged old wet-fault power cache behind phase migration',()=>{
 for(const mutate of [s=>s.sites.surface.power.demand+=1,s=>s.sites.surface.tiles.find(t=>t.wetShort).wetShort=false]){
  const {s}=historicalWetFault();mutate(s);assert.throws(()=>deserialize(serialize(s)),/Power totals|equipment power state/);
 }
});

test('older untracked water can validate a wet circuit before adding its thermal baseline',()=>{
 const {s,index}=historicalWetFault(),old=projectPreWaterHeat(s);old.version=78;
 const loaded=deserialize(serialize(old)),site=loaded.sites.surface,tile=site.tiles[index];
 assert.equal(waterPhase(tile,{floor:true}).liquid,.5);assert.equal(tile.wetShort,true);
 assert.deepEqual(site.energy,old.sites.surface.energy);assert.equal(tile.liquid,old.sites.surface.tiles[index].liquid);
});
