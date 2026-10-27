import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, at } from '../src/simulation.js';
import { Renderer, projectTile } from '../src/render.js';

const terminals = { surface: [16, 11], wreck: [4, 11], comet: [5, 10], solar: [5, 10] };
const project = ([x, y]) => projectTile(x,y);
function fixture() {
  const s = createGame();
  // This graphics harness has no DOM sprite factory; crew behavior is not under test.
  s.crew = [];
  return s;
}
function graphics() {
  const commands = [], crafts = [], renderer = Object.create(Renderer.prototype);
  renderer.ctx = new Proxy({}, { get(target, key) { return target[key] ?? (key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}); } });
  Object.assign(renderer, { w: 1440, h: 1000, dpr: 1, zoom: 1, pan: { x: 0, y: 0 }, stars: [], cutaway: true });
  for (const name of ['box', 'diamond', 'hex', 'polygon']) renderer[name] = (...args) => commands.push({ name, args });
  renderer.shuttleCraft = (x, y) => crafts.push([x, y]);
  return { renderer, commands, crafts };
}
function draw(s, site) {
  const graphicsResult = graphics();
  graphicsResult.renderer.draw(s, site, 'inspect', null);
  return graphicsResult;
}
function assertBerth(commands, site) {
  const [x, y] = project(terminals[site]);
  assert.ok(commands.some(({ name, args }) => site === 'surface'
    ? name === 'box' && args[0] === x && args[1] === y + 3 && args[5] === '#536874'
    : name === 'hex' && args[0] === x && args[1] === y && args[2] === '#536772'), `${site} permanent berth remains visible`);
}

test('idle and departure preparation draw one surface craft and retain every empty remote berth', () => {
  for (const stage of [null, 'loading', 'boarding']) {
    const s = fixture();
    if (stage) s.departure = { site: 'wreck', stage };
    const before = structuredClone(s);
    for (const site of Object.keys(terminals)) {
      const { crafts, commands } = draw(s, site);
      assert.deepEqual(crafts, site === 'surface' ? [project(terminals.surface)] : []);
      assertBerth(commands, site);
    }
    assert.deepEqual(s, before, 'Drawing must not change simulation state');
  }
});

test('mission phases draw the craft only at the destination or in transit, even at zero timer', () => {
  for (const destination of ['wreck', 'comet', 'solar']) {
    for (const phase of ['outbound', 'working', 'boarding', 'returning']) {
      const s = fixture();
      s.mission = { site: destination, phase, remaining: 0, fit: 'standard' };
      const before = structuredClone(s);
      for (const site of Object.keys(terminals)) {
        const { crafts, commands } = draw(s, site);
        const landed = ['working', 'boarding'].includes(phase) && site === destination;
        assert.deepEqual(crafts, landed ? [project(terminals[site])] : [], `${destination}/${phase} viewed from ${site}`);
        assertBerth(commands, site);
      }
      assert.deepEqual(s, before);
    }
  }
});

test('one selected terminal receives the craft; destroyed terminals do not relocate it', () => {
  const s = fixture(); s.mission = { site: 'wreck', phase: 'working', remaining: 0, fit: 'standard' };
  const original = at(s.sites.wreck, ...terminals.wreck), extra = at(s.sites.wreck, 5, 11);
  extra.building = 'dock'; original.hp = 0;
  assert.deepEqual(draw(s, 'wreck').crafts, [project([5, 11])], 'Usable terminal receives the single craft');
  extra.hp = 0;
  assert.deepEqual(draw(s, 'wreck').crafts, [project(terminals.wreck)], 'Physical presence survives unusable terminals');
  assert.deepEqual(draw(s, 'surface').crafts, [], 'Damage never returns the craft to the surface');
  original.building = null; extra.building = null;
  assert.deepEqual(draw(s, 'wreck').crafts, [], 'No arbitrary tile becomes a replacement berth');
});

test('system map draws a travel marker only during actual outbound or return transit', () => {
  for (const phase of [null, 'outbound', 'working', 'boarding', 'returning']) {
    const s = fixture();
    if (phase) s.mission = { site: 'wreck', phase, remaining: 0, fit: 'standard' };
    const { renderer, commands } = graphics();
    renderer.universe(s);
    const markers = commands.filter(({ name, args }) => name === 'polygon' && args[1] === '#d6e9cf');
    assert.equal(markers.length, ['outbound', 'returning'].includes(phase) ? 1 : 0);
  }
});


test('the landing-deck view hides upper tiles, actors, work and impact markers',()=>{
 const s=fixture(),baseline=draw(s,'surface'),site=s.sites.surface;
 site.levels.push({z:1,name:'Upper'});site.tiles.push(...site.tiles.map(t=>({...structuredClone(t),z:1})));
 s.crew.push({id:'upper-person',site:'surface',x:8,y:8,z:1,health:100});
 s.jobs.push({id:'upper-work',site:'surface',x:8,y:8,z:1,kind:'build',building:'wall',remaining:4,work:4,materials:{alloy:2},sources:[]});
 s.debris.target={x:8,y:8,z:1};const actual=draw(s,'surface');
 assert.deepEqual(actual.commands,baseline.commands);assert.deepEqual(actual.crafts,baseline.crafts);
});


test('upper drawing uses only its structures, stair landing and declared hit-test floor',()=>{
 const s=fixture(),site=s.sites.surface;s.creatures=[];
 site.levels.push({z:1,name:'Upper'});
 const upper=site.tiles.map(t=>({x:t.x,y:t.y,z:1,terrain:'void',building:null,variant:0,hp:100,liquid:0}));site.tiles.push(...upper);
 const landing=upper[8*site.size+8],built=upper[9*site.size+8];landing.terrain=built.terrain='floor';built.building='wall';landing.verticalLink='vertical-999';
 site.verticalLinks=[{id:'vertical-999',kind:'stairwell',lower:{x:8,y:8,z:0},upper:{x:8,y:8,z:1},hp:100,mode:'open',openUntil:0}];
 const {renderer,crafts}=graphics(),structures=[],stairs=[];
 renderer.structure=t=>structures.push(t);renderer.stairwell=(...args)=>stairs.push(args);
 renderer.draw(s,'surface','inspect',null,1);
 assert.deepEqual(structures,[built]);assert.equal(stairs.length,1);assert.equal(stairs[0][3],'↓');assert.deepEqual(crafts,[]);
 const origin=renderer.origin(site),[x,y]=renderer.project(8,8);
 assert.deepEqual(renderer.screenToTile(origin.x+x,origin.y+y,site,1),{x:8,y:8,z:1});
 assert.equal(renderer.screenToTile(origin.x+x,origin.y+y,site,2),null);
});

test('supply reservations appear on their source floor even when the construction is upstairs',()=>{
 const s=fixture();s.jobs.push({id:'upper-work',site:'surface',x:8,y:8,z:1,kind:'build',building:'wall',materials:{},sources:[{x:6,y:7,z:0,items:{alloy:2}}]});
 const {commands}=draw(s,'surface'),[x,y]=project([6,7]);
 assert.ok(commands.some(c=>c.name==='box'&&c.args[0]===x-18&&c.args[1]===y+6&&c.args[5]==='#d2b9db'));
});
