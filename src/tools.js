import {crewPathToPosition} from './navigation.js';
import {advanceCrewRoutePositions,cancelCrewTraversal} from './crew-traversal.js';
import {TOOL_MATERIALS,TOOL_KINDS,isTool,toolSupports} from './tool-data.js';
import {add,extract,spill,quantity} from './inventory.js';
import {outgoingInventory} from './inventory-reservations.js';
import {tileAt,positionOf} from './spatial.js';
import {emitEvent,tileEntityId} from './telemetry.js';

export const equippedTool=c=>c?.possessions?.inventory?._items?.find(i=>isTool(i))||null;
export function toolStatus(c,workKind=null){
 const item=equippedTool(c);if(!item)return {equipped:false,multiplier:1,...(c?.intent?.type==='equipTool'?{pickup:{...c.intent}}:{})};
 const material=TOOL_MATERIALS[item.material];
 return {equipped:true,item:item.id,kind:item.kind,appliesTo:[...TOOL_KINDS[item.kind].jobs],...(workKind===null?{}:{workKind,applicable:toolSupports(item,workKind)}),material:item.material,condition:item.condition,broken:item.condition<=0,multiplier:item.condition>0&&(workKind===null||toolSupports(item,workKind))?1+(material.speed-1)*(1+.1*(item.quality-1)):1,wearPerWork:material.wear};
}
export function finishToolBatch(s,c,recipe,batch){
 if(recipe.repair){
  const original=batch._items?.find(i=>isTool(i)&&i.condition<100);
  if(!original)throw new Error('Repair requires a physical worn tool.');
  const item={...original,condition:100};
  emitEvent(s,'tool.repaired',{entity:item.id,actor:c.id,kind:item.kind,previous:original.condition,condition:100,materials:{alloy:recipe.input.alloy}});
  return {tools:1,_items:[item]};
 }
 const item={id:`item-${s.nextItemId++}`,maker:c.id,kind:recipe.toolKind,material:recipe.material,quality:Math.min(4,1+Math.floor(c.skills.production.level/3)),condition:100,created:s.tick};
 emitEvent(s,'tool.crafted',{entity:item.id,actor:c.id,kind:item.kind,material:item.material,quality:item.quality,recipe:recipe.id});
 return {tools:1,_items:[item]};
}
const sourceAt=(t,source)=>t&&(source==='stock'?(t.building==='stockpile'?t.stock:null):source==='drop'?t.drop:source==='output'?t.machine?.output:null);
export function clearToolPickup(s,c,reason){
 if(c.intent?.type!=='equipTool')return false;
 const id=c.intent.item;c.intent=null;emitEvent(s,'tool.pickup.cancelled',{entity:id,actor:c.id,reason});return true;
}
export function cancelToolPickup(s,id){
 const c=s.crew.find(c=>c.id===id);if(!c||c.intent?.type!=='equipTool')return {ok:false,message:'This crew member has no tool pickup request.'};
 cancelCrewTraversal(s,c);clearToolPickup(s,c,'player');return {ok:true};
}
export function equipTool(s,id,source,itemId){
 const c=s.crew.find(c=>c.id===id&&c.health>0);
 if(!c||c.site==='transit')return {ok:false,code:'local_owner_required',message:'Choose a living crew member at a local site.'};
 if(equippedTool(c))return {ok:false,code:'tool_equipped',message:'Put down the current tool first.'};
 if(c.job||c.carry||c.rescue||c.airlockTraversal||c.intent&&!['leisure'].includes(c.intent.type))return {ok:false,code:'crew_busy',message:'Finish or cancel current work before collecting a tool.'};
 const site=s.sites[c.site],t=site.tiles.find(t=>sourceAt(t,source)?._items?.some(i=>i.id===itemId&&isTool(i)));
 if(!t)return {ok:false,code:'tool_not_here',message:'Choose a tool in this crew member’s local settlement.'};
 if(outgoingInventory(s,c.site,positionOf(t),source,'tools',c)>0||s.crew.some(o=>o!==c&&o.intent?.type==='equipTool'&&o.intent.item===itemId))return {ok:false,code:'tool_reserved',message:'This tool is already promised to another worker.'};
 if(crewPathToPosition(s,site,c,[positionOf(t)])===null)return {ok:false,code:'tool_unreachable',message:'No route to this tool. Check doors and stair hatches.'};
 if(c.intent?.keepsake)emitEvent(s,'item.pickup.cancelled',{entity:c.intent.keepsake.id,actor:c.id,reason:'equipment_request'});
 c.intent={type:'equipTool',target:positionOf(t),source,item:itemId};
 emitEvent(s,'tool.pickup.planned',{entity:itemId,actor:c.id,source:tileEntityId(c.site,t.x,t.y,t.z),slot:source});return {ok:true};
}
export function advanceToolPickup(s,c){
 const intent=c.intent;if(intent?.type!=='equipTool')return false;
 const site=s.sites[c.site],t=tileAt(site,intent.target),inventory=sourceAt(t,intent.source),item=inventory?._items?.find(i=>i.id===intent.item&&isTool(i));
 const route=item&&!equippedTool(c)&&!c.carry?crewPathToPosition(s,site,c,[intent.target]):null;
 if(!item||route===null||outgoingInventory(s,c.site,intent.target,intent.source,'tools',c)>0){clearToolPickup(s,c,'unavailable');return true;}
 if(route.length){advanceCrewRoutePositions(s,c,site,[intent.target]);c.activity=`Collecting ${TOOL_KINDS[item.kind].name}`;return true;}
 const moved=extract(inventory,{tools:1,_items:[item]});if(!moved){clearToolPickup(s,c,'unavailable');return true;}
 add(c.possessions.inventory,moved);if(intent.source==='drop'&&!quantity(t.drop))t.drop=null;
 emitEvent(s,'tool.equipped',{entity:item.id,actor:c.id,source:tileEntityId(c.site,t.x,t.y,t.z),slot:intent.source});c.intent=null;c.activity=`Equipped ${TOOL_KINDS[item.kind].name}`;return true;
}
export function validateToolPickups(s){
 const claimed=new Set();
 for(const c of s.crew){const i=c.intent;if(i?.type!=='equipTool')continue;
  if(c.job||c.carry||equippedTool(c)||c.site==='transit'||!i.target||!tileAt(s.sites[c.site],i.target)||!['stock','drop','output'].includes(i.source)||!/^item-[1-9][0-9]*$/.test(i.item)||Number(i.item.slice(5))>=s.nextItemId||claimed.has(i.item)||Object.keys(i).length!==4)throw new Error('Invalid tool pickup claim.');
  claimed.add(i.item);
 }
}
export function releaseTool(s,id){
 const c=s.crew.find(c=>c.id===id&&c.health>0),item=equippedTool(c);
 if(!c||c.site==='transit'||!item)return {ok:false,message:'Choose a living local crew member with a tool.'};
 const t=tileAt(s.sites[c.site],positionOf(c));if(!t)return {ok:false,code:'missing_owner_tile',message:'The owner has no local tile for this tool.'};
 const moved=extract(c.possessions.inventory,{tools:1,_items:[item]});if(!moved)return {ok:false,message:'The tool is no longer owned.'};
 spill(t,moved);emitEvent(s,'tool.released',{entity:item.id,actor:c.id,target:tileEntityId(c.site,t.x,t.y,t.z)});return {ok:true};
}
// Spend only actual completed work. If the edge wears out partway through a
// tick, the remaining work time uses the normal hand-work rate.
export function workEffort(s,c,j,base){
 const item=equippedTool(c),status=toolStatus(c);
 if(!item||!toolSupports(item,j.kind)||item.condition<=0)return Math.min(j.remaining,base);
 const boosted=Math.min(j.remaining,base*status.multiplier,item.condition/status.wearPerWork);
 const plain=Math.min(j.remaining-boosted,Math.max(0,base-boosted/status.multiplier));
 const before=item.condition,wear=Math.min(before,boosted*status.wearPerWork);item.condition=Math.max(0,before-wear);
 if(item.condition<1e-10)item.condition=0;
 emitEvent(s,'tool.used',{entity:item.id,actor:c.id,job:j.id,kind:item.kind,workKind:j.kind,work:boosted,wear:before-item.condition,condition:item.condition});
 if(before>0&&item.condition===0)emitEvent(s,'tool.broken',{entity:item.id,actor:c.id,job:j.id});
 return boosted+plain;
}

// Preserve the mining-only helper for existing callers; all job execution uses
// the same capability-aware work calculation above.
export const miningEffort=(s,c,j,base)=>workEffort(s,c,{...j,kind:'mine'},base);
export function rejectLegacyEquipment(s){
 // Schemas before67 cannot own the newly introduced kit or its production
 // selection/commitment. Existing mining items and recipe IDs stay untouched.
 const pending=[s];
 while(pending.length){const value=pending.pop();if(!value||typeof value!=='object')continue;
  if(value.kind==='engineering_tool'||['recipeId','batchRecipeId'].some(key=>['alloy_kit','composite_kit'].includes(value[key])))throw new Error('Legacy engineering equipment fields.');
  pending.push(...Object.values(value).filter(v=>v&&typeof v==='object'));
 }
}
