import assert from 'node:assert/strict';
import {fixture,CONFIG,STAGING} from './airlock-fixture.js';
import {tileAt} from '../../src/spatial.js';
import {updateRooms,refreshAtmosphere,roomAt} from '../../src/atmosphere.js';
import {initializeThermal} from '../../src/thermal.js';
import {refreshPower} from '../../src/power.js';
import {executeAction} from '../../src/controls.js';

export const upperTarget={site:'surface',x:CONFIG.x,y:CONFIG.y,z:1};
export function floorRefs(s,z=1){const site=s.sites.surface,tile=(x,y)=>tileAt(site,{x,y,z});return {s,site,tile,controller:tile(CONFIG.x,CONFIG.y),crew:s.crew[0],chamber:roomAt(site,...CONFIG.chamber,z),habitat:roomAt(site,...STAGING.inner,z),inner:tile(...CONFIG.inner),outer:tile(...CONFIG.outer),reservoir:tile(...CONFIG.reservoir),pump:tile(...CONFIG.pump),extractor:tile(...CONFIG.extractor),vent:tile(...CONFIG.vent)};}
// SYNTHETIC subsystem boundary: two explicitly installed, finite assemblies.
// No claim of paid construction or ordinary colony endurance is made here.
export function floorFixture({configure=true}={}){
 const base=fixture({configure:false}),{s,site}=base,blank=site.tiles.find(t=>!t.building&&!t.cable&&!t.pipe&&t.terrain==='ground');
 const permitted=new Set(['wall','door','airlockController','gasExtractor','gasPump','gasReservoir','gasVent','solar','battery']);
 const upper=site.tiles.map(t=>{const keep=(!t.building||permitted.has(t.building))&&(permitted.has(t.building)||t.cable||t.pipe||t.terrain==='floor'),n=structuredClone(keep?t:blank);Object.assign(n,{x:t.x,y:t.y,z:1,terrain:keep?'floor':'void'});if(!keep)n.building=null;return n;});
 site.levels.push({z:1,name:'Upper deck'});site.tiles.push(...upper);const f=floorRefs(s);f.tile(...STAGING.outer).terrain='floor';
 site.energy.initial+=upper.reduce((sum,t)=>sum+(t.charge||0),0);
 for(const t of upper)if(t.gasStore)for(const k of ['oxygen','inert','co2'])site.gasNetwork.loaded[k]+=t.gasStore.gas[k];
 updateRooms(site);initializeThermal(s);Object.assign(f,floorRefs(s));
 for(const [room,old] of [[f.chamber,base.chamber],[f.habitat,base.habitat]]){room.gas=structuredClone(old.gas);room.smoke=old.smoke;room.heat=old.heat;site.fireSafety.smokeProduced+=room.smoke;}
 refreshAtmosphere(site);s.crew[0].z=1;refreshPower(s,site);
 if(configure){assert.equal(executeAction(s,'airlock.configure',CONFIG).ok,true);const r=executeAction(s,'airlock.configure',{...CONFIG,z:1});assert.equal(r.ok,true,r.message);}
 return f;
}
export function stairToHabitat(f){const [x,y]=STAGING.inner,link={id:`vertical-${f.s.nextId++}`,kind:'stairwell',lower:{x,y,z:0},upper:{x,y,z:1},hp:100,mode:'auto',openUntil:0};f.site.verticalLinks.push(link);for(const p of [link.lower,link.upper])tileAt(f.site,p).verticalLink=link.id;return link;}
export function upperCommand(f,action,args={}){return executeAction(f.s,'airlock.'+action,{...upperTarget,...args});}
