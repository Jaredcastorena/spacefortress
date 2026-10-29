import {MATERIALS} from './material-data.js';
// Material properties are shared by manufacturing, work, inspection and saves.
export const TOOL_MATERIALS = Object.freeze(Object.fromEntries(Object.entries(MATERIALS).map(([id,material]) => [id,Object.freeze({name:material.name,...material.tool})])));
export const TOOL_KINDS=Object.freeze({
 mining_tool:Object.freeze({name:'mining tool',work:'mining',jobs:Object.freeze(['mine'])}),
 engineering_tool:Object.freeze({name:'engineering kit',work:'construction and maintenance',jobs:Object.freeze(['build','remove','repair','service','repairCable','removeCable','repairPipe','removePipe','repairWaterPipe','removeWaterPipe'])}),
});
export const isTool=item=>!!item&&Object.hasOwn(TOOL_KINDS,item.kind);
export const toolSupports=(item,kind)=>isTool(item)&&TOOL_KINDS[item.kind].jobs.includes(kind);
const recipe=(id,name,input,duration,minSkill,extra)=>({id,name,input,output:{tools:1},duration,minSkill,air:40,temperature:[5,40],...extra});
export const DEFAULT_TOOL_RECIPE='alloy_pick';
export const TOOL_RECIPES=Object.freeze({
 alloy_pick:recipe('alloy_pick','Alloy mining tool',{alloy:2,components:1},24,0,{material:'alloy',toolKind:'mining_tool'}),
 composite_pick:recipe('composite_pick','Composite mining tool',{alloy:2,components:2},32,3,{material:'composite',toolKind:'mining_tool'}),
 alloy_kit:recipe('alloy_kit','Alloy engineering kit',{alloy:2,components:1},24,0,{material:'alloy',toolKind:'engineering_tool'}),
 composite_kit:recipe('composite_kit','Composite engineering kit',{alloy:2,components:2},32,3,{material:'composite',toolKind:'engineering_tool'}),
 repair_pick:recipe('repair_pick','Repair a worn tool',{tools:1,alloy:1},12,0,{repair:true}),
});
