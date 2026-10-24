// Normalizes an official ClinicalTrials.gov API v2 study into the public ApplyRecord used for the local contact plan.
// Pure and shared: the native helper and the browser fallback produce identical records from the same raw JSON.
import {sanitizeUntrustedText} from './untrusted-text.mjs';
import {parseApplyRecord,applyNctId,APPLY_MAX_SITES,APPLY_MAX_SITE_CONTACTS,APPLY_MAX_CENTRAL_CONTACTS,APPLY_MAX_OFFICIALS} from './apply-contract.mjs';
const DATE=/^\d{4}-\d{2}(-\d{2})?$/;
function obj(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}
function arr(v){return Array.isArray(v)?v:[];}
function text(v,max){if(typeof v!=='string')return null;const s=sanitizeUntrustedText(v,max);return s?s:null;}
function num(v,min,max){return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;}
function date(v){const s=obj(v).date;return typeof s==='string'&&DATE.test(s)?s:null;}
function email(v){const s=text(v,254);return s&&/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s)?s:null;}
export function normalizeApplyRecord(raw,fetchedAt){
 const p=obj(obj(raw).protocolSection),id=obj(p.identificationModule),st=obj(p.statusModule),el=obj(p.eligibilityModule),cl=obj(p.contactsLocationsModule);
 const nctId=applyNctId(id.nctId);let n=0;
 const contact=c=>({id:`c${++n}`,name:text(obj(c).name,160),role:text(obj(c).role,60),phone:text(obj(c).phone,40),phoneExt:text(obj(c).phoneExt,20),email:email(obj(c).email)});
 const centralContacts=arr(cl.centralContacts).slice(0,APPLY_MAX_CENTRAL_CONTACTS).map(contact);
 const officials=arr(cl.overallOfficials).slice(0,APPLY_MAX_OFFICIALS).map((o,i)=>({id:`o${i+1}`,name:text(obj(o).name,160),role:text(obj(o).role,60),affiliation:text(obj(o).affiliation,200)}));
 const locations=arr(cl.locations);
 const sites=locations.slice(0,APPLY_MAX_SITES).map((l,i)=>{const s=obj(l),g=obj(s.geoPoint);return{id:`s${i+1}`,facility:text(s.facility,200),status:text(s.status,40),city:text(s.city,100),state:text(s.state,100),zip:text(s.zip,20),country:text(s.country,100),lat:num(g.lat,-90,90),lon:num(g.lon,-180,180),contacts:arr(s.contacts).slice(0,APPLY_MAX_SITE_CONTACTS).map(contact)}});
 const type=obj(st.primaryCompletionDateStruct).type;
 return parseApplyRecord({nctId,title:text(id.briefTitle,1000)??nctId,officialTitle:text(id.officialTitle,2000),acronym:text(id.acronym,100),orgStudyId:text(obj(id.orgStudyIdInfo).id,100),overallStatus:text(st.overallStatus,40)??'UNKNOWN',primaryCompletionDate:date(st.primaryCompletionDateStruct),primaryCompletionType:type==='ACTUAL'||type==='ESTIMATED'?type:null,lastUpdatePostDate:date(st.lastUpdatePostDateStruct),minimumAge:text(el.minimumAge,40),maximumAge:text(el.maximumAge,40),centralContacts,officials,sites,sitesTruncated:locations.length>APPLY_MAX_SITES,sourceUrl:`https://clinicaltrials.gov/study/${nctId}`,fetchedAt});
}
