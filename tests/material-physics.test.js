import test from 'node:test';
import assert from 'node:assert/strict';
import {neighbors} from '../src/hex.js';
import {tileAt} from '../src/spatial.js';
import {updateRooms,roomAt} from '../src/atmosphere.js';
import {initializeThermal,updateThermal,validateThermal,HEAT_CAPACITY} from '../src/thermal.js';
import {installMaterial} from '../src/materials.js';
import {damage} from '../src/maintenance.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
// Synthetic enclosed cells isolate conductivity, without construction grants
// or an ordinary habitat/endurance claim. The native suite owns paid assembly.
function fixture(){
 const size=7,site={id:'surface',size,levels:[{z:0},{z:1}],tiles:[],rooms:[],incidents:[],verticalLinks:[],fireSafety:{smokeVented:0,smokeCleared:0}};
 for(const {z} of site.levels)for(let y=0;y<size;y++)for(let x=0;x<size;x++)site.tiles.push({x,y,z,terrain:'ground',building:null,hp:100,powered:false});
 for(const {z} of site.levels){tileAt(site,{x:3,y:3,z}).terrain='floor';for(const [x,y] of neighbors(3,3))tileAt(site,{x,y,z}).building='wall';}
 updateRooms(site);const s={tick:0,sites:{surface:site},crew:[],log:[]};initializeThermal(s);
 return {s,site,lower:roomAt(site,3,3,0),upper:roomAt(site,3,3,1),slab:tileAt(site,{x:3,y:3,z:1}),wall:tileAt(site,{x:neighbors(3,3)[0][0],y:neighbors(3,3)[0][1],z:0})};
}
function temperature(f,room,value){const next=(value+273.15)*HEAT_CAPACITY*room.volume,delta=next-room.heat;f.site.thermal[delta>0?'added':'removed']+=Math.abs(delta);room.heat=next;}
function tick(f){const before=f.site.rooms.reduce((n,r)=>n+r.heat,0),inflow=f.site.thermal.environmentIn,outflow=f.site.thermal.environmentOut,gas=JSON.stringify(f.site.rooms.map(r=>r.gas));updateThermal(f.s);const after=f.site.rooms.reduce((n,r)=>n+r.heat,0);close(after,before+f.site.thermal.environmentIn-inflow-(f.site.thermal.environmentOut-outflow));assert.equal(JSON.stringify(f.site.rooms.map(r=>r.gas)),gas);validateThermal(f.s);}

for(const direction of ['up','down'])test(`solid slabs transfer finite heat ${direction}; composite reduces only that link`,()=>{
 const alloy=fixture(),composite=fixture();installMaterial(composite.slab,'floor','composite');
 for(const f of [alloy,composite]){temperature(f,f.lower,direction==='up'?40:0);temperature(f,f.upper,direction==='up'?0:40);tick(f);}
 const difference=40*.015*.75;close(composite.lower.heat-alloy.lower.heat,direction==='up'?difference:-difference);close(composite.upper.heat-alloy.upper.heat,direction==='up'?-difference:difference);
});

for(const mode of ['open','closed'])test(`${mode} stair hatch uses its own heat path without a duplicate insulating slab`,()=>{
 const a=fixture(),b=fixture();installMaterial(b.slab,'floor','composite');
 for(const f of [a,b]){const lower={x:3,y:3,z:0},upper={x:3,y:3,z:1};f.site.verticalLinks=[{id:'vertical-1',kind:'stairwell',lower,upper,hp:100,mode,openUntil:0}];for(const p of [lower,upper])tileAt(f.site,p).verticalLink='vertical-1';temperature(f,f.lower,40);temperature(f,f.upper,0);tick(f);}
 close(a.lower.heat,b.lower.heat);close(a.upper.heat,b.upper.heat);
});

for(const state of ['intact','damaged','open','broken'])test(`composite ${state} wall or door changes solid conduction without insulating gaps`,()=>{
 const a=fixture(),b=fixture();
 for(const f of [a,b]){f.wall.building='door';f.wall.doorMode=state==='open'?'open':'closed';f.wall.doorUntil=0;f.wall.hp=state==='broken'?0:state==='damaged'?50:100;temperature(f,f.lower,40);}
 installMaterial(b.wall,'structure','composite');tick(a);tick(b);
 const difference=['open','broken'].includes(state)?0:32*.015*.75;close(b.lower.heat-a.lower.heat,difference);
});

test('material resistance affects only structure damage and leaves cable damage and floor ownership independent',()=>{
 const f=fixture();f.wall.terrain='floor';installMaterial(f.wall,'floor','composite');installMaterial(f.wall,'structure','composite');f.wall.cable={hp:100,enabled:true};
 damage(f.s,f.site,f.wall,'structure',20,'debris');assert.equal(f.wall.hp,88);assert.equal(f.wall.cable.hp,100);
 damage(f.s,f.site,f.wall,'cable',20,'debris');assert.equal(f.wall.cable.hp,80);assert.equal(f.wall.hp,88);assert.deepEqual(f.wall.materials,{floor:'composite',structure:'composite'});
});
