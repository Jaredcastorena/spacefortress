import { isLivestock, VETERINARY } from './livestock-data.js';
import { temperatureAt } from './thermal.js';
import { distance } from './geometry.js';
import { emitEvent, tileEntityId } from './telemetry.js';
import { animalTraits } from './animal-traits.js';

const EPS=1e-8;
const recoveryReasons={none:'No active treatment credit.',needs_post:'Needs to reach its working assigned post.',needs_food:'Needs nutrition of at least 60 to recover.',unsafe_temperature:'Needs temperature within its species range.',fire:'Recovery paused by fire.',transport:'Recovery paused during transport.',recovering:'Recovering from treated injuries at the post.'};
const thermalBand=stress=>Math.abs(stress)>70?'danger':Math.abs(stress)>=45?'stressed':'normal';
const tileAt=(site,x,y)=>site&&Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<site.size&&y<site.size?site.tiles[y*site.size+x]:null;
const postTile=(s,a)=>a.husbandry?.post?tileAt(s.sites.surface,...a.husbandry.post):null;
const transporting=(s,a)=>s.jobs.some(j=>j.kind==='animalLead'&&j.animal===a.id);
const untreated=a=>Math.max(0,a.condition.injury-a.condition.treated);
const safeTemperature=(s,a)=>{const temp=temperatureAt(s.sites[a.site],a.x,a.y),[low,high]=animalTraits(a).temperatureRange;return temp>=low&&temp<=high;};
export function initializeAnimalCondition(a){if(isLivestock(a))a.condition??={injury:0,treated:0,thermalStress:0,cause:null,recovery:'none'};}
export function initializeAnimalHealth(s){for(const a of s.creatures)initializeAnimalCondition(a);}
export const animalActivityAllowed=a=>!a.condition||a.condition.injury<=EPS&&Math.abs(a.condition.thermalStress)<45;
function recoveryState(s,a){
  if(a.health<=0||a.condition.treated<=EPS)return 'none';
  if(transporting(s,a))return 'transport';
  const tile=tileAt(s.sites[a.site],a.x,a.y),post=postTile(s,a);
  if(tile?.fire)return 'fire';
  if(a.site!=='surface'||post?.building!=='husbandryPost'||post.hp<=0||a.x!==post.x||a.y!==post.y)return 'needs_post';
  if(!safeTemperature(s,a))return 'unsafe_temperature';
  if(a.fed<60)return 'needs_food';
  return 'recovering';
}
function updateRecoveryState(s,a){
  const next=recoveryState(s,a),previous=a.condition.recovery;
  a.condition.recovery=next;
  if(previous!==next)emitEvent(s,'animal.recovery.state_changed',{entity:a.id,previous,current:next,injury:a.condition.injury,credit:a.condition.treated});
  return next;
}
export function injureAnimal(s,a,amount,cause){
  if(!isLivestock(a)||a.health<=0||!Number.isFinite(amount)||amount<=0||!['fire','cold','heat'].includes(cause))return 0;
  const loss=Math.min(a.health,amount);a.health-=loss;a.condition.injury=Math.min(100,a.condition.injury+loss);a.condition.cause=cause;
  emitEvent(s,'animal.injured',{entity:a.id,amount:loss,cause,health:a.health,injury:a.condition.injury});
  if(a.health<=0){updateRecoveryState(s,a);emitEvent(s,'animal.died',{entity:a.id,cause});}
  return loss;
}
export function updateAnimalHealth(s,a){
  if(!isLivestock(a)||a.health<=0)return;
  const q=a.condition,site=s.sites[a.site],tile=tileAt(site,a.x,a.y),temp=temperatureAt(site,a.x,a.y),[low,high]=animalTraits(a).temperatureRange;
  const previous=thermalBand(q.thermalStress),strain=temp<low?(temp-low)*.012:temp>high?(temp-high)*.012:0;
  q.thermalStress=strain?Math.max(-100,Math.min(100,q.thermalStress+strain)):Math.sign(q.thermalStress)*Math.max(0,Math.abs(q.thermalStress)-.8);
  const current=thermalBand(q.thermalStress);
  if(current!==previous)emitEvent(s,'animal.thermal.state_changed',{entity:a.id,previous,current,stress:q.thermalStress,temp});
  if(Math.abs(q.thermalStress)>70)injureAnimal(s,a,(Math.abs(q.thermalStress)-70)*.006,q.thermalStress<0?'cold':'heat');
  if(a.health<=0)return;
  if(a.fed===0){a.health=Math.max(0,a.health-.2);if(a.health===0){updateRecoveryState(s,a);emitEvent(s,'animal.died',{entity:a.id,cause:'starvation'});return;}}
  else if(a.fed>=60&&!tile?.fire)a.health=Math.min(100-q.injury,a.health+.01);
  if(updateRecoveryState(s,a)==='recovering'){
    const healed=Math.min(VETERINARY.recoveryRate,q.injury,q.treated,100-a.health);
    a.health+=healed;q.injury=Math.max(0,q.injury-healed);q.treated=Math.max(0,q.treated-healed);
    if(q.injury<=EPS){q.injury=0;q.treated=0;q.cause=null;if(100-a.health<EPS)a.health=100;emitEvent(s,'animal.recovered',{entity:a.id,health:a.health});}
    else if(q.treated<=EPS)q.treated=0;
    updateRecoveryState(s,a);
  }
}
export function animalHealthStatus(s,a){
  if(!isLivestock(a)||!a.condition)return null;
  const q=a.condition,recovery=recoveryState(s,a);
  return {injury:q.injury,treated:q.treated,untreated:untreated(a),thermalStress:q.thermalStress,temperature:temperatureAt(s.sites[a.site],a.x,a.y),temperatureRange:animalTraits(a).temperatureRange,thermalState:thermalBand(q.thermalStress),recovery,recoveryReason:recoveryReasons[recovery],activityAllowed:animalActivityAllowed(a)};
}
export function animalTreatmentEligibility(s,a){
  const fail=(code,message)=>({ok:false,code,message,dose:0});
  if(!a||!isLivestock(a)||a.health<=0)return fail('invalid_animal','Choose living livestock.');
  if(a.husbandry.trust!==100)return fail('untamed','Veterinary treatment needs a tame animal.');
  const post=postTile(s,a);if(a.site!=='surface'||post?.building!=='husbandryPost'||post.hp<=0)return fail('needs_post','Assign a working surface husbandry post.');
  if(untreated(a)<=EPS)return fail('covered','No uncovered injury needs medicine.');
  if(transporting(s,a))return fail('transport','Finish or cancel animal transport first.');
  if(s.jobs.some(j=>(j.animal===a.id||j.site==='surface'&&j.x===post.x&&j.y===post.y)&&!(j.kind==='animalCare'&&j.animal===a.id)))return fail('busy','Finish or cancel conflicting animal work first.');
  return {ok:true,code:'ready',message:'Ready to designate veterinary treatment.',dose:Math.min(VETERINARY.maxDose,untreated(a))};
}
function treatmentAnimal(s,j){
  return s.creatures.find(a=>a.id===j.animal&&isLivestock(a)&&a.health>0&&a.site===j.site&&a.husbandry.trust===100&&a.husbandry.post?.[0]===j.x&&a.husbandry.post?.[1]===j.y);
}
export function animalTreatmentValid(s,j){
  if(j.kind!=='animalTreat'||j.site!=='surface'||j.building!==null||j.work!==VETERINARY.work||!Number.isFinite(j.dose)||j.dose<=0||j.dose>VETERINARY.maxDose)return false;
  const a=treatmentAnimal(s,j),post=a&&postTile(s,a);
  return !!a&&post?.building==='husbandryPost'&&post.hp>0&&untreated(a)>EPS&&!transporting(s,a);
}
export function animalTreatmentReady(s,j){
  if(!animalTreatmentValid(s,j))return false;
  const a=treatmentAnimal(s,j),tile=postTile(s,a);
  return a.x===j.x&&a.y===j.y&&a.fed>=60&&!tile.fire&&safeTemperature(s,a)&&!s.jobs.some(o=>o.kind==='animalCare'&&o.animal===a.id);
}
export function completeAnimalTreatment(s,c,j){
  if(!animalTreatmentReady(s,j)||(j.materials?.medicine||0)<VETERINARY.medicine||!c||c.site!==j.site||distance([c.x,c.y],[j.x,j.y])>1)return false;
  const a=treatmentAnimal(s,j),dose=Math.min(j.dose,untreated(a));a.condition.treated+=dose;
  emitEvent(s,'animal.treatment.completed',{entity:a.id,actor:c.id,job:j.id,target:tileEntityId(j.site,j.x,j.y),medicine:VETERINARY.medicine,dose,credit:a.condition.treated});
  updateRecoveryState(s,a);return true;
}
export function validateAnimalHealth(s){
  const keys=['injury','treated','thermalStress','cause','recovery'];
  for(const a of s.creatures){
    if(!isLivestock(a)){if(a.condition!==undefined)throw new Error('Pests cannot have livestock condition.');continue;}
    const q=a.condition;
    if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).length!==keys.length||keys.some(k=>!Object.hasOwn(q,k))||![q.injury,q.treated].every(n=>Number.isFinite(n)&&n>=0&&n<=100)||q.treated>q.injury+EPS||a.health+q.injury>100+1e-7||!Number.isFinite(q.thermalStress)||Math.abs(q.thermalStress)>100||![null,'fire','cold','heat'].includes(q.cause)||!Object.hasOwn(recoveryReasons,q.recovery))throw new Error('Invalid livestock condition.');
  }
  const patients=new Set();
  for(const j of s.jobs.filter(j=>j.kind==='animalTreat')){
    if(!animalTreatmentValid(s,j)||patients.has(j.animal)||Object.keys(j.cost).length!==1||j.cost.medicine!==VETERINARY.medicine||j.patient!==undefined||j.foodKinds!==undefined||j.plantSpecies!==undefined||j.plantHarvests!==undefined)throw new Error('Invalid veterinary treatment order.');
    patients.add(j.animal);
  }
}
