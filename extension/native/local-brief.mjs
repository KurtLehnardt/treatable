// Local study brief pipeline: the same pinned public excerpts and the same validators as the OpenAI path, run by a model on this device
// through the helper's own dedicated Ollama runtime. Nothing in this module reads a credential or contacts OpenAI.
import{ApiError}from'./transport.mjs';
import{parseBriefAgentOutput,routeBriefPlans,fallbackPlan,unroutedPlans}from'./study-brief.mjs';
import{APPLY_QUESTION_TEMPLATES,APPLY_PRESCREEN_TEMPLATES,APPLY_FLAG_TEMPLATES,STUDY_BRIEF_ROUTES,parseStudyBriefResult,localTraceBody,LOCAL_TRACE_BODY_MAX_BYTES}from'../shared/apply-contract.mjs';
import{MAX_MESSAGE_BYTES,utf8Bytes,isRecord}from'../shared/demo-contract.mjs';
import{UNTRUSTED_TEXT_RULE,UNTRUSTED_FIELD}from'../shared/untrusted-text.mjs';
// At most this many sourced claims per study. Each claim repeats its excerpt twice, so the cap bounds local generation time.
export const LOCAL_MAX_CLAIMS=4;
// Claim sources longer than this stay out of the local selection (each claim repeats its text twice); they remain visible as source passages.
export const LOCAL_CLAIM_MAX_CHARS=600;
// Within the shared 3 to 8 question bound; fewer entries keep local generation short.
export const LOCAL_MAX_QUESTIONS=6;
export const LOCAL_BRIEF_TIMEOUT_MS=150000;
export const LOCAL_ROUTING_TIMEOUT_MS=75000;
// Output token ceilings. They are generous for the schema-constrained JSON and stop a runaway generation.
const BRIEF_NUM_PREDICT=6144,ROUTING_NUM_PREDICT=1536;
const str=values=>({type:'string',...(values?{enum:values}:{})});
const arr=(min,max,items)=>({type:'array',minItems:min,maxItems:max,items});
const ids=table=>str(Object.keys(table));
// Context window sized to the prompt (about 3 bytes per token for this JSON) plus the output budget, in 4096-token steps.
function contextFor(promptBytes,output){const tokens=Math.ceil(promptBytes/3)+output+512;return Math.min(32768,Math.max(8192,Math.ceil(tokens/4096)*4096));}
// Registry milestones are not participant visits, so they are never offered as claim sources (the OpenAI path is told the same).
const claimSources=brief=>brief.items.filter(i=>i.context!=='registry_milestone'&&i.text.length<=LOCAL_CLAIM_MAX_CHARS);
function studySchema(brief){
 // One alternative per source item: the model picks an item ID and constrained decoding can then only produce that item's exact text,
 // category and quote. The validators still check every claim.
 const claims=claimSources(brief).map(i=>({type:'object',additionalProperties:false,properties:{evidenceIds:{type:'array',minItems:1,maxItems:1,items:{const:i.id}},category:{const:i.category},text:{const:i.text},sourceQuotes:{type:'array',minItems:1,maxItems:1,items:{const:i.text}}},required:['evidenceIds','category','text','sourceQuotes']}));
 const evidence=str(brief.items.map(i=>i.id));
 return{type:'object',additionalProperties:false,properties:{nctId:{const:brief.nctId},claims:claims.length?arr(0,Math.min(LOCAL_MAX_CLAIMS,claims.length),{anyOf:claims}):arr(0,0,{type:'object'}),questionEvidence:arr(3,LOCAL_MAX_QUESTIONS,{type:'object',additionalProperties:false,properties:{questionId:ids(APPLY_QUESTION_TEMPLATES),evidenceIds:arr(0,3,evidence)},required:['questionId','evidenceIds']}),questionIds:arr(3,LOCAL_MAX_QUESTIONS,ids(APPLY_QUESTION_TEMPLATES)),prescreenIds:arr(2,6,ids(APPLY_PRESCREEN_TEMPLATES)),flagIds:arr(0,4,ids(APPLY_FLAG_TEMPLATES))},required:['nctId','claims','questionEvidence','questionIds','prescreenIds','flagIds']};
}
// Both local requests start with the same system message and the same public study message, so the runtime can reuse that prefix;
// the task follows in a second user message. Both use one context size, so the model is not reloaded between them.
const SHARED_SYSTEM='You help a patient understand official public ClinicalTrials.gov source excerpts for the selected studies. You have no patient information. Never infer missing criteria or results, eligibility, safety or benefit. Return only compact single-line JSON that matches the required output format. '+UNTRUSTED_TEXT_RULE;
const publicStudies=briefs=>JSON.stringify({publicOnly:true,selectedStudyIds:briefs.map(b=>b.nctId),studies:briefs.map(b=>({public:true,[UNTRUSTED_FIELD]:b}))});
const TASK_ROOM=6000;
const contextSize=briefs=>contextFor(utf8Bytes(SHARED_SYSTEM)+utf8Bytes(publicStudies(briefs))+TASK_ROOM,BRIEF_NUM_PREDICT);
function chatRequest(briefs,model,task,format,numPredict){return{model,stream:false,format,options:{temperature:0,seed:7,num_ctx:contextSize(briefs),num_predict:numPredict},keep_alive:'2m',messages:[{role:'system',content:SHARED_SYSTEM},{role:'user',content:publicStudies(briefs)},{role:'user',content:task}]};}
const BRIEF_TASK='Task: for each selected study, in the given order, select source items and catalog IDs. claims: up to '+LOCAL_MAX_CLAIMS+' source items that best explain participation (schedule, visits, procedures, sham or control allocation, possible crossover, key criteria). Each claim MUST be an EXACT COPY of ONE source item of that study: evidenceIds contains only its ID, category is its category, text and sourceQuotes are its exact text. Never paraphrase, shorten or combine items. Registry milestone dates are not participant visits. questionEvidence: 3 to '+LOCAL_MAX_QUESTIONS+' entries, one for each DIFFERENT question from the questions catalog that would help this patient talk to the study team, each listing at most 3 source item IDs of that study that directly answer it (an empty list when the record does not answer it). questionIds: exactly the question IDs of questionEvidence, in the same order. prescreenIds: 2 to 6 DIFFERENT IDs from the prescreen catalog that the study team is likely to ask about. flagIds: 0 to 4 DIFFERENT IDs from the flags catalog, only when the source items support them. Use only these catalog IDs: ';
/** Pinned at preparation: the exact first local request body. Public study excerpts only; the model name is the only caller choice. */
export function buildLocalBriefRequest(briefs,model){
 const format={type:'object',additionalProperties:false,properties:{studies:{type:'array',minItems:briefs.length,maxItems:briefs.length,prefixItems:briefs.map(studySchema)}},required:['studies']};
 return chatRequest(briefs,model,BRIEF_TASK+JSON.stringify({questions:APPLY_QUESTION_TEMPLATES,prescreen:APPLY_PRESCREEN_TEMPLATES,flags:APPLY_FLAG_TEMPLATES}),format,BRIEF_NUM_PREDICT);
}
const ROUTING_TASK='Task: route each listed study question using ONLY the public source excerpts above. answered_by_record means the cited evidence directly answers the entire question; missing costs, visit length, eligibility or timing stays ask_coordinator. ask_patient means the answer must be supplied by the patient (never infer it). ask_coordinator means not fully answered, unclear, or requiring the study team to confirm. Do not make eligibility, benefit or safety judgments. Return one entry per listed question name, in the given order. confidence is optional: your own estimate from 0 to 1 that the route is right. ';
/** The second local request: one route per selected question, with the same public input the Decisions request carries. */
export function buildLocalRoutingRequest(briefs,plans,model){
 const questions=plans.flatMap(p=>p.questionIds.map(id=>({name:`${p.nctId}_${id}`,nctId:p.nctId,question:APPLY_QUESTION_TEMPLATES[id]})));
 const entry=name=>({type:'object',additionalProperties:false,properties:{name:{const:name},route:str([...STUDY_BRIEF_ROUTES]),confidence:{type:'number',minimum:0,maximum:1}},required:['name','route']});
 const format={type:'object',additionalProperties:false,properties:{routes:{type:'array',minItems:questions.length,maxItems:questions.length,prefixItems:questions.map(q=>entry(q.name))}},required:['routes']};
 return chatRequest(briefs,model,ROUTING_TASK+JSON.stringify({questions,questionEvidence:plans.map(p=>({nctId:p.nctId,items:p.questionEvidence}))}),format,ROUTING_NUM_PREDICT);
}
/** Local routing output to the shared route rules. Confidence is kept only when the model gave one in range; it is never invented. */
export function parseLocalRouting(text,plans){
 if(typeof text!=='string'||utf8Bytes(text)>20000)throw new ApiError('LOCAL_INVALID_OUTPUT');let v;try{v=JSON.parse(text)}catch{throw new ApiError('LOCAL_INVALID_OUTPUT')}
 const expected=plans.flatMap(p=>p.questionIds.map(id=>`${p.nctId}_${id}`));
 if(!isRecord(v)||Object.keys(v).join()!=='routes'||!Array.isArray(v.routes)||v.routes.length!==expected.length)throw new ApiError('LOCAL_INVALID_OUTPUT');
 const answers=new Map(),confidences=new Map();
 for(const r of v.routes){if(!isRecord(r)||Object.keys(r).some(k=>!['name','route','confidence'].includes(k))||!expected.includes(r.name)||answers.has(r.name)||!STUDY_BRIEF_ROUTES.includes(r.route))throw new ApiError('LOCAL_INVALID_OUTPUT');answers.set(r.name,{choice:r.route});if(typeof r.confidence==='number'&&Number.isFinite(r.confidence)&&r.confidence>=0&&r.confidence<=1)confidences.set(r.name,r.confidence);}
 return{studyPlans:routeBriefPlans(plans,answers),confidences};
}
const safeCode=e=>typeof e?.code==='string'&&/^[A-Z_]{1,40}$/.test(e.code)?e.code:'LOCAL_INVALID_OUTPUT';
// Runtime-level failures make a second local request pointless; output failures still let step 2 run on the default plan, as on the OpenAI path.
const RUNTIME_FAILURES=['LOCAL_NOT_INSTALLED','LOCAL_RUNTIME_FAILED','LOCAL_MODEL_UNAVAILABLE','LOCAL_TIMEOUT','CANCELLED'];
function chatText(reply){if(!isRecord(reply)||!isRecord(reply.message)||typeof reply.message.content!=='string'||reply.remote_host||reply.remote_model)throw new ApiError('LOCAL_INVALID_OUTPUT');return reply.message.content;}
/** Runs the pinned local brief. runtime: {ensure(signal), chat(body,{signal,timeout}), describe(model,signal), version}. */
export async function runLocalStudyBrief(runtime,pinned,{signal,onTrace=()=>{},now=()=>performance.now(),briefTimeout=LOCAL_BRIEF_TIMEOUT_MS,routingTimeout=LOCAL_ROUTING_TIMEOUT_MS}={}){
 const model=pinned.engine.model;let plans=pinned.briefs.map(fallbackPlan),agentStatus='failed',decisionStatus='failed',studyPlans,stop;const failureCodes=[],steps=[],confidences=new Map();
 const step=async(name,body,timeout,parse)=>{const started=now();let output=null;onTrace({stage:`local.${name}.request`});try{const reply=await runtime.chat(body,{signal,timeout});output=chatText(reply);const value=parse(output);steps.push({step:name,status:'complete',durationMs:Math.round(now()-started),request:body,output});onTrace({stage:`local.${name}.complete`});return value;}catch(e){if(signal?.aborted)throw new ApiError('CANCELLED');steps.push({step:name,status:'failed',durationMs:Math.round(now()-started),request:body,output});throw e;}};
 try{onTrace({stage:'local.runtime.start'});await runtime.ensure(signal);const info=await runtime.describe(model,signal);if(!info.completion)throw new ApiError('LOCAL_MODEL_UNAVAILABLE');onTrace({stage:'local.runtime.ready'});}
 catch(e){if(signal?.aborted)throw new ApiError('CANCELLED');stop=RUNTIME_FAILURES.includes(e?.code)?e.code:'LOCAL_RUNTIME_FAILED';failureCodes.push(stop);}
 const thinking=!stop&&(await runtime.describe(model,signal).catch(()=>({}))).thinking===true;
 // Thinking models are asked to answer directly; the pinned body is otherwise sent unchanged and is what the trace shows.
 const withThink=body=>thinking?{...body,think:false}:body;
 if(!stop){try{plans=await step('brief',withThink(pinned.localRequest),briefTimeout,text=>{try{return parseBriefAgentOutput(text,pinned.briefs)}catch{throw new ApiError('LOCAL_INVALID_OUTPUT')}});agentStatus='complete';}catch(e){if(signal?.aborted)throw new ApiError('CANCELLED');const code=safeCode(e);failureCodes.push(code);if(RUNTIME_FAILURES.includes(code))stop=code;plans=pinned.briefs.map(fallbackPlan);}}
 if(!stop){try{const routed=await step('routing',withThink(buildLocalRoutingRequest(pinned.briefs,plans,model)),routingTimeout,text=>parseLocalRouting(text,plans));studyPlans=routed.studyPlans;for(const[k,c]of routed.confidences)confidences.set(k,c);decisionStatus='complete';}catch(e){if(signal?.aborted)throw new ApiError('CANCELLED');failureCodes.push(safeCode(e));}}
 studyPlans??=unroutedPlans(plans);
 const base={kind:'studyBrief',mode:'local',digest:pinned.digest,briefs:pinned.briefs.map((b,i)=>({...b,claims:plans[i].claims})),studyPlans,agentStatus,decisionStatus,failureCodes:[...new Set(failureCodes)].slice(0,2),cleanup:'not_started',toolCalls:0};
 const confidenceList=studyPlans.flatMap(p=>p.routes.flatMap(r=>{const c=confidences.get(`${p.nctId}_${r.questionId}`);return c===undefined?[]:[{nctId:p.nctId,questionId:r.questionId,confidence:c}]}));
 const withTrace=(result,shown=steps)=>({...result,local:localTrace(result,{model,version:runtime.version??null,steps:shown,confidences:decisionStatus==='complete'?confidenceList:[]})});
 // Never discard completed local work over a bounds failure: fall back to the verified source excerpts without claims, as the OpenAI path does.
 try{return parseStudyBriefResult(withTrace(base))}catch{return parseStudyBriefResult(withTrace({...base,briefs:pinned.briefs.map(b=>({...b,claims:[]})),agentStatus:'failed',failureCodes:[...new Set([...base.failureCodes,'LOCAL_INVALID_OUTPUT'])].slice(0,2)},steps.map(s=>s.step==='brief'?{...s,status:'failed'}:s)))}
}
// The display copies of the local request bodies and outputs share whatever room the verified result leaves under the native frame limit.
function localTrace(result,{model,version,steps,confidences}){
 const room=MAX_MESSAGE_BYTES-2048-utf8Bytes({...result,local:{model,version,steps:steps.map(s=>({step:s.step,status:s.status,durationMs:s.durationMs,request:{text:'',bytes:0,truncated:true},output:null})),confidences}});
 const parts=steps.flatMap((s,i)=>[{i,key:'output',value:s.output},{i,key:'request',value:s.request}]).filter(p=>p.value!==null);
 // Outputs first (they are short and show what the model answered), then requests, each capped at an equal share of what is left.
 let left=Math.max(0,room);const shown=steps.map(()=>({}));
 for(const[n,p]of parts.entries()){const share=Math.floor(left/(parts.length-n));const body=localTraceBody(p.value,Math.min(share,LOCAL_TRACE_BODY_MAX_BYTES));shown[p.i][p.key]=body;left-=Math.max(0,utf8Bytes(JSON.stringify(body.text))-2);}
 return{model,runtime:'ollama',version,steps:steps.map((s,i)=>({step:s.step,status:s.status,durationMs:s.durationMs,request:shown[i].request,output:shown[i].output??null})),confidences};
}
