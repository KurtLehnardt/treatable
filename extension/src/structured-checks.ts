import type {AgeBand} from '../shared/real-contract.mjs';
export interface StructuredProfile{ageBand?:AgeBand;sex?:'female'|'male'|'other'|'prefer_not_to_say'}
export interface StructuredStudy{minimumAge?:string|null;maximumAge?:string|null;sex?:string|null;status?:string}
export interface StructuredCheck{id:'age'|'sex'|'status';status:'met'|'unmet'|'unknown';message:string}
export type GuardBucket='structured_compatible'|'unknown'|'unlikely';
const ranges:Record<AgeBand,[number,number]>={under_18:[0,17.999],'18_29':[18,29.999],'30_44':[30,44.999],'45_59':[45,59.999],'60_74':[60,74.999],'75_89':[75,89.999], '90_plus':[90,Infinity]};
function years(value?:string|null){const m=value&&/^([0-9]+(?:\.[0-9]+)?) (Years|Months|Weeks|Days|Hours|Minutes)$/.exec(value);return m?Number(m[1])/({Years:1,Months:12,Weeks:52.1775,Days:365.2425,Hours:8765.82,Minutes:525949.2}[m[2]]!):undefined}
export function structuredChecks(study:StructuredStudy,profile:StructuredProfile):{bucket:GuardBucket;guardTier:0|1|2;checks:StructuredCheck[]}{
 const checks:StructuredCheck[]=[],range=profile.ageBand?ranges[profile.ageBand]:undefined,min=years(study.minimumAge),max=years(study.maximumAge);
 if(range&&((min!==undefined&&range[1]<min)||(max!==undefined&&range[0]>max)))checks.push({id:'age',status:'unmet',message:'The whole age band falls outside the listed age range.'});
 else if(!range||min===undefined||max===undefined||range[0]<min||range[1]>max)checks.push({id:'age',status:'unknown',message:'Age-band compatibility cannot be fully confirmed from these fields.'});
 else checks.push({id:'age',status:'met',message:'The age band fits the listed structured age range.'});
 const sex=study.sex?.toUpperCase();
 if((profile.sex==='female'&&sex==='MALE')||(profile.sex==='male'&&sex==='FEMALE'))checks.push({id:'sex',status:'unmet',message:'The selected sex conflicts with the listed study criterion.'});
 else if(sex==='ALL'||profile.sex==='female'&&sex==='FEMALE'||profile.sex==='male'&&sex==='MALE')checks.push({id:'sex',status:'met',message:'No conflict in the listed structured sex criterion.'});
 else checks.push({id:'sex',status:'unknown',message:'Sex-criterion compatibility is unknown or not shared.'});
 const status=study.status?.trim().toUpperCase(),closed=['ACTIVE_NOT_RECRUITING','COMPLETED','TERMINATED','WITHDRAWN','SUSPENDED','NO_LONGER_AVAILABLE','TEMPORARILY_NOT_AVAILABLE','APPROVED_FOR_MARKETING'];
 checks.push(status==='RECRUITING'||status==='AVAILABLE'?{id:'status',status:'met',message:'The public record reports recruiting or available expanded access.'}:closed.includes(status||'')?{id:'status',status:'unmet',message:'The public record does not report accepting participants.'}:{id:'status',status:'unknown',message:'Current acceptance is unverified or not yet open.'});
 const guardTier=checks.some(c=>c.status==='unmet')?2:checks.some(c=>c.status==='unknown')?1:0;
 return{guardTier,bucket:guardTier===2?'unlikely':guardTier===1?'unknown':'structured_compatible',checks};
}
