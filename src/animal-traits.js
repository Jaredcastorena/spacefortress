import { isLivestock, livestockDef } from './livestock-data.js';

export const ANIMAL_TRAITS = Object.freeze({alleles:Object.freeze([-1,0,1]),thermalShift:5,paceFactor:.2});
const loci=['thermal','pace'];
const cloneGenome=g=>({origin:g.origin,thermal:[...g.thermal],pace:[...g.pace]});
const genomeOf=a=>a.genetics??neutralGenome();
const hash=(...parts)=>{
  let value=2166136261;
  for(const character of JSON.stringify(['spacefortress.animal-traits.v1',...parts]))value=Math.imul(value^character.charCodeAt(0),16777619)>>>0;
  value=Math.imul(value^(value>>>16),0x85ebca6b);value=Math.imul(value^(value>>>13),0xc2b2ae35);
  return (value^(value>>>16))>>>0;
};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const pair=value=>Array.isArray(value)&&value.length===2&&Object.keys(value).length===2&&[0,1].every(slot=>Object.hasOwn(value,slot));
const validGenome=g=>exact(g,['origin','thermal','pace'])&&['founder','inherited','legacy'].includes(g.origin)&&loci.every(locus=>pair(g[locus])&&g[locus].every(allele=>Number.isInteger(allele)&&ANIMAL_TRAITS.alleles.includes(allele)));
const equalGenome=(a,b)=>a.origin===b.origin&&loci.every(locus=>a[locus].every((allele,slot)=>allele===b[locus][slot]));
const inherits=(child,parents)=>loci.every(locus=>child[locus].every((allele,slot)=>parents[slot][locus].includes(allele)));

export function neutralGenome(){return {origin:'legacy',thermal:[-1,1],pace:[-1,1]};}
export function founderGenome(seed,species,id){
  return {origin:'founder',...Object.fromEntries(loci.map(locus=>[locus,[0,1].map(slot=>ANIMAL_TRAITS.alleles[hash(seed,species,id,'founder',locus,slot)%ANIMAL_TRAITS.alleles.length])]))};
}
export function inheritGenome(seed,carrier,mate,broodId){
  const parents=[carrier,mate];
  return {origin:'inherited',...Object.fromEntries(loci.map(locus=>[locus,parents.map((parent,slot)=>genomeOf(parent)[locus][hash(seed,carrier.species,broodId,parent.id,'inheritance',locus,slot)%2])]))};
}
export function animalTraits(a){
  const def=livestockDef(a);if(!def)return null;
  const g=genomeOf(a),thermalExpression=(g.thermal[0]+g.thermal[1])/2,paceExpression=(g.pace[0]+g.pace[1])/2,paceMultiplier=1+ANIMAL_TRAITS.paceFactor*paceExpression;
  return {thermalExpression,paceExpression,temperatureRange:def.temperature.map(bound=>bound+ANIMAL_TRAITS.thermalShift*thermalExpression),productRate:def.productRate*paceMultiplier,metabolism:def.metabolism*paceMultiplier,juvenileMetabolism:def.juvenileMetabolism*paceMultiplier,paceMultiplier};
}
export function initializeAnimalTraits(s,{legacy=false}={}){
  if(legacy&&s.creatures.some(a=>Object.hasOwn(a,'genetics')||a.lifecycle?.brood&&Object.hasOwn(a.lifecycle.brood,'inheritance')))throw new Error('Legacy animal genetics shadow.');
  const byId=new Map(s.creatures.map(a=>[a.id,a]));
  for(const a of s.creatures)if(isLivestock(a)){
    a.genetics??=legacy?neutralGenome():founderGenome(s.seed,a.species,a.id);
    if(legacy&&a.lifecycle?.brood){const mate=byId.get(a.lifecycle.brood.mate);if(!mate||mate.species!==a.species)throw new Error('Invalid legacy brood parent.');}
  }
  if(legacy)for(const a of s.creatures)if(isLivestock(a)&&a.lifecycle?.brood){const mate=byId.get(a.lifecycle.brood.mate);a.lifecycle.brood.inheritance={parents:[a,mate].map(parent=>({id:parent.id,genetics:cloneGenome(parent.genetics)})),child:neutralGenome()};}
}
export function validateAnimalTraits(s){
  const byId=new Map(s.creatures.map(a=>[a.id,a]));
  for(const a of s.creatures){
    if(!isLivestock(a)){if(Object.hasOwn(a,'genetics')||a.lifecycle?.brood&&Object.hasOwn(a.lifecycle.brood,'inheritance'))throw new Error('Pests cannot have livestock genetics.');continue;}
    const g=a.genetics,l=a.lifecycle;
    if(!validGenome(g)||!l||g.origin==='founder'&&(l.born!==null||l.parents.length!==0)||g.origin==='inherited'&&(l.born===null||l.parents.length!==2))throw new Error('Invalid animal genetics.');
    if(g.origin==='inherited'){
      const parents=l.parents.map(id=>byId.get(id));
      if(parents.some(parent=>!parent||parent.species!==a.species||!validGenome(parent.genetics))||!inherits(g,parents.map(parent=>parent.genetics)))throw new Error('Invalid inherited animal genetics.');
    }
    if(l.brood!==null){
      const brood=l.brood,inheritance=brood?.inheritance,parents=[a,byId.get(brood?.mate)];
      if(!exact(brood,['id','mate','started','progress','inheritance'])||!exact(inheritance,['parents','child'])||!pair(inheritance.parents)||!validGenome(inheritance.child)||inheritance.child.origin==='founder')throw new Error('Invalid brood inheritance.');
      for(const [slot,snapshot]of inheritance.parents.entries())if(!exact(snapshot,['id','genetics'])||!parents[slot]||parents[slot].species!==a.species||snapshot.id!==parents[slot].id||!validGenome(snapshot.genetics)||!validGenome(parents[slot].genetics)||!equalGenome(snapshot.genetics,parents[slot].genetics))throw new Error('Invalid brood parent genetics.');
      if(!inherits(inheritance.child,inheritance.parents.map(parent=>parent.genetics)))throw new Error('Invalid brood child genetics.');
    }
  }
}
