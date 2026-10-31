import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer, projectTile, projectGround, unprojectTile, projectedBounds, hexDirectionVector, compareHexDepth } from '../src/render.js';
import { DIRECTIONS, step, opposite, corners, edge, tileAt } from '../src/geometry.js';
import { createGame } from '../src/simulation.js';
import { gasDetails } from '../src/gas-panels.js';
import { plumbingDetails } from '../src/plumbing-panels.js';
import { breakerDetails } from '../src/breaker-panels.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} differs from ${b}`);
const grid=size=>({size,tiles:Array.from({length:size*size},(_,i)=>({x:i%size,y:Math.floor(i/size),z:0}))});
function graphics(){
  const renderer=Object.create(Renderer.prototype),lines=[],polygons=[];
  Object.assign(renderer,{w:1200,h:800,dpr:1,zoom:1,pan:{x:0,y:0},stars:[],cutaway:true});
  renderer.ctx=new Proxy({}, {get:(target,key)=>target[key]??(key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{})});
  renderer.line=(...args)=>lines.push(args);renderer.polygon=(...args)=>polygons.push(args);
  return {renderer,lines,polygons};
}

test('pure hex view: center and six edge/corner picks survive pan, zoom and DPR',()=>{
  const site=grid(6),{renderer}=graphics();
  for(const zoom of [.35,1,2.2])for(const dpr of [1,2])for(const pan of [{x:0,y:0},{x:-137,y:83}]){
    Object.assign(renderer,{zoom,dpr,pan});const origin=renderer.origin(site);
    const pick=([x,y])=>renderer.screenToTile(origin.x+x*zoom,origin.y+y*zoom,site);
    for(const cell of site.tiles){
      const [x,y]=projectTile(cell.x,cell.y);assert.deepEqual(pick([x,y]),cell);
      assert.deepEqual(unprojectTile(x,y),[cell.x,cell.y]);
      for(const direction of DIRECTIONS){
        const neighbor=step(cell.x,cell.y,direction),[nx,ny]=projectTile(...neighbor);
        assert.deepEqual(pick([x+(nx-x)*.499,y+(ny-y)*.499]),cell);
        assert.deepEqual(pick([x+(nx-x)*.501,y+(ny-y)*.501]),tileAt(site,...neighbor));
      }
      for(const vertex of corners(cell.x,cell.y)){
        const [vx,vy]=projectGround(...vertex);
        assert.deepEqual(pick([x+(vx-x)*.999,y+(vy-y)*.999]),cell);
      }
    }
  }
});

test('pure hex view: projected bounds contain every tile and center the complete map',()=>{
  const {renderer}=graphics();
  for(const size of [1,2,5,6,24]){
    const site=grid(size),bounds=projectedBounds(size),points=site.tiles.flatMap(t=>corners(t.x,t.y).map(p=>projectGround(...p)));
    close(bounds.left,Math.min(...points.map(p=>p[0])));close(bounds.right,Math.max(...points.map(p=>p[0])));
    close(bounds.top,Math.min(...points.map(p=>p[1])));close(bounds.bottom,Math.max(...points.map(p=>p[1])));
    const origin=renderer.origin(site);close(origin.x+(bounds.left+bounds.right)/2,renderer.w/2);close(origin.y+(bounds.top+bounds.bottom)/2,renderer.h/2);
  }
});

test('pure hex view: shared edges, six arrow directions and depth match ground geometry',()=>{
  for(const x of [2,3])for(const direction of DIRECTIONS){
    const neighbor=step(x,3,direction),a=edge(x,3,direction).map(p=>projectGround(...p)),b=edge(...neighbor,opposite(direction)).map(p=>projectGround(...p)).reverse();
    a.forEach((p,i)=>p.forEach((v,j)=>close(v,b[i][j])));
    const center=projectTile(x,3),next=projectTile(...neighbor),vector=hexDirectionVector(direction);
    close(next[0]-center[0],vector[0]);close(next[1]-center[1],vector[1]);
  }
  const sorted=grid(6).tiles.reverse().sort(compareHexDepth);
  for(let i=1;i<sorted.length;i++)assert.ok(projectTile(sorted[i].x,sorted[i].y)[1]>=projectTile(sorted[i-1].x,sorted[i-1].y)[1]);
  const {renderer,polygons}=graphics();renderer.hexPrism(20,30,32,'top','left','right');
  assert.equal(polygons.filter(p=>p[0].length===6).length,1);assert.equal(polygons.filter(p=>p[0].length===4).length,3);
});

function scene(){
  const s=createGame();s.crew=[];s.creatures=[];s.jobs=[];
  const site=s.sites.surface;
  // An isolated view fixture keeps domain behavior in its owners' tests.
  // Each draw focuses its test fitting so viewport culling cannot hide the ports.
  for(const t of site.tiles)Object.assign(t,{terrain:'floor',building:null,pipe:null,waterPipe:null,waterDevice:null,gasDevice:null,gasStore:null,waterStore:null,cable:null,airlock:null,airlockOwner:null});
  site.rooms=[];return {s,site};
}
const gasPipe=()=>({gas:{oxygen:0,inert:0,co2:0},smoke:0,open:true,hp:100});
const waterPipe=()=>({water:0,open:true,hp:100});

test('integrated hex view: gas and water branches draw all six edges without observing mutations',()=>{
  for(const overlay of ['gasOverlay','waterOverlay'])for(const x of [4,5]){
    const {s,site}=scene(),t=tileAt(site,x,4),field=overlay==='gasOverlay'?'pipe':'waterPipe',make=overlay==='gasOverlay'?gasPipe:waterPipe;
    t[field]=make();for(const direction of DIRECTIONS)tileAt(site,...step(x,4,direction))[field]=make();
    const before=structuredClone(s),{renderer,lines}=graphics();renderer[overlay]=true;renderer.focus(site,t);renderer.draw(s,'surface','inspect',null);
    const [cx,cy]=projectTile(x,4),color=overlay==='gasOverlay'?'#82dbe2':'#82baf4';
    const branches=lines.filter(l=>l[0]===cx&&l[1]===cy&&l[4]===color);assert.equal(branches.length,6);
    for(const direction of DIRECTIONS){const [dx,dy]=hexDirectionVector(direction,.5);assert.ok(branches.some(l=>Math.abs(l[2]-cx-dx)<1e-8&&Math.abs(l[3]-cy-dy)<1e-8));}
    assert.deepEqual(s,before);
  }
});

test('integrated hex view: directional device controls expose six logical IDs',()=>{
  const {s,site}=scene(),t=tileAt(site,4,4);
  const panels=[
    ()=>{Object.assign(t,{building:'gasPump',gasDevice:{enabled:true,direction:'ne'}});return gasDetails(site,t);},
    ()=>{Object.assign(t,{building:'waterPump',waterDevice:{enabled:true,direction:'ne'}});return plumbingDetails(s,site,t);},
    ()=>{Object.assign(t,{building:'breaker',protection:{enabled:false,direction:'ne',mode:'manual',tripped:false}});return breakerDetails(s,site,t);}
  ];
  for(const panel of panels){const html=panel();assert.deepEqual([...html.matchAll(/data-direction="([^"]+)"/g)].map(m=>m[1]),DIRECTIONS);assert.doesNotMatch(html,/undefined|data-direction="(?:north|south|east|west)"/);}
});

test('integrated hex view: pumps show only their opposite ports in all six orientations',()=>{
  for(const field of ['gas','water'])for(const x of [4,5])for(const direction of DIRECTIONS){
    const {s,site}=scene(),t=tileAt(site,x,4),pipe=field==='gas'?'pipe':'waterPipe',make=field==='gas'?gasPipe:waterPipe;
    t.building=field==='gas'?'gasPump':'waterPump';t[`${field}Device`]={enabled:true,direction};
    for(const side of DIRECTIONS)tileAt(site,...step(x,4,side))[pipe]=make();
    const {renderer,lines}=graphics();renderer[`${field}Overlay`]=true;renderer.focus(site,t);renderer.draw(s,'surface','inspect',null);
    const [cx,cy]=projectTile(x,4),color=field==='gas'?'#82dbe2':'#82baf4';
    const branches=lines.filter(l=>l[0]===cx&&l[1]===cy&&l[4]===color);assert.equal(branches.length,2);
    for(const side of [direction,opposite(direction)]){const [dx,dy]=hexDirectionVector(side,.5);assert.ok(branches.some(l=>Math.abs(l[2]-cx-dx)<1e-8&&Math.abs(l[3]-cy-dy)<1e-8));}
  }
  const {s,site}=scene(),a=tileAt(site,4,4),b=tileAt(site,...step(4,4,'ne'));
  for(const t of [a,b])Object.assign(t,{building:'gasPump',gasDevice:{enabled:true,direction:'ne'}});
  const {renderer,lines}=graphics();renderer.gasOverlay=true;renderer.focus(site,a);renderer.draw(s,'surface','inspect',null);
  const [x,y]=projectTile(a.x,a.y);assert.equal(lines.filter(l=>l[0]===x&&l[1]===y&&l[4]==='#82dbe2').length,0,'Two adjacent pumps do not create a passive gas connection');
});

test('integrated hex view: room perimeter and remote fence use six neighbors from the displayed site',()=>{
  const {s,site}=scene(),t=tileAt(site,4,4);site.rooms=[{cells:['4,4']}];
  const view=graphics();view.renderer.selection={site:'surface',x:4,y:4};view.renderer.focus(site,t);view.renderer.draw(s,'surface','inspect',null);
  assert.equal(view.lines.filter(l=>l[4]==='#a5dcc5').length,6);
  const remote=grid(9);t.building='fence';remote.tiles[4*9+4]={...t};
  for(const direction of DIRECTIONS)tileAt(remote,...step(4,4,direction)).building='wall';
  const {renderer,lines}=graphics(),[x,y]=projectTile(4,4);renderer.structure(t,x,y,s,null,remote);
  assert.equal(lines.filter(l=>l[4]==='#a4b79d').length,12);
});
