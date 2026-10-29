// Material properties are shared by manufacturing, work, inspection and saves.
export const TOOL_MATERIALS = Object.freeze({
 alloy: {name:'Alloy',speed:1.25,wear:1},
 composite: {name:'Composite',speed:1.5,wear:.5},
});
const recipe=(id,name,input,duration,minSkill,extra)=>({id,name,input,output:{tools:1},duration,minSkill,air:40,temperature:[5,40],...extra});
export const DEFAULT_TOOL_RECIPE='alloy_pick';
export const TOOL_RECIPES=Object.freeze({
 alloy_pick:recipe('alloy_pick','Alloy mining tool',{alloy:2,components:1},24,0,{material:'alloy'}),
 composite_pick:recipe('composite_pick','Composite mining tool',{alloy:2,components:2},32,3,{material:'composite'}),
 repair_pick:recipe('repair_pick','Repair a worn mining tool',{tools:1,alloy:1},12,0,{repair:true}),
});
