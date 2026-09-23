import { BREEDING } from './breeding.js';
import { immobile } from './mobility.js';
import { at, inside, key, isDay, roomAt } from './simulation.js';
import { routeTime } from './expedition.js';
import { electrical } from './power.js';
import { buildPowerTopology, POWER_DIRECTIONS, breakerContactClosed } from './power-topology.js';
import { WATER_DIRECTIONS, waterNode, waterCapacity } from './plumbing.js';
import { GAS_DIRECTIONS, gasNode, gasCapacity, gasPayload } from './gas-networks.js';
import { SITES } from './data.js';
import { crewSprite, ANATOMIES } from './sprites.js';

import { doorOpen } from './atmosphere.js';
import { quantity } from './inventory.js';

const T = 32, H = 16;
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.zoom = 1; this.pan = { x: 0, y: 0 }; this.cutaway = true; this.powerOverlay = false; this.gasOverlay = false; this.waterOverlay = false; this.hover = null; this.selection = null;
    this.spriteCache = new Map(); this.stars = Array.from({ length: 180 }, (_, i) => ({ x: ((i * 7919) % 1009) / 1009, y: ((i * 3571) % 1013) / 1013, a: .1 + (i % 5) * .07, r: i % 17 === 0 ? 1.4 : .7 }));
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas); this.resize();
  }
  resize() { const r = this.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); this.w = r.width; this.h = r.height; this.dpr = dpr; this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr); }
  center() { this.pan = { x: 0, y: 0 }; this.zoom = Math.min(1.1, Math.max(.5, this.w / 900)); }
  origin(site) { return { x: this.w / 2 + this.pan.x, y: this.h / 2 - (site.size - 1) * H * this.zoom + 60 + this.pan.y }; }
  project(x, y) { return [(x - y) * T, (x + y) * H]; }
  screenToTile(px, py, site) { const o = this.origin(site), x = (px - o.x) / this.zoom, y = (py - o.y) / this.zoom; return { x: Math.floor((x / T + y / H) / 2 + .5), y: Math.floor((y / H - x / T) / 2 + .5) }; }
  polygon(points, fill, stroke) { const c = this.ctx; c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = .7; c.stroke(); } }
  diamond(x, y, fill, stroke) { this.polygon([[x, y - H], [x + T, y], [x, y + H], [x - T, y]], fill, stroke); }
  box(x, y, w, d, h, top, left, right) {
    this.polygon([[x - w, y - h], [x, y + d - h], [x, y + d], [x - w, y]], left);
    this.polygon([[x, y + d - h], [x + w, y - h], [x + w, y], [x, y + d]], right);
    this.polygon([[x, y - d - h], [x + w, y - h], [x, y + d - h], [x - w, y - h]], top);
  }
  line(x1, y1, x2, y2, color, width = 1) { const c = this.ctx; c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  crewSprite(color) {
    if (this.spriteCache.has(color)) return this.spriteCache.get(color);
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 30; const c = canvas.getContext('2d');
    c.fillStyle = '#15252f'; c.fillRect(3, 12, 14, 12); c.fillRect(4, 24, 5, 6); c.fillRect(12, 24, 5, 6);
    c.fillStyle = color; c.fillRect(4, 11, 12, 14); c.fillRect(2, 14, 3, 10); c.fillRect(16, 14, 3, 10); c.fillRect(5, 3, 10, 10); c.fillRect(3, 6, 14, 7);
    c.fillStyle = '#d9e2d6'; c.fillRect(6, 2, 8, 3); c.fillRect(7, 14, 6, 2); c.fillRect(5, 20, 10, 2);
    c.fillStyle = '#173943'; c.fillRect(5, 6, 11, 5); c.fillStyle = '#76ccd1'; c.fillRect(6, 6, 8, 2); c.fillStyle = '#eff6de'; c.fillRect(6, 6, 2, 2);
    c.fillStyle = '#374c55'; c.fillRect(8, 17, 4, 2); c.fillRect(5, 25, 4, 3); c.fillRect(12, 25, 4, 3);
    this.spriteCache.set(color, canvas); return canvas;
  }
  backdrop(siteId) {
    const c = this.ctx; c.fillStyle = '#0b161f'; c.fillRect(0, 0, this.w, this.h);
    const gradient = c.createRadialGradient(this.w * .5, this.h * .5, 0, this.w * .5, this.h * .5, this.w * .7); gradient.addColorStop(0, siteId === 'surface' ? '#21313988' : '#1a37434d'); gradient.addColorStop(1, '#07101900'); c.fillStyle = gradient; c.fillRect(0, 0, this.w, this.h);
    for (const s of this.stars) { c.fillStyle = `rgba(164,200,209,${s.a})`; c.fillRect(s.x * this.w, s.y * this.h, s.r, s.r); }
    if (siteId !== 'surface' && siteId !== 'universe') {
      c.save(); c.globalAlpha = .16; c.beginPath(); c.arc(this.w * .87, this.h * .92, this.w * .36, 0, Math.PI * 2); c.fillStyle = siteId === 'solar' ? '#d28a39' : '#679097'; c.fill(); c.strokeStyle = '#b1d6dc'; c.lineWidth = 3; c.stroke(); c.restore();
    }
  }
  draw(s, siteId, mode, build) {
    const c = this.ctx; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.imageSmoothingEnabled = false; this.backdrop(siteId);
    if (siteId === 'universe') { this.universe(s); return; }
    const site = s.sites[siteId], origin = this.origin(site); c.save(); c.translate(origin.x, origin.y); c.scale(this.zoom, this.zoom);
    const selectedRoom = mode === 'inspect' && Number.isInteger(this.selection?.x) && Number.isInteger(this.selection?.y) ? roomAt(site, this.selection.x, this.selection.y) : null;
    const selectedCells = new Set(selectedRoom?.cells || []);
    const tileColors = { ground: ['#61564a', '#66594b', '#5b5147', '#6a5e4f'], floor: ['#6e8080', '#748585', '#718282', '#6b7c7e'], deck: ['#465b65', '#4d626d', '#516570', '#435964'], ice: ['#7d9fba', '#90aec6', '#779ab4', '#82a5be'], ore: ['#5c5346', '#665645', '#605246', '#68574a'], rock: ['#64594d', '#5a5147', '#685b4e', '#62574a'] };
    for (const t of site.tiles) {
      if (t.terrain === 'void') continue;
      const [x, y] = this.project(t.x, t.y);
      this.box(x, y + 5, T, H, 5, tileColors[t.terrain][t.variant], t.terrain === 'ice' ? '#4c718e' : '#3e4140', '#343b3c');
      this.diamond(x, y, tileColors[t.terrain][t.variant], t.terrain === 'floor' ? '#8f9d923d' : '#a5aa9417');
      if (selectedCells.has(key(t.x, t.y))) this.diamond(x, y, '#93d5c218');
      if (t.terrain === 'floor' || t.terrain === 'deck') { c.fillStyle = '#b2c0af42'; c.fillRect(x - 1, y - 12, 2, 1); c.fillRect(x - 24, y, 2, 1); }
      if (t.terrain === 'ground') { c.fillStyle = '#b59a702b'; c.fillRect(x - 15 + t.variant * 5, y - 3 + t.variant, 3, 1); }
      if (t.lichen > 10) { for (let i = 0; i < 4; i++) { c.fillStyle = ['#98a076', '#788765', '#a6a778', '#748468'][i]; c.fillRect(x - 12 + i * 7, y - 2 + i % 2 * 4, 6, 2); } }
    }
    for (const cell of selectedCells) {
      const [tx,ty] = cell.split(',').map(Number), [x,y] = this.project(tx,ty);
      for (const [nx,ny,ax,ay,bx,by] of [[tx+1,ty,x+T,y,x,y+H],[tx-1,ty,x-T,y,x,y-H],[tx,ty+1,x-T,y,x,y+H],[tx,ty-1,x+T,y,x,y-H]]) if (!selectedCells.has(key(nx,ny))) this.line(ax,ay,bx,by,'#a5dcc5',2);
    }
    const pending = new Map(s.jobs.filter(j => j.site === siteId).map(j => [key(j.x, j.y), j]));
    const reservedTiles = new Set();
    for (const j of pending.values()) {
      if (quantity(j.materials)) reservedTiles.add(key(j.x, j.y));
      for (const source of j.sources) if (quantity(source.items)) reservedTiles.add(key(source.x, source.y));
    }
    const crew = s.crew.filter(p => p.site === siteId);
    const sorted = [...site.tiles].sort((a, b) => a.x + a.y - b.x - b.y || a.x - b.x);
    for (const t of sorted) {
      const [x, y] = this.project(t.x, t.y);
      if (t.terrain === 'rock') { const h = 12 + t.variant * 5; this.box(x, y, 26, 13, h, '#8a7963', '#685b4e', '#4b4842'); this.line(x - 12, y - h - 5, x + 2, y - h + 3, '#a49375'); }
      if (t.terrain === 'ore') { this.box(x, y, 22, 10, 11, '#897563', '#6d5744', '#4c473b'); for (let k = 0; k < 3; k++) { c.fillStyle = ['#ce9863', '#dfb777', '#b78052'][k]; c.fillRect(x - 14 + k * 10, y - 17 + (k % 2) * 5, 6, 4); } }
      if (t.deposit?.remaining > 0) { const h = 4 + t.deposit.remaining / 2; this.box(x,y,19,9,h,'#b9d8de','#7aaebf','#4c788c'); this.line(x-12,y-h-2,x+5,y-h+4,'#e0eff0',2); this.line(x+5,y-h+4,x+10,y-h-2,'#668fa5',2); }
      if(t.liquid>1e-8){c.save();c.globalAlpha=Math.min(.8,.2+t.liquid/4*.6);this.diamond(x,y,'#3b94ba','#8bcee0');this.line(x-12,y,x+2,y+7,'#b2deeb',1);c.restore();}
      if (t.building) this.structure(t, x, y, s);
      if(waterNode(t)?.water>0&&(t.waterPipe?.hp??t.hp)<50){this.polygon([[x+17,y-19],[x+13,y-11],[x+17,y-8],[x+21,y-11]],'#89c7f1','#eeaa82');}
      if(t.wetShort){this.line(x-9,y-2,x-2,y-12,'#ffd390',2);this.line(x-2,y-12,x+2,y-3,'#ffc276',2);this.line(x+2,y-3,x+10,y-15,'#ffb35e',2);}
      const smokeRoom=roomAt(site,t.x,t.y);
      if(smokeRoom?.smoke>0){const density=smokeRoom.smoke/smokeRoom.volume;c.save();c.globalAlpha=Math.min(.4,density*3);this.box(x,y-14,20,10,5,'#a29b8f','#716d69','#595d60');c.restore();}
      if(t.fire){const h=16+t.fire.intensity*.22+(s.tick%3)*2;this.polygon([[x-14,y-4],[x-8,y-h],[x-1,y-h+12],[x+8,y-h-8],[x+15,y-4],[x,y+3]],'#ee7938','#ffb761');this.polygon([[x-6,y-3],[x+1,y-h+12],[x+8,y-4],[x,y+1]],'#ffe0a0');}

      for (const creature of s.creatures.filter(a => a.site === siteId && a.x === t.x && a.y === t.y)) {
        if (creature.species === 'bristleback') {
          const escorted=s.jobs.some(j=>j.kind==='animalLead'&&j.animal===creature.id&&j.phase==='escort');
          c.save();if(escorted)c.translate(-18,8);if(creature.health<=0)c.globalAlpha=.35;
          if(creature.lifecycle?.growth<BREEDING.maturity){const scale=.55+.45*creature.lifecycle.growth/BREEDING.maturity;c.translate(x,y);c.scale(scale,scale);c.translate(-x,-y);}
          c.fillStyle = '#303c35'; for (let i = 0; i < 3; i++) { c.fillRect(x - 14 + i * 10, y - 2, 4, 10); c.fillRect(x - 16 + i * 10, y - 10, 3, 8); }
          this.box(x, y - 1, 18, 9, 13, '#ab9b71', '#817955', '#5b604d');
          this.box(x - 13, y - 5, 10, 5, 10, '#c0b088', '#978c61', '#6e7254');
          c.fillStyle = '#d3c5a0'; c.fillRect(x - 22, y - 18, 2, 7); c.fillRect(x - 17, y - 20, 2, 7); c.fillStyle = '#182d31'; c.fillRect(x - 21, y - 9, 3, 2);
          for (let i = 0; i < 3; i++) this.line(x - 7 + i * 7, y - 16 + i * 3, x - 7 + i * 7, y - 10 + i * 3, '#d6bb83', 1);
          if(escorted){this.line(x-19,y-10,x+12,y-22,'#8ee4d7',2);}
          if(creature.lifecycle?.brood){c.fillStyle='#e8bf85';c.fillRect(x+2,y-5,4,4);c.fillRect(x+9,y-2,4,4);}
          if(creature.husbandry?.trust===100){c.fillStyle='#82d6c1';c.fillRect(x-19,y-17,5,3);}c.restore();
        } else { this.box(x, y, 5, 3, 4, '#e8c9b0', '#b38e77', '#866e65'); c.fillStyle = '#a5d3ac'; c.fillRect(x - 2, y - 5, 3, 2); this.line(x - 5, y - 1, x - 9, y - 4, '#c9baa3'); this.line(x - 5, y + 1, x - 9, y + 3, '#c9baa3'); }
      }
      if (t.drop) { this.box(x, y, 10, 5, 7, '#d5ae75', '#91704e', '#6c5944'); }
      if (t.machine && Object.values(t.machine.output).some(n => n > 0)) this.box(x + 19, y + 7, 7, 4, 6, '#a7ceb7', '#678c81', '#425e61');
      if (reservedTiles.has(key(t.x, t.y))) this.box(x - 18, y + 6, 7, 4, 6, '#d2b9db', '#92769d', '#605071');
      const job = pending.get(key(t.x, t.y));
      if (job) { c.globalAlpha = .55; this.diamond(x, y, job.kind === 'build' ? '#5ac9c144' : '#e3ae6055', '#edc882'); c.globalAlpha = 1; c.fillStyle = '#e7d09a'; c.font = '14px monospace'; c.textAlign = 'center'; c.fillText(job.kind === 'build' ? '+' : job.kind === 'mine' ? '⌁' : job.kind === 'operate' ? '⚙' : '×', x, y + 4); if (job.worker) { c.fillStyle = '#18242c'; c.fillRect(x - 16, y + 12, 32, 3); c.fillStyle = '#a7d6ba'; c.fillRect(x - 16, y + 12, 32 * (1 - job.remaining / job.work), 3); } }
      for (const person of crew.filter(p => p.x === t.x && p.y === t.y)) {
        c.fillStyle = '#0b182d55'; c.beginPath(); c.ellipse(x, y + 3, 10, 5, 0, 0, Math.PI * 2); c.fill();
        if (person.health <= 0 || immobile(person)) { const transported = s.crew.some(helper => helper.rescue?.carrying && helper.rescue.patient === person.id); if (transported) this.box(x + 19, y + 8, 18, 8, 5, '#a7c0b4', '#6b8987', '#405e69'); c.save(); c.translate(x + (transported ? 19 : 0), y + (transported ? 5 : 0)); c.rotate(Math.PI / 2); c.globalAlpha = person.health <= 0 ? .65 : 1; c.drawImage(crewSprite(person.color, ANATOMIES[Number(person.id.split('-')[1]) % ANATOMIES.length]), -19, -26); c.restore(); }
        else c.drawImage(crewSprite(person.color, ANATOMIES[Number(person.id.split('-')[1]) % ANATOMIES.length], !!person.job), x - 19, y - 48);
        if (person.carry) this.box(x + 12, y - 10, 6, 3, 7, '#dcc290', '#8c8869', '#596865');
        if (person.oxygen < 30) { c.fillStyle = '#ee957b'; c.font = 'bold 12px monospace'; c.fillText('!', x, y - 52); }
        if (this.selection?.crew === person.id) { this.diamond(x, y, null, '#baf2da'); c.fillStyle = '#d8eee1'; c.font = '10px monospace'; c.textAlign = 'center'; c.fillText(person.name.split(' ')[0], x, y - 56); }
      }
    }
    if(this.powerOverlay||(mode==='build'&&['cable','breaker'].includes(build))){
      if(this.powerGraphSite!==site||this.powerGraphCircuits!==site.circuits){this.powerGraph=buildPowerTopology(site);this.powerGraphSite=site;this.powerGraphCircuits=site.circuits;}
      const graph=this.powerGraph,color=id=>`hsl(${(Number(id?.split('-')[1])*47+(id?.endsWith('-input')?17:id?.endsWith('-output')?83:0))%360} 65% 72%)`;
      const point=v=>{const [x,y]=this.project(v.tile.x,v.tile.y);if(!v.terminal)return [x,y];const [dx,dy]=POWER_DIRECTIONS[v.tile.protection.direction],f=v.terminal==='input'?-1:1;return [x+(dx-dy)*11*f,y+(dx+dy)*5.5*f];};
      for(const [id,neighbors] of graph.adjacency){const a=graph.vertices.get(id),[x,y]=point(a);for(const next of neighbors){if(id>=next)continue;const [nx,ny]=point(graph.vertices.get(next));this.line(x,y,nx,ny,'#17313b',6);this.line(x,y,nx,ny,color(graph.membership.get(id)),3);}}
      for(const [id,v] of graph.vertices){const [x,y]=point(v),t=v.tile,col=t.cable&&(!t.cable.enabled||!t.cable.hp)?'#ec8e7e':color(graph.membership.get(id));c.fillStyle=col;
        if(v.terminal==='output'){const [dx,dy]=POWER_DIRECTIONS[t.protection.direction],vx=(dx-dy)*6,vy=(dx+dy)*3,len=Math.hypot(vx,vy),ux=vx/len,uy=vy/len;this.polygon([[x+vx,y+vy],[x-vx-uy*4,y-vy+ux*4],[x-vx+uy*4,y-vy-ux*4]],col,'#17313b');}
        else{c.fillRect(x-3,y-3,6,6);}
      }
    }
    if (this.gasOverlay || (mode === 'build' && ['gasPipe','gasTank','gasPump','gasVent','gasExtractor','gasReservoir'].includes(build))) {
      const accepts=(t,dx,dy)=>{
        if(gasNode(t))return true;
        if(t?.building!=='gasPump')return false;
        const [px,py]=GAS_DIRECTIONS[t.gasDevice.direction];return dx*py===dy*px;
      };
      for(const t of site.tiles){
        if(!gasNode(t)&&t.building!=='gasPump')continue;
        const [x,y]=this.project(t.x,t.y),node=gasNode(t),hp=t.pipe?.hp??t.hp;
        const color=hp<50?'#f49883':node&&!node.open?'#edc174':t.gasDevice?.enabled===false?'#899ba8':'#82dbe2';
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const neighbor=inside(site,t.x+dx,t.y+dy)?at(site,t.x+dx,t.y+dy):null;
          if(accepts(t,dx,dy)&&accepts(neighbor,dx,dy)){
            this.line(x,y,x+(dx-dy)*T/2,y+(dx+dy)*H/2,'#173644',7);
            this.line(x,y,x+(dx-dy)*T/2,y+(dx+dy)*H/2,color,3);
          }
        }
        if(t.building==='gasPump')this.gasArrow(x,y,t.gasDevice.direction,color);
        else {
          c.fillStyle='#163644';c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.ellipse(x,y,6,4,0,0,Math.PI*2);c.fill();c.stroke();
          if(!node.open)this.line(x-6,y-5,x+6,y+5,'#edc174',3);
          if(hp<50){this.line(x+7,y-4,x+10,y-10,'#f49883',2);this.line(x+10,y-1,x+16,y-4,'#f49883',2);}
        }
      }
    }
    if(this.waterOverlay||(mode==='build'&&['waterPipe','waterReservoir','waterPump','waterIntake','waterOutlet'].includes(build))){
      const accepts=(t,dx,dy)=>{if(waterNode(t))return true;if(!t?.waterDevice)return false;const [px,py]=WATER_DIRECTIONS[t.waterDevice.direction];return dx*py===dy*px;};
      for(const t of site.tiles){
        const node=waterNode(t);if(!node&&!t.waterDevice)continue;
        const [x,y]=this.project(t.x,t.y),hp=t.waterPipe?.hp??t.hp,color=hp<50?'#f49c83':node&&!node.open?'#efc674':t.waterDevice?.enabled===false?'#869aa9':'#82baf4';
        for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
          const neighbor=inside(site,t.x+dx,t.y+dy)?at(site,t.x+dx,t.y+dy):null;
          let connect=accepts(t,dx,dy)&&accepts(neighbor,dx,dy);
          if(t.waterDevice&&neighbor){const [px,py]=WATER_DIRECTIONS[t.waterDevice.direction],endpoint=t.building==='waterIntake'?dx===-px&&dy===-py:t.building==='waterOutlet'?dx===px&&dy===py:false;if(endpoint)connect=t.waterDevice.mode==='floor'||!!neighbor.machine;}
          if(connect){this.line(x,y,x+(dx-dy)*T/2,y+(dx+dy)*H/2,'#18304d',7);c.setLineDash([5,3]);this.line(x,y,x+(dx-dy)*T/2,y+(dx+dy)*H/2,color,3);c.setLineDash([]);}
        }
        if(t.waterDevice)this.gasArrow(x,y,t.waterDevice.direction,color);
        else{c.fillStyle='#193551';c.strokeStyle=color;c.lineWidth=2;c.fillRect(x-5,y-4,10,8);c.strokeRect(x-5,y-4,10,8);if(!node.open)this.line(x-6,y-5,x+6,y+5,'#efc674',3);if(hp<50){this.line(x+7,y-4,x+10,y-10,'#f49c83',2);this.line(x+10,y-1,x+16,y-4,'#f49c83',2);}}
      }
    }
    if (siteId === 'surface' && s.debris.target) { const [x, y] = this.project(s.debris.target.x, s.debris.target.y); this.diamond(x, y, '#ec8e7e44', '#ffc28a'); c.fillStyle = '#ffe4bb'; c.font = 'bold 12px monospace'; c.textAlign = 'center'; c.fillText('IMPACT', x, y - 40); }
    if (this.selection && !this.selection.crew && this.selection.site === siteId) { const [x, y] = this.project(this.selection.x, this.selection.y); c.lineWidth = 2; this.diamond(x, y, '#b7dbbb12', '#c7e5ce'); }
    if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x < site.size && this.hover.y < site.size) {
      const [x, y] = this.project(this.hover.x, this.hover.y); this.diamond(x, y, mode === 'build' ? '#8ee5cc55' : '#ffffdd1a', mode === 'mine' ? '#edbd7e' : '#c5e6d8');
      if (mode === 'build') { c.globalAlpha = .5; this.structure({ building: build, terrain: 'floor', hp: 100, powered: true, x: this.hover.x, y: this.hover.y }, x, y, s); c.globalAlpha = 1; }
    }
    c.restore();
    if (siteId === 'surface' && !isDay(s)) { c.fillStyle = '#0a1b3840'; c.fillRect(0, 0, this.w, this.h); }
    c.fillStyle = '#58717e'; c.font = '9px monospace'; c.textAlign = 'left'; c.fillText(`LOCAL GRID / ${site.size} × ${site.size}     ${Math.round(this.zoom * 100)}%`, 22, this.h - 108);
    if(this.powerOverlay){c.fillStyle='#b0d5c3';c.fillText('POWER / BREAKER TRIANGLE: OUTPUT SIDE   GAP: OPEN CONTACT',22,this.h-122);}
    if(this.waterOverlay){c.fillStyle='#a8c7ef';c.fillText('WATER / DASHED ROUTE   SQUARE: VALVE   AMBER: CLOSED   CORAL: LEAK   ARROW: FLOW',22,this.h-122);}
    if(this.gasOverlay){c.fillStyle='#9ed6d9';c.fillText('GAS / CYAN: ROUTE   AMBER: VALVE CLOSED   CORAL: LEAK   ARROW: PUMP OUTLET',22,this.h-122);}
  }
  gasArrow(x,y,direction,color){
    const [dx,dy]=GAS_DIRECTIONS[direction||'east'],vx=(dx-dy)*15,vy=(dx+dy)*7.5;
    this.line(x-vx,y-vy,x+vx,y+vy,'#173644',7);this.line(x-vx,y-vy,x+vx,y+vy,color,3);
    const length=Math.hypot(vx,vy),ux=vx/length,uy=vy/length;
    this.polygon([[x+vx,y+vy],[x+vx-ux*10-uy*5,y+vy-uy*10+ux*5],[x+vx-ux*10+uy*5,y+vy-uy*10-ux*5]],color,'#173644');
  }
  structure(t, x, y, s) {
    const c = this.ctx, b = t.building;
    if(b==='gasPipe'){this.line(x-24,y-12,x+24,y+12,'#35677a',7);this.line(x-24,y-12,x+24,y+12,'#93d0d4',3);this.line(x+24,y-12,x-24,y+12,'#35677a',7);this.line(x+24,y-12,x-24,y+12,'#93d0d4',3);this.box(x,y,6,3,5,'#e1be7f','#a18d60','#756e53');}
    else if(b==='breaker'){
      const [dx,dy]=POWER_DIRECTIONS[t.protection?.direction||'east'],vx=(dx-dy)*15,vy=(dx+dy)*7.5,closed=t.protection&&breakerContactClosed(t),tripped=t.protection?.tripped,col=tripped?'#e7a28b':closed?'#e2d091':'#b7c7c0';
      this.box(x,y,22,11,8,'#b4b5a0','#777f7c','#4d5d66');this.box(x,y-8,14,7,8,'#6f8589','#465f6c','#344c5d');
      this.box(x-vx,y-vy-8,5,3,4,'#ddd9b2','#a5a087','#727d7c');this.box(x+vx,y+vy-8,5,3,4,'#ddd9b2','#a5a087','#727d7c');
      this.line(x-vx,y-vy-12,closed?x+vx:x-vx+vx*.6,closed?y+vy-12:y-vy-28,col,5);
      const len=Math.hypot(vx,vy),ux=vx/len,uy=vy/len;this.polygon([[x+vx+ux*7,y+vy-12+uy*7],[x+vx-uy*4,y+vy-12+ux*4],[x+vx+uy*4,y+vy-12-ux*4]],'#ece2b1','#56696d');
      if(tripped||t.hp<=0){this.line(x-4,y-24,x+4,y-16,'#ef9984',3);this.line(x+4,y-24,x-4,y-16,'#ef9984',3);}
    }
    else if(b==='waterPipe'){this.line(x-24,y-12,x+24,y+12,'#354e72',7);this.line(x-24,y-12,x+24,y+12,'#8bbdf0',3);this.line(x+24,y-12,x-24,y+12,'#354e72',7);this.line(x+24,y-12,x-24,y+12,'#8bbdf0',3);this.box(x,y,7,4,3,'#c7d7e1','#7a96ac','#4e6c8d');}
    else if(b==='waterReservoir'){
      this.box(x,y,27,13,5,'#83a1b5','#4b6b8a','#334c70');this.box(x,y-5,24,10,18,'#b7cfda','#7298b5','#4b6c93');
      this.line(x-22,y-19,x,y-8,'#d5e5e7',2);this.line(x,y-8,x+22,y-19,'#7facce',2);
      this.box(x-12,y-23,6,3,3,'#d0e0dc','#86a6b2','#536c8b');this.box(x+12,y-23,6,3,3,'#d0e0dc','#86a6b2','#536c8b');
      c.fillStyle='#263f63';c.fillRect(x+5,y-15,11,5);c.fillStyle='#82c4fa';c.fillRect(x+5,y-15,11*(t.waterStore?t.waterStore.water/waterCapacity(t):0),5);
      this.line(x-5,y-24,x+5,y-24,t.waterStore?.open===false?'#efc674':'#abcfea',2);
    }
    else if(['waterPump','waterIntake','waterOutlet'].includes(b)){
      this.box(x,y,22,11,6,'#91b6ca','#5687a8','#365d89');
      if(b==='waterPump'){this.box(x,y-5,12,7,9,'#c5dae0','#7babc1','#4c799e');for(const dx of [-8,0,8])this.line(x+dx-5,y-13,x+dx+2,y-9,'#345c83',2);}
      if(b==='waterIntake'){this.box(x-9,y-5,12,7,5,'#cedde0','#7babc1','#4c799e');for(let i=0;i<4;i++)this.line(x-17+i*4,y-11+i*2,x-7+i*4,y-16+i*2,'#365779',2);this.box(x+12,y-5,5,3,20,'#d3e2da','#8cafbd','#527b9c');}
      if(b==='waterOutlet'){this.box(x-11,y-5,6,4,19,'#cededb','#84aabd','#527a9b');this.line(x-9,y-25,x+8,y-17,'#a4d5e7',6);this.line(x+8,y-17,x+8,y-9,'#7faecb',5);this.box(x+12,y-3,7,4,3,'#76b5d3','#5186ab','#345d81');}
      this.gasArrow(x,y-28,t.waterDevice?.direction||'east',t.powered&&t.waterDevice?.enabled!==false?'#a9d9fa':'#859cab');
    }
    else if(b==='gasTank'){
      this.box(x,y,20,10,6,'#769ca7','#476b7d','#2f4c65');
      for(const dx of [-9,9]){this.box(x+dx,y-5,8,5,29,'#d0d5b6','#92acaa','#547d8d');this.line(x+dx-7,y-20,x+dx,y-16,'#e2c187',3);this.line(x+dx,y-16,x+dx+7,y-20,'#b8996a',3);}
      const fill=t.gasStore?gasPayload(t)/gasCapacity(t):0;c.fillStyle='#3c6375';c.fillRect(x+10,y-27,3,18);c.fillStyle='#91e0d9';c.fillRect(x+10,y-9-fill*18,3,fill*18);
      this.box(x,y-27,5,3,4,'#dabc7d','#91794f','#5e5e53');this.line(x-5,y-32,x+5,y-32,t.gasStore?.open===false?'#f0b877':'#8dded3',2);
    }
    else if(b==='gasPump'){
      this.box(x,y,21,10,9,'#91afb7','#527487','#354f6b');this.box(x,y-7,10,5,13,'#c3cebd','#789a9c','#476d81');
      for(const dx of [-9,0,9])this.line(x+dx-5,y-14,x+dx+1,y-11,'#334f65',2);
      this.gasArrow(x,y-22,t.gasDevice?.direction||'east',t.powered&&t.gasDevice?.enabled!==false?'#a3e7d5':'#a7b6b6');
    }
    else if(b==='gasVent'){
      this.box(x,y,22,11,5,'#9caeb1','#5d7e8b','#3c5c71');this.box(x,y-4,17,8,3,'#466e7d','#365363','#293f54');
      for(let i=-2;i<=2;i++)this.line(x-13+i*3,y-7-i*1.5,x+1+i*3,y+i*1.5,'#b1cdcb',2);
      c.fillStyle=t.powered&&t.gasDevice?.enabled!==false?'#8edbc9':'#725d56';c.fillRect(x+13,y-7,4,3);
      if(t.gasStore?.open===false)this.line(x-7,y-11,x+7,y-3,'#edbd77',2);
    }
    else if(b==='gasExtractor'){
      this.box(x,y,23,11,7,'#a0afb3','#667e8e','#3e536d');
      this.box(x-7,y-5,12,6,19,'#b9bec4','#7d8c9e','#535c79');
      this.box(x+13,y-4,6,4,27,'#beaaca','#827698','#5a537a');
      for(let i=0;i<4;i++)this.line(x-17,y-20+i*4,x-6,y-15+i*4,'#3b576e',2);
      c.fillStyle=t.powered&&t.gasDevice?.enabled!==false?'#b2e5d2':'#657784';c.fillRect(x+1,y-18,6,4);
      const mode=t.gasDevice?.mode||'filter';
      if(mode==='filter'){this.line(x+10,y-22,x+15,y-19,'#e1c59b',2);this.line(x+10,y-17,x+15,y-14,'#e1c59b',2);}
      else {this.line(x+13,y-29,x+13,y-20,'#e1c59b',2);this.line(x+9,y-24,x+13,y-20,'#e1c59b',2);this.line(x+17,y-24,x+13,y-20,'#e1c59b',2);}
    }
    else if(b==='gasReservoir'){
      this.box(x,y,24,12,7,'#8794ac','#4f637f','#344b68');
      this.box(x,y-5,18,10,29,'#b8bac9','#7987a5','#4d5d85');
      this.line(x-17,y-27,x,y-18,'#d1bdd9',3);this.line(x,y-18,x+17,y-27,'#8e84ae',3);
      this.box(x,y-33,6,3,4,'#d0c4d5','#958ca9','#646080');
      c.fillStyle='#354867';c.fillRect(x+4,y-25,5,20);
      const amount=t.gasStore?gasPayload(t):0,fill=Math.min(1,amount/(t.gasStore?gasCapacity(t):80));
      c.fillStyle='#c4ade0';c.fillRect(x+4,y-5-fill*20,5,fill*20);
      this.line(x-5,y-38,x+5,y-38,t.gasStore?.open===false?'#edbd77':'#a8ddd7',2);
    }
    else if (b === 'cable') { this.line(x - 24, y - 12, x + 24, y + 12, '#b1e5c4', 3); this.line(x + 24, y - 12, x - 24, y + 12, '#b1e5c4', 3); }
    else if (b === 'wall') { const front = t.y >= 12 || t.x >= 14; const h = this.cutaway && front ? 9 : 32; this.box(x, y, 31, 15, h, '#a7aea0', '#64787c', '#40565f'); this.line(x - 29, y - h, x, y + 14 - h, '#c3c6ac'); this.line(x, y + 14 - h, x + 30, y - h, '#bbc0ac'); if (h > 10) { this.line(x, y + 13 - h + 5, x, y + 9, '#293f4a'); c.fillStyle = '#cfac6a'; c.fillRect(x + 15, y - h + 12, 5, 3); } }
    else if (b === 'door') { this.box(x, y, 24, 12, 27, '#94ada9', '#3c6870', '#325663'); if (!doorOpen(t, s.tick)) this.box(x, y + 1, 14, 7, 23, '#849997', '#56787c', '#3e5d67'); else this.diamond(x, y, '#324955', '#8cb5b0'); c.fillStyle = '#98dfba'; c.fillRect(x - 4, y - 23, 8, 3); }
    else if (b === 'solar' || b === 'advanced') { this.box(x, y, 5, 3, 9, '#77878a', '#485765', '#3a4a53'); this.box(x, y - 9, 27, 14, 3, b === 'advanced' ? '#477f99' : '#315b76', '#345268', '#213d52'); for (let n = -2; n <= 2; n++) { this.line(x - 25 + (n + 2) * 6, y - 11 + (n + 2) * 3, x + 1 + (n + 2) * 6, y - 24 + (n + 2) * 3, '#8abcd35c'); } this.line(x - 13, y - 17, x + 13, y - 4, '#80b9d363'); if (b === 'advanced') { c.fillStyle = '#e2c886'; c.fillRect(x - 3, y - 14, 6, 3); } }
    else if (b === 'fence' || b === 'pastureGate') {
      const open=t.hp<=0||(b==='pastureGate'&&t.gateMode==='open'),height=t.hp<=0?6:19;
      this.box(x,y,3,2,height,'#bcc6ad','#798b7c','#4d6966');
      const site=s.sites.surface;
      const links=[[1,0,32,16],[-1,0,-32,-16],[0,1,-32,16],[0,-1,32,-16]].filter(([dx,dy])=>t.x+dx>=0&&t.y+dy>=0&&t.x+dx<site.size&&t.y+dy<site.size&&['fence','pastureGate','wall'].includes(site.tiles[(t.y+dy)*site.size+t.x+dx]?.building));
      if(!links.length)links.push([1,0,28,14],[-1,0,-28,-14]);
      for(const [,,dx,dy] of links){
        if(!open){for(const h of [6,16])this.line(x,y-h,x+dx,y+dy-h,'#a4b79d',3);for(const f of [.3,.7])this.line(x+dx*f,y+dy*f-16,x+dx*f,y+dy*f-6,'#5c8079',1);}
        else this.line(x,y-height+2,x+dx*.3,y+dy*.3-height-4,'#92a78e',3);
      }
      if(b==='pastureGate'){c.fillStyle=open?'#ddad73':'#8ee0c0';c.fillRect(x-2,y-19,5,5);}
    }
    else if (b === 'husbandryPost') { this.box(x,y,24,12,6,'#b8ad8d','#827b62','#566557');this.box(x-14,y-5,4,3,24,'#b8c4b2','#7d998d','#4d716a');this.line(x-14,y-29,x+14,y-15,'#c4ccad',2);this.box(x+8,y-2,10,5,5,'#91ab91','#687f6a','#466456'); }
    else if (b === 'galley') { this.box(x,y,26,13,12,'#b8b9a1','#858c7b','#526b6c'); this.box(x-12,y-5,9,5,9,'#a6bdb7','#647f80','#3e5c64'); this.box(x+10,y-9,10,5,5,'#dbc799','#a78e68','#756c58'); c.fillStyle=t.powered?'#f0bc73':'#75695a';c.fillRect(x+4,y-16,11,4);this.line(x-13,y-25,x-11,y-32,'#b8d4cd',2);this.line(x-6,y-23,x-4,y-29,'#b8d4cd',2); }
    else if (b === 'iceProcessor') { this.box(x,y,25,12,13,'#a0bac3','#65878f','#415969'); this.box(x-9,y-7,10,5,21,'#c4dadd','#729ba9','#44677f'); this.box(x+13,y-5,7,4,17,'#b7c5b5','#7a9a8d','#526e69'); this.line(x-2,y-25,x+12,y-16,'#d6ded1',4); c.fillStyle=t.powered?'#96e2df':'#436474';c.fillRect(x-15,y-22,9,10); c.fillStyle='#dcaf72';c.fillRect(x+3,y-6,6,3); }
    else if (b === 'artisan') { this.box(x,y,24,12,14,'#bcb99f','#827f70','#525e61');this.box(x-13,y-14,6,3,16,'#93aaa9','#64878e','#3c5d6c');this.line(x-13,y-30,x+10,y-18,'#d9ccb0',4);this.box(x+7,y-13,7,4,7,'#ceb68b','#9c896d','#6d6c63');c.fillStyle=t.powered?'#9be1d3':'#4f737b';c.fillRect(x-9,y-10,7,4);this.line(x+5,y-24,x+12,y-20,'#bcebe0',2); }
    else if (b === 'sculpture') { this.box(x,y,17,8,6,'#8198a0','#4b6573','#344b5c'); this.box(x,y-6,7,4,10,'#c6b798','#998c79','#6d6a66'); this.polygon([[x-14,y-24],[x,y-40],[x+14,y-24],[x,y-13]],'#d6c6a3','#ece0ba'); this.polygon([[x-7,y-24],[x,y-32],[x+7,y-24],[x,y-19]],'#496979'); this.line(x-14,y-24,x,y-13,'#a38f75',3); }
    else if (b === 'holo') { this.box(x,y,19,9,8,'#799fa6','#4d717f','#304c62'); this.box(x,y-8,11,5,2,'#426d82','#315166','#253e55'); if(t.powered && t.hp>0) { this.polygon([[x-13,y-12],[x-18,y-35],[x+18,y-35],[x+13,y-12]],'#79d2de35'); this.line(x-17,y-26,x+17,y-26,'#85dfd2',2); this.line(x,y-40,x,y-14,'#9ce8ea',2); this.polygon([[x,y-38],[x+12,y-26],[x,y-16],[x-12,y-26]],'#94dce950','#b9efdc'); c.fillStyle='#f2d4a4'; c.fillRect(x-2,y-28,4,4); } }
    else if (b === 'commons') { this.box(x, y, 7, 4, 12, '#526d73', '#3f535e', '#273d4b'); this.box(x, y - 12, 23, 11, 3, '#bbab80', '#897d62', '#635f52'); for (const [dx, dy] of [[-23, 3], [23, 3]]) this.box(x + dx, y + dy, 7, 4, 6, '#91b6a4', '#64877f', '#3d605e'); c.fillStyle = '#c1e4c5'; c.fillRect(x - 8, y - 18, 8, 4); c.fillStyle = '#e4b580'; c.fillRect(x + 4, y - 13, 4, 3); }
    else if (b === 'medicalCot') { this.box(x, y, 23, 11, 10, '#b4cbc2', '#749c98', '#476d78'); this.box(x, y - 9, 20, 9, 3, '#d5ded1', '#9bbcaf', '#648b86'); this.box(x - 17, y - 10, 4, 2, 21, '#89aeaf', '#61858e', '#355b6d'); c.fillStyle = '#87ddc8'; c.fillRect(x - 22, y - 30, 10, 5); this.line(x + 2, y - 17, x + 12, y - 12, '#408a87', 3); }
    else if (b === 'medlab') { this.box(x, y, 22, 11, 23, '#c0d2c3', '#769e95', '#416d77'); this.box(x - 11, y - 20, 6, 3, 12, '#9fd4cc', '#6ca7a4', '#447c8a'); this.box(x + 8, y - 21, 5, 3, 9, '#c1dcae', '#91b393', '#668d7e'); c.fillStyle = t.powered ? '#91ebcf' : '#536c70'; c.fillRect(x + 3, y - 15, 9, 5); }
    else if (b === 'bunk') { this.box(x, y, 21, 10, 7, '#516970', '#3b4f56', '#263b44'); this.box(x - 1, y - 5, 18, 8, 2, '#bec5ae', '#879990', '#687e7e'); this.box(x - 12, y - 10, 6, 3, 2, '#e3dcc2', '#a7b1a1', '#a4afa0'); }
    else if (b === 'sanitary') { this.box(x, y, 20, 10, 7, '#9bb9b0', '#658981', '#3d6565'); this.box(x - 13, y - 8, 5, 3, 28, '#c1cec0', '#86a89d', '#527b78'); this.box(x + 5, y - 15, 12, 6, 22, '#b5c9bd', '#7b9f94', '#496e6d'); this.box(x + 3, y - 7, 9, 5, 9, '#e0dfc8', '#abc2af', '#729a8d'); c.fillStyle = t.hp ? '#90d6bb' : '#d38e71'; c.fillRect(x - 18, y - 29, 4, 4); c.fillStyle = '#d7b879'; c.fillRect(x - 9, y + 2, Math.round(16 * (t.sanitary?.output.waste || 0) / 8), 3); }
    else if (b === 'recycler') { this.box(x, y, 23, 11, 12, '#829d91', '#486c67', '#304e53'); for (const dx of [-10, 10]) { this.box(x + dx, y - 12, 8, 4, 19, '#bad0a0', '#678b72', '#426453'); this.line(x + dx - 6, y - 22, x + dx + 5, y - 17, '#d1dbad', 2); } c.fillStyle = t.powered ? '#b6e789' : '#4b6159'; c.fillRect(x - 4, y - 10, 8, 4); }
    else if (b === 'farm') { this.box(x, y, 24, 12, 9, '#798d84', '#3e6263', '#2d484e'); this.diamond(x, y - 10, '#2f4941'); for (let i = 0; i < 6; i++) { const px = x - 15 + (i % 3) * 11, py = y - 14 + Math.floor(i / 3) * 8; c.fillStyle = '#85b079'; c.fillRect(px, py - 5, 4, 7); c.fillStyle = '#b2ce85'; c.fillRect(px - 2, py - 3, 7, 3); } }
    else if (b === 'climate') { this.box(x, y, 17, 8, 21, '#a9c3ca', '#658593', '#3b5e71'); for (let i = 0; i < 4; i++) this.line(x - 12, y - 18 + i * 4, x - 3, y - 14 + i * 4, '#294b60', 2); c.fillStyle = t.powered ? (t.climate?.status.startsWith('Heating') ? '#ecb57c' : '#8bd3db') : '#526974'; c.fillRect(x + 4, y - 16, 7, 4); }
    else if (b === 'scrubber') { this.box(x, y, 16, 8, 29, '#abb9ad', '#698989', '#41656c'); this.box(x - 7, y, 7, 4, 24, '#bbc9b6', '#82a09a', '#628b8a'); c.fillStyle = t.powered ? '#9ce1c7' : '#775b4c'; c.fillRect(x + 3, y - 21, 7, 5); for (let i = 0; i < 3; i++) this.line(x + 2, y - 10 + i * 3, x + 10, y - 14 + i * 3, '#263f4e', 2); }
    else if (b === 'atmosphere') { this.box(x, y, 24, 12, 10, '#90a59d', '#4e7475', '#35585f'); for (const offset of [-10, 10]) { this.box(x + offset, y - 2, 8, 5, 29, '#bacdb8', '#6c9c95', '#456e79'); this.line(x + offset - 6, y - 12, x + offset + 6, y - 18, '#315e68', 3); } c.fillStyle = t.powered ? '#96dfca' : '#5e706c'; c.fillRect(x - 3, y - 20, 6, 5); }
    else if(b==='waterTank'){this.box(x,y,20,10,9,'#a4c6c8','#638e9c','#406676');this.box(x,y-8,15,8,26,'#b7d1ce','#74a5ad','#4a7586');c.fillStyle='#4bafd3';c.fillRect(x+3,y-28,6,Math.max(1,18*(t.machine?.input.water||0)/8));c.fillStyle=t.tank?.drain?'#ddad73':'#89c6b1';c.fillRect(x-13,y-17,5,5);}
    else if(b==='bilgePump'){this.box(x,y,18,9,10,'#a8bbc2','#658696','#3d6078');this.box(x+3,y-4,9,5,15,'#b4c9c9','#70979e','#456f83');c.strokeStyle=t.powered?'#8ee0d7':'#526a7b';c.lineWidth=3;c.beginPath();c.arc(x+4,y-15,6,0,Math.PI*2);c.stroke();this.line(x-18,y+2,x-7,y+7,'#789eb0',4);}
    else if(b==='reactor'){this.box(x,y,20,10,8,'#a6a5bb','#646f85','#444e6b');this.box(x,y-6,13,7,30,'#b7bdc9','#727c91','#455470');c.fillStyle=t.reactor?.tripped?'#ee9271':t.powerStatus==='Generating'?'#a5dbcf':'#536176';c.beginPath();c.ellipse(x+5,y-24,4,8,0,0,Math.PI*2);c.fill();for(let i=0;i<3;i++)this.line(x-13,y-12-i*6,x-4,y-7-i*6,'#ab87c1',2);}
    else if(b==='radiator'){this.box(x,y,21,10,5,'#a3b5bb','#5c7b88','#3e596d');for(let i=0;i<5;i++)this.box(x-12+i*6,y-6,2,6,23,'#8cbac2','#4f778d','#33576b');c.fillStyle=t.radiator?.enabled&&t.hp>0?'#87cdb6':'#8b747b';c.fillRect(x+12,y-3,4,3);}
    else if (b === 'battery') { this.box(x, y, 16, 8, 21, '#9aa898', '#566f71', '#3d575e'); for (let i = 0; i < 3; i++) { c.fillStyle = (t.charge || 0) >= (3 - i) * 40 ? '#85c1ad' : '#364e54'; c.fillRect(x + 3, y - 16 + i * 4, 7, 2); } }
    else if (b === 'refinery') { this.box(x, y, 22, 11, 18, '#a19a85', '#796b5b', '#4d5655'); this.box(x - 7, y - 7, 8, 4, 25, '#89968c', '#536c70', '#3c535e'); c.fillStyle = t.powered ? '#eaba79' : '#66564a'; c.fillRect(x + 5, y - 8, 9, 6); this.line(x + 5, y - 1, x + 14, y - 6, '#2b3f43', 2); }
    else if (b === 'fabricator') { this.box(x, y, 23, 12, 18, '#879eaa', '#557887', '#355264'); this.box(x - 9, y - 9, 7, 4, 25, '#c1c4af', '#8b9d97', '#567077'); this.line(x - 9, y - 34, x + 13, y - 23, '#b3bdb0', 4); c.fillStyle = t.powered ? '#87decb' : '#59676d'; c.fillRect(x + 3, y - 16, 9, 4); this.box(x + 8, y + 2, 6, 3, 4, '#cfbd8b', '#8e8465', '#635d50'); }
    else if (b === 'stockpile') { this.diamond(x, y, '#485950', '#a3b894'); this.box(x - 9, y, 10, 5, 10, '#c4b78d', '#928665', '#696b58'); this.box(x + 10, y + 2, 9, 5, 7, '#8facaa', '#597b7d', '#3b5e64'); }
    else if (b === 'trap') { this.box(x, y, 12, 6, 9, '#a8bb9d', '#6d877b', '#4b6867'); this.box(x, y - 3, 7, 3, 5, '#577776', '#335555', '#233f47'); c.fillStyle = '#d9c389'; c.fillRect(x - 2, y - 7, 4, 3); }
    else if (b === 'shuttle') { this.box(x, y + 3, 30, 15, 7, '#536874', '#314650', '#293c47'); this.box(x, y - 5, 26, 13, 20, '#d3d1b7', '#8b9c95', '#667e80'); this.box(x + 2, y - 25, 15, 7, 7, '#6eaaa9', '#375e6c', '#2c4e62'); this.box(x - 22, y + 2, 9, 4, 16, '#a7b6a6', '#637e7e', '#405e67'); c.fillStyle = s.mission ? '#5e6f6a' : '#e4b16b'; c.fillRect(x - 24, y - 5, 5, 5); }
    else if (b === 'salvage') { this.box(x, y, 20, 10, 16, '#9da9a2', '#5c757e', '#3c5361'); this.box(x + 8, y - 10, 11, 6, 12, '#517f95', '#36556c', '#263a4e'); c.fillStyle = '#d8b878'; c.fillRect(x - 9, y - 15, 4, 4); this.line(x - 16, y - 22, x - 9, y - 14, '#9ab9bd', 2); }
    else if (b === 'volatile') { this.box(x, y, 19, 10, 18, '#b4d7dc', '#719eb7', '#487991'); this.box(x + 8, y + 4, 10, 5, 13, '#c4e2e4', '#9abdcf', '#6d9eb8'); }
    else if (b === 'dock') { this.diamond(x, y, '#536772', '#d5c891'); c.strokeStyle = '#d6cb99'; c.lineWidth = 2; c.beginPath(); c.ellipse(x, y, 16, 8, 0, 0, Math.PI * 2); c.stroke(); this.line(x - 8, y, x + 8, y, '#d6cb99', 2); }
    else if (b === 'collector') { this.box(x, y, 12, 6, 27, '#c7b991', '#8b8971', '#596d68'); this.box(x, y - 28, 31, 16, 4, '#bfa567', '#756e52', '#525e51'); this.box(x, y - 32, 6, 3, 9, '#dcdfb9', '#9cb5a5', '#688e8a'); }
    if (t.hp < 100) { c.fillStyle = '#352e2a'; c.fillRect(x - 12, y - 37, 24, 3); c.fillStyle = '#d99971'; c.fillRect(x - 12, y - 37, 24 * t.hp / 100, 3); }
  }
  universe(s) {
    const c = this.ctx; const nodes = this.regionNodes();
    c.strokeStyle = '#42616c'; c.setLineDash([3, 7]); c.lineWidth = 1;
    for (let i = 1; i < nodes.length; i++) { c.beginPath(); c.moveTo(nodes[0].x, nodes[0].y); c.lineTo(nodes[i].x, nodes[i].y); c.stroke(); } c.setLineDash([]);
    for (const n of nodes) {
      c.save(); c.translate(n.x, n.y); const color = SITES[n.id].color;
      c.strokeStyle = `${color}55`; c.beginPath(); c.ellipse(0, 0, n.id === 'surface' ? 89 : 41, n.id === 'surface' ? 45 : 21, -.35, 0, Math.PI * 2); c.stroke();
      if (n.id === 'surface') { const g = c.createRadialGradient(-20, -20, 0, 0, 0, 52); g.addColorStop(0, '#b69c6e'); g.addColorStop(.6, '#64766c'); g.addColorStop(1, '#1c353f'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 48, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#b6c3a6'; c.lineWidth = 1; c.stroke(); }
      else if (n.id === 'wreck') { this.structure({ building: 'salvage', hp: 100 }, 0, 3, s); }
      else if (n.id === 'comet') { this.polygon([[-15, 4], [72, -30], [20, 15]], '#8bbdc22a'); this.structure({ building: 'volatile', hp: 100 }, 0, 3, s); }
      else this.structure({ building: 'collector', hp: 100 }, 0, 5, s);
      c.fillStyle = '#d6e1d8'; c.textAlign = 'center'; c.font = '14px Arial'; c.fillText(SITES[n.id].name, 0, n.id === 'surface' ? 75 : 52); c.fillStyle = color; c.font = '8px monospace'; c.fillText(SITES[n.id].label, 0, n.id === 'surface' ? 93 : 70); c.restore();
    }
    if (s.mission && ['outbound', 'returning'].includes(s.mission.phase)) {
      const dest = nodes.find(n => n.id === s.mission.site), from = nodes[0]; const duration = routeTime(s, s.mission.site), f = s.mission.phase === 'outbound' ? 1 - s.mission.remaining / duration : s.mission.remaining / duration;
      const x = from.x + (dest.x - from.x) * f, y = from.y + (dest.y - from.y) * f; c.fillStyle = '#d6e9cf'; this.polygon([[x, y - 6], [x + 5, y + 5], [x, y + 2], [x - 5, y + 5]], '#d6e9cf');
    }
  }
  regionNodes() { return [{ id: 'surface', x: this.w * .3, y: this.h * .58 }, { id: 'wreck', x: this.w * .66, y: this.h * .34 }, { id: 'comet', x: this.w * .75, y: this.h * .69 }, { id: 'solar', x: this.w * .36, y: this.h * .28 }]; }
}
