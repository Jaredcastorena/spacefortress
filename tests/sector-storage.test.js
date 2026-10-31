import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,serialize,deserialize} from '../src/simulation.js';
import {executeAction} from '../src/controls.js';
import {validatePreflight} from '../src/preflight.js';
import {MAX_SAVE_BYTES} from '../src/data.js';
import {SECTOR_SAVE_HEADROOM} from '../src/sector-travel.js';
import {siteDefinition,settlementSite} from '../src/region.js';
import {sectorWorld} from '../src/sector-sites.js';

test('projected sector admission accounts for all declared floors and leaves the old colony intact at the save budget',()=>{
  const s=createGame(74257),planetId=siteDefinition(s,'surface').planetId,w=sectorWorld(s,planetId);
  s.satellites={[planetId]:{launchedAt:0,site:'surface',position:{x:16,y:11,z:0}}};
  // Retain one normally prepared destination so valid buildable floors can reach the budget.
  assert.ok(executeAction(s,'expedition.surveyed',{planetId,x:(w.landing.x+1)%w.width,y:w.landing.y}).ok);
  assert.ok(executeAction(s,'expedition.cancel_departure').ok);
  // Synthetic empty declared floors isolate storage capacity; no construction claim.
  let bytes=0;
  outer:for(const site of Object.values(s.sites).filter(settlementSite))for(let z=1;z<8;z++){
    site.levels.push({z,name:`Storage check ${z}`});
    for(let y=0;y<site.size;y++)for(let x=0;x<site.size;x++)site.tiles.push({x,y,z,terrain:'void',building:null,hp:100,drop:null,variant:(y*site.size+x)%4,powered:false,cable:null,circuit:null,powerStatus:null,wetShort:false,liquid:0,pipe:null,waterPipe:null});
    bytes=Buffer.byteLength(serialize(s));if(bytes>=MAX_SAVE_BYTES-SECTOR_SAVE_HEADROOM)break outer;
  }
  assert.ok(bytes>=MAX_SAVE_BYTES-SECTOR_SAVE_HEADROOM&&bytes<MAX_SAVE_BYTES,`fixture size ${bytes}`);
  const before=serialize(s);assert.ok(serialize(deserialize(before))===before,'large starting colony is valid');
  const result=executeAction(s,'expedition.surveyed',{planetId,x:(w.landing.x+2)%w.width,y:w.landing.y});
  assert.equal(result.reason,'sector_storage_capacity');assert.ok(serialize(s)===before);assert.equal(Object.keys(s.sectorSites).length,1);
});

test('prepared sector saves reject forged exploration flags and outbound travel without its reserved first-landing kit',()=>{
  const s=createGame(74257),planetId=siteDefinition(s,'surface').planetId,w=sectorWorld(s,planetId);
  s.satellites={[planetId]:{launchedAt:0,site:'surface',position:{x:16,y:11,z:0}}};
  const result=executeAction(s,'expedition.surveyed',{planetId,x:(w.landing.x+1)%24,y:w.landing.y});assert.ok(result.ok);
  delete s.sites[result.site].explored;assert.throws(()=>deserialize(serialize(s)),/sector site identity/);
  s.sites[result.site].explored=false;s.departure=null;s.mission={site:result.site,phase:'outbound',kitReserved:false};
  assert.throws(()=>validatePreflight(s),/requires its reserved kit/);
});
