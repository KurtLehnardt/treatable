// "Help me apply" protocol. Only a public NCT ID crosses to the native helper; no patient data is accepted or sent to a model.
// The native helper fetches the official record, pins the exact Agents request, and returns fixed-catalog IDs only.
import {exactKeys,isRecord,validId,utf8Bytes,templateIdList,MAX_MESSAGE_BYTES} from './demo-contract.mjs';
export const APPLY_REQUEST_TYPES=Object.freeze(['prepareApply','executeApply','revokeApply','prepareStudyBrief','executeStudyBrief','revokeStudyBrief']);
export const APPLY_TOKEN_TTL_MS=5*60*1000;
export const APPLY_MAX_SITES=150;
export const APPLY_MAX_SITE_CONTACTS=4;
export const APPLY_MAX_CENTRAL_CONTACTS=4;
export const APPLY_MAX_OFFICIALS=6;
// Upper bound for a normalized record (unchanged value); normalizeApplyRecord drops trailing sites to stay within a budget instead of failing.
export const APPLY_RECORD_MAX_BYTES=MAX_MESSAGE_BYTES-8*1024;
export const APPLY_TOOL_SECTIONS=Object.freeze(['overview','eligibility','design','locations_contacts']);
// Questions the patient can ask the study team. Rendered only from this table.
export const APPLY_QUESTION_TEMPLATES=Object.freeze({
 still_enrolling:'Is the study still enrolling at this site?',
 prescreen_fit:'Based on what I have shared, would I be a fit for a pre-screening call?',
 visits:'How many visits are required, and how long does each one take?',
 duration:'How long would I be in the study, including follow-up?',
 placebo:'Is there a placebo or sham group, and what are the chances of being in it?',
 crossover:'If I am in the placebo or sham group, can I receive the study treatment later?',
 procedure:'What does the study procedure involve, and is there recovery time?',
 costs:'Which study costs are covered, and is there compensation or travel reimbursement?',
 imaging:'Will I need new imaging or tests, or can you use my existing records?',
 medications:'Would I need to stop or change any of my current medicines?',
 remote_visits:'Can any visits be done by phone, by video, or closer to home?',
 caregiver:'Can a family member or caregiver come with me to visits?',
 next_steps:'What are the next steps, and how soon would I hear back?',
 results:'Will I be told the results when the study ends?'});
// Information the study team is likely to ask for during pre-screening. Rendered only from this table.
export const APPLY_PRESCREEN_TEMPLATES=Object.freeze({
 diagnosis_details:'Your diagnosis and when it was made',
 affected_area:'Which part of the body is affected (for example, which spine level)',
 symptom_duration:'How long you have had symptoms',
 recent_imaging:'Recent imaging reports (MRI, X-ray or CT) and their dates',
 prior_treatments:'Treatments you have already tried and how well they worked',
 prior_surgery:'Any past surgery related to this condition',
 medication_list:'A list of your current medicines, including any blood thinners',
 other_conditions:'Other health conditions you are being treated for',
 daily_impact:'How your symptoms affect daily life (for example, a 0 to 10 pain rating)',
 doctor_contact:'Your doctor’s name and contact details, in case the team requests records',
 insurance:'Insurance information, if the team asks for it',
 availability:'Days and times you could travel to the study site',
 pregnancy_status:'Pregnancy status or plans, if this applies to you'});
// Warnings shown with the contact plan. The agent may select some; the panel adds deterministic ones from the record.
export const APPLY_FLAG_TEMPLATES=Object.freeze({
 near_completion:'Main data collection is scheduled to finish soon. Ask whether the study is still enrolling.',
 status_mismatch:'The study’s overall status and this site’s status do not match. Confirm that the site is enrolling.',
 contact_inconsistent:'Contact details look inconsistent between sites. Double-check the email address before sending.',
 no_site_contact:'This site has no direct contact listed. Use the study’s central contact instead.',
 stale_record:'This record has not been updated in over a year, so some details may be out of date.',
 not_yet_recruiting:'This site is not recruiting yet. Ask when it expects to open.',
 limited_sites:'Only a few sites are listed, so travel may be needed.',
 age_limit:'This study has an age limit. Check it before you contact the team.'});
const HASH=/^[a-f0-9]{64}$/,TOKEN=/^[A-Za-z0-9_-]{43}$/,NCT=/^NCT[0-9]{8}$/,PART_ID=/^[cos][0-9]{1,3}$/,DATE=/^\d{4}-\d{2}(-\d{2})?$/;
export function applyNctId(v){if(typeof v!=='string'||!NCT.test(v))throw Error('Choose one public NCT ID');return v;}
function str(v,max,nullable=true){if(v===null&&nullable)return true;return typeof v==='string'&&v.length>0&&utf8Bytes(v)<=max;}
function contact(c){return exactKeys(c,['id','name','role','phone','phoneExt','email'])&&typeof c.id==='string'&&PART_ID.test(c.id)&&c.id[0]==='c'&&str(c.name,160)&&str(c.role,60)&&str(c.phone,40)&&str(c.phoneExt,20)&&(c.email===null||typeof c.email==='string'&&utf8Bytes(c.email)<=254&&/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(c.email));}
function official(o){return exactKeys(o,['id','name','role','affiliation'])&&typeof o.id==='string'&&PART_ID.test(o.id)&&o.id[0]==='o'&&str(o.name,160)&&str(o.role,60)&&str(o.affiliation,200);}
function site(s){return exactKeys(s,['id','facility','status','city','state','zip','country','lat','lon','contacts'])&&typeof s.id==='string'&&PART_ID.test(s.id)&&s.id[0]==='s'&&str(s.facility,200)&&str(s.status,40)&&str(s.city,100)&&str(s.state,100)&&str(s.zip,20)&&str(s.country,100)&&(s.lat===null||Number.isFinite(s.lat)&&s.lat>=-90&&s.lat<=90)&&(s.lon===null||Number.isFinite(s.lon)&&s.lon>=-180&&s.lon<=180)&&Array.isArray(s.contacts)&&s.contacts.length<=APPLY_MAX_SITE_CONTACTS&&s.contacts.every(contact);}
function uniqueIds(items){const ids=items.map(x=>x.id);return new Set(ids).size===ids.length;}
// Normalized public record used for the local contact plan. Produced by the native helper from the official API.
export function parseApplyRecord(v){
 if(!exactKeys(v,['nctId','title','officialTitle','acronym','orgStudyId','overallStatus','primaryCompletionDate','primaryCompletionType','lastUpdatePostDate','minimumAge','maximumAge','centralContacts','officials','sites','sitesTruncated','sourceUrl','fetchedAt']))throw Error('Invalid public apply record');
 applyNctId(v.nctId);if(v.sourceUrl!==`https://clinicaltrials.gov/study/${v.nctId}`||!Number.isSafeInteger(v.fetchedAt)||typeof v.sitesTruncated!=='boolean')throw Error('Invalid public apply record');
 if(!str(v.title,1000,false)||!str(v.officialTitle,2000)||!str(v.acronym,100)||!str(v.orgStudyId,100)||!str(v.overallStatus,40,false)||!str(v.minimumAge,40)||!str(v.maximumAge,40))throw Error('Invalid public apply text');
 for(const k of ['primaryCompletionDate','lastUpdatePostDate'])if(v[k]!==null&&(typeof v[k]!=='string'||!DATE.test(v[k])))throw Error('Invalid public apply date');
 if(![null,'ACTUAL','ESTIMATED'].includes(v.primaryCompletionType))throw Error('Invalid completion type');
 if(!Array.isArray(v.centralContacts)||v.centralContacts.length>APPLY_MAX_CENTRAL_CONTACTS||!v.centralContacts.every(contact))throw Error('Invalid central contacts');
 if(!Array.isArray(v.officials)||v.officials.length>APPLY_MAX_OFFICIALS||!v.officials.every(official))throw Error('Invalid study officials');
 if(!Array.isArray(v.sites)||v.sites.length>APPLY_MAX_SITES||!v.sites.every(site))throw Error('Invalid study sites');
 const contacts=[...v.centralContacts,...v.sites.flatMap(s=>s.contacts)];if(!uniqueIds(contacts)||!uniqueIds(v.officials)||!uniqueIds(v.sites))throw Error('Duplicate record part IDs');
 if(utf8Bytes(v)>APPLY_RECORD_MAX_BYTES)throw Error('Public apply record too large');return v;
}
export function parseApplyRequest(v){
 if(!exactKeys(v,['id','type','payload'])||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||!isRecord(v.payload))throw Error('Invalid apply operation');const p=v.payload;
 if(['prepareStudyBrief','executeStudyBrief','revokeStudyBrief'].includes(v.type))return parseStudyBriefRequest(v);
 if(v.type==='prepareApply'){if(!exactKeys(p,['nctId']))throw Error('Invalid apply preparation');applyNctId(p.nctId);}
 else if(v.type==='executeApply'){if(!exactKeys(p,['token','digest'])||typeof p.token!=='string'||!TOKEN.test(p.token)||typeof p.digest!=='string'||!HASH.test(p.digest))throw Error('Invalid prepared apply receipt');}
 else if(v.type==='revokeApply'){if(!exactKeys(p,['token'])||p.token!==undefined&&(typeof p.token!=='string'||!TOKEN.test(p.token)))throw Error('Invalid apply revocation');}
 else throw Error('Unsupported apply operation');return v;
}
// Prepared: the record for local planning plus the exact Agents request body and pinned tool outputs that executeApply will send.
export function parsePreparedApply(v){
 if(!exactKeys(v,['kind','token','digest','expiresAt','nctId','record','preview'])||v.kind!=='preparedApply'||typeof v.token!=='string'||!TOKEN.test(v.token)||typeof v.digest!=='string'||!HASH.test(v.digest)||!Number.isSafeInteger(v.expiresAt))throw Error('Invalid prepared apply plan');
 applyNctId(v.nctId);parseApplyRecord(v.record);if(v.record.nctId!==v.nctId)throw Error('Prepared record mismatch');
 if(!exactKeys(v.preview,['agentsRequest','toolResults'])||!isRecord(v.preview.agentsRequest)||!Array.isArray(v.preview.toolResults)||v.preview.toolResults.length!==APPLY_TOOL_SECTIONS.length)throw Error('Invalid apply preview');
 for(const t of v.preview.toolResults)if(!exactKeys(t,['section','output'])||!APPLY_TOOL_SECTIONS.includes(t.section)||typeof t.output!=='string'||utf8Bytes(t.output)>12*1024)throw Error('Invalid pinned tool output');
 if(new Set(v.preview.toolResults.map(t=>t.section)).size!==APPLY_TOOL_SECTIONS.length||utf8Bytes(v)>MAX_MESSAGE_BYTES-1024)throw Error('Invalid apply preview');return v;
}
export function parseApplyResult(v){
 if(!exactKeys(v,['kind','mode','nctId','digest','questionIds','prescreenIds','flagIds','sectionsRead','toolCalls','cleanup'])||v.kind!=='applyAgent'||!['live','test'].includes(v.mode)||typeof v.digest!=='string'||!HASH.test(v.digest))throw Error('Invalid apply result');applyNctId(v.nctId);
 if(!templateIdList(v.questionIds,APPLY_QUESTION_TEMPLATES,3,8))throw Error('Invalid question selection');
 if(!templateIdList(v.prescreenIds,APPLY_PRESCREEN_TEMPLATES,2,8))throw Error('Invalid pre-screen selection');
 if(!templateIdList(v.flagIds,APPLY_FLAG_TEMPLATES,0,4))throw Error('Invalid flag selection');
 if(!Array.isArray(v.sectionsRead)||!v.sectionsRead.length||v.sectionsRead.length>APPLY_TOOL_SECTIONS.length||new Set(v.sectionsRead).size!==v.sectionsRead.length||v.sectionsRead.some(s=>typeof s!=='string'||!APPLY_TOOL_SECTIONS.includes(s))||!v.sectionsRead.includes('eligibility'))throw Error('Agent did not read the eligibility evidence');
 if(!Number.isInteger(v.toolCalls)||v.toolCalls<v.sectionsRead.length||v.toolCalls>6||!['deleted','failed'].includes(v.cleanup))throw Error('Invalid apply agent trace');return v;
}
export function parseApplyReply(v,expectedId){
 if(!isRecord(v)||v.id!==expectedId||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||v.type!=='result'||typeof v.ok!=='boolean'||!exactKeys(v,['id','type','ok','result','code','error']))throw Error('Invalid apply reply');
 if(!v.ok){if(typeof v.code!=='string'||!/^[A-Z_]{1,40}$/.test(v.code)||typeof v.error!=='string'||v.error.length>300)throw Error('Invalid apply error');}
 else if(v.result!==undefined){if(v.result?.kind==='preparedApply')parsePreparedApply(v.result);else if(v.result?.kind==='preparedStudyBrief')parsePreparedStudyBrief(v.result);else if(v.result?.kind==='studyBrief')parseStudyBriefResult(v.result);else parseApplyResult(v.result);}return v;
}

// Source-only study brief: this authority accepts public NCT IDs and receipts, never a patient profile.
export const STUDY_BRIEF_REQUEST_TYPES=Object.freeze(['prepareStudyBrief','executeStudyBrief','revokeStudyBrief']);
export const STUDY_BRIEF_CATEGORIES=Object.freeze(['overview','timeline','design','eligibility','contact']);
export const STUDY_BRIEF_ROUTES=Object.freeze(['answered_by_record','ask_patient','ask_coordinator']);
// Upper bound for one public brief including its sourced claims; claims that would exceed it are dropped, never the whole result.
export const STUDY_BRIEF_MAX_BYTES=24*1024;
// Ceiling for the complete study purpose kept for display on this device. ClinicalTrials.gov limits a brief summary to 5,000 characters; this is a safety bound only.
export const PURPOSE_DISPLAY_MAX_CHARS=60000;
export function briefNctIds(v){if(!Array.isArray(v)||v.length<1||v.length>2||new Set(v).size!==v.length)throw Error('Choose one or two current public studies');v.forEach(applyNctId);return v;}
export function parseStudyBriefRequest(v){
 if(!exactKeys(v,['id','type','payload'])||!validId(v.id)||utf8Bytes(v)>MAX_MESSAGE_BYTES||!isRecord(v.payload))throw Error('Invalid study brief operation');const p=v.payload;
 if(v.type==='prepareStudyBrief'){if(!exactKeys(p,['nctIds']))throw Error('Invalid public study selection');briefNctIds(p.nctIds);}
 else if(v.type==='executeStudyBrief'){if(!exactKeys(p,['token','digest'])||typeof p.token!=='string'||!TOKEN.test(p.token)||typeof p.digest!=='string'||!HASH.test(p.digest))throw Error('Invalid study brief receipt');}
 else if(v.type==='revokeStudyBrief'){if(!exactKeys(p,['token'])||p.token!==undefined&&(typeof p.token!=='string'||!TOKEN.test(p.token)))throw Error('Invalid study brief revocation');}
 else throw Error('Unsupported study brief operation');return v;
}
export function parsePublicStudyBrief(v){
 if(!exactKeys(v,['nctId','sourceUrl','fetchedAt','items','unknowns','claims']))throw Error('Invalid study brief');applyNctId(v.nctId);
 if(v.sourceUrl!==`https://clinicaltrials.gov/study/${v.nctId}`||!Number.isSafeInteger(v.fetchedAt)||!Array.isArray(v.items)||v.items.length>36||!Array.isArray(v.unknowns)||v.unknowns.length>8||v.unknowns.some(x=>!str(x,180,false)))throw Error('Invalid study sources');
 for(const i of v.items)if(!exactKeys(i,['id','category','label','field','text','sourceUrl','context','dateType'])||typeof i.id!=='string'||!/^e[1-9][0-9]?$/.test(i.id)||!STUDY_BRIEF_CATEGORIES.includes(i.category)||!str(i.label,100,false)||!str(i.field,160,false)||!/^protocolSection\.[A-Za-z0-9_.\[\]]+$/.test(i.field)||!str(i.text,2200,false)||i.sourceUrl!==v.sourceUrl||i.context!==undefined&&!['inclusion','exclusion','eligibility_unspecified','registry_milestone','participant_schedule'].includes(i.context)||i.dateType!==undefined&&!['ACTUAL','ESTIMATED','UNSPECIFIED'].includes(i.dateType))throw Error('Invalid source item');
 if(v.claims!==undefined){if(!Array.isArray(v.claims)||v.claims.length>8)throw Error('Invalid sourced claims');const source=new Map(v.items.map(i=>[i.id,i]));for(const c of v.claims){if(!exactKeys(c,['id','category','text','evidenceIds','sourceQuotes'])||typeof c.id!=='string'||!/^claim[1-8]$/.test(c.id)||!STUDY_BRIEF_CATEGORIES.includes(c.category)||!str(c.text,2200,false)||!Array.isArray(c.evidenceIds)||c.evidenceIds.length!==1||new Set(c.evidenceIds).size!==c.evidenceIds.length||!Array.isArray(c.sourceQuotes)||c.sourceQuotes.length!==c.evidenceIds.length||c.evidenceIds.some((id,i)=>!source.has(id)||c.sourceQuotes[i]!==source.get(id).text||c.text!==source.get(id).text||c.category!==source.get(id).category))throw Error('Invalid claim citations');}if(new Set(v.claims.map(c=>c.id)).size!==v.claims.length)throw Error('Duplicate sourced claims');}
 if(new Set(v.items.map(i=>i.id)).size!==v.items.length||utf8Bytes(v)>STUDY_BRIEF_MAX_BYTES)throw Error('Invalid study brief bounds');return v;
}
export function parsePreparedStudyBrief(v){
 if(!exactKeys(v,['kind','token','digest','expiresAt','records','briefs'])||v.kind!=='preparedStudyBrief'||typeof v.token!=='string'||!TOKEN.test(v.token)||typeof v.digest!=='string'||!HASH.test(v.digest)||!Number.isSafeInteger(v.expiresAt)||!Array.isArray(v.records)||!Array.isArray(v.briefs))throw Error('Invalid prepared study brief');
 briefNctIds(v.records.map(r=>parseApplyRecord(r).nctId));if(v.briefs.length!==v.records.length||v.briefs.some((b,i)=>parsePublicStudyBrief(b).nctId!==v.records[i].nctId)||utf8Bytes(v)>MAX_MESSAGE_BYTES-1024)throw Error('Mismatched study briefs');return v;
}
export function parseStudyBriefResult(v){
 if(!exactKeys(v,['kind','mode','digest','briefs','studyPlans','agentStatus','decisionStatus','failureCodes','cleanup','toolCalls','apiTrace'])||v.kind!=='studyBrief'||!['live','test'].includes(v.mode)||typeof v.digest!=='string'||!HASH.test(v.digest)||!['complete','failed'].includes(v.agentStatus)||!['complete','failed'].includes(v.decisionStatus)||!['deleted','failed','not_started'].includes(v.cleanup)||!Number.isInteger(v.toolCalls)||v.toolCalls<0||v.toolCalls>6||!Array.isArray(v.failureCodes)||v.failureCodes.length>2||v.failureCodes.some(c=>typeof c!=='string'||! /^[A-Z_]{1,40}$/.test(c))||!Array.isArray(v.briefs)||!Array.isArray(v.studyPlans))throw Error('Invalid study brief result');
 briefNctIds(v.briefs.map(b=>parsePublicStudyBrief(b).nctId));if(v.studyPlans.length!==v.briefs.length)throw Error('Invalid study plans');
 for(const [i,p] of v.studyPlans.entries()){
  const b=v.briefs[i],ids=new Set(b.items.map(x=>x.id));if(!exactKeys(p,['nctId','briefItemIds','questionIds','prescreenIds','flagIds','routes','prioritizedQuestionIds'])||p.nctId!==b.nctId||!Array.isArray(p.briefItemIds)||p.briefItemIds.length>12||new Set(p.briefItemIds).size!==p.briefItemIds.length||p.briefItemIds.some(id=>!ids.has(id))||!templateIdList(p.questionIds,APPLY_QUESTION_TEMPLATES,1,8)||!templateIdList(p.prescreenIds,APPLY_PRESCREEN_TEMPLATES,0,8)||!templateIdList(p.flagIds,APPLY_FLAG_TEMPLATES,0,4)||!Array.isArray(p.routes)||p.routes.length!==p.questionIds.length)throw Error('Invalid source-linked plan');
  const seen=new Set();for(const r of p.routes){if(!exactKeys(r,['questionId','route','evidenceIds'])||!p.questionIds.includes(r.questionId)||seen.has(r.questionId)||!STUDY_BRIEF_ROUTES.includes(r.route)||!Array.isArray(r.evidenceIds)||r.evidenceIds.length>3||new Set(r.evidenceIds).size!==r.evidenceIds.length||r.evidenceIds.some(id=>!ids.has(id))||r.route==='answered_by_record'&&!r.evidenceIds.length)throw Error('Invalid question route');seen.add(r.questionId);}
  if(!Array.isArray(p.prioritizedQuestionIds)||p.prioritizedQuestionIds.length>3||new Set(p.prioritizedQuestionIds).size!==p.prioritizedQuestionIds.length||p.prioritizedQuestionIds.some(id=>!p.routes.some(r=>r.questionId===id&&r.route==='ask_coordinator')))throw Error('Invalid question priority');
 }if(v.apiTrace!==undefined)parseStudyBriefTrace(v.apiTrace,v);
 if(utf8Bytes(v)>MAX_MESSAGE_BYTES-1024)throw Error('Study brief too large');return v;
}

// Display-only record of the OpenAI calls behind one study brief, shown under "How this was generated". Request bodies are the objects the
// native helper hands to its transport (pretty-printed); headers, credentials and provider session IDs are never part of it. In memory only.
export const STUDY_BRIEF_TOOL_NAME='get_public_selected_study';
export const STUDY_BRIEF_TRACE_BODY_MAX_BYTES=64*1024;
export const STUDY_BRIEF_TRACE_MAX_TOOL_CALLS=6;
export const STUDY_BRIEF_TRACE_MAX_DECISIONS=16;
// The shape of an OpenAI API key; a body that contains one is refused rather than displayed.
const KEY_LIKE=/(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/;
// Size of text once it sits inside a JSON reply: quoted, with quotes and line breaks escaped (the two enclosing quotes excluded).
const jsonCost=text=>utf8Bytes(JSON.stringify(text))-2;
export function traceBodyCost(body){return jsonCost(JSON.stringify(body,null,2));}
/** Pretty-prints one request body for display. A body whose reply cost exceeds maxCost is cut at a line (or character) boundary and flagged truncated;
 * `bytes` is always the full pretty-printed size. This only shortens the display copy; the API request itself is never changed. */
export function traceBody(body,maxCost=STUDY_BRIEF_TRACE_BODY_MAX_BYTES){
 const full=JSON.stringify(body,null,2),bytes=utf8Bytes(full),cap=Math.max(0,Math.min(Math.floor(maxCost),STUDY_BRIEF_TRACE_BODY_MAX_BYTES));
 if(jsonCost(full)<=cap)return{text:full,bytes,truncated:false};
 let text='',cost=0;
 for(const [i,line] of full.split('\n').entries()){
  const c=jsonCost(line)+(i?2:0);
  if(cost+c<=cap){text+=(i?'\n':'')+line;cost+=c;continue}
  // The next line does not fit whole: keep as many of its characters (never half of one) as the remaining room allows.
  let used=cost+(i?2:0),part='';if(used<cap)for(const ch of line){const w=jsonCost(ch);if(used+w>cap)break;part+=ch;used+=w}
  text+=(i&&part?'\n':'')+part;break;
 }
 return{text,bytes,truncated:true};
}
function traceBodyOk(b){
 if(!exactKeys(b,['text','bytes','truncated'])||typeof b.text!=='string'||!Number.isSafeInteger(b.bytes)||typeof b.truncated!=='boolean')return false;
 const shown=utf8Bytes(b.text);if(shown>STUDY_BRIEF_TRACE_BODY_MAX_BYTES||KEY_LIKE.test(b.text))return false;
 if(b.truncated)return b.bytes>shown;
 if(b.bytes!==shown)return false;try{return isRecord(JSON.parse(b.text))}catch{return false}
}
function traceToolCallOk(c){
 if(!exactKeys(c,['tool','outcome','arguments','summary'])||c.tool!==STUDY_BRIEF_TOOL_NAME||!str(c.summary,300,false)||KEY_LIKE.test(c.summary))return false;
 if(c.outcome==='returned')return exactKeys(c.arguments,['nctId'])&&typeof c.arguments.nctId==='string'&&NCT.test(c.arguments.nctId);
 return c.outcome==='rejected'&&c.arguments===null;
}
const unit=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
function traceDecisionOk(d){
 if(!exactKeys(d,['nctId','questionId','choice','route','confidence','probabilities'])||typeof d.nctId!=='string'||!NCT.test(d.nctId)||typeof d.questionId!=='string'||!Object.hasOwn(APPLY_QUESTION_TEMPLATES,d.questionId))return false;
 // The final route is the model's choice, except that an uncited "answered by the record" is downgraded to "ask the study team".
 if(!STUDY_BRIEF_ROUTES.includes(d.choice)||!(d.route===d.choice||d.choice==='answered_by_record'&&d.route==='ask_coordinator')||!unit(d.confidence)||!exactKeys(d.probabilities,STUDY_BRIEF_ROUTES))return false;
 let sum=0;for(const route of STUDY_BRIEF_ROUTES){if(!unit(d.probabilities[route]))return false;sum+=d.probabilities[route]}
 return Math.abs(sum-1)<=.002;
}
export function parseStudyBriefTrace(t,result){
 if(!exactKeys(t,['agentsRequest','decisionsRequest','toolCalls','decisions'])||!traceBodyOk(t.agentsRequest)||!traceBodyOk(t.decisionsRequest)||!Array.isArray(t.toolCalls)||t.toolCalls.length>STUDY_BRIEF_TRACE_MAX_TOOL_CALLS||!t.toolCalls.every(traceToolCallOk)||!Array.isArray(t.decisions)||t.decisions.length>STUDY_BRIEF_TRACE_MAX_DECISIONS||!t.decisions.every(traceDecisionOk))throw Error('Invalid API trace');
 // One Decisions entry per question route, in plan order, with the same final route; none when classification failed.
 const routes=result.studyPlans.flatMap(p=>p.routes.map(r=>({nctId:p.nctId,...r})));
 if(result.decisionStatus==='failed'?t.decisions.length!==0:t.decisions.length!==routes.length||t.decisions.some((d,i)=>d.nctId!==routes[i].nctId||d.questionId!==routes[i].questionId||d.route!==routes[i].route))throw Error('Mismatched Decisions trace');
 const ids=result.briefs.map(b=>b.nctId);if(t.toolCalls.some(c=>c.arguments&&!ids.includes(c.arguments.nctId)))throw Error('Mismatched tool call trace');
 return t;
}
