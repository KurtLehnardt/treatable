// Normalizes an official ClinicalTrials.gov API v2 study into the public ApplyRecord used for the local contact plan.
// Pure and shared: the native helper and the browser fallback produce identical records from the same raw JSON.
import {sanitizeUntrustedText} from './untrusted-text.mjs';
import {parseApplyRecord,parsePublicStudyBrief,applyNctId,APPLY_MAX_SITES,APPLY_MAX_SITE_CONTACTS,APPLY_MAX_CENTRAL_CONTACTS,APPLY_MAX_OFFICIALS,APPLY_RECORD_MAX_BYTES} from './apply-contract.mjs';
import {utf8Bytes} from './demo-contract.mjs';
const DATE=/^\d{4}-\d{2}(-\d{2})?$/;
function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function arr(v){return Array.isArray(v)?v:[];}
function text(v,max){if(typeof v!=='string')return null;const s=sanitizeUntrustedText(v,max);return s?s:null;}
function num(v,min,max){return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;}
function date(v){const s=obj(v).date;return typeof s==='string'&&DATE.test(s)?s:null;}
function email(v){const s=text(v,254);return s&&/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s)?s:null;}
// maxBytes (optional, default and ceiling APPLY_RECORD_MAX_BYTES): a large multi-site study keeps its first sites that fit, with sitesTruncated:true,
// instead of failing validation. Earlier part IDs never change when trailing sites are dropped.
export function normalizeApplyRecord(raw,fetchedAt,maxBytes=APPLY_RECORD_MAX_BYTES){
 const p=obj(obj(raw).protocolSection),id=obj(p.identificationModule),st=obj(p.statusModule),el=obj(p.eligibilityModule),cl=obj(p.contactsLocationsModule);
 const nctId=applyNctId(id.nctId);let n=0;
 const contact=c=>({id:`c${++n}`,name:text(obj(c).name,160),role:text(obj(c).role,60),phone:text(obj(c).phone,40),phoneExt:text(obj(c).phoneExt,20),email:email(obj(c).email)});
 const centralContacts=arr(cl.centralContacts).slice(0,APPLY_MAX_CENTRAL_CONTACTS).map(contact);
 const officials=arr(cl.overallOfficials).slice(0,APPLY_MAX_OFFICIALS).map((o,i)=>({id:`o${i+1}`,name:text(obj(o).name,160),role:text(obj(o).role,60),affiliation:text(obj(o).affiliation,200)}));
 const locations=arr(cl.locations);
 const sites=locations.slice(0,APPLY_MAX_SITES).map((l,i)=>{const s=obj(l),g=obj(s.geoPoint);return{id:`s${i+1}`,facility:text(s.facility,200),status:text(s.status,40),city:text(s.city,100),state:text(s.state,100),zip:text(s.zip,20),country:text(s.country,100),lat:num(g.lat,-90,90),lon:num(g.lon,-180,180),contacts:arr(s.contacts).slice(0,APPLY_MAX_SITE_CONTACTS).map(contact)}});
 const type=obj(st.primaryCompletionDateStruct).type;
 const record={nctId,title:text(id.briefTitle,1000)??nctId,officialTitle:text(id.officialTitle,2000),acronym:text(id.acronym,100),orgStudyId:text(obj(id.orgStudyIdInfo).id,100),overallStatus:text(st.overallStatus,40)??'UNKNOWN',primaryCompletionDate:date(st.primaryCompletionDateStruct),primaryCompletionType:type==='ACTUAL'||type==='ESTIMATED'?type:null,lastUpdatePostDate:date(st.lastUpdatePostDateStruct),minimumAge:text(el.minimumAge,40),maximumAge:text(el.maximumAge,40),centralContacts,officials,sites,sitesTruncated:locations.length>APPLY_MAX_SITES,sourceUrl:`https://clinicaltrials.gov/study/${nctId}`,fetchedAt};
 const limit=Number.isSafeInteger(maxBytes)?Math.min(maxBytes,APPLY_RECORD_MAX_BYTES):APPLY_RECORD_MAX_BYTES;
 if(utf8Bytes(record)>limit){// Bytes of the record with no sites, plus each kept site and its separating comma.
  const empty=utf8Bytes({...record,sites:[],sitesTruncated:true});let total=empty,keep=0;for(const s of sites){const next=total+utf8Bytes(s)+(keep?1:0);if(next>limit)break;total=next;keep++;}
  record.sites=sites.slice(0,keep);record.sitesTruncated=true;}
 return parseApplyRecord(record);
}

// Source excerpts are quotations of sanitized official fields, not generated medical claims.
export function normalizeStudyBrief(raw,fetchedAt){
 const p=obj(obj(raw).protocolSection),nctId=applyNctId(obj(p.identificationModule).nctId),sourceUrl=`https://clinicaltrials.gov/study/${nctId}`,items=[],unknowns=[];
 const add=(category,label,field,value,max=900)=>{let valueText=text(value,max);if(valueText){let bounded='',bytes=0;for(const char of valueText){const size=new TextEncoder().encode(char).length;if(bytes+size>2100)break;bounded+=char;bytes+=size}valueText=bounded.trim()}if(valueText&&items.length<36)items.push({id:`e${items.length+1}`,category,label,field:`protocolSection.${field}`,text:valueText,sourceUrl});};
 const d=obj(p.descriptionModule),ds=obj(p.designModule),di=obj(ds.designInfo),st=obj(p.statusModule),el=obj(p.eligibilityModule),ai=obj(p.armsInterventionsModule);
 add('overview','Study purpose','descriptionModule.briefSummary',d.briefSummary,1800);
 // Split on paragraph/sentence boundaries so timeline and sham/crossover evidence remain exact source excerpts.
 const sentences=typeof d.detailedDescription==='string'?sanitizeUntrustedText(d.detailedDescription).split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(x=>x.trim()).filter(Boolean):[];
 for(const [i,t] of sentences.slice(0,10).entries())add(/visit|week|month|follow.up|day|year|treatment.{0,30}apart/i.test(t)?'timeline':'design','Study description',`descriptionModule.detailedDescription`,t,1400);
 for(const [field,label]of[['allocation','Assignment to groups'],['interventionModel','Study model'],['primaryPurpose','Study purpose type']])add('design',label,`designModule.designInfo.${field}`,di[field]);
 add('design','Masking','designModule.designInfo.maskingInfo.masking',obj(di.maskingInfo).masking);
 for(const [i,a]of arr(ai.armGroups).slice(0,4).entries())add('design',text(obj(a).label,80)||'Study group',`armsInterventionsModule.armGroups[${i}].description`,obj(a).description,900);
 for(const [field,label]of[['startDateStruct','Study start'],['primaryCompletionDateStruct','Primary completion'],['completionDateStruct','Study completion']]){const v=obj(st[field]);if(date(v))add('timeline',label,`statusModule.${field}.date`,v.date);}
 add('eligibility','Minimum age','eligibilityModule.minimumAge',el.minimumAge);add('eligibility','Maximum age','eligibilityModule.maximumAge',el.maximumAge);add('eligibility','Sex listed in criteria','eligibilityModule.sex',el.sex);
 const criteria=typeof el.eligibilityCriteria==='string'?sanitizeUntrustedText(el.eligibilityCriteria).split(/\n+/).map(x=>x.trim()).filter(x=>x&&!/^(?:inclusion|exclusion) criteria:?$/i.test(x)):[];
 for(const t of criteria.slice(0,8))add('eligibility','Listed participation criterion','eligibilityModule.eligibilityCriteria',t,900);
 add('contact','Overall recruitment status','statusModule.overallStatus',st.overallStatus);
 if(!items.some(x=>x.category==='timeline'))unknowns.push('The record does not give a clear participation timeline.');
 if(!criteria.length)unknowns.push('Detailed eligibility criteria are not listed in the available source.');
 if(!items.some(x=>/sham|placebo/i.test(x.text)))unknowns.push('A sham or placebo group is not described in the available excerpts.');
 if(!items.some(x=>/cross.?over/i.test(x.text)))unknowns.push('Access to treatment after a control group is not stated in the available excerpts.');
 if(!arr(obj(p.contactsLocationsModule).centralContacts).length&&!arr(obj(p.contactsLocationsModule).locations).some(l=>arr(obj(l).contacts).length))unknowns.push('No study contact is listed in the available record.');
 if(!obj(raw).resultsSection)unknowns.push('Published results are not included in the available source excerpts.');while(items.length&&utf8Bytes({nctId,sourceUrl,fetchedAt,items,unknowns})>20*1024)items.pop();const brief={nctId,sourceUrl,fetchedAt,items,unknowns,claims:[]};return parsePublicStudyBrief(brief);
}
