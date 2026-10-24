import https from 'node:https';
import {createHash} from 'node:crypto';
import {ApiError} from './transport.mjs';
import {sanitizeUntrustedText} from '../shared/untrusted-text.mjs';
import {liveNctIds,parseLiveSource,parseLiveCatalog,LIVE_SNAPSHOT_TTL_MS,LIVE_CATALOG_MAX_CONDITIONS} from '../shared/live-analysis-contract.mjs';
export const GOV_RECORD_MAX_BYTES=512*1024,GOV_TIMEOUT_MS=12000,GOV_CONCURRENCY=3,GOV_CACHE_LIMIT=50;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function freezeLive(v){if(v&&typeof v==='object'){Object.values(v).forEach(freezeLive);Object.freeze(v);}return v;}
function capText(v,max){const clean=sanitizeUntrustedText(v);let text='';for(const c of clean){if(Buffer.byteLength(JSON.stringify(text+c))>max)break;text+=c;}return text;}
// Gov transport never accepts a URL, request headers, patient fields or credentials.
export async function fetchGovRecord(nctId,{signal,request=https.request}={}){
 liveNctIds([nctId]);const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(GOV_TIMEOUT_MS)]):AbortSignal.timeout(GOV_TIMEOUT_MS);
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
export class LiveEvidenceStore{
 constructor({fetchRecord=fetchGovRecord,now=()=>performance.now(),wallNow=()=>Date.now(),onInvalidate=()=>{}}={}){this.fetchRecord=fetchRecord;this.now=now;this.wallNow=wallNow;this.onInvalidate=onInvalidate;this.cache=new Map();this.snapshot=undefined;this.epoch=0;this.timer=undefined;this.controller=undefined;}
 clear({cache=false}={}){this.controller?.abort();this.controller=undefined;clearTimeout(this.timer);this.timer=undefined;this.snapshot=undefined;this.epoch++;if(cache)this.cache.clear();this.onInvalidate();}
 async catalog(nctIds,source,{signal}={}){
  const ids=liveNctIds(nctIds),binding=parseLiveSource(source);this.clear();this.controller=new AbortController();signal=signal?AbortSignal.any([signal,this.controller.signal]):this.controller.signal;const epoch=this.epoch,rows=new Array(ids.length);let index=0;
  const worker=async()=>{while(index<ids.length){const i=index++,id=ids[i];if(signal?.aborted||this.epoch!==epoch)throw new ApiError('CANCELLED');let cached=this.cache.get(id);if(cached?.expires<=this.now()){this.cache.delete(id);cached=undefined;}
   if(!cached){const raw=await this.fetchRecord(id,{signal}),study=normalizeLiveRecord(raw,id,this.wallNow());if(signal?.aborted||this.epoch!==epoch)throw new ApiError('CANCELLED');cached={study,expires:this.now()+LIVE_SNAPSHOT_TTL_MS};this.cache.set(id,cached);while(this.cache.size>GOV_CACHE_LIMIT)this.cache.delete(this.cache.keys().next().value);}rows[i]=cached.study;}};
  const tasks=Array.from({length:Math.min(GOV_CONCURRENCY,ids.length)},()=>worker().catch(error=>{this.controller?.abort();throw error;}));const settled=await Promise.allSettled(tasks);const failed=settled.find(x=>x.status==='rejected');if(failed)throw failed.reason;if(signal?.aborted||this.epoch!==epoch)throw new ApiError('CANCELLED');
  const labels=new Map();for(const row of rows)for(const label of row.conditions)labels.set(label.toLocaleLowerCase('en-US'),label);const values=[...labels].sort(([a],[b])=>a.localeCompare(b)),conditions=values.slice(0,LIVE_CATALOG_MAX_CONDITIONS).map(([key,label])=>({id:'lc_'+hash(key),label}));
  const fetchedAt=this.wallNow(),data={source:binding,studies:rows,conditions,conditionsTruncated:values.length>conditions.length,fetchedAt,expiresAt:fetchedAt+LIVE_SNAPSHOT_TTL_MS};const result=parseLiveCatalog({kind:'liveCatalog',snapshotId:hash(data),...data});this.snapshot=freezeLive({catalog:result,expires:this.now()+LIVE_SNAPSHOT_TTL_MS});this.timer=setTimeout(()=>this.clear(),LIVE_SNAPSHOT_TTL_MS);this.timer.unref?.();return structuredClone(result);
 }
 get(snapshotId,source){const s=this.snapshot;if(!s||s.expires<=this.now()){this.clear();throw new ApiError('LIVE_SNAPSHOT_EXPIRED');}if(s.catalog.snapshotId!==snapshotId||JSON.stringify(s.catalog.source)!==JSON.stringify(parseLiveSource(source)))throw new ApiError('LIVE_SOURCE_CHANGED');return s.catalog;}
}
