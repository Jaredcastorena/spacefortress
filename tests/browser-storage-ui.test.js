import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, serialize, deserialize } from '../src/simulation.js';
import { exportColony } from '../src/persistence.js';
import { MAX_SAVE_BYTES } from '../src/data.js';

const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
function boundary(){
  const nodes=new Map(),messages=[],writes=[],unread=[],waiters=[],documentEvents={},windowEvents={};let flushes=0;
  const get=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',disabled:false,value:'chosen',files:[],events:{},addEventListener(name,fn){this.events[name]=fn;},click(){},close(){this.closed=true;}});return nodes.get(id);};
  const initial=createGame(74219),session={state:initial,fresh:false,error:null,original:null};
  const context={state:initial,saveSession:session,speed:0,lastSave:0,accumulator:0,previousTime:0,MAX_SAVE_BYTES,createGame,deserialize,$:get,
    toast:(message,error=false)=>messages.push({message,error}),setSite(){},setSpeed(value){context.speed=value;},
    document:{hidden:false,addEventListener:(name,fn)=>documentEvents[name]=fn},window:{addEventListener:(name,fn)=>windowEvents[name]=fn},performance:{now:()=>1},
    storeBrowserColony(active,target,replace){
      let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
      const write={state:target,replace,resolve(){active.error=null;active.original=null;resolve();},reject};
      writes.push(write);if(waiters.length)waiters.shift()(write);else unread.push(write);return promise;
    },flushBrowserColony:async()=>{flushes++;}
  };
  vm.createContext(context);
  for(const [start,end] of [
    ['let saveRequest =','function setSpeed'],
    ["$('confirm-new-button').onclick =","$('export').onclick ="],
    ['let importSpeed =',"$('crew-list').onclick ="],
    ['let lifecycleSave =','refresh(); renderer.draw(state, siteId, mode, building, deckView.z); requestAnimationFrame(frame);']
  ]){const offset=app.indexOf(start);assert.ok(offset>=0);vm.runInContext(app.slice(offset,app.indexOf(end,offset)),context);}
  return {context,get,messages,writes,session,windowEvents,documentEvents,flushes:()=>flushes,nextWrite:()=>unread.length?Promise.resolve(unread.shift()):new Promise(resolve=>waiters.push(resolve))};
}

test('actual app save/import/new/lifecycle handlers wait for commit, suppress stale results and protect exportable bytes',async()=>{
  const b=boundary(),c=b.context;
  const saved=c.save(),first=await b.nextWrite();assert.equal(b.messages.length,0,'no success before durable commit');first.resolve();assert.equal(await saved,true);
  assert.equal(b.messages.at(-1).message,'Colony saved on this device.');

  b.messages.length=0;
  const obsolete=c.save(),oldWrite=await b.nextWrite(),newGame=b.get('confirm-new-button').onclick(),newWrite=await b.nextWrite(),replacement=c.state;
  assert.notEqual(replacement,b.session.state);assert.equal(b.get('confirm-new').closed,true);assert.equal(b.messages.length,0);
  oldWrite.resolve();assert.equal(await obsolete,false);assert.equal(b.messages.length,0,'old colony completion stays silent');
  newWrite.reject(new Error('aborted'));await newGame;
  assert.equal(c.state,replacement);assert.ok(b.messages.at(-1).error);assert.ok(!b.messages.some(m=>m.message==='A new foothold. A new history.'));
  assert.equal(exportColony(b.session,c.state).contents,serialize(replacement),'failed new colony remains exportable');

  b.messages.length=0;
  const imported=createGame(74220),bytes=serialize(imported),input=b.get('save-file');input.files=[{size:bytes.length,text:async()=>bytes}];
  const importing=input.onchange({target:input}),importWrite=await b.nextWrite();
  assert.equal(c.speed,0);assert.equal(c.state.seed,imported.seed);assert.equal(b.messages.length,0);
  importWrite.resolve();await importing;assert.equal(c.speed,0,'paused import stays paused');assert.equal(input.value,'');assert.equal(b.messages.at(-1).message,'Colony restored.');

  b.session.error='Unreadable original';b.session.original='original corrupt bytes';c.state=b.session.state;
  const protectedWriteCount=b.writes.length;assert.equal(await c.save(),false);assert.equal(b.writes.length,protectedWriteCount);
  assert.equal(exportColony(b.session,c.state).contents,'original corrupt bytes');
  const failedImport=input.onchange({target:input}),failedWrite=await b.nextWrite();failedWrite.reject(new Error('quota'));await failedImport;
  assert.equal(b.session.original,'original corrupt bytes');assert.equal(exportColony(b.session,c.state).contents,bytes,'failed replacement exports the imported colony');assert.equal(c.speed,0);

  b.session.error=null;b.session.original=null;b.messages.length=0;
  const count=b.writes.length,a=c.saveLifecycle(),d=c.saveLifecycle(),e=c.saveLifecycle();
  assert.equal(a,d);assert.equal(d,e);assert.equal(b.writes.length,count+1);
  const lifecycle=await b.nextWrite();assert.equal(b.flushes(),0);lifecycle.resolve();await a;assert.equal(b.flushes(),1);assert.equal(b.messages.length,0);

  let finishRead;input.files=[{size:bytes.length,text:()=>new Promise(resolve=>{finishRead=resolve;})}];
  const delayedImport=input.onchange({target:input}),newer=b.get('confirm-new-button').onclick(),lastWrite=await b.nextWrite(),lastState=c.state;
  finishRead(bytes);await delayedImport;assert.equal(c.state,lastState,'late file read cannot replace a newer colony');
  lastWrite.resolve();await newer;assert.equal(b.messages.at(-1).message,'A new foothold. A new history.');
});
