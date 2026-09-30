import { freightDetails, residentDetails, returnManifestDetails, residenceLabel, outpostGuide, outpostWarning, localDepotStock } from './outpost-panels.js';
import { residentIds } from './outposts.js';
import { expeditionCandidates } from './expedition-readiness.js';
import { breakerDetails } from './breaker-panels.js';
import { plumbingDetails } from './plumbing-panels.js';
import { waterNode } from './plumbing.js';
import { gasDetails } from './gas-panels.js';
import { gasNode } from './gas-networks.js';
import { liquidDetails } from './liquid-panels.js';
import { reactorDetails } from './reactor-panels.js';
import { fireDetails, fireOverview } from './fire-panels.js';
import { animalDetails, postDetails, pastureDetails } from './husbandry-panels.js';
import { iceAvailable } from './water.js';
import { depositDetails, waterSupplyDetails } from './water-panels.js';
import { itemsDetails, possessionDetails } from './possession-panels.js';
import { controlBindings, createAgentInterface } from './controls.js';
import { startRecording, stopRecording, recordingStatus, exportRecording, tileEntityId } from './telemetry.js';
import { comfortDetails } from './comfort-panels.js';
import { bunkDetails, crewHousingDetails } from './housing-panels.js';
import { roomDetails } from './room-panels.js';
import { sanitationRoomDetails, sanitaryDetails } from './sanitation-panels.js';
import { foodDetails } from './food-panels.js';
import { temperatureAt } from './thermal.js';
import { thermalDetails, climateDetails } from './thermal-panels.js';

import { BUILDINGS, SITES, RESOURCES, SPECIES } from './data.js';
import { createGame, step, deserialize, at, inside, roomAt, isDay, pathTo } from './simulation.js';
import { crewDetails, jobDetails } from './crew-panels.js';
import { constructionResources, reservedAt, siteWorkAllowed } from './construction.js';
import { quantity } from './inventory.js';
import { storageDetails, inventoryText } from './industry-panels.js';
import { loadColony, storeColony, exportColony } from './persistence.js';
import { atmosphereDetails, doorDetails } from './atmosphere-panels.js';
import { preflightDetails } from './preflight-panels.js';
import { expeditionDetails, shuttleDetails, missionStatus } from './expedition-panels.js';
import { maintenanceDetails, maintenanceOverview } from './maintenance-panels.js';
import { powerDetails } from './power-panels.js';
import { Renderer } from './render.js';
import { crewSprite, ANATOMIES } from './sprites.js';

const $ = id => document.getElementById(id);
window.addEventListener('error', event => {
  const box = $('toast'); box.textContent = `Colony paused: ${event.message}`; box.className = 'toast show error';
  document.body.dataset.runtimeError = event.message;
  speed = 0;
});
const esc = v => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let state, siteId = 'surface', mode = 'inspect', building = null, selected = null, speed = 1, previousSpeed = 1;
const saveSession = loadColony(() => localStorage);
state = saveSession.state; const fresh = saveSession.fresh;
const { loadFreight, unloadFreight, setReturnCrew, setOutpostResidents, setBreaker, resetBreaker, setWaterValve, setWaterPump, setWaterIntake, setWaterOutlet, setGasValve, setGasDevice, setGasExtractor, setTank, setReactor, resetReactor, setRadiator, setFireResponse, transportAnimalToPost, setBreeding, setPastureGate, setAnimalPost, setAnimalPolicy, setPossessionCollection, releasePossession, order, cancelJob, launch, cancelDeparture, recall, dischargeCell, resolveSignal, setLabor, setJobPriority, setBunkOwner, setRoomDesignation, setClimate, setDepotAccepted, setDepotPriority, setProductionOrder, setProductionPriority, setMachineEnabled, setDoorMode, setCargoAccepted, resumeExpedition, setAutoService, setCableEnabled, setPowerPriority, setLifePolicy } = controlBindings(()=>state);
window.spacefortress = createAgentInterface(()=>state,()=>setSpeed(0),()=>refresh());
const renderer = new Renderer($('world')); renderer.center();
let toastTimer, inspectorKey = null, inspectorPress = null, warningPress = null;
// Keep a pressed control alive until its click dispatches, even if a tick refreshes the UI.
$('inspector').addEventListener('pointerdown', e => {
  if(e.button===0&&e.target.closest?.('button, input, select, summary'))inspectorPress={pointerId:e.pointerId};
});
function finishInspectorPress(e){
  const press=inspectorPress;
  if(!press||(e.pointerId!==undefined&&e.pointerId!==press.pointerId))return;
  requestAnimationFrame(()=>{if(inspectorPress===press){inspectorPress=null;refresh();}});
}
window.addEventListener('pointerup',finishInspectorPress);
window.addEventListener('pointercancel',finishInspectorPress);
window.addEventListener('blur',finishInspectorPress);
$('environment').addEventListener('pointerdown', e => {
  if(e.button===0&&e.target.closest?.('[data-outpost-warning]')) warningPress={pointerId:e.pointerId};
});
function finishWarningPress(e) {
  const press=warningPress; if(!press||(e.pointerId!==undefined&&e.pointerId!==press.pointerId)) return;
  requestAnimationFrame(()=>{if(warningPress===press){warningPress=null;refresh();}});
}
window.addEventListener('pointerup',finishWarningPress);
window.addEventListener('pointercancel',finishWarningPress);
window.addEventListener('blur',finishWarningPress);
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = `toast show${error ? ' error' : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').className = 'toast', 4500); }
function result(r, success) { if (!r.ok) toast(r.message, true); else if (success) toast(success); refresh(); }
function save(silent = false, replace = false) {
  if (replace && state !== saveSession.state) $('export').textContent = 'Export save';
  if (saveSession.error && !replace) { if (!silent) toast('Previous save could not be loaded. Export it or choose New colony before replacing it.', true); return false; }
  try { storeColony(() => localStorage, saveSession, state, replace); $('save').disabled = false; $('save').title = 'Save in this browser'; $('export').textContent = 'Export save'; if (!silent) toast('Colony saved on this device.'); return true; }
  catch { toast('Browser storage unavailable. Use Export save to keep your colony.', true); return false; }
}
function setSpeed(value) { speed = value; if (value) previousSpeed = value; document.querySelectorAll('[data-speed]').forEach(b => { const active = Number(b.dataset.speed) === value; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active); }); }
function closeDrawer(side) {
  const drawer = $(`${side}-drawer`); drawer.classList.remove('open'); drawer.inert = true;
  for (const id of side === 'left' ? ['regions-menu', 'construction-menu'] : ['crew-menu', 'colony-menu']) { $(id).classList.remove('active'); $(id).setAttribute('aria-expanded', 'false'); }
}
function openDrawer(side, panel) {
  const drawer = $(`${side}-drawer`); drawer.dataset.panel = panel; drawer.inert = false; drawer.classList.add('open');
  const id = { regions: 'regions-menu', build: 'construction-menu', crew: 'crew-menu', colony: 'colony-menu' }[panel];
  if (id) { $(id).classList.add('active'); $(id).setAttribute('aria-expanded', 'true'); }
}
function toggleDrawer(side, panel) { const drawer = $(`${side}-drawer`); const wasOpen = drawer.classList.contains('open') && drawer.dataset.panel === panel; closeDrawer(side); if (!wasOpen) { closeDrawer(side === 'left' ? 'right' : 'left'); openDrawer(side, panel); } }
$('regions-menu').onclick = () => toggleDrawer('left', 'regions');
$('construction-menu').onclick = () => toggleDrawer('left', 'build');
$('crew-menu').onclick = () => toggleDrawer('right', 'crew');
$('colony-menu').title = 'Status and supplies for the current site';
$('colony-menu').onclick = () => { setMode('inspect'); selected = null; renderer.selection = null; refresh(); toggleDrawer('right', 'colony'); };
$('close-left').onclick = () => closeDrawer('left');
$('close-right').onclick = () => closeDrawer('right');
$('events-menu').onclick = () => { const open = $('event-log').classList.toggle('open'); $('events-menu').classList.toggle('active', open); $('events-menu').setAttribute('aria-expanded', open); };
$('settings-menu').onclick = () => document.querySelector('.file-actions').classList.toggle('open');
function setMode(value, type = null) { mode = value; building = type; document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === value)); document.querySelectorAll('[data-building]').forEach(b => b.classList.toggle('active', b.dataset.building === type)); $('map-tip').textContent = value === 'build' ? `${BUILDINGS[type].name}: click a tile to designate · Esc to inspect` : value === 'inspect' ? 'Select a tile to inspect · Drag to pan · Scroll to zoom' : `Click a tile to ${value === 'mine' ? 'extract material' : value === 'remove' ? 'dismantle' : 'repair'} · Esc to inspect`; }
let manifestState=null;const manifestDrafts=new Map();
function manifestDraft(destination){
  if(manifestState!==state){manifestDrafts.clear();manifestState=state;}
  if(!manifestDrafts.has(destination)){const active=state.departure?.site===destination?state.departure:state.mission?.site===destination?state.mission:null;manifestDrafts.set(destination,active?[...active.crew]:expeditionCandidates(state).filter(c=>c.eligible).slice(0,2).map(c=>c.id));}
  return manifestDrafts.get(destination);
}
let freightDraftState = null; const freightDrafts = new Map();
function freightDraft(site, operation) {
  if (freightDraftState !== state) { freightDrafts.clear(); freightDraftState = state; }
  const key = `${site}:${operation}`;
  if (!freightDrafts.has(key)) freightDrafts.set(key, { items: {}, resource: 'alloy', amount: 1 });
  return freightDrafts.get(key);
}
const siteFreightDrafts = site => ({ load: freightDraft(site, 'load'), unload: freightDraft(site, 'unload') });
let returnMission = null, returnDraftIds = [], returnDraftDirty = false;
function returnDraft() {
  if (returnMission !== state.mission) { returnMission = state.mission; returnDraftDirty = false; }
  if (!returnDraftDirty) returnDraftIds = [...(state.mission?.returnCrew || [])];
  return returnDraftIds;
}
function inspectSite(id) { setSite(id); openDrawer('right', 'inspect'); refresh(); }
$('environment').addEventListener('click', e => { const warning = e.target.closest('[data-outpost-warning]'); if (warning) inspectSite(warning.dataset.outpostWarning); });
function setSite(id) { siteId = id; selected = null; renderer.selection = null; renderer.hover = null; renderer.center(); setMode('inspect'); closeDrawer('left'); closeDrawer('right'); if (!['surface', 'universe'].includes(id) && !(id === 'wreck' && state.outposts.wreck.established)) openDrawer('right', 'inspect'); refresh(); }
const icons = { breaker:'⊣', waterPipe:'╪',waterReservoir:'▰',waterPump:'➜',waterIntake:'↧',waterOutlet:'↥', gasExtractor:'⇣',gasReservoir:'▰',gasPipe:'╋',gasTank:'◉',gasPump:'➜',gasVent:'≋', waterTank:'◒',bilgePump:'↥', reactor:'◉',radiator:'▤', fence: '▥', pastureGate: '▯', husbandryPost: '♧', galley: '♨', iceProcessor: '❄', artisan: '⚒', sculpture: '◇', holo: '✧', sanitary: '▣', recycler: '♲', medicalCot: '▱', medlab: '⚕', commons: '♧', cable: '⌁', floor: '◇', wall: '▥', door: '▣', bunk: '▰', solar: '▦', battery: '▤', scrubber: '▥', farm: '♧', refinery: '▧', advanced: '✧', stockpile: '▨', trap: '◈' };
$('build-menu').innerHTML = Object.entries(BUILDINGS).map(([id, b]) => `<button class="build-option" data-building="${id}" title="${esc(b.description)}"><span class="build-icon">${icons[id] || '⚙'}</span><span><span class="build-name">${b.name}</span><small>${Object.entries(b.cost).map(([r, n]) => `${n} ${r}`).join(' · ')}</small></span></button>`).join('');
function buildBlock() {
  if (!['surface','wreck'].includes(siteId)) return 'Choose the surface or Relay K-07 for construction.';
  if (siteWorkAllowed(state,siteId)) return null;
  return state.mission?.site === siteId && state.mission.phase === 'boarding' ? 'Resume field work to construct before departure.' : 'A working expedition or a living local resident must be at this site.';
}
$('build-menu').addEventListener('click', e => { const b = e.target.closest('[data-building]'); if (!b) return; if (buildBlock()) { toast(buildBlock(), true); return; } setMode('build', b.dataset.building); selected = null; closeDrawer('left'); closeDrawer('right'); toast(`${BUILDINGS[building].name} selected. Click a tile to designate construction.`); refresh(); });
$('destinations').addEventListener('click', e => { const b = e.target.closest('[data-site]'); if (b) setSite(b.dataset.site); });
document.querySelector('.orders').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
document.querySelector('.speeds').addEventListener('click', e => { const b = e.target.closest('[data-speed]'); if (b) setSpeed(Number(b.dataset.speed)); });
$('save').onclick = () => save();
$('center').onclick = () => renderer.center();
$('zoom-in').onclick = () => renderer.zoom = Math.min(2.2, renderer.zoom * 1.15);
$('zoom-out').onclick = () => renderer.zoom = Math.max(.35, renderer.zoom / 1.15);
function setOverlay(name) { const active=!renderer[name]; renderer.powerOverlay=false;renderer.gasOverlay=false;renderer.waterOverlay=false;renderer[name]=active;for(const view of ['power','gas','water'])$(`${view}-overlay`).setAttribute('aria-pressed',renderer[`${view}Overlay`]);refresh(); }
$('power-overlay').onclick = () => setOverlay('powerOverlay');
$('gas-overlay').onclick = () => setOverlay('gasOverlay');
$('water-overlay').onclick = () => setOverlay('waterOverlay');
$('cutaway').onclick = () => { renderer.cutaway = !renderer.cutaway; $('cutaway').setAttribute('aria-pressed', renderer.cutaway); };
function openGuide() { setSpeed(0); $('guide').showModal(); }
$('help').onclick = openGuide;
$('close-guide').onclick = () => $('guide').close();
$('guide').addEventListener('close', () => setSpeed(previousSpeed));
$('new-game').onclick = () => { setSpeed(0); $('confirm-new').showModal(); };
$('cancel-new').onclick = () => $('confirm-new').close();
$('confirm-new').addEventListener('close', () => setSpeed(previousSpeed));
$('confirm-new-button').onclick = () => { state = createGame(Math.floor(Math.random() * 2147483647) + 1); lastSave = 0; accumulator = 0; setSite('surface'); const stored = save(true, true); $('confirm-new').close(); if (stored) toast('A new foothold. A new history.'); };
$('export').onclick = () => { const exported = exportColony(saveSession, state); const url = URL.createObjectURL(new Blob([exported.contents], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = exported.protectedOriginal ? 'spacefortress-unreadable-save.json' : `spacefortress-cycle-${Math.floor(state.tick / 300) + 1}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Save exported.'); };
$('record-simulation').onclick = () => {
  if (recordingStatus(state).active) { stopRecording(state); toast('Simulation recording stopped. Export it from this menu.'); }
  else { startRecording(state); toast('Recording actions and simulation changes locally.'); }
  refresh();
};
$('export-recording').onclick = () => {
  try { const url=URL.createObjectURL(new Blob([exportRecording(state)],{type:'application/x-ndjson'}));const a=document.createElement('a');a.href=url;a.download=`spacefortress-recording-${state.tick}.ndjson`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Simulation recording exported.'); }
  catch(error){toast(error.message,true);}
};
$('import').onclick = () => { setSpeed(0); $('save-file').click(); };
$('save-file').addEventListener('cancel', () => setSpeed(previousSpeed));
$('save-file').onchange = async e => { const file = e.target.files[0]; if (!file) return; try { if (file.size > 5_000_000) throw new Error('Save is too large.'); const imported = deserialize(await file.text()); state = imported; lastSave = state.tick; accumulator = 0; setSite('surface'); if (save(true, true)) toast('Colony restored.'); } catch (error) { toast(`Could not import: ${error.message}`, true); } finally { e.target.value = ''; setSpeed(previousSpeed); } };
$('crew-list').onclick = e => { const row = e.target.closest('[data-crew]'); if (!row) return; const c = state.crew.find(c => c.id === row.dataset.crew); setMode('inspect'); if (c.site !== 'transit' && c.site !== siteId) setSite(c.site); selected = { crew: c.id }; renderer.selection = selected; openDrawer('right', 'inspect'); refresh(); };
$('inspector').addEventListener('input', e => {
  const form = e.target.closest('[data-freight-form]'); if (!form) return;
  const draft = freightDraft(form.dataset.site, form.dataset.operation);
  draft.resource = form.elements['freight-resource'].value; draft.amount = form.elements['freight-amount'].value;
});
$('inspector').onsubmit = e => {
  const freightForm = e.target.closest('[data-freight-form]');
  if (freightForm) {
    e.preventDefault(); const draft = freightDraft(freightForm.dataset.site, freightForm.dataset.operation);
    const resource = freightForm.elements['freight-resource'].value, units = Number(freightForm.elements['freight-amount'].value);
    if (!RESOURCES.includes(resource) || !Number.isFinite(units) || units <= 0 || (resource === 'keepsakes' && !Number.isInteger(units))) { toast('Enter a positive quantity; keepsakes must be whole items.', true); return; }
    const next = (draft.items[resource] || 0) + units; if (!Number.isFinite(next)) { toast('The manifest quantity is too large.',true); return; }
    draft.items[resource] = next; draft.resource = resource; draft.amount = units;
    document.activeElement.blur(); refresh(); return;
  }
  const gasForm=e.target.closest('[data-gas-form]');
  if(gasForm&&selected){e.preventDefault();const target=Number(gasForm.elements['gas-target'].value),t=at(state.sites[siteId],selected.x,selected.y);document.activeElement.blur();result(t.building==='gasExtractor'?setGasExtractor(state,siteId,t.x,t.y,t.gasDevice.enabled,t.gasDevice.mode,target):setGasDevice(state,siteId,t.x,t.y,t.gasDevice.enabled,'east',target),'Pressure target updated.');return;}
  const reactorForm=e.target.closest('[data-reactor-form]');
  if(reactorForm&&selected){e.preventDefault();const percent=Number(reactorForm.elements['reactor-output'].value),t=at(state.sites[siteId],selected.x,selected.y);document.activeElement.blur();result(setReactor(state,siteId,t.x,t.y,percent,t.machine.enabled),'Reactor output updated.');return;}
  const climateForm = e.target.closest('[data-climate-form]');
  if (climateForm && selected) { e.preventDefault(); const target = Number(climateForm.elements['climate-target'].value), t = at(state.sites[siteId], selected.x, selected.y); document.activeElement.blur(); result(setClimate(state, siteId, t.x, t.y, target, t.climate.enabled), 'Temperature target updated.'); return; }
  const form = e.target.closest('[data-production-form]'); if (!form || !selected) return;
  e.preventDefault(); const mode = form.elements['production-mode'].value, limit = Number(form.elements['production-limit'].value);
  document.activeElement.blur(); result(setProductionOrder(state, siteId, selected.x, selected.y, mode, limit), 'Production order updated.');
};
$('inspector').onclick = e => {
  const button = e.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'inspect-outpost-tile') { setSite(button.dataset.site); selected={site:siteId,x:Number(button.dataset.x),y:Number(button.dataset.y)}; renderer.selection=selected; openDrawer('right','inspect'); refresh(); return; }
  if (action === 'inspect-site') { inspectSite(button.dataset.site); return; }
  if (action === 'freight-draft-remove') { delete freightDraft(button.dataset.site,button.dataset.operation).items[button.dataset.resource]; refresh(); return; }
  if (action === 'freight-load' || action === 'freight-unload') {
    const draft = freightDraft(button.dataset.site,action === 'freight-load' ? 'load' : 'unload');
    const r = action === 'freight-load' ? loadFreight(state,{...draft.items}) : unloadFreight(state,button.dataset.site,{...draft.items});
    if (r.ok) draft.items = {}; result(r,'Freight job ordered. Crew must carry and finish the shipment.'); return;
  }
  if (action === 'freight-unload-all') { result(unloadFreight(state,button.dataset.site),'Unloading ordered. Goods become local only when delivered.'); return; }
  if (action === 'show-return-team') { const details=$('inspector').querySelector('[data-panel-key="return-wreck"]'); if(details){details.open=true;details.scrollIntoView({block:'nearest'});} return; }
  if (action === 'return-crew-draft') {
    const ids = returnDraft(), index = ids.indexOf(button.dataset.crew); returnDraftDirty = true;
    if (index >= 0) ids.splice(index,1); else if (ids.length < 2) ids.push(button.dataset.crew); refresh(); return;
  }
  if (action === 'return-crew-apply') { const r = setReturnCrew(state,[...returnDraft()]); if (r.ok) returnDraftDirty = false; result(r,'Return team assigned. Boarding still happens physically.'); return; }
  if (action === 'resident-toggle') {
    const ids = residentIds(state,button.dataset.site), crew = button.dataset.crew;
    const r = setOutpostResidents(state,button.dataset.site,ids.includes(crew) ? ids.filter(id=>id!==crew) : [...ids,crew]);
    if (r.ok) returnDraftDirty = false; result(r,'Residence updated. Check the return team before recall.'); return;
  }
  if(['breaker-toggle','breaker-direction','breaker-mode'].includes(action)&&selected){const t=at(state.sites[siteId],selected.x,selected.y),p=t.protection;result(setBreaker(state,siteId,t.x,t.y,action==='breaker-toggle'?!p.enabled:false,action==='breaker-direction'?button.dataset.direction:p.direction,action==='breaker-mode'?button.dataset.breakerMode:p.mode));}
  if(action==='breaker-reset'&&selected)result(resetBreaker(state,siteId,selected.x,selected.y));
  if(action==='plumbing-valve'&&selected){const t=at(state.sites[siteId],selected.x,selected.y);result(setWaterValve(state,siteId,t.x,t.y,!waterNode(t).open));}
  if(['plumbing-toggle','plumbing-direction','plumbing-mode'].includes(action)&&selected){const t=at(state.sites[siteId],selected.x,selected.y),d=t.waterDevice,enabled=action==='plumbing-toggle'?!d.enabled:d.enabled,direction=action==='plumbing-direction'?button.dataset.direction:d.direction,mode=action==='plumbing-mode'?button.dataset.waterMode:d.mode;const configure=t.building==='waterPump'?setWaterPump:t.building==='waterIntake'?setWaterIntake:setWaterOutlet;result(configure(state,siteId,t.x,t.y,enabled,direction,mode));}
  if(['repairWaterPipe','removeWaterPipe'].includes(action)&&selected)result(order(state,siteId,selected.x,selected.y,action),'Water pipe work designated.');
  if(action==='gas-valve'&&selected){const t=at(state.sites[siteId],selected.x,selected.y);result(setGasValve(state,siteId,t.x,t.y,!gasNode(t).open));}
  if(['gas-toggle','gas-direction'].includes(action)&&selected){const t=at(state.sites[siteId],selected.x,selected.y),d=t.gasDevice;result(setGasDevice(state,siteId,t.x,t.y,action==='gas-toggle'?!d.enabled:d.enabled,action==='gas-direction'?button.dataset.direction:(d.direction||'east'),d.target??100));}
  if(['gas-extractor-toggle','gas-extractor-mode'].includes(action)&&selected){const t=at(state.sites[siteId],selected.x,selected.y),d=t.gasDevice;result(setGasExtractor(state,siteId,t.x,t.y,action==='gas-extractor-toggle'?!d.enabled:d.enabled,action==='gas-extractor-mode'?button.dataset.mode:d.mode,d.target));}
  if(['repairPipe','removePipe'].includes(action)&&selected)result(order(state,siteId,selected.x,selected.y,action),'Pipe work designated.');
  if(action==='animal-assign')result(setAnimalPost(state,button.dataset.animal,Number(button.dataset.x),Number(button.dataset.y)));
  if(action==='animal-release')result(setAnimalPost(state,button.dataset.animal,null,null));
  if(action==='fire-response'){const current=state.sites[button.dataset.site];result(setFireResponse(state,current.id,!current.fireSafety.automatic));}
  if(action==='fire-suppress'&&selected)result(order(state,siteId,selected.x,selected.y,'extinguish'));
  if(action==='animal-transport')result(transportAnimalToPost(state,button.dataset.animal,+button.dataset.x,+button.dataset.y));
  if(action==='animal-breed'){const a=state.creatures.find(a=>a.id===button.dataset.animal);result(setBreeding(state,a.id,!a.lifecycle.enabled));}
  if(action==='animal-policy'){const a=state.creatures.find(a=>a.id===button.dataset.animal);result(setAnimalPolicy(state,a.id,button.dataset.policy,!a.husbandry[button.dataset.policy]));}
  if(action==='possession-policy'){const c=state.crew.find(c=>c.id===button.dataset.crew);result(setPossessionCollection(state,c.id,!c.possessions.collect));}
  if(action==='possession-release')result(releasePossession(state,button.dataset.crew));
  if (action === 'bunk-owner' && selected) result(setBunkOwner(state, siteId, selected.x, selected.y, button.dataset.owner || null));
  if (action === 'room-role' && selected) result(setRoomDesignation(state, siteId, selected.x, selected.y, button.dataset.role));
  if(['tank-fill','tank-drain'].includes(action)&&selected){const t=at(state.sites[siteId],selected.x,selected.y);result(setTank(state,siteId,t.x,t.y,action==='tank-fill'?!t.machine.enabled:t.machine.enabled,action==='tank-drain'?!t.tank.drain:t.tank.drain));}
  if(action==='reactor-toggle'&&selected){const t=at(state.sites[siteId],selected.x,selected.y);result(setReactor(state,siteId,t.x,t.y,t.reactor.output,!t.machine.enabled));}
  if(action==='reactor-reset'&&selected)result(resetReactor(state,siteId,selected.x,selected.y));
  if(action==='radiator-toggle'&&selected){const t=at(state.sites[siteId],selected.x,selected.y);result(setRadiator(state,siteId,t.x,t.y,!t.radiator.enabled));}
  if (action === 'climate-toggle' && selected) { const t = at(state.sites[siteId], selected.x, selected.y); result(setClimate(state, siteId, t.x, t.y, t.climate.target, !t.climate.enabled)); }
  if (action === 'depot-filter' && selected) { const t = at(state.sites[siteId], selected.x, selected.y); result(setDepotAccepted(state, siteId, t.x, t.y, button.dataset.resource, !t.storage.accepted.includes(button.dataset.resource))); }
  if (action === 'depot-priority' && selected) result(setDepotPriority(state, siteId, selected.x, selected.y, Number(button.dataset.priority)));
  if (action === 'production-priority' && selected) result(setProductionPriority(state, siteId, selected.x, selected.y, Number(button.dataset.priority)));
  if(action==='expedition-crew'&&!state.departure&&!state.mission){const ids=manifestDraft(siteId),id=button.dataset.crew,index=ids.indexOf(id);if(index>=0)ids.splice(index,1);else if(ids.length<2&&expeditionCandidates(state).some(c=>c.id===id&&c.eligible))ids.push(id);refresh();}
  if (action === 'launch') result(launch(state, siteId, [...manifestDraft(siteId)]), 'Departure planned. Haulers will load supplies, then crew will board.');
  if (action === 'recall') result(recall(state), 'Recall ordered. Crew will return to the shuttle before departure.');
  if (action === 'cell') result(dischargeCell(state), 'Charged cell transferred to colony batteries.');
  if (action === 'cancel-departure') result(cancelDeparture(state), 'Preparation cancelled. Loaded supplies remain aboard.');
  if (action === 'unload-shuttle') result(order(state, 'surface', 16, 11, 'unloadShuttle'), 'Unloading designated. Crew will recover the service stores.');
  if (action === 'refit') result(order(state, 'surface', 16, 11, 'refit', button.dataset.fit), 'Shuttle refit designated. Engineers will deliver its materials.');
  if (action === 'resume-expedition') result(resumeExpedition(state), 'Field work resumed. Watch crew safety margins.');
  if (action === 'cargo-policy') result(setCargoAccepted(state, button.dataset.resource, !state.shuttle.accepted.includes(button.dataset.resource)));
  if (action === 'auto-service' && selected) { const t = at(state.sites[siteId], selected.x, selected.y); result(setAutoService(state, siteId, t.x, t.y, !t.maintenance.auto)); }
  if (['service', 'repair-structure'].includes(action) && selected) result(order(state, siteId, selected.x, selected.y, action === 'service' ? 'service' : 'repair'), 'Engineering work designated.');
  if (action === 'inspect-maintenance') { setSite('surface'); selected = { x: Number(button.dataset.x), y: Number(button.dataset.y), site: 'surface' }; renderer.selection = selected; openDrawer('right', 'inspect'); refresh(); }
  if (action === 'bank-cell' && selected && siteId === 'surface') result(dischargeCell(state, selected.x, selected.y), 'Power cell loaded into this bank.');
  if (action === 'power-priority' && selected) result(setPowerPriority(state, siteId, selected.x, selected.y, Number(button.dataset.priority)));
  if (action === 'cable-toggle' && selected) { const t = at(state.sites[siteId], selected.x, selected.y); result(setCableEnabled(state, siteId, t.x, t.y, !t.cable.enabled)); }
  if (['repairCable', 'removeCable'].includes(action) && selected) result(order(state, siteId, selected.x, selected.y, action), 'Cable work designated.');
  if (action === 'decode' || action === 'isolate') result(resolveSignal(state, action === 'decode'), 'Signal report recorded.');
  if (action === 'cancel') { cancelJob(state, button.dataset.job); toast('Order cancelled. Supplies remain at their current locations.'); refresh(); }
  if (action === 'life-policy') result(setLifePolicy(state, button.dataset.crew, button.dataset.policy));
  if (action === 'labor') { const c = state.crew.find(c => c.id === button.dataset.crew); result(setLabor(state, c.id, button.dataset.labor, !c.labors[button.dataset.labor])); }
  if (action === 'priority') result(setJobPriority(state, button.dataset.job, Number(button.dataset.priority)));
  if (action === 'pasture-gate' && selected) result(setPastureGate(state, siteId, selected.x, selected.y, button.dataset.gateMode));
  if (action === 'door' && selected) result(setDoorMode(state, siteId, selected.x, selected.y, button.dataset.doorMode));
  if (action === 'machine' && selected) { const t = at(state.sites[siteId], selected.x, selected.y); result(setMachineEnabled(state, siteId, t.x, t.y, !t.machine.enabled)); }
  if (action === 'clear') { selected = null; renderer.selection = null; if (siteId === 'surface') closeDrawer('right'); refresh(); }
  if (action === 'extract') result(order(state, siteId, selected.x, selected.y, 'mine'), 'Extraction designated.');
};
let pointer = null;
$('world').addEventListener('pointerdown', e => { $('world').focus(); pointer = { x: e.offsetX, y: e.offsetY, lastX: e.offsetX, lastY: e.offsetY, moved: false, button: e.button }; $('world').setPointerCapture(e.pointerId); });
$('world').addEventListener('pointermove', e => {
  if (pointer) { const dx = e.offsetX - pointer.lastX, dy = e.offsetY - pointer.lastY; if (Math.abs(e.offsetX - pointer.x) + Math.abs(e.offsetY - pointer.y) > 5) pointer.moved = true; if (pointer.moved) { renderer.pan.x += dx; renderer.pan.y += dy; } pointer.lastX = e.offsetX; pointer.lastY = e.offsetY; }
  if (siteId !== 'universe') renderer.hover = renderer.screenToTile(e.offsetX, e.offsetY, state.sites[siteId]);
});
$('world').addEventListener('pointerup', e => {
  if (!pointer) return; const click = !pointer.moved && pointer.button === 0; pointer = null;
  if (!click) return;
  if (siteId === 'universe') { const n = renderer.regionNodes().find(n => Math.hypot(n.x - e.offsetX, n.y - e.offsetY) < 65); if (n) setSite(n.id); return; }
  const pos = renderer.screenToTile(e.offsetX, e.offsetY, state.sites[siteId]); if (!inside(state.sites[siteId], pos.x, pos.y)) return;
  selected = { ...pos, site: siteId }; renderer.selection = selected;
  if (mode !== 'inspect') result(order(state, siteId, pos.x, pos.y, mode, building), 'Work designated.');
  else openDrawer('right', 'inspect');
  refresh();
});
$('world').addEventListener('pointercancel', () => pointer = null);
$('world').addEventListener('pointerleave', () => renderer.hover = null);
$('world').addEventListener('contextmenu', e => e.preventDefault());
$('world').addEventListener('wheel', e => { e.preventDefault(); renderer.zoom = Math.max(.35, Math.min(2.2, renderer.zoom * (e.deltaY < 0 ? 1.08 : .925))); }, { passive: false });
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.code === 'Space' && document.activeElement.tagName !== 'BUTTON') { e.preventDefault(); setSpeed(speed ? 0 : previousSpeed); }
  if (e.key === 'Escape') { selected = null; renderer.selection = null; setMode('inspect'); closeDrawer('left'); closeDrawer('right'); $('event-log').classList.remove('open'); document.querySelector('.file-actions').classList.remove('open'); refresh(); }
  if (['1', '2', '3', '4'].includes(e.key)) setMode({ 1: 'inspect', 2: 'mine', 3: 'repair', 4: 'remove' }[e.key]);
  if (e.key === 'Home') { e.preventDefault(); renderer.center(); }
  const pan = { ArrowUp: [0, 30], ArrowDown: [0, -30], ArrowLeft: [30, 0], ArrowRight: [-30, 0] }[e.key];
  if (pan) { e.preventDefault(); renderer.pan.x += pan[0]; renderer.pan.y += pan[1]; }
});
function clock(tick) { return `${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick % 60).padStart(2, '0')}`; }
function meter(value, label) { return `<div class="stat-card"><strong class="${value < 30 ? 'warn' : ''}">${Math.round(value)}<small>%</small></strong><span>${label}</span><div class="bar"><i class="${value < 30 ? 'warn' : ''}" style="width:${Math.max(0, Math.min(100, value))}%"></i></div></div>`; }
function inspector() {
  if (selected?.crew) {
    const c = state.crew.find(c => c.id === selected.crew);
    return crewDetails(c, SITES[c.site]?.name || 'In transit', state.crew, c.site === 'transit' ? 20 : temperatureAt(state.sites[c.site], c.x, c.y), state.jobs.filter(j => j.patient === c.id), state.tick, residenceLabel(state,c)+crewHousingDetails(state, c, pathTo)+possessionDetails(c,state.crew)+foodDetails(c.medical.openedFood,c.site==='transit'?20:temperatureAt(state.sites[c.site],c.x,c.y),'Bedside ration')+foodDetails(c.intent?.openedFood,c.site==='transit'?20:temperatureAt(state.sites[c.site],c.x,c.y),'Opened ration'), c.site === 'surface' || c.site === 'wreck' && residentIds(state,'wreck').includes(c.id));
  }
  if (mode === 'build') {
    const b = BUILDINGS[building], supplies = constructionResources(state,siteId); return `<div class="eyebrow">${esc(SITES[siteId].name)} · CONSTRUCTION ORDER</div><h2>${b.name}</h2><p>${b.description}</p><dl>${Object.entries(b.cost).map(([r, n]) => `<dt>${r}</dt><dd>${n} / ${Math.floor(supplies[r])} in stock or loose</dd>`).join('')}</dl><p>${building === 'cable' ? 'Cables can run beneath existing structures.' : ['gasPipe','waterPipe'].includes(building) ? 'Pipes can run beneath existing structures and beside cables. Pipe equipment has its own ports and occupies a clear tile.' : 'Click a clear tile.'} Crew reserve reachable supplies, carry them to the site, then build.</p>`;
  }
  if (selected && selected.site === siteId) {
    const t = at(state.sites[siteId], selected.x, selected.y), jobs = state.jobs.filter(j => j.site === siteId && j.x === t.x && j.y === t.y), room = roomAt(state.sites[siteId], t.x, t.y);
    const creature = state.creatures.find(c => c.site === siteId && c.x === t.x && c.y === t.y);
    if (creature && !((renderer.gasOverlay&&(gasNode(t)||t.gasDevice))||(renderer.waterOverlay&&(waterNode(t)||t.waterDevice))) && !['husbandryPost','pastureGate','fence'].includes(t.building)) return `<div class="eyebrow">FRONTIER LIFE / ${creature.species === 'tibble' ? 'BIOMASS PEST' : 'GRAZER'}</div><h2>${SPECIES[creature.species].name}</h2><p>${SPECIES[creature.species].description}</p>${creature.husbandry?'':`<dl><dt>Condition</dt><dd>${creature.health}%</dd><dt>Fed</dt><dd>${Math.round(creature.fed)}%</dd></dl>`}${animalDetails(state,creature,pathTo)}<button data-action="clear">Back to region</button>`;
    const name = BUILDINGS[t.building]?.name || (iceAvailable(t) ? 'Exposed ice seam' : null) || ({ salvage: 'Satellite components', volatile: 'Volatile deposit', collector: 'Solar collector', dock: 'Shuttle berth', shuttle: 'Surface shuttle berth', ore: 'Metal-bearing rock', rock: 'Basalt outcrop', ground: 'Regolith', floor: 'Habitat floor', deck: 'Station deck', ice: 'Comet ice', void: 'Open space' }[t.building || t.terrain]);
    const extractable = iceAvailable(t) || ['rock', 'ore'].includes(t.terrain) || ['salvage', 'volatile'].includes(t.building);
    return `<div class="eyebrow">TILE ${t.x} / ${t.y}</div><h2>${name}</h2><p>${BUILDINGS[t.building]?.description || (extractable ? 'Recover material with an extraction order.' : 'Part of our small foothold in the universe.')}</p><dl>${atmosphereDetails(room)}${thermalDetails(state.sites[siteId], t)}${sanitationRoomDetails(state, state.sites[siteId], t)}${t.building ? `<dt>Condition</dt><dd>${Math.round(t.hp)}%</dd>` : ''}${BUILDINGS[t.building]?.demand ? `<dt>Power</dt><dd>${t.powered ? 'Online' : 'Offline'}</dd>` : ''}${t.drop ? `<dt>Awaiting haul</dt><dd>${esc(inventoryText(t.drop))}</dd>` : ''}</dl>${fireDetails(state,state.sites[siteId],t)}${gasDetails(state.sites[siteId],t)}${plumbingDetails(state,state.sites[siteId],t)}${liquidDetails(t)}${reactorDetails(state.sites[siteId],t)}${pastureDetails(state,t)}${postDetails(state,t,pathTo)}${depositDetails(t)}${shuttleDetails(state, t)}${['shuttle','dock'].includes(t.building) ? freightDetails(state,siteId,siteFreightDrafts(siteId)) : ''}${maintenanceDetails(state, state.sites[siteId], t)}${breakerDetails(state,state.sites[siteId],t)}${powerDetails(state.sites[siteId], t)}${doorDetails(t, state.tick)}${foodDetails(t.drop, temperatureAt(state.sites[siteId], t.x, t.y), "Loose food")}${bunkDetails(state, state.sites[siteId], t)}${itemsDetails(t.drop)}${roomDetails(state, state.sites[siteId], t)}${comfortDetails(state, state.sites[siteId], t)}${climateDetails(t)}${sanitaryDetails(state, state.sites[siteId], t)}${storageDetails(t, state, siteId)}${quantity(reservedAt(state, siteId, t.x, t.y)) ? `<p>Reserved here: ${esc(inventoryText(reservedAt(state, siteId, t.x, t.y)))}</p>` : ''}${jobs.length ? jobs.filter(j => j.kind !== 'operate').map(jobDetails).join('<hr>') : extractable ? '<button data-action="extract">Designate extraction</button>' : ''}<button data-action="clear">Back to region</button>`;
  }
  if (siteId === 'surface' || siteId === 'universe') return `<div class="eyebrow">${state.mission ? 'EXPEDITION ACTIVE' : 'YOUR FIRST FOOTHOLD'}</div><h2>${state.mission ? SITES[state.mission.site].name : 'Make a home out here.'}</h2><p>${state.mission ? `${missionStatus(state.mission)}` : 'Build a colony, recover forgotten technology, and push farther into the unknown.'}</p><dl><dt>Power supply</dt><dd>${state.sites.surface.power.output.toFixed(0)} / ${state.sites.surface.power.demand} kW</dd><dt>Circuits short of power</dt><dd>${state.sites.surface.power.brownouts} / ${state.sites.surface.power.networks}</dd><dt>Battery</dt><dd>${Math.floor(state.sites.surface.power.battery)} / ${state.sites.surface.power.capacity} kJ</dd><dt>Breathing mix stored</dt><dd>${state.resources.air.toFixed(1)} units</dd><dt>Medicine in storage</dt><dd>${Math.floor(state.resources.medicine)} units</dd><dt>Injured crew</dt><dd>${state.crew.filter(c => c.health > 0 && c.medical.injury > 0).length}</dd><dt>Work orders</dt><dd>${state.jobs.length} pending</dd><dt>Tibbles detected</dt><dd>${state.creatures.filter(c => c.species === 'tibble').length}</dd></dl>${state.mission ? '<button data-action="recall">Recall expedition</button>' : '<p>Select Relay K-07 to launch your first salvage expedition.</p>'}${fireOverview(state.sites.surface)}${waterSupplyDetails(state)}${preflightDetails(state)}${freightDetails(state,'surface',siteFreightDrafts('surface'))}<button data-action="inspect-site" data-ui-action="site.inspect" data-site="wreck">Inspect Relay K-07</button>${maintenanceOverview(state)}${state.resources.cells > 0 ? '<button data-action="cell">Discharge a power cell</button>' : ''}${state.anomaly && !state.anomaly.resolved ? `<hr><div class="eyebrow">UNREGISTERED SIGNAL</div><h2>${esc(state.anomaly.title)}</h2><p>${esc(state.anomaly.description)}</p><button data-action="decode">Decode · 1 component</button><button data-action="isolate">Isolate channel</button>` : ''}`;
  return expeditionDetails(state, siteId, manifestDraft(siteId)) + freightDetails(state,siteId,siteFreightDrafts(siteId)) + residentDetails(state,siteId) + returnManifestDetails(state,siteId,returnDraft()) + (siteId === 'wreck' ? outpostGuide() : '');
}
function refresh() {
  const recording=recordingStatus(state);
  $('record-simulation').textContent=recording.active?'Stop recording':recording.reason==='not_started'?'Start recording':'New recording';
  $('record-simulation').title=recording.reason==='not_started'?'Capture local actions and simulation outcomes':recording.active?'Stop and retain this recording':'Replaces this session recording. Export it first to keep it.';
  $('recording-status').textContent=recording.reason==='not_started'?'Recording off':`${recording.records} records · ${recording.active?'recording':recording.reason.replaceAll('_',' ')}`;
  $('export-recording').disabled=recording.reason==='not_started';
  $('inspector').dataset.entity=selected?.crew || (selected?.x!==undefined?tileEntityId(siteId,selected.x,selected.y):`site:${siteId}`);
  const resourceSite = state.sites[siteId] ? siteId : 'surface', localStock = localDepotStock(state,resourceSite);
  $('resources').setAttribute('aria-label', `${SITES[resourceSite].name} depot stock`);
  $('resources').innerHTML = RESOURCES.filter(r => !['air', 'medicine', 'waste', 'fertilizer', 'keepsakes', 'ice'].includes(r)).map(r => `<div class="resource ${localStock[r] < 3 ? 'low' : ''}" title="${esc(SITES[resourceSite].name)} depot stock · ${r === 'alloy' ? 'Construction material. Refine mined ore.' : r === 'components' ? 'Advanced parts from the fabricator or orbital wrecks. Counts depot stock; some may be reserved.' : r === 'cells' ? 'Energy harvested at Helios Reach. Discharge into surface batteries.' : r}"><span class="value">${Math.floor(localStock[r] || 0)}</span><span class="label">${r}</span></div>`).join('');
  $('destinations').innerHTML = `<button data-site="universe" class="${siteId === 'universe' ? 'active' : ''}" style="--dot:#b2c3ca">System overview<small>THE KEPLER FRONTIER</small></button>` + Object.entries(SITES).map(([id, d]) => `<button data-site="${id}" class="${siteId === id ? 'active' : ''}" style="--dot:${d.color}">${d.name}<small>${id === 'surface' ? 'PLANETARY COLONY' : id === 'wreck' ? state.outposts.wreck.established ? `${residentIds(state,'wreck').length} REGISTERED RESIDENTS` : 'SATELLITE SALVAGE' : id === 'comet' ? state.tick < state.comet.arrives ? `ARRIVES IN ${state.comet.arrives - state.tick}s` : `DEPARTS IN ${state.comet.leaves - state.tick}s` : 'ADVANCED SOLAR SITE'}</small></button>`).join('');
  $('build-site').textContent = SITES[siteId]?.name || 'Choose a site';
  const canBuild = !buildBlock();
  $('build-status').textContent = buildBlock() || 'Uses supplies and workers at this site.';
  for (const button of $('build-menu').querySelectorAll('button')) button.disabled = !canBuild;
  const def = SITES[siteId]; $('site-label').textContent = def?.label || '00 / SYSTEM OVERVIEW'; $('site-name').textContent = def?.name || 'The Kepler frontier'; $('site-subtitle').textContent = def?.sub || 'One colony. An entire sky of possibilities.';
  const statusSite = state.sites[siteId] || state.sites.surface, p = statusSite.power;
  if (!warningPress) {
  $('environment').innerHTML = siteId === 'surface' ? `<span class="env-chip">${isDay(state) ? '☀ Daylight' : '☾ Night'} · ${isDay(state) ? 220 - state.tick % 300 : 300 - state.tick % 300}s</span><span class="env-chip ${p.output < p.demand ? 'warn' : ''}">${p.output.toFixed(0)} kW generation / ${p.demand} demand</span><span class="env-chip optional">${state.sites.surface.thermal.ambient}°C exterior</span>${state.sites.surface.tiles.some(t=>t.fire)?`<span class="env-chip warn">${state.sites.surface.tiles.filter(t=>t.fire).length} active fires</span>`:''}${state.sites.surface.tiles.some(t=>t.wetShort)?`<span class="env-chip warn">Wet cable short · isolate power</span>`:''}${state.sites.surface.tiles.some(t=>t.reactor?.tripped)?`<span class="env-chip warn">Reactor shutdown · inspect to reset</span>`:''}${state.debris.target ? `<span class="env-chip warn">Debris at ${state.debris.target.x}/${state.debris.target.y} in ${state.debris.next - state.tick}s</span>` : ''}` : siteId === 'universe' ? '<span class="env-chip">Click a destination to inspect</span>' : `<span class="env-chip">Exterior vacuum · suits required</span><span class="env-chip">${state.mission?.site === siteId ? state.mission.phase : 'Remote survey'}</span>${siteId === 'solar' ? `<span class="env-chip warn">${state.tick % 120 >= 90 ? 'Solar squall active' : `Next squall in ${90 - state.tick % 120}s`}</span>` : ''}`;
  $('environment').insertAdjacentHTML('beforeend',outpostWarning(state,siteId));
  }
  $('crew-count').textContent = `${state.crew.filter(c => c.health > 0).length} ALIVE`;
  $('health-summary').innerHTML = meter(statusSite.air, `${SITES[statusSite.id].name} AIR`) + meter(p.capacity ? p.battery / p.capacity * 100 : 0, 'BATTERY RESERVE');
  const nextInspectorKey = JSON.stringify([siteId, mode, building, selected]);
  if (!inspectorPress && (nextInspectorKey !== inspectorKey || !document.activeElement.closest?.('[data-production-form], [data-climate-form], [data-reactor-form], [data-gas-form], [data-freight-form]'))) {
    const assigningBunk = nextInspectorKey === inspectorKey && $('inspector').querySelector('[data-bunk-assignment]')?.open;
    const openItems=nextInspectorKey===inspectorKey?[...$('inspector').querySelectorAll('[data-item-list], [data-meal-list], [data-gas-composition], [data-plumbing-endpoints], [data-breaker-diagnostics], [data-expedition-roster], .animal-breeding, .animal-transport')].map(d=>d.open):[];
    const openPanels = nextInspectorKey === inspectorKey ? new Map([...$('inspector').querySelectorAll('[data-panel-key]')].map(d=>[d.dataset.panelKey,d.open])) : new Map();
    $('inspector').innerHTML = inspector();
    for (const details of $('inspector').querySelectorAll('[data-panel-key]')) details.open = openPanels.get(details.dataset.panelKey) || false;
    [...$('inspector').querySelectorAll('[data-item-list], [data-meal-list], [data-gas-composition], [data-plumbing-endpoints], [data-breaker-diagnostics], [data-expedition-roster], .animal-breeding, .animal-transport')].forEach((d,i)=>d.open=!!openItems[i]);
    if (assigningBunk) { const details = $('inspector').querySelector('[data-bunk-assignment]'); if (details) details.open = true; }
  }
  if(!inspectorPress){
    if (nextInspectorKey !== inspectorKey) $('right-drawer').scrollTop = 0;
    inspectorKey = nextInspectorKey;
  }
  const actionIds={ 'freight-load':'freight.load','freight-unload':'freight.unload','freight-unload-all':'freight.unload','return-crew-apply':'expedition.return_crew','resident-toggle':'outpost.residents', 'breaker-toggle':'power.breaker','breaker-direction':'power.breaker','breaker-mode':'power.breaker','breaker-reset':'power.breaker.reset', 'plumbing-valve':'plumbing.valve',repairWaterPipe:'job.order',removeWaterPipe:'job.order', 'gas-extractor-toggle':'gas.extractor','gas-extractor-mode':'gas.extractor','gas-valve':'gas.valve','gas-toggle':'gas.device','gas-direction':'gas.device',repairPipe:'job.order',removePipe:'job.order', 'tank-fill':'water.tank','tank-drain':'water.tank', 'reactor-toggle':'reactor.configure','reactor-reset':'reactor.reset','radiator-toggle':'radiator.configure', 'fire-response':'fire.response','fire-suppress':'job.order', 'animal-transport':'husbandry.transport', 'animal-breed':'husbandry.breed', 'pasture-gate':'pasture.gate', 'animal-assign':'husbandry.assign','animal-release':'husbandry.assign','animal-policy':'husbandry.policy', 'possession-policy':'crew.possessions.collect','possession-release':'crew.possessions.release', 'bunk-owner':'housing.assign','room-role':'room.designate','climate-toggle':'climate.configure','depot-filter':'depot.accept','depot-priority':'depot.priority','production-priority':'production.priority',launch:'expedition.launch',recall:'expedition.recall',cell:'power.discharge_cell','bank-cell':'power.discharge_cell','cancel-departure':'expedition.cancel_departure','resume-expedition':'expedition.resume','cargo-policy':'expedition.cargo','auto-service':'maintenance.auto','power-priority':'power.priority','cable-toggle':'power.cable',decode:'signal.resolve',isolate:'signal.resolve',cancel:'job.cancel','life-policy':'crew.routine',labor:'crew.labor',priority:'job.priority',door:'door.mode',machine:'production.enable',extract:'job.order',service:'job.order','repair-structure':'job.order',repairCable:'job.order',removeCable:'job.order',refit:'job.order','unload-shuttle':'job.order' };
  for(const button of $('inspector').querySelectorAll('[data-action]'))if(actionIds[button.dataset.action])button.dataset.simulationAction=actionIds[button.dataset.action];
  if(selected&&!selected.crew&&state.sites[siteId]&&Number.isInteger(selected.x)&&Number.isInteger(selected.y)){const t=at(state.sites[siteId],selected.x,selected.y),id=({waterPump:'plumbing.pump',waterIntake:'plumbing.intake',waterOutlet:'plumbing.outlet'})[t?.building];for(const button of $('inspector').querySelectorAll('[data-action="plumbing-toggle"], [data-action="plumbing-direction"], [data-action="plumbing-mode"]'))button.dataset.simulationAction=id;}
  for(const form of $('inspector').querySelectorAll('form:not([data-freight-form])'))form.dataset.simulationAction=form.hasAttribute('data-gas-extractor-form')?'gas.extractor':form.hasAttribute('data-gas-form')?'gas.device':form.hasAttribute('data-reactor-form')?'reactor.configure':form.hasAttribute('data-production-form')?'production.order':'climate.configure';
  $('crew-list').innerHTML = state.crew.map(c => `<button data-entity="${c.id}" class="crew-row ${selected?.crew === c.id ? 'active' : ''}" data-crew="${c.id}"><img class="crew-portrait" src="${crewSprite(c.color, ANATOMIES[Number(c.id.split('-')[1]) % ANATOMIES.length]).toDataURL()}" alt=""><span class="crew-text"><strong>${esc(c.name)}</strong><small>${esc(SITES[c.site]?.name || 'In transit')}${residentIds(state,'wreck').includes(c.id) ? ' · Resident' : ''} · ${esc(c.activity)}</small></span><span class="crew-health">${Math.round(c.health)}%</span></button>`).join('');
  const tasks = [['build', 'Build your first structure'], ['extract', 'Extract frontier materials'], ['salvage', 'Bring satellite components home'], ['advanced', 'Build an advanced solar array'], ['solar', 'Return with solar energy cells']];
  $('objectives').innerHTML = tasks.map(([id, text]) => `<div class="objective ${state.objectives[id] ? 'done' : ''}"><span class="check">${state.objectives[id] ? '✓' : ''}</span>${text}</div>`).join('');
  $('objective-count').textContent = `${tasks.filter(([id]) => state.objectives[id]).length} / 5`;
  $('clock').textContent = `CYCLE ${String(Math.floor(state.tick / 300) + 1).padStart(2, '0')} / ${clock(state.tick % 300)}`;
  $('event-log').innerHTML = state.log.slice(0, 4).map(e => `<div class="event ${['info', 'good', 'discovery', 'danger'].includes(e.type) ? e.type : ''}"><time>${clock(e.tick)}</time>${esc(e.message)}</div>`).join('');
}
let previousTime = performance.now(), accumulator = 0, lastUI = 0, lastSave = state.tick;
function frame(now) {
  const elapsed = Math.min((now - previousTime) / 1000, .25); previousTime = now;
  if (!document.hidden) accumulator += elapsed * speed;
  let updated = false;
  while (accumulator >= 1) { step(state); accumulator--; updated = true; }
  if (updated || now - lastUI > 500) { refresh(); lastUI = now; }
  if (state.tick - lastSave >= 30) { save(true); lastSave = state.tick; }
  renderer.draw(state, siteId, mode, building); requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { previousTime = performance.now(); if (document.hidden) save(true); });
window.addEventListener('beforeunload', () => save(true));
refresh(); renderer.draw(state, siteId, mode, building); requestAnimationFrame(frame);
if (saveSession.error) { setSpeed(0); $('save').disabled = true; $('save').title = 'Original save protected. Export it or choose New colony.'; if (saveSession.original !== null) $('export').textContent = 'Export previous save'; toast('Could not load the saved colony. Your original is preserved. Use the ⋯ menu to export it, import a save, or start a new colony.', true); }
else if (new URLSearchParams(location.search).has('preview')) setSpeed(0);
else if (fresh) openGuide();
