// "Help me apply": only a public NCT ID arrives here. The helper fetches the official record (same hardened Gov transport as the live path),
// pins four public tool outputs plus the exact Agents request, and runs the agent, which may only select fixed-catalog IDs. No patient data.
import {createHash,randomBytes} from 'node:crypto';
import {fetchGovRecord,freezeLive} from './live-evidence.mjs';
import {sameSecret} from './real.mjs';
import {ApiError} from './transport.mjs';
import {runPinnedToolAgent,MAX_TOOL_ARGUMENT_BYTES} from './provider.mjs';
import {normalizeApplyRecord} from '../shared/apply-record.mjs';
import {parseApplyRequest,parsePreparedApply,parseApplyResult,APPLY_TOKEN_TTL_MS,APPLY_TOOL_SECTIONS,APPLY_QUESTION_TEMPLATES,APPLY_PRESCREEN_TEMPLATES,APPLY_FLAG_TEMPLATES} from '../shared/apply-contract.mjs';
import {exactKeys,isRecord,templateIdList,utf8Bytes,MAX_MESSAGE_BYTES} from '../shared/demo-contract.mjs';
import {sanitizeUntrustedText,UNTRUSTED_FIELD,UNTRUSTED_TEXT_RULE,MAX_PUBLIC_SUMMARY_CHARS} from '../shared/untrusted-text.mjs';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const APPLY_TOOL_NAME='get_public_trial_evidence';
export const APPLY_TOOL_OUTPUT_MAX_BYTES=12*1024;
// Per-section output budgets (all within the 12 KB contract cap) leave room in the 96 KB reply for the normalized record itself.
export const APPLY_SECTION_BUDGETS=Object.freeze({overview:8*1024,eligibility:APPLY_TOOL_OUTPUT_MAX_BYTES,design:8*1024,locations_contacts:8*1024});
export const APPLY_TOOL_SITES=30;
export const APPLY_MAX_OUTPUT_BYTES=4000;
// Fixed text only: rejected tool arguments are never echoed back to the model, trace or logs.
export const APPLY_TOOL_ARGUMENT_ERROR='Rejected: get_public_trial_evidence accepts exactly two arguments: nctId set to this study\'s NCT ID, and section set to one of overview, eligibility, design or locations_contacts. No evidence was returned.';
const DATE=/^\d{4}-\d{2}(-\d{2})?$/,ENUM=/^[A-Z][A-Z0-9_]{0,39}$/;
const STATUSES=new Set(['ACTIVE_NOT_RECRUITING','COMPLETED','ENROLLING_BY_INVITATION','NOT_YET_RECRUITING','RECRUITING','SUSPENDED','TERMINATED','WITHDRAWN','AVAILABLE','NO_LONGER_AVAILABLE','TEMPORARILY_NOT_AVAILABLE','APPROVED_FOR_MARKETING','WITHHELD','UNKNOWN']);
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const arr=v=>Array.isArray(v)?v:[];
// Structured API enum values (study type, phase, allocation ...) stay outside the untrusted block only when they are plain enum tokens.
const token=v=>typeof v==='string'&&ENUM.test(v)?v:null;
const tokens=(v,max)=>[...new Set(arr(v).map(token).filter(Boolean))].slice(0,max);
const date=v=>typeof v==='string'&&DATE.test(v)?v:null;
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const publicAge=v=>typeof v==='string'&&/^(?:[0-9]{1,3}(?:\.[0-9]{1,2})? (?:Years|Months|Weeks|Days|Hours|Minutes)|N\/A)$/.test(v)?v:null;
const status=v=>typeof v==='string'&&STATUSES.has(v)?v:null;
// Contact phone numbers and emails never go to the model, even when a sponsor typed them into a name, role, facility or affiliation field.
const EMAIL=/[^\s@<>"()]+@[^\s@<>"()]+\.[^\s@<>"()]+/g,PHONE=/\+?\(?\d[\d\s().\/-]{5,}\d/g;
const redact=v=>typeof v==='string'?v.replace(EMAIL,'[email removed]').replace(PHONE,m=>m.replace(/\D/g,'').length>=7?'[phone removed]':m):v;
// Third-party text helpers for one build attempt: every string passes sanitizeUntrustedText; caps shrink with scale until the section fits.
function helpers(scale,cut,clean=v=>v){
 const text=(field,v,chars)=>{if(typeof v!=='string')return null;const full=sanitizeUntrustedText(clean(v));if(!full)return null;const out=sanitizeUntrustedText(clean(v),Math.floor(chars*scale)).trim();if(out!==full)cut.add(field);return out||null;};
 const list=(field,v,n)=>{const all=arr(v),k=Math.floor(n*scale);if(all.length>k)cut.add(field);return all.slice(0,k).map(obj);};
 const texts=(field,v,n,chars)=>{const all=arr(v).filter(x=>typeof x==='string'),k=Math.floor(n*scale);if(all.length>k)cut.add(field);return all.slice(0,k).map(x=>text(field,x,chars)).filter(Boolean);};
 return{text,list,texts};
}
const SCALES=[1,.8,.64,.5,.4,.3,.2,.12,.06,0];
function fit(nctId,section,build,clean){
 for(const scale of SCALES){const cut=new Set(),{structured,untrusted}=build(helpers(scale,cut,clean));const output=JSON.stringify({public:true,nctId,section,...structured,truncatedFields:[...cut],[UNTRUSTED_FIELD]:untrusted});if(utf8Bytes(output)<=APPLY_SECTION_BUDGETS[section])return output;}
 throw new ApiError('RECORD_UNAVAILABLE');
}
function overview(p,nctId){const id=obj(p.identificationModule),st=obj(p.statusModule),d=obj(p.descriptionModule),c=obj(p.conditionsModule),ds=obj(p.designModule),ai=obj(p.armsInterventionsModule),en=obj(ds.enrollmentInfo),pc=obj(st.primaryCompletionDateStruct);
 return fit(nctId,'overview',({text,list,texts})=>({structured:{studyType:token(ds.studyType),phases:tokens(ds.phases,6),enrollment:{count:count(en.count),type:token(en.type)},startDate:date(obj(st.startDateStruct).date),primaryCompletionDate:date(pc.date),primaryCompletionType:token(pc.type)},
  untrusted:{briefTitle:text('briefTitle',id.briefTitle,300),officialTitle:text('officialTitle',id.officialTitle,600),acronym:text('acronym',id.acronym,40),briefSummary:text('briefSummary',d.briefSummary,MAX_PUBLIC_SUMMARY_CHARS),conditions:texts('conditions',c.conditions,12,120),interventions:list('interventions',ai.interventions,10).map(x=>({type:token(x.type),name:text('interventions',x.name,160),description:text('interventions',x.description,500)}))}}));}
function eligibility(p,nctId){const el=obj(p.eligibilityModule);
 return fit(nctId,'eligibility',({text})=>({structured:{minimumAge:publicAge(el.minimumAge),maximumAge:publicAge(el.maximumAge),sex:['ALL','FEMALE','MALE'].includes(el.sex)?el.sex:null,healthyVolunteers:typeof el.healthyVolunteers==='boolean'?el.healthyVolunteers:null,stdAges:tokens(el.stdAges,3)},
  untrusted:{eligibilityCriteria:text('eligibilityCriteria',el.eligibilityCriteria,10500),studyPopulation:text('studyPopulation',el.studyPopulation,1200)}}));}
function design(p,nctId){const ds=obj(p.designModule),di=obj(ds.designInfo),mi=obj(di.maskingInfo),ai=obj(p.armsInterventionsModule),om=obj(p.outcomesModule);
 return fit(nctId,'design',({text,list,texts})=>({structured:{studyType:token(ds.studyType),allocation:token(di.allocation),interventionModel:token(di.interventionModel),primaryPurpose:token(di.primaryPurpose),observationalModel:token(di.observationalModel),timePerspective:token(di.timePerspective),masking:token(mi.masking),whoMasked:tokens(mi.whoMasked,4),armGroupCount:arr(ai.armGroups).length,primaryOutcomeCount:arr(om.primaryOutcomes).length},
  untrusted:{interventionModelDescription:text('interventionModelDescription',di.interventionModelDescription,600),maskingDescription:text('maskingDescription',mi.maskingDescription,400),armGroups:list('armGroups',ai.armGroups,8).map(g=>({label:text('armGroups',g.label,160),type:token(g.type),description:text('armGroups',g.description,500),interventionNames:texts('armGroups',g.interventionNames,4,120)})),primaryOutcomes:list('primaryOutcomes',om.primaryOutcomes,6).map(o=>({measure:text('primaryOutcomes',o.measure,400),timeFrame:text('primaryOutcomes',o.timeFrame,200)}))}}));}
function locationsContacts(p,nctId,fetchedAt){const st=obj(p.statusModule),cl=obj(p.contactsLocationsModule),pc=obj(st.primaryCompletionDateStruct),locations=arr(cl.locations).map(obj),central=arr(cl.centralContacts).map(obj);
 const siteStatusCounts={};for(const l of locations){const s=status(l.status)??(l.status===undefined||l.status===null?'NOT_LISTED':'OTHER');siteStatusCounts[s]=(siteStatusCounts[s]??0)+1;}
 // Counts only: phone numbers and emails themselves never enter a tool output.
 const has=v=>typeof v==='string'&&v.trim().length>0,domain=v=>has(v)&&/@([^\s@]+)$/.exec(v.trim())?.[1].toLowerCase(),siteContacts=locations.flatMap(l=>arr(l.contacts).map(obj));
 const contactSummary={centralContacts:central.length,centralWithEmail:central.filter(c=>has(c.email)).length,centralWithPhone:central.filter(c=>has(c.phone)).length,sitesWithDirectContact:locations.filter(l=>arr(l.contacts).length>0).length,sitesWithoutDirectContact:locations.filter(l=>!arr(l.contacts).length).length,distinctContactEmailDomains:new Set([...central,...siteContacts].map(c=>domain(c.email)).filter(Boolean)).size};
 return fit(nctId,'locations_contacts',({text,list})=>{const sites=list('sites',locations,APPLY_TOOL_SITES).map(l=>({facility:text('sites',l.facility,200),city:text('sites',l.city,100),state:text('sites',l.state,100),country:text('sites',l.country,100),status:status(l.status)}));
  return{structured:{asOfDate:new Date(fetchedAt).toISOString().slice(0,10),overallStatus:status(st.overallStatus)??'UNKNOWN',primaryCompletionDate:date(pc.date),primaryCompletionType:token(pc.type),completionDate:date(obj(st.completionDateStruct).date),lastUpdatePostDate:date(obj(st.lastUpdatePostDateStruct).date),siteCount:locations.length,siteStatusCounts,sitesListed:sites.length,contactSummary},
   untrusted:{centralContacts:list('centralContacts',central,4).map(c=>({name:text('centralContacts',c.name,160),role:token(c.role)})),officials:list('officials',cl.overallOfficials,6).map(o=>({name:text('officials',o.name,160),role:token(o.role),affiliation:text('officials',o.affiliation,200)})),sites}};},redact);}
// The four pinned tool outputs, in APPLY_TOOL_SECTIONS order. Each is a JSON string of at most its section budget.
export function buildApplyToolResults(raw,nctId,fetchedAt){const p=obj(obj(raw).protocolSection);if(obj(p.identificationModule).nctId!==nctId)throw new ApiError('RECORD_UNAVAILABLE');
 const outputs={overview:overview(p,nctId),eligibility:eligibility(p,nctId),design:design(p,nctId),locations_contacts:locationsContacts(p,nctId,fetchedAt)};return APPLY_TOOL_SECTIONS.map(section=>({section,output:outputs[section]}));}
const catalog=table=>Object.entries(table).map(([id,text])=>`${id} = "${text}"`).join('; ');
export function applyOutputSchema(){return{type:'object',additionalProperties:false,properties:{questionIds:{type:'array',minItems:3,maxItems:8,items:{type:'string',enum:Object.keys(APPLY_QUESTION_TEMPLATES)}},prescreenIds:{type:'array',minItems:2,maxItems:8,items:{type:'string',enum:Object.keys(APPLY_PRESCREEN_TEMPLATES)}},flagIds:{type:'array',minItems:0,maxItems:4,items:{type:'string',enum:Object.keys(APPLY_FLAG_TEMPLATES)}}},required:['questionIds','prescreenIds','flagIds']};}
// Same Agents body shape, model and fields as the agentLive request; one function tool pinned to this study's NCT ID and the four sections.
export function buildApplyAgentsRequest(nctId,title){
 const instructions='You help a patient, or a family member helping them, prepare to contact the study team of one public ClinicalTrials.gov study. You have no patient information. '+
  'You MUST call get_public_trial_evidence with section "eligibility" and with section "locations_contacts" before your final JSON; sections "overview" and "design" are optional. Use at most 6 tool calls. '+
  'Then return JSON that selects 3 to 8 questionIds, 2 to 8 prescreenIds and 0 to 4 flagIds, each ID at most once and ONLY from the lists below. Choose the questions and pre-screening items that best fit this study\'s public eligibility criteria, design and contacts; choose a flag only when the public evidence supports it (compare dates with asOfDate). '+
  'Never give medical advice, diagnoses, eligibility decisions or benefit promises, and never write free text. You have no browser, files, shell, MCP or other tools. '+
  `Question IDs: ${catalog(APPLY_QUESTION_TEMPLATES)}. Pre-screening IDs: ${catalog(APPLY_PRESCREEN_TEMPLATES)}. Flag IDs: ${catalog(APPLY_FLAG_TEMPLATES)}. `+UNTRUSTED_TEXT_RULE;
 return{environment:{type:'none'},agent:{model:'gpt-6-astra',reasoning:{effort:'low'},multi_agent:{enabled:false},instructions,tools:[{type:'function',name:APPLY_TOOL_NAME,description:'Read one section of the immutable official public ClinicalTrials.gov record of this study.',parameters:{type:'object',properties:{nctId:{type:'string',enum:[nctId]},section:{type:'string',enum:[...APPLY_TOOL_SECTIONS]}},required:['nctId','section'],additionalProperties:false}}],text:{format:{type:'json_schema',schema:applyOutputSchema()},verbosity:'low'}},input:JSON.stringify({nctId,[UNTRUSTED_FIELD]:{title}}),stream:true};
}
// Prepared result for the panel: the normalized record plus the exact request and outputs, within the reply budget (trailing sites drop first).
export function buildPreparedApply(raw,nctId,fetchedAt,{token,expiresAt}){
 let record=normalizeApplyRecord(raw,fetchedAt);if(record.nctId!==nctId)throw new ApiError('RECORD_UNAVAILABLE');
 const preview={agentsRequest:buildApplyAgentsRequest(nctId,record.title),toolResults:buildApplyToolResults(raw,nctId,fetchedAt)};
 const shell={kind:'preparedApply',token,digest:'0'.repeat(64),expiresAt,nctId,record:null,preview},budget=MAX_MESSAGE_BYTES-1024-(utf8Bytes(shell)-4);
 if(utf8Bytes(record)>budget)record=normalizeApplyRecord(raw,fetchedAt,budget);
 const digest=sha({kind:'preparedApply',nctId,record,preview});return parsePreparedApply({...shell,digest,record});
}
export function toolArgumentSection(raw,nctId){let value=raw;if(typeof raw==='string'){if(Buffer.byteLength(raw)>MAX_TOOL_ARGUMENT_BYTES)return undefined;try{value=JSON.parse(raw);}catch{return undefined;}}
 if(!isRecord(value))return undefined;const keys=Object.keys(value);if(keys.length!==2||!keys.includes('nctId')||!keys.includes('section')||typeof value.nctId!=='string'||value.nctId!==nctId||typeof value.section!=='string'||!APPLY_TOOL_SECTIONS.includes(value.section))return undefined;return value.section;}
export function parseApplyPlan(text){if(typeof text!=='string'||Buffer.byteLength(text)>APPLY_MAX_OUTPUT_BYTES)throw new ApiError('INVALID_AGENT_OUTPUT');let v;try{v=JSON.parse(text);}catch{throw new ApiError('INVALID_AGENT_OUTPUT');}
 if(!exactKeys(v,['questionIds','prescreenIds','flagIds'])||!templateIdList(v.questionIds,APPLY_QUESTION_TEMPLATES,3,8)||!templateIdList(v.prescreenIds,APPLY_PRESCREEN_TEMPLATES,2,8)||!templateIdList(v.flagIds,APPLY_FLAG_TEMPLATES,0,4))throw new ApiError('INVALID_AGENT_OUTPUT');
 return{questionIds:[...v.questionIds],prescreenIds:[...v.prescreenIds],flagIds:[...v.flagIds]};}
// Runs the pinned request through the shared Agents session loop: tool calls are answered only from the pinned section outputs.
export function runPreparedApply(transport,pinned,options){
 const outputs=new Map(pinned.toolResults.map(x=>[x.section,x.output]));if(outputs.size!==APPLY_TOOL_SECTIONS.length||APPLY_TOOL_SECTIONS.some(s=>typeof outputs.get(s)!=='string'))throw new ApiError('INVALID_TOOL_EVIDENCE');
 const answer=raw=>{const section=toolArgumentSection(raw,pinned.nctId);return section===undefined?undefined:{key:section,output:outputs.get(section),trace:{nctId:pinned.nctId,section}};};
 const finish=(text,read)=>{if(!read.has('eligibility'))throw new ApiError('INCOMPLETE_AGENT_TURN');return{...parseApplyPlan(text),sectionsRead:[...read]};};
 return runPinnedToolAgent(transport,pinned.agentsRequest,{answer,finish,toolError:APPLY_TOOL_ARGUMENT_ERROR,wrapResult:v=>parseApplyResult({kind:'applyAgent',nctId:pinned.nctId,digest:pinned.digest,...v})},options);
}
export class PreparedApplyStore{
 constructor({fetchRecord=fetchGovRecord,now=()=>performance.now(),wallNow=()=>Date.now(),token=()=>randomBytes(32).toString('base64url'),onInvalidate=()=>{}}={}){this.fetchRecord=fetchRecord;this.now=now;this.wallNow=wallNow;this.makeToken=token;this.onInvalidate=onInvalidate;this.active=undefined;this.used=false;this.timer=undefined;this.controller=undefined;this.epoch=0;}
 // Explicit invalidation (revoke, cancel of an apply operation, disconnect): stops a record fetch, drops the token and aborts running apply sends.
 clear(){this.controller?.abort();this.controller=undefined;this.epoch++;this.discard();this.onInvalidate();}
 // Expiry, a new preparation or invalid apply input: the token can no longer start a send, but a send that already started is never aborted.
 discard(){clearTimeout(this.timer);this.timer=undefined;this.active=undefined;this.used=false;}
 async prepare(nctId,{signal}={}){
  parseApplyRequest({id:'native',type:'prepareApply',payload:{nctId}});this.discard();this.controller?.abort();const controller=this.controller=new AbortController(),epoch=++this.epoch,combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const stopped=()=>combined.aborted||this.epoch!==epoch;
  try{let raw;try{raw=await this.fetchRecord(nctId,{signal:combined});}catch(error){throw new ApiError(stopped()||error?.code==='CANCELLED'?'CANCELLED':'RECORD_UNAVAILABLE',error?.status);}if(stopped())throw new ApiError('CANCELLED');
   const token=this.makeToken(),expiresAt=this.wallNow()+APPLY_TOKEN_TTL_MS;let result;try{result=buildPreparedApply(raw,nctId,this.wallNow(),{token,expiresAt});}catch{throw new ApiError('RECORD_UNAVAILABLE');}
   this.active=freezeLive({token,digest:result.digest,expires:this.now()+APPLY_TOKEN_TTL_MS,pinned:{nctId,digest:result.digest,agentsRequest:result.preview.agentsRequest,toolResults:result.preview.toolResults}});this.used=false;
   this.timer=setTimeout(()=>this.discard(),APPLY_TOKEN_TTL_MS);this.timer.unref?.();return structuredClone(result);
  }finally{if(this.controller===controller)this.controller=undefined;}
 }
 // One use: the first matching receipt starts the run; any later use of the same token is refused until a new preparation.
 take(payload){parseApplyRequest({id:'native',type:'executeApply',payload});const c=this.active;if(!c||c.expires<=this.now()){this.discard();throw new ApiError('APPLY_EXPIRED');}
  // Both secrets are always compared (non-short-circuit &), each in constant time for equal lengths.
  if(!(sameSecret(payload.token,c.token)&sameSecret(payload.digest,c.digest))||this.used)throw new ApiError('INVALID_APPLY_RECEIPT');this.used=true;return c.pinned;}
 revoke(token){if(token!==undefined&&this.active&&!sameSecret(token,this.active.token))throw new ApiError('INVALID_APPLY_RECEIPT');this.clear();}
}
