import https from 'node:https';
import {timingSafeEqual} from 'node:crypto';
import {ApiError} from './transport.mjs';
import {sanitizeUntrustedText} from '../shared/untrusted-text.mjs';
// Public-record helpers shared by AI ranking (rank.mjs) and the study brief (study-brief.mjs): the official record fetch, its normalized
// form, deep freezing of pinned data and the constant-time receipt comparison.
export const GOV_RECORD_MAX_BYTES=512*1024,GOV_TIMEOUT_MS=12000,GOV_CONCURRENCY=3;
// Constant-time for equal lengths; unequal lengths fail without comparing.
export function sameSecret(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a,'utf8'),y=Buffer.from(b,'utf8');return x.length===y.length&&timingSafeEqual(x,y);}
export function freezeLive(v){if(v&&typeof v==='object'){Object.values(v).forEach(freezeLive);Object.freeze(v);}return v;}
function capText(v,max){const clean=sanitizeUntrustedText(v);let text='';for(const c of clean){if(Buffer.byteLength(JSON.stringify(text+c))>max)break;text+=c;}return text;}
// Gov transport never accepts a URL, request headers, patient fields or credentials.
export async function fetchGovRecord(nctId,{signal,request=https.request}={}){
 if(typeof nctId!=='string'||!/^NCT[0-9]{8}$/.test(nctId))throw Error('Choose a bounded unique set of public NCT IDs');const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(GOV_TIMEOUT_MS)]):AbortSignal.timeout(GOV_TIMEOUT_MS);
 try{const response=await new Promise((resolve,reject)=>{const req=request({hostname:'clinicaltrials.gov',servername:'clinicaltrials.gov',port:443,path:`/api/v2/studies/${nctId}`,method:'GET',agent:false,rejectUnauthorized:true,minVersion:'TLSv1.2',signal:combined,headers:{Accept:'application/json'}},resolve);req.on('error',()=>reject(new ApiError(combined.aborted?'CANCELLED':'GOV_NETWORK_ERROR')));req.end();});
  // Node HTTPS does not follow redirects. Reject even same-host redirects.
  if(response.statusCode!==200){response.resume();throw new ApiError('GOV_HTTP_ERROR',response.statusCode);}
  if(!String(response.headers['content-type']).toLowerCase().includes('application/json')){response.destroy();throw new ApiError('GOV_INVALID_RECORD');}
  if(Number(response.headers['content-length'])>GOV_RECORD_MAX_BYTES){response.destroy();throw new ApiError('GOV_RECORD_TOO_LARGE');}
  let length=0;const chunks=[];for await(const c of response){length+=c.length;if(length>GOV_RECORD_MAX_BYTES){response.destroy();throw new ApiError('GOV_RECORD_TOO_LARGE');}chunks.push(c);}
  let record;try{record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ApiError('GOV_INVALID_RECORD');}
  if(record?.protocolSection?.identificationModule?.nctId!==nctId)throw new ApiError('GOV_ID_MISMATCH');return record;
 }catch(e){throw e instanceof ApiError?e:new ApiError(combined.aborted?'CANCELLED':'GOV_NETWORK_ERROR');}
}
export function normalizeLiveRecord(raw,nctId,fetchedAt){
 if(raw?.protocolSection?.identificationModule?.nctId!==nctId)throw new ApiError('GOV_ID_MISMATCH');const p=raw.protocolSection,e=p.eligibilityModule??{},truncatedFields=[],missingFields=[];
 const text=(field,v,cap)=>{const full=sanitizeUntrustedText(v),out=capText(v,cap);if(!full)missingFields.push(field);if(full!==out)truncatedFields.push(field);return out;};
 const nullable=(field,v,cap=80)=>typeof v==='string'&&v.trim()?text(field,v,cap):(missingFields.push(field),null);
 const list=(field,v,count=10,cap=120)=>{if(!Array.isArray(v)){missingFields.push(field);return [];}const values=v.filter(x=>typeof x==='string').map(x=>capText(x,cap)).filter(Boolean);if(values.length!==v.length||v.length>count||v.some(x=>typeof x==='string'&&sanitizeUntrustedText(x)!==capText(x,cap)))truncatedFields.push(field);return [...new Set(values)].slice(0,count);};
 const countries=list('countries',p.contactsLocationsModule?.locations?.map(x=>x?.country),8,60);
 const study={id:nctId,title:text('title',p.identificationModule.briefTitle,180),status:text('status',p.statusModule?.overallStatus,60),conditions:list('conditions',p.conditionsModule?.conditions,10,120),criteria:text('criteria',e.eligibilityCriteria,1600),summary:text('summary',p.descriptionModule?.briefSummary,600),minimumAge:nullable('minimumAge',e.minimumAge),maximumAge:nullable('maximumAge',e.maximumAge),sex:nullable('sex',e.sex),healthyVolunteers:typeof e.healthyVolunteers==='boolean'?e.healthyVolunteers:null,hasResults:typeof raw.hasResults==='boolean'?raw.hasResults:null,countries,sourceUrl:`https://clinicaltrials.gov/study/${nctId}`,fetchedAt,lastUpdatePostDate:nullable('lastUpdatePostDate',p.statusModule?.lastUpdatePostDateStruct?.date,30),truncatedFields,missingFields};
 if(study.healthyVolunteers===null)missingFields.push('healthyVolunteers');if(study.hasResults===null)missingFields.push('hasResults');return freezeLive(study);
}
