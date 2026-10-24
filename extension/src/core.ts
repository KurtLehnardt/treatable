import {boundedText,parseFormInput,record,exactKeys,sanitizePageText} from './validation';
import {isSupportedSite} from './sites';
import { PatientProfileSchema, type PatientProfile } from '../../scaffold/lib/contracts/patientProfile';
import { StudySchema, type Study } from '../../scaffold/lib/contracts/study';
import { screenStudy, haversineMiles } from '../../scaffold/lib/eligibility/hardFilters';
export { PatientProfileSchema, StudySchema };
export type { PatientProfile,Study };
export interface ZipData {zips:Record<string,{city:string;state:string;lat:number;lon:number}>;attribution?:string;precision?:string}
export interface PageSource {url:string;title:string;text:string;nctId?:string;kind:'clinicaltrials'}
export type Screen=ReturnType<typeof screenStudy>;
export interface Match {study:Study;screen:Screen;relevance:number}
/** HTTPS-only, credential-free absolute URL, or undefined. */
export function safeWebUrl(value:string):string|undefined{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:undefined}catch{return undefined}}
/** Link target for study records: HTTPS on the exact trusted ClinicalTrials.gov origins only. */
export function trialUrl(value:string):string|undefined{const url=safeWebUrl(value);return url&&isSupportedSite(url)?url:undefined}
export function parsePageSource(value:unknown):PageSource{
 if(!record(value))throw new Error('Page could not be read.');exactKeys(value,['url','title','text','nctId','kind']);
 // Read each field exactly once (a getter cannot change type between check and use), then type-check before any sanitizing.
 const{url:rawAddress,title:rawTitle,text:rawText,nctId:claimedNct,kind}=value;
 const rawUrl=boundedText(rawAddress,'Page address',2048,{empty:false}),url=safeWebUrl(rawUrl);if(!url||!isSupportedSite(url))throw new Error('Open an HTTPS ClinicalTrials.gov page. Other sites are not supported in this release.');
 if(rawTitle!==undefined&&typeof rawTitle!=='string'||typeof rawText!=='string')throw new Error('Page could not be read.');if(rawText.length>100000)throw new Error('Page text exceeds its size limit.');
 // Harmless page quirks (split emoji, bidi/C1/zero-width characters, long titles) are stripped or truncated, not refused.
 const title=sanitizePageText(rawTitle===undefined?'Current page':rawTitle,'Page title',400);
 const text=sanitizePageText(rawText,'Page text',24000,{multiline:true});if(!text)throw new Error('Page text is required.');const u=new URL(url);const nctId=u.pathname.match(/^\/(?:study|ct2\/show)\/(NCT\d{8})\/?$/i)?.[1]?.toUpperCase();
 if(claimedNct!==undefined&&claimedNct!==nctId||kind!==undefined&&kind!=='clinicaltrials')throw new Error('Page source information is inconsistent.');const sourceUrl=nctId?`https://clinicaltrials.gov/study/${nctId}`:`https://clinicaltrials.gov${u.pathname}`;return{url:sourceUrl,title,text,nctId,kind:'clinicaltrials'};
}
export function resolveZip(raw:string,zips:ZipData):{zip:string;city:string;state:string;lat:number;lon:number}{
 const value=boundedText(raw,'ZIP code',10);if(!/^\d{5}(?:-\d{4})?$/.test(value))throw new Error('Enter a five-digit US ZIP code, optionally ZIP+4.');const zip=value.slice(0,5),entry=zips?.zips?.[zip];
 if(!entry)throw new Error('ZIP not in the offline directory. Check it or search without location.');
 if(!Number.isFinite(entry.lat)||entry.lat< -90||entry.lat>90||!Number.isFinite(entry.lon)||entry.lon< -180||entry.lon>180||typeof entry.state!=='string'||!/^[A-Z]{2}$/.test(entry.state))throw new Error('Offline location data is unavailable. Search without location.');
 return{zip,city:boundedText(entry.city,'Offline city',200,{empty:false}),state:entry.state,lat:entry.lat,lon:entry.lon};
}
export function profileFromForm(value:{condition:string;notes:string;age:string;sex:string;zip:string;radius:string},zips:ZipData):PatientProfile{
 const v=parseFormInput(value),location=v.zip?resolveZip(v.zip,zips):{state:'Not provided'};
 const result=PatientProfileSchema.safeParse({ageYears:Number(v.age),sex:v.sex,primaryDiagnoses:v.condition.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean),symptomNarrative:v.notes,location,travelRadiusMiles:v.radius==='anywhere'?'anywhere':Number(v.radius)});
 if(!result.success)throw new Error('Check your profile fields. No health details were sent.');return result.data;
}
function terms(text:string):string[]{return [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g)||[])].filter(t=>!new Set(['the','and','with','for','have','has','that','this','from','was','are','been','patient','painful']).has(t));}
export function searchStudies(studies:Study[],profile:PatientProfile,limit=40):Match[]{const query=terms([...profile.primaryDiagnoses,...profile.symptoms,profile.symptomNarrative].join(' '));const rows=studies.map(study=>{const condition=(study.conditions.join(' ')+' '+study.keywords.join(' ')).toLowerCase();const title=study.briefTitle.toLowerCase(),body=(study.briefSummary+' '+study.interventions.map(i=>i.name).join(' ')).toLowerCase();const relevance=query.reduce((n,t)=>n+(condition.includes(t)?8:0)+(title.includes(t)?4:0)+(body.includes(t)?1:0),0);return{study,relevance,screen:screenStudy(study,profile)}}).filter(m=>m.screen.visible&&m.relevance>0);return rows.sort((a,b)=>b.relevance-a.relevance||(a.screen.distanceMiles??Infinity)-(b.screen.distanceMiles??Infinity)||a.study.id.localeCompare(b.study.id)).slice(0,limit);}
export function nearestSite(study:Study,profile:PatientProfile){const {lat,lon}=profile.location;if(lat===undefined||lon===undefined)return study.locations[0];return study.locations.filter(l=>l.lat!==undefined&&l.lon!==undefined).sort((a,b)=>haversineMiles({lat,lon},{lat:a.lat!,lon:a.lon!})-haversineMiles({lat,lon},{lat:b.lat!,lon:b.lon!}))[0]||study.locations[0]}
export function sourceExcerpts(source:PageSource):string[]{const blocks=source.text.split(/\n+/).map(x=>x.trim()).filter(x=>x.length>30);const matches=blocks.filter(x=>/eligib|inclusion|exclusion|recruit|contact|participant|study|trial|condition|treatment/i.test(x));return (matches.length?matches:blocks).slice(0,5).map(x=>x.slice(0,500));}
