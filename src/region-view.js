import {planetDefinitions,planetSiteIds,siteDefinition} from './region.js';

const fallback={surface:{x:.15,y:.7},wreck:{x:.4,y:.3},comet:{x:.72,y:.2},solar:{x:.87,y:.65}};
// View-only hierarchy. These detached nodes never enter the save or consume RNG.
export function regionViewNodes(s,planetId=null){
 const planets=planetDefinitions(s);
 if(!Object.hasOwn(planets,planetId))return Object.values(planets).map(p=>({id:p.id,type:'planet',name:p.name,label:p.label||'PLANETARY REGION',color:p.color||'#b6b897',...(p.map||{x:.5,y:.5})}));
 const ids=planetSiteIds(s,planetId),nodes=ids.map(id=>{const d=siteDefinition(s,id);return {id,type:'site',name:d.name,label:d.label,color:d.color,template:d.template,...(d.map||fallback[id])};});
 if(!ids.includes('surface')){
  const home=siteDefinition(s,'surface');nodes.unshift({id:'surface',type:'site',gateway:true,name:'Home route',label:'DEPARTURE / RETURN',color:home.color,x:.15,y:.7});
 }
 return nodes;
}
export function visibleMissionRoute(s,nodes){
 const m=s.mission;if(!m||!['outbound','returning'].includes(m.phase))return null;
 const planets=nodes[0]?.type==='planet',home=siteDefinition(s,'surface'),destination=siteDefinition(s,m.site);
 const from=nodes.find(n=>n.id===(planets?home?.planetId:'surface')),to=nodes.find(n=>n.id===(planets?destination?.planetId:m.site));
 return from&&to&&from!==to?{from,to}:null;
}
